<script setup>
/**
 * ModelEditDialog - 模型编辑对话框
 */
import { ref, watch, computed } from 'vue'
import { useDialogStack } from '../../../../composables/useDialogStack'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  model: {
    type: Object,
    default: null
  },
  modelType: {
    type: String,
    default: 'claude' // 'claude' 或 'codex'
  }
})

const emit = defineEmits(['update:visible', 'save', 'close'])

// 表单数据
const formData = ref({
  friendlyName: '',
  apiUrl: '',
  authToken: '',
  defaultCardId: null,
  modelCards: []
})

// 状态
const showAuthToken = ref(false)
const hoveredCardId = ref(null)
const loading = ref(false)

// 是否编辑模式
const isEditing = computed(() => !!props.model)

// 对话框标题
const dialogTitle = computed(() => {
  const action = isEditing.value ? '编辑' : '添加'
  const type = props.modelType === 'claude' ? 'Claude' : 'Codex'
  return `${action}${type}模型`
})

// 生成卡片 ID
function generateCardId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9)
}

// 监听 model 变化，初始化表单
watch(() => props.model, (model) => {
  if (model) {
    // 编辑模式
    let modelCards = []
    if (model.modelCards && model.modelCards.length > 0) {
      modelCards = model.modelCards.map(card => ({
        id: card.id || generateCardId(),
        modelName: card.modelName || '',
        pricingCache: card.pricingCache || '',
        pricingInput: card.pricingInput || '',
        pricingOutput: card.pricingOutput || ''
      }))
    } else if (model.modelName) {
      modelCards = [{
        id: generateCardId(),
        modelName: model.modelName,
        pricingCache: model.pricingCache || '',
        pricingInput: model.pricingInput || '',
        pricingOutput: model.pricingOutput || ''
      }]
    } else {
      modelCards = [{ id: generateCardId(), modelName: '', pricingCache: '', pricingInput: '', pricingOutput: '' }]
    }

    formData.value = {
      friendlyName: model.friendlyName || '',
      apiUrl: model.apiUrl || model.baseUrl || '',
      authToken: model.authToken || '',
      defaultCardId: model.defaultCardId || modelCards[0]?.id || null,
      modelCards
    }
  } else {
    // 添加模式
    const firstCardId = generateCardId()
    formData.value = {
      friendlyName: '',
      apiUrl: '',
      authToken: '',
      defaultCardId: firstCardId,
      modelCards: [{ id: firstCardId, modelName: '', pricingCache: '', pricingInput: '', pricingOutput: '' }]
    }
  }
  showAuthToken.value = false
}, { immediate: true })

// 添加模型卡片
function addCard() {
  const newCardId = generateCardId()
  formData.value.modelCards.push({
    id: newCardId,
    modelName: '',
    pricingCache: '',
    pricingInput: '',
    pricingOutput: ''
  })
}

// 删除模型卡片
function removeCard(cardId) {
  if (formData.value.modelCards.length <= 1) return
  formData.value.modelCards = formData.value.modelCards.filter(c => c.id !== cardId)
  if (formData.value.defaultCardId === cardId) {
    formData.value.defaultCardId = formData.value.modelCards[0]?.id || null
  }
}

// 设置默认卡片
function setDefaultCard(cardId) {
  formData.value.defaultCardId = cardId
}

// 关闭对话框
function handleClose() {
  emit('update:visible', false)
  emit('close')
}

useDialogStack(computed(() => props.visible), handleClose)

// 保存
function handleSave() {
  if (!formData.value.friendlyName || !formData.value.apiUrl || !formData.value.authToken) {
    alert('请填写必填项：友好名称、API地址和认证令牌')
    return
  }

  emit('save', {
    ...formData.value,
    id: props.model?.id || Date.now().toString()
  })
  handleClose()
}
</script>

