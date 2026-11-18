const fs = require('fs')
const path = require('path')
const logger = require('../logger')
const { getLogDir, getProfile } = require('../runtime-paths')
const {
  collectProcessTree,
  listProcesses,
  parseElapsedSeconds
} = require('./process-registry')

const DIAGNOSTICS_DIR = process.env.CCGUI_QUIT_DIAGNOSTICS_DIR
  ? path.resolve(process.env.CCGUI_QUIT_DIAGNOSTICS_DIR)
  : path.join(getLogDir(), 'quit-diagnostics')
const LAST_SHUTDOWN_PATH = path.join(DIAGNOSTICS_DIR, 'last-shutdown.json')
const CHECKED_SHUTDOWN_PATH = path.join(DIAGNOSTICS_DIR, 'last-shutdown.checked.json')
const MAX_SHUTDOWN_LOGS = 20

let activeLogPath = null
let activeCapturedAt = null

function ensureDiagnosticsDir() {
  fs.mkdirSync(DIAGNOSTICS_DIR, { recursive: true })
}

function formatTimestamp(date = new Date()) {
  return date.toISOString().replace(/[:.]/g, '-')
}

function appendJsonLine(filePath, payload) {
  ensureDiagnosticsDir()
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, 'utf8')
}

function writeJsonFile(filePath, payload) {
  ensureDiagnosticsDir()
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
}

function normalizeSessionSnapshot(session = null) {
  if (!session) {
    return null
  }

  let runtimePid = null
  let runtimeReady = false
  let runtimeExecutable = ''
  try {
    runtimePid = session.runtimeManager?.getPid?.() || null
    runtimeReady = session.runtimeManager?.isReady?.() === true
    runtimeExecutable = session.runtimeManager?.codexPath || session.runtimeManager?.claudePath || ''
  } catch (error) {
    runtimePid = null
  }

  return {
    sessionId: session.id || null,
    provider: session.provider || null,
    projectId: session.projectId || null,
    webContentsId: session.webContentsId || null,
    runtimePid,
    runtimeReady,
    runtimeExecutable,
    registeredRuntimePids: [...(session.registeredRuntimePids || [])],
    isProcessing: session.isProcessing === true,
    currentStreamingAssistantId: session.currentStreamingAssistantId || null
  }
}

