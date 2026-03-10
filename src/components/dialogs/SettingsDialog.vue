<script setup>
import { ref, onMounted, onUnmounted, toRaw, computed } from 'vue'
import { barkProvider } from '../../utils/notifier'

const emit = defineEmits(['close'])

// 当前激活的导航项
const activeSection = ref('model')

// 配置选项
const settings = ref({
  // 软件配置
  theme: 'dark',
  language: 'zh-CN',
  barkUrl: ''
})

// 模型列表
const models = ref([])

// 默认配置（从 ~/.claude/settings.json 读取）
const defaultConfig = ref({
  apiUrl: '',
  authToken: '',
  model: 'claude-sonnet-4-6',
  effort: 'default'
})

// 当前选中的模型
const selectedModelId = ref(null)

// 编辑模型对话框
const showModelDialog = ref(false)
const editingModel = ref(null)
const modelForm = ref({
  friendlyName: '',
  apiUrl: '',
  authToken: '',
  defaultCardId: null, // 默认模型卡片ID
  modelCards: [
    {
      id: Date.now().toString(),
      modelName: '',
      pricingCache: '',
      pricingInput: '',
      pricingOutput: ''
    }
  ]
})

// 模型卡片 hover 状态 (编辑对话框)
const hoveredCardId = ref(null)

// 模型列表中卡片 hover 状态
const hoveredListModelCard = ref(null)

// 模型列表中模型卡片的 hover 状态
const hoveredModelId = ref(null)

// Bark 测试和保存状态
const testingBark = ref(false)
const savingBark = ref(false)

// 提示词列表
const prompts = ref([])

// 编辑提示词对话框
const showPromptDialog = ref(false)
const editingPrompt = ref(null)
const promptForm = ref({
  name: '',
  description: '',
  content: '',
  isActive: false
})

// 规范文档列表
const documents = ref([])

// 编辑规范文档对话框
const showDocumentDialog = ref(false)
const editingDocument = ref(null)
const documentForm = ref({
  name: '',
  description: '',
  content: '',
  isActive: false
})

// 提示词 hover 状态
const hoveredPromptId = ref(null)

// 规范文档 hover 状态
const hoveredDocumentId = ref(null)

// 生成模型卡片ID
function generateModelCardId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9)
}

// 生成提示词ID
function generatePromptId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9)
}

// 添加新提示词
function handleAddPrompt() {
  editingPrompt.value = null
  promptForm.value = {
    name: '',
    description: '',
    content: '',
    isActive: false
  }
  showPromptDialog.value = true
}

// 编辑提示词
function handleEditPrompt(prompt) {
  editingPrompt.value = prompt
  promptForm.value = {
    name: prompt.name,
    description: prompt.description || '',
    content: prompt.content,
    isActive: prompt.isActive
  }
  showPromptDialog.value = true
}

// 删除提示词
async function handleDeletePrompt(promptId) {
  if (!confirm('确定要删除这个提示词吗？')) {
    return
  }
  console.log('[Prompt] Deleting prompt:', promptId)
  console.log('[Prompt] Before delete:', JSON.stringify(prompts.value))
  const index = prompts.value.findIndex(p => p.id === promptId)
  if (index !== -1) {
    prompts.value.splice(index, 1)
  }
  console.log('[Prompt] After delete:', JSON.stringify(prompts.value))
  const success = await saveAppConfig()
  console.log('[Prompt] Save result:', success)
  if (success) {
    console.log('[Prompt] Delete successful')
  } else {
    alert('删除失败，请重试')
  }
}

// 切换提示词激活状态
async function handleTogglePromptActive(promptId) {
  const prompt = prompts.value.find(p => p.id === promptId)
  if (prompt) {
    prompt.isActive = !prompt.isActive
    console.log('[Prompt] Toggled active state:', promptId, prompt.isActive)
    await saveAppConfig()
  }
}

// 关闭提示词对话框
function handleClosePromptDialog() {
  showPromptDialog.value = false
  editingPrompt.value = null
}

// 保存提示词
function handleSavePrompt() {
  if (!promptForm.value.name || !promptForm.value.content) {
    alert('请填写提示词名称和内容')
    return
  }

  if (editingPrompt.value) {
    // 更新现有提示词
    const prompt = prompts.value.find(p => p.id === editingPrompt.value.id)
    if (prompt) {
      prompt.name = promptForm.value.name
      prompt.description = promptForm.value.description
      prompt.content = promptForm.value.content
      prompt.isActive = promptForm.value.isActive
    }
  } else {
    // 添加新提示词
    prompts.value.push({
      id: generatePromptId(),
      name: promptForm.value.name,
      description: promptForm.value.description,
      content: promptForm.value.content,
      isActive: promptForm.value.isActive
    })
  }

  saveAppConfig()
  handleClosePromptDialog()
}

// 添加规范文档
function handleAddDocument() {
  editingDocument.value = null
  documentForm.value = {
    name: '',
    content: ''
  }
  showDocumentDialog.value = true
}

// 编辑规范文档
async function handleEditDocument(document) {
  editingDocument.value = document
  // 从文件系统读取完整内容
  const result = await window.electronAPI.getDoc({ docId: document.id })
  if (result.success && result.doc) {
    documentForm.value = {
      name: result.doc.name,
      content: result.doc.content
    }
    showDocumentDialog.value = true
  } else {
    alert('读取文档失败')
  }
}

// 删除规范文档
async function handleDeleteDocument(documentId) {
  if (!confirm('确定要删除这个规范文档吗？')) {
    return
  }
  const result = await window.electronAPI.deleteDoc({ docId: documentId })
  if (result && result.success) {
    await loadDocs()
  } else {
    alert('删除失败：' + (result.error || '未知错误'))
  }
}

