/**
 * 同步管理器
 * 负责与 ~/.claude 目录同步项目和会话数据
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const logger = require('../logger')
const projectConfigManager = require('./project-config-manager')
const sessionConfigManager = require('./session-config-manager')
const historyManager = require('./history-manager')

/**
 * 获取 Claude 项目目录
 */
function getClaudeProjectsDir() {
  return path.join(os.homedir(), '.claude', 'projects')
}

/**
 * 解码项目ID为原始路径
 * @param {string} encodedId - 编码的项目ID
 * @returns {string} 原始路径
 */
function decodeProjectPath(encodedId) {
  let decoded = encodedId.startsWith('-') ? encodedId.slice(1) : encodedId

  if (process.platform === 'win32') {
    decoded = decoded.replace(/^([A-Za-z])-/, '$1:/')
    decoded = decoded.slice(2).replace(/-/g, '\\')
  } else {
    decoded = '/' + decoded.replace(/-/g, '/')
  }

  return decoded
}

/**
 * 编码项目路径为ID
 * @param {string} projectPath - 项目路径
 * @returns {string} 编码的项目ID
 */
function encodeProjectPath(projectPath) {
  let encodedPath = projectPath

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
 * 扫描 Claude 项目目录
 * @returns {Array} Claude 项目列表
 */
function scanClaudeProjects() {
  try {
    const claudeDir = getClaudeProjectsDir()

    if (!fs.existsSync(claudeDir)) {
      logger.info('[SyncManager] Claude projects directory does not exist')
      return []
    }

    const entries = fs.readdirSync(claudeDir, { withFileTypes: true })
    const projects = []

    for (const entry of entries) {
      if (!entry.isDirectory()) continue

      const projectId = entry.name
      const projectPath = decodeProjectPath(projectId)
      const fullDir = path.join(claudeDir, projectId)

      // 获取会话文件列表
      const files = fs.readdirSync(fullDir)
      const sessionFiles = files.filter(f => 
        f.endsWith('.jsonl') && !fs.statSync(path.join(fullDir, f)).isDirectory()
      )

      let lastActiveAt = null
      try {
        const stats = fs.statSync(fullDir)
        lastActiveAt = stats.mtime.toISOString()
      } catch (e) {
        // Ignore stat errors
      }

      projects.push({
        id: projectId,
        path: projectPath,
        name: path.basename(projectPath),
        sessionCount: sessionFiles.length,
        lastActiveAt
      })
    }

    logger.info('[SyncManager] Scanned Claude projects', { count: projects.length })
    return projects
  } catch (error) {
    logger.error('[SyncManager] Failed to scan Claude projects', {
      error: error.message
    })
    return []
  }
}

/**
 * 获取 Claude 会话列表
 * @param {string} projectId - 项目ID
 * @returns {Array} 会话列表
 */
function getClaudeSessions(projectId) {
  try {
    const claudeDir = getClaudeProjectsDir()
    const projectDir = path.join(claudeDir, projectId)

    if (!fs.existsSync(projectDir)) {
      return []
    }

    const files = fs.readdirSync(projectDir)
    const sessions = []

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue

      const sessionId = file.replace('.jsonl', '')
      const filePath = path.join(projectDir, file)
      const stat = fs.statSync(filePath)

      sessions.push({
        id: sessionId,
        projectId,
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString()
      })
    }

    return sessions
  } catch (error) {
    logger.error('[SyncManager] Failed to get Claude sessions', {
      projectId,
      error: error.message
    })
    return []
  }
}

/**
 * 从 Claude 导入会话历史
 * @param {string} projectId - 项目ID
 * @param {string} sessionId - 会话ID
 * @returns {Array} 消息数组
 */
function importClaudeHistory(projectId, sessionId) {
  try {
    const claudeDir = getClaudeProjectsDir()
    const sessionFile = path.join(claudeDir, projectId, `${sessionId}.jsonl`)

    if (!fs.existsSync(sessionFile)) {
      logger.warn('[SyncManager] Claude session file not found', { projectId, sessionId })
      return []
    }

    const content = fs.readFileSync(sessionFile, 'utf-8')
    const lines = content.trim().split('\n')
    const messages = []

    for (const line of lines) {
      if (!line.trim()) continue

      try {
        const data = JSON.parse(line)
        messages.push(data)
      } catch (e) {
        logger.warn('[SyncManager] Failed to parse Claude message', {
          projectId,
          sessionId
        })
      }
    }

    logger.info('[SyncManager] Imported Claude history', {
      projectId,
      sessionId,
      messageCount: messages.length
    })

    return messages
  } catch (error) {
    logger.error('[SyncManager] Failed to import Claude history', {
      projectId,
      sessionId,
      error: error.message
    })
    return []
  }
}

