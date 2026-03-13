<script setup>
/**
 * AssistantMessage - 助手消息组件
 * 显示 AI 助手的回复（Markdown 渲染）
 */
import { computed } from 'vue'
import CopyButton from '../ui/CopyButton.vue'
import MarkdownRenderer from '../../../../../components/common/MarkdownRenderer.vue'

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
  }
})

const emit = defineEmits(['copyContent'])

// 是否已复制
const isCopied = computed(() => props.copiedMessageIndex === props.messageIndex)

function copyContent() {
  emit('copyContent', props.messageIndex)
}
</script>

<template>
  <div class="assistant-message">
    <!-- Turn 分割线（在气泡外部） -->
    <div v-if="message.showTurnSeparator" class="turn-separator">
      <div class="turn-separator-line"></div>
      <span class="turn-separator-label">Turn {{ message.turnNumber || 2 }}</span>
      <div class="turn-separator-line"></div>
    </div>

    <!-- 消息内容（单独气泡） -->
    <div v-if="message.content" class="message-text">
      <CopyButton
        :is-copied="isCopied"
        @copy="copyContent"
      />
      <MarkdownRenderer :content="message.content" />
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
</style>
