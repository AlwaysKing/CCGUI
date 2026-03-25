<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { getDefaultCredential, getProviderModels } from '../../../utils/provider-models'
import { useDialogStack } from '../../../composables/useDialogStack'
import ChatMessageThemeEditor from '@/components/chat/ChatMessageThemeEditor.vue'
import { buildChatMessageThemeFromPreset, getChatMessageThemePresetLabel, normalizeChatMessageTheme } from '@/utils/chatMessageTheme'
import AppSelect from '@/components/base/AppSelect.vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  projectId: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['close', 'saved'])

useDialogStack(computed(() => props.visible), () => emit('close'))

// 配置选项
const claudeModelMode = ref('system')
const claudeModelCardMode = ref('default')
const codexModelMode = ref('system')
const codexModelCardMode = ref('default')
const promptsMode = ref('system')
const documentsMode = ref('system')
const chatMessageThemeMode = ref('app')
const chatMessageThemePreset = ref('classic')
const chatMessageTheme = ref(buildChatMessageThemeFromPreset('classic'))

// 选择的配置
const selectedClaudeTargetId = ref(null)
const selectedClaudeModelId = ref(null)
const selectedClaudeCredentialId = ref(null)
const selectedClaudeTargetKind = ref('provider')
const selectedClaudeModelCardId = ref(null)
const selectedCodexTargetId = ref(null)
const selectedCodexModelId = ref(null)
const selectedCodexCredentialId = ref(null)
const selectedCodexTargetKind = ref('provider')
const selectedCodexModelCardId = ref(null)
const selectedPromptIds = ref([])
const selectedDocumentIds = ref([])

// 系统配置数据
const claudeSystemModels = ref([])
const codexSystemModels = ref([])
const claudeProviderTargets = ref([])
const codexProviderTargets = ref([])
const systemPrompts = ref([])
const systemDocuments = ref([])
const appConfig = ref(null)
const modelSummary = ref({
  claude: null,
  codex: null
})

// 状态
const loading = ref(false)
const saving = ref(false)

// 计算属性：可用的模型列表（已激活的）
const availableClaudeModels = computed(() => claudeSystemModels.value.filter(m => m.isActive !== false))
const availableCodexModels = computed(() => codexSystemModels.value.filter(m => m.isActive !== false))

const availableClaudeModelCards = computed(() => {
  if (!selectedClaudeModelId.value) return []
  const model = claudeSystemModels.value.find(m => m.id === selectedClaudeModelId.value)
  return model?.modelCards || []
})

const availableCodexModelCards = computed(() => {
  if (!selectedCodexModelId.value) return []
  const model = codexSystemModels.value.find(m => m.id === selectedCodexModelId.value)
  return model?.modelCards || []
})

const groupedClaudeTargets = computed(() => groupTargets(claudeProviderTargets.value))
const groupedCodexTargets = computed(() => groupTargets(codexProviderTargets.value))

// 计算属性：基础提示词ID列表
const basePromptIds = computed(() => {
  return systemPrompts.value
    .filter(p => p.isBase === true)
    .map(p => p.id)
})

// 计算属性：基础文档ID列表
const baseDocumentIds = computed(() => {
  return systemDocuments.value
    .filter(d => d.isBase !== false)
    .map(d => d.id)
})

const systemPromptsSummary = computed(() => summarizeNames(systemPrompts.value.filter(prompt => prompt.isBase === true)))
const systemDocumentsSummary = computed(() => summarizeNames(systemDocuments.value.filter(doc => doc.isBase !== false)))
const appThemeSummary = computed(() => {
  const preset = appConfig.value?.settings?.chatMessageThemePreset || 'classic'
  return getChatMessageThemePresetLabel(preset)
})

