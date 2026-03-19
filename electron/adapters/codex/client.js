const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const logger = require('../../logger')
const appConfigManager = require('../../storage/app-config-manager')
const {
  createEmptyTurnUsage,
  mergeTurnUsage
} = require('../shared/usage')

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value
    }
  }
  return null
}

const TOOL_NAME_ALIASES = new Map([
  ['bash', 'Bash'],
  ['exec_command', 'Bash'],
  ['commandexecution', 'Bash'],
  ['read', 'Read'],
  ['write', 'Write'],
  ['edit', 'Edit'],
  ['multiedit', 'Edit'],
  ['apply_patch', 'ApplyPatch'],
  ['applypatch', 'ApplyPatch'],
  ['glob', 'Glob'],
  ['grep', 'Grep'],
  ['websearch', 'WebSearch'],
  ['web_search', 'WebSearch'],
  ['viewimage', 'ViewImage'],
  ['view_image', 'ViewImage'],
  ['generateimage', 'GenerateImage'],
  ['generate_image', 'GenerateImage'],
  ['skill', 'Skill'],
  ['agent', 'Agent'],
  ['collabagenttoolcall', 'Agent'],
  ['todowrite', 'TodoWrite'],
  ['todowrite tool', 'TodoWrite'],
  ['request_permissions', 'RequestPermissions'],
  ['requestpermissions', 'RequestPermissions'],
  ['request_user_input', 'AskUserQuestion'],
  ['requestuserinput', 'AskUserQuestion'],
  ['askuserquestion', 'AskUserQuestion'],
  ['client_tool_call', 'ClientToolCall'],
  ['clienttoolcall', 'ClientToolCall']
])

function normalizeToolName(name, fallback = 'UnknownTool') {
  if (!name) {
    return fallback
  }

  const raw = String(name).trim()
  if (!raw) {
    return fallback
  }

  const normalizedKey = raw.toLowerCase().replace(/[\s/-]+/g, '_')
  const compactKey = normalizedKey.replace(/_/g, '')

  return (
    TOOL_NAME_ALIASES.get(normalizedKey) ||
    TOOL_NAME_ALIASES.get(compactKey) ||
    raw
  )
}

function normalizeCodexUsage(tokenUsage = {}, scope = 'total') {
  const source =
    scope === 'last'
      ? (tokenUsage.last || tokenUsage.total || {})
      : (tokenUsage.total || tokenUsage.last || {})

  return {
    total_tokens: source.totalTokens || 0,
    input_tokens: source.inputTokens || 0,
    cache_read_input_tokens: source.cachedInputTokens || 0,
    output_tokens: source.outputTokens || 0,
    reasoning_output_tokens: source.reasoningOutputTokens || 0,
    model_context_window: tokenUsage.modelContextWindow || 0,
    raw: tokenUsage,
    scope
  }
}

function buildSessionUsageSummary(tokenUsage = {}, previousSummary = null) {
  const usage = normalizeCodexUsage(tokenUsage)
  return {
    ...previousSummary,
    total_tokens: usage.total_tokens,
    input_tokens: usage.input_tokens,
    cache_read_input_tokens: usage.cache_read_input_tokens,
    output_tokens: usage.output_tokens,
    reasoning_output_tokens: usage.reasoning_output_tokens,
    model_context_window: usage.model_context_window,
    raw: tokenUsage
  }
}

function normalizeControlRequest(message = {}) {
  const toolName = normalizeToolName(
    pickFirstDefined(message.tool_name, message.toolName, message.method)
  )
  const toolInput = pickFirstDefined(message.tool_input, message.toolInput, message.input, {}) || {}

  return {
    ...message,
    tool_name: toolName,
    toolName,
    tool_input: toolInput,
    toolInput,
    input: toolInput
  }
}

function applyCodexEnvInfoPatch(envInfo = {}, options = {}) {
  const provider = options.provider || envInfo.provider || 'codex'
  const providerPid = pickFirstDefined(
    options.providerPid,
    envInfo.providerPid,
    null
  )

  return {
    ...envInfo,
    provider,
    providerPid
  }
}

function getTextFromUserMessage(message) {
  if (typeof message === 'string') {
    return message
  }

  const parts = message?.message?.content
  if (!Array.isArray(parts)) {
    return ''
  }

  const textPart = parts.find(part => part?.type === 'text')
  return textPart?.text || ''
}

