import { ref, computed } from 'vue'
import { logger } from '../../../../utils/logger'
import { findProviderModel, getProviderModels } from '../../../../utils/provider-models'

const EFFORT_OPTION_MAP = {
  low: { label: '低', icon: '⚡', description: '更快返回结果，思考更少' },
  medium: { label: '中', icon: '🧠', description: '平衡思考力度与响应速度' },
  high: { label: '高', icon: '🔬', description: '更深入思考，耗时更长' },
  xhigh: { label: '超高', icon: '🚀', description: '最大化思考力度，耗时最长' }
}

function normalizeSessionModelSettings(settings = {}) {
  const modelMode = settings.modelMode || (settings.modelId === '' ? 'system' : (settings.modelId ? 'custom' : 'project'))
  return {
    modelMode,
    modelId: modelMode === 'custom' ? settings.modelId || null : null,
    modelCardId: modelMode === 'custom' ? settings.modelCardId || null : null
  }
}

function formatModelLabel(appConfig, provider, modelId, fallback = '系统') {
  if (!modelId) return fallback
  const model = findProviderModel(appConfig, provider, modelId)
  if (!model) return modelId
  return model.friendlyName || model.id
}

function formatTargetLabel(appConfig, provider, settings = {}, fallback = '系统') {
  const targetKind = typeof settings?.targetKind === 'string' ? settings.targetKind.trim() : ''
  if (provider === 'codex' && targetKind === 'openai') {
    return 'OpenAI'
  }

  if (targetKind && targetKind !== 'provider' && targetKind !== 'project' && targetKind !== 'system') {
    return targetKind
  }

  const modelId = typeof settings?.modelId === 'string' && settings.modelId.trim()
    ? settings.modelId.trim()
    : null
  return formatModelLabel(appConfig, provider, modelId, fallback)
}

function toPlainObject(value) {
  return value ? JSON.parse(JSON.stringify(value)) : {}
}

function resetSubModelStateRefs({
  providerSubModelOptions,
  providerSubModelDefaultValue,
  lastLoadedSubModelProvider
}) {
  providerSubModelOptions.value = []
  providerSubModelDefaultValue.value = ''
  lastLoadedSubModelProvider.value = ''
}

function formatEffortOption(option) {
  const value = typeof option?.value === 'string' ? option.value : ''
  if (!value) return null

  const preset = EFFORT_OPTION_MAP[value] || null
  return {
    key: value,
    value,
    label: preset?.label || option.label || value,
    icon: preset?.icon || '🧠',
    description: preset?.description || option.description || ''
  }
}

function resetEffortStateRefs({
  providerEffortOptions,
  providerEffortDefaultValue,
  providerSupportsRuntimeEffortSwitch,
  lastLoadedEffortKey
}) {
  providerEffortOptions.value = []
  providerEffortDefaultValue.value = ''
  providerSupportsRuntimeEffortSwitch.value = false
  lastLoadedEffortKey.value = ''
}

function buildSubModelCacheKey(projectId, sessionId, provider, modelSelectionKey) {
  return [projectId || '', sessionId || '', provider || '', modelSelectionKey || ''].join(':')
}

function buildEffortCacheKey(projectId, sessionId, provider, model) {
  return [projectId || '', sessionId || '', provider || '', model || 'default'].join(':')
}

