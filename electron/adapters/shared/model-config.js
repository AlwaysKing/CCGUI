function normalizeProvider(provider, fallback = 'claude') {
  if (provider === 'codex') return 'codex'
  if (provider === 'claude') return 'claude'
  return fallback
}

function sanitizeCodexProviderSuffix(value = '') {
  return String(value || '')
    .trim()
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

function buildCodexModelProviderId(modelId = '') {
  const suffix = sanitizeCodexProviderSuffix(modelId)
  return suffix ? `ccgui_model_${suffix}` : 'ccgui'
}

function generateCredentialId() {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

function normalizeCredential(credential = {}, fallbackIndex = 0) {
  const token = typeof credential?.token === 'string'
    ? credential.token
    : (typeof credential?.authToken === 'string' ? credential.authToken : '')
  const name = typeof credential?.name === 'string' && credential.name.trim()
    ? credential.name.trim()
    : `令牌 ${fallbackIndex + 1}`
  const id = typeof credential?.id === 'string' && credential.id.trim()
    ? credential.id.trim()
    : generateCredentialId()

  return {
    id,
    name,
    token
  }
}

function getModelCredentials(model = null) {
  if (!model || typeof model !== 'object') {
    return []
  }

  const rawCredentials = Array.isArray(model.credentials)
    ? model.credentials
    : []

  const normalized = rawCredentials
    .map((credential, index) => normalizeCredential(credential, index))
    .filter(credential => credential.token)

  if (normalized.length > 0) {
    return normalized
  }

  if (typeof model.authToken === 'string' && model.authToken.trim()) {
    return [
      {
        id: typeof model.defaultCredentialId === 'string' && model.defaultCredentialId.trim()
          ? model.defaultCredentialId.trim()
          : 'default',
        name: '默认',
        token: model.authToken
      }
    ]
  }

  return []
}

function getDefaultCredential(model = null, preferredCredentialId = null) {
  const credentials = getModelCredentials(model)
  if (!credentials.length) {
    return null
  }

  const preferredId = typeof preferredCredentialId === 'string' ? preferredCredentialId.trim() : ''
  if (preferredId) {
    const preferred = credentials.find(credential => credential.id === preferredId)
    if (preferred) {
      return preferred
    }
  }

  const defaultCredentialId = typeof model?.defaultCredentialId === 'string'
    ? model.defaultCredentialId.trim()
    : ''
  if (defaultCredentialId) {
    const defaultCredential = credentials.find(credential => credential.id === defaultCredentialId)
    if (defaultCredential) {
      return defaultCredential
    }
  }

  return credentials[0]
}

function normalizeModelConfig(model = null) {
  if (!model || typeof model !== 'object') {
    return model
  }

  const credentials = getModelCredentials(model)
  const defaultCredential = getDefaultCredential(model)

  return {
    ...model,
    credentials,
    defaultCredentialId: defaultCredential?.id || null,
    authToken: defaultCredential?.token || ''
  }
}

function getProviderModels(appConfig, provider = 'claude') {
  const normalizedProvider = normalizeProvider(provider)
  const settings = appConfig?.settings || {}
  const models = normalizedProvider === 'codex'
    ? (settings.codexModels || [])
    : (settings.claudeModels || [])
  return models.map(normalizeModelConfig)
}

function findProviderModel(appConfig, provider = 'claude', modelId = null) {
  if (!modelId) return null
  return getProviderModels(appConfig, provider).find(model => model.id === modelId) || null
}

module.exports = {
  buildCodexModelProviderId,
  getDefaultCredential,
  getModelCredentials,
  normalizeProvider,
  normalizeModelConfig,
  getProviderModels,
  findProviderModel
}
