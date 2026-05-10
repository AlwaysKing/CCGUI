<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { useAppStore } from '../../../stores/useAppStore'
import { getDefaultCredential, getProviderModels } from '../../../utils/provider-models'
import { useDialogStack } from '../../../composables/useDialogStack'
import AppSelect from '@/components/base/AppSelect.vue'
import { getChatMessageThemePresetLabel } from '@/utils/chatMessageTheme'

const store = useAppStore()

const props = defineProps({
  projectId: {
    type: String,
    required: true
  }
})

const sessionName = ref('')
const selectedTool = ref('claude')
const showAdvanced = ref(false)
const modelMode = ref('project')
const modelCardMode = ref('default')
const promptsMode = ref('project')
const documentsMode = ref('project')
const selectedModelId = ref(null)
const selectedCredentialId = ref(null)
const selectedTargetKind = ref('provider')
const selectedTargetId = ref(null)
const selectedModelCardId = ref(null)
const selectedPromptIds = ref([])
const selectedDocumentIds = ref([])
const projectPromptMode = ref('project')
const projectPromptText = ref('')
const systemModels = ref([])
const providerTargets = ref([])
const systemPrompts = ref([])
const systemDocuments = ref([])
const appConfig = ref(null)
const projectConfig = ref(null)
const modelSummary = ref({
  systemSummary: null,
  projectSummary: null
})
const codexRuntimeSettings = ref({
  authMode: 'provider',
  model: '',
  modelProvider: '',
  activeAccountId: null,
  activeAccountName: ''
})
const isCreating = ref(false)
const error = ref('')

const emit = defineEmits(['close', 'created'])

useDialogStack(computed(() => true), () => emit('close'))

function handleEnterKey(event) {
  if (event?.isComposing || event?.keyCode === 229) return
  handleCreate()
}

const selectedToolLabel = computed(() => {
  if (selectedTool.value === 'codex') return 'Codex'
  if (selectedTool.value === 'claude') return 'Claude'
  return '未选择'
})

const availableModels = computed(() => {
  return systemModels.value.filter(model => model.isActive !== false)
})

const groupedProviderTargets = computed(() => {
  const groups = []
  const byProvider = new Map()

  for (const option of providerTargets.value) {
    const groupKey = option.providerLabel || option.providerId || '其他'
    if (!byProvider.has(groupKey)) {
      const group = {
        key: groupKey,
        label: option.providerLabel || groupKey,
        options: []
      }
      byProvider.set(groupKey, group)
      groups.push(group)
    }
    byProvider.get(groupKey).options.push(option)
  }

  return groups
})

const availableModelCards = computed(() => {
  if (!selectedModelId.value) return []
  const model = systemModels.value.find(item => item.id === selectedModelId.value)
  return model?.modelCards || []
})

const basePromptIds = computed(() => {
  return systemPrompts.value.filter(prompt => prompt.isBase === true).map(prompt => prompt.id)
})

const baseDocumentIds = computed(() => {
  return systemDocuments.value.filter(doc => doc.isBase !== false).map(doc => doc.id)
})

const systemPromptsSummary = computed(() => summarizeNames(systemPrompts.value.filter(prompt => prompt.isBase === true)))
const projectPromptsSummary = computed(() => summarizePromptSummary(projectConfig.value?.settings || {}, 'project'))
const systemDocumentsSummary = computed(() => summarizeNames(systemDocuments.value.filter(doc => doc.isBase !== false)))
const projectDocumentsSummary = computed(() => summarizeDocumentSummary(projectConfig.value?.settings || {}, 'project'))
const projectPromptSummary = computed(() => {
  const settings = projectConfig.value?.settings || {}
  if (!settings.projectPromptEnabled) return '未启用'
  const text = settings.projectPromptText || ''
  if (!text.trim()) return '未填写'
  const firstLine = text.trim().split('\n')[0]
  return firstLine.length > 20 ? firstLine.slice(0, 20) + '...' : firstLine
})
const projectThemeSummary = computed(() => {
  const settings = projectConfig.value?.settings || {}
  const mode = settings.chatMessageThemeMode || 'app'
  const preset = settings.chatMessageThemePreset || 'classic'
  if (mode === 'app') return `系统 · ${getChatMessageThemePresetLabel(preset)}`
  if (mode === 'project') return '项目'
  return getChatMessageThemePresetLabel(preset)
})

