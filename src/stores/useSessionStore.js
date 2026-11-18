import { defineStore } from 'pinia'
import { ref, computed, watch, reactive } from 'vue'
import { QueueManager } from './AgentQueue'
import {
  findMcpNotificationByOperationId,
  isMcpLifecycleNotificationType,
  isMcpNotificationType,
  shouldIgnoreMcpNotificationUpdate
} from './systemNotificationOperation'
import { logger } from '../utils/logger'
import { stripAttachmentTokens } from '../utils/chatAttachments'
import { stripAnsi } from '../utils/textSanitizers'
import { useAppStore } from './useAppStore'
import { openAppErrorDialog } from '../utils/appErrorDialog'

/**
 * 日志工具 - 使用新的文件日志系统
 */
function log(...args) {
  const message = args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ')

  logger.info(`[SessionStore] ${message}`)
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

/**
 * 判断权限请求是否针对 ~/.ccgui 目录下的文件
 * 自动批准这些请求，无需弹窗和音效
 */
function isCcGuiFileRequest(requestData) {
  if (!requestData || typeof requestData !== 'object') return false

  let toolInput = requestData.input || requestData.tool_input || requestData.toolInput
  if (!toolInput) return false

  if (typeof toolInput === 'string') {
    try { toolInput = JSON.parse(toolInput) } catch { return false }
  }
  if (!toolInput || typeof toolInput !== 'object') return false

  const filePath = toolInput.file_path || toolInput.filePath || toolInput.path || ''
  if (typeof filePath !== 'string' || !filePath) return false

  const normalized = filePath.replace(/\\/g, '/')
  return normalized.includes('/.ccgui/') || normalized.endsWith('/.ccgui')
}

function isCcGuiInternalMcpRequest(requestData) {
  if (!requestData || typeof requestData !== 'object') return false

  const toolName = requestData.tool_name || requestData.toolName
  if (typeof toolName === 'string' && toolName.startsWith('mcp__ccgui_internal__')) {
    return true
  }

  const serverNames = [
    requestData.serverName,
    requestData.mcp_server?.name,
    requestData.mcpServer?.name,
    requestData.permissions?.serverName,
    requestData.tool_input?.permissions?.serverName,
    requestData.toolInput?.permissions?.serverName,
    requestData.input?.permissions?.serverName
  ]

  return serverNames.some(serverName => String(serverName || '').trim() === 'ccgui_internal')
}

function isTurnInitiatorMessage(message = null) {
  return message?.role === 'user' || message?.role === 'command'
}

function toPlainJsonObject(value) {
  if (!value || typeof value !== 'object') {
    return null
  }

  try {
    return JSON.parse(JSON.stringify(value))
  } catch (error) {
    return null
  }
}

function normalizeCommandForIpc(command = {}) {
  if (!command || typeof command !== 'object') {
    return null
  }

  const value = typeof command.value === 'string' ? command.value.trim() : ''
  if (!value) {
    return null
  }

  return {
    id: typeof command.id === 'string' ? command.id : '',
    label: typeof command.label === 'string' ? command.label : value,
    description: typeof command.description === 'string' ? command.description : '',
    argumentHint: typeof command.argumentHint === 'string' ? command.argumentHint : '',
    category: typeof command.category === 'string' ? command.category : 'slash_command',
    submitMode: typeof command.submitMode === 'string' ? command.submitMode : 'runCommand',
    kind: typeof command.kind === 'string' ? command.kind : '',
    value,
    arguments: typeof command.arguments === 'string' ? command.arguments.trim() : '',
    groupId: typeof command.groupId === 'string' ? command.groupId : '',
    groupLabel: typeof command.groupLabel === 'string' ? command.groupLabel : '',
    providerMeta: toPlainJsonObject(command.providerMeta)
  }
}

/**
 * SessionData
 * 每个会话的完整状态（包含 UI 状态和消息）
 */
class SessionData {
  constructor(id, projectPath) {
    this.id = id
    this.projectPath = projectPath

    // 消息队列系统（取代原来的扁平 messages 数组）
    this.queueManager = new QueueManager()

    this.rawMessages = [] // 原始消息数据

    // UI 状态
    this.inputMessage = ''
    this.inputAttachments = []
    this.isProcessing = false
    this.inputHistory = []
    this.historyIndex = -1

    // 权限相关
    this.pendingPermissions = []
    this.pendingControlRequests = [] // 改为队列以支持并发请求
    this.pendingQuestion = null  // AskUserQuestion 请求
    this.lastPermissionRequest = null // 用于在收到 CLI 响应时添加权限结果消息

    // 环境信息
    this.envInfo = null
    this.silentMessages = []
    this.taskEvents = []
    this.subagentHistories = []
    this.activeAgentIds = new Set()

    // Runtime 状态
    this.runtimeReady = false

    // 流式状态
    this.currentAssistantMessageIndex = -1
    this.currentContentBlockType = null
    this.contentBlockIndexToId = new Map()
    this.currentTurnNumber = 0
    this.hasSeenToolUseInCurrentTurn = false
    this.currentStreamingAssistantId = null // 用于去重

    this.permissionMode = 'default' // 当前权限模式
    this.autoApprove = false         // 自动批准开关（独立于权限模式）
    this.taskDockHistory = []         // task-dock 历史记录
    this.fastModeState = 'off' // 快速模式状态: 'off' | 'auto' | 'on'
    this.activeTasks = new Map() // 活跃的子任务 Map<taskId, taskData>
    this.currentTurnUsageSources = {}
    this.mainAgentId = 'master'
    this.agentRegistry = new Map()
    this.agentToolUseBindings = new Map()
    this.agentWorkspaceState = {
      activeAgentId: this.mainAgentId,
      collaborativeViewMode: 'single',
      splitAgentIds: [],
      focusedPaneAgentId: this.mainAgentId,
      inputTargetAgentId: this.mainAgentId
    }
  }
}

function normalizeAgentRegistryEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null
  }

  const agentId = entry.agentId || entry.agent_id
  if (!agentId) {
    return null
  }

  return {
    agentId,
    agentKind: entry.agentKind || entry.agent_kind || null,
    agentType: entry.agentType || entry.agent_type || null,
    name: entry.name || null,
    title: entry.title || null,
    description: entry.description || null,
    color: entry.color || entry.agentColor || entry.agent_color || null,
    prompt: entry.prompt || null,
    model: entry.model || null,
    teamId: entry.teamId || entry.team_id || null,
    parentAgentId: entry.parentAgentId || entry.parent_agent_id || null,
    status: entry.status || null,
    canWrite: entry.canWrite !== undefined ? Boolean(entry.canWrite) : null,
    interactionMode: entry.interactionMode || entry.interaction_mode || null,
    startTime: entry.startTime || entry.start_time || null,
    endTime: entry.endTime || entry.end_time || null,
    deleteTime: entry.deleteTime || entry.delete_time || null
  }
}

function normalizeOrchestrationEntry(entry) {
  if (!entry || typeof entry !== 'object') {
    return null
  }

  const eventType = entry.eventType || entry.event_type
  const agentId = entry.agentId || entry.agent_id
  if (!eventType || !agentId) {
    return null
  }

  return {
    eventType,
    agentId,
    agentKind: entry.agentKind || entry.agent_kind || null,
    agentType: entry.agentType || entry.agent_type || null,
    name: entry.name || null,
    color: entry.color || entry.agentColor || entry.agent_color || null,
    prompt: entry.prompt || null,
    model: entry.model || null,
    teamId: entry.teamId || entry.team_id || null,
    parentAgentId: entry.parentAgentId || entry.parent_agent_id || null,
    actorId: entry.actorId || entry.actor_id || null,
    targetId: entry.targetId || entry.target_id || null,
    source: entry.source || null,
    reason: entry.reason || null,
    result: entry.result || null,
    status: entry.status || null,
    canWrite: entry.canWrite !== undefined ? Boolean(entry.canWrite) : null,
    interactionMode: entry.interactionMode || entry.interaction_mode || null,
    targetKind: entry.targetKind || entry.target_kind || null,
    timestamp: entry.timestamp || null
  }
}

function normalizeRoutingParticipant(value) {
  if (!value) return null
  return String(value)
    .trim()
    .replace(/^@/, '')
    .replace(/v\d+$/i, '')
    .replace(/\s+/g, ' ')
    .toLowerCase()
}

function isGenericCollaborativeLabel(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return !normalized ||
    normalized === 'team-member' ||
    normalized === '协作型代理' ||
    normalized === 'team-lead' ||
    normalized === 'team lead' ||
    normalized === 'teamlead' ||
    normalized === 'master'
}

function pickSpecificCollaborativeValue(...values) {
  for (const value of values) {
    if (value === null || value === undefined) {
      continue
    }
    const normalized = String(value).trim()
    if (!normalized) {
      continue
    }
    if (isGenericCollaborativeLabel(normalized)) {
      continue
    }
    return value
  }
  return null
}

function hasSpecificCollaborativeIdentityPayload(...entries) {
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      continue
    }

    const title = pickSpecificCollaborativeValue(entry.title)
    const name = pickSpecificCollaborativeValue(entry.name)
    const agentType = pickSpecificCollaborativeValue(entry.agentType, entry.agent_type)
    const color = typeof entry.color === 'string' && entry.color.trim() ? entry.color.trim() : null

    if (title || name || agentType || color) {
      return true
    }
  }

  return false
}

function extractTeammateMessageMeta(text) {
  if (typeof text !== 'string' || !text.trim()) {
    return null
  }

  const match = text.match(/^<teammate-message\b([^>]*)>([\s\S]*?)<\/teammate-message>\s*$/)
  if (!match) {
    return null
  }

  const [, rawAttrs = '', rawBody = ''] = match
  const attrs = {}
  for (const attrMatch of rawAttrs.matchAll(/([a-zA-Z0-9_:-]+)="([^"]*)"/g)) {
    attrs[attrMatch[1]] = attrMatch[2]
  }

  return {
    sender: attrs.teammate_id || attrs.sender || '',
    summary: attrs.summary || '',
    color: attrs.color || '',
    content: rawBody.trim()
  }
}

function extractTeammateDisplayName(teammateMeta) {
  if (!teammateMeta) {
    return null
  }

  const bodyMatch = teammateMeta.content?.match(/你是([^\s。，“”"'':：\-]{1,20})/u)
  if (bodyMatch?.[1] && !isGenericCollaborativeLabel(bodyMatch[1])) {
    return bodyMatch[1].trim()
  }

  const summary = String(teammateMeta.summary || '').trim()
  if (!summary) {
    return null
  }

  const summaryMatch = summary.match(/^([^\s。，“”"'':：\-]{1,20}?)(?:参与讨论|讨论|开始|第\d+轮|发言|回应|总结|结束|$)/u)
  if (summaryMatch?.[1] && !isGenericCollaborativeLabel(summaryMatch[1])) {
    return summaryMatch[1].trim()
  }

  const head = summary.split(/[\s，。,：:\-]/u)[0]?.trim() || ''
  if (head && !isGenericCollaborativeLabel(head)) {
    return head
  }

  return null
}

function inferCollaborativeDisplay(entry, mainAgentId) {
  const fallbackTitle = entry?.agentId === mainAgentId ? 'Master' : '协作型代理'
  const existingTitle = (() => {
    const candidate = entry?.title || entry?.name || null
    if (!candidate || isGenericCollaborativeLabel(candidate)) {
      return null
    }
    return candidate
  })()
  const title = existingTitle || fallbackTitle
  const agentType = entry?.agentType && entry.agentType !== 'team-member'
    ? entry.agentType
    : null

  return {
    title,
    subtitle: entry?.agentId === mainAgentId ? '主会话' : (agentType || entry?.model || null),
    effectiveAgentType: agentType || entry?.agentType || null
  }
}

function toPlainAttachment(attachment) {
  if (!attachment || typeof attachment !== 'object') {
    return attachment
  }

  return JSON.parse(JSON.stringify(attachment))
}

function normalizeOutgoingContent(content) {
  if (typeof content === 'string') {
    return content
  }

  if (!content || typeof content !== 'object') {
    return content
  }

  if (typeof content.text === 'string' && Array.isArray(content.attachments)) {
    return {
      text: content.text,
      attachments: content.attachments.map(toPlainAttachment),
      ...(content.ccgui ? { ccgui: JSON.parse(JSON.stringify(content.ccgui)) } : {})
    }
  }

  return JSON.parse(JSON.stringify(content))
}

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value
    }
  }
  return null
}

function isGenericAgentLabel(value) {
  const normalized = String(value || '').trim().toLowerCase()
  return normalized === 'agent' || normalized === 'subagent'
}

function normalizeExecutionTaskTitle(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  if (!text) {
    return null
  }
  if (text.length <= 48) {
    return text
  }
  return `${text.slice(0, 48)}...`
}

function pickExecutionAgentDisplayTitle(items = [], entry = null) {
  const candidates = []
  const taskTitleCandidates = []

  for (const message of items) {
    const input = message?.toolInput || {}
    candidates.push(
      input.name,
      input.subagent_type,
      input.subagentType,
      message?.name
    )
    taskTitleCandidates.push(
      message?.description,
      message?.summary,
      input.task,
      input.instructions,
      input.description,
      input.prompt
    )
  }

  candidates.push(
    entry?.name,
    entry?.agentType
  )

  for (const candidate of candidates) {
    if (candidate === undefined || candidate === null || candidate === '') {
      continue
    }
    if (isGenericAgentLabel(candidate)) {
      continue
    }
    return candidate
  }

  for (const candidate of taskTitleCandidates) {
    const title = normalizeExecutionTaskTitle(candidate)
    if (title) {
      return title
    }
  }

  return pickFirstDefined(entry?.name, entry?.agentType) || 'Agent'
}

function aggregateExecutionAgentUsage(items = [], entry = null) {
  const latestWithUsage = [...items].reverse().find(message =>
    message?.usage &&
    typeof message.usage === 'object' &&
    (
      Number.isFinite(message.usage.input_tokens) ||
      Number.isFinite(message.usage.output_tokens) ||
      Number.isFinite(message.usage.cache_read_input_tokens)
    )
  )
  return latestWithUsage?.usage || entry?.usage || null
}

function aggregateExecutionAgentDuration(items = [], entry = null, status = null) {
  const latestTaskComplete = [...items].reverse().find(message => message?.role === 'task_complete' && typeof message?.duration === 'number')
  if (latestTaskComplete?.duration !== undefined) {
    return latestTaskComplete.duration
  }

  if (typeof entry?.duration === 'number') {
    return entry.duration
  }

  const startMs = entry?.startTime ? Date.parse(entry.startTime) : NaN
  const endMs = entry?.endTime ? Date.parse(entry.endTime) : NaN
  if (
    status &&
    status !== 'running' &&
    Number.isFinite(startMs) &&
    Number.isFinite(endMs) &&
    endMs >= startMs
  ) {
    return endMs - startMs
  }

  return null
}

function formatExecutionAgentResult(value) {
  if (value === undefined || value === null) {
    return null
  }

  if (typeof value === 'string') {
    const text = value.trim()
    return text || null
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }

  if (typeof value === 'object') {
    if (typeof value.result === 'string' && value.result.trim()) {
      return value.result.trim()
    }
    if (typeof value.text === 'string' && value.text.trim()) {
      return value.text.trim()
    }
    if (typeof value.content === 'string' && value.content.trim()) {
      return value.content.trim()
    }
    try {
      return JSON.stringify(value, null, 2)
    } catch {
      return String(value)
    }
  }

  return String(value)
}

function normalizeTokenUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return null
  }

  const normalized = {
    input_tokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0,
    cache_read_input_tokens: Number.isFinite(usage.cache_read_input_tokens) ? usage.cache_read_input_tokens : 0,
    output_tokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0
  }

  if (
    normalized.input_tokens === 0 &&
    normalized.cache_read_input_tokens === 0 &&
    normalized.output_tokens === 0
  ) {
    return null
  }

  return normalized
}

function sumTokenUsages(usages = []) {
  const total = {
    input_tokens: 0,
    cache_read_input_tokens: 0,
    output_tokens: 0
  }

  let hasAnyUsage = false
  for (const usage of usages) {
    const normalized = normalizeTokenUsage(usage)
    if (!normalized) {
      continue
    }
    hasAnyUsage = true
    total.input_tokens += normalized.input_tokens
    total.cache_read_input_tokens += normalized.cache_read_input_tokens
    total.output_tokens += normalized.output_tokens
  }

  return hasAnyUsage ? total : null
}

function resolveAgentIdFromCcguiPayload(ccgui = null) {
  if (!ccgui || typeof ccgui !== 'object') {
    return null
  }

  return pickFirstDefined(
    ccgui?.attribution?.agentId,
    ccgui?.orchestration?.agentId,
    ccgui?.registry?.agentId
  )
}

function toIsoTimestamp(value) {
  if (!value) return null
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'number') return new Date(value).toISOString()
  if (typeof value === 'string') return value
  return null
}

function toTimestampMs(value) {
  if (value instanceof Date) return value.getTime()
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim()) {
    if (/^\d+$/.test(value.trim())) {
      return Number(value.trim())
    }
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function applyMessageDuration(message, completedAt) {
  if (!message || message.duration) return
  const startTime = toTimestampMs(message.startTime ?? message.timestamp)
  const endTime = toTimestampMs(completedAt)
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime < startTime) {
    return
  }

  const duration = endTime - startTime
  if (duration <= 24 * 60 * 60 * 1000) {
    message.duration = duration
  }
}

function buildSubagentHistoryAnchor(turn = {}, agentId, registry = null) {
  const timestamp = toIsoTimestamp(turn.createdAt) || new Date().toISOString()
  const content = typeof turn.inputText === 'string' ? turn.inputText : ''
  const syntheticId = `subagent-anchor:${agentId}:${turn.turnId}`
  const role = turn.messageRole === 'command' ? 'command' : 'user'

  return {
    id: syntheticId,
    role,
    content,
    serializedContent: content,
    attachments: [],
    timestamp,
    responseCollapsed: Boolean(turn.hasAssistantResponse),
    ccgui: {
      ...(registry ? { registry } : {}),
      history: {
        sourceUserTurnId: turn.sourceUserTurnId || null,
        subagentTurnId: turn.turnId,
        inputKind: turn.inputKind || null,
        deliveryKind: turn.deliveryKind || null,
        senderAgentId: turn.senderAgentId || null,
        targetAgentId: turn.targetAgentId || agentId
      }
    },
    historyTurn: {
      scope: 'subagent',
      agentId,
      turnId: turn.turnId,
      status: turn.status || 'pending',
      hasResponse: Boolean(turn.hasAssistantResponse),
      eventCount: Number(turn.eventCount || 0),
      loaded: Boolean(turn.loaded),
      loading: false
    },
    ...(turn.loaded ? { responseCollapsed: false } : {})
  }
}

function resolveSubagentHistoryStatus(subagentHistory = null, session = null) {
  const entries = Array.isArray(subagentHistory?.entries) ? subagentHistory.entries : []
  const latestEntry = [...entries].reverse().find(entry => entry && typeof entry === 'object') || null
  const status = latestEntry?.registry?.status || subagentHistory?.registry?.status || null
  const terminalStatuses = new Set(['ended', 'failed', 'interrupted', 'deleted'])
  const agentId = subagentHistory?.agentId || latestEntry?.agentId || null
  const isActive = Boolean(agentId && session?.activeAgentIds?.has?.(agentId))

  if (terminalStatuses.has(status)) {
    return status
  }
  if (status === 'running' || status === 'starting') {
    return isActive ? status : 'interrupted'
  }

  switch (latestEntry?.status) {
    case 'completed':
      return 'ended'
    case 'failed':
    case 'error':
      return 'failed'
    case 'interrupted':
    case 'deleted':
      return latestEntry.status
    case 'streaming':
    case 'pending':
      return isActive ? 'running' : 'interrupted'
    default:
      return null
  }
}

