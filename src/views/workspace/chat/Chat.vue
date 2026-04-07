<script setup>
import { useAttrs, ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue'
import { useSessionStore } from '../../../stores/useSessionStore'
import { useAppStore } from '../../../stores/useAppStore'
import { logger } from '../../../utils/logger'
import { barkProvider } from '../../../utils/notifier'
import { addAppErrorDialogListener, openAppErrorDialog } from '../../../utils/appErrorDialog'
import { useSessionModelControls } from './composables/useSessionModelControls'
import { useDialogStack } from '../../../composables/useDialogStack'
import { resolveSessionChatMessageTheme } from '../../../utils/chatMessageTheme'

// 引入对话框组件
import PermissionDialog from './components/dialogs/PermissionDialog.vue'
import AskUserQuestionDialog from './components/dialogs/AskUserQuestionDialog.vue'
import MessageDetailDialog from './components/dialogs/MessageDetailDialog.vue'

// 引入子组件
import EnvInfoBar from './components/layout/EnvInfoBar.vue'
import ChatInput from './components/layout/ChatInput.vue'
import AgentWorkspace from './components/AgentWorkspace.vue'
import TaskFloatingWindow from './components/TaskFloatingWindow.vue'

// 引入 composables
// useMessageList composable 的功能已移至 MessageList 组件
// useScroll 和 useHistory composables 已创建，可在未来需要时使用
// import { useScroll } from './composables/useScroll'
// import { useHistory } from './composables/useHistory'
import { useMessageList } from './composables/useMessageList'

const sessionStore = useSessionStore()
const appStore = useAppStore()
const attrs = useAttrs()
const { findAssistantResponse } = useMessageList()

// 使用 composables
// useMessage composable 的功能已移至 MessageList 组件

// Props
const props = defineProps({
  sidebarCollapsed: {
    type: Boolean,
    default: false
  },
  sidebarWidth: {
    type: Number,
    default: 260
  },
  showCollapseToggle: {
    type: Boolean,
    default: false
  },
  isCollapsedByPreview: {
    type: Boolean,
    default: false
  },
  showSidebarToggle: {
    type: Boolean,
    default: false
  }
})

// Emits
const emit = defineEmits(['toggleSidebar', 'toggleCollapse', 'startSession', 'closeSession'])

// 使用 SessionStore 的状态（只读 computed）
const messages = computed(() => sessionStore.currentMessages)
const mainAgentId = computed(() => sessionStore.currentMainAgentId)
const executionAgentCards = computed(() => sessionStore.executionAgentCards)
const collaborativeAgentSessions = computed(() => sessionStore.collaborativeAgentSessions)
const agentWorkspaceAgents = computed(() => sessionStore.agentWorkspaceAgents)
const activeCollaborativeSession = computed(() => sessionStore.activeCollaborativeSession)
const splitCollaborativeSessions = computed(() => sessionStore.splitCollaborativeSessions)
const agentWorkspaceState = computed(() => sessionStore.currentAgentWorkspaceState)
const currentInputTargetAgent = computed(() => sessionStore.currentInputTargetAgent)
const childCollaborativeSessions = computed(() => collaborativeAgentSessions.value.filter(session => !session.isMain))
const hasCollaborativeChildren = computed(() => childCollaborativeSessions.value.length > 0)
const inputTargetOptions = computed(() => {
  if (!hasCollaborativeChildren.value) {
    return []
  }

  const deletedTeamIds = new Set(
    collaborativeAgentSessions.value
      .filter(entry => entry.registry?.agentType === 'team' && entry.status === 'deleted')
      .map(entry => entry.agentId)
  )

  return collaborativeAgentSessions.value
    .filter(entry => entry.status !== 'deleted' && entry.registry?.agentType !== 'team')
    .filter(entry => !entry.registry?.teamId || !deletedTeamIds.has(entry.registry.teamId))
    .map(entry => ({
      agentId: entry.agentId,
      label: entry.title || entry.name || (entry.isMain ? 'Master' : 'Agent'),
      color: entry.color || null,
      subtitle: entry.canWrite === false || entry.interactionMode === 'read-only'
        ? '只读'
        : (entry.subtitle || (entry.isMain ? '主会话' : '子会话')),
      readOnly: entry.canWrite === false || entry.interactionMode === 'read-only',
      isMain: Boolean(entry.isMain)
    }))
})
const splitSideSessions = computed(() => {
  if (agentWorkspaceState.value.collaborativeViewMode !== 'split') {
    return []
  }

  const activeAgentId = activeCollaborativeSession.value?.agentId || null
  return splitCollaborativeSessions.value.filter(session => session.agentId !== activeAgentId)
})

const shouldShowStickyHeader = computed(() => {
  if (!stickyMessage.value) {
    return false
  }

  if (!hasCollaborativeChildren.value) {
    return true
  }

  return Boolean(activeCollaborativeSession.value?.isMain)
})

const collaborativeRailPlacement = computed(() => {
  if (!hasCollaborativeChildren.value) {
    return 'side'
  }

  return messagesViewportWidth.value >= 1080 ? 'side' : 'top'
})

// UI 状态
const pendingPermission = computed(() => sessionStore.pendingPermission)
const pendingControlRequest = computed(() => sessionStore.pendingControlRequest)
const pendingQuestion = computed(() => sessionStore.currentSession?.pendingQuestion)
const envInfo = computed(() => sessionStore.currentSession?.envInfo)
const silentMessages = computed(() => sessionStore.currentSession?.silentMessages || [])
const runtimeActive = computed(() => envInfo.value?.providerPid != null)
const codexUsageRefreshing = ref(false)
const inputMessage = computed({
  get: () => sessionStore.inputMessage,
  set: (val) => { sessionStore.inputMessage = val }
})
const inputAttachments = computed({
  get: () => sessionStore.inputAttachments,
  set: (val) => { sessionStore.inputAttachments = val }
})

const isProcessing = computed(() => sessionStore.isProcessing)
const messagesContainer = ref(null)
const chatInputRef = ref(null)
// pendingPermission and pendingControlRequest are now computed from sessionStore (defined above)
// pendingQuestion is also now computed from sessionStore
const workingDirectory = ref('') // 工作目录
const selectedMessage = ref(null) // 当前选中的消息（用于显示详情）
const currentTime = ref(Date.now()) // 用于实时更新消耗时间
const stickyMessageId = ref(null) // 当前粘性显示的消息 ID
const containerHeight = ref(400) // 聊天容器高度，用于限制粘性面板
const messagesHeight = ref(null) // 消息区域高度，null 表示自动
const isResizing = ref(false) // 是否正在调整大小
const contentViewport = ref({ left: 0, right: 0, width: 0 })
const messagesViewportWidth = ref(0)
let previousMessageCount = 0 // 追踪之前的消息数量
let durationTimer = null // 消耗时间更新定时器
let previousWindowHeight = null // 上一次窗口高度
let chatPanelHeight = ref(0) // chat-panel 容器的高度
let chatPanelResizeObserver = null // ResizeObserver 实例
const suppressSessionControlWatchers = ref(false)
const skipNextProviderRefreshSessionId = ref('')
const skipNextSubModelRefreshSessionId = ref('')
const inputHistory = computed(() => sessionStore.currentSession?.inputHistory || [])
// Note: isLoadingHistory removed - history is now loaded by SessionStore/SessionInstance

const executionAgentCardMap = computed(() => {
  return new Map(executionAgentCards.value.map(card => [card.agentId, card]))
})

const mainTimelineMessages = computed(() => {
  return messages.value.filter(message => {
    const agentId = sessionStore.getMessageAgentId(message)
    const registryEntry = sessionStore.currentAgentRegistry.get(agentId)

    if (agentId !== mainAgentId.value && registryEntry?.agentKind === 'collaborative') {
      return false
    }

    if (agentId !== mainAgentId.value && registryEntry?.agentKind === 'execution') {
      return false
    }

    return true
  })
})

const mainTimelineBlocks = computed(() => {
  const blocks = []
  const insertedExecutionAgentIds = new Set()

  messages.value.forEach((message, index) => {
    const agentId = sessionStore.getMessageAgentId(message)
    const registryEntry = sessionStore.currentAgentRegistry.get(agentId)

    if (agentId !== mainAgentId.value && registryEntry?.agentKind === 'collaborative') {
      return
    }

    if (agentId !== mainAgentId.value && registryEntry?.agentKind === 'execution') {
      if (!insertedExecutionAgentIds.has(agentId)) {
        const card = executionAgentCardMap.value.get(agentId)
        if (card) {
          blocks.push({
            type: 'execution-card',
            key: `execution-${agentId}`,
            card
          })
          insertedExecutionAgentIds.add(agentId)
        }
      }
      return
    }

    blocks.push({
      type: 'message',
      key: `message-${message.id || index}`,
      message,
      messageIndex: mainTimelineMessages.value.indexOf(message),
      totalMessages: mainTimelineMessages.value.length,
      allMessages: mainTimelineMessages.value
    })
  })

  executionAgentCards.value.forEach(card => {
    if (!insertedExecutionAgentIds.has(card.agentId)) {
      blocks.push({
        type: 'execution-card',
        key: `execution-${card.agentId}`,
        card
      })
    }
  })

  return blocks
})

// 权限模式
const permissionMode = ref('default') // 当前权限模式
const showPermissionMenu = ref(false) // 是否显示权限菜单
const permissionModes = [
  { value: 'default', label: '默认', icon: '💡' },
  { value: 'acceptEdits', label: '允许编辑', icon: '✏️' },
  { value: 'plan', label: '计划模式', icon: '📋' },
  { value: 'bypassPermissions', label: '全部允许', icon: '✅' }
]

const currentSessionMeta = computed(() => {
  const sessionId = appStore.currentSession?.id
  if (!sessionId) return null
  return appStore.currentProjectSessions.find(session => session.id === sessionId) || appStore.currentSession || null
})

const sessionAvailability = ref({
  available: true,
  reason: '',
  initProvider: null,
  currentProvider: null
})

const sessionUnavailableMessage = computed(() => {
  if (sessionAvailability.value.available !== false) {
    return ''
  }

  const initProvider = sessionAvailability.value.initProvider || '未知'
  const currentProvider = sessionAvailability.value.currentProvider || '未知'
  return `当前会话不可用：创建时供应商为 ${initProvider}，当前供应商为 ${currentProvider}`
})

const isSessionRuntimeStarted = computed(() => {
  return Boolean(
    sessionStore.currentSession?.runtimeReady ||
    envInfo.value?.providerPid
  )
})

const canConfigureNotifications = computed(() => {
  return !!appStore.currentSession?.id
})
const {
  appConfig,
  projectConfig,
  sessionConfig,
  canQuickSwitchModel,
  canQuickSwitchSubModel,
  currentModelProvider,
  availableModelOptions,
  currentModelLabel,
  currentModelSelectionKey,
  providerSubModelOptions,
  providerSubModelLoading,
  currentSubModelLabel,
  currentSubModelKey,
  availableEffortOptions,
  providerEffortLoading,
  canQuickSwitchEffort,
  currentEffortValue,
  currentEffortKey,
  loadModelConfigContext,
  loadProviderSubModels,
  loadSessionEffortCapabilities,
  isSwitchingSessionControls,
  restoreSessionDerivedState,
  handleQuickModelChange,
  handleQuickSubModelChange,
  handleQuickEffortChange,
  resetModelState,
  resetSubModelState,
  resetEffortState
} = useSessionModelControls({
  sessionStore,
  appStore,
  envInfo,
  currentSessionMeta,
  workingDirectory,
  isSessionRuntimeStarted
})

const notificationOptions = computed(() => [
  {
    value: 'sound',
    label: '播放系统音'
  },
  {
    value: 'bark',
    label: 'Bark 通知',
    disabled: !appConfig.value?.settings?.barkUrl
  }
])

const resolvedChatMessageTheme = computed(() => {
  return resolveSessionChatMessageTheme(
    appConfig.value?.settings || {},
    projectConfig.value?.settings || {},
    sessionConfig.value?.settings || {}
  ).theme
})

const AUTO_SCROLL_NEAR_BOTTOM_PX = 5
const STREAMING_NEAR_BOTTOM_PX = 52
const SYSTEM_NEAR_BOTTOM_PX = 44

const hasActiveConversationActivity = computed(() => {
  return messages.value.some(message => message?.isStreaming || message?.isExecuting)
})

const showInterruptButton = computed(() => {
  return isProcessing.value || hasActiveConversationActivity.value
})

const showConversationWave = computed(() => {
  return showInterruptButton.value
})

const queuedMessagesBySession = ref({})
const isFlushingQueuedMessage = ref(false)
const activeQueueSessionId = computed(() => sessionStore.currentSessionId || appStore.currentSession?.id || '__global__')
const queuePanelVisible = ref(true)

const queuedMessages = computed(() => {
  const sessionId = activeQueueSessionId.value
  return queuedMessagesBySession.value[sessionId] || []
})

const displayedQueuedMessages = computed(() => {
  return queuedMessages.value
})

const queuedMessageCount = computed(() => {
  const queue = displayedQueuedMessages.value
  return Array.isArray(queue) ? queue.length : 0
})

const shouldShowQueuePanel = computed(() => queuedMessageCount.value > 0 && queuePanelVisible.value)

function normalizeQueuedContent(content) {
  if (typeof content === 'string') {
    return content
  }

  if (!content || typeof content !== 'object') {
    return ''
  }

  return {
    text: String(content.text || ''),
    attachments: Array.isArray(content.attachments) ? content.attachments.map(item => ({ ...item })) : []
  }
}

function buildQueuedMessageLabel(content) {
  const normalized = normalizeQueuedContent(content)
  if (typeof normalized === 'string') {
    const text = normalized.trim().replace(/\s+/g, ' ')
    return {
      text: text || '空消息',
      attachmentBadges: []
    }
  }

  const text = String(normalized.text || '').trim().replace(/\s+/g, ' ')
  const attachmentBadges = Array.isArray(normalized.attachments)
    ? normalized.attachments.map((attachment, index) => ({
        id: attachment.id || `queued-attachment-${index}`,
        label: String(attachment.name || attachment.path || attachment.kind || '附件').split('/').pop()
      }))
    : []

  return {
    text: text || '',
    attachmentBadges,
    fallbackText: attachmentBadges.length > 0 ? '' : '空消息'
  }
}

function enqueueMessage(content) {
  const sessionId = activeQueueSessionId.value
  const queue = queuedMessagesBySession.value[sessionId] || []
  queue.push({
    id: `queued-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    content: normalizeQueuedContent(content),
    ...buildQueuedMessageLabel(content),
    createdAt: Date.now()
  })
  queuedMessagesBySession.value = {
    ...queuedMessagesBySession.value,
    [sessionId]: queue
  }
}

function removeQueuedMessage(queueId) {
  if (!queuedMessages.value.length) return
  const sessionId = activeQueueSessionId.value
  const queue = queuedMessagesBySession.value[sessionId] || []
  const index = queue.findIndex(item => item.id === queueId)
  if (index >= 0) {
    queue.splice(index, 1)
    queuedMessagesBySession.value = {
      ...queuedMessagesBySession.value,
      [sessionId]: queue
    }
  }
}

async function flushQueuedMessages() {
  if (isFlushingQueuedMessage.value) return
  if (isProcessing.value || pendingPermission.value || pendingControlRequest.value) return
  if (!queuedMessageCount.value) return

  isFlushingQueuedMessage.value = true
  const nextItem = queuedMessages.value[0]
  const sessionId = activeQueueSessionId.value

  try {
    await sessionStore.sendMessage(nextItem.content)
    const queue = queuedMessagesBySession.value[sessionId] || []
    queue.shift()
    queuedMessagesBySession.value = {
      ...queuedMessagesBySession.value,
      [sessionId]: queue
    }
  } catch (error) {
    logger.warn('[Chat] Failed to flush queued message', { error: error?.message || String(error) })
  } finally {
    isFlushingQueuedMessage.value = false
  }
}

watch(
  () => [isProcessing.value, !!pendingPermission.value, !!pendingControlRequest.value, queuedMessageCount.value, runtimeActive.value],
  () => {
    if (!isProcessing.value && !pendingPermission.value && !pendingControlRequest.value && queuedMessageCount.value > 0 && runtimeActive.value) {
      void flushQueuedMessages()
    }
  }
)

function formatCenterTimer(ms) {
  const safeMs = Number(ms)
  if (!Number.isFinite(safeMs) || safeMs <= 0) return ''
  if (safeMs < 1000) return `${Math.round(safeMs)}ms`
  if (safeMs < 60000) return `${(safeMs / 1000).toFixed(safeMs >= 10000 ? 0 : 1)}s`
  return `${Math.floor(safeMs / 60000)}m ${Math.floor((safeMs % 60000) / 1000)}s`
}

const centerResizeTimerLabel = computed(() => {
  if (!isProcessing.value) {
    return ''
  }

  const activeUserMessage = [...messages.value].reverse().find(message =>
    message?.role === 'user' && message?.startTime && !message?.duration
  )

  if (!activeUserMessage?.startTime) {
    return ''
  }

  return formatCenterTimer(currentTime.value - activeUserMessage.startTime)
})

const latestRuntimeTransitionMessage = computed(() => {
  return [...messages.value].reverse().find(message =>
    message?.role === 'system_notification' && (
      message.notificationType === 'session-runtime-starting' ||
      message.notificationType === 'session-runtime-restarting' ||
      message.notificationType === 'session-runtime-ready' ||
      message.notificationType === 'session-config-applied' ||
      message.notificationType === 'session-effort-changed' ||
      message.notificationType === 'runtime-stopped' ||
      message.notificationType === 'runtime-exit'
    )
  ) || null
})

const isRuntimeTransitioning = computed(() => {
  const type = latestRuntimeTransitionMessage.value?.notificationType
  return type === 'session-runtime-starting' || type === 'session-runtime-restarting'
})

const toolbarLocked = computed(() => {
  return isRuntimeTransitioning.value || sessionAvailability.value.available === false
})

const collapsibleStats = computed(() => {
  let total = 0
  let collapsed = 0

  for (let index = 0; index < messages.value.length; index += 1) {
    const message = messages.value[index]
    if (!message) continue

    if (message.role === 'user') {
      if (findAssistantResponse(messages.value, index)) {
        total += 1
        if (message.responseCollapsed) collapsed += 1
      }
      continue
    }
  }

  return {
    total,
    collapsed,
    allCollapsed: total > 0 && collapsed === total
  }
})

function toPlainObject(value) {
  return value ? JSON.parse(JSON.stringify(value)) : {}
}

function toggleAllMessageCollapse() {
  const shouldCollapse = !collapsibleStats.value.allCollapsed

  for (let index = 0; index < messages.value.length; index += 1) {
    const message = messages.value[index]
    if (!message) continue

    if (message.role === 'user') {
      if (findAssistantResponse(messages.value, index)) {
        message.responseCollapsed = shouldCollapse
      }
    }
  }
}

function handleChatShortcut(event) {
  if (event?.detail?.action === 'toggle-all-message-collapse') {
    toggleAllMessageCollapse()
  }
}

const currentNotificationChannels = computed(() => {
  const settings = sessionConfig.value?.settings || {}
  if (!Array.isArray(settings.notificationChannels)) {
    return []
  }
  return settings.notificationChannels.filter(channel => channel === 'sound' || channel === 'bark')
})

async function handleNotificationToggle(option) {
  if (!appStore.currentProject?.id || !appStore.currentSession?.id) return

  try {
    const existingSettings = toPlainObject(sessionConfig.value?.settings)
    const currentChannels = Array.isArray(existingSettings.notificationChannels)
      ? existingSettings.notificationChannels.filter(channel => channel === 'sound' || channel === 'bark')
      : []

    let nextChannels
    if (option.value === 'none') {
      nextChannels = []
    } else if (currentChannels.includes(option.value)) {
      nextChannels = currentChannels.filter(channel => channel !== option.value)
    } else {
      nextChannels = [...currentChannels, option.value]
    }

    const result = await window.electronAPI.updateSessionConfig({
      projectId: appStore.currentProject.id,
      sessionId: appStore.currentSession.id,
      updates: {
        name: currentSessionMeta.value?.name || appStore.currentSession.name || sessionStore.currentSession?.id?.slice(0, 8) || '新会话',
        settings: {
          ...existingSettings,
          notificationChannels: nextChannels
        }
      }
    })

    if (result?.success) {
      sessionConfig.value = result.config
    } else {
      throw new Error(result?.error || '保存通知配置失败')
    }
  } catch (error) {
    logger.error('[Chat] Failed to update notification channels', { error: error.message })
    alert('更新通知方式失败: ' + error.message)
  }
}

async function handleSessionComplete(event) {
  if (event.detail?.sessionId !== appStore.currentSession?.id) return
  if (appConfig.value?.settings?.showNotifications === false) return

  const channels = currentNotificationChannels.value
  if (!channels.length) return

  const sessionName = currentSessionMeta.value?.name || appStore.currentSession?.name || '当前会话'
  const message = `会话「${sessionName}」已完成`

  if (channels.includes('sound') && appConfig.value?.settings?.notificationSound) {
    try {
      await window.electronAPI.playSystemSound({
        sound: appConfig.value.settings.notificationSound
      })
    } catch (error) {
      logger.warn('[Chat] Failed to play completion sound', { error: error.message })
    }
  }

  if (channels.includes('bark') && appConfig.value?.settings?.barkUrl) {
    try {
      await barkProvider.send(appConfig.value.settings.barkUrl, message)
    } catch (error) {
      logger.warn('[Chat] Failed to send Bark notification', { error: error.message })
    }
  }
}

// 监听 session 的 permissionMode 变化
watch(
  () => sessionStore.currentSession?.permissionMode,
  (newMode) => {
    if (newMode && newMode !== permissionMode.value) {
      permissionMode.value = newMode
      console.log('[Chat] Permission mode synced from session:', newMode)
    }
  },
  { immediate: true }
)

// 监听弹窗出现，播放提示音
watch(
  () => !!(pendingPermission.value || pendingControlRequest.value || pendingQuestion.value),
  (hasDialog, prev) => {
    if (hasDialog && !prev && appConfig.value?.settings?.alertSoundEnabled !== false) {
      const sound = appConfig.value?.settings?.alertSound || 'Glass'
      window.electronAPI?.playSystemSound?.({ sound })?.catch?.(() => {})
    }
  }
)

onMounted(async () => {
  removeAppErrorDialogListener = addAppErrorDialogListener((detail) => {
    openErrorDialog(detail)
  })

  // 启动 SessionStore 的事件监听器（监听后端的 session-event 统一通道）
  sessionStore.startEventListener()

  // 启动消耗时间更新定时器
  durationTimer = setInterval(() => {
    currentTime.value = Date.now()
  }, 100)

  // 记录初始窗口高度
  previousWindowHeight = window.innerHeight
  chatPanelHeight.value = document.querySelector('.chat-panel')?.offsetHeight || 0

  // 监听窗口大小变化，将高度变化全部作用到 messages 区域
  window.addEventListener('resize', handleWindowResize)

  // 右键菜单：点击空白处关闭
  window.addEventListener('pointerdown', handleGlobalPointerDownForContextMenu, true)

  // 监听聊天容器高度变化
  if (messagesContainer.value) {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerHeight.value = entry.contentRect.height
        messagesViewportWidth.value = entry.contentRect.width
      }
      nextTick(updateContentViewport)
    })
    resizeObserver.observe(messagesContainer.value)
  }

  // 监听 chat-panel 容器大小变化
  const chatPanel = document.querySelector('.chat-panel')
  if (chatPanel) {
    chatPanelResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        chatPanelHeight.value = entry.contentRect.height
        // 如果当前有设置的消息高度，需要重新计算最大高度
        if (messagesHeight.value) {
          const inputAreaHeight = 180
          const maxPossibleHeight = Math.max(200, chatPanelHeight.value - inputAreaHeight)
          const currentHeight = parseInt(messagesHeight.value)
          // 如果当前高度超过了新的最大高度，调整它
          if (currentHeight > maxPossibleHeight) {
            messagesHeight.value = maxPossibleHeight + 'px'
          }
        }
      }
      nextTick(updateContentViewport)
    })
    chatPanelResizeObserver.observe(chatPanel)
  }

  // 点击外部关闭操作菜单 - 现在由 MessageList 组件内部处理

  // Get working directory
  try {
    const info = await window.electronAPI.getRuntimeInfo()
    workingDirectory.value = info.workingDirectory || ''
  } catch (error) {
    // Ignore error
  }

  await loadModelConfigContext()
  await loadProviderSubModels()
  await loadSessionEffortCapabilities()
  await nextTick()
  messagesViewportWidth.value = messagesContainer.value?.getBoundingClientRect?.().width || 0
  updateContentViewport()

  // 注意：所有事件现在通过 SessionStore 的 session-event 通道处理

  // 点击外部关闭权限菜单
  document.addEventListener('click', handleClickOutsidePermissionMenu)
  window.addEventListener('ccgui-session-complete', handleSessionComplete)
  window.addEventListener('ccgui-shortcut', handleChatShortcut)

  await nextTick()
  updateStickyMessage()
})

// Note: Session history is now loaded by SessionStore/SessionInstance
// The messages computed property automatically reflects sessionStore.currentMessages

onUnmounted(() => {
  removeAppErrorDialogListener?.()
  removeAppErrorDialogListener = null

  // Clean up duration timer
  if (durationTimer) {
    clearInterval(durationTimer)
    durationTimer = null
  }
  // Stop SessionStore event listener
  sessionStore.stopEventListener()
  // 清理点击外部监听器
  document.removeEventListener('click', handleClickOutsidePermissionMenu)
  // 清理窗口大小变化监听器
  window.removeEventListener('resize', handleWindowResize)
  window.removeEventListener('pointerdown', handleGlobalPointerDownForContextMenu, true)
  window.removeEventListener('ccgui-session-complete', handleSessionComplete)
  window.removeEventListener('ccgui-shortcut', handleChatShortcut)
  // 清理 chat-panel 大小变化监听器
  if (chatPanelResizeObserver) {
    chatPanelResizeObserver.disconnect()
    chatPanelResizeObserver = null
  }
})

defineExpose({
  refreshModelConfig: loadModelConfigContext,
  appendTextToInput: (text) => chatInputRef.value?.appendText(text)
})

watch(
  () => [appStore.currentProject?.id, appStore.currentSession?.id],
  async ([projectId, sessionId]) => {
    if (projectId && sessionId) {
      suppressSessionControlWatchers.value = true
      skipNextProviderRefreshSessionId.value = sessionId
      skipNextSubModelRefreshSessionId.value = sessionId
      try {
        const availabilityResult = await window.electronAPI.getSessionAvailable({
          projectId,
          sessionId
        })
        sessionAvailability.value = availabilityResult?.success
          ? {
              available: availabilityResult.available !== false,
              reason: availabilityResult.reason || '',
              initProvider: availabilityResult.initProvider || null,
              currentProvider: availabilityResult.currentProvider || null
            }
          : {
              available: true,
              reason: '',
              initProvider: null,
              currentProvider: null
            }
        await loadModelConfigContext()
        const restored = restoreSessionDerivedState(sessionId)
        if (!restored) {
          await loadProviderSubModels()
          await loadSessionEffortCapabilities()
        }
        await nextTick()
      } finally {
        suppressSessionControlWatchers.value = false
      }
    } else {
      sessionAvailability.value = {
        available: true,
        reason: '',
        initProvider: null,
        currentProvider: null
      }
      suppressSessionControlWatchers.value = false
      skipNextProviderRefreshSessionId.value = ''
      skipNextSubModelRefreshSessionId.value = ''
      resetModelState()
    }
  },
  { immediate: true }
)

watch(
  () => [appStore.currentSession?.id, currentModelProvider.value],
  async ([sessionId, provider], [previousSessionId, previousProvider]) => {
    if (suppressSessionControlWatchers.value) {
      return
    }

    if (!sessionId || sessionId !== previousSessionId) {
      return
    }

    if (skipNextProviderRefreshSessionId.value === sessionId) {
      skipNextProviderRefreshSessionId.value = ''
      return
    }

    if (provider && provider !== previousProvider) {
      await loadModelConfigContext()
      resetSubModelState()
      resetEffortState()
      await loadProviderSubModels({ force: true })
      await loadSessionEffortCapabilities({ force: true })
    }
  }
)

watch(
  () => [appStore.currentSession?.id, currentSubModelKey.value],
  async ([sessionId, subModel], [previousSessionId, previousSubModel]) => {
    if (suppressSessionControlWatchers.value) {
      return
    }

    if (!sessionId || sessionId !== previousSessionId) {
      return
    }

    if (skipNextSubModelRefreshSessionId.value === sessionId) {
      skipNextSubModelRefreshSessionId.value = ''
      return
    }

    if (subModel && subModel !== previousSubModel) {
      resetEffortState()
      await loadSessionEffortCapabilities({ force: true })
    }
  }
)

// 点击外部关闭权限菜单
function handleClickOutsidePermissionMenu(event) {
  const wrapper = document.querySelector('.permission-mode-wrapper')
  if (wrapper && !wrapper.contains(event.target)) {
    showPermissionMenu.value = false
  }
}

// 监听流式更新（消息内容变化导致高度增加）
// 使用 sync flush 在 DOM 更新前记录状态
let wasNearBottomBeforeStreaming = true
watch(() => {
  // 检查是否有正在流式更新的消息
  if (!messages.value) return null
  const hasStreaming = messages.value.some(m => m.isStreaming)
  return hasStreaming
}, (hasStreaming) => {
  const container = getScrollContainer()
  if (hasStreaming && container) {
    // 在 DOM 更新前检查滚动位置
    wasNearBottomBeforeStreaming = container.scrollHeight - container.scrollTop - container.clientHeight < STREAMING_NEAR_BOTTOM_PX
  }
}, { immediate: false, flush: 'sync' })

// 在 DOM 更新后处理流式更新的滚动
watch(() => {
  // 检查是否有正在流式更新的消息
  if (!messages.value) return null
  const hasStreaming = messages.value.some(m => m.isStreaming)
  return hasStreaming
}, async (hasStreaming) => {
  if (hasStreaming && wasNearBottomBeforeStreaming) {
    // 等待 DOM 更新
    await nextTick()
    // 如果之前在底部，强制滚动
    scrollToBottom(true)
  }
}, { immediate: false, deep: true })

// 监听消息内容变化（流式更新），处理高度变化
watch(() => messages.value, async (newMessages) => {
  if (!newMessages || newMessages.length === 0) return

  // 检查是否有正在流式更新的消息
  const hasStreamingMessage = newMessages.some(m => m.isStreaming || m.isExecuting)
  if (!hasStreamingMessage) return

  // 在 DOM 更新前检查用户是否在底部
  const container = getScrollContainer()
  if (!container) return

  // 等待 DOM 更新
  await nextTick()

  // nextTick 后重新检查：用户可能在等待期间已向上滚动
  const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < STREAMING_NEAR_BOTTOM_PX
  if (isNearBottom) {
    scrollToBottom(true)
  }
}, { deep: true, immediate: false })

watch(
  () => [
    hasCollaborativeChildren.value,
    agentWorkspaceState.value.collaborativeViewMode,
    activeCollaborativeSession.value?.agentId,
    splitSideSessions.value.length,
    agentWorkspaceAgents.value.length
  ],
  async () => {
    await nextTick()
    updateContentViewport()
  },
  { immediate: false }
)

// 监听消息变化，当有新消息时自动折叠之前已完成的消息
watch(() => messages.value, async (newMessages) => {
  const newLength = newMessages?.length || 0

  if (newLength > previousMessageCount) {
    // 检查用户是否在底部（在折叠前检查）
    const container = getScrollContainer()
    const wasNearBottom = container
      ? container.scrollHeight - container.scrollTop - container.clientHeight < 50
      : true

    // 等待 DOM 更新完成
    await nextTick()

    // 有新消息添加，自动折叠之前已完成的消息
    const lastIndex = newLength - 1
    let collapsedCount = 0

    newMessages.forEach((message, index) => {
      // 不折叠最后一条消息
      if (index === lastIndex) return

      // 只处理有 collapsed 属性的消息
      if (!message.hasOwnProperty('collapsed')) return

      // 跳过手动展开的消息
      if (message.manuallyExpanded) {
        return
      }

      // 折叠已完成的 tool_use / diff 消息
      if ((message.role === 'tool_use' || message.role === 'diff') && message.result && !message.isError && !message.isExecuting) {
        message.collapsed = true
        collapsedCount++
      }

      // 折叠已完成的 question 消息
      if (message.role === 'question' && message.resultReceived) {
        message.collapsed = true
        collapsedCount++
      }
    })

    // 如果有折叠发生且用户之前在底部，折叠后保持在底部
    if (collapsedCount > 0 && wasNearBottom) {
      await nextTick()
      scrollToBottom(true)
    }
  }
  previousMessageCount = newLength
  await nextTick()
  updateStickyMessage()
}, { deep: true })

watch(() => {
  const list = messages.value || []
  const lastMessage = list[list.length - 1]
  if (!lastMessage) return ''

  return JSON.stringify({
    id: lastMessage.id || '',
    role: lastMessage.role || '',
    notificationType: lastMessage.notificationType || '',
    timestamp: lastMessage.timestamp || '',
    duration: lastMessage.duration ?? null,
    content: typeof lastMessage.content === 'string' ? lastMessage.content : '',
    scope: lastMessage.scope || '',
    data: lastMessage.role === 'system_notification' ? (lastMessage.data || null) : null
  })
}, async (newSignature, oldSignature) => {
  if (!newSignature || newSignature === oldSignature) return

  const container = getScrollContainer()
  if (!container) return

  const lastMessage = messages.value?.[messages.value.length - 1]
  if (!lastMessage) return

  if (lastMessage.role !== 'system_notification' && lastMessage.role !== 'status') {
    return
  }

  const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < SYSTEM_NEAR_BOTTOM_PX
  if (!wasNearBottom && userScrolledAway) {
    return
  }

  await nextTick()
  scrollToBottom(true)
}, { deep: false })

// 监听 session 切换，同步权限模式
watch(() => sessionStore.currentSessionId, async (newSessionId, oldSessionId) => {
  if (newSessionId && newSessionId !== oldSessionId) {
    console.log('[Chat] Session switch started:', {
      newSessionId,
      oldSessionId,
      currentPermissionMode: permissionMode.value
    })

    // 等待 DOM 更新和 session 数据初始化完成
    await nextTick()

    // 获取当前会话
    const currentSession = sessionStore.currentSession
    console.log('[Chat] Session switch details:', {
      newSessionId,
      oldSessionId,
      sessionExists: !!currentSession,
      sessionPermissionMode: currentSession?.permissionMode,
      currentPermissionMode: permissionMode.value,
      sessionRuntimeReady: currentSession?.runtimeReady,
      sessionEnvInfo: currentSession?.envInfo ? 'exists' : 'null'
    })

    if (currentSession) {
      permissionMode.value = currentSession.permissionMode || 'default'
      console.log('[Chat] ✅ Synced permission mode from session:', permissionMode.value)

      if (currentSession.envInfo?.provider === 'codex') {
        await syncStoredCodexUsageForSession(currentSession)
        refreshCodexUsageForSession(currentSession)
      }
    } else {
      permissionMode.value = 'default'
      console.log('[Chat] ❌ No current session, using default permission mode')
    }

    console.log('[Chat] 🎯 Final permission mode after sync:', permissionMode.value)

    // 切换 session 时强制滚动到底部
    setTimeout(() => {
      scrollToBottom(true)
    }, 100)
  } else {
    console.log('[Chat] Session unchanged:', {
      newSessionId,
      oldSessionId,
      sameSession: newSessionId === oldSessionId
    })
  }
})

// 处理消息点击（Cmd+点击显示详情）
function handleMessageClick(event, message) {
  // 检查是否按住了 Cmd (Mac) 或 Ctrl (Windows/Linux)
  if (event.metaKey || event.ctrlKey) {
    event.preventDefault()
    event.stopPropagation()
    selectedMessage.value = message
  }
}

function handleMessagesMouseDown(event) {
  const selection = window.getSelection()
  if (!selection || selection.type !== 'Range') return
  // 只有点击在文本内容区域内才保留选区（允许拖拽调整）
  const textEl = event.target.closest?.('.markdown-content, .message-text, .assistant-message, .user-message, INPUT, TEXTAREA, [contenteditable]')
  if (textEl) return
  selection.removeAllRanges()
}

// 处理 PID 点击（启动/关闭运行时）
function handlePidClick() {
  const currentSession = sessionStore.currentSession
  if (!currentSession) return

  // 根据运行时状态决定操作
  if (runtimeActive.value) {
    // 运行时已启动，执行关闭
    emit('closeSession', { id: currentSession.id })
  } else {
    // 运行时未启动，执行启动
    emit('startSession', { id: currentSession.id })
  }
}

function buildCodexRateLimitsFromUsage(usage) {
  if (!usage || typeof usage !== 'object') {
    return null
  }

  const primary = usage.primaryWindow
  const secondary = usage.secondaryWindow
  const hasPrimary = primary && primary.remainingPercent !== null
  const hasSecondary = secondary && secondary.remainingPercent !== null

  if (!hasPrimary && !hasSecondary) {
    return null
  }

  return {
    planType: usage.planType || null,
    limitName: usage.accountName || usage.email || usage.accountId || null,
    primary: hasPrimary
      ? {
          label: '5小时',
          used: primary.usedPercent,
          resetAfter: primary.resetAfterSeconds || null,
          resetAt: primary.resetAt || null
        }
      : null,
    secondary: hasSecondary
      ? {
          label: '1周',
          used: secondary.usedPercent,
          resetAfter: secondary.resetAfterSeconds || null,
          resetAt: secondary.resetAt || null
        }
      : null
  }
}

async function syncStoredCodexUsageForSession(targetSession) {
  if (!targetSession || targetSession.envInfo?.provider !== 'codex') {
    return
  }

  try {
    const result = await window.electronAPI.getActiveCodexAccountUsageSnapshot()
    if (!result?.success) {
      return
    }

    const currentEnvInfo = targetSession.envInfo || {}
    const snapshotUsage = result.usage
      ? {
          ...result.usage,
          accountName: result.usage.accountName || result.accountName || ''
        }
      : null
    const nextRateLimits = buildCodexRateLimitsFromUsage(snapshotUsage)
    const nextUsageError = result.usageError || null

    if (!nextRateLimits && !nextUsageError) {
      return
    }

    targetSession.envInfo = {
      ...currentEnvInfo,
      rate_limits: nextRateLimits || currentEnvInfo.rate_limits || null,
      codex_usage_error: nextRateLimits ? null : nextUsageError
    }
  } catch (error) {
    logger.warn('[Chat] Failed to apply stored codex usage snapshot', error?.message || String(error))
  }
}

async function refreshCodexUsageForSession(targetSession) {
  if (!targetSession || targetSession.envInfo?.provider !== 'codex' || codexUsageRefreshing.value) {
    return
  }

  codexUsageRefreshing.value = true
  try {
    const result = await window.electronAPI.getCodexUsageStatus()
    const currentEnvInfo = targetSession.envInfo || {}

    if (result?.success) {
      if (!result.usage) {
        targetSession.envInfo = {
          ...currentEnvInfo,
          codex_usage_error: {
            code: 'empty_usage',
            message: 'Codex usage refresh returned empty data',
            status: null
          }
        }
        return
      }

      targetSession.envInfo = {
        ...currentEnvInfo,
        rate_limits: buildCodexRateLimitsFromUsage(result.usage),
        codex_usage_error: null
      }
      return
    }

    targetSession.envInfo = {
      ...currentEnvInfo,
      codex_usage_error: {
        code: null,
        message: result?.error || 'Codex usage refresh failed',
        status: null
      }
    }
  } catch (error) {
    const currentEnvInfo = targetSession.envInfo || {}
    targetSession.envInfo = {
      ...currentEnvInfo,
      codex_usage_error: {
        code: error?.code || null,
        message: error?.message || 'Codex usage refresh failed',
        status: Number(error?.statusCode || 0) || null
      }
    }
  } finally {
    codexUsageRefreshing.value = false
  }
}

async function handleRefreshCodexUsage() {
  await syncStoredCodexUsageForSession(sessionStore.currentSession)
  await refreshCodexUsageForSession(sessionStore.currentSession)
}

// Rewind 确认对话框状态
const showRewindDialog = ref(false)
const rewindPreviewData = ref(null)
const rewindTargetMessageId = ref(null)
const rewindTargetMessageIndex = ref(null)
const rewindPreviewLoading = ref(false)
const rewindActionMode = ref('reset')
const rewindActionType = ref('undo')
const showErrorDialog = ref(false)
const errorDialogState = ref({
  title: '操作失败',
  message: '操作未完成',
  detail: '',
  confirmText: '知道了'
})
let removeAppErrorDialogListener = null

const rewindActionTitle = computed(() => {
  if (rewindActionMode.value === 'patch') {
    return rewindActionType.value === 'redo' ? '确认重做本次修改' : '确认撤销本次修改'
  }
  return '确认重置文件'
})
const rewindActionPreviewText = computed(() => {
  if (rewindActionMode.value === 'patch') {
    return rewindActionType.value === 'redo' ? '将重做' : '将撤销'
  }
  return '将重置'
})
const rewindActionEmptyText = computed(() => {
  if (rewindActionMode.value === 'patch') {
    return rewindActionType.value === 'redo' ? '没有本次修改可重做' : '没有本次修改需要撤销'
  }
  return '没有文件需要重置'
})
const rewindActionLoadingText = computed(() => {
  if (rewindActionMode.value === 'patch') {
    return rewindActionType.value === 'redo' ? '正在获取重做预览...' : '正在获取撤销预览...'
  }
  return '正在获取重置预览...'
})
const rewindActionConfirmText = computed(() => rewindPreviewLoading.value
  ? '获取预览中...'
  : (
      rewindActionMode.value === 'patch'
        ? (rewindActionType.value === 'redo' ? '确认重做' : '确认撤销')
        : '确认重置'
    ))

function normalizePreviewFiles(files = []) {
  return Array.isArray(files)
    ? files
        .map(file => {
          if (typeof file === 'string') {
            const trimmed = file.trim()
            return trimmed || null
          }
          if (file && typeof file === 'object' && typeof file.path === 'string') {
            const trimmed = file.path.trim()
            return trimmed || null
          }
          return null
        })
        .filter(Boolean)
    : []
}

function resolveSummaryPreviewData(summaryMessage = null) {
  if (!summaryMessage || typeof summaryMessage !== 'object') {
    return null
  }

  return {
    files: Array.from(new Set(normalizePreviewFiles(summaryMessage.files))),
    insertions: summaryMessage.totalInsertions || 0,
    deletions: summaryMessage.totalDeletions || 0
  }
}

function findSummaryMessage(summaryMessageId = null, userMessageId = null) {
  if (summaryMessageId) {
    const exactMatch = messages.value.find(message => message?.id === summaryMessageId && message?.role === 'file_change_summary')
    if (exactMatch) {
      return exactMatch
    }
  }

  if (userMessageId) {
    return messages.value.find(message => (
      message?.role === 'file_change_summary' &&
      message?.userMessageId === userMessageId
    )) || null
  }

  return null
}

// 复制粘性窗口内容
const stickyCopied = ref(false)
async function copyStickyMessage() {
  if (!stickyMessage.value) return

  try {
    await navigator.clipboard.writeText(stickyMessage.value.content)
    stickyCopied.value = true
    setTimeout(() => {
      stickyCopied.value = false
    }, 2000)
  } catch (err) {
    console.error('复制失败:', err)
  }
}

// 滚动到粘性消息对应的用户消息
function scrollToStickyMessage() {
  if (!stickyMessage.value || !stickyMessage.value.id) return
  scrollToMessage(stickyMessage.value.id)
}

// 关闭消息详情弹窗
function closeMessageDetail() {
  selectedMessage.value = null
}

// 为消息添加原始数据
function addRawMessage(displayMessage, rawMessage) {
  if (!displayMessage.rawMessages) {
    displayMessage.rawMessages = []
  }
  displayMessage.rawMessages.push(rawMessage)
}

// 处理发送消息（从 ChatInput 组件调用）
async function handleSendMessage(userText) {
  if (sessionAvailability.value.available === false) {
    messages.value.push({
      role: 'system',
      content: sessionUnavailableMessage.value || '当前会话不可用',
      timestamp: new Date()
    })
    return
  }

  // 如果实例未启动，先入队并启动实例
  if (!runtimeActive.value) {
    enqueueMessage(userText)
    inputMessage.value = ''
    scrollToBottom(true)
    emit('startSession', { id: sessionStore.currentSession?.id })
    return
  }

  if (isProcessing.value || pendingPermission.value || pendingControlRequest.value || isFlushingQueuedMessage.value) {
    enqueueMessage(userText)
    inputMessage.value = ''
    scrollToBottom(true)
    return
  }

  // 折叠之前所有用户消息的回答
  if (appConfig.value?.settings?.collapseOnSend !== false) {
    messages.value.forEach(msg => {
      if (msg.role === 'user') {
        msg.responseCollapsed = true
      }
    })
  }

  inputMessage.value = ''
  scrollToBottom(true) // 用户发送消息时强制滚动

  try {
    // 使用 SessionStore 发送消息（会自动处理 sessionId）
    await sessionStore.sendMessage(userText)
  } catch (error) {
    console.error('[ChatWindow] Failed to send message:', error)
    const errorText = error?.message || String(error)
    notifyTurnError(`发送消息失败: ${errorText}`, {
      asDialog: true,
      title: '发送消息失败',
      message: '消息未发送成功',
      detail: errorText
    })
  }
}

// 滚动到指定消息
function scrollToMessage(messageId) {
  if (!messagesContainer.value) return

  const messageElement = document.querySelector(`[data-message-id="${messageId}"]`)
  if (messageElement) {
    messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
    // 高亮效果
    messageElement.classList.add('highlight-message')
    setTimeout(() => {
      messageElement.classList.remove('highlight-message')
    }, 2000)
  }
}

// 处理还原消息点击
function handleRewindNoticeClick(rewindToMessageId) {
  scrollToMessage(rewindToMessageId)
}

// 记录用户是否主动滚动离开底部
let userScrolledAway = false

function notifyTurnError(message, options = {}) {
  if (options.asDialog) {
    openAppErrorDialog({
      title: options.title || '操作失败',
      message: options.message || '操作未完成',
      detail: typeof options.detail === 'string' ? options.detail : message
    })
    return
  }

  sessionStore.addMessage({
    id: `turn-error-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role: 'system_notification',
    notificationType: 'turn-error',
    scope: 'turn',
    data: { type: 'turn-error', message },
    timestamp: new Date()
  })
}

function openErrorDialog(options = {}) {
  errorDialogState.value = {
    title: options.title || '操作失败',
    message: options.message || '操作未完成',
    detail: options.detail || '',
    confirmText: options.confirmText || '知道了'
  }
  showErrorDialog.value = true
}

function closeErrorDialog() {
  showErrorDialog.value = false
}

function getScrollContainer() {
  return document.querySelector('.chat-window .agent-workspace__content') || messagesContainer.value || null
}

// 滚动到底部
let pendingScrollRAF = null
function scrollToBottom(forceScroll = false) {
  const container = getScrollContainer()
  if (!container) return

  // 如果不强制滚动，检查当前是否接近底部
  if (!forceScroll) {
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < AUTO_SCROLL_NEAR_BOTTOM_PX

    // 如果用户已经滚动离开底部，不要自动滚动
    if (userScrolledAway && !isNearBottom) {
      return
    }

    // 如果当前不在底部，也不滚动
    if (!isNearBottom) {
      return
    }
  }

  // 重置用户滚动标记
  userScrolledAway = false

  // 取消上一次待处理的 RAF 滚动，避免流式更新时重叠
  if (pendingScrollRAF) {
    cancelAnimationFrame(pendingScrollRAF)
    pendingScrollRAF = null
  }

  const doScroll = () => {
    const activeContainer = getScrollContainer()
    if (activeContainer) {
      activeContainer.scrollTop = activeContainer.scrollHeight
    }
  }

  // 立即滚动一次
  doScroll()

  // 等待 DOM 完全更新后再滚动一次（处理异步渲染的高高度元素）
  nextTick(() => {
    pendingScrollRAF = requestAnimationFrame(() => {
      pendingScrollRAF = null
      doScroll()
    })
  })
}

// 处理用户滚动事件
function handleUserScroll() {
  const container = getScrollContainer()
  if (!container) return
  const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < AUTO_SCROLL_NEAR_BOTTOM_PX

  // 如果用户滚动离开底部，设置标记
  if (!isNearBottom) {
    userScrolledAway = true
  } else {
    // 如果用户滚动到底部，重置标记
    userScrolledAway = false
  }

  // 计算当前粘性显示的用户消息
  updateStickyMessage()
}

// 更新粘性头部显示的用户消息
function updateStickyMessage() {
  const container = getScrollContainer()
  if (!container) return

  // 获取所有消息元素
  const messageElements = container.querySelectorAll('.message')

  let lastScrolledPastUserId = null

  // 从上往下遍历，找到最后一个已经滚过顶部的用户消息
  messageElements.forEach((el) => {
    const rect = el.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()

    // 消息顶部已滚过容器顶部（放宽阈值到 40px）
    if (rect.top <= containerRect.top + 40) {
      const msgId = el.getAttribute('data-message-id')
      if (!msgId) return

      const msg = messages.value.find(m => m.id === msgId)
      if (msg && msg.role === 'user') {
        lastScrolledPastUserId = msgId
      }
    }
  })

  // 检查可见区域内是否有用户消息
  let hasVisibleUserMessage = false
  messageElements.forEach((el) => {
    const rect = el.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()

    // 消息在可见区域内
    if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
      const msgId = el.getAttribute('data-message-id')
      if (!msgId) return

      const msg = messages.value.find(m => m.id === msgId)
      if (msg && msg.role === 'user') {
        hasVisibleUserMessage = true
      }
    }
  })

  // 只有当可见区域内没有用户消息时，才显示粘性头部
  if (hasVisibleUserMessage) {
    stickyMessageId.value = null
  } else if (lastScrolledPastUserId) {
    stickyMessageId.value = lastScrolledPastUserId
  } else {
    stickyMessageId.value = null
  }
}