async function loadSystemConfig(provider = selectedTool.value) {
  try {
    const result = await window.electronAPI.getAppConfig()
    if (result?.success) {
      const config = result.config || {}
      appConfig.value = config
      systemPrompts.value = config.settings?.prompts || []
      systemDocuments.value = config.documents || []
      if (provider === selectedTool.value) {
        systemModels.value = getProviderModels(config, provider)
      }
    }

    modelSummary.value = {
      systemSummary: null,
      projectSummary: null
    }

    const [targetResult, projectConfigResult, codexSettingsResult] = await Promise.all([
      window.electronAPI.getAvailableTargets({
        projectId: props.projectId,
        provider
      }),
      window.electronAPI.getProjectConfig({ projectId: props.projectId }),
      window.electronAPI.getCodexSettings()
    ])
    if (provider === selectedTool.value) {
      providerTargets.value = targetResult?.success
        ? (Array.isArray(targetResult.options) ? targetResult.options : [])
        : []
    }
    projectConfig.value = projectConfigResult?.config || null
    if (codexSettingsResult?.success && codexSettingsResult.settings) {
      codexRuntimeSettings.value = {
        authMode: codexSettingsResult.settings.authMode || 'provider',
        model: codexSettingsResult.settings.model || '',
        modelProvider: codexSettingsResult.settings.modelProvider || '',
        activeAccountId: codexSettingsResult.settings.activeAccountId || null,
        activeAccountName: codexSettingsResult.settings.activeAccountName || ''
      }
    }

    const summaryResult = await window.electronAPI.getModelConfigSummary({
      provider,
      projectId: props.projectId
    })
    if (provider === selectedTool.value && summaryResult?.success) {
      modelSummary.value = {
        systemSummary: summaryResult.systemSummary || null,
        projectSummary: summaryResult.projectSummary || null
      }
    }
  } catch (e) {
    console.error('Failed to load system config:', e)
  }
}

function onModelChange() {
  modelCardMode.value = 'default'
  const model = systemModels.value.find(item => item.id === selectedModelId.value)
  if (model?.modelCards?.length > 0) {
    const defaultCard = model.modelCards.find(card => card.id === model.defaultCardId)
    selectedModelCardId.value = defaultCard?.id || model.modelCards[0].id
  } else {
    selectedModelCardId.value = null
  }
}

function syncSelectedTarget(optionId) {
  selectedTargetId.value = optionId || null
  const option = providerTargets.value.find(item => item.id === optionId) || null
  selectedModelId.value = option?.modelId || null
  selectedCredentialId.value = option?.credentialId || null
  selectedTargetKind.value = option?.targetKind || 'provider'
  onModelChange()
}