function reconcileSubagentHistoryStatuses(session) {
  if (!session?.agentRegistry || !Array.isArray(session.subagentHistories)) {
    return
  }

  for (const subagentHistory of session.subagentHistories) {
    const agentId = subagentHistory?.agentId
    if (!agentId) {
      continue
    }

    const currentEntry = session.agentRegistry.get(agentId)
    if (!currentEntry) {
      continue
    }

    const historyStatus = resolveSubagentHistoryStatus(subagentHistory, session)
    if (!historyStatus) {
      continue
    }

    session.agentRegistry.set(agentId, mergeAgentRegistryEntry(currentEntry, {
      ...(subagentHistory.registry || {}),
      agentId,
      agentKind: currentEntry.agentKind || subagentHistory.registry?.agentKind || 'collaborative',
      status: historyStatus
    }))
  }
}

function reconcileAgentRuntimeStatuses(session) {
  if (!session?.agentRegistry) {
    return
  }

  const mainAgentId = session.mainAgentId || 'master'
  const activeAgentIds = session.activeAgentIds?.has ? session.activeAgentIds : new Set()

  for (const [agentId, entry] of session.agentRegistry) {
    if (agentId === mainAgentId || activeAgentIds.has(agentId)) {
      continue
    }
    if (entry?.status !== 'running' && entry?.status !== 'starting') {
      continue
    }

    entry.status = entry.agentKind === 'collaborative' && (entry.agentType === 'team' || entry.teamId)
      ? 'deleted'
      : 'interrupted'
  }
}

function getMessageTimestamp(message) {
  if (!message || typeof message !== 'object') {
    return null
  }

  const rawTimestamp = pickFirstDefined(
    message.timestamp,
    message.createdAt,
    message.created_at,
    message.startTime,
    message.start_time,
    message.ccgui?.orchestration?.timestamp
  )

  return toIsoTimestamp(rawTimestamp)
}

function getToolUseIdFromPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  return pickFirstDefined(
    payload.tool_use_id,
    payload.toolUseId,
    payload.request_id,
    payload.requestId,
    payload.id
  )
}

function getMessageToolUseId(message) {
  if (!message || typeof message !== 'object') {
    return null
  }

  return pickFirstDefined(
    message.tool_use_id,
    message.toolUseId,
    message.request_id,
    message.requestId,
    (message.role === 'tool_use' || message.role === 'diff') ? message.id : null
  )
}

function normalizeWorkspaceState(state, mainAgentId) {
  const activeAgentId = pickFirstDefined(state?.activeAgentId, mainAgentId)
  const focusedPaneAgentId = pickFirstDefined(state?.focusedPaneAgentId, activeAgentId, mainAgentId)
  const inputTargetAgentId = pickFirstDefined(state?.inputTargetAgentId, focusedPaneAgentId, activeAgentId, mainAgentId)

  return {
    activeAgentId,
    collaborativeViewMode: state?.collaborativeViewMode === 'split' ? 'split' : 'single',
    splitAgentIds: Array.isArray(state?.splitAgentIds) ? state.splitAgentIds.filter(Boolean) : [],
    focusedPaneAgentId,
    inputTargetAgentId
  }
}

function createMainAgentRegistryEntry(session) {
  const provider = session?.envInfo?.provider === 'codex' ? 'Codex' : 'Claude'

  return {
    agentId: session.mainAgentId,
    agentKind: 'collaborative',
    agentType: 'main',
    name: 'Master',
    title: `${provider} Master`,
    description: '当前主代理会话',
    prompt: null,
    model: session?.envInfo?.model || null,
    teamId: null,
    parentAgentId: null,
    status: 'running',
    canWrite: true,
    interactionMode: 'interactive',
    startTime: null,
    endTime: null,
    deleteTime: null
  }
}

function mergeAgentRegistryEntry(currentEntry, patch) {
  const normalizedPatch = normalizeAgentRegistryEntry(patch) || patch
  if (!normalizedPatch?.agentId) {
    return currentEntry || null
  }

  const nextName = pickSpecificCollaborativeValue(normalizedPatch.name, currentEntry?.name)
    ?? pickFirstDefined(normalizedPatch.name, currentEntry?.name)
  const nextTitle = pickSpecificCollaborativeValue(
    normalizedPatch.title,
    normalizedPatch.name,
    currentEntry?.title,
    currentEntry?.name
  ) ?? pickFirstDefined(
    normalizedPatch.title,
    normalizedPatch.name,
    currentEntry?.title,
    currentEntry?.name
  )
  const nextAgentType = pickSpecificCollaborativeValue(normalizedPatch.agentType, currentEntry?.agentType)
    ?? pickFirstDefined(normalizedPatch.agentType, currentEntry?.agentType)

  return {
    agentId: normalizedPatch.agentId,
    agentKind: pickFirstDefined(normalizedPatch.agentKind, currentEntry?.agentKind),
    agentType: nextAgentType,
    name: nextName,
    color: pickFirstDefined(normalizedPatch.color, currentEntry?.color),
    title: nextTitle,
    description: pickFirstDefined(normalizedPatch.description, normalizedPatch.prompt, currentEntry?.description, currentEntry?.prompt),
    prompt: pickFirstDefined(normalizedPatch.prompt, currentEntry?.prompt),
    model: pickFirstDefined(normalizedPatch.model, currentEntry?.model),
    teamId: pickFirstDefined(normalizedPatch.teamId, currentEntry?.teamId),
    parentAgentId: pickFirstDefined(normalizedPatch.parentAgentId, currentEntry?.parentAgentId),
    status: pickFirstDefined(normalizedPatch.status, currentEntry?.status),
    canWrite: pickFirstDefined(normalizedPatch.canWrite, currentEntry?.canWrite),
    interactionMode: pickFirstDefined(normalizedPatch.interactionMode, currentEntry?.interactionMode),
    startTime: pickFirstDefined(normalizedPatch.startTime, currentEntry?.startTime),
    endTime: pickFirstDefined(normalizedPatch.endTime, currentEntry?.endTime),
    deleteTime: pickFirstDefined(normalizedPatch.deleteTime, currentEntry?.deleteTime)
  }
}

function mergeRegistryEntryFromEvent(currentEntry, event) {
  const normalizedEvent = normalizeOrchestrationEntry(event)
  if (!normalizedEvent?.agentId) {
    return currentEntry || null
  }

  const timestamp = toIsoTimestamp(normalizedEvent.timestamp)
  const eventPatch = {
    agentId: normalizedEvent.agentId,
    agentKind: normalizedEvent.agentKind,
    agentType: normalizedEvent.agentKind === 'collaborative' &&
      !(normalizedEvent.eventType === 'start' && hasSpecificCollaborativeIdentityPayload(normalizedEvent))
      ? null
      : normalizedEvent.agentType,
    name: normalizedEvent.agentKind === 'collaborative' &&
      !(normalizedEvent.eventType === 'start' && hasSpecificCollaborativeIdentityPayload(normalizedEvent))
      ? null
      : normalizedEvent.name,
    title: normalizedEvent.agentKind === 'collaborative' &&
      !(normalizedEvent.eventType === 'start' && hasSpecificCollaborativeIdentityPayload(normalizedEvent))
      ? null
      : (normalizedEvent.title || normalizedEvent.name),
    description: normalizedEvent.agentKind === 'collaborative' &&
      !(normalizedEvent.eventType === 'start' && hasSpecificCollaborativeIdentityPayload(normalizedEvent))
      ? null
      : (normalizedEvent.description || normalizedEvent.prompt),
    color: normalizedEvent.agentKind === 'collaborative' &&
      !(normalizedEvent.eventType === 'start' && hasSpecificCollaborativeIdentityPayload(normalizedEvent))
      ? null
      : normalizedEvent.color,
    prompt: normalizedEvent.prompt,
    model: normalizedEvent.model,
    teamId: normalizedEvent.teamId,
    parentAgentId: normalizedEvent.parentAgentId,
    canWrite: normalizedEvent.canWrite,
    interactionMode: normalizedEvent.interactionMode
  }

  if (normalizedEvent.eventType === 'start') {
    eventPatch.status = normalizedEvent.status || 'running'
    eventPatch.startTime = timestamp
  } else if (normalizedEvent.eventType === 'end') {
    eventPatch.status = normalizedEvent.status || 'ended'
    eventPatch.endTime = timestamp
  } else if (normalizedEvent.eventType === 'delete') {
    eventPatch.status = 'deleted'
    eventPatch.deleteTime = timestamp
  }

  return mergeAgentRegistryEntry(currentEntry, eventPatch)
}

function sanitizeCollaborativeRegistryPatch(registryEntry, payload = {}, options = {}) {
  if (!registryEntry?.agentId) {
    return registryEntry
  }

  const orchestrationEntry = normalizeOrchestrationEntry(payload?.ccgui?.orchestration)
  const isCollaborative = registryEntry.agentKind === 'collaborative' || orchestrationEntry?.agentKind === 'collaborative'
  if (!isCollaborative) {
    return registryEntry
  }

  const allowIdentityUpdate =
    options?.sourceEventType === 'agent-update' ||
    (
      orchestrationEntry?.eventType === 'start' &&
      hasSpecificCollaborativeIdentityPayload(registryEntry, orchestrationEntry)
    )
  if (allowIdentityUpdate) {
    return registryEntry
  }

  return {
    ...registryEntry,
    agentType: null,
    name: null,
    title: null,
    description: null,
    color: null
  }
}

/**
 * SessionStore
 * 管理所有会话的状态
 */
