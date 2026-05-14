const { execFile } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const logger = require('../logger')

let cachedShellPath = null
let cachedShellPathPromise = null

function getDefaultShell() {
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

function execFileAsync(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, options, (error, stdout, stderr) => {
      if (error) {
        reject(error)
        return
      }
      resolve({ stdout, stderr })
    })
  })
}

async function resolveLoginShellPath() {
  if (process.platform === 'win32') {
    return process.env.PATH || ''
  }

  if (cachedShellPath !== null) {
    return cachedShellPath
  }

  if (cachedShellPathPromise) {
    return cachedShellPathPromise
  }

  cachedShellPathPromise = (async () => {
    const shellPath = getDefaultShell()
    const marker = `ccgui_path_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`

    try {
      const { stdout } = await execFileAsync(
        shellPath,
        ['-lic', `printf '${marker}'; command printenv PATH; printf '${marker}'`],
        {
          timeout: 10000,
          env: process.env,
          windowsHide: true
        }
      )

      const match = String(stdout || '').match(new RegExp(`${marker}([\\s\\S]*?)${marker}`))
      const resolvedPath = match?.[1]?.trim() || ''
      if (resolvedPath && resolvedPath.includes(path.delimiter)) {
        cachedShellPath = resolvedPath
        logger.info('[ShellEnv] Resolved login shell PATH', {
          shellPath,
          entryCount: resolvedPath.split(path.delimiter).filter(Boolean).length
        })
        return cachedShellPath
      }

      logger.warn('[ShellEnv] Login shell returned empty or invalid PATH', { shellPath })
    } catch (error) {
      logger.warn('[ShellEnv] Failed to resolve login shell PATH', {
        shellPath,
        error: error.message
      })
    }

    cachedShellPath = process.env.PATH || ''
    return cachedShellPath
  })()

  try {
    return await cachedShellPathPromise
  } finally {
    cachedShellPathPromise = null
  }
}

async function buildAugmentedEnv(baseEnv = {}, overrides = {}) {
  const env = {
    ...baseEnv,
    ...overrides
  }

  const shellPath = await resolveLoginShellPath()
  if (shellPath) {
    env.PATH = shellPath
  }

  return env
}

function clearShellEnvCache() {
  cachedShellPath = null
  cachedShellPathPromise = null
}

module.exports = {
  buildAugmentedEnv,
  resolveLoginShellPath,
  clearShellEnvCache
}