function pruneOldShutdownLogs() {
  try {
    const entries = fs.readdirSync(DIAGNOSTICS_DIR)
      .filter(name => /^shutdown-.*\.jsonl$/.test(name))
      .map(name => {
        const filePath = path.join(DIAGNOSTICS_DIR, name)
        return { filePath, mtimeMs: fs.statSync(filePath).mtimeMs }
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs)

    for (const entry of entries.slice(MAX_SHUTDOWN_LOGS)) {
      fs.unlinkSync(entry.filePath)
    }
  } catch (error) {
    logger.warn('[QuitDiagnostics] Failed to prune old shutdown logs', { error: error.message })
  }
}

function recordEvent(event, data = {}) {
  if (!activeLogPath) {
    return
  }

  try {
    appendJsonLine(activeLogPath, {
      schemaVersion: 1,
      timestamp: new Date().toISOString(),
      event,
      sinceShutdownCaptureMs: activeCapturedAt ? Date.now() - activeCapturedAt : null,
      ...data
    })
  } catch (error) {
    logger.warn('[QuitDiagnostics] Failed to append shutdown event', { event, error: error.message })
  }
}

function captureShutdownSnapshot(options = {}) {
  const capturedAt = new Date()
  const capturedAtMs = capturedAt.getTime()
  const sessions = Array.isArray(options.sessions)
    ? options.sessions.map(normalizeSessionSnapshot).filter(Boolean)
    : []
  const appPid = Number(options.appPid || process.pid)
  const processes = listProcesses()
  const processTree = collectProcessTree(appPid, processes)
  const logPath = path.join(DIAGNOSTICS_DIR, `shutdown-${formatTimestamp(capturedAt)}.jsonl`)
  const snapshot = {
    schemaVersion: 1,
    event: 'shutdown-capture',
    capturedAt: capturedAt.toISOString(),
    profile: getProfile(),
    appPid,
    appExecutable: process.execPath,
    proxyStatus: options.proxyStatus || null,
    terminalHostPid: options.terminalHostPid || null,
    terminalHostExecutable: options.terminalHostPid ? process.execPath : null,
    sessions,
    processTree,
    logPath
  }

  activeLogPath = logPath
  activeCapturedAt = capturedAtMs

  try {
    appendJsonLine(logPath, snapshot)
    writeJsonFile(LAST_SHUTDOWN_PATH, snapshot)
    pruneOldShutdownLogs()
    logger.info('[QuitDiagnostics] Captured shutdown snapshot', {
      logPath,
      appPid,
      sessionCount: sessions.length,
      processCount: processTree.length,
      providerPids: sessions.map(session => session.runtimePid).filter(Boolean)
    })
    return snapshot
  } catch (error) {
    logger.warn('[QuitDiagnostics] Failed to capture shutdown snapshot', { error: error.message })
    return null
  }
}

function recordProviderExit({ sessionId, provider, pid, code, signal } = {}) {
  if (!activeLogPath) {
    return
  }

  recordEvent('provider-exit', {
    sessionId: sessionId || null,
    provider: provider || null,
    pid: pid || null,
    code: code ?? null,
    signal: signal ?? null
  })
  logger.info('[QuitDiagnostics] Provider exit observed during shutdown', {
    sessionId: sessionId || null,
    provider: provider || null,
    pid: pid || null,
    code: code ?? null,
    signal: signal ?? null
  })
}

function recordShutdownAction(action, data = {}) {
  recordEvent('shutdown-action', {
    action,
    ...data
  })
}

function sameExecutable(leftCommand, rightCommand) {
  const left = String(leftCommand || '').trim()
  const right = String(rightCommand || '').trim()
  if (!left || !right) {
    return null
  }
  if (left === right) {
    return true
  }
  return path.basename(left) === path.basename(right)
}

function collectTrackedProcesses(snapshot) {
  const tracked = new Map()

  for (const processEntry of snapshot.processTree || []) {
    if (processEntry?.pid) {
      tracked.set(processEntry.pid, { ...processEntry, source: 'process-tree' })
    }
  }

  for (const session of snapshot.sessions || []) {
    for (const pid of [session.runtimePid, ...(session.registeredRuntimePids || [])]) {
      if (pid && !tracked.has(pid)) {
        tracked.set(pid, {
          pid,
          command: session.runtimeExecutable || '',
          source: 'session',
          sessionId: session.sessionId,
          provider: session.provider
        })
      }
    }
  }

  if (snapshot.terminalHostPid && !tracked.has(snapshot.terminalHostPid)) {
    tracked.set(snapshot.terminalHostPid, {
      pid: snapshot.terminalHostPid,
      command: snapshot.terminalHostExecutable || '',
      source: 'terminal-host'
    })
  }

  if (snapshot.appPid && !tracked.has(snapshot.appPid)) {
    tracked.set(snapshot.appPid, {
      pid: snapshot.appPid,
      command: snapshot.appExecutable || '',
      source: 'app'
    })
  }

  return [...tracked.values()]
}

function checkPreviousShutdown() {
  let snapshot = null
  try {
    if (!fs.existsSync(LAST_SHUTDOWN_PATH)) {
      return null
    }
    snapshot = JSON.parse(fs.readFileSync(LAST_SHUTDOWN_PATH, 'utf8'))
  } catch (error) {
    logger.warn('[QuitDiagnostics] Failed to read previous shutdown snapshot', { error: error.message })
    return null
  }

  const checkedAt = new Date()
  const checkedAtMs = checkedAt.getTime()
  const processes = listProcesses()
  const processByPid = new Map(processes.map(entry => [entry.pid, entry]))
  const capturedAtMs = Date.parse(snapshot.capturedAt || '')
  const elapsedSinceCaptureSeconds = Number.isFinite(capturedAtMs)
    ? Math.max(0, Math.floor((checkedAtMs - capturedAtMs) / 1000))
    : 0
  const alive = []
  const reusedPids = []

  for (const tracked of collectTrackedProcesses(snapshot)) {
    const current = processByPid.get(tracked.pid)
    if (!current) {
      continue
    }

    const identityMatch = sameExecutable(tracked.command, current.command)
    const expectedElapsedSeconds = Number.isFinite(tracked.elapsedSeconds)
      ? tracked.elapsedSeconds + elapsedSinceCaptureSeconds
      : null
    const elapsedMatches = expectedElapsedSeconds === null
      ? null
      : Number(current.elapsedSeconds || 0) + 2 >= expectedElapsedSeconds
    const likelySurvivor = identityMatch !== false && elapsedMatches !== false
    const record = {
      pid: current.pid,
      ppid: current.ppid,
      pgid: current.pgid,
      stat: current.stat,
      elapsed: current.elapsed,
      command: current.command,
      previousCommand: tracked.command || null,
      source: tracked.source || null,
      sessionId: tracked.sessionId || null,
      provider: tracked.provider || null,
      identityMatch,
      elapsedMatches,
      likelySurvivor
    }

    if (likelySurvivor) {
      alive.push(record)
    } else {
      reusedPids.push(record)
    }
  }

  const startupCheck = {
    schemaVersion: 1,
    event: 'startup-check',
    checkedAt: checkedAt.toISOString(),
    previousCapturedAt: snapshot.capturedAt || null,
    appPid: snapshot.appPid || null,
    logPath: snapshot.logPath || null,
    alive,
    reusedPids
  }

  try {
    if (snapshot.logPath) {
      appendJsonLine(snapshot.logPath, startupCheck)
    }
    writeJsonFile(path.join(DIAGNOSTICS_DIR, 'last-startup-check.json'), startupCheck)
    writeJsonFile(CHECKED_SHUTDOWN_PATH, {
      ...snapshot,
      startupCheck
    })
    fs.unlinkSync(LAST_SHUTDOWN_PATH)
  } catch (error) {
    logger.warn('[QuitDiagnostics] Failed to persist startup shutdown check', { error: error.message })
  }

  if (alive.length > 0) {
    logger.warn('[QuitDiagnostics] Previous shutdown left processes alive', {
      capturedAt: snapshot.capturedAt || null,
      alive,
      logPath: snapshot.logPath || null
    })
  } else {
    logger.info('[QuitDiagnostics] Previous shutdown left no matching processes alive', {
      capturedAt: snapshot.capturedAt || null,
      reusedPidCount: reusedPids.length,
      logPath: snapshot.logPath || null
    })
  }

  return startupCheck
}

module.exports = {
  captureShutdownSnapshot,
  checkPreviousShutdown,
  collectProcessTree,
  listProcesses,
  parseElapsedSeconds,
  recordProviderExit,
  recordShutdownAction
}
