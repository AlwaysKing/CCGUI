<script setup>
/**
 * MessageItem - 单个消息封装组件
 * 封装消息的通用结构：头像、统计信息、思考过程、点击处理、折叠占位符
 * 具体内容通过插槽或子组件渲染
 */
import { computed, nextTick, onMounted, onUnmounted, ref, useSlots, watch } from 'vue'
import MessageStats from './MessageStats.vue'
import ToolUseMessage from './ToolUseMessage.vue'
import DiffMessage from './DiffMessage.vue'
import UserMessage from './UserMessage.vue'
import AssistantMessage from './AssistantMessage.vue'
import ThinkingSection from './ThinkingSection.vue'
import QuestionMessage from './QuestionMessage.vue'
import RewindNoticeMessage from './RewindNoticeMessage.vue'
import PermissionResultMessage from './PermissionResultMessage.vue'
import UnknownMessage from './UnknownMessage.vue'
import SystemNotificationMessage from './SystemNotificationMessage.vue'
import FileChangeSummaryMessage from './FileChangeSummaryMessage.vue'
import TaskCompleteMessage from './TaskCompleteMessage.vue'
import { useMessageList } from '../../composables/useMessageList'
import { useMessage } from '../../composables/useMessage'
import { useSessionStore } from '../../../../../stores/useSessionStore'
import { openAppErrorDialog } from '../../../../../utils/appErrorDialog'

const TOOL_AVATAR_ICONS = {
  Bash: '>',
  Read: '📘',
  Edit: '✏️',
  ApplyPatch: '🩹',
  Diff: '🩹',
  Write: '📝',
  Glob: '🔍',
  Grep: '🔎',
  Agent: '🤖',
  TaskOutput: '📋',
  TaskStop: '⏹️',
  WebSearch: '🌐',
  ViewImage: '🖼️',
  GenerateImage: '🎨',
  ClientToolCall: '🧩',
  RequestPermissions: '🔐',
  SendMessage: '✉️',
  TeamCreate: '👥',
  TeamDelete: '👥',
  AskUserQuestion: '❓',
  EnterPlanMode: '📋',
  EnterWorktree: '🌳',
  TodoWrite: '✅',
  Skill: '🛠'
}

