const { app, BrowserWindow, ipcMain, session, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFile } = require('child_process')
const { SessionManager } = require('./session-manager')
const logger = require('./logger')

// 初始化日志系统
logger.initialize()

// Global isDev flag - will be set before creating windows
let isDev = process.env.NODE_ENV === 'development'

let mainWindow
let sessionManager

/**
 * Get app icon path
 */
function getIconPath() {
  return path.join(__dirname, '../build/icons/icon.icns')
}

/**
 * Create main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: '首页',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    icon: getIconPath(),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  // Set CSP for development
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self' http://localhost:5173; script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173 ws://localhost:5173; style-src 'self' 'unsafe-inline' http://localhost:5173; connect-src 'self' http://localhost:5173 ws://localhost:5173; img-src 'self' data: http://localhost:5173; font-src 'self' data: http://localhost:5173; object-src 'none';"]
      }
    })
  })

  // Load app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  // Initialize Session Manager with callback to send events to renderer
  initSessionManager()

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/**
 * Initialize Session Manager
 */
function initSessionManager() {
  // Create SessionManager instance (webContents will be passed per-session)
  sessionManager = new SessionManager()
}



// ============================================
// Session IPC Handlers
// ============================================

// Frontend log handler - 将前端日志打印到后端终端
ipcMain.on('frontend-log', (event, args) => {
  const message = args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ')
  logger.info(`[Frontend] ${message}`)
})

// Ensure log directory exists
ipcMain.handle('ensure-log-dir', async (event, { baseDir = '/tmp/ccgui' }) => {
  logger.info('[IPC] ensure-log-dir called', { baseDir })
  try {
    // 日志模块已经在 initialize() 中创建了目录，但我们可以再次确保
    const fs = require('fs')
    const path = require('path')

    const appLogDir = path.dirname(path.join(baseDir, 'app.log'))
    const streamLogDir = path.join(baseDir, 'stream')

    if (!fs.existsSync(appLogDir)) {
      fs.mkdirSync(appLogDir, { recursive: true })
    }
    if (!fs.existsSync(streamLogDir)) {
      fs.mkdirSync(streamLogDir, { recursive: true })
    }

    logger.info(`[Log] Log directories created at ${baseDir}`)
    return { success: true, baseDir }
  } catch (error) {
    logger.error('[IPC] ensure-log-dir error:', error)
    return { success: false, error: error.message }
  }
})

// Write application log
ipcMain.handle('write-app-log', async (event, { entry }) => {
  try {
    // 解析日志条目并写入
    const logEntry = JSON.parse(entry)
    const { level, message, data } = logEntry

    // 使用日志模块写入
    logger.writeAppLog(level, message, data)
    return { success: true }
  } catch (error) {
    logger.error('[IPC] write-app-log error:', error)
    return { success: false, error: error.message }
  }
})

// Write stream log for a session
ipcMain.handle('write-stream-log', async (event, { sessionId, entry }) => {
  try {
    // 解析流日志条目并写入
    const streamEntry = JSON.parse(entry)
    const { direction, data } = streamEntry

    // 使用日志模块写入
    logger.writeStreamLog(sessionId, direction, data)
    return { success: true }
  } catch (error) {
    logger.error('[IPC] write-stream-log error:', error)
    return { success: false, error: error.message }
  }
})

// Select/Activate a session - creates SessionInstance and returns state
ipcMain.handle('select-session', async (event, { sessionId, projectId, projectPath }) => {
  logger.info('[IPC] select-session:', { sessionId, projectId, projectPath })

  try {
    // Get or create the session instance, passing the caller's webContents
    // This ensures events are sent to the correct window (supports multi-window)
    const sessionInstance = await sessionManager.getOrCreateSession(
      sessionId,
      projectPath,
      event.sender, // webContents of the calling window
      true
    )

    // Return the session state
    return {
      success: true,
      state: sessionInstance.getState()
    }
  } catch (error) {
    logger.error('[IPC] select-session error:', error)
    return { success: false, error: error.message }
  }
})

// Get session state
ipcMain.handle('get-session-state', async (event, { sessionId }) => {
  const state = sessionManager.getSessionState(sessionId)
  return state
})

// Update session UI state
ipcMain.handle('update-session-ui-state', async (event, { sessionId, state }) => {
  sessionManager.updateSessionUIState(sessionId, state)
  return { success: true }
})

// Send message
ipcMain.handle('send-message', async (event, { sessionId, message, content }) => {
  logger.info('[IPC] send-message:', { sessionId, contentLength: content?.length || message?.length })

  try {
    // Support both 'content' (new) and 'message' (legacy) parameters
    const messageContent = content || message
    await sessionManager.sendMessage(sessionId, messageContent)
    return { success: true }
  } catch (error) {
    logger.error('[IPC] send-message error:', error)
    return { success: false, error: error.message }
  }
})

// Send control response (for permission prompts)
ipcMain.handle('send-control-response', async (event, { sessionId, requestId, approved, options }) => {
  logger.info('[IPC] send-control-response:', { sessionId, requestId, approved })

  try {
    await sessionManager.sendControlResponse(sessionId, requestId, approved, options)
    return { success: true }
  } catch (error) {
    logger.error('[IPC] send-control-response error:', error)
    return { success: false, error: error.message }
  }
})

