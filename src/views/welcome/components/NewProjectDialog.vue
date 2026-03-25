<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useAppStore } from '../../../stores/useAppStore'
import { getDefaultCredential, getProviderModels } from '../../../utils/provider-models'
import { useDialogStack } from '../../../composables/useDialogStack'
import AppSelect from '@/components/base/AppSelect.vue'

const store = useAppStore()

// Props
const props = defineProps({
  initialPath: {
    type: String,
    default: ''
  }
})

// 基础字段
const projectPath = ref('')
const isCreating = ref(false)
const error = ref('')

// 配置选项
const claudeModelMode = ref('system')
const claudeModelCardMode = ref('default')
const codexModelMode = ref('system')
const codexModelCardMode = ref('default')
const promptsMode = ref('system')
const documentsMode = ref('system')

// 选择的配置
const selectedClaudeModelId = ref(null)
const selectedClaudeCredentialId = ref(null)
const selectedClaudeTargetKind = ref('provider')
const selectedClaudeTargetId = ref(null)
const selectedClaudeModelCardId = ref(null)
const selectedCodexModelId = ref(null)
const selectedCodexCredentialId = ref(null)
const selectedCodexTargetKind = ref('provider')
const selectedCodexTargetId = ref(null)
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
const codexRuntimeSettings = ref({
  authMode: 'provider',
  model: '',
  modelProvider: '',
  activeAccountId: null,
  activeAccountName: ''
})

const emit = defineEmits(['close', 'created'])

useDialogStack(computed(() => true), () => emit('close'))

// 计算属性：可用的模型列表（已激活的）
const availableClaudeModels = computed(() => claudeSystemModels.value.filter(m => m.isActive !== false))
const availableCodexModels = computed(() => codexSystemModels.value.filter(m => m.isActive !== false))

const groupedClaudeTargets = computed(() => groupTargets(claudeProviderTargets.value))
const groupedCodexTargets = computed(() => groupTargets(codexProviderTargets.value))

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

// 计算属性：基础提示词ID列表（isBase=true）
const basePromptIds = computed(() => {
  return systemPrompts.value
    .filter(p => p.isBase === true)
    .map(p => p.id)
})

// 计算属性：基础文档ID列表（isBase!==false）
const baseDocumentIds = computed(() => {
  return systemDocuments.value
    .filter(d => d.isBase !== false)
    .map(d => d.id)
})

const systemPromptsSummary = computed(() => summarizeNames(systemPrompts.value.filter(prompt => prompt.isBase === true)))
const systemDocumentsSummary = computed(() => summarizeNames(systemDocuments.value.filter(doc => doc.isBase !== false)))

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

    const [claudeTargetResult, codexTargetResult, codexSettingsResult] = await Promise.all([
      window.electronAPI.getAvailableTargets({ provider: 'claude' }),
      window.electronAPI.getAvailableTargets({ provider: 'codex' }),
      window.electronAPI.getCodexSettings()
    ])
    claudeProviderTargets.value = claudeTargetResult?.success ? (Array.isArray(claudeTargetResult.options) ? claudeTargetResult.options : []) : []
    codexProviderTargets.value = codexTargetResult?.success ? (Array.isArray(codexTargetResult.options) ? codexTargetResult.options : []) : []
    if (codexSettingsResult?.success && codexSettingsResult.settings) {
      codexRuntimeSettings.value = {
        authMode: codexSettingsResult.settings.authMode || 'provider',
        model: codexSettingsResult.settings.model || '',
        modelProvider: codexSettingsResult.settings.modelProvider || '',
        activeAccountId: codexSettingsResult.settings.activeAccountId || null,
        activeAccountName: codexSettingsResult.settings.activeAccountName || ''
      }
    }

    const [claudeSummaryResult, codexSummaryResult] = await Promise.all([
      window.electronAPI.getModelConfigSummary({ provider: 'claude' }),
      window.electronAPI.getModelConfigSummary({ provider: 'codex' })
    ])
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
  const byProvider = new Map()
  for (const option of options) {
    const groupKey = option.providerLabel || option.providerId || '其他'
    if (!byProvider.has(groupKey)) {
      const group = { key: groupKey, label: option.providerLabel || groupKey, options: [] }
      byProvider.set(groupKey, group)
      groups.push(group)
    }
    byProvider.get(groupKey).options.push(option)
  }
  return groups
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

