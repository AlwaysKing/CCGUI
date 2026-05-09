<script setup>
/**
 * DefaultConfigDialog - 默认配置编辑对话框
 */
import { ref, watch, computed } from 'vue'
import { useDialogStack } from '../../../../composables/useDialogStack'
import AppSelect from '@/components/base/AppSelect.vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  config: {
    type: Object,
    default: () => ({})
  },
  effortOptions: {
    type: Array,
    default: () => [
      { value: 'default', label: '默认' },
      { value: 'low', label: '低' },
      { value: 'medium', label: '中' },
      { value: 'high', label: '高' }
    ]
  }
})

const emit = defineEmits(['update:visible', 'save', 'close'])

// 表单数据
const formData = ref({
  apiUrl: '',
  authToken: '',
  anthropicModel: '',
  effort: 'default',
  maxThinkingTokens: 10240,
  thinkingEnabled: true,
  anthropicDefaultSonnetModel: '',
  anthropicDefaultOpusModel: '',
  anthropicDefaultHaikuModel: '',
  anthropicSmallFastModel: ''
})

// 状态
const showAuthToken = ref(false)
const loading = ref(false)

// 同步表单数据
function syncFormData() {
  if (props.config) {
    formData.value = {
      apiUrl: props.config.apiUrl || '',
      authToken: props.config.authToken || '',
      anthropicModel: props.config.anthropicModel || '',
      effort: props.config.effort || 'default',
      maxThinkingTokens: props.config.maxThinkingTokens ?? 10240,
      thinkingEnabled: props.config.thinkingEnabled !== undefined ? props.config.thinkingEnabled : true,
      anthropicDefaultSonnetModel: props.config.anthropicDefaultSonnetModel || '',
      anthropicDefaultOpusModel: props.config.anthropicDefaultOpusModel || '',
      anthropicDefaultHaikuModel: props.config.anthropicDefaultHaikuModel || '',
      anthropicSmallFastModel: props.config.anthropicSmallFastModel || ''
    }
  }
}

// 监听 visible 变化，对话框打开时同步数据
watch(() => props.visible, (visible) => {
  if (visible) {
    syncFormData()
  }
})

// 监听 config 变化
watch(() => props.config, syncFormData, { immediate: true, deep: true })

// 关闭对话框
function handleClose() {
  emit('update:visible', false)
  emit('close')
}

useDialogStack(computed(() => props.visible), handleClose)

// 保存
function handleSave() {
  if (!formData.value.apiUrl) {
    alert('请填写 API 地址')
    return
  }

  emit('save', { ...formData.value })
  handleClose()
}
</script>