class CodexClient {
  constructor(workingDirectory = null, sessionId = null, isNewSession = true, permissionMode = 'default', projectSettings = null, options = {}) {
    this.process = null
    this.messageHandlers = new Map()
    this.codexPath = null
    this.workingDirectory = workingDirectory || process.cwd()
    this.sessionId = sessionId
    this.isNewSession = isNewSession
    this.permissionMode = permissionMode
    this.projectSettings = projectSettings
    this.resumeThreadId = options.resumeThreadId || null

    this.requestCounter = 0
    this.pendingRequests = new Map()
    this.pendingServerRequests = new Map()
    this.currentThreadId = this.resumeThreadId
    this.currentTurnId = null
    this.currentAssistantMessageId = null
    this.turnMessageMap = new Map()
    this.turnAssistantState = new Map()
    this.turnStats = new Map()
    this.itemToMessageMap = new Map()
    this.itemState = new Map()
    this.envInfo = {
      cwd: this.workingDirectory,
      session_id: this.resumeThreadId || this.sessionId,
      provider: 'codex',
      providerPid: null,
      tools: []
    }
  }

  on(messageType, handler) {
    if (!this.messageHandlers.has(messageType)) {
      this.messageHandlers.set(messageType, [])
    }
    this.messageHandlers.get(messageType).push(handler)
  }

  off(messageType, handler) {
    if (!this.messageHandlers.has(messageType)) {
      return
    }

    const handlers = this.messageHandlers.get(messageType)
    const index = handlers.indexOf(handler)
    if (index >= 0) {
      handlers.splice(index, 1)
    }
  }

  emit(messageType, payload) {
    const handlers = this.messageHandlers.get(messageType) || []
    handlers.forEach(handler => {
      try {
        handler(payload)
      } catch (error) {
        logger.error('[CodexClient] Handler error', { messageType, error: error.message })
      }
    })
  }

  detectCodexPath() {
    const possiblePaths = [
      '/Applications/Codex.app/Contents/Resources/codex',
      '/opt/homebrew/bin/codex',
      '/usr/local/bin/codex',
      path.join(process.env.HOME || '', '.local/bin/codex'),
      ...(process.env.PATH ? process.env.PATH.split(':').map(dir => path.join(dir, 'codex')) : [])
    ]

    for (const candidate of possiblePaths) {
      if (candidate && fs.existsSync(candidate)) {
        return candidate
      }
    }

    throw new Error('Codex CLI not found. Please install Codex first.')
  }

  resolveModelName() {
    if (!this.projectSettings?.modelId) {
      return null
    }

    try {
      const appConfig = appConfigManager.loadConfig()
      const models = appConfig.settings?.models || []
      const modelConfig = models.find(model => model.id === this.projectSettings.modelId)
      if (!modelConfig) {
        return null
      }

      const cards = modelConfig.modelCards || []
      let targetCard = null
      if (this.projectSettings.modelCardId) {
        targetCard = cards.find(card => card.id === this.projectSettings.modelCardId)
      }
      if (!targetCard) {
        const defaultCardId = modelConfig.defaultCardId || cards[0]?.id
        targetCard = cards.find(card => card.id === defaultCardId) || cards[0]
      }

      return targetCard?.modelName || null
    } catch (error) {
      logger.warn('[CodexClient] Failed to resolve model name', { error: error.message })
      return null
    }
  }

  mapPermissionModeToApprovalPolicy() {
    switch (this.permissionMode) {
      case 'bypassPermissions':
        return 'never'
      case 'acceptEdits':
      case 'plan':
      case 'auto':
      case 'default':
      default:
        return 'on-request'
    }
  }

