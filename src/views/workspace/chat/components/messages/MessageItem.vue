<script setup>
/**
 * MessageItem - 单个消息封装组件
 * 封装消息的通用结构：头像、统计信息、思考过程、点击处理、折叠占位符
 * 具体内容通过插槽或子组件渲染
 */
import { computed } from 'vue'
import MessageStats from './MessageStats.vue'
import ToolUseMessage from './ToolUseMessage.vue'
import UserMessage from './UserMessage.vue'
import AssistantMessage from './AssistantMessage.vue'
import ThinkingSection from './ThinkingSection.vue'
import QuestionMessage from './QuestionMessage.vue'
import RewindNoticeMessage from './RewindNoticeMessage.vue'
import UnknownMessage from './UnknownMessage.vue'
import { useMessageList } from '../composables/useMessageList'
import { useMessage } from '../composables/useMessage'
import { useSessionStore } from '../../../../../stores/useSessionStore'

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  messageIndex: {
    type: Number,
    required: true
  },
  totalMessages: {
    type: Number,
    default: 0
  },
  workingDirectory: {
    type: String,
    default: ''
  },
  currentTime: {
    type: Number,
    default: null
  },
  allMessages: {
    type: Array,
    default: () => []
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

// 使用 composables
const {
  toggleRewindCollapse,
  isRewindCollapsed,
  getQuestionActiveTab,
  handleQuestionSwitchTab,
  toggleQuestionCollapse,
  isQuestionCollapsed,
  handleToolToggleCollapse,
  toggleThinkingCollapse,
  getResponseCollapseState,
  toggleResponseCollapse,
  isLastUserMessage,
  openActionMenuIndex,
  toggleActionMenu
} = useMessageList()

const { copiedMessageIndex, copyToClipboard } = useMessage()
const sessionStore = useSessionStore()

// ============ 计算属性 ============

// 是否有回答（检查下一条消息是否是 assistant）
const hasAssistantResponse = computed(() => {
  if (props.message.role !== 'user') return false
  const nextMessage = props.allMessages[props.messageIndex + 1]
  return nextMessage?.role === 'assistant'
})

// 是否显示折叠按钮（有回答就显示）
const showCollapseBtn = computed(() => hasAssistantResponse.value)

// 是否显示撤销菜单（有回答、不是最后一条、不在处理中）
const showRewindBtn = computed(() => {
  if (!hasAssistantResponse.value) return false
  if (props.messageIndex >= props.totalMessages - 1) return false
  if (!props.message.id) return false
  // 检查是否正在处理中
  return !sessionStore.isProcessing
})

// 是否因为前面的用户消息回答被折叠而应该隐藏
const shouldHide = computed(() => {
  if (props.message.role === 'user') return false
  const { collapsed } = getResponseCollapseState(props.allMessages, props.messageIndex)
  return collapsed
})

// 是否显示折叠的回答占位符
const showCollapsedPlaceholder = computed(() => {
  return props.message.role === 'user' && props.message.responseCollapsed
})

// 是否是一轮新问答的开始（用户消息且不是第一条）
const isNewTurn = computed(() => {
  return props.message.role === 'user' && props.messageIndex > 0
})

// 头像字符
const avatarChar = computed(() => {
  switch (props.message.role) {
    case 'user': return 'U'
    case 'assistant': return 'C'
    case 'tool_use': return 'T'
    case 'question': return '?'
    default: return 'S'
  }
})

// 是否显示头像（统一由 MessageItem 处理）
const showAvatar = computed(() => {
  return props.message.role !== 'status' &&
         props.message.role !== 'system' &&
         !(props.message.role === 'system' && props.message.subtype === 'rewind-notice')
})

// 判断是否是最后一条用户消息（用于显示实时耗时）
const isLastUserMsg = computed(() => {
  return isLastUserMessage(props.allMessages, props.messageIndex)
})

// 是否显示 streaming 状态的耗时
const isStreaming = computed(() => {
  const msg = props.message
  if (msg.role === 'assistant') return !!msg.isStreaming
  if (msg.role === 'tool_use') return !!msg.isExecuting
  // 用户消息：最后一条且没有 duration 时显示实时耗时
  if (msg.role === 'user') return isLastUserMsg.value && !msg.duration && !!msg.startTime
  return false
})

// 是否显示思考过程
const showThinking = computed(() => {
  return props.message.hasThinking && props.message.thinking
})

// 思考过程是否折叠
const isThinkingCollapsed = computed(() => {
  return props.message.thinkingCollapsed !== false // 默认折叠
})

// ============ 事件处理 ============

function handleMessageClick(event) {
  emit('messageClick', { event, message: props.message })
}

function handleRewind(messageId, messageIndex) {
  emit('rewind', { messageId, messageIndex })
}

function handleFork(messageId, messageIndex) {
  emit('fork', { messageId, messageIndex })
}

function handleRewindAndFork(messageId, messageIndex) {
  emit('rewindAndFork', { messageId, messageIndex })
}

function handleRewindNoticeClick(rewindToMessageId) {
  emit('jumpToMessage', rewindToMessageId)
}

async function copyMessageContent(index) {
  const message = props.allMessages[index]
  if (message) {
    await copyToClipboard(message.content, index)
    emit('copyContent', { index, content: message.content })
  }
}

async function copyQuestionContent(index) {
  const message = props.allMessages[index]
  if (message && message.questions) {
    const content = message.questions.map(q =>
      `${q.header}: ${q.selectedAnswer || '未选择'}`
    ).join('\n')
    await copyToClipboard(content, index)
    emit('copyQuestionContent', { index, content })
  }
}

async function copyThinkingContent(index) {
  const message = props.allMessages[index]
  if (message && message.thinking) {
    await copyToClipboard(message.thinking, index)
  }
}

function onQuestionSwitchTab({ messageIndex, tabIndex }) {
  handleQuestionSwitchTab(messageIndex, tabIndex)
}

function onToggleQuestionCollapse(messageIndex) {
  toggleQuestionCollapse(props.allMessages, messageIndex)
}

function onToggleResponseCollapse(messageIndex) {
  toggleResponseCollapse(props.allMessages, messageIndex)
}

function onToggleThinkingCollapse(messageIndex) {
  const message = props.allMessages[messageIndex]
  toggleThinkingCollapse(message)
}

function onToolToggleCollapse(message) {
  handleToolToggleCollapse(message)
}

function onToggleRewindCollapse(messageId) {
  toggleRewindCollapse(messageId)
}

function onToggleActionMenu(index) {
  toggleActionMenu(index)
}
</script>

<template>
  <!-- 消息主体 -->
  <div
    v-if="!shouldHide"
    class="message"
    :class="[message.role, { 'new-turn': isNewTurn }]"
    :data-index="messageIndex"
    :data-message-id="message.id"
    @click="handleMessageClick"
  >
    <!-- 非用户消息：头像在左边 -->
    <div v-if="showAvatar && message.role !== 'user'" class="message-avatar">
      {{ avatarChar }}
    </div>

    <!-- 消息内容区域 -->
    <div class="message-body">
      <!-- 统一的统计信息（在气泡外部） -->
      <div class="message-stats-header">
        <MessageStats
          :timestamp="message.timestamp"
          :duration="message.duration"
          :start-time="(message.role === 'user' && isLastUserMsg && !message.duration) ? message.startTime : message.startTime"
          :current-time="currentTime"
          :is-streaming="isStreaming"
          :num-turns="message.numTurns"
          :usage="message.usage"
        />
      </div>

      <!-- Tool use 消息 -->
      <template v-if="message.role === 'tool_use'">
        <ToolUseMessage
          :tool-name="message.toolName"
          :tool-input="message.toolInput"
          :result="message.result"
          :is-error="message.isError"
          :is-executing="message.isExecuting"
          :collapsed="message.collapsed"
          :working-directory="workingDirectory"
          :is-partial="message.isExecuting && Object.keys(message.toolInput || {}).length === 0"
          :raw-messages="message.rawMessages || []"
          @toggle-collapse="() => onToolToggleCollapse(message)"
        />
      </template>

      <!-- Rewind notice 消息 -->
      <template v-else-if="message.role === 'system' && message.subtype === 'rewind-notice'">
        <RewindNoticeMessage
          :message="message"
          :is-collapsed="isRewindCollapsed(message.id)"
          @toggle-collapse="onToggleRewindCollapse"
          @jump-to-message="handleRewindNoticeClick"
        />
      </template>

      <!-- Question 消息 -->
      <template v-else-if="message.role === 'question'">
        <QuestionMessage
          :message="message"
          :message-index="messageIndex"
          :is-collapsed="isQuestionCollapsed(message)"
          :active-tab="getQuestionActiveTab(messageIndex)"
          :copied-message-index="copiedMessageIndex"
          @toggle-collapse="onToggleQuestionCollapse"
          @copy-content="copyQuestionContent"
          @switch-tab="onQuestionSwitchTab"
        />
      </template>

      <!-- Unknown 消息 -->
      <template v-else-if="message.role === 'unknown'">
        <UnknownMessage
          :message="message"
          :message-index="messageIndex"
          :copied-message-index="copiedMessageIndex"
          @copy-content="copyMessageContent"
        />
      </template>

      <!-- User 消息 -->
      <template v-else-if="message.role === 'user'">
        <UserMessage
          :message="message"
          :message-index="messageIndex"
          :copied-message-index="copiedMessageIndex"
          @copyContent="copyMessageContent"
        />
      </template>

      <!-- Assistant 消息 -->
      <template v-else-if="message.role === 'assistant'">
        <div class="assistant-content-wrapper">
          <!-- 思考过程 -->
          <ThinkingSection
            v-if="showThinking"
            :thinking="message.thinking"
            :is-collapsed="isThinkingCollapsed"
            :message-index="messageIndex"
            :copied-message-index="copiedMessageIndex"
            @toggle-collapse="() => onToggleThinkingCollapse(messageIndex)"
            @copy-content="copyThinkingContent"
          />
          <AssistantMessage
            :message="message"
            :message-index="messageIndex"
            :copied-message-index="copiedMessageIndex"
            @copyContent="copyMessageContent"
          />
        </div>
      </template>

      <!-- Status/System 消息 -->
      <template v-else>
        <div class="message-content" :class="{ 'status-content': message.role === 'status' }">
          <div
            v-if="message.content && !(message.role === 'system' && message.subtype === 'rewind-notice')"
            class="message-text"
            :class="{ 'status-text': message.role === 'status' }"
          >
            <div v-if="message.role !== 'assistant' && message.role !== 'system'">{{ message.content }}</div>
          </div>
          <div class="message-time" v-if="message.role !== 'status' && message.role !== 'assistant' && message.role !== 'user'">
            {{ new Date(message.timestamp).toLocaleTimeString() }}
          </div>
        </div>
      </template>
    </div>

    <!-- 用户消息右侧：头像 + 操作按钮 -->
    <div v-if="showAvatar && message.role === 'user'" class="user-right-column">
      <div class="message-avatar">
        {{ avatarChar }}
      </div>
      <div class="user-action-buttons">
        <!-- 展开/折叠回答按钮 -->
        <button
          v-if="showCollapseBtn"
          class="icon-action-btn"
          @click.stop="onToggleResponseCollapse(messageIndex)"
          :title="message.responseCollapsed ? '展开回答' : '折叠回答'"
        >
          <svg v-if="message.responseCollapsed" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="15 3 21 3 21 9"></polyline>
            <polyline points="9 21 3 21 3 15"></polyline>
            <line x1="21" y1="3" x2="14" y2="10"></line>
            <line x1="3" y1="21" x2="10" y2="14"></line>
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="4 14 10 14 10 20"></polyline>
            <polyline points="20 10 14 10 14 4"></polyline>
            <line x1="14" y1="10" x2="21" y2="3"></line>
            <line x1="3" y1="21" x2="10" y2="14"></line>
          </svg>
        </button>
        <!-- 操作菜单按钮 -->
        <div v-if="showRewindBtn" class="action-menu-wrapper" @click.stop>
          <button
            class="icon-action-btn rewind-btn"
            :class="{ active: openActionMenuIndex === messageIndex }"
            @click="onToggleActionMenu(messageIndex)"
            title="更多操作"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
              <path d="M3 3v5h5"></path>
            </svg>
          </button>
          <!-- 下拉菜单 -->
          <div v-if="openActionMenuIndex === messageIndex" class="action-dropdown-menu">
            <button class="menu-item rewind-item" @click="handleRewind(message.id, messageIndex)">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                <path d="M3 3v5h5"></path>
              </svg>
              还原
              <span class="menu-hint">撤销后续修改</span>
            </button>
            <button class="menu-item fork-item" @click="handleFork(message.id, messageIndex)">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="6" y1="3" x2="6" y2="15"></line>
                <circle cx="18" cy="6" r="3"></circle>
                <circle cx="6" cy="18" r="3"></circle>
                <path d="M18 9a9 9 0 0 1-9 9"></path>
              </svg>
              创建分支
              <span class="menu-hint">保留当前状态</span>
            </button>
            <button class="menu-item rewind-fork-item" @click="handleRewindAndFork(message.id, messageIndex)">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                <path d="M3 3v5h5"></path>
                <line x1="6" y1="8" x2="6" y2="16"></line>
                <circle cx="16" cy="10" r="3"></circle>
                <circle cx="6" cy="18" r="3"></circle>
                <path d="M16 13a6 6 0 0 1-6 5"></path>
              </svg>
              还原并创建分支
              <span class="menu-hint">保存并回滚</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- 折叠的回答占位符 -->
  <div
    v-if="showCollapsedPlaceholder"
    class="collapsed-response-placeholder"
    @click="onToggleResponseCollapse(messageIndex)"
  >
    <span class="collapsed-icon">▶</span>
    <span class="collapsed-text">回答已折叠，点击展开</span>
  </div>
</template>

<style scoped>
.message {
  display: flex;
  margin-bottom: 16px;
  gap: 12px;
  transition: opacity 0.15s;
}

.message.user {
  justify-content: flex-end;
  padding-left: 48px;  /* 留出左侧空间，与回答消息的头像区域对齐 */
}

/* 每轮新问答之间增加间距 */
.message.new-turn {
  margin-top: 60px;
}

.message.user .message-body {
  align-items: flex-end;
  flex: 1;
  max-width: calc(100% - 48px);  /* 减去右侧列宽度(36px) + 间距(12px) */
  overflow: hidden;
}

/* 用户消息右侧列：头像 + 操作按钮 */
.user-right-column {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  width: 36px;  /* 固定宽度，与头像宽度一致 */
}

.user-action-buttons {
  display: flex;
  flex-direction: row;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.15s;
  width: 100%;  /* 占满父容器宽度 */
  justify-content: center;  /* 按钮居中 */
}

/* hover 整个消息行时显示操作按钮 */
.message.user:hover .user-action-buttons {
  opacity: 1;
}

.icon-action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #52525B;
  cursor: pointer;
  transition: all 0.15s;
}