// 通过 ID 获取粘性消息（确保响应式更新）
const stickyMessage = computed(() => {
  if (!stickyMessageId.value) return null
  return messages.value.find(m => m.id === stickyMessageId.value) || null
})

// 判断粘性消息是否正在被回答（基于消息是否有 duration）
const isStickyMessageProcessing = computed(() => {
  if (!stickyMessage.value) return false
  if (stickyMessage.value.role === 'assistant') return !!stickyMessage.value.isStreaming
  if (stickyMessage.value.role === 'tool_use' || stickyMessage.value.role === 'diff') return !!stickyMessage.value.isExecuting
  if (stickyMessage.value.role === 'user') return !!isProcessing.value && !stickyMessage.value.duration
  return false
})

// 处理窗口大小变化，将高度变化全部作用到 messages 区域
function handleWindowResize() {
  const currentHeight = window.innerHeight
  const delta = currentHeight - previousWindowHeight

  // 更新上一次窗口高度
  previousWindowHeight = currentHeight

  // 如果有用户手动设置的高度，则调整它
  if (messagesHeight.value) {
    // 解析当前高度值
    const currentMessagesHeight = parseInt(messagesHeight.value)
    // 计算新的高度
    const newHeight = Math.max(200, currentMessagesHeight + delta)
    messagesHeight.value = newHeight + 'px'
  }
  nextTick(updateContentViewport)
  // 如果没有设置高度（自动模式），则不需要处理，让 flex 布局自动调整
}

