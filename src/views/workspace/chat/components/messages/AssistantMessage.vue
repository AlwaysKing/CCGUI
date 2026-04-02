<script setup>
/**
 * AssistantMessage - 助手消息组件
 * 显示 AI 助手的回复（Markdown 渲染）
 */
import { computed } from 'vue'
import CopyButton from '../ui/CopyButton.vue'
import MarkdownRenderer from '@/components/base/MarkdownRenderer.vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  messageIndex: {
    type: Number,
    required: true
  },
  copiedMessageIndex: {
    type: Number,
    default: -1
  },
  chatTheme: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['copyContent'])

// 是否已复制
const isCopied = computed(() => props.copiedMessageIndex === props.messageIndex)
const isFloatingStatus = computed(() => props.chatTheme?.statusStyle === 'floating')
const showStreamingPlaceholder = computed(() => isFloatingStatus.value && props.message.isStreaming && !props.message.content)

const assistantMessageStyle = computed(() => {
  const style = {}
  if (props.chatTheme?.assistantFontSize) {
    style.fontSize = props.chatTheme.assistantFontSize + 'px'
  }
  if (props.chatTheme?.assistantFontColor) {
    style.color = props.chatTheme.assistantFontColor
  }
  return style
})

const changedFilesSummary = computed(() => {
  const summary = props.message?.changedFilesSummary
  if (!summary || !Array.isArray(summary.files) || summary.files.length === 0) {
    return null
  }
  return summary
})

function copyContent() {
  emit('copyContent', props.messageIndex)
}
</script>

<template>
  <div class="assistant-message" :class="[`surface-${chatTheme.messageSurface || 'bubble'}`]">
    <!-- Turn 分割线（在气泡外部） -->
    <div v-if="message.showTurnSeparator" class="turn-separator">
      <div class="turn-separator-line"></div>
      <span class="turn-separator-label">Turn {{ message.turnNumber || 2 }}</span>
      <div class="turn-separator-line"></div>
    </div>

    <!-- 消息内容（单独气泡） -->
    <div v-if="message.content" class="message-text" :class="[`surface-${chatTheme.messageSurface || 'bubble'}`]" :style="assistantMessageStyle">
      <CopyButton
        :is-copied="isCopied"
        @copy="copyContent"
      />
      <MarkdownRenderer :content="message.content" />
      <div v-if="changedFilesSummary" class="changed-files-summary">
        <div class="changed-files-summary-header">
          修改文件
          <span class="changed-files-summary-count">{{ changedFilesSummary.count || changedFilesSummary.files.length }}</span>
        </div>
        <div class="changed-files-summary-table">
          <div
            v-for="(file, index) in changedFilesSummary.files"
            :key="`${file}-${index}`"
            class="changed-files-summary-row"
          >
            <span class="changed-files-summary-index">{{ index + 1 }}</span>
            <span class="changed-files-summary-path">{{ file }}</span>
          </div>
        </div>
      </div>
    </div>
    <div v-else-if="showStreamingPlaceholder" class="message-streaming-placeholder" :class="[`surface-${chatTheme.messageSurface || 'bubble'}`]">
      <span class="placeholder-spinner"></span>
      <span class="placeholder-text">思考中</span>
    </div>
  </div>
</template>

<style scoped>
.assistant-message {
  display: flex;
  flex-direction: column;
  gap: 8px;
  width: 100%;
}

/* Turn 分割线样式 */
.turn-separator {
  display: flex;
  align-items: center;
  gap: 12px;
  margin: 16px 0 12px 0;
}

.turn-separator-line {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, transparent, #3F3F46, transparent);
}

.turn-separator-label {
  font-size: 11px;
  color: #71717A;
  background: #27272A;
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
}

/* 消息内容：单独气泡，宽度适应内容 */
.message-text {
  width: fit-content;
  max-width: 100%;
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.5;
  overflow-x: auto;
  position: relative;
  cursor: text;
  background: #27272A;
  border: 1px solid #3F3F46;
}

.message-text.surface-ghost {
  width: 100%;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 0;
}

.message-streaming-placeholder {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  width: fit-content;
  max-width: 100%;
  min-height: 22px;
  padding: 10px 14px;
  border-radius: 12px;
  color: #A1A1AA;
  background: #27272A;
  border: 1px solid #3F3F46;
}

.message-streaming-placeholder.surface-ghost {
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 0;
}

.placeholder-spinner {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.35px solid rgba(148, 163, 184, 0.28);
  border-top-color: currentColor;
  animation: assistant-placeholder-spin 0.9s linear infinite;
}

.placeholder-text {
  font-size: 12px;
  line-height: 1.4;
}

@keyframes assistant-placeholder-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.message-text.surface-bubble :deep(.markdown-content p) {
  margin: 0.5em 0;
}

.message-text.surface-ghost :deep(.markdown-content p) {
  margin: 0;
}

.message-text.surface-ghost :deep(.markdown-content ul),
.message-text.surface-ghost :deep(.markdown-content ol) {
  margin: 0.3em 0;
}

.message-text.surface-ghost :deep(.markdown-content li) {
  margin: 0.12em 0;
}

/* 非 Markdown 内容保持 pre-wrap */
.message-text:not(:has(.markdown-content)) {
  white-space: pre-wrap;
}

/* 复制按钮定位到右上角 */
.message-text :deep(.copy-btn) {
  position: absolute;
  top: 4px;
  right: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}

/* hover 时显示复制按钮 */
.message-text:hover :deep(.copy-btn) {
  opacity: 1;
}

.changed-files-summary {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px solid rgba(113, 113, 122, 0.35);
}

.changed-files-summary-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 600;
  color: #D4D4D8;
}

.changed-files-summary-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 20px;
  padding: 0 6px;
  border-radius: 999px;
  background: rgba(63, 63, 70, 0.9);
  color: #A1A1AA;
  font-size: 11px;
  font-weight: 500;
}

.changed-files-summary-table {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.changed-files-summary-row {
  display: grid;
  grid-template-columns: 20px minmax(0, 1fr);
  gap: 10px;
  align-items: start;
  font-size: 12px;
  line-height: 1.45;
}

.changed-files-summary-index {
  color: #71717A;
  text-align: right;
}

.changed-files-summary-path {
  color: #E4E4E7;
  word-break: break-all;
}
</style>
