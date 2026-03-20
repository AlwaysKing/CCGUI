const BASE_DOCUMENT_ENABLED = (doc) => doc?.isBase !== false
const BASE_PROMPT_ENABLED = (prompt) => prompt?.isBase === true

function getBasePromptIds(appConfig) {
  const prompts = appConfig?.settings?.prompts || []
  return prompts.filter(BASE_PROMPT_ENABLED).map(prompt => prompt.id)
}

function getBaseDocumentIds(appConfig) {
  const documents = appConfig?.documents || []
  return documents.filter(BASE_DOCUMENT_ENABLED).map(doc => doc.id)
}

function normalizeProjectSettings(settings = {}) {
  const modelMode = settings.modelMode || (settings.modelId ? 'custom' : 'system')
  const promptMode = settings.promptMode || (
    Array.isArray(settings.promptIds) ? (settings.promptIds.length > 0 ? 'custom' : 'none') : 'system'
  )
  const documentMode = settings.documentMode || (
    Array.isArray(settings.documentIds) ? (settings.documentIds.length > 0 ? 'custom' : 'none') : 'system'
  )

  return {
    modelMode,
    modelId: modelMode === 'custom' ? settings.modelId || null : null,
    modelCardId: modelMode === 'custom' ? settings.modelCardId || null : null,
    debug: settings.debug === true,
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
    debug: settings.debug === true,
    promptMode,
    promptIds: promptMode === 'custom' && Array.isArray(settings.promptIds) ? settings.promptIds : [],
    documentMode,
    documentIds: documentMode === 'custom' && Array.isArray(settings.documentIds) ? settings.documentIds : []
  }
}

function resolveProjectSettings(appConfig, projectSettings = {}) {
  const normalized = normalizeProjectSettings(projectSettings)
  const basePromptIds = getBasePromptIds(appConfig)
  const baseDocumentIds = getBaseDocumentIds(appConfig)

  return {
    modelId: normalized.modelMode === 'custom' ? normalized.modelId : null,
    modelCardId: normalized.modelMode === 'custom' ? normalized.modelCardId : null,
    promptIds: normalized.promptMode === 'custom'
      ? normalized.promptIds
      : (normalized.promptMode === 'none' ? [] : basePromptIds),
    documentIds: normalized.documentMode === 'custom'
      ? normalized.documentIds
      : (normalized.documentMode === 'none' ? [] : baseDocumentIds),
    meta: normalized
  }
}

function resolveSessionSettings(appConfig, projectSettings = {}, sessionSettings = null) {
  const projectResolved = resolveProjectSettings(appConfig, projectSettings)
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
  normalizeProjectSettings,
  normalizeSessionSettings,
  resolveProjectSettings,
  resolveSessionSettings
}
