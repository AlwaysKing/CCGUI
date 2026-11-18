const path = require('path')
const { spawn } = require('child_process')
const { encodeProjectPath } = require('../../project-paths')
const logger = require('../../logger')
const appConfigManager = require('../../storage/app-config-manager')
const { localProxy } = require('../../services/local-proxy')
const { buildProxyModelString } = require('../shared/model-config')
const { getCodexExecutablePath } = require('./path')

const SESSION_SCAN_TIMEOUT_MS = 30000

function isMissingCodexThreadError(error) {
  const message = typeof error?.message === 'string' ? error.message.toLowerCase() : ''
  return message.includes('thread not found') ||
    message.includes('thread not loaded') ||
    message.includes('conversation not found')
}

async function withCodexAppServer(run, options = {}) {
  const codexPath = getCodexExecutablePath()
  if (!codexPath) {
    throw new Error('Codex executable not found')
  }

  let child = null
  let rl = null
  let proxySessionToken = null
  let stderrText = ''
  const pending = new Map()
  let requestId = 0

  try {
    const appConfig = appConfigManager.loadConfig()
    const proxyUrl = appConfig.settings?.codexProxy || ''
    const codexEnv = {
      ...process.env
    }

    if (proxyUrl) {
      codexEnv.HTTP_PROXY = proxyUrl
      codexEnv.HTTPS_PROXY = proxyUrl
      codexEnv.ALL_PROXY = proxyUrl
    }

    // 会话扫描同样走 CCGUI 供应商，保证不同供应商的会话列表互相独立
    if (!localProxy.getBaseUrl()) {
      const proxyStatus = await localProxy.start()
      if (!localProxy.getBaseUrl()) {
        throw new Error(`Local proxy unavailable: ${proxyStatus?.error || proxyStatus?.status || 'unknown error'}`)
      }
    }
    proxySessionToken = localProxy.registerSession({
      tool: 'codex',
      resolveSettings: () => ({
        modelId: appConfig.settings?.selectedCodexModelId || null,
        credentialId: appConfig.settings?.selectedCodexCredentialId || null
      })
    })
    const providerArgs = localProxy.buildCodexProviderArgs({
      appConfig,
      token: proxySessionToken,
      model: buildProxyModelString(appConfig, 'codex', {
        modelId: appConfig.settings?.selectedCodexModelId || null
      })
    })

    child = spawn(codexPath, ['app-server', ...providerArgs, '--listen', 'stdio://'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: codexEnv
    })

    // 子进程启动失败或意外退出时立即让所有 pending 请求失败，
    // 避免每个请求都干等到超时（例如 PATH 里找不到 node 时 spawn 直接 ENOENT）
    const failPending = (reason) => {
      const error = new Error(reason)
      for (const entry of pending.values()) {
        entry.reject(error)
      }
      pending.clear()
    }

    child.on('error', (error) => {
      failPending(`Codex process failed to start: ${error.message}`)
    })
    child.stderr?.on('data', (chunk) => {
      stderrText = `${stderrText}${String(chunk)}`.slice(-4000)
    })
    child.on('exit', (code, signal) => {
      const redactedStderr = proxySessionToken
        ? stderrText.split(proxySessionToken).join('[REDACTED]')
        : stderrText
      const stderrSuffix = redactedStderr.trim() ? `: ${redactedStderr.trim()}` : ''
      failPending(`Codex app-server exited unexpectedly (code=${code}${signal ? `, signal=${signal}` : ''})${stderrSuffix}`)
    })

    const readline = require('readline')
    rl = readline.createInterface({ input: child.stdout })

    const send = (payload) => {
      child.stdin.write(JSON.stringify(payload) + '\n')
    }

    const request = (method, params) => {
      const id = String(++requestId)
      send({ id, method, params })
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        setTimeout(() => {
          if (!pending.has(id)) return
          pending.delete(id)
          reject(new Error(`Codex request timeout: ${method}`))
        }, options.timeoutMs || 10000)
      })
    }

    rl.on('line', (line) => {
      if (!line.trim()) return

      let message = null
      try {
        message = JSON.parse(line)
      } catch (error) {
        return
      }

      if (message.id === undefined) return

      const key = String(message.id)
      const entry = pending.get(key)
      if (!entry) return
      pending.delete(key)

      if (message.error) {
        entry.reject(new Error(message.error.message || 'Codex request failed'))
      } else {
        entry.resolve(message.result)
      }
    })

    await request('initialize', {
      clientInfo: { name: options.clientName || 'ccgui', version: '1.0.0' },
      capabilities: { experimentalApi: true }
    })
    send({ method: 'initialized' })

    return await run({ request, send, child })
  } finally {
    if (proxySessionToken) {
      localProxy.unregisterSession(proxySessionToken)
    }
    if (rl) {
      rl.close()
    }
    if (child) {
      child.kill('SIGTERM')
    }
  }
}

