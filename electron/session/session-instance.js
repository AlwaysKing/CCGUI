const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { ClaudeAdapter } = require('../adapters/claude/adapter')
const { CodexAdapter } = require('../adapters/codex/adapter')
const logger = require('../logger')
const historyManager = require('../storage/history-manager')
const projectConfigManager = require('../storage/project-config-manager')
const sessionConfigManager = require('../storage/session-config-manager')
const appConfigManager = require('../storage/app-config-manager')
const { resolveSessionSettings } = require('../config-resolution')

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value
    }
  }
  return null
}

function normalizeSessionControlRequest(message = {}) {
  const request = message.request && typeof message.request === 'object'
    ? message.request
    : message
  const toolName = pickFirstDefined(
    request.tool_name,
    request.toolName,
    request.method,
    message.tool_name,
    message.toolName,
    message.method,
    'Unknown'
  )
  const toolInput = pickFirstDefined(
    request.tool_input,
    request.toolInput,
    request.input,
    message.tool_input,
    message.toolInput,
    message.input,
    {}
  ) || {}
  const toolUseId = pickFirstDefined(
    request.tool_use_id,
    request.toolUseId,
    request.id,
    message.tool_use_id,
    message.toolUseId,
    message.id,
    message.request_id
  )

  return {
    ...request,
    ...message,
    request,
    request_id: pickFirstDefined(message.request_id, request.request_id, toolUseId),
    tool_use_id: toolUseId,
    toolUseId: toolUseId,
    tool_name: toolName,
    toolName,
    tool_input: toolInput,
    toolInput,
    input: toolInput
  }
}

function applySessionEnvInfoPatch(envInfo = {}, options = {}) {
  const provider = options.provider || envInfo.provider || 'claude'
  const providerPid = pickFirstDefined(
    options.providerPid,
    envInfo.providerPid,
    null
  )

  return {
    ...envInfo,
    provider,
    providerPid
  }
}

/**
 * SessionInstance
 * 每个会话的独立实例，包含该会话的所有数据和状态
 */
class SessionInstance {
  constructor(sessionId, projectPath, webContents) {
    this.id = sessionId
    this.projectPath = projectPath
    this.webContents = webContents // 所属窗口的 webContents，用于向前端发送事件

    // 计算 projectId（编码后的路径，用于历史存储）
    this.projectId = this.calculateProjectId()

    // 会话数据
    this.messages = []        // 消息历史
    this.rawMessages = []     // 原始消息数据（用于详情查看）

    // 已保存到历史存储的消息 ID 集合
    this.savedMessageIds = new Set()

    // UI 状态
    this.inputMessage = ''    // 输入框内容
    this.isProcessing = false // 是否正在处理
    this.inputHistory = []    // 输入历史
    this.historyIndex = -1    // 历史浏览索引

    // 权限相关
    this.permissionMode = 'default'  // 权限模式
    this.pendingPermission = null      // 待处理的工具权限请求
    this.pendingControlRequest = null  // 待处理的控制请求（AskUserQuestion 等）
    this.pendingControlRequests = new Map()
    this.pendingToolResults = new Map() // 待处理的工具结果

    // 运行时 provider 实例（懒加载）
    this.runtimeManager = null
    this.provider = 'claude'
    this.sessionSettings = {}

    // 标记是否为手动停止（用于区分正常退出和异常退出）
    this.isManualStop = false

    // 环境信息（先用已知信息初始化，收到 system init 后更新）
    this.envInfo = {
      cwd: projectPath,
      session_id: sessionId,
      providerPid: null,
      provider: 'claude'
    }
    this.silentMessages = []

    // 流式消息处理状态
    this.currentStreamingAssistantId = null
    this.currentAssistantMessageIndex = -1
    this.currentContentBlockType = null
    this.contentBlockIndexToId = new Map()
    this.currentTurnNumber = 0
    this.hasSeenToolUseInCurrentTurn = false
  }

  /**
   * 初始化：从 jsonl 加载历史消息
   */
  async initialize() {
    await this.loadHistory()
  }

  /**
   * 获取 provider 运行时会话文件路径
   */
  getSessionFilePath() {
    if (!this.id || !this.projectPath) return null

    return path.join(os.homedir(), '.claude', 'projects', this.projectId, `${this.id}.jsonl`)
  }

