const { app, BrowserWindow, ipcMain, session, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFile, fork, spawn } = require('child_process')
const { SessionManager } = require('./session/session-manager')
const logger = require('./logger')

// 初始化日志系统
logger.initialize()

// Global isDev flag - will be set before creating windows
let isDev = process.env.NODE_ENV === 'development'

let mainWindow
let sessionManager
let projectFileWatcher = null
let projectFileWatcherPath = ''
let terminalSequence = 0
const terminalSessions = new Map()
let terminalHostProcess = null
let terminalHostRequestSequence = 0
const terminalHostPendingRequests = new Map()
let isAppQuitting = false
const pendingDockProjectOpens = []

/**
 * Get app icon path
 */
function getIconPath() {
  return path.join(__dirname, '../build/icons/icon.icns')
}

function getDefaultTerminalShell() {
  if (process.platform === 'win32') {
    return process.env.ComSpec || 'powershell.exe'
  }

  const candidates = [
    process.env.SHELL,
    os.userInfo?.().shell,
    process.platform === 'darwin' ? '/bin/zsh' : null,
    '/bin/bash',
    '/bin/sh'
  ].filter(Boolean)

  for (const candidate of candidates) {
    if (!candidate) continue
    if (path.isAbsolute(candidate) && fs.existsSync(candidate)) {
      return candidate
    }
    return candidate
  }

  return '/bin/sh'
}

function getTerminalShellArgs(shellPath) {
  if (process.platform === 'win32') {
    return []
  }

  const shellName = path.basename(shellPath || '').toLowerCase()
  if (shellName === 'bash' || shellName === 'zsh' || shellName === 'sh' || shellName === 'fish') {
    return ['-i']
  }

  return []
}

function buildTerminalName(shellPath) {
  terminalSequence += 1
  return `${path.basename(shellPath || 'shell')} ${terminalSequence}`
}

function rejectPendingTerminalHostRequests(error) {
  for (const { reject } of terminalHostPendingRequests.values()) {
    reject(error)
  }
  terminalHostPendingRequests.clear()
}

function handleTerminalHostMessage(message) {
  if (!message || typeof message !== 'object') {
    return
  }

  if (message.type === 'response') {
    const pending = terminalHostPendingRequests.get(message.requestId)
    if (!pending) {
      return
    }

    terminalHostPendingRequests.delete(message.requestId)
    if (message.success) {
      pending.resolve(message)
    } else {
      pending.reject(new Error(message.error || '终端主机操作失败'))
    }
    return
  }

  if (message.type === 'terminal-data') {
    const terminalSession = terminalSessions.get(message.terminalId)
    if (!terminalSession) return
    const webContents = getWebContentsById(terminalSession.webContentsId)

    if (webContents && !webContents.isDestroyed()) {
      webContents.send('terminal-data', {
        terminalId: message.terminalId,
        data: message.data || ''
      })
    }
    return
  }

  if (message.type === 'terminal-exit') {
    const terminalSession = terminalSessions.get(message.terminalId)
    if (!terminalSession) return
    const webContents = getWebContentsById(terminalSession.webContentsId)

    stopTerminalCommandMonitor(terminalSession)
    terminalSessions.delete(message.terminalId)
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('terminal-exit', {
        terminalId: message.terminalId,
        exitCode: message.exitCode,
        signal: message.signal
      })
    }
  }
}

function getWebContentsById(id) {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.webContents.id === id) {
      return window.webContents
    }
  }
  return null
}

function ensureTerminalHostProcess() {
  if (terminalHostProcess && !terminalHostProcess.killed) {
    return terminalHostProcess
  }

  const child = fork(path.join(__dirname, 'terminal-host.cjs'), [], {
    stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  })

  child.on('message', handleTerminalHostMessage)
  child.on('exit', (code, signal) => {
    if (terminalHostProcess === child) {
      terminalHostProcess = null
    }

    const error = new Error(`终端主机已退出 (${code ?? 'null'} / ${signal ?? 'null'})`)
    rejectPendingTerminalHostRequests(error)

    for (const [terminalId, terminalSession] of terminalSessions.entries()) {
      stopTerminalCommandMonitor(terminalSession)
      const webContents = getWebContentsById(terminalSession.webContentsId)
      if (webContents && !webContents.isDestroyed()) {
        webContents.send('terminal-exit', {
          terminalId,
          exitCode: code ?? null,
          signal: signal ?? null
        })
      }
    }
    terminalSessions.clear()
  })

  terminalHostProcess = child
  return child
}

function sendTerminalHostRequest(type, payload = {}) {
  const child = ensureTerminalHostProcess()
  const requestId = `terminal-host-${Date.now()}-${++terminalHostRequestSequence}`

  return new Promise((resolve, reject) => {
    terminalHostPendingRequests.set(requestId, { resolve, reject })
    child.send({ type, requestId, payload }, error => {
      if (!error) {
        return
      }

      terminalHostPendingRequests.delete(requestId)
      reject(error)
    })
  })
}

function disposeTerminalSession(terminalId) {
  const terminalSession = terminalSessions.get(terminalId)
  if (!terminalSession) return

  stopTerminalCommandMonitor(terminalSession)
  terminalSessions.delete(terminalId)
  sendTerminalHostRequest('close-terminal', { terminalId }).catch(() => {
    // Ignore host shutdown errors while cleaning up.
  })
}

