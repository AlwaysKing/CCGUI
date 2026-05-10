const BASE_DOCUMENT_ENABLED = (doc) => doc?.isBase !== false
const BASE_PROMPT_ENABLED = (prompt) => prompt?.isBase === true
const SUPPORTED_EFFORT_LEVELS = new Set(['low', 'medium', 'high'])
const DEFAULT_MAX_THINKING_TOKENS = 10240
const MAX_THINKING_TOKENS_MAX = 30000
const { readCodexAuthFile } = require('./services/app-service')
const CHAT_THEME_PRESETS = {
  classic: {
    avatarMode: 'large',
    statusPosition: 'top',
    statusStyle: 'full',
    messageSurface: 'bubble',
    toolStyle: 'bubble',
    messageSpacing: 'large'
  },
  codex: {
    avatarMode: 'none',
    statusPosition: 'bottom',
    statusStyle: 'compact',
    messageSurface: 'ghost',
    toolStyle: 'text',
    messageSpacing: 'small'
  },
  compact: {
    avatarMode: 'small',
    statusPosition: 'tail',
    statusStyle: 'compact',
    messageSurface: 'bubble',
    toolStyle: 'text',
    messageSpacing: 'medium'
  }
}
const CHAT_THEME_FIELDS = Object.keys(CHAT_THEME_PRESETS.classic)

function normalizeEffortValue(value) {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim().toLowerCase()
  if (!normalized || normalized === 'default') {
    return null
  }

  return SUPPORTED_EFFORT_LEVELS.has(normalized) ? normalized : null
}

function normalizeMaxThinkingTokensValue(value) {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  return Number.isFinite(num) && num >= 0
    ? Math.min(Math.max(0, Math.floor(num)), MAX_THINKING_TOKENS_MAX)
    : null
}

function normalizeThinkingEnabled(value) {
  if (value === true) return true
  if (value === false) return false
  return undefined
}

function getBasePromptIds(appConfig) {
  const prompts = appConfig?.settings?.prompts || []
  return prompts.filter(BASE_PROMPT_ENABLED).map(prompt => prompt.id)
}

function getBaseDocumentIds(appConfig) {
  const documents = appConfig?.documents || []
  return documents.filter(BASE_DOCUMENT_ENABLED).map(doc => doc.id)
}

function normalizeChatMessageTheme(theme = {}, presetKey = 'classic') {
  const safePresetKey = CHAT_THEME_PRESETS[presetKey] ? presetKey : 'classic'
  const picked = CHAT_THEME_FIELDS.reduce((acc, key) => {
    if (typeof theme?.[key] === 'string' && theme[key].trim()) {
      acc[key] = theme[key]
    }
    return acc
  }, {})

  return {
    ...CHAT_THEME_PRESETS.classic,
    ...CHAT_THEME_PRESETS[safePresetKey],
    ...picked
  }
}

function resolveAppChatMessageTheme(appConfig) {
  const settings = appConfig?.settings || {}
  const presetKey = settings.chatMessageThemePreset || 'classic'
  return {
    presetKey,
    theme: normalizeChatMessageTheme(settings.chatMessageTheme || {}, presetKey)
  }
}

function resolveProjectChatMessageTheme(appConfig, projectSettings = {}) {
  const appResolved = resolveAppChatMessageTheme(appConfig)
  const mode = projectSettings.chatMessageThemeMode || 'app'

  if (mode === 'preset') {
    const presetKey = projectSettings.chatMessageThemePreset || appResolved.presetKey
    return {
      source: 'project',
      mode,
      presetKey,
      theme: normalizeChatMessageTheme({}, presetKey)
    }
  }

  if (mode === 'custom') {
    const presetKey = projectSettings.chatMessageThemePreset || appResolved.presetKey
    return {
      source: 'project',
      mode,
      presetKey,
      theme: normalizeChatMessageTheme(projectSettings.chatMessageTheme || {}, presetKey)
    }
  }

  return {
    source: 'app',
    mode: 'app',
    presetKey: appResolved.presetKey,
    theme: appResolved.theme
  }
}

