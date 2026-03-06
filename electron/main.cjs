const { app, BrowserWindow, ipcMain, session } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { SessionManager } = require('./session-manager')

let mainWindow
let sessionManager

/**
 * Create main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: 'Claude Code GUI',
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
  const isDev = true
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
  console.log('[Frontend]', ...args)
})

// Select/Activate a session - creates SessionInstance and returns state
ipcMain.handle('select-session', async (event, { sessionId, projectId, projectPath }) => {
  console.log('[IPC] select-session:', { sessionId, projectId, projectPath })

  try {
    // Get or create the session instance
    const sessionInstance = await sessionManager.getOrCreateSession(sessionId, projectPath, true)

    // Return the session state
    return {
      success: true,
      state: sessionInstance.getState()
    }
  } catch (error) {
    console.error('[IPC] select-session error:', error)
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
  console.log('[IPC] send-message:', { sessionId, contentLength: content?.length || message?.length })

  try {
    // Support both 'content' (new) and 'message' (legacy) parameters
    const messageContent = content || message
    await sessionManager.sendMessage(sessionId, messageContent)
    return { success: true }
  } catch (error) {
    console.error('[IPC] send-message error:', error)
    return { success: false, error: error.message }
  }
})

// Send control response (for permission prompts)
ipcMain.handle('send-control-response', async (event, { sessionId, requestId, approved, options }) => {
  console.log('[IPC] send-control-response:', { sessionId, requestId, approved })

  try {
    await sessionManager.sendControlResponse(sessionId, requestId, approved, options)
    return { success: true }
  } catch (error) {
    console.error('[IPC] send-control-response error:', error)
    return { success: false, error: error.message }
  }
})

// Send interrupt
ipcMain.handle('send-interrupt', async (event, options) => {
  const sessionId = options?.sessionId
  console.log('[IPC] send-interrupt:', sessionId)

  // If no sessionId, try to get the current active session
  if (!sessionId) {
    const activeSessions = sessionManager.getActiveSessionIds()
    if (activeSessions.length > 0) {
      // Use the first active session
      const activeSessionId = activeSessions[0]
      console.log('[IPC] send-interrupt: using active session', activeSessionId)
      try {
        await sessionManager.sendInterrupt(activeSessionId)
        return { success: true }
      } catch (error) {
        console.error('[IPC] send-interrupt error:', error)
        return { success: false, error: error.message }
      }
    }
    return { success: false, error: 'No active session' }
  }

  try {
    await sessionManager.sendInterrupt(sessionId)
    return { success: true }
  } catch (error) {
    console.error('[IPC] send-interrupt error:', error)
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
  console.log('[IPC] send-tool-result:', { sessionId, toolUseId, isError })

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
    console.error('[IPC] send-tool-result error:', error)
    return { success: false, error: error.message }
  }
})

// Start session (legacy - for backwards compatibility)
ipcMain.handle('start-session', async (event, { sessionId, projectPath }) => {
  console.log('[IPC] start-session (legacy):', { sessionId, projectPath })

  try {
    // Use select-session internally
    const session = await sessionManager.getOrCreateSession(sessionId, projectPath, true)
    return { success: true, sessionId }
  } catch (error) {
    console.error('[IPC] start-session error:', error)
    return { success: false, error: error.message }
  }
})

// Close session
ipcMain.handle('close-session', async (event, { sessionId }) => {
  console.log('[IPC] close-session:', sessionId)
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
    console.log('[Projects] Projects directory does not exist:', projectsDir)
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

  console.log(`[Projects] Found ${projects.length} projects`)
  return projects
}

/**
 * Get sessions for a specific project
 */
async function getProjectSessions(projectId) {
  const projectsDir = getClaudeProjectsDir()
  const projectDir = path.join(projectsDir, projectId)

  if (!fs.existsSync(projectDir)) {
    console.log('[Sessions] Project directory does not exist:', projectDir)
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
      console.log('[Sessions] Error reading session file:', e.message)
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

  console.log(`[Sessions] Found ${sessions.length} sessions for project ${projectId}`)
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
ipcMain.handle('remove-project', async (event, { projectId }) => {
  const projectsDir = getClaudeProjectsDir()
  const projectDir = path.join(projectsDir, projectId)

  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true })
    console.log('[Projects] Removed project:', projectId)
  }

  return { success: true }
})

// Get sessions for a project
ipcMain.handle('get-sessions', async (event, { projectId }) => {
  return getProjectSessions(projectId)
})

// Get running sessions
ipcMain.handle('get-running-sessions', async () => {
  if (!sessionManager) {
    return []
  }

  const runningSessionIds = []
  for (const [sessionId, session] of sessionManager.sessions) {
    if (session.isClaudeReady()) {
      runningSessionIds.push(sessionId)
    }
  }
  return runningSessionIds
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

// App lifecycle

app.whenReady().then(() => {
  createWindow()

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