// Send interrupt
ipcMain.handle('send-interrupt', async (event, options) => {
  const sessionId = options?.sessionId
  logger.info('[IPC] send-interrupt:', sessionId)

  // If no sessionId, try to get the current active session
  if (!sessionId) {
    const activeSessions = sessionManager.getActiveSessionIds()
    if (activeSessions.length > 0) {
      // Use the first active session
      const activeSessionId = activeSessions[0]
      logger.info('[IPC] send-interrupt: using active session', activeSessionId)
      try {
        await sessionManager.sendInterrupt(activeSessionId)
        return { success: true }
      } catch (error) {
        logger.error('[IPC] send-interrupt error:', error)
        return { success: false, error: error.message }
      }
    }
    return { success: false, error: 'No active session' }
  }

  try {
    await sessionManager.sendInterrupt(sessionId)
    return { success: true }
  } catch (error) {
    logger.error('[IPC] send-interrupt error:', error)
    return { success: false, error: error.message }
  }
})

// Send control request (主动请求，如切换权限模式)
ipcMain.handle('send-control-request', async (event, { sessionId, request }) => {
  logger.info('[IPC] send-control-request:', { sessionId, request })

  try {
    await sessionManager.sendControlRequest(sessionId, request)
    return { success: true }
  } catch (error) {
    logger.error('[IPC] send-control-request error:', error)
    return { success: false, error: error.message }
  }
})

// Set permission mode
ipcMain.handle('set-permission-mode', async (event, { sessionId, mode }) => {
  logger.info('[IPC] set-permission-mode:', { sessionId, mode })

  try {
    await sessionManager.setPermissionMode(sessionId, mode)
    return { success: true }
  } catch (error) {
    logger.error('[IPC] set-permission-mode error:', error)
    return { success: false, error: error.message }
  }
})

// ============================================
// Legacy IPC Handlers (向后兼容)
// ============================================

// Get Claude info (legacy)
ipcMain.handle('get-claude-info', async (event, options) => {
  const sessionId = options?.sessionId

  // Safely get session if sessionId is provided and sessionManager is initialized
  let session = null
  if (sessionId && sessionManager) {
    session = sessionManager.getSession(sessionId)
  }

  return {
    version: '1.0.0',
    tools: ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep'],
    isReady: session?.isClaudeReady?.() || false,
    workingDirectory: session?.projectPath || process.cwd()
  }
})

// Get init info (legacy) - returns env info from active session
ipcMain.handle('get-init-info', async (event, options) => {
  const sessionId = options?.sessionId

  // Try to get env info from the specified session or any active session
  if (sessionManager) {
    const session = sessionId
      ? sessionManager.getSession(sessionId)
      : sessionManager.sessions.values().next().value

    if (session?.envInfo) {
      return session.envInfo
    }
  }

  return null
})

// Check if Claude is ready (legacy)
ipcMain.handle('is-claude-ready', async (event, options) => {
  const sessionId = options?.sessionId

  if (!sessionManager) {
    return false
  }

  const session = sessionId ? sessionManager.getSession(sessionId) : null
  return session?.isClaudeReady?.() || false
})

// Send tool result (legacy - for permission approval)
ipcMain.handle('send-tool-result', async (event, { sessionId, toolUseId, content, isError }) => {
  logger.info('[IPC] send-tool-result:', { sessionId, toolUseId, isError })

  try {
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return { success: false, error: 'Session not found' }
    }

    // Use ClaudeManager's sendToolResult method
    if (session.claudeManager) {
      session.claudeManager.sendToolResult(toolUseId, content, isError)
    }
    return { success: true }
  } catch (error) {
    logger.error('[IPC] send-tool-result error:', error)
    return { success: false, error: error.message }
  }
})

// Start session (legacy - for backwards compatibility)
ipcMain.handle('start-session', async (event, { sessionId, projectPath }) => {
  logger.info('[IPC] start-session (legacy):', { sessionId, projectPath })

  try {
    // Use select-session internally, passing webContents for multi-window support
    const session = await sessionManager.getOrCreateSession(sessionId, projectPath, event.sender, true)

    // Start Claude process
    await session.start()

    logger.info('[IPC] start-session completed:', { sessionId, ready: session.isClaudeReady() })
    return { success: true, sessionId }
  } catch (error) {
    logger.error('[IPC] start-session error:', error)
    return { success: false, error: error.message }
  }
})

// Close session
ipcMain.handle('close-session', async (event, { sessionId }) => {
  logger.info('[IPC] close-session:', sessionId)
  sessionManager.closeSession(sessionId)
  return { success: true }
})

// Stop Claude process (keep session alive for restart)
ipcMain.handle('stop-claude', async (event, { sessionId }) => {
  logger.info('[IPC] stop-claude:', sessionId)
  sessionManager.stopClaude(sessionId)
  return { success: true }
})

// ============================================
// Project & Session Management IPC Handlers
// ============================================

/**
 * Get the Claude projects directory path
 */
function getClaudeProjectsDir() {
  return path.join(os.homedir(), '.claude', 'projects')
}

/**
 * Decode project directory name back to original path
 * e.g., '-Users-alwaysking-Desktop-CCGUI' -> '/Users/alwaysking/Desktop/CCGUI'
 */
function decodeProjectPath(encodedName) {
  let decoded = encodedName.startsWith('-') ? encodedName.slice(1) : encodedName
  if (process.platform === 'win32') {
    decoded = decoded.replace(/^([A-Za-z])-/, '$1:/')
    decoded = decoded.slice(2).replace(/-/g, '/')
  } else {
    decoded = '/' + decoded.replace(/-/g, '/')
  }
  return decoded
}

/**
 * Scan all projects from ~/.claude/projects directory
 */