function updateContentViewport() {
  const messagesRect = messagesContainer.value?.getBoundingClientRect?.()
  const contentEl = document.querySelector('.chat-window .agent-workspace__content')
  const contentRect = contentEl?.getBoundingClientRect?.()

  messagesViewportWidth.value = messagesRect?.width || 0

  if (!messagesRect || !contentRect) {
    contentViewport.value = { left: 0, right: 0, width: 0 }
    return
  }

  contentViewport.value = {
    left: Math.max(0, contentRect.left - messagesRect.left),
    right: Math.max(0, messagesRect.right - contentRect.right),
    width: Math.max(0, contentRect.width)
  }
}

// 开始调整大小
function startResize(event) {
  event.preventDefault()
  isResizing.value = true

  const startY = event.clientY
  const startHeight = messagesContainer.value ? messagesContainer.value.offsetHeight : 400

  function onMouseMove(e) {
    if (!isResizing.value) return

    const deltaY = e.clientY - startY

    // 向上拖拽压缩 messages 区域
    // 向下拖拽扩大 messages 区域
    let newHeight = startHeight + deltaY

    // 使用 chat-panel 的当前高度
    const currentChatPanelHeight = chatPanelHeight.value
    if (currentChatPanelHeight <= 0) {
      // 如果还没有获取到高度，使用 window.innerHeight 作为回退
      const maxPossibleHeight = window.innerHeight - 180
      newHeight = Math.max(200, Math.min(maxPossibleHeight, newHeight))
    } else {
      // 使用 chat-panel 的高度
      const inputAreaHeight = 180
      const maxPossibleHeight = currentChatPanelHeight - inputAreaHeight
      const minPossibleHeight = 200

      // 限制高度范围
      newHeight = Math.max(minPossibleHeight, Math.min(maxPossibleHeight, newHeight))
    }

    messagesHeight.value = newHeight + 'px'
  }

  function onMouseUp() {
    isResizing.value = false
    document.removeEventListener('mousemove', onMouseMove)
    document.removeEventListener('mouseup', onMouseUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
  }

  document.addEventListener('mousemove', onMouseMove)
  document.addEventListener('mouseup', onMouseUp)
  document.body.style.cursor = 'ns-resize'
  document.body.style.userSelect = 'none'
}

// 处理打断请求
async function handleInterrupt() {
  try {
    await sessionStore.sendInterrupt()
  } catch (error) {
    console.error('发送打断请求失败:', error)
  }
}

function handleInputTargetChange(agentId) {
  if (!agentId) return
  sessionStore.setInputTargetAgentId(agentId)
}

async function handlePermissionApprove(requestId, toolName, displayDetail) {
  const controlRequest = pendingControlRequest.value

  // 清除权限请求，并保存请求信息用于后续添加权限结果消息
  // 气泡会在 CLI 返回 control_response 后添加
  sessionStore.clearPendingPermissions(requestId, true)

  // 注意: 工具刚刚被批准，还没有执行完成，所以 isExecuting 应该保持 true
  // 工具执行完成后会通过 toolResult 事件来更新状态

  try {
    // Check if this is a control_request (for --permission-prompt-tool stdio)
    if (controlRequest && controlRequest.request_id === requestId) {
      // 对于单次批准，不传递 permissionRules
      // 这样 CLI 就不会记住这个决定，下次还会询问
      const options = {}

      // 添加 toolUseID (从 controlRequest.tool_use_id 获取)
      if (controlRequest.tool_use_id) {
        options.toolUseID = controlRequest.tool_use_id
      }

      // 传递工具的输入参数作为 updatedInput
      // 支持多种字段名：input, tool_input, toolInput
      const toolInput = controlRequest.input || controlRequest.tool_input || controlRequest.toolInput
      if (toolInput) {
        options.updatedInput = typeof toolInput === 'string' ? JSON.parse(toolInput) : JSON.parse(JSON.stringify(toolInput))
      }

      // 如果仍然没有 updatedInput，使用空对象（某些工具可能没有输入）
      if (!options.updatedInput) {
        options.updatedInput = {}
      }

      // 构建完整的响应消息用于日志
      const responseMessage = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: {
            behavior: 'allow',
            ...options
          }
        }
      }

      await sessionStore.sendControlResponse(requestId, true, options)
    } else {
      // Regular tool_use permission
      const responseMessage = {
        type: 'tool_result',
        tool_use_id: requestId,
        content: '',
        is_error: false
      }

      await sessionStore.sendRuntimeToolResult(requestId, '', false)
    }
  } catch (error) {
    console.error('[ChatWindow] Failed to approve permission:', error)
    notifyTurnError(`批准权限失败: ${error.message || error}`)
  }
}

