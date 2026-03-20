<script setup>
import { ref, watch } from 'vue'

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

const formData = ref({
  apiUrl: '',
  authToken: '',
  model: '',
  modelReasoningEffort: 'medium',
  proxyUrl: ''
})

const showAuthToken = ref(false)

function syncFormData() {
  formData.value = {
    apiUrl: props.config?.apiUrl || '',
    authToken: props.config?.authToken || '',
    model: props.config?.model || '',
    modelReasoningEffort: props.config?.modelReasoningEffort || 'medium',
    proxyUrl: props.config?.proxyUrl || ''
  }
}

watch(() => props.visible, (visible) => {
  if (visible) {
    syncFormData()
  }
})

watch(() => props.config, syncFormData, { immediate: true, deep: true })

function handleClose() {
  emit('update:visible', false)
  emit('close')
}

function handleSave() {
  emit('save', { ...formData.value })
  handleClose()
}
</script>

<template>
  <div v-if="visible" class="dialog-overlay" @click="handleClose">
    <div class="codex-config-dialog" @click.stop>
      <div class="dialog-header">
        <h2>编辑 Codex 配置</h2>
        <button class="close-btn" @click="handleClose" title="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <div class="form-item">
          <label class="form-label">API地址</label>
          <input
            v-model="formData.apiUrl"
            type="text"
            class="form-input"
            placeholder="例如: https://api2.codexcn.com/v1"
          >
        </div>

        <div class="form-item">
          <label class="form-label">认证令牌</label>
          <div class="input-with-action">
            <input
              :type="showAuthToken ? 'text' : 'password'"
              v-model="formData.authToken"
              class="form-input"
              placeholder="例如: sk-..."
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
          <label class="form-label">默认模型</label>
          <input
            v-model="formData.model"
            type="text"
            class="form-input"
            placeholder="例如: gpt-5.4"
          >
        </div>

        <div class="form-item">
          <label class="form-label">思考力度</label>
          <select v-model="formData.modelReasoningEffort" class="form-select">
            <option v-for="option in effortOptions" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div class="form-item">
          <label class="form-label">代理</label>
          <input
            v-model="formData.proxyUrl"
            type="text"
            class="form-input"
            placeholder="例如: http://127.0.0.1:7890 或 socks5://127.0.0.1:7891"
          >
        </div>
      </div>

      <div class="dialog-footer">
        <button class="btn btn-secondary" @click="handleClose">取消</button>
        <button class="btn btn-primary" @click="handleSave">保存</button>
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

.codex-config-dialog {
  background: #1F1F23;
  border-radius: 12px;
  width: 520px;
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

.label-hint {
  font-weight: 400;
  color: #71717A;
  font-size: 12px;
}

.form-input,
.form-select {
  width: 100%;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  padding: 10px 12px;
  color: #F4F4F5;
  font-size: 14px;
  box-sizing: border-box;
}

.form-input:focus,
.form-select:focus {
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

.btn-small {
  padding: 8px 12px;
  font-size: 12px;
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

.btn-secondary {
  background: #3F3F46;
  color: #F4F4F5;
}

.btn-secondary:hover {
  background: #52525B;
}

.btn-primary {
  background: #F97316;
  color: white;
}

.btn-primary:hover {
  background: #EA580C;
}
</style>
