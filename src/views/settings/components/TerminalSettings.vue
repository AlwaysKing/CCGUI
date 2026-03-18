<script setup>
import SettingsSection from './common/SettingsSection.vue'
import SettingItem from './common/SettingItem.vue'

const props = defineProps({
  settings: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['update:settings', 'save-settings'])

const defaultTerminalFontFamily = 'Menlo, Monaco, "Courier New", monospace'
const defaultCustomTerminalThemeText = `{
  "background": "#111216",
  "foreground": "#E4E4E7",
  "cursor": "#F97316",
  "cursorAccent": "#111216",
  "selectionBackground": "rgba(228, 228, 231, 0.18)",
  "black": "#111216",
  "red": "#F87171",
  "green": "#4ADE80",
  "yellow": "#FBBF24",
  "blue": "#60A5FA",
  "magenta": "#C084FC",
  "cyan": "#22D3EE",
  "white": "#E4E4E7",
  "brightBlack": "#52525B",
  "brightRed": "#FCA5A5",
  "brightGreen": "#86EFAC",
  "brightYellow": "#FCD34D",
  "brightBlue": "#93C5FD",
  "brightMagenta": "#D8B4FE",
  "brightCyan": "#67E8F9",
  "brightWhite": "#FAFAFA"
}`

const terminalThemeOptions = [
  { value: 'ccgui-dark', label: 'CCGUI Dark' },
  { value: 'macos-terminal', label: 'macOS Terminal Dark' },
  { value: 'iterm2-dark', label: 'iTerm2 Dark' },
  { value: 'vscode-dark', label: 'VS Code Dark' },
  { value: 'custom', label: '自定义' }
]

function updateSettings(nextSettings, autoSave = false) {
  emit('update:settings', nextSettings)
  if (autoSave) {
    emit('save-settings')
  }
}
</script>

<template>
  <SettingsSection title="终端配置">
    <SettingItem title="终端主题" description="选择终端配色方案，影响背景、文本、光标和 ANSI 颜色">
      <select
        :value="settings.terminalTheme || 'ccgui-dark'"
        @change="updateSettings({ ...settings, terminalTheme: $event.target.value }, true)"
        class="setting-select"
      >
        <option v-for="option in terminalThemeOptions" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </SettingItem>

    <SettingItem
      v-if="(settings.terminalTheme || 'ccgui-dark') === 'custom'"
      title="自定义主题"
      description="填写 xterm 主题 JSON。未填写的字段会回退到 CCGUI Dark 默认值。"
      vertical
    >
      <textarea
        :value="settings.customTerminalThemeText || defaultCustomTerminalThemeText"
        @input="updateSettings({ ...settings, customTerminalThemeText: $event.target.value })"
        @blur="updateSettings({ ...settings, customTerminalThemeText: $event.target.value || defaultCustomTerminalThemeText }, true)"
        class="setting-textarea"
        spellcheck="false"
      ></textarea>
    </SettingItem>

    <SettingItem
      title="终端字体"
      description="设置终端面板使用的字体族，支持填写多个字体并用逗号分隔"
      vertical
    >
      <input
        type="text"
        :value="settings.terminalFontFamily"
        @input="updateSettings({ ...settings, terminalFontFamily: $event.target.value })"
        @blur="updateSettings({ ...settings, terminalFontFamily: $event.target.value || defaultTerminalFontFamily }, true)"
        class="setting-input"
        placeholder='例如: "MesloLGS NF", "SF Mono", monospace'
      >
    </SettingItem>
  </SettingsSection>
</template>

<style scoped>
.setting-select {
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  padding: 8px 12px;
  color: #F4F4F5;
  font-size: 13px;
  cursor: pointer;
  min-width: 180px;
}

.setting-select:focus {
  outline: none;
  border-color: #F97316;
}

.setting-input {
  width: 100%;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  padding: 10px 12px;
  color: #F4F4F5;
  font-size: 13px;
}

.setting-input:focus {
  outline: none;
  border-color: #F97316;
}

.setting-textarea {
  width: 100%;
  min-height: 240px;
  resize: vertical;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  padding: 12px;
  color: #F4F4F5;
  font-size: 12px;
  line-height: 1.5;
  font-family: "SF Mono", Menlo, Monaco, "Courier New", monospace;
}

.setting-textarea:focus {
  outline: none;
  border-color: #F97316;
}
</style>