<template>
  <div v-if="visible" class="dialog-overlay">
    <div class="default-config-dialog" @click.stop>
      <div class="dialog-header">
        <h2>编辑默认配置</h2>
        <button class="close-btn" @click="handleClose" title="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <!-- API 地址 -->
        <div class="form-item">
          <label class="form-label">
            API地址 (ANTHROPIC_BASE_URL) <span class="required">*</span>
            <span class="label-hint">API 端点地址</span>
          </label>
          <input
            type="text"
            v-model="formData.apiUrl"
            class="form-input"
            placeholder="例如: https://api.anthropic.com"
          >
        </div>

        <!-- 认证令牌 -->
        <div class="form-item">
          <label class="form-label">
            认证令牌 (ANTHROPIC_AUTH_TOKEN) <span class="required">*</span>
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

        <!-- 模型选择 -->
        <div class="form-item">
          <label class="form-label">
            默认模型
            <span class="label-hint">通用模型配置</span>
          </label>
          <input
            type="text"
            v-model="formData.anthropicModel"
            class="form-input"
            placeholder="例如: claude-sonnet-4-6"
          >
        </div>

        <!-- 思考力度 -->
        <div class="form-item">
          <label class="form-label">
            思考力度
            <span class="label-hint">控制模型的思考力度</span>
          </label>
          <AppSelect
            v-model="formData.effort"
            class="form-select"
            full-width
            :options="effortOptions"
          />
        </div>

        <!-- 思考 -->
        <div class="form-item">
          <label class="form-label">
            思考
            <span class="label-hint">关闭后所有会话默认禁用思考，可通过会话工具栏单独开启</span>
          </label>
          <div class="thinking-row">
            <span class="thinking-row-label">开启:</span>
            <label class="toggle-switch">
              <input type="checkbox" v-model="formData.thinkingEnabled">
              <span class="toggle-slider"></span>
            </label>
            <span class="thinking-row-label thinking-limit-label">上限</span>
            <input
              type="number"
              v-model.number="formData.maxThinkingTokens"
              class="form-input thinking-input"
              min="0"
              max="30000"
              step="1024"
              placeholder="10240"
            >
          </div>
        </div>

        <!-- 模型映射 -->
        <div class="form-section">
          <div class="form-section-title">模型映射（高级）</div>
          <p class="form-section-desc">为不同场景指定特定模型</p>

          <div class="form-grid">
            <div class="form-item">
              <label class="form-label">SONNET</label>
              <input
                type="text"
                v-model="formData.anthropicDefaultSonnetModel"
                class="form-input"
                placeholder="claude-sonnet-4-6"
              >
            </div>

            <div class="form-item">
              <label class="form-label">OPUS</label>
              <input
                type="text"
                v-model="formData.anthropicDefaultOpusModel"
                class="form-input"
                placeholder="claude-opus-4-6"
              >
            </div>

            <div class="form-item">
              <label class="form-label">HAIKU</label>
              <input
                type="text"
                v-model="formData.anthropicDefaultHaikuModel"
                class="form-input"
                placeholder="claude-haiku-4-5"
              >
            </div>

            <div class="form-item">
              <label class="form-label">SMALL_FAST</label>
              <input
                type="text"
                v-model="formData.anthropicSmallFastModel"
                class="form-input"
                placeholder="claude-haiku-4-5"
              >
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

.default-config-dialog {
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

.form-input,
.form-select {
  width: 100%;
  box-sizing: border-box;
}

.form-input {
  appearance: none;
  min-height: 38px;
  padding: 8px 12px;
  border: 1px solid #52525B;
  border-radius: 6px;
  background: #27272A;
  color: #F4F4F5;
  font-size: 14px;
  line-height: 1.4;
}

.form-input::placeholder {
  color: #71717A;
}

.form-input:focus,
.form-select:focus {
  outline: none;
  border-color: #F97316;
}

.form-input:hover {
  border-color: #71717A;
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

.form-section {
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid #3F3F46;
}

.form-section-title {
  font-size: 15px;
  font-weight: 600;
  color: #D1D5DB;
  margin-bottom: 4px;
}

.form-section-desc {
  font-size: 12px;
  color: #71717A;
  margin: 0 0 16px;
}

.form-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.form-grid .form-item {
  margin-bottom: 0;
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

/* 开关切换 */
.toggle-switch {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  cursor: pointer;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
  position: absolute;
}

.toggle-slider {
  position: relative;
  width: 36px;
  height: 20px;
  background: #52525B;
  border-radius: 10px;
  transition: background 0.2s;
  flex-shrink: 0;
}

.toggle-slider::after {
  content: '';
  position: absolute;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: #F4F4F5;
  top: 2px;
  left: 2px;
  transition: transform 0.2s;
}

.toggle-switch input:checked + .toggle-slider {
  background: #F97316;
}

.toggle-switch input:checked + .toggle-slider::after {
  transform: translateX(16px);
}

.toggle-label {
  font-size: 13px;
  color: #A1A1AA;
}

/* 思考行布局 */
.thinking-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.thinking-row-label {
  font-size: 14px;
  color: #D1D5DB;
  white-space: nowrap;
}

.thinking-limit-label {
  margin-left: 4px;
}

.thinking-input {
  flex: 1;
  min-width: 0;
}

/* 隐藏 number input 的上下步进按钮 */
.thinking-input::-webkit-inner-spin-button,
.thinking-input::-webkit-outer-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
.thinking-input[type='number'] {
  -moz-appearance: textfield;
}
</style>