function isTurnMessageRole(role = '') {
  return role === 'user' || role === 'command'
}

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
  },
  sessionId: {
    type: String,
    default: ''
  },
  chatTheme: {
    type: Object,
    default: () => ({})
  },
  paneWidth: {
    type: Number,
    default: 0
  },
  externalizeThinking: {
    type: Boolean,
    default: false
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

const slots = useSlots()
const toolbarMenuTrigger = ref(null)
const toolbarMenuStyle = ref({})

// 使用 composables
const {
  findAssistantResponse,
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
  toggleActionMenu,
  closeActionMenu
} = useMessageList()

const { copiedMessageIndex, copyToClipboard } = useMessage()
const sessionStore = useSessionStore()
const dialogOnlyErrorShown = ref(false)

function isDialogOnlyTurnError(message) {
  if (message?.role !== 'system_notification' || message?.notificationType !== 'turn-error') {
    return false
  }

  const errorText = typeof message?.data?.message === 'string' ? message.data.message : ''
  if (!errorText) {
    return false
  }

  return [
    '撤销本次修改失败',
    '重做本次修改失败',
    '重置文件失败',
    '撤销本次修改并创建分支失败',
    '重置文件并创建分支失败',
    '创建分支失败',
    '获取预览失败',
    '发送消息失败'
  ].some(keyword => errorText.includes(keyword))
}

function maybeShowDialogOnlyTurnError() {
  if (dialogOnlyErrorShown.value || !isDialogOnlyTurnError(props.message)) {
    return
  }

  dialogOnlyErrorShown.value = true
  const rawMessage = typeof props.message?.data?.message === 'string'
    ? props.message.data.message.trim()
    : '操作失败'
  const [titleLine, ...detailLines] = rawMessage.split('\n').filter(Boolean)
  openAppErrorDialog({
    title: titleLine || '操作失败',
    message: titleLine || '操作未完成',
    detail: detailLines.join('\n') || rawMessage
  })
}

// ============ 计算属性 ============

// 是否因为前面的用户消息回答被折叠而应该隐藏
const shouldHide = computed(() => {
  if (isDialogOnlyTurnError(props.message)) {
    return true
  }
  // 已合并到 task_complete 的 TaskOutput tool_use 隐藏
  if (props.message.mergedIntoTaskComplete) {
    return true
  }
  if (props.message.role === 'system' && props.message.subtype === 'rewind-notice') {
    return false
  }
  if (
    props.message.role === 'status' ||
    props.message.role === 'task_complete' ||
    props.message.role === 'file_change_summary'
  ) {
    return false
  }
  if (props.message.role === 'system_notification') {
    return props.message.scope !== 'session'
      ? getResponseCollapseState(props.allMessages, props.messageIndex).collapsed
      : false
  }
  if (isTurnMessageRole(props.message.role)) return false
  const { collapsed } = getResponseCollapseState(props.allMessages, props.messageIndex)
  return collapsed
})

// 是否是一轮新问答的开始（用户消息且不是第一条）
const isNewTurn = computed(() => {
  return isTurnMessageRole(props.message.role) && props.messageIndex > 0
})

const responsiveMessageWidthStyle = computed(() => {
  const paneWidth = Number(props.paneWidth) || 0
  if (paneWidth <= 0) {
    return null
  }

  let targetWidth = paneWidth
  if (paneWidth > 300 && paneWidth < 400) {
    const ratio = 1 - 0.3 * ((paneWidth - 300) / 100)
    targetWidth = paneWidth * ratio
  } else if (paneWidth >= 400) {
    targetWidth = paneWidth * 0.7
  }

  const safeTargetWidth = Math.max(0, Math.min(targetWidth, paneWidth))
  const cssWidth = `min(100%, ${safeTargetWidth}px)`

  return {
    '--ccgui-message-max-width': cssWidth,
    '--ccgui-message-fill-width': cssWidth,
    '--ccgui-message-ghost-max-width': cssWidth
  }
})

const avatarMode = computed(() => props.chatTheme?.avatarMode || 'large')
const effectiveAvatarMode = computed(() => {
  if ((props.chatTheme?.messageSurface || 'bubble') === 'ghost' && avatarMode.value === 'large') {
    return 'small'
  }
  return avatarMode.value
})

const usesToolAvatarIcon = computed(() => {
  return props.message.role === 'tool_use' || props.message.role === 'diff' || props.message.role === 'task_complete'
})

// 头像字符
const avatarChar = computed(() => {
  if (props.message.subtype === 'execution-card') {
    return '🤖'
  }
  // rewind-notice 特殊头像
  if (props.message.role === 'system' && props.message.subtype === 'rewind-notice') {
    return '↩'
  }
  // interrupt 特殊头像
  if (props.message.role === 'system' && props.message.subtype === 'interrupt') {
    return '⏹'
  }
  // permission_result 特殊头像：根据内容显示勾或叉
  if (props.message.role === 'permission_result') {
    const content = props.message.content || ''
    return content.startsWith('✅') ? '✓' : '✗'
  }
  // unknown 消息头像
  if (props.message.role === 'unknown') {
    return '?'
  }
  if (props.message.role === 'tool_use') {
    return TOOL_AVATAR_ICONS[props.message.toolName] || '🔧'
  }
  if (props.message.role === 'diff') {
    return TOOL_AVATAR_ICONS.Diff
  }
  switch (props.message.role) {
    case 'user': return 'U'
    case 'command': return '/'
    case 'assistant': return 'C'
    case 'question': return '?'
    case 'task_complete': {
      const taskType = props.message.taskType
      if (taskType === 'local_agent') return '🤖'
      if (taskType === 'explore') return '🔍'
      if (taskType === 'plan') return '📋'
      return '⚙️'
    }
    default: return 'S'
  }
})

// 是否显示头像（统一由 MessageItem 处理）
const showAvatar = computed(() => {
  if (effectiveAvatarMode.value === 'none') {
    return false
  }
  // rewind-notice 需要显示头像
  if (props.message.role === 'system' && props.message.subtype === 'rewind-notice') {
    return false
  }
  // interrupt 需要显示头像
  if (props.message.role === 'system' && props.message.subtype === 'interrupt') {
    return true
  }
  // permission_result 需要显示头像
  if (props.message.role === 'permission_result') {
    return true
  }
  return props.message.role !== 'status' &&
         props.message.role !== 'system' &&
         props.message.role !== 'system_notification' &&
         props.message.role !== 'file_change_summary'
})

// 权限结果是否是拒绝
const isPermissionDenied = computed(() => {
  if (props.message.role !== 'permission_result') return false
  const content = props.message.content || ''
  return content.startsWith('❌')
})

// 判断是否是最后一条用户消息（用于显示实时耗时）
const isLastUserMsg = computed(() => {
  return isLastUserMessage(props.allMessages, props.messageIndex)
})

// 是否显示 streaming 状态的耗时
const isStreaming = computed(() => {
  const msg = props.message
  if (msg.role === 'assistant') return !!msg.isStreaming
  if (msg.role === 'tool_use' || msg.role === 'diff') return !!msg.isExecuting
  // 用户消息：最后一条且没有 duration 时显示实时耗时
  if (isTurnMessageRole(msg.role)) return isLastUserMsg.value && !msg.duration && !!msg.startTime
  return false
})

// 是否显示思考过程
const showThinking = computed(() => {
  return !props.externalizeThinking && props.message.hasThinking && props.message.thinking
})

const showAssistantMessage = computed(() => {
  if (props.message.role === 'assistant' && props.message.subtype === 'thinking') {
    return false
  }
  return Boolean(props.message.content || props.message.showTurnSeparator || props.message.isStreaming)
})

const isPlainSystemMessage = computed(() => {
  return props.message.role === 'system' &&
    props.message.subtype !== 'rewind-notice' &&
    props.message.subtype !== 'interrupt'
})

// 思考过程是否折叠
const isThinkingCollapsed = computed(() => {
  return props.message.thinkingCollapsed !== false // 默认折叠
})

const statusStyle = computed(() => props.chatTheme?.statusStyle || 'full')
const messageSpacing = computed(() => props.chatTheme?.messageSpacing || 'large')
const isFloatingStatus = computed(() => statusStyle.value === 'floating')

const showMessageStats = computed(() => {
  return props.message.role !== 'system_notification' &&
         props.message.role !== 'file_change_summary' &&
         !(props.message.role === 'system' && props.message.subtype === 'rewind-notice') &&
         statusStyle.value !== 'hidden'
})

const showTopStats = computed(() => showMessageStats.value && !isFloatingStatus.value)
const showTailStats = computed(() => false)
const showBottomStats = computed(() => false)
const showFloatingStats = computed(() => showMessageStats.value && isFloatingStatus.value)
const showUserRightColumn = computed(() => {
  return isTurnMessageRole(props.message.role) && showAvatar.value
})

const responseToolbarTarget = computed(() => {
  if (!isTurnMessageRole(props.message.role)) return null
  const response = findAssistantResponse(props.allMessages, props.messageIndex)
  return { message: props.message, index: props.messageIndex, response }
})

const showResponseToolbar = computed(() => {
  return true
})

const showResponseToolbarCollapseBtn = computed(() => Boolean(responseToolbarTarget.value?.response))
const isResponseCollapsed = computed(() => Boolean(responseToolbarTarget.value?.message?.responseCollapsed))
const responseToolbarLabel = computed(() => {
  if (!showResponseToolbarCollapseBtn.value) {
    return '没有回答'
  }
  return isResponseCollapsed.value ? '回答已折叠' : '折叠回答'
})

const sessionEnvInfo = computed(() => {
  if (!props.sessionId) {
    return sessionStore.currentSession?.envInfo || null
  }
  return sessionStore.sessions?.get(props.sessionId)?.envInfo || sessionStore.currentSession?.envInfo || null
})

const rewindCapabilities = computed(() => {
  const provider = sessionEnvInfo.value?.provider || 'claude'
  const fallbackCapabilities = provider === 'codex'
    ? { reset: false, patch: true, forkReset: false, forkPatch: false }
    : { reset: true, patch: false, forkReset: true, forkPatch: false }
  const capabilities = sessionEnvInfo.value?.rewindCapabilities || fallbackCapabilities
  return {
    reset: capabilities.reset === true,
    patch: capabilities.patch === true,
    forkReset: capabilities.forkReset === true,
    forkPatch: capabilities.forkPatch === true
  }
})

const hasRewindAction = computed(() => rewindCapabilities.value.reset || rewindCapabilities.value.patch)
const hasForkedRewindAction = computed(() => rewindCapabilities.value.forkReset)

const showResponseToolbarRewindBtn = computed(() => {
  const target = responseToolbarTarget.value
  if (!target) return false
  if (target.index >= props.totalMessages - 1) return false
  if (!target.message?.id) return false
  if (!hasRewindAction.value && !hasForkedRewindAction.value) return false
  return !sessionStore.isProcessing
})

const hasCustomContent = computed(() => Boolean(slots.default))

// ============ 事件处理 ============

function handleMessageClick(event) {
  emit('messageClick', { event, message: props.message })
}

function handleRewind(messageId, messageIndex, rewindMode = 'reset') {
  if ((rewindMode === 'reset' && !rewindCapabilities.value.reset) || (rewindMode === 'patch' && !rewindCapabilities.value.patch)) {
    return
  }
  closeActionMenu()
  emit('rewind', { messageId, messageIndex, rewindMode })
}

function handleFork(messageId, messageIndex) {
  closeActionMenu()
  emit('fork', { messageId, messageIndex })
}

function handleRewindAndFork(messageId, messageIndex, rewindMode = 'reset') {
  if (
    rewindMode !== 'reset' ||
    !rewindCapabilities.value.forkReset
  ) {
    return
  }
  closeActionMenu()
  emit('rewindAndFork', { messageId, messageIndex, rewindMode })
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

function setAllResponseCollapsed(nextCollapsed, { excludeIndex = null } = {}) {
  props.allMessages.forEach((message, index) => {
    if (!isTurnMessageRole(message?.role)) return
    if (!findAssistantResponse(props.allMessages, index)) return
    if (excludeIndex !== null && index === excludeIndex) return
    message.responseCollapsed = nextCollapsed
  })
}

async function onToggleResponseCollapse(messageIndex, event = null) {
  const message = props.allMessages[messageIndex]
  if (!message || !isTurnMessageRole(message.role)) {
    return
  }

  const nextCollapsed = !Boolean(message.responseCollapsed)
  const useGlobalMode = Boolean(event?.metaKey)
  const useOthersMode = useGlobalMode && Boolean(event?.altKey)

  if (useOthersMode) {
    setAllResponseCollapsed(nextCollapsed, { excludeIndex: messageIndex })
    return
  }

  if (useGlobalMode) {
    setAllResponseCollapsed(nextCollapsed)
    return
  }

  if (!nextCollapsed && message.historyTurn?.turnId && !message.historyTurn.loaded) {
    const ownerSession = props.sessionId
      ? sessionStore.sessions.get(props.sessionId)
      : (
          sessionStore.currentSession?.messages === props.allMessages
            ? sessionStore.currentSession
            : Array.from(sessionStore.sessions.values()).find(session => session?.messages === props.allMessages)
        )

    if (ownerSession?.id) {
      const result = await sessionStore.loadHistoryTurn(ownerSession.id, message.historyTurn.turnId, message.historyTurn)
      if (!result?.success) {
        return
      }
      return
    }
  }

  // 展开被释放的问答：从缓存中恢复响应消息
  if (!nextCollapsed && message._releasedResponses) {
    const ownerSession = props.sessionId
      ? sessionStore.sessions.get(props.sessionId)
      : sessionStore.currentSession

    if (ownerSession) {
      sessionStore.restoreReleasedTurn(ownerSession, message)
    }
  }

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

function setToolbarMenuTrigger(el) {
  toolbarMenuTrigger.value = el || null
}

function updateToolbarMenuPosition() {
  const trigger = toolbarMenuTrigger.value
  if (!trigger || openActionMenuIndex.value === -1) {
    return
  }

  const rect = trigger.getBoundingClientRect()
  const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0
  const padding = 12
  const menuWidth = Math.min(280, Math.max(220, viewportWidth - padding * 2))
  const left = Math.max(
    padding,
    Math.min(rect.right - menuWidth, viewportWidth - menuWidth - padding)
  )

  toolbarMenuStyle.value = {
    top: `${rect.bottom + 8}px`,
    left: `${left}px`
  }
}

// 点击外部关闭菜单
function handleGlobalClick(event) {
  if (openActionMenuIndex.value === -1) return
  const target = event.target
  const menuWrapper = target.closest('.action-menu-wrapper')
  const teleportedMenu = target.closest('.action-dropdown-menu--toolbar')
  if (!menuWrapper && !teleportedMenu) {
    closeActionMenu()
  }
}

function handleViewportChange() {
  if (openActionMenuIndex.value === -1) {
    return
  }
  updateToolbarMenuPosition()
}

watch(() => openActionMenuIndex.value, async (nextIndex) => {
  if (nextIndex === -1) {
    toolbarMenuStyle.value = {}
    return
  }

  await nextTick()
  updateToolbarMenuPosition()
})

onMounted(() => {
  maybeShowDialogOnlyTurnError()
  document.addEventListener('click', handleGlobalClick)
  window.addEventListener('resize', handleViewportChange)
  window.addEventListener('scroll', handleViewportChange, true)
})

onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick)
  window.removeEventListener('resize', handleViewportChange)
  window.removeEventListener('scroll', handleViewportChange, true)
})