async function listCodexThreads(options = {}) {
  const cwd = typeof options.cwd === 'string' && options.cwd.trim()
    ? path.resolve(options.cwd.trim())
    : null
  const nativeSessionIds = Array.from(new Set(
    (Array.isArray(options.nativeSessionIds) ? options.nativeSessionIds : [])
      .map(value => typeof value === 'string' ? value.trim() : '')
      .filter(Boolean)
  ))

  return withCodexAppServer(async ({ request }) => {
    let listError = null
    let listedThreads = []

    try {
      const result = await request('thread/list', {
        limit: 200,
        archived: false,
        ...(cwd ? { cwd } : {})
      })
      listedThreads = Array.isArray(result?.data) ? result.data : []
    } catch (error) {
      listError = error
      if (nativeSessionIds.length === 0) {
        throw error
      }
      logger.warn('[Sessions] Codex thread list failed, checking exact bindings', {
        cwd,
        nativeSessionIdCount: nativeSessionIds.length,
        error: error.message
      })
    }

    const threadsById = new Map(
      listedThreads
        .filter(thread => thread?.id)
        .map(thread => [thread.id, thread])
    )

    for (const threadId of nativeSessionIds) {
      if (threadsById.has(threadId)) {
        continue
      }

      try {
        const result = await request('thread/read', {
          threadId,
          includeTurns: false
        })
        const thread = result?.thread || result?.data?.thread || null
        if (thread?.id) {
          threadsById.set(thread.id, thread)
        }
      } catch (error) {
        if (isMissingCodexThreadError(error)) {
          continue
        }
        throw error
      }
    }

    if (listError && threadsById.size === 0) {
      throw listError
    }

    return Array.from(threadsById.values())
  }, {
    clientName: 'ccgui-session-scan',
    timeoutMs: SESSION_SCAN_TIMEOUT_MS
  })
}

function normalizeCodexText(value) {
  if (typeof value === 'string') {
    return value
  }

  if (Array.isArray(value)) {
    return value
      .map(item => normalizeCodexText(
        item?.text ??
        item?.content ??
        item?.value ??
        item?.message
      ))
      .filter(Boolean)
      .join('')
  }

  if (value && typeof value === 'object') {
    return normalizeCodexText(
      value.text ??
      value.content ??
      value.value ??
      value.message
    )
  }

  return ''
}

function buildCodexImportedMessage(turn, index) {
  const role = turn?.role || turn?.author || turn?.type
  const timestampRaw =
    turn?.createdAt ??
    turn?.timestamp ??
    turn?.updatedAt ??
    Date.now() / 1000
  const timestamp = new Date(typeof timestampRaw === 'number' ? timestampRaw * 1000 : timestampRaw)
  const id = turn?.id || turn?.uuid || `codex-history-${index}`

  const content = normalizeCodexText(
    turn?.content ??
    turn?.message ??
    turn?.text ??
    turn?.output ??
    turn?.input
  )

  const thinking = normalizeCodexText(
    turn?.reasoning ??
    turn?.thinking
  )

  if ((role === 'user' || role === 'human') && content) {
    return {
      id,
      role: 'user',
      content,
      timestamp,
      rawMessage: turn
    }
  }

  if ((role === 'assistant' || role === 'agent' || role === 'model') && (content || thinking)) {
    return {
      id,
      role: 'assistant',
      content,
      thinking,
      timestamp,
      rawMessage: turn
    }
  }

  return null
}

async function loadCodexSessionHistory({ sessionId, session }) {
  const threadId = session?.settings?.codexThreadId || sessionId

  try {
    const result = await withCodexAppServer(async ({ request }) => {
      return request('thread/read', {
        threadId,
        includeTurns: true
      })
    }, {
      clientName: 'ccgui-session-history'
    })

    const thread = result?.data || result?.thread || result || {}
    const turns = Array.isArray(thread?.turns)
      ? thread.turns
      : (Array.isArray(thread?.messages) ? thread.messages : [])

    return turns
      .map((turn, index) => buildCodexImportedMessage(turn, index))
      .filter(Boolean)
  } catch (error) {
    if (error.message && error.message.includes('not materialized yet')) {
      const retryableError = new Error(error.message)
      retryableError.code = 'CODEX_THREAD_NOT_MATERIALIZED'
      retryableError.retryable = true
      retryableError.threadId = threadId
      throw retryableError
    }

    logger.warn('[Sessions] Failed to load Codex session history', {
      threadId,
      error: error.message
    })
    return []
  }
}

async function scanCodexProjects() {
  try {
    const threads = await listCodexThreads()
    const projectMap = new Map()

    for (const thread of threads) {
      if (!thread?.cwd) continue

      const projectId = encodeProjectPath(thread.cwd)
      const current = projectMap.get(projectId)
      const updatedAt = thread.updatedAt ? new Date(thread.updatedAt * 1000).toISOString() : null
      const nextProject = {
        id: projectId,
        name: path.basename(thread.cwd),
        path: thread.cwd,
        sessionCount: (current?.sessionCount || 0) + 1,
        lastActiveAt: updatedAt,
        settings: {},
        sourceFlags: {
          ccgui: false,
          claude: false,
          codex: true
        }
      }

      if (!current || (updatedAt && (!current.lastActiveAt || new Date(updatedAt) > new Date(current.lastActiveAt)))) {
        projectMap.set(projectId, nextProject)
      } else {
        projectMap.set(projectId, {
          ...current,
          sessionCount: nextProject.sessionCount,
          sourceFlags: nextProject.sourceFlags
        })
      }
    }

    return Array.from(projectMap.values())
  } catch (error) {
    logger.warn('[Projects] Failed to scan Codex projects', { error: error.message })
    return []
  }
}

