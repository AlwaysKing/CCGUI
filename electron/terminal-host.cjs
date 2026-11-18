const fs = require('fs')
const os = require('os')
const path = require('path')

let nodePty = null
let terminalSequence = 0
const terminalSessions = new Map()
let shutdownPromise = null

function dedupePaths(paths = []) {
  return [...new Set(paths.filter(Boolean))]
}

function isWritableRealPath(targetPath) {
  if (!targetPath) {
    return false
  }

  if (targetPath.includes('.asar.unpacked')) {
    return true
  }

  if (targetPath.includes('.asar')) {
    return false
  }

  return true
}

function getNodePtyModuleRoots() {
  const roots = []

  try {
    const packageJsonPath = require.resolve('node-pty/package.json')
    const packageRoot = path.dirname(packageJsonPath)
    roots.push(packageRoot)

    if (packageRoot.includes('.asar')) {
      roots.push(packageRoot.replace('.asar', '.asar.unpacked'))
    }
  } catch (error) {
    // Fall back to conventional locations when resolution fails.
  }

  roots.push(path.join(__dirname, '..', 'node_modules', 'node-pty'))

  if (process.resourcesPath) {
    roots.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'node-pty'))
    roots.push(path.join(process.resourcesPath, 'app.asar', 'node_modules', 'node-pty'))
  }

  return dedupePaths(roots)
}

