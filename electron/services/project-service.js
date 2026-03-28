const fs = require('fs')
const os = require('os')
const path = require('path')
const logger = require('../logger')
const { encodeProjectPath, decodeProjectPath } = require('../project-paths')
const { providerSessionSources, providerSessionSourcesById } = require('../adapters/session-sources')
const {
  getProviderModels,
  findProviderModel,
  getModelCredentials,
  getDefaultCredential
} = require('../adapters/shared/model-config')
const {
  listClaudeModels,
  listClaudeReasoningCapabilities
} = require('../adapters/claude/provider-api')
const {
  listCodexModels,
  listCodexReasoningCapabilities
} = require('../adapters/codex/provider-api')
const {
  appConfigManager,
  historyManager,
  projectConfigManager,
  sessionConfigManager
} = require('../storage')
const { readCodexAuthFile, readCodexConfigFile } = require('./app-service')
const { resolveProjectSettings, resolveSessionSettings } = require('../config-resolution')
const pendingHistoryImports = new Map()
const pendingHistoryRetries = new Map()
const HISTORY_RETRY_DELAY_MS = 5000

function buildScannedProjectDefaultSettings() {
  return {
    modelMode: 'system',
    modelId: null,
    modelCardId: null,
    credentialId: null,
    targetKind: null,
    promptMode: 'none',
    promptIds: [],
    documentMode: 'none',
    documentIds: []
  }
}

function buildScannedSessionDefaultSettings() {
  return {
    modelMode: 'system',
    modelId: null,
    modelCardId: null,
    credentialId: null,
    targetKind: null,
    promptMode: 'none',
    promptIds: [],
    documentMode: 'none',
    documentIds: []
  }
}

function normalizeToolBinding(binding = null, fallbackTool = null, fallbackNativeSessionId = null) {
  const tool = typeof binding?.tool === 'string' && binding.tool.trim()
    ? binding.tool.trim()
    : (typeof fallbackTool === 'string' && fallbackTool.trim() ? fallbackTool.trim() : null)
  const nativeSessionId = typeof binding?.nativeSessionId === 'string' && binding.nativeSessionId.trim()
    ? binding.nativeSessionId.trim()
    : (typeof fallbackNativeSessionId === 'string' && fallbackNativeSessionId.trim() ? fallbackNativeSessionId.trim() : null)

  if (!tool) {
    return null
  }

  return {
    tool,
    nativeSessionId: nativeSessionId || null
  }
}

function resolveToolBinding(settings = {}, fallbackSessionId = null) {
  const tool = settings?.toolBinding?.tool
    || settings?.tool
    || settings?.provider
    || (settings?.codexThreadId ? 'codex' : null)
  const nativeSessionId = settings?.toolBinding?.nativeSessionId
    || settings?.codexThreadId
    || null

  return normalizeToolBinding(settings?.toolBinding, tool, nativeSessionId)
}

function resolveProvider(projectSettings = {}, sessionSettings = null) {
  const sessionBinding = resolveToolBinding(sessionSettings)
  const sessionTool = sessionBinding?.tool || sessionSettings?.tool || sessionSettings?.provider
  if (sessionTool === 'codex') return 'codex'
  if (sessionTool === 'claude') return 'claude'

  const projectTool = projectSettings?.tool || projectSettings?.provider
  if (projectTool === 'codex') return 'codex'
  if (projectTool === 'claude') return 'claude'

  return 'claude'
}

function resolveSystemSelectedModel(appConfig, provider = 'claude') {
  const models = getProviderModels(appConfig, provider).filter(model => model.isActive !== false)
  const selectedId = provider === 'codex'
    ? appConfig?.settings?.selectedCodexModelId
    : appConfig?.settings?.selectedClaudeModelId

  return models.find(model => model.id === selectedId) || models[0] || null
}

function resolveActiveCodexAccount(appConfig, authState = null) {
  const auth = authState || readCodexAuthFile()
  const accounts = Array.isArray(appConfig?.settings?.codexAccounts) ? appConfig.settings.codexAccounts : []
  const tokenAccountId = auth?.tokens?.accountId || auth?.accountId || ''
  return (
    accounts.find(account => account?.accountId && account.accountId === tokenAccountId) ||
    accounts.find(account => account?.id && account.id === appConfig?.settings?.selectedCodexAccountId) ||
    null
  )
}

function resolveConfiguredDefaultCard(model = null, preferredCardId = null) {
  const cards = Array.isArray(model?.modelCards) ? model.modelCards : []
  if (!cards.length) return null

  if (preferredCardId) {
    return cards.find(card => card.id === preferredCardId) || null
  }

  const defaultCardId = model.defaultCardId || cards[0]?.id
  return cards.find(card => card.id === defaultCardId) || cards[0] || null
}

function buildConfiguredSubModelOptions(model = null, preferredCardId = null) {
  const cards = Array.isArray(model?.modelCards) ? model.modelCards : []
  const defaultCard = resolveConfiguredDefaultCard(model, preferredCardId)
  const configName = model?.friendlyName || model?.id || ''

  return cards
    .filter(card => card && typeof card.modelName === 'string' && card.modelName)
    .map(card => ({
      key: card.modelName,
      value: card.modelName,
      label: card.modelName,
      description: configName ? `来自 ${configName}` : '',
      reasoningEffort: 'medium',
      isConfigured: true,
      isDefault: defaultCard?.id === card.id
    }))
}

function buildSessionTargetId({ provider = '', targetKind = 'provider', modelId = '', credentialId = '' } = {}) {
  return [provider || '', targetKind || 'provider', modelId || '', credentialId || ''].join(':')
}

function buildVirtualTargetId(provider = 'claude', targetKind = 'system') {
  return buildSessionTargetId({
    provider,
    targetKind,
    modelId: '',
    credentialId: ''
  })
}

function buildSessionTargetLabel(model = null, credential = null, options = {}) {
  const providerLabel = model?.friendlyName || model?.id || options.providerLabel || '未命名供应商'
  if (!credential?.name) {
    return providerLabel
  }
  return `${providerLabel} - ${credential.name}`
}

function summarizeModelTarget(model = null, credential = null, preferredCardId = null, fallback = '未设置默认模型') {
  if (!model) return fallback
  const defaultCard = resolveConfiguredDefaultCard(model, preferredCardId)
  const parts = [model.friendlyName || model.id]
  if (credential?.name) parts.push(credential.name)
  if (defaultCard?.modelName || defaultCard?.id) parts.push(defaultCard.modelName || defaultCard.id)
  return parts.join(' · ')
}

