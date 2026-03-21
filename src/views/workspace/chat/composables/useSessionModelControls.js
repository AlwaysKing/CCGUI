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

function buildSubModelCacheKey(projectId, provider, modelSelectionKey) {
  return [projectId || '', provider || '', modelSelectionKey || ''].join(':')
}

function buildEffortCacheKey(projectId, provider, model) {
  return [projectId || '', provider || '', model || 'default'].join(':')
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
  const providerSubModelDefaultValue = ref('')
  const providerSubModelLoading = ref(false)
  const lastLoadedSubModelProvider = ref('')
  const providerEffortOptions = ref([])
  const providerEffortDefaultValue = ref('')
  const providerEffortLoading = ref(false)
  const providerSupportsRuntimeEffortSwitch = ref(false)
  const lastLoadedEffortKey = ref('')
  const subModelCache = new Map()
  const effortCapabilityCache = new Map()

  const canQuickSwitchModel = computed(() => {
    return !!appStore.currentSession?.id
  })

  const canQuickSwitchSubModel = computed(() => {
    return !!appStore.currentSession?.id
  })

  const canQuickSwitchEffort = computed(() => {
    return !!appStore.currentSession?.id && providerEffortOptions.value.length > 0
  })

  const currentModelProvider = computed(() => {
    return sessionConfig.value?.settings?.tool || sessionConfig.value?.settings?.provider || envInfo.value?.provider || currentSessionMeta.value?.tool || 'claude'
  })

  const availableModelOptions = computed(() => {
    const models = getProviderModels(appConfig.value, currentModelProvider.value).filter(model => model.isActive !== false)
    const customOptions = models.map(model => ({
      key: model.id,
      mode: 'custom',
      modelId: model.id,
      modelCardId: null,
      label: model.friendlyName || model.id
    }))

    return [
      { key: 'system', mode: 'system', modelId: null, modelCardId: null, label: '系统' },
      { key: 'project', mode: 'project', modelId: null, modelCardId: null, label: '项目' },
      ...customOptions
    ]
  })

  const currentModelLabel = computed(() => {
    const normalizedSession = normalizeSessionModelSettings(sessionConfig.value?.settings || {})

    if (!sessionConfig.value?.settings || Object.keys(sessionConfig.value.settings).length === 0) {
      return '项目'
    }

    if (normalizedSession.modelMode === 'custom') {
      return formatModelLabel(appConfig.value, currentModelProvider.value, normalizedSession.modelId)
    }
    if (normalizedSession.modelMode === 'system') {
      return '系统'
    }
    return '项目'
  })

  const currentModelSelectionKey = computed(() => {
    const normalizedSession = normalizeSessionModelSettings(sessionConfig.value?.settings || {})

    if (!sessionConfig.value?.settings || Object.keys(sessionConfig.value.settings).length === 0) {
      return 'project'
    }

    if (normalizedSession.modelMode === 'custom') {
      return normalizedSession.modelId || 'project'
    }

    return normalizedSession.modelMode
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
    } catch (error) {
      logger.error('[Chat] Failed to load model config context', { error: error.message })
    }
  }

  async function loadProviderSubModels(options = {}) {
    const provider = currentModelProvider.value
    const projectId = appStore.currentProject?.id || ''
    const modelSelectionKey = currentModelSelectionKey.value || ''
    const cacheKey = buildSubModelCacheKey(projectId, provider, modelSelectionKey)

    if (!options.force && lastLoadedSubModelProvider.value === provider && providerSubModelOptions.value.length > 0) {
      return
    }

    if (!options.force && subModelCache.has(cacheKey)) {
      const cached = subModelCache.get(cacheKey)
      providerSubModelOptions.value = Array.isArray(cached?.options) ? cached.options : []
      providerSubModelDefaultValue.value = cached?.defaultValue || ''
      lastLoadedSubModelProvider.value = cached?.provider || provider
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
      lastLoadedSubModelProvider.value = result.provider || provider
      subModelCache.set(cacheKey, {
        options: providerSubModelOptions.value,
        defaultValue: providerSubModelDefaultValue.value,
        provider: lastLoadedSubModelProvider.value
      })
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
    const model = currentSubModelValue.value || (typeof envInfo.value?.model === 'string' ? envInfo.value.model.trim() : '')
    const cacheKey = buildEffortCacheKey(projectId, currentModelProvider.value, model || 'default')

    if (!options.force && lastLoadedEffortKey.value === cacheKey && providerEffortOptions.value.length > 0) {
      return
    }

    if (!options.force && effortCapabilityCache.has(cacheKey)) {
      const cached = effortCapabilityCache.get(cacheKey)
      providerEffortOptions.value = Array.isArray(cached?.options) ? cached.options : []
      providerEffortDefaultValue.value = cached?.defaultValue || ''
      providerSupportsRuntimeEffortSwitch.value = cached?.supportsRuntimeSwitch === true
      lastLoadedEffortKey.value = cacheKey
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
    const existingSettings = toPlainObject(sessionConfig.value?.settings)
    const normalizedSession = normalizeSessionModelSettings(existingSettings)
    if (
      normalizedSession.modelMode === plainOption.mode &&
      (plainOption.mode !== 'custom' || (
        normalizedSession.modelId === plainOption.modelId &&
        (normalizedSession.modelCardId || null) === (plainOption.modelCardId || null)
      ))
    ) {
      return
    }

    try {
      const result = await sessionStore.setSessionModel({
        projectId: appStore.currentProject.id,
        workingDirectory: appStore.currentProject.path || workingDirectory.value || '',
        mode: plainOption.mode,
        modelId: plainOption.mode === 'custom' ? plainOption.modelId : null,
        modelCardId: plainOption.mode === 'custom' ? (plainOption.modelCardId || null) : null
      })

      if (!result?.success) {
        throw new Error(result?.error || '切换模型失败')
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
      logger.error('[Chat] Failed to quick switch model', { error: error.message })
      alert('切换模型失败: ' + error.message)
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
    }
  }

  function resetModelState() {
    projectConfig.value = null
    sessionConfig.value = null
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
    resetSubModelStateRefs({
      providerSubModelOptions,
        providerSubModelDefaultValue,
        lastLoadedSubModelProvider
      })
  }

  function resetEffortState() {
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
    loadModelConfigContext,
    loadProviderSubModels,
    loadSessionEffortCapabilities,
    handleQuickModelChange,
    handleQuickSubModelChange,
    handleQuickEffortChange,
    resetModelState,
    resetSubModelState,
    resetEffortState
  }
}
