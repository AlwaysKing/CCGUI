const { spawn } = require('child_process')
const http = require('http')

process.env.NODE_ENV = process.env.NODE_ENV || 'development'
process.env.CCGUI_PROFILE = 'debug'

const DEV_URL = 'http://127.0.0.1:5183'

function isViteServerUp(timeoutMs = 1200) {
  return new Promise(resolve => {
    const request = http.get(DEV_URL, response => {
      response.resume()
      resolve(Boolean(response.statusCode && response.statusCode < 500))
    })
    request.on('error', () => resolve(false))
    request.setTimeout(timeoutMs, () => {
      request.destroy()
      resolve(false)
    })
  })
}

async function waitForViteServer(timeoutMs = 30000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (await isViteServerUp()) {
      return true
    }
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  return false
}

function runElectron() {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return spawn(npmCommand, ['exec', 'electron', '.'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
  })
}

function runVite() {
  const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  return spawn(npmCommand, ['run', 'dev'], {
    cwd: process.cwd(),
    env: process.env,
    stdio: 'inherit'
  })
}

async function main() {
  if (await isViteServerUp()) {
    const electron = runElectron()
    electron.on('exit', code => {
      process.exitCode = code || 0
    })
    return
  }

  const vite = runVite()
  const ready = await waitForViteServer()
  if (!ready) {
    vite.kill('SIGTERM')
    process.exitCode = 1
    return
  }

  const electron = runElectron()
  electron.on('exit', code => {
    vite.kill('SIGTERM')
    process.exitCode = code || 0
  })
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
