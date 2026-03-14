<script setup>
/**
 * SettingsDialog - 设置对话框
 * 整合模型配置、提示词配置、软件配置三个区域
 */
import { ref, onMounted, onUnmounted, toRaw, computed } from 'vue'
import { barkProvider } from '@/utils/notifier'
import { IconButton } from '@/components/common'
import ModelSettings from './components/ModelSettings.vue'
import PromptSettings from './components/PromptSettings.vue'
import SoftwareSettings from './components/SoftwareSettings.vue'
import ModelEditDialog from './components/dialogs/ModelEditDialog.vue'
import DefaultConfigDialog from './components/dialogs/DefaultConfigDialog.vue'
import PromptEditDialog from './components/dialogs/PromptEditDialog.vue'
import DocumentEditDialog from './components/dialogs/DocumentEditDialog.vue'
import ModelMappingDialog from './components/dialogs/ModelMappingDialog.vue'

const emit = defineEmits(['close'])

// ========== 导航相关 ==========
const activeSection = ref('model')
const contentRef = ref(null)
const modelSectionRef = ref(null)
const promptSectionRef = ref(null)
const softwareSectionRef = ref(null)

const navItems = [
  { id: 'model', label: '模型配置', icon: 'model' },
  { id: 'prompt', label: '提示词配置', icon: 'prompt' },
  { id: 'software', label: '软件配置', icon: 'software' }
]

// ========== 配置状态 ==========
const settings = ref({
  theme: 'dark',
  language: 'zh-CN',
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

// ========== 对话框状态 ==========
const showModelDialog = ref(false)
const editingModel = ref(null)

const showDefaultConfigDialog = ref(false)
const showAuthToken = ref(false)
const showModelAuthToken = ref(false)

const showPromptDialog = ref(false)
const editingPrompt = ref(null)

const showDocumentDialog = ref(false)
const editingDocument = ref(null)

// 映射确认对话框
const showMappingDialog = ref(false)
const pendingModel = ref(null)

// ========== 悬停状态 ==========
const hoveredPromptId = ref(null)
const hoveredDocumentId = ref(null)
const hoveredModelId = ref(null)

// ========== Bark 测试状态 ==========
const testingBark = ref(false)
const savingBark = ref(false)

// ========== 努力选项 ==========
const effortOptions = [
  { value: 'default', label: '默认' },
  { value: 'low', label: '低' },
  { value: 'medium', label: '中' },
  { value: 'high', label: '高' }
]

// ========== 工具函数 ==========
function generateModelCardId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9)
}

function generatePromptId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9)
}

function generateDocumentId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9)
}