// 加载系统配置
async function loadSystemConfig() {
  try {
    const result = await window.electronAPI.getAppConfig()
    if (result && result.success) {
      const config = result.config
      appConfig.value = config
      if (config.settings) {
        claudeSystemModels.value = getProviderModels(config, 'claude')
        codexSystemModels.value = getProviderModels(config, 'codex')
        systemPrompts.value = config.settings.prompts || []
      }
      if (config.documents) {
        systemDocuments.value = config.documents
      }
    }

    const [claudeTargetResult, codexTargetResult, claudeSummaryResult, codexSummaryResult] = await Promise.all([
      window.electronAPI.getAvailableTargets({ projectId: props.projectId, provider: 'claude' }),
      window.electronAPI.getAvailableTargets({ projectId: props.projectId, provider: 'codex' }),
      window.electronAPI.getModelConfigSummary({ provider: 'claude', projectId: props.projectId }),
      window.electronAPI.getModelConfigSummary({ provider: 'codex', projectId: props.projectId })
    ])

    claudeProviderTargets.value = claudeTargetResult?.success ? (claudeTargetResult.options || []) : []
    codexProviderTargets.value = codexTargetResult?.success ? (codexTargetResult.options || []) : []
    modelSummary.value = {
      claude: claudeSummaryResult?.success ? (claudeSummaryResult.systemSummary || null) : null,
      codex: codexSummaryResult?.success ? (codexSummaryResult.systemSummary || null) : null
    }
  } catch (e) {
    console.error('Failed to load system config:', e)
  }
}

function groupTargets(options = []) {
  const groups = []
  const seen = new Map()

  for (const option of options) {
    const key = option.providerLabel || option.providerId || '其他'
    if (!seen.has(key)) {
      const group = { key, label: key, options: [] }
      seen.set(key, group)
      groups.push(group)
    }
    seen.get(key).options.push(option)
  }

  return groups
}

// 加载项目配置
async function loadProjectConfig() {
  if (!props.projectId) return

  loading.value = true
  try {
    const result = await window.electronAPI.getProjectConfig({ projectId: props.projectId })
    if (result && result.config) {
      const settings = result.config.settings || {}

      applyProviderModelConfig('claude', settings.providerModelSettings?.claude || settings.claudeModelConfig || settings)
      applyProviderModelConfig('codex', settings.providerModelSettings?.codex || settings.codexModelConfig || settings)

      // 提示词配置
      const savedPromptMode = settings.promptMode || (
        Array.isArray(settings.promptIds) ? (settings.promptIds.length > 0 ? 'custom' : 'none') : 'system'
      )
      if (savedPromptMode === 'custom') {
        promptsMode.value = 'custom'
        selectedPromptIds.value = Array.isArray(settings.promptIds) ? [...settings.promptIds] : []
      } else {
        promptsMode.value = savedPromptMode
        selectedPromptIds.value = []
      }

      // 规范文档配置
      const savedDocumentMode = settings.documentMode || (
        Array.isArray(settings.documentIds) ? (settings.documentIds.length > 0 ? 'custom' : 'none') : 'system'
      )
      if (savedDocumentMode === 'custom') {
        documentsMode.value = 'custom'
        selectedDocumentIds.value = Array.isArray(settings.documentIds) ? [...settings.documentIds] : []
      } else {
        documentsMode.value = savedDocumentMode
        selectedDocumentIds.value = []
      }

      const savedChatThemeMode = settings.chatMessageThemeMode || 'app'
      chatMessageThemeMode.value = savedChatThemeMode === 'preset' ? 'custom' : savedChatThemeMode
      chatMessageThemePreset.value = settings.chatMessageThemePreset || 'classic'
      chatMessageTheme.value = normalizeChatMessageTheme(settings.chatMessageTheme || {}, chatMessageThemePreset.value)
    }
  } catch (e) {
    console.error('Failed to load project config:', e)
  } finally {
    loading.value = false
  }
}

