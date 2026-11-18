// Run with Electron's Node runtime because node-pty is built against Electron's ABI:
// ELECTRON_RUN_AS_NODE=1 <electron-binary> tests/terminal-host-shutdown.test.cjs
const assert = require('assert')
const { fork } = require('child_process')
const path = require('path')
const processRegistry = require('../electron/services/process-registry')

const terminalHostPath = path.resolve(__dirname, '..', 'electron', 'terminal-host.cjs')
let requestSequence = 0

function waitForChildExit(child, timeoutMs = 5000) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true)
  }

  return new Promise(resolve => {
    const timer = setTimeout(() => {
      child.removeListener('exit', onExit)
      resolve(false)
    }, timeoutMs)
    const onExit = () => {
      clearTimeout(timer)
      resolve(true)
    }
    child.once('exit', onExit)
  })
}

function waitForMessage(child, requestId, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.removeListener('message', onMessage)
      reject(new Error(`terminal host request timed out: ${requestId}`))
    }, timeoutMs)
    const onMessage = message => {
      if (message?.type !== 'response' || message.requestId !== requestId) {
        return
      }
      clearTimeout(timer)
      child.removeListener('message', onMessage)
      resolve(message)
    }
    child.once('error', error => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('message', onMessage)
  })
}

function sendRequest(child, type, payload = {}) {
  const requestId = `terminal-host-test-${++requestSequence}`
  const response = waitForMessage(child, requestId)
  child.send({ type, requestId, payload })
  return response
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitForDescendant(pid, matcher, timeoutMs = 3000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const match = processRegistry.collectProcessTree(pid)
      .find(entry => matcher(entry.command))
    if (match) {
      return match
    }
    await delay(100)
  }
  return null
}

async function waitForExit(pid, timeoutMs = 3000) {
  return (await processRegistry.waitForProcessesExit([pid], timeoutMs)).length === 0
}

async function run() {
  const child = fork(terminalHostPath, [], {
    stdio: ['ignore', 'ignore', 'inherit', 'ipc']
  })
  let terminalPid = null
  let sleepPid = null

  try {
    const createResponse = await sendRequest(child, 'create-terminal', {
      cwd: '/tmp',
      cols: 80,
      rows: 24
    })
    assert.strictEqual(createResponse.success, true)
    terminalPid = createResponse.terminal.pid
    assert.strictEqual(Number.isInteger(terminalPid), true)

    await sendRequest(child, 'write-terminal', {
      terminalId: createResponse.terminal.id,
      data: 'sleep 30\n'
    })

    const sleepProcess = await waitForDescendant(terminalPid, command => /(^|\/)sleep$/.test(command))
    assert.ok(sleepProcess, 'sleep process should be running inside the PTY')
    sleepPid = sleepProcess.pid

    child.send({ type: 'shutdown', requestId: 'terminal-host-test-shutdown' })
    assert.strictEqual(await waitForChildExit(child), true)
    assert.strictEqual(await waitForExit(terminalPid), true)
    assert.strictEqual(await waitForExit(sleepPid), true)
    console.log('terminal-host shutdown tests passed')
  } finally {
    if (sleepPid) {
      try { process.kill(sleepPid, 'SIGKILL') } catch {}
    }
    if (terminalPid) {
      try { process.kill(-terminalPid, 'SIGKILL') } catch {}
      try { process.kill(terminalPid, 'SIGKILL') } catch {}
    }
    child.kill('SIGKILL')
  }
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
