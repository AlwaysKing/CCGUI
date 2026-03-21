const appConfigManager = require('../../storage/app-config-manager')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  CodexClient,
  extractChatGptAccountId,
  buildDesktopUserAgent,
  buildProxyAgent,
  requestJson
} = require('./client')

async function withCodexProviderClient(task, options = {}) {
  const client = new CodexClient(
    options.workingDirectory || process.cwd(),
    null,
    true,
    'default',
    null,
    { debug: options.debug === true }
  )

  try {
    await client.ensureInitialized()
    return await task(client)
  } finally {
    client.stop()
  }
}

async function requestUsageWithAccount(account = {}) {
  const appConfig = appConfigManager.loadConfig()
  const proxyUrl = appConfig.settings?.codexProxy || ''
  const agent = buildProxyAgent(proxyUrl)
  const authToken = account.accessToken || account.authToken || ''
  const accountId = account.accountId || extractChatGptAccountId(authToken) || ''

  if (!authToken) {
    throw new Error('Missing Codex account access token')
  }

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${authToken}`,
    originator: 'Codex Desktop',
    'User-Agent': buildDesktopUserAgent()
  }

  if (accountId) {
    headers['ChatGPT-Account-Id'] = accountId
  }

  const response = await requestJson('https://chatgpt.com/backend-api/wham/usage', {
    method: 'GET',
    headers,
    agent
  })

  if (response.statusCode < 200 || response.statusCode >= 300) {
    const error = new Error(
      `Codex usage request failed: ${response.statusCode} ${response.body || ''}`.trim()
    )
    error.statusCode = response.statusCode
    throw error
  }

  return response.json || null
}

async function getCodexUsageStatus(options = {}) {
  if (options.account) {
    return requestUsageWithAccount(options.account)
  }

  return withCodexProviderClient(client => client.getUsageStatus(), options)
}

async function refreshCodexAuthToken(options = {}) {
  return withCodexProviderClient(client => client.refreshAuthToken(), options)
}

function normalizeReasoningEffortOption(option = null) {
  if (!option || typeof option !== 'object') {
    return null
  }

  const reasoningEffort = typeof option.reasoningEffort === 'string'
    ? option.reasoningEffort
    : ''

  if (!reasoningEffort) {
    return null
  }

  return {
    reasoningEffort,
    description: typeof option.description === 'string' ? option.description : ''
  }
}

function normalizeCodexModelEntry(entry = null) {
  if (!entry || typeof entry !== 'object') {
    return null
  }

  const model = typeof entry.model === 'string' ? entry.model : ''
  if (!model) {
    return null
  }

  const supportedReasoningEfforts = Array.isArray(entry.supportedReasoningEfforts)
    ? entry.supportedReasoningEfforts
      .map(normalizeReasoningEffortOption)
      .filter(Boolean)
    : []

  return {
    model,
    hidden: entry.hidden === true,
    isDefault: entry.isDefault === true,
    defaultReasoningEffort: typeof entry.defaultReasoningEffort === 'string'
      ? entry.defaultReasoningEffort
      : '',
    supportedReasoningEfforts,
    raw: entry
  }
}

function readCodexDefaultReasoningEffort() {
  try {
    const appConfig = appConfigManager.loadConfig()
    const configPath = path.join(os.homedir(), '.codex', 'config.toml')
    if (!fs.existsSync(configPath)) {
      return appConfig.settings?.modelReasoningEffort || ''
    }

    const content = fs.readFileSync(configPath, 'utf8')
    for (const line of content.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('[')) {
        continue
      }

      const match = trimmed.match(/^model_reasoning_effort\s*=\s*(.+)$/)
      if (!match) {
        continue
      }

      return String(match[1] || '')
        .trim()
        .replace(/^['"]|['"]$/g, '')
    }
  } catch (error) {
    return ''
  }

  return ''
}

async function listCodexModels(options = {}) {
  const result = await withCodexProviderClient(
    client => client.listModels({
      includeHidden: options.includeHidden === true,
      cursor: options.cursor ?? null,
      limit: Number.isFinite(options.limit) ? Number(options.limit) : 100
    }),
    options
  )

  const data = Array.isArray(result?.data)
    ? result.data.map(normalizeCodexModelEntry).filter(Boolean)
    : []

  return {
    data,
    nextCursor: result?.nextCursor ?? null,
    raw: result || null
  }
}

async function listCodexReasoningCapabilities(options = {}) {
  const modelId = typeof options.model === 'string' ? options.model.trim() : ''
  const result = await listCodexModels(options)
  const entries = Array.isArray(result.data) ? result.data : []
  const matched = entries.find(entry => entry.model === modelId) || null
  const optionsList = Array.isArray(matched?.supportedReasoningEfforts) && matched.supportedReasoningEfforts.length > 0
    ? matched.supportedReasoningEfforts.map(option => ({
      value: option.reasoningEffort,
      label: option.reasoningEffort,
      description: option.description || ''
    }))
    : []

  return {
    provider: 'codex',
    model: modelId || matched?.model || '',
    supportsRuntimeSwitch: true,
    defaultValue: matched?.defaultReasoningEffort || readCodexDefaultReasoningEffort() || 'medium',
    options: optionsList,
    raw: matched?.raw || null
  }
}

async function setCodexDefaultModel(options = {}) {
  const model = typeof options.model === 'string' ? options.model.trim() : ''
  const reasoningEffort = typeof options.reasoningEffort === 'string'
    ? options.reasoningEffort.trim()
    : 'medium'

  if (!model) {
    throw new Error('Missing Codex model')
  }

  const result = await withCodexProviderClient(
    client => client.setDefaultModelConfig(model, reasoningEffort || 'medium'),
    options
  )

  return {
    model,
    reasoningEffort: reasoningEffort || 'medium',
    raw: result || null
  }
}

module.exports = {
  listCodexModels,
  listCodexReasoningCapabilities,
  setCodexDefaultModel,
  getCodexUsageStatus,
  refreshCodexAuthToken
}