function summarizeResolvedTarget(appConfig, provider = 'claude', resolvedSettings = {}, fallback = '未设置默认模型') {
  if (provider === 'codex' && resolvedSettings?.targetKind === 'openai') {
    const auth = readCodexAuthFile()
    const codexSettings = readCodexConfigFile()
    const activeAccount = resolveActiveCodexAccount(appConfig, auth)
    const parts = ['账号模式']
    if (activeAccount?.name) parts.push(activeAccount.name)
    if (codexSettings?.model) parts.push(codexSettings.model)
    return parts.join(' · ')
  }

  const model = resolvedSettings?.modelId
    ? findProviderModel(appConfig, provider, resolvedSettings.modelId)
    : resolveSystemSelectedModel(appConfig, provider)

  if (!model) {
    return fallback
  }

  const credential = getDefaultCredential(model, resolvedSettings?.credentialId || null)
  return summarizeModelTarget(model, credential, resolvedSettings?.modelCardId || model?.defaultCardId, fallback)
}

function buildOpenAiTargetOption(currentTargetId = null) {
  const id = buildSessionTargetId({
    provider: 'codex',
    targetKind: 'openai',
    modelId: 'openai',
    credentialId: ''
  })

  return {
    id,
    label: 'OpenAI',
    menuLabel: 'OpenAI',
    providerId: 'openai',
    providerLabel: 'OpenAI',
    credentialId: null,
    credentialLabel: null,
    authMode: 'account',
    selectable: true,
    isCurrent: currentTargetId === id,
    targetKind: 'openai',
    modelId: null
  }
}

function buildProviderTargetOptions(provider, models = [], currentTargetId = null) {
  return models.flatMap(model => {
    const credentials = getModelCredentials(model)
    const defaultCredential = getDefaultCredential(model)
    const targetCredentials = credentials.length > 0 ? credentials : [defaultCredential].filter(Boolean)

    return targetCredentials.map(credential => {
      const id = buildSessionTargetId({
        provider,
        targetKind: 'provider',
        modelId: model.id,
        credentialId: credential?.id || ''
      })

      return {
        id,
        label: buildSessionTargetLabel(model, credential),
        menuLabel: credential?.name || buildSessionTargetLabel(model, credential),
        providerId: model.id,
        providerLabel: model.friendlyName || model.id,
        credentialId: credential?.id || null,
        credentialLabel: credential?.name || null,
        authMode: 'provider',
        selectable: true,
        isCurrent: currentTargetId === id,
        targetKind: 'provider',
        modelId: model.id
      }
    })
  })
}

function buildClaudeVirtualTargetOptions({
  appConfig,
  projectSettings = {},
  currentTargetId = null
} = {}) {
  const systemModel = resolveSystemSelectedModel(appConfig, 'claude')
  const systemCredential = systemModel
    ? getDefaultCredential(systemModel, appConfig?.settings?.selectedClaudeCredentialId || null)
    : null

  const projectResolved = resolveSessionSettings(appConfig, projectSettings, null, 'claude')
  const projectModel = projectResolved?.modelId
    ? findProviderModel(appConfig, 'claude', projectResolved.modelId)
    : systemModel
  const projectCredential = projectModel
    ? getDefaultCredential(projectModel, projectResolved.credentialId || null)
    : systemCredential

  return [
    {
      id: buildVirtualTargetId('claude', 'system'),
      label: `系统（${summarizeModelTarget(systemModel, systemCredential, systemModel?.defaultCardId, '未设置默认模型')}）`,
      menuLabel: '系统',
      providerId: null,
      providerLabel: '系统',
      credentialId: null,
      credentialLabel: null,
      authMode: 'system',
      selectable: true,
      isCurrent: currentTargetId === buildVirtualTargetId('claude', 'system'),
      targetKind: 'system',
      modelId: null
    },
    {
      id: buildVirtualTargetId('claude', 'project'),
      label: `项目（${summarizeModelTarget(projectModel, projectCredential, projectResolved?.modelCardId || projectModel?.defaultCardId, '未设置默认模型')}）`,
      menuLabel: '项目',
      providerId: null,
      providerLabel: '项目',
      credentialId: null,
      credentialLabel: null,
      authMode: 'project',
      selectable: true,
      isCurrent: currentTargetId === buildVirtualTargetId('claude', 'project'),
      targetKind: 'project',
      modelId: null
    }
  ]
}

function resolveCurrentSessionTarget(provider, resolvedSettings = {}) {
  if (provider === 'claude') {
    const sessionMode = resolvedSettings?.meta?.session?.modelMode || null
    if (sessionMode === 'system') {
      return buildVirtualTargetId('claude', 'system')
    }
    if (sessionMode === 'project') {
      return buildVirtualTargetId('claude', 'project')
    }
    if (!resolvedSettings?.meta?.session) {
      return buildVirtualTargetId('claude', 'project')
    }
  }

  if (provider === 'codex' && (!resolvedSettings.modelId || resolvedSettings.targetKind === 'openai')) {
    return buildSessionTargetId({
      provider: 'codex',
      targetKind: 'openai',
      modelId: 'openai',
      credentialId: ''
    })
  }

  if (resolvedSettings.modelId) {
    return buildSessionTargetId({
      provider,
      targetKind: resolvedSettings.targetKind || 'provider',
      modelId: resolvedSettings.modelId,
      credentialId: resolvedSettings.credentialId || ''
    })
  }

  return null
}

function resolveInitProvider(provider, resolvedSettings = {}) {
  if (provider === 'codex') {
    if (resolvedSettings.targetKind === 'openai' || !resolvedSettings.modelId) {
      return 'openai'
    }

    return resolvedSettings.modelId || null
  }

  if (resolvedSettings.targetKind && resolvedSettings.targetKind !== 'provider') {
    return resolvedSettings.targetKind
  }

  return resolvedSettings.modelId || provider || null
}

