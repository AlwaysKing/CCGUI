<script setup>
/**
 * StickyHeader - 粘性头部组件
 * 显示当前正在流式输出的消息，浮动在聊天内容上方
 */
import { computed } from 'vue'
import CopyButton from '../ui/CopyButton.vue'
import MarkdownRenderer from '../../../../../components/common/MarkdownRenderer.vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  isProcessing: {
    type: Boolean,
    default: false
  },
  currentTime: {
    type: Number,
    default: null
  },
  containerHeight: {
    type: Number,
    default: 400
  },
  isCopied: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['copy', 'scrollToUser'])

// 格式化耗时
function formatDuration(ms) {
  if (!ms && ms !== 0) return ''
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

// 格式化 tokens
function formatTokens(usage) {
  if (!usage) return ''
  const cache = usage.cache_read_input_tokens || 0
  const input = usage.input_tokens || 0
  const output = usage.output_tokens || 0
  if (cache === 0 && input === 0 && output === 0) return ''

  const parts = []
  if (cache) parts.push(`缓存: ${cache.toLocaleString()}`)
  if (input) parts.push(`输入: ${input.toLocaleString()}`)
  if (output) parts.push(`输出: ${output.toLocaleString()}`)

  return parts.join(' ')
}

// 计算实时耗时
const computedDuration = computed(() => {
  if (props.message.duration) {
    return formatDuration(props.message.duration)
  }
  if (props.isProcessing && props.message.startTime && props.currentTime) {
    return formatDuration(props.currentTime - props.message.startTime)
  }
  return null
})

// 格式化时间
const formattedTime = computed(() => {
  if (!props.message.timestamp) return ''
  return new Date(props.message.timestamp).toLocaleTimeString()
})

// 格式化 tokens
const formattedTokens = computed(() => {
  return formatTokens(props.message.usage)
})

// 是否显示实时耗时
const isDurationStreaming = computed(() => {
  return !props.message.duration && props.isProcessing && props.message.startTime && props.currentTime
})

// CSS 变量
const cssMaxHeight = computed(() => `${props.containerHeight * 0.5}px`)

function copyContent() {
  emit('copy')
}

function scrollToUserMessage() {
  emit('scrollToUser')
}
</script>

<template>
  <div class="sticky-header">
    <div class="sticky-content" :style="{ '--max-height': cssMaxHeight }">
      <!-- 折叠状态：简单信息 -->
      <div class="sticky-collapsed">
        <div class="sticky-info">
          <span v-if="formattedTime" class="sticky-time">
            <span class="sticky-info-icon">🕐</span>
            {{ formattedTime }}
          </span>
          <span v-if="computedDuration" class="sticky-duration" :class="{ streaming: isDurationStreaming }">
            <span class="sticky-info-icon">⏳</span>
            {{ computedDuration }}
          </span>
          <span v-if="message.numTurns" class="sticky-turns">
            <span class="sticky-info-icon">🔄</span>
            {{ message.numTurns }}
          </span>
          <span v-if="formattedTokens" class="sticky-usage">
            <span class="sticky-info-icon">⚡</span>
            {{ formattedTokens }}
          </span>
          <button class="scroll-up-btn" @click="scrollToUserMessage" title="滚动到提问">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="19" x2="12" y2="5"></line>
              <polyline points="5 12 12 5 19 12"></polyline>
            </svg>
          </button>
        </div>
        <div class="sticky-text">{{ message.content }}</div>
      </div>

      <!-- 展开状态：Markdown 渲染 -->
      <div class="sticky-expanded">
        <div class="sticky-info">
          <span v-if="formattedTime" class="sticky-time">
            <span class="sticky-info-icon">🕐</span>
            {{ formattedTime }}
          </span>
          <span v-if="computedDuration" class="sticky-duration" :class="{ streaming: isDurationStreaming }">
            <span class="sticky-info-icon">⏳</span>
            {{ computedDuration }}
          </span>
          <span v-if="message.numTurns" class="sticky-turns">
            <span class="sticky-info-icon">🔄</span>
            {{ message.numTurns }}
          </span>
          <span v-if="formattedTokens" class="sticky-usage">
            <span class="sticky-info-icon">⚡</span>
            {{ formattedTokens }}
          </span>
          <button class="scroll-up-btn" @click="scrollToUserMessage" title="滚动到提问">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="19" x2="12" y2="5"></line>
              <polyline points="5 12 12 5 19 12"></polyline>
            </svg>
          </button>
        </div>
        <div class="sticky-text-md">
          <CopyButton
            :is-copied="isCopied"
            @copy="copyContent"
          />
          <MarkdownRenderer :content="message.content" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* 粘性头部 - 浮动在聊天内容上方 */
.sticky-header {
  position: sticky;
  top: 0;
  z-index: 50;
  display: flex;
  justify-content: flex-end;
  margin-right: -12px;
  margin-top: -14px;
}

.sticky-content {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background: #3F3F46;
  border-radius: 8px;
  padding: 4px 12px;
  max-width: 70%;
  flex-direction: column;
  gap: 4px;
  transform: translateY(-6px);
}

/* 折叠状态：默认显示 */
.sticky-collapsed {
  display: flex;
  flex-direction: column;
  gap: 4px;
  align-items: flex-start;
}

.sticky-expanded {
  display: none;
  flex-direction: column;
  gap: 8px;
  align-items: flex-start;
  max-height: calc(var(--max-height, 300px) - 50px);
  overflow-y: auto;
  width: 100%;
}

/* 悬停时：隐藏折叠，显示展开 */
.sticky-content:hover .sticky-collapsed {
  display: none;
}

.sticky-content:hover {
  max-width: none;
  max-height: var(--max-height, 300px);
  padding: 4px 12px;
}

.sticky-content:hover .sticky-expanded {
  display: flex;
}

.sticky-info {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 11px;
  justify-content: flex-end;
  width: 100%;
}

.sticky-info-icon {
  font-size: 10px;
}

.sticky-time,
.sticky-duration,
.sticky-turns,
.sticky-usage {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #71717A;
}

.sticky-duration.streaming {
  color: #A78BFA;
  background: #1E1B4B;
}

/* 滚动到提问按钮 */
.scroll-up-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #71717A;
  cursor: pointer;
  transition: all 0.15s;
  margin-left: 4px;
}

.scroll-up-btn:hover {
  background: rgba(113, 113, 122, 0.2);
  color: #A1A1AA;
}

/* 折叠时的文本：单行截断 */
.sticky-text {
  font-size: 13px;
  color: #F1F5F9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 300px;
  cursor: text;
}

/* 展开时的文本：Markdown 渲染，添加滚动条 */
.sticky-text-md {
  font-size: 13px;
  color: #F1F5F9;
  word-break: break-word;
  max-height: calc(var(--max-height, 300px) - 80px);
  overflow-y: auto;
  width: 100%;
  position: relative;
  cursor: text;
}

/* 复制按钮定位到右上角 */
.sticky-text-md :deep(.copy-btn) {
  position: absolute;
  top: 2px;
  right: 2px;
  opacity: 0;
  z-index: 10;
}

.sticky-text-md:hover :deep(.copy-btn) {
  opacity: 0.6;
}

.sticky-text-md :deep(.copy-btn:hover) {
  opacity: 1;
}
</style>
