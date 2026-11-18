/**
 * Session Configuration Manager
 * Manages session.json configuration files
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const logger = require('../logger')
const { getCcguiHome } = require('../runtime-paths')
const projectConfigManager = require('./project-config-manager')

/**
 * Storage base directory
 */
const STORAGE_BASE = getCcguiHome()

/**
 * Ensure directory exists
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim()
  return normalized || null
}

function normalizeSessionRole(value) {
  const normalized = normalizeOptionalString(value)
  return normalized ? normalized.toLowerCase() : null
}

/**
 * Get session directory path
 * @param {string} encodedProjectId - Encoded project ID
 * @param {string} sessionId - Session ID
 * @returns {string} Session directory path
 */
function getSessionDir(encodedProjectId, sessionId) {
  return path.join(STORAGE_BASE, 'projects', encodedProjectId, 'sessions', sessionId)
}

/**
 * Get session config file path
 * @param {string} encodedProjectId - Encoded project ID
 * @param {string} sessionId - Session ID
 * @returns {string} Session config file path
 */
function getSessionConfigPath(encodedProjectId, sessionId) {
  return path.join(getSessionDir(encodedProjectId, sessionId), 'session.json')
}

function getProjectSessionIds(encodedProjectId) {
  const sessionsDir = path.join(STORAGE_BASE, 'projects', encodedProjectId, 'sessions')
  if (!fs.existsSync(sessionsDir)) {
    return []
  }

  const sessions = fs.readdirSync(sessionsDir, { withFileTypes: true })
    .filter(entry => (
      entry.isDirectory() &&
      fs.existsSync(path.join(sessionsDir, entry.name, 'session.json'))
    ))
    .map(entry => {
      try {
        const configPath = path.join(sessionsDir, entry.name, 'session.json')
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
        return {
          id: entry.name,
          updatedAt: config.updatedAt || config.createdAt || ''
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)

  sessions.sort((left, right) => {
    const leftTime = Date.parse(left.updatedAt)
    const rightTime = Date.parse(right.updatedAt)
    const timeDifference = (Number.isFinite(rightTime) ? rightTime : 0) -
      (Number.isFinite(leftTime) ? leftTime : 0)
    return timeDifference || left.id.localeCompare(right.id)
  })
  return sessions.map(session => session.id)
}

/**
 * Create a new session
 * @param {string} encodedProjectId - Encoded project ID
 * @param {object} options - Session options
 * @param {string} [options.name] - Session name
 * @param {object} [options.settings] - Session settings
 * @returns {object} Created session configuration
 */
function createSession(encodedProjectId, options = {}) {
  try {
    const sessionId = crypto.randomUUID()
    const sessionDir = getSessionDir(encodedProjectId, sessionId)

    // Create session directory
    ensureDir(sessionDir)

    // Create history directory
    const historyDir = path.join(sessionDir, 'history')
    ensureDir(historyDir)

    const now = new Date().toISOString()
    const sessionConfig = {
      id: sessionId,
      projectId: encodedProjectId,
      name: options.name || `Session ${now.split('T')[0]}`,
      teamId: normalizeOptionalString(options.teamId),
      role: normalizeSessionRole(options.role),
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      settings: options.settings || {},
      ...(options.forkedFrom ? { forkedFrom: options.forkedFrom } : {})
    }

    // Write session config
    const configPath = getSessionConfigPath(encodedProjectId, sessionId)
    fs.writeFileSync(configPath, JSON.stringify(sessionConfig, null, 2), 'utf-8')
    projectConfigManager.prependProjectSessionOrder(
      encodedProjectId,
      sessionId,
      getProjectSessionIds(encodedProjectId)
    )

    logger.info('[SessionConfigManager] Created session', {
      sessionId,
      projectId: encodedProjectId,
      name: sessionConfig.name
    })

    return sessionConfig
  } catch (error) {
    logger.error('[SessionConfigManager] Failed to create session', {
      projectId: encodedProjectId,
      error: error.message
    })
    throw error
  }
}

/**
 * Get session configuration
 * @param {string} encodedProjectId - Encoded project ID
 * @param {string} sessionId - Session ID
 * @returns {object|null} Session configuration or null if not found
 */
function getSession(encodedProjectId, sessionId) {
  try {
    const configPath = getSessionConfigPath(encodedProjectId, sessionId)

    if (!fs.existsSync(configPath)) {
      logger.warn('[SessionConfigManager] Session config not found', {
        projectId: encodedProjectId,
        sessionId
      })
      return null
    }

    const content = fs.readFileSync(configPath, 'utf-8')
    const sessionConfig = JSON.parse(content)

    return sessionConfig
  } catch (error) {
    logger.error('[SessionConfigManager] Failed to get session', {
      projectId: encodedProjectId,
      sessionId,
      error: error.message
    })
    throw error
  }
}

/**
 * Update session configuration (creates session if not exists)
 * @param {string} encodedProjectId - Encoded project ID
 * @param {string} sessionId - Session ID
 * @param {object} updates - Fields to update
 * @returns {object} Updated session configuration
 */
function updateSession(encodedProjectId, sessionId, updates) {
  try {
    let sessionConfig = getSession(encodedProjectId, sessionId)
    const isNewSession = !sessionConfig

    // If session doesn't exist, create it first
    if (!sessionConfig) {
      logger.info('[SessionConfigManager] Session not found, creating new session', {
        projectId: encodedProjectId,
        sessionId
      })

      // Create session directory
      const sessionDir = getSessionDir(encodedProjectId, sessionId)
      ensureDir(sessionDir)

      // Create history directory
      const historyDir = path.join(sessionDir, 'history')
      ensureDir(historyDir)

      // Create initial config
      const now = new Date().toISOString()
      sessionConfig = {
        id: sessionId,
        projectId: encodedProjectId,
        name: updates.name || `Session ${now.split('T')[0]}`,
        teamId: normalizeOptionalString(updates.teamId),
        role: normalizeSessionRole(updates.role),
        createdAt: now,
        updatedAt: now,
        messageCount: 0,
        settings: {}
      }
    }

    // Apply updates (preserve immutable fields)
    const updatedConfig = {
      ...sessionConfig,
      ...updates,
      id: sessionId, // Prevent ID changes
      projectId: encodedProjectId, // Prevent project ID changes
      updatedAt: new Date().toISOString()
    }
    if (Object.prototype.hasOwnProperty.call(updates || {}, 'teamId')) {
      updatedConfig.teamId = normalizeOptionalString(updates.teamId)
    }
    if (Object.prototype.hasOwnProperty.call(updates || {}, 'role')) {
      updatedConfig.role = normalizeSessionRole(updates.role)
    }

    // Write updated config
    const configPath = getSessionConfigPath(encodedProjectId, sessionId)
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf-8')
    if (isNewSession) {
      projectConfigManager.prependProjectSessionOrder(
        encodedProjectId,
        sessionId,
        getProjectSessionIds(encodedProjectId)
      )
    }

    logger.info('[SessionConfigManager] Updated session', {
      sessionId,
      projectId: encodedProjectId,
      updates: Object.keys(updates)
    })

    return updatedConfig
  } catch (error) {
    logger.error('[SessionConfigManager] Failed to update session', {
      projectId: encodedProjectId,
      sessionId,
      error: error.message
    })
    throw error
  }
}

/**
 * Delete session
 * @param {string} encodedProjectId - Encoded project ID
 * @param {string} sessionId - Session ID
 * @returns {boolean} Success status
 */
function deleteSession(encodedProjectId, sessionId) {
  try {
    const sessionDir = getSessionDir(encodedProjectId, sessionId)

    if (!fs.existsSync(sessionDir)) {
      logger.warn('[SessionConfigManager] Session directory not found for deletion', {
        projectId: encodedProjectId,
        sessionId
      })
      return false
    }

    // Recursively delete session directory
    fs.rmSync(sessionDir, { recursive: true, force: true })
    projectConfigManager.removeProjectSessionOrder(encodedProjectId, sessionId)

    logger.info('[SessionConfigManager] Deleted session', {
      sessionId,
      projectId: encodedProjectId
    })

    return true
  } catch (error) {
    logger.error('[SessionConfigManager] Failed to delete session', {
      projectId: encodedProjectId,
      sessionId,
      error: error.message
    })
    throw error
  }
}

/**
 * Get all sessions for a project
 * @param {string} encodedProjectId - Encoded project ID
 * @returns {Array} Array of session configurations
 */
function getProjectSessions(encodedProjectId) {
  try {
    const sessionsDir = path.join(STORAGE_BASE, 'projects', encodedProjectId, 'sessions')

    if (!fs.existsSync(sessionsDir)) {
      logger.debug('[SessionConfigManager] No sessions directory for project', {
        projectId: encodedProjectId
      })
      return []
    }

    const sessionDirs = fs.readdirSync(sessionsDir)
    const sessions = []

    for (const sessionId of sessionDirs) {
      try {
        const sessionConfig = getSession(encodedProjectId, sessionId)
        if (sessionConfig) {
          sessions.push(sessionConfig)
        }
      } catch (error) {
        logger.warn('[SessionConfigManager] Failed to read session, skipping', {
          projectId: encodedProjectId,
          sessionId,
          error: error.message
        })
      }
    }

    const sessionOrder = projectConfigManager.getProjectSessionOrder(encodedProjectId)
    if (sessionOrder.length > 0) {
      const orderIndex = new Map(sessionOrder.map((sessionId, index) => [sessionId, index]))
      sessions.sort((left, right) => {
        const leftIndex = orderIndex.has(left.id) ? orderIndex.get(left.id) : -1
        const rightIndex = orderIndex.has(right.id) ? orderIndex.get(right.id) : -1
        return leftIndex - rightIndex
      })
    } else {
      // 旧项目首次迁移时沿用原列表顺序；迁移落盘后不再参与时间排序。
      sessions.sort((left, right) => {
        const leftTime = Date.parse(left.updatedAt || left.createdAt || '')
        const rightTime = Date.parse(right.updatedAt || right.createdAt || '')
        const timeDifference = (Number.isFinite(rightTime) ? rightTime : 0) -
          (Number.isFinite(leftTime) ? leftTime : 0)
        return timeDifference || String(left.id || '').localeCompare(String(right.id || ''))
      })
    }

    logger.debug('[SessionConfigManager] Retrieved project sessions', {
      projectId: encodedProjectId,
      count: sessions.length
    })

    return sessions
  } catch (error) {
    logger.error('[SessionConfigManager] Failed to get project sessions', {
      projectId: encodedProjectId,
      error: error.message
    })
    throw error
  }
}

/**
 * Check if session exists
 * @param {string} encodedProjectId - Encoded project ID
 * @param {string} sessionId - Session ID
 * @returns {boolean} True if session exists
 */
function sessionExists(encodedProjectId, sessionId) {
  try {
    const configPath = getSessionConfigPath(encodedProjectId, sessionId)
    return fs.existsSync(configPath)
  } catch (error) {
    return false
  }
}

/**
 * Update session message count
 * @param {string} encodedProjectId - Encoded project ID
 * @param {string} sessionId - Session ID
 * @param {number} messageCount - New message count
 * @returns {object} Updated session configuration
 */
function updateMessageCount(encodedProjectId, sessionId, messageCount) {
  return updateSession(encodedProjectId, sessionId, { messageCount })
}

/**
 * Soft delete a session (mark as deleted)
 * @param {string} encodedProjectId - Encoded project ID
 * @param {string} sessionId - Session ID
 * @returns {object} Updated session configuration
 */
function softDeleteSession(encodedProjectId, sessionId) {
  return updateSession(encodedProjectId, sessionId, {
    deleted: true,
    deletedAt: new Date().toISOString()
  })
}

/**
 * Restore a soft-deleted session
 * @param {string} encodedProjectId - Encoded project ID
 * @param {string} sessionId - Session ID
 * @returns {object} Updated session configuration
 */
function restoreSession(encodedProjectId, sessionId) {
  return updateSession(encodedProjectId, sessionId, {
    deleted: false,
    deletedAt: null
  })
}

/**
 * Toggle session lock status
 * @param {string} encodedProjectId - Encoded project ID
 * @param {string} sessionId - Session ID
 * @returns {object} Updated session configuration
 */
function toggleLock(encodedProjectId, sessionId) {
  const session = getSession(encodedProjectId, sessionId)
  const currentLocked = session?.locked || false
  return updateSession(encodedProjectId, sessionId, {
    locked: !currentLocked
  })
}

module.exports = {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  softDeleteSession,
  restoreSession,
  toggleLock,
  getProjectSessions,
  sessionExists,
  updateMessageCount,
  getSessionDir,
  getSessionConfigPath
}