function buildSessionAvailability(appConfig, projectSettings = {}, sessionSettings = null) {
  const provider = resolveProvider(projectSettings, sessionSettings)
  const resolvedSettings = resolveSessionSettings(
    appConfig,
    projectSettings || {},
    sessionSettings || null,
    provider
  )
  const currentProvider = resolveInitProvider(provider, resolvedSettings)
  const initProvider = typeof sessionSettings?.initProvider === 'string'
    ? sessionSettings.initProvider.trim()
    : ''

  if (provider === 'claude') {
    return {
      available: true,
      provider,
      currentProvider,
      initProvider: initProvider || currentProvider || null,
      reason: 'claude-session-always-available'
    }
  }

  if (!initProvider) {
    return {
      available: true,
      provider,
      currentProvider,
      initProvider: null,
      reason: 'missing-init-provider'
    }
  }

  if (provider === 'codex' && initProvider === 'openai') {
    const systemResolved = resolveProjectSettings(appConfig, {}, 'codex')
    const systemProvider = resolveInitProvider('codex', systemResolved)
    if (systemProvider !== 'openai') {
      return {
        available: false,
        provider,
        currentProvider: systemProvider,
        initProvider,
        reason: 'system-openai-mismatch'
      }
    }
  }

  return {
    available: currentProvider === initProvider,
    provider,
    currentProvider,
    initProvider,
    reason: currentProvider === initProvider ? 'provider-matched' : 'provider-mismatch'
  }
}

function applyCodexTargetAvailability(options = [], currentTarget = null) {
  if (!currentTarget) {
    return options
  }

  const currentTargetKind = currentTarget.targetKind || 'provider'
  const currentProviderId = currentTarget.providerId || null

  if (currentTargetKind === 'openai') {
    return options
      .filter(option => option.targetKind === 'openai')
      .map(option => ({
        ...option,
        selectable: true,
        reasonDisabled: ''
      }))
  }

  if (!currentProviderId) {
    return options
  }

  return options
    .filter(option => option.targetKind === 'provider' && option.providerId === currentProviderId)
    .map(option => ({
      ...option,
      selectable: true,
      reasonDisabled: ''
    }))
}

async function getAvailableTargets({ projectId = null, provider = null, sessionId = null } = {}) {
  const appConfig = appConfigManager.loadConfig()

  if (sessionId) {
    const projectConfig = projectConfigManager.loadProjectConfig(projectId)
    const sessionConfig = sessionConfigManager.getSession(projectId, sessionId)
    const resolvedProvider = resolveProvider(projectConfig?.settings || {}, sessionConfig?.settings || null)
    const resolved = resolveSessionSettings(
      appConfig,
      projectConfig?.settings || {},
      sessionConfig?.settings || null,
      resolvedProvider
    )
    const currentTargetId = resolveCurrentSessionTarget(resolvedProvider, resolved)
    const activeModels = getProviderModels(appConfig, resolvedProvider).filter(model => model.isActive !== false)

    let options = buildProviderTargetOptions(resolvedProvider, activeModels, currentTargetId)
    if (resolvedProvider === 'claude') {
      options = [
        ...buildClaudeVirtualTargetOptions({
          appConfig,
          projectSettings: projectConfig?.settings || {},
          currentTargetId
        }),
        ...options
      ]
    } else if (resolvedProvider === 'codex') {
      options = [
        buildOpenAiTargetOption(currentTargetId),
        ...options
      ]
      const currentTarget = options.find(option => option.id === currentTargetId) || null
      options = applyCodexTargetAvailability(options, currentTarget)
    }

    return {
      provider: resolvedProvider,
      currentTargetId,
      options
    }
  }

  const normalizedProvider = provider === 'codex' ? 'codex' : 'claude'
  const activeModels = getProviderModels(appConfig, normalizedProvider).filter(model => model.isActive !== false)

  let options = buildProviderTargetOptions(normalizedProvider, activeModels, null)
  if (normalizedProvider === 'codex') {
    options = [
      buildOpenAiTargetOption(null),
      ...options
    ]
  }

  return {
    provider: normalizedProvider,
    currentTargetId: null,
    options
  }
}

async function validateSessionTarget(projectId, sessionId, target = {}) {
  const available = await getAvailableTargets({ projectId, sessionId })
  const targetId = typeof target?.targetId === 'string' && target.targetId.trim()
    ? target.targetId.trim()
    : buildSessionTargetId({
      provider: available.provider,
      targetKind: typeof target?.targetKind === 'string' && target.targetKind.trim() ? target.targetKind.trim() : 'provider',
      modelId: typeof target?.modelId === 'string' && target.modelId.trim() ? target.modelId.trim() : '',
      credentialId: typeof target?.credentialId === 'string' && target.credentialId.trim() ? target.credentialId.trim() : ''
    })

  const option = available.options.find(item => item.id === targetId) || null
  if (!option) {
    return {
      valid: false,
      reason: '目标模型不存在或已不可用'
    }
  }

  if (option.selectable === false) {
    return {
      valid: false,
      reason: option.reasonDisabled || '当前会话不允许切换到该目标'
    }
  }

  return {
    valid: true,
    option
  }
}

function readClaudeRuntimeDefaults() {
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
    if (!fs.existsSync(settingsPath)) {
      return { default: '', sonnet: '', opus: '', haiku: '' }
    }

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    const env = settings.env || {}
    return {
      default: settings.model || env.ANTHROPIC_MODEL || '',
      sonnet: env.ANTHROPIC_DEFAULT_SONNET_MODEL || '',
      opus: env.ANTHROPIC_DEFAULT_OPUS_MODEL || '',
      haiku: env.ANTHROPIC_DEFAULT_HAIKU_MODEL || env.ANTHROPIC_SMALL_FAST_MODEL || ''
    }
  } catch (error) {
    logger.warn('[ProjectService] Failed to read Claude runtime defaults', { error: error.message })
    return { default: '', sonnet: '', opus: '', haiku: '' }
  }
}

function formatClaudeAliasActualModel(value = '', fallbackDescription = '', defaults = null) {
  const normalizedValue = String(value || '').trim()
  if (!normalizedValue) return fallbackDescription || ''

  let actualModel = ''
  if (normalizedValue === 'default') {
    actualModel = defaults?.default || defaults?.sonnet || ''
  } else if (normalizedValue.startsWith('sonnet')) {
    actualModel = defaults?.sonnet || ''
  } else if (normalizedValue.startsWith('opus')) {
    actualModel = defaults?.opus || ''
  } else if (normalizedValue.startsWith('haiku')) {
    actualModel = defaults?.haiku || ''
  }

  if (!actualModel) {
    return fallbackDescription || ''
  }

  return fallbackDescription
    ? `${fallbackDescription} (${actualModel})`
    : actualModel
}

