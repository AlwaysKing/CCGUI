const assert = require('assert')
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

const projectRoot = path.resolve(__dirname, '..')
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-proxy-fallback-'))
const sharedHome = path.join(tempRoot, 'shared')
const preferredPort = 28931

fs.mkdirSync(sharedHome, { recursive: true })
fs.writeFileSync(path.join(sharedHome, 'app.json'), JSON.stringify({
  settings: {
    proxyPort: preferredPort
  }
}), 'utf8')

function startProxy(profile) {
  const child = spawn(process.execPath, ['-e', `
    const { localProxy } = require('./electron/services/local-proxy')
    localProxy.start().then(async status => {
      if (status.status !== 'running') {
        throw new Error(status.error || 'proxy failed to start')
      }
      const response = await fetch(localProxy.getBaseUrl() + '/api/hello')
      if (!response.ok) {
        throw new Error('proxy health check failed: ' + response.status)
      }
      console.log(JSON.stringify({ profile: process.env.CCGUI_PROFILE, port: status.port }))
      setInterval(() => {}, 1000)
    }).catch(error => {
      console.error(error.stack || error.message)
      process.exitCode = 1
    })
  `], {
    cwd: projectRoot,
    env: {
      ...process.env,
      CCGUI_PROFILE: profile,
      CCGUI_HOME: sharedHome
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  return new Promise((resolve, reject) => {
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => {
      stdout += chunk
      const line = stdout.trim().split('\n').find(Boolean)
      if (!line) {
        return
      }
      try {
        resolve({ child, result: JSON.parse(line) })
      } catch {
        // Wait for the complete JSON line.
      }
    })
    child.stderr.on('data', chunk => {
      stderr += chunk
    })
    child.on('error', reject)
    child.on('exit', code => {
      if (code !== 0) {
        reject(new Error(`${profile} proxy exited with ${code}: ${stderr}`))
      }
    })
  })
}

async function run() {
  let mainProxy = null
  let debugProxy = null
  try {
    mainProxy = await startProxy('main')
    debugProxy = await startProxy('debug')

    assert.deepStrictEqual(mainProxy.result, {
      profile: 'main',
      port: preferredPort
    })
    assert.deepStrictEqual(debugProxy.result, {
      profile: 'debug',
      port: preferredPort + 1
    })
    console.log('profile proxy port fallback tests passed')
  } finally {
    mainProxy?.child.kill('SIGTERM')
    debugProxy?.child.kill('SIGTERM')
    fs.rmSync(tempRoot, { recursive: true, force: true })
  }
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