async function scanProjects() {
  const projectsDir = getClaudeProjectsDir()

  if (!fs.existsSync(projectsDir)) {
    logger.info('[Projects] Projects directory does not exist:', projectsDir)
    return []
  }

  const entries = fs.readdirSync(projectsDir, { withFileTypes: true })
  const projects = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const projectPath = decodeProjectPath(entry.name)
    const fullProjectDir = path.join(projectsDir, entry.name)

    const files = fs.readdirSync(fullProjectDir)
    const sessionFiles = files.filter(f => f.endsWith('.jsonl') && !fs.statSync(path.join(fullProjectDir, f)).isDirectory())

    let lastActiveAt = null
    try {
      const stats = fs.statSync(fullProjectDir)
      lastActiveAt = stats.mtime.toISOString()
    } catch (e) {
      // Ignore stat errors
    }

    const name = path.basename(projectPath)

    projects.push({
      id: entry.name,
      name,
      path: projectPath,
      sessionCount: sessionFiles.length,
      lastActiveAt
    })
  }

  projects.sort((a, b) => {
    if (!a.lastActiveAt) return 1
    if (!b.lastActiveAt) return -1
    return new Date(b.lastActiveAt) - new Date(a.lastActiveAt)
  })

  logger.info(`[Projects] Found ${projects.length} projects`)
  return projects
}

/**
 * Get sessions for a specific project
 * Merges CCGUI sessions with Claude .jsonl sessions, using CCGUI as the primary source
 */
async function getProjectSessions(projectId) {
  const projectsDir = getClaudeProjectsDir()
  const projectDir = path.join(projectsDir, projectId)

  // Get CCGUI sessions (primary source for name, settings, etc.)
  let ccguiSessions = []
  try {
    ccguiSessions = sessionConfigManager.getProjectSessions(projectId) || []
    logger.info(`[Sessions] Found ${ccguiSessions.length} CCGUI sessions for project ${projectId}`)
  } catch (e) {
    logger.warn('[Sessions] Error reading CCGUI sessions:', e.message)
  }

  // Get Claude .jsonl sessions (source for messageCount, preview, timestamps)
  const claudeSessions = new Map()

  if (fs.existsSync(projectDir)) {
    const files = fs.readdirSync(projectDir)

    for (const file of files) {
      if (!file.endsWith('.jsonl')) continue

      const filePath = path.join(projectDir, file)
      const stat = fs.statSync(filePath)

      const sessionId = file.replace('.jsonl', '')

      let preview = ''
      let messageCount = 0

      try {
        // Only read content if file is not empty
        if (stat.size > 0) {
          const content = fs.readFileSync(filePath, 'utf-8')
          const lines = content.trim().split('\n')
          messageCount = lines.length

          for (const line of lines) {
            if (!line.trim()) continue
            try {
              const data = JSON.parse(line)
              if (data.type === 'user' && data.message?.content) {
                const msgContent = data.message.content
                if (Array.isArray(msgContent)) {
                  const textContent = msgContent.find(c => c.type === 'text')
                  if (textContent?.text) {
                    preview = textContent.text.slice(0, 100)
                    break
                  }
                } else if (typeof msgContent === 'string') {
                  preview = msgContent.slice(0, 100)
                  break
                }
              }
            } catch (e) {
              // Skip invalid JSON lines
            }
          }
        }
      } catch (e) {
        logger.warn('[Sessions] Error reading session file:', e.message)
      }

      claudeSessions.set(sessionId, {
        preview,
        messageCount,
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString()
      })
    }
  }

  // Merge sessions: CCGUI sessions + Claude sessions not in CCGUI
  const mergedSessions = []
  const processedIds = new Set()

  // First, add all CCGUI sessions (these are the primary source)
  for (const ccguiSession of ccguiSessions) {
    processedIds.add(ccguiSession.id)

    // Get Claude session data if available
    const claudeData = claudeSessions.get(ccguiSession.id)

    mergedSessions.push({
      id: ccguiSession.id,
      projectId,
      name: ccguiSession.name || `会话`,
      preview: claudeData?.preview || '',
      createdAt: ccguiSession.createdAt || claudeData?.createdAt,
      updatedAt: ccguiSession.updatedAt || claudeData?.updatedAt,
      messageCount: claudeData?.messageCount || ccguiSession.messageCount || 0,
      status: 'idle',
      settings: ccguiSession.settings || {}
    })
  }

  // Then, add Claude sessions that don't exist in CCGUI
  for (const [sessionId, claudeData] of claudeSessions) {
    if (!processedIds.has(sessionId)) {
      mergedSessions.push({
        id: sessionId,
        projectId,
        name: `会话`,
        preview: claudeData.preview,
        createdAt: claudeData.createdAt,
        updatedAt: claudeData.updatedAt,
        messageCount: claudeData.messageCount,
        status: 'idle',
        settings: {}
      })
    }
  }

  mergedSessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))

  logger.info(`[Sessions] Found ${mergedSessions.length} merged sessions for project ${projectId} (CCGUI: ${ccguiSessions.length}, Claude-only: ${claudeSessions.size - processedIds.size})`)
  return mergedSessions
}

// Get all projects
ipcMain.handle('get-projects', async () => {
  return scanProjects()
})