function normalizeProviderSubModelOptions(provider, items = [], claudeDefaults = null) {
  if (provider === 'codex') {
    return items
      .filter(item => item && typeof item.model === 'string' && item.model)
      .map(item => ({
        key: item.model,
        value: item.model,
        label: item.raw?.displayName || item.model,
        description: item.raw?.description || '',
        reasoningEffort: item.defaultReasoningEffort || 'medium',
        isConfigured: false,
        isDefault: false
      }))
  }

  return items
    .filter(item => item && typeof item.value === 'string' && item.value)
    .map(item => ({
      key: item.value,
      value: item.value,
      label: item.displayName || item.value,
      description: formatClaudeAliasActualModel(item.value, item.description || '', claudeDefaults),
      reasoningEffort: 'medium',
      isConfigured: false,
      isDefault: false
    }))
}

function mergeSubModelOptions(configuredOptions = [], providerOptions = []) {
  const merged = []
  const seen = new Set()

  for (const option of [...configuredOptions, ...providerOptions]) {
    const value = typeof option?.value === 'string' ? option.value : ''
    if (!value || seen.has(value)) continue
    seen.add(value)
    merged.push(option)
  }

  return merged
}

function normalizeReasoningOptions(items = []) {
  return items
    .filter(item => item && typeof item.value === 'string' && item.value)
    .map(item => ({
      value: item.value,
      key: item.value,
      label: item.label || item.value,
      description: item.description || ''
    }))
}

function ensureProjectConfig(project) {
  if (!project?.id || !project?.path) {
    return null
  }

  const existing = projectConfigManager.loadProjectConfig(project.id)
  if (existing) {
    return existing
  }

  const config = projectConfigManager.createProjectConfig(
    project.id,
    project.path,
    project.name || path.basename(project.path)
  )
  config.settings = buildScannedProjectDefaultSettings()
  projectConfigManager.saveProjectConfig(project.id, config)
  logger.info('[ProjectService] Created CCGUI project config for scanned provider project', {
    projectId: project.id,
    projectPath: project.path
  })
  return config
}

function ensureSessionConfig(projectId, providerSession) {
  if (!projectId || !providerSession?.id) {
    return null
  }

  const existing = sessionConfigManager.getSession(projectId, providerSession.id)
  const providerSettings = {
    ...buildScannedSessionDefaultSettings(),
    ...(providerSession.settings || {}),
    toolBinding: normalizeToolBinding(
      providerSession?.settings?.toolBinding,
      providerSession?.settings?.provider || providerSession?.settings?.tool || providerSession?.provider || null,
      providerSession?.id || null
    )
  }

  if (existing) {
    const mergedSettings = {
      ...providerSettings,
      ...(existing.settings || {})
    }

    const needsSettingsPatch = Object.keys(providerSettings).some(key => existing.settings?.[key] !== providerSettings[key])
    const needsNamePatch = !existing.name && providerSession.name

    if (needsSettingsPatch || needsNamePatch) {
      return {
        config: sessionConfigManager.updateSession(projectId, providerSession.id, {
          name: existing.name || providerSession.name || '会话',
          settings: mergedSettings
        }),
        created: false
      }
    }

    return {
      config: existing,
      created: false
    }
  }

  return {
    config: sessionConfigManager.updateSession(projectId, providerSession.id, {
      name: providerSession.name || '会话',
      settings: providerSettings
    }),
    created: true
  }
}

function resolveLinkedSessionProvider(session = null) {
  return resolveToolBinding(session?.settings || {}, session?.id || null)?.tool || null
}

function getCodexSessionNativeIds(session = null) {
  const settings = session?.settings || {}
  const nativeIds = new Set()
  const binding = resolveToolBinding(settings, session?.id || null)

  if (binding?.tool === 'codex' && binding.nativeSessionId) {
    nativeIds.add(binding.nativeSessionId)
  }

  const currentThreadId = typeof settings.codexThreadId === 'string' ? settings.codexThreadId.trim() : ''
  if (currentThreadId) {
    nativeIds.add(currentThreadId)
  }

  const aliases = Array.isArray(settings.codexThreadAliases) ? settings.codexThreadAliases : []
  for (const value of aliases) {
    const normalized = typeof value === 'string' ? value.trim() : ''
    if (normalized) {
      nativeIds.add(normalized)
    }
  }

  return Array.from(nativeIds)
}

function isProviderPlaceholderSession(session = null) {
  const provider = resolveLinkedSessionProvider(session)
  if (provider === 'codex') {
    const binding = resolveToolBinding(session?.settings || {}, session?.id || null)
    const currentThreadId = binding?.nativeSessionId || (typeof session?.settings?.codexThreadId === 'string'
      ? session.settings.codexThreadId.trim()
      : '')
    return Boolean(currentThreadId) && session?.id === currentThreadId
  }

  return false
}

function resolveSessionBindingMeta(session = null, providerData = null) {
  const binding = resolveToolBinding(session?.settings || {}, session?.id || null)
  if (!binding?.tool) {
    return {
      bindingState: 'none',
      bindingLabel: '',
      bindingMissing: false
    }
  }

  const provider = binding.tool
  const providerName = provider === 'codex' ? 'Codex' : 'Claude'
  if (providerData) {
    return {
      bindingState: 'linked',
      bindingLabel: '',
      bindingMissing: false
    }
  }

  if (!binding.nativeSessionId) {
    return {
      bindingState: 'pending',
      bindingLabel: `待绑定 ${providerName}`,
      bindingMissing: false
    }
  }

  return {
    bindingState: 'missing',
    bindingLabel: `${providerName} 绑定失效`,
    bindingMissing: true
  }
}

function buildProviderSessionIdentity(session = null) {
  const binding = resolveToolBinding(session?.settings || {}, session?.id || null)
  const provider = binding?.tool || null
  if (!provider) {
    return null
  }

  if (provider === 'codex') {
    const nativeIds = getCodexSessionNativeIds(session)
    const nativeId = nativeIds[0] || null
    if (!nativeId) {
      return null
    }

    return {
      key: `codex:${nativeId}`,
      provider,
      nativeId,
      nativeIds
    }
  }

  const nativeId = binding?.nativeSessionId || null
  if (!nativeId) {
    return null
  }

  return {
    key: `${provider}:${nativeId}`,
    provider,
    nativeId
  }
}

function groupSessionsByProviderIdentity(sessions = []) {
  const groups = new Map()

  for (const session of sessions) {
    const identity = buildProviderSessionIdentity(session)
    if (!identity?.key) {
      continue
    }

    if (!groups.has(identity.key)) {
      groups.set(identity.key, [])
    }
    groups.get(identity.key).push(session)
  }

  return groups
}

function choosePreferredLinkedSession(sessions = []) {
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return null
  }

  if (sessions.length === 1) {
    return sessions[0]
  }

  const identity = buildProviderSessionIdentity(sessions[0])
  if (identity?.nativeId) {
    const localAlias = sessions.find(session => session?.id && session.id !== identity.nativeId)
    if (localAlias) {
      return localAlias
    }
  }

  return sessions[0]
}