function applyProviderModelConfig(provider, settings = {}) {
  const savedModelMode = settings.modelMode || (settings.modelId ? 'custom' : 'system')

  if (provider === 'claude') {
    claudeModelMode.value = savedModelMode === 'custom' && settings.modelId ? 'custom' : 'system'
    selectedClaudeModelId.value = savedModelMode === 'custom' ? (settings.modelId || null) : null
    selectedClaudeCredentialId.value = savedModelMode === 'custom' ? (settings.credentialId || null) : null
    selectedClaudeTargetKind.value = savedModelMode === 'custom' ? (settings.targetKind || 'provider') : 'provider'
    claudeModelCardMode.value = settings.modelCardId ? 'custom' : 'default'
    selectedClaudeModelCardId.value = settings.modelCardId || null
    syncTargetFromModel('claude')
    return
  }

  codexModelMode.value = savedModelMode === 'custom' && settings.modelId ? 'custom' : 'system'
  selectedCodexModelId.value = savedModelMode === 'custom' ? (settings.modelId || null) : null
  selectedCodexCredentialId.value = savedModelMode === 'custom' ? (settings.credentialId || null) : null
  selectedCodexTargetKind.value = savedModelMode === 'custom' ? (settings.targetKind || 'provider') : 'provider'
  codexModelCardMode.value = settings.modelCardId ? 'custom' : 'default'
  selectedCodexModelCardId.value = settings.modelCardId || null
  syncTargetFromModel('codex')
}

// 切换提示词选择
function togglePrompt(promptId) {
  const index = selectedPromptIds.value.indexOf(promptId)
  if (index === -1) {
    selectedPromptIds.value.push(promptId)
  } else {
    selectedPromptIds.value.splice(index, 1)
  }
}

// 切换文档选择
function toggleDocument(docId) {
  const index = selectedDocumentIds.value.indexOf(docId)
  if (index === -1) {
    selectedDocumentIds.value.push(docId)
  } else {
    selectedDocumentIds.value.splice(index, 1)
  }
}

function syncTargetFromModel(provider) {
  const targets = provider === 'codex' ? codexProviderTargets.value : claudeProviderTargets.value
  const modelId = provider === 'codex' ? selectedCodexModelId.value : selectedClaudeModelId.value
  const credentialId = provider === 'codex' ? selectedCodexCredentialId.value : selectedClaudeCredentialId.value
  const targetKind = provider === 'codex' ? selectedCodexTargetKind.value : selectedClaudeTargetKind.value

  const match = targets.find(option =>
    (option.modelId || null) === (modelId || null) &&
    (option.credentialId || null) === (credentialId || null) &&
    (option.targetKind || 'provider') === (targetKind || 'provider')
  ) || null

  if (provider === 'codex') {
    selectedCodexTargetId.value = match?.id || null
  } else {
    selectedClaudeTargetId.value = match?.id || null
  }
}

function onModelChange(provider) {
  const models = provider === 'codex' ? codexSystemModels.value : claudeSystemModels.value
  const modelId = provider === 'codex' ? selectedCodexModelId.value : selectedClaudeModelId.value
  const model = models.find(m => m.id === modelId)

  if (provider === 'codex') {
    codexModelCardMode.value = 'default'
    if (model?.modelCards?.length > 0) {
      const defaultCard = model.modelCards.find(c => c.id === model.defaultCardId)
      selectedCodexModelCardId.value = defaultCard?.id || model.modelCards[0].id
    } else {
      selectedCodexModelCardId.value = null
    }
    return
  }

  claudeModelCardMode.value = 'default'
  if (model?.modelCards?.length > 0) {
    const defaultCard = model.modelCards.find(c => c.id === model.defaultCardId)
    selectedClaudeModelCardId.value = defaultCard?.id || model.modelCards[0].id
  } else {
    selectedClaudeModelCardId.value = null
  }
}

