<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useAppStore } from '../../../stores/useAppStore'
import { getProviderModels } from '../../../utils/provider-models'

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
const modelMode = ref('system')
const modelCardMode = ref('default') // 'default' = 使用默认, 'custom' = 自选
const promptsMode = ref('system')
const documentsMode = ref('system')

// 选择的配置
const selectedModelId = ref(null)
const selectedModelCardId = ref(null)
const selectedPromptIds = ref([])
const selectedDocumentIds = ref([])

// 系统配置数据
const systemModels = ref([])
const systemPrompts = ref([])
const systemDocuments = ref([])

const emit = defineEmits(['close', 'created'])

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

// 加载系统配置
async function loadSystemConfig() {
  try {
    const result = await window.electronAPI.getAppConfig()
    if (result && result.success) {
      const config = result.config
      if (config.settings) {
        systemModels.value = getProviderModels(config, 'claude')
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

// 模型配置切换时，重置子模型选择并选择默认卡片
function onModelChange() {
  modelCardMode.value = 'default'
  const model = systemModels.value.find(m => m.id === selectedModelId.value)
  if (model?.modelCards?.length > 0) {
    // 优先选择默认卡片，否则选择第一个
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

// 子模型模式切换
function onModelCardModeChange() {
  if (modelCardMode.value === 'custom') {
    // 切换到自选时，保持当前选中的卡片
    const model = systemModels.value.find(m => m.id === selectedModelId.value)
    if (model?.modelCards?.length > 0 && !selectedModelCardId.value) {
      const defaultCard = model.modelCards.find(c => c.id === model.defaultCardId)
      selectedModelCardId.value = defaultCard?.id || model.modelCards[0].id
    }
  }
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
      modelMode: modelMode.value,
      modelId: modelMode.value === 'custom' ? selectedModelId.value : null,
      modelCardId: modelMode.value === 'custom' && modelCardMode.value === 'custom' ? selectedModelCardId.value : null,
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

// 监听模式变化，初始化选择
watch(modelMode, (newVal) => {
  if (newVal === 'custom' && availableModels.value.length > 0) {
    selectedModelId.value = availableModels.value[0].id
    // 触发子模型选择
    onModelChange()
  } else {
    selectedModelId.value = null
    selectedModelCardId.value = null
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
  <div class="dialog-overlay" @click.self="emit('close')">
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

          <!-- 模型选择 -->
          <div class="config-section">
            <label class="config-label">模型</label>
            <div class="radio-group">
              <label class="radio-item">
                <input type="radio" v-model="modelMode" value="system" />
                <span>系统</span>
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
  padding: 10px 16px;
  background: #374151;
  border: 1px solid #4B5563;
  border-radius: 6px;
  color: #D1D5DB;
  font-size: 13px;
  cursor: pointer;
  white-space: nowrap;
}

.browse-btn:hover {
  background: #4B5563;
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
