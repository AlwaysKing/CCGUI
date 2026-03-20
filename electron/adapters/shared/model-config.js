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

function getProviderModels(appConfig, provider = 'claude') {
  const normalizedProvider = normalizeProvider(provider)
  const settings = appConfig?.settings || {}
  return normalizedProvider === 'codex'
    ? (settings.codexModels || [])
    : (settings.claudeModels || [])
}

function findProviderModel(appConfig, provider = 'claude', modelId = null) {
  if (!modelId) return null
  return getProviderModels(appConfig, provider).find(model => model.id === modelId) || null
}

module.exports = {
  buildCodexModelProviderId,
  normalizeProvider,
  getProviderModels,
  findProviderModel
}
