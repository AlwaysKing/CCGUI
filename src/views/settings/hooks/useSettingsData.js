import { ref, toRaw } from 'vue'
import { barkProvider } from '@/utils/notifier'

function generateEntityId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9)
}

function toDeepPlain(value) {
  return JSON.parse(JSON.stringify(value))
}

export function useSettingsData(emit) {
  const settings = ref({
    theme: 'dark',
    language: 'zh-CN',
    notificationSound: 'Glass',
    barkUrl: ''
  })

  const defaultConfig = ref({
    apiUrl: '',
    authToken: '',
    model: 'claude-sonnet-4-6',
    anthropicModel: '',
    effort: 'default',
    anthropicDefaultSonnetModel: '',
    anthropicDefaultOpusModel: '',
    anthropicDefaultHaikuModel: '',
    anthropicSmallFastModel: ''
  })

  const models = ref([])
  const selectedModelId = ref(null)
  const prompts = ref([])
  const documents = ref([])

  const showModelDialog = ref(false)
  const editingModel = ref(null)
  const showDefaultConfigDialog = ref(false)
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

  async function loadSettings() {
    try {
      const result = await window.electronAPI.getAppConfig()
      if (result?.success) {
        const config = result.config
        if (config.settings) {
          settings.value = { ...settings.value, ...config.settings }
          models.value = config.settings.models || []
          prompts.value = config.settings.prompts || []
          selectedModelId.value = config.settings.selectedModelId || null
        }
        if (config.documents) {
          documents.value = config.documents
        }
      }

      const claudeResult = await window.electronAPI.getClaudeSettings()
      if (claudeResult?.success && claudeResult.settings) {
        const claudeSettings = claudeResult.settings
        const env = claudeSettings.env || {}

        defaultConfig.value.apiUrl = env.ANTHROPIC_BASE_URL || ''
        defaultConfig.value.authToken = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || ''
        defaultConfig.value.model = claudeSettings.model || ''
        defaultConfig.value.effort = claudeSettings.effort || 'default'
        defaultConfig.value.anthropicModel = env.ANTHROPIC_MODEL || ''
        defaultConfig.value.anthropicDefaultSonnetModel = env.ANTHROPIC_DEFAULT_SONNET_MODEL || ''
        defaultConfig.value.anthropicDefaultOpusModel = env.ANTHROPIC_DEFAULT_OPUS_MODEL || ''
        defaultConfig.value.anthropicDefaultHaikuModel = env.ANTHROPIC_DEFAULT_HAIKU_MODEL || ''
        defaultConfig.value.anthropicSmallFastModel = env.ANTHROPIC_SMALL_FAST_MODEL || ''
      }
    } catch (error) {
      console.error('Failed to load settings:', error)
    }
  }

  async function saveAppConfig() {
    try {
      const updates = {
        settings: {
          ...toDeepPlain(settings.value),
          models: toDeepPlain(models.value),
          prompts: toDeepPlain(prompts.value),
          selectedModelId: selectedModelId.value
        },
        documents: toDeepPlain(documents.value)
      }

      const result = await window.electronAPI.updateAppConfig({ updates })
      if (result?.success) {
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

  function handleAddModel() {
    editingModel.value = null
    showModelDialog.value = true
  }

  function handleEditModel(model) {
    editingModel.value = model
    showModelDialog.value = true
  }

  async function handleDeleteModel(modelId) {
    if (!confirm('确定要删除这个模型吗？')) return

    models.value = models.value.filter(model => model.id !== modelId)
    if (selectedModelId.value === modelId) {
      selectedModelId.value = models.value[0]?.id || null
    }
    await saveAppConfig()
  }

  async function handleSaveModel(formData) {
    const validModelCards = formData.modelCards.filter(card =>
      card.modelName || card.pricingCache || card.pricingInput || card.pricingOutput
    )

    const finalCards = validModelCards.length > 0 ? toRaw(validModelCards) : toRaw(formData.modelCards)
    const defaultCardId = finalCards.some(card => card.id === formData.defaultCardId)
      ? formData.defaultCardId
      : finalCards[0]?.id || null

    if (editingModel.value) {
      const index = models.value.findIndex(model => model.id === editingModel.value.id)
      if (index !== -1) {
        models.value[index] = {
          ...models.value[index],
          friendlyName: formData.friendlyName,
          apiUrl: formData.apiUrl,
          authToken: formData.authToken,
          defaultCardId,
          modelCards: finalCards
        }
      }
    } else {
      const newModel = {
        id: formData.id || Date.now().toString(),
        friendlyName: formData.friendlyName,
        apiUrl: formData.apiUrl,
        authToken: formData.authToken,
        defaultCardId,
        modelCards: finalCards
      }
      models.value.push(newModel)
      if (models.value.length === 1) {
        selectedModelId.value = newModel.id
      }
    }

    showModelDialog.value = false
    await saveAppConfig()
  }

  function handleSelectModel(modelId) {
    selectedModelId.value = modelId
  }

  async function handleSetModelDefaultCard({ modelId, cardId }) {
    const model = models.value.find(item => item.id === modelId)
    if (!model) return

    model.defaultCardId = cardId
    await saveAppConfig()
  }

  async function handleToggleModelActive({ modelId, active }) {
    const model = models.value.find(item => item.id === modelId)
    if (!model) return

    model.isActive = active
    await saveAppConfig()
  }

  function handleApplyModel(model) {
    if (!model) return

    const cardCount = model.modelCards?.length || 0
    if (cardCount <= 1) {
      const defaultModelName = cardCount === 1 ? model.modelCards[0].modelName : ''
      applyModelWithMappings(model, {
        ANTHROPIC_MODEL: defaultModelName,
        model: defaultModelName
      }, true)
      return
    }

    pendingModel.value = model
    showMappingDialog.value = true
  }

  async function handleMappingConfirm(mappings) {
    if (!pendingModel.value) return

    try {
      await applyModelWithMappings(pendingModel.value, mappings)
    } finally {
      showMappingDialog.value = false
      pendingModel.value = null
    }
  }

  async function applyModelWithMappings(model, mappings, clearMappings = false) {
    try {
      const env = {
        ANTHROPIC_BASE_URL: model.apiUrl || '',
        ANTHROPIC_AUTH_TOKEN: model.authToken || ''
      }

      if (mappings.ANTHROPIC_MODEL) env.ANTHROPIC_MODEL = mappings.ANTHROPIC_MODEL
      if (mappings.ANTHROPIC_DEFAULT_SONNET_MODEL) env.ANTHROPIC_DEFAULT_SONNET_MODEL = mappings.ANTHROPIC_DEFAULT_SONNET_MODEL
      if (mappings.ANTHROPIC_DEFAULT_OPUS_MODEL) env.ANTHROPIC_DEFAULT_OPUS_MODEL = mappings.ANTHROPIC_DEFAULT_OPUS_MODEL
      if (mappings.ANTHROPIC_DEFAULT_HAIKU_MODEL) env.ANTHROPIC_DEFAULT_HAIKU_MODEL = mappings.ANTHROPIC_DEFAULT_HAIKU_MODEL
      if (mappings.ANTHROPIC_SMALL_FAST_MODEL) env.ANTHROPIC_SMALL_FAST_MODEL = mappings.ANTHROPIC_SMALL_FAST_MODEL

      const updates = { env }
      if (mappings.model) {
        updates.model = mappings.model
      }

      const result = await window.electronAPI.updateClaudeSettings({ updates, clearMappings })

      if (!result?.success) {
        alert('应用模型配置失败: ' + (result?.error || '未知错误'))
        return
      }

      defaultConfig.value.apiUrl = model.apiUrl || ''
      defaultConfig.value.authToken = model.authToken || ''
      defaultConfig.value.anthropicModel = mappings.ANTHROPIC_MODEL || ''
      defaultConfig.value.anthropicDefaultSonnetModel = mappings.ANTHROPIC_DEFAULT_SONNET_MODEL || ''
      defaultConfig.value.anthropicDefaultOpusModel = mappings.ANTHROPIC_DEFAULT_OPUS_MODEL || ''
      defaultConfig.value.anthropicDefaultHaikuModel = mappings.ANTHROPIC_DEFAULT_HAIKU_MODEL || ''
      defaultConfig.value.anthropicSmallFastModel = mappings.ANTHROPIC_SMALL_FAST_MODEL || ''
      if (mappings.model) {
        defaultConfig.value.model = mappings.model
      }

      await saveAppConfig()
      alert('模型配置已应用')
    } catch (error) {
      console.error('应用模型失败:', error)
      alert('应用模型配置失败: ' + error.message)
    }
  }

  function handleEditDefaultConfig() {
    showDefaultConfigDialog.value = true
  }

  async function handleSaveDefaultConfig(config) {
    defaultConfig.value = { ...defaultConfig.value, ...config }
    showDefaultConfigDialog.value = false
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
    models,
    selectedModelId,
    prompts,
    documents,
    showModelDialog,
    editingModel,
    showDefaultConfigDialog,
    showPromptDialog,
    editingPrompt,
    showDocumentDialog,
    editingDocument,
    showMappingDialog,
    pendingModel,
    effortOptions,
    loadSettings,
    saveSoftwareSettings,
    handleAddModel,
    handleEditModel,
    handleDeleteModel,
    handleSaveModel,
    handleSelectModel,
    handleSetModelDefaultCard,
    handleToggleModelActive,
    handleApplyModel,
    handleMappingConfirm,
    handleEditDefaultConfig,
    handleSaveDefaultConfig,
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