function getNodePty() {
  if (!nodePty) {
    nodePty = require('node-pty')
  }

  return nodePty
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

function ensureNodePtySpawnHelperExecutable() {
  if (process.platform === 'win32') {
    return
  }

  const helperPaths = dedupePaths(
    getNodePtyModuleRoots().flatMap(root => ([
      path.join(root, 'prebuilds', `${process.platform}-${process.arch}`, 'spawn-helper'),
      path.join(root, 'build', 'Release', 'spawn-helper'),
      path.join(root, 'build', 'Debug', 'spawn-helper')
    ]))
  )

  for (const helperPath of helperPaths) {
    if (!fs.existsSync(helperPath)) {
      continue
    }
    if (!isWritableRealPath(helperPath)) {
      continue
    }

    const stat = fs.statSync(helperPath)
    if ((stat.mode & 0o111) === 0) {
      fs.chmodSync(helperPath, 0o755)
    }
  }
}

function sendMessage(message) {
  if (typeof process.send === 'function') {
    process.send(message)
  }
}

function sendResponse(requestId, success, payload = {}) {
  sendMessage({
    type: 'response',
    requestId,
    success,
    ...payload
  })
}

function signalTerminalProcess(terminalId, signal) {
  const terminalSession = terminalSessions.get(terminalId)
  if (!terminalSession) return

  const pid = terminalSession.process.pid
  try {
    process.kill(-pid, signal)
  } catch (error) {
    try {
      process.kill(pid, signal)
    } catch (_) {
      // The process or its process group is already gone.
    }
  }
}

function disposeTerminal(terminalId) {
  if (!terminalSessions.has(terminalId)) return

  signalTerminalProcess(terminalId, 'SIGTERM')
  terminalSessions.delete(terminalId)
}

function handleForceKillTerminal(requestId, payload = {}) {
  if (!terminalSessions.has(payload.terminalId)) {
    sendResponse(requestId, false, { error: '终端不存在' })
    return
  }

  signalTerminalProcess(payload.terminalId, 'SIGKILL')
  terminalSessions.delete(payload.terminalId)
  sendResponse(requestId, true)
}

async function handleCreateTerminal(requestId, payload = {}) {
  ensureNodePtySpawnHelperExecutable()
  const pty = getNodePty()

  const shellPath = getDefaultTerminalShell()
  if (path.isAbsolute(shellPath) && !fs.existsSync(shellPath)) {
    throw new Error(`终端 Shell 不存在: ${shellPath}`)
  }

  const terminalId = `terminal-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
  const resolvedCwd = payload.cwd && fs.existsSync(payload.cwd) ? payload.cwd : os.homedir()

  // 过滤掉 Electron 特定的环境变量，避免影响子进程中的 require('electron')
  const electronEnvKeys = [
    'ELECTRON_RUN_AS_NODE',
    'ATOM_SHELL_INTERNAL_RUN_AS_NODE',
    'ELECTRON_NO_ATTACH_CONSOLE',
    'GOOGLE_API_KEY'
  ]
  const cleanEnv = { ...process.env }
  for (const key of electronEnvKeys) {
    delete cleanEnv[key]
  }

  const env = {
    ...cleanEnv,
    ...(payload.env && typeof payload.env === 'object' ? payload.env : {}),
    TERM: process.env.TERM || 'xterm-256color',
    COLORTERM: 'truecolor'
  }

  const shellArgs = getTerminalShellArgs(shellPath)
  const terminalProcess = pty.spawn(shellPath, shellArgs, {
    name: 'xterm-256color',
    cols: Math.max(40, Number(payload.cols) || 120),
    rows: Math.max(12, Number(payload.rows) || 30),
    cwd: resolvedCwd,
    env
  })

  terminalSessions.set(terminalId, {
    id: terminalId,
    process: terminalProcess
  })

  terminalProcess.onData(data => {
    sendMessage({
      type: 'terminal-data',
      terminalId,
      data
    })
  })

  terminalProcess.onExit(({ exitCode, signal }) => {
    terminalSessions.delete(terminalId)
    sendMessage({
      type: 'terminal-exit',
      terminalId,
      exitCode,
      signal
    })
  })

  sendResponse(requestId, true, {
    terminal: {
      id: terminalId,
      name: buildTerminalName(shellPath),
      cwd: resolvedCwd,
      shell: shellPath,
      pid: terminalProcess.pid
    }
  })
}

function handleWriteTerminal(requestId, payload = {}) {
  const terminalSession = terminalSessions.get(payload.terminalId)
  if (!terminalSession) {
    throw new Error('终端不存在')
  }

  terminalSession.process.write(String(payload.data || ''))
  sendResponse(requestId, true)
}

function handleResizeTerminal(requestId, payload = {}) {
  const terminalSession = terminalSessions.get(payload.terminalId)
  if (!terminalSession) {
    throw new Error('终端不存在')
  }

  terminalSession.process.resize(
    Math.max(20, Number(payload.cols) || 120),
    Math.max(8, Number(payload.rows) || 30)
  )
  sendResponse(requestId, true)
}

function handleCloseTerminal(requestId, payload = {}) {
  if (!terminalSessions.has(payload.terminalId)) {
    throw new Error('终端不存在')
  }

  disposeTerminal(payload.terminalId)
  sendResponse(requestId, true)
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function terminateAllTerminals() {
  const terminalIds = [...terminalSessions.keys()]
  for (const terminalId of terminalIds) {
    signalTerminalProcess(terminalId, 'SIGTERM')
  }

  if (terminalIds.length > 0) {
    await wait(250)
  }

  for (const terminalId of terminalIds) {
    signalTerminalProcess(terminalId, 'SIGKILL')
  }
  terminalSessions.clear()
}

async function shutdownTerminalHost(exitCode = 0) {
  if (shutdownPromise) {
    return shutdownPromise
  }

  shutdownPromise = (async () => {
    await terminateAllTerminals()
    process.exit(exitCode)
  })()
  return shutdownPromise
}

async function handleShutdown(requestId) {
  try {
    await terminateAllTerminals()
    sendResponse(requestId, true)
  } finally {
    process.exit(0)
  }
}

process.on('message', async message => {
  const { type, requestId, payload } = message || {}

  try {
    switch (type) {
      case 'create-terminal':
        await handleCreateTerminal(requestId, payload)
        break
      case 'write-terminal':
        handleWriteTerminal(requestId, payload)
        break
      case 'resize-terminal':
        handleResizeTerminal(requestId, payload)
        break
      case 'close-terminal':
        handleCloseTerminal(requestId, payload)
        break
      case 'force-kill-terminal':
        handleForceKillTerminal(requestId, payload)
        break
      case 'shutdown':
        await handleShutdown(requestId)
        break
      default:
        throw new Error(`未知终端消息类型: ${type}`)
    }
  } catch (error) {
    sendResponse(requestId, false, {
      error: error.message || '终端操作失败'
    })
  }
})

process.on('disconnect', () => {
  void shutdownTerminalHost(0)
})

for (const [signal, exitCode] of [['SIGTERM', 143], ['SIGINT', 130], ['SIGHUP', 129]]) {
  process.on(signal, () => {
    void shutdownTerminalHost(exitCode)
  })
}