async function handlePermissionDeny(requestId) {
  const controlRequest = pendingControlRequest.value

  // 清除权限请求，并保存请求信息用于后续添加权限结果消息
  sessionStore.clearPendingPermissions(requestId, true)

  try {
    // Check if this is a control_request (for --permission-prompt-tool stdio)
    if (controlRequest && controlRequest.request_id === requestId) {
      const options = {
        message: 'Permission denied by user'
      }
      // 添加 toolUseID (从 controlRequest.tool_use_id 获取)
      if (controlRequest.tool_use_id) {
        options.toolUseID = controlRequest.tool_use_id
      }

      await sessionStore.sendControlResponse(requestId, false, options)
    } else {
      // Regular tool_use permission
      await sessionStore.sendRuntimeToolResult(requestId, 'Permission denied by user', true)
    }
  } catch (error) {
    console.error('[ChatWindow] Failed to deny permission:', error)
    notifyTurnError(`拒绝权限失败: ${error.message || error}`)
  }
}

async function handlePermissionApproveAll(requestId) {
  const controlRequest = pendingControlRequest.value

  // 清除权限请求，并保存请求信息用于后续添加权限结果消息
  // 气泡会在 CLI 返回 control_response 后添加
  sessionStore.clearPendingPermissions(requestId, true)

  try {
    // Check if this is a control_request (for --permission-prompt-tool stdio)
    if (controlRequest && controlRequest.request_id === requestId) {
      // 对于 approve all，需要传递 permissionRules 来添加规则
      // 这样 CLI 会记住这个决定，以后类似的工具调用就不会再询问
      const options = {}

      // 添加 toolUseID (从 controlRequest.tool_use_id 获取)
      if (controlRequest.tool_use_id) {
        options.toolUseID = controlRequest.tool_use_id
      }

      if (controlRequest.permission_suggestions && controlRequest.permission_suggestions.length > 0) {
        // 传递完整的 permission_suggestions 数组
        options.permissionRules = JSON.parse(JSON.stringify(controlRequest.permission_suggestions))
      }

      // 支持多种字段名：input, tool_input, toolInput
      const toolInput = controlRequest.input || controlRequest.tool_input || controlRequest.toolInput
      if (toolInput) {
        options.updatedInput = typeof toolInput === 'string' ? JSON.parse(toolInput) : JSON.parse(JSON.stringify(toolInput))
      }

      // 如果仍然没有 updatedInput，使用空对象
      if (!options.updatedInput) {
        options.updatedInput = {}
      }

      // 构建完整的响应消息用于日志
      const responseMessage = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: {
            behavior: 'allow',
            toolUseID: options.toolUseID,
            updatedInput: options.updatedInput,
            updatedPermissions: options.permissionRules
          }
        }
      }

      await sessionStore.sendControlResponse(requestId, true, options)
    } else {
      // Regular tool_use permission
      const responseMessage = {
        type: 'tool_result',
        tool_use_id: requestId,
        content: '',
        is_error: false
      }

      await sessionStore.sendRuntimeToolResult(requestId, '', false)
    }
  } catch (error) {
    // Ignore error
  }
}

