<script setup>
import { ref, computed, onMounted, watch } from 'vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  projectId: {
    type: String,
    default: ''
  },
  sessionId: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['close', 'saved'])

// 配置选项
const modelMode = ref('project')
const modelCardMode = ref('default')
const promptsMode = ref('project')
const documentsMode = ref('project')

// 选择的配置
const selectedModelId = ref(null)
const selectedModelCardId = ref(null)
const selectedPromptIds = ref([])
const selectedDocumentIds = ref([])

// 系统配置数据
const systemModels = ref([])
const systemPrompts = ref([])
const systemDocuments = ref([])

// 状态
const loading = ref(false)
const saving = ref(false)

// 计算属性：可用的模型列表（已激活的）
const availableModels = computed(() => {
  return systemModels.value.filter(m => m.isActive !== false)
})

// 计算属性：选中模型的卡片列表
const availableModelCards = computed(() => {
  if (!selectedModelId.value) return []
  const model = systemModels.value.find(m => m.id === selectedModelId.value)
  return model?.modelCards || []
})

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

// 加载系统配置
async function loadSystemConfig() {
  try {
    const result = await window.electronAPI.getAppConfig()
    if (result && result.success) {
      const config = result.config
      if (config.settings) {
        systemModels.value = config.settings.models || []
        systemPrompts.value = config.settings.prompts || []
      }
      if (config.documents) {
        systemDocuments.value = config.documents
      }
    }
  } catch (e) {
    console.error('Failed to load system config:', e)
  }
}

// 加载会话配置
async function loadSessionConfig() {
  if (!props.projectId || !props.sessionId) return

  loading.value = true
  try {
    const result = await window.electronAPI.getSessionConfig({
      projectId: props.projectId,
      sessionId: props.sessionId
    })
    if (result && result.config && result.config.settings) {
      const settings = result.config.settings

      // 模型配置
      const savedModelMode = settings.modelMode || (settings.modelId === '' ? 'system' : (settings.modelId ? 'custom' : 'project'))
      if (savedModelMode === 'custom' && settings.modelId) {
        modelMode.value = 'custom'
        selectedModelId.value = settings.modelId
        if (settings.modelCardId) {
          modelCardMode.value = 'custom'
          selectedModelCardId.value = settings.modelCardId
        } else {
          modelCardMode.value = 'default'
        }
      } else {
        modelMode.value = savedModelMode
      }

      // 提示词配置
      const savedPromptMode = settings.promptMode || (
        Array.isArray(settings.promptIds) ? (settings.promptIds.length > 0 ? 'custom' : 'none') : 'project'
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
        Array.isArray(settings.documentIds) ? (settings.documentIds.length > 0 ? 'custom' : 'none') : 'project'
      )
      if (savedDocumentMode === 'custom') {
        documentsMode.value = 'custom'
        selectedDocumentIds.value = Array.isArray(settings.documentIds) ? [...settings.documentIds] : []
      } else {
        documentsMode.value = savedDocumentMode
        selectedDocumentIds.value = []
      }
    } else {
      // 没有会话配置，默认跟随项目
      modelMode.value = 'project'
      promptsMode.value = 'project'
      documentsMode.value = 'project'
    }
  } catch (e) {
    console.error('Failed to load session config:', e)
  } finally {
    loading.value = false
  }
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

// 模型配置切换时
function onModelChange() {
  modelCardMode.value = 'default'
  const model = systemModels.value.find(m => m.id === selectedModelId.value)
  if (model?.modelCards?.length > 0) {
    const defaultCard = model.modelCards.find(c => c.id === model.defaultCardId)
    selectedModelCardId.value = defaultCard?.id || model.modelCards[0].id
  } else {
    selectedModelCardId.value = null
  }
}

// 获取默认模型卡片名称
function getDefaultModelCardName() {
  const model = systemModels.value.find(m => m.id === selectedModelId.value)
  if (!model?.modelCards?.length) return '无可用模型'
  const defaultCard = model.modelCards.find(c => c.id === model.defaultCardId)
  const card = defaultCard || model.modelCards[0]
  return card?.modelName || card?.id || '默认模型'
}

// 保存配置
async function handleSave() {
  if (!props.projectId || !props.sessionId) return

  saving.value = true
  try {
    const settings = {
      modelMode: modelMode.value,
      modelId: modelMode.value === 'custom' ? selectedModelId.value : null,
      modelCardId: modelMode.value === 'custom' && modelCardMode.value === 'custom' ? selectedModelCardId.value : null,
      promptMode: promptsMode.value,
      promptIds: promptsMode.value === 'custom' ? [...selectedPromptIds.value] : [],
      documentMode: documentsMode.value,
      documentIds: documentsMode.value === 'custom' ? [...selectedDocumentIds.value] : []
    }

    await window.electronAPI.updateSessionConfig({
      projectId: props.projectId,
      sessionId: props.sessionId,
      updates: { settings }
    })

    emit('saved')
    emit('close')
  } catch (e) {
    console.error('Failed to save session config:', e)
    alert('保存配置失败: ' + e.message)
  } finally {
    saving.value = false
  }
}

// 监听可见性变化
watch(() => props.visible, (visible) => {
  if (visible) {
    loadSystemConfig()
    loadSessionConfig()
  }
})

// 监听模式变化
watch(modelMode, (newVal) => {
  if (newVal === 'custom' && availableModels.value.length > 0) {
    if (!selectedModelId.value) {
      selectedModelId.value = availableModels.value[0].id
      onModelChange()
    }
  } else if (newVal !== 'custom') {
    selectedModelId.value = null
    selectedModelCardId.value = null
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
    loadSessionConfig()
  }
})
</script>

<template>
  <div v-if="visible" class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog">
      <div class="dialog-header">
        <div class="header-content">
          <h3>会话配置</h3>
          <span class="session-hint">独立配置优先于项目配置</span>
        </div>
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
          <!-- 模型选择 -->
          <div class="config-section">
            <label class="config-label">模型</label>
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
            <div v-if="modelMode === 'custom'" class="model-select-wrapper">
              <div class="select-row">
                <select v-model="selectedModelId" class="select-input" @change="onModelChange">
                  <option value="" disabled>-- 选择模型配置 --</option>
                  <option v-for="model in availableModels" :key="model.id" :value="model.id">
                    {{ model.friendlyName || model.id }}
                  </option>
                </select>
              </div>
              <!-- 子模型选择 -->
              <div v-if="selectedModelId && availableModelCards.length > 0" class="model-cards-wrapper">
                <div class="cards-header">
                  <span class="cards-label">具体模型</span>
                  <div class="segment-control">
                    <button
                      type="button"
                      class="segment-btn"
                      :class="{ active: modelCardMode === 'default' }"
                      @click="modelCardMode = 'default'"
                    >
                      默认
                    </button>
                    <button
                      type="button"
                      class="segment-btn"
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
                暂无可用模型，请先在设置中添加并激活模型
              </p>
            </div>
          </div>

          <!-- 提示词选择 -->
          <div class="config-section">
            <label class="config-label">提示词</label>
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

          <!-- 规范文档选择 -->
          <div class="config-section">
            <label class="config-label">规范文档</label>
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

.header-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.dialog-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #E5E7EB;
}

.session-hint {
  font-size: 11px;
  color: #6B7280;
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
  padding: 8px 12px;
  background: #1E1E1E;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  color: #E5E7EB;
  font-size: 13px;
  cursor: pointer;
}

.select-input option {
  background: #1E1E1E;
  color: #E5E7EB;
  padding: 8px;
}

.select-input:focus {
  outline: none;
  border-color: #F97316;
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
