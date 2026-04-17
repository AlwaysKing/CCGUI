<script setup>
import { reactive, ref, watch } from 'vue'
import BaseDialog from '@/components/base/BaseDialog.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import FormField from '@/components/base/FormField.vue'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  saving: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'save'])

const form = reactive({
  label: '',
  command: ''
})
const formError = ref('')

function resetForm() {
  form.label = ''
  form.command = ''
  formError.value = ''
}

function handleSave() {
  if (!form.label.trim()) {
    formError.value = '请输入快捷命令名称'
    return
  }

  if (!form.command.trim()) {
    formError.value = '请输入要执行的命令'
    return
  }

  formError.value = ''
  emit('save', {
    label: form.label.trim(),
    command: form.command.trim()
  })
}

watch(() => props.modelValue, visible => {
  if (visible) {
    resetForm()
  }
})
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    title="新建快捷命令"
    width="520px"
    @update:model-value="$emit('update:modelValue', $event)"
    @close="$emit('update:modelValue', false)"
  >
    <div class="task-config-layout">
      <div class="task-config-title">填写一个名称和一条命令，保存后会追加到 `.vscode/tasks.json`。</div>

      <FormField label="名称" required :error="!form.label.trim() && formError ? formError : ''">
        <BaseInput v-model="form.label" placeholder="例如：electron-dev" />
      </FormField>

      <FormField label="命令" required :error="!form.command.trim() && formError ? formError : ''" hint="例如：npm run electron:dev">
        <BaseInput v-model="form.command" placeholder="输入实际要执行的命令" />
      </FormField>
    </div>

    <template #footer>
      <button class="footer-btn footer-cancel" @click="$emit('update:modelValue', false)">取消</button>
      <button class="footer-btn footer-save" :disabled="saving" @click="handleSave">
        {{ saving ? '保存中...' : '保存' }}
      </button>
    </template>
  </BaseDialog>
</template>

<style scoped>
.task-config-layout {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.task-config-title {
  font-size: 13px;
  color: var(--text-secondary);
  line-height: 1.5;
}

.footer-btn {
  padding: 8px 14px;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease, border-color 0.18s ease;
}

.footer-cancel {
  background: transparent;
  border: 1px solid var(--border-default);
  color: var(--text-secondary);
}

.footer-cancel:hover {
  background: rgba(255, 255, 255, 0.04);
}

.footer-save {
  background: rgba(249, 115, 22, 0.14);
  color: #FDBA74;
}

.footer-save:hover:not(:disabled) {
  background: rgba(249, 115, 22, 0.22);
}

.footer-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