  /**
   * 计算 projectId（编码后的路径）
   */
  calculateProjectId() {
    let encodedPath = this.projectPath
    if (process.platform === 'win32') {
      encodedPath = encodedPath.replace(/:/g, '').replace(/\\/g, '-')
    } else {
      encodedPath = encodedPath.replace(/\//g, '-')
    }
    if (encodedPath.startsWith('-')) {
      encodedPath = encodedPath.slice(1)
    }
    return '-' + encodedPath
  }

  /**
   * 加载历史消息
   * 仅从 CCGUI 存储加载统一语义历史消息
   */
  async loadHistory() {
    try {
      const storedMetadata = historyManager.loadMetadata(this.projectId, this.id)
      if (storedMetadata?.envInfo) {
        this.envInfo = applySessionEnvInfoPatch({
          ...this.envInfo,
          ...storedMetadata.envInfo,
          provider: storedMetadata.envInfo.provider || this.envInfo.provider
        }, {
          provider: storedMetadata.envInfo.provider || this.envInfo.provider,
          providerPid: null
        })
      }

      const ccguiMessages = historyManager.loadHistory(this.projectId, this.id)

      if (ccguiMessages.length > 0) {
        this.messages = ccguiMessages
        logger.info(`[SessionInstance] Loaded ${ccguiMessages.length} messages from CCGUI storage for session ${this.id}`)

        for (const msg of ccguiMessages) {
          this.savedMessageIds.add(msg.id)
        }
        return
      }

      logger.info(`[SessionInstance] No stored CCGUI history for session ${this.id}`)
    } catch (e) {
      logger.error(`[SessionInstance] Error loading history: ${e.message}`)
    }
  }

  /**
   * 获取会话状态（用于前端同步）
   */
  getState() {
    // 更新 envInfo 中的 PID
    if (this.envInfo) {
      const pid = this.runtimeManager?.getPid() || null
      this.envInfo = applySessionEnvInfoPatch({
        ...this.envInfo,
        provider: this.provider
      }, {
        provider: this.provider,
        providerPid: pid
      })
      historyManager.updateSessionEnvInfo(this.projectId, this.id, this.envInfo)
    }

    return {
      id: this.id,
      projectPath: this.projectPath,
      messages: this.messages,
      inputMessage: this.inputMessage,
      isProcessing: this.isProcessing,
      inputHistory: this.inputHistory,
      historyIndex: this.historyIndex,
      pendingPermission: this.pendingPermission,
      pendingControlRequest: this.pendingControlRequest,
      envInfo: this.envInfo,
      silentMessages: this.silentMessages,
      runtimeReady: this.runtimeManager?.isReady() || false,
      provider: this.provider
    }
  }

  resolveProvider(projectSettings = {}, sessionSettings = null) {
    const sessionTool = sessionSettings?.tool || sessionSettings?.provider
    if (sessionTool === 'codex') {
      return 'codex'
    }

    if (sessionTool === 'claude') {
      return 'claude'
    }

    return 'claude'
  }

  /**
   * 更新 UI 状态（从前端同步）
   */
  updateUIState(state) {
    if (state.inputMessage !== undefined) this.inputMessage = state.inputMessage
    if (state.historyIndex !== undefined) this.historyIndex = state.historyIndex
    // inputHistory 通常只增不减，这里可以选择是否同步
  }

  loadResolvedRuntimeConfig() {
    const appConfig = appConfigManager.loadConfig()
    const projectConfig = projectConfigManager.loadProjectConfig(this.projectId)
    const sessionConfig = sessionConfigManager.getSession(this.projectId, this.id)

    const settings = resolveSessionSettings(
      appConfig,
      projectConfig?.settings || {},
      sessionConfig?.settings || null
    )

    this.sessionSettings = sessionConfig?.settings || {}
    this.provider = this.resolveProvider(projectConfig?.settings || {}, this.sessionSettings)
    this.envInfo = applySessionEnvInfoPatch(this.envInfo, {
      provider: this.provider,
      providerPid: this.runtimeManager?.getPid?.() || null
    })

    return {
      settings,
      projectConfig,
      sessionConfig
    }
  }

  /**
   * 启动运行时实例（懒加载）
   */
  async startRuntime() {
    // 如果已经就绪，直接返回
    if (this.runtimeManager && this.runtimeManager.isReady()) {
      return true
    }

    // 如果存在旧的运行时实例（进程已退出），先清理
    if (this.runtimeManager) {
      logger.info(`[SessionInstance] Cleaning up old runtime manager for session ${this.id}`)
      this.runtimeManager.stop()
      this.runtimeManager = null
    }

    logger.info(`[SessionInstance] Starting runtime provider for session ${this.id}`)

    // 判断是否是新会话
    // 策略：如果文件存在且为空，删除后使用 --session-id 创建新会话
    // 如果文件存在且有内容，使用 --resume 恢复会话
    const sessionFile = this.getSessionFilePath()
    let isNewSession = true

    if (sessionFile && fs.existsSync(sessionFile)) {
      const stat = fs.statSync(sessionFile)
      if (stat.size === 0) {
        // 文件为空，删除后作为新会话处理
        logger.info(`[SessionInstance] Empty session file found, deleting: ${sessionFile}`)
        fs.unlinkSync(sessionFile)
        isNewSession = true
      } else {
        // 文件有内容，恢复会话
        isNewSession = false
      }
    }

    // 解析最终生效配置（system -> project -> session）
    let settings = null
    try {
      const resolvedConfig = this.loadResolvedRuntimeConfig()
      settings = resolvedConfig.settings
      logger.info(`[SessionInstance] Using resolved settings:`, settings)
    } catch (e) {
      logger.warn(`[SessionInstance] Failed to load settings:`, e.message)
    }

    if (this.provider === 'codex') {
      this.runtimeManager = new CodexAdapter(
        this.projectPath,
        this.id,
        isNewSession,
        this.permissionMode,
        settings,
        {
          resumeThreadId: this.sessionSettings.codexThreadId || null
        }
      )
    } else {
      this.runtimeManager = new ClaudeAdapter(
        this.projectPath,
        this.id,
        isNewSession,
        this.permissionMode,
        settings
      )
    }

    this.setupRuntimeHandlers()

    try {
      await this.runtimeManager.start()
      logger.info(`[SessionInstance] ${this.provider} started for session ${this.id}`)

      // 启动成功后立即更新 envInfo 并发送到前端
      const pid = this.runtimeManager.getPid()
      logger.info(`[SessionInstance] Provider PID: ${pid}, current envInfo:`, this.envInfo)

      if (this.envInfo) {
        this.envInfo = applySessionEnvInfoPatch({
          ...this.envInfo,
          provider: this.provider
        }, {
          provider: this.provider,
          providerPid: pid
        })
        historyManager.updateSessionEnvInfo(this.projectId, this.id, this.envInfo)
        logger.info(`[SessionInstance] Emitting env-info with PID:`, this.envInfo)
        this.emit('env-info', this.envInfo)
      } else {
        logger.warn(`[SessionInstance] envInfo is null, creating basic envInfo`)
        this.envInfo = applySessionEnvInfoPatch({
          cwd: this.projectPath,
          session_id: this.id,
          provider: this.provider
        }, {
          provider: this.provider,
          providerPid: pid
        })
        historyManager.updateSessionEnvInfo(this.projectId, this.id, this.envInfo)
        this.emit('env-info', this.envInfo)
      }

      const runtimeSessionIdentifier = this.runtimeManager.getSessionIdentifier?.()
      if (runtimeSessionIdentifier && this.envInfo.session_id !== runtimeSessionIdentifier) {
        this.envInfo.session_id = runtimeSessionIdentifier
        historyManager.updateSessionEnvInfo(this.projectId, this.id, this.envInfo)
        this.emit('env-info', this.envInfo)
      }

      const sessionSettingsPatch = this.runtimeManager.getSessionSettingsPatch?.()
      if (sessionSettingsPatch && Object.keys(sessionSettingsPatch).length > 0) {
        this.sessionSettings = {
          ...this.sessionSettings,
          ...sessionSettingsPatch
        }
        sessionConfigManager.updateSession(this.projectId, this.id, {
          settings: this.sessionSettings
        })
      }

      return true
    } catch (e) {
      logger.error(`[SessionInstance] Failed to start provider: ${e.message}`)
      this.runtimeManager = null
      throw e
    }
  }

  getProviderDisplayName() {
    return this.provider === 'codex' ? 'Codex' : 'Claude'
  }

  resolveUnifiedResult(message) {
    const latestUserMessage = this.getLatestUserMessage()
    const latestAssistantMessage = this.getAssistantMessageById(
      this.runtimeManager?.turnMessageMap?.get(message.turn?.id)
    )
    const now = Date.now()

    const resolvedDuration =
      message.duration_ms ??
      latestUserMessage?.duration ??
      (latestUserMessage?.startTime ? now - latestUserMessage.startTime : null)

    const resolvedUsage =
      message.usage ??
      latestUserMessage?.usage ??
      latestAssistantMessage?.usage ??
      null

    const resolvedTurns =
      message.num_turns ??
      this.runtimeManager?.getTurnSegmentCount?.(message.turn?.id) ??
      latestUserMessage?.numTurns ??
      1

    return {
      latestUserMessage,
      latestAssistantMessage,
      enrichedResult: {
        ...message,
        duration_ms: resolvedDuration,
        num_turns: resolvedTurns,
        usage: resolvedUsage
      }
    }
  }

  finalizeRuntimeResult(message) {
    const { latestUserMessage, latestAssistantMessage, enrichedResult } = this.resolveUnifiedResult(message)

    if (latestUserMessage) {
      latestUserMessage.duration = enrichedResult.duration_ms
      latestUserMessage.numTurns = enrichedResult.num_turns
      latestUserMessage.usage = enrichedResult.usage
      historyManager.updateMessage(this.projectId, this.id, latestUserMessage.id, {
        duration: latestUserMessage.duration,
        numTurns: latestUserMessage.numTurns,
        usage: latestUserMessage.usage
      })
    }

    if (latestAssistantMessage) {
      latestAssistantMessage.isStreaming = false
      latestAssistantMessage.duration = latestAssistantMessage.duration || enrichedResult.duration_ms
      latestAssistantMessage.usage = enrichedResult.usage || latestAssistantMessage.usage || null
    }

    this.currentStreamingAssistantId = null
    this.pendingControlRequest = null
    this.pendingControlRequests.clear()
    this.pendingPermission = null
    this.pendingControlRequestResult = null

    for (const item of this.messages) {
      if (item.isStreaming) {
        item.isStreaming = false
        if (!item.duration && item.startTime) {
          item.duration = Date.now() - item.startTime
        }
      }

      if (item.isExecuting) {
        item.isExecuting = false
        if (!item.duration && item.startTime) {
          item.duration = Date.now() - item.startTime
        }
      }
    }

    this.saveUnsavedMessages()
    this.isProcessing = false
    this.emit('state-update', { isProcessing: false })
    this.emit('result', enrichedResult)
  }

  handleRuntimeExit({ code, signal }) {
    logger.info(`[SessionInstance] Provider process exited for session ${this.id}, code: ${code}, signal: ${signal}`)

    const isAbnormalExit = !this.isManualStop && code !== 0 && code !== null

    if (this.envInfo) {
      this.envInfo = applySessionEnvInfoPatch({
        ...this.envInfo
      }, {
        provider: this.provider,
        providerPid: null
      })
      historyManager.updateSessionEnvInfo(this.projectId, this.id, this.envInfo)
      this.emit('env-info', this.envInfo)
    }

    if (this.isManualStop) {
      this.emit('normal-exit', {
        code,
        signal,
        message: `${this.getProviderDisplayName()} 进程已停止`
      })
    } else if (isAbnormalExit) {
      this.emit('abnormal-exit', {
        code,
        signal,
        message: `${this.getProviderDisplayName()} 进程异常退出 (code: ${code})`
      })
    }

    this.isManualStop = false
  }

  setupRuntimeHandlers() {
    const manager = this.runtimeManager

    manager.on('message-start', (message) => {
      this.messages.push(message)
      this.emit('message-start', message)
    })

    manager.on('message-delta', ({ messageId, field, delta }) => {
      const msg = this.messages.find(item => item.id === messageId)
      if (!msg) return

      if (field === 'thinking') {
        msg.thinking = (msg.thinking || '') + delta
        msg.hasThinking = true
      } else if (field === 'result') {
        msg.result = (msg.result || '') + delta
      } else {
        msg.content = (msg.content || '') + delta
      }

      this.emit('message-delta', { messageId, field, delta })
    })

    manager.on('message-update', ({ messageId, updates }) => {
      const msg = this.messages.find(item => item.id === messageId)
      if (msg) {
        Object.assign(msg, updates)
        if ((updates.isStreaming === false || updates.isExecuting === false) && !msg.duration && msg.startTime) {
          msg.duration = Date.now() - msg.startTime
        }
      }
      this.emit('message-update', { messageId, updates })
    })

    manager.on('tool-result', (payload) => {
      this.emit('tool-result', payload)
    })

    manager.on('message-complete', ({ messageId, updates }) => {
      const msg = this.messages.find(item => item.id === messageId)
      if (msg) {
        Object.assign(msg, updates)
        if (!msg.duration && msg.startTime) {
          msg.duration = Date.now() - msg.startTime
        }
      }
      this.emit('message-complete', {
        messageId,
        updates: {
          ...updates,
          ...(msg?.duration ? { duration: msg.duration } : {})
        }
      })
    })

    manager.on('result', (message) => {
      this.finalizeRuntimeResult(message)
    })

    manager.on('control-request', (message) => {
      const controlRequest = normalizeSessionControlRequest(message)
      this.trackPendingControlRequest(controlRequest)
      this.emit('control-request', controlRequest)
    })

    manager.on('control-response', (message) => {
      this.emit('control-response', message)
    })

    manager.on('interrupt', (message) => {
      this.currentStreamingAssistantId = null
      this.isProcessing = false
      this.emit('state-update', { isProcessing: false })
      this.emit('interrupt', message)
    })

    manager.on('env-info', (envInfo) => {
      this.envInfo = applySessionEnvInfoPatch({
        ...this.envInfo,
        ...envInfo
      }, {
        provider: this.provider,
        providerPid: manager.getPid?.() || null
      })
      historyManager.updateSessionEnvInfo(this.projectId, this.id, this.envInfo)
      this.emit('env-info', this.envInfo)
    })

    manager.on('silent-message', (message) => {
      const silentMessage = {
        id: `silent-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        ...message,
        timestamp: message.timestamp || new Date().toISOString()
      }
      this.silentMessages.push(silentMessage)
      this.emit('silent-message', silentMessage)
    })

    manager.on('system-notification', (message) => {
      this.emit('system-notification', message)
    })

    manager.on('task-event', (message) => {
      this.emit('task-event', message)
    })

    manager.on('system-message', (message) => {
      this.emit('system-message', message)
    })

    manager.on('permission-mode-change', (mode) => {
      this.emit('permission-mode-change', mode)
    })

    manager.on('fast-mode-change', (state) => {
      this.emit('fast-mode-change', state)
    })

    // CLI status
    manager.on('cli-status', (message) => {
      this.emit('cli-status', message)
    })

    // Unknown message
    manager.on('unknown_message', (message) => {
      this.emit('unknown-message', message)
    })

    manager.on('exit', ({ code, signal }) => {
      this.handleRuntimeExit({ code, signal })
    })
  }

  /**
   * 发送消息
   * @param {string|object} content - 字符串内容或完整的消息对象
   */
  async sendMessage(content) {
    // 支持两种格式：字符串或消息对象
    let userMessage
    let textContent

    // 生成真实的 UUID（用于 Claude 创建文件快照）
    const messageUuid = crypto.randomUUID()

    if (typeof content === 'string') {
      // 字符串格式：包装成消息对象
      textContent = content
      userMessage = {
        type: 'user',
        uuid: messageUuid,  // 添加 UUID
        message: {
          role: 'user',
          content: [{ type: 'text', text: content }]
        }
      }
    } else if (content && content.type === 'user' && content.message) {
      // 已经是消息对象格式
      userMessage = content
      // 如果没有 UUID，添加一个
      if (!userMessage.uuid) {
        userMessage.uuid = messageUuid
      }
      // 提取文本内容用于显示
      const msgContent = content.message.content
      if (Array.isArray(msgContent)) {
        const textPart = msgContent.find(c => c.type === 'text')
        textContent = textPart?.text || ''
      } else {
        textContent = typeof msgContent === 'string' ? msgContent : ''
      }
    } else {
      throw new Error('Invalid message format')
    }

    // 保存输入历史
    if (textContent && (this.inputHistory.length === 0 || this.inputHistory[this.inputHistory.length - 1] !== textContent)) {
      this.inputHistory.push(textContent)
      if (this.inputHistory.length > 100) {
        this.inputHistory.shift()
      }
    }
    this.historyIndex = -1

    // 添加到本地消息列表（使用真实 UUID）
    const displayMessage = {
      id: userMessage.uuid,  // 使用消息对象中的真实 UUID
      role: 'user',
      content: textContent,
      timestamp: new Date(),
      startTime: Date.now(), // 用于实时计时
      rawMessage: userMessage
    }
    this.messages.push(displayMessage)
    this.rawMessages.push(userMessage)

    // 保存用户消息到历史存储
    const msgToSave = { ...displayMessage }
    delete msgToSave.startTime
    historyManager.appendMessage(this.projectId, this.id, msgToSave)
    this.savedMessageIds.add(displayMessage.id)

    // 立即发送到前端，让用户看到自己的消息
    this.emit('message', displayMessage)

    // 更新状态
    this.isProcessing = true
    this.inputMessage = ''
    this.emit('state-update', { isProcessing: true, inputMessage: '' })

    // 懒加载：第一次发送时启动运行时
    // 注意：放在消息发送之后，这样用户能立即看到自己发送的内容
    if (!this.runtimeManager || !this.runtimeManager.isReady()) {
      try {
        this.loadResolvedRuntimeConfig()
      } catch (e) {
        logger.warn(`[SessionInstance] Failed to resolve provider before startup status:`, e.message)
      }
      // 发送启动状态提示
      this.emit('cli-status', { message: `正在启动 ${this.getProviderDisplayName()}...` })
      await this.startRuntime()
    }

    // 发送到运行时 provider
    await this.runtimeManager.sendMessage(userMessage)
  }

  /**
   * 保存所有未保存的消息到历史存储
   */
  saveUnsavedMessages() {
    let savedCount = 0
    for (const msg of this.messages) {
      if (!this.savedMessageIds.has(msg.id)) {
        // 准备保存的消息副本
        const msgToSave = { ...msg }

        // 移除不需要保存的运行时字段
        delete msgToSave.isStreaming
        delete msgToSave.isExecuting
        delete msgToSave.startTime

        historyManager.appendMessage(this.projectId, this.id, msgToSave)
        this.savedMessageIds.add(msg.id)
        savedCount++
      }
    }

    if (savedCount > 0) {
      logger.debug(`[SessionInstance] Saved ${savedCount} new messages to history`)
    }
  }

  /**
   * 保存单个消息到历史存储
   */
  saveMessageToHistory(message) {
    if (this.savedMessageIds.has(message.id)) {
      return // 已经保存过了
    }

    // 准备保存的消息副本
    const msgToSave = { ...message }

    // 移除不需要保存的运行时字段
    delete msgToSave.isStreaming
    delete msgToSave.isExecuting
    delete msgToSave.startTime
    delete msgToSave.toolInputBuffer  // 工具输入缓冲区，完整输入已在 toolInput 中

    historyManager.appendMessage(this.projectId, this.id, msgToSave)
    this.savedMessageIds.add(message.id)

    logger.debug(`[SessionInstance] Saved message ${message.id} to history`)
  }

  getLatestUserMessage() {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') {
        return this.messages[i]
      }
    }
    return null
  }

  getAssistantMessageById(messageId) {
    if (!messageId) return null
    return this.messages.find(item => item.id === messageId) || null
  }

  trackPendingControlRequest(controlRequest) {
    if (!controlRequest) return

    const candidateIds = [
      controlRequest.request_id,
      controlRequest.tool_use_id,
      controlRequest.id
    ].filter(Boolean)

    for (const candidateId of candidateIds) {
      this.pendingControlRequests.set(String(candidateId), controlRequest)
    }

    this.pendingControlRequest = controlRequest
  }

  consumePendingControlRequest(requestId) {
    const lookupId = requestId ? String(requestId) : null
    const resolvedRequest = lookupId
      ? (this.pendingControlRequests.get(lookupId) || this.pendingControlRequest)
      : this.pendingControlRequest

    if (!resolvedRequest) {
      return null
    }

    const candidateIds = [
      resolvedRequest.request_id,
      resolvedRequest.tool_use_id,
      resolvedRequest.id
    ].filter(Boolean)

    for (const candidateId of candidateIds) {
      this.pendingControlRequests.delete(String(candidateId))
    }

    if (this.pendingControlRequest === resolvedRequest) {
      this.pendingControlRequest = null
    }

    return resolvedRequest
  }

  /**
   * 发送控制响应（权限批准/拒绝）
   */
  async sendControlResponse(requestId, approved, options = {}) {
    if (!this.runtimeManager) {
      throw new Error('Provider not started')
    }

    const pendingRequest = this.consumePendingControlRequest(requestId)
    if (approved && pendingRequest) {
      const toolName = pendingRequest.tool_name || pendingRequest.toolName
      if (toolName === 'AskUserQuestion') {
        const answers = options?.updatedInput?.answers || {}
        const questionMessage = this.buildQuestionMessage(pendingRequest, answers)
        if (questionMessage) {
          this.messages.push(questionMessage)
          this.saveMessageToHistory(questionMessage)
          this.emit('message', questionMessage)
        }
      }
    }
    this.runtimeManager.sendControlResponse(requestId, approved, options)
  }

  sendRuntimeToolResult(toolUseId, content, isError = false) {
    if (!this.runtimeManager || typeof this.runtimeManager.sendToolResult !== 'function') {
      throw new Error('Current provider does not support sendToolResult')
    }

    this.runtimeManager.sendToolResult(toolUseId, content, isError)
  }

  /**
   * 发送中断请求
   */
  async sendInterrupt() {
    if (!this.runtimeManager) {
      return
    }

    this.runtimeManager.sendInterrupt()
  }

  /**
   * 发送控制请求（主动请求，如切换权限模式）
   */
  async sendControlRequest(request) {
    // 懒加载：第一次使用时启动运行时（和 sendMessage 一样）
    if (!this.runtimeManager || !this.runtimeManager.isReady()) {
      await this.startRuntime()
    }

    if (this.runtimeManager.sendControlRequest) {
      this.runtimeManager.sendControlRequest(request)
    }
  }

  /**
   * 设置权限模式
   */
  async setPermissionMode(mode) {
    logger.info(`[SessionInstance] Setting permission mode to: ${mode}`)

    // 保存权限模式
    this.permissionMode = mode

    // 如果 provider 已启动，发送 control_request
    if (this.runtimeManager && this.runtimeManager.isReady()) {
      if (typeof this.runtimeManager.setPermissionMode === 'function') {
        await this.runtimeManager.setPermissionMode(mode)
        logger.info(`[SessionInstance] Applied permission mode via adapter: ${mode}`)
        return
      }

      logger.info(`[SessionInstance] Provider has no live permission mode handler, will apply on next turn: ${mode}`)
    } else {
      logger.info(`[SessionInstance] Provider not ready, will apply permission mode on start: ${mode}`)
    }
  }

  /**
   * 向前端发送事件
   */
  emit(eventType, data) {
    if (this.webContents && !this.webContents.isDestroyed()) {
      this.webContents.send('session-event', {
        sessionId: this.id,
        eventType,
        data
      })
    }
  }

  buildQuestionMessage(controlRequest, answers = {}) {
    if (!controlRequest) return null

    const toolUseId =
      controlRequest.tool_use_id ||
      controlRequest.toolUseId ||
      controlRequest.id ||
      controlRequest.request_id

    if (!toolUseId) return null

    const toolInput =
      controlRequest.input ||
      controlRequest.tool_input ||
      controlRequest.toolInput ||
      {}

    const questionSources = Array.isArray(toolInput?.questions)
      ? toolInput.questions
      : (Array.isArray(controlRequest.questions) ? controlRequest.questions : [])

    const questions = questionSources.map((questionData, index) => {
      const questionText = String(questionData?.question || '')
      return {
        header: String(questionData?.header || `问题 ${index + 1}`),
        question: questionText,
        options: Array.isArray(questionData?.options) ? questionData.options : [],
        selectedAnswer: answers[questionText] || '',
        multiSelect: !!questionData?.multiSelect
      }
    })

    return {
      id: `question-${toolUseId}`,
      role: 'question',
      tool_use_id: toolUseId,
      questions,
      userAnswers: answers,
      resultReceived: false,
      answersConsistent: true,
      receivedAnswers: null,
      collapsed: false,
      timestamp: new Date(),
      rawMessages: [controlRequest]
    }
  }

  /**
   * 停止运行时实例
   */
  stop() {
    if (this.runtimeManager) {
      logger.info(`[SessionInstance] Stopping provider for session ${this.id}`)
      this.isManualStop = true // 标记为手动停止
      this.runtimeManager.stop()
      this.runtimeManager = null
    }
  }

  /**
   * 启动运行时实例
   */
  async start() {
    logger.info(`[SessionInstance] Starting runtime via public start() method for session ${this.id}`)
    return this.startRuntime()
  }

  /**
   * 检查运行时是否就绪
   */
  isRuntimeReady() {
    return this.runtimeManager?.isReady() || false
  }

}

module.exports = { SessionInstance }