.icon-action-btn:hover {
  background: rgba(82, 82, 91, 0.3);
  color: #A1A1AA;
}

.icon-action-btn.rewind-btn:hover,
.icon-action-btn.rewind-btn.active {
  background: rgba(245, 158, 11, 0.15);
  color: #F59E0B;
}

/* 操作菜单容器 */
.action-menu-wrapper {
  position: relative;
}

.action-dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: #1E1E1E;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  box-shadow: 0 10px 15px rgba(0, 0, 0, 0.5);
  min-width: 180px;
  z-index: 100;
  overflow: hidden;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  background: transparent;
  border: none;
  color: #A1A1AA;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
}

.menu-item:hover {
  background: #3F3F46;
  color: #E4E4E7;
}

.menu-hint {
  margin-left: auto;
  font-size: 11px;
  color: #71717A;
}

.rewind-item {
  color: #F59E0B;
}

.rewind-item:hover {
  background: rgba(245, 158, 11, 0.1);
}

.fork-item {
  color: #3B82F6;
}

.fork-item:hover {
  background: rgba(59, 130, 246, 0.1);
}

.rewind-fork-item {
  color: #8B5CF6;
}

.rewind-fork-item:hover {
  background: rgba(139, 92, 246, 0.1);
}

.message-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  flex-shrink: 0;
}