function handleTargetChange(provider, optionId) {
  const targets = provider === 'codex' ? codexProviderTargets.value : claudeProviderTargets.value
  const option = targets.find(item => item.id === optionId) || null
  if (!option) return

  if (provider === 'codex') {
    selectedCodexTargetId.value = option.id
    selectedCodexModelId.value = option.modelId || null
    selectedCodexCredentialId.value = option.credentialId || null
    selectedCodexTargetKind.value = option.targetKind || 'provider'
    onModelChange('codex')
    return
  }

  selectedClaudeTargetId.value = option.id
  selectedClaudeModelId.value = option.modelId || null
  selectedClaudeCredentialId.value = option.credentialId || null
  selectedClaudeTargetKind.value = option.targetKind || 'provider'
  onModelChange('claude')
}

function getSelectedTargetLabel(provider) {
  const options = provider === 'codex' ? codexProviderTargets.value : claudeProviderTargets.value
  const targetId = provider === 'codex' ? selectedCodexTargetId.value : selectedClaudeTargetId.value
  const option = options.find(item => item.id === targetId) || null
  return option?.label || ''
}

function mapTargetGroups(groups = []) {
  return groups.map(group => ({
    ...group,
    options: (group.options || []).map(option => ({
      ...option,
      value: option.id
    }))
  }))
}

function getDefaultModelCardName(provider) {
  const models = provider === 'codex' ? codexSystemModels.value : claudeSystemModels.value
  const modelId = provider === 'codex' ? selectedCodexModelId.value : selectedClaudeModelId.value
  const model = models.find(m => m.id === modelId)
  if (!model?.modelCards?.length) return '无可用模型'
  const defaultCard = model.modelCards.find(c => c.id === model.defaultCardId)
  const card = defaultCard || model.modelCards[0]
  return card?.modelName || card?.id || '默认模型'
}

function getSystemModelSummary(provider) {
  return modelSummary.value[provider === 'codex' ? 'codex' : 'claude'] || ''
}

function summarizeNames(items = [], fallback = '未配置') {
  if (!Array.isArray(items) || items.length === 0) return fallback
  const names = items.map(item => item?.name).filter(Boolean)
  if (!names.length) return fallback
  return names.length <= 3 ? names.join('、') : `${names.slice(0, 3).join('、')} 等 ${names.length} 项`
}

// 保存配置
async function handleSave() {
  if (!props.projectId) return

  saving.value = true
  try {
    const settings = {
      providerModelSettings: {
        claude: {
          modelMode: claudeModelMode.value,
          modelId: claudeModelMode.value === 'custom' ? selectedClaudeModelId.value : null,
          credentialId: claudeModelMode.value === 'custom' ? selectedClaudeCredentialId.value : null,
          targetKind: claudeModelMode.value === 'custom' ? selectedClaudeTargetKind.value : null,
          modelCardId: claudeModelMode.value === 'custom' && claudeModelCardMode.value === 'custom' ? selectedClaudeModelCardId.value : null
        },
        codex: {
          modelMode: codexModelMode.value,
          modelId: codexModelMode.value === 'custom' ? selectedCodexModelId.value : null,
          credentialId: codexModelMode.value === 'custom' ? selectedCodexCredentialId.value : null,
          targetKind: codexModelMode.value === 'custom' ? selectedCodexTargetKind.value : null,
          modelCardId: codexModelMode.value === 'custom' && codexModelCardMode.value === 'custom' ? selectedCodexModelCardId.value : null
        }
      },
      promptMode: promptsMode.value,
      promptIds: promptsMode.value === 'custom' ? [...selectedPromptIds.value] : [],
      documentMode: documentsMode.value,
      documentIds: documentsMode.value === 'custom' ? [...selectedDocumentIds.value] : [],
      chatMessageThemeMode: chatMessageThemeMode.value,
      chatMessageThemePreset: chatMessageThemeMode.value === 'custom' ? chatMessageThemePreset.value : null,
      chatMessageTheme: chatMessageThemeMode.value === 'custom' ? { ...chatMessageTheme.value } : {}
    }

    await window.electronAPI.updateProjectConfig({
      projectId: props.projectId,
      updates: { settings }
    })

    emit('saved')
    emit('close')
  } catch (e) {
    console.error('Failed to save project config:', e)
    alert('保存配置失败: ' + e.message)
  } finally {
    saving.value = false
  }
}

