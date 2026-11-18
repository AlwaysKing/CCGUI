#!/usr/bin/env node

const net = require('net')

const socketPath = String(process.env.CCGUI_AGENT_SOCKET || '').trim()
const sessionId = String(process.env.CCGUI_SESSION_ID || '').trim()
const bridgeToken = String(process.env.CCGUI_BRIDGE_TOKEN || '').trim()

let socket = null
let socketBuffer = ''
let stdinBuffer = ''
let registered = false
let pendingInput = []
let shuttingDown = false

function fail(message) {
  if (shuttingDown) return
  shuttingDown = true
  process.stderr.write(`[ccgui-internal-mcp] ${message}\n`)
  try {
    socket?.destroy()
  } catch {}
  process.exitCode = 1
  setImmediate(() => process.exit(1))
}

function writeSocketLine(payload) {
  if (!socket || socket.destroyed) {
    pendingInput.push(payload)
    return
  }
  socket.write(`${JSON.stringify(payload)}\n`)
}

function writeStdoutLine(rawLine) {
  if (!rawLine) return
  process.stdout.write(rawLine.endsWith('\n') ? rawLine : `${rawLine}\n`)
}

function flushPendingInput() {
  if (!registered || !socket || socket.destroyed) return
  for (const line of pendingInput) {
    socket.write(`${line}\n`)
  }
  pendingInput = []
}

function handleSocketLine(line) {
  const trimmed = String(line || '').trim()
  if (!trimmed) return

  if (!registered) {
    let payload = null
    try {
      payload = JSON.parse(trimmed)
    } catch {
      fail('invalid registration response')
      return
    }

    if (payload?.type !== 'ccgui_register_ack' || payload?.ok !== true) {
      fail(payload?.error || 'registration rejected')
      return
    }

    registered = true
    flushPendingInput()
    return
  }

  writeStdoutLine(trimmed)
}

function consumeSocketChunk(chunk) {
  socketBuffer += chunk
  const lines = socketBuffer.split('\n')
  socketBuffer = lines.pop()
  for (const line of lines) {
    handleSocketLine(line)
  }
}

function handleStdinLine(line) {
  const trimmed = String(line || '').trim()
  if (!trimmed) return

  if (!registered) {
    pendingInput.push(trimmed)
    return
  }

  let payload = null
  try {
    payload = JSON.parse(trimmed)
  } catch {
    fail('invalid MCP input')
    return
  }
  writeSocketLine(payload)
}

function consumeStdinChunk(chunk) {
  stdinBuffer += chunk
  const lines = stdinBuffer.split('\n')
  stdinBuffer = lines.pop()
  for (const line of lines) {
    handleStdinLine(line)
  }
}

function shutdown(exitCode = 0) {
  if (shuttingDown) return
  shuttingDown = true
  process.exitCode = exitCode
  try {
    socket?.end()
  } catch {}
  setImmediate(() => process.exit(exitCode))
}

if (!socketPath || !sessionId || !bridgeToken) {
  fail('missing CCGUI_AGENT_SOCKET, CCGUI_SESSION_ID or CCGUI_BRIDGE_TOKEN')
} else {
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', consumeStdinChunk)
  process.stdin.on('end', () => shutdown(0))
  process.stdin.on('error', error => fail(`stdin error: ${error.message}`))

  socket = net.createConnection({ path: socketPath })
  socket.setEncoding('utf8')
  socket.setNoDelay(true)
  socket.on('connect', () => {
    socket.write(`${JSON.stringify({
      type: 'ccgui_register',
      session_id: sessionId,
      bridge_token: bridgeToken
    })}\n`)
  })
  socket.on('data', consumeSocketChunk)
  socket.on('error', error => fail(`socket error: ${error.message}`))
  socket.on('close', () => shutdown(process.exitCode || 0))
}
