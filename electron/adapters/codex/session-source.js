const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const { encodeProjectPath } = require('../../project-paths')
const logger = require('../../logger')
const appConfigManager = require('../../storage/app-config-manager')

function getCodexExecutablePath() {
  const possiblePaths = [
    '/Applications/Codex.app/Contents/Resources/codex',
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    path.join(os.homedir(), '.local', 'bin', 'codex')
  ]

  return possiblePaths.find(candidate => fs.existsSync(candidate)) || null
}

async function withCodexAppServer(run, options = {}) {
  const codexPath = getCodexExecutablePath()
  if (!codexPath) {
    throw new Error('Codex executable not found')
  }

  let child = null
  let rl = null
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

    child = spawn(codexPath, ['app-server', '--listen', 'stdio://'], {
      cwd: process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: codexEnv
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
    if (rl) {
      rl.close()
    }
    if (child) {
      child.kill('SIGTERM')
    }
  }
}

async function listCodexThreads() {
  const result = await withCodexAppServer(async ({ request }) => {
    return request('thread/list', {
      limit: 200,
      archived: false
    })
  }, {
    clientName: 'ccgui-session-scan'
  })

  return result?.data || []
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

async function listCodexSessions({ projectPath }) {
  try {
    const normalizedProjectPath = projectPath ? path.resolve(projectPath) : null
    const threads = await listCodexThreads()

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
  } catch (error) {
    logger.warn('[Sessions] Failed to list Codex sessions', { error: error.message, projectPath })
    return []
  }
}

async function deleteCodexSession({ sessionId, session }) {
  const threadId = session?.settings?.codexThreadId || sessionId
  const candidateMethods = [
    { method: 'thread/archive', params: { threadId } },
    { method: 'conversation/archive', params: { conversationId: threadId } }
  ]

  let lastError = null
  for (const candidate of candidateMethods) {
    try {
      await withCodexAppServer(async ({ request }) => {
        await request(candidate.method, candidate.params)
      }, {
        clientName: 'ccgui-session-delete'
      })
      logger.info('[Sessions] Archived Codex thread', { threadId, method: candidate.method })
      return
    } catch (error) {
      lastError = error
      logger.warn('[Sessions] Failed to archive Codex thread with method', {
        threadId,
        method: candidate.method,
        error: error.message
      })
    }
  }

  throw lastError || new Error('Failed to archive Codex thread')
}

const codexSessionSource = {
  provider: 'codex',
  scanProjects: scanCodexProjects,
  listProjectSessions: listCodexSessions,
  createSession: async () => ({ nativeSessionId: null }),
  loadSessionHistory: loadCodexSessionHistory,
  deleteSession: deleteCodexSession,
  deleteProject: async () => {}
}

module.exports = {
  codexSessionSource
}