// 监听可见性变化
watch(() => props.visible, (visible) => {
  if (visible) {
    loadSystemConfig()
    loadProjectConfig()
  }
})

// 监听模式变化
watch(claudeModelMode, (newVal) => {
  if (newVal === 'custom' && claudeProviderTargets.value.length > 0) {
    if (!selectedClaudeTargetId.value) {
      handleTargetChange('claude', claudeProviderTargets.value[0].id)
    }
  } else if (newVal !== 'custom') {
    selectedClaudeTargetId.value = null
    selectedClaudeModelId.value = null
    selectedClaudeCredentialId.value = null
    selectedClaudeTargetKind.value = 'provider'
    selectedClaudeModelCardId.value = null
  }
})

watch(codexModelMode, (newVal) => {
  if (newVal === 'custom' && codexProviderTargets.value.length > 0) {
    if (!selectedCodexTargetId.value) {
      handleTargetChange('codex', codexProviderTargets.value[0].id)
    }
  } else if (newVal !== 'custom') {
    selectedCodexTargetId.value = null
    selectedCodexModelId.value = null
    selectedCodexCredentialId.value = null
    selectedCodexTargetKind.value = 'provider'
    selectedCodexModelCardId.value = null
  }
})

watch(promptsMode, (newVal) => {
  if (newVal === 'custom') {
    if (selectedPromptIds.value.length === 0) {
      selectedPromptIds.value = [...basePromptIds.value]
    }
  } else {
    selectedPromptIds.value = []
  }
})

watch(documentsMode, (newVal) => {
  if (newVal === 'custom') {
    if (selectedDocumentIds.value.length === 0) {
      selectedDocumentIds.value = [...baseDocumentIds.value]
    }
  } else {
    selectedDocumentIds.value = []
  }
})

onMounted(() => {
  if (props.visible) {
    loadSystemConfig()
    loadProjectConfig()
  }
})
</script>