function disposeTerminalsForWebContents(webContentsId) {
  for (const [terminalId, terminalSession] of terminalSessions.entries()) {
    if (terminalSession.webContentsId === webContentsId) {
      disposeTerminalSession(terminalId)
    }
  }
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
        'Content-Security-Policy': [
          "default-src 'self' http://localhost:5173; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://localhost:5173 ws://localhost:5173; " +
          "style-src 'self' 'unsafe-inline' http://localhost:5173; " +
          "connect-src 'self' http://localhost:5173 ws://localhost:5173; " +
          "img-src 'self' data: http://localhost:5173; " +
          "font-src 'self' data: http://localhost:5173; " +
          "worker-src 'self' blob: http://localhost:5173; " +
          "child-src 'self' blob: http://localhost:5173; " +
          "object-src 'none';"
        ]
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

  const mainWindowWebContentsId = mainWindow.webContents.id
  mainWindow.on('closed', () => {
    disposeTerminalsForWebContents(mainWindowWebContentsId)
    stopProjectFileWatcher()
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

const FILE_TREE_IGNORES = new Set([
  '.git',
  'node_modules',
  '.DS_Store',
  '.idea',
  '.vscode',
  'dist',
  'build',
  'output'
])

const MAX_PREVIEW_FILE_SIZE = 1024 * 1024

function normalizePathSlashes(value = '') {
  return String(value || '').replace(/\\/g, '/')
}

function resolveProjectTargetPath(projectPath, targetPath = '') {
  const normalizedProjectPath = path.resolve(projectPath)
  const normalizedTargetPath = path.resolve(normalizedProjectPath, targetPath)
  const relativePath = path.relative(normalizedProjectPath, normalizedTargetPath)

  if (relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    throw new Error('目标路径超出项目目录')
  }

  return normalizedTargetPath
}

function detectLanguageFromPath(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  const languageMap = {
    '.js': 'javascript',
    '.cjs': 'javascript',
    '.mjs': 'javascript',
    '.ts': 'typescript',
    '.tsx': 'typescript',
    '.jsx': 'javascript',
    '.vue': 'xml',
    '.json': 'json',
    '.toml': 'ini',
    '.yaml': 'yaml',
    '.yml': 'yaml',
    '.md': 'markdown',
    '.css': 'css',
    '.scss': 'scss',
    '.less': 'less',
    '.html': 'xml',
    '.xml': 'xml',
    '.sh': 'bash',
    '.py': 'python',
    '.rs': 'rust',
    '.go': 'go',
    '.java': 'java'
  }

  return languageMap[extension] || 'plaintext'
}

function isLikelyBinary(buffer) {
  if (!buffer || buffer.length === 0) return false

  const sampleLength = Math.min(buffer.length, 1024)
  let suspiciousBytes = 0
  for (let i = 0; i < sampleLength; i += 1) {
    const byte = buffer[i]
    if (byte === 0) return true
    if ((byte < 7 || (byte > 14 && byte < 32)) && byte !== 9 && byte !== 10 && byte !== 13) {
      suspiciousBytes += 1
    }
  }

  return suspiciousBytes / sampleLength > 0.15
}

function listDirectoryEntries(projectPath, relativePath = '') {
  const targetDir = resolveProjectTargetPath(projectPath, relativePath)

  if (!fs.existsSync(targetDir)) {
    throw new Error('目录不存在')
  }

  const stat = fs.statSync(targetDir)
  if (!stat.isDirectory()) {
    throw new Error('目标不是目录')
  }

  return fs.readdirSync(targetDir, { withFileTypes: true })
    .filter(entry => !FILE_TREE_IGNORES.has(entry.name))
    .map(entry => {
      const entryAbsolutePath = path.join(targetDir, entry.name)
      const entryRelativePath = path.relative(projectPath, entryAbsolutePath)
      let hasChildren = false

      if (entry.isDirectory()) {
        try {
          hasChildren = fs.readdirSync(entryAbsolutePath).some(childName => !FILE_TREE_IGNORES.has(childName))
        } catch (error) {
          hasChildren = false
        }
      }

      return {
        name: entry.name,
        path: entryRelativePath,
        type: entry.isDirectory() ? 'directory' : 'file',
        extension: entry.isDirectory() ? '' : path.extname(entry.name).toLowerCase(),
        hasChildren
      }
    })
    .sort((left, right) => {
      if (left.type !== right.type) {
        return left.type === 'directory' ? -1 : 1
      }
      return left.name.localeCompare(right.name, 'zh-Hans-CN', { sensitivity: 'base' })
    })
}

function validateProjectEntryName(name) {
  const normalizedName = String(name || '').trim()
  if (!normalizedName) {
    throw new Error('名称不能为空')
  }
  if (normalizedName === '.' || normalizedName === '..') {
    throw new Error('名称无效')
  }
  if (normalizedName.includes('/') || normalizedName.includes('\\')) {
    throw new Error('名称不能包含路径分隔符')
  }
  return normalizedName
}

function ensureProjectParentDirectory(projectPath, parentPath = '') {
  const absoluteParentPath = resolveProjectTargetPath(projectPath, parentPath)
  if (!fs.existsSync(absoluteParentPath)) {
    throw new Error('父目录不存在')
  }
  const stat = fs.statSync(absoluteParentPath)
  if (!stat.isDirectory()) {
    throw new Error('父级目标不是目录')
  }
  return absoluteParentPath
}

function execFileAsync(command, args = [], options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message || '命令执行失败'))
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

function normalizeProcessName(command = '') {
  const rawName = String(command || '').trim()
  if (!rawName) return ''
  return path.basename(rawName).replace(/^-+/, '')
}

function getTerminalDisplayCommand(command = '', shellPath = '') {
  return normalizeProcessName(command) || normalizeProcessName(shellPath) || 'shell'
}

async function resolveForegroundProcessName(terminalPid) {
  const normalizedPid = Number(terminalPid)
  if (!Number.isFinite(normalizedPid) || normalizedPid <= 0) {
    return ''
  }

  try {
    const { stdout: tpgidOutput } = await execFileAsync('ps', ['-o', 'tpgid=', '-p', String(normalizedPid)])
    const foregroundGroupId = String(tpgidOutput || '').trim()
    if (!foregroundGroupId || foregroundGroupId === '0' || foregroundGroupId === '-1') {
      return ''
    }

    const { stdout: processListOutput } = await execFileAsync('ps', ['-axo', 'pid=,pgid=,comm='])
    const lines = String(processListOutput || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    const processes = lines.map(line => {
      const match = line.match(/^(\d+)\s+(\d+)\s+(.+)$/)
      if (!match) return null
      return {
        pid: Number(match[1]),
        pgid: Number(match[2]),
        command: match[3]
      }
    }).filter(Boolean).filter(item => String(item.pgid) === foregroundGroupId)

    if (processes.length === 0) {
      return ''
    }

    const foregroundProcess = processes.find(item => item.pid !== normalizedPid) || processes[0]
    return foregroundProcess?.command || ''
  } catch (error) {
    return ''
  }
}

function emitTerminalStatus(terminalSession) {
  if (!terminalSession) return

  const webContents = getWebContentsById(terminalSession.webContentsId)
  if (!webContents || webContents.isDestroyed()) {
    return
  }

  webContents.send('terminal-status', {
    terminalId: terminalSession.id,
    command: terminalSession.currentCommand || getTerminalDisplayCommand('', terminalSession.shell)
  })
}

function stopTerminalCommandMonitor(terminalSession) {
  if (!terminalSession?.monitorTimer) return
  clearInterval(terminalSession.monitorTimer)
  terminalSession.monitorTimer = null
}

function startTerminalCommandMonitor(terminalSession) {
  if (!terminalSession?.pid) return

  stopTerminalCommandMonitor(terminalSession)

  const refreshCommand = async () => {
    const activeCommand = await resolveForegroundProcessName(terminalSession.pid)
    const nextCommand = getTerminalDisplayCommand(activeCommand, terminalSession.shell)
    if (nextCommand === terminalSession.currentCommand) {
      return
    }

    terminalSession.currentCommand = nextCommand
    emitTerminalStatus(terminalSession)
  }

  refreshCommand()
  terminalSession.monitorTimer = setInterval(refreshCommand, 1000)
}

function parseGitStatusPorcelainToRepoPaths(output = '') {
  const statusMap = {}
  const lines = String(output || '').split(/\r?\n/).filter(Boolean)

  for (const line of lines) {
    if (line.length < 4) continue

    const x = line[0]
    const y = line[1]
    const rawPath = line.slice(3).trim()
    const normalizedPath = normalizePathSlashes(rawPath.includes(' -> ') ? rawPath.split(' -> ').pop() : rawPath)

    if (!normalizedPath) continue

    let code = ''
    if (x === '?' && y === '?') {
      code = '?'
    } else if (x === 'U' || y === 'U') {
      code = 'U'
    } else if (x === 'A' || y === 'A') {
      code = 'A'
    } else if (x === 'D' || y === 'D') {
      code = 'D'
    } else if (x === 'R' || y === 'R') {
      code = 'R'
    } else if (x === 'M' || y === 'M' || x === 'T' || y === 'T' || x === 'C' || y === 'C') {
      code = 'M'
    }

    if (code) {
      statusMap[normalizedPath] = code
    }
  }

  return statusMap
}

function collectNestedGitRepoRoots(projectPath) {
  const absoluteProjectPath = path.resolve(projectPath)
  const repoRoots = new Set()
  const queue = [absoluteProjectPath]

  while (queue.length > 0) {
    const currentPath = queue.shift()
    let dirEntries = []

    try {
      dirEntries = fs.readdirSync(currentPath, { withFileTypes: true })
    } catch (error) {
      continue
    }

    const hasGitMarker = dirEntries.some(entry => entry.name === '.git')
    if (hasGitMarker) {
      repoRoots.add(currentPath)
      continue
    }

    for (const entry of dirEntries) {
      if (!entry.isDirectory()) continue
      if (FILE_TREE_IGNORES.has(entry.name)) continue
      queue.push(path.join(currentPath, entry.name))
    }
  }

  return [...repoRoots]
}

async function resolveProjectGitRepoRoots(projectPath) {
  const absoluteProjectPath = path.resolve(projectPath)
  const repoRoots = new Set()

  try {
    await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: absoluteProjectPath })
    const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd: absoluteProjectPath })
    const rootPath = path.resolve(String(stdout || '').trim())
    repoRoots.add(rootPath)
  } catch (error) {
    // The project root itself is not inside a git work tree.
  }

  for (const nestedRoot of collectNestedGitRepoRoots(absoluteProjectPath)) {
    repoRoots.add(path.resolve(nestedRoot))
  }

  return [...repoRoots]
}