// Add a new project (by path)
ipcMain.handle('add-project', async (event, { projectPath, settings }) => {
  const name = path.basename(projectPath)

  let encodedPath = projectPath
  if (process.platform === 'win32') {
    encodedPath = encodedPath.replace(/:/g, '').replace(/\\/g, '-')
  } else {
    encodedPath = encodedPath.replace(/\//g, '-')
  }
  if (encodedPath.startsWith('-')) {
    encodedPath = encodedPath.slice(1)
  }
  const projectId = '-' + encodedPath

  // 创建项目配置
  let projectConfig
  try {
    projectConfig = projectConfigManager.createProjectConfig(projectId, projectPath, name)

    // 如果有传入 settings，更新配置
    if (settings) {
      projectConfig.settings = settings
      projectConfigManager.saveProjectConfig(projectId, projectConfig)
    }
  } catch (e) {
    logger.warn('[Projects] Failed to create project config:', e.message)
    projectConfig = { settings: {} }
  }

  return {
    id: projectId,
    name,
    path: projectPath,
    sessionCount: 0,
    lastActiveAt: new Date().toISOString(),
    settings: projectConfig.settings || {}
  }
})

// Get project config
ipcMain.handle('get-project-config', async (event, { projectId }) => {
  try {
    const config = projectConfigManager.loadProjectConfig(projectId)
    return { success: true, config }
  } catch (error) {
    logger.error('[ProjectConfig] Failed to get config', { projectId, error: error.message })
    return { success: false, error: error.message }
  }
})

// Update project config
ipcMain.handle('update-project-config', async (event, { projectId, updates }) => {
  try {
    const updatedConfig = projectConfigManager.updateProjectConfig(projectId, updates)
    if (updatedConfig) {
      return { success: true, config: updatedConfig }
    } else {
      return { success: false, error: 'Project not found' }
    }
  } catch (error) {
    logger.error('[ProjectConfig] Failed to update config', { projectId, error: error.message })
    return { success: false, error: error.message }
  }
})

// ============================================
// Session Config IPC Handlers
// ============================================

// Get session config
ipcMain.handle('get-session-config', async (event, { projectId, sessionId }) => {
  try {
    const config = sessionConfigManager.getSession(projectId, sessionId)
    return { success: true, config }
  } catch (error) {
    logger.error('[SessionConfig] Failed to get config', { projectId, sessionId, error: error.message })
    return { success: false, error: error.message }
  }
})

// Update session config
ipcMain.handle('update-session-config', async (event, { projectId, sessionId, updates }) => {
  try {
    const normalizedUpdates = { ...(updates || {}) }
    if (!normalizedUpdates.name) {
      const existingSessions = await getProjectSessions(projectId)
      const existingSession = existingSessions.find(session => session.id === sessionId)
      if (existingSession?.name) {
        normalizedUpdates.name = existingSession.name
      }
    }

    const updatedConfig = sessionConfigManager.updateSession(projectId, sessionId, normalizedUpdates)
    if (updatedConfig) {
      return { success: true, config: updatedConfig }
    } else {
      return { success: false, error: 'Session not found' }
    }
  } catch (error) {
    logger.error('[SessionConfig] Failed to update config', { projectId, sessionId, error: error.message })
    return { success: false, error: error.message }
  }
})

// Delete session config (reset settings)
ipcMain.handle('delete-session-config', async (event, { projectId, sessionId }) => {
  try {
    const updatedConfig = sessionConfigManager.updateSession(projectId, sessionId, { settings: {} })
    if (updatedConfig) {
      return { success: true, config: updatedConfig }
    } else {
      return { success: false, error: 'Session not found' }
    }
  } catch (error) {
    logger.error('[SessionConfig] Failed to delete config', { projectId, sessionId, error: error.message })
    return { success: false, error: error.message }
  }
})

// Copy session (creates new session, optionally copying config)
ipcMain.handle('copy-session', async (event, { projectId, sessionId }) => {
  try {
    // Generate incremental name (会话1, 会话2, etc.)
    const existingSessions = sessionConfigManager.getProjectSessions(projectId) || []
    let maxNum = 0
    for (const s of existingSessions) {
      const match = s.name?.match(/^会话(\d+)$/)
      if (match) {
        const num = parseInt(match[1], 10)
        if (num > maxNum) maxNum = num
      }
    }
    const newName = `会话${maxNum + 1}`

    // Check if source session has config
    const sourceConfig = sessionConfigManager.getSession(projectId, sessionId)
    const hasSettings = sourceConfig?.settings && Object.keys(sourceConfig.settings).length > 0

    // Create new session, copy config only if source has one
    const newSession = sessionConfigManager.createSession(projectId, {
      name: newName,
      settings: hasSettings ? { ...sourceConfig.settings } : {}
    })

    logger.info('[SessionConfig] Session copied', { sourceId: sessionId, newId: newSession.id, hasConfig: hasSettings })
    return { success: true, session: newSession }
  } catch (error) {
    logger.error('[SessionConfig] Failed to copy session', { projectId, sessionId, error: error.message })
    return { success: false, error: error.message }
  }
})

// Remove a project
ipcMain.handle('remove-project', async (event, { projectId, deleteFolder }) => {
  const projectsDir = getClaudeProjectsDir()
  const projectDir = path.join(projectsDir, projectId)

  // Get project metadata to find the actual project path
  let projectPath = null
  const projects = await scanProjects()
  const project = projects.find(p => p.id === projectId)
  if (project) {
    projectPath = project.path
  }

  // Delete CCGUI project data
  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true })
    logger.info('[Projects] Removed project data:', projectId)
  }

  // Delete actual project folder if requested
  if (deleteFolder && projectPath && fs.existsSync(projectPath)) {
    try {
      fs.rmSync(projectPath, { recursive: true })
      logger.info('[Projects] Removed project folder:', projectPath)
    } catch (error) {
      logger.error('[Projects] Failed to remove project folder:', { error: error.message, projectPath })
      throw new Error(`删除项目文件夹失败: ${error.message}`)
    }
  }

  return { success: true }
})

