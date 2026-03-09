/**
 * 历史管理器
 * 管理聊天历史记录的存储和加载
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
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  }
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
    const messageLine = JSON.stringify(message) + '\n'

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

    const content = fs.readFileSync(messagesPath, 'utf-8')
    const lines = content.trim().split('\n')

    const messages = []
    for (const line of lines) {
      if (!line.trim()) continue

      try {
        const message = JSON.parse(line)
        messages.push(message)
      } catch (e) {
        logger.warn('[HistoryManager] Failed to parse message line', {
          projectId,
          sessionId,
          line: line.substring(0, 100)
        })
      }
    }

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
    const content = messages.map(msg => JSON.stringify(msg)).join('\n') + '\n'

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
  return fs.existsSync(messagesPath)
}

module.exports = {
  getSessionHistoryDir,
  getMessagesFilePath,
  getMetadataFilePath,
  loadMetadata,
  saveMetadata,
  appendMessage,
  loadHistory,
  deleteHistory,
  saveAllMessages,
  historyExists
}