function buildPreferredLinkedSessionMap(sessions = []) {
  const preferredMap = new Map()

  for (const session of sessions) {
    const identity = buildProviderSessionIdentity(session)
    if (!identity) {
      continue
    }

    const keys = identity.provider === 'codex'
      ? identity.nativeIds.map(nativeId => `codex:${nativeId}`)
      : [identity.key]

    for (const key of keys) {
      if (!preferredMap.has(key)) {
        preferredMap.set(key, session)
      }
    }
  }

  for (const [key, group] of groupSessionsByProviderIdentity(sessions).entries()) {
    const preferred = choosePreferredLinkedSession(group)
    if (preferred) {
      preferredMap.set(key, preferred)
    }
  }

  return preferredMap
}

async function importProviderSessionHistory(projectId, providerSession, targetSessionId = null) {
  const historySessionId = targetSessionId || providerSession?.id
  if (!historySessionId) {
    return
  }

  const provider = providerSession?.settings?.provider
  if (!provider) {
    return
  }

  if (historyManager.historyExists(projectId, historySessionId)) {
    return
  }

  const source = providerSessionSourcesById[provider]
  if (!source?.loadSessionHistory) {
    return
  }

  const messages = await Promise.resolve(source.loadSessionHistory({
    projectId,
    projectPath: decodeProjectPath(projectId),
    sessionId: historySessionId,
    session: providerSession
  }))

  if (!Array.isArray(messages) || messages.length === 0) {
    return
  }

  historyManager.saveAllMessages(projectId, historySessionId, messages)
  logger.info('[ProjectService] Imported provider session history into CCGUI', {
    projectId,
    sessionId: historySessionId,
    provider,
    messageCount: messages.length
  })
}

function scheduleProviderSessionHistoryImport(projectId, providerSession) {
  return scheduleProviderSessionHistoryImportToTarget(projectId, providerSession, providerSession.id)
}

function scheduleProviderSessionHistoryImportToTarget(projectId, providerSession, targetSessionId) {
  const historySessionId = targetSessionId || providerSession?.id
  const key = `${projectId}:${historySessionId}`
  if (pendingHistoryImports.has(key)) {
    return pendingHistoryImports.get(key)
  }

  const existingRetryTimer = pendingHistoryRetries.get(key)
  if (existingRetryTimer) {
    clearTimeout(existingRetryTimer)
    pendingHistoryRetries.delete(key)
  }

  const task = importProviderSessionHistory(projectId, providerSession, historySessionId)
    .catch(error => {
      if (error?.retryable) {
        logger.info('[ProjectService] Provider session history not ready yet, will retry', {
          projectId,
          sessionId: historySessionId,
          provider: providerSession?.settings?.provider || 'unknown',
          error: error.message
        })
        const retryTimer = setTimeout(() => {
          pendingHistoryRetries.delete(key)
          if (!historyManager.historyExists(projectId, historySessionId)) {
            scheduleProviderSessionHistoryImportToTarget(projectId, providerSession, historySessionId)
          }
        }, HISTORY_RETRY_DELAY_MS)
        pendingHistoryRetries.set(key, retryTimer)
        return
      }

      logger.warn('[ProjectService] Provider session history import failed', {
        projectId,
        sessionId: historySessionId,
        provider: providerSession?.settings?.provider || 'unknown',
        error: error.message
      })
    })
    .finally(() => {
      pendingHistoryImports.delete(key)
    })

  pendingHistoryImports.set(key, task)
  return task
}

function ensureProviderSessions(projectId, providerSessions, preferredLinkedSessions = new Map()) {
  for (const providerSession of providerSessions.values()) {
    const identity = buildProviderSessionIdentity(providerSession)
    const linkedSession = identity?.key ? preferredLinkedSessions.get(identity.key) : null

    if (linkedSession) {
      if (!historyManager.historyExists(projectId, linkedSession.id)) {
        scheduleProviderSessionHistoryImportToTarget(projectId, providerSession, linkedSession.id)
      }
      continue
    }

    const ensured = ensureSessionConfig(projectId, providerSession)
    if (ensured?.created || !historyManager.historyExists(projectId, providerSession.id)) {
      scheduleProviderSessionHistoryImport(projectId, providerSession)
    }
  }
}

function scanCCGUIProjects() {
  try {
    const projects = projectConfigManager.getAllProjects() || []
    return projects.map(project => ({
      id: project.id || encodeProjectPath(project.path),
      name: project.name || path.basename(project.path),
      path: project.path,
      sessionCount: project.sessionCount || 0,
      lastActiveAt: project.updatedAt || project.createdAt || null,
      settings: project.settings || {},
      sourceFlags: {
        ccgui: true,
        claude: false,
        codex: false
      }
    }))
  } catch (error) {
    logger.warn('[ProjectService] Failed to scan CCGUI projects', { error: error.message })
    return []
  }
}

function pickLatestTimestamp(a, b) {
  if (!a) return b || null
  if (!b) return a || null
  return new Date(a) >= new Date(b) ? a : b
}

function mergeProjectsByPath(...projectLists) {
  const merged = new Map()

  for (const projects of projectLists) {
    for (const project of projects) {
      if (!project?.path) continue

      const existing = merged.get(project.path)
      if (!existing) {
        merged.set(project.path, {
          ...project,
          id: project.id || encodeProjectPath(project.path),
          sourceFlags: {
            ccgui: !!project.sourceFlags?.ccgui,
            claude: !!project.sourceFlags?.claude,
            codex: !!project.sourceFlags?.codex
          }
        })
        continue
      }

      merged.set(project.path, {
        ...existing,
        ...project,
        id: existing.id || project.id || encodeProjectPath(project.path),
        name: existing.name || project.name || path.basename(project.path),
        settings: existing.settings && Object.keys(existing.settings).length > 0 ? existing.settings : (project.settings || {}),
        sessionCount: Math.max(existing.sessionCount || 0, project.sessionCount || 0),
        lastActiveAt: pickLatestTimestamp(existing.lastActiveAt, project.lastActiveAt),
        sourceFlags: {
          ccgui: !!(existing.sourceFlags?.ccgui || project.sourceFlags?.ccgui),
          claude: !!(existing.sourceFlags?.claude || project.sourceFlags?.claude),
          codex: !!(existing.sourceFlags?.codex || project.sourceFlags?.codex)
        }
      })
    }
  }

  return Array.from(merged.values()).sort((a, b) => {
    if (!a.lastActiveAt) return 1
    if (!b.lastActiveAt) return -1
    return new Date(b.lastActiveAt) - new Date(a.lastActiveAt)
  })
}