// Get sessions for a project
ipcMain.handle('get-sessions', async (event, { projectId }) => {
  return getProjectSessions(projectId)
})

// Get running sessions with full status
ipcMain.handle('get-running-sessions', async () => {
  if (!sessionManager) {
    return {}
  }

  const sessionStatuses = {}
  for (const [sessionId, session] of sessionManager.sessions) {
    // 获取消息数量和最后更新时间
    const messages = session.messages || []
    const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null

    sessionStatuses[sessionId] = {
      ready: session.isClaudeReady(),
      processing: session.isProcessing,
      streaming: session.currentStreamingAssistantId !== null,
      // 添加实时统计信息
      messageCount: messages.length,
      updatedAt: lastMessage?.timestamp || new Date().toISOString()
    }
  }
  return sessionStatuses
})

// Create a new session
ipcMain.handle('create-session', async (event, { projectId, name }) => {
  const projectsDir = getClaudeProjectsDir()
  const projectDir = path.join(projectsDir, projectId)

  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true })
  }

  const sessionId = require('crypto').randomUUID()
  const sessionFile = path.join(projectDir, `${sessionId}.jsonl`)

  // Create empty file - will be deleted before first use if still empty
  fs.writeFileSync(sessionFile, '')

  return {
    id: sessionId,
    projectId,
    name: name || `新会话`,
    preview: '',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messageCount: 0,
    status: 'idle'
  }
})

// Delete a session
ipcMain.handle('delete-session', async (event, { sessionId, projectId }) => {
  // Also close the session instance if it's open
  sessionManager.closeSession(sessionId)

  const projectsDir = getClaudeProjectsDir()
  const sessionFile = path.join(projectsDir, projectId, `${sessionId}.jsonl`)

  // Delete .jsonl file
  if (fs.existsSync(sessionFile)) {
    fs.unlinkSync(sessionFile)
    console.log('[Sessions] Deleted session file:', sessionId)
  }

  // Delete session directory (including config, history, etc.)
  try {
    sessionConfigManager.deleteSession(projectId, sessionId)
    console.log('[Sessions] Deleted session directory:', sessionId)
  } catch (e) {
    // Session directory might not exist, that's okay
    console.log('[Sessions] Session directory not found or already deleted:', sessionId)
  }

  return { success: true }
})

// Open a session (returns session info for compatibility)
ipcMain.handle('open-session', async (event, { sessionId }) => {
  const projectsDir = getClaudeProjectsDir()

  if (!fs.existsSync(projectsDir)) {
    return null
  }

  const projectDirs = fs.readdirSync(projectsDir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => e.name)

  for (const projectId of projectDirs) {
    const sessionFile = path.join(projectsDir, projectId, `${sessionId}.jsonl`)
    if (fs.existsSync(sessionFile)) {
      const stat = fs.statSync(sessionFile)
      const projectPath = decodeProjectPath(projectId)

      return {
        id: sessionId,
        projectId,
        projectPath,
        name: `会话`,
        createdAt: stat.birthtime.toISOString(),
        updatedAt: stat.mtime.toISOString(),
        status: 'idle'
      }
    }
  }

  return null
})

// Rename a project
ipcMain.handle('rename-project', async (event, { projectId, name }) => {
  return { success: true }
})

// Rename a session
ipcMain.handle('rename-session', async (event, { sessionId, projectId, name }) => {
  try {
    if (!sessionId || !name?.trim()) {
      return { success: false, error: 'Invalid session rename request' }
    }

    let targetProjectId = projectId

    if (!targetProjectId) {
      const claudeProjectsDir = getClaudeProjectsDir()
      if (fs.existsSync(claudeProjectsDir)) {
        const projectDirs = fs.readdirSync(claudeProjectsDir, { withFileTypes: true })
          .filter(entry => entry.isDirectory())
          .map(entry => entry.name)

        targetProjectId = projectDirs.find(candidateProjectId => {
          const sessionFile = path.join(claudeProjectsDir, candidateProjectId, `${sessionId}.jsonl`)
          return fs.existsSync(sessionFile) || sessionConfigManager.sessionExists(candidateProjectId, sessionId)
        })
      }
    }

    if (!targetProjectId) {
      return { success: false, error: 'Session not found' }
    }

    const updatedSession = sessionConfigManager.updateSession(targetProjectId, sessionId, {
      name: name.trim()
    })

    return { success: true, session: updatedSession }
  } catch (error) {
    logger.error('[SessionConfig] Failed to rename session', { projectId, sessionId, error: error.message })
    return { success: false, error: error.message }
  }
})

// Open project in new window
ipcMain.handle('open-project-in-new-window', async (event, { projectId }) => {
  try {
    // Get project info
    const projects = await scanProjects()
    const project = projects.find(p => p.id === projectId)

    if (!project) {
      throw new Error('Project not found')
    }

    // Create new BrowserWindow with same config as main window
    const newWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      minWidth: 800,
      minHeight: 600,
      title: project.name,
      titleBarStyle: 'hiddenInset',
      trafficLightPosition: { x: 16, y: 16 },
      icon: getIconPath(),
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    // Store window-project mapping
    newWindow.projectId = projectId

    // Load app with project ID
    if (isDev) {
      const url = `http://localhost:5173/?projectId=${encodeURIComponent(projectId)}`
      logger.info('[Window] Loading URL in new window', { url })
      newWindow.loadURL(url)
    } else {
      // In production, use loadURL with file:// protocol and query params
      const indexPath = path.join(__dirname, '../dist/index.html')
      newWindow.loadURL(`file://${indexPath}?projectId=${encodeURIComponent(projectId)}`)
    }

    // Handle window close
    newWindow.on('closed', () => {
      logger.info('[Window] Closed window', { projectId })
    })

    logger.info('[Window] Created new window', { projectName: project.name, projectId })

    return { success: true, windowId: newWindow.id }
  } catch (error) {
    logger.error('[Window] Failed to create new window', { error: error.message })
    throw error
  }
})

