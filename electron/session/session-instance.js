const path = require('path')
const crypto = require('crypto')
const { ClaudeAdapter } = require('../adapters/claude/adapter')
const { CodexAdapter } = require('../adapters/codex/adapter')
const logger = require('../logger')
const historyManager = require('../storage/history-manager')
const projectService = require('../services/project-service')
const appConfigManager = require('../storage/app-config-manager')
const { findProviderModel } = require('../adapters/shared/model-config')
const attachmentService = require('../services/attachment-service')
const { stripAttachmentTokens } = require('../adapters/shared/ccgui-attachments')
const processRegistry = require('../services/process-registry')

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value
    }
  }
  return null
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function normalizeAgentRegistry(entry = null) {
  if (!isPlainObject(entry)) {
    return null
  }

  const agentId = pickFirstDefined(entry.agentId, entry.agent_id)
  if (!agentId) {
    return null
  }

  return Object.fromEntries(Object.entries({
    agentId,
    agentKind: pickFirstDefined(entry.agentKind, entry.agent_kind),
    agentType: pickFirstDefined(entry.agentType, entry.agent_type),
    name: pickFirstDefined(entry.name, entry.title),
    color: pickFirstDefined(entry.color, entry.agentColor, entry.agent_color),
    prompt: pickFirstDefined(entry.prompt, entry.description),
    model: pickFirstDefined(entry.model, entry.subModel, entry.sub_model),
    teamId: pickFirstDefined(entry.teamId, entry.team_id),
    parentAgentId: pickFirstDefined(entry.parentAgentId, entry.parent_agent_id),
    status: pickFirstDefined(entry.status),
    canWrite: entry.canWrite !== undefined ? Boolean(entry.canWrite) : null,
    interactionMode: pickFirstDefined(entry.interactionMode, entry.interaction_mode)
  }).filter(([, value]) => value !== null))
}

function normalizeOrchestrationEvent(event = null) {
  if (!isPlainObject(event)) {
    return null
  }

  const eventType = pickFirstDefined(event.eventType, event.event_type)
  const agentId = pickFirstDefined(event.agentId, event.agent_id)
  if (!eventType || !agentId) {
    return null
  }

  return Object.fromEntries(Object.entries({
    eventType,
    agentId,
    agentKind: pickFirstDefined(event.agentKind, event.agent_kind),
    agentType: pickFirstDefined(event.agentType, event.agent_type),
    name: pickFirstDefined(event.name),
    color: pickFirstDefined(event.color, event.agentColor, event.agent_color),
    prompt: pickFirstDefined(event.prompt, event.description),
    model: pickFirstDefined(event.model),
    teamId: pickFirstDefined(event.teamId, event.team_id),
    parentAgentId: pickFirstDefined(event.parentAgentId, event.parent_agent_id),
    actorId: pickFirstDefined(event.actorId, event.actor_id),
    targetId: pickFirstDefined(event.targetId, event.target_id),
    source: pickFirstDefined(event.source),
    reason: pickFirstDefined(event.reason),
    result: pickFirstDefined(event.result),
    status: pickFirstDefined(event.status),
    targetKind: pickFirstDefined(event.targetKind, event.target_kind),
    timestamp: pickFirstDefined(event.timestamp),
    canWrite: event.canWrite !== undefined ? Boolean(event.canWrite) : null,
    interactionMode: pickFirstDefined(event.interactionMode, event.interaction_mode)
  }).filter(([, value]) => value !== null))
}

function normalizeAttribution(attribution = null) {
  if (!isPlainObject(attribution)) {
    return null
  }

  const agentId = pickFirstDefined(attribution.agentId, attribution.agent_id)
  const actorId = pickFirstDefined(attribution.actorId, attribution.actor_id, agentId)
  const targetId = pickFirstDefined(attribution.targetId, attribution.target_id)

  if (!agentId && !actorId && !targetId) {
    return null
  }

  return Object.fromEntries(Object.entries({
    agentId: agentId || actorId || null,
    actorId: actorId || agentId || null,
    targetId
  }).filter(([, value]) => value !== null))
}

function normalizeHistoryContext(history = null) {
  if (!isPlainObject(history)) {
    return null
  }

  return Object.fromEntries(Object.entries({
    sourceUserTurnId: pickFirstDefined(history.sourceUserTurnId, history.source_user_turn_id),
    subagentTurnId: pickFirstDefined(history.subagentTurnId, history.subagent_turn_id),
    inputKind: pickFirstDefined(history.inputKind, history.input_kind),
    deliveryKind: pickFirstDefined(history.deliveryKind, history.delivery_kind),
    senderAgentId: pickFirstDefined(history.senderAgentId, history.sender_agent_id),
    targetAgentId: pickFirstDefined(history.targetAgentId, history.target_agent_id)
  }).filter(([, value]) => value !== null))
}

function mergePlain(base = null, patch = null) {
  if (!base && !patch) {
    return null
  }

  return {
    ...(base || {}),
    ...(patch || {})
  }
}

function mergeCcguiSemantics(base = null, patch = null) {
  if (!isPlainObject(base) && !isPlainObject(patch)) {
    return null
  }

  const safeBase = isPlainObject(base) ? base : {}
  const safePatch = isPlainObject(patch) ? patch : {}
  const registry = mergePlain(
    normalizeAgentRegistry(safeBase.registry),
    normalizeAgentRegistry(safePatch.registry)
  )
  const orchestration = mergePlain(
    normalizeOrchestrationEvent(safeBase.orchestration),
    normalizeOrchestrationEvent(safePatch.orchestration)
  )
  const attribution = mergePlain(
    normalizeAttribution(safeBase.attribution),
    normalizeAttribution(safePatch.attribution)
  )
  const history = mergePlain(
    normalizeHistoryContext(safeBase.history),
    normalizeHistoryContext(safePatch.history)
  )
  const legacy = {
    subagentId: pickFirstDefined(safePatch.subagentId, safeBase.subagentId, registry?.agentId, attribution?.agentId),
    subagentType: pickFirstDefined(safePatch.subagentType, safeBase.subagentType, registry?.agentType),
    isSubagent: Boolean(
      safePatch.isSubagent ||
      safeBase.isSubagent ||
      registry?.agentId ||
      attribution?.agentId
    )
  }

  return {
    ...(registry ? { registry } : {}),
    ...(orchestration ? { orchestration } : {}),
    ...(attribution ? { attribution } : {}),
    ...(history ? { history } : {}),
    ...(legacy.subagentId || legacy.subagentType || legacy.isSubagent ? legacy : {})
  }
}

function attachExistingCcgui(payload = {}, extra = null) {
  const merged = mergeCcguiSemantics(
    isPlainObject(payload.ccgui) ? payload.ccgui : null,
    isPlainObject(extra?.ccgui) ? extra.ccgui : (isPlainObject(extra) ? extra : null)
  )

  if (!merged) {
    return payload
  }

  return {
    ...payload,
    ccgui: merged
  }
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

  return attachExistingCcgui({
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
  })
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

function isResetSubtype(subtype = '') {
  return subtype === 'reset_files' || subtype === 'rewind_files'
}

function isPatchUndoSubtype(subtype = '') {
  return subtype === 'undo_patch'
}

function isPatchRedoSubtype(subtype = '') {
  return subtype === 'redo_patch'
}

function isPatchSubtype(subtype = '') {
  return isPatchUndoSubtype(subtype) || isPatchRedoSubtype(subtype)
}

function isRestoreActionSubtype(subtype = '') {
  return isResetSubtype(subtype) || isPatchUndoSubtype(subtype)
}

function isRestoreAndForkSubtype(subtype = '') {
  return subtype === 'reset_files_and_fork' || subtype === 'undo_patch_and_fork'
}

function isUuidLike(value) {
  if (typeof value !== 'string') {
    return false
  }

  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.trim())
}

function isTurnEntryRole(role = '') {
  return role === 'user' || role === 'command'
}

function buildHistoryUserMessageFromTurn(turn = {}) {
  const timestamp = turn.createdAt || new Date().toISOString()
  const normalizedContent = typeof turn.userText === 'string'
    ? turn.userText
    : (typeof turn.serializedContent === 'string' ? turn.serializedContent : '')
  const role = turn.messageRole === 'command' ? 'command' : 'user'

  return {
    id: turn.userMessageId || turn.turnId,
    role,
    content: normalizedContent,
    serializedContent: typeof turn.serializedContent === 'string'
      ? turn.serializedContent
      : normalizedContent,
    attachments: Array.isArray(turn.attachments) ? turn.attachments : [],
    timestamp,
    ...(Number.isFinite(turn.duration) ? { duration: turn.duration } : {}),
    ...(Number.isFinite(turn.numTurns) ? { numTurns: turn.numTurns } : {}),
    ...(turn.usage ? { usage: turn.usage } : {}),
    responseCollapsed: Boolean(turn.hasAssistantResponse),
    historyTurn: {
      turnId: turn.turnId,
      streamFile: turn.streamFile || null,
      status: turn.status || 'pending',
      hasResponse: Boolean(turn.hasAssistantResponse),
      eventCount: Number(turn.eventCount || 0),
      loaded: false,
      loading: false
    }
  }
}

function buildHistoryIndexMessage(entry = {}) {
  if (entry?.entryType === 'message' && entry?.message && typeof entry.message === 'object') {
    return {
      ...entry.message
    }
  }

  return buildHistoryUserMessageFromTurn(entry)
}