// 处理代码还原 - 接收 MessageList 发出的事件对象
function buildRewindRequestSubtype(mode, withFork = false, actionType = 'undo') {
  const normalizedMode = mode === 'patch' ? 'patch' : 'reset'
  const normalizedActionType = actionType === 'redo' ? 'redo' : 'undo'
  if (withFork) {
    return normalizedMode === 'patch' ? 'undo_patch_and_fork' : 'reset_files_and_fork'
  }
  if (normalizedMode === 'patch') {
    return normalizedActionType === 'redo' ? 'redo_patch' : 'undo_patch'
  }
  return 'reset_files'
}

async function handleRewind({ messageId, messageIndex, rewindMode = 'reset', actionType = 'undo', summaryMessageId = null }) {
  rewindTargetMessageId.value = messageId
  rewindTargetMessageIndex.value = messageIndex
  rewindActionMode.value = rewindMode === 'patch' ? 'patch' : 'reset'
  rewindActionType.value = actionType === 'redo' ? 'redo' : 'undo'
  rewindPreviewData.value = null
  showRewindDialog.value = true

  if (rewindActionMode.value === 'patch' && rewindActionType.value === 'redo') {
    rewindPreviewLoading.value = false
    rewindPreviewData.value = resolveSummaryPreviewData(findSummaryMessage(summaryMessageId, messageId))
    return
  }

  rewindPreviewLoading.value = true

  try {
    const previewResponse = await sessionStore.sendControlRequest({
      subtype: 'changed_files',
      user_message_id: messageId,
      preview_only: true
    })

    let data = null
    if (previewResponse && previewResponse.response) {
      data = previewResponse.response.response || previewResponse.response
    } else {
      data = previewResponse || null
    }

    rewindPreviewData.value = {
      files: Array.from(new Set(normalizePreviewFiles(data?.changed_files || data?.filesChanged || data?.restored_files || []))),
      insertions: data?.insertions || data?.lines_added || 0,
      deletions: data?.deletions || data?.lines_removed || 0
    }
  } catch (error) {
    console.error('[Rewind] Preview error:', error)
    showRewindDialog.value = false
    rewindPreviewData.value = null
    rewindTargetMessageId.value = null
    rewindTargetMessageIndex.value = null
    const errorText = error?.message || String(error)
    notifyTurnError(`获取预览失败: ${errorText}`, {
      asDialog: true,
      title: '获取预览失败',
      message: '无法获取本次文件变更预览',
      detail: errorText
    })
  } finally {
    rewindPreviewLoading.value = false
  }
}

// 确认执行还原
async function confirmRewind() {
  if (rewindPreviewLoading.value) {
    return
  }

  showRewindDialog.value = false

  try {
    const response = await sessionStore.sendControlRequest({
      subtype: buildRewindRequestSubtype(rewindActionMode.value, false, rewindActionType.value),
      user_message_id: rewindTargetMessageId.value
    })

    if (response && response.response) {
      scrollToBottom()
    }
  } catch (error) {
    console.error('[Rewind] Error:', error)
    const actionLabel = rewindActionMode.value === 'patch'
      ? (rewindActionType.value === 'redo' ? '重做本次修改' : '撤销本次修改')
      : '重置文件'
    const errorText = error?.message || String(error)
    notifyTurnError(`${actionLabel}失败: ${errorText}`, {
      asDialog: true,
      title: `${actionLabel}失败`,
      message: `${actionLabel}未完成`,
      detail: errorText
    })
  }
}

// 取消还原
function cancelRewind() {
  showRewindDialog.value = false
  rewindPreviewData.value = null
  rewindPreviewLoading.value = false
  rewindTargetMessageId.value = null
  rewindTargetMessageIndex.value = null
  rewindActionMode.value = 'reset'
  rewindActionType.value = 'undo'
}

useDialogStack(computed(() => showRewindDialog.value), cancelRewind)

// 处理创建分支 - 接收 MessageList 发出的事件对象
async function handleFork({ messageId, messageIndex }) {

  const confirmed = confirm(
    '确定要从此处创建会话分支吗？\n\n' +
    '这将：\n' +
    '• 创建一个新的会话副本\n' +
    '• 复制到此消息为止的所有内容\n' +
    '• 新会话将独立存在，不影响当前会话'
  )

  if (!confirmed) return

  try {
    // 后端会自动处理运行时启动（如果需要）
    const response = await sessionStore.sendControlRequest({
      subtype: 'fork_session',
      message_id: messageId
    })

    if (response && response.response) {
      scrollToBottom()
    }
  } catch (error) {
    console.error('[Fork] Error:', error)
    const errorText = error?.message || String(error)
    notifyTurnError(`创建分支失败: ${errorText}`, {
      asDialog: true,
      title: '创建分支失败',
      message: '未能创建会话分支',
      detail: errorText
    })
  }
}

// 处理还原并创建分支 - 接收 MessageList 发出的事件对象
async function handleRewindAndFork({ messageId, messageIndex, rewindMode = 'reset' }) {
  const normalizedMode = rewindMode === 'patch' ? 'patch' : 'reset'
  const confirmed = confirm(
    `确定要${normalizedMode === 'patch' ? '撤销本次修改并创建分支' : '重置文件并创建分支'}吗？\n\n` +
    '这将：\n' +
    '• 先将当前状态保存到新分支\n' +
    `• 然后${normalizedMode === 'patch' ? '撤销本次提问产生的补丁修改' : '将文件状态重置到此次提问之前'}\n` +
    '• 保留完整消息历史，不删除任何消息\n' +
    '• 此操作无法撤销\n\n' +
    `适用于：想保留当前进度，同时${normalizedMode === 'patch' ? '撤销这一轮修改' : '回到该提问前继续探索'}`
  )

  if (!confirmed) return

  try {
    const response = await sessionStore.sendControlRequest({
      subtype: buildRewindRequestSubtype(normalizedMode, true),
      user_message_id: messageId
    })

    if (response && response.response) {
      scrollToBottom()
    }
  } catch (error) {
    console.error('[RewindAndFork] Error:', error)
    const actionLabel = normalizedMode === 'patch' ? '撤销本次修改并创建分支' : '重置文件并创建分支'
    const errorText = error?.message || String(error)
    notifyTurnError(`${actionLabel}失败: ${errorText}`, {
      asDialog: true,
      title: `${actionLabel}失败`,
      message: `${actionLabel}未完成`,
      detail: errorText
    })
  }
}

// 处理权限模式切换
async function handlePermissionModeChange(mode) {
  console.log('[Chat] handlePermissionModeChange called:', {
    newMode: mode,
    currentMode: permissionMode.value,
    modesEqual: mode === permissionMode.value,
    currentSessionId: sessionStore.currentSessionId,
    runtimeActive: runtimeActive.value
  })

  if (mode === permissionMode.value) {
    console.log('[Chat] Permission mode unchanged, skipping')
    return
  }

  const previousMode = permissionMode.value
  permissionMode.value = mode

  try {
    // 调用 sessionStore 的 setPermissionMode
    // 后端会自动判断运行时是否已启动，并在适当时机应用新模式
    console.log('[Chat] Calling sessionStore.setPermissionMode:', mode)
    await sessionStore.setPermissionMode(mode)

    console.log('[Chat] Permission mode changed successfully:', {
      previousMode,
      newMode: mode,
      sessionCurrentMode: sessionStore.currentSession?.permissionMode
    })
  } catch (error) {
    // 恢复之前的模式
    permissionMode.value = previousMode
    console.error('Failed to set permission mode:', error)
    notifyTurnError(`设置权限模式失败: ${error.message || error}`)
  }
}

// 选择权限模式（从菜单）
function selectPermissionMode(mode) {
  showPermissionMenu.value = false
  handlePermissionModeChange(mode)
}

async function handleQuestionAnswer(requestId, answers) {
  const question = pendingQuestion.value
  sessionStore.clearPendingQuestion()

  if (question) {
    // 获取 tool_use_id - 支持多种可能的字段名
    const toolUseId = question.tool_use_id || question.toolUseId || question.id || requestId

    // 获取问题数据 - 支持多种字段名格式
    let toolInput = question.input || question.tool_input || question.toolInput

    // 如果 toolInput 是字符串，尝试解析为 JSON
    if (typeof toolInput === 'string') {
      try {
        toolInput = JSON.parse(toolInput)
      } catch (e) {
        // Ignore invalid JSON string input and fall back to raw value.
      }
    }

    let questionsData = []
    if (toolInput && toolInput.questions) {
      questionsData = toolInput.questions
    } else if (question.questions) {
      questionsData = question.questions
    }

    // 构建问题列表用于显示
    const questionItems = questionsData.map((questionData, index) => {
      const questionText = questionData?.question || ''
      const header = questionData?.header || `问题 ${index + 1}`
      const options = questionData?.options || []
      const multiSelect = questionData?.multiSelect || false
      const selectedAnswer = answers[questionText] || ''

      return {
        header: String(header),
        question: String(questionText),
        options: options,
        selectedAnswer: selectedAnswer,
        multiSelect: multiSelect
      }
    })
    try {
      const options = {
        toolUseID: toolUseId,
        updatedInput: {
          answers: answers
        }
      }

      await sessionStore.sendControlResponse(requestId, true, options)
      scrollToBottom(true)
    } catch (error) {
      console.error('[ChatWindow] Failed to send control response:', error)
    }
  } else {
    console.warn('[ChatWindow] handleQuestionAnswer: question is null, cannot send response')
  }
}

