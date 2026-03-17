<script setup>
/**
 * BaseFormDialog - 表单对话框基础组件
 * 基于 BaseDialog，添加表单相关功能
 */
import { ref, watch } from 'vue'
import BaseDialog from '@/components/base/BaseDialog.vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  title: {
    type: String,
    required: true
  },
  width: {
    type: String,
    default: '600px'
  },
  loading: {
    type: Boolean,
    default: false
  },
  confirmText: {
    type: String,
    default: '保存'
  },
  cancelText: {
    type: String,
    default: '取消'
  }
})

const emit = defineEmits(['update:visible', 'confirm', 'cancel', 'close'])

function handleClose() {
  emit('update:visible', false)
  emit('close')
}

function handleCancel() {
  emit('cancel')
  handleClose()
}

function handleConfirm() {
  emit('confirm')
}
</script>

<template>
  <BaseDialog
    :visible="visible"
    :title="title"
    :width="width"
    @update:visible="emit('update:visible', $event)"
    @close="handleClose"
  >
    <div class="form-dialog-body">
      <slot></slot>
    </div>

    <template #footer>
      <slot name="footer">
        <button class="btn btn-secondary" @click="handleCancel" :disabled="loading">
          {{ cancelText }}
        </button>
        <button class="btn btn-primary" @click="handleConfirm" :disabled="loading">
          {{ loading ? '保存中...' : confirmText }}
        </button>
      </slot>
    </template>
  </BaseDialog>
</template>

<style scoped>
.form-dialog-body {
  display: flex;
  flex-direction: column;
  gap: 16px;
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