<template>
  <div v-if="visible" class="dialog-overlay">
    <div class="dialog">
      <div class="dialog-header">
        <h3>项目配置</h3>
        <button class="close-btn" @click="emit('close')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <div v-if="loading" class="loading-state">
          <p>加载中...</p>
        </div>

        <template v-else>
          <!-- Claude 模型 -->
          <div class="config-section">
            <label class="config-label">
              Claude 模型
              <span v-if="claudeModelMode === 'system'" class="current-config-hint">- {{ getSystemModelSummary('claude') }}</span>
            </label>
            <div class="radio-group">
              <label class="radio-item">
                <input type="radio" v-model="claudeModelMode" value="system" />
                <span>系统</span>
              </label>
              <label class="radio-item">
                <input type="radio" v-model="claudeModelMode" value="custom" />
                <span>自定义</span>
              </label>
            </div>
            <div v-if="claudeModelMode === 'custom'" class="model-select-wrapper">
              <div class="select-row">
                <AppSelect
                  v-model="selectedClaudeTargetId"
                  class="select-input"
                  full-width
                  placeholder="-- 选择供应商与令牌 --"
                  :groups="mapTargetGroups(groupedClaudeTargets)"
                  :selected-label="getSelectedTargetLabel('claude')"
                  @change="handleTargetChange('claude', $event?.value || null)"
                />
              </div>
              <div v-if="selectedClaudeModelId && availableClaudeModelCards.length > 0" class="model-cards-wrapper">
                <div class="cards-header">
                  <span class="cards-label">模型</span>
                  <div class="segment-control">
                    <button type="button" class="segment-btn" :class="{ active: claudeModelCardMode === 'default' }" @click="claudeModelCardMode = 'default'">默认</button>
                    <button type="button" class="segment-btn" :class="{ active: claudeModelCardMode === 'custom' }" @click="claudeModelCardMode = 'custom'">自选</button>
                  </div>
                </div>
                <div v-if="claudeModelCardMode === 'custom'" class="model-cards-list">
                  <button
                    v-for="card in availableClaudeModelCards"
                    :key="card.id"
                    type="button"
                    class="model-card-badge"
                    :class="{ active: selectedClaudeModelCardId === card.id }"
                    @click="selectedClaudeModelCardId = card.id"
                  >
                    {{ card.modelName || card.id }}
                  </button>
                </div>
                <div v-else class="default-card-hint">
                  {{ getDefaultModelCardName('claude') }}
                </div>
              </div>
              <p v-if="availableClaudeModels.length === 0" class="empty-hint">暂无可用模型供应商，请先在设置中添加并激活模型供应商</p>
            </div>
          </div>

          <div class="config-section">
            <label class="config-label">
              Codex 模型
              <span v-if="codexModelMode === 'system'" class="current-config-hint">- {{ getSystemModelSummary('codex') }}</span>
            </label>
            <div class="radio-group">
              <label class="radio-item">
                <input type="radio" v-model="codexModelMode" value="system" />
                <span>系统</span>
              </label>
              <label class="radio-item">
                <input type="radio" v-model="codexModelMode" value="custom" />
                <span>自定义</span>
              </label>
            </div>
            <div v-if="codexModelMode === 'custom'" class="model-select-wrapper">
              <div class="select-row">
                <AppSelect
                  v-model="selectedCodexTargetId"
                  class="select-input"
                  full-width
                  placeholder="-- 选择供应商与令牌 --"
                  :groups="mapTargetGroups(groupedCodexTargets)"
                  :selected-label="getSelectedTargetLabel('codex')"
                  @change="handleTargetChange('codex', $event?.value || null)"
                />
              </div>
              <p class="config-hint">Codex 一旦绑定供应商，后续会话只能在同一供应商的不同令牌之间切换。</p>
              <div v-if="selectedCodexModelId && availableCodexModelCards.length > 0" class="model-cards-wrapper">
                <div class="cards-header">
                  <span class="cards-label">模型</span>
                  <div class="segment-control">
                    <button type="button" class="segment-btn" :class="{ active: codexModelCardMode === 'default' }" @click="codexModelCardMode = 'default'">默认</button>
                    <button type="button" class="segment-btn" :class="{ active: codexModelCardMode === 'custom' }" @click="codexModelCardMode = 'custom'">自选</button>
                  </div>
                </div>
                <div v-if="codexModelCardMode === 'custom'" class="model-cards-list">
                  <button
                    v-for="card in availableCodexModelCards"
                    :key="card.id"
                    type="button"
                    class="model-card-badge"
                    :class="{ active: selectedCodexModelCardId === card.id }"
                    @click="selectedCodexModelCardId = card.id"
                  >
                    {{ card.modelName || card.id }}
                  </button>
                </div>
                <div v-else class="default-card-hint">
                  {{ getDefaultModelCardName('codex') }}
                </div>
              </div>
              <p v-if="availableCodexModels.length === 0" class="empty-hint">暂无可用模型供应商，请先在设置中添加并激活模型供应商</p>
            </div>
          </div>

          <!-- 提示词选择 -->
          <div class="config-section">
            <label class="config-label">
              提示词
              <span v-if="promptsMode === 'system'" class="current-config-hint">- {{ systemPromptsSummary }}</span>
            </label>
            <div class="radio-group">
              <label class="radio-item">
                <input type="radio" v-model="promptsMode" value="system" />
                <span>系统</span>
              </label>
              <label class="radio-item">
                <input type="radio" v-model="promptsMode" value="custom" />
                <span>自定义</span>
              </label>
              <label class="radio-item">
                <input type="radio" v-model="promptsMode" value="none" />
                <span>不使用</span>
              </label>
            </div>
            <div v-if="promptsMode === 'custom'" class="config-content">
              <div v-if="systemPrompts.length > 0" class="checkbox-list">
                <label v-for="prompt in systemPrompts" :key="prompt.id" class="checkbox-item">
                  <input
                    type="checkbox"
                    :checked="selectedPromptIds.includes(prompt.id)"
                    @change="togglePrompt(prompt.id)"
                  />
                  <span class="checkbox-label">
                    {{ prompt.name }}
                    <span v-if="prompt.isBase" class="badge-base">基础</span>
                  </span>
                  <span v-if="prompt.description" class="item-description">{{ prompt.description }}</span>
                </label>
              </div>
              <p v-else class="empty-hint">暂无自定义提示词</p>
            </div>
          </div>

          <!-- 规范文档选择 -->
          <div class="config-section">
            <label class="config-label">
              规范文档
              <span v-if="documentsMode === 'system'" class="current-config-hint">- {{ systemDocumentsSummary }}</span>
            </label>
            <div class="radio-group">
              <label class="radio-item">
                <input type="radio" v-model="documentsMode" value="system" />
                <span>系统</span>
              </label>
              <label class="radio-item">
                <input type="radio" v-model="documentsMode" value="custom" />
                <span>自定义</span>
              </label>
              <label class="radio-item">
                <input type="radio" v-model="documentsMode" value="none" />
                <span>不使用</span>
              </label>
            </div>
            <div v-if="documentsMode === 'custom'" class="config-content">
              <div v-if="systemDocuments.length > 0" class="checkbox-list">
                <label v-for="doc in systemDocuments" :key="doc.id" class="checkbox-item">
                  <input
                    type="checkbox"
                    :checked="selectedDocumentIds.includes(doc.id)"
                    @change="toggleDocument(doc.id)"
                  />
                  <span class="checkbox-label">
                    {{ doc.name }}
                    <span v-if="doc.isBase !== false" class="badge-base">基础</span>
                  </span>
                  <span v-if="doc.summary" class="item-description">{{ doc.summary }}</span>
                </label>
              </div>
              <p v-else class="empty-hint">暂无规范文档</p>
            </div>
          </div>

          <div class="config-section">
            <label class="config-label">
              消息主题
              <span v-if="chatMessageThemeMode === 'app'" class="current-config-hint">- {{ appThemeSummary }}</span>
            </label>
            <div class="radio-group">
              <label class="radio-item">
                <input type="radio" v-model="chatMessageThemeMode" value="app" />
                <span>系统</span>
              </label>
              <label class="radio-item">
                <input type="radio" v-model="chatMessageThemeMode" value="custom" />
                <span>自定义</span>
              </label>
            </div>
            <div v-if="chatMessageThemeMode === 'custom'" class="config-content">
              <ChatMessageThemeEditor
                :show-preview="false"
                :preset-key="chatMessageThemePreset"
                :theme-config="chatMessageTheme"
                @update:preset-key="chatMessageThemePreset = $event; chatMessageTheme = buildChatMessageThemeFromPreset($event)"
                @update:theme-config="chatMessageTheme = $event"
              />
            </div>
          </div>
        </template>
      </div>

      <div class="dialog-footer">
        <button class="btn btn-cancel" @click="emit('close')">
          取消
        </button>
        <button
          class="btn btn-confirm"
          :disabled="saving || loading"
          @click="handleSave"
        >
          {{ saving ? '保存中...' : '保存' }}
        </button>
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
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.dialog {
  background: #2D2D2D;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  min-width: 480px;
  max-width: 560px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.dialog-header {
  padding: 16px 20px;
  border-bottom: 1px solid #3F3F46;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.dialog-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #E5E7EB;
}

.close-btn {
  padding: 4px;
  background: transparent;
  border: none;
  color: #6B7280;
  cursor: pointer;
  border-radius: 4px;
}

.close-btn:hover {
  background: #374151;
  color: #D1D5DB;
}

.dialog-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
  min-height: 0;
}

