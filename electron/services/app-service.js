const fs = require('fs')
const os = require('os')
const path = require('path')
const logger = require('../logger')
const { appConfigManager } = require('../storage')
const {
  buildCodexModelProviderId,
  findProviderModel,
  getDefaultCredential
} = require('../adapters/shared/model-config')
const {
  listClaudeModels: loadClaudeModels
} = require('../adapters/claude/provider-api')
const {
  listCodexModels: loadCodexModels,
  setCodexDefaultModel: applyCodexDefaultModel,
  getCodexUsageStatus: loadCodexUsageStatus,
  refreshCodexAuthToken: runCodexAuthRefresh
} = require('../adapters/codex/provider-api')

let codexUsagePollTimer = null

function clampPercent(value) {
  if (!Number.isFinite(value)) return null
  return Math.min(Math.max(value, 0), 100)
}

function buildUsageWindow(window = null) {
  if (!window) return null

  const usedPercent = clampPercent(Number(window.used_percent))
  return {
    usedPercent,
    remainingPercent: usedPercent === null ? null : clampPercent(100 - usedPercent),
    limitWindowSeconds: Number(window.limit_window_seconds || 0) || 0,
    resetAfterSeconds: Number(window.reset_after_seconds || 0) || 0,
    resetAt: Number(window.reset_at || 0) || 0
  }
}

function mapCodexUsageSnapshot(usage = null) {
  if (!usage || typeof usage !== 'object') {
    return null
  }

  return {
    email: usage.email || '',
    userId: usage.user_id || '',
    accountId: usage.account_id || '',
    planType: usage.plan_type || '',
    primaryWindow: buildUsageWindow(usage.rate_limit?.primary_window || null),
    secondaryWindow: buildUsageWindow(usage.rate_limit?.secondary_window || null),
    codeReviewPrimaryWindow: buildUsageWindow(usage.code_review_rate_limit?.primary_window || null),
    updatedAt: new Date().toISOString(),
    raw: usage
  }
}

function getCodexAuthPath() {
  return path.join(os.homedir(), '.codex', 'auth.json')
}

function getCodexConfigPath() {
  return path.join(os.homedir(), '.codex', 'config.toml')
}

