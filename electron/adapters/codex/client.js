const { spawn } = require('child_process')
const fs = require('fs')
const https = require('https')
const os = require('os')
const path = require('path')
const logger = require('../../logger')
const appConfigManager = require('../../storage/app-config-manager')
const {
  buildCodexModelProviderId,
  findProviderModel
} = require('../shared/model-config')
const {
  createEmptyTurnUsage,
  mergeTurnUsage
} = require('../shared/usage')

let HttpsProxyAgent = null
try {
  HttpsProxyAgent = require('https-proxy-agent').HttpsProxyAgent
} catch (error) {
  HttpsProxyAgent = null
}

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value
    }
  }
  return null
}

function parseTomlTopLevelValue(rawValue) {
  if (typeof rawValue !== 'string') {
    return null
  }

  const trimmed = rawValue.trim()
  if (!trimmed) {
    return null
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1)
  }

  return trimmed
}

function readCodexDefaultModelProvider() {
  try {
    const configPath = path.join(os.homedir(), '.codex', 'config.toml')
    if (!fs.existsSync(configPath)) {
      return null
    }

    const content = fs.readFileSync(configPath, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) {
        continue
      }

      const separatorIndex = trimmed.indexOf('=')
      if (separatorIndex === -1) {
        continue
      }

      const key = trimmed.slice(0, separatorIndex).trim()
      if (key !== 'model_provider') {
        continue
      }

      const value = parseTomlTopLevelValue(trimmed.slice(separatorIndex + 1))
      return value || null
    }

    return null
  } catch (error) {
    logger.warn('[CodexClient] Failed to read default model provider from config.toml', {
      error: error.message
    })
    return null
  }
}

function readCodexAuthAccountId() {
  try {
    const authPath = path.join(os.homedir(), '.codex', 'auth.json')
    if (!fs.existsSync(authPath)) {
      return ''
    }

    const raw = JSON.parse(fs.readFileSync(authPath, 'utf8'))
    return raw?.tokens?.account_id || ''
  } catch (error) {
    logger.warn('[CodexClient] Failed to read auth account id', { error: error.message })
    return ''
  }
}

function buildCodexEnvRateLimits(usage = null, accountName = '') {
  if (!usage || typeof usage !== 'object') {
    return null
  }

  const primary = usage.primaryWindow
  const secondary = usage.secondaryWindow
  const hasPrimary = primary && primary.remainingPercent !== null
  const hasSecondary = secondary && secondary.remainingPercent !== null

  if (!hasPrimary && !hasSecondary) {
    return null
  }

  return {
    planType: usage.planType || null,
    limitName: accountName || usage.email || usage.accountId || null,
    primary: hasPrimary
      ? {
          label: '5小时',
          used: primary.usedPercent,
          resetAfter: primary.resetAfterSeconds || null
        }
      : null,
    secondary: hasSecondary
      ? {
          label: '1周',
          used: secondary.usedPercent,
          resetAfter: secondary.resetAfterSeconds || null
        }
      : null
  }
}

