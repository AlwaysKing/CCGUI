const { app, BrowserWindow, ipcMain, session, dialog, shell, protocol, screen: electronScreen } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFile, fork, spawn } = require('child_process')
const yaml = require('js-yaml')
const { SessionManager } = require('./session/session-manager')
const logger = require('./logger')
const { encodeProjectPath, decodeProjectPath } = require('./project-paths')
const appService = require('./services/app-service')
const projectService = require('./services/project-service')
const attachmentService = require('./services/attachment-service')
const providerInspector = require('./services/provider-inspector')
const historyManager = require('./storage/history-manager')
const processRegistry = require('./services/process-registry')

const isDevRuntime = process.env.NODE_ENV === 'development' || !app.isPackaged

if (isDevRuntime) {
  const devUserDataPath = path.join(app.getPath('appData'), 'CCGUI-dev')
  app.setPath('userData', devUserDataPath)
}

// 初始化日志系统
logger.initialize()

// Global isDev flag - will be set before creating windows
let isDev = isDevRuntime

let mainWindow
let sessionManager
const projectFileWatchers = new Map()
let terminalSequence = 0
const terminalSessions = new Map()
let terminalHostProcess = null
let terminalHostRequestSequence = 0
const terminalHostPendingRequests = new Map()
let isAppQuitting = false
const pendingDockProjectOpens = []
let appStartupStartedAt = Date.now()

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'ccgui-asset',
    privileges: {
      secure: true,
      standard: true,
      supportFetchAPI: true,
      corsEnabled: true
    }
  }
])

/**
 * Get app icon path
 */
function getIconPath() {
  return path.join(__dirname, '../build/icons/icon.icns')
}

function getCcgGuiHistoryRoot() {
  return path.join(os.homedir(), '.ccgui', 'projects')
}

function isAllowedAssetPath(filePath) {
  if (!filePath) return false

  const resolved = path.resolve(filePath)
  const mimeType = attachmentService.inferMimeType(resolved)
  const allowedRoots = [
    path.resolve(attachmentService.getTempAttachmentDir()),
    path.resolve(getCcgGuiHistoryRoot())
  ]

  if (allowedRoots.some(root => resolved.startsWith(root))) {
    return true
  }

  return typeof mimeType === 'string' && mimeType.startsWith('image/')
}

function buildAssetMimeType(filePath) {
  return attachmentService.inferMimeType(filePath) || 'application/octet-stream'
}

function createTextResponse(body, status) {
  return new Response(body, {
    status,
    headers: {
      'content-type': 'text/plain; charset=utf-8'
    }
  })
}

