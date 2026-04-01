/**
 * 历史管理器
 * 管理聊天历史记录的存储和加载
 * 直接保存/加载界面显示用的 message 对象
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const logger = require('../logger')

/**
 * 获取历史记录根目录
 */
function getHistoryRoot() {
  return path.join(os.homedir(), '.ccgui', 'projects')
}

/**
 * 获取会话历史目录路径
 * @param {string} projectId - 项目ID
 * @param {string} sessionId - 会话ID
 */
function getSessionHistoryDir(projectId, sessionId) {
  return path.join(getHistoryRoot(), projectId, 'sessions', sessionId, 'history')
}

/**
 * 获取消息历史文件路径
 * @param {string} projectId - 项目ID
 * @param {string} sessionId - 会话ID
 */
function getMessagesFilePath(projectId, sessionId) {
  return path.join(getSessionHistoryDir(projectId, sessionId), 'messages.jsonl')
}

/**
 * 获取元数据文件路径
 * @param {string} projectId - 项目ID
 * @param {string} sessionId - 会话ID
 */
function getMetadataFilePath(projectId, sessionId) {
  return path.join(getSessionHistoryDir(projectId, sessionId), 'metadata.json')
}

/**
 * 获取语义事件历史文件路径
 * @param {string} projectId - 项目ID
 * @param {string} sessionId - 会话ID
 */
function getSemanticEventsFilePath(projectId, sessionId) {
  return path.join(getSessionHistoryDir(projectId, sessionId), 'semantic-events.jsonl')
}

function getSessionEventsFilePath(projectId, sessionId) {
  return path.join(getSessionHistoryDir(projectId, sessionId), 'session-events.jsonl')
}

function getTurnIndexFilePath(projectId, sessionId) {
  return path.join(getSessionHistoryDir(projectId, sessionId), 'turn-index.json')
}

function getTurnsDirPath(projectId, sessionId) {
  return path.join(getSessionHistoryDir(projectId, sessionId), 'turns')
}

function getTurnStreamFilePath(projectId, sessionId, fileName) {
  return path.join(getTurnsDirPath(projectId, sessionId), fileName)
}

/**
 * 确保历史目录存在
 * @param {string} projectId - 项目ID
 * @param {string} sessionId - 会话ID
 */
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

/**
 * 创建默认元数据
 */
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