// ========== 加载配置 ==========
async function loadSettings() {
  try {
    const result = await window.electronAPI.getAppConfig()
    if (result && result.success) {
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

    // 加载 Claude 设置 (from ~/.claude/settings.json)
    const claudeResult = await window.electronAPI.getClaudeSettings()
    if (claudeResult && claudeResult.success && claudeResult.settings) {
      const claudeSettings = claudeResult.settings
      const env = claudeSettings.env || {}

      // 映射 Claude 设置到 defaultConfig
      defaultConfig.value.apiUrl = env.ANTHROPIC_BASE_URL || ''
      defaultConfig.value.authToken = env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || ''
      defaultConfig.value.model = claudeSettings.model || ''
      defaultConfig.value.effort = claudeSettings.effort || 'default'

      // 映射模型变量 (从 env 中加载)
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

// ========== 保存配置 ==========
async function saveAppConfig() {
  try {
    const promptsData = JSON.parse(JSON.stringify(prompts.value))
    const updates = {
      settings: {
        ...JSON.parse(JSON.stringify(settings.value)),
        models: JSON.parse(JSON.stringify(models.value)),
        prompts: promptsData,
        selectedModelId: selectedModelId.value
      },
      documents: JSON.parse(JSON.stringify(documents.value))
    }

    const result = await window.electronAPI.updateAppConfig({ updates })
    if (result && result.success) {
      return true
    } else {
      alert('保存配置失败: ' + (result?.error || '未知错误'))
      return false
    }
  } catch (error) {
    console.error('Failed to save settings:', error)
    alert('保存配置失败: ' + error.message)
    return false
  }
}

// ========== 导航功能 ==========
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
    container.scrollTo({ top: targetOffsetTop, behavior: 'smooth' })
  }
}

function handleScroll() {
  if (!contentRef.value) return

  const container = contentRef.value
  const scrollTop = container.scrollTop

  const sections = [
    { id: 'model', ref: modelSectionRef.value },
    { id: 'prompt', ref: promptSectionRef.value },
    { id: 'software', ref: softwareSectionRef.value }
  ]

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

// ========== 模型操作 ==========
function handleAddModel() {
  editingModel.value = null
  showModelDialog.value = true
}

function handleEditModel(model) {
  editingModel.value = model
  showModelDialog.value = true
}

async function handleDeleteModel(modelId) {
  if (confirm('确定要删除这个模型吗？')) {
    models.value = models.value.filter(m => m.id !== modelId)
    if (selectedModelId.value === modelId) {
      selectedModelId.value = models.value[0]?.id || null
    }
    await saveAppConfig()
  }
}

async function handleSaveModel(formData) {
  const validModelCards = formData.modelCards.filter(card =>
    card.modelName || card.pricingCache || card.pricingInput || card.pricingOutput
  )

  const finalCards = validModelCards.length > 0 ? toRaw(validModelCards) : toRaw(formData.modelCards)
  const defaultCardId = finalCards.some(c => c.id === formData.defaultCardId)
    ? formData.defaultCardId
    : finalCards[0]?.id || null

  if (editingModel.value) {
    const index = models.value.findIndex(m => m.id === editingModel.value.id)
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
  const model = models.value.find(m => m.id === modelId)
  if (model) {
    model.defaultCardId = cardId
    await saveAppConfig()
  }
}

async function handleToggleModelActive({ modelId, active }) {
  const model = models.value.find(m => m.id === modelId)
  if (model) {
    model.isActive = active
    await saveAppConfig()
  }
}

function handleApplyModel(model) {
  if (!model) return

  // 检查模型卡片数量
  const cardCount = model.modelCards?.length || 0

  if (cardCount <= 1) {
    // 单卡片或无卡片：直接应用，只设置通用模型
    const defaultModelName = cardCount === 1 ? model.modelCards[0].modelName : ''
    applyModelWithMappings(model, {
      ANTHROPIC_MODEL: defaultModelName,
      model: defaultModelName
    }, true)  // clearMappings: true for single card mode
  } else {
    // 多卡片：显示映射确认对话框
    pendingModel.value = model
    showMappingDialog.value = true
  }
}

// 处理映射确认
async function handleMappingConfirm(mappings) {
  if (!pendingModel.value) return

  try {
    await applyModelWithMappings(pendingModel.value, mappings)
  } finally {
    showMappingDialog.value = false
    pendingModel.value = null
  }
}

// 应用模型配置（带映射）
async function applyModelWithMappings(model, mappings, clearMappings = false) {
  try {
    // 构建环境变量更新
    const env = {
      ANTHROPIC_BASE_URL: model.apiUrl || '',
      ANTHROPIC_AUTH_TOKEN: model.authToken || ''
    }

    // 根据映射设置各模型变量
    if (mappings.ANTHROPIC_MODEL) {
      env.ANTHROPIC_MODEL = mappings.ANTHROPIC_MODEL
    }
    if (mappings.ANTHROPIC_DEFAULT_SONNET_MODEL) {
      env.ANTHROPIC_DEFAULT_SONNET_MODEL = mappings.ANTHROPIC_DEFAULT_SONNET_MODEL
    }
    if (mappings.ANTHROPIC_DEFAULT_OPUS_MODEL) {
      env.ANTHROPIC_DEFAULT_OPUS_MODEL = mappings.ANTHROPIC_DEFAULT_OPUS_MODEL
    }
    if (mappings.ANTHROPIC_DEFAULT_HAIKU_MODEL) {
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL = mappings.ANTHROPIC_DEFAULT_HAIKU_MODEL
    }
    if (mappings.ANTHROPIC_SMALL_FAST_MODEL) {
      env.ANTHROPIC_SMALL_FAST_MODEL = mappings.ANTHROPIC_SMALL_FAST_MODEL
    }

    const updates = { env }
    if (mappings.model) {
      updates.model = mappings.model
    }

    // 调用 API 更新 Claude 设置
    const result = await window.electronAPI.updateClaudeSettings({ updates, clearMappings })

    if (result && result.success) {
      // 更新本地 defaultConfig 显示
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
    } else {
      alert('应用模型配置失败: ' + (result?.error || '未知错误'))
    }
  } catch (error) {
    console.error('应用模型失败:', error)
    alert('应用模型配置失败: ' + error.message)
  }
}


// ========== 默认配置操作 ==========
function handleEditDefaultConfig() {
  showDefaultConfigDialog.value = true
}

async function handleSaveDefaultConfig(config) {
  defaultConfig.value = { ...defaultConfig.value, ...config }
  showDefaultConfigDialog.value = false
  showAuthToken.value = false
  await saveAppConfig()
}

// ========== 提示词操作 ==========
function handleAddPrompt() {
  editingPrompt.value = null
  showPromptDialog.value = true
}

function handleEditPrompt(prompt) {
  editingPrompt.value = prompt
  showPromptDialog.value = true
}

async function handleDeletePrompt(promptId) {
  if (confirm('确定要删除这个提示词吗？')) {
    prompts.value = prompts.value.filter(p => p.id !== promptId)
    await saveAppConfig()
  }
}

async function handleTogglePromptActive(promptId) {
  const prompt = prompts.value.find(p => p.id === promptId)
  if (prompt) {
    prompt.isActive = !prompt.isActive
    await saveAppConfig()
  }
}

async function handleSavePrompt(formData) {
  if (editingPrompt.value) {
    const index = prompts.value.findIndex(p => p.id === editingPrompt.value.id)
    if (index !== -1) {
      prompts.value[index] = {
        ...prompts.value[index],
        name: formData.name,
        description: formData.description,
        content: formData.content,
        isActive: formData.isActive
      }
    }
  } else {
    prompts.value.push({
      id: formData.id || generatePromptId(),
      name: formData.name,
      description: formData.description,
      content: formData.content,
      isActive: formData.isActive
    })
  }

  showPromptDialog.value = false
  await saveAppConfig()
}

// ========== 规范文档操作 ==========
function handleAddDocument() {
  editingDocument.value = null
  showDocumentDialog.value = true
}

function handleEditDocument(document) {
  editingDocument.value = document
  showDocumentDialog.value = true
}

async function handleDeleteDocument(documentId) {
  if (confirm('确定要删除这个规范文档吗？')) {
    documents.value = documents.value.filter(d => d.id !== documentId)
    await saveAppConfig()
  }
}

async function handleToggleDocumentActive(documentId) {
  const document = documents.value.find(d => d.id === documentId)
  if (document) {
    document.isActive = document.isActive === false ? true : false
    await saveAppConfig()
  }
}

async function handleSaveDocument(formData) {
  if (editingDocument.value) {
    const index = documents.value.findIndex(d => d.id === editingDocument.value.id)
    if (index !== -1) {
      documents.value[index] = {
        ...documents.value[index],
        name: formData.name,
        summary: formData.summary,
        content: formData.content
      }
    }
  } else {
    documents.value.push({
      id: formData.id || generateDocumentId(),
      name: formData.name,
      summary: formData.summary,
      content: formData.content
    })
  }

  showDocumentDialog.value = false
  await saveAppConfig()
}

// ========== Bark 通知 ==========
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

// ========== 生命周期 ==========
onMounted(() => {
  if (contentRef.value) {
    contentRef.value.addEventListener('scroll', handleScroll)
  }
  loadSettings()
})

onUnmounted(() => {
  if (contentRef.value) {
    contentRef.value.removeEventListener('scroll', handleScroll)
  }
})

function handleClose() {
  emit('close')
}
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
          <div ref="modelSectionRef">
            <ModelSettings
              :default-config="defaultConfig"
              :models="models"
              :selected-model-id="selectedModelId"
              :effort-options="effortOptions"
              @edit-default-config="handleEditDefaultConfig"
              @select-model="handleSelectModel"
              @edit-model="handleEditModel"
              @delete-model="handleDeleteModel"
              @add-model="handleAddModel"
              @set-model-default-card="handleSetModelDefaultCard"
              @toggle-model-active="handleToggleModelActive"
              @apply-model="handleApplyModel"
            />
          </div>

          <div ref="promptSectionRef">
            <PromptSettings
              :prompts="prompts"
              :documents="documents"
              @add-prompt="handleAddPrompt"
              @edit-prompt="handleEditPrompt"
              @delete-prompt="handleDeletePrompt"
              @toggle-prompt-active="handleTogglePromptActive"
              @add-document="handleAddDocument"
              @edit-document="handleEditDocument"
              @delete-document="handleDeleteDocument"
              @toggle-document-active="handleToggleDocumentActive"
            />
          </div>

          <div ref="softwareSectionRef">
            <SoftwareSettings
              :settings="settings"
              @update:settings="settings = $event"
              @test-bark="testBarkUrl"
              @save-bark="saveBarkUrl"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 模型编辑对话框 -->
    <ModelEditDialog
      v-model:visible="showModelDialog"
      :model="editingModel"
      @save="handleSaveModel"
      @close="showModelDialog = false"
    />

    <!-- 默认配置编辑对话框 -->
    <DefaultConfigDialog
      v-model:visible="showDefaultConfigDialog"
      :config="defaultConfig"
      @save="handleSaveDefaultConfig"
      @close="showDefaultConfigDialog = false"
    />

    <!-- 提示词编辑对话框 -->
    <PromptEditDialog
      v-model:visible="showPromptDialog"
      :prompt="editingPrompt"
      @save="handleSavePrompt"
      @close="showPromptDialog = false"
    />

    <!-- 规范文档编辑对话框 -->
    <DocumentEditDialog
      v-model:visible="showDocumentDialog"
      :document="editingDocument"
      @save="handleSaveDocument"
      @close="showDocumentDialog = false"
    />

    <!-- 模型映射确认对话框 -->
    <ModelMappingDialog
      v-model:visible="showMappingDialog"
      :model="pendingModel"
      @confirm="handleMappingConfirm"
      @close="showMappingDialog = false"
    />
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
  z-index: 1000;
}

.settings-dialog {
  background: #1F1F23;
  border-radius: 12px;
  width: 90vw;
  max-width: 900px;
  height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid #3F3F46;
}

.dialog-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #F4F4F5;
}

.close-btn {
  background: transparent;
  border: none;
  color: #9CA3AF;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.close-btn:hover {
  color: #F4F4F5;
  background: #3F3F46;
}

.dialog-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.settings-nav {
  width: 200px;
  background: #18181B;
  border-right: 1px solid #3F3F46;
  padding: 16px 8px;
  flex-shrink: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  color: #9CA3AF;
  transition: all 0.2s;
  margin-bottom: 4px;
}

.nav-item:hover {
  background: #27272A;
  color: #F4F4F5;
}

.nav-item.active {
  background: rgba(249, 115, 22, 0.1);
  color: #F97316;
}

.nav-item span {
  font-size: 14px;
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}
</style>