function handleSelectAgent(agentId) {
  if (agentWorkspaceState.value.collaborativeViewMode === 'split') {
    sessionStore.replaceSplitPaneAgent(agentId)
    return
  }

  sessionStore.setActiveAgent(agentId)
}

function handleFocusAgent(agentId) {
  sessionStore.setFocusedPaneAgentId(agentId)
}

function handleToggleAgentViewMode(mode) {
  sessionStore.setCollaborativeViewMode(mode)
}

const isAgentRailVisible = ref(true)

const contextMenuState = ref({ show: false, x: 0, y: 0 })
let contextMenuText = ''

function handleContextMenu(event) {
  const selection = window.getSelection()
  const text = selection?.toString()?.trim()
  if (!text) return

  event.preventDefault()
  contextMenuText = text
  contextMenuState.value = { show: true, x: event.clientX, y: event.clientY }
}

function closeContextMenu() {
  contextMenuState.value = { ...contextMenuState.value, show: false }
  contextMenuText = ''
}

async function copySelectedText() {
  const text = contextMenuText
  closeContextMenu()
  if (text) {
    try {
      await navigator.clipboard.writeText(text)
    } catch (e) {
      console.error('Failed to copy:', e)
    }
  }
}

function handleGlobalPointerDownForContextMenu(event) {
  if (!contextMenuState.value.show) return
  if (event.target?.closest?.('.chat-context-menu')) return
  closeContextMenu()
}

watch(hasCollaborativeChildren, (hasChildren) => {
  if (!hasChildren) {
    isAgentRailVisible.value = true
    return
  }

  isAgentRailVisible.value = true
}, { immediate: true })

function handleToggleAgentRail() {
  if (!hasCollaborativeChildren.value) {
    return
  }
  isAgentRailVisible.value = !isAgentRailVisible.value
}
</script>

