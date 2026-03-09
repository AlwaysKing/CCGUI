/**
 * Session Configuration Manager
 * Manages session.json configuration files
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const crypto = require('crypto')
const logger = require('../logger')

/**
 * Storage base directory
 */
const STORAGE_BASE = path.join(os.homedir(), '.ccgui')

/**
 * Ensure directory exists
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
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
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      settings: options.settings || {}
    }

    // Write session config
    const configPath = getSessionConfigPath(encodedProjectId, sessionId)
    fs.writeFileSync(configPath, JSON.stringify(sessionConfig, null, 2), 'utf-8')

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
 * Update session configuration
 * @param {string} encodedProjectId - Encoded project ID
 * @param {string} sessionId - Session ID
 * @param {object} updates - Fields to update
 * @returns {object} Updated session configuration
 */
function updateSession(encodedProjectId, sessionId, updates) {
  try {
    const sessionConfig = getSession(encodedProjectId, sessionId)

    if (!sessionConfig) {
      throw new Error(`Session not found: ${sessionId}`)
    }

    // Apply updates (preserve immutable fields)
    const updatedConfig = {
      ...sessionConfig,
      ...updates,
      id: sessionId, // Prevent ID changes
      projectId: encodedProjectId, // Prevent project ID changes
      updatedAt: new Date().toISOString()
    }

    // Write updated config
    const configPath = getSessionConfigPath(encodedProjectId, sessionId)
    fs.writeFileSync(configPath, JSON.stringify(updatedConfig, null, 2), 'utf-8')

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

    // Sort by updatedAt descending (most recent first)
    sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))

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

module.exports = {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  getProjectSessions,
  sessionExists,
  updateMessageCount,
  getSessionDir,
  getSessionConfigPath
}