function loadJsonLines(filePath) {
  if (!fs.existsSync(filePath)) {
    return []
  }

  const content = fs.readFileSync(filePath, 'utf-8')
  if (!content.trim()) {
    return []
  }

  const lines = content.trim().split('\n')
  const items = []
  for (const line of lines) {
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

/**
 * 加载元数据
 * @param {string} projectId - 项目ID
 * @param {string} sessionId - 会话ID
 * @returns {object} 元数据对象
 */
function loadMetadata(projectId, sessionId) {
  try {
    const metadataPath = getMetadataFilePath(projectId, sessionId)

    if (!fs.existsSync(metadataPath)) {
      logger.debug('[HistoryManager] Metadata file not found, creating default', {
        projectId,
        sessionId
      })
      return createDefaultMetadata()
    }

    const content = fs.readFileSync(metadataPath, 'utf-8')
    return JSON.parse(content)
  } catch (error) {
    logger.error('[HistoryManager] Failed to load metadata', {
      projectId,
      sessionId,
      error: error.message
    })
    return createDefaultMetadata()
  }
}

/**
 * 保存元数据
 * @param {string} projectId - 项目ID
 * @param {string} sessionId - 会话ID
 * @param {object} metadata - 元数据对象
 */
function saveMetadata(projectId, sessionId, metadata) {
  try {
    ensureHistoryDir(projectId, sessionId)

    const metadataPath = getMetadataFilePath(projectId, sessionId)
    metadata.updatedAt = new Date().toISOString()

    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2), 'utf-8')

    logger.debug('[HistoryManager] Saved metadata', { projectId, sessionId })
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

/**
 * 序列化消息（处理 Date 对象等特殊类型）
 * @param {object} message - 消息对象
 * @returns {string} JSON 字符串
 */
function serializeMessage(message) {
  return JSON.stringify(message, (key, value) => {
    // 处理 Date 对象
    if (value instanceof Date) {
      return { __type: 'Date', value: value.toISOString() }
    }
    // 处理 Set
    if (value instanceof Set) {
      return { __type: 'Set', value: Array.from(value) }
    }
    // 处理 Map
    if (value instanceof Map) {
      return { __type: 'Map', value: Array.from(value.entries()) }
    }
    return value
  })
}

/**
 * 反序列化消息（恢复 Date 对象等特殊类型）
 * @param {string} jsonStr - JSON 字符串
 * @returns {object} 消息对象
 */
function deserializeMessage(jsonStr) {
  return JSON.parse(jsonStr, (key, value) => {
    if (value && typeof value === 'object') {
      // 恢复 Date 对象
      if (value.__type === 'Date') {
        return new Date(value.value)
      }
      // 恢复 Set
      if (value.__type === 'Set') {
        return new Set(value.value)
      }
      // 恢复 Map
      if (value.__type === 'Map') {
        return new Map(value.value)
      }
    }
    return value
  })
}

/**
 * 追加消息到历史记录
 * @param {string} projectId - 项目ID
 * @param {string} sessionId - 会话ID
 * @param {object} message - 消息对象
 */
function appendMessage(projectId, sessionId, message) {
  try {
    ensureHistoryDir(projectId, sessionId)

    const messagesPath = getMessagesFilePath(projectId, sessionId)
    const messageLine = serializeMessage(message) + '\n'

    fs.appendFileSync(messagesPath, messageLine, 'utf-8')

    // 更新元数据
    const metadata = loadMetadata(projectId, sessionId)
    metadata.messageCount++
    metadata.lastMessageAt = message.timestamp || new Date().toISOString()

    // 累加 token 统计
    if (message.usage) {
      metadata.totalTokens.input += message.usage.input_tokens || 0
      metadata.totalTokens.output += message.usage.output_tokens || 0
    }

    saveMetadata(projectId, sessionId, metadata)

    logger.debug('[HistoryManager] Appended message', {
      projectId,
      sessionId,
      role: message.role,
      messageCount: metadata.messageCount
    })

    return true
  } catch (error) {
    logger.error('[HistoryManager] Failed to append message', {
      projectId,
      sessionId,
      error: error.message
    })
    return false
  }
}

/**
 * 追加语义事件到历史记录
 * @param {string} projectId
 * @param {string} sessionId
 * @param {object} event
 */
function appendSemanticEvent(projectId, sessionId, event) {
  try {
    ensureHistoryDir(projectId, sessionId)

    const eventsPath = getSemanticEventsFilePath(projectId, sessionId)
    const eventLine = serializeMessage(event) + '\n'

    fs.appendFileSync(eventsPath, eventLine, 'utf-8')

    logger.debug('[HistoryManager] Appended semantic event', {
      projectId,
      sessionId,
      eventType: event?.eventType || event?.type || 'unknown'
    })

    return true
  } catch (error) {
    logger.error('[HistoryManager] Failed to append semantic event', {
      projectId,
      sessionId,
      error: error.message
    })
    return false
  }
}

function appendSessionEvent(projectId, sessionId, event) {
  try {
    ensureHistoryDir(projectId, sessionId)

    const eventsPath = getSessionEventsFilePath(projectId, sessionId)
    const eventLine = serializeMessage(event) + '\n'

    fs.appendFileSync(eventsPath, eventLine, 'utf-8')

    logger.debug('[HistoryManager] Appended session event', {
      projectId,
      sessionId,
      eventType: event?.eventType || 'unknown'
    })

    return true
  } catch (error) {
    logger.error('[HistoryManager] Failed to append session event', {
      projectId,
      sessionId,
      error: error.message
    })
    return false
  }
}

function loadTurnIndex(projectId, sessionId) {
  try {
    const indexPath = getTurnIndexFilePath(projectId, sessionId)
    if (!fs.existsSync(indexPath)) {
      return []
    }

    const content = fs.readFileSync(indexPath, 'utf-8')
    const parsed = JSON.parse(content)
    return Array.isArray(parsed) ? parsed : []
  } catch (error) {
    logger.error('[HistoryManager] Failed to load turn index', {
      projectId,
      sessionId,
      error: error.message
    })
    return []
  }
}

function saveTurnIndex(projectId, sessionId, turns) {
  try {
    ensureHistoryDir(projectId, sessionId)
    const indexPath = getTurnIndexFilePath(projectId, sessionId)
    fs.writeFileSync(indexPath, JSON.stringify(Array.isArray(turns) ? turns : [], null, 2), 'utf-8')
    return true
  } catch (error) {
    logger.error('[HistoryManager] Failed to save turn index', {
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

    const turns = loadTurnIndex(projectId, sessionId)
    const nextEntry = createTurnIndexEntry(message)
    const existingIndex = turns.findIndex(turn => turn.turnId === nextEntry.turnId)

    if (existingIndex >= 0) {
      turns[existingIndex] = {
        ...turns[existingIndex],
        ...nextEntry,
        updatedAt: new Date().toISOString()
      }
    } else {
      turns.push(nextEntry)
    }

    saveTurnIndex(projectId, sessionId, turns)
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

function appendIndexMessage(projectId, sessionId, message) {
  try {
    ensureHistoryDir(projectId, sessionId)
    const entries = loadTurnIndex(projectId, sessionId)
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

    saveTurnIndex(projectId, sessionId, entries)
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
    const entries = loadTurnIndex(projectId, sessionId)
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

    return saveTurnIndex(projectId, sessionId, entries)
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
    const turns = loadTurnIndex(projectId, sessionId)
    const turnIndex = turns.findIndex(turn => turn.turnId === turnId)
    if (turnIndex === -1) {
      return false
    }

    turns[turnIndex] = {
      ...turns[turnIndex],
      ...cloneSerializable(updates),
      updatedAt: new Date().toISOString()
    }

    return saveTurnIndex(projectId, sessionId, turns)
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
    const turns = loadTurnIndex(projectId, sessionId)
    const turnIndex = turns.findIndex(turn => turn.turnId === turnId)
    if (turnIndex === -1) {
      return false
    }

    ensureHistoryDir(projectId, sessionId)
    ensureTurnsDir(projectId, sessionId)

    const turn = turns[turnIndex]
    const streamPath = getTurnStreamFilePath(projectId, sessionId, turn.streamFile)
    fs.appendFileSync(streamPath, serializeMessage(event) + '\n', 'utf-8')

    const payload = event?.data || null
    const nextUpdates = {
      eventCount: Number(turn.eventCount || 0) + 1,
      updatedAt: new Date().toISOString()
    }

    if (
      (event?.eventType === 'message-start' || event?.eventType === 'message') &&
      payload?.role === 'assistant'
    ) {
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

    turns[turnIndex] = {
      ...turn,
      ...nextUpdates
    }
    saveTurnIndex(projectId, sessionId, turns)

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

function loadTurnEvents(projectId, sessionId, turnId) {
  try {
    const turns = loadTurnIndex(projectId, sessionId)
    const turn = turns.find(item => item.turnId === turnId)
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

/**
 * 更新指定消息（通过消息ID）
 * @param {string} projectId - 项目ID
 * @param {string} sessionId - 会话ID
 * @param {string} messageId - 消息ID
 * @param {object} updates - 更新内容
 */
function updateMessage(projectId, sessionId, messageId, updates) {
  try {
    const messages = loadHistory(projectId, sessionId)
    let found = false

    for (let i = 0; i < messages.length; i++) {
      if (messages[i].id === messageId) {
        messages[i] = { ...messages[i], ...updates }
        found = true
        break
      }
    }

    if (found) {
      // 重写整个文件
      saveAllMessages(projectId, sessionId, messages)
      logger.debug('[HistoryManager] Updated message', { projectId, sessionId, messageId })
    }

    return found
  } catch (error) {
    logger.error('[HistoryManager] Failed to update message', {
      projectId,
      sessionId,
      messageId,
      error: error.message
    })
    return false
  }
}

/**
 * 加载会话历史记录
 * @param {string} projectId - 项目ID
 * @param {string} sessionId - 会话ID
 * @returns {Array} 消息数组
 */
function loadHistory(projectId, sessionId) {
  try {
    const messagesPath = getMessagesFilePath(projectId, sessionId)

    if (!fs.existsSync(messagesPath)) {
      logger.debug('[HistoryManager] History file not found', { projectId, sessionId })
      return []
    }
    const messages = loadJsonLines(messagesPath)

    logger.info('[HistoryManager] Loaded history', {
      projectId,
      sessionId,
      messageCount: messages.length
    })

    return messages
  } catch (error) {
    logger.error('[HistoryManager] Failed to load history', {
      projectId,
      sessionId,
      error: error.message
    })
    return []
  }
}

/**
 * 加载语义事件历史
 * @param {string} projectId
 * @param {string} sessionId
 * @returns {Array}
 */
function loadSemanticEvents(projectId, sessionId) {
  try {
    const eventsPath = getSemanticEventsFilePath(projectId, sessionId)

    if (!fs.existsSync(eventsPath)) {
      logger.debug('[HistoryManager] Semantic history file not found', { projectId, sessionId })
      return []
    }
    const events = loadJsonLines(eventsPath)

    logger.info('[HistoryManager] Loaded semantic history', {
      projectId,
      sessionId,
      eventCount: events.length
    })

    return events
  } catch (error) {
    logger.error('[HistoryManager] Failed to load semantic history', {
      projectId,
      sessionId,
      error: error.message
    })
    return []
  }
}

function loadSessionEvents(projectId, sessionId) {
  try {
    const eventsPath = getSessionEventsFilePath(projectId, sessionId)

    if (!fs.existsSync(eventsPath)) {
      logger.debug('[HistoryManager] Session event log not found', { projectId, sessionId })
      return []
    }
    const events = loadJsonLines(eventsPath)

    logger.info('[HistoryManager] Loaded session event log', {
      projectId,
      sessionId,
      eventCount: events.length
    })

    return events
  } catch (error) {
    logger.error('[HistoryManager] Failed to load session event log', {
      projectId,
      sessionId,
      error: error.message
    })
    return []
  }
}

/**
 * 删除会话历史
 * @param {string} projectId - 项目ID
 * @param {string} sessionId - 会话ID
 */
function deleteHistory(projectId, sessionId) {
  try {
    const historyDir = getSessionHistoryDir(projectId, sessionId)

    if (fs.existsSync(historyDir)) {
      fs.rmSync(historyDir, { recursive: true })
      logger.info('[HistoryManager] Deleted history', { projectId, sessionId })
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

/**
 * 批量保存消息 (用于初始化或迁移)
 * @param {string} projectId - 项目ID
 * @param {string} sessionId - 会话ID
 * @param {Array} messages - 消息数组
 */
function saveAllMessages(projectId, sessionId, messages) {
  try {
    ensureHistoryDir(projectId, sessionId)

    const messagesPath = getMessagesFilePath(projectId, sessionId)
    const content = messages.map(msg => serializeMessage(msg)).join('\n') + '\n'

    fs.writeFileSync(messagesPath, content, 'utf-8')

    // 更新元数据
    const metadata = createDefaultMetadata()
    metadata.messageCount = messages.length

    if (messages.length > 0) {
      metadata.lastMessageAt = messages[messages.length - 1].timestamp || new Date().toISOString()

      // 累加所有 token
      for (const msg of messages) {
        if (msg.usage) {
          metadata.totalTokens.input += msg.usage.input_tokens || 0
          metadata.totalTokens.output += msg.usage.output_tokens || 0
        }
      }
    }

    saveMetadata(projectId, sessionId, metadata)

    logger.info('[HistoryManager] Saved all messages', {
      projectId,
      sessionId,
      messageCount: messages.length
    })

    return true
  } catch (error) {
    logger.error('[HistoryManager] Failed to save all messages', {
      projectId,
      sessionId,
      error: error.message
    })
    return false
  }
}

/**
 * 检查历史记录是否存在
 * @param {string} projectId - 项目ID
 * @param {string} sessionId - 会话ID
 */
function historyExists(projectId, sessionId) {
  const messagesPath = getMessagesFilePath(projectId, sessionId)
  const turnIndexPath = getTurnIndexFilePath(projectId, sessionId)
  return fs.existsSync(messagesPath) || fs.existsSync(turnIndexPath)
}

module.exports = {
  getSessionHistoryDir,
  getMessagesFilePath,
  getMetadataFilePath,
  getSemanticEventsFilePath,
  getSessionEventsFilePath,
  getTurnIndexFilePath,
  getTurnsDirPath,
  loadMetadata,
  saveMetadata,
  updateSessionEnvInfo,
  appendMessage,
  appendSemanticEvent,
  appendSessionEvent,
  appendTurn,
  appendIndexMessage,
  updateTurn,
  updateIndexMessage,
  appendTurnEvent,
  updateMessage,
  loadHistory,
  loadSemanticEvents,
  loadSessionEvents,
  loadTurnIndex,
  loadTurnEvents,
  deleteHistory,
  saveAllMessages,
  historyExists
}