<template>
  <div class="chat-window" v-bind="attrs" @contextmenu="handleContextMenu">
    <!-- Top Bar: Environment Bar -->
    <EnvInfoBar
      :env-info="envInfo"
      :silent-messages="silentMessages"
      :project-path="appStore.currentProject?.path"
      :show-sidebar-toggle="showSidebarToggle"
      :permission-mode="permissionMode"
      :show-collapse-toggle="showCollapseToggle"
      :is-chat-collapsed="isCollapsedByPreview"
      :show-agent-rail-toggle="hasCollaborativeChildren"
      :is-agent-rail-visible="isAgentRailVisible"
      :view-mode="agentWorkspaceState.collaborativeViewMode"
      :codex-usage-refreshing="codexUsageRefreshing"
      @toggle-sidebar="emit('toggleSidebar')"
      @toggle-collapse="emit('toggleCollapse')"
      @pid-click="handlePidClick"
      @refresh-codex-usage="handleRefreshCodexUsage"
      @toggle-agent-rail="handleToggleAgentRail"
      @toggle-view-mode="handleToggleAgentViewMode"
    />
    <div class="messages" ref="messagesContainer" @scroll="handleUserScroll" @mousedown="handleMessagesMouseDown" :style="messagesHeight ? { height: messagesHeight } : {}">
      <AgentWorkspace
        :timeline-blocks="mainTimelineBlocks"
        :has-collaborative-children="hasCollaborativeChildren"
        :agent-entries="agentWorkspaceAgents"
        :collaborative-sessions="collaborativeAgentSessions"
        :active-session="activeCollaborativeSession"
        :session-id="sessionStore.currentSession?.id || ''"
        :split-sessions="splitSideSessions"
        :view-mode="agentWorkspaceState.collaborativeViewMode"
        :focused-pane-agent-id="agentWorkspaceState.focusedPaneAgentId"
        :input-target-agent-id="agentWorkspaceState.inputTargetAgentId"
        :working-directory="workingDirectory"
        :current-time="currentTime"
        :sticky-message="stickyMessage"
        :show-sticky-header="shouldShowStickyHeader"
        :sticky-is-processing="isStickyMessageProcessing"
        :sticky-copied="stickyCopied"
        :container-height="containerHeight"
        :chat-theme="resolvedChatMessageTheme"
        :rail-visible="isAgentRailVisible"
        :rail-placement="collaborativeRailPlacement"
        @select-agent="handleSelectAgent"
        @focus-agent="handleFocusAgent"
        @toggle-view-mode="handleToggleAgentViewMode"
        @message-click="handleMessageClick"
        @copy-sticky="copyStickyMessage"
        @scroll-to-sticky="scrollToStickyMessage"
        @content-scroll="handleUserScroll"
        @rewind="handleRewind"
        @fork="handleFork"
        @rewind-and-fork="handleRewindAndFork"
        @jump-to-message="handleRewindNoticeClick"
      />
    </div>

    <div v-if="showConversationWave" class="conversation-wave-rail" aria-hidden="true">
      <div class="conversation-wave">
        <svg class="conversation-wave-svg" viewBox="0 0 1200 24" preserveAspectRatio="none">
          <defs>
            <pattern id="conversation-wave-pattern-back" width="220" height="24" patternUnits="userSpaceOnUse">
              <path
                d="M0 17 C 28 12, 82 12, 110 17 C 138 22, 192 22, 220 17"
                class="conversation-wave-path layer-back"
              />
              <animateTransform
                attributeName="patternTransform"
                type="translate"
                from="0 0"
                to="-220 0"
                dur="2.9s"
                repeatCount="indefinite"
              />
            </pattern>
            <pattern id="conversation-wave-pattern-mid" width="160" height="24" patternUnits="userSpaceOnUse">
              <path
                d="M0 12 C 20 7, 60 7, 80 12 C 100 17, 140 17, 160 12"
                class="conversation-wave-path layer-mid"
              />
              <animateTransform
                attributeName="patternTransform"
                type="translate"
                from="0 0"
                to="160 0"
                dur="1.7s"
                repeatCount="indefinite"
              />
            </pattern>
            <pattern id="conversation-wave-pattern-front" width="108" height="24" patternUnits="userSpaceOnUse">
              <path
                d="M0 15 C 14 9, 40 9, 54 15 C 68 21, 94 21, 108 15"
                class="conversation-wave-path layer-front"
              />
              <animateTransform
                attributeName="patternTransform"
                type="translate"
                from="0 0"
                to="-108 0"
                dur="0.9s"
                repeatCount="indefinite"
              />
            </pattern>
          </defs>
          <rect x="0" y="0" width="1200" height="24" fill="url(#conversation-wave-pattern-back)" />
          <rect x="0" y="0" width="1200" height="24" fill="url(#conversation-wave-pattern-mid)" />
          <rect x="0" y="0" width="1200" height="24" fill="url(#conversation-wave-pattern-front)" />
        </svg>
      </div>
    </div>

    <!-- 任务浮动窗口 - 在 messages 容器外,不受滚动影响 -->
    <TaskFloatingWindow
      v-if="!isCollapsedByPreview"
      :sidebar-collapsed="sidebarCollapsed"
      :sidebar-width="sidebarWidth"
      :content-bounds="contentViewport"
    />

    <!-- 可拖拽的分隔条 -->
    <div
      class="resize-handle"
      :class="{ resizing: isResizing }"
      @mousedown="startResize"
    >
      <div
        v-if="centerResizeTimerLabel && queuedMessageCount === 0"
        class="resize-handle-timer"
        aria-hidden="true"
      >
        {{ centerResizeTimerLabel }}
      </div>
    </div>

    <div
      class="input-stack"
      :class="{ 'resizable-expanded': !!messagesHeight }"
    >
      <div
      v-if="shouldShowQueuePanel"
      class="queued-message-strip"
    >
        <div
          v-if="centerResizeTimerLabel"
          class="queued-message-timer"
          aria-hidden="true"
        >
          <span class="queued-message-timer-pill">
            {{ centerResizeTimerLabel }}
          </span>
        </div>
      <div class="queued-message-list">
        <div
          v-for="item in displayedQueuedMessages"
          :key="item.id"
            class="queued-message-item"
          >
            <div class="queued-message-content">
              <span
                v-for="badge in item.attachmentBadges || []"
                :key="badge.id"
                class="queued-message-badge"
                :title="badge.label"
              >
                {{ badge.label }}
              </span>
              <div
                class="queued-message-label"
                :title="item.text || item.fallbackText || ''"
              >
                {{ item.text || item.fallbackText || '空消息' }}
              </div>
            </div>
            <button
              class="queued-message-remove"
              type="button"
              @click="removeQueuedMessage(item.id)"
            >
              删除
            </button>
          </div>
        </div>
      </div>

      <!-- Input Area -->
      <ChatInput
        ref="chatInputRef"
        :class="{ 'resizable-expanded': !!messagesHeight }"
        v-model="inputMessage"
        v-model:attachments="inputAttachments"
        :is-processing="showInterruptButton"
        :toolbar-locked="toolbarLocked"
        :session-controls-switching="isSwitchingSessionControls"
        :has-permission="pendingPermission !== null || pendingControlRequest !== null"
        :permission-mode="permissionMode"
        :permission-modes="permissionModes"
        :current-model-label="currentModelLabel"
        :current-model-key="currentModelSelectionKey"
        :model-options="availableModelOptions"
        :can-switch-model="canQuickSwitchModel"
        :current-sub-model-label="currentSubModelLabel"
        :current-sub-model-key="currentSubModelKey"
        :sub-model-options="providerSubModelOptions"
        :can-switch-sub-model="canQuickSwitchSubModel"
        :sub-model-loading="providerSubModelLoading"
        :current-notification-channels="currentNotificationChannels"
        :queue-count="queuedMessageCount"
        :queue-visible="shouldShowQueuePanel"
        :notification-options="notificationOptions"
        :can-configure-notifications="canConfigureNotifications"
        :input-target-label="hasCollaborativeChildren ? (currentInputTargetAgent?.title || currentInputTargetAgent?.name || activeCollaborativeSession?.title || '') : ''"
        :input-target-subtitle="hasCollaborativeChildren ? ((currentInputTargetAgent?.canWrite === false || currentInputTargetAgent?.interactionMode === 'read-only')
          ? '当前代理只读，暂不支持发送消息'
          : (currentInputTargetAgent?.subtitle || (agentWorkspaceState.collaborativeViewMode === 'split' ? '跟随当前焦点分屏视图' : (currentInputTargetAgent?.isMain ? '主会话' : '当前激活子会话')))) : ''"
        :input-target-agent-id="agentWorkspaceState.inputTargetAgentId"
        :input-target-options="inputTargetOptions"
        :input-target-read-only="Boolean(hasCollaborativeChildren && (currentInputTargetAgent?.canWrite === false || currentInputTargetAgent?.interactionMode === 'read-only'))"
        :effort="currentEffortValue"
        :effort-key="currentEffortKey"
        :effort-options="availableEffortOptions"
        :effort-loading="providerEffortLoading"
        :can-switch-effort="canQuickSwitchEffort"
        :input-history="inputHistory"
        @send="handleSendMessage"
        @interrupt="handleInterrupt"
        @model-change="handleQuickModelChange"
        @sub-model-change="handleQuickSubModelChange"
        @notification-toggle="handleNotificationToggle"
        @toggle-queue-visibility="queuePanelVisible = !queuePanelVisible"
        @permission-mode-change="selectPermissionMode"
        @effort-change="handleQuickEffortChange"
        @input-target-change="handleInputTargetChange"
      />
      <div v-if="sessionUnavailableMessage" class="session-unavailable-banner">
        {{ sessionUnavailableMessage }}
      </div>
    </div>

    <!-- Ask User Question Dialog - 在聊天窗口内部 -->
    <AskUserQuestionDialog
      v-if="pendingQuestion"
      :request="pendingQuestion"
      @answer="handleQuestionAnswer"
    />

    <!-- Permission Dialog for tool_use - 在聊天窗口内部 -->
    <PermissionDialog
      v-if="pendingPermission"
      :request="pendingPermission"
      @approve="handlePermissionApprove"
      @deny="handlePermissionDeny"
      @approve-all="handlePermissionApproveAll"
    />

    <!-- Permission Dialog for control_request (--permission-prompt-tool stdio) - 在聊天窗口内部 -->
    <PermissionDialog
      v-if="pendingControlRequest"
      :request="pendingControlRequest"
      @approve="handlePermissionApprove"
      @deny="handlePermissionDeny"
      @approve-all="handlePermissionApproveAll"
    />
  </div>

  <!-- Message Detail Dialog (Cmd+Click to view) -->
  <Teleport to="body">
    <MessageDetailDialog
      v-if="selectedMessage"
      :message="selectedMessage"
      @close="closeMessageDetail"
    />
  </Teleport>

  <!-- Rewind Confirmation Dialog -->
  <Teleport to="body">
    <div v-if="showRewindDialog" class="rewind-dialog-overlay">
        <div class="rewind-dialog">
        <div class="rewind-dialog-header">
          <div class="rewind-dialog-icon">↩️</div>
          <h3 class="rewind-dialog-title">{{ rewindActionTitle }}</h3>
        </div>

        <div class="rewind-dialog-content">
          <div v-if="rewindPreviewLoading" class="rewind-dialog-section">
            <div class="rewind-dialog-section-empty">
              <span class="empty-icon">⏳</span>
              {{ rewindActionLoadingText }}
            </div>
          </div>

          <!-- 文件变更 -->
          <div v-else-if="rewindPreviewData?.files?.length > 0" class="rewind-dialog-section">
            <div class="rewind-dialog-section-title">
              <span class="section-icon">📄</span>
              {{ rewindActionPreviewText }} {{ rewindPreviewData.files.length }} 个文件
            </div>
            <div class="rewind-files-list">
              <div
                v-for="(file, index) in rewindPreviewData.files"
                :key="index"
                class="rewind-file-item"
              >
                <span class="file-icon">📝</span>
                <span class="file-name">{{ file.split('/').pop() }}</span>
              </div>
            </div>
          </div>
          <div v-else class="rewind-dialog-section">
            <div class="rewind-dialog-section-empty">
              <span class="empty-icon">ℹ️</span>
              {{ rewindActionEmptyText }}
            </div>
          </div>

          <!-- 行数统计 -->
          <div v-if="!rewindPreviewLoading && (rewindPreviewData?.deletions > 0 || rewindPreviewData?.insertions > 0)" class="rewind-dialog-section">
            <div class="rewind-stats-box">
              <div class="stat-item deletions">
                <span class="stat-label">删除</span>
                <span class="stat-value">{{ rewindPreviewData.deletions }} 行</span>
              </div>
              <div class="stat-divider"></div>
              <div class="stat-item insertions">
                <span class="stat-label">添加</span>
                <span class="stat-value">{{ rewindPreviewData.insertions }} 行</span>
              </div>
            </div>
          </div>

          <!-- 操作说明 -->
          <div class="rewind-dialog-section">
            <div class="rewind-dialog-warnings">
              <div class="warning-item">
                <span class="warning-icon">•</span>
                <span>
                  {{
                    rewindActionMode === 'patch'
                      ? (rewindActionType === 'redo' ? '将重新应用此次提问对应的补丁修改' : '仅撤销此次提问对应的补丁修改')
                      : '将文件重置到此次提问之前的状态'
                  }}
                </span>
              </div>
              <div class="warning-item">
                <span class="warning-icon">•</span>
                <span>
                  {{
                    rewindActionMode === 'patch'
                      ? '会直接更新这条文件变更卡片的状态'
                      : '创建一个还原点提示，可点击跳转到此次提问'
                  }}
                </span>
              </div>
              <div class="warning-item">
                <span class="warning-icon">•</span>
                <span class="warning-text-highlight">此操作无法撤销</span>
              </div>
            </div>
          </div>

          <div class="rewind-dialog-note">
            <span class="note-icon">💡</span>
            <span>注意：消息历史将保留，不会删除。</span>
          </div>
        </div>

        <div class="rewind-dialog-footer">
          <button class="rewind-btn cancel" @click="cancelRewind">
            取消
          </button>
          <button class="rewind-btn confirm" :disabled="rewindPreviewLoading" @click="confirmRewind">
            {{ rewindActionConfirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>

  <Teleport to="body">
    <div
      v-if="contextMenuState.show"
      class="chat-context-menu"
      :style="{ left: `${contextMenuState.x}px`, top: `${contextMenuState.y}px` }"
      @click.stop
    >
      <button class="chat-context-menu-item" @click="copySelectedText">复制选中内容</button>
    </div>
  </Teleport>

  <Teleport to="body">
    <div v-if="showErrorDialog" class="error-dialog-overlay" @click.self="closeErrorDialog">
      <div class="error-dialog">
        <div class="error-dialog-header">
          <div class="error-dialog-badge">!</div>
          <div class="error-dialog-headings">
            <h3 class="error-dialog-title">{{ errorDialogState.title }}</h3>
            <p class="error-dialog-message">{{ errorDialogState.message }}</p>
          </div>
        </div>

        <div v-if="errorDialogState.detail" class="error-dialog-body">
          <pre class="error-dialog-detail">{{ errorDialogState.detail }}</pre>
        </div>

        <div class="error-dialog-footer">
          <button class="error-dialog-btn" @click="closeErrorDialog">
            {{ errorDialogState.confirmText }}
          </button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.chat-window {
  position: relative; /* 为 PermissionDialog 提供定位基准 */
  height: 100%;
  width: 100%;
  max-width: 100%;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.error-dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 2600;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(4, 8, 16, 0.62);
  backdrop-filter: blur(10px);
}

.error-dialog {
  width: min(100%, 640px);
  max-height: min(80vh, 720px);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 18px;
  border: 1px solid rgba(255, 115, 115, 0.18);
  background:
    linear-gradient(180deg, rgba(31, 24, 27, 0.98) 0%, rgba(20, 19, 24, 0.98) 100%);
  box-shadow:
    0 24px 80px rgba(0, 0, 0, 0.48),
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.error-dialog-header {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 22px 24px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.error-dialog-badge {
  flex-shrink: 0;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: linear-gradient(180deg, rgba(239, 68, 68, 0.92) 0%, rgba(185, 28, 28, 0.92) 100%);
  color: #fff7f7;
  font-size: 18px;
  font-weight: 800;
  box-shadow: 0 10px 24px rgba(127, 29, 29, 0.32);
}

.error-dialog-headings {
  min-width: 0;
}

.error-dialog-title {
  margin: 0;
  font-size: 18px;
  line-height: 1.2;
  font-weight: 700;
  color: #fff1f2;
}

.error-dialog-message {
  margin: 6px 0 0;
  font-size: 13px;
  line-height: 1.5;
  color: rgba(255, 228, 230, 0.78);
}

.error-dialog-body {
  padding: 18px 24px 0;
  overflow: auto;
}

.error-dialog-detail {
  margin: 0;
  padding: 14px 16px;
  border-radius: 12px;
  background: rgba(10, 10, 14, 0.54);
  border: 1px solid rgba(255, 255, 255, 0.06);
  color: #fca5a5;
  font-size: 12px;
  line-height: 1.65;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
}

.error-dialog-footer {
  display: flex;
  justify-content: flex-end;
  padding: 18px 24px 24px;
}

.error-dialog-btn {
  appearance: none;
  border: 1px solid rgba(248, 113, 113, 0.28);
  background: linear-gradient(180deg, #ef4444 0%, #dc2626 100%);
  color: #fff7f7;
  border-radius: 10px;
  padding: 10px 16px;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease, filter 0.15s ease;
}

.error-dialog-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 12px 22px rgba(127, 29, 29, 0.28);
  filter: brightness(1.04);
}

/* Top Bar: Expand Button + Environment Bar */
.top-bar {
  display: flex;
  align-items: stretch;
  background: rgba(17, 19, 23, 0.42);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  -webkit-app-region: drag;
}

.top-bar.sidebar-collapsed {
  /* 折叠时为红绿灯留出空间 */
  padding-left: 80px;
}

/* Expand Button in Top Bar */
.expand-btn-top {
  padding: 4px;
  background: transparent;
  border: none;
  color: #6B7280;
  border-radius: 4px;
  align-self: center;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-right: 1px solid rgba(255, 255, 255, 0.05);
  color: #71717A;
  cursor: pointer;
  transition: all 0.2s;
  -webkit-app-region: no-drag;
  flex-shrink: 0;
  /* 不使用负边距，让按钮在红绿灯区域右侧正常显示 */
}

.expand-btn-top:hover {
  background: #374151;
  color: #D1D5DB;
}

/* Environment Bar */
.env-bar {
  flex: 1;
  position: relative;
  background: transparent;
  padding: 9.25px 16px;
  font-size: 12px;
  cursor: move;
}

.env-bar.with-expand-btn {
  /* 当有展开按钮时的样式调整 */
}

.env-main {
  display: flex;
  align-items: center;
  gap: 16px;
}

.env-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #71717A;
}

.env-icon {
  font-size: 12px;
}

.env-label {
  color: #A1A1AA;
  font-family: ui-monospace, monospace;
}

.env-item-highlight {
  background: rgba(251, 191, 36, 0.15);
  border: 1px solid rgba(251, 191, 36, 0.4);
  border-radius: 4px;
  padding: 2px 8px;
  margin: -2px -8px;
}

.env-item-highlight .env-label {
  color: #FCD34D;
  font-weight: 500;
}

.env-item-clickable {
  cursor: pointer;
  transition: all 0.15s ease;
  border-radius: 4px;
  padding: 2px 8px;
  margin: -2px -8px;
  -webkit-app-region: no-drag;
}

.env-item-clickable:hover {
  background: rgba(255, 255, 255, 0.1);
}

.env-item-clickable:active {
  background: rgba(255, 255, 255, 0.15);
}

/* MCP 状态统计样式 */
.mcp-status-summary {
  margin-left: 6px;
  font-size: 10px;
}

.mcp-status-ok {
  color: #10B981;
  margin-right: 4px;
}

.mcp-status-fail {
  color: #EF4444;
  margin-right: 4px;
}

.env-detail-btn {
  margin-left: auto;
  background: rgba(255, 255, 255, 0.04);
  border: none;
  color: #71717A;
  cursor: pointer;
  padding: 4px 12px;
  border-radius: 4px;
  font-size: 11px;
  transition: all 0.2s;
  -webkit-app-region: no-drag;
}

.env-detail-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #A1A1AA;
}

.env-detail-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: rgba(18, 20, 24, 0.82);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  padding: 12px 16px;
  z-index: 100;
  -webkit-app-region: no-drag;
  cursor: default;
  -webkit-backdrop-filter: blur(14px);
  backdrop-filter: blur(14px);
}

.env-detail-row {
  display: flex;
  gap: 12px;
  margin-bottom: 6px;
}

.env-detail-row:last-child {
  margin-bottom: 0;
}

.env-detail-label {
  color: #52525B;
  min-width: 60px;
  flex-shrink: 0;
}

.env-detail-value {
  color: #A1A1AA;
  font-family: ui-monospace, monospace;
  font-size: 11px;
  word-break: break-all;
  cursor: text;
}

.env-detail-value.tools-list {
  line-height: 1.6;
}

.env-detail-value.highlight {
  color: #FCD34D;
  background: rgba(251, 191, 36, 0.1);
  padding: 2px 6px;
  border-radius: 3px;
}


.messages {
  flex: 1 1 auto;
  min-height: 80px;
  overflow: hidden;
  padding: 0;
  position: relative;
  background: transparent;
}

/* 当设置了固定高度时 */
.messages[style*="height"] {
  flex: 0 0 auto !important;
  min-height: 0 !important;
}


.conversation-wave-rail {
  position: relative;
  height: 0;
  flex-shrink: 0;
  z-index: 4;
  pointer-events: none;
}

.conversation-wave {
  position: absolute;
  left: 0;
  right: 0;
  bottom: -11px;
  margin: 0;
  transform: none;
  left: 0;
  width: 100%;
  height: 22px;
  padding: 0;
  pointer-events: none;
  opacity: 1;
  mask-image: linear-gradient(90deg, transparent 0%, rgba(0, 0, 0, 0.92) 4%, rgba(0, 0, 0, 0.92) 96%, transparent 100%);
}

.conversation-wave-svg {
  width: 100%;
  height: 100%;
  overflow: visible;
  transform: translateZ(0);
}

.conversation-wave-path {
  fill: none;
  stroke-linecap: round;
  stroke-linejoin: round;
  vector-effect: non-scaling-stroke;
  will-change: transform;
}

.conversation-wave-path.layer-back {
  stroke: rgba(120, 113, 108, 0.68);
  stroke-width: 1.3;
  opacity: 0.8;
  filter: drop-shadow(0 0 4px rgba(120, 113, 108, 0.1));
}

.conversation-wave-path.layer-mid {
  stroke: rgba(251, 146, 60, 0.84);
  stroke-width: 1.58;
  opacity: 0.9;
  filter: drop-shadow(0 0 5px rgba(251, 146, 60, 0.16));
}

.conversation-wave-path.layer-front {
  stroke: rgba(249, 115, 22, 0.96);
  stroke-width: 1.82;
  opacity: 0.96;
  filter: drop-shadow(0 0 6px rgba(249, 115, 22, 0.2)) drop-shadow(0 0 10px rgba(251, 146, 60, 0.12));
}

.message {
  display: flex;
  margin-bottom: 16px;
  gap: 12px;
  transition: opacity 0.15s;
}

.message.user {
  flex-direction: row-reverse;
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

.message.tool_use .message-avatar {
  background: #3B82F6;
}

/* Assistant 消息头部样式 */
.message-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0 6px 0;
  margin-bottom: 8px;
  border-bottom: 1px solid #27272A;
}

.header-status {
  font-size: 13px;
  font-weight: 500;
  color: #71717A;
}

.header-status.streaming {
  display: inline-flex;
  align-items: center;
}

.loading-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid #3F3F46;
  border-top-color: #A78BFA;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.header-time {
  font-size: 11px;
  color: #71717A;
  background: #27272A;
  padding: 2px 6px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.header-duration {
  font-size: 11px;
  color: #71717A;
  background: #27272A;
  padding: 2px 6px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.header-duration.streaming {
  color: #A78BFA;
  background: #1E1B4B;
}

/* 气泡内的复制按钮 - 右上角定位 */
.bubble-copy-btn {
  position: absolute;
  top: 2px;
  right: 2px;
  margin-left: 0;
  opacity: 0;
  z-index: 10;
}

.message-text:hover .bubble-copy-btn {
  opacity: 0.6;
}

.bubble-copy-btn:hover {
  opacity: 1 !important;
}

.header-icon {
  font-size: 10px;
}

.message-content {
  max-width: 70%;
  position: relative;
}

/* 用户消息容器：包含头部和气泡，右对齐 */
.message-user-container {
  display: flex;
  flex-direction: column;
}

.tool-use-message-wrapper {
  flex: 1;
  max-width: 70%;
}

.message-text {
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.5;
  overflow-x: auto;
  position: relative;
  cursor: text;
}

.message-text:not(:has(.markdown-content)) {
  white-space: pre-wrap;
}

.message.user .message-text {
  background: #3F3F46;
  width: fit-content;
}

.message.assistant .message-text {
  background: #27272A;
  border: 1px solid #3F3F46;
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

.message.system .message-text {
  background: #374151;
  border: 1px solid #52525B;
  color: #a1a1aa;
}

/* Tool use message styles */
.message.tool_use {
  margin: 8px 0;
  margin-left: 0;
}

/* Status message styles (CLI connection status, retries, etc.) */
.message.status {
  justify-content: center;
  margin: 8px 0;
}

.message.status .status-content {
  max-width: 100%;
}

.message.status .status-text {
  background: #1E3A5F;
  border: 1px solid #3B82F6;
  color: #93C5FD;
  font-size: 12px;
  padding: 6px 12px;
  border-radius: 6px;
  text-align: center;
  font-family: monospace;
}

.message-time {
  font-size: 12px;
  color: #6B7280;
  margin-top: 4px;
}

.message.user .message-time {
  text-align: right;
}

/* 折叠的回答占位符 */
.collapsed-response-placeholder {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  margin: 8px 0;
  background: #1F1F23;
  border: 1px dashed #3F3F46;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}

.collapsed-response-placeholder:hover {
  background: #27272A;
  border-color: #52525B;
}

.collapsed-icon {
  font-size: 10px;
  color: #71717A;
}

.collapsed-text {
  font-size: 12px;
  color: #71717A;
}

.typing-indicator {
  color: #6B7280;
  font-style: italic;
}

.history-picker {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  max-height: 300px;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  margin-bottom: 8px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 -4px 16px rgba(0, 0, 0, 0.3);
}

.history-picker-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: #3F3F46;
  font-size: 13px;
  color: #A1A1AA;
  font-weight: 500;
}

.history-picker-close {
  background: none;
  border: none;
  color: #A1A1AA;
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
  line-height: 1;
}

.history-picker-close:hover {
  color: #E4E4E7;
}

.history-picker-list {
  overflow-y: auto;
  flex: 1;
}

.history-picker-item {
  padding: 10px 12px;
  cursor: pointer;
  color: #E4E4E7;
  font-size: 13px;
  border-bottom: 1px solid #3F3F46;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-picker-item:last-child {
  border-bottom: none;
}

.history-picker-item:hover {
  background: #3F3F46;
}

/* 可拖拽调整大小的分隔条 */
.resize-handle {
  height: 4px;
  margin-top: -2px;
  margin-bottom: -2px;
  background: transparent;
  cursor: ns-resize;
  transition: background 0.2s;
  -webkit-app-region: no-drag;
  flex-shrink: 0;
  position: relative;
  z-index: 6;
}

.resize-handle:hover {
  background: #F97316;
}

.resize-handle.resizing {
  background: #EA580C;
}

.resize-handle-timer {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translate(-50%, -100%);
  padding: 2px 8px;
  border-radius: 999px;
  background: #18181B;
  border: 1px solid rgba(249, 115, 22, 0.28);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.28);
  color: #F97316;
  font-size: 10px;
  line-height: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
  letter-spacing: 0.02em;
  white-space: nowrap;
  pointer-events: none;
  z-index: 9;
}

.input-stack {
  position: relative;
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  min-height: 0;
  flex-shrink: 0; /* 防止被压缩 */
}

.input-stack.resizable-expanded {
  flex: 1 1 auto;
  min-height: 120px;
}

.queued-message-strip {
  position: absolute;
  left: 0;
  right: 0;
  bottom: calc(100% - 20px);
  padding: 0;
  margin: 0;
  background: transparent;
  -webkit-app-region: no-drag;
  z-index: 7;
  pointer-events: none;
}

.queued-message-list {
  position: relative;
  margin: 0 56px;
  display: flex;
  flex-direction: column;
  background: rgba(31, 31, 35, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.07);
  border-bottom: none;
  border-radius: 10px 10px 0 0;
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.16);
  overflow: hidden;
  pointer-events: auto;
}

.queued-message-timer {
  display: flex;
  justify-content: center;
  align-items: center;
  min-height: 0;
  padding: 0 12px 6px;
  background: transparent;
}

.queued-message-timer-pill {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: #18181B;
  border: 1px solid rgba(249, 115, 22, 0.28);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22);
  color: #F97316;
  font-size: 10px;
  line-height: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.queued-message-item {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 34px;
  padding: 0 12px;
  background: transparent;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.queued-message-item:last-child {
  border-bottom: none;
}

.queued-message-content {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  overflow: hidden;
}

.queued-message-badge {
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  max-width: 140px;
  min-width: 0;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #D4D4D8;
  font-size: 11px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.queued-message-label {
  flex: 1 1 auto;
  min-width: 0;
  color: #E4E4E7;
  font-size: 12px;
  line-height: 1.35;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.queued-message-remove {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: #71717A;
  font-size: 11px;
  line-height: 1;
  padding: 4px 0;
  cursor: pointer;
  transition: color 0.18s ease;
}

.queued-message-remove:hover {
  color: #D4D4D8;
}

.input-area {
  position: relative;
  padding: 20px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  display: flex;
  -webkit-app-region: no-drag;
  flex: 0 0 auto;
  min-height: 120px;
  background: transparent;
}

/* 输入框容器 */
.input-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  transition: border-color 0.2s;
}

.input-container.focused {
  border-color: #F97316;
}

/* 工具栏（包含权限模式按钮） */
.input-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px;
  background: transparent;
  border-bottom: 1px solid #3F3F46;
  border-radius: 8px 8px 0 0;
}

.input-container textarea {
  flex: 1;
  background: transparent;
  border: none;
  padding: 12px;
  color: #E4E4E7;
  font-size: 14px;
  resize: none;
  font-family: inherit;
  min-height: 60px;
  max-height: 400px;
  border-radius: 0 0 8px 8px;
}

.input-container textarea:focus {
  outline: none;
}

.input-container textarea:disabled {
  opacity: 0.5;
}

.input-container textarea.drag-over {
  background: rgba(249, 115, 22, 0.1);
}

/* Textarea scrollbar */
.input-container textarea::-webkit-scrollbar {
  width: 6px;
}

.input-container textarea::-webkit-scrollbar-track {
  background: transparent;
}

.input-container textarea::-webkit-scrollbar-thumb {
  background: #52525B;
  border-radius: 3px;
}

.input-container textarea::-webkit-scrollbar-thumb:hover {
  background: #71717A;
}

.input-container textarea::-webkit-scrollbar-corner {
  background: transparent;
}

.send-button {
  margin-right: -4.5px;
  padding: 4px 16px;
  background: #F97316;
  border: none;
  border-radius: 4px;
  color: white;
  font-weight: 500;
  font-size: 12px;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: background 0.2s;
  height: 24px;
  line-height: 1;
}

.send-button:hover:not(:disabled) {
  background: #EA580C;
}

.send-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 权限模式按钮 */
.permission-mode-btn {
  min-width: 90px;
  padding: 2px 8px;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: #A1A1AA;
  font-size: 12px;
  font-weight: 400;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  text-align: left;
  -webkit-app-region: no-drag;
}

.permission-mode-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: #E4E4E7;
}

.permission-mode-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 权限模式包装器（用于定位菜单） */
.permission-mode-wrapper {
  position: relative;
  display: inline-block;
}

/* 权限模式菜单 */
.permission-menu {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 4px;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.3);
  min-width: 120px;
  z-index: 1000;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
}

