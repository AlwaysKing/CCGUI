import { ref, toRaw } from 'vue'
import { barkProvider } from '@/utils/notifier'
import { buildChatMessageThemeFromPreset } from '@/utils/chatMessageTheme'

function generateEntityId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9)
}

function toDeepPlain(value) {
  return JSON.parse(JSON.stringify(value))
}

function normalizeCodexAccounts(accounts = []) {
  let changed = false
  const normalized = (Array.isArray(accounts) ? accounts : []).map(account => {
    const email = account?.email || account?.usage?.email || ''
    const name = account?.name || email || ''
    if (email !== (account?.email || '') || name !== (account?.name || '')) {
      changed = true
    }
    return {
      ...account,
      email,
      name
    }
  })

  return { accounts: normalized, changed }
}

function normalizeModelEntry(model = {}) {
  const rawCredentials = Array.isArray(model.credentials) ? model.credentials : []
  const credentials = rawCredentials.length > 0
    ? rawCredentials
        .map((credential, index) => ({
          id: credential?.id || `credential-${index + 1}`,
          name: credential?.name || `令牌 ${index + 1}`,
          token: credential?.token || credential?.authToken || ''
        }))
        .filter(credential => credential.token)
    : (
        typeof model.authToken === 'string' && model.authToken.trim()
          ? [{
              id: model.defaultCredentialId || 'default',
              name: '默认',
              token: model.authToken
            }]
          : []
      )

  const defaultCredentialId = model.defaultCredentialId || credentials[0]?.id || null
  const defaultCredential = credentials.find(credential => credential.id === defaultCredentialId) || credentials[0] || null

  return {
    ...model,
    credentials,
    defaultCredentialId: defaultCredential?.id || null,
    authToken: defaultCredential?.token || ''
  }
}

function getDefaultCredential(model = null, preferredCredentialId = null) {
  const credentials = Array.isArray(model?.credentials) ? model.credentials : []
  if (!credentials.length) {
    return null
  }

  if (preferredCredentialId) {
    const preferred = credentials.find(credential => credential.id === preferredCredentialId)
    if (preferred) {
      return preferred
    }
  }

  return credentials.find(credential => credential.id === model?.defaultCredentialId) || credentials[0] || null
}