async function resolveOwningGitRepoRoot(projectPath, targetPath) {
  const absoluteProjectPath = path.resolve(projectPath)
  const absoluteTargetPath = resolveProjectTargetPath(projectPath, targetPath)
  const repoRoots = await resolveProjectGitRepoRoots(absoluteProjectPath)

  const matchedRoots = repoRoots
    .filter(repoRoot => {
      const relativePath = path.relative(repoRoot, absoluteTargetPath)
      return relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
    })
    .sort((left, right) => right.length - left.length)

  return matchedRoots[0] || null
}

async function getProjectGitStatusMap(projectPath) {
  const absoluteProjectPath = path.resolve(projectPath)
  const projectRelativeStatuses = {}

  for (const repoRootPath of await resolveProjectGitRepoRoots(absoluteProjectPath)) {
    let stdout = ''

    try {
      const result = await execFileAsync(
        'git',
        ['status', '--porcelain=v1', '--untracked-files=all'],
        { cwd: repoRootPath }
      )
      stdout = result.stdout || ''
    } catch (error) {
      continue
    }

    const repoRelativeStatuses = parseGitStatusPorcelainToRepoPaths(stdout)

    for (const [repoRelativePath, status] of Object.entries(repoRelativeStatuses)) {
      const absoluteEntryPath = path.resolve(repoRootPath, repoRelativePath)
      const projectRelativePath = normalizePathSlashes(path.relative(absoluteProjectPath, absoluteEntryPath))

      if (
        !projectRelativePath ||
        projectRelativePath.startsWith('..') ||
        path.isAbsolute(projectRelativePath)
      ) {
        continue
      }

      projectRelativeStatuses[projectRelativePath] = status
    }
  }

  return projectRelativeStatuses
}

async function openPathInSystemFileManager(targetPath, { reveal = false } = {}) {
  if (process.platform === 'darwin') {
    const args = reveal ? ['-R', targetPath] : [targetPath]
    await execFileAsync('open', args)
    return
  }

  if (process.platform === 'win32') {
    if (reveal) {
      await execFileAsync('explorer.exe', ['/select,', targetPath])
    } else {
      await execFileAsync('explorer.exe', [targetPath])
    }
    return
  }

  const openError = await shell.openPath(reveal ? path.dirname(targetPath) : targetPath)
  if (openError) {
    throw new Error(openError)
  }
}

function stopProjectFileWatcher() {
  if (projectFileWatcher) {
    projectFileWatcher.close()
    projectFileWatcher = null
    projectFileWatcherPath = ''
  }
}