async function listCodexSessions({ projectPath, nativeSessionIds = [] }) {
  const normalizedProjectPath = projectPath ? path.resolve(projectPath) : null
  const threads = await listCodexThreads({
    cwd: normalizedProjectPath,
    nativeSessionIds
  })

  return threads
    .filter(thread => {
      if (!thread?.id || !thread?.cwd) return false
      if (!normalizedProjectPath) return true
      return path.resolve(thread.cwd) === normalizedProjectPath
    })
    .map(thread => {
      const updatedAt = thread.updatedAt ? new Date(thread.updatedAt * 1000).toISOString() : null
      const createdAt = thread.createdAt ? new Date(thread.createdAt * 1000).toISOString() : updatedAt
      const name = typeof thread.name === 'string' && thread.name.trim()
        ? thread.name.trim()
        : '会话'
      const preview = typeof thread.preview === 'string'
        ? thread.preview.slice(0, 100)
        : ''

      return {
        id: thread.id,
        name,
        preview,
        messageCount: 0,
        createdAt,
        updatedAt,
        settings: {
          provider: 'codex',
          codexThreadId: thread.id,
          toolBinding: {
            tool: 'codex',
            nativeSessionId: thread.id
          }
        }
      }
    })
}

function getCodexThreadId(session = null) {
  return session?.settings?.codexThreadId ||
    session?.settings?.toolBinding?.nativeSessionId ||
    session?.id ||
    null
}

function buildCodexArchiveCandidates(threadId) {
  return [
    { method: 'thread/archive', params: { threadId } },
    { method: 'conversation/archive', params: { conversationId: threadId } }
  ]
}

async function deleteCodexSessions({ sessions = [] } = {}) {
  const targets = []
  const seenSessionIds = new Set()

  for (const session of sessions) {
    const sessionId = session?.id
    const threadId = getCodexThreadId(session)
    if (!sessionId || !threadId || seenSessionIds.has(sessionId)) continue
    seenSessionIds.add(sessionId)
    targets.push({ sessionId, threadId })
  }

  const result = {
    deletedSessionIds: [],
    failures: []
  }
  if (targets.length === 0) {
    return result
  }

  const outcomes = new Map()
  try {
    await withCodexAppServer(async ({ request }) => {
      for (const target of targets) {
        let lastError = null

        for (const candidate of buildCodexArchiveCandidates(target.threadId)) {
          try {
            await request(candidate.method, candidate.params)
            outcomes.set(target.sessionId, {
              success: true,
              method: candidate.method
            })
            logger.info('[Sessions] Archived Codex thread', {
              threadId: target.threadId,
              method: candidate.method
            })
            break
          } catch (error) {
            lastError = error
            logger.warn('[Sessions] Failed to archive Codex thread with method', {
              threadId: target.threadId,
              method: candidate.method,
              error: error.message
            })
          }
        }

        if (!outcomes.has(target.sessionId)) {
          outcomes.set(target.sessionId, {
            success: false,
            error: lastError?.message || 'Failed to archive Codex thread'
          })
        }
      }
    }, {
      clientName: 'ccgui-session-delete-batch'
    })
  } catch (error) {
    logger.warn('[Sessions] Failed to run Codex batch session delete', {
      sessionCount: targets.length,
      error: error.message
    })

    for (const target of targets) {
      if (!outcomes.has(target.sessionId)) {
        outcomes.set(target.sessionId, {
          success: false,
          error: error.message
        })
      }
    }
  }

  for (const target of targets) {
    const outcome = outcomes.get(target.sessionId)
    if (outcome?.success) {
      result.deletedSessionIds.push(target.sessionId)
    } else {
      result.failures.push({
        sessionId: target.sessionId,
        error: outcome?.error || 'Failed to archive Codex thread'
      })
    }
  }

  return result
}

async function deleteCodexSession({ sessionId, session }) {
  const result = await deleteCodexSessions({
    sessions: [{
      ...(session || {}),
      id: sessionId
    }]
  })
  const failure = result.failures.find(item => item.sessionId === sessionId)
  if (failure) {
    throw new Error(failure.error)
  }
}

const codexSessionSource = {
  provider: 'codex',
  scanProjects: scanCodexProjects,
  listProjectSessions: listCodexSessions,
  createSession: async () => ({ nativeSessionId: null }),
  loadSessionHistory: loadCodexSessionHistory,
  deleteSession: deleteCodexSession,
  deleteSessions: deleteCodexSessions,
  deleteProject: async () => {}
}

module.exports = {
  codexSessionSource
}