function registerAssetProtocol() {
  protocol.handle('ccgui-asset', async (request) => {
    try {
      const requestUrl = new URL(request.url)
      const rawPath = requestUrl.searchParams.get('path') || ''
      const filePath = decodeURIComponent(rawPath)

      if (!filePath || !isAllowedAssetPath(filePath)) {
        return createTextResponse('Forbidden', 403)
      }

      if (!fs.existsSync(filePath)) {
        return createTextResponse('Not Found', 404)
      }

      const data = fs.readFileSync(filePath)
      return new Response(data, {
        status: 200,
        headers: {
          'content-type': buildAssetMimeType(filePath),
          'cache-control': 'no-store'
        }
      })
    } catch (error) {
      logger.error('[AssetProtocol] Failed to resolve asset request', {
        error: error.message,
        url: request.url
      })
      return createTextResponse('Internal Error', 500)
    }
  })
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
  const windowCreateStartedAt = Date.now()
  logger.info('[Startup] createWindow start', {
    sinceAppStartMs: windowCreateStartedAt - appStartupStartedAt
  })

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: '首页',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    icon: getIconPath(),
    backgroundColor: '#111315',
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
          "default-src 'self' http://127.0.0.1:5173; " +
          "script-src 'self' 'unsafe-inline' 'unsafe-eval' http://127.0.0.1:5173 ws://127.0.0.1:5173; " +
          "style-src 'self' 'unsafe-inline' http://127.0.0.1:5173; " +
          "connect-src 'self' http://127.0.0.1:5173 ws://127.0.0.1:5173 https: wss:; " +
          "img-src 'self' data: http://127.0.0.1:5173 https: ccgui-asset:; " +
          "font-src 'self' data: http://127.0.0.1:5173; " +
          "worker-src 'self' blob: http://127.0.0.1:5173; " +
          "child-src 'self' blob: http://127.0.0.1:5173; " +
          "object-src 'none';"
        ]
      }
    })
  })

  // Load app
  if (isDev) {
    mainWindow.loadURL('http://127.0.0.1:5173')
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  mainWindow.webContents.on('did-start-loading', () => {
    logger.info('[Startup] did-start-loading', {
      sinceAppStartMs: Date.now() - appStartupStartedAt
    })
  })

  mainWindow.webContents.on('dom-ready', () => {
    logger.info('[Startup] dom-ready', {
      sinceAppStartMs: Date.now() - appStartupStartedAt
    })
  })

  mainWindow.webContents.on('did-finish-load', () => {
    logger.info('[Startup] did-finish-load', {
      sinceAppStartMs: Date.now() - appStartupStartedAt,
      sinceCreateWindowMs: Date.now() - windowCreateStartedAt
    })
  })

  // Initialize Session Manager with callback to send events to renderer
  initSessionManager()

  const mainWindowWebContentsId = mainWindow.webContents.id
  mainWindow.on('closed', () => {
    disposeTerminalsForWebContents(mainWindowWebContentsId)
    stopProjectFileWatcher(mainWindowWebContentsId)
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

const PROJECT_HIDDEN_RULES_RELATIVE_PATH = '.ccgui/hidden'
const FILE_TREE_DEFAULT_HIDDEN_RULES = ['.DS_Store']
const projectHiddenRuleCache = new Map()

const MAX_PREVIEW_FILE_SIZE = 1024 * 1024

function normalizePathSlashes(value = '') {
  return String(value || '').replace(/\\/g, '/')
}

function normalizeProjectRelativePath(value = '') {
  return normalizePathSlashes(value).replace(/^\/+|\/+$/g, '')
}

function isProtectedProjectPath(relativePath = '') {
  const normalizedPath = normalizeProjectRelativePath(relativePath)
  return normalizedPath === '.ccgui' || normalizedPath.startsWith('.ccgui/')
}

function parseProjectHiddenRule(rawLine = '') {
  const trimmedLine = String(rawLine || '').trim()
  if (!trimmedLine) return null

  let line = trimmedLine
  if (line.startsWith('\\#') || line.startsWith('\\!')) {
    line = line.slice(1)
  } else if (line.startsWith('#')) {
    return null
  }

  let negated = false
  if (line.startsWith('!')) {
    negated = true
    line = line.slice(1)
  }

  line = normalizePathSlashes(line.trim())
  if (!line) return null

  const directoryOnly = line.endsWith('/')
  const patternBody = directoryOnly ? line.slice(0, -1) : line
  const anchored = patternBody.startsWith('/') || patternBody.includes('/')
  const normalizedPattern = normalizeProjectRelativePath(patternBody.replace(/^\/+/, ''))
  if (!normalizedPattern) return null

  return {
    negated,
    directoryOnly,
    basenameOnly: !anchored,
    segments: normalizedPattern.split('/').filter(Boolean)
  }
}

function compileProjectHiddenRules(rawContent = '') {
  return [...FILE_TREE_DEFAULT_HIDDEN_RULES, ...String(rawContent || '').split(/\r?\n/)]
    .map(parseProjectHiddenRule)
    .filter(Boolean)
}

function getProjectHiddenRules(projectPath) {
  const absoluteProjectPath = path.resolve(projectPath)
  const configPath = path.join(absoluteProjectPath, '.ccgui', 'hidden')
  let fingerprint = 'missing'
  let rawContent = ''

  try {
    const stat = fs.statSync(configPath)
    if (stat.isFile()) {
      fingerprint = `${stat.size}:${stat.mtimeMs}`
      rawContent = fs.readFileSync(configPath, 'utf8')
    }
  } catch (_) {
    fingerprint = 'missing'
  }

  const cached = projectHiddenRuleCache.get(absoluteProjectPath)
  if (cached?.fingerprint === fingerprint) {
    return cached.rules
  }

  const rules = compileProjectHiddenRules(rawContent)
  projectHiddenRuleCache.set(absoluteProjectPath, { fingerprint, rules })
  return rules
}

function matchHiddenRuleSegment(pattern = '', value = '') {
  let patternIndex = 0
  let valueIndex = 0
  let starIndex = -1
  let starMatchIndex = 0

  while (valueIndex < value.length) {
    const patternChar = pattern[patternIndex]

    if (patternChar === '?' || patternChar === value[valueIndex]) {
      patternIndex += 1
      valueIndex += 1
      continue
    }

    if (patternChar === '*') {
      starIndex = patternIndex
      starMatchIndex = valueIndex
      patternIndex += 1
      continue
    }

    if (starIndex !== -1) {
      patternIndex = starIndex + 1
      starMatchIndex += 1
      valueIndex = starMatchIndex
      continue
    }

    return false
  }

  while (pattern[patternIndex] === '*') {
    patternIndex += 1
  }

  return patternIndex === pattern.length
}

function matchHiddenRuleSegments(patternSegments = [], pathSegments = [], patternIndex = 0, pathIndex = 0) {
  if (patternIndex >= patternSegments.length) {
    return pathIndex >= pathSegments.length
  }

  const patternSegment = patternSegments[patternIndex]
  if (patternSegment === '**') {
    if (patternIndex === patternSegments.length - 1) {
      return true
    }

    for (let nextPathIndex = pathIndex; nextPathIndex <= pathSegments.length; nextPathIndex += 1) {
      if (matchHiddenRuleSegments(patternSegments, pathSegments, patternIndex + 1, nextPathIndex)) {
        return true
      }
    }
    return false
  }
  if (pathIndex >= pathSegments.length) {
    return false
  }

  if (!matchHiddenRuleSegment(patternSegment, pathSegments[pathIndex])) {
    return false
  }

  return matchHiddenRuleSegments(patternSegments, pathSegments, patternIndex + 1, pathIndex + 1)
}

function doesProjectHiddenRuleMatch(rule, relativePath = '', isDirectory = false) {
  if (!rule) return false
  if (rule.directoryOnly && !isDirectory) {
    return false
  }

  const normalizedPath = normalizeProjectRelativePath(relativePath)
  if (!normalizedPath) return false

  if (rule.basenameOnly) {
    const baseName = normalizedPath.split('/').pop() || normalizedPath
    return matchHiddenRuleSegment(rule.segments[0] || '', baseName)
  }

  return matchHiddenRuleSegments(rule.segments, normalizedPath.split('/').filter(Boolean))
}

function isProjectPathHidden(projectPath, relativePath = '', options = {}) {
  const normalizedPath = normalizeProjectRelativePath(relativePath)
  if (!normalizedPath || isProtectedProjectPath(normalizedPath)) {
    return false
  }

  const { isDirectory = false, includeAncestors = false } = options
  const rules = getProjectHiddenRules(projectPath)
  if (rules.length === 0) return false

  const matchTargets = [{ path: normalizedPath, isDirectory }]
  if (includeAncestors) {
    const segments = normalizedPath.split('/').filter(Boolean)
    while (segments.length > 1) {
      segments.pop()
      matchTargets.push({ path: segments.join('/'), isDirectory: true })
    }
  }

  let hidden = false
  for (const rule of rules) {
    if (matchTargets.some(target => doesProjectHiddenRuleMatch(rule, target.path, target.isDirectory))) {
      hidden = !rule.negated
    }
  }

  return hidden
}

function directoryHasVisibleDescendants(projectPath, directoryPath) {
  let dirEntries = []

  try {
    dirEntries = fs.readdirSync(directoryPath, { withFileTypes: true })
  } catch (_) {
    return false
  }

  for (const entry of dirEntries) {
    const entryAbsolutePath = path.join(directoryPath, entry.name)
    const entryRelativePath = normalizeProjectRelativePath(path.relative(projectPath, entryAbsolutePath))
    const entryHidden = isProjectPathHidden(projectPath, entryRelativePath, {
      isDirectory: entry.isDirectory(),
      includeAncestors: true
    })

    if (!entryHidden) {
      return true
    }

    if (entry.isDirectory() && directoryHasVisibleDescendants(projectPath, entryAbsolutePath)) {
      return true
    }
  }

  return false
}

function listVisibleDirectoryEntries(projectPath, targetDir) {
  return fs.readdirSync(targetDir, { withFileTypes: true })
    .filter(entry => {
      const entryAbsolutePath = path.join(targetDir, entry.name)
      const entryRelativePath = normalizeProjectRelativePath(path.relative(projectPath, entryAbsolutePath))
      const hidden = isProjectPathHidden(projectPath, entryRelativePath, {
        isDirectory: entry.isDirectory(),
        includeAncestors: true
      })

      if (!hidden) {
        return true
      }

      if (!entry.isDirectory()) {
        return false
      }

      return directoryHasVisibleDescendants(projectPath, entryAbsolutePath)
    })
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

  return listVisibleDirectoryEntries(projectPath, targetDir)
    .map(entry => {
      const entryAbsolutePath = path.join(targetDir, entry.name)
      const entryRelativePath = normalizeProjectRelativePath(path.relative(projectPath, entryAbsolutePath))
      let hasChildren = false

      if (entry.isDirectory()) {
        try {
          hasChildren = listVisibleDirectoryEntries(projectPath, entryAbsolutePath).length > 0
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

function buildClaudePluginCommand(options = {}) {
  const action = options.action || ''
  const scope = options.scope || ''
  const pluginId = options.pluginId || ''
  const marketplaceName = options.marketplaceName || ''
  const source = options.source || ''

  switch (action) {
    case 'installPlugin':
      if (!pluginId) throw new Error('缺少插件标识')
      return ['plugin', 'install', pluginId, ...(scope ? ['--scope', scope] : [])]
    case 'uninstallPlugin':
      if (!pluginId) throw new Error('缺少插件标识')
      return ['plugin', 'uninstall', pluginId, ...(scope ? ['--scope', scope] : [])]
    case 'enablePlugin':
      if (!pluginId) throw new Error('缺少插件标识')
      return ['plugin', 'enable', pluginId, ...(scope ? ['--scope', scope] : [])]
    case 'disablePlugin':
      if (!pluginId) throw new Error('缺少插件标识')
      return ['plugin', 'disable', pluginId, ...(scope ? ['--scope', scope] : [])]
    case 'updatePlugin':
      if (!pluginId) throw new Error('缺少插件标识')
      return ['plugin', 'update', pluginId, ...(scope ? ['--scope', scope] : [])]
    case 'addMarketplace':
      if (!source) throw new Error('缺少市场来源')
      return ['plugin', 'marketplace', 'add', source, ...(scope ? ['--scope', scope] : [])]
    case 'removeMarketplace':
      if (!marketplaceName) throw new Error('缺少市场名称')
      return ['plugin', 'marketplace', 'remove', marketplaceName]
    case 'updateMarketplace':
      return marketplaceName
        ? ['plugin', 'marketplace', 'update', marketplaceName]
        : ['plugin', 'marketplace', 'update']
    default:
      throw new Error('不支持的 Claude 插件操作')
  }
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
      const relativeEntryPath = normalizeProjectRelativePath(path.relative(absoluteProjectPath, path.join(currentPath, entry.name)))
      if (isProjectPathHidden(absoluteProjectPath, relativeEntryPath, { isDirectory: true })) continue
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

async function openFileWithApplication(targetPath, application = 'default') {
  if (!targetPath || typeof targetPath !== 'string') {
    throw new Error('缺少目标路径')
  }

  if (application === 'default') {
    const openError = await shell.openPath(targetPath)
    if (openError) {
      throw new Error(openError)
    }
    return
  }

  if (process.platform === 'darwin') {
    await execFileAsync('open', ['-a', application, targetPath])
    return
  }

  const openError = await shell.openPath(targetPath)
  if (openError) {
    throw new Error(openError)
  }
}

function stopProjectFileWatcher(webContentsId = null) {
  if (webContentsId == null) {
    for (const watcherEntry of projectFileWatchers.values()) {
      watcherEntry.watcher.close()
    }
    projectFileWatchers.clear()
    return
  }

  const watcherEntry = projectFileWatchers.get(webContentsId)
  if (!watcherEntry) {
    return
  }

  watcherEntry.watcher.close()
  projectFileWatchers.delete(webContentsId)
}

function shouldIgnoreWatchedPath(relativePath = '') {
  const normalizedPath = normalizeProjectRelativePath(relativePath)
  if (!normalizedPath) return false
  return false
}

async function getOrCreateHydratedSession({
  sessionId,
  projectId = null,
  projectPath = null,
  webContents,
  createIfNotExists = true
}) {
  const resolvedProjectPath = projectPath || (projectId ? decodeProjectPath(projectId) : null)
  const resolvedProjectId = projectId || (resolvedProjectPath ? encodeProjectPath(resolvedProjectPath) : null)
  const sessionExisted = sessionManager.hasSession(sessionId)
  let hasPersistedHistory = false

  if (resolvedProjectId) {
    try {
      await projectService.ensureSessionHistoryHydrated(resolvedProjectId, sessionId)
      hasPersistedHistory = historyManager.hasHistoryIndex(resolvedProjectId, sessionId)
    } catch (error) {
      logger.warn('[IPC] Failed to hydrate session history on demand', {
        sessionId,
        projectId: resolvedProjectId,
        error: error.message
      })
    }
  }

  const session = await sessionManager.getOrCreateSession(
    sessionId,
    resolvedProjectPath,
    webContents,
    createIfNotExists
  )

  if (sessionExisted && hasPersistedHistory && typeof session?.refreshStoredHistoryIfEmpty === 'function') {
    await session.refreshStoredHistoryIfEmpty()
  }

  return session
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

// Select/Activate a session - creates SessionInstance and returns state
ipcMain.handle('select-session', async (event, { sessionId, projectId, projectPath }) => {
  logger.info('[IPC] select-session:', { sessionId, projectId, projectPath })

  try {
    // Get or create the session instance, passing the caller's webContents
    // This ensures events are sent to the correct window (supports multi-window)
    const sessionInstance = await getOrCreateHydratedSession({
      sessionId,
      projectId,
      projectPath,
      webContents: event.sender,
      createIfNotExists: true
    })

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

ipcMain.handle('load-session-history-turn', async (event, { sessionId, turnId }) => {
  try {
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    const turns = historyManager.loadIndexEntries(session.projectId, sessionId)
    const turn = turns.find(item => item.turnId === turnId) || null
    const events = historyManager.loadTurnEvents(session.projectId, sessionId, turnId)

    return {
      success: true,
      turn,
      events
    }
  } catch (error) {
    logger.error('[IPC] load-session-history-turn error:', {
      sessionId,
      turnId,
      message: error.message
    })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('load-subagent-history-turn', async (event, { sessionId, agentId, turnId }) => {
  try {
    const session = sessionManager.getSession(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }
    if (!agentId) {
      throw new Error('Missing agentId')
    }

    const turns = historyManager.loadSubagentIndexEntries(session.projectId, sessionId, agentId)
    const turn = turns.find(item => item.turnId === turnId) || null
    const events = historyManager.loadSubagentTurnEvents(session.projectId, sessionId, agentId, turnId)

    return {
      success: true,
      turn,
      events
    }
  } catch (error) {
    logger.error('[IPC] load-subagent-history-turn error:', {
      sessionId,
      agentId,
      turnId,
      message: error.message
    })
    return { success: false, error: error.message }
  }
})

// Update session UI state
ipcMain.handle('update-session-ui-state', async (event, { sessionId, state }) => {
  sessionManager.updateSessionUIState(sessionId, state)
  return { success: true }
})

// Send message
ipcMain.handle('send-message', async (event, { sessionId, message, content }) => {
  logger.info('[IPC] send-message:', {
    sessionId,
    contentType: Array.isArray(content) ? 'array' : typeof content,
    contentLength: typeof content === 'string' ? content.length : null,
    attachmentCount: Array.isArray(content?.attachments) ? content.attachments.length : 0
  })

  try {
    await sessionManager.sendMessage(sessionId, content)
    return { success: true }
  } catch (error) {
    logger.error('[IPC] send-message error:', {
      message: error.message,
      stack: error.stack,
      sessionId
    })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('save-temp-attachment', async (event, options = {}) => {
  try {
    const result = attachmentService.saveClipboardImage(options)
    return { success: true, data: result }
  } catch (error) {
    logger.error('[IPC] save-temp-attachment error:', error)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('delete-temp-attachment', async (event, { path: filePath } = {}) => {
  try {
    const deleted = attachmentService.deleteTempAttachment(filePath)
    return { success: true, deleted }
  } catch (error) {
    logger.error('[IPC] delete-temp-attachment error:', error)
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
    const response = await sessionManager.sendControlRequest(sessionId, request)
    return { success: true, response: response || null }
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
ipcMain.handle('start-session', async (event, { sessionId, projectPath, reason, postStartNotification }) => {
  logger.info('[IPC] start-session:', { sessionId, projectPath, reason, hasPostStartNotification: !!postStartNotification })

  try {
    // Use select-session internally, passing webContents for multi-window support
    const session = await getOrCreateHydratedSession({
      sessionId,
      projectPath,
      webContents: event.sender,
      createIfNotExists: true
    })

    // Start runtime process
    await session.start({ reason, postStartNotification })

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
ipcMain.handle('stop-session-runtime', async (event, { sessionId, reason, postStartNotification }) => {
  logger.info('[IPC] stop-session-runtime:', { sessionId, reason, hasPostStartNotification: !!postStartNotification })
  sessionManager.stopSessionRuntime(sessionId, { reason, postStartNotification })
  return { success: true }
})

// ============================================
// Project & Session Management IPC Handlers
// ============================================

// Get all projects
ipcMain.handle('get-projects', async () => {
  return projectService.scanProjects()
})

// Add a new project (by path)
ipcMain.handle('add-project', async (event, { projectPath, settings }) => {
  try {
    return projectService.addProject(projectPath, settings)
  } catch (e) {
    logger.warn('[Projects] Failed to create project config:', e.message)
    return {
      id: encodeProjectPath(projectPath),
      name: path.basename(projectPath),
      path: projectPath,
      sessionCount: 0,
      lastActiveAt: new Date().toISOString(),
      settings: {},
      sourceFlags: {
        ccgui: true,
        claude: false,
        codex: false
      }
    }
  }
})

// Get project config
ipcMain.handle('get-project-config', async (event, { projectId }) => {
  try {
    const config = projectService.getProjectConfig(projectId)
    return { success: true, config }
  } catch (error) {
    logger.error('[ProjectConfig] Failed to get config', { projectId, error: error.message })
    return { success: false, error: error.message }
  }
})

// Update project config
ipcMain.handle('update-project-config', async (event, { projectId, updates }) => {
  try {
    const updatedConfig = projectService.updateProjectConfig(projectId, updates)
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
    const config = projectService.getSessionConfig(projectId, sessionId)
    return { success: true, config }
  } catch (error) {
    logger.error('[SessionConfig] Failed to get config', { projectId, sessionId, error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-session-available', async (event, { projectId, sessionId }) => {
  try {
    const result = projectService.getSessionAvailable(projectId, sessionId)
    return { success: true, ...result }
  } catch (error) {
    logger.error('[SessionConfig] Failed to get session availability', { projectId, sessionId, error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-model-config-summary', async (event, options = {}) => {
  try {
    const result = projectService.getModelConfigSummary(options || {})
    return { success: true, ...result }
  } catch (error) {
    logger.error('[SessionConfig] Failed to get model config summary', { options, error: error.message })
    return { success: false, error: error.message }
  }
})

// Update session config
ipcMain.handle('update-session-config', async (event, { projectId, sessionId, updates }) => {
  try {
    const updatedConfig = await projectService.updateSessionConfig(projectId, sessionId, updates)
    if (updatedConfig) {
      if (Object.prototype.hasOwnProperty.call(updates || {}, 'settings')) {
        sessionManager.applySessionSettings(sessionId, updatedConfig.settings || {})
      }
      return { success: true, config: updatedConfig }
    } else {
      return { success: false, error: 'Session not found' }
    }
  } catch (error) {
    logger.error('[SessionConfig] Failed to update config', { projectId, sessionId, error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('list-session-submodels', async (event, { projectId, sessionId, workingDirectory }) => {
  try {
    const result = await projectService.listSessionSubmodels(projectId, sessionId, { workingDirectory })
    return { success: true, ...result }
  } catch (error) {
    logger.error('[SessionConfig] Failed to list session submodels', { projectId, sessionId, error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-available-targets', async (event, { projectId, provider, sessionId }) => {
  try {
    const result = await projectService.getAvailableTargets({ projectId, provider, sessionId })
    return { success: true, ...result }
  } catch (error) {
    logger.error('[SessionConfig] Failed to get available targets', { projectId, provider, sessionId, error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('list-session-effort-options', async (event, { projectId, sessionId, workingDirectory, model }) => {
  try {
    const result = await projectService.listSessionReasoningCapabilities(projectId, sessionId, {
      workingDirectory,
      model
    })
    return { success: true, ...result }
  } catch (error) {
    logger.error('[SessionConfig] Failed to list session effort options', {
      projectId,
      sessionId,
      error: error.message
    })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('set-session-submodel', async (event, { sessionId, model, reasoningEffort }) => {
  try {
    const normalizedModel = typeof model === 'string' ? model.trim() : ''
    if (!sessionId) {
      throw new Error('Missing sessionId')
    }
    if (!normalizedModel) {
      throw new Error('Missing model')
    }

    const result = await sessionManager.setSessionSubmodel(
      sessionId,
      normalizedModel,
      typeof reasoningEffort === 'string' && reasoningEffort.trim()
        ? reasoningEffort.trim()
        : 'medium'
    )

    return {
      success: true,
      sessionId,
      ...result
    }
  } catch (error) {
    logger.error('[SessionConfig] Failed to set session submodel', { sessionId, error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('set-session-model', async (event, {
  projectId,
  sessionId,
  mode,
  modelId,
  modelCardId,
  workingDirectory
}) => {
  try {
    if (!sessionId) {
      throw new Error('Missing sessionId')
    }

    const session = await getOrCreateHydratedSession({
      sessionId,
      projectId,
      projectPath: workingDirectory || decodeProjectPath(projectId),
      webContents: event.sender,
      createIfNotExists: true
    })

    const result = await session.setSessionModel({
      mode,
      modelId,
      modelCardId
    })

    return {
      success: true,
      ...result
    }
  } catch (error) {
    logger.error('[SessionConfig] Failed to set session model', { projectId, sessionId, error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('set-session-target', async (event, {
  projectId,
  sessionId,
  targetId,
  targetKind,
  modelId,
  credentialId,
  workingDirectory
}) => {
  try {
    if (!sessionId) {
      throw new Error('Missing sessionId')
    }

    const session = await getOrCreateHydratedSession({
      sessionId,
      projectId,
      projectPath: workingDirectory || decodeProjectPath(projectId),
      webContents: event.sender,
      createIfNotExists: true
    })

    const result = await session.setSessionTarget({
      targetId,
      targetKind,
      modelId,
      credentialId
    })

    return {
      success: true,
      ...result
    }
  } catch (error) {
    logger.error('[SessionConfig] Failed to set session target', { projectId, sessionId, error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('set-session-effort', async (event, {
  projectId,
  sessionId,
  effort,
  workingDirectory,
  model
}) => {
  try {
    const normalizedEffort = typeof effort === 'string' ? effort.trim() : ''
    if (!sessionId) {
      throw new Error('Missing sessionId')
    }
    if (!normalizedEffort) {
      throw new Error('Missing effort')
    }
    const session = await getOrCreateHydratedSession({
      sessionId,
      projectId,
      projectPath: workingDirectory || decodeProjectPath(projectId),
      webContents: event.sender,
      createIfNotExists: true
    })
    const result = await session.setSessionEffort(normalizedEffort, {
      projectId,
      workingDirectory,
      model
    })

    return {
      success: true,
      ...result
    }
  } catch (error) {
    logger.error('[SessionConfig] Failed to set session effort', {
      projectId,
      sessionId,
      error: error.message
    })
    return { success: false, error: error.message }
  }
})

// Delete session config (reset settings)
ipcMain.handle('delete-session-config', async (event, { projectId, sessionId }) => {
  try {
    const updatedConfig = projectService.resetSessionConfig(projectId, sessionId)
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
    const newSession = projectService.copySession(projectId, sessionId)
    const hasConfig = !!(newSession?.settings && Object.keys(newSession.settings).length > 0)
    logger.info('[SessionConfig] Session copied', { sourceId: sessionId, newId: newSession.id, hasConfig })
    return { success: true, session: newSession }
  } catch (error) {
    logger.error('[SessionConfig] Failed to copy session', { projectId, sessionId, error: error.message })
    return { success: false, error: error.message }
  }
})

// Remove a project
ipcMain.handle('remove-project', async (event, { projectId, deleteFolder }) => {
  try {
    return await projectService.removeProject(projectId, deleteFolder)
  } catch (error) {
    logger.error('[Projects] Failed to remove project', { projectId, deleteFolder, error: error.message })
    throw new Error(`删除项目失败: ${error.message}`)
  }
})

// Get sessions for a project
ipcMain.handle('get-sessions', async (event, { projectId }) => {
  return projectService.getProjectSessions(projectId)
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
  const nextSettings = {
    ...(settings || {}),
    ...(settings?.debug === undefined ? { debug: isDev === true } : {})
  }

  const sessionConfig = await projectService.createSession(projectId, name, nextSettings)

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
  try {
    const result = await projectService.deleteSession(projectId, sessionId)
    logger.info('[Sessions] Deleted session', {
      sessionId,
      projectId,
      providerDeleted: result?.providerDeleted !== false
    })
    return { success: true, ...result }
  } catch (e) {
    logger.error('[Sessions] Failed to delete session cleanly', { sessionId, projectId, error: e.message })
    return { success: false, error: e.message }
  }
})

// Open a session (returns session info for compatibility)
ipcMain.handle('open-session', async (event, { sessionId }) => {
  return projectService.openSession(sessionId)
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

    const updatedSession = await projectService.renameSession(sessionId, projectId, name)
    if (!updatedSession) {
      return { success: false, error: 'Session not found' }
    }

    return { success: true, session: updatedSession }
  } catch (error) {
    logger.error('[SessionConfig] Failed to rename session', { projectId, sessionId, error: error.message })
    return { success: false, error: error.message }
  }
})

// Open project in new window
ipcMain.handle('open-project-in-new-window', async (event, { projectId }) => {
  try {
    // Debug: log all windows and their projectIds
    const allWindows = BrowserWindow.getAllWindows()
    logger.info('[Window] Checking for existing project window', {
      requestedProjectId: projectId,
      totalWindows: allWindows.length,
      windowProjectIds: allWindows.map(win => ({
        id: win.id,
        projectId: win.projectId,
        title: win.getTitle()
      }))
    })

    // Check if project is already open in another window
    const existingWindow = allWindows.find(win => win.projectId === projectId)
    if (existingWindow) {
      // Focus the existing window instead of creating a new one
      if (existingWindow.isMinimized()) {
        existingWindow.restore()
      }
      existingWindow.focus()
      logger.info('[Window] Project already open, focused existing window', { projectId, windowId: existingWindow.id })
      return { success: true, windowId: existingWindow.id, reused: true }
    }

    // Get project info
    const projects = await projectService.scanProjects()
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
    const newWindowWebContentsId = newWindow.webContents.id

    // Load app with project ID
    if (isDev) {
      const url = `http://127.0.0.1:5173/?projectId=${encodeURIComponent(projectId)}`
      logger.info('[Window] Loading URL in new window', { url })
      newWindow.loadURL(url)
    } else {
      // In production, use loadURL with file:// protocol and query params
      const indexPath = path.join(__dirname, '../dist/index.html')
      newWindow.loadURL(`file://${indexPath}?projectId=${encodeURIComponent(projectId)}`)
    }

    // Handle window close
    newWindow.on('closed', () => {
      stopProjectFileWatcher(newWindowWebContentsId)
      logger.info('[Window] Closed window', { projectId })
    })

    logger.info('[Window] Created new window', { projectName: project.name, projectId })

    return { success: true, windowId: newWindow.id }
  } catch (error) {
    logger.error('[Window] Failed to create new window', { error: error.message })
    throw error
  }
})

// Focus project window if already open, returns { focused: true } or { focused: false }
ipcMain.handle('focus-project-window', async (event, { projectId }) => {
  try {
    const allWindows = BrowserWindow.getAllWindows()
    logger.info('[Window] Checking for existing project window to focus', {
      requestedProjectId: projectId,
      totalWindows: allWindows.length,
      windowProjectIds: allWindows.map(win => ({
        id: win.id,
        projectId: win.projectId,
        title: win.getTitle()
      }))
    })

    // Find window with this project (exclude current window)
    const currentWindow = BrowserWindow.fromWebContents(event.sender)
    const existingWindow = allWindows.find(win => win !== currentWindow && win.projectId === projectId)

    if (existingWindow) {
      // Focus the existing window
      if (existingWindow.isMinimized()) {
        existingWindow.restore()
      }
      existingWindow.focus()
      logger.info('[Window] Project already open in another window, focused it', { projectId, windowId: existingWindow.id })
      return { focused: true, windowId: existingWindow.id }
    }

    logger.info('[Window] Project not open in another window', { projectId })
    return { focused: false }
  } catch (error) {
    logger.error('[Window] Failed to focus project window', { error: error.message })
    return { focused: false }
  }
})

// Check if project folder exists
ipcMain.handle('check-project-exists', async (event, { projectPath }) => {
  try {
    const exists = fs.existsSync(projectPath)
    logger.info('[Project] check-project-exists', { projectPath, exists })
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

// Resize window (for welcome → project transition)
ipcMain.handle('resize-window', async (event, { width, height, center = false, anchor = false }) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return { success: false }
  const [currentWidth, currentHeight] = win.getSize()
  const newWidth = width || currentWidth
  const newHeight = height || currentHeight

  if (anchor) {
    const [x, y] = win.getPosition()
    const [curW, curH] = [currentWidth, currentHeight]
    const cx = x + curW / 2
    const cy = y + curH / 2
    let newX = Math.round(cx - newWidth / 2)
    let newY = Math.round(cy - newHeight / 2)
    const display = electronScreen.getDisplayMatching(win.getBounds())
    const { x: wx, y: wy, width: sw, height: sh } = display.workArea
    newX = Math.max(wx, Math.min(newX, wx + sw - newWidth))
    newY = Math.max(wy, Math.min(newY, wy + sh - newHeight))
    win.setBounds({ x: newX, y: newY, width: newWidth, height: newHeight })
  } else {
    win.setSize(newWidth, newHeight)
    if (center) {
      win.center()
    }
  }
  return { success: true }
})

// Update window title and projectId
ipcMain.handle('update-window-title', async (event, { title, projectId }) => {
  const window = BrowserWindow.fromWebContents(event.sender)
  if (window) {
    window.setTitle(title)
    // Update projectId for tracking which project is open in this window
    if (projectId !== undefined) {
      window.projectId = projectId || null
    }
    logger.info('[Window] Updated window title:', title, { projectId })
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

    const senderId = event.sender.id
    const absoluteProjectPath = path.resolve(projectPath)
    const currentWatcher = projectFileWatchers.get(senderId) || null
    if (currentWatcher?.path === absoluteProjectPath) {
      return { success: true }
    }

    stopProjectFileWatcher(senderId)

    const watcher = fs.watch(
      absoluteProjectPath,
      { recursive: process.platform === 'darwin' || process.platform === 'win32' },
      (eventType, filename) => {
        const relativePath = normalizePathSlashes(filename || '')
        if (shouldIgnoreWatchedPath(relativePath) || isProjectPathHidden(absoluteProjectPath, relativePath, { includeAncestors: true })) {
          return
        }

        // 检查 webContents 是否已被销毁
        if (event.sender.isDestroyed()) {
          stopProjectFileWatcher(senderId)
          return
        }

        event.sender.send('project-files-changed', {
          projectPath: absoluteProjectPath,
          eventType,
          relativePath
        })
      }
    )

    projectFileWatchers.set(senderId, {
      watcher,
      path: absoluteProjectPath
    })
    return { success: true }
  } catch (error) {
    logger.error('[Files] Failed to watch project files', { projectPath, error: error.message })
    stopProjectFileWatcher(event.sender.id)
    return { success: false, error: error.message }
  }
})

ipcMain.handle('unwatch-project-files', async (event) => {
  stopProjectFileWatcher(event.sender.id)
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

ipcMain.handle('read-attachment-file', async (event, { filePath }) => {
  try {
    if (!filePath) {
      throw new Error('缺少文件路径')
    }

    const absolutePath = path.resolve(filePath)
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
          path: absolutePath,
          size: stat.size,
          language: detectLanguageFromPath(absolutePath)
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
          path: absolutePath,
          size: stat.size,
          language: detectLanguageFromPath(absolutePath)
        }
      }
    }

    return {
      success: true,
      file: {
        path: absolutePath,
        name: path.basename(absolutePath),
        language: detectLanguageFromPath(absolutePath),
        content: buffer.toString('utf8'),
        size: stat.size,
        updatedAt: stat.mtime.toISOString()
      }
    }
  } catch (error) {
    logger.error('[Files] Failed to read attachment file', { filePath, error: error.message })
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
    const normalizedTargetPath = normalizeProjectRelativePath(targetPath)

    const isHidden = isProjectPathHidden(projectPath, normalizedTargetPath, {
      isDirectory,
      includeAncestors: true
    })

    if (isHidden && (!isDirectory || !directoryHasVisibleDescendants(projectPath, absoluteTargetPath))) {
      return { success: true, exists: false }
    }

    let hasChildren = false

    if (isDirectory) {
      try {
        hasChildren = listVisibleDirectoryEntries(projectPath, absoluteTargetPath).length > 0
      } catch (error) {
        hasChildren = false
      }
    }

    return {
      success: true,
      exists: true,
      entry: {
        name: path.basename(absoluteTargetPath),
        path: normalizeProjectRelativePath(path.relative(projectPath, absoluteTargetPath)),
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

ipcMain.handle('open-path-in-finder', async (event, { targetPath, mode = 'reveal' }) => {
  try {
    if (!targetPath) {
      throw new Error('缺少目标路径')
    }

    if (!['reveal', 'open'].includes(mode)) {
      throw new Error('无效的打开模式')
    }

    const absoluteTargetPath = path.resolve(targetPath)
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
    logger.error('[Files] Failed to open absolute path in finder', { targetPath, mode, error: error.message })
    return { success: false, error: error.message || '打开失败' }
  }
})

ipcMain.handle('open-file-with-application', async (event, { targetPath, application = 'default' }) => {
  try {
    await openFileWithApplication(targetPath, application)
    return { success: true }
  } catch (error) {
    logger.error('[Files] Failed to open file with application', {
      targetPath,
      application,
      error: error.message
    })
    return { success: false, error: error.message || '打开文件失败' }
  }
})

ipcMain.handle('open-external-url', async (event, { url }) => {
  try {
    if (!url || typeof url !== 'string') {
      throw new Error('缺少链接地址')
    }

    await shell.openExternal(url)
    return { success: true }
  } catch (error) {
    logger.error('[Shell] Failed to open external url', { url, error: error.message })
    return { success: false, error: error.message || '打开链接失败' }
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

const { docsManager } = require('./storage')

// Get app config
ipcMain.handle('get-app-config', async () => {
  try {
    const config = appService.syncCodexAccountsWithAuthConfig()
    return { success: true, config }
  } catch (error) {
    logger.error('[AppConfig] Failed to get config', { error: error.message })
    return { success: false, error: error.message }
  }
})

// Save app config
ipcMain.handle('save-app-config', async (event, { config }) => {
  try {
    const success = appService.saveAppConfig(config)
    return { success }
  } catch (error) {
    logger.error('[AppConfig] Failed to save config', { error: error.message })
    return { success: false, error: error.message }
  }
})

// Update app config
ipcMain.handle('update-app-config', async (event, { updates }) => {
  try {
    const config = appService.updateAppConfig(updates)
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

ipcMain.handle('manage-claude-hook', async (event, options = {}) => {
  try {
    const action = options?.action || ''
    const scope = options?.scope || 'user'
    const projectPath = options?.projectPath || ''
    const settingsPath = getClaudeHookSettingsPath(scope, projectPath)
    const existingSettings = readJsonFileSafe(settingsPath, {})
    let nextSettings = existingSettings

    if (action === 'create') {
      nextSettings = appendClaudeHook(existingSettings, options.payload || {})
    } else if (action === 'update') {
      nextSettings = removeClaudeHook(existingSettings, options.target || {})
      nextSettings = appendClaudeHook(nextSettings, options.payload || {})
    } else if (action === 'delete') {
      nextSettings = removeClaudeHook(existingSettings, options.target || {})
    } else {
      throw new Error('无效的 Hook 操作')
    }

    ensureParentDir(settingsPath)
    fs.writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2), 'utf-8')

    return {
      success: true,
      settingsPath,
      data: providerInspector.inspectProviderSetup({
        provider: 'claude',
        projectPath
      })
    }
  } catch (error) {
    logger.error('[ClaudeHook] Failed to manage Claude hook', {
      action: options?.action || '',
      scope: options?.scope || '',
      error: error.message
    })
    return { success: false, error: error.message || 'Hook 操作失败' }
  }
})

ipcMain.handle('manage-claude-hook-settings', async (event, options = {}) => {
  try {
    const scope = options?.scope || 'user'
    const projectPath = options?.projectPath || ''
    const settingsPath = getClaudeHookSettingsPath(scope, projectPath)
    const existingSettings = readJsonFileSafe(settingsPath, {})
    const nextSettings = existingSettings && typeof existingSettings === 'object'
      ? { ...existingSettings }
      : {}

    nextSettings.disableAllHooks = options?.disableAllHooks === true

    ensureParentDir(settingsPath)
    fs.writeFileSync(settingsPath, JSON.stringify(nextSettings, null, 2), 'utf-8')

    return {
      success: true,
      settingsPath,
      data: providerInspector.inspectProviderSetup({
        provider: 'claude',
        projectPath
      })
    }
  } catch (error) {
    logger.error('[ClaudeHookSettings] Failed to update Claude hook settings', {
      scope: options?.scope || '',
      error: error.message
    })
    return { success: false, error: error.message || 'Hook 设置更新失败' }
  }
})

ipcMain.handle('manage-claude-subagent', async (event, options = {}) => {
  try {
    const action = options?.action || ''
    const scope = options?.scope || 'user'
    const projectPath = options?.projectPath || ''

    if (!['create', 'update', 'delete'].includes(action)) {
      throw new Error('无效的 SubAgent 操作')
    }

    if (action === 'delete') {
      const targetPath = resolveClaudeSubagentPath(scope, projectPath, options?.target?.name || '', options?.target?.path || '')
      if (!targetPath || !fs.existsSync(targetPath)) {
        throw new Error('未找到目标 SubAgent')
      }
      fs.unlinkSync(targetPath)
    } else {
      const payload = options?.payload || {}
      const targetPath = action === 'update'
        ? resolveClaudeSubagentPath(scope, projectPath, options?.target?.name || '', options?.target?.path || '')
        : buildClaudeSubagentPath(scope, projectPath, payload.name || '')
      const nextContent = buildClaudeSubagentMarkdown(payload)
      ensureParentDir(targetPath)
      fs.writeFileSync(targetPath, nextContent, 'utf-8')
    }

    return {
      success: true,
      data: providerInspector.inspectProviderSetup({
        provider: 'claude',
        projectPath
      })
    }
  } catch (error) {
    logger.error('[ClaudeSubAgent] Failed to manage Claude subagent', {
      action: options?.action || '',
      scope: options?.scope || '',
      error: error.message
    })
    return { success: false, error: error.message || 'SubAgent 操作失败' }
  }
})

ipcMain.handle('list-claude-models', async (event, options) => {
  try {
    const result = await appService.listClaudeModels(options || {})
    return { success: true, ...result }
  } catch (error) {
    logger.error('[ClaudeSettings] Failed to list models', { error: error.message })
    return { success: false, error: error.message }
  }
})

function getCodexConfigPath() {
  return path.join(os.homedir(), '.codex', 'config.toml')
}

function getClaudeSubagentDir(scope = 'user', projectPath = '') {
  if (scope === 'project') {
    if (!projectPath) throw new Error('缺少项目路径')
    return path.join(projectPath, '.claude', 'agents')
  }
  return path.join(os.homedir(), '.claude', 'agents')
}

function slugifySubagentName(name = '') {
  const value = String(name || '').trim()
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5_-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
  return slug || 'subagent'
}

function buildClaudeSubagentPath(scope = 'user', projectPath = '', name = '') {
  const dir = getClaudeSubagentDir(scope, projectPath)
  return path.join(dir, `${slugifySubagentName(name)}.md`)
}

function resolveClaudeSubagentPath(scope = 'user', projectPath = '', name = '', currentPath = '') {
  if (currentPath) return currentPath
  return buildClaudeSubagentPath(scope, projectPath, name)
}

function buildClaudeSubagentMarkdown(payload = {}) {
  const name = String(payload.name || '').trim()
  const description = String(payload.description || '').trim()
  const model = String(payload.model || '').trim()
  const prompt = String(payload.prompt || '').trim()
  const tools = Array.isArray(payload.tools)
    ? payload.tools.map(item => String(item || '').trim()).filter(Boolean)
    : []

  if (!name) throw new Error('缺少 SubAgent 名称')
  if (!description) throw new Error('缺少 SubAgent 描述')
  if (!prompt) throw new Error('缺少 SubAgent 提示词')

  const frontmatter = {
    name,
    description
  }
  if (model) frontmatter.model = model
  if (tools.length > 0) frontmatter.tools = tools

  const yamlText = yaml.dump(frontmatter, {
    lineWidth: -1,
    noRefs: true
  }).trim()

  return `---\n${yamlText}\n---\n\n${prompt}\n`
}

function getClaudeHookSettingsPath(scope = 'user', projectPath = '') {
  if (scope === 'project') {
    if (!projectPath) throw new Error('缺少项目路径')
    return path.join(projectPath, '.claude', 'settings.json')
  }
  if (scope === 'local') {
    if (!projectPath) throw new Error('缺少项目路径')
    return path.join(projectPath, '.claude', 'settings.local.json')
  }
  return path.join(os.homedir(), '.claude', 'settings.json')
}

function readJsonFileSafe(targetPath, fallback = {}) {
  try {
    if (!fs.existsSync(targetPath)) return fallback
    return JSON.parse(fs.readFileSync(targetPath, 'utf-8'))
  } catch {
    return fallback
  }
}

function ensureParentDir(filePath) {
  const dirPath = path.dirname(filePath)
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

function buildClaudeHookEntry(payload = {}) {
  const type = payload.type || 'command'
  const handler = {
    type,
    async: payload.async === true
  }

  const contentValue = typeof payload.content === 'string' ? payload.content.trim() : ''
  if (!contentValue) {
    throw new Error('缺少 Hook 内容')
  }

  if (type === 'command') handler.command = contentValue
  else if (type === 'http') handler.url = contentValue
  else if (type === 'prompt') handler.prompt = contentValue
  else if (type === 'agent') handler.agent = contentValue
  else handler.content = contentValue

  if (payload.timeout !== undefined && payload.timeout !== null && String(payload.timeout).trim() !== '') {
    const timeout = Number(payload.timeout)
    if (!Number.isFinite(timeout) || timeout < 0) {
      throw new Error('timeout 必须是非负数字')
    }
    handler.timeout = timeout
  }

  return {
    matcher: typeof payload.matcher === 'string' ? payload.matcher.trim() : '',
    hook: handler
  }
}

function appendClaudeHook(settings = {}, payload = {}) {
  const eventName = typeof payload.eventName === 'string' ? payload.eventName.trim() : ''
  if (!eventName) throw new Error('缺少 Hook 点')

  const nextSettings = settings && typeof settings === 'object' ? { ...settings } : {}
  const hooksRoot = nextSettings.hooks && typeof nextSettings.hooks === 'object' && !Array.isArray(nextSettings.hooks)
    ? { ...nextSettings.hooks }
    : {}
  const entries = Array.isArray(hooksRoot[eventName]) ? [...hooksRoot[eventName]] : []
  const built = buildClaudeHookEntry(payload)

  entries.push({
    matcher: built.matcher || undefined,
    hooks: [built.hook]
  })

  hooksRoot[eventName] = entries
  nextSettings.hooks = hooksRoot
  return nextSettings
}

function removeClaudeHook(settings = {}, target = {}) {
  const eventName = target?.eventName || ''
  const groupIndex = Number(target?.groupIndex ?? -1)
  const hookIndex = Number(target?.hookIndex ?? -1)
  if (!eventName) throw new Error('缺少目标 Hook 点')

  const nextSettings = settings && typeof settings === 'object' ? { ...settings } : {}
  const hooksRoot = nextSettings.hooks && typeof nextSettings.hooks === 'object' && !Array.isArray(nextSettings.hooks)
    ? { ...nextSettings.hooks }
    : {}
  const eventEntries = Array.isArray(hooksRoot[eventName]) ? [...hooksRoot[eventName]] : null

  if (!eventEntries || !eventEntries[groupIndex]) {
    throw new Error('未找到目标 Hook')
  }

  const rawEntry = eventEntries[groupIndex]
  if (Array.isArray(rawEntry?.hooks) && rawEntry.hooks.length > 0) {
    const nextHooks = rawEntry.hooks.filter((_, index) => index !== hookIndex)
    if (nextHooks.length > 0) {
      eventEntries[groupIndex] = {
        ...rawEntry,
        hooks: nextHooks
      }
    } else {
      eventEntries.splice(groupIndex, 1)
    }
  } else {
    eventEntries.splice(groupIndex, 1)
  }

  if (eventEntries.length > 0) {
    hooksRoot[eventName] = eventEntries
  } else {
    delete hooksRoot[eventName]
  }

  if (Object.keys(hooksRoot).length > 0) {
    nextSettings.hooks = hooksRoot
  } else {
    delete nextSettings.hooks
  }

  return nextSettings
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
  return appService.readCodexConfigFile()
}

function readCodexAuthFile() {
  return appService.readCodexAuthFile()
}

function writeCodexConfigFile(updates = {}) {
  return appService.writeCodexConfigFile(updates || {})
}

function writeCodexAuthFile(updates = {}) {
  return appService.writeCodexAuthFile(updates || {})
}

// Get Codex settings from ~/.codex/config.toml
ipcMain.handle('get-codex-settings', async () => {
  try {
    appService.syncCodexModelProviders()
    const settings = appService.readCodexConfigFile()
    const auth = readCodexAuthFile()
    const appConfig = appService.getAppConfig()
    const codexAccounts = Array.isArray(appConfig.settings?.codexAccounts)
      ? appConfig.settings.codexAccounts
      : []
    const activeAccount = auth.authMode === 'chatgpt'
      ? (
          codexAccounts.find(account => account?.accountId && account.accountId === auth.accountId) ||
          codexAccounts.find(account => account?.id && account.id === appConfig.settings?.selectedCodexAccountId) ||
          null
        )
      : null
    return {
      success: true,
      settings: {
        authMode: auth.authMode || 'provider',
        model: settings.model || '',
        modelProvider: settings.modelProvider || '',
        modelReasoningEffort: settings.modelReasoningEffort || 'medium',
        apiUrl: settings.apiUrl || '',
        proxyUrl: appConfig.settings?.codexProxy || '',
        authToken: auth.authToken || '',
        activeAccountId: activeAccount?.id || null,
        activeAccountName: activeAccount?.name || ''
      }
    }
  } catch (error) {
    logger.error('[CodexSettings] Failed to load settings', { error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('load-codex-auth-tokens', async () => {
  try {
    const tokens = appService.loadCodexAuthTokens()
    return {
      success: true,
      tokens
    }
  } catch (error) {
    logger.error('[CodexSettings] Failed to load auth tokens', { error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('apply-codex-account', async (event, { account }) => {
  try {
    const result = appService.applyCodexAccount(account || {})
    return {
      success: true,
      tokens: result.tokens,
      config: result.config
    }
  } catch (error) {
    logger.error('[CodexSettings] Failed to apply codex account', { error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-codex-usage-status', async (event, options = {}) => {
  try {
    const usage = options?.account
      ? await appService.refreshCodexAccountUsage(options.account)
      : await appService.getCodexUsageStatus()
    return {
      success: true,
      usage
    }
  } catch (error) {
    logger.error('[CodexSettings] Failed to load usage status', { error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('get-active-codex-account-usage-snapshot', async () => {
  try {
    return {
      success: true,
      ...appService.getActiveCodexAccountUsageSnapshot()
    }
  } catch (error) {
    logger.error('[CodexSettings] Failed to load active codex account usage snapshot', { error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('list-codex-models', async (event, options = {}) => {
  try {
    const result = await appService.listCodexModels(options || {})
    return {
      success: true,
      ...result
    }
  } catch (error) {
    logger.error('[CodexSettings] Failed to list codex models', { error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('set-codex-default-model', async (event, options = {}) => {
  try {
    const result = await appService.setCodexDefaultModel(options || {})
    return {
      success: true,
      ...result
    }
  } catch (error) {
    logger.error('[CodexSettings] Failed to set codex default model', { error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('refresh-codex-auth-token', async () => {
  try {
    const result = await appService.refreshCodexAuthToken()
    return {
      success: true,
      ...result
    }
  } catch (error) {
    logger.error('[CodexSettings] Failed to refresh auth token', { error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('start-codex-chatgpt-login', async () => {
  try {
    const result = await appService.startCodexChatGptLogin()
    return {
      success: true,
      result: result || null
    }
  } catch (error) {
    logger.error('[CodexSettings] Failed to start ChatGPT login', { error: error.message })
    return { success: false, error: error.message }
  }
})

// Update Codex settings to ~/.codex/config.toml
ipcMain.handle('update-codex-settings', async (event, { updates }) => {
  try {
    const settings = appService.writeCodexConfigFile(updates || {})
    const authSettings = writeCodexAuthFile(updates || {})
    const currentAppConfig = appService.getAppConfig()
    const appConfig = appService.updateAppConfig({
      settings: {
        codexProxy: updates?.proxyUrl !== undefined
          ? (updates.proxyUrl || '')
          : (currentAppConfig.settings?.codexProxy || '')
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

ipcMain.handle('sync-codex-model-providers', async () => {
  try {
    const result = appService.syncCodexModelProviders()
    return {
      success: true,
      ...result
    }
  } catch (error) {
    logger.error('[CodexSettings] Failed to sync model providers', { error: error.message })
    return { success: false, error: error.message }
  }
})

ipcMain.handle('inspect-provider-setup', async (event, options = {}) => {
  try {
    const result = providerInspector.inspectProviderSetup(options || {})
    return {
      success: true,
      data: result
    }
  } catch (error) {
    logger.error('[ProviderInspector] Failed to inspect provider setup', {
      provider: options?.provider || 'claude',
      error: error.message
    })
    return {
      success: false,
      error: error.message
    }
  }
})

ipcMain.handle('manage-claude-plugin', async (event, options = {}) => {
  try {
    const args = buildClaudePluginCommand(options)
    const { stdout, stderr } = await execFileAsync('claude', args, {
      cwd: options.projectPath || process.cwd()
    })
    const data = providerInspector.inspectProviderSetup({
      provider: 'claude',
      projectPath: options.projectPath || ''
    })

    return {
      success: true,
      stdout: stdout || '',
      stderr: stderr || '',
      data
    }
  } catch (error) {
    logger.error('[ClaudePlugin] Failed to manage Claude plugin', {
      action: options?.action || '',
      error: error.message
    })
    return {
      success: false,
      error: error.message
    }
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

ipcMain.handle('fetch-json', async (event, options) => {
  try {
    const https = require('https')
    const http = require('http')
    const url = typeof options === 'string' ? options : options.url
    const method = options.method || 'GET'
    const reqHeaders = options.headers || {}
    const body = options.body || null
    const parsedUrl = new URL(url)
    const protocol = parsedUrl.protocol === 'https:' ? https : http

    return new Promise((resolve) => {
      const requestOptions = {
        method,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'CCGUI/1.0',
          ...reqHeaders
        }
      }
      if (body) {
        requestOptions.headers['Content-Length'] = Buffer.byteLength(body)
      }

      const req = protocol.request(url, requestOptions, (res) => {
        if (res.statusCode >= 400) {
          let errData = ''
          res.on('data', chunk => { errData += chunk })
          res.on('end', () => {
            resolve({ success: false, error: `HTTP ${res.statusCode}: ${errData.slice(0, 200)}` })
          })
          return
        }
        let data = ''
        res.on('data', chunk => { data += chunk })
        res.on('end', () => {
          try {
            resolve({ success: true, data: JSON.parse(data) })
          } catch (e) {
            resolve({ success: false, error: e.message })
          }
        })
      })
      req.on('error', (error) => {
        resolve({ success: false, error: error.message })
      })
      req.setTimeout(15000, () => {
        req.destroy()
        resolve({ success: false, error: 'Request timeout' })
      })
      if (body) {
        req.write(body)
      }
      req.end()
    })
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// ============================================
// ClawHub Skill Download API
// ============================================
ipcMain.handle('download-skill', async (event, { slug }) => {
  try {
    const fs = require('fs')
    const path = require('path')
    const https = require('https')
    const http = require('http')
    const { execSync } = require('child_process')
    const os = require('os')

    const skillsDir = path.join(os.homedir(), '.ccgui', 'skills', 'clawhub')
    const skillDir = path.join(skillsDir, slug)

    // 如果已存在，先删除
    if (fs.existsSync(skillDir)) {
      fs.rmSync(skillDir, { recursive: true, force: true })
    }

    // 下载 zip
    const downloadUrl = `https://clawhub.ai/api/v1/download?slug=${encodeURIComponent(slug)}`
    const tmpZip = path.join(os.tmpdir(), `clawhub-${slug}-${Date.now()}.zip`)

    await new Promise((resolve, reject) => {
      const parsedUrl = new URL(downloadUrl)
      const protocol = parsedUrl.protocol === 'https:' ? https : http

      const req = protocol.get(downloadUrl, {
        headers: {
          'Accept': '*/*',
          'User-Agent': 'CCGUI/1.0'
        }
      }, (res) => {
        // 处理重定向
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          const file = fs.createWriteStream(tmpZip)
          const redirectReq = protocol.get(res.headers.location, (redirectRes) => {
            redirectRes.pipe(file)
            file.on('finish', () => { file.close(); resolve() })
          })
          redirectReq.on('error', reject)
          return
        }

        if (res.statusCode >= 400) {
          let errData = ''
          res.on('data', chunk => { errData += chunk })
          res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${errData.slice(0, 200)}`)))
          return
        }

        const file = fs.createWriteStream(tmpZip)
        res.pipe(file)
        file.on('finish', () => { file.close(); resolve() })
        file.on('error', reject)
      })
      req.on('error', reject)
      req.setTimeout(60000, () => {
        req.destroy()
        reject(new Error('Download timeout'))
      })
    })

    // 创建目标目录
    fs.mkdirSync(skillDir, { recursive: true })

    // 解压
    try {
      execSync(`unzip -o "${tmpZip}" -d "${skillDir}"`, { stdio: 'pipe' })
    } catch (e) {
      // unzip 可能返回非零退出码但有输出
      if (!fs.existsSync(path.join(skillDir, 'SKILL.md'))) {
        // 检查是否解压到了子目录（zip 内有根文件夹）
        const entries = fs.readdirSync(skillDir)
        if (entries.length === 1 && fs.statSync(path.join(skillDir, entries[0])).isDirectory()) {
          const subDir = path.join(skillDir, entries[0])
          const tmpMove = path.join(os.tmpdir(), `clawhub-move-${slug}-${Date.now()}`)
          fs.renameSync(subDir, tmpMove)
          fs.rmSync(skillDir, { recursive: true })
          fs.renameSync(tmpMove, skillDir)
        }
      }
    }

    // 清理 zip
    try { fs.unlinkSync(tmpZip) } catch (e) { /* ignore */ }

    // 验证
    if (!fs.existsSync(skillDir)) {
      return { success: false, error: 'Extraction failed: directory not created' }
    }

    return { success: true, path: skillDir }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('check-skill-downloaded', async (event, { slug }) => {
  try {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')
    const skillDir = path.join(os.homedir(), '.ccgui', 'skills', 'clawhub', slug)
    return { success: true, downloaded: fs.existsSync(skillDir) }
  } catch (error) {
    return { success: false, downloaded: false }
  }
})

ipcMain.handle('list-downloaded-skills', async () => {
  try {
    const skillsRoot = path.join(os.homedir(), '.ccgui', 'skills')

    const skills = []

    // 动态扫描所有来源目录
    if (fs.existsSync(skillsRoot)) {
      for (const sourceEntry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
        if (!sourceEntry.isDirectory()) continue
        const sourceName = sourceEntry.name
        const sourcePath = path.join(skillsRoot, sourceName)

        for (const skillEntry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
          if (!skillEntry.isDirectory()) continue
          const skillPath = path.join(sourcePath, skillEntry.name)
          const meta = readSkillMetaFromPath(skillPath, skillEntry.name)
          // Check symlink installation status
          const installedTargets = []
          const claudeLink = path.join(os.homedir(), '.claude', 'skills', skillEntry.name)
          const codexLink = path.join(os.homedir(), '.codex', 'skills', skillEntry.name)
          try { if (fs.lstatSync(claudeLink).isSymbolicLink() && fs.realpathSync(claudeLink) === skillPath) installedTargets.push('claude') } catch (_) {}
          try { if (fs.lstatSync(codexLink).isSymbolicLink() && fs.realpathSync(codexLink) === skillPath) installedTargets.push('codex') } catch (_) {}

          skills.push({ name: meta.name, slug: skillEntry.name, source: sourceName, path: skillPath, description: meta.description, installedTargets })
        }
      }
    }

    // 扫描外部技能（Claude/Codex 目录中非 CCGUI 管理的技能）
    const ccguiPaths = new Set(skills.map(s => s.path))
    const externalDirs = [
      { target: 'claude', dir: path.join(os.homedir(), '.claude', 'skills') },
      { target: 'codex', dir: path.join(os.homedir(), '.codex', 'skills') }
    ]
    const externalSkills = new Map()

    for (const { target, dir } of externalDirs) {
      if (!fs.existsSync(dir)) continue
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        const entryPath = path.join(dir, entry.name)

        // 跳过指向 CCGUI 管理技能的 symlink
        try {
          const stat = fs.lstatSync(entryPath)
          if (stat.isSymbolicLink() && ccguiPaths.has(fs.realpathSync(entryPath))) continue
        } catch (_) {}

        const meta = readSkillMetaFromPath(entryPath, entry.name)
        const existing = externalSkills.get(entry.name)
        if (existing) {
          existing.installedTargets.push(target)
        } else {
          externalSkills.set(entry.name, {
            name: meta.name,
            slug: entry.name,
            source: 'external',
            path: entryPath,
            description: meta.description,
            installedTargets: [target],
            external: true
          })
        }
      }
    }

    skills.push(...externalSkills.values())

    // 扫描 Codex 系统内置技能（~/.codex/skills/.system/）
    const codexSystemDir = path.join(os.homedir(), '.codex', 'skills', '.system')
    if (fs.existsSync(codexSystemDir)) {
      for (const entry of fs.readdirSync(codexSystemDir, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue
        const skillPath = path.join(codexSystemDir, entry.name)
        const meta = readSkillMetaFromPath(skillPath, entry.name)
        skills.push({
          name: meta.name,
          slug: entry.name,
          source: 'codex-system',
          path: skillPath,
          description: meta.description,
          installedTargets: ['codex'],
          external: true,
          system: true
        })
      }
    }

    for (const pluginSkill of providerInspector.collectPlugins({ contents: ['skills'] }).skills) {
      const existing = skills.find(skill => skill.slug === pluginSkill.slug && skill.path === pluginSkill.path)
      if (existing) {
        existing.source = pluginSkill.source || existing.source
        existing.sourceLabel = pluginSkill.sourceLabel || existing.sourceLabel
        existing.plugin = pluginSkill.plugin === true || existing.plugin === true
        existing.pluginEnabled = pluginSkill.pluginEnabled
        existing.pluginScope = pluginSkill.pluginScope || existing.pluginScope
        existing.external = pluginSkill.external === true || existing.external === true
        for (const target of pluginSkill.installedTargets || []) {
          if (!existing.installedTargets.includes(target)) {
            existing.installedTargets.push(target)
          }
        }
        continue
      }
      skills.push(pluginSkill)
    }

    return { success: true, skills }
  } catch (error) {
    return { success: false, skills: [] }
  }
})

// ============================================
// Manual Skill Install / Delete API
// ============================================

function extractArchiveTo(archivePath, targetDir) {
  const fs = require('fs')
  const path = require('path')
  const { execSync } = require('child_process')
  const os = require('os')

  const tmpDir = path.join(os.tmpdir(), `ccgui-skill-extract-${Date.now()}`)
  fs.mkdirSync(tmpDir, { recursive: true })

  let extracted = false

  // Detect archive type by magic bytes
  try {
    const buf = Buffer.alloc(4)
    const fd = fs.openSync(archivePath, 'r')
    fs.readSync(fd, buf, 0, 4, 0)
    fs.closeSync(fd)

    const isZip = buf[0] === 0x50 && buf[1] === 0x4B
    const isGzip = buf[0] === 0x1F && buf[1] === 0x8B

    if (isZip) {
      execSync(`unzip -o "${archivePath}" -d "${tmpDir}"`, { stdio: 'pipe' })
      extracted = true
    } else if (isGzip) {
      execSync(`tar -xzf "${archivePath}" -C "${tmpDir}"`, { stdio: 'pipe' })
      extracted = true
    } else {
      // Fall back to extension
      if (archivePath.endsWith('.tar.gz') || archivePath.endsWith('.tgz')) {
        execSync(`tar -xzf "${archivePath}" -C "${tmpDir}"`, { stdio: 'pipe' })
        extracted = true
      } else if (archivePath.endsWith('.zip')) {
        execSync(`unzip -o "${archivePath}" -d "${tmpDir}"`, { stdio: 'pipe' })
        extracted = true
      } else {
        // Try both
        try {
          execSync(`unzip -o "${archivePath}" -d "${tmpDir}"`, { stdio: 'pipe' })
          extracted = true
        } catch (e) {
          execSync(`tar -xzf "${archivePath}" -C "${tmpDir}"`, { stdio: 'pipe' })
          extracted = true
        }
      }
    }
  } catch (e) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) { /* ignore */ }
    return { success: false, error: '无法解压文件，请确认是有效的 .zip 或 .tar.gz 压缩包' }
  }

  // 查找 SKILL.md
  let skillRoot = tmpDir
  if (!fs.existsSync(path.join(tmpDir, 'SKILL.md'))) {
    const entries = fs.readdirSync(tmpDir)
    if (entries.length === 1 && fs.statSync(path.join(tmpDir, entries[0])).isDirectory()) {
      skillRoot = path.join(tmpDir, entries[0])
    }
    if (!fs.existsSync(path.join(skillRoot, 'SKILL.md'))) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) { /* ignore */ }
      return { success: false, error: '压缩包中未找到 SKILL.md 文件，不是合法的技能包' }
    }
  }

  // 从 SKILL.md 读取技能名称作为文件夹名
  let skillName = path.basename(skillRoot)
  try {
    const content = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf-8')
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
    if (fmMatch) {
      const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m)
      if (nameMatch) skillName = nameMatch[1].trim()
    }
  } catch (_) { /* 保留原始文件夹名 */ }
  const destDir = path.join(targetDir, skillName)
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true, force: true })
  }
  fs.cpSync(skillRoot, destDir, { recursive: true })

  try { fs.rmSync(tmpDir, { recursive: true, force: true }) } catch (_) { /* ignore */ }
  return { success: true, name: skillName, path: destDir }
}

function readSkillMetaFromPath(skillPath, fallbackName) {
  let name = fallbackName
  let description = ''
  try {
    const skillMd = path.join(skillPath, 'SKILL.md')
    if (fs.existsSync(skillMd)) {
      const content = fs.readFileSync(skillMd, 'utf-8')
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
      if (fmMatch) {
        const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m)
        if (nameMatch) {
          name = nameMatch[1].trim().replace(/^["']|["']$/g, '')
        }
        const descMatch = fmMatch[1].match(/^(?:description|summary):\s*(.+)$/m)
        if (descMatch) {
          description = descMatch[1].trim().replace(/^["']|["']$/g, '')
        }
      }
    }
  } catch (_) {}
  return { name, description }
}

ipcMain.handle('install-skill', async (event, { source }) => {
  try {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')
    const https = require('https')
    const http = require('http')

    const skillsRoot = path.join(os.homedir(), '.ccgui', 'skills')
    fs.mkdirSync(skillsRoot, { recursive: true })

    // URL → 先下载到 /tmp
    if (/^https?:\/\//i.test(source)) {
      const urlBasename = path.basename(new URL(source).pathname) || 'download.zip'
      const tmpFile = path.join(os.tmpdir(), `ccgui-skill-url-${Date.now()}-${urlBasename}`)

      await new Promise((resolve, reject) => {
        const parsedUrl = new URL(source)
        const protocol = parsedUrl.protocol === 'https:' ? https : http

        const doRequest = (reqUrl) => {
          const req = protocol.get(reqUrl, {
            headers: { 'User-Agent': 'CCGUI/1.0' }
          }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              doRequest(res.headers.location)
              return
            }
            if (res.statusCode >= 400) {
              let errData = ''
              res.on('data', chunk => { errData += chunk })
              res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${errData.slice(0, 200)}`)))
              return
            }
            const file = fs.createWriteStream(tmpFile)
            res.pipe(file)
            file.on('finish', () => { file.close(); resolve() })
            file.on('error', reject)
          })
          req.on('error', reject)
          req.setTimeout(120000, () => { req.destroy(); reject(new Error('下载超时')) })
        }

        doRequest(source)
      })

      // 从 URL 提取域名作为来源分类
      const hostname = new URL(source).hostname
      const domainParts = hostname.split('.')
      const skipPrefixes = ['www', 'api', 'raw', 'cdn', 'dl']
      while (domainParts.length > 1 && skipPrefixes.includes(domainParts[0])) domainParts.shift()
      const domainName = domainParts[0] || 'local'

      const urlSkillsDir = path.join(skillsRoot, domainName)
      fs.mkdirSync(urlSkillsDir, { recursive: true })
      const result = extractArchiveTo(tmpFile, urlSkillsDir)
      try { fs.unlinkSync(tmpFile) } catch (_) { /* ignore */ }
      return result
    }

    // 本地路径
    const resolvedPath = path.resolve(source)
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: '路径不存在' }
    }

    const stat = fs.statSync(resolvedPath)

    if (stat.isDirectory()) {
      // 目录 → 检查 SKILL.md → 复制
      if (!fs.existsSync(path.join(resolvedPath, 'SKILL.md'))) {
        return { success: false, error: '目录中未找到 SKILL.md 文件，不是合法的技能包' }
      }

      // 从 SKILL.md 读取技能名称
      let skillName = path.basename(resolvedPath)
      try {
        const content = fs.readFileSync(path.join(resolvedPath, 'SKILL.md'), 'utf-8')
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
        if (fmMatch) {
          const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m)
          if (nameMatch) skillName = nameMatch[1].trim()
        }
      } catch (_) { /* 保留原始文件夹名 */ }
      const destDir = path.join(skillsRoot, 'local', skillName)
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true })
      }
      fs.cpSync(resolvedPath, destDir, { recursive: true })

      return { success: true, name: skillName, path: destDir }
    }

    // 文件 → 当作压缩包
    return extractArchiveTo(resolvedPath, path.join(skillsRoot, 'local'))
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('delete-skill', async (event, { name, source }) => {
  try {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')

    const skillDir = path.join(os.homedir(), '.ccgui', 'skills', source, name)

    if (!fs.existsSync(skillDir)) {
      return { success: false, error: '技能不存在' }
    }

    // Clean up symlinks in target directories
    const targetDirs = [
      path.join(os.homedir(), '.claude', 'skills'),
      path.join(os.homedir(), '.codex', 'skills')
    ]
    for (const targetDir of targetDirs) {
      const linkPath = path.join(targetDir, name)
      try {
        const stat = fs.lstatSync(linkPath)
        if (stat.isSymbolicLink() && fs.realpathSync(linkPath) === skillDir) {
          fs.unlinkSync(linkPath)
        }
      } catch (_) {}
    }

    fs.rmSync(skillDir, { recursive: true, force: true })
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('read-skill-readme', async (event, { skillPath }) => {
  try {
    const fs = require('fs')
    const path = require('path')
    const readmePath = path.join(skillPath, 'SKILL.md')
    if (!fs.existsSync(readmePath)) {
      return { success: false, error: 'SKILL.md not found' }
    }
    const content = fs.readFileSync(readmePath, 'utf-8')
    return { success: true, content }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('read-skill-extra', async (event, { skillPath }) => {
  try {
    const fs = require('fs')
    const path = require('path')

    // 读取 LICENSE
    let license = null
    for (const name of ['LICENSE.txt', 'LICENSE', 'LICENSE.md', 'license.txt']) {
      const p = path.join(skillPath, name)
      if (fs.existsSync(p)) {
        license = fs.readFileSync(p, 'utf-8')
        break
      }
    }

    // 读取文件结构
    function buildTree(dir) {
      const entries = []
      let items
      try { items = fs.readdirSync(dir, { withFileTypes: true }) } catch (_) { return entries }
      items.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1
        if (!a.isDirectory() && b.isDirectory()) return 1
        return a.name.localeCompare(b.name)
      })
      for (const item of items) {
        if (item.name.startsWith('.')) continue
        const fullPath = path.join(dir, item.name)
        if (item.isDirectory()) {
          entries.push({ name: item.name, type: 'dir', children: buildTree(fullPath) })
        } else {
          entries.push({ name: item.name, type: 'file' })
        }
      }
      return entries
    }

    const tree = buildTree(skillPath)
    return { success: true, license, tree }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('activate-skill', async (event, { slug, source, targets }) => {
  try {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')

    const skillPath = path.join(os.homedir(), '.ccgui', 'skills', source, slug)
    if (!fs.existsSync(skillPath)) {
      return { success: false, error: '技能不存在' }
    }

    const targetDirs = {
      claude: path.join(os.homedir(), '.claude', 'skills'),
      codex: path.join(os.homedir(), '.codex', 'skills')
    }

    const activated = []
    for (const target of (targets || [])) {
      const dir = targetDirs[target]
      if (!dir) continue

      fs.mkdirSync(dir, { recursive: true })
      const linkPath = path.join(dir, slug)

      try {
        const stat = fs.lstatSync(linkPath)
        if (stat.isSymbolicLink()) {
          fs.unlinkSync(linkPath)
        } else if (stat.isDirectory()) {
          // Don't overwrite user's manual install
          continue
        } else {
          fs.unlinkSync(linkPath)
        }
      } catch (_) {}

      fs.symlinkSync(skillPath, linkPath)
      activated.push(target)
    }

    return { success: true, activated }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('deactivate-skill', async (event, { slug, targets }) => {
  try {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')

    const targetDirs = {
      claude: path.join(os.homedir(), '.claude', 'skills'),
      codex: path.join(os.homedir(), '.codex', 'skills')
    }

    const deactivated = []
    for (const target of (targets || [])) {
      const dir = targetDirs[target]
      if (!dir) continue

      const linkPath = path.join(dir, slug)
      try {
        const stat = fs.lstatSync(linkPath)
        if (stat.isSymbolicLink()) {
          fs.unlinkSync(linkPath)
          deactivated.push(target)
        }
      } catch (_) {}
    }

    return { success: true, deactivated }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// ============================================
// MCP Registry IPC Handlers
// ============================================

function extractMcpSlug(name) {
  if (!name) return ''
  const parts = name.split('/')
  return parts[parts.length - 1] || name
}

// 生成 Codex TOML 格式的 MCP 配置行
function generateMcpTomlLines(config, slug) {
  const lines = [`[mcp_servers.${slug}]`]
  if (config.type) {
    lines.push(`type = ${stringifyTomlString(config.type)}`)
    if (config.url) lines.push(`url = ${stringifyTomlString(config.url)}`)
    if (config.headers && Object.keys(config.headers).length > 0) {
      for (const [hk, hv] of Object.entries(config.headers)) {
        lines.push(`header_${hk} = ${stringifyTomlString(hv)}`)
      }
    }
  } else if (config.command) {
    lines.push(`command = ${stringifyTomlString(config.command)}`)
    if (config.args?.length) {
      const argsItems = config.args.map(a => stringifyTomlString(a)).join(', ')
      lines.push(`args = [${argsItems}]`)
    }
  }
  if (config.env && Object.keys(config.env).length > 0) {
    for (const [ek, ev] of Object.entries(config.env)) {
      lines.push(`env_${ek} = ${stringifyTomlString(ev)}`)
    }
  }
  return lines
}

// 从 Codex config.toml 读取 mcp_servers slug 列表
function readCodexMcpServers() {
  const codexConfigPath = path.join(os.homedir(), '.codex', 'config.toml')
  const result = {} // { slug: { command, args, type, url, ... } }
  if (!fs.existsSync(codexConfigPath)) return result
  const rawContent = fs.readFileSync(codexConfigPath, 'utf-8')
  let currentSection = null
  let currentSlug = null
  let currentConfig = null

  for (const line of rawContent.split(/\r?\n/)) {
    const trimmed = line.trim()
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      // 保存前一个 section
      if (currentSlug && currentConfig) {
        result[currentSlug] = currentConfig
      }
      const section = sectionMatch[1]
      const mcpPrefix = 'mcp_servers.'
      if (section.startsWith(mcpPrefix)) {
        currentSection = section
        currentSlug = section.slice(mcpPrefix.length)
        currentConfig = {}
      } else {
        currentSection = null
        currentSlug = null
        currentConfig = null
      }
      continue
    }
    if (!currentSlug || !currentConfig) continue
    const entryMatch = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/)
    if (entryMatch) {
      const key = entryMatch[1]
      let value = entryMatch[2].trim()
      // 解析简单值
      if (value.startsWith('[')) {
        // TOML 数组
        try {
          currentConfig[key] = JSON.parse(value.replace(/'/g, '"'))
        } catch (_) {
          currentConfig[key] = value
        }
      } else {
        currentConfig[key] = parseTopLevelTomlValue(value)
      }
    }
  }
  // 最后一个
  if (currentSlug && currentConfig) {
    result[currentSlug] = currentConfig
  }
  return result
}

// 从 Codex config.toml 移除指定 mcp_servers section
function removeCodexMcpSection(slug) {
  const codexConfigPath = path.join(os.homedir(), '.codex', 'config.toml')
  if (!fs.existsSync(codexConfigPath)) return
  const rawContent = fs.readFileSync(codexConfigPath, 'utf-8')
  const sectionHeader = `[mcp_servers.${slug}]`
  const lines = rawContent.split(/\r?\n/)
  const output = []
  let skipping = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === sectionHeader) {
      skipping = true
      continue
    }
    if (skipping) {
      // 遇到新的 section 就停止跳过
      if (trimmed.match(/^\[([^\]]+)\]$/)) {
        skipping = false
        output.push(line)
      }
      continue
    }
    output.push(line)
  }
  const finalContent = output.join('\n').replace(/\n{3,}/g, '\n\n') + '\n'
  fs.writeFileSync(codexConfigPath, finalContent, 'utf-8')
}

// 向 Codex config.toml 追加 mcp_servers section
function addCodexMcpSection(slug, config) {
  const codexConfigPath = path.join(os.homedir(), '.codex', 'config.toml')
  const codexDir = path.dirname(codexConfigPath)
  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true })
  }
  // 先移除已有的
  removeCodexMcpSection(slug)
  // 重新读取
  let rawContent = ''
  if (fs.existsSync(codexConfigPath)) {
    rawContent = fs.readFileSync(codexConfigPath, 'utf-8')
  }
  const tomlLines = generateMcpTomlLines(config, slug)
  const content = rawContent.replace(/\n+$/, '') + '\n\n' + tomlLines.join('\n') + '\n'
  fs.writeFileSync(codexConfigPath, content.replace(/\n{3,}/g, '\n\n'), 'utf-8')
}

function generateMcpConfig(mcpData, envValues) {
  // 优先使用 remotes（直接 URL 连接）
  if (mcpData.remotes?.length) {
    const remote = mcpData.remotes[0]
    const config = { type: remote.type, url: remote.url }
    // 合并 headers 中的 auth
    if (remote.headers?.length) {
      const headers = {}
      for (const h of remote.headers) {
        if (h.isRequired && envValues?.[h.name]) {
          headers[h.name] = envValues[h.name]
        }
      }
      if (Object.keys(headers).length > 0) {
        config.headers = headers
      }
    }
    return config
  }

  // 使用 packages
  if (mcpData.packages?.length) {
    const pkg = mcpData.packages[0]
    const config = { command: '', args: [] }

    if (pkg.registryType === 'npm') {
      config.command = 'npx'
      config.args = ['-y', pkg.identifier]
      if (pkg.version) {
        config.args[1] = `${pkg.identifier}@${pkg.version}`
      }
    } else if (pkg.registryType === 'pypi') {
      config.command = 'uvx'
      config.args = [pkg.identifier]
    } else if (pkg.registryType === 'oci') {
      config.command = 'docker'
      config.args = ['run', '--rm', '-i', pkg.identifier]
    } else {
      // 通用 fallback
      config.command = pkg.registryType || 'unknown'
      config.args = [pkg.identifier]
    }

    // 环境变量
    if (pkg.environmentVariables?.length || mcpData.environmentVariables?.length) {
      const env = {}
      const vars = pkg.environmentVariables || mcpData.environmentVariables || []
      for (const ev of vars) {
        if (envValues?.[ev.name]) {
          env[ev.name] = envValues[ev.name]
        }
      }
      if (Object.keys(env).length > 0) {
        config.env = env
      }
    }

    return config
  }

  return null
}

// 下载 MCP 服务器元数据到 ~/.ccgui/mcps/<slug>.json
ipcMain.handle('download-mcp', async (event, { server }) => {
  try {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')

    const slug = extractMcpSlug(server.name)
    if (!slug) {
      return { success: false, error: 'Invalid server name' }
    }

    const mcpsDir = path.join(os.homedir(), '.ccgui', 'mcps')
    fs.mkdirSync(mcpsDir, { recursive: true })

    const mcpFile = path.join(mcpsDir, `${slug}.json`)

    // 收集环境变量
    const envVars = []
    if (server.packages?.length) {
      for (const p of server.packages) {
        if (p.environmentVariables) {
          for (const ev of p.environmentVariables) {
            if (!envVars.find(e => e.name === ev.name)) {
              envVars.push(ev)
            }
          }
        }
      }
    }
    if (server.remotes?.length) {
      for (const r of server.remotes) {
        if (r.headers) {
          for (const h of r.headers) {
            if (h.isRequired && !envVars.find(e => e.name === h.name)) {
              envVars.push({
                name: h.name,
                description: h.description,
                isSecret: h.isSecret || false,
                format: h.format || 'string'
              })
            }
          }
        }
      }
    }

    const mcpData = {
      name: server.name,
      slug,
      description: server.description || '',
      version: server.version || '',
      repository: server.repository?.url || '',
      source: 'registry',
      downloadedAt: new Date().toISOString(),
      remotes: server.remotes || [],
      packages: server.packages || [],
      environmentVariables: envVars,
      icons: server.icons || [],
      title: server.title || slug
    }

    fs.writeFileSync(mcpFile, JSON.stringify(mcpData, null, 2), 'utf-8')
    logger.info(`[MCP] Downloaded: ${slug}`)

    return { success: true, slug }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 列出已下载的 MCP 服务器
ipcMain.handle('list-downloaded-mcps', async () => {
  try {
    const mcpsDir = path.join(os.homedir(), '.ccgui', 'mcps')
    const mcps = []

    if (fs.existsSync(mcpsDir)) {
      const entries = fs.readdirSync(mcpsDir).filter(f => f.endsWith('.json'))
      for (const file of entries) {
        try {
          const content = fs.readFileSync(path.join(mcpsDir, file), 'utf-8')
          const data = JSON.parse(content)
          mcps.push(data)
        } catch (_) {}
      }
    }

    // 检查安装状态
    const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json')
    let claudeMcpServers = {}
    try {
      if (fs.existsSync(claudeSettingsPath)) {
        const content = fs.readFileSync(claudeSettingsPath, 'utf-8')
        const settings = JSON.parse(content)
        claudeMcpServers = settings.mcpServers || {}
      }
    } catch (_) {}

    // 检查 Codex 安装状态
    let codexMcpServers = {}
    try {
      codexMcpServers = readCodexMcpServers()
    } catch (_) {}

    // 标记安装状态
    const ccguiSlugs = new Set(mcps.map(m => m.slug))
    for (const mcp of mcps) {
      const installedTargets = []
      if (claudeMcpServers[mcp.slug]) {
        installedTargets.push('claude')
      }
      if (codexMcpServers[mcp.slug]) {
        installedTargets.push('codex')
      }
      mcp.installedTargets = installedTargets
    }

    // 检测外部 MCP（settings.json 中有但不在 CCGUI 管理的）
    const seenExternal = new Set()
    for (const [key, value] of Object.entries(claudeMcpServers)) {
      if (!ccguiSlugs.has(key) && !seenExternal.has(key)) {
        seenExternal.add(key)
        mcps.push({
          name: key,
          slug: key,
          description: value.type === 'streamable-http'
            ? `远程服务: ${value.url || ''}`
            : value.command
              ? `${value.command} ${(value.args || []).join(' ')}`
              : '',
          version: '',
          source: 'external',
          external: true,
          installedTargets: ['claude']
        })
      }
    }
    for (const [key, value] of Object.entries(codexMcpServers)) {
      if (!ccguiSlugs.has(key) && !seenExternal.has(key)) {
        seenExternal.add(key)
        const desc = value.type
          ? `远程服务: ${value.url || ''}`
          : value.command
            ? `${value.command} ${Array.isArray(value.args) ? value.args.join(' ') : ''}`
            : ''
        mcps.push({
          name: key,
          slug: key,
          description: desc,
          version: '',
          source: 'external',
          external: true,
          installedTargets: ['codex']
        })
      } else if (seenExternal.has(key)) {
        // 已经从 Claude 外部列表添加过了，补充 codex 目标
        const existing = mcps.find(m => m.slug === key && m.external)
        if (existing && !existing.installedTargets.includes('codex')) {
          existing.installedTargets.push('codex')
        }
      }
    }

    for (const pluginMcp of providerInspector.collectPlugins({ contents: ['mcp'] }).mcp) {
      const existing = mcps.find(mcp => mcp.slug === pluginMcp.slug && mcp.sourceLabel === pluginMcp.sourceLabel)
      if (existing) {
        existing.source = pluginMcp.source || existing.source
        existing.sourceLabel = pluginMcp.sourceLabel || existing.sourceLabel
        existing.plugin = pluginMcp.plugin === true || existing.plugin === true
        existing.pluginEnabled = pluginMcp.pluginEnabled
        existing.pluginScope = pluginMcp.pluginScope || existing.pluginScope
        existing.external = pluginMcp.external === true || existing.external === true
        for (const target of pluginMcp.installedTargets || []) {
          if (!existing.installedTargets.includes(target)) {
            existing.installedTargets.push(target)
          }
        }
        continue
      }
      mcps.push(pluginMcp)
    }

    return { success: true, mcps }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 安装 MCP 到目标（写入 settings.json）
ipcMain.handle('install-mcp', async (event, { slug, target, envValues }) => {
  try {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')

    // 读取 MCP 数据
    const mcpFile = path.join(os.homedir(), '.ccgui', 'mcps', `${slug}.json`)
    if (!fs.existsSync(mcpFile)) {
      return { success: false, error: 'MCP 配置不存在' }
    }

    const mcpData = JSON.parse(fs.readFileSync(mcpFile, 'utf-8'))
    const config = generateMcpConfig(mcpData, envValues)
    if (!config) {
      return { success: false, error: '无法生成 MCP 配置（缺少 remotes 和 packages）' }
    }

    if (target === 'claude') {
      const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json')
      let settings = {}
      if (fs.existsSync(claudeSettingsPath)) {
        settings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'))
      }
      if (!settings.mcpServers) {
        settings.mcpServers = {}
      }
      settings.mcpServers[slug] = config

      const claudeDir = path.dirname(claudeSettingsPath)
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true })
      }
      fs.writeFileSync(claudeSettingsPath, JSON.stringify(settings, null, 2), 'utf-8')
      logger.info(`[MCP] Installed ${slug} to Claude`)
    } else if (target === 'codex') {
      addCodexMcpSection(slug, config)
      logger.info(`[MCP] Installed ${slug} to Codex`)
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 卸载 MCP（从 settings.json 移除）
ipcMain.handle('uninstall-mcp', async (event, { slug, target }) => {
  try {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')

    if (target === 'claude') {
      const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json')
      if (!fs.existsSync(claudeSettingsPath)) {
        return { success: true }
      }
      const settings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'))
      if (settings.mcpServers?.[slug]) {
        delete settings.mcpServers[slug]
        fs.writeFileSync(claudeSettingsPath, JSON.stringify(settings, null, 2), 'utf-8')
        logger.info(`[MCP] Uninstalled ${slug} from Claude`)
      }
    } else if (target === 'codex') {
      removeCodexMcpSection(slug)
      logger.info(`[MCP] Uninstalled ${slug} from Codex`)
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 删除 MCP（卸载 + 删除 JSON 文件）
ipcMain.handle('delete-mcp', async (event, { slug }) => {
  try {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')

    // 先从所有 target 卸载
    const claudeSettingsPath = path.join(os.homedir(), '.claude', 'settings.json')
    try {
      if (fs.existsSync(claudeSettingsPath)) {
        const settings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'))
        if (settings.mcpServers?.[slug]) {
          delete settings.mcpServers[slug]
          fs.writeFileSync(claudeSettingsPath, JSON.stringify(settings, null, 2), 'utf-8')
        }
      }
    } catch (_) {}

    try {
      removeCodexMcpSection(slug)
    } catch (_) {}

    // 删除 JSON 文件
    const mcpFile = path.join(os.homedir(), '.ccgui', 'mcps', `${slug}.json`)
    if (fs.existsSync(mcpFile)) {
      fs.unlinkSync(mcpFile)
    }

    logger.info(`[MCP] Deleted: ${slug}`)
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// ============================================
// Project-Level Skill & MCP APIs
// ============================================

// 列出项目级已安装的 skills
ipcMain.handle('list-project-skills', async (event, { projectPath }) => {
  try {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')

    if (!projectPath) return { success: true, skills: [] }

    // 获取全局下载的 skills（用于关联）
    const globalSkillsRoot = path.join(os.homedir(), '.ccgui', 'skills')
    const globalSkillsMap = new Map() // slug -> { source, skillPath }
    if (fs.existsSync(globalSkillsRoot)) {
      for (const sourceEntry of fs.readdirSync(globalSkillsRoot, { withFileTypes: true })) {
        if (!sourceEntry.isDirectory()) continue
        const sourcePath = path.join(globalSkillsRoot, sourceEntry.name)
        for (const skillEntry of fs.readdirSync(sourcePath, { withFileTypes: true })) {
          if (!skillEntry.isDirectory()) continue
          globalSkillsMap.set(skillEntry.name, {
            source: sourceEntry.name,
            skillPath: path.join(sourcePath, skillEntry.name)
          })
        }
      }
    }
    for (const pluginSkill of providerInspector.collectPlugins({ contents: ['skills'] }).skills) {
      globalSkillsMap.set(pluginSkill.slug, {
        source: pluginSkill.source,
        sourceLabel: pluginSkill.sourceLabel,
        skillPath: pluginSkill.path,
        plugin: true,
        external: true,
        pluginEnabled: pluginSkill.pluginEnabled,
        pluginScope: pluginSkill.pluginScope || ''
      })
    }

    // 读取 SKILL.md 元数据的辅助函数
    function readSkillMeta(skillPath, fallbackName) {
      let name = fallbackName
      let description = ''
      try {
        const skillMd = path.join(skillPath, 'SKILL.md')
        if (fs.existsSync(skillMd)) {
          const content = fs.readFileSync(skillMd, 'utf-8')
          const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
          if (fmMatch) {
            const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m)
            if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, '')
            const descMatch = fmMatch[1].match(/^(?:description|summary):\s*(.+)$/m)
            if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, '')
          }
        }
      } catch (_) {}
      return { name, description }
    }

    const skills = []
    const seenSlugs = new Set()

    const projectTargets = [
      { target: 'claude', dir: path.join(projectPath, '.claude', 'skills') },
      { target: 'codex', dir: path.join(projectPath, '.codex', 'skills') }
    ]

    for (const { target, dir } of projectTargets) {
      if (!fs.existsSync(dir)) continue
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name.startsWith('.')) continue
        if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
        const entryPath = path.join(dir, entry.name)

        if (seenSlugs.has(entry.name)) {
          // 补充 target
          const existing = skills.find(s => s.slug === entry.name)
          if (existing && !existing.installedTargets.includes(target)) {
            existing.installedTargets.push(target)
          }
          continue
        }
        seenSlugs.add(entry.name)

        // 判断来源
        let realPath = entryPath
        try {
          const stat = fs.lstatSync(entryPath)
          if (stat.isSymbolicLink()) realPath = fs.realpathSync(entryPath)
        } catch (_) {}

        const globalInfo = globalSkillsMap.get(entry.name)
        const source = globalInfo ? globalInfo.source : 'local'
        const skillPath = globalInfo ? globalInfo.skillPath : realPath
        const meta = readSkillMetaFromPath(skillPath, entry.name)

        skills.push({
          name: meta.name,
          slug: entry.name,
          source,
          sourceLabel: globalInfo?.sourceLabel || '',
          path: skillPath,
          description: meta.description,
          installedTargets: [target],
          projectLevel: true,
          external: globalInfo?.external === true,
          plugin: globalInfo?.plugin === true,
          pluginEnabled: globalInfo?.pluginEnabled,
          pluginScope: globalInfo?.pluginScope || ''
        })
      }
    }

    return { success: true, skills }
  } catch (error) {
    return { success: false, skills: [], error: error.message }
  }
})

// 激活 skill 到项目级目录
ipcMain.handle('activate-skill-to-project', async (event, { slug, source, targets, projectPath }) => {
  try {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')

    if (!projectPath) return { success: false, error: '未指定项目路径' }

    const skillPath = path.join(os.homedir(), '.ccgui', 'skills', source, slug)
    if (!fs.existsSync(skillPath)) {
      return { success: false, error: '技能不存在，请先从"已下载"中确认该技能已下载' }
    }

    const targetDirs = {
      claude: path.join(projectPath, '.claude', 'skills'),
      codex: path.join(projectPath, '.codex', 'skills')
    }

    const activated = []
    for (const target of (targets || [])) {
      const dir = targetDirs[target]
      if (!dir) continue

      fs.mkdirSync(dir, { recursive: true })
      const linkPath = path.join(dir, slug)

      try {
        const stat = fs.lstatSync(linkPath)
        if (stat.isSymbolicLink()) {
          fs.unlinkSync(linkPath)
        } else if (stat.isDirectory()) {
          continue // 不覆盖用户手动安装的
        } else {
          fs.unlinkSync(linkPath)
        }
      } catch (_) {}

      fs.symlinkSync(skillPath, linkPath)
      activated.push(target)
    }

    logger.info(`[Skill] Activated ${slug} to project: ${activated.join(', ')}`)
    return { success: true, activated }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 从项目级目录停用 skill
ipcMain.handle('deactivate-skill-from-project', async (event, { slug, targets, projectPath }) => {
  try {
    const fs = require('fs')
    const path = require('path')

    if (!projectPath) return { success: false, error: '未指定项目路径' }

    const targetDirs = {
      claude: path.join(projectPath, '.claude', 'skills'),
      codex: path.join(projectPath, '.codex', 'skills')
    }

    const deactivated = []
    for (const target of (targets || [])) {
      const dir = targetDirs[target]
      if (!dir) continue
      const linkPath = path.join(dir, slug)
      try {
        const stat = fs.lstatSync(linkPath)
        if (stat.isSymbolicLink()) {
          fs.unlinkSync(linkPath)
          deactivated.push(target)
        } else if (stat.isDirectory()) {
          // 非符号链接的目录，不删除（用户手动安装的）
        }
      } catch (_) {}
    }

    logger.info(`[Skill] Deactivated ${slug} from project: ${deactivated.join(', ')}`)
    return { success: true, deactivated }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 安装 skill 到项目级目录（从本地路径或 URL）
ipcMain.handle('install-skill-to-project', async (event, { source, projectPath }) => {
  try {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')
    const https = require('https')
    const http = require('http')

    if (!projectPath) return { success: false, error: '未指定项目路径' }

    // 安装到项目的 .claude/skills/ 目录
    const projectSkillsDir = path.join(projectPath, '.claude', 'skills')
    fs.mkdirSync(projectSkillsDir, { recursive: true })

    if (/^https?:\/\//i.test(source)) {
      const urlBasename = path.basename(new URL(source).pathname) || 'download.zip'
      const tmpFile = path.join(os.tmpdir(), `ccgui-skill-url-${Date.now()}-${urlBasename}`)

      await new Promise((resolve, reject) => {
        const parsedUrl = new URL(source)
        const protocol = parsedUrl.protocol === 'https:' ? https : http
        const doRequest = (reqUrl) => {
          const req = protocol.get(reqUrl, {
            headers: { 'User-Agent': 'CCGUI/1.0' }
          }, (res) => {
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              doRequest(res.headers.location)
              return
            }
            if (res.statusCode >= 400) {
              let errData = ''
              res.on('data', chunk => { errData += chunk })
              res.on('end', () => reject(new Error(`HTTP ${res.statusCode}: ${errData.slice(0, 200)}`)))
              return
            }
            const file = fs.createWriteStream(tmpFile)
            res.pipe(file)
            file.on('finish', () => { file.close(); resolve() })
            file.on('error', reject)
          })
          req.on('error', reject)
          req.setTimeout(120000, () => { req.destroy(); reject(new Error('下载超时')) })
        }
        doRequest(source)
      })

      const result = extractArchiveTo(tmpFile, projectSkillsDir)
      try { fs.unlinkSync(tmpFile) } catch (_) {}
      return result
    }

    // 本地路径
    const resolvedPath = path.resolve(source)
    if (!fs.existsSync(resolvedPath)) {
      return { success: false, error: '路径不存在' }
    }

    const stat = fs.statSync(resolvedPath)
    if (stat.isDirectory()) {
      if (!fs.existsSync(path.join(resolvedPath, 'SKILL.md'))) {
        return { success: false, error: '目录中未找到 SKILL.md 文件，不是合法的技能包' }
      }
      let skillName = path.basename(resolvedPath)
      try {
        const content = fs.readFileSync(path.join(resolvedPath, 'SKILL.md'), 'utf-8')
        const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
        if (fmMatch) {
          const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m)
          if (nameMatch) skillName = nameMatch[1].trim()
        }
      } catch (_) {}
      const destDir = path.join(projectSkillsDir, skillName)
      if (fs.existsSync(destDir)) {
        fs.rmSync(destDir, { recursive: true, force: true })
      }
      fs.cpSync(resolvedPath, destDir, { recursive: true })
      return { success: true, name: skillName, path: destDir }
    }

    return extractArchiveTo(resolvedPath, projectSkillsDir)
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 删除项目级 skill
ipcMain.handle('delete-project-skill', async (event, { name, projectPath }) => {
  try {
    const fs = require('fs')
    const path = require('path')

    if (!projectPath) return { success: false, error: '未指定项目路径' }

    const projectTargets = [
      path.join(projectPath, '.claude', 'skills', name),
      path.join(projectPath, '.codex', 'skills', name)
    ]

    for (const skillPath of projectTargets) {
      if (!fs.existsSync(skillPath)) continue
      const stat = fs.lstatSync(skillPath)
      if (stat.isSymbolicLink()) {
        fs.unlinkSync(skillPath)
      } else if (stat.isDirectory()) {
        fs.rmSync(skillPath, { recursive: true, force: true })
      }
    }

    logger.info(`[Skill] Deleted from project: ${name}`)
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 列出项目级已安装的 MCP 服务
ipcMain.handle('list-project-mcps', async (event, { projectPath }) => {
  try {
    const fs = require('fs')
    const path = require('path')

    if (!projectPath) return { success: true, mcps: [] }

    // 获取全局下载的 MCP（用于关联）
    const globalMcpsDir = path.join(os.homedir(), '.ccgui', 'mcps')
    const globalMcpsMap = new Map() // slug -> data
    if (fs.existsSync(globalMcpsDir)) {
      for (const file of fs.readdirSync(globalMcpsDir).filter(f => f.endsWith('.json'))) {
        try {
          const data = JSON.parse(fs.readFileSync(path.join(globalMcpsDir, file), 'utf-8'))
          globalMcpsMap.set(data.slug, data)
        } catch (_) {}
      }
    }
    for (const pluginMcp of providerInspector.collectPlugins({ contents: ['mcp'] }).mcp) {
      globalMcpsMap.set(pluginMcp.slug, pluginMcp)
    }

    const mcps = []
    const seenSlugs = new Set()

    // 读取 Claude 项目级 settings.json
    const claudeSettingsPath = path.join(projectPath, '.claude', 'settings.json')
    if (fs.existsSync(claudeSettingsPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'))
        for (const [key, value] of Object.entries(settings.mcpServers || {})) {
          seenSlugs.add(key)
          const globalData = globalMcpsMap.get(key)
          mcps.push({
            name: globalData?.name || key,
            slug: key,
            title: globalData?.title || globalData?.name || key,
            description: globalData?.description || (value.type === 'streamable-http' ? `远程服务: ${value.url || ''}` : value.command ? `${value.command} ${(value.args || []).join(' ')}` : ''),
            version: globalData?.version || '',
            source: globalData?.source || (globalData ? 'registry' : 'project-local'),
            sourceLabel: globalData?.sourceLabel || '',
            installedTargets: ['claude'],
            projectLevel: true,
            external: globalData?.external === true,
            plugin: globalData?.plugin === true,
            pluginEnabled: globalData?.pluginEnabled,
            pluginScope: globalData?.pluginScope || ''
          })
        }
      } catch (_) {}
    }

    // 读取 Codex 项目级 config.toml
    const codexConfigPath = path.join(projectPath, '.codex', 'config.toml')
    if (fs.existsSync(codexConfigPath)) {
      try {
        const projectCodexMcps = readTomlMcpServers(codexConfigPath)
        for (const [key, value] of Object.entries(projectCodexMcps)) {
          if (seenSlugs.has(key)) {
            const existing = mcps.find(m => m.slug === key)
            if (existing) existing.installedTargets.push('codex')
            continue
          }
          seenSlugs.add(key)
          const globalData = globalMcpsMap.get(key)
          mcps.push({
            name: globalData?.name || key,
            slug: key,
            title: globalData?.title || globalData?.name || key,
            description: globalData?.description || (value.type ? `远程服务: ${value.url || ''}` : value.command ? `${value.command} ${Array.isArray(value.args) ? value.args.join(' ') : ''}` : ''),
            version: globalData?.version || '',
            source: globalData?.source || (globalData ? 'registry' : 'project-local'),
            sourceLabel: globalData?.sourceLabel || '',
            installedTargets: ['codex'],
            projectLevel: true,
            external: globalData?.external === true,
            plugin: globalData?.plugin === true,
            pluginEnabled: globalData?.pluginEnabled,
            pluginScope: globalData?.pluginScope || ''
          })
        }
      } catch (_) {}
    }

    return { success: true, mcps }
  } catch (error) {
    return { success: false, mcps: [], error: error.message }
  }
})

// 从指定 toml 文件读取 mcp_servers sections（复用全局逻辑但支持自定义路径）
function readTomlMcpServers(tomlPath) {
  const fs = require('fs')
  const result = {}
  if (!fs.existsSync(tomlPath)) return result
  const rawContent = fs.readFileSync(tomlPath, 'utf-8')
  let currentSlug = null
  let currentConfig = null

  for (const line of rawContent.split(/\r?\n/)) {
    const trimmed = line.trim()
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      if (currentSlug && currentConfig) result[currentSlug] = currentConfig
      const section = sectionMatch[1]
      const mcpPrefix = 'mcp_servers.'
      if (section.startsWith(mcpPrefix)) {
        currentSlug = section.slice(mcpPrefix.length)
        currentConfig = {}
      } else {
        currentSlug = null
        currentConfig = null
      }
      continue
    }
    if (!currentSlug || !currentConfig) continue
    const entryMatch = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/)
    if (entryMatch) {
      const key = entryMatch[1]
      let value = entryMatch[2].trim()
      if (value.startsWith('[')) {
        try { currentConfig[key] = JSON.parse(value.replace(/'/g, '"')) } catch (_) { currentConfig[key] = value }
      } else {
        currentConfig[key] = parseTopLevelTomlValue(value)
      }
    }
  }
  if (currentSlug && currentConfig) result[currentSlug] = currentConfig
  return result
}

// 安装 MCP 到项目级配置
ipcMain.handle('install-mcp-to-project', async (event, { slug, target, envValues, projectPath }) => {
  try {
    const fs = require('fs')
    const path = require('path')
    const os = require('os')

    if (!projectPath) return { success: false, error: '未指定项目路径' }

    // 读取 MCP 数据
    const mcpFile = path.join(os.homedir(), '.ccgui', 'mcps', `${slug}.json`)
    if (!fs.existsSync(mcpFile)) {
      return { success: false, error: 'MCP 配置不存在，请先从"已下载"中确认该 MCP 已下载' }
    }

    const mcpData = JSON.parse(fs.readFileSync(mcpFile, 'utf-8'))
    const config = generateMcpConfig(mcpData, envValues)
    if (!config) {
      return { success: false, error: '无法生成 MCP 配置' }
    }

    if (target === 'claude') {
      const claudeDir = path.join(projectPath, '.claude')
      const claudeSettingsPath = path.join(claudeDir, 'settings.json')
      fs.mkdirSync(claudeDir, { recursive: true })

      let settings = {}
      if (fs.existsSync(claudeSettingsPath)) {
        settings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'))
      }
      if (!settings.mcpServers) settings.mcpServers = {}
      settings.mcpServers[slug] = config
      fs.writeFileSync(claudeSettingsPath, JSON.stringify(settings, null, 2), 'utf-8')
      logger.info(`[MCP] Installed ${slug} to project Claude settings`)
    } else if (target === 'codex') {
      const codexDir = path.join(projectPath, '.codex')
      const codexConfigPath = path.join(codexDir, 'config.toml')
      fs.mkdirSync(codexDir, { recursive: true })

      // 先移除已有的 section
      removeTomlMcpSection(codexConfigPath, slug)

      let rawContent = ''
      if (fs.existsSync(codexConfigPath)) {
        rawContent = fs.readFileSync(codexConfigPath, 'utf-8')
      }
      const tomlLines = generateMcpTomlLines(config, slug)
      const content = rawContent.replace(/\n+$/, '') + '\n\n' + tomlLines.join('\n') + '\n'
      fs.writeFileSync(codexConfigPath, content.replace(/\n{3,}/g, '\n\n'), 'utf-8')
      logger.info(`[MCP] Installed ${slug} to project Codex config`)
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 从项目级配置卸载 MCP
ipcMain.handle('uninstall-mcp-from-project', async (event, { slug, target, projectPath }) => {
  try {
    const fs = require('fs')
    const path = require('path')

    if (!projectPath) return { success: false, error: '未指定项目路径' }

    if (target === 'claude') {
      const claudeSettingsPath = path.join(projectPath, '.claude', 'settings.json')
      if (fs.existsSync(claudeSettingsPath)) {
        const settings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'))
        if (settings.mcpServers?.[slug]) {
          delete settings.mcpServers[slug]
          fs.writeFileSync(claudeSettingsPath, JSON.stringify(settings, null, 2), 'utf-8')
          logger.info(`[MCP] Uninstalled ${slug} from project Claude settings`)
        }
      }
    } else if (target === 'codex') {
      const codexConfigPath = path.join(projectPath, '.codex', 'config.toml')
      removeTomlMcpSection(codexConfigPath, slug)
      logger.info(`[MCP] Uninstalled ${slug} from project Codex config`)
    }

    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

// 从指定 toml 文件移除 mcp_servers section
function removeTomlMcpSection(tomlPath, slug) {
  const fs = require('fs')
  if (!fs.existsSync(tomlPath)) return
  const rawContent = fs.readFileSync(tomlPath, 'utf-8')
  const sectionHeader = `[mcp_servers.${slug}]`
  const lines = rawContent.split(/\r?\n/)
  const output = []
  let skipping = false

  for (const line of lines) {
    const trimmed = line.trim()
    if (trimmed === sectionHeader) {
      skipping = true
      continue
    }
    if (skipping) {
      if (trimmed.match(/^\[([^\]]+)\]$/)) {
        skipping = false
        output.push(line)
      }
      continue
    }
    output.push(line)
  }
  const finalContent = output.join('\n').replace(/\n{3,}/g, '\n\n') + '\n'
  fs.writeFileSync(tomlPath, finalContent, 'utf-8')
}

// 删除项目级 MCP
ipcMain.handle('delete-project-mcp', async (event, { slug, projectPath }) => {
  try {
    if (!projectPath) return { success: false, error: '未指定项目路径' }

    // 从两个目标中都移除
    const fs = require('fs')
    const path = require('path')

    // Claude
    const claudeSettingsPath = path.join(projectPath, '.claude', 'settings.json')
    if (fs.existsSync(claudeSettingsPath)) {
      try {
        const settings = JSON.parse(fs.readFileSync(claudeSettingsPath, 'utf-8'))
        if (settings.mcpServers?.[slug]) {
          delete settings.mcpServers[slug]
          fs.writeFileSync(claudeSettingsPath, JSON.stringify(settings, null, 2), 'utf-8')
        }
      } catch (_) {}
    }

    // Codex
    const codexConfigPath = path.join(projectPath, '.codex', 'config.toml')
    removeTomlMcpSection(codexConfigPath, slug)

    logger.info(`[MCP] Deleted from project: ${slug}`)
    return { success: true }
  } catch (error) {
    return { success: false, error: error.message }
  }
})

ipcMain.handle('show-message-box', async (event, options = {}) => {
  try {
    const targetWindow = BrowserWindow.fromWebContents(event.sender) || mainWindow || null
    const {
      type = 'info',
      title = '提示',
      message = '',
      detail = '',
      buttons = ['确定'],
      defaultId = 0,
      cancelId = 0,
      noLink = true
    } = options || {}

    return await dialog.showMessageBox(targetWindow, {
      type,
      title,
      message: String(message || ''),
      detail: String(detail || ''),
      buttons: Array.isArray(buttons) && buttons.length > 0 ? buttons : ['确定'],
      defaultId,
      cancelId,
      noLink
    })
  } catch (error) {
    logger.error('[Dialog] Failed to show message box', {
      error: error.message
    })
    return {
      response: 0,
      checkboxChecked: false,
      error: error.message
    }
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
  try {
    const messages = projectService.getSessionMessages(projectId, sessionId)
    logger.info('[Sessions] Loaded unified session history', {
      projectId,
      sessionId,
      messageCount: messages.length
    })
    return messages
  } catch (error) {
    logger.error('[Sessions] Failed to load unified session history', {
      projectId,
      sessionId,
      error: error.message
    })
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
 * Open project window (new or existing)
 * @param {string} projectId - Encoded project ID (for URL parameter)
 * @param {string} projectName - Project name (for window title)
 * @param {string} projectPath - Original project path (for window lookup)
 */
function openProjectWindow(projectId, projectName, projectPath) {
  // Check if project is already open in another window
  const existingWindow = BrowserWindow.getAllWindows().find(win => win.projectId === projectId)
  if (existingWindow) {
    // Focus the existing window instead of creating a new one
    if (existingWindow.isMinimized()) {
      existingWindow.restore()
    }
    existingWindow.focus()
    logger.info('[Window] Project already open, focused existing window', { projectId, windowId: existingWindow.id })
    return existingWindow
  }

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
    const url = `http://127.0.0.1:5173/?projectId=${encodeURIComponent(projectId)}`
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
    newWindow.loadURL('http://127.0.0.1:5173')
  } else {
    const indexPath = path.join(__dirname, '../dist/index.html')
    newWindow.loadURL(`file://${indexPath}`)
  }

  newWindow.on('closed', () => {
    disposeTerminalsForWebContents(newWindowWebContentsId)
    stopProjectFileWatcher(newWindowWebContentsId)
    logger.info('[Window] Closed new window')
  })

  return newWindow
}

// App lifecycle

app.whenReady().then(() => {
  // 清理上次异常退出残留的 provider 进程（开发模式下跳过）
  if (!isDevRuntime) {
    processRegistry.cleanupStaleInstances()
  }

  appStartupStartedAt = Date.now()
  // Update isDev flag now that app is ready
  isDev = process.env.NODE_ENV === 'development' || !app.isPackaged
  logger.info('[App] Development mode:', isDev)
  logger.info('[App] userData path', { userData: app.getPath('userData') })
  logger.info('[Startup] whenReady', { sinceAppStartMs: 0 })
  registerAssetProtocol()

  createWindow()
  setupDockMenu()
  flushPendingDockProjectOpens()

  Promise.resolve().then(() => {
    appService.syncCodexAccountsWithAuthConfig()
    appService.startCodexAccountUsagePolling()
  }).catch(error => {
    logger.warn('[CodexSettings] Failed to sync codex accounts on startup', { error: error.message })
  })

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
