<script setup>
import { ref } from 'vue'
import { useAppStore } from '../../../stores/useAppStore'

const store = useAppStore()

const props = defineProps({
  projectId: {
    type: String,
    required: true
  }
})

const sessionName = ref('')
const isCreating = ref(false)
const error = ref('')

const emit = defineEmits(['close', 'created'])

async function handleCreate() {
  if (!props.projectId) {
    error.value = '未选择项目'
    return
  }

  isCreating.value = true
  error.value = ''

  try {
    const newSession = await store.createSession(props.projectId, sessionName.value.trim() || null)
    // Auto-select the new session
    await store.selectSession(newSession)
    emit('created', newSession)
  } catch (e) {
    error.value = e.message || '创建会话失败'
  } finally {
    isCreating.value = false
  }
}
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
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
            @keyup.enter="handleCreate"
          />
        </div>

        <p v-if="error" class="error-message">{{ error }}</p>

        <p class="hint">
          新会话将在当前项目下创建
        </p>
      </div>

      <div class="dialog-footer">
        <button class="btn btn-cancel" @click="emit('close')">
          取消
        </button>
        <button
          class="btn btn-confirm"
          :disabled="isCreating"
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
  min-width: 360px;
  max-width: 440px;
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
