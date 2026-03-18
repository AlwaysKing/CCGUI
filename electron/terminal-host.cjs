const fs = require('fs')
const os = require('os')
const path = require('path')

let nodePty = null
let terminalSequence = 0
const terminalSessions = new Map()

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

  const helperPaths = [
    path.join(
      __dirname,
      '..',
      'node_modules',
      'node-pty',
      'prebuilds',
      `${process.platform}-${process.arch}`,
      'spawn-helper'
    ),
    path.join(
      __dirname,
      '..',
      'node_modules',
      'node-pty',
      'build',
      'Release',
      'spawn-helper'
    ),
    path.join(
      __dirname,
      '..',
      'node_modules',
      'node-pty',
      'build',
      'Debug',
      'spawn-helper'
    )
  ]

  for (const helperPath of helperPaths) {
    if (!fs.existsSync(helperPath)) {
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

function disposeTerminal(terminalId) {
  const terminalSession = terminalSessions.get(terminalId)
  if (!terminalSession) return

  try {
    terminalSession.process.kill()
  } catch (error) {
    // Ignore already-closed terminal processes.
  }

  terminalSessions.delete(terminalId)
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
  const env = {
    ...process.env,
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

function handleShutdown(requestId) {
  for (const terminalId of [...terminalSessions.keys()]) {
    disposeTerminal(terminalId)
  }

  sendResponse(requestId, true)
  process.exit(0)
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
      case 'shutdown':
        handleShutdown(requestId)
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
  for (const terminalId of [...terminalSessions.keys()]) {
    disposeTerminal(terminalId)
  }
  process.exit(0)
})
