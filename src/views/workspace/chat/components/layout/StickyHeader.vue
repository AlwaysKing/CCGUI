<script setup>
/**
 * StickyHeader - 粘性头部组件
 * 显示当前正在流式输出的消息，浮动在聊天内容上方
 */
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import CopyButton from '../ui/CopyButton.vue'
import MarkdownRenderer from '@/components/base/MarkdownRenderer.vue'

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
  rightInset: {
    type: Number,
    default: 0
  },
  contentWidth: {
    type: Number,
    default: 0
  },
  isCopied: {
    type: Boolean,
    default: false
  },
  userQuestions: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['copy', 'scrollToUser', 'jumpToQuestion'])

const stickyHeaderRef = ref(null)
const questionListRef = ref(null)
const showQuestionList = ref(false)

const activeQuestionId = computed(() => props.message?.id || '')
const questionCount = computed(() => props.userQuestions.length)

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
  return !props.message.duration && !!props.isProcessing && !!props.message.startTime && !!props.currentTime
})

// CSS 变量
const cssMaxHeight = computed(() => `${props.containerHeight * 0.5}px`)
const cssRightInset = computed(() => `${props.rightInset}px`)
const cssContentWidth = computed(() => props.contentWidth > 0 ? `${props.contentWidth}px` : '100%')
function copyContent() {
  emit('copy')
}

function scrollToUserMessage() {
  emit('scrollToUser')
}

function closeQuestionList() {
  showQuestionList.value = false
}

async function toggleQuestionList() {
  showQuestionList.value = !showQuestionList.value
  if (!showQuestionList.value) {
    return
  }

  await nextTick()
  questionListRef.value
    ?.querySelector('.question-list-item.active')
    ?.scrollIntoView({ block: 'nearest' })
}

function jumpToQuestion(question) {
  if (!question?.id) {
    return
  }
  closeQuestionList()
  emit('jumpToQuestion', question.id)
}

function handleDocumentPointerDown(event) {
  if (!showQuestionList.value) {
    return
  }
  if (stickyHeaderRef.value?.contains(event.target)) {
    return
  }
  closeQuestionList()
}

function handleDocumentKeydown(event) {
  if (event.key === 'Escape') {
    closeQuestionList()
  }
}

onMounted(() => {
  document.addEventListener('mousedown', handleDocumentPointerDown)
  document.addEventListener('keydown', handleDocumentKeydown)
})

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleDocumentPointerDown)
  document.removeEventListener('keydown', handleDocumentKeydown)
})
</script>

<template>
  <div ref="stickyHeaderRef" class="sticky-header" :style="{ '--right-inset': cssRightInset }">
    <div
      class="sticky-content"
      :class="{ 'question-list-mode': showQuestionList }"
      :style="{ '--max-height': cssMaxHeight, '--content-width': cssContentWidth }"
    >
      <!-- 提问导航状态：原浮窗切换为全部提问 -->
      <div v-if="showQuestionList" class="sticky-question-mode">
        <div class="sticky-info question-list-toolbar">
          <div class="question-list-heading">
            <span>我的提问</span>
            <span class="question-list-count">{{ questionCount }}</span>
          </div>
          <div class="sticky-actions">
            <button
              class="question-nav-btn active"
              @click.stop="toggleQuestionList"
              title="返回消息预览"
              aria-label="返回消息预览"
              :aria-expanded="true"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="7 9 12 4 17 9"></polyline>
                <polyline points="7 15 12 20 17 15"></polyline>
              </svg>
            </button>
            <button class="scroll-up-btn" @click="scrollToUserMessage" title="滚动到当前提问">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"></line>
                <polyline points="5 12 12 5 19 12"></polyline>
              </svg>
            </button>
          </div>
        </div>
        <div ref="questionListRef" class="question-list-scroll">
          <button
            v-for="(question, index) in userQuestions"
            :key="question.id"
            class="question-list-item"
            :class="{ active: question.id === activeQuestionId }"
            :title="question.content"
            @click="jumpToQuestion(question)"
          >
            <span class="question-list-index">{{ index + 1 }}</span>
            <span class="question-list-text">{{ question.content }}</span>
          </button>
        </div>
      </div>

      <!-- 折叠状态：简单信息 -->
      <div v-else class="sticky-collapsed">
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
          <div class="sticky-actions">
            <button
              class="question-nav-btn"
              :class="{ active: showQuestionList }"
              @click.stop="toggleQuestionList"
              title="展示所有我的提问"
              aria-label="展示所有我的提问"
              :aria-expanded="showQuestionList"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="7 9 12 4 17 9"></polyline>
                <polyline points="7 15 12 20 17 15"></polyline>
              </svg>
            </button>
            <button class="scroll-up-btn" @click="scrollToUserMessage" title="滚动到提问">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"></line>
                <polyline points="5 12 12 5 19 12"></polyline>
              </svg>
            </button>
          </div>
        </div>
        <div class="sticky-text">{{ message.content }}</div>
      </div>

      <!-- 展开状态：Markdown 渲染 -->
      <div v-if="!showQuestionList" class="sticky-expanded">
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
          <div class="sticky-actions">
            <button
              class="question-nav-btn"
              :class="{ active: showQuestionList }"
              @click.stop="toggleQuestionList"
              title="展示所有我的提问"
              aria-label="展示所有我的提问"
              :aria-expanded="showQuestionList"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="7 9 12 4 17 9"></polyline>
                <polyline points="7 15 12 20 17 15"></polyline>
              </svg>
            </button>
            <button class="scroll-up-btn" @click="scrollToUserMessage" title="滚动到提问">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <line x1="12" y1="19" x2="12" y2="5"></line>
                <polyline points="5 12 12 5 19 12"></polyline>
              </svg>
            </button>
          </div>
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
/* 粘性头部 - 绝对定位浮动在聊天内容上方 */
.sticky-header {
  position: absolute;
  top: 2px;
  left: 48px;
  right: 0;
  z-index: 50;
  display: flex;
  justify-content: flex-end;
  padding-right: 16px;
  pointer-events: auto;
}