function resolveSessionChatMessageTheme(appConfig, projectSettings = {}, sessionSettings = null) {
  const appResolved = resolveAppChatMessageTheme(appConfig)
  const projectResolved = resolveProjectChatMessageTheme(appConfig, projectSettings)

  if (!sessionSettings || Object.keys(sessionSettings).length === 0) {
    return {
      source: projectResolved.source,
      mode: 'project',
      presetKey: projectResolved.presetKey,
      theme: projectResolved.theme
    }
  }

  const mode = sessionSettings.chatMessageThemeMode || 'project'

  if (mode === 'app') {
    return {
      source: 'app',
      mode,
      presetKey: appResolved.presetKey,
      theme: appResolved.theme
    }
  }

  if (mode === 'preset') {
    const presetKey = sessionSettings.chatMessageThemePreset || projectResolved.presetKey || appResolved.presetKey
    return {
      source: 'session',
      mode,
      presetKey,
      theme: normalizeChatMessageTheme({}, presetKey)
    }
  }

  if (mode === 'custom') {
    const presetKey = sessionSettings.chatMessageThemePreset || projectResolved.presetKey || appResolved.presetKey
    return {
      source: 'session',
      mode,
      presetKey,
      theme: normalizeChatMessageTheme(sessionSettings.chatMessageTheme || {}, presetKey)
    }
  }

  return {
    source: projectResolved.source,
    mode: 'project',
    presetKey: projectResolved.presetKey,
    theme: projectResolved.theme
  }
}

function pickProviderProjectModelSettings(settings = {}, provider = 'claude') {
  const providerKey = provider === 'codex' ? 'codex' : 'claude'
  const providerSpecific = settings?.providerModelSettings?.[providerKey]
    || settings?.[`${providerKey}ModelConfig`]
    || null

  if (providerSpecific && typeof providerSpecific === 'object') {
    return providerSpecific
  }

  return settings
}

function normalizeProjectSettings(settings = {}, provider = 'claude') {
  const modelSettings = pickProviderProjectModelSettings(settings, provider)
  const modelMode = modelSettings.modelMode || (modelSettings.modelId ? 'custom' : 'system')
  const promptMode = settings.promptMode || (
    Array.isArray(settings.promptIds) ? (settings.promptIds.length > 0 ? 'custom' : 'none') : 'system'
  )
  const documentMode = settings.documentMode || (
    Array.isArray(settings.documentIds) ? (settings.documentIds.length > 0 ? 'custom' : 'none') : 'system'
  )

  return {
    modelMode,
    modelId: modelMode === 'custom' ? modelSettings.modelId || null : null,
    modelCardId: modelMode === 'custom' ? modelSettings.modelCardId || null : null,
    credentialId: modelMode === 'custom' ? modelSettings.credentialId || null : null,
    targetKind: typeof modelSettings.targetKind === 'string' && modelSettings.targetKind.trim()
      ? modelSettings.targetKind.trim()
      : null,
    effort: normalizeEffortValue(modelSettings.effort),
    thinkingMode: modelSettings.thinkingMode || (modelSettings.thinkingEnabled !== undefined ? 'custom' : 'system'),
    maxThinkingTokens: normalizeMaxThinkingTokensValue(modelSettings.maxThinkingTokens),
    thinkingEnabled: normalizeThinkingEnabled(modelSettings.thinkingEnabled),
    debug: modelSettings.debug === true,
    promptMode,
    promptIds: promptMode === 'custom' && Array.isArray(settings.promptIds) ? settings.promptIds : [],
    documentMode,
    documentIds: documentMode === 'custom' && Array.isArray(settings.documentIds) ? settings.documentIds : [],
    projectPromptEnabled: settings.projectPromptEnabled === true,
    projectPromptText: typeof settings.projectPromptText === 'string' ? settings.projectPromptText : ''
  }
}

function normalizeSessionSettings(settings = {}) {
  const modelMode = settings.modelMode || 'project'
  const promptMode = settings.promptMode || (
    Array.isArray(settings.promptIds) ? (settings.promptIds.length > 0 ? 'custom' : 'none') : 'project'
  )
  const documentMode = settings.documentMode || (
    Array.isArray(settings.documentIds) ? (settings.documentIds.length > 0 ? 'custom' : 'none') : 'project'
  )

  return {
    modelMode,
    modelId: modelMode === 'custom' ? settings.modelId || null : null,
    modelCardId: modelMode === 'custom' ? settings.modelCardId || null : null,
    credentialId: modelMode === 'custom' ? settings.credentialId || null : null,
    targetKind: typeof settings.targetKind === 'string' && settings.targetKind.trim()
      ? settings.targetKind.trim()
      : null,
    effort: normalizeEffortValue(settings.effort),
    thinkingMode: settings.thinkingMode || (settings.thinkingEnabled !== undefined ? 'custom' : 'project'),
    maxThinkingTokens: normalizeMaxThinkingTokensValue(settings.maxThinkingTokens),
    thinkingEnabled: normalizeThinkingEnabled(settings.thinkingEnabled),
    debug: settings.debug === true,
    promptMode,
    promptIds: promptMode === 'custom' && Array.isArray(settings.promptIds) ? settings.promptIds : [],
    documentMode,
    documentIds: documentMode === 'custom' && Array.isArray(settings.documentIds) ? settings.documentIds : [],
    projectPromptMode: settings.projectPromptMode || 'project',
    projectPromptText: typeof settings.projectPromptText === 'string' ? settings.projectPromptText : ''
  }
}

