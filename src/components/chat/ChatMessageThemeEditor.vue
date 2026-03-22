<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import {
  CHAT_MESSAGE_THEME_PRESET_OPTIONS,
  buildChatMessageThemeFromPreset
} from '@/utils/chatMessageTheme'
import MessageList from '@/views/workspace/chat/components/messages/MessageList.vue'

const props = defineProps({
  mode: {
    type: String,
    default: ''
  },
  modeOptions: {
    type: Array,
    default: () => []
  },
  presetKey: {
    type: String,
    default: 'classic'
  },
  themeConfig: {
    type: Object,
    default: () => ({})
  },
  showPreview: {
    type: Boolean,
    default: true
  },
  disabled: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits([
  'update:mode',
  'update:presetKey',
  'update:themeConfig'
])

const previewNow = ref(Date.now())
let previewTimer = null
const previewMessages = ref([])

const showModeSelector = computed(() => props.modeOptions.length > 0)
const canEditTheme = computed(() => !showModeSelector.value || props.mode === 'custom')
const canChoosePreset = computed(() => !showModeSelector.value || props.mode === 'preset' || props.mode === 'custom')

function buildPreviewMessages() {
  const now = Date.now()

  return [
    {
      id: 'preview-user-1',
      role: 'user',
      content: '请帮我把消息主题改得更接近 codex.app，但要保留 CCGUI 的配置能力。',
      timestamp: now - 48000,
      startTime: now - 47000,
      duration: 820,
      responseCollapsed: false
    },
    {
      id: 'preview-assistant-1',
      role: 'assistant',
      content: '我会先整理主题 schema，再把头像、状态、tool use 和间距收敛成可组合配置。',
      thinking: '先把主题系统固定成少量视觉开关，再用预设映射出 Codex 风格，避免后续无限长 if 分支。',
      hasThinking: true,
      thinkingCollapsed: true,
      timestamp: now - 44000,
      startTime: now - 43800,
      duration: 2100,
      usage: {
        input_tokens: 1240,
        output_tokens: 322
      },
      numTurns: 3
    },
    {
      id: 'preview-tool-read',
      role: 'tool_use',
      toolName: 'Read',
      toolInput: {
        file_path: '/Users/alwaysking/AKProject/CCGUI/src/views/workspace/chat/components/messages/ToolUseMessage.vue',
        start_line: 118,
        end_line: 186
      },
      result: '已读取目标区段',
      isError: false,
      isExecuting: false,
      collapsed: true,
      timestamp: now - 39600,
      startTime: now - 39800,
      duration: 260
    },
    {
      id: 'preview-tool-write',
      role: 'tool_use',
      toolName: 'Write',
      toolInput: {
        file_path: '/Users/alwaysking/AKProject/CCGUI/docs/chat-message-theme-schema.md',
        content: '# Chat Message Theme\n\n- avatarMode\n- statusStyle\n- messageSurface\n'
      },
      result: '写入成功',
      isError: false,
      isExecuting: false,
      collapsed: true,
      timestamp: now - 38400,
      startTime: now - 38600,
      duration: 310
    },
    {
      id: 'preview-tool-bash',
      role: 'tool_use',
      toolName: 'Bash',
      toolInput: {
        command: 'rg -n "messageSurface|statusStyle" src/views/workspace/chat/components/messages',
        description: '检查主题切换影响的消息组件'
      },
      result: '',
      isError: false,
      isExecuting: true,
      collapsed: true,
      timestamp: now - 37200,
      startTime: now - 37200
    },
    {
      id: 'preview-tool-edit',
      role: 'tool_use',
      toolName: 'Edit',
      toolInput: {
        file_path: '/Users/alwaysking/AKProject/CCGUI/src/views/settings/components/ChatThemeSettings.vue',
        old_string: '<div class="old-layout">...</div>',
        new_string: '<div class="theme-preview-layout">...</div>'
      },
      result: 'Applied successfully',
      isError: false,
      isExecuting: false,
      collapsed: true,
      timestamp: now - 36000,
      startTime: now - 36200,
      duration: 460
    },
    {
      id: 'preview-permission-result',
      role: 'permission_result',
      content: '✅ 已允许: Bash\n说明: 运行主题预览相关搜索\n命令: rg -n "ChatMessageThemeEditor|MessageList" src',
      timestamp: now - 33800,
      startTime: now - 33900,
      duration: 220
    },
    {
      id: 'preview-question',
      role: 'question',
      timestamp: now - 32600,
      questions: [
        {
          header: '头像风格',
          question: '消息主题默认应该保留哪种头像展示方式？',
          selectedAnswer: '小头像',
          multiSelect: false,
          options: [
            { label: '大头像', description: '保留当前识别感' },
            { label: '小头像', description: '更接近 Codex 的轻量视觉' },
            { label: '无头像', description: '极简布局' }
          ]
        },
        {
          header: '状态样式',
          question: '状态信息更适合用哪种呈现方式？',
          selectedAnswer: '简约',
          multiSelect: false,
          options: [
            { label: '完整', description: '信息完整且稳定可见' },
            { label: '简约', description: '更轻量' },
            { label: '悬浮', description: '只在 hover 时显示' }
          ]
        }
      ],
      resultReceived: true,
      answersConsistent: true
    },
    {
      id: 'preview-system-notification',
      role: 'system_notification',
      scope: 'session',
      notificationType: 'session-config-applied',
      data: {
        provider: 'codex',
        model: 'OpenAI',
        subModel: 'gpt-5.4',
        effort: 'medium',
        changeType: 'effort',
        durationMs: 1400
      },
      timestamp: now - 31400
    },
    {
      id: 'preview-system-message',
      role: 'system',
      content: '会话已切换到 Codex 消息主题预设，后续消息将按新的展示方案渲染。',
      timestamp: now - 30400
    },
    {
      id: 'preview-assistant-2',
      role: 'assistant',
      content: '主题配置页已经接入真实消息预览，下面这块就是 MessageList 的实际渲染效果。',
      timestamp: now - 30000,
      startTime: now - 29500,
      duration: 1330,
      usage: {
        cache_read_input_tokens: 320,
        input_tokens: 980,
        output_tokens: 211
      },
      numTurns: 4
    }
  ]
}

const fieldOptions = {
  avatarMode: [
    { value: 'large', label: '大头像' },
    { value: 'small', label: '小头像' },
    { value: 'none', label: '无头像' }
  ],
  statusStyle: [
    { value: 'full', label: '完整' },
    { value: 'compact', label: '简约' },
    { value: 'floating', label: '悬浮' },
    { value: 'hidden', label: '不显示' }
  ],
  messageSurface: [
    { value: 'bubble', label: '气泡样式' },
    { value: 'ghost', label: '简约' }
  ],
  messageSpacing: [
    { value: 'large', label: '大' },
    { value: 'medium', label: '中' },
    { value: 'small', label: '小' }
  ]
}

const themeLabelMap = {
  avatarMode: Object.fromEntries(fieldOptions.avatarMode.map(option => [option.value, option.label])),
  statusStyle: Object.fromEntries(fieldOptions.statusStyle.map(option => [option.value, option.label])),
  messageSurface: Object.fromEntries(fieldOptions.messageSurface.map(option => [option.value, option.label])),
  messageSpacing: Object.fromEntries(fieldOptions.messageSpacing.map(option => [option.value, option.label]))
}

function updateMode(nextMode) {
  emit('update:mode', nextMode)
}

function handlePresetChange(nextPresetKey) {
  emit('update:presetKey', nextPresetKey)
}

function updateField(field, value) {
  emit('update:themeConfig', {
    ...props.themeConfig,
    [field]: value
  })
}

onMounted(() => {
  if (!props.showPreview) {
    return
  }

  previewMessages.value = buildPreviewMessages()
  previewTimer = window.setInterval(() => {
    previewNow.value = Date.now()
  }, 1000)
})

onUnmounted(() => {
  if (previewTimer) {
    window.clearInterval(previewTimer)
    previewTimer = null
  }
})
</script>

<template>
  <div class="theme-editor" :class="{ 'without-preview': !showPreview }">
    <div v-if="showPreview" class="theme-preview-pane">
      <div class="preview-header">
        <div class="preview-title-group">
          <span class="preview-title">实时预览</span>
        </div>
        <span class="preview-badge">Live</span>
      </div>
      <div class="theme-preview-shell">
        <div class="theme-preview-scroll">
          <MessageList
            :messages="previewMessages"
            :current-time="previewNow"
            :working-directory="'/Users/alwaysking/AKProject/CCGUI'"
            :chat-theme="themeConfig"
          />
        </div>
      </div>
    </div>

    <div :class="showPreview ? 'theme-controls-pane' : 'theme-controls-flat'">
      <div class="theme-controls-scroll" :class="{ 'without-preview': !showPreview }">
        <div v-if="showModeSelector" class="theme-mode-group">
          <label v-for="option in modeOptions" :key="option.value" class="theme-radio-item">
            <input
              :checked="mode === option.value"
              :disabled="disabled"
              type="radio"
              :value="option.value"
              @change="updateMode(option.value)"
            >
            <span>{{ option.label }}</span>
          </label>
        </div>

        <div v-if="canChoosePreset" class="theme-preset-row">
          <span class="row-label">预设</span>
          <select
            class="theme-select"
            :disabled="disabled"
            :value="presetKey"
            @change="handlePresetChange($event.target.value)"
          >
            <option v-for="option in CHAT_MESSAGE_THEME_PRESET_OPTIONS" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </select>
        </div>

        <div v-if="canEditTheme" class="theme-grid">
          <div class="theme-field">
            <label class="field-label">头像</label>
            <select class="theme-select" :value="themeConfig.avatarMode" @change="updateField('avatarMode', $event.target.value)">
              <option v-for="option in fieldOptions.avatarMode" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </div>

          <div class="theme-field">
            <label class="field-label">状态样式</label>
            <select class="theme-select" :value="themeConfig.statusStyle" @change="updateField('statusStyle', $event.target.value)">
              <option v-for="option in fieldOptions.statusStyle" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </div>

          <div class="theme-field">
            <label class="field-label">消息边框</label>
            <select class="theme-select" :value="themeConfig.messageSurface" @change="updateField('messageSurface', $event.target.value)">
              <option v-for="option in fieldOptions.messageSurface" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </div>

          <div class="theme-field">
            <label class="field-label">消息间隔</label>
            <select class="theme-select" :value="themeConfig.messageSpacing" @change="updateField('messageSpacing', $event.target.value)">
              <option v-for="option in fieldOptions.messageSpacing" :key="option.value" :value="option.value">{{ option.label }}</option>
            </select>
          </div>
        </div>

        <p v-else-if="canChoosePreset" class="theme-hint">
          当前模式使用完整预设，不展开细分开关。
        </p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.theme-editor {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.theme-editor.without-preview {
  gap: 0;
}

.theme-controls-pane,
.theme-preview-pane {
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  background:
    radial-gradient(circle at top left, rgba(249, 115, 22, 0.04), transparent 28%),
    linear-gradient(180deg, rgba(28, 30, 35, 0.94) 0%, rgba(21, 23, 28, 0.96) 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.03),
    0 10px 24px rgba(0, 0, 0, 0.14);
  overflow: hidden;
}

.theme-controls-flat {
  border: none;
  border-radius: 0;
  background: transparent;
  overflow: visible;
}

.theme-preview-pane {
  border: none;
  border-radius: 0;
  background: transparent;
}

.theme-controls-pane {
  min-height: 248px;
  max-height: 320px;
}

.theme-controls-scroll {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 320px;
  overflow-y: auto;
  padding: 14px;
}

.theme-controls-scroll.without-preview {
  max-height: none;
  overflow: visible;
  padding: 0;
}

.theme-mode-group {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.theme-radio-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #A1A1AA;
  cursor: pointer;
}

.theme-radio-item input {
  accent-color: #F97316;
}

.theme-preset-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.row-label,
.field-label {
  font-size: 12px;
  color: #A8ABB6;
}

.theme-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
  gap: 12px;
}

.theme-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.theme-select {
  background:
    linear-gradient(180deg, rgba(255, 255, 255, 0.025) 0%, rgba(255, 255, 255, 0.01) 100%),
    rgba(18, 20, 24, 0.9);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-radius: 8px;
  padding: 8px 10px;
  color: #F4F4F5;
  font-size: 13px;
  transition: border-color 0.18s ease, background-color 0.18s ease, box-shadow 0.18s ease;
}

.theme-select:focus {
  outline: none;
  border-color: #F97316;
  box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.12);
}

.theme-select:hover {
  border-color: rgba(255, 255, 255, 0.11);
}

.theme-hint {
  margin: 0;
  font-size: 12px;
  color: #8B8E98;
}

.theme-preview-pane {
  padding: 0;
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
  padding: 0 0 12px;
}

.preview-title-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.preview-title {
  font-size: 14px;
  font-weight: 600;
  color: #F4F4F5;
}

.preview-badge {
  display: inline-flex;
  align-items: center;
  min-height: 22px;
  padding: 0 10px;
  border-radius: 999px;
  background: rgba(249, 115, 22, 0.12);
  border: 1px solid rgba(249, 115, 22, 0.24);
  color: #FED7AA;
  font-size: 11px;
  font-weight: 600;
}

.theme-preview-shell {
  border: 1px solid #2D2E33;
  border-radius: 12px;
  background:
    radial-gradient(circle at top left, rgba(249, 115, 22, 0.06), transparent 34%),
    linear-gradient(180deg, #121316 0%, #0E0F12 100%);
  min-height: 360px;
  max-height: 520px;
  overflow: hidden;
}

.theme-preview-scroll {
  max-height: 520px;
  overflow-y: auto;
  padding: 18px 18px 10px;
}
</style>
