/**
 * 历史管理器
 * 正式历史结构只包含：
 * - history/index.jsonl
 * - history/turns/<turnId>.jsonl
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const logger = require('../logger')

function getHistoryRoot() {
  return path.join(os.homedir(), '.ccgui', 'projects')
}

function getSessionHistoryDir(projectId, sessionId) {
  return path.join(getHistoryRoot(), projectId, 'sessions', sessionId, 'history')
}

function getIndexFilePath(projectId, sessionId) {
  return path.join(getSessionHistoryDir(projectId, sessionId), 'index.jsonl')
}

function getMetadataFilePath(projectId, sessionId) {
  return path.join(getSessionHistoryDir(projectId, sessionId), 'metadata.json')
}

function getTurnsDirPath(projectId, sessionId) {
  return path.join(getSessionHistoryDir(projectId, sessionId), 'turns')
}

function getTurnStreamFilePath(projectId, sessionId, fileName) {
  return path.join(getTurnsDirPath(projectId, sessionId), fileName)
}

function toSafePathSegment(value, fallback = 'unknown') {
  const rawValue = String(value || '').trim() || fallback
  return rawValue.replace(/[/:*?"<>|\\]/g, '-').replace(/\s+/g, ' ').trim()
}

function getReadableSubagentPathName(agentId) {
  const rawAgentId = String(agentId || '').trim()
  if (!rawAgentId) {
    return 'unknown-agent'
  }

  const lastSegment = rawAgentId.split(':').pop() || rawAgentId
  return toSafePathSegment(lastSegment, 'unknown-agent')
}

function getReadableSubagentTurnFileName(turnId) {
  const rawTurnId = String(turnId || '').trim()
  if (!rawTurnId) {
    return 'unknown-turn.jsonl'
  }

  const lastSegment = rawTurnId.split(':').pop() || rawTurnId
  return `${toSafePathSegment(lastSegment, 'unknown-turn')}.jsonl`
}

function getSubagentsDirPath(projectId, sessionId) {
  return path.join(getSessionHistoryDir(projectId, sessionId), 'subagents')
}

function getSubagentHistoryDir(projectId, sessionId, agentId) {
  return path.join(getSubagentsDirPath(projectId, sessionId), getReadableSubagentPathName(agentId))
}

function getSubagentIndexFilePath(projectId, sessionId, agentId) {
  return path.join(getSubagentHistoryDir(projectId, sessionId, agentId), 'index.jsonl')
}

function getSubagentTurnsDirPath(projectId, sessionId, agentId) {
  return path.join(getSubagentHistoryDir(projectId, sessionId, agentId), 'turns')
}

function getSubagentTurnStreamFilePath(projectId, sessionId, agentId, fileName) {
  return path.join(getSubagentTurnsDirPath(projectId, sessionId, agentId), fileName)
}

function ensureHistoryDir(projectId, sessionId) {
  const historyDir = getSessionHistoryDir(projectId, sessionId)
  if (!fs.existsSync(historyDir)) {
    fs.mkdirSync(historyDir, { recursive: true })
    logger.info('[HistoryManager] Created history directory', { projectId, sessionId })
  }
}

function ensureTurnsDir(projectId, sessionId) {
  const turnsDir = getTurnsDirPath(projectId, sessionId)
  if (!fs.existsSync(turnsDir)) {
    fs.mkdirSync(turnsDir, { recursive: true })
  }
}

function ensureSubagentHistoryDir(projectId, sessionId, agentId) {
  const subagentDir = getSubagentHistoryDir(projectId, sessionId, agentId)
  if (!fs.existsSync(subagentDir)) {
    fs.mkdirSync(subagentDir, { recursive: true })
  }
}

function ensureSubagentTurnsDir(projectId, sessionId, agentId) {
  const turnsDir = getSubagentTurnsDirPath(projectId, sessionId, agentId)
  if (!fs.existsSync(turnsDir)) {
    fs.mkdirSync(turnsDir, { recursive: true })
  }
}

function createDefaultMetadata() {
  return {
    messageCount: 0,
    lastMessageAt: null,
    totalTokens: {
      input: 0,
      output: 0
    },
    envInfo: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
}

function cloneSerializable(value) {
  if (value === undefined) {
    return null
  }

  return JSON.parse(JSON.stringify(value))
}

function normalizeSubagentRegistrySnapshot(registry = null, fallbackAgentId = null) {
  if (!registry || typeof registry !== 'object') {
    return fallbackAgentId ? { agentId: fallbackAgentId } : null
  }

  const agentId = registry.agentId || registry.agent_id || fallbackAgentId || null
  if (!agentId) {
    return null
  }

  return Object.fromEntries(Object.entries({
    agentId,
    agentKind: registry.agentKind || registry.agent_kind || null,
    agentType: registry.agentType || registry.agent_type || null,
    name: registry.name || null,
    title: registry.title || registry.name || null,
    description: registry.description || registry.prompt || null,
    color: registry.color || registry.agentColor || registry.agent_color || null,
    prompt: registry.prompt || null,
    model: registry.model || null,
    teamId: registry.teamId || registry.team_id || null,
    parentAgentId: registry.parentAgentId || registry.parent_agent_id || null,
    status: registry.status || null,
    canWrite: registry.canWrite !== undefined ? Boolean(registry.canWrite) : null,
    interactionMode: registry.interactionMode || registry.interaction_mode || null
  }).filter(([, value]) => value !== null))
}

function mergeSubagentRegistrySnapshot(current = null, patch = null) {
  if (!current && !patch) {
    return null
  }

  return {
    ...(current || {}),
    ...(patch || {})
  }
}

function createTurnIndexEntry(message = {}) {
  const turnId = String(message.id || message.uuid || `turn-${Date.now()}`)
  const normalizedContent = typeof message.content === 'string'
    ? message.content
    : (typeof message.serializedContent === 'string' ? message.serializedContent : '')

  return {
    entryType: 'turn',
    turnId,
    schemaVersion: 1,
    userMessageId: turnId,
    userText: normalizedContent,
    serializedContent: typeof message.serializedContent === 'string'
      ? message.serializedContent
      : normalizedContent,
    attachments: cloneSerializable(Array.isArray(message.attachments) ? message.attachments : []),
    createdAt: message.timestamp || new Date().toISOString(),
    updatedAt: message.timestamp || new Date().toISOString(),
    streamFile: `${turnId}.jsonl`,
    status: 'pending',
    hasAssistantResponse: false,
    eventCount: 0
  }
}

function createIndexMessageEntry(message = {}) {
  const messageId = String(message.id || `index-message-${Date.now()}`)
  return {
    entryType: 'message',
    messageId,
    createdAt: message.timestamp || new Date().toISOString(),
    updatedAt: message.timestamp || new Date().toISOString(),
    message: cloneSerializable({
      ...message,
      id: messageId
    })
  }
}

function extractSubagentInputTextFromPayload(payload = {}, history = {}) {
  if (payload?.role === 'user') {
    return typeof payload.content === 'string'
      ? payload.content
      : (typeof payload.serializedContent === 'string' ? payload.serializedContent : '')
  }

  if (payload?.role === 'tool_use' && payload?.toolName === 'SendMessage') {
    return (
      payload?.toolInput?.content ||
      payload?.toolInput?.summary ||
      payload?.toolInput?.prompt ||
      ''
    )
  }

  if (payload?.role === 'tool_use' && payload?.toolName === 'ReceiveMessage') {
    return (
      payload?.toolInput?.content ||
      payload?.toolInput?.summary ||
      ''
    )
  }

  return history?.inputText || ''
}

function resolveSourceUserTurnText(projectId, sessionId, sourceUserTurnId) {
  if (!sourceUserTurnId) {
    return ''
  }

  const sourceTurn = loadIndexEntries(projectId, sessionId)
    .find(entry => entry?.entryType === 'turn' && entry?.turnId === sourceUserTurnId)

  if (!sourceTurn) {
    return ''
  }

  return typeof sourceTurn.userText === 'string'
    ? sourceTurn.userText
    : (typeof sourceTurn.serializedContent === 'string' ? sourceTurn.serializedContent : '')
}

function createSubagentTurnEntry(projectId, sessionId, agentId, turnId, event = {}) {
  const payload = event?.data || {}
  const history = payload?.ccgui?.history || {}
  const timestamp = event?.timestamp || payload?.timestamp || new Date().toISOString()
  const inputText = resolveSourceUserTurnText(projectId, sessionId, history?.sourceUserTurnId)
    || extractSubagentInputTextFromPayload(payload, history)
  const registry = normalizeSubagentRegistrySnapshot(payload?.ccgui?.registry, agentId)

  return {
    entryType: 'subagent-turn',
    schemaVersion: 1,
    agentId,
    turnId,
    sourceUserTurnId: history?.sourceUserTurnId || null,
    inputKind: history?.inputKind || null,
    deliveryKind: history?.deliveryKind || null,
    senderAgentId: history?.senderAgentId || null,
    targetAgentId: history?.targetAgentId || agentId,
    inputText,
    registry,
    createdAt: timestamp,
    updatedAt: timestamp,
    streamFile: getReadableSubagentTurnFileName(turnId),
    status: 'pending',
    hasAssistantResponse: false,
    eventCount: 0
  }
}

function serializeMessage(message) {
  return JSON.stringify(message, (key, value) => {
    if (value instanceof Date) {
      return { __type: 'Date', value: value.toISOString() }
    }
    if (value instanceof Set) {
      return { __type: 'Set', value: Array.from(value) }
    }
    if (value instanceof Map) {
      return { __type: 'Map', value: Array.from(value.entries()) }
    }
    return value
  })
}

function deserializeMessage(jsonStr) {
  return JSON.parse(jsonStr, (key, value) => {
    if (value && typeof value === 'object') {
      if (value.__type === 'Date') {
        return new Date(value.value)
      }
      if (value.__type === 'Set') {
        return new Set(value.value)
      }
      if (value.__type === 'Map') {
        return new Map(value.value)
      }
    }
    return value
  })
}

function loadJsonLines(filePath) {
  if (!fs.existsSync(filePath)) {
    return []
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.trim()) {
    return []
  }

  const items = []
  for (const line of content.trim().split('\n')) {
    if (!line.trim()) continue
    try {
      items.push(deserializeMessage(line))
    } catch (error) {
      logger.warn('[HistoryManager] Failed to parse jsonl line', {
        filePath,
        line: line.substring(0, 100),
        error: error.message
      })
    }
  }
  return items
}

function writeJsonLines(filePath, items = []) {
  const normalizedItems = Array.isArray(items) ? items : []
  const content = normalizedItems.length > 0
    ? `${normalizedItems.map(item => serializeMessage(item)).join('\n')}\n`
    : ''
  fs.writeFileSync(filePath, content, 'utf-8')
}

function resolveStoredSubagentPathNames(projectId, sessionId) {
  try {
    const subagentsDir = getSubagentsDirPath(projectId, sessionId)
    if (!fs.existsSync(subagentsDir)) {
      return []
    }

    return fs.readdirSync(subagentsDir, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)
      .filter(Boolean)
      .sort()
  } catch (error) {
    logger.error('[HistoryManager] Failed to list stored subagent path names', {
      projectId,
      sessionId,
      error: error.message
    })
    return []
  }
}

function listSubagentIds(projectId, sessionId) {
  try {
    return resolveStoredSubagentPathNames(projectId, sessionId)
      .map(pathName => {
        const indexPath = path.join(getSubagentsDirPath(projectId, sessionId), pathName, 'index.jsonl')
        const entries = loadJsonLines(indexPath)
        return entries[0]?.agentId || entries[0]?.registry?.agentId || pathName
      })
      .filter(Boolean)
  } catch (error) {
    logger.error('[HistoryManager] Failed to list subagent ids', {
      projectId,
      sessionId,
      error: error.message
    })
    return []
  }
}

function loadMetadata(projectId, sessionId) {
  try {
    const metadataPath = getMetadataFilePath(projectId, sessionId)
    if (!fs.existsSync(metadataPath)) {
      return createDefaultMetadata()
    }
    return JSON.parse(fs.readFileSync(metadataPath, 'utf-8'))
  } catch (error) {
    logger.error('[HistoryManager] Failed to load metadata', {
      projectId,
      sessionId,
      error: error.message
    })
    return createDefaultMetadata()
  }
}

function saveMetadata(projectId, sessionId, metadata) {
  try {
    ensureHistoryDir(projectId, sessionId)
    const metadataPath = getMetadataFilePath(projectId, sessionId)
    metadata.updatedAt = new Date().toISOString()
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8')
    return true
  } catch (error) {
    logger.error('[HistoryManager] Failed to save metadata', {
      projectId,
      sessionId,
      error: error.message
    })
    return false
  }
}

function updateSessionEnvInfo(projectId, sessionId, envInfo) {
  try {
    const metadata = loadMetadata(projectId, sessionId)
    metadata.envInfo = cloneSerializable(envInfo)
    return saveMetadata(projectId, sessionId, metadata)
  } catch (error) {
    logger.error('[HistoryManager] Failed to update session envInfo', {
      projectId,
      sessionId,
      error: error.message
    })
    return false
  }
}

function loadIndexEntries(projectId, sessionId) {
  try {
    const indexPath = getIndexFilePath(projectId, sessionId)
    return fs.existsSync(indexPath) ? loadJsonLines(indexPath) : []
  } catch (error) {
    logger.error('[HistoryManager] Failed to load index entries', {
      projectId,
      sessionId,
      error: error.message
    })
    return []
  }
}

function saveIndexEntries(projectId, sessionId, entries = []) {
  try {
    ensureHistoryDir(projectId, sessionId)
    writeJsonLines(getIndexFilePath(projectId, sessionId), entries)

    const metadata = loadMetadata(projectId, sessionId)
    metadata.messageCount = Array.isArray(entries) ? entries.length : 0
    const lastEntry = Array.isArray(entries) && entries.length > 0 ? entries[entries.length - 1] : null
    metadata.lastMessageAt = lastEntry?.updatedAt || lastEntry?.createdAt || metadata.lastMessageAt || null
    saveMetadata(projectId, sessionId, metadata)
    return true
  } catch (error) {
    logger.error('[HistoryManager] Failed to save index entries', {
      projectId,
      sessionId,
      error: error.message
    })
    return false
  }
}

function appendTurn(projectId, sessionId, message) {
  try {
    ensureHistoryDir(projectId, sessionId)
    ensureTurnsDir(projectId, sessionId)

    const entries = loadIndexEntries(projectId, sessionId)
    const nextEntry = createTurnIndexEntry(message)
    const existingIndex = entries.findIndex(turn => turn.turnId === nextEntry.turnId)

    if (existingIndex >= 0) {
      entries[existingIndex] = {
        ...entries[existingIndex],
        ...nextEntry,
        updatedAt: new Date().toISOString()
      }
    } else {
      entries.push(nextEntry)
    }

    saveIndexEntries(projectId, sessionId, entries)
    return nextEntry
  } catch (error) {
    logger.error('[HistoryManager] Failed to append turn', {
      projectId,
      sessionId,
      error: error.message
    })
    return null
  }
}

function appendMessage(projectId, sessionId, message) {
  if (!message || typeof message !== 'object') {
    return false
  }

  if (message.role === 'user') {
    return Boolean(appendTurn(projectId, sessionId, message))
  }

  return Boolean(appendIndexMessage(projectId, sessionId, message))
}

function appendIndexMessage(projectId, sessionId, message) {
  try {
    ensureHistoryDir(projectId, sessionId)
    const entries = loadIndexEntries(projectId, sessionId)
    const nextEntry = createIndexMessageEntry(message)
    const existingIndex = entries.findIndex(entry =>
      entry?.entryType === 'message' && entry?.messageId === nextEntry.messageId
    )

    if (existingIndex >= 0) {
      entries[existingIndex] = {
        ...entries[existingIndex],
        ...nextEntry,
        updatedAt: new Date().toISOString()
      }
    } else {
      entries.push(nextEntry)
    }

    saveIndexEntries(projectId, sessionId, entries)
    return nextEntry
  } catch (error) {
    logger.error('[HistoryManager] Failed to append index message', {
      projectId,
      sessionId,
      error: error.message
    })
    return null
  }
}

function updateIndexMessage(projectId, sessionId, messageId, updates = {}) {
  try {
    const entries = loadIndexEntries(projectId, sessionId)
    const entryIndex = entries.findIndex(entry =>
      entry?.entryType === 'message' && entry?.messageId === messageId
    )
    if (entryIndex === -1) {
      return false
    }

    const currentMessage = entries[entryIndex]?.message || {}
    entries[entryIndex] = {
      ...entries[entryIndex],
      updatedAt: new Date().toISOString(),
      message: cloneSerializable({
        ...currentMessage,
        ...updates,
        id: messageId
      })
    }

    return saveIndexEntries(projectId, sessionId, entries)
  } catch (error) {
    logger.error('[HistoryManager] Failed to update index message', {
      projectId,
      sessionId,
      messageId,
      error: error.message
    })
    return false
  }
}

function updateTurn(projectId, sessionId, turnId, updates = {}) {
  try {
    const entries = loadIndexEntries(projectId, sessionId)
    const entryIndex = entries.findIndex(entry => entry?.turnId === turnId)
    if (entryIndex === -1) {
      return false
    }

    entries[entryIndex] = {
      ...entries[entryIndex],
      ...cloneSerializable(updates),
      updatedAt: new Date().toISOString()
    }

    return saveIndexEntries(projectId, sessionId, entries)
  } catch (error) {
    logger.error('[HistoryManager] Failed to update turn', {
      projectId,
      sessionId,
      turnId,
      error: error.message
    })
    return false
  }
}

function appendTurnEvent(projectId, sessionId, turnId, event) {
  try {
    const entries = loadIndexEntries(projectId, sessionId)
    const entryIndex = entries.findIndex(entry => entry?.turnId === turnId)
    if (entryIndex === -1) {
      return false
    }

    ensureHistoryDir(projectId, sessionId)
    ensureTurnsDir(projectId, sessionId)

    const turn = entries[entryIndex]
    const streamPath = getTurnStreamFilePath(projectId, sessionId, turn.streamFile)
    fs.appendFileSync(streamPath, `${serializeMessage(event)}\n`, 'utf-8')

    entries[entryIndex] = {
      ...turn,
      ...buildTurnEventUpdates(turn, event)
    }
    saveIndexEntries(projectId, sessionId, entries)
    return true
  } catch (error) {
    logger.error('[HistoryManager] Failed to append turn event', {
      projectId,
      sessionId,
      turnId,
      error: error.message
    })
    return false
  }
}

function buildTurnEventUpdates(turn, event) {
  const payload = event?.data || null
  const nextUpdates = {
    eventCount: Number(turn.eventCount || 0) + 1,
    updatedAt: new Date().toISOString()
  }
  const registryPatch = normalizeSubagentRegistrySnapshot(payload?.ccgui?.registry, turn?.agentId)
  if (registryPatch) {
    nextUpdates.registry = mergeSubagentRegistrySnapshot(turn?.registry || null, registryPatch)
  }

  if ((event?.eventType === 'message-start' || event?.eventType === 'message') && payload?.role === 'assistant') {
    nextUpdates.hasAssistantResponse = true
    nextUpdates.status = payload?.isStreaming ? 'streaming' : 'completed'
  } else if (event?.eventType === 'result') {
    nextUpdates.status = 'completed'
  } else if (
    event?.eventType === 'abnormal-exit' ||
    (event?.eventType === 'system-notification' && payload?.type === 'turn-error')
  ) {
    nextUpdates.status = 'error'
  } else if (event?.eventType === 'message-start' && payload?.role !== 'user') {
    nextUpdates.status = 'streaming'
  }

  return nextUpdates
}

function loadTurnEvents(projectId, sessionId, turnId) {
  try {
    const entries = loadIndexEntries(projectId, sessionId)
    const turn = entries.find(item => item.turnId === turnId)
    if (!turn?.streamFile) {
      return []
    }

    return loadJsonLines(getTurnStreamFilePath(projectId, sessionId, turn.streamFile))
  } catch (error) {
    logger.error('[HistoryManager] Failed to load turn events', {
      projectId,
      sessionId,
      turnId,
      error: error.message
    })
    return []
  }
}

function updateMessage(projectId, sessionId, messageId, updates) {
  return updateIndexMessage(projectId, sessionId, messageId, updates)
}

function loadSubagentIndexEntries(projectId, sessionId, agentId) {
  try {
    const indexPath = getSubagentIndexFilePath(projectId, sessionId, agentId)
    return fs.existsSync(indexPath) ? loadJsonLines(indexPath) : []
  } catch (error) {
    logger.error('[HistoryManager] Failed to load subagent index entries', {
      projectId,
      sessionId,
      agentId,
      error: error.message
    })
    return []
  }
}

function saveSubagentIndexEntries(projectId, sessionId, agentId, entries = []) {
  try {
    ensureSubagentHistoryDir(projectId, sessionId, agentId)
    ensureSubagentTurnsDir(projectId, sessionId, agentId)
    writeJsonLines(getSubagentIndexFilePath(projectId, sessionId, agentId), entries)
    return true
  } catch (error) {
    logger.error('[HistoryManager] Failed to save subagent index entries', {
      projectId,
      sessionId,
      agentId,
      error: error.message
    })
    return false
  }
}

function ensureSubagentTurn(projectId, sessionId, agentId, turnId, event = null) {
  if (!agentId || !turnId) {
    return null
  }

  const entries = loadSubagentIndexEntries(projectId, sessionId, agentId)
  const existingEntryIndex = entries.findIndex(entry => entry?.turnId === turnId)
  if (existingEntryIndex >= 0) {
    return entries[existingEntryIndex]
  }

  const nextEntry = createSubagentTurnEntry(projectId, sessionId, agentId, turnId, event || {})
  entries.push(nextEntry)
  saveSubagentIndexEntries(projectId, sessionId, agentId, entries)
  return nextEntry
}

function appendSubagentTurnEvent(projectId, sessionId, agentId, turnId, event) {
  try {
    if (!agentId || !turnId) {
      return false
    }

    const entries = loadSubagentIndexEntries(projectId, sessionId, agentId)
    let entryIndex = entries.findIndex(entry => entry?.turnId === turnId)
    if (entryIndex === -1) {
      const nextEntry = createSubagentTurnEntry(projectId, sessionId, agentId, turnId, event)
      entries.push(nextEntry)
      entryIndex = entries.length - 1
    }

    ensureSubagentHistoryDir(projectId, sessionId, agentId)
    ensureSubagentTurnsDir(projectId, sessionId, agentId)

    const turn = entries[entryIndex]
    const streamPath = getSubagentTurnStreamFilePath(projectId, sessionId, agentId, turn.streamFile)
    fs.appendFileSync(streamPath, `${serializeMessage(event)}\n`, 'utf-8')

    entries[entryIndex] = {
      ...turn,
      ...buildTurnEventUpdates(turn, event)
    }
    saveSubagentIndexEntries(projectId, sessionId, agentId, entries)
    return true
  } catch (error) {
    logger.error('[HistoryManager] Failed to append subagent turn event', {
      projectId,
      sessionId,
      agentId,
      turnId,
      error: error.message
    })
    return false
  }
}

function loadSubagentTurnEvents(projectId, sessionId, agentId, turnId) {
  try {
    const entries = loadSubagentIndexEntries(projectId, sessionId, agentId)
    const turn = entries.find(item => item.turnId === turnId)
    if (!turn?.streamFile) {
      return []
    }

    return loadJsonLines(getSubagentTurnStreamFilePath(projectId, sessionId, agentId, turn.streamFile))
  } catch (error) {
    logger.error('[HistoryManager] Failed to load subagent turn events', {
      projectId,
      sessionId,
      agentId,
      turnId,
      error: error.message
    })
    return []
  }
}

function loadAllSubagentHistories(projectId, sessionId) {
  return resolveStoredSubagentPathNames(projectId, sessionId).map(pathName => {
    const entries = loadJsonLines(path.join(getSubagentsDirPath(projectId, sessionId), pathName, 'index.jsonl'))
    const agentId = entries[0]?.agentId || entries[0]?.registry?.agentId || pathName

    return {
      agentId,
      entries,
      registry: entries
      .map(entry => entry?.registry || null)
      .reduce((acc, registry) => mergeSubagentRegistrySnapshot(acc, registry), { agentId })
    }
  })
}

function deleteHistory(projectId, sessionId) {
  try {
    const historyDir = getSessionHistoryDir(projectId, sessionId)
    if (fs.existsSync(historyDir)) {
      fs.rmSync(historyDir, { recursive: true })
      return true
    }
    return false
  } catch (error) {
    logger.error('[HistoryManager] Failed to delete history', {
      projectId,
      sessionId,
      error: error.message
    })
    return false
  }
}

function hasHistoryIndex(projectId, sessionId) {
  return fs.existsSync(getIndexFilePath(projectId, sessionId))
}

module.exports = {
  getSessionHistoryDir,
  getIndexFilePath,
  getMetadataFilePath,
  getTurnsDirPath,
  getTurnStreamFilePath,
  getSubagentsDirPath,
  getSubagentHistoryDir,
  getSubagentIndexFilePath,
  getSubagentTurnsDirPath,
  getSubagentTurnStreamFilePath,
  loadMetadata,
  saveMetadata,
  updateSessionEnvInfo,
  appendMessage,
  appendTurn,
  appendIndexMessage,
  updateTurn,
  updateIndexMessage,
  appendTurnEvent,
  ensureSubagentTurn,
  appendSubagentTurnEvent,
  updateMessage,
  loadIndexEntries,
  loadTurnEvents,
  loadSubagentIndexEntries,
  loadSubagentTurnEvents,
  loadAllSubagentHistories,
  deleteHistory,
  saveIndexEntries,
  saveSubagentIndexEntries,
  listSubagentIds,
  hasHistoryIndex
}
