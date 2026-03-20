export function normalizeProvider(provider, fallback = 'claude') {
  if (provider === 'codex') return 'codex'
  if (provider === 'claude') return 'claude'
  return fallback
}

export function getProviderModels(appConfig, provider = 'claude') {
  const normalizedProvider = normalizeProvider(provider)
  const settings = appConfig?.settings || {}
  return normalizedProvider === 'codex'
    ? (settings.codexModels || [])
    : (settings.claudeModels || [])
}

export function findProviderModel(appConfig, provider = 'claude', modelId = null) {
  if (!modelId) return null
  return getProviderModels(appConfig, provider).find(model => model.id === modelId) || null
}