export const useSessionStore = defineStore('session', () => {
  const SESSION_SCOPED_NOTIFICATION_TYPES = new Set([
    'runtime-exit',
    'runtime-stopped',
    'session-runtime-starting',
    'session-runtime-restarting',
    'session-runtime-ready',
    'session-config-applied',
    'session-effort-changed',
    'thread-event',
    'provider-deprecation',
    'provider-config-warning',
    'account-login-completed'
  ])

  function resolveNotificationScope(notificationType, data = {}, session = currentSession.value) {
    const type = notificationType || data?.type || ''
    const agentId = getMessageAgentId({ ccgui: data?.ccgui || null }, session)
    if (
      agentId &&
      agentId !== getMainAgentId(session) &&
      isMcpNotificationType(type)
    ) {
      return 'turn'
    }

    if (SESSION_SCOPED_NOTIFICATION_TYPES.has(type) || isMcpNotificationType(type)) {
      return 'session'
    }

    return 'turn'
  }

  // 所有会话的数据
  const sessions = ref(new Map())

  // 当前活跃的会话 ID
  const currentSessionId = ref(null)

  // 当前会话的计算属性
  const currentSession = computed(() => {
    if (!currentSessionId.value) return null
    return sessions.value.get(currentSessionId.value) || null
  })

  function getMainAgentId(session) {
    return session?.mainAgentId || 'master'
  }

  /**
   * 获取 session 的主 agent 队列（便捷方法）
   */
  function getMainQueue(session) {
    return session?.queueManager?.getOrCreateQueue(session.mainAgentId || 'master')
  }

  function getMessageAgentId(message, session = currentSession.value) {
    const mainAgentId = getMainAgentId(session)
    if (!message || !session) {
      return mainAgentId
    }

    const linkedToolUseId = getMessageToolUseId(message)
    if (linkedToolUseId && session.agentToolUseBindings?.has(linkedToolUseId)) {
      return session.agentToolUseBindings.get(linkedToolUseId)
    }

    const ccgui = message.ccgui || null
    const attribution = ccgui?.attribution || null
    const registry = ccgui?.registry || null
    const orchestration = ccgui?.orchestration || null

    return pickFirstDefined(
      attribution?.agentId,
      registry?.agentId,
      orchestration?.agentId,
      mainAgentId
    )
  }

  /**
   * 增量地将消息路由到对应 agent 的队列中
   * queue.append 通过全局索引自动去重。
   * 对于 tool_use / diff 消息，在 append 前设置 collapsed 默认值。
   */
  function addMessageToQueue(session, message) {
    if (!message?.id) {
      return
    }
    // 确保 tool_use / diff 消息默认折叠（覆盖历史恢复等未经过 handleMessageStart 的场景）
    if ((message.role === 'tool_use' || message.role === 'diff') && !message.manuallyExpanded && message.collapsed !== true) {
      message.collapsed = true
    }
    const queue = session.queueManager.routeToQueue(session, message)
    // 通过全局索引去重：如果已存在则跳过
    if (session.queueManager.findEntryGlobal(message.id)) {
      return
    }
    queue.append(message)
  }

  /**
   * 当 agentToolUseBindings 建立/变更后，将对应 tool_use 消息从旧队列移到新队列。
   * 通过全局索引查找 entry，跨队列移动。
   */
  /**
   * 获取用户消息对应的回答消息范围（在主队列 entries 中的索引范围）
   * 返回 { responseStart, responseEnd } 或 null
   */
  function getTurnResponseRange(messages, userMessageIndex) {
    const msg = messages[userMessageIndex]
    if (!msg || !isTurnInitiatorMessage(msg)) return null

    let responseStart = userMessageIndex + 1
    if (responseStart >= messages.length) return null
    if (isTurnInitiatorMessage(messages[responseStart])) return null

    let responseEnd = responseStart
    while (responseEnd < messages.length && !isTurnInitiatorMessage(messages[responseEnd])) {
      responseEnd++
    }
    return { responseStart, responseEnd }
  }

  /**
   * 释放超过保留数量的折叠问答。
   * 真正的消息与事件缓存由 unloadCollapsedTurns 统一跨进程卸载。
   */
  function releaseOldCollapsedTurns(session, keepRecentCount = 5) {
    void unloadCollapsedTurns(session, { keepRecentCount }).catch(error => {
      log('[SessionStore] Failed to release old collapsed turns:', error?.message || String(error))
    })
  }

  /**
   * 从主进程和渲染进程同时卸载已完成且已折叠的回答。
   * 用户消息保留为未加载的历史锚点，展开时通过 loadHistoryTurn 从磁盘恢复。
   */
  async function unloadCollapsedTurns(session, options = {}) {
    const mainQueue = session?.queueManager?.getQueue(session.mainAgentId)
    if (!mainQueue?.length) {
      return { unloadedCount: 0, skippedCount: 0 }
    }

    const keepRecentCount = Math.max(0, Number(options.keepRecentCount || 0))
    const entries = mainQueue.entries
    const userIndexes = []

    for (let index = 0; index < entries.length; index++) {
      if (isTurnInitiatorMessage(entries[index])) {
        userIndexes.push(index)
      }
    }

    const maxIndexToUnload = keepRecentCount > 0
      ? Math.max(0, userIndexes.length - keepRecentCount)
      : userIndexes.length
    const candidates = []

    for (let userIndex = 0; userIndex < maxIndexToUnload; userIndex++) {
      const messageIndex = userIndexes[userIndex]
      const userMessage = entries[messageIndex]
      if (!userMessage?.responseCollapsed) {
        continue
      }

      const range = getTurnResponseRange(entries, messageIndex)
      const hasCachedResponses = Boolean(userMessage._releasedResponses?.length)
      if (!range && !hasCachedResponses) {
        continue
      }

      if (range) {
        const responseEntries = entries.slice(range.responseStart, range.responseEnd)
        if (responseEntries.some(message => message?.isStreaming || message?.isExecuting)) {
          continue
        }
      }

      const turnId = userMessage.historyTurn?.turnId || userMessage.id
      if (turnId) {
        candidates.push({ turnId, userMessage })
      }
    }

    if (candidates.length === 0) {
      return { unloadedCount: 0, skippedCount: 0 }
    }

    if (!session.id || typeof window.electronAPI?.unloadSessionHistoryTurns !== 'function') {
      return { unloadedCount: 0, skippedCount: candidates.length, error: '历史卸载接口不可用' }
    }

    const result = await window.electronAPI.unloadSessionHistoryTurns({
      sessionId: session.id,
      turnIds: candidates.map(item => item.turnId)
    })
    if (!result?.success) {
      return {
        unloadedCount: 0,
        skippedCount: candidates.length,
        error: result?.error || '主进程卸载历史失败'
      }
    }

    const unloadedTurnIds = new Set(result.unloadedTurnIds || [])
    const releasedSubagentTurnIds = new Set(result.subagentTurnIds || [])
    const unloadedCandidates = candidates.filter(item => unloadedTurnIds.has(item.turnId))

    for (let index = unloadedCandidates.length - 1; index >= 0; index--) {
      const { turnId } = unloadedCandidates[index]
      const currentEntries = mainQueue.entries
      const anchorIndex = currentEntries.findIndex(message => message?.id === turnId)
      if (anchorIndex === -1) {
        continue
      }

      const range = getTurnResponseRange(currentEntries, anchorIndex)
      if (range) {
        mainQueue.splice(range.responseStart, range.responseEnd - range.responseStart)
      }

      const userMessage = mainQueue.entries[anchorIndex]
      if (!userMessage) {
        continue
      }
      userMessage._releasedResponses = null
      userMessage.historyTurn = {
        ...(userMessage.historyTurn || {}),
        turnId,
        status: userMessage.historyTurn?.status || 'completed',
        hasResponse: true,
        loaded: false,
        loading: false,
        error: null
      }
      userMessage.responseCollapsed = true
    }

    for (const history of session.subagentHistories || []) {
      for (const entry of history.entries || []) {
        if (!releasedSubagentTurnIds.has(entry.turnId)) {
          continue
        }
        entry.loaded = false
        delete entry.loadedEvents
      }
    }

    const sourceTurnIds = new Set(unloadedCandidates.map(item => item.turnId))
    const sourceFilter = message => {
      const sourceTurnId = message?.ccgui?.history?.sourceUserTurnId
        || (isTurnInitiatorMessage(message) ? message?.id : null)
      return !sourceTurnId || !sourceTurnIds.has(sourceTurnId)
    }
    session.silentMessages = (session.silentMessages || []).filter(sourceFilter)
    session.taskEvents = (session.taskEvents || []).filter(sourceFilter)
    for (const toolUseId of [...session.agentToolUseBindings.keys()]) {
      if (!session.queueManager.findEntryGlobal(toolUseId)) {
        session.agentToolUseBindings.delete(toolUseId)
      }
    }
    rebuildAgentSemanticState(session)

    return {
      unloadedCount: unloadedCandidates.length,
      skippedCount: candidates.length - unloadedCandidates.length + Number((result.skippedTurnIds || []).length || 0)
    }
  }

  /**
   * 恢复被释放的问答——将缓存的响应消息重新插入主队列
   */
  function restoreReleasedTurn(session, userMessage) {
    if (!userMessage?._releasedResponses || !session?.queueManager) return

    const mainQueue = session.queueManager.getQueue(session.mainAgentId)
    if (!mainQueue) return

    const userIdx = mainQueue.indexOfId(userMessage.id)
    if (userIdx === -1) return

    // 将缓存的响应消息重新插入到主队列（这些消息原本就在主队列中）
    const restoredMessages = userMessage._releasedResponses
    mainQueue.insertManyAt(userIdx + 1, restoredMessages)

    // 清除缓存
    userMessage._releasedResponses = null
  }

  function syncAgentWorkspaceState(session) {
    if (!session) {
      return
    }

    const mainAgentId = getMainAgentId(session)
    const validCollaborativeAgentIds = Array.from(session.agentRegistry.values())
      .filter(entry => entry?.agentKind === 'collaborative')
      .map(entry => entry.agentId)

    const preferredActiveAgentId = pickFirstDefined(
      session.agentWorkspaceState?.activeAgentId,
      mainAgentId
    )

    const activeAgentId = preferredActiveAgentId === mainAgentId
      ? mainAgentId
      : (validCollaborativeAgentIds.includes(preferredActiveAgentId) ? preferredActiveAgentId : mainAgentId)

    const sanitizedSplitAgentIds = Array.from(new Set(
      (Array.isArray(session.agentWorkspaceState?.splitAgentIds) ? session.agentWorkspaceState.splitAgentIds : [])
        .filter(agentId => validCollaborativeAgentIds.includes(agentId))
    )).slice(0, 2)

    let splitAgentIds = sanitizedSplitAgentIds
    if ((session.agentWorkspaceState?.collaborativeViewMode || 'single') === 'split') {
      if (splitAgentIds.length === 0) {
        splitAgentIds = [activeAgentId]
      }
      if (!splitAgentIds.includes(activeAgentId)) {
        splitAgentIds = [splitAgentIds[0], activeAgentId].filter(Boolean).slice(0, 2)
      }
      if (splitAgentIds.length === 1) {
        const fallbackSplitAgentId = validCollaborativeAgentIds.find(agentId => agentId !== splitAgentIds[0]) || null
        if (fallbackSplitAgentId) {
          splitAgentIds = [splitAgentIds[0], fallbackSplitAgentId]
        }
      }
    }

    const isSplitMode = (session.agentWorkspaceState?.collaborativeViewMode || 'single') === 'split'
    const focusCandidates = isSplitMode && splitAgentIds.length > 0
      ? splitAgentIds
      : [activeAgentId]

    const focusedPaneAgentId = focusCandidates.includes(session.agentWorkspaceState?.focusedPaneAgentId)
      ? session.agentWorkspaceState.focusedPaneAgentId
      : activeAgentId

    const inputTargetAgentId = focusCandidates.includes(session.agentWorkspaceState?.inputTargetAgentId)
      ? session.agentWorkspaceState.inputTargetAgentId
      : activeAgentId

    session.agentWorkspaceState = normalizeWorkspaceState({
      ...session.agentWorkspaceState,
      activeAgentId,
      splitAgentIds,
      focusedPaneAgentId,
      inputTargetAgentId
    }, mainAgentId)
  }

  function rebuildAgentSemanticState(session) {
    if (!session) {
      return
    }

    const mainAgentId = getMainAgentId(session)
    const nextRegistry = new Map(
      Array.from(session.agentRegistry.entries()).map(([agentId, entry]) => [
        agentId,
        mergeAgentRegistryEntry(null, entry)
      ])
    )
    const eventKeys = new Set()
    const supportedExecutionAgentIds = new Set()

    const recordEvent = (event) => {
      const normalizedEvent = normalizeOrchestrationEntry(event)
      if (!normalizedEvent?.agentId || !normalizedEvent?.eventType) {
        return
      }

      const dedupeKey = [
        normalizedEvent.eventType,
        normalizedEvent.agentId,
        normalizedEvent.timestamp || '',
        normalizedEvent.reason || '',
        normalizedEvent.status || ''
      ].join('::')

      if (eventKeys.has(dedupeKey)) {
        return
      }

      eventKeys.add(dedupeKey)
      supportedExecutionAgentIds.add(normalizedEvent.agentId)
      nextRegistry.set(
        normalizedEvent.agentId,
        mergeRegistryEntryFromEvent(nextRegistry.get(normalizedEvent.agentId), normalizedEvent)
      )
    }

    nextRegistry.set(mainAgentId, mergeAgentRegistryEntry(nextRegistry.get(mainAgentId), createMainAgentRegistryEntry(session)))

    // 从所有队列的 entries 中重建 registry（队列已包含正确路由的消息）
    for (const queue of session.queueManager.queues.values()) {
      for (const message of queue.entries) {
        const registryEntry = sanitizeCollaborativeRegistryPatch(
          normalizeAgentRegistryEntry(message?.ccgui?.registry),
          message
        )
        if (registryEntry?.agentId) {
          supportedExecutionAgentIds.add(registryEntry.agentId)
          nextRegistry.set(registryEntry.agentId, mergeAgentRegistryEntry(nextRegistry.get(registryEntry.agentId), registryEntry))
        } else if (!nextRegistry.has(queue.agentId)) {
          nextRegistry.set(queue.agentId, mergeAgentRegistryEntry(nextRegistry.get(queue.agentId), {
            agentId: queue.agentId,
            status: queue.agentId === mainAgentId ? 'running' : null
          }))
        }

        recordEvent(message?.ccgui?.orchestration)
      }
    }

    for (const silentMessage of session.silentMessages || []) {
      const registryEntry = sanitizeCollaborativeRegistryPatch(
        normalizeAgentRegistryEntry(silentMessage?.ccgui?.registry),
        silentMessage
      )
      if (registryEntry?.agentId) {
        supportedExecutionAgentIds.add(registryEntry.agentId)
        nextRegistry.set(registryEntry.agentId, mergeAgentRegistryEntry(nextRegistry.get(registryEntry.agentId), registryEntry))
      }
      recordEvent(silentMessage?.ccgui?.orchestration)
    }

    for (const taskEvent of session.taskEvents || []) {
      const registryEntry = sanitizeCollaborativeRegistryPatch(
        normalizeAgentRegistryEntry(taskEvent?.ccgui?.registry),
        taskEvent
      )
      if (registryEntry?.agentId) {
        supportedExecutionAgentIds.add(registryEntry.agentId)
        nextRegistry.set(registryEntry.agentId, mergeAgentRegistryEntry(nextRegistry.get(registryEntry.agentId), registryEntry))
      }
      recordEvent(taskEvent?.ccgui?.orchestration)
    }

    for (const subagentHistory of session.subagentHistories || []) {
      const agentId = subagentHistory?.agentId
      if (!agentId) {
        continue
      }

      session.queueManager.getOrCreateQueue(agentId)
      const historyStatus = resolveSubagentHistoryStatus(subagentHistory, session)
      nextRegistry.set(agentId, mergeAgentRegistryEntry(nextRegistry.get(agentId), {
        ...(subagentHistory?.registry || {}),
        agentId,
        agentKind: 'collaborative',
        ...(historyStatus ? { status: historyStatus } : {})
      }))

      for (const turn of subagentHistory.entries || []) {
        const anchorMessage = buildSubagentHistoryAnchor(turn, agentId, subagentHistory.registry || null)
        const queue = session.queueManager.getOrCreateQueue(agentId)
        if (!queue.findById(anchorMessage.id)) {
          queue.append(anchorMessage)
        }

        if (Array.isArray(turn.loadedEvents)) {
          for (const event of turn.loadedEvents) {
            const payload = event?.data
            if (!payload || typeof payload !== 'object') {
              continue
            }
            if (isTurnInitiatorMessage(payload) && payload.ccgui?.history?.subagentTurnId === turn.turnId) {
              continue
            }
            queue.append(payload)
          }
        }
      }
    }

    // 确保主 agent 队列存在
    session.queueManager.getOrCreateQueue(mainAgentId)

    // Execution agents should be reconstructed from concrete messages/task events.
    // If an old registry entry no longer has any supporting payload, it becomes a
    // ghost card that gets appended to the end of the timeline.
    for (const [agentId, entry] of nextRegistry.entries()) {
      if (entry?.agentKind !== 'execution') {
        continue
      }
      if (supportedExecutionAgentIds.has(agentId)) {
        continue
      }
      nextRegistry.delete(agentId)
      session.queueManager.deleteQueue(agentId)
    }

    session.agentRegistry = nextRegistry
    syncAgentWorkspaceState(session)
  }

  /**
   * 当首次发现 execution agent 时，搜索并绑定对应的父级 Agent tool_use 消息。
   * 场景：Agent tool_use 消息有时缺少 ccgui 数据（或缺少 agentKind），
   * 导致消息被放入主 agent 的队列。
   * 此函数通过以下策略定位并修复归类：
   * 1. 先尝试通过 ccgui 数据精确匹配
   * 2. 若无精确匹配，查找此 agent 队列中首条消息之前最近的未绑定 Agent tool_use
   */
  function ensureParentAgentToolUseBinding(session, agentId) {
    if (!session?.queueManager || !agentId) return

    // 策略 1：在所有队列中搜索带有 ccgui 精确指向此 agent 的 Agent tool_use
    // 只设置 binding，不移动消息——"Agent" tool_use 是父 agent 发起的调用，
    // 必须留在父 agent 的队列中，mainTimelineBlocks 才能在主队列里找到它并渲染 execution card
    for (const queue of session.queueManager.queues.values()) {
      for (let i = queue.length - 1; i >= 0; i--) {
        const msg = queue.entries[i]
        if (msg?.role !== 'tool_use' || msg?.toolName !== 'Agent') continue
        const msgAgentId = resolveAgentIdFromCcguiPayload(msg?.ccgui)
        if (msgAgentId === agentId) {
          const msgToolUseId = msg.id || msg.request_id
          if (msgToolUseId) {
            session.agentToolUseBindings.set(msgToolUseId, agentId)
            return
          }
        }
      }
    }

    // 策略 2：在主队列中找到此 agent 最早出现的 ccgui 消息，
    // 然后向前搜索最近的未绑定 Agent tool_use
    let earliestAnchorIndex = -1
    const mainQueue = session.queueManager.getQueue(session.mainAgentId)
    if (mainQueue) {
      for (let i = 0; i < mainQueue.length; i++) {
        const msg = mainQueue.entries[i]
        const msgAgentId = resolveAgentIdFromCcguiPayload(msg?.ccgui)
        if (msgAgentId === agentId) {
          earliestAnchorIndex = i
          break
        }
      }
    }

    if (earliestAnchorIndex <= 0) return

    // 向前搜索最近的未绑定 Agent tool_use
    if (mainQueue) {
      for (let i = earliestAnchorIndex - 1; i >= 0; i--) {
        const msg = mainQueue.entries[i]
        if (msg?.role !== 'tool_use' || msg?.toolName !== 'Agent') continue
        const msgToolUseId = msg.id || msg.request_id
        if (!msgToolUseId) continue
        // 跳过已绑定的（可能属于其他 subagent）
        if (session.agentToolUseBindings.has(msgToolUseId)) continue

        session.agentToolUseBindings.set(msgToolUseId, agentId)
        return
      }
    }
  }

  function recordAgentSemantics(session, payload = {}, options = {}) {
    if (!session || !payload || typeof payload !== 'object') {
      return
    }

    const registryEntry = sanitizeCollaborativeRegistryPatch(
      normalizeAgentRegistryEntry(payload?.ccgui?.registry),
      payload,
      options
    )
    if (registryEntry?.agentId) {
      session.agentRegistry.set(
        registryEntry.agentId,
        mergeAgentRegistryEntry(session.agentRegistry.get(registryEntry.agentId), registryEntry)
      )
    }

    const orchestrationEntry = normalizeOrchestrationEntry(payload?.ccgui?.orchestration)
    if (orchestrationEntry?.agentId) {
      session.agentRegistry.set(
        orchestrationEntry.agentId,
        mergeRegistryEntryFromEvent(session.agentRegistry.get(orchestrationEntry.agentId), orchestrationEntry)
      )
    }

    const semanticAgentId = pickFirstDefined(
      orchestrationEntry?.agentId,
      registryEntry?.agentId,
      payload?.ccgui?.attribution?.agentId
    )
    const semanticAgentKind = pickFirstDefined(
      orchestrationEntry?.agentKind,
      registryEntry?.agentKind,
      session.agentRegistry.get(semanticAgentId || '')?.agentKind
    )
    const semanticAgentType = pickFirstDefined(
      orchestrationEntry?.agentType,
      registryEntry?.agentType,
      session.agentRegistry.get(semanticAgentId || '')?.agentType
    )
    const toolUseId = getToolUseIdFromPayload(payload)
    if (toolUseId && semanticAgentId && semanticAgentKind === 'execution') {
      session.agentToolUseBindings.set(toolUseId, semanticAgentId)
      // 不移动消息——tool_use 消息必须留在发起调用的父 agent 队列中，
      // mainTimelineBlocks 通过 binding 查找对应的 execution card
    }

    // 当首次发现 execution agent 时，搜索并绑定对应的父级 Agent tool_use 消息
    // 有些情况下 Agent tool_use 消息本身没有 ccgui 数据或缺少 agentKind，
    // 导致它被归类到主 agent 的队列中。这里通过定位来解决。
    if (semanticAgentId && semanticAgentKind === 'execution') {
      ensureParentAgentToolUseBinding(session, semanticAgentId)
    }

    if (semanticAgentId && semanticAgentId !== getMainAgentId(session) && semanticAgentType !== 'team') {
      const status = pickFirstDefined(orchestrationEntry?.status, registryEntry?.status)
      const eventType = orchestrationEntry?.eventType
      if (
        eventType === 'end' ||
        eventType === 'delete' ||
        ['ended', 'failed', 'interrupted', 'deleted'].includes(status)
      ) {
        session.activeAgentIds.delete(semanticAgentId)
      } else if (
        eventType === 'start' ||
        status === 'starting' ||
        status === 'running'
      ) {
        session.activeAgentIds.add(semanticAgentId)
      }
    }

    syncAgentWorkspaceState(session)
  }

  // 当前会话的消息（便捷访问，来自主 agent 队列）
  const currentMessages = computed(() => {
    const session = currentSession.value
    return session?.queueManager?.getQueue(session.mainAgentId)?.entries || []
  })

  const currentMainAgentId = computed(() => getMainAgentId(currentSession.value))

  const currentAgentRegistry = computed(() => {
    return currentSession.value?.agentRegistry || new Map()
  })

  const currentAgentBuckets = computed(() => {
    return currentSession.value?.queueManager?.queues || new Map()
  })

  const currentAgentWorkspaceState = computed(() => {
    const session = currentSession.value
    return session?.agentWorkspaceState || normalizeWorkspaceState(null, getMainAgentId(session))
  })

  const executionAgentCards = computed(() => {
    const registryEntries = Array.from(currentAgentRegistry.value.values())
    const queues = currentAgentBuckets.value
    const session = currentSession.value
    const hasLiveRuntime = Boolean(session?.runtimeReady || session?.envInfo?.providerPid)

    // 通过 agentToolUseBindings 反查：哪些 tool_use_id 绑定到了哪个 subagent
    const bindingReverseMap = new Map()
    if (session?.agentToolUseBindings) {
      for (const [toolUseId, agentId] of session.agentToolUseBindings) {
        if (!bindingReverseMap.has(agentId)) {
          bindingReverseMap.set(agentId, toolUseId)
        }
      }
    }
    // 主 agent 队列，用于查找 "Agent" tool_use 消息
    const mainQueue = session?.queueManager?.getQueue(session.mainAgentId)

    return registryEntries
      .filter(entry => entry?.agentKind === 'execution')
      .map(entry => {
        const queue = queues.get(entry.agentId) || session?.queueManager?.getOrCreateQueue(entry.agentId)
        const items = queue?.entries || []
        // "Agent" tool_use 留在父 agent 队列中，通过 binding 反查找到它
        const boundToolUseId = bindingReverseMap.get(entry.agentId)
        const spawnRequest = boundToolUseId && mainQueue
          ? mainQueue.entries.find(m => (m.id === boundToolUseId || m.request_id === boundToolUseId) && m?.toolName === 'Agent')
          : null
        const latestTaskComplete = [...items].reverse().find(message => message?.role === 'task_complete')
        const displayTitle = pickExecutionAgentDisplayTitle(items, entry)
        const promptText = pickFirstDefined(
          spawnRequest?.toolInput?.prompt,
          spawnRequest?.toolInput?.task,
          spawnRequest?.toolInput?.instructions,
          spawnRequest?.toolInput?.description,
          entry.prompt
        )
        const toolCalls = items
          .filter(message => (message?.role === 'tool_use' || message?.role === 'diff') && message?.toolName !== 'Agent')
          .map(message => ({
            id: message.id || message.request_id || null,
            toolName: message.toolName || (message.role === 'diff' ? 'Diff' : 'Tool'),
            description: pickFirstDefined(
              message.toolInput?.description,
              message.toolInput?.command,
              message.toolInput?.file_path,
              message.toolInput?.path,
              message.result
            ),
            status: message.isExecuting ? 'running' : (message.isError ? 'error' : 'completed')
          }))
        const timelineItems = items.filter(message =>
          (message?.role === 'tool_use' || message?.role === 'diff') &&
          message?.toolName !== 'Agent'
        )
        const activeTimelineItems = timelineItems.filter(message => message?.isExecuting)
        const rawStatus = entry.status || 'ended'
        const isTerminalRawStatus = rawStatus === 'ended' || rawStatus === 'failed' || rawStatus === 'deleted'
        // 优先级：注册表已有终态 → 保留；task_complete 消息存在 → 已结束；无 runtime 且无活跃工具 → 中断；否则取注册表状态
        const resolvedStatus = isTerminalRawStatus
          ? rawStatus
          : latestTaskComplete
            ? 'ended'
            : (!hasLiveRuntime && (rawStatus === 'running' || rawStatus === 'starting') && activeTimelineItems.length === 0)
              ? 'interrupted'
              : rawStatus
        const completedToolCount = toolCalls.filter(toolCall => toolCall.status === 'completed').length
        const errorToolCount = toolCalls.filter(toolCall => toolCall.status === 'error').length
        const displayTimelineItems = activeTimelineItems.length
          ? activeTimelineItems
          : (timelineItems.length ? [timelineItems[timelineItems.length - 1]] : [])
        const latestResult = formatExecutionAgentResult(
          resolvedStatus === 'running' || resolvedStatus === 'starting'
            ? null
            : pickFirstDefined(
                spawnRequest?.result,
                latestTaskComplete?.summary,
                latestTaskComplete?.description,
                entry.summary,
                entry.description,
                resolvedStatus === 'interrupted'
                  ? '子代理在会话关闭时被中断，恢复历史后不会继续执行。'
                  : null
              )
        )
        const aggregatedUsage = aggregateExecutionAgentUsage(items, entry)
        const aggregatedDuration = aggregateExecutionAgentDuration(items, entry, resolvedStatus)

        return {
          agentId: entry.agentId,
          title: displayTitle,
          subtitle: entry.agentType || entry.model || null,
          status: resolvedStatus,
          summary: promptText || latestResult,
          promptText,
          latestResult,
          toolCalls,
          timelineItems,
          activeTimelineItems,
          displayTimelineItems,
          itemCount: items.length,
          toolCount: toolCalls.length,
          completedToolCount,
          errorToolCount,
          usage: aggregatedUsage,
          duration: aggregatedDuration,
          collapsed: true,
          items,
          bucket: queue,
          registry: entry
        }
      })
      .sort((left, right) => {
        const leftTime = left.bucket?.firstTimestamp || left.registry.startTime || ''
        const rightTime = right.bucket?.firstTimestamp || right.registry.startTime || ''
        return String(leftTime).localeCompare(String(rightTime))
      })
  })

  const collaborativeAgentSessions = computed(() => {
    const mainAgentId = currentMainAgentId.value
    const registryEntries = Array.from(currentAgentRegistry.value.values())
    const queues = currentAgentBuckets.value

    return registryEntries
      .filter(entry => entry?.agentKind === 'collaborative')
      .map(entry => {
        const queue = queues.get(entry.agentId) || currentSession.value?.queueManager?.getOrCreateQueue(entry.agentId)
        const display = inferCollaborativeDisplay(entry, mainAgentId)
        return {
          agentId: entry.agentId,
          title: display.title,
          subtitle: display.subtitle,
          color: entry.color || null,
          status: entry.agentId === mainAgentId
            ? (currentSession.value?.isProcessing ? 'running' : 'ended')
            : (entry.status || 'ended'),
          canInput: entry.status !== 'deleted' && entry.canWrite !== false && entry.interactionMode !== 'read-only',
          canWrite: entry.canWrite !== false,
          interactionMode: entry.interactionMode || null,
          messages: queue?.entries || [],
          bucket: queue,
          registry: entry,
          isMain: entry.agentId === mainAgentId
        }
      })
      .sort((left, right) => {
        if (left.isMain) return -1
        if (right.isMain) return 1
        const leftTime = left.bucket?.firstTimestamp || left.registry.startTime || ''
        const rightTime = right.bucket?.firstTimestamp || right.registry.startTime || ''
        return String(leftTime).localeCompare(String(rightTime))
      })
  })

  const agentWorkspaceAgents = computed(() => {
    const registryEntries = Array.from(currentAgentRegistry.value.values())
    const queues = currentAgentBuckets.value
    const mainAgentId = currentMainAgentId.value

    return registryEntries
      .filter(entry => entry?.agentId === mainAgentId || entry?.agentKind === 'collaborative')
      .map(entry => {
        const queue = queues.get(entry.agentId) || currentSession.value?.queueManager?.getOrCreateQueue(entry.agentId)
        const isMain = entry.agentId === mainAgentId
        const isCollaborative = entry.agentKind === 'collaborative'
        const display = inferCollaborativeDisplay(entry, mainAgentId)
        const displayAgentType = display.effectiveAgentType
        const resolvedStatus = isMain
          ? (currentSession.value?.isProcessing ? 'running' : 'ended')
          : (entry.status || 'ended')

        return {
          agentId: entry.agentId,
          agentKind: entry.agentKind || null,
          agentType: displayAgentType || null,
          teamId: entry.teamId || null,
          parentAgentId: entry.parentAgentId || null,
          title: display.title || (isMain ? 'Master' : 'Agent'),
          color: entry.color || null,
          subtitle: isMain
            ? '主代理'
            : (entry.agentKind === 'execution'
                ? (displayAgentType || '执行型代理')
                : (display.subtitle || '协作型代理')),
          status: resolvedStatus,
          isMain,
          isCollaborative,
          canActivate: isCollaborative,
          canWrite: entry.canWrite !== false,
          interactionMode: entry.interactionMode || null,
          messageCount: queue?.length || 0
        }
      })
      .sort((left, right) => {
        if (left.isMain) return -1
        if (right.isMain) return 1
        if (left.isCollaborative && !right.isCollaborative) return -1
        if (!left.isCollaborative && right.isCollaborative) return 1
        return left.title.localeCompare(right.title)
      })
  })

  const activeCollaborativeSession = computed(() => {
    const sessions = collaborativeAgentSessions.value
    const activeAgentId = currentAgentWorkspaceState.value.activeAgentId
    return sessions.find(entry => entry.agentId === activeAgentId) || sessions[0] || null
  })

  const splitCollaborativeSessions = computed(() => {
    const splitAgentIds = currentAgentWorkspaceState.value.splitAgentIds || []
    const sessionsById = new Map(collaborativeAgentSessions.value.map(entry => [entry.agentId, entry]))
    return splitAgentIds
      .map(agentId => sessionsById.get(agentId))
      .filter(Boolean)
  })

  const currentInputTargetAgent = computed(() => {
    const targetId = currentAgentWorkspaceState.value.inputTargetAgentId
    return collaborativeAgentSessions.value.find(entry => entry.agentId === targetId)
      || Array.from(currentAgentRegistry.value.values()).find(entry => entry.agentId === targetId)
      || null
  })

  // 当前会话是否正在处理
  const isProcessing = computed(() => {
    return currentSession.value?.isProcessing || false
  })

  // 是否有任何会话正在处理（实时检查 renderer 内存中的状态）
  const hasAnyProcessingSession = computed(() => {
    for (const session of sessions.value.values()) {
      if (session.isProcessing) return true
    }
    return false
  })

  // 当前会话的工具权限请求（队列中的第一个）
  const pendingPermission = computed(() => {
    const requests = currentSession.value?.pendingPermissions
    return (requests && requests.length > 0) ? requests[0] : null
  })

  // 当前会话的 AskUserQuestion 请求
  const pendingQuestion = computed(() => currentSession.value?.pendingQuestion || null)

  // 当前会话的控制请求（队列中的第一个）
  const pendingControlRequest = computed(() => {
    const requests = currentSession.value?.pendingControlRequests
    return (requests && requests.length > 0) ? requests[0] : null
  })

  // 当前会话的输入框内容
  const inputMessage = computed({
    get: () => currentSession.value?.inputMessage || '',
    set: (value) => {
      if (currentSession.value) {
        currentSession.value.inputMessage = value
      }
    }
  })

  const inputAttachments = computed({
    get: () => currentSession.value?.inputAttachments || [],
    set: (value) => {
      if (currentSession.value) {
        currentSession.value.inputAttachments = Array.isArray(value) ? value : []
      }
    }
  })

  // 事件取消订阅函数
  let eventUnsubscribe = null

  function shouldHydrateEnvInfo(session) {
    if (!session) {
      return false
    }

    const provider = session.envInfo?.provider
    if (provider && provider !== 'codex') {
      return false
    }

    return !session.envInfo?.rate_limits || !session.envInfo?.session_usage
  }

  function mergeSessionEnvInfo(session, envInfo) {
    if (!session || !envInfo || typeof envInfo !== 'object') {
      return
    }

    session.envInfo = {
      ...(session.envInfo || {}),
      ...envInfo
    }

    if (typeof envInfo.providerPid !== 'undefined') {
      session.runtimeReady = Boolean(envInfo.providerPid)
    }
  }

  async function hydrateSessionEnvInfo(sessionId) {
    const session = sessions.value.get(sessionId)
    if (!shouldHydrateEnvInfo(session)) {
      return
    }

    for (let attempt = 0; attempt < 4; attempt++) {
      const currentSession = sessions.value.get(sessionId)
      if (!shouldHydrateEnvInfo(currentSession)) {
        return
      }

      try {
        const runtimeEnvInfo = await window.electronAPI.getRuntimeInitInfo({ sessionId })
        if (runtimeEnvInfo?.provider || runtimeEnvInfo?.rate_limits || runtimeEnvInfo?.session_usage) {
          mergeSessionEnvInfo(currentSession, runtimeEnvInfo)
          if (!shouldHydrateEnvInfo(currentSession)) {
            return
          }
        }

        const latestState = await window.electronAPI.getSessionState({ sessionId })
        if (latestState?.envInfo) {
          mergeSessionEnvInfo(currentSession, latestState.envInfo)
          if (!shouldHydrateEnvInfo(currentSession)) {
            return
          }
        }
      } catch (error) {
        log('[SessionStore] Failed to hydrate env info:', { sessionId, attempt, error: error?.message || String(error) })
      }

      if (attempt < 3) {
        await sleep(350)
      }
    }
  }

  /**
   * 初始化会话
   */
  async function initSession(sessionId, projectPath) {
    log('[SessionStore] Initializing session:', sessionId)

    try {
      // 调用后端创建/获取 SessionInstance
      const result = await window.electronAPI.selectSession({
        sessionId,
        projectPath
      })

      if (!result.success) {
        console.error('[SessionStore] Failed to init session:', result.error)
        throw new Error(result.error)
      }

      // 创建前端 SessionData，使用 reactive 包装以支持响应式更新
      const sessionData = reactive(new SessionData(sessionId, projectPath))
      const eventLog = Array.isArray(result.state?.eventLog) ? result.state.eventLog : []
      sessionData.subagentHistories = Array.isArray(result.state?.subagentHistories)
        ? result.state.subagentHistories
        : []
      sessionData.activeAgentIds = new Set(
        Array.isArray(result.state?.activeAgentIds) ? result.state.activeAgentIds : []
      )

      // 先用后端快照恢复当前内存状态，eventLog 仅作为增量事件补放。
      const restoredState = result.state || {}
      const restoredMessages = (restoredState.messages || []).map(msg => reactive(msg))
      sessionData.queueManager.resetAll()
      for (const msg of restoredMessages) {
        const queue = sessionData.queueManager.routeToQueue(sessionData, msg)
        queue.append(msg)
      }
      sessionData.inputAttachments = restoredState.inputAttachments || []
      sessionData.inputHistory = restoredState.inputHistory || []
      sessionData.envInfo = restoredState.envInfo || null
      sessionData.silentMessages = (restoredState.silentMessages || []).map(msg => reactive(msg))
      sessionData.taskEvents = (restoredState.taskEvents || []).map(event => reactive(event))
      sessionData.runtimeReady = restoredState.runtimeReady || false
      if (restoredState.permissionMode) {
        sessionData.permissionMode = restoredState.permissionMode
      }
      if (restoredState.autoApprove !== undefined) {
        sessionData.autoApprove = restoredState.autoApprove
        try {
          const appStore = useAppStore()
          appStore.patchSessionStatus(sessionId, { autoApprove: restoredState.autoApprove })
        } catch (_) { /* ignore */ }
      }
      if (Array.isArray(restoredState.taskDockHistory)) {
        sessionData.taskDockHistory = restoredState.taskDockHistory
      }
      if (restoredState.pendingPermission) {
        sessionData.pendingPermissions = [reactive(restoredState.pendingPermission)]
      }

      // 先放进 Map，方便事件重放直接走统一 reducer
      sessions.value.set(sessionId, sessionData)

      if (eventLog.length > 0) {
        for (const event of eventLog) {
          handleSessionEvent(event)
        }
        sessionData.activeAgentIds = new Set(
          Array.isArray(restoredState.activeAgentIds) ? restoredState.activeAgentIds : []
        )
        sessionData.silentMessages = Array.from(new Map(
          sessionData.silentMessages.map(message => [message?.id || `${message?.messageType}:${message?.timestamp}`, message])
        ).values())
        sessionData.taskEvents = Array.from(new Map(
          sessionData.taskEvents.map(event => [event?.id || `${event?.type}:${event?.timestamp}`, event])
        ).values())
        rebuildAgentSemanticState(sessionData)
      } else {
        for (const silentMessage of sessionData.silentMessages) {
          recordAgentSemantics(sessionData, silentMessage)
        }

        for (const taskEvent of sessionData.taskEvents) {
          recordAgentSemantics(sessionData, taskEvent)
          handleTaskEvent(sessionData, taskEvent)
        }

        rebuildAgentSemanticState(sessionData)
      }

      // 清理历史重放后仍处于 running 状态的 task（会话中断时未收到完成通知）
      for (const [taskId, task] of sessionData.activeTasks) {
        if (task.status === 'running') {
          sessionData.activeTasks.delete(taskId)
        }
      }

      // 历史重放后，没有实时活跃证据的代理不能继续保持运行态。
      reconcileAgentRuntimeStatuses(sessionData)

      // 设置为当前会话
      currentSessionId.value = sessionId

      hydrateSessionEnvInfo(sessionId)

      log('[SessionStore] Session initialized:', sessionId)
      return sessionData
    } catch (error) {
      console.error('[SessionStore] Init session error:', error)
      throw error
    }
  }

  /**
   * 切换到指定会话
   */
  async function switchToSession(sessionId, projectPath) {
    const existingSession = sessions.value.get(sessionId)
    console.log('[SessionStore] Switching to session:', {
      sessionId,
      projectPath,
      sessionExists: !!existingSession,
      permissionMode: existingSession?.permissionMode
    })

    // 如果会话已存在，直接切换
    if (existingSession) {
      reconcileSubagentHistoryStatuses(existingSession)
      reconcileAgentRuntimeStatuses(existingSession)
      currentSessionId.value = sessionId
      hydrateSessionEnvInfo(sessionId)
      console.log('[SessionStore] Switched to existing session with permission mode:', existingSession.permissionMode)
      return existingSession
    }

    // 否则初始化新会话
    return initSession(sessionId, projectPath)
  }

  function setActiveAgent(agentId, options = {}) {
    const session = currentSession.value
    if (!session || !agentId) {
      return
    }

    const syncInputTarget = options.syncInputTarget !== false
    const nextState = normalizeWorkspaceState({
      ...session.agentWorkspaceState,
      activeAgentId: agentId,
      focusedPaneAgentId: options.syncFocus === false
        ? session.agentWorkspaceState.focusedPaneAgentId
        : agentId,
      inputTargetAgentId: syncInputTarget ? agentId : session.agentWorkspaceState.inputTargetAgentId
    }, getMainAgentId(session))

    session.agentWorkspaceState = nextState
    syncAgentWorkspaceState(session)
  }

  function setFocusedPaneAgentId(agentId, options = {}) {
    const session = currentSession.value
    if (!session || !agentId) {
      return
    }

    session.agentWorkspaceState = normalizeWorkspaceState({
      ...session.agentWorkspaceState,
      activeAgentId: agentId,
      focusedPaneAgentId: agentId,
      inputTargetAgentId: options.syncInputTarget === false
        ? session.agentWorkspaceState.inputTargetAgentId
        : agentId
    }, getMainAgentId(session))

    syncAgentWorkspaceState(session)
  }

  function setInputTargetAgentId(agentId) {
    const session = currentSession.value
    if (!session || !agentId) {
      return
    }

    session.agentWorkspaceState = normalizeWorkspaceState({
      ...session.agentWorkspaceState,
      inputTargetAgentId: agentId
    }, getMainAgentId(session))

    syncAgentWorkspaceState(session)
  }

  function setCollaborativeViewMode(mode) {
    const session = currentSession.value
    if (!session) {
      return
    }

    const nextMode = mode === 'split' ? 'split' : 'single'
    const activeAgentId = pickFirstDefined(
      session.agentWorkspaceState?.focusedPaneAgentId,
      session.agentWorkspaceState?.activeAgentId,
      getMainAgentId(session)
    )

    session.agentWorkspaceState = normalizeWorkspaceState({
      ...session.agentWorkspaceState,
      collaborativeViewMode: nextMode,
      splitAgentIds: nextMode === 'split'
        ? Array.from(new Set([
            ...(session.agentWorkspaceState?.splitAgentIds || []),
            activeAgentId
          ].filter(Boolean))).slice(0, 2)
        : session.agentWorkspaceState?.splitAgentIds || []
    }, getMainAgentId(session))

    syncAgentWorkspaceState(session)
  }

  function setSplitAgentIds(agentIds = []) {
    const session = currentSession.value
    if (!session) {
      return
    }

    session.agentWorkspaceState = normalizeWorkspaceState({
      ...session.agentWorkspaceState,
      splitAgentIds: Array.isArray(agentIds) ? agentIds.filter(Boolean) : []
    }, getMainAgentId(session))

    syncAgentWorkspaceState(session)
  }

  function replaceSplitPaneAgent(agentId, options = {}) {
    const session = currentSession.value
    if (!session || !agentId) {
      return
    }

    const currentSplitAgentIds = Array.isArray(session.agentWorkspaceState?.splitAgentIds)
      ? session.agentWorkspaceState.splitAgentIds.filter(Boolean)
      : []

    if (currentSplitAgentIds.includes(agentId)) {
      setFocusedPaneAgentId(agentId)
      return
    }

    let paneIndex = Number.isInteger(options.paneIndex) ? options.paneIndex : currentSplitAgentIds.indexOf(session.agentWorkspaceState?.focusedPaneAgentId)
    if (paneIndex < 0) {
      paneIndex = Math.min(currentSplitAgentIds.length, 1)
    }

    const nextSplitAgentIds = currentSplitAgentIds.slice(0, 2)
    if (nextSplitAgentIds.length === 0) {
      nextSplitAgentIds.push(agentId)
    } else if (paneIndex >= nextSplitAgentIds.length) {
      nextSplitAgentIds.push(agentId)
    } else {
      nextSplitAgentIds[paneIndex] = agentId
    }

    session.agentWorkspaceState = normalizeWorkspaceState({
      ...session.agentWorkspaceState,
      collaborativeViewMode: 'split',
      activeAgentId: agentId,
      splitAgentIds: Array.from(new Set(nextSplitAgentIds)).slice(0, 2),
      focusedPaneAgentId: agentId,
      inputTargetAgentId: agentId
    }, getMainAgentId(session))

    syncAgentWorkspaceState(session)
  }

  /**
   * 关闭会话
   */
  async function closeSession(sessionId) {
    try {
      await window.electronAPI.closeSession({ sessionId })
    } catch (e) {
      console.error('[SessionStore] Close session error:', e)
    }

    // 从 Map 中移除
    sessions.value.delete(sessionId)

    // 如果关闭的是当前会话，清除当前会话 ID
    if (currentSessionId.value === sessionId) {
      currentSessionId.value = null
    }
  }

  /**
   * 发送消息
   * 注意：不在这里添加消息，让后端统一管理并通过事件发送
   */
  async function sendMessage(content, options = {}) {
    const session = currentSession.value
    if (!session) {
      throw new Error('No active session')
    }

    const sessionId = session.id
    log('sendMessage input', {
      sessionId,
      content
    })
    let outgoingContent = normalizeOutgoingContent(content)
    log('sendMessage normalized outgoingContent', {
      sessionId,
      outgoingContent
    })
    const inputTargetAgentId = pickFirstDefined(
      session.agentWorkspaceState?.inputTargetAgentId,
      session.agentWorkspaceState?.activeAgentId,
      getMainAgentId(session)
    )
    const shouldAttachAgentAttribution = Boolean(
      inputTargetAgentId &&
      inputTargetAgentId !== getMainAgentId(session)
    )
    const inputTargetRegistry = inputTargetAgentId
      ? session.agentRegistry.get(inputTargetAgentId)
      : null
    if (inputTargetRegistry && (inputTargetRegistry.canWrite === false || inputTargetRegistry.interactionMode === 'read-only')) {
      throw new Error('当前协作型代理为只读模式，暂不支持直接发送消息')
    }

    if (shouldAttachAgentAttribution) {
      const nextCcgui = {
        attribution: {
          agentId: inputTargetAgentId,
          actorId: inputTargetAgentId
        }
      }

      if (typeof outgoingContent === 'string') {
        outgoingContent = {
          text: outgoingContent,
          attachments: [],
          ccgui: nextCcgui
        }
      } else if (outgoingContent && typeof outgoingContent === 'object') {
        outgoingContent = {
          ...outgoingContent,
          ccgui: {
            ...(outgoingContent.ccgui || {}),
            ...nextCcgui,
            attribution: {
              ...(outgoingContent.ccgui?.attribution || {}),
              ...nextCcgui.attribution
            }
          }
        }
      }
    }

    // 保存输入历史
    const historyText = typeof outgoingContent === 'string'
      ? outgoingContent
      : stripAttachmentTokens(outgoingContent?.text || '', outgoingContent?.attachments || [])

    if (historyText && (session.inputHistory.length === 0 || session.inputHistory[session.inputHistory.length - 1] !== historyText)) {
      session.inputHistory.push(historyText)
      if (session.inputHistory.length > 100) {
        session.inputHistory.shift()
      }
    }
    session.historyIndex = -1

    const wasProcessing = session.isProcessing
    if (!shouldAttachAgentAttribution) {
      session.isProcessing = true
    }
    session.currentTurnUsageSources = {}

    // 清理悬浮框中的任务（发起新提问时清理上一轮的任务）
    session.activeTasks.clear()
    log('[SessionStore] Cleared active tasks for new message')

    try {
      log('sendMessage ipc payload', {
        sessionId,
        content: outgoingContent
      })
      const result = await window.electronAPI.sendMessage({
        sessionId,
        content: outgoingContent,
      })

      if (!result?.success) {
        throw new Error(result?.error || '发送消息失败')
      }
    } catch (error) {
      session.isProcessing = wasProcessing
      throw error
    }
  }

  async function queryCommands(category = 'slash_command') {
    const session = currentSession.value
    if (!session) {
      throw new Error('No active session')
    }

    const result = await window.electronAPI.queryCommands({
      sessionId: session.id,
      category
    })

    if (!result?.success) {
      throw new Error(result?.error || '查询命令失败')
    }

    return result.data || { provider: session.provider || null, category, groups: [] }
  }

  async function queryAtReferences(forceRefresh = false) {
    const session = currentSession.value
    if (!session) {
      throw new Error('No active session')
    }

    const result = await window.electronAPI.queryAtReferences({
      sessionId: session.id,
      forceRefresh
    })

    if (!result?.success) {
      throw new Error(result?.error || '查询引用失败')
    }

    return result.data || { provider: session.provider || null, groups: [] }
  }

  async function runCommands(commands = []) {
    const session = currentSession.value
    if (!session) {
      throw new Error('No active session')
    }

    const normalizedCommands = Array.isArray(commands)
      ? commands.map(command => normalizeCommandForIpc(command)).filter(Boolean)
      : []
    if (!normalizedCommands.length) {
      return { success: true, executed: 0 }
    }

    session.isProcessing = true
    session.currentTurnUsageSources = {}
    session.activeTasks.clear()

    let result
    try {
      result = await window.electronAPI.runCommands({
        sessionId: session.id,
        commands: normalizedCommands
      })
    } catch (error) {
      session.isProcessing = false
      throw error
    }

    if (!result?.success) {
      session.isProcessing = false
      throw new Error(result?.error || '执行命令失败')
    }

    return result.data || { success: true, executed: 0 }
  }

  /**
   * 发送控制响应（权限批准/拒绝）
   */
  async function sendControlResponse(requestId, approved, options = {}) {
    const session = currentSession.value
    if (!session) return

    removePendingControlRequest(session, requestId)
    session.pendingQuestion = null

    await window.electronAPI.sendControlResponse({
      sessionId: session.id,
      requestId,
      approved,
      options
    })
  }

  /**
   * 发送工具结果（用于普通 tool_use 权限响应）
   */
  async function sendRuntimeToolResult(toolUseId, content, isError = false) {
    const session = currentSession.value
    if (!session) return

    removePendingPermission(session, toolUseId)

    await window.electronAPI.sendRuntimeToolResult({
      sessionId: session.id,
      toolUseId,
      content,
      isError
    })
  }

  /**
   * 发送中断请求
   */
  async function sendInterrupt() {
    const session = currentSession.value
    if (!session) return

    const result = await window.electronAPI.sendInterrupt({ sessionId: session.id })
    if (!result?.success) {
      throw new Error(result?.error || '中断请求失败')
    }
  }

  async function closeSubagentAgent(agentId) {
    const session = currentSession.value
    if (!session || !agentId) return

    const result = await window.electronAPI.closeSubagentAgent({
      sessionId: session.id,
      agentId
    })
    if (!result?.success) {
      throw new Error(result?.error || '关闭子代理失败')
    }
  }

  /**
   * 发送控制请求（主动请求，如切换权限模式、rewind）
   * @returns {Promise} 返回一个 Promise，在收到 control-response 时解析
   */
  async function sendControlRequest(request) {
    const session = currentSession.value
    if (!session) return

    // 创建一个 Promise 来等待响应
    const responsePromise = new Promise((resolve, reject) => {
      // 设置超时，避免永久等待
      const timeout = setTimeout(() => {
        session.pendingControlRequestResult = null
        reject(new Error('Control request timeout'))
      }, 30000) // 30 秒超时

      // 保存 resolve 和 reject 函数，在 handleControlResponse 中调用
      session.pendingControlRequestResult = {
        resolve: (data) => {
          clearTimeout(timeout)
          resolve(data)
        },
        reject: (error) => {
          clearTimeout(timeout)
          reject(error)
        }
      }
    })

    // 发送请求
    const invokeResult = await window.electronAPI.sendControlRequest({
      sessionId: session.id,
      request
    })

    if (invokeResult?.success === false) {
      session.pendingControlRequestResult = null
      throw new Error(invokeResult.error || 'Control request failed')
    }

    if (invokeResult?.response) {
      session.pendingControlRequestResult?.resolve(invokeResult.response)
      session.pendingControlRequestResult = null
      return invokeResult.response
    }

    // 返回 Promise，让调用者可以 await 响应
    return responsePromise
  }

  /**
   * 执行 MCP 操作（toggle / reconnect），复用已有的 sendControlRequest 通道
   */
  async function executeMcpAction(action, params = {}) {
    const session = currentSession.value
    if (!session) {
      log('[SessionStore] executeMcpAction: no active session')
      return null
    }

    const subtypeMap = { toggle: 'mcp_toggle', reconnect: 'mcp_reconnect' }
    const request = { subtype: subtypeMap[action], serverName: params.serverName }
    if (action === 'toggle') {
      request.enabled = params.enabled
    }

    log('[SessionStore] executeMcpAction', action, request)
    return sendControlRequest(request)
  }

  const currentMcpCapabilities = computed(() => {
    return currentSession.value?.envInfo?.mcp_capabilities || null
  })

  async function listSessionSubmodels(options = {}) {
    const session = currentSession.value
    if (!session) {
      throw new Error('No active session')
    }

    return window.electronAPI.listSessionSubmodels({
      sessionId: session.id,
      ...options
    })
  }

  async function getAvailableTargets(options = {}) {
    const session = currentSession.value
    if (!session) {
      throw new Error('No active session')
    }

    return window.electronAPI.getAvailableTargets({
      sessionId: session.id,
      ...options
    })
  }

  async function setSessionTarget(options = {}) {
    const session = currentSession.value
    if (!session) {
      throw new Error('No active session')
    }

    return window.electronAPI.setSessionTarget({
      sessionId: session.id,
      ...options
    })
  }

  async function setSessionSubmodel(options = {}) {
    const session = currentSession.value
    if (!session) {
      throw new Error('No active session')
    }

    return window.electronAPI.setSessionSubmodel({
      sessionId: session.id,
      ...options
    })
  }

  async function setSessionModel(options = {}) {
    const session = currentSession.value
    if (!session) {
      throw new Error('No active session')
    }

    return window.electronAPI.setSessionModel({
      sessionId: session.id,
      ...options
    })
  }

  async function listSessionEffortOptions(options = {}) {
    const session = currentSession.value
    if (!session) {
      throw new Error('No active session')
    }

    return window.electronAPI.listSessionEffortOptions({
      sessionId: session.id,
      ...options
    })
  }

  async function setSessionEffort(options = {}) {
    const session = currentSession.value
    if (!session) {
      throw new Error('No active session')
    }

    return window.electronAPI.setSessionEffort({
      sessionId: session.id,
      ...options
    })
  }

  /**
   * 运行时动态修改 maxThinkingTokens（不禁用思考，仅限运行时 control request）
   */
  async function setMaxThinkingTokens(value) {
    const session = currentSession.value
    if (!session) {
      throw new Error('No active session')
    }

    return window.electronAPI.setSessionMaxThinkingTokens({
      sessionId: session.id,
      value
    })
  }

  /**
   * 切换思考开关（持久化 thinkingEnabled + 运行时立即生效）
   */
  async function setThinkingEnabled(enabled) {
    const session = currentSession.value
    if (!session) {
      throw new Error('No active session')
    }

    return window.electronAPI.setSessionThinkingEnabled({
      sessionId: session.id,
      enabled
    })
  }

  /**
   * 设置权限模式
   */
  async function setPermissionMode(mode) {
    const session = currentSession.value
    if (!session) {
      console.log('[SessionStore] Cannot set permission mode: no current session')
      return
    }

    const previousMode = session.permissionMode
    // 立即更新前端的 session 对象
    session.permissionMode = mode
    console.log('[SessionStore] Setting permission mode:', {
      sessionId: session.id,
      previousMode,
      newMode: mode,
      modesEqual: previousMode === mode
    })

    try {
      // 调用后端保存
      const result = await window.electronAPI.setPermissionMode({
        sessionId: session.id,
        mode
      })

      if (result?.success === false) {
        console.error('[SessionStore] Failed to set permission mode:', result.error)
        // 恢复之前的模式
        session.permissionMode = previousMode
      } else {
        console.log('[SessionStore] Successfully set permission mode for session:', session.id)
      }
    } catch (error) {
      console.error('[SessionStore] Error setting permission mode:', error)
      // 恢复之前的模式
      session.permissionMode = previousMode
      throw error
    }
  }

  async function setAutoApprove(enabled) {
    const session = currentSession.value
    if (!session) {
      console.log('[SessionStore] Cannot set autoApprove: no current session')
      return
    }

    const previousValue = session.autoApprove
    session.autoApprove = !!enabled
    console.log('[SessionStore] Setting autoApprove:', {
      sessionId: session.id,
      previousValue,
      newValue: !!enabled
    })

    // 同步 autoApprove 状态到 useAppStore，以便后台权限请求时判断是否播放通知
    try {
      const appStore = useAppStore()
      appStore.patchSessionStatus(session.id, { autoApprove: !!enabled })
    } catch (_) { /* ignore */ }

    try {
      const result = await window.electronAPI.setAutoApprove({
        sessionId: session.id,
        enabled: !!enabled
      })

      if (result?.success === false) {
        console.error('[SessionStore] Failed to set autoApprove:', result.error)
        session.autoApprove = previousValue
        // 回滚 useAppStore 同步
        try {
          const appStore = useAppStore()
          appStore.patchSessionStatus(session.id, { autoApprove: previousValue })
        } catch (_) { /* ignore */ }
      } else {
        console.log('[SessionStore] Successfully set autoApprove for session:', session.id)
      }
    } catch (error) {
      console.error('[SessionStore] Error setting autoApprove:', error)
      session.autoApprove = previousValue
      // 回滚 useAppStore 同步
      try {
        const appStore = useAppStore()
        appStore.patchSessionStatus(session.id, { autoApprove: previousValue })
      } catch (_) { /* ignore */ }
      throw error
    }
  }

  function createHistoryReplaySession(baseSession) {
    const replaySession = new SessionData(baseSession.id, baseSession.projectPath)
    replaySession.mainAgentId = baseSession.mainAgentId
    replaySession.permissionMode = baseSession.permissionMode
    replaySession.autoApprove = baseSession.autoApprove
    replaySession.envInfo = baseSession.envInfo
    replaySession.isHistoryReplay = true
    return replaySession
  }

  function findHistoryAnchor(session, turnId, historyTurn = null) {
    const mainQueue = getMainQueue(session)
    const mainAnchorIndex = mainQueue ? mainQueue.entries.findIndex(message => message?.historyTurn?.turnId === turnId) : -1
    if (mainAnchorIndex !== -1) {
      return {
        scope: 'main',
        queue: mainQueue,
        index: mainAnchorIndex,
        message: mainQueue.entries[mainAnchorIndex]
      }
    }

    const targetAgentId = historyTurn?.agentId || null
    const queueCandidates = targetAgentId
      ? [session.queueManager.getQueue(targetAgentId)].filter(Boolean)
      : Array.from(session.queueManager.queues.values())

    for (const queue of queueCandidates) {
      const index = queue.entries.findIndex(message => message?.historyTurn?.turnId === turnId)
      if (index !== -1) {
        return {
          scope: 'subagent',
          queue,
          index,
          message: queue.entries[index]
        }
      }
    }

    return null
  }

  async function loadHistoryTurn(sessionId, turnId, historyTurn = null) {
    const session = sessions.value.get(sessionId)
    if (!session || !turnId) {
      return { success: false, error: 'Session or turn not found' }
    }

    const anchorRef = findHistoryAnchor(session, turnId, historyTurn)
    if (!anchorRef) {
      return { success: false, error: 'Turn anchor message not found' }
    }

    const anchorMessage = anchorRef.message
    if (anchorMessage?.historyTurn?.loaded) {
      return { success: true, cached: true }
    }
    if (anchorMessage?.historyTurn?.loading) {
      return { success: true, loading: true }
    }

    anchorMessage.historyTurn.loading = true
    anchorMessage.historyTurn.error = null

    try {
      const isSubagentTurn = anchorMessage?.historyTurn?.scope === 'subagent' && anchorMessage?.historyTurn?.agentId
      const result = isSubagentTurn
        ? await window.electronAPI.loadSubagentHistoryTurn({
            sessionId,
            agentId: anchorMessage.historyTurn.agentId,
            turnId
          })
        : await window.electronAPI.loadSessionHistoryTurn({
            sessionId,
            turnId
          })

      if (!result?.success) {
        throw new Error(result?.error || 'Failed to load history turn')
      }

      const turnEvents = Array.isArray(result.events) ? result.events : []
      let replayedUserMessage = null
      let insertedMessages = []

      if (isSubagentTurn) {
        insertedMessages = turnEvents
          .map(event => event?.data)
          .filter(message => message && typeof message === 'object')
          .filter(message => !(isTurnInitiatorMessage(message) && message.ccgui?.history?.subagentTurnId === turnId))
          .map(message => reactive(message))
      } else {
        const replaySession = createHistoryReplaySession(session)
        for (const event of turnEvents) {
          handleSessionEvent(event, replaySession)
        }

        const replayedMessages = (() => {
          const mainQ = getMainQueue(replaySession)
          return mainQ ? mainQ.entries : []
        })()
        const replayedUserIndex = replayedMessages.findIndex(message =>
          isTurnInitiatorMessage(message) && message?.id === anchorMessage.id
        )
        replayedUserMessage = replayedUserIndex >= 0 ? replayedMessages[replayedUserIndex] : null
        insertedMessages = replayedMessages
          .filter((message, index) => !(index === replayedUserIndex && isTurnInitiatorMessage(message)))
          .map(message => reactive(message))
      }

      const refreshedTurn = {
        ...(anchorMessage.historyTurn || {}),
        ...(result.turn || {}),
        turnId,
        loaded: true,
        loading: false,
        hasResponse: Boolean(result.turn?.hasAssistantResponse ?? anchorMessage.historyTurn?.hasResponse)
      }

      const mergedUserMessage = reactive({
        ...anchorMessage,
        ...(replayedUserMessage || {}),
        responseCollapsed: false,
        historyTurn: refreshedTurn
      })

      if (isSubagentTurn) {
        const queue = anchorRef.queue
        queue.splice(anchorRef.index, 1, mergedUserMessage, ...insertedMessages)
        const subagentEntry = (session.subagentHistories || [])
          .find(item => item?.agentId === anchorMessage.historyTurn.agentId)
        const turnEntry = subagentEntry?.entries?.find(entry => entry?.turnId === turnId)
        if (turnEntry) {
          turnEntry.loaded = true
          turnEntry.loadedEvents = turnEvents
        }
        rebuildAgentSemanticState(session)
      } else {
        const queue = anchorRef.queue
        queue.splice(anchorRef.index, 1, mergedUserMessage, ...insertedMessages)
        rebuildAgentSemanticState(session)
      }

      return { success: true, insertedCount: insertedMessages.length }
    } catch (error) {
      anchorMessage.historyTurn.loading = false
      anchorMessage.historyTurn.error = error.message
      return { success: false, error: error.message }
    }
  }

  /**
   * 处理从后端收到的事件
   */
  function handleSessionEvent(event, explicitSession = null) {
    const { sessionId, eventType, data } = event

    // 获取对应的会话
    const session = explicitSession || sessions.value.get(sessionId)
    if (!session) {
      log('[SessionStore] Event for unknown session:', sessionId)
      return
    }
  const eventTimestamp = event?.timestamp || data?.timestamp || null
  const isHistoryReplay = explicitSession?.isHistoryReplay === true

    // 根据事件类型处理
    switch (eventType) {
      case 'message':
        recordAgentSemantics(session, data)
      handleAddMessage(session, data, eventTimestamp, isHistoryReplay)
        // addMessageToQueue 兜底：handleAddMessage 对 tool_result/streaming 等场景走 early return
        // 不会 append，addMessageToQueue 通过全局索引去重确保不会重复插入
        addMessageToQueue(session, data)
        break

      case 'message-start':
        // 后端发送的消息创建事件
        recordAgentSemantics(session, data)
        handleMessageStart(session, data)
        // 同上兜底逻辑
        addMessageToQueue(session, data)
        break

      case 'message-delta':
        // 后端发送的增量更新事件
        handleMessageDelta(session, data)
        break

      case 'message-replace':
        recordAgentSemantics(session, data?.replacement || data)
        handleMessageReplace(session, data)
        break

      case 'message-snapshot':
        recordAgentSemantics(session, data?.message || data)
        handleMessageSnapshot(session, data)
        break

      case 'message-remove':
        if (data?.messageId) {
          const queue = session.queueManager.findQueueForEntry(data.messageId)
          queue?.removeById(data.messageId)
        }
        break

      case 'message-complete':
        // 后端发送的消息完成事件
        recordAgentSemantics(session, data?.updates || data)
        handleMessageComplete(session, data, eventTimestamp, isHistoryReplay)
        break

      case 'message-stop':
        // tool_use 输入流结束（仍在执行中）
        handleMessageStop(session, data)
        break

      case 'message-update':
        // 后端发送的字段更新事件
        recordAgentSemantics(session, data?.updates || data)
        handleMessageUpdate(session, data, eventTimestamp, isHistoryReplay)
        break

      case 'messages-reset':
        handleMessagesReset(session, data)
        break

      case 'tool-result':
        recordAgentSemantics(session, data)
        handleToolResult(session, data, eventTimestamp, isHistoryReplay)
        break

      case 'message-result':
        recordAgentSemantics(session, data)
        handleMessageResult(session, data, eventTimestamp, isHistoryReplay)
        break

      case 'result':
        handleResult(session, data, eventTimestamp, isHistoryReplay)
        break

      case 'control-request':
        recordAgentSemantics(session, data)
        handleControlRequest(session, data)
        break

      case 'control-response':
        handleControlResponse(session, data)
        break

      case 'interrupt':
        handleInterrupt(session, data)
        break

      case 'env-info':
        mergeSessionEnvInfo(session, data)
        session.runtimeReady = Boolean(session.envInfo?.providerPid)
        break

      case 'silent-message':
        recordAgentSemantics(session, data)
        {
          const escalatedNotification = getEscalatedSilentMessageNotification(data)
          if (escalatedNotification) {
            handleSystemNotification(session, escalatedNotification)
            break
          }
        }
        if (!isSilentMessageHandled(data)) {
          session.silentMessages.push(reactive(data))
          // 空内容的 silent-message 只记入沉没列表，不加入消息队列渲染
          if (hasMessageContent(data)) {
            addMessageToQueue(session, data)
          }
        }
        break

      case 'cli-status':
        // CLI 状态消息，显示在消息列表中
        log('[CLI Status]', data.message)
        handleCliStatus(session, data)
        break

      case 'state-update':
        handleStateUpdate(session, data)
        break

      case 'permission-mode-change':
        // Runtime 主动切换权限模式
        log('[SessionStore] Permission mode changed:', data)
        console.log('[SessionStore] Runtime setting permission mode to:', data, 'for session:', session.id)
        console.log('[SessionStore] Previous permission mode:', session.permissionMode)
        session.permissionMode = data
        console.log('[SessionStore] New permission mode:', session.permissionMode)
        break

      case 'fast-mode-change':
        // 快速模式状态变化
        log('[SessionStore] Fast mode state changed:', data)
        session.fastModeState = data
        break

      case 'system-notification':
        // 系统通知（权限模式切换、压缩边界等）
        log('[SessionStore] System notification:', data)
        recordAgentSemantics(session, data)
        handleSystemNotification(session, data)
        break

      case 'task-event':
        // 子任务事件（started/progress/notification）
        log('[SessionStore] Task event:', data)
        session.taskEvents.push(reactive(data))
        recordAgentSemantics(session, data)
        addMessageToQueue(session, data)
        handleTaskEvent(session, data)
        break

      case 'agent-update':
        log('[SessionStore] Agent update:', data)
        recordAgentSemantics(session, data, { sourceEventType: 'agent-update' })
        break

      case 'system-message':
        log('[SessionStore] System message:', data)
        handleResidualManagerEvent(session, data)
        break

      case 'unknown-message':
        log('[SessionStore] Unknown message:', data)
        handleResidualManagerEvent(session, data)
        break

      case 'abnormal-exit':
        // Runtime 进程异常退出
        log('[SessionStore] Runtime process abnormal exit:', data)
        handleAbnormalExit(session, data)
        break

      case 'normal-exit':
        // Runtime 进程正常停止（用户手动停止）
        log('[SessionStore] Runtime process normal exit:', data)
        handleNormalExit(session, data)
        break

      default:
        log('[SessionStore] Unknown event type:', eventType)
    }

    if ([
      'messages-reset',
      'result',
      'abnormal-exit',
      'normal-exit'
    ].includes(eventType)) {
      rebuildAgentSemanticState(session)
    }
  }

  /**
   * 添加消息
   * 注意：对于 assistant 消息，需要检查是否已有流式创建的消息
   */
  function handleAddMessage(session, message, eventTimestamp = null, isHistoryReplay = false) {
    const queue = session.queueManager.routeToQueue(session, message)

    if (message?.id) {
      const existing = queue.findById(message.id)
      if (existing) {
        Object.assign(existing, message)
        return
      }
    }

    // 如果是 assistant 消息，检查是否已有流式创建的消息
    if (message.role === 'assistant') {
      // 查找是否有正在流式传输的 assistant 消息
      const streamingMsg = queue.findLatest(m =>
        m.role === 'assistant' && (m.isStreaming || m.id === session.currentStreamingAssistantId)
      )

      if (streamingMsg) {
        // 更新现有消息而不是添加新消息
        streamingMsg.content = message.content || streamingMsg.content
        streamingMsg.isStreaming = false
        if (message.rawMessage) {
          streamingMsg.rawMessage = message.rawMessage
        }
        return
      }

      // 处理 tool_result 之后的 assistant 消息（ID 不匹配的情况）
      // 查找是否有刚完成 tool_use 的 assistant 消息（isStreaming 已设置为 false 但没有 content）
      const justFinished = queue.findLatest(m =>
        m.role === 'assistant' && m.content === '' && !m.isStreaming
      )
      if (justFinished) {
        justFinished.content = message.content || justFinished.content
        justFinished.isStreaming = false
        if (message.rawMessage) {
          justFinished.rawMessage = message.rawMessage
        }
        log('[SessionStore] handleAddMessage: updated assistant message after tool_result')
        return
      }
    }

    // 处理 tool_result 消息：更新对应的 tool_use 消息而不是添加新消息
    if (message.role === 'user' && Array.isArray(message.content)) {
      const toolResultContent = message.content.find(c => c.type === 'tool_result')
      if (toolResultContent) {
        const toolUseId = toolResultContent.tool_use_id
        log('[SessionStore] handleAddMessage: found tool_result for tool_use_id:', toolUseId)

        // 查找对应的 tool_use 消息并更新结果（跨队列搜索）
        const toolUseRef = session.queueManager.findToolUseGlobal(toolUseId)
        if (toolUseRef) {
          const msg = toolUseRef.entry
          msg.isExecuting = false
          msg.isError = toolResultContent.is_error
          msg.result = toolResultContent.content || '(无输出)'
          applyMessageDuration(
            msg,
            eventTimestamp || message.timestamp || (isHistoryReplay ? null : Date.now())
          )
          log('[SessionStore] handleAddMessage: updated tool_use message result')
          return // 不添加新消息
        }
      }
    }

    // 使用 queue.append 追加消息（自动包装 reactive）
    queue.append(message)
  }

  function handleMessagesReset(session, data) {
    const nextMessages = Array.isArray(data?.messages) ? data.messages : []
    session.queueManager.resetAll()
    for (const msg of nextMessages) {
      const queue = session.queueManager.routeToQueue(session, msg)
      queue.append(msg)
    }
    session.currentAssistantMessageIndex = -1
    session.currentStreamingAssistantId = null
    session.currentContentBlockType = null
    session.hasSeenToolUseInCurrentTurn = false
  }

  /**
   * 处理 result（包含 usage 信息）
   */
  function handleResult(session, result, eventTimestamp = null, isHistoryReplay = false) {
    log('[SessionStore] handleResult called')
    log('[SessionStore] Full result object:', JSON.stringify(result, null, 2))

    const mainQueue = getMainQueue(session)

    // 移除 status 消息（如"正在启动运行时..."）—— status 消息在主队列
    const statusEntry = mainQueue ? mainQueue.findLatestByRole('status') : null
    if (statusEntry) {
      mainQueue.removeById(statusEntry.id)
    }

    // 清除流式消息标记
    session.currentStreamingAssistantId = null
    session.pendingQuestion = null
    session.pendingPermissions = []
    session.pendingControlRequests = []

    // 主代理 result 只收尾主代理消息；子代理可能仍在独立线程中运行
    if (mainQueue) {
      for (const msg of mainQueue.entries) {
        if (msg.isStreaming) {
          msg.isStreaming = false
          applyMessageDuration(
            msg,
            eventTimestamp || result.timestamp || (isHistoryReplay ? null : Date.now())
          )
        }

        if (msg.isExecuting) {
          msg.isExecuting = false
          applyMessageDuration(
            msg,
            eventTimestamp || result.timestamp || (isHistoryReplay ? null : Date.now())
          )
        }
      }
    }

    // result 只描述主代理本轮，统计不能取到子代理的消息
    const mainEntries = mainQueue?.entries || []
    const latestUserMessage = [...mainEntries].reverse().find(msg => isTurnInitiatorMessage(msg)) || null
    const latestAssistantMessage = [...mainEntries].reverse().find(msg =>
      msg.role === 'assistant' && ((msg.content && msg.content.trim()) || (msg.thinking && msg.thinking.trim()))
    ) || [...mainEntries].reverse().find(msg => msg.role === 'assistant') || null

    const fallbackResultDuration = latestUserMessage?.startTime
      ? (
          eventTimestamp || result.timestamp
            ? toTimestampMs(eventTimestamp || result.timestamp) - toTimestampMs(latestUserMessage.startTime)
            : (isHistoryReplay ? null : Date.now() - toTimestampMs(latestUserMessage.startTime))
        )
      : null
    const durationMs =
      result.duration_ms ??
      latestUserMessage?.duration ??
      (Number.isFinite(fallbackResultDuration) ? Math.max(0, fallbackResultDuration) : null)

    const numTurns =
      result.num_turns ??
      latestUserMessage?.numTurns ??
      1

    if (latestUserMessage) {
      clearUserUsageSourcesByPrefix(session, 'main:', latestUserMessage)
      setUserUsageSource(session, 'main:result', result.usage)
    }

    const usage =
      latestUserMessage?.usage ??
      normalizeTokenUsage(result.usage) ??
      null

    log('[SessionStore] Extracted: durationMs=', durationMs, 'numTurns=', numTurns, 'usage=', usage)

    // 更新最后一个用户消息的统计信息
    if (mainQueue) {
      for (let i = mainQueue.length - 1; i >= 0; i--) {
        if (isTurnInitiatorMessage(mainQueue.entries[i])) {
          const userMsg = mainQueue.entries[i]
          log('[SessionStore] Found user message at index', i, 'startTime:', userMsg.startTime)

          // 使用 Object.assign 确保响应式更新
          Object.assign(userMsg, {
            duration: durationMs,
            numTurns: numTurns,
            usage: usage
          })

          log('[SessionStore] Updated user message:', JSON.stringify({
            duration: userMsg.duration,
            numTurns: userMsg.numTurns,
            usage: userMsg.usage
          }))
          break
        }
      }
    }

    // 更新最后一个 assistant 消息的统计信息
    if (mainQueue) {
      for (let i = mainQueue.length - 1; i >= 0; i--) {
        if (mainQueue.entries[i].role === 'assistant') {
          const assistantMsg = mainQueue.entries[i]
          log('[SessionStore] Found assistant message at index', i)

          const updates = {
            isStreaming: false
          }
          if (durationMs !== null && durationMs !== undefined) {
            updates.duration = durationMs
          }

          Object.assign(assistantMsg, updates)

          log('[SessionStore] Updated assistant message:', JSON.stringify({
            duration: assistantMsg.duration,
            usage: assistantMsg.usage
          }))
          break
        }
      }
    }

    // 解锁输入
    session.isProcessing = false

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ccgui-session-complete', {
        detail: {
          sessionId: session.id,
          timestamp: Date.now()
        }
      }))
    }
  }

  function getLatestUserMessage(session) {
    const mainQueue = getMainQueue(session)
    if (!mainQueue) return null
    for (let i = mainQueue.length - 1; i >= 0; i--) {
      if (isTurnInitiatorMessage(mainQueue.entries[i])) {
        return mainQueue.entries[i]
      }
    }
    return null
  }

  function getCurrentTurnUsageSources(session) {
    if (!session) {
      return null
    }
    if (!session.currentTurnUsageSources || typeof session.currentTurnUsageSources !== 'object') {
      session.currentTurnUsageSources = {}
    }
    return session.currentTurnUsageSources
  }

  function syncUserUsageFromSources(session, userMsg = getLatestUserMessage(session)) {
    if (!userMsg) {
      return
    }

    const usageSources = getCurrentTurnUsageSources(session)
    const nextUsage = sumTokenUsages(Object.values(usageSources))
    userMsg.usage = nextUsage
  }

  function setUserUsageSource(session, sourceKey, usage) {
    const userMsg = getLatestUserMessage(session)
    if (!userMsg || !sourceKey) {
      return
    }

    const usageSources = getCurrentTurnUsageSources(session)
    const normalizedUsage = normalizeTokenUsage(usage)

    if (normalizedUsage) {
      usageSources[sourceKey] = normalizedUsage
    } else {
      delete usageSources[sourceKey]
    }

    syncUserUsageFromSources(session, userMsg)
  }

  function clearUserUsageSourcesByPrefix(session, prefix, userMsg = getLatestUserMessage(session)) {
    if (!userMsg || !prefix) {
      return
    }

    const usageSources = getCurrentTurnUsageSources(session)
    for (const key of Object.keys(usageSources)) {
      if (key.startsWith(prefix)) {
        delete usageSources[key]
      }
    }

    syncUserUsageFromSources(session, userMsg)
  }

  function syncUserRealtimeStats(session, updates = {}) {
    const userMsg = getLatestUserMessage(session)
    if (!userMsg) return

    const nextStats = {}

    if (updates.turnNumber !== undefined && updates.turnNumber !== null) {
      nextStats.numTurns = updates.turnNumber
    }

    if (updates.usage !== undefined && updates.usage !== null) {
      const usageSourceKey = updates.usageSourceKey || 'main'
      setUserUsageSource(session, usageSourceKey, updates.usage)
    }

    if (Object.keys(nextStats).length > 0) {
      Object.assign(userMsg, nextStats)
    }
  }

  /**
   * 处理消息创建事件（来自后端）
   */
  function handleMessageStart(session, message) {
    log('[SessionStore] handleMessageStart:', message.role, message.subtype, message.id)

    // 直接使用原始 message 对象
    const nextMessage = message
    const isMainAgentMessage = getMessageAgentId(nextMessage, session) === getMainAgentId(session)

    if ((nextMessage.role === 'tool_use' || nextMessage.role === 'diff') && !nextMessage.manuallyExpanded) {
      nextMessage.collapsed = true
    }

    const queue = session.queueManager.routeToQueue(session, nextMessage)

    const existing = queue.findById(nextMessage.id)
    if (existing) {
      const mergedToolInput = nextMessage.toolInput && typeof nextMessage.toolInput === 'object'
        ? {
            ...(existing.toolInput || {}),
            ...nextMessage.toolInput
          }
        : existing.toolInput
      Object.assign(existing, {
        ...nextMessage,
        ...(mergedToolInput ? { toolInput: mergedToolInput } : {}),
        content: existing.content || nextMessage.content || '',
        thinking: existing.thinking || nextMessage.thinking || '',
        hasThinking: existing.hasThinking || nextMessage.hasThinking || false
      })

      if (isMainAgentMessage) {
        session.currentStreamingAssistantId = nextMessage.id
      }
      if (nextMessage.role === 'assistant' && isMainAgentMessage) {
        syncUserRealtimeStats(session, {
          turnNumber: nextMessage.turnNumber,
          usage: nextMessage.usage,
          usageSourceKey: `main:${nextMessage.id}`
        })
      }
      log('[SessionStore] handleMessageStart: reused existing message', nextMessage.id)
      return
    }

    // 所有角色都直接添加
    queue.append(nextMessage)
    if (isMainAgentMessage) {
      session.currentStreamingAssistantId = nextMessage.id
    }

    if (nextMessage.role === 'tool_use' || nextMessage.role === 'diff') {
      if (typeof nextMessage.request_id === 'number') {
        session.contentBlockIndexToId.set(nextMessage.request_id, nextMessage.id)
      }
    }
  }

  /**
   * 处理消息增量更新（来自后端）
   */
  function handleMessageDelta(session, data) {
    const { messageId, field, delta } = data

    // 查找对应的消息（跨队列）
    const msg = session.queueManager.findEntryGlobal(messageId)
    if (!msg) {
      log('[SessionStore] handleMessageDelta: message not found', messageId)
      return
    }

    // 根据字段类型增量更新
    if (field === 'content') {
      msg.content = (msg.content || '') + delta
    } else if (field === 'thinking') {
      msg.thinking = (msg.thinking || '') + delta
      msg.hasThinking = true
    } else if (field === 'result') {
      msg.result = (msg.result || '') + delta
    }

    log('[SessionStore] handleMessageDelta:', field, 'delta length:', delta.length)
  }

  function handleMessageReplace(session, data) {
    const { messageId, replacement } = data || {}
    if (!messageId || !replacement || typeof replacement !== 'object') {
      return
    }

    const msg = session.queueManager.findEntryGlobal(messageId)
    if (!msg) {
      log('[SessionStore] handleMessageReplace: message not found', messageId)
      return
    }

    const nextReplacement = {
      ...replacement
    }
    Object.assign(msg, nextReplacement)
    if (typeof nextReplacement.thinking === 'string') {
      msg.hasThinking = Boolean(nextReplacement.thinking)
    }

    log('[SessionStore] handleMessageReplace:', messageId, 'fields:', Object.keys(nextReplacement))
  }

  function handleMessageSnapshot(session, data) {
    const snapshot = data?.message
    if (!snapshot?.id) {
      return
    }

    const existing = session.queueManager.findEntryGlobal(snapshot.id)
    if (!existing) {
      handleMessageStart(session, snapshot)
      return
    }

    const uiState = {}
    for (const field of [
      '_releasedResponses',
      'collapsed',
      'historyTurn',
      'manuallyExpanded',
      'responseCollapsed',
      'thinkingCollapsed'
    ]) {
      if (Object.prototype.hasOwnProperty.call(existing, field)) {
        uiState[field] = existing[field]
      }
    }

    const nextSnapshot = {
      ...snapshot,
      ...(existing.ccgui || snapshot.ccgui
        ? {
            ccgui: {
              ...(existing.ccgui || {}),
              ...(snapshot.ccgui || {}),
              history: snapshot.ccgui?.history || existing.ccgui?.history
            }
          }
        : {})
    }
    Object.assign(existing, nextSnapshot, uiState)
    if (existing.isStreaming === false && session.currentStreamingAssistantId === existing.id) {
      session.currentStreamingAssistantId = null
    }
    log('[SessionStore] handleMessageSnapshot:', snapshot.id, data?.reason || '')
  }

  /**
   * 处理消息完成事件（来自后端）
   */
  function handleMessageComplete(session, data, eventTimestamp = null, isHistoryReplay = false) {
    const { messageId, updates } = data

    // 查找对应的消息（跨队列）
    const msg = session.queueManager.findEntryGlobal(messageId)
    if (!msg) {
      log('[SessionStore] handleMessageComplete: message not found', messageId)
      return
    }

    // 应用更新
    Object.assign(msg, updates)
    applyMessageDuration(
      msg,
      eventTimestamp || data?.timestamp || (isHistoryReplay ? null : Date.now())
    )

    // 只清除主代理的流式标记，避免子代理完成事件覆盖主代理状态
    if (session.currentStreamingAssistantId === messageId) {
      session.currentStreamingAssistantId = null
    }

    log('[SessionStore] handleMessageComplete:', messageId)
  }

  /**
   * 处理 message-stop（tool_use 输入流结束，仍在执行中）
   * 将 isStreaming 设为 false，但保留 isExecuting
   */
  function handleMessageStop(session, data) {
    const messageId = data?.messageId
    if (!messageId) return

    const msg = session.queueManager.findEntryGlobal(messageId)
    if (msg) {
      msg.isStreaming = false
    }
  }

  /**
   * 处理消息字段更新（来自后端）
   */
  function handleMessageUpdate(session, data, eventTimestamp = null, isHistoryReplay = false) {
    const messageId = data?.messageId
    const updates = data?.updates || {}
    const canonical = data?.canonical === true


    // 查找对应的消息（跨队列）
    const msg = session.queueManager.findEntryGlobal(messageId)
    if (!msg) {
      log('[SessionStore] handleMessageUpdate: message not found', messageId)
      return
    }

    // 后端已完成权威状态合并，前端只应用对应 messageId 的规范更新。
    const normalizedUpdates = {
      ...updates,
      ...(!canonical && updates.toolInput && typeof updates.toolInput === 'object'
        ? {
            toolInput: {
              ...(msg.toolInput || {}),
              ...updates.toolInput
            }
          }
        : {}),
      ...(msg.ccgui || updates.ccgui
        ? {
            ccgui: {
              ...(msg.ccgui || {}),
              ...(updates.ccgui || {}),
              history: updates.ccgui?.history || msg.ccgui?.history
            }
          }
        : {})
    }
    Object.assign(msg, normalizedUpdates)
    if (updates.isStreaming === false || updates.isExecuting === false) {
      applyMessageDuration(
        msg,
        eventTimestamp || data?.timestamp || (isHistoryReplay ? null : Date.now())
      )
    }

    if (msg.role === 'assistant') {
      syncUserRealtimeStats(session, {
        turnNumber: updates.turnNumber ?? msg.turnNumber,
        usage: updates.usage ?? msg.usage,
        usageSourceKey: `main:${msg.id}`
      })
    }
    if (msg.role === 'tool_use' && msg.toolName === 'Agent' && normalizedUpdates.usage) {
      setUserUsageSource(session, `execution:${msg.id}`, normalizedUpdates.usage)
    }

    log('[SessionStore] handleMessageUpdate:', messageId, 'updates:', Object.keys(normalizedUpdates))

    // 处理 TodoWrite 工具：显示在悬浮窗中
    if (msg.role === 'tool_use' && msg.toolName === 'TodoWrite' && normalizedUpdates.toolInput?.todos) {
      log('[SessionStore] TodoWrite detected in handleMessageUpdate:', {
        toolUseId: messageId,
        todosCount: normalizedUpdates.toolInput.todos.length
      })
      handleTodoWrite(session, messageId, normalizedUpdates.toolInput.todos)
    }
  }

  function handleToolResult(session, data, eventTimestamp = null, isHistoryReplay = false) {
    const toolUseId = data?.toolUseId
    if (!toolUseId) return

    // 先搜索 question 消息
    for (const queue of session.queueManager.queues.values()) {
      const questionEntry = queue.findLatest(m => m.role === 'question' && m.tool_use_id === toolUseId)
      if (questionEntry) {
        questionEntry.resultReceived = true
        questionEntry.receivedAnswers = data.answers || null
        questionEntry.answersConsistent = data.answers ? compareAnswers(questionEntry.userAnswers, data.answers) : true
        return
      }
    }

    // 搜索 tool_use / diff 消息
    const toolUseRef = session.queueManager.findToolUseGlobal(toolUseId)
    if (toolUseRef) {
      const msg = toolUseRef.entry
      msg.isExecuting = false
      msg.isError = !!data.isError
      msg.result = data.content || '(无输出)'
      if (data.usage) {
        msg.usage = data.usage
      }
      applyMessageDuration(
        msg,
        eventTimestamp || data?.timestamp || (isHistoryReplay ? null : Date.now())
      )
      if (msg.role === 'tool_use' && msg.toolName === 'Agent') {
        setUserUsageSource(session, `execution:${toolUseId}`, data.usage)
      }
    }
  }

  /**
   * 兼容旧历史中的 message-result 事件。
   * 新事件由后端归一成 message-update / message-snapshot。
   */
  function handleMessageResult(session, data, eventTimestamp = null, isHistoryReplay = false) {
    const messageId = data?.messageId
    if (!messageId) return

    // 处理 AskUserQuestion 响应
    if (data.answers) {
      for (const queue of session.queueManager.queues.values()) {
        const questionEntry = queue.findLatest(m => m.role === 'question' && m.tool_use_id === messageId)
        if (questionEntry) {
          questionEntry.resultReceived = true
          questionEntry.receivedAnswers = data.answers || null
          questionEntry.answersConsistent = data.answers ? compareAnswers(questionEntry.userAnswers, data.answers) : true
          return
        }
      }
    }

    // 更新对应 tool_use/diff 消息
    const toolUseRef = session.queueManager.findToolUseGlobal(messageId)
    if (toolUseRef) {
      const msg = toolUseRef.entry
      msg.isExecuting = false
      msg.isError = !!data.isError
      msg.result = data.content || '(无输出)'
      if (data.usage) {
        msg.usage = data.usage
      }
      applyMessageDuration(
        msg,
        eventTimestamp || data?.timestamp || (isHistoryReplay ? null : Date.now())
      )
      if (msg.role === 'tool_use' && msg.toolName === 'Agent') {
        setUserUsageSource(session, `execution:${messageId}`, data.usage)
      }
    }
  }

  /**
   * 处理控制请求（权限/AskUserQuestion）
   */
  function handleControlRequest(session, data) {
    log('[SessionStore] handleControlRequest called')
    log('[SessionStore] Full data object:', JSON.stringify(data, null, 2))

    // 保存外层的 request_id（用于响应）
    const outerRequestId = data.request_id

    // 获取实际的请求数据（可能嵌套在 request 字段中）
    const requestData = data.request || data

    log('[SessionStore] requestData:', JSON.stringify(requestData, null, 2))

    // 获取 tool_use_id - 支持多种可能的字段名
    const toolUseId = pickFirstDefined(
      requestData.tool_use_id,
      requestData.toolUseId,
      requestData.id,
      data.tool_use_id
    )

    // 检查是否是 AskUserQuestion 请求
    // 支持多种可能的字段名格式
    const toolName = requestData.tool_name || requestData.toolName
    // 支持多种字段名：input, tool_input, toolInput
    let toolInput = requestData.input || requestData.tool_input || requestData.toolInput

    log('[SessionStore] toolName:', toolName)
    log('[SessionStore] tool_use_id:', toolUseId)
    log('[SessionStore] raw toolInput type:', typeof toolInput)

    // 如果 toolInput 是字符串，尝试解析为 JSON
    if (typeof toolInput === 'string') {
      try {
        toolInput = JSON.parse(toolInput)
        log('[SessionStore] parsed toolInput keys:', toolInput ? Object.keys(toolInput).join(', ') : 'null')
      } catch (e) {
        log('[SessionStore] Failed to parse input as JSON:', e.message)
      }
    }

    // 将解析后的 input 放入 mergedRequestData
    const mergedRequestData = {
      ...requestData,
      request_id: pickFirstDefined(outerRequestId, requestData.request_id),
      tool_use_id: toolUseId, // 确保 tool_use_id 被保留
      input: toolInput, // 使用解析后的 input
      ccgui: pickFirstDefined(data.ccgui, requestData.ccgui) || null
    }

    log('[SessionStore] mergedRequestData:', JSON.stringify(mergedRequestData, null, 2))

    const hasQuestions = toolInput?.questions || requestData.questions
    const isInternalMcpRequest = isCcGuiInternalMcpRequest(mergedRequestData)

    // ~/.ccgui 目录下的文件请求自动批准（不弹窗、不播放音效）
    if (isCcGuiFileRequest(mergedRequestData)) {
      log('[SessionStore] Auto-approving ~/.ccgui file request, toolName:', toolName, 'request_id:', mergedRequestData.request_id)
      autoApproveControlRequest(session, mergedRequestData)
      return
    }

    if (toolName === 'AskUserQuestion' || hasQuestions) {
      log('[SessionStore] Setting pendingQuestion, request_id:', mergedRequestData.request_id)
      session.pendingQuestion = mergedRequestData
    } else if (session.autoApprove || isInternalMcpRequest) {
      // 自动批准开关开启，或请求来自 ccgui_internal MCP 时，不弹窗直接批准
      log('[SessionStore] Auto-approving (autoApprove enabled or ccgui_internal), toolName:', toolName, 'request_id:', mergedRequestData.request_id)
      autoApproveControlRequest(session, mergedRequestData)
    } else {
      // 添加到队列而不是覆盖
      log('[SessionStore] Adding to pendingControlRequests queue, toolName:', toolName, 'request_id:', mergedRequestData.request_id)
      session.pendingControlRequests.push(mergedRequestData)
    }
  }

  /**
   * 自动批准权限请求（自动批准开关开启或 ccgui_internal MCP 请求）
   */
  function autoApproveControlRequest(session, requestData) {
    const requestId = requestData.request_id
    const options = {}

    if (requestData.tool_use_id !== undefined && requestData.tool_use_id !== null && requestData.tool_use_id !== '') {
      options.toolUseID = requestData.tool_use_id
    }

    // 传递 permission_suggestions 以便 CLI 记住规则
    if (requestData.permission_suggestions && requestData.permission_suggestions.length > 0) {
      options.permissionRules = JSON.parse(JSON.stringify(requestData.permission_suggestions))
    }

    // 传递工具输入参数
    const toolInput = requestData.input || requestData.tool_input || requestData.toolInput
    if (toolInput) {
      options.updatedInput = typeof toolInput === 'string' ? JSON.parse(toolInput) : JSON.parse(JSON.stringify(toolInput))
    }
    if (!options.updatedInput) {
      options.updatedInput = {}
    }

    window.electronAPI.sendControlResponse({
      sessionId: session.id,
      requestId,
      approved: true,
      options
    }).catch(error => {
      log('[SessionStore] Auto-approve failed:', error?.message || String(error))
    })
  }

  function removePendingPermission(session, requestId) {
    if (!session || requestId === undefined || requestId === null || requestId === '') return null

    const index = session.pendingPermissions.findIndex(permission =>
      permission?.request_id === requestId ||
      permission?.tool_use_id === requestId ||
      permission?.id === requestId
    )

    if (index === -1) return null
    return session.pendingPermissions.splice(index, 1)[0] || null
  }

  function removePendingControlRequest(session, requestId) {
    if (!session || requestId === undefined || requestId === null || requestId === '') return null

    const index = session.pendingControlRequests.findIndex(request =>
      request?.request_id === requestId ||
      request?.tool_use_id === requestId ||
      request?.id === requestId
    )

    if (index === -1) return null
    return session.pendingControlRequests.splice(index, 1)[0] || null
  }

  /**
   * 处理控制响应（rewind/fork 等操作的结果，以及权限确认的响应）
   */
  function handleControlResponse(session, data) {
    log('[SessionStore] handleControlResponse called')
    log('[SessionStore] Response data:', JSON.stringify(data, null, 2))

    // 检查是否有待处理的控制请求
    if (session.pendingControlRequestResult) {
      // 解析响应并传递给等待的 Promise
      session.pendingControlRequestResult.resolve(data)
      session.pendingControlRequestResult = null
    }
  }

  /**
   * 处理中断
   */
  function handleInterrupt(session, data) {
    // 中断只由 turn-interrupted system-notification 插入提示，
    // isProcessing 由正常的 result 流程设置
  }

  /**
   * 比较用户答案和收到的答案是否一致
   */
  function compareAnswers(userAnswers, receivedAnswers) {
    if (!userAnswers || !receivedAnswers) return false

    const userKeys = Object.keys(userAnswers)
    const receivedKeys = Object.keys(receivedAnswers)

    if (userKeys.length !== receivedKeys.length) {
      return false
    }

    for (const key of userKeys) {
      if (!receivedAnswers.hasOwnProperty(key)) {
        return false
      }
      // 标准化答案进行比较（处理空格差异）
      const userAnswer = String(userAnswers[key]).trim()
      const receivedAnswer = String(receivedAnswers[key]).trim()
      if (userAnswer !== receivedAnswer) {
        return false
      }
    }

    return true
  }

  /**
   * 处理状态更新
   */
  function handleStateUpdate(session, data) {
    if (data.isProcessing !== undefined) {
      session.isProcessing = data.isProcessing
    }
    if (Array.isArray(data.activeAgentIds)) {
      session.activeAgentIds = new Set(data.activeAgentIds)
      reconcileAgentRuntimeStatuses(session)
    }
    if (data.inputMessage !== undefined) {
      session.inputMessage = data.inputMessage
    }
    if (data.inputAttachments !== undefined) {
      session.inputAttachments = Array.isArray(data.inputAttachments) ? data.inputAttachments : []
    }
  }

  /**
   * 处理未知消息类型
   * 显示为 unknown 消息气泡，方便调试和发现漏掉的消息
   */
  function handleUnknownMessage(session, data) {
    log('[SessionStore] handleUnknownMessage:', data)

    // 创建 unknown 消息
    const unknownMsg = {
      id: `unknown-${Date.now()}`,
      role: 'unknown',
      messageType: data.type || 'unknown',
      subtype: data.subtype || null,
      content: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      rawMessage: data,
      timestamp: new Date()
    }

    // unknown 消息放入主队列
    getMainQueue(session).append(unknownMsg)
  }

  function normalizeProviderUnknownMessage(data = {}) {
    const rawMessage = data?.rawMessage
    if (!rawMessage || typeof rawMessage !== 'object') {
      return null
    }

    if (rawMessage.method === 'warning') {
      const params = rawMessage.params && typeof rawMessage.params === 'object'
        ? rawMessage.params
        : {}
      const warningMessage = typeof params.message === 'string' ? params.message.trim() : ''

      return {
        type: 'provider-runtime-warning',
        provider: data.provider || 'unknown',
        threadId: params.threadId || null,
        message: warningMessage || '收到 provider 警告消息',
        rawMessage,
        timestamp: data.timestamp || new Date().toISOString()
      }
    }

    return null
  }

  function handleResidualManagerEvent(session, data) {
    const normalizedProviderMessage = normalizeProviderUnknownMessage(data)
    if (normalizedProviderMessage) {
      handleSystemNotification(session, normalizedProviderMessage)
      return
    }

    const payload = data?.rawMessage && typeof data.rawMessage === 'object'
      ? data.rawMessage
      : data

    if (payload && typeof payload === 'object') {
      if (typeof payload.type === 'string' && payload.type.trim()) {
        handleSystemNotification(session, payload)
        return
      }

      if (payload.eventType && payload.taskId) {
        handleTaskEvent(session, payload)
        return
      }
    }

    handleUnknownMessage(session, data)
  }

  function shouldShowTurnErrorAsDialog(data = {}) {
    if (data?.type !== 'turn-error') {
      return false
    }

    const message = typeof data?.message === 'string' ? data.message : ''
    if (!message) {
      return false
    }

    return [
      '撤销本次修改失败',
      '重做本次修改失败',
      '重置文件失败',
      '撤销本次修改并创建分支失败',
      '重置文件并创建分支失败'
    ].some(keyword => message.includes(keyword))
  }

  function showTurnErrorDialog(data = {}) {
    const rawMessage = typeof data?.message === 'string' ? data.message.trim() : '操作失败'
    const [titleLine, ...detailLines] = rawMessage.split('\n').filter(Boolean)
    openAppErrorDialog({
      title: titleLine || '操作失败',
      message: titleLine || '操作未完成',
      detail: detailLines.join('\n') || rawMessage
    })
  }

  /**
   * 处理运行时进程异常退出
   */
  function handleAbnormalExit(session, data) {
    log('[SessionStore] handleAbnormalExit:', data)

    finalizeSessionRuntimeActivity(session, { markInterruptedTools: true })

    // 停止处理状态
    session.isProcessing = false
    session.runtimeReady = false

    // 添加异常退出提示消息到主队列（使用 system_notification 类型）
    const exitMsg = {
      id: `abnormal-exit-${Date.now()}`,
      role: 'system_notification',
      notificationType: 'runtime-exit',
      scope: 'session',
      data: {
        provider: data.provider || session.envInfo?.provider || 'claude',
        reason: data.reason || 'crash',
        code: data.code,
        message: data.message
      },
      timestamp: new Date()
    }
    getMainQueue(session).append(exitMsg)
  }

  /**
   * 处理正常退出（用户手动停止）
   */
  function handleNormalExit(session, data) {
    finalizeSessionRuntimeActivity(session, { markInterruptedTools: true })

    // 停止处理状态
    session.isProcessing = false
    session.runtimeReady = false

    // 添加正常停止提示消息到主队列
    const exitMsg = {
      id: `normal-exit-${Date.now()}`,
      role: 'system_notification',
      notificationType: 'runtime-stopped',
      scope: 'session',
      data: {
        provider: data.provider || session.envInfo?.provider || 'claude',
        reason: data.reason || 'user-stop',
        message: data.message || '运行时已停止'
      },
      timestamp: new Date()
    }
    getMainQueue(session).append(exitMsg)
  }

  /**
   * 处理系统通知（权限模式切换、快速模式切换、压缩边界等）
   * 添加到消息列表显示为系统通知气泡
   */
  function handleSystemNotification(session, data) {
    log('[SessionStore] handleSystemNotification:', data)

    if (shouldShowTurnErrorAsDialog(data)) {
      showTurnErrorDialog(data)
      return
    }

    const notificationAgentId = getMessageAgentId({ ccgui: data?.ccgui || null }, session)
    const notificationQueue = session.queueManager.getOrCreateQueue(notificationAgentId)
    const operationId = typeof data?.operationId === 'string' ? data.operationId : ''

    if (data?.type === 'session-runtime-starting' || data?.type === 'session-runtime-restarting') {
      session.runtimeReady = false
    } else if (data?.type === 'session-runtime-ready') {
      session.runtimeReady = true
    } else if (data?.type === 'runtime-stopped') {
      finalizeSessionRuntimeActivity(session, { markInterruptedTools: true })
      session.isProcessing = false
      session.runtimeReady = false
    } else if (data?.type === 'runtime-exit') {
      finalizeSessionRuntimeActivity(session, { markInterruptedTools: true })
      session.isProcessing = false
      session.runtimeReady = false
    }

    const existingMcpNotification = operationId && isMcpLifecycleNotificationType(data?.type)
      ? findMcpNotificationByOperationId(session.queueManager.queues.values(), operationId)
      : null

    if (existingMcpNotification) {
      const { message: existingMessage } = existingMcpNotification
      const resolveExistingScope = () => resolveNotificationScope(data.type, {
        ...data,
        ccgui: data?.ccgui || existingMessage.ccgui || null
      }, session)

      if (data.type === 'mcp-server-starting') {
        if (existingMessage.notificationType === 'mcp-server-starting') {
          existingMessage.data = {
            ...existingMessage.data,
            ...data,
            startedAt: existingMessage.data?.startedAt || data.startedAt || Date.now()
          }
          existingMessage.scope = resolveExistingScope()
          existingMessage.ccgui = data?.ccgui || existingMessage.ccgui || null
        }
        return
      }

      if (shouldIgnoreMcpNotificationUpdate(existingMessage.notificationType, data.type)) {
        return
      }

      const applyMcpUpdate = () => {
        if (shouldIgnoreMcpNotificationUpdate(existingMessage.notificationType, data.type)) {
          return
        }

        const startedAt = existingMessage.data?.startedAt || existingMessage.timestamp?.getTime?.() || Date.now()
        const resolvedDurationMs = Number.isFinite(data.durationMs)
          ? data.durationMs
          : Number.isFinite(existingMessage.data?.durationMs)
            ? existingMessage.data.durationMs
            : Math.max(0, Date.now() - startedAt)

        existingMessage.notificationType = data.type
        existingMessage.scope = resolveExistingScope()
        existingMessage.data = {
          ...existingMessage.data,
          ...data,
          startedAt,
          completedAt: Date.now(),
          durationMs: resolvedDurationMs
        }
        existingMessage.ccgui = data?.ccgui || existingMessage.ccgui || null
        existingMessage.timestamp = new Date()
      }

      if (existingMessage.notificationType === 'mcp-server-starting') {
        const startedAt = existingMessage.data?.startedAt || existingMessage.timestamp?.getTime?.() || Date.now()
        const elapsed = Math.max(0, Date.now() - startedAt)
        const minDisplayMs = 700
        if (elapsed < minDisplayMs) {
          setTimeout(applyMcpUpdate, minDisplayMs - elapsed)
        } else {
          applyMcpUpdate()
        }
      } else {
        applyMcpUpdate()
      }
      return
    }

    if (
      operationId && (
        data.type === 'session-runtime-ready' ||
        data.type === 'session-config-applied' ||
        data.type === 'session-effort-changed' ||
        data.type === 'mcp-server-ready' ||
        data.type === 'mcp-server-error' ||
        data.type === 'hook-event'
      )
    ) {
      const pendingMessage = [...notificationQueue.entries].reverse().find(message =>
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
        const applyUpdate = () => {
          const startedAt = pendingMessage.data?.startedAt || pendingMessage.timestamp?.getTime?.() || Date.now()
          const resolvedDurationMs = Number.isFinite(data.durationMs)
            ? data.durationMs
            : Number.isFinite(pendingMessage.data?.durationMs)
              ? pendingMessage.data.durationMs
              : Math.max(0, Date.now() - startedAt)

          pendingMessage.notificationType = data.type
          pendingMessage.scope = resolveNotificationScope(data.type, data, session)
          pendingMessage.data = {
            ...pendingMessage.data,
            ...data,
            completedAt: Date.now(),
            durationMs: resolvedDurationMs
          }
          pendingMessage.timestamp = new Date()
        }

        const startedAt = pendingMessage.data?.startedAt || pendingMessage.timestamp?.getTime?.() || Date.now()
        const elapsed = Math.max(0, Date.now() - startedAt)
        const minDisplayMs = 700
        if (elapsed < minDisplayMs) {
          setTimeout(applyUpdate, minDisplayMs - elapsed)
        } else {
          applyUpdate()
        }
        return
      }
    }

    // 中断提示：不作为错误通知，显示为简短提示
    if (data?.type === 'turn-interrupted') {
      const interruptMsg = {
        id: `interrupt-${Date.now()}`,
        role: 'system_notification',
        notificationType: 'turn-interrupted',
        scope: 'turn',
        data: {
          message: data.message || '已中断响应'
        },
        timestamp: new Date()
      }
      getMainQueue(session).append(interruptMsg)
      return
    }

    // 创建系统通知消息
    const canonicalMessageId = typeof data?.messageId === 'string' ? data.messageId.trim() : ''
    const notificationMsg = {
      id: canonicalMessageId || `system-notification-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'system_notification',
      notificationType: data.type,
      scope: resolveNotificationScope(data.type, data, session),
      data: data,
      ccgui: data?.ccgui || null,
      timestamp: new Date()
    }

    notificationQueue.append(notificationMsg)
  }

  function finalizeSessionRuntimeActivity(session, options = {}) {
    if (!session) {
      return
    }

    const markInterruptedTools = options.markInterruptedTools !== false
    const now = Date.now()

    session.activeAgentIds.clear()
    reconcileAgentRuntimeStatuses(session)

    // 遍历所有队列
    for (const queue of session.queueManager.queues.values()) {
      for (let i = queue.length - 1; i >= 0; i--) {
        const msg = queue.entries[i]

        if (msg.isStreaming) {
          msg.isStreaming = false
        }

        if (msg.isExecuting) {
          msg.isExecuting = false

          if (
            markInterruptedTools &&
            (msg.role === 'tool_use' || msg.role === 'diff')
          ) {
            msg.interrupted = true
            if (!msg.isError) {
              msg.isError = true
            }
          }
        }

        if (msg.startTime && !msg.duration) {
          msg.duration = now - msg.startTime
        }
      }
    }
  }

  const HANDLED_SILENT_MESSAGE_TYPES = new Set([
    'agent-orchestration',
    'claude/citations_delta'
  ])

  function isSilentMessageHandled(data) {
    return HANDLED_SILENT_MESSAGE_TYPES.has(data?.messageType)
  }

  function hasMessageContent(data) {
    if (typeof data?.content === 'string' && data.content.trim()) return true
    if (Array.isArray(data?.content) && data.content.length > 0) return true
    if (typeof data?.message === 'string' && data.message.trim()) return true
    return false
  }

  function getEscalatedSilentMessageNotification(data) {
    const textCandidates = [
      data?.rawMessage?.tool_use_result?.content,
      data?.rawMessage?.message?.content,
      data?.rawMessage?.tool_use_result?.prompt,
      data?.params?.rawMessage?.tool_use_result?.content,
      data?.params?.rawMessage?.message?.content,
      data?.params?.tool_use_result?.content,
      data?.params?.content,
      data?.rawMessage?.content,
      data?.message,
      data?.params
    ]

    const flattenedText = textCandidates
      .flatMap(value => {
        if (Array.isArray(value)) {
          return value.map(item => {
            if (typeof item === 'string') return item
            if (typeof item?.text === 'string') return item.text
            if (typeof item?.content === 'string') return item.content
            return ''
          })
        }
        if (typeof value === 'string') return [value]
        if (typeof value?.text === 'string') return [value.text]
        return []
      })
      .filter(Boolean)
      .join('\n')

    if (!/context window limit/i.test(flattenedText)) {
      return null
    }

    return {
      type: 'turn-error',
      errorType: 'contextWindowLimit',
      message: flattenedText.trim() || 'The model has reached its context window limit.',
      provider: data?.provider || 'claude',
      source: 'silent-message-escalation',
      metadata: data
    }
  }

  /**
   * 查找与 taskId 匹配的 TaskOutput tool_use 消息，返回其 result 并标记为已合并
   */
  function findAndMergeTaskOutput(session, taskId) {
    const normalizedTaskId = String(taskId || '')
    if (!normalizedTaskId) return null

    // 跨队列搜索 TaskOutput
    for (const queue of session.queueManager.queues.values()) {
      for (let i = queue.length - 1; i >= 0; i--) {
        const msg = queue.entries[i]
        if (msg?.role !== 'tool_use' || msg?.toolName !== 'TaskOutput') continue
        const msgTaskId = String(msg.toolInput?.task_id || msg.toolInput?.taskId || '')
        if (msgTaskId !== normalizedTaskId) continue
        // 找到匹配的 TaskOutput
        const result = msg.result || null
        if (result) {
          msg.mergedIntoTaskComplete = true
        }
        return result
      }
    }
    return null
  }

  /**
   * 处理子任务事件（started/progress/notification）
   */
  function handleTaskEvent(session, data) {
    const { eventType, taskId } = data

    if (eventType === 'started') {
      const agentId = resolveAgentIdFromCcguiPayload(data.ccgui)
      // 协作型 subagent 不创建 activeTask（浮动窗口），只有执行型才创建
      if (agentId) {
        const registryEntry = session.agentRegistry.get(agentId)
        if (registryEntry?.agentKind === 'collaborative') {
          log('[SessionStore] Skipping activeTask for collaborative agent:', agentId)
          return
        }
      }
      // 任务开始：添加到活跃任务列表
      const taskData = {
        id: taskId,
        taskType: data.taskType,
        description: data.description,
        prompt: data.prompt,
        status: 'running',
        startTime: Date.now(),
        usage: null,
        summary: null,
        latestEvent: null,
        agentId,
        ccgui: data.ccgui || null
      }
      session.activeTasks.set(taskId, taskData)
      log('[SessionStore] Task started:', taskId, data.description)
    } else if (eventType === 'progress') {
      // 任务进度：更新任务信息
      const task = session.activeTasks.get(taskId)
      if (task) {
        task.usage = data.usage || task.usage
        task.summary = data.summary || task.summary
        if (data.description) task.latestEvent = data.description
        task.agentId = task.agentId || resolveAgentIdFromCcguiPayload(data.ccgui)
        task.ccgui = data.ccgui || task.ccgui || null
        log('[SessionStore] Task progress:', taskId, data.summary)
      }
    } else if (eventType === 'updated') {
      // 任务状态变更：将 patch 合并到 activeTask
      // 注意：collaborative agent 的 task 不在 activeTasks 中，此处静默忽略是预期行为
      // （collaborative agent 的终态由 task_notification 的 else 分支处理）
      const task = session.activeTasks.get(taskId)
      if (task) {
        const patch = data.patch || {}
        if (patch.status) task.status = patch.status
        if (patch.description) task.description = patch.description
        if (patch.error) task.error = patch.error
        task.agentId = task.agentId || resolveAgentIdFromCcguiPayload(data.ccgui)
        task.ccgui = data.ccgui || task.ccgui || null
        log('[SessionStore] Task updated:', taskId, patch)
      }
    } else if (eventType === 'notification') {
      // 任务通知：通常是任务结束，从活跃列表移除
      const task = session.activeTasks.get(taskId)
      if (task) {
        task.status = 'completed'
        const resolvedAgentId = task.agentId || resolveAgentIdFromCcguiPayload(data.ccgui)
        const taskCcgui = resolvedAgentId
          ? {
              ...(task.ccgui || data.ccgui || {}),
              attribution: {
                ...((task.ccgui || data.ccgui || {}).attribution || {}),
                agentId: resolvedAgentId,
                actorId: resolvedAgentId
              }
            }
          : (task.ccgui || data.ccgui || null)
        // 添加任务完成消息到聊天
        const taskCompleteMsg = {
          id: `task-complete-${taskId}`,
          role: 'task_complete',
          taskId: taskId,
          taskType: task.taskType,
          description: task.description,
          summary: task.summary,
          usage: task.usage,
          outputResult: null,
          ccgui: taskCcgui,
          duration: Date.now() - task.startTime,
          timestamp: new Date()
        }
        // 检查是否已存在 task_complete（跨队列搜索）
        const existingTaskComplete = session.queueManager.findLatestGlobal(m => m?.role === 'task_complete' && m?.taskId === taskId)
        if (!existingTaskComplete) {
          taskCompleteMsg.outputResult = findAndMergeTaskOutput(session, taskId)
          const queue = session.queueManager.routeToQueue(session, taskCompleteMsg)
          queue.append(taskCompleteMsg)
        }
        // 从活跃列表移除
        session.activeTasks.delete(taskId)
        rebuildAgentSemanticState(session)
        log('[SessionStore] Task completed:', taskId)
      } else {
        // collaborative agent 的 task 不在 activeTasks 中，但仍需推送 task_complete 消息
        const agentId = resolveAgentIdFromCcguiPayload(data.ccgui)
        const registryEntry = agentId ? session.agentRegistry.get(agentId) : null
        if (registryEntry?.agentKind === 'collaborative') {
          const taskCompleteMsg = {
            id: `task-complete-${taskId}`,
            role: 'task_complete',
            taskId,
            taskType: data.taskType || null,
            description: data.description || null,
            summary: data.summary || null,
            usage: data.usage || null,
            outputResult: null,
            ccgui: null,
            duration: data.duration || 0,
            timestamp: new Date()
          }
          const existingTaskComplete = session.queueManager.findLatestGlobal(m => m?.role === 'task_complete' && m?.taskId === taskId)
          if (!existingTaskComplete) {
            const taskCcgui = agentId
              ? {
                  ...(data.ccgui || {}),
                  attribution: {
                    ...((data.ccgui || {}).attribution || {}),
                    agentId,
                    actorId: agentId
                  }
                }
              : (data.ccgui || null)
            taskCompleteMsg.ccgui = taskCcgui
            taskCompleteMsg.outputResult = findAndMergeTaskOutput(session, taskId)
            const queue = session.queueManager.routeToQueue(session, taskCompleteMsg)
            queue.append(taskCompleteMsg)
            rebuildAgentSemanticState(session)
            log('[SessionStore] Collaborative task completed (no activeTask):', taskId)
          }
        }
      }
    }
  }

  /**
   * 处理 TodoWrite 工具调用
   * 将 todos 显示在悬浮窗中
   */
  function handleTodoWrite(session, toolUseId, todos) {
    log('[SessionStore] handleTodoWrite called:', { toolUseId, todosCount: todos.length })

    // TodoWrite 固定使用 'todowrite' 作为 ID
    const taskId = 'todowrite'
    const existingTask = session.activeTasks.get(taskId)

    // 找到当前正在进行的 todo（用于显示描述）
    const currentTodo = todos.find(t => t.status === 'in_progress') || todos[todos.length - 1]
    const completedCount = todos.filter(t => t.status === 'completed').length

    // 创建新的 Map 以触发 Vue 响应式更新
    const newActiveTasks = new Map(session.activeTasks)

    if (existingTask) {
      // 更新现有任务
      newActiveTasks.set(taskId, {
        ...existingTask,
        todos: todos,
        description: currentTodo?.activeForm || currentTodo?.content || '任务列表',
        status: completedCount === todos.length ? 'completed' : 'in_progress'
      })
      log('[SessionStore] Updated todo task:', taskId, `(${completedCount}/${todos.length})`)
    } else {
      // 创建新任务
      newActiveTasks.set(taskId, {
        id: taskId,
        taskType: 'todo',
        description: currentTodo?.activeForm || currentTodo?.content || '任务列表',
        status: completedCount === todos.length ? 'completed' : 'in_progress',
        startTime: Date.now(),
        todos: todos,
        toolUseId: toolUseId
      })
      log('[SessionStore] Created todo task:', taskId)
    }

    // 替换整个 Map 以触发响应式更新
    session.activeTasks = newActiveTasks
  }

  /**
   * 处理 CLI 状态消息（如"正在启动运行时..."）
   * 添加一个临时的 status 消息到消息列表
   */
  function handleCliStatus(session, data) {
    // 移除之前的 status 消息（如果有的话）—— status 消息在主队列
    const mainQueue = getMainQueue(session)
    const existingStatus = mainQueue ? mainQueue.findLatestByRole('status') : null
    if (existingStatus) {
      mainQueue.removeById(existingStatus.id)
    }

    // 构建更详细的错误消息
    let displayMessage = stripAnsi(data.message || '')
    if (data.type === 'error') {
      // 尝试提取更多有用的错误信息
      const parts = [displayMessage]

      if (data.errorType && data.errorType !== data.message) {
        parts.push(`类型: ${data.errorType}`)
      }
      if (data.details && data.details !== data.message) {
        parts.push(`详情: ${data.details}`)
      }
      if (data.suggestion) {
        parts.push(`建议: ${data.suggestion}`)
      }

      // 如果有额外信息，组合成更完整的消息
      if (parts.length > 1) {
        displayMessage = parts.filter(Boolean).join(' | ')
      }

      // 如果原始消息太简短，尝试从 raw 数据中提取更多信息
      if (displayMessage === 'Codex error' && data.raw) {
        const rawInfo = data.raw.error?.message || data.raw.error?.type || data.raw.details
        if (rawInfo) {
          displayMessage = `Codex 错误: ${rawInfo}`
        }
      }
    }

    // 添加新的 status 消息到主队列
    if (displayMessage) {
      mainQueue.append({
        id: `status-${Date.now()}`,
        role: 'status',
        content: displayMessage,
        isError: data.type === 'error',
        errorType: data.errorType || null,
        details: data.details || null,
        suggestion: data.suggestion || null,
        timestamp: new Date()
      })
    }
  }

  /**
   * 开始监听后端事件
   */
  function startEventListener() {
    if (eventUnsubscribe) {
      eventUnsubscribe()
    }

    eventUnsubscribe = window.electronAPI.onSessionEvent((event) => {
      handleSessionEvent(event)
    })
  }

  /**
   * 停止监听后端事件
   */
  function stopEventListener() {
    if (eventUnsubscribe) {
      eventUnsubscribe()
      eventUnsubscribe = null
    }
  }

  /**
   * 清除所有会话
   */
  function clearAll() {
    sessions.value.clear()
    currentSessionId.value = null
  }

  /**
   * 添加消息到当前会话（供前端直接添加消息使用）
   */
  function addMessage(message) {
    const session = currentSession.value
    if (session) {
      const queue = session.queueManager.routeToQueue(session, message)
      queue.append(message)
      rebuildAgentSemanticState(session)
    }
  }

  /**
   * 更新指定消息（用于 tool_use 结果更新等）
   */
  function updateMessage(predicate, updates) {
    const session = currentSession.value
    if (!session) return false

    // 在所有队列中搜索
    for (const queue of session.queueManager.queues.values()) {
      for (const entry of queue.entries) {
        if (predicate(entry)) {
          Object.assign(entry, updates)
          rebuildAgentSemanticState(session)
          return true
        }
      }
    }
    return false
  }

  /**
   * 设置权限请求（来自后端事件）
   */
  function setPendingPermission(permission) {
    const session = currentSession.value
    if (session) {
      session.pendingPermissions.push(permission)
    }
  }

  /**
   * 设置控制请求（来自后端事件）
   */
  function setPendingControlRequest(request) {
    const session = currentSession.value
    if (session) {
      // 添加到队列而不是覆盖
      session.pendingControlRequests.push(request)
    }
  }

  /**
   * 清除当前会话的权限和控制请求
   * @param {string|null} requestId - 要清除的请求 ID；为空时清除当前展示中的请求
   * @param {boolean} saveForResponse - 是否保存请求信息用于后续添加权限结果消息
   */
  function clearPendingPermissions(requestId = null, saveForResponse = false) {
    const session = currentSession.value
    if (session) {
      const hasRequestId = !(requestId === undefined || requestId === null || requestId === '')
      const currentPermission = hasRequestId
        ? session.pendingPermissions.find(permission =>
            permission?.request_id === requestId ||
            permission?.tool_use_id === requestId ||
            permission?.id === requestId
          ) || null
        : (session.pendingPermissions[0] || null)
      const currentRequest = hasRequestId
        ? session.pendingControlRequests.find(request =>
            request?.request_id === requestId ||
            request?.tool_use_id === requestId ||
            request?.id === requestId
          ) || null
        : (session.pendingControlRequests[0] || null)

      // 如果需要保存，先保存请求信息
      if (saveForResponse && (currentPermission || currentRequest)) {
        session.lastPermissionRequest = currentPermission || currentRequest
      }

      if (currentPermission) {
        removePendingPermission(
          session,
          pickFirstDefined(currentPermission.request_id, currentPermission.tool_use_id, currentPermission.id)
        )
      }
      if (currentRequest) {
        removePendingControlRequest(
          session,
          pickFirstDefined(currentRequest.request_id, currentRequest.tool_use_id, currentRequest.id)
        )
      }
      session.pendingQuestion = null
    }
  }

  /**
   * 清除当前会话的 AskUserQuestion 请求
   */
  function clearPendingQuestion() {
    const session = currentSession.value
    if (session) {
      session.pendingQuestion = null
    }
  }

  return {
    // State
    sessions,
    currentSessionId,
    currentSession,
    currentMessages,
    currentMainAgentId,
    currentAgentRegistry,
    currentAgentBuckets,
    currentAgentWorkspaceState,
    executionAgentCards,
    collaborativeAgentSessions,
    agentWorkspaceAgents,
    activeCollaborativeSession,
    splitCollaborativeSessions,
    currentInputTargetAgent,
    isProcessing,
    hasAnyProcessingSession,
    inputMessage,
    inputAttachments,
    pendingPermission,
    pendingQuestion,
    pendingControlRequest,

    // Actions
    initSession,
    loadHistoryTurn,
    switchToSession,
    setActiveAgent,
    setFocusedPaneAgentId,
    setInputTargetAgentId,
    setCollaborativeViewMode,
    setSplitAgentIds,
    replaceSplitPaneAgent,
    closeSession,
    sendMessage,
    queryCommands,
    queryAtReferences,
    runCommands,
    sendControlResponse,
    sendRuntimeToolResult,
    sendInterrupt,
    closeSubagentAgent,
    sendControlRequest,
    executeMcpAction,
    currentMcpCapabilities,
    setSessionModel,
    listSessionSubmodels,
    getAvailableTargets,
    setSessionSubmodel,
    setSessionTarget,
    listSessionEffortOptions,
    setSessionEffort,
    setMaxThinkingTokens,
    setThinkingEnabled,
    setPermissionMode,
    setAutoApprove,
    startEventListener,
    stopEventListener,
    clearAll,
    addMessage,
    updateMessage,
    getMessageAgentId,
    setPendingPermission,
    setPendingControlRequest,
    clearPendingPermissions,
    clearPendingQuestion,
    releaseOldCollapsedTurns,
    unloadCollapsedTurns,
    restoreReleasedTurn
  }
})
