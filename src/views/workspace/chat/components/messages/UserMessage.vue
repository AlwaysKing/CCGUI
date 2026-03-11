<script setup>
/**
 * UserMessage - 用户消息组件
 * 显示用户发送的消息内容
 * 操作按钮（展开/折叠、撤销）已移至 MessageItem 组件的右侧列
 */
import { computed } from 'vue'
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
  <div class="message-user-container">
    <div class="message-content user-content">
      <div class="message-text">
        <CopyButton
          :is-copied="isCopied"
          @copy="copyContent"
        />
        {{ message.content }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.message-user-container {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  max-width: 100%;
}

.message-content.user-content {
  width: fit-content;
  max-width: 100%;
}

.message-text {
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.5;
  overflow-x: auto;
  position: relative;
  cursor: text;
  white-space: pre-wrap;
  background: #3F3F46;
  color: #E4E4E7;
}

/* 复制按钮定位到右上角 */
.message-text :deep(.copy-btn) {
  position: absolute;
  top: 8px;
  right: 8px;
  opacity: 0;
  transition: opacity 0.15s;
}

/* hover 时显示复制按钮 */
.message-text:hover :deep(.copy-btn) {
  opacity: 1;
}
</style>