function isIndexVisibleMessage(message = null) {
  if (!message || typeof message !== 'object') {
    return false
  }

  if (message.role === 'file_change_summary') {
    return true
  }

  if (message.role === 'system_notification' && message.scope === 'session') {
    return true
  }

  return message.role === 'system' && message.subtype === 'rewind-notice'
}

const SESSION_NOTIFICATION_TYPES = new Set([
  'runtime-exit',
  'runtime-stopped',
  'session-runtime-starting',
  'session-runtime-restarting',
  'session-runtime-ready',
  'mcp-server-starting',
  'mcp-server-ready',
  'mcp-server-error',
  'mcp-server-status',
  'session-config-applied',
  'session-effort-changed',
  'permission-mode-change',
  'fast-mode-change',
  'compact-boundary',
  'context_compacted',
  'model-rerouted',
  'turn-error',
  'turn-interrupted',
  'thread-event',
  'turn-plan-updated',
  'provider-deprecation',
  'provider-config-warning',
  'account-login-completed',
  'hook-event',
  'provider-message',
  'provider-system-message'
])

function normalizeLegacyManagerEvent(message = {}, provider = 'unknown') {
  if (!message || typeof message !== 'object') {
    return null
  }

  const normalizedProvider = message.provider || provider || 'unknown'
  const method = typeof message.method === 'string' ? message.method.trim() : ''
  if (method === 'mcpServer/startupStatus/updated') {
    const params = isPlainObject(message.params) ? message.params : {}
    const serverName = typeof params.name === 'string' ? params.name.trim() : ''
    const status = typeof params.status === 'string' ? params.status.trim() : ''
    const operationId = serverName
      ? `mcp-startup:${normalizedProvider}:${serverName}`
      : ''

    if (status === 'starting') {
      return {
        eventType: 'system-notification',
        data: {
          type: 'mcp-server-starting',
          provider: normalizedProvider,
          name: serverName || 'unknown',
          status,
          operationId,
          startedAt: Date.now(),
          rawMessage: message,
          error: params.error ?? null
        }
      }
    }

    if (status === 'ready') {
      return {
        eventType: 'system-notification',
        data: {
          type: 'mcp-server-ready',
          provider: normalizedProvider,
          name: serverName || 'unknown',
          status,
          operationId,
          completedAt: Date.now(),
          rawMessage: message,
          error: params.error ?? null
        }
      }
    }

    if (status === 'error' || params.error) {
      return {
        eventType: 'system-notification',
        data: {
          type: 'mcp-server-error',
          provider: normalizedProvider,
          name: serverName || 'unknown',
          status: status || 'error',
          operationId,
          completedAt: Date.now(),
          rawMessage: message,
          error: params.error ?? null
        }
      }
    }
  }

  const notificationType = typeof message.type === 'string' ? message.type.trim() : ''
  if (notificationType && SESSION_NOTIFICATION_TYPES.has(notificationType)) {
    return {
      eventType: 'system-notification',
      data: {
        provider: normalizedProvider,
        ...message,
        type: notificationType
      }
    }
  }

  const subtype = typeof message.subtype === 'string' ? message.subtype.trim() : ''
  if (subtype === 'compact_boundary') {
    return {
      eventType: 'system-notification',
      data: {
        type: 'compact-boundary',
        provider: normalizedProvider,
        compactMetadata: message.compact_metadata || message.compactMetadata || null,
        compactSummary: message.compactSummary || message.compact_summary || null,
        rawMessage: message
      }
    }
  }

  return null
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
    this.autoApprove = false           // 自动批准开关（独立于权限模式）
    this.taskDockHistory = []          // task-dock 历史记录（从 projectConfig 加载，project 级别共享）
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
      provider: 'claude',
      rewindCapabilities: {
        reset: true,
        patch: false,
        forkReset: true,
        forkPatch: false
      }
    }
    this.silentMessages = []
    this.taskEvents = []
    this.eventLog = []
    this.historyTurns = []
    this.currentHistoryTurnId = null
    this.agentSourceTurnIds = new Map()
    this.agentSubagentTurns = new Map()
    this.agentAliases = new Map()
    this.agentRegistrySnapshots = new Map()
    this.pendingCollaborativeDeliveries = []

    // 流式消息处理状态
    this.currentStreamingAssistantId = null
    this.currentAssistantMessageIndex = -1
    this.currentContentBlockType = null
    this.contentBlockIndexToId = new Map()
    this.currentTurnNumber = 0
    this.hasSeenToolUseInCurrentTurn = false
    this.activeResponseUserMessageId = null
  }

  attachWebContents(webContents) {
    if (!webContents || webContents.isDestroyed?.()) {
      return
    }

    this.webContents = webContents
  }

  getMainAgentId() {
    return 'master'
  }

  normalizeAgentAlias(value) {
    if (typeof value !== 'string') {
      return ''
    }

    return value.replace(/^@/, '').trim().toLowerCase()
  }

  rememberAgentAlias(agentId, ...values) {
    if (!agentId) {
      return
    }

    for (const value of values) {
      const alias = this.normalizeAgentAlias(value)
      if (!alias) {
        continue
      }
      this.agentAliases.set(alias, agentId)
    }
  }

  resolveAgentIdFromAlias(value) {
    const alias = this.normalizeAgentAlias(value)
    if (!alias) {
      return null
    }

    if (alias === 'master') {
      return this.getMainAgentId()
    }

    return this.agentAliases.get(alias) || null
  }

  rememberAgentAliasesFromPayload(payload = null) {
    if (!payload || typeof payload !== 'object') {
      return
    }

    const ccgui = payload.ccgui || {}
    const registry = ccgui.registry || null
    const orchestration = ccgui.orchestration || null
    const attribution = ccgui.attribution || null
    const agentId = pickFirstDefined(
      registry?.agentId,
      orchestration?.agentId,
      attribution?.agentId,
      attribution?.actorId
    )

    if (!agentId) {
      return
    }

    this.rememberAgentAlias(agentId, registry?.name, registry?.title, orchestration?.name)
    if (registry) {
      const normalizedRegistry = normalizeAgentRegistry(registry)
      this.agentRegistrySnapshots.set(
        agentId,
        mergePlain(this.agentRegistrySnapshots.get(agentId) || null, normalizedRegistry || { agentId })
      )
    }

    if (payload.toolName === 'SendMessage') {
      this.rememberAgentAlias(agentId, payload.toolInput?.from)
    }

    if (payload.toolName === 'ReceiveMessage') {
      this.rememberAgentAlias(agentId, payload.toolInput?.to)
    }
  }

  getAgentRegistrySnapshot(agentId) {
    if (!agentId) {
      return null
    }

    return this.agentRegistrySnapshots.get(agentId) || null
  }

  getPayloadAgentId(payload = null) {
    if (!payload || typeof payload !== 'object') {
      return null
    }

    return pickFirstDefined(
      payload.ccgui?.attribution?.agentId,
      payload.ccgui?.attribution?.actorId,
      payload.ccgui?.registry?.agentId,
      payload.ccgui?.orchestration?.agentId
    )
  }

  getAgentSourceTurnId(agentId) {
    if (!agentId) {
      return this.currentHistoryTurnId || null
    }

    if (agentId === this.getMainAgentId()) {
      return this.agentSourceTurnIds.get(agentId) || this.currentHistoryTurnId || null
    }

    return this.agentSourceTurnIds.get(agentId) || null
  }

  setAgentSourceTurnId(agentId, sourceUserTurnId) {
    if (!agentId || !sourceUserTurnId) {
      return
    }

    this.agentSourceTurnIds.set(agentId, sourceUserTurnId)
  }

  ensureSubagentTurn(agentId, sourceUserTurnId, options = {}) {
    if (!agentId || !sourceUserTurnId || agentId === this.getMainAgentId()) {
      return null
    }

    const current = this.agentSubagentTurns.get(agentId) || null
    if (!options.forceNew && current?.sourceUserTurnId === sourceUserTurnId) {
      current.updatedAt = new Date().toISOString()
      this.agentSubagentTurns.set(agentId, current)
      return current.turnId
    }

    const nextTurnId = `subagent-turn:${agentId}:${crypto.randomUUID()}`
    this.agentSubagentTurns.set(agentId, {
      turnId: nextTurnId,
      sourceUserTurnId,
      updatedAt: new Date().toISOString(),
      inputKind: options.inputKind || 'delegated_context'
    })
    return nextTurnId
  }

  recordPendingCollaborativeDelivery(entry = {}) {
    if (!entry?.senderAgentId || !entry?.sourceUserTurnId) {
      return
    }

    this.pendingCollaborativeDeliveries.push({
      senderAgentId: entry.senderAgentId,
      targetAgentId: entry.targetAgentId || null,
      targetLabel: this.normalizeAgentAlias(entry.targetLabel),
      sourceUserTurnId: entry.sourceUserTurnId,
      timestamp: Date.now()
    })

    const cutoff = Date.now() - 5 * 60 * 1000
    this.pendingCollaborativeDeliveries = this.pendingCollaborativeDeliveries
      .filter(item => item.timestamp >= cutoff)
      .slice(-200)
  }

  resolveCollaborativeDeliveryTurn({ senderAgentId = null, recipientAgentId = null, senderLabel = '' } = {}) {
    const normalizedSenderLabel = this.normalizeAgentAlias(senderLabel)
    const candidates = [...this.pendingCollaborativeDeliveries].reverse()

    for (const item of candidates) {
      if (senderAgentId && item.senderAgentId !== senderAgentId) {
        continue
      }
      if (recipientAgentId && item.targetAgentId && item.targetAgentId !== recipientAgentId) {
        continue
      }
      return item.sourceUserTurnId
    }

    if (senderAgentId) {
      return this.getAgentSourceTurnId(senderAgentId)
    }

    if (normalizedSenderLabel) {
      const resolvedSenderAgentId = this.resolveAgentIdFromAlias(normalizedSenderLabel)
      if (resolvedSenderAgentId) {
        return this.getAgentSourceTurnId(resolvedSenderAgentId)
      }
    }

    return null
  }

  attachHistoryContext(payload = null, historyPatch = null) {
    if (!payload || typeof payload !== 'object' || !historyPatch) {
      return payload
    }

    return attachExistingCcgui(payload, {
      history: historyPatch
    })
  }

  applyHistoryContextToEventData(eventType, data) {
    if (!data || typeof data !== 'object') {
      return data
    }

    let payload = attachExistingCcgui(data)
    this.rememberAgentAliasesFromPayload(payload)

    const payloadAgentId = this.getPayloadAgentId(payload)
    const registrySnapshot = this.getAgentRegistrySnapshot(payloadAgentId)
    if (payloadAgentId && registrySnapshot && !payload?.ccgui?.registry) {
      payload = attachExistingCcgui(payload, {
        registry: registrySnapshot
      })
    }

    if (eventType === 'message' && isTurnEntryRole(payload.role)) {
      const sourceUserTurnId = payload.id || null
      const targetAgentId = this.getPayloadAgentId(payload)
      const inputKind = payload.role === 'command' ? 'direct_command' : 'direct_user'

      if (sourceUserTurnId) {
        this.setAgentSourceTurnId(this.getMainAgentId(), sourceUserTurnId)
      }

      if (targetAgentId && targetAgentId !== this.getMainAgentId() && sourceUserTurnId) {
        this.setAgentSourceTurnId(targetAgentId, sourceUserTurnId)
        const subagentTurnId = this.ensureSubagentTurn(targetAgentId, sourceUserTurnId, {
          forceNew: true,
          inputKind
        })
        const targetRegistry = this.getAgentRegistrySnapshot(targetAgentId)
        payload = this.attachHistoryContext(payload, {
          sourceUserTurnId,
          subagentTurnId,
          inputKind,
          targetAgentId
        })
        if (targetRegistry && !payload?.ccgui?.registry) {
          payload = attachExistingCcgui(payload, {
            registry: targetRegistry
          })
        }
      } else if (sourceUserTurnId) {
        payload = this.attachHistoryContext(payload, {
          sourceUserTurnId,
          inputKind,
          targetAgentId: targetAgentId || this.getMainAgentId()
        })
      }

      return payload
    }

    if (eventType === 'message-start' && payload.role === 'tool_use') {
      const toolName = String(payload.toolName || '').trim()
      const actingAgentId = this.getPayloadAgentId(payload) || this.getMainAgentId()

      if (toolName === 'SendMessage') {
        const sourceUserTurnId = this.getAgentSourceTurnId(actingAgentId)
        const targetLabel = payload.toolInput?.to || ''
        const targetAgentId = this.resolveAgentIdFromAlias(targetLabel)
        const targetRegistry = this.getAgentRegistrySnapshot(targetAgentId)
        if (sourceUserTurnId) {
          const subagentTurnId = targetAgentId && targetAgentId !== this.getMainAgentId()
            ? this.ensureSubagentTurn(targetAgentId, sourceUserTurnId, {
                inputKind: 'delegated_context'
              })
            : null
          this.recordPendingCollaborativeDelivery({
            senderAgentId: actingAgentId,
            targetAgentId,
            targetLabel,
            sourceUserTurnId
          })
          payload = this.attachHistoryContext(payload, {
            sourceUserTurnId,
            inputKind: 'delegated_context',
            deliveryKind: 'send',
            senderAgentId: actingAgentId,
            targetAgentId,
            ...(subagentTurnId ? { subagentTurnId } : {})
          })
        }
        if (targetRegistry) {
          payload = attachExistingCcgui(payload, {
            registry: targetRegistry
          })
        }
        return payload
      }

      if (toolName === 'ReceiveMessage') {
        const recipientAgentId = actingAgentId
        const senderLabel = payload.toolInput?.from || ''
        const senderAgentId = this.resolveAgentIdFromAlias(senderLabel)
        const sourceUserTurnId = this.resolveCollaborativeDeliveryTurn({
          senderAgentId,
          recipientAgentId,
          senderLabel
        })

        if (recipientAgentId && sourceUserTurnId) {
          this.setAgentSourceTurnId(recipientAgentId, sourceUserTurnId)
          const current = this.agentSubagentTurns.get(recipientAgentId) || null
          const forceNew = current?.sourceUserTurnId !== sourceUserTurnId
          const subagentTurnId = this.ensureSubagentTurn(recipientAgentId, sourceUserTurnId, {
            forceNew,
            inputKind: 'delegated_context'
          })
          payload = this.attachHistoryContext(payload, {
            sourceUserTurnId,
            subagentTurnId,
            inputKind: 'delegated_context',
            deliveryKind: 'receive',
            senderAgentId,
            targetAgentId: recipientAgentId
          })
        }
        return payload
      }
    }

    const actingAgentId = this.getPayloadAgentId(payload)
    const sourceUserTurnId = actingAgentId ? this.getAgentSourceTurnId(actingAgentId) : null
    if (actingAgentId && sourceUserTurnId) {
      const historyPatch = {
        sourceUserTurnId,
        targetAgentId: actingAgentId
      }
      if (actingAgentId !== this.getMainAgentId()) {
        const subagentTurnId = this.ensureSubagentTurn(actingAgentId, sourceUserTurnId, {
          inputKind: 'delegated_context'
        })
        if (subagentTurnId) {
          historyPatch.subagentTurnId = subagentTurnId
        }
      }
      payload = this.attachHistoryContext(payload, historyPatch)
    }

    return payload
  }

  /**
   * 初始化：从 jsonl 加载历史消息
   */
  async initialize() {
    await this.loadHistory()
    const sessionConfig = projectService.getSessionConfig(this.projectId, this.id)
    if (sessionConfig?.settings) {
      this.applySessionSettings(sessionConfig.settings)
    }
    this.reconcilePersistedRuntimeState()
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

      this.silentMessages = []
      this.taskEvents = []
      this.eventLog = []

      this.historyTurns = historyManager.loadIndexEntries(this.projectId, this.id)
      if (this.historyTurns.length > 0) {
        this.messages = this.historyTurns.map(buildHistoryIndexMessage)
        this.inputHistory = mergeInputHistory(this.inputHistory, this.messages)
        logger.info(`[SessionInstance] Loaded ${this.historyTurns.length} history index entries for session ${this.id}`)

        for (const msg of this.messages) {
          if (msg?.id) {
            this.savedMessageIds.add(msg.id)
          }
        }
        return
      }

      logger.info(`[SessionInstance] No stored CCGUI history for session ${this.id}`)
    } catch (e) {
      logger.error(`[SessionInstance] Error loading history: ${e.message}`)
    }
  }

  async refreshStoredHistoryIfEmpty() {
    if (this.isProcessing) {
      return false
    }

    const persistedTurns = historyManager.loadIndexEntries(this.projectId, this.id)
    if (!Array.isArray(persistedTurns) || persistedTurns.length === 0) {
      return false
    }

    const persistedMessages = persistedTurns.map(buildHistoryIndexMessage)
    const persistedIds = new Set()
    const currentMessagesById = new Map()

    for (const message of this.messages) {
      if (message?.id) {
        currentMessagesById.set(message.id, message)
      }
    }

    const mergedMessages = persistedMessages.map(message => {
      if (message?.id) {
        persistedIds.add(message.id)
        this.savedMessageIds.add(message.id)
        return currentMessagesById.get(message.id) || message
      }

      return message
    })

    for (const message of this.messages) {
      if (!message?.id || !persistedIds.has(message.id)) {
        mergedMessages.push(message)
      }
    }

    this.historyTurns = persistedTurns
    this.messages = mergedMessages
    this.inputHistory = mergeInputHistory(this.inputHistory, persistedMessages)

    return true
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
      taskEvents: this.taskEvents,
      subagentHistories: historyManager.loadAllSubagentHistories(this.projectId, this.id),
      eventLog: this.eventLog,
      historyTurns: this.historyTurns,
      runtimeReady: this.runtimeManager?.isReady() || false,
      provider: this.provider,
      permissionMode: this.permissionMode,
      autoApprove: this.autoApprove,
      taskDockHistory: this.taskDockHistory
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

  resolveConfiguredRuntimeSubModel(settings = null, provider = null) {
    const resolvedProvider = provider || this.provider || this.envInfo?.provider || 'claude'
    const appConfig = appConfigManager.loadConfig()
    const effectiveSettings = settings || projectService.resolveRuntimeConfig(this.projectId, this.id).settings
    const selectedSystemModelId = resolvedProvider === 'codex'
      ? ((effectiveSettings?.targetKind === 'openai') ? null : (appConfig?.settings?.selectedCodexModelId || null))
      : (appConfig?.settings?.selectedClaudeModelId || null)
    const effectiveModelId = effectiveSettings?.modelId || selectedSystemModelId || null

    if (!effectiveModelId) {
      return ''
    }

    const configuredModel = findProviderModel(appConfig, resolvedProvider, effectiveModelId)
    if (!configuredModel) {
      return ''
    }

    const cards = Array.isArray(configuredModel.modelCards) ? configuredModel.modelCards : []
    const targetCard = effectiveSettings?.modelCardId
      ? cards.find(card => card.id === effectiveSettings.modelCardId)
      : (cards.find(card => card.id === configuredModel.defaultCardId) || cards[0] || null)

    return typeof targetCard?.modelName === 'string' ? targetCard.modelName.trim() : ''
  }

  async applyConfiguredClaudeStartupModel(settings = null) {
    if (this.provider !== 'claude' || typeof this.runtimeManager?.sendControlRequest !== 'function') {
      return
    }

    const configuredSubModel = this.resolveConfiguredRuntimeSubModel(settings, 'claude')
    if (!configuredSubModel) {
      return
    }

    const currentRuntimeModel = typeof this.envInfo?.model === 'string' ? this.envInfo.model.trim() : ''
    if (currentRuntimeModel === configuredSubModel) {
      return
    }

    logger.info(`[SessionInstance] Applying configured Claude startup model for session ${this.id}: ${configuredSubModel}`)
    await this.runtimeManager.sendControlRequest({
      subtype: 'set_session_submodel',
      model: configuredSubModel,
      reasoningEffort: (typeof settings?.effort === 'string' && settings.effort.trim()) || 'medium',
      silent: true
    })
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
      const sessionStoragePath = path.dirname(historyManager.getSessionHistoryDir(this.projectId, this.id))
      this.runtimeManager = new CodexAdapter(
        this.projectPath,
        this.id,
        isNewSession,
        this.permissionMode,
        settings,
        {
          resumeThreadId: this.sessionSettings.codexThreadId || null,
          debug: this.sessionSettings.debug === true,
          sessionStoragePath
        }
      )
    } else {
      const nativeClaudeSessionId = this.resolveClaudeRuntimeSessionId()
      this.runtimeManager = new ClaudeAdapter(
        this.projectPath,
        nativeClaudeSessionId,
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

      // 注册进程实例，用于异常退出时清理孤儿进程
      const exePath = this.runtimeManager.claudePath || this.runtimeManager.codexPath || ''
      processRegistry.register(this.id, {
        pid,
        provider: this.provider,
        exePath,
        projectPath: this.projectPath
      })

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

      const runtimeSessionIdentifier = this.runtimeManager.getSessionIdentifier?.()
      if (runtimeSessionIdentifier && this.envInfo.session_id !== runtimeSessionIdentifier) {
        this.envInfo.session_id = runtimeSessionIdentifier
        historyManager.updateSessionEnvInfo(this.projectId, this.id, this.envInfo)
        this.emit('env-info', this.envInfo)
      }

      try {
        await this.applyConfiguredClaudeStartupModel(settings)
      } catch (error) {
        logger.warn(`[SessionInstance] Failed to apply configured Claude startup model for session ${this.id}: ${error.message}`)
      }

      this.persistRuntimeSessionSettingsPatch()

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

  resolveClaudeRuntimeSessionId() {
    const boundNativeSessionId = typeof this.sessionSettings?.toolBinding?.nativeSessionId === 'string'
      ? this.sessionSettings.toolBinding.nativeSessionId.trim()
      : ''
    if (boundNativeSessionId) {
      return boundNativeSessionId
    }

    if (isUuidLike(this.id)) {
      return this.id
    }

    const generatedSessionId = crypto.randomUUID()
    logger.info('[SessionInstance] Generated Claude native session id for non-UUID CCGUI session id', {
      sessionId: this.id,
      nativeSessionId: generatedSessionId
    })
    return generatedSessionId
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
      type === 'mcp-server-starting' ||
      type === 'mcp-server-ready' ||
      type === 'mcp-server-error' ||
      type === 'mcp-server-status' ||
      type === 'session-config-applied' ||
      type === 'session-effort-changed'
    ) {
      return 'session'
    }

    return 'turn'
  }

  shouldPersistEventInTurnHistory(event = null) {
    if (!event || typeof event !== 'object') {
      return false
    }

    const payload = event.data || null

    if (event.eventType === 'message' && isIndexVisibleMessage(payload)) {
      return false
    }

    if (event.eventType === 'normal-exit' || event.eventType === 'abnormal-exit') {
      return false
    }

    if (
      event.eventType === 'env-info' ||
      event.eventType === 'state-update' ||
      event.eventType === 'control-response' ||
      event.eventType === 'silent-message' ||
      event.eventType === 'task-event' ||
      event.eventType === 'agent-update' ||
      event.eventType === 'permission-mode-change' ||
      event.eventType === 'fast-mode-change' ||
      event.eventType === 'cli-status' ||
      event.eventType === 'unknown-message'
    ) {
      return false
    }

    if (event.eventType === 'system-notification') {
      if (this.resolveNotificationScope(payload?.type, payload) === 'session') {
        return false
      }
    }

    return true
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
    if (message.scope === 'session') {
      historyManager.appendIndexMessage(this.projectId, this.id, message)
      this.historyTurns = historyManager.loadIndexEntries(this.projectId, this.id)
    }
    return message
  }

  syncSystemNotificationMessage(notificationType, data = {}) {
    const operationId = typeof data?.operationId === 'string' ? data.operationId : ''
    if (
      operationId && (
        notificationType === 'session-runtime-ready' ||
        notificationType === 'session-config-applied' ||
        notificationType === 'session-effort-changed' ||
        notificationType === 'mcp-server-ready' ||
        notificationType === 'mcp-server-error' ||
        notificationType === 'hook-event'
      )
    ) {
      const pendingMessage = [...this.messages].reverse().find(message =>
        message.role === 'system_notification' &&
        (
          message.notificationType === 'session-runtime-starting' ||
          message.notificationType === 'session-runtime-restarting' ||
          message.notificationType === 'mcp-server-starting' ||
          message.notificationType === 'hook-event'
        ) &&
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
        if (pendingMessage.scope === 'session') {
          historyManager.updateIndexMessage(this.projectId, this.id, pendingMessage.id, {
            notificationType: pendingMessage.notificationType,
            scope: pendingMessage.scope,
            data: pendingMessage.data,
            timestamp: pendingMessage.timestamp
          })
          this.historyTurns = historyManager.loadIndexEntries(this.projectId, this.id)
        }
        return pendingMessage
      }
    }

    return this.appendSystemNotificationMessage(notificationType, data)
  }

  finalizePendingLifecycleNotification(notificationType = 'runtime-stopped', data = {}) {
    const pendingMessage = [...this.messages].reverse().find(message =>
      message.role === 'system_notification' &&
      (message.notificationType === 'session-runtime-starting' || message.notificationType === 'session-runtime-restarting') &&
      !message.data?.completedAt
    )

    if (!pendingMessage) {
      return null
    }

    const startedAt = Number(pendingMessage.data?.startedAt || pendingMessage.timestamp?.getTime?.() || Date.now())
    const durationMs = Math.max(0, Date.now() - startedAt)
    pendingMessage.notificationType = notificationType
    pendingMessage.scope = this.resolveNotificationScope(notificationType, data)
    pendingMessage.data = {
      ...pendingMessage.data,
      ...data,
      completedAt: Date.now(),
      durationMs
    }
    pendingMessage.timestamp = new Date()
    historyManager.updateMessage(this.projectId, this.id, pendingMessage.id, {
      notificationType: pendingMessage.notificationType,
      scope: pendingMessage.scope,
      data: pendingMessage.data,
      timestamp: pendingMessage.timestamp
    })
    if (pendingMessage.scope === 'session') {
      historyManager.updateIndexMessage(this.projectId, this.id, pendingMessage.id, {
        notificationType: pendingMessage.notificationType,
        scope: pendingMessage.scope,
        data: pendingMessage.data,
        timestamp: pendingMessage.timestamp
      })
      this.historyTurns = historyManager.loadIndexEntries(this.projectId, this.id)
    }

    return pendingMessage
  }

  finalizeActiveMessages() {
    const now = Date.now()

    for (const item of this.messages) {
      const updates = {}

      if (item.isStreaming) {
        item.isStreaming = false
        updates.isStreaming = false
      }

      if (item.isExecuting) {
        item.isExecuting = false
        updates.isExecuting = false

        if (item.role === 'tool_use' || item.role === 'diff') {
          item.interrupted = true
          item.isError = true
          updates.interrupted = true
          updates.isError = true

          if (!String(item.result || '').trim()) {
            item.result = item.toolName === 'Agent'
              ? '子代理在 CCGUI 关闭时被中断，恢复历史后不会继续执行。'
              : '工具调用在 CCGUI 关闭时被中断，恢复历史后不会继续执行。'
            updates.result = item.result
          }
        }
      }

      if (!item.duration && item.startTime) {
        item.duration = now - item.startTime
        updates.duration = item.duration
      }

      if (Object.keys(updates).length > 0 && item.id) {
        if (isTurnEntryRole(item.role)) {
          historyManager.updateTurn(this.projectId, this.id, item.id, updates)
        } else {
          this.emit('message-update', {
            messageId: item.id,
            updates
          })
        }
      }
    }
  }

  reconcilePersistedRuntimeState() {
    this.finalizePendingLifecycleNotification('runtime-stopped', {
      provider: this.provider,
      reason: 'session-restored',
      message: `${this.getProviderDisplayName()} 上次启动未完成，已重置为停止状态`
    })
    this.finalizeActiveMessages()
    this.isProcessing = false
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
      historyManager.updateTurn(this.projectId, this.id, latestUserMessage.id, {
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
    this.activeResponseUserMessageId = null
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

    if (this.isManualStop && this.pendingLifecycleReason === 'restart-for-config') {
      // Controlled restart: lifecycle is represented by restarting/ready notifications.
    } else if (this.isManualStop) {
      this.emit('system-notification', {
        type: 'runtime-stopped',
        code,
        signal,
        provider: this.provider,
        reason: this.pendingLifecycleReason || 'user-stop',
        message: `${this.getProviderDisplayName()} 已停止运行`
      })
    } else if (isAbnormalExit) {
      this.emit('system-notification', {
        type: 'runtime-exit',
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
      const normalizedMessage = attachExistingCcgui(message)
      this.messages.push(normalizedMessage)
      this.emit('message-start', normalizedMessage)
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
      const normalizedUpdates = attachExistingCcgui({
        ...(updates || {}),
        id: messageId,
        rawMessages: updates?.rawMessages,
        rawMessage: updates?.rawMessage,
        toolInput: updates?.toolInput,
        tool_use_id: pickFirstDefined(updates?.tool_use_id, updates?.toolUseId, msg?.request_id, msg?.id),
        ccgui: mergeCcguiSemantics(msg?.ccgui || null, updates?.ccgui || null)
      })
      if (msg) {
        Object.assign(msg, normalizedUpdates)
        if (normalizedUpdates.ccgui) {
          msg.ccgui = normalizedUpdates.ccgui
        }
        if ((normalizedUpdates.isStreaming === false || normalizedUpdates.isExecuting === false) && !msg.duration && msg.startTime) {
          msg.duration = Date.now() - msg.startTime
        }
      }
      this.emit('message-update', { messageId, updates: normalizedUpdates })
    })

    manager.on('message-replace', ({ messageId, replacement }) => {
      const msg = this.messages.find(item => item.id === messageId)
      const normalizedReplacement = attachExistingCcgui({
        ...(replacement || {}),
        id: messageId,
        rawMessages: replacement?.rawMessages,
        rawMessage: replacement?.rawMessage,
        toolInput: replacement?.toolInput,
        tool_use_id: pickFirstDefined(replacement?.tool_use_id, replacement?.toolUseId, msg?.request_id, msg?.id),
        ccgui: mergeCcguiSemantics(msg?.ccgui || null, replacement?.ccgui || null)
      })
      if (msg) {
        Object.assign(msg, normalizedReplacement)
        if (normalizedReplacement.ccgui) {
          msg.ccgui = normalizedReplacement.ccgui
        }
        historyManager.updateMessage(this.projectId, this.id, messageId, normalizedReplacement)
      }
      this.emit('message-replace', { messageId, replacement: normalizedReplacement })
    })

    manager.on('tool-result', (payload) => {
      const normalizedPayload = attachExistingCcgui(payload)
      this.emit('tool-result', normalizedPayload)
    })

    manager.on('message-result', (payload) => {
      const normalizedPayload = attachExistingCcgui(payload)
      // 更新对应 tool_use 消息的状态
      const toolMsgIndex = this.messages.findIndex(m => m.id === payload.messageId)
      if (toolMsgIndex >= 0) {
        const msg = this.messages[toolMsgIndex]
        Object.assign(msg, {
          isExecuting: false,
          isError: payload.isError || false,
          result: payload.content || '(无输出)',
          ...(payload.usage ? { usage: payload.usage } : {})
        })
      }
      this.emit('message-result', normalizedPayload)
    })

    manager.on('message-complete', ({ messageId, updates }) => {
      const msgIndex = this.messages.findIndex(item => item.id === messageId)
      const msg = msgIndex >= 0 ? this.messages[msgIndex] : null
      if (msg) {
        Object.assign(msg, updates)
        if (!msg.duration && msg.startTime) {
          msg.duration = Date.now() - msg.startTime
        }

        // Remove empty assistant messages that never received content or thinking.
        // The frontend defers these via pendingAssistantMessage and discards them,
        // but the backend unconditionally pushes them on message-start.
        // Without cleanup they persist in history and appear as blank bubbles on resume.
        if (
          msg.role === 'assistant' &&
          !msg.content?.trim() &&
          !msg.thinking?.trim() &&
          msg.isStreaming === false
        ) {
          const lastToolMsg = [...this.messages].reverse().find(
            m => m.role === 'tool_use' || m.role === 'diff'
          )
          if (lastToolMsg) {
            const pendingUsage = updates?.usage || msg.usage
            if (pendingUsage) lastToolMsg.usage = pendingUsage
            if (!lastToolMsg.duration && msg.startTime) {
              lastToolMsg.duration = Date.now() - msg.startTime
            }
          }
          this.messages.splice(msgIndex, 1)
          logger.info(`[SessionInstance] Removed empty assistant message ${messageId}`)
          this.emit('message-complete', {
            messageId,
            updates: {
              ...updates,
              ...(msg.duration ? { duration: msg.duration } : {})
            }
          })
          return
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

    manager.on('message-stop', ({ messageId }) => {
      // tool_use 输入流结束，标记 isStreaming=false 但保留 isExecuting=true
      const msg = this.messages.find(item => item.id === messageId)
      if (msg) {
        msg.isStreaming = false
      }
      this.emit('message-stop', { messageId })
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
      const requestId = message?.response?.request_id || message?.request_id || null
      const pendingRequest = this.consumePendingControlRequest(requestId)
      const payload = this.extractControlResponsePayload(message)

      if (pendingRequest && payload && !payload.error) {
        if (
          isRestoreActionSubtype(pendingRequest?.subtype) &&
          pendingRequest?.user_message_id &&
          pendingRequest?.dry_run !== true
        ) {
          const rewindMode = isPatchUndoSubtype(pendingRequest?.subtype) ? 'patch' : 'reset'
          this.applyRewindLocally(pendingRequest.user_message_id, payload, { mode: rewindMode })
        }

        if (
          isPatchRedoSubtype(pendingRequest?.subtype) &&
          pendingRequest?.user_message_id &&
          pendingRequest?.dry_run !== true
        ) {
          this.applyPatchRedoLocally(pendingRequest.user_message_id)
        }

        this.appendControlOutcomeMessage(pendingRequest, message)
      }

      this.emit('control-response', message)
    })

    manager.on('interrupt', (message) => {
      this.currentStreamingAssistantId = null
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
        ...attachExistingCcgui(message),
        timestamp: message.timestamp || new Date().toISOString()
      }
      this.silentMessages.push(silentMessage)
      this.emit('silent-message', silentMessage)
    })

    manager.on('agent-update', (message) => {
      const normalizedAgentUpdate = attachExistingCcgui(message)
      this.emit('agent-update', normalizedAgentUpdate)
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
      const normalizedTaskEvent = attachExistingCcgui(message)
      this.taskEvents.push(normalizedTaskEvent)
      this.emit('task-event', normalizedTaskEvent)
    })

    manager.on('system-message', (message) => {
      const normalizedEvent = normalizeLegacyManagerEvent(message, this.provider)
      if (normalizedEvent) {
        this.emit(normalizedEvent.eventType, normalizedEvent.data)
        return
      }

      this.emit('unknown-message', {
        type: 'legacy-system-message',
        provider: this.provider,
        rawMessage: message,
        timestamp: new Date().toISOString()
      })
    })

    manager.on('permission-mode-change', (mode) => {
      this.emit('permission-mode-change', mode)
    })

    manager.on('fast-mode-change', (state) => {
      this.emit('fast-mode-change', state)
    })

    // 文件变更统计（provider 构造好消息体，这里纯透传）
    manager.on('file-change-summary', (summary) => {
      if (!summary?.files?.length) return

      this.messages.push(summary)
      this.saveMessageToHistory(summary)
      historyManager.appendIndexMessage(this.projectId, this.id, summary)
      this.historyTurns = historyManager.loadIndexEntries(this.projectId, this.id)
      this.emit('message', summary)
    })

    // CLI status
    manager.on('cli-status', (message) => {
      this.emit('cli-status', message)
    })

    // Unknown message
    manager.on('unknown_message', (message) => {
      if (
        message?.method === 'mcpServer/elicitation/request' && message?.params?.serverName === 'computer-use'
      ) {
        logger.info('[SessionInstance] Observed raw Computer Use unknown_message passthrough', {
          sessionId: this.id,
          provider: this.provider,
          requestId: message.id ?? null,
          threadId: message.params?.threadId || null,
          turnId: message.params?.turnId || null,
          mode: message.params?.mode || null,
          prompt: message.params?.message || message.params?.reason || null
        })
      }

      const normalizedEvent = normalizeLegacyManagerEvent(message, this.provider)
      if (normalizedEvent) {
        if (normalizedEvent.eventType === 'system-notification' && normalizedEvent.data?.type) {
          this.syncSystemNotificationMessage(normalizedEvent.data.type, normalizedEvent.data)
        }
        this.emit(normalizedEvent.eventType, normalizedEvent.data)
        return
      }

      this.emit('unknown-message', {
        type: 'provider-unknown-message',
        provider: this.provider,
        rawMessage: message,
        timestamp: new Date().toISOString()
      })
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
    let outgoingCcgui = (content && typeof content === 'object' && !Array.isArray(content) && content.ccgui)
      ? JSON.parse(JSON.stringify(content.ccgui))
      : null

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
      rawMessage: userMessage,
      ...(outgoingCcgui ? { ccgui: outgoingCcgui } : {})
    }
    this.messages.push(displayMessage)
    this.rawMessages.push(userMessage)
    this.activeResponseUserMessageId = displayMessage.id

    this.saveMessageToHistory(displayMessage)

    this.emit('message', displayMessage)

    // 更新状态
    this.isProcessing = true
    this.emit('state-update', { isProcessing: true })

    // 发送到运行时 provider
    try {
      await this.runtimeManager.sendMessage(userMessage)
    } catch (error) {
      logger.error(`[SessionInstance] Failed to send message:`, error)
      this.isProcessing = false
      this.emit('state-update', { isProcessing: false })
      throw error
    }
  }

  /**
   * 保存所有未保存的消息到历史存储
   */
  saveUnsavedMessages() {
    let savedCount = 0
    for (const msg of this.messages) {
      if (!this.savedMessageIds.has(msg.id)) {
        this.saveMessageToHistory(msg)
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

    this.savedMessageIds.add(message.id)
  }

  getLatestUserMessage() {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      if (isTurnEntryRole(this.messages[i].role)) {
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
    const targetIndex = this.messages.findIndex(item => isTurnEntryRole(item.role) && item.id === userMessageId)
    if (targetIndex === -1) {
      throw new Error('Target user message not found')
    }

    let numTurns = 0
    for (let index = targetIndex; index < this.messages.length; index += 1) {
      if (isTurnEntryRole(this.messages[index]?.role)) {
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

  getFileChangeSummaryMessage(userMessageId) {
    if (!userMessageId) {
      return null
    }

    for (let index = this.messages.length - 1; index >= 0; index -= 1) {
      const message = this.messages[index]
      if (message?.role === 'file_change_summary' && message?.userMessageId === userMessageId) {
        return message
      }
    }

    return null
  }

  updateFileChangeSummaryMessage(userMessageId, updates = {}) {
    const summaryMessage = this.getFileChangeSummaryMessage(userMessageId)
    if (!summaryMessage) {
      return null
    }

    const normalizedUpdates = {
      ...updates,
      updatedAt: new Date().toISOString()
    }

    Object.assign(summaryMessage, normalizedUpdates)
    historyManager.updateMessage(this.projectId, this.id, summaryMessage.id, normalizedUpdates)
    historyManager.updateIndexMessage(this.projectId, this.id, summaryMessage.id, normalizedUpdates)
    this.historyTurns = historyManager.loadIndexEntries(this.projectId, this.id)
    this.emit('message-update', {
      messageId: summaryMessage.id,
      updates: normalizedUpdates
    })

    return summaryMessage
  }

  applyPatchUndoLocally(userMessageId) {
    this.updateFileChangeSummaryMessage(userMessageId, {
      patchState: 'undone',
      patchUndoneAt: new Date().toISOString()
    })

    this.activeResponseUserMessageId = null
    this.pendingControlRequest = null
    this.pendingControlRequests.clear()
    return this.messages
  }

  applyPatchRedoLocally(userMessageId) {
    this.updateFileChangeSummaryMessage(userMessageId, {
      patchState: 'applied',
      patchUndoneAt: null,
      patchRedoneAt: new Date().toISOString()
    })

    this.activeResponseUserMessageId = null
    this.pendingControlRequest = null
    this.pendingControlRequests.clear()
    return this.messages
  }

  applyRewindLocally(userMessageId, rewindData = {}, options = {}) {
    const targetIndex = this.messages.findIndex(item => isTurnEntryRole(item.role) && item.id === userMessageId)
    if (targetIndex === -1) {
      throw new Error('Target turn message not found')
    }

    const targetMessage = this.messages[targetIndex] || null
    const mode = options?.mode === 'patch' ? 'patch' : 'reset'
    if (mode === 'patch') {
      return this.applyPatchUndoLocally(userMessageId)
    }

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
    const actionText = mode === 'patch' ? '已撤销本次修改' : '已重置到提问前文件状态'

    const rewindNotice = {
      id: `rewind-${Date.now()}`,
      role: 'system',
      subtype: 'rewind-notice',
      content: `${actionText}：「${previewText.substring(0, 30)}${previewText.length > 30 ? '...' : ''}」`,
      rewindToMessageId: userMessageId,
      originalMessageContent: previewText,
      rewindMode: mode,
      restoredFilesCount: changedFiles.length,
      restoredFiles: changedFiles,
      insertions,
      deletions,
      timestamp: new Date()
    }

    this.messages.push(rewindNotice)

    this.activeResponseUserMessageId = null
    this.pendingControlRequest = null
    this.pendingControlRequests.clear()

    this.saveMessageToHistory(rewindNotice)
    historyManager.appendIndexMessage(this.projectId, this.id, rewindNotice)
    this.historyTurns = historyManager.loadIndexEntries(this.projectId, this.id)
    this.emit('message', rewindNotice)

    return this.messages
  }

  extractControlResponsePayload(response = null) {
    if (!response || typeof response !== 'object') {
      return null
    }

    if (response.response?.response && typeof response.response.response === 'object') {
      return response.response.response
    }

    if (response.response && typeof response.response === 'object') {
      return response.response
    }

    return null
  }

  appendControlOutcomeMessage(request = {}, response = null) {
    const subtype = typeof request?.subtype === 'string' ? request.subtype : ''
    const payload = this.extractControlResponsePayload(response)
    if (!payload || payload.error) {
      return null
    }

    if (subtype === 'fork_session') {
      const newSessionId = payload.session_id || payload.new_session_id || '已生成'
      const message = {
        id: `fork-${Date.now()}`,
        role: 'system',
        subtype: 'fork-notice',
        content: `✅ 会话分支创建成功\n新会话 ID: ${newSessionId}\n\n您可以在项目列表中找到这个新会话`,
        timestamp: new Date()
      }
      this.messages.push(message)
      this.saveMessageToHistory(message)
      this.emit('message', message)
      return message
    }

    if (isRestoreAndForkSubtype(subtype)) {
      const newSessionId = payload.new_session_id || payload.session_id || '已生成'
      const restoredCount = (payload.changed_files || payload.restored_files || payload.filesChanged || []).length || 0
      const isPatchMode = subtype === 'undo_patch_and_fork'
      const message = {
        id: `rewind-fork-${Date.now()}`,
        role: 'system',
        subtype: 'rewind-and-fork-notice',
        content:
          `✅ ${isPatchMode ? '已撤销本次修改并创建分支' : '已重置文件并创建分支'}\n\n` +
          `📦 新分支 ID: ${newSessionId}\n` +
          ` (已保存当前状态)\n` +
          `🔄 ${isPatchMode ? '撤销了' : '重置了'} ${restoredCount} 个文件\n\n` +
          `您可以在项目列表中找到新分支继续探索`,
        timestamp: new Date()
      }
      this.messages.push(message)
      this.saveMessageToHistory(message)
      this.emit('message', message)
      return message
    }

    return null
  }

  normalizeControlRequestForProvider(request = {}) {
    const normalizedRequest = { ...request }

    if (normalizedRequest?.subtype === 'rewind') {
      normalizedRequest.subtype = 'reset_files'
    } else if (normalizedRequest?.subtype === 'rewind_and_fork') {
      normalizedRequest.subtype = 'reset_files_and_fork'
    }

    if (normalizedRequest?.subtype === 'changed_files') {
      normalizedRequest.dry_run = true
    } else if (
      normalizedRequest?.subtype === 'reset_files' ||
      normalizedRequest?.subtype === 'undo_patch' ||
      normalizedRequest?.subtype === 'redo_patch'
    ) {
      normalizedRequest.dry_run = false
    }

    if (
      normalizedRequest?.user_message_id &&
      (
        normalizedRequest?.subtype === 'changed_files' ||
        normalizedRequest?.subtype === 'reset_files' ||
        normalizedRequest?.subtype === 'rewind_files' ||
        normalizedRequest?.subtype === 'reset_files_and_fork'
      )
    ) {
      normalizedRequest.numTurns = this.resolveCodexRollbackTurnCount(normalizedRequest.user_message_id)
    }

    return normalizedRequest
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

  trackPendingControlRequest(controlRequest) {
    if (!controlRequest) return

    const candidateIds = [
      controlRequest.request_id,
      controlRequest.tool_use_id,
      controlRequest.id
    ].filter(candidateId => candidateId !== undefined && candidateId !== null && candidateId !== '')

    for (const candidateId of candidateIds) {
      this.pendingControlRequests.set(String(candidateId), controlRequest)
    }

    this.pendingControlRequest = controlRequest
  }

  consumePendingControlRequest(requestId) {
    const lookupId = requestId !== undefined && requestId !== null && requestId !== ''
      ? String(requestId)
      : null
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
    ].filter(candidateId => candidateId !== undefined && candidateId !== null && candidateId !== '')

    for (const candidateId of candidateIds) {
      this.pendingControlRequests.delete(String(candidateId))
    }

    if (this.pendingControlRequest === resolvedRequest) {
      this.pendingControlRequest = null
    }

    return resolvedRequest
  }

  updateToolMessageState(toolUseId, updates = {}) {
    if (!toolUseId || !updates || typeof updates !== 'object') {
      return null
    }

    const toolUseIdStr = String(toolUseId)
    const message = [...this.messages].reverse().find(item =>
      item &&
      (item.role === 'tool_use' || item.role === 'diff') &&
      (
        String(item.id || '') === toolUseIdStr ||
        String(item.request_id || '') === toolUseIdStr ||
        String(item.tool_use_id || '') === toolUseIdStr ||
        String(item.toolUseId || '') === toolUseIdStr
      )
    )

    if (!message) {
      return null
    }

    const normalizedUpdates = attachExistingCcgui({
      ...updates,
      id: message.id,
      tool_use_id: pickFirstDefined(
        updates.tool_use_id,
        updates.toolUseId,
        message.request_id,
        message.tool_use_id,
        message.id
      ),
      ccgui: mergeCcguiSemantics(message.ccgui || null, updates.ccgui || null)
    })

    Object.assign(message, normalizedUpdates)
    if ((normalizedUpdates.isStreaming === false || normalizedUpdates.isExecuting === false) && !message.duration && message.startTime) {
      message.duration = Date.now() - message.startTime
    }

    historyManager.updateMessage(this.projectId, this.id, message.id, {
      ...normalizedUpdates,
      duration: message.duration || normalizedUpdates.duration || null
    })
    this.emit('message-update', {
      messageId: message.id,
      updates: {
        ...normalizedUpdates,
        ...(message.duration ? { duration: message.duration } : {})
      }
    })

    return message
  }

  async queryCommands(params = {}) {
    if (!this.runtimeManager || !this.runtimeManager.isReady()) {
      this.loadResolvedRuntimeConfig()
      await this.startRuntime()
    }

    if (typeof this.runtimeManager?.queryCommands === 'function') {
      return this.runtimeManager.queryCommands(params)
    }

    const category = typeof params?.category === 'string' ? params.category : 'slash_command'
    return { provider: this.provider, category, groups: [] }
  }

  /**
   * 查询 @ reference 分组数据（agents / skills / mcpTools）
   */
  async queryAtReferences(forceRefresh = false) {
    if (!this.runtimeManager || !this.runtimeManager.isReady()) {
      this.loadResolvedRuntimeConfig()
      await this.startRuntime()

      // 启动后主动触发 mcp_status 并等待响应，确保 MCP 工具数据就绪
      if (typeof this.runtimeManager?.requestMcpStatus === 'function') {
        try {
          await this.runtimeManager.requestMcpStatus()
        } catch (e) {
          logger.warn(`[SessionInstance] requestMcpStatus after start failed: ${e.message}`)
        }
      }
    }

    if (typeof this.runtimeManager?.queryAtReferences === 'function') {
      return this.runtimeManager.queryAtReferences(forceRefresh)
    }
    return { provider: this.provider, groups: [] }
  }

  async runCommands(payload = {}) {
    const commands = Array.isArray(payload?.commands) ? payload.commands : []
    if (!commands.length) {
      return { success: true, executed: 0 }
    }

    for (const command of commands) {
      const value = typeof command?.value === 'string' ? command.value.trim() : ''
      const commandArguments = typeof command?.arguments === 'string' ? command.arguments.trim() : ''
      if (!value) continue

      if (!this.runtimeManager || !this.runtimeManager.isReady()) {
        this.loadResolvedRuntimeConfig()
        await this.startRuntime()
      }

      const commandId = crypto.randomUUID()
      const commandText = commandArguments ? `${value} ${commandArguments}` : value
      const displayMessage = {
        id: commandId,
        role: 'command',
        content: commandText,
        serializedContent: commandText,
        commandName: value,
        commandArguments,
        argumentHint: typeof command?.argumentHint === 'string' ? command.argumentHint : '',
        command: {
          id: typeof command?.id === 'string' ? command.id : '',
          messageId: commandId,
          label: typeof command?.label === 'string' ? command.label : value,
          description: typeof command?.description === 'string' ? command.description : '',
          value,
          arguments: commandArguments,
          argumentHint: typeof command?.argumentHint === 'string' ? command.argumentHint : '',
          kind: typeof command?.kind === 'string' ? command.kind : '',
          category: typeof command?.category === 'string' ? command.category : 'slash_command',
          providerMeta: isPlainObject(command?.providerMeta) ? JSON.parse(JSON.stringify(command.providerMeta)) : null
        },
        timestamp: new Date(),
        startTime: Date.now()
      }

      this.messages.push(displayMessage)
      this.activeResponseUserMessageId = displayMessage.id
      this.saveMessageToHistory(displayMessage)
      this.emit('message', displayMessage)

      this.isProcessing = true
      this.emit('state-update', { isProcessing: true })

      try {
        if (typeof this.runtimeManager?.runCommand === 'function') {
          await this.runtimeManager.runCommand(displayMessage.command)
        } else {
          await this.runtimeManager.sendMessage({
            type: 'user',
            uuid: commandId,
            message: {
              role: 'user',
              content: [{ type: 'text', text: commandText }]
            }
          })
        }
      } catch (error) {
        this.isProcessing = false
        this.emit('state-update', { isProcessing: false })
        throw error
      }
    }

    return { success: true, executed: commands.length }
  }

  /**
   * 发送控制响应（权限批准/拒绝）
   */
  async sendControlResponse(requestId, approved, options = {}) {
    if (!this.runtimeManager) {
      throw new Error('Provider not started')
    }

    const pendingRequest = this.consumePendingControlRequest(requestId)
    if (pendingRequest) {
      const toolName = pendingRequest.tool_name || pendingRequest.toolName
      if (toolName !== 'AskUserQuestion') {
        const permissionResultMessage = this.buildPermissionResultMessage(pendingRequest, approved, options)
        if (permissionResultMessage) {
          this.messages.push(permissionResultMessage)
          this.saveMessageToHistory(permissionResultMessage)
          this.emit('message', permissionResultMessage)
        }
      }

      if (!approved && toolName !== 'AskUserQuestion') {
        const toolUseId = pickFirstDefined(
          pendingRequest.tool_use_id,
          pendingRequest.toolUseId,
          pendingRequest.id,
          requestId
        )
        this.updateToolMessageState(toolUseId, {
          isExecuting: false,
          isError: true,
          result: '用户拒绝'
        })
      }
    }
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

    if (isError) {
      this.updateToolMessageState(toolUseId, {
        isExecuting: false,
        isError: true,
        result: content || '(无输出)'
      })
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

    if (this.runtimeManager.sendControlRequest) {
      this.trackPendingControlRequest(normalizedRequest)

      const response = await this.runtimeManager.sendControlRequest(normalizedRequest)
      if (response) {
        const responseRequestId = pickFirstDefined(response?.response?.request_id, response?.request_id, null)
        const pendingRequest = this.consumePendingControlRequest(responseRequestId) || normalizedRequest
        const payload = this.extractControlResponsePayload(response)

        if (
          pendingRequest &&
          payload &&
          !payload.error &&
          isRestoreActionSubtype(pendingRequest?.subtype) &&
          pendingRequest?.user_message_id &&
          pendingRequest?.dry_run !== true
        ) {
          const rewindMode = isPatchUndoSubtype(pendingRequest?.subtype) ? 'patch' : 'reset'
          this.applyRewindLocally(pendingRequest.user_message_id, payload, { mode: rewindMode })
        }

        if (isRestoreAndForkSubtype(pendingRequest?.subtype) && pendingRequest?.user_message_id) {
          const rewindMode = pendingRequest?.subtype === 'undo_patch_and_fork' ? 'patch' : 'reset'
          this.applyRewindLocally(pendingRequest.user_message_id, payload || {}, { mode: rewindMode })
        }

        if (
          pendingRequest &&
          payload &&
          !payload.error &&
          isPatchRedoSubtype(pendingRequest?.subtype) &&
          pendingRequest?.user_message_id &&
          pendingRequest?.dry_run !== true
        ) {
          this.applyPatchRedoLocally(pendingRequest.user_message_id)
        }

        this.appendControlOutcomeMessage(pendingRequest, response)
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

    const normalizedMode = typeof mode === 'string' && mode.trim()
      ? mode.trim()
      : 'default'
    const previousMode = this.permissionMode
    const previousSettings = { ...(this.sessionSettings || {}) }

    this.permissionMode = normalizedMode
    this.sessionSettings = {
      ...previousSettings,
      permissionMode: normalizedMode
    }

    try {
      await projectService.updateSessionConfig(this.projectId, this.id, {
        name: projectService.getSessionConfig(this.projectId, this.id)?.name || '新会话',
        settings: this.sessionSettings
      })
    } catch (error) {
      this.permissionMode = previousMode
      this.sessionSettings = previousSettings
      throw error
    }

    // 所有权限模式（包括 bypassPermissions）均通过控制请求热切换，无需重启
    const runtimeStarted = Boolean(this.runtimeManager?.isReady?.())

    if (!runtimeStarted) {
      logger.info(`[SessionInstance] Provider not ready, will apply permission mode on start: ${normalizedMode}`)
      return
    }

    try {
      if (typeof this.runtimeManager.setPermissionMode === 'function') {
        await this.runtimeManager.setPermissionMode(normalizedMode)
        logger.info(`[SessionInstance] Applied permission mode via adapter: ${normalizedMode}`)
      } else {
        logger.info(`[SessionInstance] Provider has no live permission mode handler, will apply on next turn: ${normalizedMode}`)
      }
    } catch (error) {
      this.permissionMode = previousMode
      this.sessionSettings = previousSettings
      await projectService.updateSessionConfig(this.projectId, this.id, {
        name: projectService.getSessionConfig(this.projectId, this.id)?.name || '新会话',
        settings: previousSettings
      })
      throw error
    }
  }

  /**
   * 设置自动批准开关（独立于权限模式）
   */
  async setAutoApprove(enabled) {
    logger.info(`[SessionInstance] Setting autoApprove to: ${enabled}`)
    const previousAutoApprove = this.autoApprove
    const previousSettings = { ...(this.sessionSettings || {}) }

    this.autoApprove = !!enabled
    this.sessionSettings = {
      ...previousSettings,
      autoApprove: this.autoApprove
    }

    try {
      await projectService.updateSessionConfig(this.projectId, this.id, {
        name: projectService.getSessionConfig(this.projectId, this.id)?.name || '新会话',
        settings: this.sessionSettings
      })
    } catch (error) {
      this.autoApprove = previousAutoApprove
      this.sessionSettings = previousSettings
      throw error
    }
  }

  /**
   * 保存 task-dock 历史记录到 project 配置（project 级别共享）
   */
  async saveTaskDockHistory(items) {
    const history = Array.isArray(items) ? items.map(item => ({
      label: item.label || '',
      commandLine: item.commandLine || '',
      lastUsedAt: item.lastUsedAt || Date.now()
    })) : []

    this.taskDockHistory = history

    const projectConfig = projectService.getProjectConfig(this.projectId) || {}
    const nextSettings = {
      ...((projectConfig.settings && typeof projectConfig.settings === 'object') ? projectConfig.settings : {}),
      taskDockHistory: history
    }

    await projectService.updateProjectConfig(this.projectId, { settings: nextSettings })
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

  /**
   * 运行时动态修改 maxThinkingTokens（不禁用思考，仅限运行时）
   * 通过 control request 发送给 provider，不持久化到配置
   */
  async setMaxThinkingTokens(value) {
    const normalizedValue = typeof value === 'number' && Number.isFinite(value)
      ? Math.max(0, Math.min(30000, Math.floor(value)))
      : null

    if (this.runtimeManager?.sendControlRequest) {
      this.runtimeManager.sendControlRequest({
        subtype: 'set_max_thinking_tokens',
        max_thinking_tokens: normalizedValue
      })
      return { success: true, value: normalizedValue }
    }

    return { success: false, error: 'Runtime not started' }
  }

  /**
   * 切换思考开关
   * 1. 持久化 thinkingEnabled 到 session 配置
   * 2. 如果运行时已启动，根据 thinkingEnabled + 实际 tokens 值调用 control request
   */
  async setThinkingEnabled(enabled) {
    const normalizedEnabled = enabled === true

    // 1. 持久化到 session 配置
    try {
      const sessionConfig = projectService.getSessionConfig(this.projectId, this.id)
      const nextSettings = {
        ...((sessionConfig?.settings && typeof sessionConfig.settings === 'object') ? sessionConfig.settings : {})
      }
      nextSettings.thinkingEnabled = normalizedEnabled
      nextSettings.thinkingMode = 'custom'

      const updatedConfig = await projectService.updateSessionConfig(this.projectId, this.id, {
        name: sessionConfig?.name || '新会话',
        settings: nextSettings
      })

      if (updatedConfig?.settings) {
        this.applySessionSettings(updatedConfig.settings)
      }

      // 2. 如果运行时已启动，重新解析配置并发送 control request
      if (this.runtimeManager?.sendControlRequest) {
        const resolvedConfig = this.loadResolvedRuntimeConfig()
        const effectiveTokens = resolvedConfig.settings.maxThinkingTokens
        // resolvedConfig.settings.maxThinkingTokens 已被 config-resolution 根据
        // thinkingEnabled 覆盖过（thinkingEnabled=false → 0）

        this.runtimeManager.sendControlRequest({
          subtype: 'set_max_thinking_tokens',
          max_thinking_tokens: effectiveTokens
        })

        return {
          success: true,
          thinkingEnabled: normalizedEnabled,
          effectiveTokens,
          appliedLive: true
        }
      }

      return {
        success: true,
        thinkingEnabled: normalizedEnabled,
        appliedLive: false
      }
    } catch (error) {
      logger.error(`[SessionInstance] Failed to set thinkingEnabled: ${error.message}`)
      return { success: false, error: error.message }
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
    const persistedPermissionMode = typeof this.sessionSettings.permissionMode === 'string'
      ? this.sessionSettings.permissionMode.trim()
      : ''
    this.permissionMode = persistedPermissionMode || 'default'

    this.autoApprove = this.sessionSettings.autoApprove === true

    // taskDockHistory 从 projectConfig 读取（project 级别共享）
    const projectConfig = projectService.getProjectConfig(this.projectId) || {}
    this.taskDockHistory = Array.isArray(projectConfig.settings?.taskDockHistory)
      ? projectConfig.settings.taskDockHistory
      : []

    if (this.runtimeManager && typeof this.runtimeManager.setDebugEnabled === 'function') {
      this.runtimeManager.setDebugEnabled(this.sessionSettings.debug === true)
    }
  }

  /**
   * 向前端发送事件
   */
  emit(eventType, data) {
    const normalizedData = this.applyHistoryContextToEventData(eventType, data)
    const event = {
      sessionId: this.id,
      eventType,
      data: normalizedData,
      timestamp: new Date().toISOString()
    }
    this.eventLog.push(event)
    this.appendEventToTurnHistory(event)

    if (this.webContents && !this.webContents.isDestroyed()) {
      this.webContents.send('session-event', event)
    }
  }

  appendEventToTurnHistory(event) {
    const payload = event?.data || null
    const history = payload?.ccgui?.history || null
    const subagentTurnId = history?.subagentTurnId || null
    const subagentAgentId = history?.targetAgentId && history.targetAgentId !== this.getMainAgentId()
      ? history.targetAgentId
      : null

    if (event?.eventType === 'message' && isTurnEntryRole(payload?.role)) {
      const turnEntry = historyManager.appendTurn(this.projectId, this.id, payload)
      this.currentHistoryTurnId = turnEntry?.turnId || payload?.id || null
      if (this.currentHistoryTurnId) {
        this.setAgentSourceTurnId(this.getMainAgentId(), this.currentHistoryTurnId)
      }
      if (this.currentHistoryTurnId) {
        historyManager.appendTurnEvent(this.projectId, this.id, this.currentHistoryTurnId, event)
      }
      if (subagentAgentId && subagentTurnId) {
        historyManager.ensureSubagentTurn(this.projectId, this.id, subagentAgentId, subagentTurnId, event)
        historyManager.appendSubagentTurnEvent(this.projectId, this.id, subagentAgentId, subagentTurnId, event)
      }
      this.historyTurns = historyManager.loadIndexEntries(this.projectId, this.id)
      return
    }

    if (subagentAgentId && subagentTurnId) {
      historyManager.ensureSubagentTurn(this.projectId, this.id, subagentAgentId, subagentTurnId, event)
      historyManager.appendSubagentTurnEvent(this.projectId, this.id, subagentAgentId, subagentTurnId, event)
    }

    if (!this.currentHistoryTurnId) {
      return
    }

    if (!this.shouldPersistEventInTurnHistory(event)) {
      return
    }

    if (subagentAgentId || history?.deliveryKind === 'send') {
      return
    }

    historyManager.appendTurnEvent(this.projectId, this.id, this.currentHistoryTurnId, event)
    this.historyTurns = historyManager.loadIndexEntries(this.projectId, this.id)
  }

  buildQuestionMessage(controlRequest, answers = {}) {
    if (!controlRequest) return null

    const toolUseId = pickFirstDefined(
      controlRequest.tool_use_id,
      controlRequest.toolUseId,
      controlRequest.id,
      controlRequest.request_id
    )

    if (toolUseId === undefined || toolUseId === null || toolUseId === '') return null

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
      collapsed: true,
      timestamp: new Date(),
      rawMessages: [controlRequest]
    }
  }

  buildPermissionResultMessage(controlRequest, approved, options = {}) {
    if (!controlRequest) return null

    const toolUseId = pickFirstDefined(
      controlRequest.tool_use_id,
      controlRequest.toolUseId,
      controlRequest.id,
      controlRequest.request_id,
      `permission-${Date.now()}`
    )

    const updatedInput = options?.updatedInput || {}
    const updatedPermissions = Array.isArray(options?.permissionRules) ? options.permissionRules : []
    const toolName = controlRequest.tool_name || controlRequest.toolName || controlRequest.method || 'Unknown'
    const isAllowAll = Boolean(approved && updatedPermissions.length > 0)

    let content = ''
    if (!approved) {
      content = `❌ 已拒绝: ${toolName}`
    } else if (isAllowAll) {
      content = `✅ 已允许 (所有): ${toolName}`
    } else {
      content = `✅ 已允许: ${toolName}`
    }

    if (updatedInput.command) {
      if (updatedInput.description) {
        content += `\n说明: ${updatedInput.description}`
      }
      content += `\n命令: ${updatedInput.command}`
    } else if (updatedInput.file_path) {
      if (updatedInput.description) {
        content += `\n说明: ${updatedInput.description}`
      }
      content += `\n文件: ${updatedInput.file_path}`
    } else if (updatedInput.pattern) {
      if (updatedInput.description) {
        content += `\n说明: ${updatedInput.description}`
      }
      content += `\n模式: ${updatedInput.pattern}`
      if (updatedInput.path) {
        content += `\n路径: ${updatedInput.path}`
      }
    } else if (updatedInput.query) {
      if (updatedInput.description) {
        content += `\n说明: ${updatedInput.description}`
      }
      content += `\n查询: ${updatedInput.query}`
    } else if (updatedInput.description) {
      content += `\n说明: ${updatedInput.description}`
    }

    return attachExistingCcgui({
      id: `permission-result-${toolUseId}-${Date.now()}`,
      role: 'permission_result',
      tool_use_id: toolUseId,
      toolUseId,
      content,
      timestamp: new Date(),
      rawMessages: [controlRequest]
    }, controlRequest)
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
      this.finalizeActiveMessages()
      if (reason !== 'restart-for-config') {
        this.finalizePendingLifecycleNotification('runtime-stopped', {
          provider: this.provider,
          reason,
          message: reason === 'project-close'
            ? `${this.getProviderDisplayName()} 已随项目关闭停止`
            : `${this.getProviderDisplayName()} 已停止运行`
        })
      }
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

      processRegistry.unregister(this.id)
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