function shouldIgnoreWatchedPath(relativePath = '') {
  const normalizedPath = normalizePathSlashes(relativePath)
  if (!normalizedPath) return false

  const segments = normalizedPath.split('/').filter(Boolean)
  return segments.some(segment => FILE_TREE_IGNORES.has(segment))
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
    await sessionManager.sendMessage(sessionId, content)
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

ipcMain.handle('get-runtime-info', async (event, options) => {
  const sessionId = options?.sessionId

  // Safely get session if sessionId is provided and sessionManager is initialized
  let session = null
  if (sessionId && sessionManager) {
    session = sessionManager.getSession(sessionId)
  }

  return {
    version: '1.0.0',
    tools: ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep'],
    isReady: session?.isRuntimeReady?.() || false,
    workingDirectory: session?.projectPath || process.cwd()
  }
})

ipcMain.handle('get-runtime-init-info', async (event, options) => {
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

ipcMain.handle('is-runtime-ready', async (event, options) => {
  const sessionId = options?.sessionId

  if (!sessionManager) {
    return false
  }

  const session = sessionId ? sessionManager.getSession(sessionId) : null
  return session?.isRuntimeReady?.() || false
})

ipcMain.handle('send-runtime-tool-result', async (event, { sessionId, toolUseId, content, isError }) => {
  logger.info('[IPC] send-runtime-tool-result:', { sessionId, toolUseId, isError })

  try {
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      return { success: false, error: 'Session not found' }
    }

    if (typeof session.sendRuntimeToolResult === 'function') {
      session.sendRuntimeToolResult(toolUseId, content, isError)
    }
    return { success: true }
  } catch (error) {
    logger.error('[IPC] send-runtime-tool-result error:', error)
    return { success: false, error: error.message }
  }
})

// Start session
ipcMain.handle('start-session', async (event, { sessionId, projectPath }) => {
  logger.info('[IPC] start-session:', { sessionId, projectPath })

  try {
    // Use select-session internally, passing webContents for multi-window support
    const session = await sessionManager.getOrCreateSession(sessionId, projectPath, event.sender, true)

    // Start runtime process
    await session.start()

    logger.info('[IPC] start-session completed:', { sessionId, ready: session.isRuntimeReady() })
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

// Stop runtime process (keep session alive for restart)
ipcMain.handle('stop-session-runtime', async (event, { sessionId }) => {
  logger.info('[IPC] stop-session-runtime:', sessionId)
  sessionManager.stopSessionRuntime(sessionId)
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

function getCodexExecutablePath() {
  const possiblePaths = [
    '/Applications/Codex.app/Contents/Resources/codex',
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    path.join(os.homedir(), '.local', 'bin', 'codex')
  ]

  return possiblePaths.find(candidate => fs.existsSync(candidate)) || null
}

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
  const ccguiProjects = scanCCGUIProjects()
  const claudeProjects = scanClaudeProjects()
  const codexProjects = await scanCodexProjects()

  const merged = mergeProjectsByPath(ccguiProjects, claudeProjects, codexProjects)
  logger.info(`[Projects] Found ${merged.length} merged projects (ccgui=${ccguiProjects.length}, claude=${claudeProjects.length}, codex=${codexProjects.length})`)
  return merged
}

function scanCCGUIProjects() {
  try {
    const projects = projectConfigManager.getAllProjects() || []
    return projects.map(project => ({
      id: project.id || encodeProjectPath(project.path),
      name: project.name || path.basename(project.path),
      path: project.path,
      sessionCount: project.sessionCount || 0,
      lastActiveAt: project.updatedAt || project.createdAt || null,
      settings: project.settings || {},
      sourceFlags: {
        ccgui: true,
        claude: false,
        codex: false
      }
    }))
  } catch (error) {
    logger.warn('[Projects] Failed to scan CCGUI projects', { error: error.message })
    return []
  }
}

function scanClaudeProjects() {
  const projectsDir = getClaudeProjectsDir()

  if (!fs.existsSync(projectsDir)) {
    logger.info('[Projects] Claude projects directory does not exist:', projectsDir)
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
      lastActiveAt,
      settings: {},
      sourceFlags: {
        ccgui: false,
        claude: true,
        codex: false
      }
    })
  }

  projects.sort((a, b) => {
    if (!a.lastActiveAt) return 1
    if (!b.lastActiveAt) return -1
    return new Date(b.lastActiveAt) - new Date(a.lastActiveAt)
  })

  return projects
}

async function scanCodexProjects() {
  const codexPath = getCodexExecutablePath()
  if (!codexPath) {
    logger.info('[Projects] Codex executable not found, skip codex project scan')
    return []
  }

  let child = null
  try {
    child = spawn(codexPath, ['app-server', '--listen', 'stdio://'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe']
    })

    const readline = require('readline')
    const rl = readline.createInterface({ input: child.stdout })
    const pending = new Map()
    let requestId = 0

    const send = (payload) => {
      child.stdin.write(JSON.stringify(payload) + '\n')
    }

    const request = (method, params) => {
      const id = String(++requestId)
      send({ id, method, params })
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        setTimeout(() => {
          if (!pending.has(id)) return
          pending.delete(id)
          reject(new Error(`Codex request timeout: ${method}`))
        }, 10000)
      })
    }

    rl.on('line', (line) => {
      if (!line.trim()) return
      let message = null
      try {
        message = JSON.parse(line)
      } catch (error) {
        return
      }

      if (message.id !== undefined) {
        const key = String(message.id)
        const entry = pending.get(key)
        if (!entry) return
        pending.delete(key)
        if (message.error) {
          entry.reject(new Error(message.error.message || 'Codex request failed'))
        } else {
          entry.resolve(message.result)
        }
      }
    })

    await request('initialize', {
      clientInfo: { name: 'ccgui-project-scan', version: '1.0.0' },
      capabilities: { experimentalApi: true }
    })
    send({ method: 'initialized' })

    const result = await request('thread/list', {
      limit: 200,
      archived: false
    })

    const threadMap = new Map()
    for (const thread of result?.data || []) {
      if (!thread?.cwd) continue
      const projectId = encodeProjectPath(thread.cwd)
      const current = threadMap.get(projectId)
      const updatedAt = thread.updatedAt ? new Date(thread.updatedAt * 1000).toISOString() : null
      const nextProject = {
        id: projectId,
        name: path.basename(thread.cwd),
        path: thread.cwd,
        sessionCount: (current?.sessionCount || 0) + 1,
        lastActiveAt: updatedAt,
        settings: current?.settings || {},
        sourceFlags: {
          ccgui: false,
          claude: false,
          codex: true
        }
      }

      if (!current || (updatedAt && (!current.lastActiveAt || new Date(updatedAt) > new Date(current.lastActiveAt)))) {
        threadMap.set(projectId, nextProject)
      } else {
        threadMap.set(projectId, {
          ...current,
          sessionCount: nextProject.sessionCount,
          sourceFlags: nextProject.sourceFlags
        })
      }
    }

    rl.close()
    child.kill('SIGTERM')
    return Array.from(threadMap.values())
  } catch (error) {
    logger.warn('[Projects] Failed to scan Codex projects', { error: error.message })
    if (child) {
      child.kill('SIGTERM')
    }
    return []
  }
}

function mergeProjectsByPath(...projectLists) {
  const merged = new Map()

  for (const projects of projectLists) {
    for (const project of projects) {
      if (!project?.path) continue

      const existing = merged.get(project.path)
      if (!existing) {
        merged.set(project.path, {
          ...project,
          id: project.id || encodeProjectPath(project.path),
          sourceFlags: {
            ccgui: !!project.sourceFlags?.ccgui,
            claude: !!project.sourceFlags?.claude,
            codex: !!project.sourceFlags?.codex
          }
        })
        continue
      }

      merged.set(project.path, {
        ...existing,
        ...project,
        id: existing.id || project.id || encodeProjectPath(project.path),
        name: existing.name || project.name || path.basename(project.path),
        settings: existing.settings && Object.keys(existing.settings).length > 0 ? existing.settings : (project.settings || {}),
        sessionCount: Math.max(existing.sessionCount || 0, project.sessionCount || 0),
        lastActiveAt: pickLatestTimestamp(existing.lastActiveAt, project.lastActiveAt),
        sourceFlags: {
          ccgui: !!(existing.sourceFlags?.ccgui || project.sourceFlags?.ccgui),
          claude: !!(existing.sourceFlags?.claude || project.sourceFlags?.claude),
          codex: !!(existing.sourceFlags?.codex || project.sourceFlags?.codex)
        }
      })
    }
  }

  return Array.from(merged.values())
    .sort((a, b) => {
      if (!a.lastActiveAt) return 1
      if (!b.lastActiveAt) return -1
      return new Date(b.lastActiveAt) - new Date(a.lastActiveAt)
    })
}

function pickLatestTimestamp(a, b) {
  if (!a) return b || null
  if (!b) return a || null
  return new Date(a) >= new Date(b) ? a : b
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
  const projectId = encodeProjectPath(projectPath)

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
    settings: projectConfig.settings || {},
    sourceFlags: {
      ccgui: true,
      claude: false,
      codex: false
    }
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
      ready: session.isRuntimeReady(),
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
ipcMain.handle('create-session', async (event, { projectId, name, settings }) => {
  const projectsDir = getClaudeProjectsDir()
  const projectDir = path.join(projectsDir, projectId)

  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true })
  }

  const sessionConfig = sessionConfigManager.createSession(projectId, {
    name: name || '新会话',
    settings: settings || {}
  })
  const sessionFile = path.join(projectDir, `${sessionConfig.id}.jsonl`)

  // Create empty file - will be deleted before first use if still empty
  fs.writeFileSync(sessionFile, '')

  return {
    id: sessionConfig.id,
    projectId,
    name: sessionConfig.name,
    preview: '',
    createdAt: sessionConfig.createdAt,
    updatedAt: sessionConfig.updatedAt,
    messageCount: 0,
    status: 'idle',
    settings: sessionConfig.settings || {}
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

ipcMain.handle('list-project-files', async (event, { projectPath, relativePath = '' }) => {
  try {
    if (!projectPath) {
      throw new Error('缺少项目路径')
    }

    const entries = listDirectoryEntries(projectPath, relativePath)
    return { success: true, entries }
  } catch (error) {
    logger.error('[Files] Failed to list project files', { projectPath, relativePath, error: error.message })
    return { success: false, error: error.message, entries: [] }
  }
})

ipcMain.handle('get-project-git-status', async (event, { projectPath }) => {
  try {
    if (!projectPath) {
      throw new Error('缺少项目路径')
    }

    const statuses = await getProjectGitStatusMap(projectPath)
    return { success: true, statuses }
  } catch (error) {
    logger.warn('[Files] Failed to read project git status', { projectPath, error: error.message })
    return { success: false, error: error.message, statuses: {} }
  }
})

ipcMain.handle('watch-project-files', async (event, { projectPath }) => {
  try {
    if (!projectPath) {
      throw new Error('缺少项目路径')
    }

    const absoluteProjectPath = path.resolve(projectPath)
    if (projectFileWatcher && projectFileWatcherPath === absoluteProjectPath) {
      return { success: true }
    }

    stopProjectFileWatcher()

    projectFileWatcher = fs.watch(
      absoluteProjectPath,
      { recursive: process.platform === 'darwin' || process.platform === 'win32' },
      (eventType, filename) => {
        const relativePath = normalizePathSlashes(filename || '')
        if (shouldIgnoreWatchedPath(relativePath)) {
          return
        }

        event.sender.send('project-files-changed', {
          projectPath: absoluteProjectPath,
          eventType,
          relativePath
        })
      }
    )

    projectFileWatcherPath = absoluteProjectPath
    return { success: true }
  } catch (error) {
    logger.error('[Files] Failed to watch project files', { projectPath, error: error.message })
    stopProjectFileWatcher()
    return { success: false, error: error.message }
  }
})

ipcMain.handle('unwatch-project-files', async () => {
  stopProjectFileWatcher()
  return { success: true }
})

ipcMain.handle('read-project-file', async (event, { projectPath, filePath }) => {
  try {
    if (!projectPath || !filePath) {
      throw new Error('缺少文件路径')
    }

    const absolutePath = resolveProjectTargetPath(projectPath, filePath)
    const stat = fs.statSync(absolutePath)

    if (!stat.isFile()) {
      throw new Error('目标不是文件')
    }

    if (stat.size > MAX_PREVIEW_FILE_SIZE) {
      return {
        success: false,
        error: '文件过大，暂不支持预览',
        code: 'FILE_TOO_LARGE',
        file: {
          path: filePath,
          size: stat.size,
          language: detectLanguageFromPath(filePath)
        }
      }
    }

    const buffer = fs.readFileSync(absolutePath)
    if (isLikelyBinary(buffer)) {
      return {
        success: false,
        error: '当前文件是二进制文件，暂不支持预览',
        code: 'BINARY_FILE',
        file: {
          path: filePath,
          size: stat.size,
          language: detectLanguageFromPath(filePath)
        }
      }
    }

    return {
      success: true,
      file: {
        path: filePath,
        name: path.basename(filePath),
        language: detectLanguageFromPath(filePath),
        content: buffer.toString('utf8'),
        size: stat.size,
        updatedAt: stat.mtime.toISOString()
      }
    }
  } catch (error) {
    logger.error('[Files] Failed to read project file', { projectPath, filePath, error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('stat-project-entry', async (event, { projectPath, targetPath }) => {
  try {
    if (!projectPath || !targetPath) {
      throw new Error('缺少目标路径')
    }

    const absoluteTargetPath = resolveProjectTargetPath(projectPath, targetPath)
    if (!fs.existsSync(absoluteTargetPath)) {
      return { success: true, exists: false }
    }

    const stat = fs.statSync(absoluteTargetPath)
    const isDirectory = stat.isDirectory()
    let hasChildren = false

    if (isDirectory) {
      try {
        hasChildren = fs.readdirSync(absoluteTargetPath).some(childName => !FILE_TREE_IGNORES.has(childName))
      } catch (error) {
        hasChildren = false
      }
    }

    return {
      success: true,
      exists: true,
      entry: {
        name: path.basename(absoluteTargetPath),
        path: normalizePathSlashes(path.relative(projectPath, absoluteTargetPath)),
        type: isDirectory ? 'directory' : 'file',
        extension: isDirectory ? '' : path.extname(absoluteTargetPath).toLowerCase(),
        hasChildren
      }
    }
  } catch (error) {
    logger.error('[Files] Failed to stat project entry', { projectPath, targetPath, error: error.message })
    return { success: false, error: error.message, exists: false }
  }
})

ipcMain.handle('get-project-file-git-base', async (event, { projectPath, filePath }) => {
  try {
    if (!projectPath || !filePath) {
      throw new Error('缺少文件路径')
    }

    const absoluteFilePath = resolveProjectTargetPath(projectPath, filePath)
    const repoRootPath = await resolveOwningGitRepoRoot(projectPath, filePath)

    if (!repoRootPath) {
      return {
        success: true,
        hasBase: false,
        originalContent: '',
        originalLabel: 'HEAD',
        modifiedLabel: 'Working Tree'
      }
    }

    const repoRelativePath = normalizePathSlashes(path.relative(repoRootPath, absoluteFilePath))
    if (!repoRelativePath || repoRelativePath.startsWith('..') || path.isAbsolute(repoRelativePath)) {
      return {
        success: true,
        hasBase: false,
        originalContent: '',
        originalLabel: 'HEAD',
        modifiedLabel: 'Working Tree'
      }
    }

    try {
      const { stdout } = await execFileAsync('git', ['show', `HEAD:${repoRelativePath}`], {
        cwd: repoRootPath
      })

      return {
        success: true,
        hasBase: true,
        originalContent: stdout || '',
        originalLabel: 'HEAD',
        modifiedLabel: 'Working Tree'
      }
    } catch (error) {
      return {
        success: true,
        hasBase: false,
        originalContent: '',
        originalLabel: 'HEAD',
        modifiedLabel: 'Working Tree'
      }
    }
  } catch (error) {
    logger.error('[Files] Failed to get project file git base', { projectPath, filePath, error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('write-project-file', async (event, { projectPath, filePath, content }) => {
  try {
    if (!projectPath || !filePath) {
      throw new Error('缺少文件路径')
    }

    const absolutePath = resolveProjectTargetPath(projectPath, filePath)
    const existingStat = fs.existsSync(absolutePath) ? fs.statSync(absolutePath) : null
    if (existingStat && !existingStat.isFile()) {
      throw new Error('目标不是文件')
    }

    fs.writeFileSync(absolutePath, content ?? '', 'utf8')
    const stat = fs.statSync(absolutePath)

    return {
      success: true,
      file: {
        path: filePath,
        name: path.basename(filePath),
        language: detectLanguageFromPath(filePath),
        size: stat.size,
        updatedAt: stat.mtime.toISOString()
      }
    }
  } catch (error) {
    logger.error('[Files] Failed to write project file', { projectPath, filePath, error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('create-project-entry', async (event, { projectPath, parentPath = '', entryType, name }) => {
  try {
    if (!projectPath) {
      throw new Error('缺少项目路径')
    }

    if (!['file', 'directory'].includes(entryType)) {
      throw new Error('无效的条目类型')
    }

    const validatedName = validateProjectEntryName(name)
    const absoluteParentPath = ensureProjectParentDirectory(projectPath, parentPath)
    const absoluteTargetPath = resolveProjectTargetPath(projectPath, path.join(parentPath, validatedName))

    if (fs.existsSync(absoluteTargetPath)) {
      throw new Error('同名文件或文件夹已存在')
    }

    if (entryType === 'directory') {
      fs.mkdirSync(absoluteTargetPath)
    } else {
      fs.writeFileSync(absoluteTargetPath, '', 'utf8')
    }

    const stat = fs.statSync(absoluteTargetPath)
    return {
      success: true,
      entry: {
        name: validatedName,
        path: normalizePathSlashes(path.relative(projectPath, absoluteTargetPath)),
        type: entryType,
        extension: entryType === 'file' ? path.extname(validatedName).toLowerCase() : '',
        hasChildren: entryType === 'directory' ? false : undefined,
        updatedAt: stat.mtime.toISOString()
      }
    }
  } catch (error) {
    logger.error('[Files] Failed to create project entry', { projectPath, parentPath, entryType, name, error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('rename-project-entry', async (event, { projectPath, targetPath, newName }) => {
  try {
    if (!projectPath || !targetPath) {
      throw new Error('缺少目标路径')
    }

    const validatedName = validateProjectEntryName(newName)
    const absoluteSourcePath = resolveProjectTargetPath(projectPath, targetPath)
    if (!fs.existsSync(absoluteSourcePath)) {
      throw new Error('目标不存在')
    }

    const parentRelativePath = normalizePathSlashes(path.dirname(targetPath) === '.' ? '' : path.dirname(targetPath))
    const absoluteParentPath = ensureProjectParentDirectory(projectPath, parentRelativePath)
    const absoluteTargetPath = resolveProjectTargetPath(projectPath, path.join(parentRelativePath, validatedName))

    if (absoluteSourcePath === absoluteTargetPath) {
      const stat = fs.statSync(absoluteSourcePath)
      return {
        success: true,
        entry: {
          oldPath: normalizePathSlashes(targetPath),
          path: normalizePathSlashes(path.relative(projectPath, absoluteSourcePath)),
          name: validatedName,
          type: stat.isDirectory() ? 'directory' : 'file',
          extension: stat.isDirectory() ? '' : path.extname(validatedName).toLowerCase()
        }
      }
    }

    if (fs.existsSync(absoluteTargetPath)) {
      throw new Error('同名文件或文件夹已存在')
    }

    fs.renameSync(absoluteSourcePath, absoluteTargetPath)
    const stat = fs.statSync(absoluteTargetPath)

    return {
      success: true,
      entry: {
        oldPath: normalizePathSlashes(targetPath),
        path: normalizePathSlashes(path.relative(projectPath, absoluteTargetPath)),
        name: validatedName,
        type: stat.isDirectory() ? 'directory' : 'file',
        extension: stat.isDirectory() ? '' : path.extname(validatedName).toLowerCase()
      }
    }
  } catch (error) {
    logger.error('[Files] Failed to rename project entry', { projectPath, targetPath, newName, error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('delete-project-entry', async (event, { projectPath, targetPath }) => {
  try {
    if (!projectPath || !targetPath) {
      throw new Error('缺少目标路径')
    }

    const absoluteTargetPath = resolveProjectTargetPath(projectPath, targetPath)
    if (!fs.existsSync(absoluteTargetPath)) {
      throw new Error('目标不存在')
    }

    const stat = fs.statSync(absoluteTargetPath)
    if (stat.isDirectory()) {
      fs.rmSync(absoluteTargetPath, { recursive: true, force: false })
    } else {
      fs.unlinkSync(absoluteTargetPath)
    }

    return {
      success: true,
      entry: {
        path: normalizePathSlashes(targetPath),
        type: stat.isDirectory() ? 'directory' : 'file'
      }
    }
  } catch (error) {
    logger.error('[Files] Failed to delete project entry', { projectPath, targetPath, error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('open-project-entry-in-finder', async (event, { projectPath, targetPath, mode = 'reveal' }) => {
  try {
    if (!projectPath || !targetPath) {
      throw new Error('缺少目标路径')
    }

    if (!['reveal', 'open'].includes(mode)) {
      throw new Error('无效的打开模式')
    }

    const absoluteTargetPath = resolveProjectTargetPath(projectPath, targetPath)
    if (!fs.existsSync(absoluteTargetPath)) {
      throw new Error('目标不存在')
    }

    const stat = fs.statSync(absoluteTargetPath)
    if (!stat.isDirectory() || mode === 'reveal') {
      await openPathInSystemFileManager(absoluteTargetPath, { reveal: true })
    } else {
      await openPathInSystemFileManager(absoluteTargetPath)
    }

    return { success: true }
  } catch (error) {
    logger.error('[Files] Failed to open project entry in finder', { projectPath, targetPath, mode, error: error.message })
    return { success: false, error: error.message || '打开失败' }
  }
})

ipcMain.handle('create-terminal', async (event, { cwd = '', cols = 120, rows = 30 } = {}) => {
  try {
    const result = await sendTerminalHostRequest('create-terminal', { cwd, cols, rows })
    const terminal = result.terminal

    const terminalSession = {
      id: terminal.id,
      name: terminal.name,
      cwd: terminal.cwd,
      shell: terminal.shell,
      pid: terminal.pid,
      currentCommand: getTerminalDisplayCommand('', terminal.shell),
      webContentsId: event.sender.id,
      monitorTimer: null
    }

    terminalSessions.set(terminal.id, terminalSession)
    startTerminalCommandMonitor(terminalSession)

    return {
      success: true,
      terminal: {
        ...terminal,
        command: terminalSession.currentCommand
      }
    }
  } catch (error) {
    logger.error('[Terminal] Failed to create terminal', { cwd, error: error.message })
    return { success: false, error: error.message || '创建终端失败' }
  }
})

ipcMain.handle('write-terminal', async (event, { terminalId, data = '' } = {}) => {
  try {
    const terminalSession = terminalSessions.get(terminalId)
    if (!terminalSession || terminalSession.webContentsId !== event.sender.id) {
      throw new Error('终端不存在')
    }

    await sendTerminalHostRequest('write-terminal', { terminalId, data })
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message || '写入终端失败' }
  }
})

ipcMain.handle('resize-terminal', async (event, { terminalId, cols = 120, rows = 30 } = {}) => {
  try {
    const terminalSession = terminalSessions.get(terminalId)
    if (!terminalSession || terminalSession.webContentsId !== event.sender.id) {
      throw new Error('终端不存在')
    }

    await sendTerminalHostRequest('resize-terminal', { terminalId, cols, rows })
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message || '调整终端尺寸失败' }
  }
})

ipcMain.handle('close-terminal', async (event, { terminalId } = {}) => {
  try {
    const terminalSession = terminalSessions.get(terminalId)
    if (!terminalSession || terminalSession.webContentsId !== event.sender.id) {
      throw new Error('终端不存在')
    }

    stopTerminalCommandMonitor(terminalSession)
    terminalSessions.delete(terminalId)
    await sendTerminalHostRequest('close-terminal', { terminalId })
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message || '关闭终端失败' }
  }
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

function getCodexConfigPath() {
  return path.join(os.homedir(), '.codex', 'config.toml')
}

function getCodexAuthPath() {
  return path.join(os.homedir(), '.codex', 'auth.json')
}

function parseTopLevelTomlValue(rawValue) {
  const value = rawValue.trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function stringifyTomlString(value) {
  return `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function readCodexConfigFile() {
  const codexConfigPath = getCodexConfigPath()
  if (!fs.existsSync(codexConfigPath)) {
    return {
      model: '',
      modelProvider: '',
      modelReasoningEffort: 'medium',
      apiUrl: '',
      rawContent: ''
    }
  }

  const rawContent = fs.readFileSync(codexConfigPath, 'utf-8')
  const result = {
    model: '',
    modelProvider: '',
    modelReasoningEffort: 'medium',
    apiUrl: '',
    rawContent
  }

  let currentSection = null
  for (const line of rawContent.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const sectionMatch = trimmed.match(/^\[(.+)\]$/)
    if (sectionMatch) {
      currentSection = sectionMatch[1]
      continue
    }

    const entryMatch = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/)
    if (!entryMatch) continue

    const [, key, rawValue] = entryMatch
    if (!currentSection) {
      if (key === 'model') {
        result.model = parseTopLevelTomlValue(rawValue)
      } else if (key === 'model_provider') {
        result.modelProvider = parseTopLevelTomlValue(rawValue)
      } else if (key === 'model_reasoning_effort') {
        result.modelReasoningEffort = parseTopLevelTomlValue(rawValue) || 'medium'
      }
    } else if (currentSection === 'model_providers.ccgui' && key === 'base_url') {
      result.apiUrl = parseTopLevelTomlValue(rawValue)
    }
  }

  return result
}

function readCodexAuthFile() {
  const codexAuthPath = getCodexAuthPath()
  if (!fs.existsSync(codexAuthPath)) {
    return { authToken: '', raw: {} }
  }

  const raw = JSON.parse(fs.readFileSync(codexAuthPath, 'utf-8'))
  return {
    authToken: raw.OPENAI_API_KEY || '',
    raw
  }
}

function writeCodexConfigFile(updates = {}) {
  const codexConfigPath = getCodexConfigPath()
  const codexDir = path.dirname(codexConfigPath)
  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true })
  }

  const current = readCodexConfigFile()
  const currentAuth = readCodexAuthFile()
  const rawContent = current.rawContent || ''
  const lines = rawContent ? rawContent.split(/\r?\n/) : []
  const nextModel = updates.model !== undefined ? updates.model : current.model
  const nextProvider = updates.modelProvider !== undefined ? updates.modelProvider : (current.modelProvider || 'ccgui')
  const nextEffort = updates.modelReasoningEffort !== undefined ? updates.modelReasoningEffort : current.modelReasoningEffort
  const nextApiUrl = updates.apiUrl !== undefined ? updates.apiUrl : current.apiUrl
  const nextAuthToken = updates.authToken !== undefined ? updates.authToken : currentAuth.authToken
  const shouldWriteCcguiProvider = Boolean((nextApiUrl || '').trim() && (nextAuthToken || '').trim())

  const pendingTopLevel = new Map([
    ['model', stringifyTomlString(nextModel || '')],
    ['model_reasoning_effort', stringifyTomlString(nextEffort || 'medium')]
  ])

  if (shouldWriteCcguiProvider) {
    pendingTopLevel.set('model_provider', stringifyTomlString(nextProvider || 'ccgui'))
  }

  const ccguiProviderEntries = [
    `name = ${stringifyTomlString('ccgui')}`,
    `base_url = ${stringifyTomlString(nextApiUrl || '')}`,
    `wire_api = ${stringifyTomlString('responses')}`
  ]

  let currentSection = null
  let skippingCcguiSection = false
  let skippingLegacyNetworkSection = false
  const output = []

  for (const line of lines) {
    const trimmed = line.trim()
    const sectionMatch = trimmed.match(/^\[(.+)\]$/)
    if (sectionMatch) {
      if (!currentSection && pendingTopLevel.size > 0) {
        for (const [key, value] of pendingTopLevel.entries()) {
          output.push(`${key} = ${value}`)
        }
        pendingTopLevel.clear()
        if (output.length > 0 && output[output.length - 1] !== '') {
          output.push('')
        }
      }

      if (skippingCcguiSection) {
        if (shouldWriteCcguiProvider) {
          output.push('')
          output.push('[model_providers.ccgui]')
          output.push(...ccguiProviderEntries)
          output.push('')
        }
        skippingCcguiSection = false
      }

      if (skippingLegacyNetworkSection) {
        skippingLegacyNetworkSection = false
      }

      currentSection = sectionMatch[1]
      if (currentSection === 'model_providers.ccgui') {
        skippingCcguiSection = true
        continue
      }

      if (currentSection === 'permissions.ccgui.network') {
        skippingLegacyNetworkSection = true
        continue
      }

      output.push(line)
      continue
    }

    if (skippingCcguiSection || skippingLegacyNetworkSection) {
      continue
    }

    if (!currentSection) {
      const entryMatch = line.match(/^(\s*)([A-Za-z0-9_-]+)(\s*=\s*)(.+?)(\s*)$/)
      if (entryMatch) {
        const [, indent, key, separator, , trailingSpace] = entryMatch
        if (key === 'default_permissions') {
          continue
        }
        if (key === 'model_provider' && !shouldWriteCcguiProvider) {
          continue
        }
        if (pendingTopLevel.has(key)) {
          output.push(`${indent}${key}${separator}${pendingTopLevel.get(key)}${trailingSpace}`)
          pendingTopLevel.delete(key)
          continue
        }
      }
    }

    output.push(line)
  }

  if (skippingCcguiSection) {
    if (shouldWriteCcguiProvider) {
      output.push('')
      output.push('[model_providers.ccgui]')
      output.push(...ccguiProviderEntries)
    }
    skippingCcguiSection = false
  }

  if (pendingTopLevel.size > 0) {
    if (output.length > 0 && output[output.length - 1].trim() !== '') {
      output.push('')
    }
    for (const [key, value] of pendingTopLevel.entries()) {
      output.push(`${key} = ${value}`)
    }
  }

  const hasCcguiSection = output.some(line => line.trim() === '[model_providers.ccgui]')
  if (shouldWriteCcguiProvider && !hasCcguiSection) {
    if (output.length > 0 && output[output.length - 1].trim() !== '') {
      output.push('')
    }
    output.push('[model_providers.ccgui]')
    output.push(...ccguiProviderEntries)
  }

  const finalContent = output.join('\n').replace(/\n{3,}/g, '\n\n') + '\n'
  fs.writeFileSync(codexConfigPath, finalContent, 'utf-8')

  return {
    model: nextModel || '',
    modelProvider: shouldWriteCcguiProvider ? (nextProvider || 'ccgui') : '',
    modelReasoningEffort: nextEffort || 'medium',
    apiUrl: nextApiUrl || ''
  }
}

function writeCodexAuthFile(updates = {}) {
  const codexAuthPath = getCodexAuthPath()
  const codexDir = path.dirname(codexAuthPath)
  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true })
  }

  const current = readCodexAuthFile()
  const nextRaw = {
    ...(current.raw || {})
  }

  if (updates.authToken !== undefined) {
    nextRaw.OPENAI_API_KEY = updates.authToken || ''
  }

  if (!nextRaw.auth_mode) {
    nextRaw.auth_mode = 'api_key'
  }

  fs.writeFileSync(codexAuthPath, JSON.stringify(nextRaw, null, 2), 'utf-8')
  return {
    authToken: nextRaw.OPENAI_API_KEY || ''
  }
}

// Get Codex settings from ~/.codex/config.toml
ipcMain.handle('get-codex-settings', async () => {
  try {
    const settings = readCodexConfigFile()
    const appConfig = appConfigManager.loadConfig()
    return {
      success: true,
      settings: {
        model: settings.model || '',
        modelProvider: settings.modelProvider || '',
        modelReasoningEffort: settings.modelReasoningEffort || 'medium',
        apiUrl: settings.apiUrl || '',
        proxyUrl: appConfig.settings?.codexProxy || '',
        authToken: readCodexAuthFile().authToken || ''
      }
    }
  } catch (error) {
    logger.error('[CodexSettings] Failed to load settings', { error: error.message })
    return { success: false, error: error.message }
  }
})

// Update Codex settings to ~/.codex/config.toml
ipcMain.handle('update-codex-settings', async (event, { updates }) => {
  try {
    const settings = writeCodexConfigFile({
      ...(updates || {}),
      modelProvider: 'ccgui'
    })
    const authSettings = writeCodexAuthFile(updates || {})
    const appConfig = appConfigManager.updateConfig({
      settings: {
        codexProxy: updates?.proxyUrl || ''
      }
    })
    logger.info('[CodexSettings] Settings updated successfully')
    return {
      success: true,
      settings: {
        ...settings,
        proxyUrl: appConfig.settings?.codexProxy || '',
        authToken: authSettings.authToken || ''
      }
    }
  } catch (error) {
    logger.error('[CodexSettings] Failed to update settings', { error: error.message })
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

  if (!app.isReady()) {
    logger.info('[Dock] App not ready yet, queueing project open:', filePath)
    pendingDockProjectOpens.push({
      projectId,
      projectName: path.basename(filePath),
      projectPath: filePath
    })
    return
  }

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
  const newWindowWebContentsId = newWindow.webContents.id

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
    disposeTerminalsForWebContents(newWindowWebContentsId)
    logger.info('[Window] Closed window', { projectId })
  })

  logger.info('[Window] Created new window for project', { projectName, projectId })

  return newWindow
}

function flushPendingDockProjectOpens() {
  if (!app.isReady() || pendingDockProjectOpens.length === 0) {
    return
  }

  const queuedOpens = pendingDockProjectOpens.splice(0, pendingDockProjectOpens.length)
  for (const pendingProject of queuedOpens) {
    const existingWindow = findWindowByProjectPath(pendingProject.projectPath)
    if (existingWindow) {
      logger.info('[Dock] Found existing window for queued project, focusing it')
      existingWindow.focus()
      continue
    }

    openProjectWindow(
      pendingProject.projectId,
      pendingProject.projectName,
      pendingProject.projectPath
    )
  }
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
  const newWindowWebContentsId = newWindow.webContents.id

  // Load app without project ID (shows hello page)
  if (isDev) {
    newWindow.loadURL('http://localhost:5173')
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html')
    newWindow.loadURL(`file://${indexPath}`)
  }

  newWindow.on('closed', () => {
    disposeTerminalsForWebContents(newWindowWebContentsId)
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
  flushPendingDockProjectOpens()

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
  isAppQuitting = true
  for (const window of BrowserWindow.getAllWindows()) {
    const webContents = window.webContents
    if (webContents && !webContents.isDestroyed()) {
      webContents.send('app-before-quit')
    }
  }

  terminalSessions.clear()
  if (terminalHostProcess && !terminalHostProcess.killed) {
    terminalHostProcess.kill()
    terminalHostProcess = null
  }
  if (sessionManager) {
    sessionManager.closeAll()
  }
})
