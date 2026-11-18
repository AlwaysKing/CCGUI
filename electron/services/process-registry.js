const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')
const logger = require('../logger')
const { getCcguiPath, getProfile } = require('../runtime-paths')

const INSTANCES_DIR = getCcguiPath('instances', getProfile())

function parseElapsedSeconds(value) {
  const parts = String(value || '').trim().split(':')
  if (parts.length < 2) {
    return null
  }

  let days = 0
  let hours = 0
  let minutes = 0
  let seconds = 0

  if (parts.length === 3) {
    const dayAndHours = parts[0].split('-')
    if (dayAndHours.length === 2) {
      days = Number(dayAndHours[0]) || 0
      hours = Number(dayAndHours[1]) || 0
    } else {
      hours = Number(parts[0]) || 0
    }
    minutes = Number(parts[1]) || 0
    seconds = Number(parts[2]) || 0
  } else {
    minutes = Number(parts[0]) || 0
    seconds = Number(parts[1]) || 0
  }

  return days * 86400 + hours * 3600 + minutes * 60 + seconds
}

function listProcesses() {
  if (process.platform === 'win32') {
    return []
  }

  try {
    const output = execFileSync('ps', ['-axo', 'pid=,ppid=,pgid=,stat=,etime=,comm='], {
      encoding: 'utf8',
      timeout: 3000
    })

    return output.split(/\r?\n/)
      .map(line => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(\d+)\s+(\S+)\s+(\S+)\s+(.+)$/)
        if (!match) {
          return null
        }

        return {
          pid: Number(match[1]),
          ppid: Number(match[2]),
          pgid: Number(match[3]),
          stat: match[4],
          elapsed: match[5],
          elapsedSeconds: parseElapsedSeconds(match[5]),
          command: match[6].trim()
        }
      })
      .filter(Boolean)
  } catch (error) {
    logger.warn('[ProcessRegistry] Failed to inspect process table', { error: error.message })
    return []
  }
}

function collectProcessTree(rootPid, processes = listProcesses()) {
  const numericRootPid = Number(rootPid)
  if (!numericRootPid) {
    return []
  }

  const processByPid = new Map(processes.map(entry => [entry.pid, entry]))
  const childrenByParent = new Map()
  for (const entry of processes) {
    if (!childrenByParent.has(entry.ppid)) {
      childrenByParent.set(entry.ppid, [])
    }
    childrenByParent.get(entry.ppid).push(entry)
  }

  const result = []
  const seen = new Set()
  const queue = [numericRootPid]

  while (queue.length > 0) {
    const pid = queue.shift()
    if (seen.has(pid)) {
      continue
    }
    seen.add(pid)

    const processEntry = processByPid.get(pid)
    if (processEntry) {
      result.push(processEntry)
    }

    const children = childrenByParent.get(pid) || []
    for (const child of children) {
      queue.push(child.pid)
    }
  }

  return result.sort((left, right) => left.pid - right.pid)
}

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
function unregister(sessionId, expectedPid = null) {
  if (!sessionId) return

  const filePath = instanceFilePath(sessionId)
  try {
    if (fs.existsSync(filePath)) {
      if (expectedPid) {
        let record = null
        try {
          record = JSON.parse(fs.readFileSync(filePath, 'utf8'))
        } catch {
          record = null
        }
        if (Number(record?.pid) !== Number(expectedPid)) {
          return
        }
      }
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
 * 等待进程退出
 */
function waitForExit(pid, timeoutMs) {
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs
    const timer = setInterval(() => {
      if (!isProcessAlive(pid)) {
        clearInterval(timer)
        resolve(true)
        return
      }
      if (Date.now() >= deadline) {
        clearInterval(timer)
        resolve(false)
      }
    }, 100)
  })
}

function waitForProcessesExit(pids, timeoutMs) {
  const targets = [...new Set(
    (Array.isArray(pids) ? pids : [])
      .map(pid => Number(pid))
      .filter(pid => Number.isInteger(pid) && pid > 1)
  )]

  if (targets.length === 0) {
    return Promise.resolve([])
  }

  return new Promise(resolve => {
    const deadline = Date.now() + Math.max(0, Number(timeoutMs) || 0)
    const check = () => {
      const remaining = targets.filter(pid => isProcessAlive(pid))
      if (remaining.length === 0 || Date.now() >= deadline) {
        resolve(remaining)
        return
      }
      setTimeout(check, 100)
    }
    check()
  })
}

function signalProcesses(pids, signal, reason) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal)
      logger.info(`[ProcessRegistry] Sent ${signal} to ${reason} process (pid=${pid})`)
    } catch (error) {
      if (error.code !== 'ESRCH') {
        logger.warn(`[ProcessRegistry] Failed to send ${signal} to ${reason} process (pid=${pid}): ${error.message}`)
      }
    }
  }
}

async function terminateProcesses(pids, options = {}) {
  const targets = [...new Set(
    (Array.isArray(pids) ? pids : [])
      .map(pid => Number(pid))
      .filter(pid => Number.isInteger(pid) && pid > 1 && pid !== process.pid)
  )]
  const graceMs = Math.max(0, Number(options.graceMs) || 1500)
  const forceWaitMs = Math.max(0, Number(options.forceWaitMs) || 1000)
  const reason = options.reason || 'residual'

  if (targets.length === 0) {
    return { requested: [], terminated: [], remaining: [] }
  }

  signalProcesses(targets, 'SIGTERM', reason)
  let remaining = await waitForProcessesExit(targets, graceMs)
  if (remaining.length > 0) {
    signalProcesses(remaining, 'SIGKILL', reason)
    remaining = await waitForProcessesExit(remaining, forceWaitMs)
  }

  const remainingSet = new Set(remaining)
  return {
    requested: targets,
    terminated: targets.filter(pid => !remainingSet.has(pid)),
    remaining
  }
}

