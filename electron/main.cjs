const { app, BrowserWindow, ipcMain, session } = require('electron')
const path = require('path')
const { ClaudeManager } = require('./claude-manager')

let mainWindow
let claudeManager
let cachedInitInfo = null // 缓存 init 信息

/**
 * Create main application window
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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

  // Initialize Claude Manager
  initClaudeManager()

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

/**
 * Initialize Claude Manager and setup event handlers
 */
function initClaudeManager() {
  claudeManager = new ClaudeManager()

  // Start Claude CLI
  claudeManager.start().catch((error) => {
    console.error('Failed to start Claude:', error)
    sendSystemMessage({
      type: 'error',
      message: `Failed to start Claude: ${error.message}`
    })
  })

  // Handle assistant messages
  claudeManager.on('assistant', (message) => {
    mainWindow?.webContents.send('claude-message', message)
  })

  // Handle result messages
  claudeManager.on('result', (message) => {
    mainWindow?.webContents.send('claude-result', message)
  })

  // Handle system messages
  claudeManager.on('system', (message) => {
    console.log('[Claude Manager] system:', JSON.stringify(message, null, 2).substring(0, 500))
    if (message.subtype === 'init') {
      cachedInitInfo = message // 缓存 init 信息
      mainWindow?.webContents.send('claude-init', message)
    } else {
      mainWindow?.webContents.send('system-message', message)
    }
  })

  // Handle tool_use messages
  claudeManager.on('tool_use', (message) => {
    mainWindow?.webContents.send('tool-use', message)
  })

  // Handle tool_result messages
  claudeManager.on('tool_result', (message) => {
    mainWindow?.webContents.send('tool-result', message)
  })

  // Handle tool_use requests (for permission dialog)
  claudeManager.on('tool_use_request', (message) => {
    console.log('[Claude Manager] tool_use_request:', JSON.stringify(message, null, 2).substring(0, 500))
    mainWindow?.webContents.send('tool-use-request', message)
  })

  // Handle control_request (for permission prompts with --permission-prompt-tool stdio)
  claudeManager.on('control_request', (message) => {
    console.log('[Claude Manager] control_request:', JSON.stringify(message, null, 2).substring(0, 800))
    // Forward to renderer for permission dialog
    mainWindow?.webContents.send('control-request', message)
  })

  // Handle CLI status messages (stderr output like connection status, retries, etc.)
  claudeManager.on('cli-status', (message) => {
    mainWindow?.webContents.send('cli-status', message)
  })

  // Handle stream events (thinking_delta, text_delta, etc.)
  claudeManager.on('stream_event', (message) => {
    mainWindow?.webContents.send('stream-event', message)
  })

  // Handle unknown/unsupported message types
  claudeManager.on('unknown_message', (message) => {
    console.log('[Claude Manager] ⚠️ Unknown message type:', message.type)
    mainWindow?.webContents.send('unknown-message', message)
  })
}

/**
 * Send system message to renderer
 */
function sendSystemMessage(message) {
  mainWindow?.webContents.send('system-message', message)
}

// IPC Handlers

// Send message to Claude
ipcMain.handle('send-message', async (event, userMessage) => {
  console.log('[IPC] send-message:', JSON.stringify(userMessage, null, 2))
  claudeManager.sendMessage(userMessage)
  return { success: true }
})

// Get Claude info
ipcMain.handle('get-claude-info', async () => {
  return {
    version: '1.0.0',
    tools: ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep'],
    isReady: claudeManager?.isReady() || false,
    workingDirectory: claudeManager?.getWorkingDirectory() || process.cwd()
  }
})

// Check if Claude is ready
ipcMain.handle('is-claude-ready', async () => {
  return claudeManager?.isReady() || false
})

// Get cached init info
ipcMain.handle('get-init-info', async () => {
  return cachedInitInfo
})

// Handle tool result (permission response)
ipcMain.handle('send-tool-result', async (event, toolUseId, content, isError) => {
  console.log('[IPC] send-tool-result:', { toolUseId, content: content?.substring(0, 100), isError })
  claudeManager?.sendToolResult(toolUseId, content, isError)
  return { success: true }
})

// Handle control response (for --permission-prompt-tool stdio)
ipcMain.handle('send-control-response', async (event, requestId, approved, options) => {
  console.log('[IPC] send-control-response:', { requestId, approved, options })
  claudeManager?.sendControlResponse(requestId, approved, options)
  return { success: true }
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
  // Cleanup on quit
  if (claudeManager) {
    claudeManager.stop()
  }
})
