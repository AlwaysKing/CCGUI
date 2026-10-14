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

function resolveProviderModelCard(model = null, cardId = null) {
  const cards = Array.isArray(model?.modelCards) ? model.modelCards : []
  if (cards.length === 0) {
    return null
  }

  const targetCardId = cardId || model.defaultCardId || cards[0].id
  return cards.find(card => card.id === targetCardId) || cards[0]
}

/**
 * 构造传给 claude / codex 的代理模型名：<供应商ID>/<模型名>
 */
function buildProxyModelString(appConfig, provider = 'claude', settings = {}) {
  const model = findProviderModel(appConfig, provider, settings?.modelId)
  if (!model) {
    return ''
  }

  const card = resolveProviderModelCard(model, settings?.modelCardId)
  return card?.modelName ? `${model.id}/${card.modelName}` : ''
}

/**
 * 构造运行时使用的模型名（CCGUI 代理路由键）
 * - 传了 modelOverride（例如界面选了某个模型卡片名）时优先用它，必要时补上供应商前缀
 * - 否则按已解析的设置取默认卡片
 */
function buildRuntimeModelName(appConfig, provider = 'claude', modelOverride = '', settings = {}) {
  const override = typeof modelOverride === 'string' ? modelOverride.trim() : ''
  if (override) {
    if (override.includes('/')) {
      return override
    }

    const model = findProviderModel(appConfig, provider, settings?.modelId)
    return model ? `${model.id}/${override}` : override
  }

  return buildProxyModelString(appConfig, provider, settings)
}

/**
 * 去掉代理模型名里的供应商前缀，用于界面展示
 * 只有前缀确实是已配置的供应商 ID 时才剥离，避免误伤真实模型名中的斜杠
 */
function stripProxyProviderPrefix(appConfig, provider = 'claude', modelName = '') {
  const rawValue = typeof modelName === 'string' ? modelName.trim() : ''
  const separatorIndex = rawValue.indexOf('/')
  if (separatorIndex <= 0) {
    return rawValue
  }

  const providerKey = rawValue.slice(0, separatorIndex)
  const matched = getProviderModels(appConfig, provider).find(model => model?.id === providerKey)
  return matched ? rawValue.slice(separatorIndex + 1) : rawValue
}

module.exports = {
  buildRuntimeModelName,
  buildProxyModelString,
  buildCodexModelProviderId,
  getDefaultCredential,
  getModelCredentials,
  normalizeProvider,
  normalizeModelConfig,
  getProviderModels,
  findProviderModel,
  resolveProviderModelCard,
  stripProxyProviderPrefix
}
