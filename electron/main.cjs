const { app, BrowserWindow, ipcMain, session, dialog } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
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
  // Create callback to send events to renderer
  const sendToRenderer = (sessionId, eventType, data) => {
    if (mainWindow && mainWindow.webContents) {
      mainWindow.webContents.send('session-event', {
        sessionId,
        eventType,
        data
      })
    }
  }

  // Create SessionManager instance
  sessionManager = new SessionManager(sendToRenderer)

  // All done,  console.log('[Main] SessionManager initialized')
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
    // Get or create the session instance
    const sessionInstance = await sessionManager.getOrCreateSession(sessionId, projectPath, true)

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
    // Use select-session internally
    const session = await sessionManager.getOrCreateSession(sessionId, projectPath, true)

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
 */
async function getProjectSessions(projectId) {
  const projectsDir = getClaudeProjectsDir()
  const projectDir = path.join(projectsDir, projectId)

  if (!fs.existsSync(projectDir)) {
    logger.info('[Sessions] Project directory does not exist:', projectDir)
    return []
  }

  const files = fs.readdirSync(projectDir)
  const sessions = []

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

    sessions.push({
      id: sessionId,
      projectId,
      name: `会话 ${sessions.length + 1}`,
      preview,
      createdAt: stat.birthtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
      messageCount,
      status: 'idle'
    })
  }

  sessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))

  logger.info(`[Sessions] Found ${sessions.length} sessions for project ${projectId}`)
  return sessions
}

// Get all projects
ipcMain.handle('get-projects', async () => {
  return scanProjects()
})

// Add a new project (by path)
ipcMain.handle('add-project', async (event, { projectPath }) => {
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
  const encodedName = '-' + encodedPath

  return {
    id: encodedName,
    name,
    path: projectPath,
    sessionCount: 0,
    lastActiveAt: new Date().toISOString()
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

  if (fs.existsSync(sessionFile)) {
    fs.unlinkSync(sessionFile)
    console.log('[Sessions] Deleted session:', sessionId)
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
ipcMain.handle('rename-session', async (event, { sessionId, name }) => {
  return { success: true }
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