export function useSettingsData(emit) {
  const settings = ref({
    theme: 'dark',
    language: 'zh-CN',
    floatingMonitorMode: 'auto',
    terminalTheme: 'ccgui-dark',
    terminalFontFamily: 'Menlo, Monaco, "Courier New", monospace',
    customTerminalThemeText: '',
    notificationSound: 'Glass',
    alertSound: 'Glass',
    collapseOnSend: true,
    barkUrl: '',
    chatMessageThemePreset: 'classic',
    chatMessageTheme: buildChatMessageThemeFromPreset('classic')
  })

  const defaultConfig = ref({
    apiUrl: '',
    authToken: '',
    model: 'claude-sonnet-4-6',
    anthropicModel: '',
    effort: 'default',
    maxThinkingTokens: 10240,
    thinkingEnabled: true,
    anthropicDefaultSonnetModel: '',
    anthropicDefaultOpusModel: '',
    anthropicDefaultHaikuModel: '',
    anthropicSmallFastModel: ''
  })

  const codexConfig = ref({
    authMode: 'provider',
    modelProvider: '',
    apiUrl: '',
    authToken: '',
    model: '',
    modelReasoningEffort: 'medium',
    proxyUrl: '',
    accounts: [],
    selectedAccountId: null
  })

  const claudeModels = ref([])
  const codexModels = ref([])
  const selectedClaudeModelId = ref(null)
  const selectedCodexModelId = ref(null)
  const selectedClaudeCredentialId = ref(null)
  const selectedCodexCredentialId = ref(null)
  const prompts = ref([])
  const documents = ref([])

  const showModelDialog = ref(false)
  const editingModel = ref(null)
  const editingModelType = ref('claude') // 'claude' 或 'codex'
  const showDefaultConfigDialog = ref(false)
  const showCodexConfigDialog = ref(false)
  const showCodexAccountDialog = ref(false)
  const editingCodexAccount = ref(null)
  const showPromptDialog = ref(false)
  const editingPrompt = ref(null)
  const showDocumentDialog = ref(false)
  const editingDocument = ref(null)
  const showMappingDialog = ref(false)
  const pendingModel = ref(null)
  const testingBark = ref(false)
  const savingBark = ref(false)

  const effortOptions = [
    { value: 'default', label: '默认' },
    { value: 'low', label: '低' },
    { value: 'medium', label: '中' },
    { value: 'high', label: '高' }
  ]

  const CLAUDE_ALIAS_MAPPING_KEYS = [
    ['ANTHROPIC_DEFAULT_SONNET_MODEL', 'anthropicDefaultSonnetModel'],
    ['ANTHROPIC_DEFAULT_OPUS_MODEL', 'anthropicDefaultOpusModel'],
    ['ANTHROPIC_DEFAULT_HAIKU_MODEL', 'anthropicDefaultHaikuModel'],
    ['ANTHROPIC_SMALL_FAST_MODEL', 'anthropicSmallFastModel']
  ]

  function findModelById(models, modelId) {
    return (Array.isArray(models) ? models : []).find(model => model.id === modelId) || null
  }

  function resolveModelCard(model, cardId) {
    const cards = Array.isArray(model?.modelCards) ? model.modelCards : []
    if (cards.length === 0) {
      return null
    }

    const targetCardId = cardId || model?.defaultCardId || cards[0].id
    return cards.find(card => card.id === targetCardId) || cards[0]
  }

  function findCardIdByName(model, modelName) {
    if (!modelName) return null
    const cards = Array.isArray(model?.modelCards) ? model.modelCards : []
    return cards.find(card => card.modelName === modelName)?.id || null
  }

  // Claude 默认配置完全来自 CCGUI 内部配置，不再读取 ~/.claude/settings.json
  function applyClaudeDefaultConfig() {
    const model = findModelById(claudeModels.value, selectedClaudeModelId.value)
    if (!model) {
      defaultConfig.value = {
        ...defaultConfig.value,
        apiUrl: '',
        authToken: '',
        model: '',
        anthropicModel: '',
        anthropicDefaultSonnetModel: '',
        anthropicDefaultOpusModel: '',
        anthropicDefaultHaikuModel: '',
        anthropicSmallFastModel: ''
      }
      return
    }

    const card = resolveModelCard(model, model.defaultCardId)
    const credential = getDefaultCredential(model, selectedClaudeCredentialId.value)
    const cardMapping = model.cardMapping && typeof model.cardMapping === 'object' ? model.cardMapping : {}

    const mappedNames = {}
    for (const [envKey, formKey] of CLAUDE_ALIAS_MAPPING_KEYS) {
      const mappedCard = resolveModelCard(model, cardMapping[envKey])
      mappedNames[formKey] = cardMapping[envKey] && mappedCard ? mappedCard.modelName : ''
    }

    defaultConfig.value = {
      ...defaultConfig.value,
      apiUrl: model.apiUrl || '',
      authToken: credential?.token || '',
      model: card?.modelName || '',
      anthropicModel: card?.modelName || '',
      ...mappedNames
    }
  }

  // Codex 默认配置完全来自 CCGUI 内部配置，不再读取 ~/.codex 配置
  function applyCodexDefaultConfig() {
    const model = findModelById(codexModels.value, selectedCodexModelId.value)
    const card = model ? resolveModelCard(model, model.defaultCardId) : null
    const credential = model ? getDefaultCredential(model, selectedCodexCredentialId.value) : null

    codexConfig.value = {
      ...codexConfig.value,
      authMode: 'provider',
      modelProvider: model?.id || '',
      apiUrl: model?.apiUrl || '',
      authToken: credential?.token || '',
      model: card?.modelName || '',
      modelReasoningEffort: settings.value.codexReasoningEffort || 'medium',
      proxyUrl: settings.value.codexProxy || ''
    }
  }

  async function loadSettings() {
    try {
      const result = await window.electronAPI.getAppConfig()
      if (result?.success) {
        const config = result.config
        if (config.settings) {
          settings.value = { ...settings.value, ...config.settings }
          if (!['off', 'auto', 'always'].includes(settings.value.floatingMonitorMode)) {
            settings.value.floatingMonitorMode = 'auto'
          }
          claudeModels.value = (config.settings.claudeModels || []).map(normalizeModelEntry)
          codexModels.value = (config.settings.codexModels || []).map(normalizeModelEntry)
          prompts.value = config.settings.prompts || []
          selectedClaudeModelId.value = config.settings.selectedClaudeModelId || null
          selectedCodexModelId.value = config.settings.selectedCodexModelId || null
          selectedClaudeCredentialId.value = config.settings.selectedClaudeCredentialId || null
          selectedCodexCredentialId.value = config.settings.selectedCodexCredentialId || null
          const normalizedCodexAccounts = normalizeCodexAccounts(config.settings.codexAccounts || [])
          codexConfig.value.accounts = normalizedCodexAccounts.accounts
          codexConfig.value.selectedAccountId = config.settings.selectedCodexAccountId || null
          if (normalizedCodexAccounts.changed) {
            await saveAppConfig()
          }

          if (!selectedClaudeCredentialId.value && selectedClaudeModelId.value) {
            selectedClaudeCredentialId.value = getDefaultCredential(
              claudeModels.value.find(model => model.id === selectedClaudeModelId.value)
            )?.id || null
          }
          if (!selectedCodexCredentialId.value && selectedCodexModelId.value) {
            selectedCodexCredentialId.value = getDefaultCredential(
              codexModels.value.find(model => model.id === selectedCodexModelId.value)
            )?.id || null
          }
        }
        if (config.documents) {
          documents.value = config.documents
        }

        // 从 CCGUI 内部配置读取 maxThinkingTokens（非 Claude 设置）
        if (config.settings?.maxThinkingTokens !== undefined) {
          defaultConfig.value.maxThinkingTokens = config.settings.maxThinkingTokens
        }

        // 读取 thinkingEnabled
        if (config.settings?.thinkingEnabled !== undefined) {
          defaultConfig.value.thinkingEnabled = config.settings.thinkingEnabled
        }
      }

      defaultConfig.value.effort = settings.value.claudeEffort || 'default'
      applyClaudeDefaultConfig()
      applyCodexDefaultConfig()
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }

  async function saveAppConfig() {
    try {
      const updates = {
        settings: {
          ...toDeepPlain(settings.value),
          maxThinkingTokens: defaultConfig.value.maxThinkingTokens,
          thinkingEnabled: defaultConfig.value.thinkingEnabled,
          claudeEffort: defaultConfig.value.effort || 'default',
          codexReasoningEffort: codexConfig.value.modelReasoningEffort || 'medium',
          claudeModels: toDeepPlain(claudeModels.value),
          codexModels: toDeepPlain(codexModels.value),
          prompts: toDeepPlain(prompts.value),
          selectedClaudeModelId: selectedClaudeModelId.value,
          selectedCodexModelId: selectedCodexModelId.value,
          selectedClaudeCredentialId: selectedClaudeCredentialId.value,
          selectedCodexCredentialId: selectedCodexCredentialId.value,
          codexAccounts: toDeepPlain(codexConfig.value.accounts || []),
          selectedCodexAccountId: codexConfig.value.selectedAccountId || null
        },
        documents: toDeepPlain(documents.value)
      }

      const result = await window.electronAPI.updateAppConfig({ updates })
      if (result?.success) {
        window.dispatchEvent(new CustomEvent('ccgui-app-config-updated', {
          detail: {
            settings: updates.settings
          }
        }))
        emit('saved')
        return true
      }

      alert('保存配置失败: ' + (result?.error || '未知错误'))
      return false
    } catch (error) {
      console.error('Failed to save settings:', error)
      alert('保存配置失败: ' + error.message)
      return false
    }
  }

  async function saveSoftwareSettings() {
    const success = await saveAppConfig()
    if (!success) {
      alert('保存软件配置失败')
    }
  }

  function handleAddClaudeModel() {
    editingModel.value = null
    editingModelType.value = 'claude'
    showModelDialog.value = true
  }

  function handleEditClaudeModel(model) {
    editingModel.value = model
    editingModelType.value = 'claude'
    showModelDialog.value = true
  }

  function handleAddCodexModel() {
    editingModel.value = null
    editingModelType.value = 'codex'
    showModelDialog.value = true
  }

  function handleEditCodexModel(model) {
    editingModel.value = model
    editingModelType.value = 'codex'
    showModelDialog.value = true
  }

  async function handleDeleteClaudeModel(modelId) {
    if (!confirm('确定要删除这个 Claude 模型吗？')) return

    claudeModels.value = claudeModels.value.filter(model => model.id !== modelId)
    if (selectedClaudeModelId.value === modelId) {
      selectedClaudeModelId.value = claudeModels.value[0]?.id || null
      selectedClaudeCredentialId.value = getDefaultCredential(claudeModels.value[0])?.id || null
    }
    await saveAppConfig()
  }

  async function handleDeleteCodexModel(modelId) {
    if (!confirm('确定要删除这个 Codex 模型吗？')) return

    codexModels.value = codexModels.value.filter(model => model.id !== modelId)
    if (selectedCodexModelId.value === modelId) {
      selectedCodexModelId.value = codexModels.value[0]?.id || null
      selectedCodexCredentialId.value = getDefaultCredential(codexModels.value[0])?.id || null
    }
    await saveAppConfig()
    applyCodexDefaultConfig()
  }

  async function handleSaveModel(formData) {
    const validModelCards = formData.modelCards.filter(card =>
      card.modelName || card.pricingCache || card.pricingInput || card.pricingOutput
    )

    const finalCards = validModelCards.length > 0 ? toRaw(validModelCards) : toRaw(formData.modelCards)
    const defaultCardId = finalCards.some(card => card.id === formData.defaultCardId)
      ? formData.defaultCardId
      : finalCards[0]?.id || null

    const modelData = {
      friendlyName: formData.friendlyName,
      apiUrl: formData.apiUrl,
      credentials: toDeepPlain(formData.credentials || []),
      defaultCredentialId: formData.defaultCredentialId || formData.credentials?.[0]?.id || null,
      authToken: formData.authToken || '',
      defaultCardId,
      modelCards: finalCards
    }

    const modelType = editingModelType.value
    const models = modelType === 'claude' ? claudeModels : codexModels
    const selectedId = modelType === 'claude' ? selectedClaudeModelId : selectedCodexModelId

    if (editingModel.value) {
      const index = models.value.findIndex(model => model.id === editingModel.value.id)
      if (index !== -1) {
        const nextModel = normalizeModelEntry({
          ...models.value[index],
          ...modelData
        })
        models.value[index] = nextModel
        if (modelType === 'claude' && selectedClaudeModelId.value === nextModel.id) {
          selectedClaudeCredentialId.value = getDefaultCredential(nextModel, selectedClaudeCredentialId.value)?.id || null
        }
        if (modelType === 'codex' && selectedCodexModelId.value === nextModel.id) {
          selectedCodexCredentialId.value = getDefaultCredential(nextModel, selectedCodexCredentialId.value)?.id || null
        }
      }
    } else {
      const newModel = normalizeModelEntry({
        id: formData.id || Date.now().toString(),
        ...modelData
      })
      models.value.push(newModel)
      if (models.value.length === 1) {
        if (modelType === 'claude') {
          selectedClaudeModelId.value = newModel.id
          selectedClaudeCredentialId.value = getDefaultCredential(newModel)?.id || null
        } else {
          selectedCodexModelId.value = newModel.id
          selectedCodexCredentialId.value = getDefaultCredential(newModel)?.id || null
        }
      }
    }

    showModelDialog.value = false
    await saveAppConfig()
    if (modelType === 'claude') {
      applyClaudeDefaultConfig()
    } else {
      applyCodexDefaultConfig()
    }
  }

  function handleSelectClaudeModel(modelId) {
    selectedClaudeModelId.value = modelId
    selectedClaudeCredentialId.value = getDefaultCredential(claudeModels.value.find(model => model.id === modelId))?.id || null
  }

  function handleSelectCodexModel(modelId) {
    selectedCodexModelId.value = modelId
    selectedCodexCredentialId.value = getDefaultCredential(codexModels.value.find(model => model.id === modelId))?.id || null
  }

  async function handleSetClaudeModelDefaultCard({ modelId, cardId }) {
    const model = claudeModels.value.find(item => item.id === modelId)
    if (!model) return

    model.defaultCardId = cardId
    await saveAppConfig()
  }

  async function handleSetClaudeModelDefaultCredential({ modelId, credentialId }) {
    const model = claudeModels.value.find(item => item.id === modelId)
    if (!model) return

    model.defaultCredentialId = credentialId
    const credential = getDefaultCredential(model, credentialId)
    model.authToken = credential?.token || ''
    if (selectedClaudeModelId.value === modelId) {
      selectedClaudeCredentialId.value = credentialId
    }
    await saveAppConfig()
  }

  async function handleSetCodexModelDefaultCard({ modelId, cardId }) {
    const model = codexModels.value.find(item => item.id === modelId)
    if (!model) return

    model.defaultCardId = cardId
    await saveAppConfig()
  }

  async function handleSetCodexModelDefaultCredential({ modelId, credentialId }) {
    const model = codexModels.value.find(item => item.id === modelId)
    if (!model) return

    model.defaultCredentialId = credentialId
    const credential = getDefaultCredential(model, credentialId)
    model.authToken = credential?.token || ''
    if (selectedCodexModelId.value === modelId) {
      selectedCodexCredentialId.value = credentialId
    }
    await saveAppConfig()
  }

  async function handleToggleClaudeModelActive({ modelId, active }) {
    const model = claudeModels.value.find(item => item.id === modelId)
    if (!model) return

    model.isActive = active
    await saveAppConfig()
  }

  async function handleToggleCodexModelActive({ modelId, active }) {
    const model = codexModels.value.find(item => item.id === modelId)
    if (!model) return

    model.isActive = active
    await saveAppConfig()
  }

  function handleApplyClaudeModel(payload) {
    const model = payload?.model || payload
    const credentialId = payload?.credentialId || null
    if (!model) return

    const cardCount = model.modelCards?.length || 0
    if (cardCount <= 1) {
      applyClaudeModelWithMappings(model, {
        ANTHROPIC_MODEL: cardCount === 1 ? model.modelCards[0].modelName : ''
      }, true, credentialId)
      return
    }

    pendingModel.value = { model, credentialId }
    showMappingDialog.value = true
  }

  async function handleApplyCodexModel(payload) {
    const model = payload?.model || payload
    const credentialId = payload?.credentialId || null
    if (!model) return

    const targetModel = findModelById(codexModels.value, model.id) || model
    selectedCodexModelId.value = targetModel.id
    selectedCodexCredentialId.value = getDefaultCredential(
      targetModel,
      credentialId || selectedCodexCredentialId.value
    )?.id || null

    await saveAppConfig()
    applyCodexDefaultConfig()
    alert('Codex 模型供应商配置已应用')
  }

  async function handleMappingConfirm(mappings) {
    if (!pendingModel.value) return

    try {
      await applyClaudeModelWithMappings(pendingModel.value.model, mappings, false, pendingModel.value.credentialId || null)
    } finally {
      showMappingDialog.value = false
      pendingModel.value = null
    }
  }

  async function applyClaudeModelWithMappings(model, mappings, clearMappings = false, credentialOverrideId = null) {
    const targetModel = findModelById(claudeModels.value, model.id) || model
    const mainCardId = findCardIdByName(targetModel, mappings.ANTHROPIC_MODEL)
      || targetModel.defaultCardId
      || targetModel.modelCards?.[0]?.id
      || null

    if (mainCardId) {
      targetModel.defaultCardId = mainCardId
    }

    if (clearMappings) {
      delete targetModel.cardMapping
    } else {
      const cardMapping = {}
      for (const [envKey] of CLAUDE_ALIAS_MAPPING_KEYS) {
        const cardId = findCardIdByName(targetModel, mappings[envKey])
        if (cardId) {
          cardMapping[envKey] = cardId
        }
      }
      targetModel.cardMapping = cardMapping
    }

    selectedClaudeModelId.value = targetModel.id
    selectedClaudeCredentialId.value = getDefaultCredential(
      targetModel,
      credentialOverrideId || selectedClaudeCredentialId.value
    )?.id || null

    await saveAppConfig()
    applyClaudeDefaultConfig()
    alert('Claude 模型供应商配置已应用')
  }

  function handleEditDefaultConfig() {
    showDefaultConfigDialog.value = true
  }

  async function handleSaveDefaultConfig(config) {
    const model = findModelById(claudeModels.value, selectedClaudeModelId.value)
    if (model) {
      if (config.apiUrl !== undefined) {
        model.apiUrl = config.apiUrl
      }
      if (config.authToken !== undefined) {
        const credential = getDefaultCredential(model, selectedClaudeCredentialId.value)
        if (credential) {
          credential.token = config.authToken
        }
        model.authToken = config.authToken
      }

      const mainCardId = findCardIdByName(model, config.anthropicModel || config.model)
      if (mainCardId) {
        model.defaultCardId = mainCardId
      }

      const cardMapping = { ...(model.cardMapping || {}) }
      for (const [envKey, formKey] of CLAUDE_ALIAS_MAPPING_KEYS) {
        const cardId = findCardIdByName(model, config[formKey])
        if (cardId) {
          cardMapping[envKey] = cardId
        } else {
          delete cardMapping[envKey]
        }
      }
      model.cardMapping = Object.keys(cardMapping).length > 0 ? cardMapping : undefined
    }

    defaultConfig.value = { ...defaultConfig.value, ...config }
    settings.value.claudeEffort = config.effort || 'default'
    showDefaultConfigDialog.value = false
    await saveAppConfig()
    applyClaudeDefaultConfig()
  }

  function handleEditCodexConfig() {
    showCodexConfigDialog.value = true
  }

  async function handleSaveCodexConfig(config) {
    const model = findModelById(codexModels.value, selectedCodexModelId.value)
    if (model) {
      if (config.apiUrl !== undefined) {
        model.apiUrl = config.apiUrl
      }
      if (config.authToken !== undefined) {
        const credential = getDefaultCredential(model, selectedCodexCredentialId.value)
        if (credential) {
          credential.token = config.authToken
        }
        model.authToken = config.authToken
      }

      const cardId = findCardIdByName(model, config.model)
      if (cardId) {
        model.defaultCardId = cardId
      }
    }

    codexConfig.value = { ...codexConfig.value, ...config, authMode: 'provider' }
    settings.value.codexProxy = config.proxyUrl || ''
    showCodexConfigDialog.value = false
    await saveAppConfig()
    applyCodexDefaultConfig()
    emit('saved')
  }

  async function handleSaveCodexProxy(proxyUrl) {
    settings.value.codexProxy = proxyUrl || ''
    const success = await saveAppConfig()
    if (!success) {
      alert('保存 Codex 代理失败')
      return
    }
    applyCodexDefaultConfig()
    emit('saved')
  }

  async function handleAddCodexAccount() {
    editingCodexAccount.value = null
    showCodexAccountDialog.value = true
  }

  function handleEditCodexAccount(account) {
    editingCodexAccount.value = account ? { ...account } : null
    showCodexAccountDialog.value = true
  }

  async function handleSaveCodexAccount(accountData) {
    const accounts = Array.isArray(codexConfig.value.accounts) ? [...codexConfig.value.accounts] : []
    const nextAccount = {
      id: accountData.id || generateEntityId(),
      name: accountData.name || '',
      email: accountData.email || accountData.usage?.email || '',
      accountId: accountData.accountId || '',
      idToken: accountData.idToken || '',
      accessToken: accountData.accessToken || '',
      refreshToken: accountData.refreshToken || '',
      lastRefresh: accountData.lastRefresh || '',
      usage: accountData.usage || null
    }
    const index = accounts.findIndex(account => account.id === nextAccount.id)
    if (index === -1) {
      accounts.push(nextAccount)
    } else {
      accounts[index] = nextAccount
    }
    codexConfig.value.accounts = accounts
    showCodexAccountDialog.value = false
    editingCodexAccount.value = null
    await saveAppConfig()
  }

  async function handleDeleteCodexAccount(accountId) {
    const accounts = Array.isArray(codexConfig.value.accounts) ? [...codexConfig.value.accounts] : []
    codexConfig.value.accounts = accounts.filter(account => account.id !== accountId)
    if (codexConfig.value.selectedAccountId === accountId) {
      codexConfig.value.selectedAccountId = null
    }
    await saveAppConfig()
  }

  async function handleApplyCodexAccount(account) {
    if (!account) return
    const result = await window.electronAPI.applyCodexAccount({ account: toDeepPlain(account) })
    if (!result?.success) {
      alert('应用账号失败: ' + (result?.error || '未知错误'))
      return
    }

    await loadSettings()
  }

  async function handleRefreshCodexAccountUsage(account) {
    if (!account?.id) return

    const accounts = Array.isArray(codexConfig.value.accounts) ? [...codexConfig.value.accounts] : []
    const index = accounts.findIndex(item => item.id === account.id)
    if (index === -1) return

    const targetAccount = { ...accounts[index] }

    try {
      const result = await window.electronAPI.getCodexUsageStatus({ account: toDeepPlain(targetAccount) })
      if (!result?.success || !result?.usage) {
        const usageError = {
          code: result?.usage ? null : 'empty_usage',
          message: result?.error || (result?.usage ? 'Codex usage refresh failed' : 'Codex usage refresh returned empty data'),
          status: null
        }

        accounts[index] = {
          ...targetAccount,
          usageError
        }
      } else {
        accounts[index] = {
          ...targetAccount,
          email: result.usage.email || targetAccount.email || '',
          usage: result.usage,
          usageError: null
        }
      }
    } catch (error) {
      accounts[index] = {
        ...targetAccount,
        usageError: {
          code: error?.code || null,
          message: error?.message || 'Codex usage refresh failed',
          status: Number(error?.statusCode || 0) || null
        }
      }
    }

    codexConfig.value.accounts = accounts
    await saveAppConfig()
  }

  function handleAddPrompt() {
    editingPrompt.value = null
    showPromptDialog.value = true
  }

  function handleEditPrompt(prompt) {
    editingPrompt.value = prompt
    showPromptDialog.value = true
  }

  async function handleDeletePrompt(promptId) {
    if (!confirm('确定要删除这个提示词吗？')) return

    prompts.value = prompts.value.filter(prompt => prompt.id !== promptId)
    await saveAppConfig()
  }

  async function handleTogglePromptActive(promptId) {
    const prompt = prompts.value.find(item => item.id === promptId)
    if (!prompt) return

    prompt.isBase = !prompt.isBase
    await saveAppConfig()
  }

  async function handleSavePrompt(formData) {
    if (editingPrompt.value) {
      const index = prompts.value.findIndex(prompt => prompt.id === editingPrompt.value.id)
      if (index !== -1) {
        prompts.value[index] = {
          ...prompts.value[index],
          name: formData.name,
          description: formData.description,
          content: formData.content,
          isBase: formData.isBase
        }
      }
    } else {
      prompts.value.push({
        id: formData.id || generateEntityId(),
        name: formData.name,
        description: formData.description,
        content: formData.content,
        isBase: formData.isBase
      })
    }

    showPromptDialog.value = false
    await saveAppConfig()
  }

  function handleAddDocument() {
    editingDocument.value = null
    showDocumentDialog.value = true
  }

  async function handleEditDocument(document) {
    const docId = document.id || document.name.replace(/[\/\\?%*:|"<>]/g, '_')

    try {
      const result = await window.electronAPI.getDoc({ docId })
      editingDocument.value = {
        ...document,
        id: docId,
        content: result?.doc?.content || ''
      }
    } catch (error) {
      console.error('Failed to load document content:', error)
      editingDocument.value = {
        ...document,
        id: docId,
        content: document.content || ''
      }
    }

    showDocumentDialog.value = true
  }

  async function handleDeleteDocument(documentId) {
    if (!confirm('确定要删除这个规范文档吗？')) return

    documents.value = documents.value.filter(document => document.id !== documentId)
    await saveAppConfig()
  }

  async function handleToggleDocumentActive(documentId) {
    const document = documents.value.find(item => item.id === documentId)
    if (!document) return

    document.isBase = document.isBase === false
    await saveAppConfig()
  }

  async function handleSaveDocument(formData) {
    const sanitizedName = formData.name.replace(/[\/\\?%*:|"<>]/g, '_')
    const oldName = editingDocument.value?.name?.replace(/[\/\\?%*:|"<>]/g, '_')

    try {
      await window.electronAPI.saveDoc({
        docId: sanitizedName,
        content: formData.content
      })
    } catch (error) {
      console.error('Failed to save doc file:', error)
      alert('保存文档文件失败: ' + error.message)
      return
    }

    if (editingDocument.value && oldName && oldName !== sanitizedName) {
      try {
        await window.electronAPI.deleteDoc({ docId: oldName })
      } catch (error) {
        console.warn('Failed to delete old doc file:', error)
      }
    }

    if (editingDocument.value) {
      const index = documents.value.findIndex(document =>
        document.id === editingDocument.value.id || document.name === editingDocument.value.name
      )
      if (index !== -1) {
        documents.value[index] = {
          id: sanitizedName,
          name: formData.name,
          summary: formData.summary
        }
      }
    } else {
      documents.value.push({
        id: sanitizedName,
        name: formData.name,
        summary: formData.summary
      })
    }

    showDocumentDialog.value = false
    await saveAppConfig()
  }

  async function testBarkUrl() {
    if (!settings.value.barkUrl) {
      alert('请先输入 Bark 通知链接')
      return
    }

    testingBark.value = true
    try {
      const result = await barkProvider.test(settings.value.barkUrl)
      if (result?.success) {
        alert('测试成功！请检查您的设备是否收到通知')
      } else {
        alert('测试失败: ' + result.message)
      }
    } catch (error) {
      alert('测试失败: ' + error.message)
    } finally {
      testingBark.value = false
    }
  }

  async function saveBarkUrl() {
    savingBark.value = true
    try {
      const success = await saveAppConfig()
      if (success) {
        alert('Bark 通知链接已保存')
      }
    } finally {
      savingBark.value = false
    }
  }

  return {
    settings,
    defaultConfig,
    codexConfig,
    claudeModels,
    codexModels,
    selectedClaudeModelId,
    selectedCodexModelId,
    selectedClaudeCredentialId,
    selectedCodexCredentialId,
    prompts,
    documents,
    showModelDialog,
    editingModel,
    editingModelType,
    showDefaultConfigDialog,
    showCodexConfigDialog,
    showPromptDialog,
    editingPrompt,
    showDocumentDialog,
    editingDocument,
    showMappingDialog,
    pendingModel,
    effortOptions,
    loadSettings,
    saveSoftwareSettings,
    handleAddClaudeModel,
    handleEditClaudeModel,
    handleDeleteClaudeModel,
    handleAddCodexModel,
    handleEditCodexModel,
    handleDeleteCodexModel,
    handleSaveModel,
    handleSelectClaudeModel,
    handleSelectCodexModel,
    handleSetClaudeModelDefaultCard,
    handleSetClaudeModelDefaultCredential,
    handleSetCodexModelDefaultCard,
    handleSetCodexModelDefaultCredential,
    handleToggleClaudeModelActive,
    handleToggleCodexModelActive,
    handleApplyClaudeModel,
    handleApplyCodexModel,
    handleMappingConfirm,
    handleEditDefaultConfig,
    handleSaveDefaultConfig,
    handleEditCodexConfig,
    handleSaveCodexConfig,
    handleSaveCodexProxy,
    showCodexAccountDialog,
    editingCodexAccount,
    handleAddCodexAccount,
    handleEditCodexAccount,
    handleSaveCodexAccount,
    handleDeleteCodexAccount,
    handleApplyCodexAccount,
    handleRefreshCodexAccountUsage,
    handleAddPrompt,
    handleEditPrompt,
    handleDeletePrompt,
    handleTogglePromptActive,
    handleSavePrompt,
    handleAddDocument,
    handleEditDocument,
    handleDeleteDocument,
    handleToggleDocumentActive,
    handleSaveDocument,
    testBarkUrl,
    saveBarkUrl
  }
}