  async start() {
    if (this.process) {
      return
    }

    this.codexPath = this.detectCodexPath()
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

    this.process = spawn(this.codexPath, ['app-server', '--listen', 'stdio://'], {
      cwd: this.workingDirectory,
      env: codexEnv
    })

    this.setupStdioHandlers()

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(resolve, 500)

      this.process.once('error', error => {
        clearTimeout(timeout)
        reject(error)
      })

      this.process.once('exit', code => {
        clearTimeout(timeout)
        reject(new Error(`Codex CLI exited with code ${code}`))
      })
    })

    await this.request('initialize', {
      clientInfo: {
        name: 'ccgui',
        version: '1.0.0'
      },
      capabilities: {
        experimentalApi: true
      }
    })

    this.sendNotification('initialized')

    const threadParams = {
      cwd: this.workingDirectory,
      approvalPolicy: this.mapPermissionModeToApprovalPolicy(),
      sandbox: 'workspace-write',
      modelProvider: 'openai',
      experimentalRawEvents: false,
      persistExtendedHistory: true,
      ephemeral: false
    }

    const model = this.resolveModelName()
    if (model) {
      threadParams.model = model
    }

    const response = this.resumeThreadId
      ? await this.request('thread/resume', {
          threadId: this.resumeThreadId,
          cwd: threadParams.cwd,
          approvalPolicy: threadParams.approvalPolicy,
          sandbox: threadParams.sandbox,
          model: threadParams.model || null,
          modelProvider: threadParams.modelProvider,
          persistExtendedHistory: threadParams.persistExtendedHistory
        })
      : await this.request('thread/start', threadParams)

    if (response?.thread?.id) {
      this.currentThreadId = response.thread.id
      this.envInfo = applyCodexEnvInfoPatch({
        ...this.envInfo,
        session_id: response.thread.id,
        model: response.model || model || null,
        providerPid: this.getPid()
      }, {
        provider: 'codex',
        providerPid: this.getPid()
      })
      this.emit('env-info', this.envInfo)
    }
  }

  setupStdioHandlers() {
    let stdoutBuffer = ''

    this.process.stdout.on('data', data => {
      stdoutBuffer += data.toString()
      const lines = stdoutBuffer.split('\n')
      stdoutBuffer = lines.pop()

      lines.forEach(line => {
        if (!line.trim()) {
          return
        }

        try {
          const message = JSON.parse(line)
          this.handleMessage(message)
        } catch (error) {
          logger.warn('[CodexClient] Failed to parse stdout line', { error: error.message })
        }
      })
    })

    this.process.stderr.on('data', data => {
      const message = data.toString().trim()
      if (!message) {
        return
      }

      this.emit('cli-status', {
        type: 'status',
        message
      })
    })

    this.process.on('exit', (code, signal) => {
      this.emit('exit', { code, signal })
      this.process = null
    })
  }

  handleMessage(message) {
    if (this.sessionId) {
      logger.logReceive(this.sessionId, message)
    }

    if (message.id !== undefined) {
      const pending = this.pendingRequests.get(String(message.id))
      if (pending) {
        this.pendingRequests.delete(String(message.id))
        if (message.error) {
          pending.reject(new Error(message.error?.message || 'Codex request failed'))
        } else {
          pending.resolve(message.result)
        }
        return
      }

      const pendingServerRequest = this.pendingServerRequests.get(String(message.id))
      if (pendingServerRequest) {
        return
      }
    }

    if (message.method && message.params !== undefined) {
      if (message.id !== undefined) {
        this.pendingServerRequests.set(String(message.id), message)
        this.handleServerRequest(message)
        return
      }

      this.handleNotification(message)
    }
  }

  handleNotification(message) {
    this.emit('unknown_message', message)
  }

  handleServerRequest(message) {
    this.emit('unknown_message', message)
  }

  async sendMessage(message) {
    if (!this.currentThreadId) {
      throw new Error('Codex thread not initialized')
    }

    const text = getTextFromUserMessage(message)
    const result = await this.request('turn/start', {
      threadId: this.currentThreadId,
      input: [
        {
          type: 'text',
          text,
          text_elements: []
        }
      ],
      approvalPolicy: this.mapPermissionModeToApprovalPolicy()
    })

    this.currentTurnId = result?.turn?.id || this.currentTurnId
    return result
  }

  async sendControlResponse(requestId, approved, options = {}) {
    throw new Error(`Codex adapter must implement sendControlResponse: ${requestId}`)
  }

  async sendInterrupt() {
    if (!this.currentThreadId || !this.currentTurnId) {
      return
    }

    await this.request('turn/interrupt', {
      threadId: this.currentThreadId,
      turnId: this.currentTurnId
    })
  }

  async sendControlRequest(request) {
    if (request?.subtype === 'set_permission_mode' && request.mode) {
      this.permissionMode = request.mode
      return
    }
  }

  request(method, params) {
    const id = `${Date.now()}_${++this.requestCounter}`
    const payload = { id, method, params }

    if (this.sessionId) {
      logger.logSend(this.sessionId, payload)
    }

    this.process.stdin.write(JSON.stringify(payload) + '\n')

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })

      setTimeout(() => {
        if (!this.pendingRequests.has(id)) {
          return
        }
        this.pendingRequests.delete(id)
        reject(new Error(`Codex request timeout: ${method}`))
      }, 30000)
    })
  }

  sendNotification(method, params = undefined) {
    const payload = params === undefined ? { method } : { method, params }
    if (this.sessionId) {
      logger.logSend(this.sessionId, payload)
    }
    this.process.stdin.write(JSON.stringify(payload) + '\n')
  }

  sendResponse(id, result) {
    const payload = { id, result }
    if (this.sessionId) {
      logger.logSend(this.sessionId, payload)
    }
    this.process.stdin.write(JSON.stringify(payload) + '\n')
  }

  stop() {
    if (this.process) {
      this.process.kill('SIGTERM')
      this.process = null
    }
  }

  isReady() {
    return this.process !== null && this.process.stdin.writable && !!this.currentThreadId
  }

  getPid() {
    return this.process?.pid || null
  }

  getThreadId() {
    return this.currentThreadId
  }
}

module.exports = {
  CodexClient,
  normalizeToolName,
  normalizeCodexUsage,
  buildSessionUsageSummary,
  normalizeControlRequest,
  applyCodexEnvInfoPatch,
  createEmptyTurnUsage,
  mergeTurnUsage
}