.sticky-content {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  background: rgba(24, 24, 27, 0.92);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 12px;
  padding: 4px 12px;
  max-width: min(70%, var(--content-width, 100%));
  flex-direction: column;
  gap: 4px;
  box-shadow: 0 10px 24px rgba(0, 0, 0, 0.22);
  backdrop-filter: blur(12px);
  transition: background 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
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
  scrollbar-width: thin;
  scrollbar-color: #52525B transparent;
}

/* 悬停时：隐藏折叠，显示展开 */
.sticky-content:hover .sticky-collapsed {
  display: none;
}

.sticky-content:hover {
  background: rgba(30, 30, 30, 0.98);
  border-color: rgba(255, 255, 255, 0.18);
  max-width: none;
  max-height: var(--max-height, 300px);
  padding: 4px 12px;
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.28);
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
  color: #A1A1AA;
}

.sticky-duration.streaming {
  color: #A78BFA;
}

.sticky-actions {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  flex-shrink: 0;
  margin-left: 4px;
}

/* 顶部操作按钮 */
.scroll-up-btn,
.question-nav-btn {
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
}

.scroll-up-btn:hover,
.question-nav-btn:hover,
.question-nav-btn.active {
  background: rgba(255, 255, 255, 0.08);
  color: #E4E4E7;
}

.sticky-content.question-list-mode,
.sticky-content.question-list-mode:hover {
  width: min(520px, var(--content-width, 100%));
  max-width: min(520px, var(--content-width, 100%));
  max-height: var(--max-height, 300px);
}

.sticky-question-mode {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;
  min-height: 0;
  max-height: calc(var(--max-height, 300px) - 8px);
  overflow: hidden;
}

.question-list-toolbar {
  justify-content: flex-start;
}

.question-list-heading {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-right: auto;
  color: #E4E4E7;
  font-size: 12px;
  font-weight: 600;
}

.question-list-count {
  min-width: 20px;
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
  color: #A1A1AA;
  font-size: 10px;
  font-weight: 500;
  text-align: center;
}

.question-list-scroll {
  display: flex;
  flex-direction: column;
  gap: 2px;
  width: 100%;
  min-height: 0;
  max-height: calc(var(--max-height, 300px) - 42px);
  padding: 2px 0 4px;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: #52525B transparent;
}

.question-list-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  padding: 8px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #D4D4D8;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.question-list-item:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #F4F4F5;
}

.question-list-item.active {
  background: rgba(249, 115, 22, 0.14);
  color: #FDBA74;
}

.question-list-index {
  flex-shrink: 0;
  min-width: 20px;
  padding-top: 1px;
  color: #71717A;
  font-size: 10px;
  text-align: right;
}

.question-list-item.active .question-list-index {
  color: #F97316;
}

.question-list-text {
  min-width: 0;
  overflow: hidden;
  font-size: 12px;
  line-height: 1.45;
  text-overflow: ellipsis;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
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
  max-height: none;
  overflow: visible;
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

<style>
.sticky-header .sticky-expanded::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}

.sticky-header .sticky-expanded::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 999px;
}

.sticky-header .sticky-expanded::-webkit-scrollbar-thumb {
  background: #52525B;
  border-radius: 999px;
  border: none;
}

.sticky-header .sticky-expanded::-webkit-scrollbar-thumb:hover {
  background: #71717A;
}
</style>