export function useSessionModelControls({
  sessionStore,
  appStore,
  envInfo,
  currentSessionMeta,
  workingDirectory,
  isSessionRuntimeStarted
}) {
  const appConfig = ref(null)
  const projectConfig = ref(null)
  const sessionConfig = ref(null)
  const providerSubModelOptions = ref([])
  const sessionTargetOptions = ref([])
  const currentSessionTargetId = ref('')
  const providerSubModelDefaultValue = ref('')
  const providerSubModelLoading = ref(false)
  const lastLoadedSubModelProvider = ref('')
  const providerEffortOptions = ref([])
  const providerEffortDefaultValue = ref('')
  const providerEffortLoading = ref(false)
  const providerSupportsRuntimeEffortSwitch = ref(false)
  const lastLoadedEffortKey = ref('')
  const targetSwitching = ref(false)
  const subModelSwitching = ref(false)
  const effortSwitching = ref(false)
  const subModelCache = new Map()
  const effortCapabilityCache = new Map()
  const sessionSubModelStateCache = new Map()
  const sessionEffortStateCache = new Map()

  function getCurrentSessionId() {
    return appStore.currentSession?.id || ''
  }

  function persistSessionDerivedState(sessionId = getCurrentSessionId()) {
    if (!sessionId) {
      return
    }

    sessionSubModelStateCache.set(sessionId, {
      providerSubModelOptions: toPlainObject(providerSubModelOptions.value),
      providerSubModelDefaultValue: providerSubModelDefaultValue.value || '',
      lastLoadedSubModelProvider: lastLoadedSubModelProvider.value || ''
    })

    sessionEffortStateCache.set(sessionId, {
      providerEffortOptions: toPlainObject(providerEffortOptions.value),
      providerEffortDefaultValue: providerEffortDefaultValue.value || '',
      providerSupportsRuntimeEffortSwitch: providerSupportsRuntimeEffortSwitch.value === true,
      lastLoadedEffortKey: lastLoadedEffortKey.value || ''
    })
  }

  function restoreSessionDerivedState(sessionId = getCurrentSessionId()) {
    if (!sessionId) {
      return false
    }

    providerSubModelLoading.value = false
    providerEffortLoading.value = false

    let restored = false

    if (sessionSubModelStateCache.has(sessionId)) {
      const cachedSubModel = sessionSubModelStateCache.get(sessionId)
      providerSubModelOptions.value = Array.isArray(cachedSubModel?.providerSubModelOptions) ? cachedSubModel.providerSubModelOptions : []
      providerSubModelDefaultValue.value = cachedSubModel?.providerSubModelDefaultValue || ''
      lastLoadedSubModelProvider.value = cachedSubModel?.lastLoadedSubModelProvider || ''
      restored = true
    }

    if (sessionEffortStateCache.has(sessionId)) {
      const cachedEffort = sessionEffortStateCache.get(sessionId)
      providerEffortOptions.value = Array.isArray(cachedEffort?.providerEffortOptions) ? cachedEffort.providerEffortOptions : []
      providerEffortDefaultValue.value = cachedEffort?.providerEffortDefaultValue || ''
      providerSupportsRuntimeEffortSwitch.value = cachedEffort?.providerSupportsRuntimeEffortSwitch === true
      lastLoadedEffortKey.value = cachedEffort?.lastLoadedEffortKey || ''
      restored = true
    }

    return restored
  }

  const isSwitchingSessionControls = computed(() => {
    return targetSwitching.value || subModelSwitching.value || effortSwitching.value
  })

  const canQuickSwitchModel = computed(() => {
    return !!appStore.currentSession?.id && sessionTargetOptions.value.some(option => option.selectable !== false)
  })

  const canQuickSwitchSubModel = computed(() => {
    return !!appStore.currentSession?.id
  })

  const canQuickSwitchEffort = computed(() => {
    return !!appStore.currentSession?.id && providerEffortOptions.value.length > 0
  })

  const currentModelProvider = computed(() => {
    return (
      sessionConfig.value?.settings?.toolBinding?.tool ||
      sessionConfig.value?.settings?.tool ||
      sessionConfig.value?.settings?.provider ||
      envInfo.value?.provider ||
      currentSessionMeta.value?.tool ||
      'claude'
    )
  })

  const availableModelOptions = computed(() => {
    return sessionTargetOptions.value.map(option => ({
      key: option.id,
      label: option.label,
      targetKind: option.targetKind,
      modelId: option.modelId || null,
      credentialId: option.credentialId || null,
      selectable: option.selectable !== false,
      reasonDisabled: option.reasonDisabled || ''
    }))
  })

  const currentModelLabel = computed(() => {
    const currentTarget = sessionTargetOptions.value.find(option => option.id === currentSessionTargetId.value)
    if (currentTarget?.label) {
      return currentTarget.label
    }
    const normalizedSession = normalizeSessionModelSettings(sessionConfig.value?.settings || {})
    const rawSettings = sessionConfig.value?.settings || {}
    if (normalizedSession.modelMode === 'custom') {
      return formatTargetLabel(appConfig.value, currentModelProvider.value, rawSettings)
    }
    return formatTargetLabel(appConfig.value, currentModelProvider.value, rawSettings, '系统')
  })

  const currentModelSelectionKey = computed(() => {
    return currentSessionTargetId.value || 'system'
  })

  const currentSubModelValue = computed(() => {
    const runtimeValue = typeof envInfo.value?.model === 'string' ? envInfo.value.model.trim() : ''
    if (runtimeValue) {
      return runtimeValue
    }

    return providerSubModelDefaultValue.value || ''
  })

  const currentSubModelLabel = computed(() => {
    if (!currentSubModelValue.value) {
      return '默认'
    }

    const matched = providerSubModelOptions.value.find(option => option.value === currentSubModelValue.value)
    return matched?.label || currentSubModelValue.value
  })

  const currentSubModelKey = computed(() => {
    return currentSubModelValue.value || 'default'
  })

  const currentEffortValue = computed(() => {
    const runtimeValue = typeof envInfo.value?.model_reasoning_effort === 'string'
      ? envInfo.value.model_reasoning_effort.trim()
      : ''
    if (runtimeValue) {
      return runtimeValue
    }

    const configuredValue = typeof sessionConfig.value?.settings?.effort === 'string'
      ? sessionConfig.value.settings.effort.trim()
      : ''
    if (configuredValue && configuredValue !== 'default') {
      return configuredValue
    }

    return providerEffortDefaultValue.value || 'medium'
  })

  const currentEffortKey = computed(() => currentEffortValue.value || 'medium')

  const availableEffortOptions = computed(() => {
    const normalized = providerEffortOptions.value
      .map(formatEffortOption)
      .filter(Boolean)

    if (normalized.some(option => option.value === currentEffortValue.value)) {
      return normalized
    }

    const currentOption = formatEffortOption({ value: currentEffortValue.value })
    return currentOption ? [...normalized, currentOption] : normalized
  })

  async function loadModelConfigContext() {
    if (!appStore.currentProject?.id || !appStore.currentSession?.id) return

    try {
      const [appResult, projectResult, sessionResult] = await Promise.all([
        window.electronAPI.getAppConfig(),
        window.electronAPI.getProjectConfig({ projectId: appStore.currentProject.id }),
        window.electronAPI.getSessionConfig({
          projectId: appStore.currentProject.id,
          sessionId: appStore.currentSession.id
        })
      ])

      if (appResult?.success) {
        appConfig.value = appResult.config
      }
      projectConfig.value = projectResult?.config || null
      sessionConfig.value = sessionResult?.config || null
      const targetResult = await sessionStore.getAvailableTargets({
        projectId: appStore.currentProject.id
      })
      if (targetResult?.success) {
        sessionTargetOptions.value = Array.isArray(targetResult.options) ? targetResult.options : []
        currentSessionTargetId.value = targetResult.currentTargetId || ''
      } else {
        sessionTargetOptions.value = []
        currentSessionTargetId.value = ''
      }
    } catch (error) {
      logger.error('[Chat] Failed to load model config context', { error: error.message })
    }
  }

  async function loadProviderSubModels(options = {}) {
    const provider = currentModelProvider.value
    const projectId = appStore.currentProject?.id || ''
    const sessionId = appStore.currentSession?.id || ''
    const modelSelectionKey = currentModelSelectionKey.value || ''
    const cacheKey = buildSubModelCacheKey(projectId, sessionId, provider, modelSelectionKey)

    if (!options.force && lastLoadedSubModelProvider.value === cacheKey && providerSubModelOptions.value.length > 0) {
      providerSubModelLoading.value = false
      return
    }

    if (!options.force && subModelCache.has(cacheKey)) {
      const cached = subModelCache.get(cacheKey)
      providerSubModelOptions.value = Array.isArray(cached?.options) ? cached.options : []
      providerSubModelDefaultValue.value = cached?.defaultValue || ''
      lastLoadedSubModelProvider.value = cacheKey
      providerSubModelLoading.value = false
      persistSessionDerivedState()
      return
    }

    providerSubModelLoading.value = true

    try {
      const result = await sessionStore.listSessionSubmodels({
        projectId: appStore.currentProject?.id,
        workingDirectory: appStore.currentProject?.path || workingDirectory.value || ''
      })
      if (!result?.success) {
        throw new Error(result?.error || '加载子模型失败')
      }

      providerSubModelOptions.value = Array.isArray(result.options) ? result.options : []
      providerSubModelDefaultValue.value = result.defaultValue || ''
      lastLoadedSubModelProvider.value = cacheKey
      subModelCache.set(cacheKey, {
        options: providerSubModelOptions.value,
        defaultValue: providerSubModelDefaultValue.value,
        provider: result.provider || provider
      })
      persistSessionDerivedState()
    } catch (error) {
      providerSubModelOptions.value = []
      providerSubModelDefaultValue.value = ''
      logger.error('[Chat] Failed to load provider sub models', {
        provider,
        error: error.message
      })
    } finally {
      providerSubModelLoading.value = false
    }
  }

  async function loadSessionEffortCapabilities(options = {}) {
    const projectId = appStore.currentProject?.id || ''
    const sessionId = appStore.currentSession?.id || ''
    const model = currentSubModelValue.value || (typeof envInfo.value?.model === 'string' ? envInfo.value.model.trim() : '')
    const cacheKey = buildEffortCacheKey(projectId, sessionId, currentModelProvider.value, model || 'default')

    if (!options.force && lastLoadedEffortKey.value === cacheKey && providerEffortOptions.value.length > 0) {
      providerEffortLoading.value = false
      return
    }

    if (!options.force && effortCapabilityCache.has(cacheKey)) {
      const cached = effortCapabilityCache.get(cacheKey)
      providerEffortOptions.value = Array.isArray(cached?.options) ? cached.options : []
      providerEffortDefaultValue.value = cached?.defaultValue || ''
      providerSupportsRuntimeEffortSwitch.value = cached?.supportsRuntimeSwitch === true
      lastLoadedEffortKey.value = cacheKey
      providerEffortLoading.value = false
      persistSessionDerivedState()
      return
    }

    providerEffortLoading.value = true

    try {
      const result = await sessionStore.listSessionEffortOptions({
        projectId: appStore.currentProject?.id,
        workingDirectory: appStore.currentProject?.path || workingDirectory.value || '',
        model
      })
      if (!result?.success) {
        throw new Error(result?.error || '加载思考力度失败')
      }

      providerEffortOptions.value = Array.isArray(result.options) ? result.options : []
      providerEffortDefaultValue.value = result.defaultValue || ''
      providerSupportsRuntimeEffortSwitch.value = result.supportsRuntimeSwitch === true
      lastLoadedEffortKey.value = cacheKey
      effortCapabilityCache.set(cacheKey, {
        options: providerEffortOptions.value,
        defaultValue: providerEffortDefaultValue.value,
        supportsRuntimeSwitch: providerSupportsRuntimeEffortSwitch.value
      })
      persistSessionDerivedState()
    } catch (error) {
      resetEffortStateRefs({
        providerEffortOptions,
        providerEffortDefaultValue,
        providerSupportsRuntimeEffortSwitch,
        lastLoadedEffortKey
      })
      logger.error('[Chat] Failed to load session effort capabilities', {
        provider: currentModelProvider.value,
        model,
        error: error.message
      })
    } finally {
      providerEffortLoading.value = false
    }
  }

  async function handleQuickModelChange(option) {
    if (!appStore.currentProject?.id || !appStore.currentSession?.id) return

    const plainOption = toPlainObject(option)
    if (!plainOption?.key || plainOption.key === currentSessionTargetId.value) {
      return
    }

    if (plainOption.selectable === false) {
      alert(plainOption.reasonDisabled || '当前会话暂时不能切换到这个供应商令牌')
      return
    }

    targetSwitching.value = true
    try {
      const result = await sessionStore.setSessionTarget({
        projectId: appStore.currentProject.id,
        workingDirectory: appStore.currentProject.path || workingDirectory.value || '',
        targetId: plainOption.key,
        targetKind: plainOption.targetKind || 'provider',
        modelId: plainOption.modelId || null,
        credentialId: plainOption.credentialId || null
      })

      if (!result?.success) {
        throw new Error(result?.error || '切换供应商令牌失败')
      }

      resetSubModelStateRefs({
        providerSubModelOptions,
        providerSubModelDefaultValue,
        lastLoadedSubModelProvider
      })
      resetEffortStateRefs({
        providerEffortOptions,
        providerEffortDefaultValue,
        providerSupportsRuntimeEffortSwitch,
        lastLoadedEffortKey
      })
      await loadModelConfigContext()
      await loadProviderSubModels({ force: true })
      await loadSessionEffortCapabilities({ force: true })
      await appStore.fetchSessions(appStore.currentProject.id)
    } catch (error) {
      logger.error('[Chat] Failed to quick switch session target', { error: error.message })
      alert('切换供应商令牌失败: ' + error.message)
    } finally {
      targetSwitching.value = false
    }
  }

  async function handleQuickSubModelChange(option) {
    if (!appStore.currentSession?.id) return

    const selectedValue = option?.value || ''
    const wasRuntimeStarted = isSessionRuntimeStarted.value
    if (!selectedValue || selectedValue === currentSubModelValue.value) {
      return
    }

    if (!wasRuntimeStarted) {
      return
    }

    subModelSwitching.value = true
    try {
      const result = await sessionStore.setSessionSubmodel({
        model: selectedValue,
        reasoningEffort: option.reasoningEffort || 'medium'
      })
      if (!result?.success) {
        throw new Error(result?.error || '设置子模型失败')
      }

      await loadProviderSubModels()
      await loadSessionEffortCapabilities({ force: true })
    } catch (error) {
      logger.error('[Chat] Failed to quick switch sub model', {
        model: selectedValue,
        error: error.message
      })
      alert('切换子模型失败: ' + error.message)
    } finally {
      subModelSwitching.value = false
    }
  }

  async function handleQuickEffortChange(optionOrValue) {
    if (!appStore.currentProject?.id || !appStore.currentSession?.id) return

    const selectedValue = typeof optionOrValue === 'string'
      ? optionOrValue
      : optionOrValue?.value
    const normalizedValue = typeof selectedValue === 'string' ? selectedValue.trim() : ''
    if (!normalizedValue || normalizedValue === currentEffortValue.value) {
      return
    }

    const currentModel = currentSubModelValue.value || (typeof envInfo.value?.model === 'string' ? envInfo.value.model.trim() : '')

    effortSwitching.value = true
    try {
      const result = await sessionStore.setSessionEffort({
        projectId: appStore.currentProject.id,
        effort: normalizedValue,
        workingDirectory: appStore.currentProject.path || workingDirectory.value || '',
        model: currentModel
      })

      if (!result?.success) {
        throw new Error(result?.error || '设置思考力度失败')
      }

      if (result.config) {
        sessionConfig.value = result.config
      }

      await loadModelConfigContext()
      await loadSessionEffortCapabilities({ force: true })
      await appStore.fetchSessions(appStore.currentProject.id)
    } catch (error) {
      logger.error('[Chat] Failed to quick switch effort', {
        effort: normalizedValue,
        error: error.message
      })
      alert('切换思考力度失败: ' + error.message)
    } finally {
      effortSwitching.value = false
    }
  }

  function resetModelState() {
    appConfig.value = null
    projectConfig.value = null
    sessionConfig.value = null
    sessionTargetOptions.value = []
    currentSessionTargetId.value = ''
    providerSubModelLoading.value = false
    providerEffortLoading.value = false
    resetSubModelStateRefs({
      providerSubModelOptions,
        providerSubModelDefaultValue,
        lastLoadedSubModelProvider
      })
    resetEffortStateRefs({
      providerEffortOptions,
      providerEffortDefaultValue,
      providerSupportsRuntimeEffortSwitch,
      lastLoadedEffortKey
    })
  }

  function resetSubModelState() {
    providerSubModelLoading.value = false
    resetSubModelStateRefs({
      providerSubModelOptions,
        providerSubModelDefaultValue,
        lastLoadedSubModelProvider
      })
  }

  function resetEffortState() {
    providerEffortLoading.value = false
    resetEffortStateRefs({
      providerEffortOptions,
      providerEffortDefaultValue,
      providerSupportsRuntimeEffortSwitch,
      lastLoadedEffortKey
    })
  }

  return {
    appConfig,
    projectConfig,
    sessionConfig,
    canQuickSwitchModel,
    canQuickSwitchSubModel,
    currentModelProvider,
    availableModelOptions,
    currentModelLabel,
    currentModelSelectionKey,
    providerSubModelOptions,
    providerSubModelLoading,
    currentSubModelLabel,
    currentSubModelKey,
    availableEffortOptions,
    providerEffortLoading,
    canQuickSwitchEffort,
    currentEffortValue,
    currentEffortKey,
    providerSupportsRuntimeEffortSwitch,
    isSwitchingSessionControls,
    loadModelConfigContext,
    loadProviderSubModels,
    loadSessionEffortCapabilities,
    restoreSessionDerivedState,
    handleQuickModelChange,
    handleQuickSubModelChange,
    handleQuickEffortChange,
    resetModelState,
    resetSubModelState,
    resetEffortState
  }
}