function onModelChange(provider) {
  const models = provider === 'codex' ? codexSystemModels.value : claudeSystemModels.value
  const modelId = provider === 'codex' ? selectedCodexModelId.value : selectedClaudeModelId.value
  const model = models.find(m => m.id === modelId)
  const defaultCard = model?.modelCards?.find(c => c.id === model.defaultCardId) || model?.modelCards?.[0] || null

  if (provider === 'codex') {
    codexModelCardMode.value = 'default'
    selectedCodexModelCardId.value = defaultCard?.id || null
    return
  }

  claudeModelCardMode.value = 'default'
  selectedClaudeModelCardId.value = defaultCard?.id || null
}

function syncSelectedTarget(provider, optionId) {
  const options = provider === 'codex' ? codexProviderTargets.value : claudeProviderTargets.value
  const option = options.find(item => item.id === optionId) || null
  if (provider === 'codex') {
    selectedCodexTargetId.value = optionId || null
    selectedCodexModelId.value = option?.modelId || null
    selectedCodexCredentialId.value = option?.credentialId || null
    selectedCodexTargetKind.value = option?.targetKind || 'provider'
    onModelChange('codex')
    return
  }

  selectedClaudeTargetId.value = optionId || null
  selectedClaudeModelId.value = option?.modelId || null
  selectedClaudeCredentialId.value = option?.credentialId || null
  selectedClaudeTargetKind.value = option?.targetKind || 'provider'
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

// 获取默认模型卡片名称
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

async function handleBrowse() {
  if (window.electronAPI?.selectDirectory) {
    const result = await window.electronAPI.selectDirectory()
    if (result && !result.canceled && result.filePaths.length > 0) {
      projectPath.value = result.filePaths[0]
    }
  } else {
    alert('请手动输入项目路径')
  }
}

function handleEnterKey(event) {
  if (event?.isComposing || event?.keyCode === 229) return
  handleCreate()
}

async function handleCreate() {
  if (!projectPath.value.trim()) {
    error.value = '请选择或输入项目路径'
    return
  }

  isCreating.value = true
  error.value = ''

  try {
    // 构建设置对象
    // - 模式为 'system' 时，对应字段为 null（跟随系统）
    // - 模式为 'none' 时，对应字段为空数组（不使用，仅适用于提示词和文档）
    // - 模式为 'custom' 时，对应字段为具体选择的值
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
      documentIds: documentsMode.value === 'custom' ? [...selectedDocumentIds.value] : []
    }

    const newProject = await store.addProject(projectPath.value.trim(), settings)
    emit('created', newProject)
  } catch (e) {
    error.value = e.message || '创建项目失败'
  } finally {
    isCreating.value = false
  }
}

watch(claudeModelMode, (newVal) => {
  if (newVal === 'custom' && claudeProviderTargets.value.length > 0) {
    if (!selectedClaudeTargetId.value) syncSelectedTarget('claude', claudeProviderTargets.value[0].id)
  } else {
    selectedClaudeTargetId.value = null
    selectedClaudeModelId.value = null
    selectedClaudeCredentialId.value = null
    selectedClaudeTargetKind.value = 'provider'
    selectedClaudeModelCardId.value = null
  }
})

watch(codexModelMode, (newVal) => {
  if (newVal === 'custom' && codexProviderTargets.value.length > 0) {
    if (!selectedCodexTargetId.value) syncSelectedTarget('codex', codexProviderTargets.value[0].id)
  } else {
    selectedCodexTargetId.value = null
    selectedCodexModelId.value = null
    selectedCodexCredentialId.value = null
    selectedCodexTargetKind.value = 'provider'
    selectedCodexModelCardId.value = null
  }
})

watch(promptsMode, (newVal) => {
  if (newVal === 'custom') {
    // 默认选中基础提示词
    selectedPromptIds.value = [...basePromptIds.value]
  } else {
    // 'system' 或 'none' 时清空选择
    selectedPromptIds.value = []
  }
})

watch(documentsMode, (newVal) => {
  if (newVal === 'custom') {
    // 默认选中基础文档
    selectedDocumentIds.value = [...baseDocumentIds.value]
  } else {
    // 'system' 或 'none' 时清空选择
    selectedDocumentIds.value = []
  }
})

onMounted(() => {
  loadSystemConfig()
  // 如果有初始路径，填充到输入框
  if (props.initialPath) {
    projectPath.value = props.initialPath
  }
})
</script>