/**
 * 执行同步
 * 策略:
 * 1. 扫描 Claude 项目
 * 2. 删除 CCGUI 中存在但 Claude 中不存在的项目和会话
 * 3. 保留 Claude 中存在的新项目和会话
 */
function performSync() {
  try {
    logger.info('[SyncManager] Starting sync with Claude...')

    const claudeProjects = scanClaudeProjects()
    const claudeProjectIds = new Set(claudeProjects.map(p => p.id))

    const ccguiProjects = projectConfigManager.getAllProjects()
    const ccguiProjectIds = new Set(ccguiProjects.map(p => p.id))

    // 找出需要删除的项目(在 CCGUI 中存在但 Claude 中不存在)
    const projectsToDelete = []
    for (const project of ccguiProjects) {
      if (!claudeProjectIds.has(project.id)) {
        projectsToDelete.push(project.id)
      }
    }

    // 删除过期的项目
    for (const projectId of projectsToDelete) {
      logger.info('[SyncManager] Deleting project not in Claude', { projectId })
      projectConfigManager.deleteProjectConfig(projectId)
    }

    // 找出需要添加的项目(在 Claude 中存在但 CCGUI 中不存在)
    const projectsToAdd = []
    for (const project of claudeProjects) {
      if (!ccguiProjectIds.has(project.id)) {
        projectsToAdd.push(project)
      }
    }

    // 添加新项目
    for (const project of projectsToAdd) {
      logger.info('[SyncManager] Adding project from Claude', { projectId: project.id })
      projectConfigManager.createProjectConfig(project.id, project.path, project.name)
    }

    // 同步每个项目的会话
    for (const claudeProject of claudeProjects) {
      syncProjectSessions(claudeProject.id)
    }

    const result = {
      projectsDeleted: projectsToDelete.length,
      projectsAdded: projectsToAdd.length,
      timestamp: new Date().toISOString()
    }

    logger.info('[SyncManager] Sync completed', result)
    return result
  } catch (error) {
    logger.error('[SyncManager] Sync failed', { error: error.message })
    throw error
  }
}

/**
 * 同步项目的会话
 * @param {string} projectId - 项目ID
 */
function syncProjectSessions(projectId) {
  try {
    const claudeSessions = getClaudeSessions(projectId)
    const claudeSessionIds = new Set(claudeSessions.map(s => s.id))

    const ccguiSessions = sessionConfigManager.getProjectSessions(projectId)
    const ccguiSessionIds = new Set(ccguiSessions.map(s => s.id))

    // 删除过期的会话
    for (const session of ccguiSessions) {
      if (!claudeSessionIds.has(session.id)) {
        logger.info('[SyncManager] Deleting session not in Claude', {
          projectId,
          sessionId: session.id
        })
        sessionConfigManager.deleteSessionConfig(projectId, session.id)
        historyManager.deleteHistory(projectId, session.id)
      }
    }

    // 添加新会话(但不导入历史,等用户打开时再导入)
    for (const claudeSession of claudeSessions) {
      if (!ccguiSessionIds.has(claudeSession.id)) {
        logger.info('[SyncManager] Adding session from Claude', {
          projectId,
          sessionId: claudeSession.id
        })
        sessionConfigManager.createSessionConfig(projectId, claudeSession.id, '新会话')
      }
    }
  } catch (error) {
    logger.error('[SyncManager] Failed to sync project sessions', {
      projectId,
      error: error.message
    })
  }
}

/**
 * 加载会话历史(优先从 CCGUI,否则从 Claude 导入)
 * @param {string} projectId - 项目ID
 * @param {string} sessionId - 会话ID
 * @returns {Array} 消息数组
 */
function loadSessionHistoryWithFallback(projectId, sessionId) {
  try {
    // 首先尝试从 CCGUI 加载
    if (historyManager.historyExists(projectId, sessionId)) {
      logger.info('[SyncManager] Loading history from CCGUI', { projectId, sessionId })
      return historyManager.loadHistory(projectId, sessionId)
    }

    // 如果 CCGUI 中没有,从 Claude 导入
    logger.info('[SyncManager] Importing history from Claude', { projectId, sessionId })
    const messages = importClaudeHistory(projectId, sessionId)

    // 保存到 CCGUI
    if (messages.length > 0) {
      historyManager.saveAllMessages(projectId, sessionId, messages)
      logger.info('[SyncManager] Imported and saved history', {
        projectId,
        sessionId,
        messageCount: messages.length
      })
    }

    return messages
  } catch (error) {
    logger.error('[SyncManager] Failed to load session history', {
      projectId,
      sessionId,
      error: error.message
    })
    return []
  }
}

module.exports = {
  getClaudeProjectsDir,
  scanClaudeProjects,
  getClaudeSessions,
  importClaudeHistory,
  performSync,
  syncProjectSessions,
  loadSessionHistoryWithFallback,
  decodeProjectPath,
  encodeProjectPath
}