// Check if project folder exists
ipcMain.handle('check-project-exists', async (event, { projectPath }) => {
  try {
    const exists = fs.existsSync(projectPath)
    return { exists }
  } catch (error) {
    logger.error('[Project] Failed to check if project exists', { error: error.message, projectPath })
    return { exists: false }
  }
})

// Select directory dialog
ipcMain.handle('select-directory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory', 'createDirectory'],
    title: '选择项目目录'
  })
  return result
})

// Update window title
ipcMain.handle('update-window-title', async (event, { title }) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window) {
    window.setTitle(title)
    logger.info('[Window] Updated window title:', title)
    return { success: true }
  }
  return { success: false, error: 'Window not found' }
})

// ============================================
// App Config IPC Handlers
// ============================================

const { appConfigManager, docsManager, projectConfigManager, sessionConfigManager } = require('./storage')

// Get app config
ipcMain.handle('get-app-config', async () => {
  try {
    const config = appConfigManager.loadConfig()
    return { success: true, config }
  } catch (error) {
    logger.error('[AppConfig] Failed to get config', { error: error.message })
    return { success: false, error: error.message }
  }
})

// Save app config
ipcMain.handle('save-app-config', async (event, { config }) => {
  try {
    const success = appConfigManager.saveConfig(config)
    return { success }
  } catch (error) {
    logger.error('[AppConfig] Failed to save config', { error: error.message })
    return { success: false, error: error.message }
  }
})

// Update app config
ipcMain.handle('update-app-config', async (event, { updates }) => {
  try {
    const config = appConfigManager.updateConfig(updates)
    return { success: true, config }
  } catch (error) {
    logger.error('[AppConfig] Failed to update config', { error: error.message })
    return { success: false, error: error.message }
  }
})

// Get Claude settings from ~/.claude/settings.json
ipcMain.handle('get-claude-settings', async () => {
  try {
    const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json')

    if (!fs.existsSync(claudeSettingsPath)) {
      logger.info('[ClaudeSettings] Settings file not found')
      return { success: true, settings: {} }
    }

    const content = fs.readFileSync(claudeSettingsPath, 'utf-8')
    const settings = JSON.parse(content)
    return { success: true, settings }
  } catch (error) {
    logger.error('[ClaudeSettings] Failed to load settings', { error: error.message })
    return { success: false, error: error.message }
  }
})

// Update Claude settings to ~/.claude/settings.json
ipcMain.handle('update-claude-settings', async (event, { updates, clearMappings }) => {
  try {
    const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json')

    // 读取现有设置
    let existingSettings = {}
    if (fs.existsSync(claudeSettingsPath)) {
      const content = fs.readFileSync(claudeSettingsPath, 'utf-8')
      existingSettings = JSON.parse(content)
    }

    // 确保 env 对象存在
    if (!existingSettings.env) {
      existingSettings.env = {}
    }

    // 合并 env 变量（只更新指定的，不覆盖其他的）
    if (updates.env) {
      existingSettings.env = {
        ...existingSettings.env,
        ...updates.env
      }
    }

    // 如果需要清除映射变量（单卡片模式）
    if (clearMappings) {
      const mappingKeys = [
        'ANTHROPIC_DEFAULT_SONNET_MODEL',
        'ANTHROPIC_DEFAULT_OPUS_MODEL',
        'ANTHROPIC_DEFAULT_HAIKU_MODEL',
        'ANTHROPIC_SMALL_FAST_MODEL'
      ]
      for (const key of mappingKeys) {
        // 如果 updates.env 中没有提供这个 key，就清除它
        if (!updates?.env?.hasOwnProperty(key)) {
          delete existingSettings.env[key]
        }
      }
    }

    // 更新 model（如果提供）
    if (updates.model !== undefined) {
      existingSettings.model = updates.model
    }

    // 更新 effort（如果提供）
    if (updates.effort !== undefined) {
      existingSettings.effort = updates.effort
    }

    // 确保 .claude 目录存在
    const claudeDir = path.dirname(claudeSettingsPath)
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true })
    }

    // 写入文件
    fs.writeFileSync(claudeSettingsPath, JSON.stringify(existingSettings, null, 2), 'utf-8')
    logger.info('[ClaudeSettings] Settings updated successfully')

    return { success: true, settings: existingSettings }
  } catch (error) {
    logger.error('[ClaudeSettings] Failed to update settings', { error: error.message })
    return { success: false, error: error.message }
  }
})

// ============================================
// Notification IPC Handlers
// ============================================

