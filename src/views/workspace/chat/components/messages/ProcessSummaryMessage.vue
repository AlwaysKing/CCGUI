<script setup>
import { computed } from 'vue'
import MessageItem from './MessageItem.vue'

const props = defineProps({
  runKey: {
    type: String,
    required: true
  },
  stats: {
    type: Object,
    default: () => ({})
  },
  collapsed: {
    type: Boolean,
    default: true
  },
  chatTheme: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['toggle'])

const summaryTheme = computed(() => ({
  ...props.chatTheme,
  statusStyle: 'hidden'
}))

const summaryMessage = computed(() => ({
  id: `process-summary-${props.runKey}`,
  role: 'assistant',
  subtype: 'process-summary',
  content: '',
  timestamp: props.stats.timestamp || null,
  startTime: props.stats.startTime || null,
  duration: props.stats.running ? null : props.stats.durationMs || null,
  isStreaming: Boolean(props.stats.running),
  hasThinking: false
}))

const surfaceMode = computed(() => props.chatTheme?.messageSurface || 'bubble')

function toggle() {
  emit('toggle')
}
</script>

<template>
  <div class="process-summary-message">
    <MessageItem
      :message="summaryMessage"
      :message-index="0"
      :total-messages="1"
      :all-messages="[summaryMessage]"
      :current-time="stats.currentTime || null"
      :chat-theme="summaryTheme"
    >
      <button
        class="process-summary-toggle"
        :class="`surface-${surfaceMode}`"
        type="button"
        :aria-expanded="!collapsed"
        @click.stop="toggle"
      >
        <span class="process-summary-label">回答过程</span>
        <span class="process-summary-chevron" :class="{ expanded: !collapsed }">›</span>
        <span class="process-summary-count">
          {{ stats.thinkingCount || 0 }} 次思考 · {{ stats.toolCallCount || 0 }} 次工具调用
          <template v-if="stats.permissionCount">
            · {{ stats.permissionCount }} 次权限确认
          </template>
        </span>
        <span v-if="stats.durationLabel" class="process-summary-duration">{{ stats.durationLabel }}</span>
        <span
          v-if="stats.running"
          class="process-summary-spinner"
          role="status"
          aria-label="回答仍在进行"
        ></span>
      </button>
    </MessageItem>
  </div>
</template>

<style scoped>
.process-summary-message {
  min-width: 0;
}

.process-summary-message :deep(.message-avatar) {
  background: transparent !important;
  border: 1.5px solid color-mix(in srgb, var(--accent-primary) 58%, transparent);
  color: transparent !important;
  font-size: 0 !important;
  box-shadow: none !important;
  box-sizing: border-box;
}

.process-summary-message :deep(.message.avatar-small .message-avatar) {
  border-width: 1.2px;
}

.process-summary-toggle {
  width: 100%;
  min-height: 30px;
  padding: 4px 0;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  border-radius: 7px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.16s ease, border-color 0.16s ease;
}

.process-summary-toggle.surface-bubble {
  padding: 6px 9px;
  border: 1px dashed #343740;
  background: #181a1f;
}

.process-summary-toggle.surface-bubble:hover {
  border-color: #454851;
  background: #1d1f24;
}

.process-summary-toggle.surface-ghost:hover {
  background: rgba(255, 255, 255, 0.035);
}

.process-summary-label {
  color: #989ba3;
  font-size: 11.5px;
  font-weight: 560;
  white-space: nowrap;
}

.process-summary-toggle.surface-ghost .process-summary-label {
  color: #8b8b95;
}

.process-summary-chevron {
  color: #676a73;
  font-size: 13px;
  line-height: 1;
  transform: rotate(0deg);
  transition: transform 0.16s ease;
  flex: none;
}

.process-summary-chevron.expanded {
  transform: rotate(90deg);
}

.process-summary-count {
  color: #62656e;
  font-size: 10.5px;
  white-space: nowrap;
}

.process-summary-duration {
  color: #555861;
  font-size: 10px;
  font-variant-numeric: tabular-nums;
}

.process-summary-duration::before {
  content: "·";
  margin: 0 4px;
  color: #454850;
}

.process-summary-spinner {
  width: 10px;
  height: 10px;
  flex: none;
  margin-left: 1px;
  color: #90939b;
  border-radius: 50%;
  border: 1.35px solid rgba(148, 163, 184, 0.28);
  border-top-color: currentColor;
  animation: process-summary-spin 0.9s linear infinite;
}

@keyframes process-summary-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