.loading-state {
  text-align: center;
  color: #6B7280;
  padding: 40px;
}

.config-section {
  margin-bottom: 20px;
}

.config-label {
  display: block;
  font-size: 13px;
  color: #D1D5DB;
  margin-bottom: 8px;
  font-weight: 500;
}

.radio-group {
  display: flex;
  gap: 16px;
  margin-bottom: 8px;
}

.radio-item {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 13px;
  color: #9CA3AF;
}

.radio-item input {
  accent-color: #F97316;
  cursor: pointer;
}

.radio-item:hover {
  color: #D1D5DB;
}

.config-content {
  padding: 12px;
  background: #1E1E1E;
  border-radius: 6px;
  border: 1px solid #3F3F46;
}

.field-hint {
  margin: 0 0 10px;
  font-size: 12px;
  color: #6B7280;
}

.config-divider {
  height: 1px;
  margin: 24px 0 20px;
  background: #3F3F46;
}

.model-select-wrapper {
  margin-top: 8px;
}

.cards-label {
  display: block;
  font-size: 12px;
  color: #6B7280;
  margin-bottom: 6px;
}

.cards-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.default-card-hint {
  font-size: 12px;
  color: #9CA3AF;
  padding: 6px 0;
}

.select-row {
  margin-bottom: 8px;
}