function resolveSystemModelSettings(appConfig, provider = 'claude') {
  const settings = appConfig?.settings || {}
  const isCodex = provider === 'codex'
  const codexAuthMode = isCodex ? readCodexAuthFile()?.authMode : null

  if (isCodex && codexAuthMode === 'chatgpt') {
    return {
      modelId: null,
      modelCardId: null,
      credentialId: null,
      targetKind: 'openai',
      effort: null,
      maxThinkingTokens: null,
      thinkingEnabled: undefined
    }
  }

  const modelId = isCodex
    ? (settings.selectedCodexModelId || null)
    : (settings.selectedClaudeModelId || null)
  const credentialId = isCodex
    ? (settings.selectedCodexCredentialId || null)
    : (settings.selectedClaudeCredentialId || null)

  return {
    modelId,
    modelCardId: null,
    credentialId,
    targetKind: modelId ? 'provider' : (isCodex ? 'openai' : null),
    effort: null,
    maxThinkingTokens: null,
    thinkingEnabled: undefined
  }
}

function resolveProjectSettings(appConfig, projectSettings = {}, provider = 'claude') {
  const normalized = normalizeProjectSettings(projectSettings, provider)
  const basePromptIds = getBasePromptIds(appConfig)
  const baseDocumentIds = getBaseDocumentIds(appConfig)
  const systemResolved = resolveSystemModelSettings(appConfig, provider)

  // 解析 thinkingEnabled：依据 thinkingMode
  // custom → 用项目自己的值；system → 从 app 取，跳过项目自己的覆盖
  const projectThinkingEnabled = normalized.thinkingMode === 'custom'
    ? (normalized.thinkingEnabled !== undefined
        ? normalized.thinkingEnabled
        : normalizeThinkingEnabled(appConfig?.settings?.thinkingEnabled))
    : normalizeThinkingEnabled(appConfig?.settings?.thinkingEnabled)

  // 解析 maxThinkingTokens（原始值，不受 thinkingEnabled 覆盖）
  const projectRawMaxThinkingTokens = normalized.maxThinkingTokens !== null
    ? normalized.maxThinkingTokens
    : (normalizeMaxThinkingTokensValue(appConfig?.settings?.maxThinkingTokens)
      ?? DEFAULT_MAX_THINKING_TOKENS)

  // 最终生效的 maxThinkingTokens（受 thinkingEnabled 覆盖）
  const projectMaxThinkingTokens = projectThinkingEnabled === false
    ? 0
    : projectRawMaxThinkingTokens

  // 解析项目提示词：启用且有内容时才生效
  const projectPrompt = (normalized.projectPromptEnabled && normalized.projectPromptText.trim())
    ? normalized.projectPromptText.trim()
    : null

  return {
    modelId: normalized.modelMode === 'custom' ? normalized.modelId : systemResolved.modelId,
    modelCardId: normalized.modelMode === 'custom' ? normalized.modelCardId : systemResolved.modelCardId,
    credentialId: normalized.modelMode === 'custom' ? normalized.credentialId : systemResolved.credentialId,
    targetKind: normalized.modelMode === 'custom' ? normalized.targetKind : systemResolved.targetKind,
    effort: normalized.effort,
    thinkingEnabled: projectThinkingEnabled,
    maxThinkingTokens: projectMaxThinkingTokens,
    _rawMaxThinkingTokens: projectRawMaxThinkingTokens,
    promptIds: normalized.promptMode === 'custom'
      ? normalized.promptIds
      : (normalized.promptMode === 'none' ? [] : basePromptIds),
    documentIds: normalized.documentMode === 'custom'
      ? normalized.documentIds
      : (normalized.documentMode === 'none' ? [] : baseDocumentIds),
    projectPrompt,
    meta: normalized
  }
}

