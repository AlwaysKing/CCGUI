const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const { ClaudeManager } = require('./claude-manager')
const logger = require('./logger')
const historyManager = require('./storage/history-manager')

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
    this.pendingToolResults = new Map() // 待处理的工具结果

    // Claude 实例（懒加载）
    this.claudeManager = null

    // 环境信息（先用已知信息初始化，收到 system init 后更新）
    this.envInfo = {
      cwd: projectPath,
      session_id: sessionId,
      claudePid: null
    }

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
   * 获取 session 文件路径（Claude CLI 格式）
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
   * 优先从 CCGUI 存储加载，如果没有则从 Claude CLI 格式加载并转换
   */
  async loadHistory() {
    try {
      // 1. 首先尝试从 CCGUI 存储加载
      const ccguiMessages = historyManager.loadHistory(this.projectId, this.id)

      if (ccguiMessages.length > 0) {
        // 直接使用 CCGUI 存储的消息（已经是显示格式）
        this.messages = ccguiMessages
        logger.info(`[SessionInstance] Loaded ${ccguiMessages.length} messages from CCGUI storage for session ${this.id}`)

        // 标记所有消息 ID 为已保存
        for (const msg of ccguiMessages) {
          this.savedMessageIds.add(msg.id)
        }
        return
      }

      // 2. 如果 CCGUI 中没有，从 Claude CLI 格式加载
      const sessionFile = this.getSessionFilePath()
      if (!sessionFile || !fs.existsSync(sessionFile)) {
        logger.info(`[SessionInstance] No history file for session ${this.id}`)
        return
      }

      logger.info(`[SessionInstance] Loading history from Claude CLI format for session ${this.id}`)
      const content = fs.readFileSync(sessionFile, 'utf-8')
      const lines = content.trim().split('\n').filter(line => line.trim())

      for (const line of lines) {
        try {
          const data = JSON.parse(line)
          this.rawMessages.push(data)
          this.processRawMessage(data, false) // false = 不发送到前端
        } catch (e) {
          // 跳过无效 JSON
        }
      }

      // 保存转换后的消息到 CCGUI 存储
      if (this.messages.length > 0) {
        historyManager.saveAllMessages(this.projectId, this.id, this.messages)
        for (const msg of this.messages) {
          this.savedMessageIds.add(msg.id)
        }
        logger.info(`[SessionInstance] Converted and saved ${this.messages.length} messages to CCGUI storage`)
      }

      logger.info(`[SessionInstance] Loaded ${this.messages.length} messages for session ${this.id}`)
    } catch (e) {
      logger.error(`[SessionInstance] Error loading history: ${e.message}`)
    }
  }

  /**
   * 解析时间戳，支持多种格式
   * - ISO 8601 字符串: "2026-03-08T12:05:04.863Z"
   * - Unix 时间戳（秒）: 1741434244
   * - Unix 时间戳（毫秒）: 1741434244863
   */
  parseTimestamp(timestamp) {
    if (!timestamp) return new Date()

    // 如果是字符串，直接用 new Date() 解析（支持 ISO 8601）
    if (typeof timestamp === 'string') {
      const date = new Date(timestamp)
      return isNaN(date.getTime()) ? new Date() : date
    }

    // 如果是数字
    if (typeof timestamp === 'number') {
      // 判断是秒还是毫秒（如果数值小于 1e12，认为是秒）
      const ms = timestamp < 1e12 ? timestamp * 1000 : timestamp
      return new Date(ms)
    }

    return new Date()
  }

  /**
   * 处理原始消息，转换为显示格式
   */
  processRawMessage(data, sendToFrontend = true) {
    // 处理 user 消息
    if (data.type === 'user') {
      const content = data.message?.content
      if (Array.isArray(content)) {
        const textContent = content.find(c => c.type === 'text')
        if (textContent) {
          const msg = {
            id: data.uuid || `user-${Date.now()}`,
            role: 'user',
            content: textContent.text,
            timestamp: this.parseTimestamp(data.timestamp),
            rawMessage: data
          }
          this.messages.push(msg)
          if (sendToFrontend) {
            this.emit('message', msg)
          }
        }
      }
    }

    // 处理 assistant 消息
    if (data.type === 'assistant') {
      const content = data.message?.content
      if (Array.isArray(content)) {
        const textContent = content.find(c => c.type === 'text')
        if (textContent) {
          const msg = {
            id: data.uuid || `assistant-${Date.now()}`,
            role: 'assistant',
            content: textContent.text,
            timestamp: this.parseTimestamp(data.timestamp),
            rawMessage: data
          }
          this.messages.push(msg)
          if (sendToFrontend) {
            this.emit('message', msg)
          }
        }
      }
    }

    // 处理 system init - 增量更新环境信息，过滤掉 null 值
    if (data.type === 'system' && data.subtype === 'init') {
      const filteredData = {}
      for (const [key, value] of Object.entries(data)) {
        if (value !== null) {
          filteredData[key] = value
        }
      }

      this.envInfo = {
        ...this.envInfo,
        ...filteredData
      }
      if (sendToFrontend) {
        this.emit('env-info', this.envInfo)
      }
    }

    // 其他消息类型可以按需处理...
  }

  /**
   * 获取会话状态（用于前端同步）
   */
  getState() {
    // 更新 envInfo 中的 PID
    if (this.envInfo) {
      this.envInfo.claudePid = this.claudeManager?.getPid() || null
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
      claudeReady: this.claudeManager?.isReady() || false
    }
  }

  /**
   * 更新 UI 状态（从前端同步）
   */
  updateUIState(state) {
    if (state.inputMessage !== undefined) this.inputMessage = state.inputMessage
    if (state.historyIndex !== undefined) this.historyIndex = state.historyIndex
    // inputHistory 通常只增不减，这里可以选择是否同步
  }

  /**
   * 启动 Claude 实例（懒加载）
   */
  async startClaude() {
    // 如果已经就绪，直接返回
    if (this.claudeManager && this.claudeManager.isReady()) {
      return true
    }

    // 如果存在旧的 ClaudeManager（进程已退出），先清理
    if (this.claudeManager) {
      logger.info(`[SessionInstance] Cleaning up old ClaudeManager for session ${this.id}`)
      this.claudeManager.stop()
      this.claudeManager = null
    }

    logger.info(`[SessionInstance] Starting Claude for session ${this.id}`)

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

    this.claudeManager = new ClaudeManager(
      this.projectPath,
      this.id,
      isNewSession,
      this.permissionMode // 传递权限模式
    )
    this.setupClaudeHandlers()

    try {
      await this.claudeManager.start()
      logger.info(`[SessionInstance] Claude started for session ${this.id}`)

      // 启动成功后立即更新 envInfo 并发送到前端
      const pid = this.claudeManager.getPid()
      logger.info(`[SessionInstance] Claude PID: ${pid}, current envInfo:`, this.envInfo)

      if (this.envInfo) {
        this.envInfo.claudePid = pid
        logger.info(`[SessionInstance] Emitting env-info with PID:`, this.envInfo)
        this.emit('env-info', this.envInfo)
      } else {
        logger.warn(`[SessionInstance] envInfo is null, creating basic envInfo`)
        this.envInfo = {
          cwd: this.projectPath,
          session_id: this.id,
          claudePid: pid
        }
        this.emit('env-info', this.envInfo)
      }

      return true
    } catch (e) {
      logger.error(`[SessionInstance] Failed to start Claude: ${e.message}`)
      this.claudeManager = null
      throw e
    }
  }

  /**
   * 设置 Claude 事件处理器
   */
  setupClaudeHandlers() {
    const manager = this.claudeManager

    // Assistant 消息
    manager.on('assistant', (message) => {
      this.handleAssistantMessage(message)
    })

    // Result 消息（包含 usage 信息）
    manager.on('result', (message) => {
      this.handleResultMessage(message)
    })

    // System 消息
    manager.on('system', (message) => {
      this.handleSystemMessage(message)
    })

    // Stream 事件（thinking_delta, text_delta 等）
    manager.on('stream_event', (message) => {
      this.handleStreamEvent(message)
    })

    // Control request（权限请求、AskUserQuestion 等）
    manager.on('control_request', (message) => {
      this.handleControlRequest(message)
    })

    // Control response
    manager.on('control_response', (message) => {
      this.handleControlResponse(message)
    })

    // Interrupt
    manager.on('interrupt', (message) => {
      this.handleInterrupt(message)
    })

    // Tool use
    manager.on('tool_use', (message) => {
      this.handleToolUse(message)
    })

    // Tool result
    manager.on('tool_result', (message) => {
      this.handleToolResult(message)
    })

    // CLI status
    manager.on('cli-status', (message) => {
      this.emit('cli-status', message)
    })

    // Unknown message
    manager.on('unknown_message', (message) => {
      this.emit('unknown-message', message)
    })

    // Process exit
    manager.on('exit', ({ code, signal }) => {
      logger.info(`[SessionInstance] Claude process exited for session ${this.id}, code: ${code}, signal: ${signal}`)
      // Update envInfo to clear PID
      if (this.envInfo) {
        this.envInfo.claudePid = null
        logger.info(`[SessionInstance] Emitting env-info with cleared PID:`, this.envInfo)
        this.emit('env-info', this.envInfo)
      }
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

    // 懒加载：第一次发送时启动 Claude
    // 注意：放在消息发送之后，这样用户能立即看到自己发送的内容
    if (!this.claudeManager || !this.claudeManager.isReady()) {
      // 发送启动状态提示
      this.emit('cli-status', { message: '正在启动 Claude...' })
      await this.startClaude()
    }

    // 发送到 Claude
    this.claudeManager.sendMessage(userMessage)
  }

  /**
   * 处理 assistant 消息
   * 注意：流式消息已经通过 message_start 创建了 assistant 消息
   * 这里只处理非流式情况或更新已有消息
   */
  handleAssistantMessage(message) {
    logger.debug('[SessionInstance] handleAssistantMessage called', { currentStreamingAssistantId: this.currentStreamingAssistantId })

    // 如果有正在流式传输的消息，跳过（前端已经通过流式事件创建了消息）
    // 注意：不要在这里清除标记，因为可能有多个 assistant 消息
    if (this.currentStreamingAssistantId) {
      logger.debug('[SessionInstance] Skipping assistant message, streaming in progress')
      return
    }

    logger.debug('[SessionInstance] Creating new assistant message (no streaming detected)')

    const content = message.message?.content
    if (Array.isArray(content)) {
      const textContent = content.find(c => c.type === 'text')
      if (textContent) {
        const messageId = message.uuid || `assistant-${Date.now()}`

        // 检查是否已存在该消息（防止重复）
        const existingMsg = this.messages.find(m => m.id === messageId)
        if (existingMsg) {
          // 更新已有消息
          existingMsg.content = textContent.text
          existingMsg.rawMessage = message
          return
        }

        // 不存在则创建新消息（非流式情况）
        const msg = {
          id: messageId,
          role: 'assistant',
          content: textContent.text,
          timestamp: new Date(),
          rawMessage: message
        }
        this.messages.push(msg)
        this.rawMessages.push(message)
        this.emit('message', msg)
      }
    }
  }

  /**
   * 处理 result 消息
   */
  handleResultMessage(message) {
    // 清除流式消息标记
    this.currentStreamingAssistantId = null

    // 更新最后一个用户消息的统计信息
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') {
        this.messages[i].duration = message.duration_ms || null
        this.messages[i].numTurns = message.num_turns || null
        this.messages[i].usage = message.usage || null

        // 更新历史存储中的用户消息
        historyManager.updateMessage(this.projectId, this.id, this.messages[i].id, {
          duration: this.messages[i].duration,
          numTurns: this.messages[i].numTurns,
          usage: this.messages[i].usage
        })
        break
      }
    }

    // 保存所有未保存的消息到历史存储
    this.saveUnsavedMessages()

    // 解锁输入
    this.isProcessing = false
    this.emit('state-update', { isProcessing: false })
    this.emit('result', message)
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
   * 处理 system 消息
   */
  handleSystemMessage(message) {
    if (message.subtype === 'init') {
      const currentPid = this.claudeManager?.getPid()
      logger.info(`[SessionInstance] System init received, current PID: ${currentPid}`)
      logger.info(`[SessionInstance] System init message:`, message)

      // 增量更新 envInfo，过滤掉 null 值，避免覆盖现有字段
      const filteredMessage = {}
      for (const [key, value] of Object.entries(message)) {
        if (value !== null) {
          filteredMessage[key] = value
        }
      }

      this.envInfo = {
        ...this.envInfo,
        ...filteredMessage,
        claudePid: currentPid || this.envInfo?.claudePid || null
      }

      logger.info(`[SessionInstance] Updated envInfo:`, this.envInfo)
      this.emit('env-info', this.envInfo)
    } else {
      this.emit('system-message', message)
    }
  }

  /**
   * 处理 stream 事件
   * 在后端构建消息，发送增量更新给前端
   */
  handleStreamEvent(message) {
    const event = message.event
    if (!event) return

    // Handle turn_start - 统计 turn 数量
    if (event.type === 'turn_start') {
      this.currentTurnNumber++
      this.updateUserMessageTurns(this.currentTurnNumber)
      return
    }

    // Handle message_start - 创建 assistant 消息
    if (event.type === 'message_start') {
      const messageId = event.message?.id || `assistant-${Date.now()}`
      const initialUsage = event.message?.usage || null

      // 保存当前流式消息 ID，用于去重
      this.currentStreamingAssistantId = messageId
      this.currentAssistantMessageIndex = this.messages.length
      this.currentContentBlockType = null
      this.contentBlockIndexToId.clear()
      this.currentTurnNumber = 0
      this.hasSeenToolUseInCurrentTurn = false

      const assistantMsg = {
        id: messageId,
        role: 'assistant',
        content: '',
        thinking: '',
        hasThinking: false,
        isStreaming: true,
        startTime: Date.now(),
        timestamp: new Date(),
        usage: initialUsage,
        turnNumber: 1,
        rawMessages: [message]
      }

      this.messages.push(assistantMsg)

      // 发送消息创建事件给前端
      this.emit('message-start', assistantMsg)

      this.updateUserMessageTurns(1)
      if (initialUsage) {
        this.accumulateUserMessageUsage(initialUsage)
      }
      return
    }

    // Handle content_block_start
    if (event.type === 'content_block_start') {
      const contentBlock = event.content_block
      this.currentContentBlockType = contentBlock?.type

      if (contentBlock?.type === 'thinking') {
        if (this.hasSeenToolUseInCurrentTurn) {
          this.currentTurnNumber++
          this.hasSeenToolUseInCurrentTurn = false
        }
        const currentMsg = this.messages[this.currentAssistantMessageIndex]
        if (currentMsg && currentMsg.role === 'assistant') {
          currentMsg.hasThinking = true
          currentMsg.thinkingCollapsed = false
          currentMsg.turnNumber = this.currentTurnNumber + 1
          if (this.currentTurnNumber > 0) {
            currentMsg.showTurnSeparator = true
          }
          // 通知前端更新
          this.emit('message-update', {
            messageId: currentMsg.id,
            updates: {
              hasThinking: true,
              thinkingCollapsed: false,
              turnNumber: currentMsg.turnNumber,
              showTurnSeparator: currentMsg.showTurnSeparator
            }
          })
        }
      } else if (contentBlock?.type === 'tool_use') {
        this.hasSeenToolUseInCurrentTurn = true
        // 跳过 AskUserQuestion
        if (contentBlock.name === 'AskUserQuestion') {
          return
        }
        const toolUseId = contentBlock.id || `tool-${Date.now()}`
        if (typeof event.index === 'number') {
          this.contentBlockIndexToId.set(event.index, toolUseId)
        }

        const toolUseMsg = {
          id: toolUseId,
          role: 'tool_use',
          toolName: contentBlock.name,
          toolInput: contentBlock.input ? { ...contentBlock.input } : {},
          toolInputBuffer: '',
          result: '',
          isError: false,
          isExecuting: true,
          request_id: toolUseId,
          collapsed: false,
          thinking: '',
          hasThinking: false,
          timestamp: new Date(),
          startTime: Date.now(),
          rawMessages: [message]
        }

        this.messages.push(toolUseMsg)

        // 发送 tool_use 消息创建事件给前端
        this.emit('message-start', toolUseMsg)
      }
      return
    }

    // Handle content_block_delta
    if (event.type === 'content_block_delta') {
      const delta = event.delta

      // Handle thinking_delta
      if (delta?.type === 'thinking_delta' && delta.thinking) {
        if (this.currentAssistantMessageIndex >= 0 && this.messages[this.currentAssistantMessageIndex]) {
          const msg = this.messages[this.currentAssistantMessageIndex]
          msg.thinking = (msg.thinking || '') + delta.thinking
          msg.hasThinking = true
          if (!msg.rawMessages) msg.rawMessages = []
          msg.rawMessages.push(message)

          // 发送增量更新给前端
          this.emit('message-delta', {
            messageId: msg.id,
            field: 'thinking',
            delta: delta.thinking
          })
        }
      }

      // Handle text_delta
      if (delta?.type === 'text_delta' && delta.text) {
        if (this.currentAssistantMessageIndex >= 0 && this.messages[this.currentAssistantMessageIndex]) {
          const msg = this.messages[this.currentAssistantMessageIndex]
          msg.content = (msg.content || '') + delta.text
          if (!msg.rawMessages) msg.rawMessages = []
          msg.rawMessages.push(message)

          // 发送增量更新给前端
          this.emit('message-delta', {
            messageId: msg.id,
            field: 'content',
            delta: delta.text
          })
        }
      }

      // Handle input_json_delta (tool use partial JSON)
      if (delta?.type === 'input_json_delta' && delta.partial_json) {
        const contentBlockId = this.contentBlockIndexToId.get(event.index)
        const toolUseMsgIndex = this.messages.findLastIndex(m =>
          m.role === 'tool_use' && m.request_id === contentBlockId
        )

        if (toolUseMsgIndex >= 0) {
          const toolUseMsg = this.messages[toolUseMsgIndex]

          // 累积 partial_json 片段
          if (!toolUseMsg.toolInputBuffer) {
            toolUseMsg.toolInputBuffer = ''
          }
          toolUseMsg.toolInputBuffer += delta.partial_json

          // 尝试解析累积的缓冲区
          try {
            const parsedInput = JSON.parse(toolUseMsg.toolInputBuffer)
            toolUseMsg.toolInput = { ...parsedInput }

            // 发送增量更新给前端
            this.emit('message-update', {
              messageId: toolUseMsg.id,
              updates: { toolInput: toolUseMsg.toolInput }
            })
          } catch (e) {
            // JSON 还不完整，忽略 - 继续累积
          }
        }
      }
      return
    }

    // Handle content_block_stop
    if (event.type === 'content_block_stop') {
      // 内容块结束，清理当前类型
      this.currentContentBlockType = null
      return
    }

    // Handle message_delta - 包含最终的 usage 信息和 stop_reason
    if (event.type === 'message_delta') {
      if (this.currentAssistantMessageIndex >= 0 && this.messages[this.currentAssistantMessageIndex]) {
        const assistantMsg = this.messages[this.currentAssistantMessageIndex]

        // 更新 usage 信息
        if (event.usage) {
          assistantMsg.usage = event.usage
        }

        // 更新 stop_reason
        if (event.delta?.stop_reason) {
          assistantMsg.stopReason = event.delta.stop_reason
        }

        // 通知前端更新
        this.emit('message-update', {
          messageId: assistantMsg.id,
          updates: {
            usage: assistantMsg.usage,
            stopReason: assistantMsg.stopReason
          }
        })
      }
      return
    }

    // Handle message_stop - 消息完成，保存到历史
    if (event.type === 'message_stop') {
      if (this.currentAssistantMessageIndex >= 0 && this.messages[this.currentAssistantMessageIndex]) {
        const assistantMsg = this.messages[this.currentAssistantMessageIndex]
        assistantMsg.isStreaming = false

        // 计算并设置 duration
        if (assistantMsg.startTime && !assistantMsg.duration) {
          assistantMsg.duration = Date.now() - assistantMsg.startTime
        }

        // 自动折叠思考过程
        if (assistantMsg.hasThinking && assistantMsg.thinking) {
          assistantMsg.thinkingCollapsed = true
        }

        // 通知前端消息完成
        this.emit('message-complete', {
          messageId: assistantMsg.id,
          updates: {
            isStreaming: false,
            duration: assistantMsg.duration,
            thinkingCollapsed: assistantMsg.thinkingCollapsed
          }
        })

        // 保存到历史存储
        this.saveMessageToHistory(assistantMsg)
      }

      this.currentAssistantMessageIndex = -1
      this.currentContentBlockType = null
      return
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

  /**
   * 累加更新用户消息的 usage 统计
   */
  accumulateUserMessageUsage(newUsage) {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') {
        const userMsg = this.messages[i]
        const currentUsage = userMsg.usage || { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 }
        userMsg.usage = {
          input_tokens: (currentUsage.input_tokens || 0) + (newUsage.input_tokens || 0),
          output_tokens: (currentUsage.output_tokens || 0) + (newUsage.output_tokens || 0),
          cache_read_input_tokens: (currentUsage.cache_read_input_tokens || 0) + (newUsage.cache_read_input_tokens || 0)
        }
        break
      }
    }
  }

  /**
   * 更新用户消息的 turn 数量
   */
  updateUserMessageTurns(numTurns) {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (this.messages[i].role === 'user') {
        this.messages[i].numTurns = numTurns
        break
      }
    }
  }

  /**
   * 处理 control request
   */
  handleControlRequest(message) {
    this.pendingControlRequest = message
    this.emit('control-request', message)
  }

  /**
   * 处理 control response
   */
  handleControlResponse(message) {
    this.emit('control-response', message)
  }

  /**
   * 处理 interrupt
   */
  handleInterrupt(message) {
    this.currentStreamingAssistantId = null
    this.isProcessing = false
    this.emit('state-update', { isProcessing: false })
    this.emit('interrupt', message)
  }

  /**
   * 处理 tool use
   */
  handleToolUse(message) {
    this.emit('tool-use', message)
  }

  /**
   * 处理 tool result
   */
  handleToolResult(message) {
    // 处理 tool_result，更新对应的 tool_use 消息
    if (message.message?.content) {
      const toolResultContent = message.message.content.find(c => c.type === 'tool_result')
      if (toolResultContent) {
        const toolUseId = toolResultContent.tool_use_id

        // 查找对应的 tool_use 消息
        for (let i = this.messages.length - 1; i >= 0; i--) {
          const msg = this.messages[i]
          if (msg.role === 'tool_use' && (msg.id === toolUseId || msg.request_id === toolUseId)) {
            msg.isExecuting = false
            msg.isError = toolResultContent.is_error || false
            msg.result = toolResultContent.content || '(无输出)'
            msg.duration = Date.now() - (msg.startTime || Date.now())

            // 通知前端更新
            this.emit('message-update', {
              messageId: msg.id,
              updates: {
                isExecuting: false,
                isError: msg.isError,
                result: msg.result,
                duration: msg.duration
              }
            })

            // 保存到历史存储
            this.saveMessageToHistory(msg)
            break
          }
        }
      }
    }

    // 同时发送原始事件（兼容旧逻辑）
    this.emit('tool-result', message)
  }

  /**
   * 发送控制响应（权限批准/拒绝）
   */
  async sendControlResponse(requestId, approved, options = {}) {
    if (!this.claudeManager) {
      throw new Error('Claude not started')
    }

    this.claudeManager.sendControlResponse(requestId, approved, options)
    this.pendingControlRequest = null
  }

  /**
   * 发送中断请求
   */
  async sendInterrupt() {
    if (!this.claudeManager) {
      return
    }

    this.claudeManager.sendInterrupt()
  }

  /**
   * 发送控制请求（主动请求，如切换权限模式）
   */
  async sendControlRequest(request) {
    // 懒加载：第一次使用时启动 Claude（和 sendMessage 一样）
    if (!this.claudeManager || !this.claudeManager.isReady()) {
      await this.startClaude()
    }

    this.claudeManager.sendControlRequest(request)
  }

  /**
   * 设置权限模式
   */
  async setPermissionMode(mode) {
    logger.info(`[SessionInstance] Setting permission mode to: ${mode}`)

    // 保存权限模式
    this.permissionMode = mode

    // 如果 Claude 已启动，发送 control_request
    if (this.claudeManager && this.claudeManager.isReady()) {
      await this.sendControlRequest({
        subtype: 'set_permission_mode',
        mode: mode
      })
      logger.info(`[SessionInstance] Sent permission mode change to Claude: ${mode}`)
    } else {
      logger.info(`[SessionInstance] Claude not ready, will apply permission mode on start: ${mode}`)
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

  /**
   * 停止 Claude 实例
   */
  stop() {
    if (this.claudeManager) {
      logger.info(`[SessionInstance] Stopping Claude for session ${this.id}`)
      this.claudeManager.stop()
      this.claudeManager = null
    }
  }

  /**
   * 启动 Claude 实例
   */
  async start() {
    logger.info(`[SessionInstance] Starting Claude via public start() method for session ${this.id}`)
    return this.startClaude()
  }

  /**
   * 检查 Claude 是否就绪
   */
  isClaudeReady() {
    return this.claudeManager?.isReady() || false
  }
}

module.exports = { SessionInstance }