function resolveActiveCodexAccountUsage() {
  try {
    const appConfig = appConfigManager.loadConfig()
    const accounts = Array.isArray(appConfig.settings?.codexAccounts)
      ? appConfig.settings.codexAccounts
      : []
    const authAccountId = readCodexAuthAccountId()
    const selectedAccountId = appConfig.settings?.selectedCodexAccountId || null

    const matchedAccount = accounts.find(account => account?.accountId === authAccountId)
      || accounts.find(account => account?.id === selectedAccountId)
      || null

    if (!matchedAccount?.usage) {
      return null
    }

    const accountName =
      matchedAccount.name ||
      matchedAccount.email ||
      matchedAccount.accountId ||
      ''

    return {
      accountId: matchedAccount.accountId || authAccountId || '',
      accountName,
      usage: matchedAccount.usage,
      rateLimits: buildCodexEnvRateLimits(matchedAccount.usage, accountName)
    }
  } catch (error) {
    logger.warn('[CodexClient] Failed to resolve active codex account usage', {
      error: error.message
    })
    return null
  }
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

function decodeJwtPayload(token) {
  if (!token || typeof token !== 'string') {
    return null
  }

  const segments = token.split('.')
  if (segments.length < 2) {
    return null
  }

  try {
    return JSON.parse(Buffer.from(segments[1], 'base64url').toString('utf8'))
  } catch (error) {
    return null
  }
}

function extractChatGptAccountId(token) {
  const payload = decodeJwtPayload(token)
  const auth = payload?.['https://api.openai.com/auth']
  const accountId = auth?.chatgpt_account_id
  return typeof accountId === 'string' ? accountId : null
}

function buildDesktopUserAgent() {
  return `Codex Desktop/1.0.0 (${process.platform}; ${process.arch})`
}

function buildProxyAgent(proxyUrl) {
  if (!proxyUrl || !HttpsProxyAgent) {
    return null
  }

  try {
    return new HttpsProxyAgent(proxyUrl)
  } catch (error) {
    logger.warn('[CodexClient] Failed to create proxy agent', { error: error.message })
    return null
  }
}

function requestJson(url, options = {}) {
  return new Promise((resolve, reject) => {
    const request = https.request(url, options, response => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', chunk => {
        body += chunk
      })
      response.on('end', () => {
        let parsedBody = null
        if (body) {
          try {
            parsedBody = JSON.parse(body)
          } catch (error) {
            parsedBody = null
          }
        }

        resolve({
          statusCode: response.statusCode || 0,
          headers: response.headers,
          body,
          json: parsedBody
        })
      })
    })

    request.on('error', reject)
    request.end()
  })
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
    this.debugEnabled = options.debug === true

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
    this.initialized = false
    this.authTokenCache = null
    this.authTokenPromise = null
    this.accountUsageRefreshTimer = null
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

  setDebugEnabled(enabled) {
    this.debugEnabled = enabled === true
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

  resolveModelRuntime() {
    if (this.projectSettings?.modelMode !== 'custom' || !this.projectSettings?.modelId) {
      return null
    }

    try {
      const appConfig = appConfigManager.loadConfig()
      const modelConfig = findProviderModel(appConfig, 'codex', this.projectSettings.modelId)
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

      return {
        modelName: targetCard?.modelName || null,
        modelProvider: buildCodexModelProviderId(modelConfig.id),
        authToken: modelConfig.authToken || null
      }
    } catch (error) {
      logger.warn('[CodexClient] Failed to resolve model runtime', { error: error.message })
      return null
    }
  }

  async buildDeveloperInstructions() {
    if (!this.projectSettings) {
      return null
    }

    const parts = []

    try {
      const appConfig = appConfigManager.loadConfig()
      const promptIds = Array.isArray(this.projectSettings.promptIds)
        ? this.projectSettings.promptIds
        : []

      if (promptIds.length > 0) {
        const prompts = appConfig.settings?.prompts || []
        for (const promptId of promptIds) {
          const prompt = prompts.find(item => item.id === promptId)
          if (prompt?.content) {
            parts.push(prompt.content)
          }
        }
      }

      const documentIds = Array.isArray(this.projectSettings.documentIds)
        ? this.projectSettings.documentIds
        : []

      if (documentIds.length > 0) {
        const docsDir = path.join(os.homedir(), '.ccgui', 'docs')
        const docPaths = []

        for (const docId of documentIds) {
          const filePath = path.join(docsDir, `${docId}.md`)
          if (fs.existsSync(filePath)) {
            docPaths.push(filePath)
          }
        }

        if (docPaths.length > 0) {
          parts.push(`请始终遵循如下文档的规范要求: ${docPaths.join(', ')}`)
        }
      }
    } catch (error) {
      logger.warn('[CodexClient] Failed to build developer instructions', {
        error: error.message
      })
    }

    if (parts.length === 0) {
      return null
    }

    return parts.join('\n\n')
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
    await this.ensureInitialized()

    if (this.currentThreadId) {
      return
    }

    const threadParams = {
      cwd: this.workingDirectory,
      approvalPolicy: this.mapPermissionModeToApprovalPolicy(),
      sandbox: 'workspace-write',
      modelProvider: readCodexDefaultModelProvider() || 'openai',
      experimentalRawEvents: false,
      persistExtendedHistory: true,
      ephemeral: false
    }

    const modelRuntime = this.resolveModelRuntime()
    if (this.projectSettings?.modelMode === 'custom' && modelRuntime) {
      if (modelRuntime.modelName) {
        threadParams.model = modelRuntime.modelName
      }
      if (modelRuntime.modelProvider) {
        threadParams.modelProvider = modelRuntime.modelProvider
      }
    }

    const developerInstructions = await this.buildDeveloperInstructions()
    if (developerInstructions) {
      threadParams.developerInstructions = developerInstructions
    }

    const response = this.resumeThreadId
      ? await this.request('thread/resume', {
          threadId: this.resumeThreadId,
          cwd: threadParams.cwd,
          approvalPolicy: threadParams.approvalPolicy,
          sandbox: threadParams.sandbox,
          model: threadParams.model || null,
          modelProvider: threadParams.modelProvider,
          persistExtendedHistory: threadParams.persistExtendedHistory,
          developerInstructions: threadParams.developerInstructions || null
        })
      : await this.request('thread/start', threadParams)

    if (response?.thread?.id) {
      const activeCodexAccountUsage =
        threadParams.modelProvider === 'openai' ? resolveActiveCodexAccountUsage() : null

      this.currentThreadId = response.thread.id
      this.envInfo = applyCodexEnvInfoPatch({
        ...this.envInfo,
        session_id: response.thread.id,
        model: response.model || modelRuntime?.modelName || null,
        providerPid: this.getPid(),
        rate_limits: activeCodexAccountUsage?.rateLimits || null
      }, {
        provider: 'codex',
        providerPid: this.getPid()
      })
      this.emit('env-info', this.envInfo)

      if (threadParams.modelProvider === 'openai') {
        this.startAccountUsageRefresh()
      } else {
        this.stopAccountUsageRefresh()
      }
    }
  }

  refreshOpenAiAccountUsageEnvInfo() {
    const activeCodexAccountUsage = resolveActiveCodexAccountUsage()
    if (!activeCodexAccountUsage || !this.envInfo) {
      return
    }

    this.envInfo = applyCodexEnvInfoPatch({
      ...this.envInfo,
      rate_limits: activeCodexAccountUsage.rateLimits || null
    }, {
      provider: 'codex',
      providerPid: this.getPid()
    })
    this.emit('env-info', this.envInfo)
  }

  startAccountUsageRefresh() {
    this.stopAccountUsageRefresh()
    this.refreshOpenAiAccountUsageEnvInfo()
    this.accountUsageRefreshTimer = setInterval(() => {
      this.refreshOpenAiAccountUsageEnvInfo()
    }, 60 * 1000)
  }

  stopAccountUsageRefresh() {
    if (this.accountUsageRefreshTimer) {
      clearInterval(this.accountUsageRefreshTimer)
      this.accountUsageRefreshTimer = null
    }
  }

  async ensureInitialized() {
    if (this.process && this.initialized) {
      return
    }

    if (this.process && !this.initialized) {
      await this.initializeAppServer()
      return
    }

    this.codexPath = this.detectCodexPath()
    const appConfig = appConfigManager.loadConfig()
    const proxyUrl = appConfig.settings?.codexProxy || ''
    const modelRuntime = this.resolveModelRuntime()
    const codexEnv = {
      ...process.env
    }

    if (proxyUrl) {
      codexEnv.HTTP_PROXY = proxyUrl
      codexEnv.HTTPS_PROXY = proxyUrl
      codexEnv.ALL_PROXY = proxyUrl
    }

    if (modelRuntime?.authToken) {
      codexEnv.OPENAI_API_KEY = modelRuntime.authToken
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

    await this.initializeAppServer()
  }

  async initializeAppServer() {
    if (this.initialized) {
      return
    }

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
    this.initialized = true
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
      if (this.debugEnabled && this.sessionId) {
        logger.logReceive(this.sessionId, message)
      }
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
    await this.ensureInitialized()

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
    await this.ensureInitialized()

    if (!this.currentThreadId || !this.currentTurnId) {
      return
    }

    await this.request('turn/interrupt', {
      threadId: this.currentThreadId,
      turnId: this.currentTurnId
    })
  }

  async sendControlRequest(request) {
    await this.ensureInitialized()

    if (request?.subtype === 'set_permission_mode' && request.mode) {
      this.permissionMode = request.mode
      return
    }
  }

  async requestAuthStatus(options = {}) {
    const refreshToken = options.refreshToken === true
    const includeToken = options.includeToken !== false

    await this.ensureInitialized()

    return this.request('getAuthStatus', {
      includeToken,
      refreshToken
    })
  }

  async getAuthToken(options = {}) {
    const refreshToken = options.refreshToken === true

    await this.ensureInitialized()

    if (!refreshToken && this.authTokenCache) {
      return this.authTokenCache
    }

    if (refreshToken) {
      return this.fetchAuthToken(true)
    }

    if (this.authTokenPromise) {
      return this.authTokenPromise
    }

    this.authTokenPromise = this.fetchAuthToken(false)
      .finally(() => {
        this.authTokenPromise = null
      })

    return this.authTokenPromise
  }

  async fetchAuthToken(refreshToken = false) {
    const status = await this.requestAuthStatus({
      refreshToken,
      includeToken: true
    })

    const token =
      (status?.authMethod === 'chatgpt'
        ? pickFirstDefined(status?.authToken, status?.accessToken)
        : null) || null

    this.authTokenCache = token
    return token
  }

  clearAuthTokenCache() {
    this.authTokenCache = null
    this.authTokenPromise = null
  }

  async refreshAuthToken() {
    const status = await this.requestAuthStatus({
      refreshToken: true,
      includeToken: true
    })

    this.clearAuthTokenCache()
    const authToken = await this.getAuthToken({ refreshToken: false })

    return {
      ...status,
      authToken
    }
  }

  async getUsageStatus() {
    await this.ensureInitialized()

    const appConfig = appConfigManager.loadConfig()
    const proxyUrl = appConfig.settings?.codexProxy || ''
    const agent = buildProxyAgent(proxyUrl)

    const execute = async authToken => {
      if (!authToken) {
        throw new Error('Missing Codex auth token')
      }

      const accountId = extractChatGptAccountId(authToken)
      const headers = {
        Accept: 'application/json',
        Authorization: `Bearer ${authToken}`,
        originator: 'Codex Desktop',
        'User-Agent': buildDesktopUserAgent()
      }

      if (accountId) {
        headers['ChatGPT-Account-Id'] = accountId
      }

      return requestJson('https://chatgpt.com/backend-api/wham/usage', {
        method: 'GET',
        headers,
        agent
      })
    }

    let authToken = await this.getAuthToken({ refreshToken: false })
    let response = await execute(authToken)

    if (response.statusCode === 401) {
      authToken = await this.getAuthToken({ refreshToken: true })
      response = await execute(authToken)
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      throw new Error(
        `Codex usage request failed: ${response.statusCode} ${response.body || ''}`.trim()
      )
    }

    return response.json || null
  }

  request(method, params) {
    const id = `${Date.now()}_${++this.requestCounter}`
    const payload = { id, method, params }

    if (this.sessionId) {
      if (this.debugEnabled && this.sessionId) {
        logger.logSend(this.sessionId, payload)
      }
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
      if (this.debugEnabled && this.sessionId) {
        logger.logSend(this.sessionId, payload)
      }
    }
    this.process.stdin.write(JSON.stringify(payload) + '\n')
  }

  sendResponse(id, result) {
    const payload = { id, result }
    if (this.sessionId) {
      if (this.debugEnabled && this.sessionId) {
        logger.logSend(this.sessionId, payload)
      }
    }
    this.process.stdin.write(JSON.stringify(payload) + '\n')
  }

  stop() {
    this.stopAccountUsageRefresh()
    if (this.process) {
      this.process.kill('SIGTERM')
      this.process = null
    }
    this.initialized = false
    this.clearAuthTokenCache()
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
  mergeTurnUsage,
  extractChatGptAccountId,
  buildDesktopUserAgent,
  buildProxyAgent,
  requestJson
}
