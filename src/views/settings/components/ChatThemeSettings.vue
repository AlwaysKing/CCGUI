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
      title="默认消息主题"
      description="配置应用级聊天消息展示主题。项目和会话可以在此基础上继续覆盖。"
      vertical
    >
      <ChatMessageThemeEditor
        :preset-key="settings.chatMessageThemePreset || 'classic'"
        :theme-config="settings.chatMessageTheme || {}"
        @update:preset-key="updateSettings({ ...settings, chatMessageThemePreset: $event, chatMessageTheme: buildChatMessageThemeFromPreset($event) }, true)"
        @update:theme-config="updateSettings({ ...settings, chatMessageThemePreset: settings.chatMessageThemePreset || 'classic', chatMessageTheme: $event }, true)"
      />
    </SettingItem>
  </SettingsSection>
</template>
