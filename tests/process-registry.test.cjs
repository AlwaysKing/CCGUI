const assert = require('assert')
const { spawn, spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const processRegistry = require('../electron/services/process-registry')

function waitForJsonLine(child) {
  return new Promise((resolve, reject) => {
    let stdout = ''
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', chunk => {
      stdout += chunk
      const line = stdout.split(/\r?\n/).find(Boolean)
      if (!line) return
      try {
        resolve(JSON.parse(line))
      } catch {
        // Wait for the complete JSON line.
      }
    })
    child.once('error', reject)
    child.once('exit', code => {
      reject(new Error(`process tree fixture exited early with code ${code}`))
    })
  })
}

function waitForExit(pid, timeoutMs = 3000) {
  return new Promise(resolve => {
    const deadline = Date.now() + timeoutMs
    const check = () => {
      if (!processRegistry.isProcessAlive(pid)) {
        resolve(true)
        return
      }
      if (Date.now() >= deadline) {
        resolve(false)
        return
      }
      setTimeout(check, 50)
    }
    check()
  })
}

async function run() {
  let parent = null
  let parentPid = null
  let childPid = null
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-process-registry-'))

  try {
    const registryCheck = spawnSync(process.execPath, ['-e', `
      const fs = require('fs')
      const path = require('path')
      const registry = require('./electron/services/process-registry')
      registry.register('session-pid-check', {
        pid: 424242,
        provider: 'test',
        exePath: '/tmp/test-provider'
      })
      const filePath = path.join(process.env.CCGUI_HOME, 'instances', 'debug', 'session-pid-check.json')
      registry.unregister('session-pid-check', 424243)
      const retainedForWrongPid = fs.existsSync(filePath)
      registry.unregister('session-pid-check', 424242)
      const removedForExpectedPid = !fs.existsSync(filePath)
      console.log(JSON.stringify({ retainedForWrongPid, removedForExpectedPid }))
    `], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        CCGUI_PROFILE: 'debug',
        CCGUI_HOME: tempHome
      },
      encoding: 'utf8'
    })
    assert.strictEqual(registryCheck.status, 0, registryCheck.stderr)
    assert.deepStrictEqual(JSON.parse(registryCheck.stdout.trim()), {
      retainedForWrongPid: true,
      removedForExpectedPid: true
    })

    parent = spawn(process.execPath, ['-e', `
      const { spawn } = require('child_process')
      const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
        detached: true,
        stdio: 'ignore'
      })
      child.unref()
      console.log(JSON.stringify({ parentPid: process.pid, childPid: child.pid }))
      setInterval(() => {}, 1000)
    `], {
      stdio: ['ignore', 'pipe', 'inherit']
    })

    const pids = await waitForJsonLine(parent)
    parentPid = pids.parentPid
    childPid = pids.childPid
    assert.strictEqual(await waitForExit(childPid, 100), false)
    assert.strictEqual(processRegistry.isProcessAlive(parentPid), true)

    const tree = processRegistry.collectProcessTree(parentPid)
    assert.strictEqual(tree.some(entry => entry.pid === childPid), true)

    const result = await processRegistry.terminateProcessTree(parentPid, {
      graceMs: 300,
      forceWaitMs: 1500,
      reason: 'test'
    })

    assert.deepStrictEqual(result.remaining, [])
    assert.strictEqual(processRegistry.isProcessAlive(parentPid), true)
    assert.strictEqual(await waitForExit(childPid), true)

    const parentExitPromise = new Promise(resolve => parent.once('exit', resolve))
    parent.kill('SIGTERM')
    await parentExitPromise
    console.log('process-registry tests passed')
  } finally {
    if (childPid) {
      try { process.kill(-childPid, 'SIGKILL') } catch {}
      try { process.kill(childPid, 'SIGKILL') } catch {}
    }
    if (parentPid) {
      try { process.kill(parentPid, 'SIGKILL') } catch {}
    }
    parent?.kill('SIGKILL')
    fs.rmSync(tempHome, { recursive: true, force: true })
  }
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
