const appConfigManager = require('../../storage/app-config-manager')
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

module.exports = {
  getCodexUsageStatus,
  refreshCodexAuthToken
}
