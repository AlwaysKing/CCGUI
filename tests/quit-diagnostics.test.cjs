const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const diagnosticsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-quit-diagnostics-'))
const diagnostics = require('../electron/services/quit-diagnostics')
const secretArgument = 'ccgui-diagnostics-secret-should-not-be-logged'

function runNodeScript(source) {
  return spawnSync(process.execPath, ['-e', source], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CCGUI_PROFILE: 'debug',
      CCGUI_QUIT_DIAGNOSTICS_DIR: diagnosticsDir
    },
    encoding: 'utf8'
  })
}

try {
  const captureResult = runNodeScript(`
    const diagnostics = require('./electron/services/quit-diagnostics')
    const snapshot = diagnostics.captureShutdownSnapshot({
      appPid: process.pid,
      proxyStatus: { status: 'running', port: 18921 },
      terminalHostPid: null,
      sessions: [{
        id: 'session-diagnostics-test',
        provider: 'codex',
        projectId: 'project-diagnostics-test',
        webContentsId: 1,
        runtimeManager: {
          getPid: () => process.pid,
          isReady: () => true,
          codexPath: '/tmp/codex'
        },
        registeredRuntimePids: new Set([process.pid]),
        isProcessing: true,
        currentStreamingAssistantId: 'assistant-diagnostics-test'
      }]
    })
    diagnostics.recordProviderExit({
      sessionId: 'session-diagnostics-test',
      provider: 'codex',
      pid: process.pid,
      code: 0,
      signal: null
    })
    diagnostics.recordShutdownAction('diagnostics-test-action', { step: 1 })
    console.log(JSON.stringify(snapshot))
  `)

  assert.strictEqual(captureResult.status, 0, captureResult.stderr)
  const snapshot = JSON.parse(captureResult.stdout.trim())
  assert.strictEqual(snapshot.profile, 'debug')
  assert.strictEqual(snapshot.appPid > 0, true)
  assert.strictEqual(snapshot.sessions.length, 1)
  assert.strictEqual(snapshot.sessions[0].runtimePid, snapshot.appPid)
  assert.strictEqual(snapshot.sessions[0].runtimeExecutable, '/tmp/codex')
  assert.strictEqual(snapshot.sessions[0].isProcessing, true)
  assert.strictEqual(snapshot.appExecutable, process.execPath)
  assert.strictEqual(snapshot.proxyStatus.port, 18921)
  assert.strictEqual(fs.existsSync(snapshot.logPath), true)
  assert.strictEqual(
    fs.existsSync(path.join(diagnosticsDir, 'last-shutdown.json')),
    true
  )
  assert.strictEqual(
    snapshot.processTree.some(entry => Object.prototype.hasOwnProperty.call(entry, 'args')),
    false
  )

  const logEvents = fs.readFileSync(snapshot.logPath, 'utf8')
    .trim()
    .split(/\r?\n/)
    .map(line => JSON.parse(line))
  assert.deepStrictEqual(
    logEvents.map(entry => entry.event),
    ['shutdown-capture', 'provider-exit', 'shutdown-action']
  )
  assert.strictEqual(logEvents[1].provider, 'codex')
  assert.strictEqual(logEvents[2].action, 'diagnostics-test-action')

  const checkResult = runNodeScript(`
    const diagnostics = require('./electron/services/quit-diagnostics')
    console.log(JSON.stringify(diagnostics.checkPreviousShutdown()))
  `)
  assert.strictEqual(checkResult.status, 0, checkResult.stderr)
  const startupCheck = JSON.parse(checkResult.stdout.trim())
  assert.strictEqual(startupCheck.previousCapturedAt, snapshot.capturedAt)
  assert.deepStrictEqual(startupCheck.alive, [])
  assert.strictEqual(
    fs.existsSync(path.join(diagnosticsDir, 'last-startup-check.json')),
    true
  )
  assert.strictEqual(
    fs.existsSync(path.join(diagnosticsDir, 'last-shutdown.checked.json')),
    true
  )
  assert.strictEqual(
    fs.existsSync(path.join(diagnosticsDir, 'last-shutdown.json')),
    false
  )

  if (diagnostics.listProcesses().length > 0) {
    const survivorResult = runNodeScript(`
      const { spawn } = require('child_process')
      const diagnostics = require('./electron/services/quit-diagnostics')
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '${secretArgument}'], {
        stdio: 'ignore'
      })
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250)
      diagnostics.captureShutdownSnapshot({
        appPid: child.pid,
        sessions: [{
          id: 'session-survivor-test',
          provider: 'codex',
          runtimeManager: {
            getPid: () => child.pid,
            isReady: () => true,
            codexPath: process.execPath
          },
          registeredRuntimePids: new Set([child.pid])
        }]
      })
      const startupCheck = diagnostics.checkPreviousShutdown()
      child.kill('SIGKILL')
      console.log(JSON.stringify({ childPid: child.pid, startupCheck }))
    `)
    assert.strictEqual(survivorResult.status, 0, survivorResult.stderr)
    const survivorCheck = JSON.parse(survivorResult.stdout.trim())
    assert.strictEqual(
      survivorCheck.startupCheck.alive.some(entry => entry.pid === survivorCheck.childPid),
      true
    )
    const diagnosticContent = fs.readdirSync(diagnosticsDir)
      .map(name => fs.readFileSync(path.join(diagnosticsDir, name), 'utf8'))
      .join('\n')
    assert.strictEqual(diagnosticContent.includes(secretArgument), false)
  }

  const { parseElapsedSeconds } = diagnostics
  assert.strictEqual(parseElapsedSeconds('32:45'), 1965)
  assert.strictEqual(parseElapsedSeconds('01:02:03'), 3723)
  assert.strictEqual(parseElapsedSeconds('05-12:59:03'), 478743)

  console.log('quit-diagnostics tests passed')
} finally {
  fs.rmSync(diagnosticsDir, { recursive: true, force: true })
}