watch(() => props.message, () => {
  maybeShowDialogOnlyTurnError()
}, { immediate: true })
</script>

<template>
  <!-- 消息主体 -->
  <div
    v-if="!shouldHide"
    class="message"
    :class="[
      message.role,
      message.subtype,
      `spacing-${messageSpacing}`,
      `avatar-${effectiveAvatarMode}`,
      `surface-${chatTheme.messageSurface || 'bubble'}`,
      {
        'new-turn': isNewTurn,
        'denied': isPermissionDenied,
        'no-avatar': !showAvatar,
        'with-response-toolbar': showResponseToolbar,
        'thinking-first': message.role === 'assistant' && showThinking,
        'tool-text-first': (message.role === 'tool_use' || message.role === 'diff') && (chatTheme.messageSurface || 'bubble') === 'ghost',
        'tool-avatar-icon': usesToolAvatarIcon,
        'read-avatar': message.role === 'tool_use' && message.toolName === 'Read'
      }
    ]"
    :style="responsiveMessageWidthStyle"
    :data-index="messageIndex"
    :data-message-id="message.id"
    @click="handleMessageClick"
  >
    <!-- 非用户消息：头像在左边 -->
    <div v-if="showAvatar && !isTurnMessageRole(message.role)" class="message-avatar">
      {{ avatarChar }}
    </div>

    <!-- 消息内容区域 -->
    <div class="message-body">
      <!-- 统一的统计信息（在气泡外部） - system_notification 不显示 -->
      <div v-if="showTopStats" class="message-stats-header">
        <MessageStats
          :timestamp="message.timestamp"
          :duration="message.duration"
          :start-time="(isTurnMessageRole(message.role) && isLastUserMsg && !message.duration) ? message.startTime : message.startTime"
          :current-time="currentTime"
          :is-streaming="isStreaming"
          :num-turns="message.numTurns"
          :usage="message.usage"
          :variant="statusStyle"
        />
      </div>

      <template v-if="hasCustomContent">
        <slot />
      </template>

      <!-- Tool use 消息 -->
      <template v-else-if="message.role === 'tool_use'">
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
          :chat-theme="chatTheme"
          @toggle-collapse="() => onToolToggleCollapse(message)"
        />
      </template>

      <template v-else-if="message.role === 'diff'">
        <DiffMessage
          :tool-name="message.toolName"
          :tool-input="message.toolInput"
          :result="message.result"
          :is-error="message.isError"
          :is-executing="message.isExecuting"
          :collapsed="message.collapsed"
          :working-directory="workingDirectory"
          :is-partial="message.isExecuting && Object.keys(message.toolInput || {}).length === 0"
          :raw-messages="message.rawMessages || []"
          :chat-theme="chatTheme"
          @toggle-collapse="() => onToolToggleCollapse(message)"
        />
      </template>

      <!-- Rewind notice 消息 -->
      <template v-else-if="message.role === 'system' && message.subtype === 'rewind-notice'">
        <RewindNoticeMessage
          :message="message"
          :is-collapsed="isRewindCollapsed(message.id)"
          :chat-theme="chatTheme"
          @toggle-collapse="onToggleRewindCollapse"
          @jump-to-message="handleRewindNoticeClick"
        />
      </template>

      <!-- Interrupt 消息 -->
      <template v-else-if="message.role === 'system' && message.subtype === 'interrupt'">
        <div class="interrupt-message">
          <span class="interrupt-icon">⏹</span>
          <span class="interrupt-text">{{ message.content }}</span>
        </div>
      </template>

      <!-- Permission result 消息 -->
      <template v-else-if="message.role === 'permission_result'">
        <PermissionResultMessage :message="message" :chat-theme="chatTheme" />
      </template>

      <!-- System notification 消息 -->
      <template v-else-if="message.role === 'system_notification'">
        <SystemNotificationMessage :message="message" />
      </template>

      <!-- File change summary 消息 -->
      <template v-else-if="message.role === 'file_change_summary'">
        <FileChangeSummaryMessage
          :message="message"
          :message-index="messageIndex"
          :can-patch-rewind="rewindCapabilities.patch"
          :rewind-busy="sessionStore.isProcessing"
          :chat-theme="chatTheme"
          @rewind="emit('rewind', $event)"
        />
      </template>

      <!-- Task complete 消息 -->
      <template v-else-if="message.role === 'task_complete'">
        <TaskCompleteMessage
          :message="message"
          :message-index="messageIndex"
          :copied-message-index="copiedMessageIndex"
          :chat-theme="chatTheme"
          @copy-content="copyMessageContent"
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
          :chat-theme="chatTheme"
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
          :chat-theme="chatTheme"
          @copy-content="copyMessageContent"
        />
      </template>

      <!-- User 消息 -->
      <template v-else-if="message.role === 'user' || message.role === 'command'">
        <div class="user-message-shell">
          <UserMessage
            :message="message"
            :message-index="messageIndex"
            :copied-message-index="copiedMessageIndex"
            :chat-theme="chatTheme"
            :variant="message.role === 'command' ? 'command' : 'user'"
            @copyContent="copyMessageContent"
          />
          <div v-if="message.role === 'user' && showResponseToolbarRewindBtn" class="user-action-overlay">
            <div class="action-menu-wrapper" @click.stop>
              <button
                :ref="setToolbarMenuTrigger"
                class="icon-action-btn rewind-btn user-action-btn"
                :class="{ active: openActionMenuIndex === responseToolbarTarget.index }"
                @click="onToggleActionMenu(responseToolbarTarget.index)"
                title="更多操作"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                  <path d="M3 3v5h5"></path>
                </svg>
              </button>
            </div>
          </div>
        </div>
        <Teleport v-if="message.role === 'user'" to="body">
          <div
            v-if="openActionMenuIndex === responseToolbarTarget.index"
            class="action-dropdown-menu action-dropdown-menu--toolbar"
            :style="toolbarMenuStyle"
            @click.stop
          >
            <button
              class="menu-item rewind-item"
              :disabled="!rewindCapabilities.reset"
              :class="{ disabled: !rewindCapabilities.reset }"
              @click="handleRewind(responseToolbarTarget.message.id, responseToolbarTarget.index, 'reset')"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                <path d="M3 3v5h5"></path>
              </svg>
              重置文件
              <span class="menu-hint">回到该次提问前</span>
            </button>
            <button
              class="menu-item rewind-item"
              :disabled="!rewindCapabilities.patch"
              :class="{ disabled: !rewindCapabilities.patch }"
              @click="handleRewind(responseToolbarTarget.message.id, responseToolbarTarget.index, 'patch')"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                <path d="M3 3v5h5"></path>
              </svg>
              撤销本次修改
              <span class="menu-hint">仅撤销本轮补丁</span>
            </button>
            <button class="menu-item fork-item" @click="handleFork(responseToolbarTarget.message.id, responseToolbarTarget.index)">
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="6" y1="3" x2="6" y2="15"></line>
                <circle cx="18" cy="6" r="3"></circle>
                <circle cx="6" cy="18" r="3"></circle>
                <path d="M18 9a9 9 0 0 1-9 9"></path>
              </svg>
              创建分支
              <span class="menu-hint">保留当前状态</span>
            </button>
            <button
              class="menu-item rewind-fork-item"
              :disabled="!rewindCapabilities.forkReset"
              :class="{ disabled: !rewindCapabilities.forkReset }"
              @click="handleRewindAndFork(responseToolbarTarget.message.id, responseToolbarTarget.index, 'reset')"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
                <path d="M3 3v5h5"></path>
                <line x1="6" y1="8" x2="6" y2="16"></line>
                <circle cx="16" cy="10" r="3"></circle>
                <circle cx="6" cy="18" r="3"></circle>
                <path d="M16 13a6 6 0 0 1-6 5"></path>
              </svg>
              重置文件并创建分支
              <span class="menu-hint">保存当前状态后重置</span>
            </button>
          </div>
        </Teleport>
        <div class="response-toolbar-row">
          <span class="response-toolbar-line" aria-hidden="true"></span>
          <div class="response-toolbar">
            <button
              v-if="showResponseToolbarCollapseBtn"
              class="response-toolbar-toggle"
              @click.stop="onToggleResponseCollapse(responseToolbarTarget.index, $event)"
              :title="responseToolbarLabel"
            >
              {{ responseToolbarLabel }}
            </button>
            <template v-else>
              <span class="response-toolbar-hint">{{ responseToolbarLabel }}</span>
            </template>
          </div>
          <span class="response-toolbar-line" aria-hidden="true"></span>
        </div>
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
            :chat-theme="chatTheme"
            @toggle-collapse="() => onToggleThinkingCollapse(messageIndex)"
            @copy-content="copyThinkingContent"
          />
          <AssistantMessage
            v-if="showAssistantMessage"
            :message="message"
            :message-index="messageIndex"
            :copied-message-index="copiedMessageIndex"
            :chat-theme="chatTheme"
            @copyContent="copyMessageContent"
          />
        </div>
      </template>

      <!-- Plain system 消息 -->
      <template v-else-if="isPlainSystemMessage">
        <div class="system-inline-message">
          <span class="system-inline-line" aria-hidden="true"></span>
          <div class="system-inline-text">
            {{ message.content }}
          </div>
          <span class="system-inline-line" aria-hidden="true"></span>
        </div>
      </template>

      <!-- Status/System 消息 -->
      <template v-else>
        <div
          class="message-content"
          :class="{
            'status-content': message.role === 'status',
            'status-error': message.role === 'status' && message.isError
          }"
        >
          <div
            v-if="message.content && !(message.role === 'system' && message.subtype === 'rewind-notice')"
            class="message-text"
            :class="{
              'status-text': message.role === 'status',
              'status-error-text': message.role === 'status' && message.isError
            }"
          >
            <div v-if="message.role !== 'assistant'">
              <span class="status-icon" v-if="message.role === 'status' && message.isError">⚠️</span>
              {{ message.content }}
            </div>
            <div v-if="message.role === 'status' && message.details" class="status-details">
              {{ message.details }}
            </div>
            <div v-if="message.role === 'status' && message.suggestion" class="status-suggestion">
              💡 {{ message.suggestion }}
            </div>
          </div>
          <div class="message-time" v-if="message.role !== 'status' && message.role !== 'assistant' && message.role !== 'user' && message.role !== 'system'">
            {{ new Date(message.timestamp).toLocaleTimeString() }}
          </div>
        </div>
      </template>

      <div v-if="showTailStats || showBottomStats" class="message-stats-header" :class="{ tail: showTailStats, bottom: showBottomStats }">
        <MessageStats
          :timestamp="message.timestamp"
          :duration="message.duration"
          :start-time="(isTurnMessageRole(message.role) && isLastUserMsg && !message.duration) ? message.startTime : message.startTime"
          :current-time="currentTime"
          :is-streaming="isStreaming"
          :num-turns="message.numTurns"
          :usage="message.usage"
          :variant="statusStyle"
        />
      </div>

      <div
        v-if="showFloatingStats"
        class="message-stats-floating top"
        :class="{ 'user-floating': isTurnMessageRole(message.role) }"
      >
        <MessageStats
          :timestamp="message.timestamp"
          :duration="message.duration"
          :start-time="(isTurnMessageRole(message.role) && isLastUserMsg && !message.duration) ? message.startTime : message.startTime"
          :current-time="currentTime"
          :is-streaming="isStreaming"
          :num-turns="message.numTurns"
          :usage="message.usage"
          variant="floating"
        />
      </div>
    </div>

    <!-- 用户消息右侧：头像 -->
    <div v-if="showUserRightColumn" class="user-right-column" :class="{ 'avatar-hidden': !showAvatar }">
      <div v-if="showAvatar" class="message-avatar">
        {{ avatarChar }}
      </div>
    </div>
  </div>

