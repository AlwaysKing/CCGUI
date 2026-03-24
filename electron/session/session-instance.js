const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const { execFileSync } = require('child_process')
const { ClaudeAdapter } = require('../adapters/claude/adapter')
const { CodexAdapter } = require('../adapters/codex/adapter')
const logger = require('../logger')
const historyManager = require('../storage/history-manager')
const projectService = require('../services/project-service')
const appConfigManager = require('../storage/app-config-manager')
const { findProviderModel } = require('../adapters/shared/model-config')
const attachmentService = require('../services/attachment-service')
const { stripAttachmentTokens } = require('../adapters/shared/ccgui-attachments')

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value
    }
  }
  return null
}

function normalizeToolBinding(binding = null, fallbackTool = null, fallbackNativeSessionId = null) {
  const tool = typeof binding?.tool === 'string' && binding.tool.trim()
    ? binding.tool.trim()
    : (typeof fallbackTool === 'string' && fallbackTool.trim() ? fallbackTool.trim() : null)
  const nativeSessionId = typeof binding?.nativeSessionId === 'string' && binding.nativeSessionId.trim()
    ? binding.nativeSessionId.trim()
    : (typeof fallbackNativeSessionId === 'string' && fallbackNativeSessionId.trim() ? fallbackNativeSessionId.trim() : null)

  if (!tool) {
    return null
  }

  return {
    tool,
    nativeSessionId: nativeSessionId || null
  }
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

function isComposedAttachmentMessage(content) {
  return Boolean(
    content &&
    typeof content === 'object' &&
    !Array.isArray(content) &&
    typeof content.text === 'string' &&
    Array.isArray(content.attachments)
  )
}

function applySessionEnvInfoPatch(envInfo = {}, options = {}) {
  const provider = options.provider || envInfo.provider || 'claude'
  const providerPid = Object.prototype.hasOwnProperty.call(options, 'providerPid')
    ? options.providerPid
    : pickFirstDefined(
        envInfo.providerPid,
        null
      )

  return {
    ...envInfo,
    provider,
    providerPid
  }
}

function extractUserInputText(message) {
  if (!message || message.role !== 'user') {
    return ''
  }

  if (typeof message.content === 'string') {
    return message.content.trim()
  }

  if (Array.isArray(message.content)) {
    return message.content
      .map(item => {
        if (typeof item === 'string') {
          return item
        }
        if (item && typeof item.text === 'string') {
          return item.text
        }
        return ''
      })
      .join('\n')
      .trim()
  }

  return ''
}

function mergeInputHistory(existingHistory = [], messages = [], limit = 100) {
  const mergedHistory = []

  const appendEntry = (value) => {
    const text = String(value || '').trim()
    if (!text) {
      return
    }

    if (mergedHistory.length === 0 || mergedHistory[mergedHistory.length - 1] !== text) {
      mergedHistory.push(text)
      if (mergedHistory.length > limit) {
        mergedHistory.shift()
      }
    }
  }

  for (const item of existingHistory) {
    appendEntry(item)
  }

  for (const message of messages) {
    appendEntry(extractUserInputText(message))
  }

  return mergedHistory
}

function parseUnifiedDiffPaths(diffText = '') {
  if (typeof diffText !== 'string' || !diffText.trim()) {
    return []
  }

  const files = new Set()
  const patterns = [
    /^\*\*\* (?:Add|Update|Delete) File:\s+(.+)$/gm,
    /^\+\+\+\s+b\/(.+)$/gm,
    /^diff --git a\/(.+?) b\/(.+)$/gm
  ]

  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(diffText)) !== null) {
      const value = match[2] || match[1]
      if (value) {
        files.add(String(value).trim())
      }
    }
  }

  return Array.from(files)
}

function collectChangedFilePaths(value, bucket) {
  if (!value) {
    return
  }

  if (typeof value === 'string') {
    for (const filePath of parseUnifiedDiffPaths(value)) {
      bucket.add(filePath)
    }
    return
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectChangedFilePaths(item, bucket)
    }
    return
  }

  if (typeof value !== 'object') {
    return
  }

  const directPath = pickFirstDefined(
    value.file_path,
    value.filePath,
    value.path,
    value.fsPath,
    value.target_file,
    value.targetFile,
    value.move_path,
    value.movePath
  )

  if (typeof directPath === 'string' && directPath.trim()) {
    bucket.add(directPath.trim())
  }

  const nestedKeys = [
    'changes',
    'edits',
    'files',
    'fileChanges',
    'structuredPatch',
    'patch',
    'diff',
    'content'
  ]
  for (const key of nestedKeys) {
    if (value[key] !== undefined) {
      collectChangedFilePaths(value[key], bucket)
    }
  }
}

function extractChangedFilesFromToolMessage(message = {}) {
  if (message?.role !== 'tool_use' && message?.role !== 'diff') {
    return []
  }

  const normalizedToolName = String(message.toolName || '').toLowerCase()
  const candidateToolInput = message.toolInput || {}
  const files = new Set()

  const supportsFileTracking =
    normalizedToolName === 'write' ||
    normalizedToolName === 'edit' ||
    normalizedToolName === 'multiedit' ||
    normalizedToolName === 'applypatch' ||
    normalizedToolName === 'apply_patch' ||
    normalizedToolName === 'diff'

  if (!supportsFileTracking) {
    return []
  }

  collectChangedFilePaths(candidateToolInput, files)

  if (files.size === 0 && typeof message.result === 'string') {
    collectChangedFilePaths(message.result, files)
  }

  if (files.size === 0 && Array.isArray(message.rawMessages)) {
    for (const rawMessage of message.rawMessages) {
      collectChangedFilePaths(rawMessage, files)
    }
  }

  return Array.from(files)
}