async function scanProjects() {
  const providerProjectResults = await Promise.all(
    providerSessionSources.map(async (source) => ({
      provider: source.provider,
      projects: await Promise.resolve(source.scanProjects())
    }))
  )

  for (const entry of providerProjectResults) {
    for (const project of entry.projects) {
      ensureProjectConfig(project)
    }
  }

  const ccguiProjects = scanCCGUIProjects()
  const merged = mergeProjectsByPath(
    ccguiProjects,
    ...providerProjectResults.map(entry => entry.projects)
  )
  const providerSummary = providerProjectResults
    .map(entry => `${entry.provider}=${entry.projects.length}`)
    .join(', ')
  logger.info(`[ProjectService] Found ${merged.length} merged projects (ccgui=${ccguiProjects.length}${providerSummary ? `, ${providerSummary}` : ''})`)
  return merged
}

async function getProjectSessions(projectId) {
  const appConfig = appConfigManager.loadConfig()
  const projectPath = decodeProjectPath(projectId)
  const projectConfig = projectConfigManager.loadProjectConfig(projectId)
  const projectSettings = projectConfig?.settings || {}

  let ccguiSessions = []
  try {
    ccguiSessions = sessionConfigManager.getProjectSessions(projectId) || []
  } catch (error) {
    logger.warn('[ProjectService] Failed to read CCGUI sessions', { projectId, error: error.message })
  }

  const preferredLinkedSessions = buildPreferredLinkedSessionMap(ccguiSessions)
  const hiddenLinkedSessionIds = new Set()
  for (const group of groupSessionsByProviderIdentity(ccguiSessions).values()) {
    if (group.length <= 1) {
      continue
    }

    const preferred = choosePreferredLinkedSession(group)
    for (const session of group) {
      if (session?.id && session.id !== preferred?.id) {
        hiddenLinkedSessionIds.add(session.id)
      }
    }
  }

  const providerSessionResults = await Promise.all(
    providerSessionSources.map(async (source) => ({
      provider: source.provider,
      sessions: await Promise.resolve(source.listProjectSessions({ projectId, projectPath }))
    }))
  )

  const providerSessions = new Map()
  for (const entry of providerSessionResults) {
    for (const session of entry.sessions) {
      providerSessions.set(session.id, session)
    }
  }

  ensureProviderSessions(projectId, providerSessions, preferredLinkedSessions)

  const mergedSessions = []
  const processedIds = new Set()

  for (const ccguiSession of ccguiSessions) {
    if (hiddenLinkedSessionIds.has(ccguiSession.id)) {
      continue
    }

    const providerIdentity = buildProviderSessionIdentity(ccguiSession)
    const providerCandidateIds = [
      ccguiSession.id,
      ...(Array.isArray(providerIdentity?.nativeIds) ? providerIdentity.nativeIds : []),
      providerIdentity?.nativeId
    ].filter(Boolean)
    const providerData = providerCandidateIds
      .map(candidateId => providerSessions.get(candidateId))
      .find(Boolean) || null

    if (isProviderPlaceholderSession(ccguiSession) && !providerData) {
      logger.info('[ProjectService] Hiding stale provider placeholder session', {
        projectId,
        sessionId: ccguiSession.id,
        provider: providerIdentity?.provider || resolveLinkedSessionProvider(ccguiSession) || 'unknown'
      })
      continue
    }

    processedIds.add(ccguiSession.id)

    for (const candidateId of providerCandidateIds) {
      processedIds.add(candidateId)
    }
    if (Array.isArray(providerIdentity?.nativeIds)) {
      for (const nativeId of providerIdentity.nativeIds) {
        processedIds.add(nativeId)
      }
    }

    const bindingMeta = resolveSessionBindingMeta(ccguiSession, providerData)
    const mergedSettings = {
      ...(providerData?.settings || {}),
      ...(ccguiSession.settings || {})
    }
    const availability = buildSessionAvailability(appConfig, projectSettings, mergedSettings)

    mergedSessions.push({
      id: ccguiSession.id,
      projectId,
      name: ccguiSession.name || '会话',
      preview: providerData?.preview || '',
      createdAt: ccguiSession.createdAt || providerData?.createdAt,
      updatedAt: ccguiSession.updatedAt || providerData?.updatedAt,
      messageCount: providerData?.messageCount || ccguiSession.messageCount || 0,
      status: 'idle',
      bindingState: bindingMeta.bindingState,
      bindingLabel: bindingMeta.bindingLabel,
      bindingMissing: bindingMeta.bindingMissing,
      sessionAvailable: availability.available,
      sessionAvailableReason: availability.reason,
      initProvider: availability.initProvider,
      currentProvider: availability.currentProvider,
      settings: mergedSettings
    })
  }

  for (const entry of providerSessionResults) {
    for (const providerSession of entry.sessions) {
      if (processedIds.has(providerSession.id)) continue
      const availability = buildSessionAvailability(appConfig, projectSettings, providerSession.settings || {})
      mergedSessions.push({
        id: providerSession.id,
        projectId,
        name: providerSession.name || '会话',
        preview: providerSession.preview,
        createdAt: providerSession.createdAt,
        updatedAt: providerSession.updatedAt,
        messageCount: providerSession.messageCount || 0,
        status: 'idle',
        bindingState: 'linked',
        bindingLabel: '',
        bindingMissing: false,
        sessionAvailable: availability.available,
        sessionAvailableReason: availability.reason,
        initProvider: availability.initProvider,
        currentProvider: availability.currentProvider,
        settings: providerSession.settings || {}
      })
    }
  }

  mergedSessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
  return mergedSessions
}

function addProject(projectPath, settings) {
  const name = path.basename(projectPath)
  const projectId = encodeProjectPath(projectPath)
  let projectConfig = projectConfigManager.createProjectConfig(projectId, projectPath, name)
  if (settings) {
    projectConfig.settings = settings
    projectConfigManager.saveProjectConfig(projectId, projectConfig)
  }

  return {
    id: projectId,
    name,
    path: projectPath,
    sessionCount: 0,
    lastActiveAt: new Date().toISOString(),
    settings: projectConfig.settings || {},
    sourceFlags: {
      ccgui: true,
      claude: false,
      codex: false
    }
  }
}

