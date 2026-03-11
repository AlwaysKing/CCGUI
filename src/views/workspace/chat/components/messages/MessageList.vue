<script setup>
/**
 * MessageList - 消息列表组件
 * 简化版本，使用 MessageItem 渲染每个消息
 */
import MessageItem from './MessageItem.vue'

const props = defineProps({
  messages: {
    type: Array,
    required: true
  },
  workingDirectory: {
    type: String,
    default: ''
  },
  currentTime: {
    type: Number,
    default: null
  }
})

const emit = defineEmits([
  'messageClick',
  'rewind',
  'fork',
  'rewindAndFork',
  'jumpToMessage',
  'copyContent',
  'copyQuestionContent'
])

// ============ 事件透传 ============

function handleMessageClick({ event, message }) {
  emit('messageClick', { event, message })
}

function handleRewind({ messageId, messageIndex }) {
  emit('rewind', { messageId, messageIndex })
}

function handleFork({ messageId, messageIndex }) {
  emit('fork', { messageId, messageIndex })
}

function handleRewindAndFork({ messageId, messageIndex }) {
  emit('rewindAndFork', { messageId, messageIndex })
}

function handleJumpToMessage(rewindToMessageId) {
  emit('jumpToMessage', rewindToMessageId)
}

function handleCopyContent({ index, content }) {
  emit('copyContent', { index, content })
}

function handleCopyQuestionContent({ index, content }) {
  emit('copyQuestionContent', { index, content })
}
</script>

<template>
  <MessageItem
    v-for="(message, index) in messages"
    :key="index"
    :message="message"
    :message-index="index"
    :total-messages="messages.length"
    :working-directory="workingDirectory"
    :current-time="currentTime"
    :all-messages="messages"
    @message-click="handleMessageClick"
    @rewind="handleRewind"
    @fork="handleFork"
    @rewind-and-fork="handleRewindAndFork"
    @jump-to-message="handleJumpToMessage"
    @copy-content="handleCopyContent"
    @copy-question-content="handleCopyQuestionContent"
  />
</template>
