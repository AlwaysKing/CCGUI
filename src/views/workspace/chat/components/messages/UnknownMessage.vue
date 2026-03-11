<script setup>
/**
 * UnknownMessage - 未知消息类型组件
 * 显示暂未支持的消息类型
 */
import CopyButton from '../ui/CopyButton.vue'

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
  <div class="message-avatar">?</div>
  <div class="message-content-wrapper">
    <div class="message-header">
      <span class="header-time">
        <span class="header-icon">🕐</span>
        {{ new Date(message.timestamp).toLocaleTimeString() }}
      </span>
    </div>
    <div class="message-text unknown-message">
      <CopyButton
        :is-copied="isCopied"
        @copy="copyContent"
      />
      <div class="unknown-header">
        <span class="unknown-icon">⚠️</span>
        <span class="unknown-label">暂未支持的消息类型: {{ message.messageType }}</span>
      </div>
      <pre class="unknown-content">{{ message.content }}</pre>
    </div>
  </div>
</template>

<script>
import { computed } from 'vue'
export default {
  name: 'UnknownMessage'
}
</script>

<style scoped>
.message-content-wrapper {
  flex: 1;
  max-width: 70%;
}

.message-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}

.header-time {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: var(--font-size-xs);
  color: var(--text-muted);
}

.header-icon {
  font-size: 12px;
}

.message-text.unknown-message {
  background: linear-gradient(135deg, #2D1F1F 0%, #1F1F1F 100%);
  border: 1px solid #EF4444;
  border-left: 3px solid #EF4444;
  border-radius: var(--radius-lg);
  padding: 12px 16px;
  position: relative;
}

.unknown-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.unknown-icon {
  font-size: 14px;
}

.unknown-label {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: #FCA5A5;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.unknown-content {
  font-size: var(--font-size-xs);
  color: #D4D4D4;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-family-mono);
  background: rgba(0, 0, 0, 0.2);
  padding: 8px 12px;
  border-radius: var(--radius-sm);
  margin: 0;
  max-height: 300px;
  overflow: auto;
  cursor: text;
}
</style>