function resolveSessionSettings(appConfig, projectSettings = {}, sessionSettings = null, provider = 'claude') {
  const projectResolved = resolveProjectSettings(appConfig, projectSettings, provider)
  if (!sessionSettings || Object.keys(sessionSettings).length === 0) {
    return {
      ...projectResolved,
      meta: {
        source: 'project',
        project: projectResolved.meta,
        session: null
      }
    }
  }

  const normalizedSession = normalizeSessionSettings(sessionSettings)
  const basePromptIds = getBasePromptIds(appConfig)
  const baseDocumentIds = getBaseDocumentIds(appConfig)

  // 解析 thinkingEnabled 和 maxThinkingTokens：依据 thinkingMode
  // custom → 用 session 自己的值；project → 用 project 解析后的值；system → 直接用 app 跳过 project
  let sessionThinkingEnabled, sessionMaxThinkingTokens

  if (normalizedSession.thinkingMode === 'custom') {
    // 自定义：使用 session 自己的值
    sessionThinkingEnabled = normalizedSession.thinkingEnabled !== undefined
      ? normalizedSession.thinkingEnabled
      : projectResolved.thinkingEnabled

    sessionMaxThinkingTokens = sessionThinkingEnabled === false
      ? 0
      : (normalizedSession.maxThinkingTokens !== null
          ? normalizedSession.maxThinkingTokens
          // session 启用但 project 禁用：取原始 token 而非被覆写为 0 的值
          : (sessionThinkingEnabled === true && projectResolved.thinkingEnabled === false
              ? projectResolved._rawMaxThinkingTokens
              : projectResolved.maxThinkingTokens))
  } else if (normalizedSession.thinkingMode === 'system') {
    // 系统：直接从 app 取，跳过 project
    const systemThinkingEnabled = normalizeThinkingEnabled(appConfig?.settings?.thinkingEnabled)
    const systemRawMaxTokens = normalizeMaxThinkingTokensValue(appConfig?.settings?.maxThinkingTokens)
      ?? DEFAULT_MAX_THINKING_TOKENS
    sessionThinkingEnabled = systemThinkingEnabled
    sessionMaxThinkingTokens = systemThinkingEnabled === false ? 0 : systemRawMaxTokens
  } else {
    // 项目：使用 project 解析后的值
    sessionThinkingEnabled = projectResolved.thinkingEnabled
    sessionMaxThinkingTokens = projectResolved.maxThinkingTokens
  }

  // 解析 session 级别的项目提示词
  let sessionProjectPrompt = null
  if (normalizedSession.projectPromptMode === 'project') {
    sessionProjectPrompt = projectResolved.projectPrompt
  } else if (normalizedSession.projectPromptMode === 'custom') {
    sessionProjectPrompt = normalizedSession.projectPromptText.trim() || null
  }
  // 'none' → null

  return {
    modelId: normalizedSession.modelMode === 'custom'
      ? normalizedSession.modelId
      : (normalizedSession.modelMode === 'project' ? projectResolved.modelId : null),
    modelCardId: normalizedSession.modelMode === 'custom'
      ? normalizedSession.modelCardId
      : (normalizedSession.modelMode === 'project' ? projectResolved.modelCardId : null),
    credentialId: normalizedSession.modelMode === 'custom'
      ? normalizedSession.credentialId
      : (normalizedSession.modelMode === 'project' ? projectResolved.credentialId : null),
    targetKind: normalizedSession.targetKind || (normalizedSession.modelMode === 'project' ? projectResolved.targetKind : null),
    effort: normalizedSession.effort !== null
      ? normalizedSession.effort
      : projectResolved.effort,
    thinkingEnabled: sessionThinkingEnabled,
    maxThinkingTokens: sessionMaxThinkingTokens,
    promptIds: normalizedSession.promptMode === 'custom'
      ? normalizedSession.promptIds
      : (normalizedSession.promptMode === 'project'
          ? projectResolved.promptIds
          : (normalizedSession.promptMode === 'none' ? [] : basePromptIds)),
    documentIds: normalizedSession.documentMode === 'custom'
      ? normalizedSession.documentIds
      : (normalizedSession.documentMode === 'project'
          ? projectResolved.documentIds
          : (normalizedSession.documentMode === 'none' ? [] : baseDocumentIds)),
    projectPrompt: sessionProjectPrompt,
    meta: {
      source: 'session',
      project: projectResolved.meta,
      session: normalizedSession
    }
  }
}

module.exports = {
  DEFAULT_MAX_THINKING_TOKENS,
  MAX_THINKING_TOKENS_MAX,
  getBasePromptIds,
  getBaseDocumentIds,
  normalizeChatMessageTheme,
  normalizeMaxThinkingTokensValue,
  normalizeThinkingEnabled,
  normalizeProjectSettings,
  normalizeSessionSettings,
  resolveAppChatMessageTheme,
  resolveProjectChatMessageTheme,
  resolveSessionChatMessageTheme,
  resolveProjectSettings,
  resolveSessionSettings
}
