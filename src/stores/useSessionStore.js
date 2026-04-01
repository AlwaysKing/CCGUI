import { defineStore } from 'pinia'
import { ref, computed, watch, reactive } from 'vue'
import { logger } from '../utils/logger'
import { stripAttachmentTokens } from '../utils/chatAttachments'

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
 * SessionData
 * 每个会话的完整状态（包含 UI 状态和消息）
 */
class SessionData {
  constructor(id, projectPath) {
    this.id = id
    this.projectPath = projectPath

    // 消息列表
    this.messages = []
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
    this.fastModeState = 'off' // 快速模式状态: 'off' | 'auto' | 'on'
    this.activeTasks = new Map() // 活跃的子任务 Map<taskId, taskData>
    this.currentTurnUsageSources = {}
    this.mainAgentId = 'master'
    this.agentRegistry = new Map()
    this.agentBuckets = new Map()
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

  return {
    id: attachment.id || '',
    kind: attachment.kind || 'file',
    name: attachment.name || '',
    path: attachment.path || '',
    size: Number.isFinite(attachment.size) ? attachment.size : null,
    mimeType: attachment.mimeType || null,
    source: attachment.source || 'picker',
    ...(Number.isFinite(attachment.startLine) ? { startLine: attachment.startLine } : {}),
    ...(Number.isFinite(attachment.endLine) ? { endLine: attachment.endLine } : {})
  }
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

function createAgentBucket(agentId) {
  return {
    agentId,
    messages: [],
    orchestrationEvents: [],
    firstTimestamp: null,
    lastTimestamp: null
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

  function resolveNotificationScope(notificationType, data = {}) {
    const type = notificationType || data?.type || ''
    if (SESSION_SCOPED_NOTIFICATION_TYPES.has(type)) {
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
    const nextBuckets = new Map()
    const eventKeys = new Set()
    const supportedExecutionAgentIds = new Set()

    const ensureBucket = (agentId) => {
      if (!nextBuckets.has(agentId)) {
        nextBuckets.set(agentId, createAgentBucket(agentId))
      }
      if (agentId) {
        supportedExecutionAgentIds.add(agentId)
      }
      return nextBuckets.get(agentId)
    }

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
      ensureBucket(normalizedEvent.agentId).orchestrationEvents.push(normalizedEvent)
      nextRegistry.set(
        normalizedEvent.agentId,
        mergeRegistryEntryFromEvent(nextRegistry.get(normalizedEvent.agentId), normalizedEvent)
      )
    }

    nextRegistry.set(mainAgentId, mergeAgentRegistryEntry(nextRegistry.get(mainAgentId), createMainAgentRegistryEntry(session)))

    for (const message of session.messages) {
      const messageAgentId = getMessageAgentId(message, session) || mainAgentId
      const bucket = ensureBucket(messageAgentId)
      bucket.messages.push(message)
      const timestamp = getMessageTimestamp(message)
      if (timestamp && !bucket.firstTimestamp) {
        bucket.firstTimestamp = timestamp
      }
      if (timestamp) {
        bucket.lastTimestamp = timestamp
      }

      const registryEntry = sanitizeCollaborativeRegistryPatch(
        normalizeAgentRegistryEntry(message?.ccgui?.registry),
        message
      )
      if (registryEntry?.agentId) {
        supportedExecutionAgentIds.add(registryEntry.agentId)
        nextRegistry.set(registryEntry.agentId, mergeAgentRegistryEntry(nextRegistry.get(registryEntry.agentId), registryEntry))
      } else if (!nextRegistry.has(messageAgentId)) {
        nextRegistry.set(messageAgentId, mergeAgentRegistryEntry(nextRegistry.get(messageAgentId), {
          agentId: messageAgentId,
          status: messageAgentId === mainAgentId ? 'running' : null
        }))
      }

      recordEvent(message?.ccgui?.orchestration)
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

    if (!nextBuckets.has(mainAgentId)) {
      nextBuckets.set(mainAgentId, createAgentBucket(mainAgentId))
    }

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
      nextBuckets.delete(agentId)
    }

    session.agentRegistry = nextRegistry
    session.agentBuckets = nextBuckets
    syncAgentWorkspaceState(session)
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
    const toolUseId = getToolUseIdFromPayload(payload)
    if (toolUseId && semanticAgentId && semanticAgentKind === 'execution') {
      session.agentToolUseBindings.set(toolUseId, semanticAgentId)
    }

    syncAgentWorkspaceState(session)
  }

  // 当前会话的消息（便捷访问）
  const currentMessages = computed(() => {
    return currentSession.value?.messages || []
  })

  const currentMainAgentId = computed(() => getMainAgentId(currentSession.value))

  const currentAgentRegistry = computed(() => {
    return currentSession.value?.agentRegistry || new Map()
  })

  const currentAgentBuckets = computed(() => {
    return currentSession.value?.agentBuckets || new Map()
  })

  const currentAgentWorkspaceState = computed(() => {
    const session = currentSession.value
    return session?.agentWorkspaceState || normalizeWorkspaceState(null, getMainAgentId(session))
  })

  const executionAgentCards = computed(() => {
    const registryEntries = Array.from(currentAgentRegistry.value.values())
    const buckets = currentAgentBuckets.value
    const hasLiveRuntime = Boolean(currentSession.value?.runtimeReady || currentSession.value?.envInfo?.providerPid)

    return registryEntries
      .filter(entry => entry?.agentKind === 'execution')
      .map(entry => {
        const bucket = buckets.get(entry.agentId) || createAgentBucket(entry.agentId)
        const items = bucket.messages || []
        const spawnRequest = items.find(message => message?.role === 'tool_use' && message?.toolName === 'Agent')
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
        const rawStatus = entry.status || 'running'
        const resolvedStatus = (!hasLiveRuntime && (rawStatus === 'running' || rawStatus === 'starting') && activeTimelineItems.length === 0)
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
          bucket,
          registry: entry
        }
      })
      .sort((left, right) => {
        const leftTime = left.bucket.firstTimestamp || left.registry.startTime || ''
        const rightTime = right.bucket.firstTimestamp || right.registry.startTime || ''
        return leftTime.localeCompare(rightTime)
      })
  })

  const collaborativeAgentSessions = computed(() => {
    const mainAgentId = currentMainAgentId.value
    const registryEntries = Array.from(currentAgentRegistry.value.values())
    const buckets = currentAgentBuckets.value

    return registryEntries
      .filter(entry => entry?.agentKind === 'collaborative')
      .map(entry => {
        const bucket = buckets.get(entry.agentId) || createAgentBucket(entry.agentId)
        const display = inferCollaborativeDisplay(entry, mainAgentId)
        return {
          agentId: entry.agentId,
          title: display.title,
          subtitle: display.subtitle,
          color: entry.color || null,
          status: entry.status || 'running',
          canInput: entry.status !== 'deleted' && entry.canWrite !== false && entry.interactionMode !== 'read-only',
          canWrite: entry.canWrite !== false,
          interactionMode: entry.interactionMode || null,
          messages: bucket.messages || [],
          bucket,
          registry: entry,
          isMain: entry.agentId === mainAgentId
        }
      })
      .sort((left, right) => {
        if (left.isMain) return -1
        if (right.isMain) return 1
        const leftTime = left.bucket.firstTimestamp || left.registry.startTime || ''
        const rightTime = right.bucket.firstTimestamp || right.registry.startTime || ''
        return leftTime.localeCompare(rightTime)
      })
  })

  const agentWorkspaceAgents = computed(() => {
    const registryEntries = Array.from(currentAgentRegistry.value.values())
    const buckets = currentAgentBuckets.value
    const mainAgentId = currentMainAgentId.value

    return registryEntries
      .filter(entry => entry?.agentId === mainAgentId || entry?.agentKind === 'collaborative')
      .map(entry => {
        const bucket = buckets.get(entry.agentId) || createAgentBucket(entry.agentId)
        const isMain = entry.agentId === mainAgentId
        const isCollaborative = entry.agentKind === 'collaborative'
        const display = inferCollaborativeDisplay(entry, mainAgentId)
        const displayAgentType = display.effectiveAgentType

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
          status: entry.status || 'running',
          isMain,
          isCollaborative,
          canActivate: isCollaborative,
          canWrite: entry.canWrite !== false,
          interactionMode: entry.interactionMode || null,
          messageCount: bucket.messages.length
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

    rebuildAgentSemanticState(session)
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

      // 从后端状态恢复数据
      if (result.state && eventLog.length === 0) {
        // 使用 reactive 包装每个消息对象以确保响应式
        sessionData.messages = (result.state.messages || []).map(msg => reactive(msg))
        sessionData.inputAttachments = result.state.inputAttachments || []
        sessionData.inputHistory = result.state.inputHistory || []
        sessionData.envInfo = result.state.envInfo || null
        sessionData.silentMessages = (result.state.silentMessages || []).map(msg => reactive(msg))
        sessionData.taskEvents = (result.state.taskEvents || []).map(event => reactive(event))
        sessionData.runtimeReady = result.state.runtimeReady || false
        // 恢复权限模式
        if (result.state.permissionMode) {
          sessionData.permissionMode = result.state.permissionMode
          console.log('[SessionStore] Restored permission mode:', result.state.permissionMode, 'for session:', sessionId)
          console.log('[SessionStore] Full result state for permission mode:', {
            sessionId,
            hasPermissionMode: !!result.state.permissionMode,
            permissionMode: result.state.permissionMode,
            previousSessionPermissionMode: sessionData.permissionMode
          })
        } else {
          console.log('[SessionStore] No permission mode in result.state for session:', sessionId)
          console.log('[SessionStore] Session state keys:', Object.keys(result.state))
        }
        if (result.state.pendingPermission) {
          sessionData.pendingPermissions = [reactive(result.state.pendingPermission)]
        }

      } else {
        console.log('[SessionStore] No result.state for session:', sessionId, 'result:', result)
      }

      // 先放进 Map，方便事件重放直接走统一 reducer
      sessions.value.set(sessionId, sessionData)

      if (eventLog.length > 0) {
        sessionData.envInfo = result.state?.envInfo || null
        sessionData.runtimeReady = result.state?.runtimeReady || false
        sessionData.permissionMode = result.state?.permissionMode || sessionData.permissionMode
        sessionData.inputAttachments = result.state?.inputAttachments || []
        sessionData.inputHistory = result.state?.inputHistory || []

        for (const event of eventLog) {
          handleSessionEvent(event)
        }
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
  async function sendMessage(content) {
    const session = currentSession.value
    if (!session) {
      throw new Error('No active session')
    }

    const sessionId = session.id
    let outgoingContent = normalizeOutgoingContent(content)
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

    // 清空输入框，设置处理中
    // 注意：不在这里添加消息，后端会通过 'message' 事件发送
    session.inputMessage = ''
    session.inputAttachments = []
    session.isProcessing = true
    session.currentTurnUsageSources = {}

    // 清理悬浮框中的任务（发起新提问时清理上一轮的任务）
    session.activeTasks.clear()
    log('[SessionStore] Cleared active tasks for new message')

    try {
      const result = await window.electronAPI.sendMessage({
        sessionId,
        content: outgoingContent
      })

      if (!result?.success) {
        throw new Error(result?.error || '发送消息失败')
      }
    } catch (error) {
      session.isProcessing = false
      session.inputMessage = typeof outgoingContent === 'string' ? outgoingContent : (outgoingContent?.text || '')
      session.inputAttachments = Array.isArray(outgoingContent?.attachments) ? outgoingContent.attachments : []
      throw error
    }
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

    await window.electronAPI.sendInterrupt({ sessionId: session.id })
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

  function createHistoryReplaySession(baseSession) {
    const replaySession = new SessionData(baseSession.id, baseSession.projectPath)
    replaySession.mainAgentId = baseSession.mainAgentId
    replaySession.permissionMode = baseSession.permissionMode
    replaySession.envInfo = baseSession.envInfo
    return replaySession
  }

  async function loadHistoryTurn(sessionId, turnId) {
    const session = sessions.value.get(sessionId)
    if (!session || !turnId) {
      return { success: false, error: 'Session or turn not found' }
    }

    const anchorIndex = session.messages.findIndex(message => message?.historyTurn?.turnId === turnId)
    if (anchorIndex === -1) {
      return { success: false, error: 'Turn anchor message not found' }
    }

    const anchorMessage = session.messages[anchorIndex]
    if (anchorMessage?.historyTurn?.loaded) {
      return { success: true, cached: true }
    }
    if (anchorMessage?.historyTurn?.loading) {
      return { success: true, loading: true }
    }

    anchorMessage.historyTurn.loading = true
    anchorMessage.historyTurn.error = null

    try {
      const result = await window.electronAPI.loadSessionHistoryTurn({
        sessionId,
        turnId
      })

      if (!result?.success) {
        throw new Error(result?.error || 'Failed to load history turn')
      }

      const replaySession = createHistoryReplaySession(session)
      const turnEvents = Array.isArray(result.events) ? result.events : []
      for (const event of turnEvents) {
        handleSessionEvent(event, replaySession)
      }

      const replayedMessages = Array.isArray(replaySession.messages) ? replaySession.messages : []
      const replayedUserIndex = replayedMessages.findIndex(message =>
        message?.role === 'user' && message?.id === anchorMessage.id
      )
      const replayedUserMessage = replayedUserIndex >= 0 ? replayedMessages[replayedUserIndex] : null
      const insertedMessages = replayedMessages
        .filter((message, index) => !(index === replayedUserIndex && message?.role === 'user'))
        .map(message => reactive(message))

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

      session.messages.splice(anchorIndex, 1, mergedUserMessage, ...insertedMessages)
      rebuildAgentSemanticState(session)

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

    // 根据事件类型处理
    switch (eventType) {
      case 'message':
        recordAgentSemantics(session, data)
        handleAddMessage(session, data)
        break

      case 'message-start':
        // 后端发送的消息创建事件
        recordAgentSemantics(session, data)
        handleMessageStart(session, data)
        break

      case 'message-delta':
        // 后端发送的增量更新事件
        handleMessageDelta(session, data)
        break

      case 'message-replace':
        recordAgentSemantics(session, data?.replacement || data)
        handleMessageReplace(session, data)
        break

      case 'message-complete':
        // 后端发送的消息完成事件
        recordAgentSemantics(session, data?.updates || data)
        handleMessageComplete(session, data)
        break

      case 'message-stop':
        // tool_use 输入流结束（仍在执行中）
        handleMessageStop(session, data)
        break

      case 'message-update':
        // 后端发送的字段更新事件
        recordAgentSemantics(session, data?.updates || data)
        handleMessageUpdate(session, data)
        break

      case 'messages-reset':
        handleMessagesReset(session, data)
        break

      case 'tool-result':
        recordAgentSemantics(session, data)
        handleToolResult(session, data)
        break

      case 'message-result':
        recordAgentSemantics(session, data)
        handleMessageResult(session, data)
        break

      case 'result':
        handleResult(session, data)
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
        session.envInfo = data
        session.runtimeReady = Boolean(data?.providerPid)
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
        session.silentMessages.push(reactive(data))
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
      'message',
      'message-start',
      'message-replace',
      'message-complete',
      'message-update',
      'message-result',
      'messages-reset',
      'tool-result',
      'result',
      'env-info',
      'silent-message',
      'agent-update',
      'system-message',
      'unknown-message',
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
  function handleAddMessage(session, message) {
    if (message?.id) {
      const existingIndex = session.messages.findIndex(item => item?.id === message.id)
      if (existingIndex >= 0) {
        Object.assign(session.messages[existingIndex], message)
        return
      }
    }

    // 如果是 assistant 消息，检查是否已有流式创建的消息
    if (message.role === 'assistant') {
      // 查找是否有正在流式传输的 assistant 消息
      const streamingIndex = session.messages.findIndex(m =>
        m.role === 'assistant' && (m.isStreaming || m.id === session.currentStreamingAssistantId)
      )

      if (streamingIndex >= 0) {
        // 更新现有消息而不是添加新消息
        const existingMsg = session.messages[streamingIndex]
        existingMsg.content = message.content || existingMsg.content
        existingMsg.isStreaming = false
        if (message.rawMessage) {
          existingMsg.rawMessage = message.rawMessage
        }
        return
      }

      // 处理 tool_result 之后的 assistant 消息（ID 不匹配的情况）
      // 查找是否有刚完成 tool_use 的 assistant 消息（isStreaming 已设置为 false 但没有 content）
      const justFinishedIndex = session.messages.findIndex(m =>
        m.role === 'assistant' && m.content === '' && !m.isStreaming
      )
      if (justFinishedIndex >= 0) {
        const existingMsg = session.messages[justFinishedIndex]
        existingMsg.content = message.content || existingMsg.content
        existingMsg.isStreaming = false
        if (message.rawMessage) {
          existingMsg.rawMessage = message.rawMessage
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

        // 查找对应的 tool_use 消息并更新结果
        for (let i = session.messages.length - 1; i >= 0; i--) {
          const msg = session.messages[i]
          if ((msg.role === 'tool_use' || msg.role === 'diff') && (msg.id === toolUseId || msg.request_id === toolUseId)) {
            msg.isExecuting = false
            msg.isError = toolResultContent.is_error
            msg.result = toolResultContent.content || '(无输出)'
            msg.duration = Date.now() - (msg.startTime || Date.now())
            log('[SessionStore] handleAddMessage: updated tool_use message result')
            return // 不添加新消息
          }
        }
      }
    }

    // 使用 reactive 包装消息对象以确保响应式
    session.messages.push(reactive(message))
  }

  function handleMessagesReset(session, data) {
    const nextMessages = Array.isArray(data?.messages) ? data.messages.map(message => reactive(message)) : []
    session.messages = nextMessages
    rebuildAgentSemanticState(session)
    session.currentAssistantMessageIndex = -1
    session.currentStreamingAssistantId = null
    session.currentContentBlockType = null
    session.hasSeenToolUseInCurrentTurn = false
  }

  /**
   * 处理 result（包含 usage 信息）
   */
  function handleResult(session, result) {
    log('[SessionStore] handleResult called')
    log('[SessionStore] Full result object:', JSON.stringify(result, null, 2))

    // 移除 status 消息（如"正在启动运行时..."）
    const statusIndex = session.messages.findIndex(m => m.role === 'status')
    if (statusIndex >= 0) {
      session.messages.splice(statusIndex, 1)
    }

    // 清除流式消息标记
    session.currentStreamingAssistantId = null
    session.pendingQuestion = null
    session.pendingPermissions = []
    session.pendingControlRequests = []

    // 强制收尾残留的流式/执行态，避免某些边缘事件没成对回来时 UI 一直卡住
    session.messages.forEach(msg => {
      if (msg.isStreaming) {
        msg.isStreaming = false
        if (!msg.duration && msg.startTime) {
          msg.duration = Date.now() - msg.startTime
        }
      }

      if (msg.isExecuting) {
        msg.isExecuting = false
        if (!msg.duration && msg.startTime) {
          msg.duration = Date.now() - msg.startTime
        }
      }
    })

    // 提取统一 result 语义
    const latestUserMessage = [...session.messages].reverse().find(msg => msg.role === 'user') || null
    const latestAssistantMessage = [...session.messages].reverse().find(msg =>
      msg.role === 'assistant' && ((msg.content && msg.content.trim()) || (msg.thinking && msg.thinking.trim()))
    ) || [...session.messages].reverse().find(msg => msg.role === 'assistant') || null

    const durationMs =
      result.duration_ms ??
      latestUserMessage?.duration ??
      (latestUserMessage?.startTime ? Date.now() - latestUserMessage.startTime : null)

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
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === 'user') {
        const userMsg = session.messages[i]
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

    // 更新最后一个 assistant 消息的统计信息
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === 'assistant') {
        const assistantMsg = session.messages[i]
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
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === 'user') {
        return session.messages[i]
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

    const nextMessage = {
      ...message
    }

    if ((nextMessage.role === 'tool_use' || nextMessage.role === 'diff') && !nextMessage.manuallyExpanded) {
      nextMessage.collapsed = true
    }

    const existingIndex = session.messages.findIndex(item => item.id === nextMessage.id)
    if (existingIndex >= 0) {
      const existingMessage = session.messages[existingIndex]
      const mergedToolInput = nextMessage.toolInput && typeof nextMessage.toolInput === 'object'
        ? {
            ...(existingMessage.toolInput || {}),
            ...nextMessage.toolInput
          }
        : existingMessage.toolInput
      Object.assign(existingMessage, {
        ...nextMessage,
        ...(mergedToolInput ? { toolInput: mergedToolInput } : {}),
        content: existingMessage.content || nextMessage.content || '',
        thinking: existingMessage.thinking || nextMessage.thinking || '',
        hasThinking: existingMessage.hasThinking || nextMessage.hasThinking || false
      })

      session.currentStreamingAssistantId = nextMessage.id
      if (nextMessage.role === 'assistant') {
        syncUserRealtimeStats(session, {
          turnNumber: nextMessage.turnNumber,
          usage: nextMessage.usage,
          usageSourceKey: `main:${nextMessage.id}`
        })
      }
      log('[SessionStore] handleMessageStart: reused existing message', nextMessage.id)
      return
    }

    // 所有角色都直接添加，不再延迟
    session.messages.push(reactive(nextMessage))
    session.currentStreamingAssistantId = nextMessage.id

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

    // 查找对应的消息
    const msgIndex = session.messages.findIndex(m => m.id === messageId)
    if (msgIndex === -1) {
      log('[SessionStore] handleMessageDelta: message not found', messageId)
      return
    }

    const msg = session.messages[msgIndex]

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

    const msg = session.messages.find(m => m.id === messageId)
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

  /**
   * 处理消息完成事件（来自后端）
   */
  function handleMessageComplete(session, data) {
    const { messageId, updates } = data

    // 查找对应的消息
    const msgIndex = session.messages.findIndex(m => m.id === messageId)
    if (msgIndex === -1) {
      log('[SessionStore] handleMessageComplete: message not found', messageId)
      return
    }

    // 应用更新
    const msg = session.messages[msgIndex]
    Object.assign(msg, updates)
    if (!msg.duration && msg.startTime) {
      msg.duration = Date.now() - msg.startTime
    }

    // 清除流式标记
    session.currentStreamingAssistantId = null

    log('[SessionStore] handleMessageComplete:', messageId)
  }

  /**
   * 处理 message-stop（tool_use 输入流结束，仍在执行中）
   * 将 isStreaming 设为 false，但保留 isExecuting
   */
  function handleMessageStop(session, data) {
    const messageId = data?.messageId
    if (!messageId) return

    const msg = session.messages.find(m => m.id === messageId)
    if (msg) {
      msg.isStreaming = false
    }
  }

  /**
   * 处理消息字段更新（来自后端）
   */
  function handleMessageUpdate(session, data) {
    const { messageId, updates } = data


    // 查找对应的消息
    const msgIndex = session.messages.findIndex(m => m.id === messageId)
    if (msgIndex === -1) {
      log('[SessionStore] handleMessageUpdate: message not found', messageId)
      return
    }

    // 应用更新
    const msg = session.messages[msgIndex]
    const mergedUpdates = {
      ...updates
    }
    if (mergedUpdates.toolInput == null) {
      delete mergedUpdates.toolInput
    }
    if (updates.toolInput && typeof updates.toolInput === 'object') {
      mergedUpdates.toolInput = {
        ...(msg.toolInput || {}),
        ...updates.toolInput
      }
    }
    Object.assign(msg, mergedUpdates)
    if ((mergedUpdates.isStreaming === false || mergedUpdates.isExecuting === false) && !msg.duration && msg.startTime) {
      msg.duration = Date.now() - msg.startTime
    }

    if (msg.role === 'assistant') {
      syncUserRealtimeStats(session, {
        turnNumber: mergedUpdates.turnNumber ?? msg.turnNumber,
        usage: mergedUpdates.usage ?? msg.usage,
        usageSourceKey: `main:${msg.id}`
      })
    }

    log('[SessionStore] handleMessageUpdate:', messageId, 'updates:', Object.keys(mergedUpdates))

    // 处理 TodoWrite 工具：显示在悬浮窗中
    if (msg.role === 'tool_use' && msg.toolName === 'TodoWrite' && mergedUpdates.toolInput?.todos) {
      log('[SessionStore] TodoWrite detected in handleMessageUpdate:', {
        toolUseId: messageId,
        todosCount: mergedUpdates.toolInput.todos.length
      })
      handleTodoWrite(session, messageId, mergedUpdates.toolInput.todos)
    }
  }

  function handleToolResult(session, data) {
    const toolUseId = data?.toolUseId
    if (!toolUseId) return

    for (let i = session.messages.length - 1; i >= 0; i--) {
      const msg = session.messages[i]
      if (msg.role === 'question' && msg.tool_use_id === toolUseId) {
        msg.resultReceived = true
        msg.receivedAnswers = data.answers || null
        msg.answersConsistent = data.answers ? compareAnswers(msg.userAnswers, data.answers) : true
        return
      }
    }

    for (let i = session.messages.length - 1; i >= 0; i--) {
      const msg = session.messages[i]
      if ((msg.role === 'tool_use' || msg.role === 'diff') && (msg.id === toolUseId || msg.request_id === toolUseId)) {
        msg.isExecuting = false
        msg.isError = !!data.isError
        msg.result = data.content || '(无输出)'
        if (data.usage) {
          msg.usage = data.usage
        }
        if (!msg.duration && msg.startTime) {
          msg.duration = Date.now() - msg.startTime
        }
        if (msg.role === 'tool_use' && msg.toolName === 'Agent') {
          setUserUsageSource(session, `execution:${toolUseId}`, data.usage)
        }
        return
      }
    }
  }

  /**
   * 处理 message-result 事件（来自 adapter 的 tool_result）
   * 替代旧的 tool-result + message-update 双事件
   */
  function handleMessageResult(session, data) {
    const messageId = data?.messageId
    if (!messageId) return

    // 处理 AskUserQuestion 响应
    if (data.answers) {
      for (let i = session.messages.length - 1; i >= 0; i--) {
        const msg = session.messages[i]
        if (msg.role === 'question' && msg.tool_use_id === messageId) {
          msg.resultReceived = true
          msg.receivedAnswers = data.answers || null
          msg.answersConsistent = data.answers ? compareAnswers(msg.userAnswers, data.answers) : true
          return
        }
      }
    }

    // 更新对应 tool_use/diff 消息
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const msg = session.messages[i]
      if ((msg.role === 'tool_use' || msg.role === 'diff') && (msg.id === messageId || msg.request_id === messageId)) {
        msg.isExecuting = false
        msg.isError = !!data.isError
        msg.result = data.content || '(无输出)'
        if (data.usage) {
          msg.usage = data.usage
        }
        if (!msg.duration && msg.startTime) {
          msg.duration = Date.now() - msg.startTime
        }
        if (msg.role === 'tool_use' && msg.toolName === 'Agent') {
          setUserUsageSource(session, `execution:${messageId}`, data.usage)
        }
        return
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
    const toolUseId = requestData.tool_use_id || requestData.toolUseId || requestData.id || data.tool_use_id

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
      request_id: outerRequestId || requestData.request_id,
      tool_use_id: toolUseId, // 确保 tool_use_id 被保留
      input: toolInput, // 使用解析后的 input
      ccgui: data.ccgui || requestData.ccgui || null
    }

    log('[SessionStore] mergedRequestData:', JSON.stringify(mergedRequestData, null, 2))

    const hasQuestions = toolInput?.questions || requestData.questions

    if (toolName === 'AskUserQuestion' || hasQuestions) {
      log('[SessionStore] Setting pendingQuestion, request_id:', mergedRequestData.request_id)
      session.pendingQuestion = mergedRequestData
    } else {
      // 添加到队列而不是覆盖
      log('[SessionStore] Adding to pendingControlRequests queue, toolName:', toolName, 'request_id:', mergedRequestData.request_id)
      session.pendingControlRequests.push(mergedRequestData)
    }
  }

  function removePendingPermission(session, requestId) {
    if (!session || !requestId) return null

    const index = session.pendingPermissions.findIndex(permission =>
      permission?.request_id === requestId ||
      permission?.tool_use_id === requestId ||
      permission?.id === requestId
    )

    if (index === -1) return null
    return session.pendingPermissions.splice(index, 1)[0] || null
  }

  function removePendingControlRequest(session, requestId) {
    if (!session || !requestId) return null

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
    session.isProcessing = false
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

    session.messages.push(unknownMsg)
  }

  function handleResidualManagerEvent(session, data) {
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

  /**
   * 处理运行时进程异常退出
   */
  function handleAbnormalExit(session, data) {
    log('[SessionStore] handleAbnormalExit:', data)

    // 停止所有正在流式传输的消息
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const msg = session.messages[i]

      // 停止流式传输的 assistant 消息
      if (msg.isStreaming) {
        msg.isStreaming = false
        if (msg.startTime && !msg.duration) {
          msg.duration = Date.now() - msg.startTime
        }
      }

      // 停止正在执行的工具
      if (msg.isExecuting) {
        msg.isExecuting = false
        if (msg.startTime && !msg.duration) {
          msg.duration = Date.now() - msg.startTime
        }
      }
    }

    // 停止处理状态
    session.isProcessing = false
    session.runtimeReady = false

    // 添加异常退出提示消息（使用 system_notification 类型，显示为居中通知样式）
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
    session.messages.push(exitMsg)
  }

  /**
   * 处理正常退出（用户手动停止）
   */
  function handleNormalExit(session, data) {
    // 停止所有正在执行的工具和流式传输
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const msg = session.messages[i]

      // 停止流式传输的 assistant 消息
      if (msg.isStreaming) {
        msg.isStreaming = false
        if (msg.startTime && !msg.duration) {
          msg.duration = Date.now() - msg.startTime
        }
      }

      // 停止正在执行的工具
      if (msg.isExecuting) {
        msg.isExecuting = false
        if (msg.startTime && !msg.duration) {
          msg.duration = Date.now() - msg.startTime
        }
      }
    }

    // 停止处理状态
    session.isProcessing = false
    session.runtimeReady = false

    // 添加正常停止提示消息（使用 system_notification 类型，显示为居中通知样式）
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
    session.messages.push(exitMsg)
  }

  /**
   * 处理系统通知（权限模式切换、快速模式切换、压缩边界等）
   * 添加到消息列表显示为系统通知气泡
   */
  function handleSystemNotification(session, data) {
    log('[SessionStore] handleSystemNotification:', data)

    if (data?.type === 'session-runtime-starting' || data?.type === 'session-runtime-restarting') {
      session.runtimeReady = false
    } else if (data?.type === 'session-runtime-ready') {
      session.runtimeReady = true
    }

    const operationId = typeof data?.operationId === 'string' ? data.operationId : ''
    if (
      operationId && (
        data.type === 'session-runtime-ready' ||
        data.type === 'session-config-applied' ||
        data.type === 'session-effort-changed'
      )
    ) {
      const pendingMessage = [...session.messages].reverse().find(message =>
        message.role === 'system_notification' &&
        (message.notificationType === 'session-runtime-starting' || message.notificationType === 'session-runtime-restarting') &&
        message.data?.operationId === operationId
      )

      if (pendingMessage) {
        const applyUpdate = () => {
          pendingMessage.notificationType = data.type
          pendingMessage.scope = resolveNotificationScope(data.type, data)
          pendingMessage.data = {
            ...pendingMessage.data,
            ...data,
            completedAt: Date.now(),
            durationMs: data.durationMs ?? pendingMessage.data?.durationMs ?? null
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

    // 创建系统通知消息
    const notificationMsg = {
      id: `system-notification-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'system_notification',
      notificationType: data.type,
      scope: resolveNotificationScope(data.type, data),
      data: data,
      timestamp: new Date()
    }

    session.messages.push(notificationMsg)
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
   * 处理子任务事件（started/progress/notification）
   */
  function handleTaskEvent(session, data) {
    const { eventType, taskId } = data

    if (eventType === 'started') {
      const agentId = resolveAgentIdFromCcguiPayload(data.ccgui)
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
        task.description = data.description || task.description
        task.agentId = task.agentId || resolveAgentIdFromCcguiPayload(data.ccgui)
        task.ccgui = data.ccgui || task.ccgui || null
        log('[SessionStore] Task progress:', taskId, data.summary)
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
        const existingTaskComplete = session.messages.find(message =>
          message?.role === 'task_complete' && message?.taskId === taskId
        )
        if (!existingTaskComplete) {
          session.messages.push({
            id: `task-complete-${taskId}`,
            role: 'task_complete',
            taskId: taskId,
            taskType: task.taskType,
            description: task.description,
            summary: task.summary,
            usage: task.usage,
            ccgui: taskCcgui,
            duration: Date.now() - task.startTime,
            timestamp: new Date()
          })
        }
        // 从活跃列表移除
        session.activeTasks.delete(taskId)
        rebuildAgentSemanticState(session)
        log('[SessionStore] Task completed:', taskId)
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
    // 移除之前的 status 消息（如果有的话）
    const existingStatusIndex = session.messages.findIndex(m => m.role === 'status')
    if (existingStatusIndex >= 0) {
      session.messages.splice(existingStatusIndex, 1)
    }

    // 构建更详细的错误消息
    let displayMessage = data.message || ''
    if (data.type === 'error') {
      // 尝试提取更多有用的错误信息
      const parts = [data.message]

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

    // 添加新的 status 消息
    if (displayMessage) {
      session.messages.push({
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
      session.messages.push(message)
      rebuildAgentSemanticState(session)
    }
  }

  /**
   * 更新指定消息（用于 tool_use 结果更新等）
   */
  function updateMessage(predicate, updates) {
    const session = currentSession.value
    if (!session) return false

    const index = session.messages.findIndex(predicate)
    if (index !== -1) {
      session.messages[index] = { ...session.messages[index], ...updates }
      rebuildAgentSemanticState(session)
      return true
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
      const currentPermission = requestId
        ? session.pendingPermissions.find(permission =>
            permission?.request_id === requestId ||
            permission?.tool_use_id === requestId ||
            permission?.id === requestId
          ) || null
        : (session.pendingPermissions[0] || null)
      const currentRequest = requestId
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
          currentPermission.request_id || currentPermission.tool_use_id || currentPermission.id
        )
      }
      if (currentRequest) {
        removePendingControlRequest(
          session,
          currentRequest.request_id || currentRequest.tool_use_id || currentRequest.id
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
    sendControlResponse,
    sendRuntimeToolResult,
    sendInterrupt,
    sendControlRequest,
    setSessionModel,
    listSessionSubmodels,
    getAvailableTargets,
    setSessionSubmodel,
    setSessionTarget,
    listSessionEffortOptions,
    setSessionEffort,
    setPermissionMode,
    startEventListener,
    stopEventListener,
    clearAll,
    addMessage,
    updateMessage,
    getMessageAgentId,
    setPendingPermission,
    setPendingControlRequest,
    clearPendingPermissions,
    clearPendingQuestion
  }
})