// 保存规范文档
async function handleSaveDocument() {
  if (!documentForm.value.name || !documentForm.value.content) {
    alert('请填写文档名称和内容')
    return
  }

  // 文件名不能包含特殊字符
  const docName = documentForm.value.name.trim()
  if (/[\/\\?%*:|"<>]/.test(docName)) {
    alert('文档名称不能包含特殊字符：/ \\ ? % * : | " < >')
    return
  }

  const result = await window.electronAPI.saveDoc({
    docId: docName,
    content: documentForm.value.content
  })

  if (result && result.success) {
    await loadDocs()
    handleCloseDocumentDialog()
  } else {
    alert('保存失败：' + (result.error || '未知错误'))
  }
}

// 关闭规范文档对话框
function handleCloseDocumentDialog() {
  showDocumentDialog.value = false
  editingDocument.value = null
}

// 加载规范文档列表
async function loadDocs() {
  try {
    const result = await window.electronAPI.listDocs()
    if (result.success && result.docs) {
      documents.value = result.docs
    }
  } catch (error) {
    console.error('[SettingsDialog] Failed to load docs:', error)
  }
}

// 添加模型卡片
function handleAddModelCard() {
  modelForm.value.modelCards.push({
    id: generateModelCardId(),
    modelName: '',
    pricingCache: '',
    pricingInput: '',
    pricingOutput: ''
  })
}

// 删除模型卡片
function handleRemoveModelCard(cardId) {
  if (modelForm.value.modelCards.length > 1) {
    modelForm.value.modelCards = modelForm.value.modelCards.filter(card => card.id !== cardId)
    // 如果删除的是默认卡片，清除默认状态
    if (modelForm.value.defaultCardId === cardId) {
      modelForm.value.defaultCardId = null
    }
  }
}

// 设置默认模型卡片
function handleSetDefaultCard(cardId) {
  modelForm.value.defaultCardId = cardId
}

// 默认配置编辑对话框
const showDefaultConfigDialog = ref(false)
const defaultConfigForm = ref({
  apiUrl: '',
  authToken: '',
  model: 'claude-sonnet-4-6',
  effort: 'default',
  // 模型映射
  anthropicModel: '',
  anthropicDefaultSonnetModel: '',
  anthropicDefaultOpusModel: '',
  anthropicDefaultHaikuModel: '',
  anthropicSmallFastModel: ''
})

// 密码可见性
const showAuthToken = ref(false)
const showModelAuthToken = ref(false)
const visibleModelTokens = ref(new Set()) // 存储显示令牌的模型ID
const showClaudeToken = ref(false) // Claude 默认配置的令牌显示

// 切换模型令牌显示
function toggleModelTokenVisibility(modelId) {
  const newSet = new Set(visibleModelTokens.value)
  if (newSet.has(modelId)) {
    newSet.delete(modelId)
  } else {
    newSet.add(modelId)
  }
  visibleModelTokens.value = newSet
}

// 设置模型的默认卡片
async function handleSetModelDefaultCard(modelId, cardId) {
  const model = models.value.find(m => m.id === modelId)
  if (model) {
    model.defaultCardId = cardId
    // 保存配置
    await saveAppConfig()
  }
}

// Effort 选项
const effortOptions = [
  { value: 'default', label: '默认 - 使用系统设置' },
  { value: 'low', label: '低 - 快速响应' },
  { value: 'medium', label: '中等 - 平衡模式' },
  { value: 'high', label: '高 - 深度思考' }
]

// 检查是否有任何模型映射
const hasAnyModelMapping = computed(() => {
  return defaultConfig.value.anthropicModel ||
         defaultConfig.value.anthropicDefaultSonnetModel ||
         defaultConfig.value.anthropicDefaultOpusModel ||
         defaultConfig.value.anthropicDefaultHaikuModel ||
         defaultConfig.value.anthropicSmallFastModel
})

// 导航项配置
const navItems = [
  { id: 'model', label: '模型配置', icon: 'model' },
  { id: 'prompt', label: '提示词配置', icon: 'prompt' },
  { id: 'software', label: '软件配置', icon: 'software' }
]

// DOM refs
const contentRef = ref(null)
const modelSectionRef = ref(null)
const promptSectionRef = ref(null)
const softwareSectionRef = ref(null)

// 加载配置
async function loadSettings() {
  try {
    const result = await window.electronAPI.getAppConfig()
    if (result.success && result.config) {
      const configSettings = result.config.settings || {}

      // 加载基本设置
      settings.value = {
        theme: configSettings.theme || 'dark',
        language: configSettings.language || 'zh-CN',
        barkUrl: configSettings.barkUrl || ''
      }

      // 加载模型列表（用户自定义模型）
      models.value = configSettings.models || []

      // 加载选中的模型
      selectedModelId.value = configSettings.selectedModelId || null

      // 如果有模型但没有选中的模型，默认选中第一个
      if (models.value.length > 0 && !selectedModelId.value) {
        selectedModelId.value = models.value[0].id
      }

      // 加载提示词列表
      prompts.value = configSettings.prompts || []
      console.log('[SettingsDialog] Loaded prompts:', JSON.stringify(prompts.value))

      // 加载规范文档列表（从文件系统）
      await loadDocs()
    }

    // 加载默认配置（从 ~/.claude/settings.json）
    await loadDefaultConfig()
  } catch (error) {
    console.error('Failed to load settings:', error)
  }
}

// 加载默认配置
async function loadDefaultConfig() {
  try {
    const result = await window.electronAPI.getClaudeSettings()
    if (result.success && result.settings) {
      const env = result.settings.env || {}
      defaultConfig.value = {
        apiUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com',
        authToken: env.ANTHROPIC_AUTH_TOKEN || '',
        model: result.settings.model || '',  // 空值表示使用系统默认，不保存到文件
        effort: result.settings.effort || 'default',
        // 模型映射
        anthropicModel: env.ANTHROPIC_MODEL || '',
        anthropicDefaultSonnetModel: env.ANTHROPIC_DEFAULT_SONNET_MODEL || '',
        anthropicDefaultOpusModel: env.ANTHROPIC_DEFAULT_OPUS_MODEL || '',
        anthropicDefaultHaikuModel: env.ANTHROPIC_DEFAULT_HAIKU_MODEL || '',
        anthropicSmallFastModel: env.ANTHROPIC_SMALL_FAST_MODEL || ''
      }
      console.log('Loaded default config from Claude settings:', defaultConfig.value)
    }
  } catch (error) {
    console.error('Failed to load Claude settings:', error)
  }
}

// 编辑默认配置
function handleEditDefaultConfig() {
  defaultConfigForm.value = {
    apiUrl: defaultConfig.value.apiUrl,
    authToken: defaultConfig.value.authToken,
    // 只有当 model 有值时才复制到表单，否则使用空字符串（会被删除）
    model: defaultConfig.value.model || '',
    effort: defaultConfig.value.effort,
    // 模型映射
    anthropicModel: defaultConfig.value.anthropicModel || '',
    anthropicDefaultSonnetModel: defaultConfig.value.anthropicDefaultSonnetModel || '',
    anthropicDefaultOpusModel: defaultConfig.value.anthropicDefaultOpusModel || '',
    anthropicDefaultHaikuModel: defaultConfig.value.anthropicDefaultHaikuModel || '',
    anthropicSmallFastModel: defaultConfig.value.anthropicSmallFastModel || ''
  }
  showAuthToken.value = false
  showDefaultConfigDialog.value = true
}

// 保存默认配置
async function handleSaveDefaultConfig() {
  if (!defaultConfigForm.value.apiUrl) {
    alert('请填写 API 地址')
    return
  }

  if (!defaultConfigForm.value.authToken) {
    alert('请填写认证令牌')
    return
  }

  try {
    // 构建环境变量对象，空值则标记为删除
    const env = {
      ANTHROPIC_AUTH_TOKEN: toRaw(defaultConfigForm.value.authToken),
      ANTHROPIC_BASE_URL: toRaw(defaultConfigForm.value.apiUrl)
    }

    // 模型映射环境变量（空值则删除）
    if (defaultConfigForm.value.anthropicModel) {
      env.ANTHROPIC_MODEL = toRaw(defaultConfigForm.value.anthropicModel)
    } else {
      env.ANTHROPIC_MODEL = null // 标记为删除
    }

    if (defaultConfigForm.value.anthropicDefaultSonnetModel) {
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = toRaw(defaultConfigForm.value.anthropicDefaultSonnetModel)
    } else {
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = null
    }

    if (defaultConfigForm.value.anthropicDefaultOpusModel) {
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = toRaw(defaultConfigForm.value.anthropicDefaultOpusModel)
    } else {
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = null
    }

    if (defaultConfigForm.value.anthropicDefaultHaikuModel) {
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = toRaw(defaultConfigForm.value.anthropicDefaultHaikuModel)
    } else {
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = null
    }

    if (defaultConfigForm.value.anthropicSmallFastModel) {
      env.ANTHROPIC_SMALL_FAST_MODEL = toRaw(defaultConfigForm.value.anthropicSmallFastModel)
    } else {
      env.ANTHROPIC_SMALL_FAST_MODEL = null
    }

    // 构建 updates 对象
    const updates = {
      env
    }

    // model 字段：有值则设置，空值则标记删除
    if (defaultConfigForm.value.model) {
      updates.model = toRaw(defaultConfigForm.value.model)
    } else {
      updates.model = null // 标记为删除
    }

    // effort 字段：非 default 则设置，default 则标记删除
    if (defaultConfigForm.value.effort !== 'default') {
      updates.effort = toRaw(defaultConfigForm.value.effort)
    } else {
      updates.effort = null // 标记为删除
    }

    const result = await window.electronAPI.updateClaudeSettings({ updates })

    if (result && result.success) {
      // 更新本地状态
      defaultConfig.value = {
        apiUrl: defaultConfigForm.value.apiUrl,
        authToken: defaultConfigForm.value.authToken,
        model: defaultConfigForm.value.model,
        effort: defaultConfigForm.value.effort,
        // 模型映射
        anthropicModel: defaultConfigForm.value.anthropicModel,
        anthropicDefaultSonnetModel: defaultConfigForm.value.anthropicDefaultSonnetModel,
        anthropicDefaultOpusModel: defaultConfigForm.value.anthropicDefaultOpusModel,
        anthropicDefaultHaikuModel: defaultConfigForm.value.anthropicDefaultHaikuModel,
        anthropicSmallFastModel: defaultConfigForm.value.anthropicSmallFastModel
      }
      showDefaultConfigDialog.value = false
      showAuthToken.value = false
      console.log('Default config saved successfully')
    } else {
      alert('保存默认配置失败: ' + result.error)
    }
  } catch (error) {
    console.error('Failed to save default config:', error)
    alert('保存默认配置失败: ' + error.message)
  }
}

// 关闭默认配置对话框
function handleCloseDefaultConfigDialog() {
  showDefaultConfigDialog.value = false
  showAuthToken.value = false
}

// 滚动到指定section
function scrollToSection(sectionId) {
  activeSection.value = sectionId
  const sectionMap = {
    model: modelSectionRef.value,
    prompt: promptSectionRef.value,
    software: softwareSectionRef.value
  }

  const targetSection = sectionMap[sectionId]
  if (targetSection && contentRef.value) {
    const container = contentRef.value
    const targetOffsetTop = targetSection.offsetTop - container.offsetTop

    container.scrollTo({
      top: targetOffsetTop,
      behavior: 'smooth'
    })
  }
}

// 监听滚动事件，更新激活状态
function handleScroll() {
  if (!contentRef.value) return

  const container = contentRef.value
  const scrollTop = container.scrollTop

  const sections = [
    { id: 'model', ref: modelSectionRef.value },
    { id: 'prompt', ref: promptSectionRef.value },
    { id: 'software', ref: softwareSectionRef.value }
  ]

  // 找到当前滚动位置对应的section
  for (const section of sections) {
    if (section.ref) {
      const offsetTop = section.ref.offsetTop - container.offsetTop
      const offsetBottom = offsetTop + section.ref.offsetHeight

      if (scrollTop >= offsetTop - 10 && scrollTop < offsetBottom - 10) {
        activeSection.value = section.id
        break
      }
    }
  }
}

// 添加新模型
function handleAddModel() {
  editingModel.value = null
  const firstCardId = generateModelCardId()
  modelForm.value = {
    friendlyName: '',
    apiUrl: '',
    authToken: '',
    defaultCardId: firstCardId, // 默认选中第一个
    modelCards: [
      {
        id: firstCardId,
        modelName: '',
        pricingCache: '',
        pricingInput: '',
        pricingOutput: ''
      }
    ]
  }
  showModelAuthToken.value = false
  showModelDialog.value = true
}

// 编辑模型
function handleEditModel(model) {
  editingModel.value = model

  // 兼容旧数据格式：将单个模型名称/计费转换为 modelCards 数组
  let modelCards = []
  if (model.modelCards && model.modelCards.length > 0) {
    modelCards = model.modelCards.map(card => ({
      id: card.id || generateModelCardId(),
      modelName: card.modelName || '',
      pricingCache: card.pricingCache || '',
      pricingInput: card.pricingInput || '',
      pricingOutput: card.pricingOutput || ''
    }))
  } else if (model.modelName) {
    // 旧格式转换
    modelCards = [{
      id: generateModelCardId(),
      modelName: model.modelName,
      pricingCache: model.pricingCache || '',
      pricingInput: model.pricingInput || '',
      pricingOutput: model.pricingOutput || ''
    }]
  } else {
    // 没有任何模型卡片，创建一个空的
    modelCards = [{
      id: generateModelCardId(),
      modelName: '',
      pricingCache: '',
      pricingInput: '',
      pricingOutput: ''
    }]
  }

  modelForm.value = {
    friendlyName: model.friendlyName,
    apiUrl: model.apiUrl,
    authToken: model.authToken || '',
    defaultCardId: model.defaultCardId || modelCards[0]?.id || null,
    modelCards
  }
  showModelAuthToken.value = false
  showModelDialog.value = true
}

// 删除模型
async function handleDeleteModel(modelId) {
  if (confirm('确定要删除这个模型吗？')) {
    models.value = models.value.filter(m => m.id !== modelId)
    // 如果删除的是当前选中的模型，选择第一个模型或清空选中
    if (selectedModelId.value === modelId) {
      selectedModelId.value = models.value[0]?.id || null
    }
    // 自动保存
    await saveAppConfig()
  }
}

// 保存模型
async function handleSaveModel() {
  if (!modelForm.value.friendlyName || !modelForm.value.apiUrl || !modelForm.value.authToken) {
    alert('请填写必填项：友好名称、API地址和认证令牌')
    return
  }

  // 过滤掉完全空的模型卡片
  const validModelCards = modelForm.value.modelCards.filter(card =>
    card.modelName || card.pricingCache || card.pricingInput || card.pricingOutput
  )

  // 获取有效的默认卡片ID
  const finalCards = validModelCards.length > 0 ? toRaw(validModelCards) : toRaw(modelForm.value.modelCards)
  const defaultCardId = finalCards.some(c => c.id === modelForm.value.defaultCardId)
    ? modelForm.value.defaultCardId
    : finalCards[0]?.id || null

  if (editingModel.value) {
    // 编辑模式
    const index = models.value.findIndex(m => m.id === editingModel.value.id)
    if (index !== -1) {
      models.value[index] = {
        ...models.value[index],
        friendlyName: modelForm.value.friendlyName,
        apiUrl: modelForm.value.apiUrl,
        authToken: modelForm.value.authToken,
        defaultCardId,
        modelCards: finalCards
      }
    }
  } else {
    // 添加模式
    const newModel = {
      id: Date.now().toString(),
      friendlyName: modelForm.value.friendlyName,
      apiUrl: modelForm.value.apiUrl,
      authToken: modelForm.value.authToken,
      defaultCardId,
      modelCards: finalCards
    }
    models.value.push(newModel)

    // 如果这是第一个模型，自动选中它
    if (models.value.length === 1) {
      selectedModelId.value = newModel.id
    }
  }

  showModelDialog.value = false

  // 自动保存
  await saveAppConfig()
}

// 关闭模型对话框
function handleCloseModelDialog() {
  showModelDialog.value = false
  showModelAuthToken.value = false
}

function handleClose() {
  emit('close')
}

// 测试 Bark 通知
async function testBarkUrl() {
  if (!settings.value.barkUrl) {
    alert('请先输入 Bark 通知链接')
    return
  }

  testingBark.value = true
  try {
    const result = await barkProvider.test(settings.value.barkUrl)
    if (result && result.success) {
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

// 保存 Bark URL
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

// 保存应用配置到文件（可复用）
async function saveAppConfig() {
  try {
    // 构建配置对象 - 使用 JSON 序列化确保完全去除响应式代理
    const promptsData = JSON.parse(JSON.stringify(prompts.value))
    console.log('[saveAppConfig] Prompts to save:', promptsData)

    const updates = {
      settings: {
        ...JSON.parse(JSON.stringify(settings.value)),
        models: JSON.parse(JSON.stringify(models.value)),
        prompts: promptsData,
        selectedModelId: selectedModelId.value
      }
    }

    console.log('[saveAppConfig] Full updates object:', JSON.stringify(updates, null, 2))

    // 保存配置
    const result = await window.electronAPI.updateAppConfig({ updates })
    console.log('[saveAppConfig] IPC result:', result)

    if (result && result.success) {
      console.log('[saveAppConfig] Settings saved successfully')
      return true
    } else {
      const errorMsg = result?.error || '未知错误'
      console.error('[saveAppConfig] Failed to save settings:', errorMsg)
      alert('保存配置失败: ' + errorMsg)
      return false
    }
  } catch (error) {
    console.error('Failed to auto-save settings:', error)
    alert('保存配置失败: ' + error.message)
    return false
  }
}

onMounted(() => {
  if (contentRef.value) {
    contentRef.value.addEventListener('scroll', handleScroll)
  }

  // 加载配置
  loadSettings()
})

onUnmounted(() => {
  if (contentRef.value) {
    contentRef.value.removeEventListener('scroll', handleScroll)
  }
})
</script>

<template>
  <div class="dialog-overlay" @click="handleClose">
    <div class="settings-dialog" @click.stop>
      <div class="dialog-header">
        <h2>应用设置</h2>
        <button class="close-btn" @click="handleClose" title="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <!-- 左侧导航栏 -->
        <div class="settings-nav">
          <div
            v-for="item in navItems"
            :key="item.id"
            class="nav-item"
            :class="{ active: activeSection === item.id }"
            @click="scrollToSection(item.id)"
          >
            <svg v-if="item.icon === 'model'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <svg v-else-if="item.icon === 'prompt'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <svg v-else-if="item.icon === 'software'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
              <line x1="8" y1="21" x2="16" y2="21"/>
              <line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
            <span>{{ item.label }}</span>
          </div>
        </div>

        <!-- 右侧配置内容 -->
        <div class="settings-content" ref="contentRef">
          <!-- 模型配置 -->
          <div class="config-section" ref="modelSectionRef">
            <h3 class="section-title">模型配置</h3>

            <!-- Claude 默认配置 -->
            <h4 class="subsection-title">Claude</h4>
            <div class="default-config-card">
              <button class="icon-btn edit-btn-absolute" @click="handleEditDefaultConfig" title="编辑">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
              <div class="default-config-details">
                <div class="detail-row">
                  <span class="detail-label">API地址:</span>
                  <span class="detail-value">{{ defaultConfig.apiUrl }}</span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">认证令牌:</span>
                  <span class="detail-value token-value">
                    <button
                      v-if="defaultConfig.authToken"
                      type="button"
                      class="token-toggle-btn"
                      @click.stop="showClaudeToken = !showClaudeToken"
                      :title="showClaudeToken ? '隐藏' : '显示'"
                    >
                      <svg v-if="showClaudeToken" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                        <line x1="1" y1="1" x2="23" y2="23"/>
                      </svg>
                      <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                        <circle cx="12" cy="12" r="3"/>
                      </svg>
                    </button>
                    <span class="token-text">{{ showClaudeToken && defaultConfig.authToken ? defaultConfig.authToken : (defaultConfig.authToken ? '••••••••' : '未配置') }}</span>
                  </span>
                </div>
                <div class="detail-row">
                  <span class="detail-label">模型:</span>
                  <span class="detail-value code">{{ defaultConfig.anthropicModel || defaultConfig.model || '系统默认' }}</span>
                </div>
                <div class="detail-row" v-if="defaultConfig.effort && defaultConfig.effort !== 'default'">
                  <span class="detail-label">思考力度:</span>
                  <span class="detail-value">{{ effortOptions.find(o => o.value === defaultConfig.effort)?.label || defaultConfig.effort }}</span>
                </div>
                <!-- 显示模型映射字段 -->
                <div class="detail-row">
                  <span class="detail-label">模型映射:</span>
                  <div class="model-metadata-badges">
                    <span
                      v-if="defaultConfig.anthropicModel && defaultConfig.anthropicModel !== ''"
                      class="model-metadata-badge"
                    >
                      通用:{{ defaultConfig.anthropicModel }}
                    </span>
                    <span
                      v-if="defaultConfig.anthropicDefaultSonnetModel && defaultConfig.anthropicDefaultSonnetModel !== ''"
                      class="model-metadata-badge"
                    >
                      SONNET:{{ defaultConfig.anthropicDefaultSonnetModel }}
                    </span>
                    <span
                      v-if="defaultConfig.anthropicDefaultOpusModel && defaultConfig.anthropicDefaultOpusModel !== ''"
                      class="model-metadata-badge"
                    >
                      OPUS:{{ defaultConfig.anthropicDefaultOpusModel }}
                    </span>
                    <span
                      v-if="defaultConfig.anthropicDefaultHaikuModel && defaultConfig.anthropicDefaultHaikuModel !== ''"
                      class="model-metadata-badge"
                    >
                      HAIKU:{{ defaultConfig.anthropicDefaultHaikuModel }}
                    </span>
                    <span
                      v-if="defaultConfig.anthropicSmallFastModel && defaultConfig.anthropicSmallFastModel !== ''"
                      class="model-metadata-badge"
                    >
                      SMALL_FAST:{{ defaultConfig.anthropicSmallFastModel }}
                    </span>
                    <span v-if="!hasAnyModelMapping" class="no-mapping">未配置</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- 模型列表 -->
            <div class="subsection-header">
              <h4 class="subsection-title">模型列表</h4>
              <button class="icon-btn no-border" @click="handleAddModel" title="添加模型">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
            </div>

            <!-- 模型列表容器 -->
            <div class="model-list-container">
              <!-- 空状态提示 -->
              <div v-if="models.length === 0" class="empty-state">
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                  <circle cx="12" cy="12" r="3"/>
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
                </svg>
                <p class="empty-title">还未配置大模型</p>
                <p class="empty-description">点击右侧的"+"按钮开始配置</p>
              </div>

              <!-- 模型列表 -->
              <div v-else class="model-list">
                <div
                  v-for="model in models"
                  :key="model.id"
                  class="model-card"
                  :class="{ selected: selectedModelId === model.id }"
                  @mouseenter="hoveredModelId = model.id"
                  @mouseleave="hoveredModelId = null"
                >
                  <div class="model-header">
                    <h4 class="model-name">
                      {{ model.friendlyName }}
                      <span v-if="selectedModelId === model.id" class="model-default-badge">默认</span>
                      <button
                        v-else-if="hoveredModelId === model.id"
                        type="button"
                        class="model-btn-set-default"
                        @click.stop="selectedModelId = model.id"
                      >
                        设为默认
                      </button>
                    </h4>
                    <div class="model-actions">
                      <button class="icon-btn" @click.stop="handleEditModel(model)" title="编辑">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button class="icon-btn danger" @click.stop="handleDeleteModel(model.id)" title="删除">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div>
                    <div class="detail-row">
                      <span class="detail-label">API地址:</span>
                      <span class="detail-value">{{ model.apiUrl }}</span>
                    </div>
                    <div class="detail-row">
                      <span class="detail-label">认证令牌:</span>
                      <span class="detail-value token-value">
                        <button
                          v-if="model.authToken"
                          type="button"
                          class="token-toggle-btn"
                          @click.stop="toggleModelTokenVisibility(model.id)"
                          :title="visibleModelTokens.has(model.id) ? '隐藏' : '显示'"
                        >
                          <svg v-if="visibleModelTokens.has(model.id)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                            <line x1="1" y1="1" x2="23" y2="23"/>
                          </svg>
                          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                            <circle cx="12" cy="12" r="3"/>
                          </svg>
                        </button>
                        <span class="token-text">{{ visibleModelTokens.has(model.id) && model.authToken ? model.authToken : (model.authToken ? '••••••••' : '未配置') }}</span>
                      </span>
                    </div>
                    <!-- 显示模型卡片列表 -->
                    <template v-if="model.modelCards && model.modelCards.length > 0">
                      <div class="detail-row">
                        <span class="detail-label">模型名称:</span>
                        <div class="model-cards-display">
                          <span
                            v-for="card in model.modelCards.filter(c => c.modelName)"
                            :key="card.id"
                            class="model-card-tag"
                            :class="{ 'is-default': model.defaultCardId === card.id }"
                            @click.stop="handleSetModelDefaultCard(model.id, card.id)"
                            @mouseenter="hoveredListModelCard = `${model.id}-${card.id}`"
                            @mouseleave="hoveredListModelCard = null"
                          >
                            {{ card.modelName }}
                          </span>
                        </div>
                      </div>
                      <div v-if="model.modelCards.some(card => card.pricingCache || card.pricingInput || card.pricingOutput)" class="detail-row pricing-detail">
                        <span class="detail-label">计费标准:</span>
                        <span class="detail-value pricing-value">
                          <template v-for="(card, idx) in model.modelCards" :key="card.id">
                            <template v-if="card.pricingCache || card.pricingInput || card.pricingOutput">
                              <span v-if="idx > 0" class="pricing-separator">|</span>
                              <span v-if="card.modelName && model.modelCards.length > 1" class="pricing-model-name">{{ card.modelName }}:</span>
                              <span v-if="card.pricingCache">Cache: ${{ card.pricingCache }}/M</span>
                              <span v-if="card.pricingInput"> Input: ${{ card.pricingInput }}/M</span>
                              <span v-if="card.pricingOutput"> Output: ${{ card.pricingOutput }}/M</span>
                            </template>
                          </template>
                        </span>
                      </div>
                    </template>
                    <!-- 兼容旧数据格式 -->
                    <template v-else-if="model.modelName">
                      <div class="detail-row">
                        <span class="detail-label">模型名称:</span>
                        <span class="detail-value code">{{ model.modelName }}</span>
                      </div>
                      <div v-if="model.pricingCache || model.pricingInput || model.pricingOutput" class="detail-row">
                        <span class="detail-label">计费标准:</span>
                        <span class="detail-value">
                          <span v-if="model.pricingCache">Cache: ${{ model.pricingCache }}/M</span>
                          <span v-if="model.pricingInput"> | Input: ${{ model.pricingInput }}/M</span>
                          <span v-if="model.pricingOutput"> | Output: ${{ model.pricingOutput }}/M</span>
                        </span>
                      </div>
                    </template>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <!-- 提示词配置 -->
          <div class="config-section" ref="promptSectionRef">
            <h3 class="section-title">提示词配置</h3>

            <!-- 自定义提示词 -->
            <div class="subsection-header">
              <h4 class="subsection-title">自定义提示词</h4>
              <button class="icon-btn no-border" @click="handleAddPrompt" title="添加提示词">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
            </div>
            <div class="prompts-section">
              <div class="prompts-list">
                <div
                  v-for="prompt in prompts"
                  :key="prompt.id"
                  class="prompt-card-item"
                  @mouseenter="hoveredPromptId = prompt.id"
                  @mouseleave="hoveredPromptId = null"
                >
                  <div class="model-header">
                    <h4 class="model-name">
                      {{ prompt.name || '未命名' }}
                      <button
                        type="button"
                        class="btn-toggle-active"
                        :class="{ 'is-active': prompt.isActive }"
                        @click.stop="handleTogglePromptActive(prompt.id)"
                        :title="prompt.isActive ? '点击停用' : '点击激活'"
                      >
                        {{ prompt.isActive ? '已激活' : '未激活' }}
                      </button>
                    </h4>
                    <div class="model-actions">
                      <button
                        type="button"
                        class="icon-btn"
                        @click.stop="handleEditPrompt(prompt)"
                        title="编辑提示词"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="icon-btn danger"
                        @click.stop="handleDeletePrompt(prompt.id)"
                        title="删除提示词"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div class="prompt-description" v-if="prompt.description">
                    {{ prompt.description }}
                  </div>
                </div>

                <!-- 空状态 -->
                <div v-if="prompts.length === 0" class="empty-state">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                  <p class="empty-title">暂无自定义提示词</p>
                  <p class="empty-description">点击右侧的"+"按钮开始配置</p>
                </div>
              </div>
            </div>

            <!-- 规范文档 -->
            <div class="subsection-header">
              <h4 class="subsection-title">规范文档</h4>
              <button class="icon-btn no-border" @click="handleAddDocument" title="添加规范文档">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
            </div>
            <div class="documents-section">
              <div class="documents-list">
                <div
                  v-for="document in documents"
                  :key="document.id"
                  class="document-card-item"
                  @mouseenter="hoveredDocumentId = document.id"
                  @mouseleave="hoveredDocumentId = null"
                >
                  <div class="model-header">
                    <h4 class="model-name">
                      {{ document.name || '未命名' }}
                    </h4>
                    <div class="model-actions">
                      <button
                        type="button"
                        class="icon-btn"
                        @click.stop="handleEditDocument(document)"
                        title="编辑规范文档"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                        </svg>
                      </button>
                      <button
                        type="button"
                        class="icon-btn danger"
                        @click.stop="handleDeleteDocument(document.id)"
                        title="删除规范文档"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </button>
                    </div>
                  </div>
                  <div class="document-summary" v-if="document.summary">
                    {{ document.summary }}
                  </div>
                </div>

                <!-- 空状态 -->
                <div v-if="documents.length === 0" class="empty-state">
                  <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                    <polyline points="14 2 14 8 20 8"/>
                    <line x1="16" y1="13" x2="8" y2="13"/>
                    <line x1="16" y1="17" x2="8" y2="17"/>
                    <polyline points="10 9 9 9 8 9"/>
                  </svg>
                  <p class="empty-title">暂无规范文档</p>
                  <p class="empty-description">点击右侧的"+"按钮开始配置</p>
                </div>
              </div>
            </div>
          </div>

          <!-- 提示词编辑对话框 -->
          <div v-if="showPromptDialog" class="dialog-overlay prompt-dialog-overlay" @click="handleClosePromptDialog">
            <div class="dialog-content prompt-dialog" @click.stop>
              <div class="dialog-header">
                <h3>{{ editingPrompt ? '编辑提示词' : '添加提示词' }}</h3>
                <button type="button" class="btn-close" @click="handleClosePromptDialog">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>

              <div class="dialog-body">
                <div class="form-group">
                  <label class="form-label">名称 <span class="required">*</span></label>
                  <input
                    v-model="promptForm.name"
                    type="text"
                    class="form-input"
                    placeholder="输入提示词名称"
                  />
                </div>

                <div class="form-group">
                  <label class="form-label">描述</label>
                  <input
                    v-model="promptForm.description"
                    type="text"
                    class="form-input"
                    placeholder="输入提示词描述"
                  />
                </div>

                <div class="form-group">
                  <label class="form-label">内容 <span class="required">*</span></label>
                  <textarea
                    v-model="promptForm.content"
                    class="form-textarea"
                    placeholder="输入提示词内容..."
                    rows="10"
                  ></textarea>
                </div>
              </div>

              <div class="dialog-footer">
                <button type="button" class="btn btn-secondary" @click="handleClosePromptDialog">
                  取消
                </button>
                <button type="button" class="btn btn-primary" @click="handleSavePrompt">
                  保存
                </button>
              </div>
            </div>
          </div>

          <!-- 规范文档编辑对话框 -->
          <div v-if="showDocumentDialog" class="dialog-overlay document-dialog-overlay" @click="handleCloseDocumentDialog">
            <div class="dialog-content document-dialog" @click.stop>
              <div class="dialog-header">
                <h3>{{ editingDocument ? '编辑规范文档' : '添加规范文档' }}</h3>
                <button type="button" class="btn-close" @click="handleCloseDocumentDialog">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>

              <div class="dialog-body">
                <div class="form-group">
                  <label class="form-label">文档名称 <span class="required">*</span></label>
                  <input
                    v-model="documentForm.name"
                    type="text"
                    class="form-input"
                    placeholder="输入文档名称（将作为文件名）"
                  />
                </div>

                <div class="form-group">
                  <label class="form-label">文档内容 <span class="required">*</span></label>
                  <textarea
                    v-model="documentForm.content"
                    class="form-textarea"
                    placeholder="输入 Markdown 格式的文档内容..."
                    rows="15"
                  ></textarea>
                </div>
              </div>

              <div class="dialog-footer">
                <button type="button" class="btn btn-secondary" @click="handleCloseDocumentDialog">
                  取消
                </button>
                <button type="button" class="btn btn-primary" @click="handleSaveDocument">
                  保存
                </button>
              </div>
            </div>
          </div>

          <!-- 软件配置 -->
          <div class="config-section" ref="softwareSectionRef">
            <h3 class="section-title">软件配置</h3>

            <div class="setting-item">
              <div class="setting-label">
                <span>主题</span>
                <span class="setting-description">选择应用的主题外观</span>
              </div>
              <select v-model="settings.theme" class="setting-select">
                <option value="dark">深色模式</option>
                <option value="light" disabled>浅色模式（开发中）</option>
              </select>
            </div>

            <div class="setting-item">
              <div class="setting-label">
                <span>语言</span>
                <span class="setting-description">选择应用的显示语言</span>
              </div>
              <select v-model="settings.language" class="setting-select">
                <option value="zh-CN">简体中文</option>
                <option value="en-US" disabled>English (开发中)</option>
              </select>
            </div>

            <div class="setting-item vertical">
              <div class="setting-header-row">
                <span class="setting-title">Bark 通知链接</span>
                <div class="setting-actions">
                  <button class="btn-test" @click="testBarkUrl" :disabled="testingBark">
                    {{ testingBark ? '测试中...' : '测试' }}
                  </button>
                  <button class="btn-save" @click="saveBarkUrl" :disabled="savingBark">
                    {{ savingBark ? '保存中...' : '保存' }}
                  </button>
                </div>
              </div>
              <span class="setting-description">配置 Bark 推送通知的 API 地址（选填）, 例子: https://example.com/key/ </span>
              <input
                type="text"
                v-model="settings.barkUrl"
                class="setting-input"
                placeholder="例如: https://example.com/key/"
              >
            </div>

            <div class="setting-item about-section">
              <div class="setting-label">
                <span>关于</span>
                <span class="setting-description">应用版本信息</span>
              </div>
              <div class="about-info">
                <p><strong>CCGUI</strong></p>
                <p class="version">版本 1.0.0</p>
                <p class="description">Claude Code 的图形化界面客户端</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 模型编辑对话框 -->
    <div v-if="showModelDialog" class="dialog-overlay model-dialog-overlay" @click="handleCloseModelDialog">
      <div class="model-dialog" @click.stop>
        <div class="dialog-header">
          <h2>{{ editingModel ? '编辑模型' : '添加模型' }}</h2>
          <button class="close-btn" @click="handleCloseModelDialog" title="关闭">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="dialog-body">
          <div class="form-item">
            <label class="form-label">
              友好名称 <span class="required">*</span>
              <span class="label-hint">显示名称，方便识别</span>
            </label>
            <input
              type="text"
              v-model="modelForm.friendlyName"
              class="form-input"
              placeholder="例如: Claude Sonnet 4.6"
            >
          </div>

          <div class="form-item">
            <label class="form-label">
              API地址 <span class="required">*</span>
              <span class="label-hint">API 端点地址</span>
            </label>
            <input
              type="text"
              v-model="modelForm.apiUrl"
              class="form-input"
              placeholder="例如: https://api.anthropic.com"
            >
          </div>

          <div class="form-item">
            <label class="form-label">
              认证令牌 <span class="required">*</span>
              <span class="label-hint">API 认证密钥</span>
            </label>
            <div class="input-with-action">
              <input
                :type="showModelAuthToken ? 'text' : 'password'"
                v-model="modelForm.authToken"
                class="form-input"
                placeholder="例如: sk-ant-..."
              >
              <button
                type="button"
                class="input-action-btn"
                @click="showModelAuthToken = !showModelAuthToken"
                :title="showModelAuthToken ? '隐藏' : '显示'"
              >
                <svg v-if="showModelAuthToken" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
                <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>
          </div>

          <!-- 模型卡片列表 -->
          <div class="model-cards-section">
            <div class="section-header-inline">
              <label class="form-label">模型名称与计费</label>
              <button type="button" class="btn-add-card-small" @click="handleAddModelCard" title="添加模型">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
            </div>

            <div class="model-cards-list">
              <div
                v-for="(card, index) in modelForm.modelCards"
                :key="card.id"
                class="model-card-item"
                :class="{ 'is-default': modelForm.defaultCardId === card.id }"
                @mouseenter="hoveredCardId = card.id"
                @mouseleave="hoveredCardId = null"
              >
                <div class="card-header">
                  <div class="card-title-area">
                    <span class="card-index">模型 {{ index + 1 }}</span>
                    <!-- 默认标签 -->
                    <span v-if="modelForm.defaultCardId === card.id" class="default-badge">默认</span>
                    <button
                      v-else-if="hoveredCardId === card.id"
                      type="button"
                      class="btn-set-default"
                      @click="handleSetDefaultCard(card.id)"
                    >
                      设为默认
                    </button>
                  </div>

                  <button
                    v-if="modelForm.modelCards.length > 1"
                    type="button"
                    class="btn-remove-card"
                    @click="handleRemoveModelCard(card.id)"
                    title="删除此模型"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="3 6 5 6 21 6" />
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                    </svg>
                  </button>
                </div>

                <div class="card-content">
                  <div class="card-field">
                    <input
                      type="text"
                      v-model="card.modelName"
                      class="form-input"
                      placeholder="模型名称，如 claude-sonnet-4-6"
                    >
                  </div>

                  <div class="card-pricing">
                    <div class="pricing-field">
                      <span class="pricing-label">Cache</span>
                      <input
                        type="number"
                        step="0.01"
                        v-model="card.pricingCache"
                        class="form-input"
                        placeholder="0.00"
                      >
                    </div>
                    <div class="pricing-field">
                      <span class="pricing-label">Input</span>
                      <input
                        type="number"
                        step="0.01"
                        v-model="card.pricingInput"
                        class="form-input"
                        placeholder="0.00"
                      >
                    </div>
                    <div class="pricing-field">
                      <span class="pricing-label">Output</span>
                      <input
                        type="number"
                        step="0.01"
                        v-model="card.pricingOutput"
                        class="form-input"
                        placeholder="0.00"
                      >
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div class="dialog-footer">
          <button class="btn btn-secondary" @click="handleCloseModelDialog">取消</button>
          <button class="btn btn-primary" @click="handleSaveModel">保存</button>
        </div>
      </div>
    </div>

    <!-- 默认配置编辑对话框 -->
    <div v-if="showDefaultConfigDialog" class="dialog-overlay model-dialog-overlay" @click="handleCloseDefaultConfigDialog">
      <div class="model-dialog" @click.stop>
        <div class="dialog-header">
          <h2>编辑默认配置</h2>
          <button class="close-btn" @click="handleCloseDefaultConfigDialog" title="关闭">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="dialog-body">
          <div class="form-item">
            <label class="form-label">
              API地址 (ANTHROPIC_BASE_URL) <span class="required">*</span>
              <span class="label-hint">API 端点地址</span>
            </label>
            <input
              type="text"
              v-model="defaultConfigForm.apiUrl"
              class="form-input"
              placeholder="例如: https://api.anthropic.com"
            >
          </div>

          <div class="form-item">
            <label class="form-label">
              认证令牌 (ANTHROPIC_AUTH_TOKEN) <span class="required">*</span>
              <span class="label-hint">API 认证密钥</span>
            </label>
            <div class="input-with-action">
              <input
                :type="showAuthToken ? 'text' : 'password'"
                v-model="defaultConfigForm.authToken"
                class="form-input"
                placeholder="例如: sk-ant-..."
              >
              <button
                type="button"
                class="input-action-btn"
                @click="showAuthToken = !showAuthToken"
                :title="showAuthToken ? '隐藏' : '显示'"
              >
                <svg v-if="showAuthToken" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
                <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              </button>
            </div>
          </div>

          <div class="form-item">
            <label class="form-label">
              模型
              <span class="label-hint">可选值: claude-sonnet-4-6, claude-opus-4-6 等</span>
            </label>
            <input
              type="text"
              v-model="defaultConfigForm.model"
              class="form-input"
              placeholder="例如: claude-sonnet-4-6"
            >
          </div>

          <div class="form-item">
            <label class="form-label">
              思考力度 (Effort)
              <span class="label-hint">控制模型的思考深度和响应速度</span>
            </label>
            <select v-model="defaultConfigForm.effort" class="form-input">
              <option v-for="option in effortOptions" :key="option.value" :value="option.value">
                {{ option.label }}
              </option>
            </select>
          </div>

          <!-- 模型映射 -->
          <div class="form-section-title">模型映射（高级）</div>
          <p class="form-section-desc">通过环境变量覆盖模型设置。留空则删除该配置。</p>

          <div class="model-mapping-grid">
            <div class="form-item">
              <label class="form-label">通用</label>
              <input
                type="text"
                v-model="defaultConfigForm.anthropicModel"
                class="form-input"
                placeholder="claude-opus-4-6"
              >
            </div>

            <div class="form-item">
              <label class="form-label">SONNET</label>
              <input
                type="text"
                v-model="defaultConfigForm.anthropicDefaultSonnetModel"
                class="form-input"
                placeholder="claude-sonnet-4-20250514"
              >
            </div>

            <div class="form-item">
              <label class="form-label">OPUS</label>
              <input
                type="text"
                v-model="defaultConfigForm.anthropicDefaultOpusModel"
                class="form-input"
                placeholder="claude-opus-4-20250514"
              >
            </div>

            <div class="form-item">
              <label class="form-label">HAIKU</label>
              <input
                type="text"
                v-model="defaultConfigForm.anthropicDefaultHaikuModel"
                class="form-input"
                placeholder="claude-haiku-4-5-20251001"
              >
            </div>

            <div class="form-item">
              <label class="form-label">SMALL_FAST</label>
              <input
                type="text"
                v-model="defaultConfigForm.anthropicSmallFastModel"
                class="form-input"
                placeholder="claude-haiku-4-5-20251001"
              >
            </div>
          </div>
        </div>

        <div class="dialog-footer">
          <button class="btn btn-secondary" @click="handleCloseDefaultConfigDialog">取消</button>
          <button class="btn btn-primary" @click="handleSaveDefaultConfig">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2200;
}

.settings-dialog {
  background: #2D2D2D;
  border: 1px solid #3F3F46;
  border-radius: 12px;
  width: 90%;
  max-width: 900px;
  height: 80vh;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  z-index: 2201;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid #3F3F46;
  flex-shrink: 0;
}

.dialog-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: #F4F4F5;
}

.close-btn {
  padding: 4px;
  background: transparent;
  border: none;
  color: #71717A;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.close-btn:hover {
  background: #374151;
  color: #D1D5DB;
}

.dialog-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.settings-nav {
  width: 200px;
  background: #27272A;
  border-right: 1px solid #3F3F46;
  padding: 16px 8px;
  overflow-y: auto;
  flex-shrink: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  color: #9CA3AF;
  cursor: pointer;
  border-radius: 6px;
  transition: all 0.2s;
  margin-bottom: 4px;
  font-size: 14px;
}

.nav-item:hover {
  background: #374151;
  color: #D1D5DB;
}

.nav-item.active {
  background: #F97316;
  color: white;
}

.nav-item svg {
  flex-shrink: 0;
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.config-section {
  margin-bottom: 32px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: #F4F4F5;
  margin: 0 0 20px 0;
  padding-bottom: 8px;
  border-bottom: 2px solid #F97316;
}

.section-header .section-title {
  border-bottom: none;
  padding-bottom: 0;
}

.subsection-title {
  font-size: 15px;
  font-weight: 600;
  color: #D1D5DB;
  margin: 20px 0 12px;
}

.subsection-title:first-of-type {
  margin-top: 16px;
}

.subsection-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 20px 0 12px;
}

.subsection-header:first-of-type {
  margin-top: 0;
}

.subsection-header .subsection-title {
  margin: 0;
}

.icon-btn.no-border {
  border: none;
  background: transparent;
  padding: 4px;
}

.icon-btn.no-border:hover {
  background: rgba(249, 115, 22, 0.1);
  color: #F97316;
}

.btn-sm {
  padding: 6px 14px;
  font-size: 13px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.default-config-card {
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
  position: relative;
}

.edit-btn-absolute {
  position: absolute;
  top: 12px;
  right: 12px;
}

.default-config-details {
  padding-left: 0;
}

.model-list-container {
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
}

.empty-state svg {
  color: #52525B;
  margin-bottom: 16px;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: #9CA3AF;
  margin: 0 0 8px;
}

.empty-description {
  font-size: 13px;
  color: #71717A;
  margin: 0;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.model-card {
  background: #1F1F23;
  border: 2px solid #3F3F46;
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.model-card:hover {
  background: #2D2D30;
  border-color: #52525B;
}

.model-card.selected {
  background: #2D2D30;
}

.model-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.model-name {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #F4F4F5;
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-default-badge {
  font-size: 11px;
  color: #F97316;
  background: rgba(249, 115, 22, 0.1);
  border: 1px solid rgba(249, 115, 22, 0.3);
  border-radius: 4px;
  padding: 1px 6px;
  font-weight: 500;
}

.model-btn-set-default {
  font-size: 11px;
  color: #6B7280;
  background: transparent;
  border: none;
  padding: 0 4px;
  cursor: pointer;
  display: none;
}

.model-btn-set-default:hover {
  color: #9CA3AF;
}

.model-card:hover .model-btn-set-default {
  display: inline;
}

.model-actions {
  display: flex;
  gap: 8px;
}

.icon-btn {
  padding: 6px;
  background: transparent;
  border: 1px solid #4B5563;
  border-radius: 4px;
  color: #9CA3AF;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.icon-btn:hover {
  background: #374151;
  border-color: #6B7280;
  color: #D1D5DB;
}

.icon-btn.danger:hover {
  background: #7F1D1D;
  border-color: #DC2626;
  color: #FCA5A5;
}

/* 卡片内的按钮无边框 */
.model-card .icon-btn,
.default-config-card .icon-btn,
.prompt-card-item .icon-btn,
.document-card-item .icon-btn {
  border: none;
  background: transparent;
}

.model-card .icon-btn:hover,
.default-config-card .icon-btn:hover,
.prompt-card-item .icon-btn:hover,
.document-card-item .icon-btn:hover {
  background: rgba(249, 115, 22, 0.1);
  color: #F97316;
}

.model-card .icon-btn.danger:hover,
.default-config-card .icon-btn.danger:hover,
.prompt-card-item .icon-btn.danger:hover,
.document-card-item .icon-btn.danger:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #EF4444;
}

.detail-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 13px;
}

.detail-row:last-child {
  margin-bottom: 0;
}

.detail-label {
  color: #71717A;
  min-width: 80px;
}

.detail-value {
  color: #D1D5DB;
  word-break: break-all;
}

.detail-value.code {
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 12px;
  color: #F97316;
}

/* 模型映射字段样式 */
.model-metadata-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.model-metadata-badge {
  font-size: 11px;
  color: #6B7280;
  background: rgba(75, 85, 99, 0.2);
  border: 1px solid rgba(75, 85, 99, 0.4);
  padding: 2px 6px;
  border-radius: 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}

.no-mapping {
  font-size: 12px;
  color: #6B7280;
  font-style: italic;
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  margin-bottom: 12px;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  transition: all 0.2s;
}

.setting-item:hover {
  background: #2D2D30;
  border-color: #52525B;
}

.setting-item.vertical {
  flex-direction: column;
  align-items: flex-start;
  gap: 12px;
}

.setting-header-row {
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: center;
}

.setting-title {
  color: #E5E7EB;
  font-size: 14px;
  font-weight: 500;
}

.setting-actions {
  display: flex;
  gap: 8px;
}

.btn-test,
.btn-save {
  padding: 4px 12px;
  font-size: 12px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-test {
  background: #374151;
  color: #E5E7EB;
}

.btn-test:hover:not(:disabled) {
  background: #4B5563;
}

.btn-save {
  background: #F97316;
  color: white;
}

.btn-save:hover:not(:disabled) {
  background: #EA580C;
}

.btn-test:disabled,
.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.setting-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.setting-label span:first-child {
  color: #E5E7EB;
  font-size: 14px;
  font-weight: 500;
}

.setting-description {
  color: #71717A;
  font-size: 12px;
}

.setting-select {
  padding: 8px 12px;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  color: #F4F4F5;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
  min-width: 180px;
}

.setting-select:hover {
  border-color: #52525B;
}

.setting-select:focus {
  outline: none;
  border-color: #F97316;
}

.setting-select option {
  background: #27272A;
  color: #F4F4F5;
}

.setting-input-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.setting-input {
  padding: 8px 12px;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  color: #F4F4F5;
  font-size: 13px;
  width: 100%;
}

.setting-input:hover {
  border-color: #52525B;
}

.setting-input:focus {
  outline: none;
  border-color: #F97316;
}

.setting-textarea {
  width: 100%;
  padding: 12px;
  background: #374151;
  border: 1px solid #4B5563;
  border-radius: 6px;
  color: #F4F4F5;
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  min-height: 120px;
}

.setting-textarea:hover {
  border-color: #6B7280;
}

.setting-textarea:focus {
  outline: none;
  border-color: #F97316;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 44px;
  height: 24px;
  flex-shrink: 0;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  cursor: pointer;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background-color: #4B5563;
  transition: 0.3s;
  border-radius: 24px;
}

.slider:before {
  position: absolute;
  content: "";
  height: 18px;
  width: 18px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: 0.3s;
  border-radius: 50%;
}

input:checked + .slider {
  background-color: #F97316;
}

input:checked + .slider:before {
  transform: translateX(20px);
}

.about-section {
  flex-direction: column;
  align-items: flex-start;
}

.about-info {
  width: 100%;
  padding-left: 0;
}

.about-info p {
  margin: 0 0 4px;
  color: #9CA3AF;
  font-size: 13px;
}

.about-info strong {
  color: #F4F4F5;
  font-size: 16px;
}

.version {
  color: #71717A !important;
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
}

.description {
  margin-top: 8px !important;
}

.dialog-footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding: 16px 24px;
  border-top: 1px solid #3F3F46;
  flex-shrink: 0;
}

.btn {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary {
  background: #374151;
  color: #D1D5DB;
}

.btn-secondary:hover:not(:disabled) {
  background: #4B5563;
}

.btn-secondary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: #F97316;
  color: white;
}

.btn-primary:hover {
  background: #EA580C;
}

.model-dialog {
  background: #2D2D2D;
  border: 1px solid #3F3F46;
  border-radius: 12px;
  width: 90%;
  max-width: 500px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  z-index: 2300;
}

.model-dialog .dialog-body {
  padding: 24px;
  overflow-y: auto;
  display: block;
  max-height: 70vh;
}

.form-item {
  margin-bottom: 20px;
}

.form-item:last-child {
  margin-bottom: 0;
}

.form-label {
  display: block;
  margin-bottom: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #E5E7EB;
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.label-hint {
  font-size: 12px;
  font-weight: 400;
  color: #9CA3AF;
  margin-left: 8px;
}

.form-section-title {
  font-size: 14px;
  font-weight: 600;
  color: #E5E7EB;
  margin-top: 20px;
  margin-bottom: 4px;
  padding-top: 16px;
  border-top: 1px solid #3F3F46;
}

.form-section-desc {
  font-size: 12px;
  color: #9CA3AF;
  margin-bottom: 16px;
}

.model-mapping-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
}

.model-mapping-grid .form-item {
  margin-bottom: 0;
}

.model-mapping-grid .form-label {
  min-height: 20px;
  margin-bottom: 6px;
}

.required {
  color: #F97316;
}

.form-input {
  width: 100%;
  padding: 10px 12px;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  color: #F4F4F5;
  font-size: 14px;
  transition: all 0.2s;
  box-sizing: border-box;
}

.form-input[type="text"],
.form-input[type="password"] {
  cursor: text;
}

.form-input[type="select"],
select.form-input {
  cursor: pointer;
}

.form-input:hover {
  border-color: #6B7280;
}

.form-input:focus {
  outline: none;
  border-color: #F97316;
}

.form-input::placeholder {
  color: #6B7280;
}

.form-input option {
  background: #2D2D2D;
  color: #F4F4F5;
}

.input-with-action {
  position: relative;
  display: flex;
  align-items: center;
}

.input-with-action .form-input {
  width: 100%;
  padding-right: 44px;
}

.input-action-btn {
  position: absolute;
  right: 4px;
  padding: 8px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #71717A;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.input-action-btn:hover {
  background: rgba(249, 115, 22, 0.1);
  color: #F97316;
}

.form-hint {
  margin: 6px 0 0;
  font-size: 12px;
  color: #71717A;
}

.pricing-row {
  display: flex;
  gap: 12px;
}

.pricing-field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pricing-field .form-input {
  text-align: center;
}

.pricing-label {
  font-size: 11px;
  color: #71717A;
  text-align: center;
}

.model-dialog-overlay {
  z-index: 2299;
}

/* 自定义滚动条样式 */
.model-dialog .dialog-body::-webkit-scrollbar {
  width: 8px;
}

.model-dialog .dialog-body::-webkit-scrollbar-track {
  background: #27272A;
  border-radius: 4px;
}

.model-dialog .dialog-body::-webkit-scrollbar-thumb {
  background: #4B5563;
  border-radius: 4px;
}

.model-dialog .dialog-body::-webkit-scrollbar-thumb:hover {
  background: #6B7280;
}

/* 提示词对话框样式 */
.prompt-dialog-overlay {
  z-index: 2300;
}

.prompt-dialog {
  width: 600px;
  max-width: 90vw;
  background: #2D2D2D;
  border: 1px solid #3F3F46;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.prompt-dialog .dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #3F3F46;
  flex-shrink: 0;
}

.prompt-dialog .dialog-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #F4F4F5;
}

.prompt-dialog .btn-close {
  padding: 4px;
  background: transparent;
  border: none;
  color: #71717A;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.prompt-dialog .btn-close:hover {
  background: #3F3F46;
  color: #FAFAFA;
}

.prompt-dialog .dialog-body {
  display: block;
  flex: 1;
  max-height: 70vh;
  overflow-y: auto;
  padding: 20px;
}

.prompt-dialog .dialog-footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding: 16px 20px;
  border-top: 1px solid #3F3F46;
  flex-shrink: 0;
}

.prompt-dialog .form-group {
  margin-bottom: 16px;
}

.prompt-dialog .form-label {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  font-weight: 500;
  color: #FAFAFA;
}

.prompt-dialog .form-input {
  width: 100%;
  padding: 10px 12px;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  color: #FAFAFA;
  font-size: 14px;
  font-family: inherit;
  box-sizing: border-box;
}

.prompt-dialog .form-input:focus {
  outline: none;
  border-color: #F97316;
}

.prompt-dialog .form-input::placeholder {
  color: #71717A;
}

.prompt-dialog .form-textarea {
  width: 100%;
  padding: 10px 12px;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  color: #FAFAFA;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  line-height: 1.5;
  box-sizing: border-box;
}

.prompt-dialog .form-textarea:focus {
  outline: none;
  border-color: #F97316;
}

.prompt-dialog .form-textarea::placeholder {
  color: #71717A;
}

.prompt-dialog .form-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.prompt-dialog .form-checkbox input {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #F97316;
}

.prompt-dialog .form-checkbox span {
  font-size: 14px;
  color: #A1A1AA;
}

/* 模型卡片样式 */
.model-cards-section {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #3F3F46;
}

.section-header-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
}

.section-header-inline .form-label {
  margin-bottom: 0;
}

.btn-add-card {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid #F97316;
  border-radius: 6px;
  color: #F97316;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-add-card:hover {
  background: rgba(249, 115, 22, 0.1);
}

.btn-add-card-small {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #6B7280;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-add-card-small:hover {
  background: rgba(249, 115, 22, 0.1);
  color: #F97316;
}

.model-cards-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.model-card-item {
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  padding: 12px;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.card-title-area {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
}

.card-index {
  font-size: 13px;
  font-weight: 500;
  color: #D1D5DB;
}

.btn-remove-card {
  padding: 4px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #71717A;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-remove-card:hover {
  background: #7F1D1D;
  color: #FCA5A5;
}

.card-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-field .form-input {
  width: 100%;
}

.card-pricing {
  display: flex;
  gap: 12px;
}

.card-pricing .pricing-field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.card-pricing .form-input {
  text-align: center;
}

.pricing-label {
  font-size: 11px;
  color: #71717A;
  text-align: center;
}

/* 模型列表中的卡片显示样式 */
.model-card-display {
  margin-bottom: 4px;
}

.model-card-display:last-child {
  margin-bottom: 0;
}

.pricing-detail .detail-label {
  min-width: 80px;
}

.pricing-value {
  font-size: 12px;
}

.pricing-separator {
  margin: 0 8px;
  color: #52525B;
}

.pricing-model-name {
  color: #F97316;
  font-weight: 500;
  margin-right: 4px;
}

/* 模型卡片名称列表 */
.model-cards-display {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.model-card-tag {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: none;
  color: #71717A;
  background: transparent;
  box-sizing: border-box;
}

.model-card-tag:hover {
  background: rgba(249, 115, 22, 0.1);
}

.model-card-tag.is-default {
  color: #F97316;
  background: rgba(249, 115, 22, 0.1);
  border: 1px solid rgba(249, 115, 22, 0.3);
  border-radius: 4px;
  padding: 1px 6px;
  transition: none;
  }

.model-card-tag.is-default:hover {
  background: rgba(249, 115, 22, 0.15);
  }

.model-card-tag.is-default span {
  margin-left: 4px;
  color: #F97316;
}

/* 内联设为默认按钮 */
.btn-set-default-inline {
  font-size: 11px;
  color: #6B7280;
  background: transparent;
  border: none;
  padding: 0 4px;
  cursor: pointer;
  display: none;
}

.btn-set-default-inline:hover {
  color: #9CA3AF;
}

.model-card-tag:hover .btn-set-default-inline {
  display: inline;
}

/* 模型令牌显示样式 */
.token-value {
  display: flex;
  align-items: center;
  gap: 0;
}

.token-text {
  flex: 1;
  word-break: break-all;
}

.token-toggle-btn {
  padding: 4px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #71717A;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  flex-shrink: 0;
  min-width: 24px;
  margin-left: -28px;
  margin-right: 4px;
}

.token-toggle-btn:hover {
  background: rgba(249, 115, 22, 0.1);
  color: #F97316;
}

/* 默认配置卡片的令牌样式 */
.default-config-details .token-value {
  min-height: 20px;
}

/* 模型卡片默认标签样式 */
.card-default-tag {
  display: inline-flex;
  align-items: center;
  padding: 2px 6px;
  background: rgba(249, 115, 22, 0.1);
  border-radius: 4px;
  color: #D1D5DB;
  font-size: 11px;
  font-weight: 500;
  margin-left: 4px;
}

.card-default-tag:hover {
  background: rgba(249, 115, 22, 0.2);
  color: white;
}

/* 设为默认按钮 */
.btn-set-default {
  display: none;
  padding: 0;
  background: transparent;
  border: none;
  font-size: 12px;
  color: #6B7280;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-set-default:hover {
  color: #9CA3AF;
}

/* 删除按钮保持原有样式 */
.btn-remove-card {
  padding: 4px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #71717A;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  min-width: 24px;
  transition: all 0.2s;
}

.btn-remove-card:hover {
  background: #7F1D1D;
  border-color: #DC2626;
  color: #FCA5A5;
}

/* 模型卡片hover时显示设为默认按钮 */
.model-card-item:hover .btn-set-default {
  display: inline;
}

/* 默认标签样式 */
.default-badge {
  font-size: 12px;
  color: #F97316;
  background: rgba(249, 115, 22, 0.1);
  border: 1px solid rgba(249, 115, 22, 0.3);
  border-radius: 4px;
  padding: 1px 6px;
}

/* 默认标签在hover时高亮 */
.model-card-item:hover .default-badge {
  background: rgba(249, 115, 22, 0.15);
  border-color: rgba(249, 115, 22, 0.5);
}

/* 提示词卡片样式 */
.prompts-section {
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
}

.prompts-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.prompt-card-item {
  background: #1F1F23;
  border: 2px solid #3F3F46;
  border-radius: 8px;
  padding: 16px;
  transition: all 0.2s;
}

.prompt-card-item:hover {
  background: #2D2D30;
  border-color: #52525B;
}

.prompt-description {
  font-size: 13px;
  color: #A1A1AA;
  margin-top: 8px;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
}

/* 激活/停用按钮 */
.btn-toggle-active {
  font-size: 12px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid #52525B;
  background: transparent;
  color: #A1A1AA;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-toggle-active:hover {
  border-color: #F97316;
  color: #F97316;
}

.btn-toggle-active.is-active {
  background: rgba(249, 115, 22, 0.1);
  border-color: #F97316;
  color: #F97316;
}

/* 规范文档卡片样式 */
.documents-section {
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
}

.documents-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.document-card-item {
  background: #1F1F23;
  border: 2px solid #3F3F46;
  border-radius: 8px;
  padding: 16px;
  transition: all 0.2s;
}

.document-card-item:hover {
  background: #2D2D30;
  border-color: #52525B;
}

/* 规范文档对话框样式 */
.document-dialog-overlay {
  z-index: 2300;
}

.document-dialog {
  width: 600px;
  max-width: 90vw;
  background: #2D2D2D;
  border: 1px solid #3F3F46;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.document-dialog .dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid #3F3F46;
  flex-shrink: 0;
}

.document-dialog .dialog-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #F4F4F5;
}

.document-dialog .btn-close {
  padding: 4px;
  background: transparent;
  border: none;
  color: #71717A;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.document-dialog .btn-close:hover {
  background: #3F3F46;
  color: #FAFAFA;
}

.document-dialog .dialog-body {
  display: block;
  flex: 1;
  max-height: 70vh;
  overflow-y: auto;
  padding: 20px;
}

.document-dialog .dialog-footer {
  display: flex;
  gap: 12px;
  justify-content: flex-end;
  padding: 16px 20px;
  border-top: 1px solid #3F3F46;
  flex-shrink: 0;
}

.document-dialog .form-group {
  margin-bottom: 16px;
}

.document-dialog .form-label {
  display: block;
  margin-bottom: 6px;
  font-size: 14px;
  font-weight: 500;
  color: #FAFAFA;
}

.document-dialog .form-input {
  width: 100%;
  padding: 10px 12px;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  color: #FAFAFA;
  font-size: 14px;
  font-family: inherit;
  box-sizing: border-box;
}

.document-dialog .form-input:focus {
  outline: none;
  border-color: #F97316;
}

.document-dialog .form-input::placeholder {
  color: #71717A;
}

.document-dialog .form-textarea {
  width: 100%;
  padding: 10px 12px;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  color: #FAFAFA;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  line-height: 1.5;
  box-sizing: border-box;
  min-height: 200px;
}

.document-dialog .form-textarea:focus {
  outline: none;
  border-color: #F97316;
}

.document-dialog .form-textarea::placeholder {
  color: #71717A;
}

/* 文档摘要样式 */
.document-summary {
  font-size: 13px;
  color: #A1A1AA;
  margin-top: 8px;
  line-height: 1.5;
  overflow: hidden;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-line-clamp: 3;
  -webkit-box-orient: vertical;
}
</style>