// Send notification request (for Bark, etc.)
ipcMain.handle('send-notification', async (event, { url }) => {
  logger.info('[Notification] Sending notification', { url: url.substring(0, 50) + '...' })

  try {
    const https = require('https')
    const http = require('http')
    const parsedUrl = new URL(url)
    const protocol = parsedUrl.protocol === 'https:' ? https : http

    return new Promise((resolve) => {
      const req = protocol.get(url, {
        headers: {
          'User-Agent': 'CCGUI/1.0'
        }
      }, (res) => {
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          try {
            const result = JSON.parse(data)
            if (result.code === 200 || result.success) {
              logger.info('[Notification] Notification sent successfully')
              resolve({ success: true, message: '发送成功', data: result })
            } else {
              logger.warn('[Notification] Notification failed', { result })
              resolve({ success: false, message: result.message || '发送失败', error: 'NOTIFICATION_FAILED' })
            }
          } catch (parseError) {
            // 有些通知服务可能不返回 JSON
            if (res.statusCode >= 200 && res.statusCode < 300) {
              resolve({ success: true, message: '发送成功' })
            } else {
              resolve({ success: false, message: `HTTP ${res.statusCode}`, error: 'HTTP_ERROR' })
            }
          }
        })
      })

      req.on('error', (error) => {
        logger.error('[Notification] Request failed', { error: error.message })
        resolve({ success: false, message: error.message, error: 'NETWORK_ERROR' })
      })

      req.setTimeout(10000, () => {
        req.destroy()
        resolve({ success: false, message: '请求超时', error: 'TIMEOUT' })
      })
    })
  } catch (error) {
    logger.error('[Notification] Failed to send', { error: error.message })
    return { success: false, message: error.message, error: 'UNKNOWN_ERROR' }
  }
})

ipcMain.handle('play-system-sound', async (event, { sound }) => {
  try {
    if (process.platform !== 'darwin') {
      return { success: false, error: '当前仅支持 macOS 系统提示音' }
    }

    const systemSoundMap = {
      Basso: '/System/Library/Sounds/Basso.aiff',
      Blow: '/System/Library/Sounds/Blow.aiff',
      Bottle: '/System/Library/Sounds/Bottle.aiff',
      Frog: '/System/Library/Sounds/Frog.aiff',
      Funk: '/System/Library/Sounds/Funk.aiff',
      Glass: '/System/Library/Sounds/Glass.aiff',
      Hero: '/System/Library/Sounds/Hero.aiff',
      Morse: '/System/Library/Sounds/Morse.aiff',
      Ping: '/System/Library/Sounds/Ping.aiff',
      Pop: '/System/Library/Sounds/Pop.aiff',
      Purr: '/System/Library/Sounds/Purr.aiff',
      Sosumi: '/System/Library/Sounds/Sosumi.aiff',
      Submarine: '/System/Library/Sounds/Submarine.aiff',
      Tink: '/System/Library/Sounds/Tink.aiff',
      'ui-alert': '/System/Library/PrivateFrameworks/ScreenReader.framework/Versions/A/Resources/Sounds/Alert.aiff',
      'ui-error': '/System/Library/PrivateFrameworks/ScreenReader.framework/Versions/A/Resources/Sounds/Error.aiff',
      'ui-focus': '/System/Library/PrivateFrameworks/ScreenReader.framework/Versions/A/Resources/Sounds/Focus.aiff',
      'ui-focus-2': '/System/Library/PrivateFrameworks/ScreenReader.framework/Versions/A/Resources/Sounds/Focus2.aiff',
      'ui-guide-success': '/System/Library/PrivateFrameworks/ScreenReader.framework/Versions/A/Resources/Sounds/GuideSuccess.aiff',
      'ui-menu-down': '/System/Library/PrivateFrameworks/ScreenReader.framework/Versions/A/Resources/Sounds/MenuDown.aiff',
      'ui-popup-appeared': '/System/Library/PrivateFrameworks/ScreenReader.framework/Versions/A/Resources/Sounds/PopupAppeared.aiff',
      'ui-window-activated': '/System/Library/PrivateFrameworks/ScreenReader.framework/Versions/A/Resources/Sounds/WindowActivated.aiff'
    }

    const soundPath = systemSoundMap[sound]
    if (!soundPath) {
      return { success: false, error: '无效的系统提示音' }
    }

    if (!fs.existsSync(soundPath)) {
      return { success: false, error: '系统提示音文件不存在' }
    }

    await new Promise((resolve, reject) => {
      execFile('/usr/bin/afplay', [soundPath], (error) => {
        if (error) {
          reject(error)
          return
        }
        resolve()
      })
    })

    return { success: true }
  } catch (error) {
    logger.error('[SystemSound] Failed to play sound', { sound, error: error.message })
    return { success: false, error: error.message }
  }
})

// ============================================
// Docs IPC Handlers
// ============================================

// List all docs
ipcMain.handle('list-docs', async () => {
  try {
    const docs = docsManager.listDocs()
    return { success: true, docs }
  } catch (error) {
    logger.error('[Docs] Failed to list docs', { error: error.message })
    return { success: false, error: error.message }
  }
})

// Get a single doc
ipcMain.handle('get-doc', async (event, { docId }) => {
  try {
    const doc = docsManager.getDoc(docId)
    if (doc) {
      return { success: true, doc }
    } else {
      return { success: false, error: 'Doc not found' }
    }
  } catch (error) {
    logger.error('[Docs] Failed to get doc', { docId, error: error.message })
    return { success: false, error: error.message }
  }
})

// Save a doc
ipcMain.handle('save-doc', async (event, { docId, content }) => {
  try {
    const success = docsManager.saveDoc(docId, content)
    return { success }
  } catch (error) {
    logger.error('[Docs] Failed to save doc', { docId, error: error.message })
    return { success: false, error: error.message }
  }
})

// Rename a doc
ipcMain.handle('rename-doc', async (event, { oldId, newId }) => {
  try {
    const success = docsManager.renameDoc(oldId, newId)
    return { success }
  } catch (error) {
    logger.error('[Docs] Failed to rename doc', { oldId, newId, error: error.message })
    return { success: false, error: error.message }
  }
})

