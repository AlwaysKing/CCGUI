<script setup>
import SettingsSection from './common/SettingsSection.vue'
import SettingItem from './common/SettingItem.vue'
import ChatMessageThemeEditor from '@/components/chat/ChatMessageThemeEditor.vue'
import { buildChatMessageThemeFromPreset } from '@/utils/chatMessageTheme'

const props = defineProps({
  settings: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['update:settings', 'save-settings'])

function updateSettings(nextSettings, autoSave = false) {
  emit('update:settings', nextSettings)
  if (autoSave) {
    emit('save-settings')
  }
}
</script>

<template>
  <SettingsSection title="消息主题">
    <SettingItem
      vertical
    >
      <ChatMessageThemeEditor
        :preset-key="settings.chatMessageThemePreset || 'classic'"
        :theme-config="settings.chatMessageTheme || {}"
        :collapse-process-on-display="settings.collapseProcessOnDisplay === true"
        @update:preset-key="updateSettings({ ...settings, chatMessageThemePreset: $event, chatMessageTheme: buildChatMessageThemeFromPreset($event) }, true)"
        @update:theme-config="updateSettings({ ...settings, chatMessageThemePreset: settings.chatMessageThemePreset || 'classic', chatMessageTheme: $event }, true)"
        @update:collapse-process-on-display="updateSettings({ ...settings, collapseProcessOnDisplay: $event }, true)"
      />
    </SettingItem>
  </SettingsSection>
</template>
