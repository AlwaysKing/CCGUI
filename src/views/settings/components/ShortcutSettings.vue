<script setup>
import { ref } from 'vue'
import SettingsSection from './common/SettingsSection.vue'
import SettingItem from './common/SettingItem.vue'
import {
  SHORTCUT_ACTIONS,
  eventToShortcutCombo,
  formatShortcutLabel,
  getDefaultShortcutBindings,
  normalizeShortcutBindings
} from '@/utils/shortcuts'

const props = defineProps({
  settings: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['update:settings', 'save-settings'])

const recordingAction = ref('')

function updateBindings(nextBindings, autoSave = true) {
  emit('update:settings', {
    ...props.settings,
    shortcutBindings: normalizeShortcutBindings(nextBindings)
  })

  if (autoSave) {
    emit('save-settings')
  }
}

function handleShortcutKeydown(event, action) {
  event.preventDefault()
  event.stopPropagation()

  if (event.key === 'Escape') {
    recordingAction.value = ''
    return
  }

  const currentBindings = {
    ...getDefaultShortcutBindings(),
    ...normalizeShortcutBindings(props.settings.shortcutBindings || {})
  }

  if (event.key === 'Backspace' || event.key === 'Delete') {
    const nextBindings = { ...currentBindings }
    nextBindings[action] = ''
    updateBindings(nextBindings)
    recordingAction.value = ''
    return
  }

  const combo = eventToShortcutCombo(event)
  if (!combo || !combo.includes('+')) {
    return
  }

  updateBindings({
    ...currentBindings,
    [action]: combo
  })
  recordingAction.value = ''
}

function resetDefaults() {
  updateBindings(getDefaultShortcutBindings())
}
</script>

<template>
  <SettingsSection title="快捷键">
    <div class="shortcut-header">
      <div class="shortcut-summary">默认按 VS Code 常见面板切换习惯预设，可直接点击后录入新的组合键。</div>
      <button class="reset-btn" @click="resetDefaults">恢复默认</button>
    </div>

    <SettingItem
      v-for="item in SHORTCUT_ACTIONS.filter(item => !item.hidden)"
      :key="item.action"
      :title="item.label"
      :description="item.description"
    >
      <button
        class="shortcut-capture"
        :class="{ recording: recordingAction === item.action }"
        @click="recordingAction = item.action"
        @keydown="handleShortcutKeydown($event, item.action)"
      >
        {{ recordingAction === item.action
          ? '按下新的快捷键'
          : formatShortcutLabel(normalizeShortcutBindings(settings.shortcutBindings || {})[item.action] || item.defaultCombo) }}
      </button>
    </SettingItem>
  </SettingsSection>
</template>

<style scoped>
.shortcut-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 12px;
}

.shortcut-summary {
  font-size: 12px;
  color: #8b93a1;
  line-height: 1.5;
}

.reset-btn {
  padding: 6px 12px;
  background: transparent;
  border: 1px solid var(--app-soft-border);
  border-radius: 8px;
  color: #d4d4d8;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s, color 0.15s;
}

.reset-btn:hover {
  background: var(--app-soft-surface-hover);
  border-color: var(--app-soft-border-hover);
  color: #f4f4f5;
}

.shortcut-capture {
  min-width: 180px;
  padding: 8px 12px;
  background: var(--app-soft-surface);
  border: 1px solid var(--app-soft-border);
  border-radius: 8px;
  color: #f4f4f5;
  font-size: 13px;
  text-align: center;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s, color 0.15s;
}

.shortcut-capture:hover,
.shortcut-capture.recording {
  border-color: #f97316;
  background: rgba(249, 115, 22, 0.08);
}
</style>
