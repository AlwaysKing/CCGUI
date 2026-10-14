/**
 * 本地代理路由解析
 * 把模型名 <供应商ID>/<模型名> 解析成真实的供应商、凭据与上游地址
 */

const appConfigManager = require('../../storage/app-config-manager')
const { getDefaultCredential } = require('../../adapters/shared/model-config')

function getProviderModels(appConfig, tool) {
  const settings = appConfig?.settings || {}
  const models = tool === 'codex' ? settings.codexModels : settings.claudeModels
  return Array.isArray(models) ? models : []
}

function findProviderByKey(models, key) {
  const normalizedKey = String(key || '').trim()
  if (!normalizedKey) {
    return null
  }

  return models.find(model => model?.id === normalizedKey)
    || models.find(model => model?.friendlyName === normalizedKey)
    || null
}

function getModelCards(provider) {
  return Array.isArray(provider?.modelCards) ? provider.modelCards : []
}

function resolveModelCard(provider, cardKey = '', fallbackCardId = null) {
  const cards = getModelCards(provider)
  if (cards.length === 0) {
    return null
  }

  const normalizedCardKey = String(cardKey || '').trim()
  if (normalizedCardKey) {
    const byName = cards.find(card => card?.modelName === normalizedCardKey)
    if (byName) {
      return byName
    }

    const byId = cards.find(card => card?.id === normalizedCardKey)
    if (byId) {
      return byId
    }
  }

  return resolveDefaultModelCard(provider, fallbackCardId)
}

function resolveDefaultModelCard(provider, fallbackCardId = null) {
  const cards = getModelCards(provider)
  if (cards.length === 0) {
    return null
  }

  const preferredCardId = fallbackCardId || provider.defaultCardId || cards[0]?.id
  return cards.find(card => card?.id === preferredCardId) || cards[0]
}

function hasModelCard(provider, cardKey = '') {
  const normalizedCardKey = String(cardKey || '').trim()
  if (!normalizedCardKey) {
    return false
  }

  return getModelCards(provider).some(card =>
    card?.modelName === normalizedCardKey || card?.id === normalizedCardKey
  )
}

// 子 agent / 后台任务可能发来别名或 Claude 官方模型名，这类按当前会话的模型处理
function isAliasModelName(modelName = '') {
  const normalized = String(modelName || '').trim()
  if (!normalized) {
    return false
  }

  return /^(default|inherit|sonnet|opus|haiku)$/i.test(normalized)
    || /^claude-.*(opus|sonnet|haiku)/i.test(normalized)
}

function parseModelName(modelName = '') {
  const rawValue = String(modelName || '').trim()
  if (!rawValue) {
    return { providerKey: null, modelKey: '' }
  }

  const separatorIndex = rawValue.indexOf('/')
  if (separatorIndex <= 0) {
    return { providerKey: null, modelKey: rawValue }
  }

  return {
    providerKey: rawValue.slice(0, separatorIndex),
    modelKey: rawValue.slice(separatorIndex + 1)
  }
}

function buildModelName(providerId, modelName) {
  return `${providerId}/${modelName || ''}`
}

/**
 * 解析本次请求应该转发到哪个供应商
 * 供应商选择优先取模型名前缀，解析不到时回退到会话当前的模型配置
 */
function resolveProxyTarget(options = {}) {
  const tool = options.tool === 'codex' ? 'codex' : 'claude'
  const appConfig = options.appConfig || appConfigManager.loadConfig()
  const models = getProviderModels(appConfig, tool)
  const session = options.session || null
  const sessionSettings = session?.resolveSettings ? (session.resolveSettings() || {}) : {}
  const parsed = parseModelName(options.modelName)

  let provider = findProviderByKey(models, parsed.providerKey)
  if (!provider && sessionSettings.modelId) {
    provider = findProviderByKey(models, sessionSettings.modelId)
  }

  if (!provider) {
    return {
      error: `未找到模型对应的供应商配置: ${options.modelName || '(未指定模型)'}`,
      tool
    }
  }

  const fallbackCardId = sessionSettings.modelId === provider.id
    ? sessionSettings.modelCardId
    : null
  const matchedCard = hasModelCard(provider, parsed.modelKey)
  const useDefaultCard = !parsed.modelKey || isAliasModelName(parsed.modelKey)
  const card = matchedCard
    ? resolveModelCard(provider, parsed.modelKey, fallbackCardId)
    : (useDefaultCard ? resolveDefaultModelCard(provider, fallbackCardId) : null)
  // 明确点名了不属于当前供应商的模型时原样透传，让上游给出真实错误，不静默换成别的模型
  const modelName = card?.modelName || parsed.modelKey || provider.model || ''
  const preferredCredentialId = sessionSettings.modelId === provider.id
    ? sessionSettings.credentialId
    : null
  const credential = getDefaultCredential(provider, preferredCredentialId)

  if (!modelName) {
    return {
      error: `供应商 ${provider.friendlyName || provider.id} 未配置模型卡片`,
      tool,
      provider
    }
  }

  return {
    tool,
    provider,
    providerId: provider.id,
    providerName: provider.friendlyName || provider.id,
    card,
    modelName,
    credential,
    upstreamBaseUrl: provider.apiUrl || provider.baseUrl || ''
  }
}

module.exports = {
  buildModelName,
  parseModelName,
  resolveProxyTarget
}