function getProjectConfig(projectId) {
  return projectConfigManager.loadProjectConfig(projectId)
}

function updateProjectConfig(projectId, updates) {
  return projectConfigManager.updateProjectConfig(projectId, updates)
}

async function removeProject(projectId, deleteFolder) {
  const projects = await scanProjects()
  const project = projects.find(item => item.id === projectId) || null
  const projectPath = project?.path || null

  for (const source of providerSessionSources) {
    if (!source.deleteProject) continue
    await Promise.resolve(source.deleteProject({ projectId, projectPath }))
  }

  projectConfigManager.deleteProjectConfig(projectId)

  if (deleteFolder && projectPath && fs.existsSync(projectPath)) {
    fs.rmSync(projectPath, { recursive: true })
  }

  return { success: true }
}

function getSessionConfig(projectId, sessionId) {
  return sessionConfigManager.getSession(projectId, sessionId)
}

async function updateSessionConfig(projectId, sessionId, updates) {
  const normalizedUpdates = { ...(updates || {}) }
  if (!normalizedUpdates.name) {
    const existingSessions = await getProjectSessions(projectId)
    const existingSession = existingSessions.find(session => session.id === sessionId)
    if (existingSession?.name) {
      normalizedUpdates.name = existingSession.name
    }
  }

  return sessionConfigManager.updateSession(projectId, sessionId, normalizedUpdates)
}

function resetSessionConfig(projectId, sessionId) {
  return sessionConfigManager.updateSession(projectId, sessionId, { settings: {} })
}

function copySession(projectId, sessionId) {
  const existingSessions = sessionConfigManager.getProjectSessions(projectId) || []
  let maxNum = 0
  for (const session of existingSessions) {
    const match = session.name?.match(/^会话(\d+)$/)
    if (match) {
      maxNum = Math.max(maxNum, parseInt(match[1], 10))
    }
  }

  const sourceConfig = sessionConfigManager.getSession(projectId, sessionId)
  const hasSettings = sourceConfig?.settings && Object.keys(sourceConfig.settings).length > 0
  return sessionConfigManager.createSession(projectId, {
    name: `会话${maxNum + 1}`,
    settings: hasSettings ? { ...sourceConfig.settings } : {}
  })
}

async function createSession(projectId, name, settings) {
  const appConfig = appConfigManager.loadConfig()
  const projectConfig = projectConfigManager.loadProjectConfig(projectId)
  const tool = resolveProvider(projectConfig?.settings || {}, settings || {})
  const resolvedSettings = resolveSessionSettings(
    appConfig,
    projectConfig?.settings || {},
    settings || null,
    tool
  )
  const nextSettings = {
    ...(settings || {}),
    initProvider: resolveInitProvider(tool, resolvedSettings)
  }

  const sessionConfig = sessionConfigManager.createSession(projectId, {
    name: name || '新会话',
    settings: nextSettings
  })

  const source = providerSessionSourcesById[tool]
  if (!source?.createSession) {
    return sessionConfig
  }

  try {
    const created = await Promise.resolve(source.createSession({
      projectId,
      projectPath: decodeProjectPath(projectId),
      sessionId: sessionConfig.id,
      settings: sessionConfig.settings || {}
    }))
    const nativeSessionId = typeof created?.nativeSessionId === 'string' && created.nativeSessionId.trim()
      ? created.nativeSessionId.trim()
      : null
    const nextSettings = {
      ...(sessionConfig.settings || {}),
      toolBinding: normalizeToolBinding(
        sessionConfig.settings?.toolBinding,
        tool,
        nativeSessionId
      )
    }
    if (tool === 'codex' && nativeSessionId) {
      nextSettings.codexThreadId = nativeSessionId
    }

    return sessionConfigManager.updateSession(projectId, sessionConfig.id, {
      settings: nextSettings
    })
  } catch (error) {
    logger.warn('[ProjectService] Failed to create provider-native session binding', {
      projectId,
      sessionId: sessionConfig.id,
      tool,
      error: error.message
    })
    return sessionConfig
  }
}

async function deleteSession(projectId, sessionId) {
  const existingSessions = await getProjectSessions(projectId)
  const existingSession = existingSessions.find(session => session.id === sessionId) || null
  const provider = resolveLinkedSessionProvider(existingSession)
  let providerDeleteError = null

  if (provider) {
    const source = providerSessionSourcesById[provider]
    if (source?.deleteSession) {
      try {
        await source.deleteSession({
          projectId,
          sessionId,
          session: existingSession
        })
      } catch (error) {
        providerDeleteError = error
        logger.warn('[ProjectService] Failed to delete provider-native session', {
          projectId,
          sessionId,
          provider,
          error: error.message
        })
      }
    }
  }

  sessionConfigManager.deleteSession(projectId, sessionId)
  historyManager.deleteHistory(projectId, sessionId)

  return {
    success: true,
    session: existingSession,
    providerDeleted: !providerDeleteError,
    providerDeleteError: providerDeleteError?.message || null
  }
}

async function openSession(sessionId) {
  const projects = await scanProjects()
  for (const project of projects) {
    const sessions = await getProjectSessions(project.id)
    const session = sessions.find(item => item.id === sessionId)
    if (!session) continue
    return {
      id: session.id,
      projectId: project.id,
      projectPath: project.path,
      name: session.name || '会话',
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      status: 'idle',
      settings: session.settings || {}
    }
  }

  return null
}

async function renameSession(sessionId, projectId, name) {
  let targetProjectId = projectId

  if (!targetProjectId) {
    const projects = await scanProjects()
    for (const project of projects) {
      const sessions = await getProjectSessions(project.id)
      if (sessions.some(session => session.id === sessionId) || sessionConfigManager.sessionExists(project.id, sessionId)) {
        targetProjectId = project.id
        break
      }
    }
  }

  if (!targetProjectId) {
    return null
  }

  return sessionConfigManager.updateSession(targetProjectId, sessionId, {
    name: name.trim()
  })
}

function getSessionMessages(projectId, sessionId) {
  return historyManager.loadHistory(projectId, sessionId)
}

function resolveRuntimeConfig(projectId, sessionId) {
  const appConfig = appConfigManager.loadConfig()
  const projectConfig = projectConfigManager.loadProjectConfig(projectId)
  const sessionConfig = sessionConfigManager.getSession(projectId, sessionId)
  const provider = resolveProvider(projectConfig?.settings || {}, sessionConfig?.settings || null)

  return {
    settings: resolveSessionSettings(
      appConfig,
      projectConfig?.settings || {},
      sessionConfig?.settings || null,
      provider
    ),
    appConfig,
    projectConfig,
    sessionConfig
  }
}