/* 模型卡片选择样式 */
.model-cards-wrapper {
  margin-top: 10px;
  padding: 10px;
  border: 1px solid #3F3F46;
  border-radius: 6px;
}

.model-cards-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* Segment control 样式 */
.segment-control {
  display: flex;
  border: 1px solid #3F3F46;
  border-radius: 4px;
  overflow: hidden;
  background: #1E1E1E;
}

.segment-btn {
  padding: 4px 12px;
  font-size: 12px;
  background: transparent;
  border: none;
  color: #6B7280;
  cursor: pointer;
  transition: all 0.2s;
}

.segment-btn:first-child {
  border-right: 1px solid #3F3F46;
}

.segment-btn:hover:not(.active) {
  color: #9CA3AF;
  background: #2D2D2D;
}

.segment-btn.active {
  background: #F97316;
  color: white;
}

.model-card-badge {
  font-size: 11px;
  color: #6B7280;
  background: transparent;
  border: 1px solid #52525B;
  border-radius: 4px;
  padding: 1px 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.model-card-badge:hover {
  color: #9CA3AF;
  border-color: #71717A;
}

.model-card-badge.active {
  color: #fff;
  background: #F97316;
  border-color: #F97316;
}

.select-input {
  width: 100%;
}

.checkbox-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.checkbox-item {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  padding: 8px;
  border-radius: 4px;
  transition: background 0.2s;
}

.checkbox-item:hover {
  background: #2D2D2D;
}

.checkbox-item input {
  accent-color: #F97316;
  flex-shrink: 0;
}

.checkbox-label {
  font-size: 13px;
  color: #D1D5DB;
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge-base {
  font-size: 11px;
  padding: 1px 6px;
  background: #F97316;
  color: white;
  border-radius: 3px;
}

.item-description {
  font-size: 12px;
  color: #6B7280;
  width: 100%;
  margin-left: 24px;
  margin-top: 2px;
}

.empty-hint {
  font-size: 13px;
  color: #6B7280;
  margin: 0;
  padding: 8px 0;
}

.config-hint {
  margin: 8px 0 0;
  font-size: 12px;
  line-height: 1.5;
  color: #A1A1AA;
}

.current-config-hint {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 400;
  color: #6B7280;
}

.dialog-footer {
  padding: 16px 20px;
  border-top: 1px solid #3F3F46;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  flex-shrink: 0;
}

.btn {
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
}

.btn-cancel {
  background: transparent;
  border: 1px solid #4B5563;
  color: #9CA3AF;
}

.btn-cancel:hover {
  background: #374151;
  border-color: #6B7280;
}

.btn-confirm {
  background: #F97316;
  color: white;
}

.btn-confirm:hover:not(:disabled) {
  background: #EA580C;
}

.btn-confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