.message.user .message-avatar {
  background: #3F3F46;
}

.message.assistant .message-avatar {
  background: #F97316;
}

.message.system .message-avatar {
  background: #6366F1;
}

.message.question .message-avatar {
  background: #059669;
}

.message.question .message-body {
  flex: 1;
}

.message.tool_use .message-avatar {
  background: #3B82F6;
}

.message-body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Assistant 内容包装器：thinking 和 message 共享宽度 */
.assistant-content-wrapper {
  width: fit-content;
  max-width: calc(100% - 48px);  /* 减去左侧头像宽度(36px) + 间距(12px) */
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.assistant-content-wrapper > * {
  width: 100%;
}

/* 统一的统计信息头部（在气泡外部） */
.message-stats-header {
  display: flex;
  align-items: center;
  gap: 12px;
}

.message-content {
  grid-column: 2;
}

.message-content.status-content {
  grid-column: 1 / -1;
  text-align: center;
}

.message-text {
  padding: 12px 16px;
  border-radius: 8px;
  line-height: 1.5;
  overflow-x: auto;
  position: relative;
  cursor: text;
}

.message-text.status-text {
  padding: 4px 8px;
  font-size: 11px;
  color: #71717A;
  background: transparent;
}

.message-time {
  font-size: 11px;
  color: #71717A;
  margin-top: 4px;
}

.collapsed-response-placeholder {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: #18181B;
  border-bottom: 1px solid #27272A;
  cursor: pointer;
  font-size: 11px;
  color: #71717A;
  transition: all 0.15s;
}

.collapsed-response-placeholder:hover {
  background: #27272A;
  color: #A1A1AA;
}

.collapsed-icon {
  font-size: 10px;
}

.collapsed-text {
  flex: 1;
}
</style>
