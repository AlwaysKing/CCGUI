const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')
const logger = require('../logger')

const INSTANCES_DIR = path.join(os.homedir(), '.ccgui', 'instances')

function ensureInstancesDir() {
  if (!fs.existsSync(INSTANCES_DIR)) {
    fs.mkdirSync(INSTANCES_DIR, { recursive: true })
  }
}

function instanceFilePath(sessionId) {
  return path.join(INSTANCES_DIR, `${sessionId}.json`)
}

/**
 * 注册一个 provider 进程实例
 */
function register(sessionId, { pid, provider, exePath, projectPath }) {
  if (!sessionId || !pid) return

  ensureInstancesDir()

  const record = {
    sessionId,
    pid,
    provider: provider || 'unknown',
    exePath: exePath || '',
    projectPath: projectPath || '',
    startedAt: new Date().toISOString()
  }

  try {
    fs.writeFileSync(instanceFilePath(sessionId), JSON.stringify(record, null, 2), 'utf8')
    logger.info(`[ProcessRegistry] Registered ${provider} instance for session ${sessionId}, pid=${pid}`)
  } catch (error) {
    logger.warn(`[ProcessRegistry] Failed to register instance for session ${sessionId}: ${error.message}`)
  }
}

/**
 * 注销一个 provider 进程实例（删除 PID 文件）
 */
function unregister(sessionId) {
  if (!sessionId) return

  const filePath = instanceFilePath(sessionId)
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
      logger.info(`[ProcessRegistry] Unregistered instance for session ${sessionId}`)
    }
  } catch (error) {
    logger.warn(`[ProcessRegistry] Failed to unregister instance for session ${sessionId}: ${error.message}`)
  }
}

/**
 * 检查 pid 对应的进程是否仍在运行，且可执行路径匹配
 */
function isProcessAlive(pid, exePath) {
  try {
    process.kill(pid, 0)
  } catch (error) {
    return false
  }

  // 进程存在，验证是否为目标程序
  if (exePath) {
    const basename = path.basename(exePath)
    try {
      const result = execFileSync('ps', ['-p', String(pid), '-o', 'comm='], {
        encoding: 'utf8',
        timeout: 3000
      }).trim()
      // ps 返回的可能是完整路径或仅 basename，都做匹配
      if (result !== basename && result !== exePath) {
        return false
      }
    } catch (error) {
      // ps 执行失败，保守地认为进程不是目标的
      return false
    }
  }

  return true
}

/**
 * 终止一个残留进程：先 SIGTERM，等 2 秒后 SIGKILL
 */
function killStaleProcess(pid, provider) {
  try {
    process.kill(pid, 'SIGTERM')
    logger.info(`[ProcessRegistry] Sent SIGTERM to stale ${provider} process (pid=${pid})`)
  } catch (error) {
    // 进程已经不在了
    return
  }

  // 等 2 秒检查是否还活着
  const deadline = Date.now() + 2000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      return // 已退出
    }
    // 忙等 200ms
    const waitUntil = Date.now() + 200
    while (Date.now() < waitUntil) {
      // spin
    }
  }

  // 还活着，发 SIGKILL
  try {
    process.kill(pid, 'SIGKILL')
    logger.info(`[ProcessRegistry] Sent SIGKILL to stale ${provider} process (pid=${pid})`)
  } catch (error) {
    // 忽略
  }
}

/**
 * 清理所有残留的 provider 进程实例
 * 在 App 启动时调用
 */
function cleanupStaleInstances() {
  if (!fs.existsSync(INSTANCES_DIR)) {
    return
  }

  let files = []
  try {
    files = fs.readdirSync(INSTANCES_DIR).filter(f => f.endsWith('.json'))
  } catch (error) {
    logger.warn(`[ProcessRegistry] Failed to read instances directory: ${error.message}`)
    return
  }

  if (files.length === 0) {
    return
  }

  logger.info(`[ProcessRegistry] Found ${files.length} stale instance(s), checking...`)

  for (const file of files) {
    const filePath = path.join(INSTANCES_DIR, file)
    let record = null
    try {
      record = JSON.parse(fs.readFileSync(filePath, 'utf8'))
    } catch (error) {
      // 文件损坏，直接删除
      try { fs.unlinkSync(filePath) } catch (_) { /* ignore */ }
      continue
    }

    if (isProcessAlive(record.pid, record.exePath)) {
      logger.info(`[ProcessRegistry] Killing stale ${record.provider} process (pid=${record.pid}, session=${record.sessionId})`)
      killStaleProcess(record.pid, record.provider)
    }

    // 无论进程是否还在，都删除 PID 文件
    try {
      fs.unlinkSync(filePath)
    } catch (error) {
      logger.warn(`[ProcessRegistry] Failed to delete stale instance file ${file}: ${error.message}`)
    }
  }

  logger.info('[ProcessRegistry] Stale instance cleanup complete')
}

module.exports = {
  register,
  unregister,
  cleanupStaleInstances
}