function extractChangedFilesFromControlResponse(message = {}) {
  const response = message?.response?.response || message?.response || {}
  const files = response?.changed_files || response?.filesChanged || response?.restored_files || []
  if (!Array.isArray(files)) {
    return []
  }

  return Array.from(new Set(
    files
      .map(file => (typeof file === 'string' ? file.trim() : null))
      .filter(Boolean)
  ))
}

function extractDiffTextFromMessage(message = {}) {
  if (!message || message.role !== 'diff') {
    return ''
  }

  if (typeof message.toolInput?.diff === 'string' && message.toolInput.diff.trim()) {
    return message.toolInput.diff
  }

  if (Array.isArray(message.rawMessages)) {
    for (let index = message.rawMessages.length - 1; index >= 0; index -= 1) {
      const rawMessage = message.rawMessages[index]
      const diffText = rawMessage?.params?.diff
      if (typeof diffText === 'string' && diffText.trim()) {
        return diffText
      }
    }
  }

  return ''
}

function collectUnifiedDiffStats(diffText = '') {
  if (typeof diffText !== 'string' || !diffText.trim()) {
    return { insertions: 0, deletions: 0 }
  }

  let insertions = 0
  let deletions = 0
  for (const line of diffText.split('\n')) {
    if (!line) continue
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') || line.startsWith('diff --git')) {
      continue
    }
    if (line === '\\ No newline at end of file') {
      continue
    }
    if (line.startsWith('+')) {
      insertions += 1
    } else if (line.startsWith('-')) {
      deletions += 1
    }
  }

  return { insertions, deletions }
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
    this.inputAttachments = []
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
    this.pendingLifecycleReason = null
    this.pendingPostStartNotification = null
    this.pendingLifecycleOperation = null

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
    this.activeResponseUserMessageId = null
    this.currentTurnChangedFiles = new Set()
  }

  /**
   * 初始化：从 jsonl 加载历史消息
   */
  async initialize() {
    await this.loadHistory()
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
        this.inputHistory = mergeInputHistory(this.inputHistory, ccguiMessages)
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
      inputAttachments: this.inputAttachments,
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
    const sessionTool = sessionSettings?.toolBinding?.tool || sessionSettings?.tool || sessionSettings?.provider
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
    if (state.inputAttachments !== undefined) this.inputAttachments = Array.isArray(state.inputAttachments) ? state.inputAttachments : []
    if (state.historyIndex !== undefined) this.historyIndex = state.historyIndex
    // inputHistory 通常只增不减，这里可以选择是否同步
  }

  loadResolvedRuntimeConfig() {
    const { settings, projectConfig, sessionConfig } = projectService.resolveRuntimeConfig(
      this.projectId,
      this.id
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

    // Session runtime only provides generic resume hints.
    // Provider-specific resume/new-session resolution belongs in the provider layer.
    const isNewSession = this.messages.length === 0 && !this.sessionSettings.codexThreadId

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
          resumeThreadId: this.sessionSettings.codexThreadId || null,
          debug: this.sessionSettings.debug === true
        }
      )
    } else {
      this.runtimeManager = new ClaudeAdapter(
        this.projectPath,
        this.id,
        isNewSession,
        this.permissionMode,
        settings,
        {
          debug: this.sessionSettings.debug === true
        }
      )
    }

    this.setupRuntimeHandlers()

    try {
      const lifecycleReason = this.pendingLifecycleReason || 'auto-start'
      if (lifecycleReason === 'restart-for-config') {
        this.emitLifecycleStartNotification('session-runtime-restarting', {
          reason: lifecycleReason,
          changeType: this.pendingLifecycleOperation?.changeType || null
        })
      } else {
        this.emitLifecycleStartNotification('session-runtime-starting', {
          reason: lifecycleReason
        })
      }

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

      this.persistRuntimeSessionSettingsPatch()

      const readyInfo = this.pendingPostStartNotification
        ? {
            operationId: this.pendingLifecycleOperation?.id || null,
            durationMs: this.pendingLifecycleOperation?.startedAt
              ? Math.max(0, Date.now() - this.pendingLifecycleOperation.startedAt)
              : null,
            descriptor: this.resolveRuntimeDescriptor()
          }
        : this.emitLifecycleReadyNotification()

      if (this.pendingPostStartNotification) {
        this.emit('system-notification', {
          ...this.pendingPostStartNotification,
          operationId: readyInfo.operationId,
          durationMs: readyInfo.durationMs,
          provider: readyInfo.descriptor.provider,
          model: readyInfo.descriptor.model,
          modelId: readyInfo.descriptor.modelId,
          subModel: readyInfo.descriptor.subModel,
          effort: readyInfo.descriptor.effort
        })
        this.pendingPostStartNotification = null
      }

      this.pendingLifecycleReason = null
      this.pendingLifecycleOperation = null

      return true
    } catch (e) {
      logger.error(`[SessionInstance] Failed to start provider: ${e.message}`)
      this.pendingLifecycleOperation = null
      this.runtimeManager = null
      throw e
    }
  }

  getProviderDisplayName() {
    return this.provider === 'codex' ? 'Codex' : 'Claude'
  }

  resolveNotificationScope(notificationType, data = {}) {
    const type = notificationType || data?.type || ''
    if (
      type === 'runtime-exit' ||
      type === 'runtime-stopped' ||
      type === 'session-runtime-starting' ||
      type === 'session-runtime-restarting' ||
      type === 'session-runtime-ready' ||
      type === 'session-config-applied' ||
      type === 'session-effort-changed'
    ) {
      return 'session'
    }

    return 'turn'
  }

  appendSystemNotificationMessage(notificationType, data = {}) {
    const message = {
      id: `system-notification-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'system_notification',
      notificationType,
      scope: this.resolveNotificationScope(notificationType, data),
      data,
      timestamp: new Date()
    }

    this.messages.push(message)
    this.saveMessageToHistory(message)
    return message
  }

  syncSystemNotificationMessage(notificationType, data = {}) {
    const operationId = typeof data?.operationId === 'string' ? data.operationId : ''
    if (
      operationId && (
        notificationType === 'session-runtime-ready' ||
        notificationType === 'session-config-applied' ||
        notificationType === 'session-effort-changed'
      )
    ) {
      const pendingMessage = [...this.messages].reverse().find(message =>
        message.role === 'system_notification' &&
        (message.notificationType === 'session-runtime-starting' || message.notificationType === 'session-runtime-restarting') &&
        message.data?.operationId === operationId
      )

      if (pendingMessage) {
        pendingMessage.notificationType = notificationType
        pendingMessage.scope = this.resolveNotificationScope(notificationType, data)
        pendingMessage.data = {
          ...pendingMessage.data,
          ...data,
          completedAt: Date.now(),
          durationMs: data.durationMs ?? pendingMessage.data?.durationMs ?? null
        }
        pendingMessage.timestamp = new Date()
        historyManager.updateMessage(this.projectId, this.id, pendingMessage.id, {
          notificationType: pendingMessage.notificationType,
          scope: pendingMessage.scope,
          data: pendingMessage.data,
          timestamp: pendingMessage.timestamp
        })
        return pendingMessage
      }
    }

    return this.appendSystemNotificationMessage(notificationType, data)
  }

  createLifecycleOperation(type, metadata = {}) {
    const now = Date.now()
    const operation = {
      id: `lifecycle-${this.id}-${now}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      startedAt: now,
      ...metadata
    }
    this.pendingLifecycleOperation = operation
    return operation
  }

  resolveRuntimeDescriptor() {
    const appConfig = appConfigManager.loadConfig()
    const { settings } = projectService.resolveRuntimeConfig(this.projectId, this.id)
    const provider = this.provider || this.envInfo?.provider || 'claude'
    const selectedSystemModelId = provider === 'codex'
      ? ((settings?.targetKind === 'openai') ? null : (appConfig?.settings?.selectedCodexModelId || null))
      : (appConfig?.settings?.selectedClaudeModelId || null)
    const effectiveModelId = settings?.modelId || selectedSystemModelId || null
    const configuredModel = effectiveModelId
      ? findProviderModel(appConfig, provider, effectiveModelId)
      : null

    let configuredSubModel = ''
    if (configuredModel) {
      const cards = Array.isArray(configuredModel.modelCards) ? configuredModel.modelCards : []
      const targetCard = settings?.modelCardId
        ? cards.find(card => card.id === settings.modelCardId)
        : (cards.find(card => card.id === configuredModel.defaultCardId) || cards[0] || null)
      configuredSubModel = targetCard?.modelName || ''
    }

    return {
      provider,
      model: configuredModel?.friendlyName || effectiveModelId || '系统',
      modelId: effectiveModelId,
      subModel: (typeof this.envInfo?.model === 'string' && this.envInfo.model.trim()) || configuredSubModel || '',
      effort: (typeof this.envInfo?.model_reasoning_effort === 'string' && this.envInfo.model_reasoning_effort.trim())
        || (typeof settings?.effort === 'string' ? settings.effort.trim() : '')
        || 'medium'
    }
  }

  persistRuntimeSessionSettingsPatch() {
    const sessionSettingsPatch = this.runtimeManager.getSessionSettingsPatch?.()
    if (!sessionSettingsPatch || Object.keys(sessionSettingsPatch).length === 0) {
      return
    }

    const normalizedPatch = { ...sessionSettingsPatch }
    normalizedPatch.toolBinding = normalizeToolBinding(
      normalizedPatch.toolBinding,
      normalizedPatch.tool || normalizedPatch.provider || this.provider || this.sessionSettings?.toolBinding?.tool || this.sessionSettings?.tool || this.sessionSettings?.provider || null,
      normalizedPatch.codexThreadId || this.sessionSettings?.toolBinding?.nativeSessionId || null
    )
    const currentThreadId = typeof this.sessionSettings?.codexThreadId === 'string'
      ? this.sessionSettings.codexThreadId.trim()
      : ''
    const nextThreadId = typeof normalizedPatch.codexThreadId === 'string'
      ? normalizedPatch.codexThreadId.trim()
      : ''

    if (currentThreadId && nextThreadId && currentThreadId !== nextThreadId) {
      const aliasValues = Array.isArray(this.sessionSettings?.codexThreadAliases)
        ? this.sessionSettings.codexThreadAliases
        : []
      const aliasSet = new Set(
        aliasValues
          .filter(value => typeof value === 'string')
          .map(value => value.trim())
          .filter(Boolean)
      )
      aliasSet.add(currentThreadId)
      aliasSet.delete(nextThreadId)
      normalizedPatch.codexThreadAliases = Array.from(aliasSet)
    }

    const hasChanges = Object.keys(normalizedPatch).some(key => {
      if (key === 'toolBinding') {
        return JSON.stringify(this.sessionSettings?.toolBinding || null) !== JSON.stringify(normalizedPatch.toolBinding || null)
      }
      return this.sessionSettings?.[key] !== normalizedPatch[key]
    })
    if (!hasChanges) {
      return
    }

    this.sessionSettings = {
      ...this.sessionSettings,
      ...normalizedPatch
    }
    projectService.updateSessionSettings(this.projectId, this.id, this.sessionSettings)
  }

  emitLifecycleStartNotification(type, metadata = {}) {
    const operation = this.createLifecycleOperation(type, metadata)
    const payload = {
      type,
      provider: this.provider,
      operationId: operation.id,
      startedAt: operation.startedAt,
      reason: metadata.reason || this.pendingLifecycleReason || 'auto-start',
      changeType: metadata.changeType || null
    }
    this.syncSystemNotificationMessage(type, payload)
    this.emit('system-notification', payload)
    return operation
  }

  emitLifecycleReadyNotification() {
    const descriptor = this.resolveRuntimeDescriptor()
    const operation = this.pendingLifecycleOperation
    const durationMs = operation?.startedAt ? Math.max(0, Date.now() - operation.startedAt) : null

    const payload = {
      type: 'session-runtime-ready',
      provider: descriptor.provider,
      operationId: operation?.id || null,
      reason: operation?.reason || this.pendingLifecycleReason || 'auto-start',
      durationMs,
      model: descriptor.model,
      modelId: descriptor.modelId,
      subModel: descriptor.subModel,
      effort: descriptor.effort
    }
    this.syncSystemNotificationMessage('session-runtime-ready', payload)
    this.emit('system-notification', payload)

    return {
      operationId: operation?.id || null,
      durationMs,
      descriptor
    }
  }

  emitConfigAppliedNotification(changeType, applyMode = 'saved', extra = {}) {
    const descriptor = this.resolveRuntimeDescriptor()
    const operation = this.pendingLifecycleOperation
    const durationMs = operation?.startedAt ? Math.max(0, Date.now() - operation.startedAt) : null

    const payload = {
      type: 'session-config-applied',
      provider: descriptor.provider,
      operationId: operation?.id || null,
      changeType,
      applyMode,
      durationMs,
      model: descriptor.model,
      modelId: descriptor.modelId,
      subModel: descriptor.subModel,
      effort: descriptor.effort,
      ...extra
    }
    this.syncSystemNotificationMessage('session-config-applied', payload)
    this.emit('system-notification', payload)
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
      this.appendChangedFilesSummaryMessage(latestAssistantMessage)
      this.refreshChangedFilesSummary(latestUserMessage, latestAssistantMessage)
    }

    this.currentStreamingAssistantId = null
    this.activeResponseUserMessageId = null
    this.pendingControlRequest = null
    this.pendingControlRequests.clear()
    this.pendingPermission = null
    this.pendingControlRequestResult = null
    this.currentTurnChangedFiles = new Set()

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

    if (this.isManualStop && this.pendingLifecycleReason === 'restart-for-config') {
      // Controlled restart: lifecycle is represented by restarting/ready notifications.
    } else if (this.isManualStop) {
      this.emit('normal-exit', {
        code,
        signal,
        provider: this.provider,
        reason: this.pendingLifecycleReason || 'user-stop',
        message: `${this.getProviderDisplayName()} 已停止运行`
      })
    } else if (isAbnormalExit) {
      this.emit('abnormal-exit', {
        code,
        signal,
        provider: this.provider,
        reason: 'crash',
        message: `${this.getProviderDisplayName()} 进程异常退出 (code: ${code})`
      })
    }

    if (!isAbnormalExit) {
      this.pendingLifecycleReason = null
    }
    this.isManualStop = false
  }

  setupRuntimeHandlers() {
    const manager = this.runtimeManager

    manager.on('message-start', (message) => {
      this.messages.push(message)
      this.registerChangedFilesFromToolMessage(message)
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
        this.registerChangedFilesFromToolMessage(msg)
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
        this.registerChangedFilesFromToolMessage(msg)
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
      this.persistRuntimeSessionSettingsPatch()
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
      if (message?.type === 'session-model-changed') {
        this.emitConfigAppliedNotification('submodel', 'live', {
          provider: message.provider || this.provider,
          subModel: message.model || null
        })
        return
      }

      if (message?.type === 'session-effort-changed') {
        this.emitConfigAppliedNotification('effort', 'live', {
          provider: message.provider || this.provider,
          effort: message.reasoningEffort || message.effort || null
        })
        return
      }

      if (message?.type) {
        this.syncSystemNotificationMessage(message.type, message)
      }
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
    let structuredAttachments = []
    let serializedText = ''

    // 生成真实的 UUID（用于 Claude 创建文件快照）
    const messageUuid = crypto.randomUUID()

    if (typeof content === 'string') {
      // 字符串格式：包装成消息对象
      textContent = content
      serializedText = content
      userMessage = {
        type: 'user',
        uuid: messageUuid,  // 添加 UUID
        message: {
          role: 'user',
          content: [{ type: 'text', text: content }]
        }
      }
    } else if (isComposedAttachmentMessage(content)) {
      logger.info('[SessionInstance] Sending composed attachment message', {
        sessionId: this.id,
        attachmentCount: content.attachments.length,
        textLength: content.text.length
      })
      structuredAttachments = attachmentService.finalizeAttachmentsForHistory(
        this.projectId,
        this.id,
        content.attachments
      )
      serializedText = content.text
      textContent = stripAttachmentTokens(serializedText, structuredAttachments)
      userMessage = {
        type: 'user',
        uuid: messageUuid,
        attachments: structuredAttachments,
        message: {
          role: 'user',
          content: [{ type: 'text', text: serializedText }]
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
        serializedText = textContent
      } else {
        textContent = typeof msgContent === 'string' ? msgContent : ''
        serializedText = textContent
      }
      structuredAttachments = Array.isArray(content.attachments) ? content.attachments : []
    } else {
      throw new Error('Invalid message format')
    }

    if (structuredAttachments.length > 0) {
      logger.info('[SessionInstance] Prepared attachments', {
        sessionId: this.id,
        attachments: structuredAttachments.map(item => ({
          id: item.id,
          kind: item.kind,
          name: item.name,
          path: item.path,
          size: item.size,
          mimeType: item.mimeType
        }))
      })
    }

    // 保存输入历史
    if (textContent && (this.inputHistory.length === 0 || this.inputHistory[this.inputHistory.length - 1] !== textContent)) {
      this.inputHistory.push(textContent)
      if (this.inputHistory.length > 100) {
        this.inputHistory.shift()
      }
    }
    this.historyIndex = -1

    // 懒加载：第一次发送时先启动运行时，启动完成后再显示用户消息
    if (!this.runtimeManager || !this.runtimeManager.isReady()) {
      try {
        this.loadResolvedRuntimeConfig()
      } catch (e) {
        logger.warn(`[SessionInstance] Failed to resolve provider before startup status:`, e.message)
      }
      await this.startRuntime()
    }

    // 添加到本地消息列表（使用真实 UUID）
    const displayMessage = {
      id: userMessage.uuid,
      role: 'user',
      content: textContent,
      serializedContent: serializedText || textContent,
      attachments: structuredAttachments,
      timestamp: new Date(),
      startTime: Date.now(),
      rawMessage: userMessage
    }
    this.messages.push(displayMessage)
    this.rawMessages.push(userMessage)
    this.activeResponseUserMessageId = displayMessage.id
    this.currentTurnChangedFiles = new Set()

    const msgToSave = { ...displayMessage }
    delete msgToSave.startTime
    historyManager.appendMessage(this.projectId, this.id, msgToSave)
    this.savedMessageIds.add(displayMessage.id)

    this.emit('message', displayMessage)

    // 更新状态
    this.isProcessing = true
    this.inputMessage = ''
    this.inputAttachments = []
    this.emit('state-update', { isProcessing: true, inputMessage: '', inputAttachments: [] })

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

  resolveCodexRollbackTurnCount(userMessageId) {
    const targetIndex = this.messages.findIndex(item => item.role === 'user' && item.id === userMessageId)
    if (targetIndex === -1) {
      throw new Error('Target user message not found')
    }

    let numTurns = 0
    for (let index = targetIndex; index < this.messages.length; index += 1) {
      if (this.messages[index]?.role === 'user') {
        numTurns += 1
      }
    }

    if (numTurns <= 0) {
      throw new Error('No turns available to rollback')
    }

    return numTurns
  }

  buildSyntheticControlResponse(subtype, response = {}) {
    return {
      type: 'control_response',
      response: {
        subtype,
        request_id: `ccgui-${subtype}-${Date.now()}`,
        response
      }
    }
  }

  collectCodexRewindPayload(userMessageId) {
    const targetIndex = this.messages.findIndex(item => item.role === 'user' && item.id === userMessageId)
    if (targetIndex === -1) {
      throw new Error('Target user message not found')
    }

    const patches = []
    const changedFiles = new Set()
    let insertions = 0
    let deletions = 0

    for (let index = targetIndex + 1; index < this.messages.length; index += 1) {
      const message = this.messages[index]
      const diffText = extractDiffTextFromMessage(message)
      if (!diffText) {
        continue
      }

      patches.push({
        messageId: message.id || `diff-${index}`,
        diff: diffText
      })

      for (const filePath of parseUnifiedDiffPaths(diffText)) {
        changedFiles.add(filePath)
      }

      const stats = collectUnifiedDiffStats(diffText)
      insertions += stats.insertions
      deletions += stats.deletions
    }

    return {
      targetIndex,
      files: Array.from(changedFiles),
      insertions,
      deletions,
      patches
    }
  }

  runReversePatchCheck(patches = [], { dryRun = false } = {}) {
    if (!Array.isArray(patches) || patches.length === 0) {
      return
    }

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-rewind-'))

    try {
      const patchPath = path.join(tempDir, 'rewind.patch')
      const combinedPatch = patches
        .slice()
        .reverse()
        .map(patch => patch.diff)
        .join('\n')
      fs.writeFileSync(patchPath, combinedPatch, 'utf8')

      const args = ['-R', '-p1', '-i', patchPath, '-s']
      if (dryRun) {
        args.unshift('--dry-run')
      }

      execFileSync('patch', args, {
        cwd: this.projectPath,
        stdio: 'pipe'
      })
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  }

  applyRewindLocally(userMessageId, rewindData = {}) {
    const targetIndex = this.messages.findIndex(item => item.role === 'user' && item.id === userMessageId)
    if (targetIndex === -1) {
      throw new Error('Target user message not found')
    }

    const targetMessage = this.messages[targetIndex] || null
    const changedFiles = Array.from(new Set(
      (rewindData?.changed_files || rewindData?.filesChanged || rewindData?.restored_files || [])
        .filter(file => typeof file === 'string' && file.trim())
        .map(file => file.trim())
    ))
    const insertions = rewindData?.insertions || rewindData?.lines_added || 0
    const deletions = rewindData?.deletions || rewindData?.lines_removed || 0
    const previewText = typeof targetMessage?.content === 'string' && targetMessage.content.trim()
      ? targetMessage.content.trim()
      : '未知消息'

    const rewindNotice = {
      id: `rewind-${Date.now()}`,
      role: 'system',
      subtype: 'rewind-notice',
      content: `已还原到「${previewText.substring(0, 30)}${previewText.length > 30 ? '...' : ''}」前的文件状态`,
      rewindToMessageId: userMessageId,
      originalMessageContent: previewText,
      restoredFilesCount: changedFiles.length,
      restoredFiles: changedFiles,
      insertions,
      deletions,
      timestamp: new Date()
    }

    this.messages.push(rewindNotice)

    this.activeResponseUserMessageId = null
    this.currentTurnChangedFiles = new Set()
    this.pendingControlRequest = null
    this.pendingControlRequests.clear()

    this.saveMessageToHistory(rewindNotice)
    this.emit('message', rewindNotice)

    return this.messages
  }

  normalizeControlRequestForProvider(request = {}) {
    const normalizedRequest = { ...request }

    if (normalizedRequest?.subtype === 'changed_files') {
      if (this.provider === 'claude') {
        normalizedRequest.subtype = 'rewind_files'
      }
      normalizedRequest.dry_run = true
    } else if (normalizedRequest?.subtype === 'rewind') {
      if (this.provider === 'claude') {
        normalizedRequest.subtype = 'rewind_files'
      }
      normalizedRequest.dry_run = false
    }

    if (
      this.provider === 'codex' &&
      (
        normalizedRequest?.subtype === 'changed_files' ||
        normalizedRequest?.subtype === 'rewind' ||
        normalizedRequest?.subtype === 'rewind_files' ||
        normalizedRequest?.subtype === 'rewind_and_fork'
      )
    ) {
      normalizedRequest.numTurns = this.resolveCodexRollbackTurnCount(normalizedRequest.user_message_id)
    }

    return normalizedRequest
  }

  registerChangedFilesFromToolMessage(message) {
    if (!this.activeResponseUserMessageId || !this.isProcessing) {
      return
    }

    for (const filePath of extractChangedFilesFromToolMessage(message)) {
      this.currentTurnChangedFiles.add(filePath)
    }
  }

  appendChangedFilesSummaryMessage(assistantMessage) {
    if (!assistantMessage || this.currentTurnChangedFiles.size === 0) {
      return
    }

    const files = Array.from(this.currentTurnChangedFiles)
    assistantMessage.changedFilesSummary = {
      count: files.length,
      files
    }

    historyManager.updateMessage(this.projectId, this.id, assistantMessage.id, {
      changedFilesSummary: assistantMessage.changedFilesSummary
    })
  }

  applyChangedFilesSummaryMessage(assistantMessage, files = []) {
    if (!assistantMessage) {
      return
    }

    const normalizedFiles = Array.from(new Set(
      (Array.isArray(files) ? files : [])
        .map(file => (typeof file === 'string' ? file.trim() : null))
        .filter(Boolean)
    ))

    if (normalizedFiles.length === 0) {
      delete assistantMessage.changedFilesSummary
      historyManager.updateMessage(this.projectId, this.id, assistantMessage.id, {
        changedFilesSummary: null
      })
      this.emit('message-update', {
        messageId: assistantMessage.id,
        updates: {
          changedFilesSummary: null
        }
      })
      return
    }

    assistantMessage.changedFilesSummary = {
      count: normalizedFiles.length,
      files: normalizedFiles
    }

    historyManager.updateMessage(this.projectId, this.id, assistantMessage.id, {
      changedFilesSummary: assistantMessage.changedFilesSummary
    })
    this.emit('message-update', {
      messageId: assistantMessage.id,
      updates: {
        changedFilesSummary: assistantMessage.changedFilesSummary
      }
    })
  }

  async requestChangedFilesForQuestion(userMessageId) {
    if (!userMessageId) {
      return []
    }

    const response = await this.sendControlRequest({
      subtype: 'changed_files',
      user_message_id: userMessageId
    })

    return extractChangedFilesFromControlResponse(response)
  }

  refreshChangedFilesSummary(userMessage, assistantMessage) {
    if (!userMessage?.id || !assistantMessage?.id) {
      return
    }

    this.requestChangedFilesForQuestion(userMessage.id)
      .then((files) => {
        const targetAssistantMessage = this.getAssistantMessageById(assistantMessage.id)
        if (!targetAssistantMessage) {
          return
        }
        this.applyChangedFilesSummaryMessage(targetAssistantMessage, files)
      })
      .catch((error) => {
        logger.warn('[SessionInstance] Failed to refresh changed_files summary', {
          sessionId: this.id,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          error: error?.message || String(error)
        })
      })
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

    const normalizedRequest = this.normalizeControlRequestForProvider(request)

    if (this.provider === 'codex' && normalizedRequest?.subtype === 'changed_files') {
      const payload = this.collectCodexRewindPayload(normalizedRequest.user_message_id)
      const response = this.buildSyntheticControlResponse('success', {
        changed_files: payload.files,
        filesChanged: payload.files,
        restored_files: payload.files,
        insertions: payload.insertions,
        deletions: payload.deletions,
        dry_run: true
      })
      this.emit('control-response', response)
      return response
    }

    if (this.provider === 'codex' && normalizedRequest?.subtype === 'rewind') {
      const payload = this.collectCodexRewindPayload(normalizedRequest.user_message_id)
      this.runReversePatchCheck(payload.patches, { dryRun: true })

      const response = this.runtimeManager.sendControlRequest
        ? await this.runtimeManager.sendControlRequest(normalizedRequest)
        : null

      if (response?.response?.error) {
        this.emit('control-response', response)
        return response
      }

      this.runReversePatchCheck(payload.patches, { dryRun: false })
      this.applyRewindLocally(normalizedRequest.user_message_id, {
        changed_files: payload.files,
        restored_files: payload.files,
        insertions: payload.insertions,
        deletions: payload.deletions
      })

      if (response) {
        this.emit('control-response', response)
        return response
      }

      const syntheticResponse = this.buildSyntheticControlResponse('success', {
        changed_files: payload.files,
        restored_files: payload.files,
        insertions: payload.insertions,
        deletions: payload.deletions,
        dry_run: false
      })
      this.emit('control-response', syntheticResponse)
      return syntheticResponse
    }

    if (this.runtimeManager.sendControlRequest) {
      const response = await this.runtimeManager.sendControlRequest(normalizedRequest)
      if (response) {
        this.emit('control-response', response)
        return response
      }
    }

    return null
  }

  syncRuntimeResolvedSettings(resolvedSettings = null) {
    if (this.runtimeManager && typeof this.runtimeManager.setResolvedSettings === 'function') {
      this.runtimeManager.setResolvedSettings(resolvedSettings)
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

  async setSessionEffort(effort, options = {}) {
    const normalizedEffort = typeof effort === 'string' ? effort.trim() : ''
    if (!normalizedEffort) {
      throw new Error('Missing effort')
    }

    const sessionConfig = projectService.getSessionConfig(this.projectId, this.id)
    const nextSettings = {
      ...((sessionConfig?.settings && typeof sessionConfig.settings === 'object') ? sessionConfig.settings : {}),
      effort: normalizedEffort
    }

    const updatedConfig = await projectService.updateSessionConfig(this.projectId, this.id, {
      name: sessionConfig?.name || '新会话',
      settings: nextSettings
    })

    if (updatedConfig?.settings) {
      this.applySessionSettings(updatedConfig.settings)
    }

    const resolvedConfig = this.loadResolvedRuntimeConfig()
    const provider = this.provider || resolvedConfig?.settings?.tool || 'claude'
    const runtimeStarted = Boolean(this.runtimeManager?.isReady?.())

    if (!runtimeStarted) {
      this.emitConfigAppliedNotification('effort', 'saved', {
        provider,
        effort: normalizedEffort
      })

      return {
        success: true,
        config: updatedConfig || null,
        effort: normalizedEffort,
        provider,
        appliedLive: false,
        restarted: false
      }
    }

    if (provider === 'codex') {
      this.syncRuntimeResolvedSettings(resolvedConfig?.settings || null)
      if (typeof this.runtimeManager?.setSessionEffort !== 'function') {
        throw new Error('Codex runtime does not support live effort switching')
      }
      const applied = await this.runtimeManager.setSessionEffort(normalizedEffort)
      this.emitConfigAppliedNotification('effort', 'live', {
        provider,
        effort: applied?.reasoningEffort || normalizedEffort,
        subModel: applied?.model || null
      })

      return {
        success: true,
        config: updatedConfig || null,
        effort: normalizedEffort,
        provider,
        appliedLive: true,
        restarted: false
      }
    }

    this.stop('restart-for-config')
    await this.start({
      reason: 'restart-for-config',
      postStartNotification: {
        type: 'session-effort-changed',
        provider,
        effort: normalizedEffort,
        applyMode: 'restart'
      }
    })

    return {
      success: true,
      config: updatedConfig || null,
      effort: normalizedEffort,
      provider,
      appliedLive: false,
      restarted: true
    }
  }

  async setSessionModel(selection = {}) {
    const nextMode = selection?.mode || 'project'
    const nextModelId = nextMode === 'custom' ? (selection.modelId || null) : null
    const nextModelCardId = nextMode === 'custom' ? (selection.modelCardId || null) : null

    const sessionConfig = projectService.getSessionConfig(this.projectId, this.id)
    const currentSettings = (sessionConfig?.settings && typeof sessionConfig.settings === 'object')
      ? sessionConfig.settings
      : {}
    const nextSettings = {
      ...currentSettings,
      modelMode: nextMode,
      modelId: nextModelId,
      modelCardId: nextModelCardId
    }

    const updatedConfig = await projectService.updateSessionConfig(this.projectId, this.id, {
      name: sessionConfig?.name || '新会话',
      settings: nextSettings
    })

    if (updatedConfig?.settings) {
      this.applySessionSettings(updatedConfig.settings)
    }

    const resolvedConfig = this.loadResolvedRuntimeConfig()

    const runtimeStarted = Boolean(this.runtimeManager?.isReady?.())
    if (!runtimeStarted) {
      this.emitConfigAppliedNotification('model', 'saved')
      return {
        success: true,
        config: updatedConfig || null,
        restarted: false
      }
    }

    if (this.provider === 'codex') {
      this.syncRuntimeResolvedSettings(resolvedConfig?.settings || null)
      if (typeof this.runtimeManager?.setSessionModel !== 'function') {
        throw new Error('Codex runtime does not support live model switching')
      }
      const applied = await this.runtimeManager.setSessionModel()
      this.emitConfigAppliedNotification('model', 'live', {
        provider: this.provider,
        model: applied?.model || null,
        effort: applied?.reasoningEffort || null
      })
      return {
        success: true,
        config: updatedConfig || null,
        restarted: false,
        appliedLive: true,
        provider: this.provider
      }
    }

    if (this.envInfo) {
      this.envInfo.model = null
      historyManager.updateSessionEnvInfo(this.projectId, this.id, this.envInfo)
      this.emit('env-info', this.envInfo)
    }

    this.pendingLifecycleOperation = {
      changeType: 'model'
    }
    this.stop('restart-for-config')
    await this.start({
      reason: 'restart-for-config',
      lifecycleContext: {
        changeType: 'model'
      },
      postStartNotification: {
        type: 'session-config-applied',
        changeType: 'model',
        applyMode: 'restart'
      }
    })

    return {
      success: true,
      config: updatedConfig || null,
      restarted: true
    }
  }

  async setSessionTarget(target = {}) {
    const nextTargetKind = typeof target?.targetKind === 'string' && target.targetKind.trim()
      ? target.targetKind.trim()
      : 'provider'
    const nextModelId = nextTargetKind === 'provider'
      ? (typeof target?.modelId === 'string' && target.modelId.trim() ? target.modelId.trim() : null)
      : null
    const nextCredentialId = nextTargetKind === 'provider'
      ? (typeof target?.credentialId === 'string' && target.credentialId.trim() ? target.credentialId.trim() : null)
      : null
    const targetValidation = await projectService.validateSessionTarget(this.projectId, this.id, {
      targetId: typeof target?.targetId === 'string' ? target.targetId : '',
      targetKind: nextTargetKind,
      modelId: nextModelId,
      credentialId: nextCredentialId
    })
    if (!targetValidation?.valid) {
      throw new Error(targetValidation?.reason || '当前会话不允许切换到该目标')
    }

    const sessionConfig = projectService.getSessionConfig(this.projectId, this.id)
    const currentSettings = (sessionConfig?.settings && typeof sessionConfig.settings === 'object')
      ? sessionConfig.settings
      : {}
    const nextModelMode = nextTargetKind === 'provider'
      ? 'custom'
      : (nextTargetKind === 'project' ? 'project' : 'system')

    const nextSettings = {
      ...currentSettings,
      modelMode: nextModelMode,
      modelId: nextModelId,
      modelCardId: nextTargetKind === 'provider' && currentSettings.modelId === nextModelId
        ? (currentSettings.modelCardId || null)
        : null,
      credentialId: nextCredentialId,
      targetKind: nextTargetKind
    }

    const updatedConfig = await projectService.updateSessionConfig(this.projectId, this.id, {
      name: sessionConfig?.name || '新会话',
      settings: nextSettings
    })

    if (updatedConfig?.settings) {
      this.applySessionSettings(updatedConfig.settings)
    }

    const runtimeStarted = Boolean(this.runtimeManager?.isReady?.())
    if (!runtimeStarted) {
      this.emitConfigAppliedNotification('target', 'saved')
      return {
        success: true,
        config: updatedConfig || null,
        restarted: false
      }
    }

    if (this.envInfo) {
      this.envInfo.model = null
      historyManager.updateSessionEnvInfo(this.projectId, this.id, this.envInfo)
      this.emit('env-info', this.envInfo)
    }

    this.pendingLifecycleOperation = {
      changeType: 'target'
    }
    this.stop('restart-for-config')
    await this.start({
      reason: 'restart-for-config',
      lifecycleContext: {
        changeType: 'target'
      },
      postStartNotification: {
        type: 'session-config-applied',
        changeType: 'target',
        applyMode: 'restart'
      }
    })

    return {
      success: true,
      config: updatedConfig || null,
      restarted: true
    }
  }

  async setSessionSubmodel(model, reasoningEffort = 'medium') {
    const normalizedModel = typeof model === 'string' ? model.trim() : ''
    const normalizedEffort = typeof reasoningEffort === 'string' ? reasoningEffort.trim() : ''
    if (!normalizedModel) {
      throw new Error('Missing model')
    }

    if (!this.runtimeManager || !this.runtimeManager.isReady()) {
      await this.startRuntime()
    }

    if (this.provider === 'codex' && typeof this.runtimeManager?.setSessionSubmodel === 'function') {
      const applied = await this.runtimeManager.setSessionSubmodel(
        normalizedModel,
        normalizedEffort || 'medium'
      )
      this.emitConfigAppliedNotification('submodel', 'live', {
        provider: this.provider,
        subModel: applied?.model || normalizedModel,
        effort: applied?.reasoningEffort || normalizedEffort || 'medium'
      })
      return {
        success: true,
        model: applied?.model || normalizedModel,
        reasoningEffort: applied?.reasoningEffort || normalizedEffort || 'medium',
        provider: this.provider,
        appliedLive: true
      }
    }

    if (this.provider === 'codex') {
      throw new Error('Codex runtime does not support live submodel switching')
    }

    if (this.runtimeManager?.sendControlRequest) {
      await this.runtimeManager.sendControlRequest({
        subtype: 'set_session_submodel',
        model: normalizedModel,
        reasoningEffort: normalizedEffort || 'medium'
      })
    }

    return {
      success: true,
      model: normalizedModel,
      reasoningEffort: normalizedEffort || 'medium',
      provider: this.provider,
      appliedLive: true
    }
  }

  applySessionSettings(settings = null) {
    this.sessionSettings = settings && typeof settings === 'object' ? { ...settings } : {}

    if (this.runtimeManager && typeof this.runtimeManager.setDebugEnabled === 'function') {
      this.runtimeManager.setDebugEnabled(this.sessionSettings.debug === true)
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
  stop(reason = 'user-stop', options = {}) {
    if (this.runtimeManager) {
      logger.info(`[SessionInstance] Stopping provider for session ${this.id}`)
      this.isManualStop = true // 标记为手动停止
      this.pendingLifecycleReason = reason || 'user-stop'
      this.pendingPostStartNotification = options.postStartNotification || null
      if (options.lifecycleContext && typeof options.lifecycleContext === 'object') {
        this.pendingLifecycleOperation = {
          ...(this.pendingLifecycleOperation || {}),
          ...options.lifecycleContext
        }
      }
      this.currentStreamingAssistantId = null
      this.isProcessing = false
      this.emit('state-update', { isProcessing: false })

      this.envInfo = applySessionEnvInfoPatch({
        ...this.envInfo,
        provider: this.provider
      }, {
        provider: this.provider,
        providerPid: null
      })
      historyManager.updateSessionEnvInfo(this.projectId, this.id, this.envInfo)
      this.emit('env-info', this.envInfo)

      // Persist the latest provider-native session/thread identifier before the
      // runtime is torn down, otherwise a closed/reopened Codex session may
      // resume with a stale thread binding.
      this.persistRuntimeSessionSettingsPatch()

      this.runtimeManager.stop()
      this.runtimeManager = null
    }
  }

  /**
   * 启动运行时实例
   */
  async start(options = {}) {
    if (options.postStartNotification) {
      this.pendingPostStartNotification = options.postStartNotification
    }
    if (options.reason) {
      this.pendingLifecycleReason = options.reason
    }
    if (options.lifecycleContext && typeof options.lifecycleContext === 'object') {
      this.pendingLifecycleOperation = {
        ...(this.pendingLifecycleOperation || {}),
        ...options.lifecycleContext
      }
    }
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