function buildProcessTreeTargets(entries, rootPid) {
  const rootEntry = entries.find(entry => entry.pid === rootPid) || null
  const rootPgid = rootEntry?.pgid || null
  const processesByPid = new Map(entries.map(entry => [entry.pid, entry]))
  const pids = []
  const pgids = []

  for (const entry of entries) {
    if (entry.pid === rootPid || entry.pid <= 1 || entry.pid === process.pid) {
      continue
    }
    pids.push(entry.pid)

    if (
      process.platform !== 'win32' &&
      entry.pgid > 1 &&
      entry.pgid !== rootPgid &&
      processesByPid.has(entry.pgid)
    ) {
      pgids.push(entry.pgid)
    }
  }

  return {
    pids: [...new Set(pids)],
    pgids: [...new Set(pgids)]
  }
}

function signalProcessTargets(targets, signal, reason) {
  if (process.platform !== 'win32') {
    for (const pgid of targets.pgids || []) {
      try {
        process.kill(-pgid, signal)
        logger.info(`[ProcessRegistry] Sent ${signal} to ${reason} process group (pgid=${pgid})`)
      } catch (error) {
        if (error.code !== 'ESRCH') {
          logger.warn(`[ProcessRegistry] Failed to send ${signal} to ${reason} process group (pgid=${pgid}): ${error.message}`)
        }
      }
    }
  }

  signalProcesses(targets.pids || [], signal, reason)
}

async function terminateProcessTree(rootPid, options = {}) {
  const numericRootPid = Number(rootPid)
  if (!Number.isInteger(numericRootPid) || numericRootPid <= 1) {
    return { requested: [], terminated: [], remaining: [] }
  }

  const graceMs = Math.max(0, Number(options.graceMs) || 1200)
  const forceWaitMs = Math.max(0, Number(options.forceWaitMs) || 1000)
  const reason = options.reason || 'shutdown'
  const firstEntries = collectProcessTree(numericRootPid)
  const firstTargets = buildProcessTreeTargets(firstEntries, numericRootPid)

  if (firstTargets.pids.length === 0) {
    return { requested: [], terminated: [], remaining: [] }
  }

  signalProcessTargets(firstTargets, 'SIGTERM', reason)
  let remaining = await waitForProcessesExit(firstTargets.pids, graceMs)

  const currentEntries = collectProcessTree(numericRootPid)
  const currentTargets = buildProcessTreeTargets(currentEntries, numericRootPid)
  const forceTargets = {
    pids: [...new Set([
      ...remaining,
      ...currentTargets.pids
    ])],
    pgids: [...new Set([
      ...firstTargets.pgids,
      ...currentTargets.pgids
    ])]
  }

  if (forceTargets.pids.length > 0) {
    signalProcessTargets(forceTargets, 'SIGKILL', reason)
    remaining = await waitForProcessesExit(forceTargets.pids, forceWaitMs)
  }

  const remainingSetAfter = new Set(remaining)
  return {
    requested: firstTargets.pids,
    terminated: firstTargets.pids.filter(pid => !remainingSetAfter.has(pid)),
    remaining
  }
}

/**
 * 终止指定会话登记的 provider 进程（异步等待退出，不阻塞主进程）
 * 用于回收仍持有线程写锁的残留进程
 * @param {string} sessionId
 * @param {Set<number>|null} allowedPids 仅当登记的 pid 属于该集合时才终止，避免误杀其它 App 实例的 provider
 */
async function terminateRegisteredInstance(sessionId, allowedPids = null) {
  if (!sessionId) {
    return false
  }

  const filePath = instanceFilePath(sessionId)
  let record = null
  try {
    record = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch (error) {
    return false
  }

  if (!record?.pid || !isProcessAlive(record.pid, record.exePath)) {
    unregister(sessionId, record?.pid)
    return false
  }

  if (allowedPids && !allowedPids.has(record.pid)) {
    logger.warn(`[ProcessRegistry] Skip terminating ${record.provider} process (pid=${record.pid}) not owned by this session instance`)
    return false
  }

  logger.info(`[ProcessRegistry] Terminating residual ${record.provider} process (pid=${record.pid}, session=${sessionId})`)
  try {
    process.kill(record.pid, 'SIGTERM')
  } catch (error) {
    unregister(sessionId, record.pid)
    return false
  }

  if (!await waitForExit(record.pid, 2000)) {
    try {
      process.kill(record.pid, 'SIGKILL')
      logger.info(`[ProcessRegistry] Sent SIGKILL to residual ${record.provider} process (pid=${record.pid})`)
    } catch (error) {
      // 忽略
    }
    await waitForExit(record.pid, 1000)
  }

  const exited = !isProcessAlive(record.pid)
  unregister(sessionId, record.pid)
  return exited
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
  collectProcessTree,
  isProcessAlive,
  listProcesses,
  parseElapsedSeconds,
  register,
  terminateProcesses,
  terminateProcessTree,
  terminateRegisteredInstance,
  unregister,
  cleanupStaleInstances,
  waitForProcessesExit
}