<template>
  <div class="dialog-overlay">
    <div class="dialog">
      <div class="dialog-header">
        <h3>新建项目</h3>
        <button class="close-btn" @click="emit('close')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <!-- 项目路径 -->
        <div class="form-group">
          <label>项目路径</label>
          <div class="input-row">
            <input
              v-model="projectPath"
              type="text"
              placeholder="选择或输入项目目录路径"
              @keyup.enter="handleEnterKey"
            />
            <button class="browse-btn" @click="handleBrowse">浏览...</button>
          </div>
        </div>

        <!-- 高级配置 -->
        <div class="advanced-config">
          <h4 class="config-title">高级配置（可选）</h4>

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
                  @change="syncSelectedTarget('claude', $event?.value || null)"
                />
              </div>
              <div v-if="selectedClaudeModelId && availableClaudeModelCards.length > 0" class="model-cards-wrapper">
                <div class="cards-header">
                  <span class="cards-label">模型</span>
                  <div class="segment-control">
                    <button
                      type="button"
                      class="segment-btn"
                      :class="{ active: claudeModelCardMode === 'default' }"
                      @click="claudeModelCardMode = 'default'"
                    >
                      默认
                    </button>
                    <button
                      type="button"
                      class="segment-btn"
                      :class="{ active: claudeModelCardMode === 'custom' }"
                      @click="claudeModelCardMode = 'custom'"
                    >
                      自选
                    </button>
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
              <p v-if="availableClaudeModels.length === 0" class="empty-hint">
                暂无可用模型供应商，请先在设置中添加并激活模型供应商
              </p>
            </div>
          </div>

          <!-- Codex 模型 -->
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
                  @change="syncSelectedTarget('codex', $event?.value || null)"
                />
              </div>
              <p class="config-hint">Codex 一旦绑定供应商，后续会话只能在同一供应商的不同令牌之间切换。</p>
              <div v-if="selectedCodexModelId && availableCodexModelCards.length > 0" class="model-cards-wrapper">
                <div class="cards-header">
                  <span class="cards-label">模型</span>
                  <div class="segment-control">
                    <button
                      type="button"
                      class="segment-btn"
                      :class="{ active: codexModelCardMode === 'default' }"
                      @click="codexModelCardMode = 'default'"
                    >
                      默认
                    </button>
                    <button
                      type="button"
                      class="segment-btn"
                      :class="{ active: codexModelCardMode === 'custom' }"
                      @click="codexModelCardMode = 'custom'"
                    >
                      自选
                    </button>
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
              <p v-if="availableCodexModels.length === 0" class="empty-hint">
                暂无可用模型供应商，请先在设置中添加并激活模型供应商
              </p>
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
        </div>

        <p v-if="error" class="error-message">{{ error }}</p>

        <p class="hint">
          项目目录将包含 Claude Code 的配置和会话历史
        </p>
      </div>

      <div class="dialog-footer">
        <button class="btn btn-cancel" @click="emit('close')">
          取消
        </button>
        <button
          class="btn btn-confirm"
          :disabled="isCreating || !projectPath.trim()"
          @click="handleCreate"
        >
          {{ isCreating ? '创建中...' : '创建' }}
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
  overflow-y: auto;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.dialog-header {
  padding: 16px 20px;
  border-bottom: 1px solid #3F3F46;
  display: flex;
  justify-content: space-between;
  align-items: center;
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
}

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 13px;
  color: #9CA3AF;
  margin-bottom: 8px;
}

.input-row {
  display: flex;
  gap: 8px;
}

.input-row input {
  flex: 1;
  padding: 10px 12px;
  background: #1E1E1E;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  color: #E5E7EB;
  font-size: 13px;
}

.input-row input:focus {
  outline: none;
  border-color: #F97316;
}

.browse-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 76px;
  padding: 0 14px;
  background: transparent;
  border: 1px solid #4B5563;
  border-radius: 8px;
  color: #9CA3AF;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
  transition: all 0.2s ease;
}

.browse-btn:hover {
  background: #374151;
  border-color: #6B7280;
  color: #D1D5DB;
}

/* 高级配置样式 */
.advanced-config {
  margin-top: 20px;
  padding-top: 16px;
  border-top: 1px solid #3F3F46;
}

.config-title {
  margin: 0 0 16px;
  font-size: 14px;
  font-weight: 600;
  color: #9CA3AF;
}

.config-section {
  margin-bottom: 16px;
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

.select-row:last-child {
  margin-bottom: 0;
}

/* 模型卡片选择样式 */
.model-cards-wrapper {
  margin-top: 10px;
  padding: 10px;
  border: 1px solid #3F3F46;
  border-radius: 6px;
}

.model-cards {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
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

.error-message {
  margin: 0 0 12px;
  font-size: 13px;
  color: #EF4444;
}

.hint {
  margin: 0;
  font-size: 12px;
  color: #6B7280;
}

.dialog-footer {
  padding: 16px 20px;
  border-top: 1px solid #3F3F46;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
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
