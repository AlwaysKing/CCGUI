<script setup>
/**
 * PromptEditDialog - 提示词编辑对话框
 */
import { ref, watch, computed } from 'vue'
import { useDialogStack } from '../../../../composables/useDialogStack'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  prompt: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['update:visible', 'save', 'close'])

// 表单数据
const formData = ref({
  name: '',
  description: '',
  content: '',
  isBase: false
})

// 状态
const loading = ref(false)

// 是否编辑模式
const isEditing = computed(() => !!props.prompt)

// 监听 prompt 变化
watch(() => props.prompt, (prompt) => {
  if (prompt) {
    formData.value = {
      name: prompt.name || '',
      description: prompt.description || '',
      content: prompt.content || '',
      isBase: prompt.isBase || false
    }
  } else {
    formData.value = {
      name: '',
      description: '',
      content: '',
      isBase: false
    }
  }
}, { immediate: true })

// 关闭对话框
function handleClose() {
  emit('update:visible', false)
  emit('close')
}

useDialogStack(computed(() => props.visible), handleClose)

// 保存
function handleSave() {
  if (!formData.value.name || !formData.value.content) {
    alert('请填写必填项：名称和内容')
    return
  }

  emit('save', {
    ...formData.value,
    id: props.prompt?.id || Date.now().toString()
  })
  handleClose()
}
</script>

<template>
  <div v-if="visible" class="dialog-overlay">
    <div class="prompt-dialog" @click.stop>
      <div class="dialog-header">
        <h2>{{ isEditing ? '编辑提示词' : '添加提示词' }}</h2>
        <button class="close-btn" @click="handleClose" title="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <!-- 名称 -->
        <div class="form-item">
          <label class="form-label">
            名称 <span class="required">*</span>
          </label>
          <input
            type="text"
            v-model="formData.name"
            class="form-input"
            placeholder="例如: 代码审查助手"
          >
        </div>

        <!-- 描述 -->
        <div class="form-item">
          <label class="form-label">
            描述
            <span class="label-hint">可选，简短描述这个提示词的用途</span>
          </label>
          <input
            type="text"
            v-model="formData.description"
            class="form-input"
            placeholder="例如: 帮助审查代码并提供改进建议"
          >
        </div>

        <!-- 内容 -->
        <div class="form-item">
          <label class="form-label">
            内容 <span class="required">*</span>
            <span class="label-hint">提示词的完整内容</span>
          </label>
          <textarea
            v-model="formData.content"
            class="form-textarea"
            placeholder="输入提示词内容..."
            rows="10"
          ></textarea>
        </div>

        <!-- 基础状态 -->
        <div class="form-item">
          <label class="form-checkbox">
            <input type="checkbox" v-model="formData.isBase">
            <span>设为基础提示词</span>
          </label>
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

.prompt-dialog {
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

.form-textarea {
  width: 100%;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  padding: 12px;
  color: #F4F4F5;
  font-size: 14px;
  font-family: inherit;
  resize: vertical;
  min-height: 200px;
}

.form-textarea:focus {
  outline: none;
  border-color: #F97316;
}

.form-checkbox {
  display: flex;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 14px;
  color: #D1D5DB;
}

.form-checkbox input {
  width: 16px;
  height: 16px;
  cursor: pointer;
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