// Delete a doc
ipcMain.handle('delete-doc', async (event, { docId }) => {
  try {
    const success = docsManager.deleteDoc(docId)
    return { success }
  } catch (error) {
    logger.error('[Docs] Failed to delete doc', { docId, error: error.message })
    return { success: false, error: error.message }
  }
})


// Get session messages (for backwards compatibility, but prefer select-session)
ipcMain.handle('get-session-messages', async (event, { sessionId, projectId }) => {
  const projectsDir = getClaudeProjectsDir()
  const projectDir = path.join(projectsDir, projectId)
  const sessionFile = path.join(projectDir, `${sessionId}.jsonl`)

  if (!fs.existsSync(sessionFile)) {
    console.log('[Sessions] Session file does not exist:', sessionFile)
    return []
  }

  try {
    const content = fs.readFileSync(sessionFile, 'utf-8')
    const lines = content.trim().split('\n').filter(line => line.trim())
    const messages = []

    for (const line of lines) {
      try {
        const data = JSON.parse(line)
        messages.push(data)
      } catch (e) {
        // Skip invalid JSON lines
      }
    }

    console.log(`[Sessions] Loaded ${messages.length} messages for session ${sessionId}`)
    return messages
  } catch (e) {
    console.error('[Sessions] Error reading session file:', e.message)
    return []
  }
})

// ============================================
// macOS Dock Support
// ============================================

/**
 * Handle drag folder to dock icon
 */
app.on('open-file', (event, filePath) => {
  event.preventDefault()

  logger.info('[Dock] File/folder dropped to dock icon:', filePath)

  // Check if it's a directory
  try {
    const stats = fs.statSync(filePath)
    if (!stats.isDirectory()) {
      logger.info('[Dock] Not a directory, ignoring:', filePath)
      return
    }
  } catch (error) {
    logger.error('[Dock] Error checking path:', error)
    return
  }

  // Check if there's already a window with this project
  const existingWindow = findWindowByProjectPath(filePath)
  if (existingWindow) {
    logger.info('[Dock] Found existing window for project, focusing it')
    existingWindow.focus()
    return
  }

  // Create project ID from path
  const projectId = encodeProjectPath(filePath)

  // Open in new window
  openProjectWindow(projectId, path.basename(filePath), filePath)
})

/**
 * Find window by project path
 */
function findWindowByProjectPath(projectPath) {
  const windows = BrowserWindow.getAllWindows()
  for (const win of windows) {
    if (win.projectPath === projectPath) {
      return win
    }
  }
  return null
}

/**
 * Encode project path to project ID
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
 * Open project window (new or existing)
 * @param {string} projectId - Encoded project ID (for URL parameter)
 * @param {string} projectName - Project name (for window title)
 * @param {string} projectPath - Original project path (for window lookup)
 */
function openProjectWindow(projectId, projectName, projectPath) {
  // Create new BrowserWindow
  const newWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: projectName,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Store project info
  newWindow.projectId = projectId
  newWindow.projectName = projectName
  newWindow.projectPath = projectPath

  // Load app with project ID
  if (isDev) {
    const url = `http://localhost:5173/?projectId=${encodeURIComponent(projectId)}`
    logger.info('[Window] Loading URL in new window', { url })
    newWindow.loadURL(url)
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html')
    newWindow.loadURL(`file://${indexPath}?projectId=${encodeURIComponent(projectId)}`)
  }

  newWindow.on('closed', () => {
    logger.info('[Window] Closed window', { projectId })
  })

  logger.info('[Window] Created new window for project', { projectName, projectId })

  return newWindow
}

/**
 * Setup dock menu (macOS only)
 */
function setupDockMenu() {
  if (process.platform !== 'darwin') {
    return
  }

  const { Menu, nativeImage } = require('electron')

  // Set dock icon
  const iconPath = isDev
    ? path.join(__dirname, '../build/icons/icon.icns')
    : path.join(__dirname, '../build/icons/icon.icns')

  try {
    if (fs.existsSync(iconPath)) {
      const icon = nativeImage.createFromPath(iconPath)
      app.dock.setIcon(icon)
      logger.info('[Dock] Dock icon set successfully')
    } else {
      logger.warn('[Dock] Icon file not found:', iconPath)
    }
  } catch (error) {
    logger.error('[Dock] Failed to set dock icon:', error)
  }

  const dockMenuTemplate = [
    {
      label: '新建窗口',
      click: () => {
        logger.info('[Dock] New Window clicked')
        createNewWindow()
      }
    }
  ]

  const dockMenu = Menu.buildFromTemplate(dockMenuTemplate)
  app.dock.setMenu(dockMenu)

  logger.info('[Dock] Dock menu setup completed')
}

/**
 * Create new empty window (hello page)
 */
function createNewWindow() {
  const newWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: '首页',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    icon: getIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  // Load app without project ID (shows hello page)
  if (isDev) {
    newWindow.loadURL('http://localhost:5173')
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html')
    newWindow.loadURL(`file://${indexPath}`)
  }

  newWindow.on('closed', () => {
    logger.info('[Window] Closed new window')
  })

  return newWindow
}

// App lifecycle

app.whenReady().then(() => {
  // Update isDev flag now that app is ready
  isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
  logger.info('[App] Development mode:', isDev)

  createWindow()
  setupDockMenu()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  if (sessionManager) {
    sessionManager.closeAll()
  }
})