function getSessionAvailable(projectId, sessionId) {
  const appConfig = appConfigManager.loadConfig()
  const projectConfig = projectConfigManager.loadProjectConfig(projectId)
  const sessionConfig = sessionConfigManager.getSession(projectId, sessionId)

  if (!sessionConfig) {
    return {
      available: false,
      provider: null,
      currentProvider: null,
      initProvider: null,
      reason: 'session-not-found'
    }
  }

  return buildSessionAvailability(appConfig, projectConfig?.settings || {}, sessionConfig?.settings || null)
}

function getModelConfigSummary({ provider = 'claude', projectId = null, sessionId = null } = {}) {
  const appConfig = appConfigManager.loadConfig()
  const normalizedProvider = provider === 'codex' ? 'codex' : 'claude'
  const projectConfig = projectId ? projectConfigManager.loadProjectConfig(projectId) : null
  const sessionConfig = projectId && sessionId ? sessionConfigManager.getSession(projectId, sessionId) : null
  const resolvedProvider = sessionConfig
    ? resolveProvider(projectConfig?.settings || {}, sessionConfig?.settings || null)
    : normalizedProvider
  const providerToUse = resolvedProvider || normalizedProvider

  const systemResolved = resolveProjectSettings(appConfig, {}, providerToUse)
  const projectResolved = resolveProjectSettings(appConfig, projectConfig?.settings || {}, providerToUse)
  const sessionResolved = sessionConfig
    ? resolveSessionSettings(appConfig, projectConfig?.settings || {}, sessionConfig?.settings || null, providerToUse)
    : null

  return {
    provider: providerToUse,
    systemSummary: summarizeResolvedTarget(appConfig, providerToUse, systemResolved, '当前系统未设置默认模型'),
    projectSummary: projectId
      ? summarizeResolvedTarget(appConfig, providerToUse, projectResolved, '当前项目未设置默认模型')
      : null,
    sessionSummary: sessionConfig
      ? summarizeResolvedTarget(appConfig, providerToUse, sessionResolved, '当前会话未设置默认模型')
      : null
  }
}

function updateSessionSettings(projectId, sessionId, settings) {
  return sessionConfigManager.updateSession(projectId, sessionId, { settings })
}

async function listSessionSubmodels(projectId, sessionId, options = {}) {
  const appConfig = appConfigManager.loadConfig()
  const projectConfig = projectConfigManager.loadProjectConfig(projectId)
  const sessionConfig = sessionConfigManager.getSession(projectId, sessionId)
  const provider = resolveProvider(projectConfig?.settings || {}, sessionConfig?.settings || null)
  const resolved = resolveSessionSettings(
    appConfig,
    projectConfig?.settings || {},
    sessionConfig?.settings || null,
    provider
  )

  const configuredModel = resolved.targetKind === 'openai'
    ? null
    : (resolved.modelId
        ? findProviderModel(appConfig, provider, resolved.modelId)
        : resolveSystemSelectedModel(appConfig, provider))
  const configuredOptions = buildConfiguredSubModelOptions(configuredModel, resolved.modelCardId)
  const defaultCard = resolveConfiguredDefaultCard(configuredModel, resolved.modelCardId)
  const workingDirectory = options.workingDirectory || decodeProjectPath(projectId)

  let providerOptions = []
  if (provider === 'claude') {
    const result = await listClaudeModels({
      workingDirectory,
      projectSettings: resolved
    })
    providerOptions = normalizeProviderSubModelOptions(provider, result.data || [], readClaudeRuntimeDefaults())
  } else if (provider === 'codex') {
    const result = await listCodexModels({ workingDirectory, includeHidden: false, limit: 100 })
    providerOptions = normalizeProviderSubModelOptions(provider, result.data || [])
  }

  return {
    provider,
    configuredModelId: configuredModel?.id || null,
    defaultValue: defaultCard?.modelName || '',
    options: mergeSubModelOptions(configuredOptions, providerOptions)
  }
}

async function listSessionReasoningCapabilities(projectId, sessionId, options = {}) {
  const appConfig = appConfigManager.loadConfig()
  const projectConfig = projectConfigManager.loadProjectConfig(projectId)
  const sessionConfig = sessionConfigManager.getSession(projectId, sessionId)
  const provider = resolveProvider(projectConfig?.settings || {}, sessionConfig?.settings || null)
  const resolved = resolveSessionSettings(
    appConfig,
    projectConfig?.settings || {},
    sessionConfig?.settings || null,
    provider
  )
  const workingDirectory = options.workingDirectory || decodeProjectPath(projectId)
  const runtimeModel = typeof options.model === 'string' ? options.model.trim() : ''

  let configuredModelName = ''
  if (!runtimeModel) {
    const configuredModel = resolved.targetKind === 'openai'
      ? null
      : (resolved.modelId
          ? findProviderModel(appConfig, provider, resolved.modelId)
          : resolveSystemSelectedModel(appConfig, provider))
    const defaultCard = resolveConfiguredDefaultCard(configuredModel, resolved.modelCardId)
    configuredModelName = defaultCard?.modelName || ''
  }

  let result = {
    provider,
    model: runtimeModel || configuredModelName,
    supportsRuntimeSwitch: false,
    defaultValue: '',
    options: []
  }

  if (provider === 'claude') {
    result = await listClaudeReasoningCapabilities({
      workingDirectory,
      model: runtimeModel || configuredModelName
    })
  } else if (provider === 'codex') {
    result = await listCodexReasoningCapabilities({
      workingDirectory,
      model: runtimeModel || configuredModelName
    })
  }

  return {
    provider,
    model: result.model || runtimeModel || configuredModelName || '',
    supportsRuntimeSwitch: result.supportsRuntimeSwitch === true,
    defaultValue: result.defaultValue || resolved.effort || '',
    options: normalizeReasoningOptions(result.options || [])
  }
}

module.exports = {
  addProject,
  copySession,
  createSession,
  deleteSession,
  getProjectConfig,
  getProjectSessions,
  getSessionConfig,
  getSessionAvailable,
  getSessionMessages,
  getModelConfigSummary,
  getAvailableTargets,
  validateSessionTarget,
  openSession,
  removeProject,
  renameSession,
  resolveRuntimeConfig,
  resetSessionConfig,
  scanProjects,
  listSessionSubmodels,
  listSessionReasoningCapabilities,
  updateProjectConfig,
  updateSessionConfig,
  updateSessionSettings
}