function parseTopLevelTomlValue(rawValue) {
  const value = String(rawValue || '').trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function stringifyTomlString(value) {
  return `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function readCodexConfigFile() {
  const codexConfigPath = getCodexConfigPath()
  if (!fs.existsSync(codexConfigPath)) {
    return {
      model: '',
      modelProvider: '',
      modelReasoningEffort: 'medium',
      apiUrl: '',
      rawContent: ''
    }
  }

  const rawContent = fs.readFileSync(codexConfigPath, 'utf-8')
  const result = {
    model: '',
    modelProvider: '',
    modelReasoningEffort: 'medium',
    apiUrl: '',
    rawContent
  }

  const providerBaseUrls = new Map()
  let currentSection = null

  for (const line of rawContent.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue

    const sectionMatch = trimmed.match(/^\[(.+)\]$/)
    if (sectionMatch) {
      currentSection = sectionMatch[1]
      continue
    }

    const entryMatch = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(.+?)\s*$/)
    if (!entryMatch) continue

    const [, key, rawValue] = entryMatch
    if (!currentSection) {
      if (key === 'model') {
        result.model = parseTopLevelTomlValue(rawValue)
      } else if (key === 'model_provider') {
        result.modelProvider = parseTopLevelTomlValue(rawValue)
      } else if (key === 'model_reasoning_effort') {
        result.modelReasoningEffort = parseTopLevelTomlValue(rawValue) || 'medium'
      }
      continue
    }

    const providerSectionMatch = currentSection.match(/^model_providers\.(.+)$/)
    if (providerSectionMatch && key === 'base_url') {
      providerBaseUrls.set(providerSectionMatch[1], parseTopLevelTomlValue(rawValue))
    }
  }

  result.apiUrl =
    providerBaseUrls.get(result.modelProvider) ||
    providerBaseUrls.get('ccgui') ||
    ''

  return result
}

function buildManagedCodexProviderEntries() {
  const appConfig = getAppConfig()
  const models = Array.isArray(appConfig.settings?.codexModels)
    ? appConfig.settings.codexModels
    : []

  return models
    .filter(model => model?.id && model?.apiUrl)
    .map(model => {
      const providerId = buildCodexModelProviderId(model.id)
      return {
        providerId,
        lines: [
          `[model_providers.${providerId}]`,
          `name = ${stringifyTomlString(model.friendlyName || 'ccgui')}`,
          `base_url = ${stringifyTomlString(model.apiUrl || '')}`,
          `wire_api = ${stringifyTomlString('responses')}`,
          `env_key = ${stringifyTomlString('CCGUI_AUTH_KEY')}`
        ]
      }
    })
}

function stripManagedCodexProviderSections(rawContent = '') {
  const lines = rawContent ? rawContent.split(/\r?\n/) : []
  const output = []
  let currentSection = null
  let skippingManagedSection = false

  for (const line of lines) {
    const trimmed = line.trim()
    const sectionMatch = trimmed.match(/^\[(.+)\]$/)
    if (sectionMatch) {
      currentSection = sectionMatch[1]
      if (currentSection.startsWith('model_providers.ccgui_model_')) {
        skippingManagedSection = true
        continue
      }

      skippingManagedSection = false
      output.push(line)
      continue
    }

    if (skippingManagedSection) {
      continue
    }

    output.push(line)
  }

  return output.join('\n')
}

function syncCodexModelProviders() {
  const codexConfigPath = getCodexConfigPath()
  const codexDir = path.dirname(codexConfigPath)
  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true })
  }

  const current = readCodexConfigFile()
  const managedEntries = buildManagedCodexProviderEntries()
  const baseContent = stripManagedCodexProviderSections(current.rawContent || '')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\s+$/g, '')
  const sectionContent = managedEntries.flatMap(entry => ['', ...entry.lines]).join('\n')
  const finalContent = `${baseContent}${sectionContent ? `${baseContent ? '\n' : ''}${sectionContent}` : ''}\n`
    .replace(/\n{3,}/g, '\n\n')

  fs.writeFileSync(codexConfigPath, finalContent, 'utf-8')

  return {
    providerCount: managedEntries.length,
    providerIds: managedEntries.map(entry => entry.providerId)
  }
}

function writeCodexConfigFile(updates = {}) {
  const codexConfigPath = getCodexConfigPath()
  const codexDir = path.dirname(codexConfigPath)
  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true })
  }

  syncCodexModelProviders()

  const current = readCodexConfigFile()
  const authState = readCodexAuthFile()
  const rawContent = current.rawContent || ''
  const lines = rawContent ? rawContent.split(/\r?\n/) : []
  const nextAuthMode = updates.authMode === 'chatgpt' || updates.authMode === 'provider'
    ? updates.authMode
    : (
        updates.modelProvider !== undefined || updates.authToken !== undefined || updates.apiUrl !== undefined
          ? 'provider'
          : authState.authMode
      )
  const nextModel = updates.model !== undefined ? updates.model : current.model
  const explicitProvider = updates.modelProvider !== undefined ? updates.modelProvider : null
  const nextProvider = nextAuthMode === 'chatgpt' ? '' : (explicitProvider || current.modelProvider || 'ccgui')
  const nextEffort = updates.modelReasoningEffort !== undefined ? updates.modelReasoningEffort : current.modelReasoningEffort
  const nextApiUrl = updates.apiUrl !== undefined ? updates.apiUrl : current.apiUrl
  const shouldWriteLegacyCcguiProvider = nextAuthMode !== 'chatgpt' && (
    explicitProvider === 'ccgui' || (explicitProvider === null && updates.apiUrl !== undefined)
  )

  const pendingTopLevel = new Map([
    ['model', stringifyTomlString(nextModel || '')],
    ['model_reasoning_effort', stringifyTomlString(nextEffort || 'medium')]
  ])
  if (nextAuthMode !== 'chatgpt') {
    pendingTopLevel.set('model_provider', stringifyTomlString(nextProvider || 'ccgui'))
  }

  const legacyCcguiEntries = [
    `name = ${stringifyTomlString('ccgui')}`,
    `base_url = ${stringifyTomlString(nextApiUrl || '')}`,
    `wire_api = ${stringifyTomlString('responses')}`,
    `env_key = ${stringifyTomlString('CCGUI_AUTH_KEY')}`
  ]

  let currentSection = null
  let skippingLegacyCcguiSection = false
  const output = []

  for (const line of lines) {
    const trimmed = line.trim()
    const sectionMatch = trimmed.match(/^\[(.+)\]$/)
    if (sectionMatch) {
      if (!currentSection && pendingTopLevel.size > 0) {
        for (const [key, value] of pendingTopLevel.entries()) {
          output.push(`${key} = ${value}`)
        }
        pendingTopLevel.clear()
        if (output.length > 0 && output[output.length - 1] !== '') {
          output.push('')
        }
      }

      if (skippingLegacyCcguiSection) {
        if (shouldWriteLegacyCcguiProvider) {
          output.push('')
          output.push('[model_providers.ccgui]')
          output.push(...legacyCcguiEntries)
          output.push('')
        }
        skippingLegacyCcguiSection = false
      }

      currentSection = sectionMatch[1]
      if (currentSection === 'model_providers.ccgui') {
        skippingLegacyCcguiSection = true
        continue
      }

      output.push(line)
      continue
    }

    if (skippingLegacyCcguiSection) {
      continue
    }

    if (!currentSection) {
      const entryMatch = line.match(/^(\s*)([A-Za-z0-9_-]+)(\s*=\s*)(.+?)(\s*)$/)
      if (entryMatch) {
        const [, indent, key, separator, , trailingSpace] = entryMatch
        if (nextAuthMode === 'chatgpt' && key === 'model_provider') {
          continue
        }
        if (pendingTopLevel.has(key)) {
          output.push(`${indent}${key}${separator}${pendingTopLevel.get(key)}${trailingSpace}`)
          pendingTopLevel.delete(key)
          continue
        }
      }
    }

    output.push(line)
  }

  if (skippingLegacyCcguiSection) {
    if (shouldWriteLegacyCcguiProvider) {
      output.push('')
      output.push('[model_providers.ccgui]')
      output.push(...legacyCcguiEntries)
    }
  }

  if (pendingTopLevel.size > 0) {
    if (output.length > 0 && output[output.length - 1].trim() !== '') {
      output.push('')
    }
    for (const [key, value] of pendingTopLevel.entries()) {
      output.push(`${key} = ${value}`)
    }
  }

  const hasLegacyCcguiSection = output.some(line => line.trim() === '[model_providers.ccgui]')
  if (shouldWriteLegacyCcguiProvider && !hasLegacyCcguiSection) {
    if (output.length > 0 && output[output.length - 1].trim() !== '') {
      output.push('')
    }
    output.push('[model_providers.ccgui]')
    output.push(...legacyCcguiEntries)
  }

  const finalContent = output.join('\n').replace(/\n{3,}/g, '\n\n') + '\n'
  fs.writeFileSync(codexConfigPath, finalContent, 'utf-8')

  return readCodexConfigFile()
}

function readCodexAuthFile() {
  const codexAuthPath = getCodexAuthPath()
  if (!fs.existsSync(codexAuthPath)) {
    return {
      authMode: 'provider',
      authToken: '',
      tokens: {
        idToken: '',
        accessToken: '',
        refreshToken: '',
        accountId: '',
        lastRefresh: ''
      },
      raw: {}
    }
  }

  const raw = JSON.parse(fs.readFileSync(codexAuthPath, 'utf-8'))
  const hasChatGptTokens = !!(
    raw?.tokens?.id_token ||
    raw?.tokens?.access_token ||
    raw?.tokens?.refresh_token ||
    raw?.tokens?.account_id
  )
  return {
    authMode: raw?.auth_mode === 'chatgpt' || hasChatGptTokens ? 'chatgpt' : 'provider',
    authToken: raw.OPENAI_API_KEY || '',
    tokens: {
      idToken: raw.tokens?.id_token || '',
      accessToken: raw.tokens?.access_token || '',
      refreshToken: raw.tokens?.refresh_token || '',
      accountId: raw.tokens?.account_id || '',
      lastRefresh: raw.last_refresh || raw.tokens?.last_refresh || ''
    },
    raw
  }
}

function writeCodexAuthFile(updates = {}) {
  const codexAuthPath = getCodexAuthPath()
  const codexDir = path.dirname(codexAuthPath)
  if (!fs.existsSync(codexDir)) {
    fs.mkdirSync(codexDir, { recursive: true })
  }

  const current = readCodexAuthFile()
  const nextMode = updates.authMode === 'chatgpt' || updates.authMode === 'provider'
    ? updates.authMode
    : (
        updates.modelProvider !== undefined || updates.authToken !== undefined || updates.apiUrl !== undefined
          ? 'provider'
          : current.authMode
      )

  let nextRaw
  if (nextMode === 'chatgpt') {
    nextRaw = {
      auth_mode: 'chatgpt',
      OPENAI_API_KEY: null,
      tokens: {
        id_token: updates.idToken ?? current.tokens?.idToken ?? '',
        access_token: updates.accessToken ?? current.tokens?.accessToken ?? '',
        refresh_token: updates.refreshToken ?? current.tokens?.refreshToken ?? '',
        account_id: updates.accountId ?? current.tokens?.accountId ?? ''
      },
      last_refresh: updates.lastRefresh ?? current.tokens?.lastRefresh ?? ''
    }
  } else {
    nextRaw = {
      OPENAI_API_KEY: updates.authToken !== undefined
        ? (updates.authToken || '')
        : (current.authMode === 'provider' ? (current.authToken || '') : '')
    }
  }

  fs.writeFileSync(codexAuthPath, JSON.stringify(nextRaw, null, 2), 'utf-8')
  return readCodexAuthFile()
}

function writeCodexAccountTokens(account = {}) {
  const nextAuth = writeCodexAuthFile({
    authMode: 'chatgpt',
    idToken: account.idToken || '',
    accessToken: account.accessToken || '',
    refreshToken: account.refreshToken || '',
    accountId: account.accountId || '',
    lastRefresh: account.lastRefresh || ''
  })
  return {
    idToken: nextAuth.tokens.idToken || '',
    accessToken: nextAuth.tokens.accessToken || '',
    refreshToken: nextAuth.tokens.refreshToken || '',
    accountId: nextAuth.tokens.accountId || '',
    lastRefresh: nextAuth.tokens.lastRefresh || ''
  }
}

function parseTimestamp(value) {
  if (!value) return 0
  const parsed = Date.parse(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function getAppConfig() {
  return appConfigManager.loadConfig()
}

function saveAppConfig(config) {
  return appConfigManager.saveConfig(config)
}

function updateAppConfig(updates) {
  return appConfigManager.updateConfig(updates)
}

function resolveCodexModelRuntime(modelId = null, modelCardId = null, credentialId = null) {
  if (!modelId) {
    return null
  }

  const appConfig = getAppConfig()
  const model = findProviderModel(appConfig, 'codex', modelId)
  if (!model) {
    return null
  }

  const cards = Array.isArray(model.modelCards) ? model.modelCards : []
  let targetCard = null
  if (modelCardId) {
    targetCard = cards.find(card => card.id === modelCardId)
  }
  if (!targetCard) {
    const defaultCardId = model.defaultCardId || cards[0]?.id
    targetCard = cards.find(card => card.id === defaultCardId) || cards[0] || null
  }

  const credential = getDefaultCredential(model, credentialId)

  return {
    modelId: model.id,
    modelName: targetCard?.modelName || model.model || '',
    credentialId: credential?.id || null,
    credentialName: credential?.name || '',
    authToken: credential?.token || '',
    apiUrl: model.apiUrl || '',
    providerId: buildCodexModelProviderId(model.id),
    envKey: 'CCGUI_AUTH_KEY'
  }
}

function loadCodexAuthTokens() {
  const auth = readCodexAuthFile()
  return auth.tokens || {
    idToken: '',
    accessToken: '',
    refreshToken: '',
    accountId: '',
    lastRefresh: ''
  }
}

function syncCodexAccountsWithAuthConfig() {
  const config = getAppConfig()
  const settings = config.settings || {}
  const accounts = Array.isArray(settings.codexAccounts) ? [...settings.codexAccounts] : []
  const authTokens = loadCodexAuthTokens()
  const authAccountId = authTokens.accountId || ''

  if (!authAccountId) {
    return config
  }

  let changed = false
  let matchedIndex = accounts.findIndex(account => account?.accountId === authAccountId)

  if (matchedIndex === -1) {
    accounts.push({
      id: Date.now().toString(),
      name: 'Codex 当前账号',
      email: '',
      accountId: authTokens.accountId || '',
      idToken: authTokens.idToken || '',
      accessToken: authTokens.accessToken || '',
      refreshToken: authTokens.refreshToken || '',
      lastRefresh: authTokens.lastRefresh || ''
    })
    matchedIndex = accounts.length - 1
    changed = true
  } else {
    const existing = accounts[matchedIndex]
    const existingRefresh = parseTimestamp(existing?.lastRefresh)
    const authRefresh = parseTimestamp(authTokens.lastRefresh)
    if (authRefresh >= existingRefresh) {
      accounts[matchedIndex] = {
        ...existing,
        email: existing.email || '',
        accountId: authTokens.accountId || existing.accountId || '',
        idToken: authTokens.idToken || existing.idToken || '',
        accessToken: authTokens.accessToken || existing.accessToken || '',
        refreshToken: authTokens.refreshToken || existing.refreshToken || '',
        lastRefresh: authTokens.lastRefresh || existing.lastRefresh || ''
      }
      changed = true
    }
  }

  const selectedAccountId = accounts[matchedIndex]?.id || null
  if (settings.selectedCodexAccountId !== selectedAccountId) {
    changed = true
  }

  if (!changed) {
    return config
  }

  return updateAppConfig({
    settings: {
      codexAccounts: accounts,
      selectedCodexAccountId: selectedAccountId
    }
  })
}

function applyCodexAccount(account = {}) {
  const appliedTokens = writeCodexAccountTokens(account)
  writeCodexConfigFile({ authMode: 'chatgpt' })
  const config = getAppConfig()
  const accounts = Array.isArray(config.settings?.codexAccounts) ? [...config.settings.codexAccounts] : []
  const index = accounts.findIndex(item => item.id === account?.id)

  if (index !== -1) {
    accounts[index] = {
      ...accounts[index],
      accountId: appliedTokens.accountId,
      idToken: appliedTokens.idToken,
      accessToken: appliedTokens.accessToken,
      refreshToken: appliedTokens.refreshToken,
      lastRefresh: appliedTokens.lastRefresh
    }
  }

  const updatedConfig = updateAppConfig({
    settings: {
      codexAccounts: accounts,
      selectedCodexAccountId: account?.id || null
    }
  })

  return {
    tokens: appliedTokens,
    config: updatedConfig
  }
}

async function getCodexUsageStatus() {
  const usage = await loadCodexUsageStatus()
  return mapCodexUsageSnapshot(usage)
}

async function listClaudeModels(options = {}) {
  return loadClaudeModels(options)
}

async function listCodexModels(options = {}) {
  return loadCodexModels(options)
}

async function setCodexDefaultModel(options = {}) {
  const result = await applyCodexDefaultModel(options)
  const settings = writeCodexConfigFile({
    model: result.model,
    modelReasoningEffort: result.reasoningEffort
  })

  return {
    ...result,
    settings
  }
}

async function refreshCodexAuthToken() {
  const refreshResult = await runCodexAuthRefresh()
  const config = syncCodexAccountsWithAuthConfig()
  const tokens = loadCodexAuthTokens()

  return {
    authMethod: refreshResult?.authMethod || null,
    authToken: refreshResult?.authToken || null,
    tokens,
    config
  }
}

async function refreshCodexAccountUsage(account = null) {
  const usage = await loadCodexUsageStatus(account ? { account } : {})
  return mapCodexUsageSnapshot(usage)
}

async function refreshAllCodexAccountUsage() {
  const config = getAppConfig()
  const settings = config.settings || {}
  const accounts = Array.isArray(settings.codexAccounts) ? [...settings.codexAccounts] : []

  if (accounts.length === 0) {
    return config
  }

  let changed = false
  const refreshedAccounts = await Promise.all(accounts.map(async account => {
    try {
      const usage = await refreshCodexAccountUsage(account)
      if (!usage) {
        return account
      }

      const nextAccount = {
        ...account,
        email: usage.email || account.email || '',
        usage
      }

      if (JSON.stringify(account.usage || null) !== JSON.stringify(usage)) {
        changed = true
      }

      return nextAccount
    } catch (error) {
      logger.warn('[CodexSettings] Failed to refresh codex account usage', {
        accountId: account?.accountId || account?.id || '',
        error: error.message
      })
      return account
    }
  }))

  if (!changed) {
    return config
  }

  return updateAppConfig({
    settings: {
      codexAccounts: refreshedAccounts
    }
  })
}

function startCodexAccountUsagePolling() {
  if (codexUsagePollTimer) {
    return
  }

  const run = async () => {
    try {
      await refreshAllCodexAccountUsage()
    } catch (error) {
      logger.warn('[CodexSettings] Codex account usage polling failed', { error: error.message })
    }
  }

  run()
  codexUsagePollTimer = setInterval(run, 60 * 1000)
}

module.exports = {
  applyCodexAccount,
  buildCodexModelProviderId,
  getAppConfig,
  listClaudeModels,
  listCodexModels,
  setCodexDefaultModel,
  getCodexConfigPath,
  getCodexUsageStatus,
  loadCodexAuthTokens,
  readCodexAuthFile,
  readCodexConfigFile,
  refreshAllCodexAccountUsage,
  refreshCodexAccountUsage,
  refreshCodexAuthToken,
  resolveCodexModelRuntime,
  saveAppConfig,
  startCodexAccountUsagePolling,
  syncCodexModelProviders,
  syncCodexAccountsWithAuthConfig,
  updateAppConfig,
  writeCodexAuthFile,
  writeCodexConfigFile
}