/* 权限菜单项 */
.permission-menu-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #A1A1AA;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  text-align: left;
  -webkit-app-region: no-drag;
}

.permission-menu-item:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #E4E4E7;
}

.permission-menu-item.active {
  background: rgba(249, 115, 22, 0.1);
  color: #F97316;
}

.permission-menu-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.permission-menu-label {
  flex: 1;
  font-size: 12px;
  font-weight: 400;
}

.permission-menu-check {
  font-size: 12px;
  color: #F97316;
  flex-shrink: 0;
}

.interrupt-button {
  margin-right: -4.5px ;
  padding: 4px 16px;
  background: #F97316;
  border: none;
  border-radius: 4px;
  color: white;
  font-weight: 500;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-app-region: no-drag;
  height: 24px;
  min-width: 56px;
  line-height: 1;
}

.interrupt-button:hover {
  background: #EA580C;
}

/* Also style scrollbars in markdown content */
.message-text :deep(::-webkit-scrollbar) {
  width: 6px;
  height: 6px;
}

.message-text :deep(::-webkit-scrollbar-track) {
  background: #18181B;
  border-radius: 3px;
}

.message-text :deep(::-webkit-scrollbar-thumb) {
  background: #52525B;
  border-radius: 3px;
}

.message-text :deep(::-webkit-scrollbar-thumb:hover) {
  background: #71717A;
}

/* Thinking message styles */
.thinking-message {
  background: linear-gradient(135deg, #1E1E2E 0%, #18181B 100%);
  border: 1px solid #3B82F6;
  border-left: 3px solid #3B82F6;
  border-radius: 8px;
  padding: 12px 16px;
  margin: 8px 0;
  width: 100%;
}

.thinking-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.thinking-icon {
  font-size: 14px;
}

.thinking-label {
  font-size: 12px;
  font-weight: 500;
  color: #818CF8;
  text-transform: none;
  letter-spacing: 0;
  white-space: nowrap;
}

.thinking-content {
  font-size: 13px;
  color: #A1A1AA;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
}



</style>

<style scoped>
/* Highlight animation for messages */
.highlight-message {
  animation: highlight-pulse 2s ease-in-out;
}

@keyframes highlight-pulse {
  0%, 100% {
    background-color: transparent;
  }
  50% {
    background-color: rgba(102, 126, 234, 0.2);
  }
}
</style>

<style>
/* Rewind Confirmation Dialog (non-scoped for Teleport) */
.rewind-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  animation: dialog-fade-in 0.2s ease-out;
}

@keyframes dialog-fade-in {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

.rewind-dialog {
  background: linear-gradient(135deg, #1e1e2e 0%, #2a2a3e 100%);
  border-radius: 16px;
  border: 2px solid #667eea;
  box-shadow: 0 8px 32px rgba(102, 126, 234, 0.3);
  max-width: 500px;
  width: 90%;
  max-height: 80vh;
  overflow: hidden;
  animation: dialog-slide-in 0.3s ease-out;
}

@keyframes dialog-slide-in {
  from {
    transform: translateY(-20px);
    opacity: 0;
  }
  to {
    transform: translateY(0);
    opacity: 1;
  }
}

.rewind-dialog-header {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 20px 24px;
  border-bottom: 1px solid rgba(102, 126, 234, 0.2);
}

.rewind-dialog-icon {
  font-size: 32px;
  line-height: 1;
}

.rewind-dialog-title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: #fff;
}

.rewind-dialog-content {
  padding: 24px;
  overflow-y: auto;
  max-height: 60vh;
}

.rewind-dialog-section {
  margin-bottom: 20px;
}

.rewind-dialog-section:last-child {
  margin-bottom: 0;
}

.rewind-dialog-section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 600;
  color: #e0e0e0;
  margin-bottom: 12px;
}

.section-icon {
  font-size: 18px;
}

.rewind-files-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
  max-height: 200px;
  overflow-y: auto;
  padding: 12px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
}

.rewind-file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(102, 126, 234, 0.1);
  border-radius: 6px;
  font-size: 13px;
  color: #c0c0d0;
}

.file-icon {
  font-size: 14px;
}

.file-name {
  flex: 1;
  font-family: 'SF Mono', Monaco, 'Courier New', monospace;
}

.rewind-dialog-section-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 8px;
  color: #a0a0b0;
  font-size: 14px;
}

.empty-icon {
  font-size: 18px;
}

.rewind-stats-box {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 24px;
  padding: 16px;
  background: rgba(0, 0, 0, 0.3);
  border-radius: 8px;
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.stat-label {
  font-size: 12px;
  color: #a0a0b0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.stat-value {
  font-size: 18px;
  font-weight: 600;
  font-family: 'SF Mono', Monaco, 'Courier New', monospace;
}

.stat-item.deletions .stat-value {
  color: #ff6b6b;
}

.stat-item.insertions .stat-value {
  color: #51cf66;
}

.stat-divider {
  width: 1px;
  height: 40px;
  background: rgba(255, 255, 255, 0.1);
}

.rewind-dialog-warnings {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.warning-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 13px;
  color: #c0c0d0;
  line-height: 1.5;
}

.warning-icon {
  color: #667eea;
  font-weight: bold;
  flex-shrink: 0;
}

.warning-text-highlight {
  color: #ff6b6b;
  font-weight: 500;
}

.rewind-dialog-note {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  background: rgba(102, 126, 234, 0.1);
  border-radius: 8px;
  border-left: 3px solid #667eea;
  font-size: 13px;
  color: #c0c0d0;
  margin-top: 16px;
}

.note-icon {
  font-size: 16px;
  flex-shrink: 0;
}

.rewind-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid rgba(102, 126, 234, 0.2);
  background: rgba(0, 0, 0, 0.2);
}

.rewind-btn {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.rewind-btn.cancel {
  background: rgba(255, 255, 255, 0.1);
  color: #c0c0d0;
}

.rewind-btn.cancel:hover {
  background: rgba(255, 255, 255, 0.15);
}

.rewind-btn.confirm {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  color: #fff;
  box-shadow: 0 4px 12px rgba(102, 126, 234, 0.3);
}

.rewind-btn.confirm:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px rgba(102, 126, 234, 0.4);
}

.chat-context-menu {
  position: fixed;
  min-width: 140px;
  padding: 4px 0;
  background: #1E1E1E;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  box-shadow: 0 10px 15px rgba(0, 0, 0, 0.5);
  z-index: 1200;
}

.chat-context-menu-item {
  display: block;
  width: 100%;
  padding: 6px 14px;
  border: none;
  background: transparent;
  color: #E4E4E7;
  font-size: 13px;
  text-align: left;
  cursor: pointer;
  white-space: nowrap;
}

.chat-context-menu-item:hover {
  background: rgba(249, 115, 22, 0.12);
  color: #FED7AA;
}

</style>
