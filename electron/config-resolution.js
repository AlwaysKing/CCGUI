const BASE_DOCUMENT_ENABLED = (doc) => doc?.isBase !== false
const BASE_PROMPT_ENABLED = (prompt) => prompt?.isBase === true
const SUPPORTED_EFFORT_LEVELS = new Set(['low', 'medium', 'high'])
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
    debug: modelSettings.debug === true,
    promptMode,
    promptIds: promptMode === 'custom' && Array.isArray(settings.promptIds) ? settings.promptIds : [],
    documentMode,
    documentIds: documentMode === 'custom' && Array.isArray(settings.documentIds) ? settings.documentIds : []
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
    debug: settings.debug === true,
    promptMode,
    promptIds: promptMode === 'custom' && Array.isArray(settings.promptIds) ? settings.promptIds : [],
    documentMode,
    documentIds: documentMode === 'custom' && Array.isArray(settings.documentIds) ? settings.documentIds : []
  }
}

function resolveProjectSettings(appConfig, projectSettings = {}, provider = 'claude') {
  const normalized = normalizeProjectSettings(projectSettings, provider)
  const basePromptIds = getBasePromptIds(appConfig)
  const baseDocumentIds = getBaseDocumentIds(appConfig)

  return {
    modelId: normalized.modelMode === 'custom' ? normalized.modelId : null,
    modelCardId: normalized.modelMode === 'custom' ? normalized.modelCardId : null,
    credentialId: normalized.modelMode === 'custom' ? normalized.credentialId : null,
    targetKind: normalized.targetKind,
    effort: normalized.effort,
    promptIds: normalized.promptMode === 'custom'
      ? normalized.promptIds
      : (normalized.promptMode === 'none' ? [] : basePromptIds),
    documentIds: normalized.documentMode === 'custom'
      ? normalized.documentIds
      : (normalized.documentMode === 'none' ? [] : baseDocumentIds),
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
    meta: {
      source: 'session',
      project: projectResolved.meta,
      session: normalizedSession
    }
  }
}

module.exports = {
  getBasePromptIds,
  getBaseDocumentIds,
  normalizeChatMessageTheme,
  normalizeProjectSettings,
  normalizeSessionSettings,
  resolveAppChatMessageTheme,
  resolveProjectChatMessageTheme,
  resolveSessionChatMessageTheme,
  resolveProjectSettings,
  resolveSessionSettings
}