<template>
  <div v-if="visible" class="dialog-overlay">
    <div class="model-dialog" @click.stop>
      <div class="dialog-header">
        <h2>{{ dialogTitle }}</h2>
        <button class="close-btn" @click="handleClose" title="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <!-- 友好名称 -->
        <div class="form-item">
          <label class="form-label">
            友好名称 <span class="required">*</span>
            <span class="label-hint">显示名称，方便识别</span>
          </label>
          <input
            type="text"
            v-model="formData.friendlyName"
            class="form-input"
            placeholder="例如: Claude Sonnet 4.6"
          >
        </div>

        <!-- API 地址 -->
        <div class="form-item">
          <label class="form-label">
            API地址 <span class="required">*</span>
            <span class="label-hint">API 完整地址</span>
          </label>
          <input
            type="text"
            v-model="formData.apiUrl"
            class="form-input"
            :placeholder="modelType === 'claude' ? '例如: https://api.anthropic.com/v1/messages' : '例如: https://api.openai.com/v1'"
          >
        </div>

        <!-- 认证令牌 -->
        <div class="form-item">
          <label class="form-label">
            认证令牌 <span class="required">*</span>
            <span class="label-hint">API 认证密钥</span>
          </label>
          <div class="input-with-action">
            <input
              :type="showAuthToken ? 'text' : 'password'"
              v-model="formData.authToken"
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

        <!-- 模型卡片列表 -->
        <div class="model-cards-section">
          <div class="section-header-inline">
            <label class="form-label">模型名称与计费</label>
            <button type="button" class="btn-add-card-small" @click="addCard" title="添加模型">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
          </div>

          <div class="model-cards-list">
            <div
              v-for="(card, index) in formData.modelCards"
              :key="card.id"
              class="model-card-item"
              :class="{ 'is-default': formData.defaultCardId === card.id }"
              @mouseenter="hoveredCardId = card.id"
              @mouseleave="hoveredCardId = null"
            >
              <div class="card-header">
                <div class="card-title-area">
                  <span class="card-index">模型 {{ index + 1 }}</span>
                  <span v-if="formData.defaultCardId === card.id" class="default-badge">默认</span>
                  <button
                    v-else-if="hoveredCardId === card.id"
                    type="button"
                    class="btn-set-default"
                    @click="setDefaultCard(card.id)"
                  >
                    设为默认
                  </button>
                </div>

                <button
                  v-if="formData.modelCards.length > 1"
                  type="button"
                  class="btn-remove-card"
                  @click="removeCard(card.id)"
                  title="删除此模型"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
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
        <button class="btn btn-secondary" @click="handleClose">取消</button>
        <button class="btn btn-primary" @click="handleSave" :disabled="loading">
          {{ loading ? '保存中...' : '保存' }}
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
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}

.model-dialog {
  background: #1F1F23;
  border-radius: 12px;
  width: 600px;
  max-height: 85vh;
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
  overflow-y: auto;
  padding: 24px;
}

.form-item {
  margin-bottom: 20px;
}

.form-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #F4F4F5;
  margin-bottom: 8px;
}

.required {
  color: #EF4444;
}

.label-hint {
  font-weight: 400;
  color: #71717A;
  font-size: 12px;
}

.form-input {
  width: 100%;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  padding: 10px 12px;
  color: #F4F4F5;
  font-size: 14px;
}

.form-input:focus {
  outline: none;
  border-color: #F97316;
}

.input-with-action {
  display: flex;
  align-items: center;
  position: relative;
}

.input-with-action .form-input {
  padding-right: 44px;
}

.input-action-btn {
  position: absolute;
  right: 8px;
  background: transparent;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: #71717A;
}

.input-action-btn:hover {
  color: #9CA3AF;
}

.model-cards-section {
  margin-top: 24px;
}

.section-header-inline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.btn-add-card-small {
  background: transparent;
  border: 1px solid #3F3F46;
  border-radius: 4px;
  padding: 6px;
  cursor: pointer;
  color: #9CA3AF;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-add-card-small:hover {
  border-color: #F97316;
  color: #F97316;
}

.model-cards-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.model-card-item {
  background: #27272A;
  border: 2px solid #3F3F46;
  border-radius: 8px;
  padding: 16px;
}

.model-card-item.is-default {
  border-color: rgba(249, 115, 22, 0.3);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.card-title-area {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-index {
  font-size: 14px;
  font-weight: 500;
  color: #D1D5DB;
}

.default-badge {
  font-size: 11px;
  color: #F97316;
  background: rgba(249, 115, 22, 0.1);
  border: 1px solid rgba(249, 115, 22, 0.3);
  border-radius: 4px;
  padding: 1px 6px;
}

.btn-set-default {
  font-size: 11px;
  color: #6B7280;
  background: transparent;
  border: none;
  padding: 0 4px;
  cursor: pointer;
}

.btn-set-default:hover {
  color: #9CA3AF;
}

.btn-remove-card {
  background: transparent;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: #71717A;
}

.btn-remove-card:hover {
  color: #EF4444;
}

.card-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-pricing {
  display: flex;
  gap: 12px;
}

.pricing-field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pricing-label {
  font-size: 11px;
  color: #71717A;
}

.card-pricing .form-input {
  font-size: 13px;
  padding: 8px 10px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid #3F3F46;
}

.btn {
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: #3F3F46;
  color: #F4F4F5;
}

.btn-secondary:hover:not(:disabled) {
  background: #52525B;
}

.btn-primary {
  background: #F97316;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #EA580C;
}
</style>