function getSelectedTargetLabel() {
  const option = providerTargets.value.find(item => item.id === selectedTargetId.value) || null
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

function summarizeNames(items = [], fallback = '未配置') {
  if (!Array.isArray(items) || items.length === 0) return fallback
  const names = items.map(item => item?.name).filter(Boolean)
  if (!names.length) return fallback
  return names.length <= 3 ? names.join('、') : `${names.slice(0, 3).join('、')} 等 ${names.length} 项`
}

function summarizePromptSummary(settings = {}, mode = 'project') {
  if (mode === 'system') return systemPromptsSummary.value
  const savedPromptMode = settings.promptMode || (Array.isArray(settings.promptIds) ? (settings.promptIds.length > 0 ? 'custom' : 'none') : 'system')
  if (savedPromptMode === 'custom') {
    const selected = systemPrompts.value.filter(prompt => (settings.promptIds || []).includes(prompt.id))
    return summarizeNames(selected)
  }
  if (savedPromptMode === 'none') return '不使用'
  return systemPromptsSummary.value
}

function summarizeDocumentSummary(settings = {}, mode = 'project') {
  if (mode === 'system') return systemDocumentsSummary.value
  const savedMode = settings.documentMode || (Array.isArray(settings.documentIds) ? (settings.documentIds.length > 0 ? 'custom' : 'none') : 'system')
  if (savedMode === 'custom') {
    const selected = systemDocuments.value.filter(doc => (settings.documentIds || []).includes(doc.id))
    return summarizeNames(selected)
  }
  if (savedMode === 'none') return '不使用'
  return systemDocumentsSummary.value
}

function getDefaultModelCardName() {
  const model = systemModels.value.find(item => item.id === selectedModelId.value)
  if (!model?.modelCards?.length) return '无可用模型'
  const defaultCard = model.modelCards.find(card => card.id === model.defaultCardId)
  const card = defaultCard || model.modelCards[0]
  return card?.modelName || card?.id || '默认模型'
}

function getSystemModelSummary() {
  return modelSummary.value.systemSummary || ''
}

function getProjectModelSummary() {
  return modelSummary.value.projectSummary || ''
}

function togglePrompt(promptId) {
  const index = selectedPromptIds.value.indexOf(promptId)
  if (index === -1) {
    selectedPromptIds.value.push(promptId)
  } else {
    selectedPromptIds.value.splice(index, 1)
  }
}

function toggleDocument(docId) {
  const index = selectedDocumentIds.value.indexOf(docId)
  if (index === -1) {
    selectedDocumentIds.value.push(docId)
  } else {
    selectedDocumentIds.value.splice(index, 1)
  }
}

async function handleCreate() {
  if (!props.projectId) {
    error.value = '未选择项目'
    return
  }

  if (!selectedTool.value) {
    error.value = '请选择工具'
    return
  }

  isCreating.value = true
  error.value = ''

  try {
    const settings = {
      tool: selectedTool.value,
      modelMode: modelMode.value,
      modelId: modelMode.value === 'custom' ? selectedModelId.value : null,
      credentialId: modelMode.value === 'custom' ? selectedCredentialId.value : null,
      targetKind: modelMode.value === 'custom' ? selectedTargetKind.value : null,
      modelCardId: modelMode.value === 'custom' && modelCardMode.value === 'custom' ? selectedModelCardId.value : null,
      promptMode: promptsMode.value,
      promptIds: promptsMode.value === 'custom' ? [...selectedPromptIds.value] : [],
      documentMode: documentsMode.value,
      documentIds: documentsMode.value === 'custom' ? [...selectedDocumentIds.value] : [],
      projectPromptMode: projectPromptMode.value,
      projectPromptText: projectPromptMode.value === 'custom' ? projectPromptText.value : ''
    }

    const newSession = await store.createSession(props.projectId, sessionName.value.trim() || null, { settings })
    // Auto-select the new session
    await store.selectSession(newSession)
    emit('created', newSession)
  } catch (e) {
    error.value = e.message || '创建会话失败'
  } finally {
    isCreating.value = false
  }
}

watch(modelMode, (newValue) => {
  if (newValue === 'custom' && providerTargets.value.length > 0) {
    if (!selectedTargetId.value) {
      syncSelectedTarget(providerTargets.value[0].id)
    }
  } else if (newValue !== 'custom') {
    selectedTargetId.value = null
    selectedModelId.value = null
    selectedCredentialId.value = null
    selectedTargetKind.value = 'provider'
    selectedModelCardId.value = null
  }
})

watch(selectedTool, async () => {
  await loadSystemConfig()
  if (modelMode.value === 'custom') {
    const firstTarget = providerTargets.value[0] || null
    syncSelectedTarget(firstTarget?.id || null)
  } else {
    selectedTargetId.value = null
    selectedModelId.value = null
    selectedCredentialId.value = null
    selectedTargetKind.value = 'provider'
    selectedModelCardId.value = null
  }
})

watch(promptsMode, (newValue) => {
  if (newValue === 'custom') {
    if (selectedPromptIds.value.length === 0) {
      selectedPromptIds.value = [...basePromptIds.value]
    }
  } else {
    selectedPromptIds.value = []
  }
})

watch(documentsMode, (newValue) => {
  if (newValue === 'custom') {
    if (selectedDocumentIds.value.length === 0) {
      selectedDocumentIds.value = [...baseDocumentIds.value]
    }
  } else {
    selectedDocumentIds.value = []
  }
})

onMounted(() => {
  loadSystemConfig()
})
</script>

<template>
  <div class="dialog-overlay">
    <div class="dialog">
      <div class="dialog-header">
        <h3>新建会话</h3>
        <button class="close-btn" @click="emit('close')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <div class="form-group">
          <label>会话名称 (可选)</label>
          <input
            v-model="sessionName"
            type="text"
            placeholder="留空则自动生成"
            @keyup.enter="handleEnterKey"
          />
        </div>

        <div class="form-group">
          <label>工具</label>
          <div class="tool-segment" role="tablist" aria-label="选择工具">
            <button
              type="button"
              class="segment-btn"
              :class="{ active: selectedTool === 'claude' }"
              @click="selectedTool = 'claude'"
            >
              Claude
            </button>
            <button
              type="button"
              class="segment-btn"
              :class="{ active: selectedTool === 'codex' }"
              @click="selectedTool = 'codex'"
            >
              Codex
            </button>
          </div>
        </div>

        <div class="advanced-section">
          <button
            type="button"
            class="advanced-toggle"
            :class="{ expanded: showAdvanced }"
            @click="showAdvanced = !showAdvanced"
          >
            <span class="advanced-toggle-icon" aria-hidden="true"></span>
            <span>高级配置</span>
          </button>

          <div v-if="showAdvanced" class="advanced-panel">
            <div class="config-section">
              <label class="config-label">
                模型
                <span v-if="modelMode === 'system'" class="current-config-hint">- {{ getSystemModelSummary() }}</span>
                <span v-else-if="modelMode === 'project'" class="current-config-hint">- {{ getProjectModelSummary() }}</span>
              </label>
              <div class="radio-group">
                <label class="radio-item">
                  <input type="radio" v-model="modelMode" value="system" />
                  <span>系统</span>
                </label>
                <label class="radio-item">
                  <input type="radio" v-model="modelMode" value="project" />
                  <span>项目</span>
                </label>
                <label class="radio-item">
                  <input type="radio" v-model="modelMode" value="custom" />
                  <span>自定义</span>
                </label>
              </div>
              <div v-if="modelMode === 'custom'" class="config-content">
                <div class="select-row">
                  <AppSelect
                    v-model="selectedTargetId"
                    class="select-input"
                    full-width
                    placeholder="-- 选择供应商与令牌 --"
                    :groups="mapTargetGroups(groupedProviderTargets)"
                    :selected-label="getSelectedTargetLabel()"
                    @change="syncSelectedTarget($event?.value || null)"
                  />
                </div>
                <div v-if="selectedModelId && availableModelCards.length > 0" class="model-cards-wrapper">
                  <div class="cards-header">
                    <span class="cards-label">模型</span>
                    <div class="segment-control">
                      <button
                        type="button"
                        class="sub-segment-btn"
                        :class="{ active: modelCardMode === 'default' }"
                        @click="modelCardMode = 'default'"
                      >
                        默认
                      </button>
                      <button
                        type="button"
                        class="sub-segment-btn"
                        :class="{ active: modelCardMode === 'custom' }"
                        @click="modelCardMode = 'custom'"
                      >
                        自选
                      </button>
                    </div>
                  </div>
                  <div v-if="modelCardMode === 'custom'" class="model-cards-list">
                    <button
                      v-for="card in availableModelCards"
                      :key="card.id"
                      type="button"
                      class="model-card-badge"
                      :class="{ active: selectedModelCardId === card.id }"
                      @click="selectedModelCardId = card.id"
                    >
                      {{ card.modelName || card.id }}
                    </button>
                  </div>
                  <div v-else class="default-card-hint">
                    {{ getDefaultModelCardName() }}
                  </div>
                </div>
                <p v-if="availableModels.length === 0" class="empty-hint">
                  暂无可用模型供应商，请先在设置中添加并激活模型供应商
                </p>
              </div>
            </div>

            <div class="config-section">
              <label class="config-label">
                提示词
                <span v-if="promptsMode === 'system'" class="current-config-hint">- {{ systemPromptsSummary }}</span>
                <span v-else-if="promptsMode === 'project'" class="current-config-hint">- {{ projectPromptsSummary }}</span>
              </label>
              <div class="radio-group">
                <label class="radio-item">
                  <input type="radio" v-model="promptsMode" value="system" />
                  <span>系统</span>
                </label>
                <label class="radio-item">
                  <input type="radio" v-model="promptsMode" value="project" />
                  <span>项目</span>
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

            <div class="config-section">
              <label class="config-label">
                规范文档
                <span v-if="documentsMode === 'system'" class="current-config-hint">- {{ systemDocumentsSummary }}</span>
                <span v-else-if="documentsMode === 'project'" class="current-config-hint">- {{ projectDocumentsSummary }}</span>
              </label>
              <div class="radio-group">
                <label class="radio-item">
                  <input type="radio" v-model="documentsMode" value="system" />
                  <span>系统</span>
                </label>
                <label class="radio-item">
                  <input type="radio" v-model="documentsMode" value="project" />
                  <span>项目</span>
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
                项目说明
                <span v-if="projectPromptMode === 'project'" class="current-config-hint">- {{ projectPromptSummary }}</span>
              </label>
              <div class="radio-group">
                <label class="radio-item">
                  <input type="radio" v-model="projectPromptMode" value="project" />
                  <span>项目</span>
                </label>
                <label class="radio-item">
                  <input type="radio" v-model="projectPromptMode" value="custom" />
                  <span>自定义</span>
                </label>
                <label class="radio-item">
                  <input type="radio" v-model="projectPromptMode" value="none" />
                  <span>不使用</span>
                </label>
              </div>
              <div v-if="projectPromptMode === 'custom'" class="config-content">
                <textarea
                  v-model="projectPromptText"
                  class="project-prompt-textarea"
                  placeholder="输入自定义项目说明..."
                  rows="4"
                ></textarea>
              </div>
            </div>
          </div>
        </div>

        <p v-if="error" class="error-message">{{ error }}</p>

        <p class="hint">
          新会话将在当前项目下创建，并使用 {{ selectedToolLabel }}
        </p>
      </div>

      <div class="dialog-footer">
        <button class="btn btn-cancel" @click="emit('close')">
          取消
        </button>
        <button
          class="btn btn-confirm"
          :disabled="isCreating || !selectedTool"
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

.form-group {
  margin-bottom: 16px;
}

.form-group label {
  display: block;
  font-size: 13px;
  color: #9CA3AF;
  margin-bottom: 8px;
}

.form-group input {
  width: 100%;
  padding: 10px 12px;
  background: #1E1E1E;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  color: #E5E7EB;
  font-size: 13px;
  box-sizing: border-box;
}

.form-group input:focus {
  outline: none;
  border-color: #F97316;
}

.tool-segment {
  display: flex;
  padding: 4px;
  background: #1E1E1E;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  gap: 4px;
}

.advanced-section {
  margin-bottom: 16px;
}

.advanced-toggle {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  background: transparent;
  border: none;
  color: #A1A1AA;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.advanced-toggle:hover {
  color: #E4E4E7;
}

.advanced-toggle-icon {
  width: 0;
  height: 0;
  border-top: 5px solid transparent;
  border-bottom: 5px solid transparent;
  border-left: 6px solid currentColor;
  transition: transform 0.2s;
}

.advanced-toggle.expanded .advanced-toggle-icon {
  transform: rotate(90deg);
}

.advanced-panel {
  margin-top: 12px;
  padding: 16px;
  background: #242427;
  border: 1px solid #3F3F46;
  border-radius: 10px;
}

.config-section {
  margin-bottom: 20px;
}

.config-section:last-child {
  margin-bottom: 0;
}

.config-label {
  display: block;
  font-size: 13px;
  color: #D1D5DB;
  margin-bottom: 8px;
  font-weight: 500;
}

.current-config-hint {
  margin-left: 6px;
  font-size: 12px;
  font-weight: 400;
  color: #6B7280;
}

.radio-group {
  display: flex;
  gap: 16px;
  margin-bottom: 8px;
  flex-wrap: wrap;
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
  width: auto;
  margin: 0;
  accent-color: #F97316;
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

.select-row {
  display: flex;
}

.select-input {
  width: 100%;
  box-sizing: border-box;
}

.model-cards-wrapper {
  margin-top: 12px;
}

.cards-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  gap: 12px;
}

.cards-label {
  font-size: 12px;
  color: #9CA3AF;
}

.segment-control {
  display: inline-flex;
  gap: 4px;
  padding: 3px;
  background: #111113;
  border: 1px solid #3F3F46;
  border-radius: 8px;
}

.sub-segment-btn {
  padding: 6px 10px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: #A1A1AA;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.sub-segment-btn.active {
  background: rgba(249, 115, 22, 0.16);
  color: #FED7AA;
}

.model-cards-list {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.model-card-badge {
  padding: 6px 10px;
  border-radius: 999px;
  border: 1px solid #3F3F46;
  background: #111113;
  color: #A1A1AA;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.model-card-badge.active {
  border-color: rgba(249, 115, 22, 0.4);
  background: rgba(249, 115, 22, 0.16);
  color: #FED7AA;
}

.default-card-hint,
.empty-hint {
  margin: 8px 0 0;
  font-size: 12px;
  color: #6B7280;
}

.checkbox-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.checkbox-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  color: #D4D4D8;
  font-size: 13px;
  cursor: pointer;
}

.checkbox-item input {
  width: auto;
  margin: 2px 0 0;
  accent-color: #F97316;
}

.checkbox-label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.badge-base {
  display: inline-flex;
  align-items: center;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(249, 115, 22, 0.14);
  color: #FED7AA;
  font-size: 11px;
  font-weight: 600;
}

.item-description {
  display: block;
  margin-top: 2px;
  color: #71717A;
  font-size: 12px;
}

.segment-btn {
  flex: 1;
  padding: 10px 14px;
  background: transparent;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  color: #A1A1AA;
  cursor: pointer;
  transition: all 0.2s;
}

.segment-btn:hover {
  color: #E4E4E7;
  background: rgba(255, 255, 255, 0.04);
}

.segment-btn.active {
  background: #F97316;
  color: white;
  box-shadow: 0 1px 0 rgba(0, 0, 0, 0.15);
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

.project-prompt-textarea {
  width: 100%;
  min-height: 100px;
  padding: 10px 12px;
  background: transparent;
  border: none;
  color: #E5E7EB;
  font-size: 13px;
  line-height: 1.5;
  resize: vertical;
  font-family: inherit;
  box-sizing: border-box;
}

.project-prompt-textarea:focus {
  outline: none;
}

.project-prompt-textarea::placeholder {
  color: #71717A;
}
</style>