</template>

<style scoped>
.message {
  display: flex;
  margin-bottom: 16px;
  gap: 12px;
  transition: opacity 0.15s;
}

.message.spacing-small {
  margin-bottom: 16px;
}

.message.spacing-medium {
  margin-bottom: 24px;
}

.message.user,
.message.command {
  justify-content: flex-end;
  padding-left: 48px;  /* 留出左侧空间，与回答消息的头像区域对齐 */
}

.message.user.no-avatar,
.message.command.no-avatar {
  padding-left: 0;
}

/* 每轮新问答之间增加间距 */
.message.new-turn {
  margin-top: 60px;
}

.message.spacing-small.new-turn {
  margin-top: 28px;
}

.message.spacing-medium.new-turn {
  margin-top: 42px;
}

.message.user .message-body,
.message.command .message-body {
  align-items: flex-end;
  flex: 1;
  max-width: var(--ccgui-message-fill-width, calc(100% - 48px));  /* 减去右侧列宽度(36px) + 间距(12px) */
  overflow: visible;
}

.message.user.with-response-toolbar .message-body,
.message.command.with-response-toolbar .message-body {
  max-width: calc(100% - 48px);
}

.message.user.no-avatar .message-body,
.message.command.no-avatar .message-body {
  max-width: var(--ccgui-message-fill-width, calc(100% - 28px));
}

.message.user.with-response-toolbar.no-avatar .message-body,
.message.command.with-response-toolbar.no-avatar .message-body {
  max-width: calc(100% - 28px);
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

.user-right-column.avatar-hidden {
  width: 28px;
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
  background: #2f2412;
  color: #F59E0B;
}

.message:hover .response-toolbar-btn.rewind-btn.active {
  background: #2f2412;
  color: #F59E0B;
  border-color: rgba(245, 158, 11, 0.3);
}

/* 操作菜单容器 */
.action-menu-wrapper {
  position: relative;
}

.user-message-shell {
  position: relative;
  display: flex;
  justify-content: flex-end;
  width: 100%;
}

.user-action-overlay {
  position: absolute;
  right: 8px;
  bottom: -12px;
  z-index: 3;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s ease;
}

.message.user:hover .user-action-overlay,
.message.command:hover .user-action-overlay,
.user-action-overlay:has(.user-action-btn.active) {
  opacity: 1;
  pointer-events: auto;
}

.user-action-btn {
  width: 24px;
  height: 24px;
  border-radius: 999px;
  background: rgba(24, 24, 27, 0.88);
  color: rgba(113, 113, 122, 0.72);
  box-shadow: 0 0 0 2px rgba(24, 24, 27, 0.92);
  transition: all 0.15s ease;
}

.message:hover .user-action-btn,
.user-action-btn.active {
  background: #18181B;
  color: #8b949e;
  box-shadow: 0 0 0 2px rgba(24, 24, 27, 0.92);
}

.message:hover .user-action-btn:hover,
.user-action-btn.active:hover {
  background: #232329;
  color: #d4d4d8;
}

.response-toolbar-row {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  margin: 6px 0 2px;
}

.response-toolbar-line {
  flex: 1;
  min-width: 24px;
  height: 1px;
  background: linear-gradient(90deg, rgba(82, 82, 91, 0.04), rgba(82, 82, 91, 0.5), rgba(82, 82, 91, 0.04));
}

.response-toolbar {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 10px;
  padding: 0 2px;
}

.response-toolbar-hint {
  font-size: 11px;
  color: #52525B;
  user-select: none;
}

.response-toolbar-toggle {
  padding: 0;
  background: transparent;
  border: none;
  font-size: 11px;
  line-height: 1.4;
  color: #6b7280;
  cursor: pointer;
  user-select: none;
  transition: color 0.15s ease, opacity 0.15s ease;
}

.message:hover .response-toolbar-toggle {
  color: #9ca3af;
}

.response-toolbar-toggle:hover {
  color: #d4d4d8;
}

.response-toolbar-btn {
  width: 28px;
  height: 28px;
  border-radius: 999px;
  background: rgba(24, 24, 27, 0.5);
  border: 1px solid rgba(82, 82, 91, 0.35);
  color: rgba(113, 113, 122, 0.4);
  box-shadow: 0 0 0 4px rgba(24, 24, 27, 0.5);
  transition: all 0.15s ease;
}

.message:hover .response-toolbar-btn {
  background: #18181B;
  border-color: rgba(82, 82, 91, 0.75);
  color: #71717A;
  box-shadow: 0 0 0 4px rgba(24, 24, 27, 0.92);
}

.message:hover .response-toolbar-btn:hover {
  background: #232329;
  border-color: rgba(113, 113, 122, 0.95);
  color: #D4D4D8;
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

.action-dropdown-menu--toolbar {
  position: fixed;
  top: 0;
  left: 0;
  transform: none;
  z-index: 9999;
  min-width: 220px;
  width: max-content;
  max-width: min(280px, calc(100vw - 24px));
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

.menu-item.disabled,
.menu-item:disabled {
  opacity: 0.45;
  cursor: not-allowed;
  pointer-events: none;
}

.menu-item.disabled:hover,
.menu-item:disabled:hover {
  background: transparent;
  color: #A1A1AA;
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
  align-self: flex-start;
  margin-top: 0;
}

.message.avatar-small .message-avatar {
  width: 10px;
  height: 10px;
  min-width: 10px;
  min-height: 10px;
  font-size: 0;
  margin-top: 8px;
}

.message.tool-avatar-icon .message-avatar {
  margin-top: 0;
}

.message.avatar-small.tool-avatar-icon .message-avatar {
  width: 10px;
  height: 16px;
  min-width: 10px;
  min-height: 16px;
  background: transparent;
  color: #E4E4E7;
  margin-top: 0;
  align-self: flex-start;
  font-size: 14px;
  line-height: 1;
}

.message.avatar-small.thinking-first .message-avatar {
  margin-top: 4px;
}

.message.avatar-small.tool-text-first .message-avatar {
  margin-top: 0;
}

.message.avatar-small.tool-text-first.tool-avatar-icon .message-avatar {
  margin-top: 0;
  align-self: flex-start;
}

.message.read-avatar .message-avatar,
.message.avatar-small.read-avatar .message-avatar,
.message.avatar-small.tool-text-first.tool-avatar-icon.read-avatar .message-avatar {
  margin-top: 2px;
}

.message.user .message-avatar,
.message.command .message-avatar {
  background: #3F3F46;
}

.message.assistant .message-avatar {
  background: #F97316;
}

.message.system .message-avatar {
  background: #6366F1;
}

.message.system.rewind-notice {
  justify-content: center;
}

.message.system.rewind-notice .message-body {
  align-items: center;
}

.message.rewind-notice .message-avatar {
  background: #F59E0B;
  color: white;
}

.message.avatar-small.rewind-notice .message-avatar {
  margin-top: 5px;
}

.message.interrupt .message-avatar {
  background: #EF4444;
  color: white;
  font-size: 14px;
}

.message.task_complete .message-avatar {
  background: rgba(59, 130, 246, 0.15);
  color: white;
  font-size: 14px;
}

.message.question .message-avatar {
  background: #059669;
}

.message.permission_result .message-avatar {
  background: #22C55E;
  color: white;
  font-size: 14px;
  font-weight: bold;
}

.message.avatar-small.permission_result .message-avatar {
  font-size: 0;
  margin-top: 3px;
}

.message.avatar-small.question .message-avatar {
  width: 10px;
  height: 16px;
  min-width: 10px;
  min-height: 16px;
  background: transparent;
  color: #059669;
  font-size: 14px;
  line-height: 1;
  margin-top: 0;
  align-self: flex-start;
}

.message.permission_result.denied .message-avatar {
  background: #EF4444;
}

.message.question .message-body {
  flex: 1;
}

/* 中断消息样式 */
.interrupt-message {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 14px;
  background: linear-gradient(135deg, #450A0A 0%, #292524 100%);
  border: 1px solid #991B1B;
  border-left: 3px solid #EF4444;
  border-radius: 8px;
  font-size: 12px;
  color: #FCA5A5;
  margin: 8px 0;
  max-width: fit-content;
}

.interrupt-icon {
  font-size: 14px;
}

.interrupt-text {
  font-weight: 500;
}

.message.tool_use .message-avatar {
  background: #3B82F6;
}

.message.diff .message-avatar {
  background: #3B82F6;
  color: white;
}

.message.unknown .message-avatar {
  background: #EF4444;
  color: white;
  font-size: 16px;
  font-weight: bold;
}

.message.avatar-small.unknown .message-avatar {
  font-size: 0;
  margin-top: 5px;
}

.message-body {
  min-width: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}

.message.execution-card {
  align-items: stretch;
}

.message.execution-card .message-body {
  width: 100%;
  max-width: var(--ccgui-message-max-width, min(70%, 720px));
}

/* Assistant 内容包装器：thinking 和 message 共享宽度 */
.assistant-content-wrapper {
  width: var(--ccgui-message-fill-width, fit-content);
  max-width: var(--ccgui-message-fill-width, calc(100% - 48px));  /* 减去左侧头像宽度(36px) + 间距(12px) */
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.message.assistant.surface-ghost .assistant-content-wrapper {
  max-width: var(--ccgui-message-ghost-max-width, min(85%, calc(100% - 48px)));
}

.message.no-avatar .assistant-content-wrapper {
  max-width: var(--ccgui-message-fill-width, 100%);
}

.message.assistant.surface-ghost.no-avatar .assistant-content-wrapper {
  max-width: var(--ccgui-message-ghost-max-width, 85%);
}

.assistant-content-wrapper > * {
  width: 100%;
}

/* 统一的统计信息头部（在气泡外部） */
.message-stats-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;
}

.message-stats-header.tail {
  justify-content: flex-end;
}

.message-stats-header.bottom {
  padding-top: 2px;
}

.message-stats-floating {
  position: absolute;
  z-index: 3;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.16s ease;
}

.message-stats-floating.top {
  top: 0;
  left: 0;
  transform: translateY(calc(-100% - 6px));
}

.message-stats-floating.top.user-floating {
  left: auto;
  right: 0;
  justify-content: flex-end;
}

.message-stats-floating.tail {
  top: 0;
  right: 0;
  justify-content: flex-end;
  transform: translateY(calc(-100% - 6px));
}

.message-stats-floating.bottom {
  left: 0;
  bottom: 0;
  transform: translateY(calc(100% + 6px));
}

.message:hover .message-stats-floating {
  opacity: 1;
}

.message-content {
  grid-column: 2;
}

.message-content.status-content {
  grid-column: 1 / -1;
  text-align: center;
}

.system-inline-message {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  margin: 4px 0 2px;
  color: #71717A;
}

.system-inline-line {
  flex: 1;
  min-width: 24px;
  border-top: 1px dashed rgba(113, 113, 122, 0.45);
}

.system-inline-text {
  flex-shrink: 0;
  max-width: var(--ccgui-message-max-width, min(70%, 720px));
  font-size: 12px;
  line-height: 1.55;
  color: #A1A1AA;
  text-align: center;
  white-space: pre-wrap;
  word-break: break-word;
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

.message-content.status-error {
  background: rgba(239, 68, 68, 0.1);
  border-radius: 6px;
  margin: 4px 0;
}

.message-text.status-error-text {
  color: #ef4444;
  font-weight: 500;
}

.status-icon {
  margin-right: 4px;
}

.status-details {
  font-size: 10px;
  color: #a1a1aa;
  margin-top: 4px;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
  text-align: left;
}

.status-suggestion {
  font-size: 10px;
  color: #fbbf24;
  margin-top: 4px;
  padding: 4px 8px;
  background: rgba(251, 191, 36, 0.1);
  border-radius: 4px;
  text-align: left;
}

.message-time {
  font-size: 11px;
  color: #71717A;
  margin-top: 4px;
}

</style>
