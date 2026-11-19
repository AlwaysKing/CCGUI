<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import MessageItem from './messages/MessageItem.vue'
import ExecutionAgentCard from './messages/ExecutionAgentCard.vue'
import ProcessSummaryMessage from './messages/ProcessSummaryMessage.vue'
import StickyHeader from './layout/StickyHeader.vue'
import TaskFloatingWindow from './TaskFloatingWindow.vue'
import AgentWorkspaceTopRail from './AgentWorkspaceTopRail.vue'
import { buildRenderableMessageEntries } from '../composables/useMessageList'

const props = defineProps({
  timelineBlocks: {
    type: Array,
    default: () => []
  },
  agentEntries: {
    type: Array,
    default: () => []
  },
  hasCollaborativeChildren: {
    type: Boolean,
    default: false
  },
  collaborativeSessions: {
    type: Array,
    default: () => []
  },
  activeSession: {
    type: Object,
    default: null
  },
  sessionId: {
    type: String,
    default: ''
  },
  splitSessions: {
    type: Array,
    default: () => []
  },
  viewMode: {
    type: String,
    default: 'single'
  },
  focusedPaneAgentId: {
    type: String,
    default: null
  },
  inputTargetAgentId: {
    type: String,
    default: null
  },
  workingDirectory: {
    type: String,
    default: ''
  },
  currentTime: {
    type: Number,
    default: null
  },
  sessionIsProcessing: {
    type: Boolean,
    default: false
  },
  stickyMessage: {
    type: Object,
    default: null
  },
  showStickyHeader: {
    type: Boolean,
    default: false
  },
  stickyIsProcessing: {
    type: Boolean,
    default: false
  },
  stickyCopied: {
    type: Boolean,
    default: false
  },
  containerHeight: {
    type: Number,
    default: 400
  },
  chatTheme: {
    type: Object,
    default: () => ({})
  },
  collapseProcessOnDisplay: {
    type: Boolean,
    default: false
  },
  railVisible: {
    type: Boolean,
    default: true
  },
  railPlacement: {
    type: String,
    default: 'side'
  },
  canCloseAgents: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits([
  'selectAgent',
  'focusAgent',
  'toggleViewMode',
  'messageClick',
  'rewind',
  'fork',
  'rewindAndFork',
  'jumpToMessage',
  'copyContent',
  'copyQuestionContent',
  'copySticky',
  'scrollToSticky',
  'jumpToQuestion',
  'contentScroll',
  'closeAgent'
])

const AUTO_SCROLL_NEAR_BOTTOM_PX = 48
const MAX_RUNNING_PROCESS_DURATION_MS = 24 * 60 * 60 * 1000

function selectAgent(agentId) {
  emit('selectAgent', agentId)
}

function focusAgent(agentId) {
  emit('focusAgent', agentId)
}

function selectMainAgentFromStage(event) {
  if (props.viewMode !== 'split') {
    return
  }

  const target = event?.target
  if (target instanceof Element && target.closest('button, a, input, textarea, select, [role="button"]')) {
    return
  }

  const mainAgentId = railMasterEntry.value?.agentId
  if (mainAgentId) {
    emit('selectAgent', mainAgentId)
  }
}

function toggleViewMode(mode) {
  emit('toggleViewMode', mode)
}

function forward(eventName, payload) {
  emit(eventName, payload)
}

function handleContentScroll(event) {
  emit('contentScroll', event)
}

const splitPaneScrollRefs = new Map()
const splitPaneElementToAgentId = new WeakMap()
const splitPaneUserScrolledAway = ref({})
const collapsedSplitPaneIds = ref({})
const splitPaneWidths = ref({})
const expandedProcessRuns = ref({})
const processRunElements = new Map()
let processRunResizeObserver = null
const contentElementRef = ref(null)
const contentWidth = ref(0)
const mainScrollElementRef = ref(null)
const mainStageWidth = ref(0)
const splitSideWidth = ref(360)
const isDraggingSplitDivider = ref(false)
let splitDragPointerId = null
let splitDragStartX = 0
let splitDragStartWidth = 360
let paneResizeObserver = null
const MIN_SPLIT_SIDE_WIDTH = 280
const MIN_MAIN_STAGE_WIDTH = 400
const SPLIT_DIVIDER_WIDTH = 10

function updateSplitPaneWidth(agentId, element) {
  if (!agentId || !(element instanceof HTMLElement)) {
    return
  }

  const nextWidth = Math.round(element.getBoundingClientRect().width)
  if (!nextWidth || splitPaneWidths.value[agentId] === nextWidth) {
    return
  }

  splitPaneWidths.value = {
    ...splitPaneWidths.value,
    [agentId]: nextWidth
  }
}

function updateMainStageWidth(element) {
  if (!(element instanceof HTMLElement)) {
    return
  }

  const nextWidth = Math.round(element.getBoundingClientRect().width)
  if (!nextWidth || mainStageWidth.value === nextWidth) {
    return
  }

  mainStageWidth.value = nextWidth
}

function updateContentWidth(element) {
  if (!(element instanceof HTMLElement)) {
    return
  }

  const nextWidth = Math.round(element.getBoundingClientRect().width)
  if (!nextWidth || contentWidth.value === nextWidth) {
    return
  }

  contentWidth.value = nextWidth
}

function clampSplitSideWidth(nextWidth) {
  const totalWidth = contentWidth.value
  if (!totalWidth) {
    return Math.max(MIN_SPLIT_SIDE_WIDTH, nextWidth)
  }

  const maxWidth = Math.max(MIN_SPLIT_SIDE_WIDTH, totalWidth - MIN_MAIN_STAGE_WIDTH - SPLIT_DIVIDER_WIDTH)
  return Math.min(Math.max(MIN_SPLIT_SIDE_WIDTH, nextWidth), maxWidth)
}

function bindPaneWidth(agentId, element) {
  if (!(element instanceof HTMLElement)) {
    return
  }

  splitPaneElementToAgentId.set(element, agentId)
  updateSplitPaneWidth(agentId, element)
  paneResizeObserver?.observe(element)
}

function unbindPaneWidth(agentId, element) {
  if (!(element instanceof HTMLElement)) {
    return
  }

  paneResizeObserver?.unobserve(element)

  if (!agentId) {
    return
  }

  const nextWidths = { ...splitPaneWidths.value }
  delete nextWidths[agentId]
  splitPaneWidths.value = nextWidths
}

function setSplitPaneScrollRef(agentId, element) {
  if (!agentId) {
    return
  }

  const previous = splitPaneScrollRefs.get(agentId)
  if (previous && previous !== element) {
    unbindPaneWidth(agentId, previous)
  }

  if (element) {
    splitPaneScrollRefs.set(agentId, element)
    bindPaneWidth(agentId, element)
    return
  }

  if (previous) {
    unbindPaneWidth(agentId, previous)
  }
  splitPaneScrollRefs.delete(agentId)
}

function handleSplitPaneScroll(agentId, event) {
  const element = event?.target
  if (!agentId || !(element instanceof HTMLElement)) {
    return
  }

  const isNearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < AUTO_SCROLL_NEAR_BOTTOM_PX
  splitPaneUserScrolledAway.value = {
    ...splitPaneUserScrolledAway.value,
    [agentId]: !isNearBottom
  }
}

function autoScrollSplitPanes() {
  for (const sessionItem of visibleSplitSessions.value) {
    if (collapsedSplitPaneIds.value[sessionItem.agentId]) {
      continue
    }

    const element = splitPaneScrollRefs.get(sessionItem.agentId)
    if (!(element instanceof HTMLElement)) {
      continue
    }

    const isNearBottom = element.scrollHeight - element.scrollTop - element.clientHeight < AUTO_SCROLL_NEAR_BOTTOM_PX
    if (splitPaneUserScrolledAway.value[sessionItem.agentId] && !isNearBottom) {
      continue
    }

    element.scrollTop = element.scrollHeight
    if (splitPaneUserScrolledAway.value[sessionItem.agentId]) {
      splitPaneUserScrolledAway.value = {
        ...splitPaneUserScrolledAway.value,
        [sessionItem.agentId]: false
      }
    }
  }
}

function isSplitPaneCollapsed(agentId) {
  return Boolean(collapsedSplitPaneIds.value[agentId])
}

function toggleSplitPane(agentId) {
  if (!agentId) {
    return
  }

  collapsedSplitPaneIds.value = {
    ...collapsedSplitPaneIds.value,
    [agentId]: !collapsedSplitPaneIds.value[agentId]
  }
}

function toggleDeletedTeam(teamId) {
  expandedDeletedTeamId.value = expandedDeletedTeamId.value === teamId ? null : teamId
}

function toggleDeletedAgents() {
  showDeletedAgents.value = !showDeletedAgents.value
  if (!showDeletedAgents.value) {
    expandedDeletedTeamId.value = null
    if (railMasterEntry.value) {
      selectAgent(railMasterEntry.value.agentId)
    }
  }
}

function selectTeamGroup(group) {
  const firstMember = group?.members?.[0]
  if (firstMember?.agentId) {
    selectAgent(firstMember.agentId)
  }
}

function railItemStyle(agentItem) {
  if (!agentItem?.color) {
    return null
  }

  return {
    '--agent-color': agentItem.color,
    borderColor: agentItem.color
  }
}

const shouldShowSplitDivider = computed(() => {
  return props.viewMode === 'split' && props.hasCollaborativeChildren && hasVisibleSplitSessions.value
})

const effectiveSplitSideWidth = computed(() => clampSplitSideWidth(splitSideWidth.value))

const contentLayoutStyle = computed(() => {
  if (!shouldShowSplitDivider.value) {
    return null
  }

  return {
    '--agent-workspace-split-side-width': `${effectiveSplitSideWidth.value}px`,
    '--agent-workspace-split-divider-width': `${SPLIT_DIVIDER_WIDTH}px`
  }
})

function handleSplitDividerPointerMove(event) {
  if (!isDraggingSplitDivider.value) {
    return
  }

  const deltaX = splitDragStartX - event.clientX
  splitSideWidth.value = clampSplitSideWidth(splitDragStartWidth + deltaX)
}

function stopSplitDividerDrag() {
  isDraggingSplitDivider.value = false
  splitDragPointerId = null
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
  window.removeEventListener('pointermove', handleSplitDividerPointerMove)
  window.removeEventListener('pointerup', stopSplitDividerDrag)
  window.removeEventListener('pointercancel', stopSplitDividerDrag)
}

function startSplitDividerDrag(event) {
  if (!shouldShowSplitDivider.value) {
    return
  }

  splitDragPointerId = event.pointerId
  splitDragStartX = event.clientX
  splitDragStartWidth = effectiveSplitSideWidth.value
  isDraggingSplitDivider.value = true
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
  window.addEventListener('pointermove', handleSplitDividerPointerMove)
  window.addEventListener('pointerup', stopSplitDividerDrag)
  window.addEventListener('pointercancel', stopSplitDividerDrag)
}

onMounted(() => {
  window.addEventListener('pointerdown', handleAgentContextPointerDown, true)
  window.addEventListener('resize', updateAllProcessRunLines)
  if (typeof ResizeObserver === 'undefined') {
    return
  }

  paneResizeObserver = new ResizeObserver(entries => {
    for (const entry of entries) {
      const target = entry.target
      if (!(target instanceof HTMLElement)) {
        continue
      }

      if (target === mainScrollElementRef.value) {
        updateMainStageWidth(target)
        continue
      }

      if (target === contentElementRef.value) {
        updateContentWidth(target)
        continue
      }

      const agentId = splitPaneElementToAgentId.get(target)
      if (agentId) {
        updateSplitPaneWidth(agentId, target)
      }
    }
  })

  if (mainScrollElementRef.value instanceof HTMLElement) {
    updateMainStageWidth(mainScrollElementRef.value)
    paneResizeObserver.observe(mainScrollElementRef.value)
  }

  if (contentElementRef.value instanceof HTMLElement) {
    updateContentWidth(contentElementRef.value)
    paneResizeObserver.observe(contentElementRef.value)
  }

  for (const [agentId, element] of splitPaneScrollRefs.entries()) {
    bindPaneWidth(agentId, element)
  }

  processRunResizeObserver = new ResizeObserver(() => {
    updateAllProcessRunLines()
  })
  for (const element of processRunElements.values()) {
    processRunResizeObserver.observe(element)
  }
})

onUnmounted(() => {
  stopSplitDividerDrag()
  window.removeEventListener('pointerdown', handleAgentContextPointerDown, true)
  window.removeEventListener('resize', updateAllProcessRunLines)
  paneResizeObserver?.disconnect()
  paneResizeObserver = null
  processRunResizeObserver?.disconnect()
  processRunResizeObserver = null
})

function railItemTypeLabel(agentItem) {
  if (!agentItem) return ''
  if (agentItem.isMain) return '主会话'

  const typeMap = {
    team: '团队',
    'team-lead': '组长',
    subagent: '子代理',
    'general-purpose': '通用代理',
    Explore: '探索',
    Plan: '规划'
  }

  return typeMap[agentItem.agentType] || agentItem.agentType || '代理'
}

function isAgentRunning(agentItem) {
  return agentItem?.status === 'running' || agentItem?.status === 'starting'
}

function agentStatusLabel(agentItem) {
  const status = agentItem?.status || 'ended'
  const labels = {
    starting: '启动中',
    running: '运行中',
    ended: '空闲',
    failed: '失败',
    interrupted: '已中断',
    deleted: '已关闭'
  }
  return labels[status] || status
}

const timelineBlocksWithShell = computed(() => {
  return props.timelineBlocks.map((block, index) => {
    const displayIndex = index

    if (block.type !== 'execution-card') {
      return {
        ...block,
        displayIndex
      }
    }

    const timestamp = block.card?.bucket?.firstTimestamp || block.card?.registry?.startTime || new Date().toISOString()
    const startTimeValue = Date.parse(block.card?.registry?.startTime || timestamp)
    const shellMessage = {
      id: `execution-card-shell-${block.card.agentId}-${index}`,
      role: 'tool_use',
      subtype: 'execution-card',
      toolName: 'Agent',
      timestamp,
      startTime: Number.isFinite(startTimeValue) ? startTimeValue : null,
      duration: block.card?.duration ?? null,
      usage: block.card?.usage ?? null,
      isExecuting: block.card?.status === 'running' || block.card?.status === 'starting',
      collapsed: true,
      content: '',
      ccgui: {
        attribution: {
          agentId: 'master'
        }
      }
    }

    return {
      ...block,
      shellMessage,
      displayIndex
    }
  })
})

const mainStageDisplayMessages = computed(() => {
  return timelineBlocksWithShell.value.map(block => {
    if (block.type === 'execution-card') {
      return block.shellMessage
    }
    return block.message
  }).filter(Boolean)
})

const mainStageUserQuestions = computed(() => {
  const questions = []
  const seenIds = new Set()

  for (const message of mainStageDisplayMessages.value) {
    if (message?.role !== 'user' || message?.ccgui?.internalMessage) {
      continue
    }

    const agentId = message?.ccgui?.attribution?.agentId
    if (agentId && agentId !== 'master') {
      continue
    }

    const content = typeof message?.content === 'string' ? message.content.trim() : ''
    const messageId = message?.id || null
    if (!content || !messageId || seenIds.has(messageId)) {
      continue
    }

    seenIds.add(messageId)
    questions.push({
      id: messageId,
      content,
      timestamp: message.timestamp || null
    })
  }

  return questions
})

function getBlockMessage(block) {
  if (!block) return null
  if (block.type === 'execution-card') return block.shellMessage || null
  return block.message || null
}

function getMessageCurrentTime(message) {
  return message?.isStreaming ||
    message?.isExecuting ||
    (!message?.duration && message?.startTime)
    ? props.currentTime
    : null
}

function getExecutionCardCurrentTime(card) {
  return card?.status === 'running' || card?.status === 'starting'
    ? props.currentTime
    : null
}

function isTurnMessage(message = null) {
  return message?.role === 'user' || message?.role === 'command'
}

function isFoldableActivityBlock(block) {
  const message = getBlockMessage(block)
  if (!message) return false
  if (isTurnMessage(message) || message.role === 'assistant') return false
  if (message.role === 'system' || message.role === 'task_complete') return false
  if (message.role === 'system_notification') return false
  return true
}

function getActivityGroupToolCallCount(group) {
  if (!group) return 0
  return (group.foldableBlocks || []).reduce((count, block) => {
    const message = getBlockMessage(block)
    if (!message) return count
    if (message.role === 'tool_use' || message.role === 'diff') {
      return count + 1
    }
    return count
  }, 0)
}

function getActivityGroupCollapsedLabel(group) {
  const toolCalls = getActivityGroupToolCallCount(group)
  if (toolCalls > 0) {
    return `已折叠 ${toolCalls} 次工具调用`
  }
  return '已折叠活动内容'
}

function getActivityGroupKey(activityBlocks) {
  const firstBlock = activityBlocks?.[0] || null
  const firstMessage = getBlockMessage(firstBlock)
  return `activity-group-${firstMessage?.id || firstBlock?.displayIndex || 'unknown'}`
}

function buildRenderableTimeline(blocks, visibleMessageIndexes) {
  const renderBlocks = []
  let pendingActivities = []

  const flushPendingActivities = (shouldAutoCollapse = false) => {
    if (pendingActivities.length === 0) return
    if (pendingActivities.length >= 2) {
      renderBlocks.push({
        type: 'activity-group',
        key: getActivityGroupKey(pendingActivities),
        foldableBlocks: [...pendingActivities],
        shouldAutoCollapse
      })
    } else {
      pendingActivities.forEach(block => {
        renderBlocks.push({
          type: 'block',
          key: block.key || `block-${block.displayIndex}`,
          block
        })
      })
    }
    pendingActivities = []
  }

  blocks.forEach(block => {
    if (!visibleMessageIndexes.has(block.displayIndex)) {
      return
    }

    if (isFoldableActivityBlock(block)) {
      pendingActivities.push(block)
      return
    }

    // 折叠段只装工具调用等活动内容，助手消息始终紧跟折叠段之后单独渲染
    flushPendingActivities(true)

    renderBlocks.push({
      type: 'block',
      key: block.key || `block-${block.displayIndex}`,
      block
    })
  })

  flushPendingActivities()
  return renderBlocks
}

function hasVisibleMessageContent(message) {
  return typeof message?.content === 'string' && message.content.trim().length > 0
}

function isProcessRunBlock(block) {
  const message = getBlockMessage(block)
  if (!message) return false
  if (
    message.role === 'tool_use' ||
    message.role === 'diff' ||
    message.role === 'permission_result'
  ) {
    return true
  }
  return message.role === 'assistant' &&
    !hasVisibleMessageContent(message) &&
    (
      message.subtype === 'thinking' ||
      message.hasThinking ||
      Boolean(message.thinking) ||
      message.isStreaming
    )
}

function buildThinkingBlock(block, message) {
  const displayKey = block.key || block.displayIndex
  return {
    ...block,
    key: `${displayKey}-thinking`,
    message: {
      ...message,
      id: `${message.id || displayKey}-thinking`,
      subtype: 'thinking',
      content: '',
      isStreaming: false,
      hasThinking: true
    }
  }
}

function buildVisibleMessageBlock(block, message) {
  return {
    ...block,
    message: {
      ...message,
      subtype: null,
      thinking: '',
      hasThinking: false
    }
  }
}

function buildProcessRenderableTimeline(blocks, visibleMessageIndexes) {
  const renderBlocks = []
  let pendingProcessBlocks = []

  const flushProcessBlocks = (endedAt = null) => {
    if (pendingProcessBlocks.length === 0) return
    const firstBlock = pendingProcessBlocks[0]
    renderBlocks.push({
      type: 'process-run',
      key: `process-run-${firstBlock.key || firstBlock.displayIndex}`,
      displayIndex: firstBlock.displayIndex,
      foldableBlocks: [...pendingProcessBlocks],
      endedAt: Number.isFinite(endedAt) ? endedAt : null
    })
    pendingProcessBlocks = []
  }

  blocks.forEach(block => {
    if (!visibleMessageIndexes.has(block.displayIndex)) {
      return
    }

    const message = block.type === 'message' ? block.message : null
    const hasThinking = message?.role === 'assistant' &&
      (message.hasThinking || Boolean(message.thinking))

    if (hasThinking && hasVisibleMessageContent(message)) {
      pendingProcessBlocks.push(buildThinkingBlock(block, message))
      flushProcessBlocks(toTimestamp(message?.timestamp ?? message?.startTime))
      renderBlocks.push({
        type: 'block',
        key: block.key || `block-${block.displayIndex}`,
        block: buildVisibleMessageBlock(block, message)
      })
      return
    }

    if (isProcessRunBlock(block)) {
      pendingProcessBlocks.push(block)
      return
    }

    const blockMessage = getBlockMessage(block)
    flushProcessBlocks(toTimestamp(blockMessage?.timestamp ?? blockMessage?.startTime))
    renderBlocks.push({
      type: 'block',
      key: block.key || `block-${block.displayIndex}`,
      block
    })
  })

  flushProcessBlocks()
  return renderBlocks
}

function toTimestamp(value) {
  if (value instanceof Date) {
    return value.getTime()
  }
  if (typeof value === 'number') {
    return value
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function formatProcessDuration(durationMs) {
  const safeMs = Number(durationMs)
  if (!Number.isFinite(safeMs) || safeMs < 0) return ''
  if (safeMs < 1000) return `${Math.round(safeMs)}ms`
  if (safeMs < 60000) return `${(safeMs / 1000).toFixed(safeMs >= 10000 ? 0 : 1)}s`
  if (safeMs < 3600000) {
    return `${Math.floor(safeMs / 60000)}m ${Math.floor((safeMs % 60000) / 1000)}s`
  }
  return `${Math.floor(safeMs / 3600000)}h ${Math.floor((safeMs % 3600000) / 60000)}m`
}

function isTrailingProcessRun(runKey) {
  const renderBlocks = renderableMainTimelineBlocks.value
  const lastBlock = renderBlocks[renderBlocks.length - 1]
  return lastBlock?.type === 'process-run' && lastBlock.key === runKey
}

function getProcessRunStats(renderBlock) {
  const messages = (renderBlock?.foldableBlocks || []).map(getBlockMessage).filter(Boolean)
  const thinkingCount = messages.filter(message => {
    return message.role === 'assistant' &&
      (message.subtype === 'thinking' || message.hasThinking || Boolean(message.thinking))
  }).length
  const toolCallCount = messages.filter(message => {
    return message.role === 'tool_use' || message.role === 'diff'
  }).length
  const permissionCount = messages.filter(message => message.role === 'permission_result').length
  const running = isTrailingProcessRun(renderBlock.key) &&
    props.sessionIsProcessing === true
  const startTimes = messages
    .map(message => toTimestamp(message.startTime ?? message.timestamp))
    .filter(value => Number.isFinite(value))
  const startTime = startTimes.length ? Math.min(...startTimes) : null
  const endTimes = messages
    .map(message => toTimestamp(message.timestamp) ?? toTimestamp(message.startTime))
    .filter(value => Number.isFinite(value))
  const currentTime = Number(props.currentTime) || Date.now()
  const lastKnownEndTime = endTimes.length ? Math.max(...endTimes) : startTime
  const boundaryEndTime = Number.isFinite(Number(renderBlock?.endedAt))
    ? Math.max(Number(renderBlock.endedAt), lastKnownEndTime ?? Number(renderBlock.endedAt))
    : lastKnownEndTime
  let endTime = running
    ? Math.max(currentTime, lastKnownEndTime ?? currentTime)
    : boundaryEndTime
  if (
    running &&
    Number.isFinite(startTime) &&
    currentTime - startTime > MAX_RUNNING_PROCESS_DURATION_MS
  ) {
    endTime = lastKnownEndTime ?? startTime
  }
  const summedDuration = messages.reduce((sum, message) => {
    const duration = Number(message.duration)
    return sum + (
      Number.isFinite(duration) && duration > 0 && duration <= MAX_RUNNING_PROCESS_DURATION_MS
        ? duration
        : 0
    )
  }, 0)
  let durationMs = Number.isFinite(startTime) && Number.isFinite(endTime)
    ? Math.max(0, endTime - startTime)
    : summedDuration
  if (durationMs === 0 && !running) {
    durationMs = summedDuration
  }

  return {
    thinkingCount,
    toolCallCount,
    permissionCount,
    running,
    durationMs,
    durationLabel: formatProcessDuration(durationMs),
    timestamp: messages[0]?.timestamp || null,
    startTime,
    currentTime
  }
}

function isProcessRunExpanded(runKey) {
  return expandedProcessRuns.value[runKey] === true
}

function toggleProcessRun(runKey) {
  expandedProcessRuns.value = {
    ...expandedProcessRuns.value,
    [runKey]: !expandedProcessRuns.value[runKey]
  }
  nextTick(() => updateProcessRunLineEnd(runKey))
}

function setProcessRunRef(runKey, element) {
  const previousElement = processRunElements.get(runKey)
  if (previousElement && previousElement !== element) {
    processRunResizeObserver?.unobserve(previousElement)
  }

  if (element) {
    processRunElements.set(runKey, element)
    processRunResizeObserver?.observe(element)
    return
  }

  processRunElements.delete(runKey)
}

function updateProcessRunLineEnd(runKey) {
  const container = processRunElements.get(runKey)
  if (!container || !isProcessRunExpanded(runKey)) {
    return
  }

  const avatars = []
  for (const child of container.children) {
    const messageRoot = child.classList.contains('message')
      ? child
      : child.querySelector(':scope > .message')
    const avatar = messageRoot?.querySelector(':scope > .message-avatar')
    if (avatar) {
      avatars.push(avatar)
    }
  }
  if (avatars.length < 2) {
    container.style.setProperty('--process-line-opacity', '0')
    return
  }

  const firstAvatar = avatars[0]
  const lastAvatar = avatars[avatars.length - 1]
  const containerRect = container.getBoundingClientRect()
  const firstRect = firstAvatar.getBoundingClientRect()
  const lastRect = lastAvatar.getBoundingClientRect()

  container.style.setProperty('--process-line-x', `${firstRect.left + firstRect.width / 2 - containerRect.left}px`)
  container.style.setProperty('--process-line-top', `${firstRect.top + firstRect.height / 2 - containerRect.top}px`)
  container.style.setProperty('--process-line-bottom', `${containerRect.bottom - (lastRect.top + lastRect.height / 2)}px`)
  container.style.setProperty('--process-line-opacity', '1')
}

function updateAllProcessRunLines() {
  for (const runKey of processRunElements.keys()) {
    updateProcessRunLineEnd(runKey)
  }
}

const collapsedActivityGroups = ref({})

const renderableMainMessageIndexes = computed(() => {
  return new Set(buildRenderableMessageEntries(mainStageDisplayMessages.value).map(entry => entry.index))
})

const renderableMainTimelineBlocks = computed(() => {
  if (props.collapseProcessOnDisplay) {
    return buildProcessRenderableTimeline(timelineBlocksWithShell.value, renderableMainMessageIndexes.value)
  }
  return buildRenderableTimeline(timelineBlocksWithShell.value, renderableMainMessageIndexes.value)
})

watch(
  [renderableMainTimelineBlocks, expandedProcessRuns, () => props.chatTheme],
  async () => {
    await nextTick()
    updateAllProcessRunLines()
  },
  { deep: true, flush: 'post' }
)

const splitMainSession = computed(() => {
  if (props.viewMode !== 'split') {
    return props.activeSession
  }

  return props.collaborativeSessions.find(session => session?.isMain) || props.activeSession
})
const availableSplitSessions = computed(() => {
  if (props.viewMode !== 'split') {
    return props.splitSessions
  }

  return props.splitSessions.filter(session => session && !session.isMain)
})

function isActivityGroupCollapsed(groupKey) {
  return Boolean(collapsedActivityGroups.value[groupKey])
}

function resolveActivityGroupCollapsed(group) {
  const stored = collapsedActivityGroups.value[group.key]
  if (typeof stored === 'boolean') {
    return stored
  }
  // 有 shouldAutoCollapse 标记时默认折叠
  return Boolean(group?.shouldAutoCollapse)
}

function toggleActivityGroup(groupKey) {
  collapsedActivityGroups.value[groupKey] = !collapsedActivityGroups.value[groupKey]
}

const railMasterEntry = computed(() => {
  return props.agentEntries.find(entry => entry.isMain) || null
})

const showDeletedAgents = ref(false)
const expandedDeletedTeamId = ref(null)
const hoveredRailAgentId = ref(null)
const railTooltipPosition = ref({ top: 0, left: 0 })
const agentContextMenu = ref(null)

function openAgentContextMenu(event, agentItem) {
  if (!props.canCloseAgents || !agentItem?.agentId || agentItem.isMain) {
    return
  }
  agentContextMenu.value = {
    agentId: agentItem.agentId,
    x: Math.min(event.clientX, window.innerWidth - 120),
    y: Math.min(event.clientY, window.innerHeight - 44)
  }
}

function closeAgentContextMenu() {
  agentContextMenu.value = null
}

function handleAgentContextPointerDown(event) {
  if (!event.target?.closest?.('.agent-context-menu')) {
    closeAgentContextMenu()
  }
}

function closeSelectedAgent() {
  const agentId = agentContextMenu.value?.agentId
  closeAgentContextMenu()
  if (agentId) {
    emit('closeAgent', agentId)
  }
}

const hoveredRailAgent = computed(() => {
  if (!hoveredRailAgentId.value) return null
  if (railMasterEntry.value?.agentId === hoveredRailAgentId.value) return railMasterEntry.value
  for (const group of railActiveTeamGroups.value) {
    for (const member of group.members) {
      if (member.agentId === hoveredRailAgentId.value) return member
    }
  }
  for (const entry of railStandaloneEntries.value) {
    if (entry.agentId === hoveredRailAgentId.value) return entry
  }
  for (const entry of railDeletedStandaloneEntries.value) {
    if (entry.agentId === hoveredRailAgentId.value) return entry
  }
  for (const group of railDeletedTeamGroups.value) {
    for (const member of group.members) {
      if (member.agentId === hoveredRailAgentId.value) return member
    }
  }
  return null
})

function onRailTabEnter(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  railTooltipPosition.value = {
    top: rect.top + rect.height / 2,
    left: rect.left - 6
  }
}

const railTeamGroups = computed(() => {
  const teamEntriesById = new Map(
    props.agentEntries
      .filter(entry => entry.agentType === 'team')
      .map(entry => [entry.agentId, entry])
  )

  const members = props.agentEntries.filter(entry => {
    return entry.agentType !== 'team' && entry.agentType !== 'team-lead' && !entry.isMain
  })

  const groups = new Map()
  for (const member of members) {
    if (!member.teamId) {
      continue
    }

    if (!groups.has(member.teamId)) {
      const teamEntry = teamEntriesById.get(member.teamId)
      const fallbackTitle = String(member.teamId)
        .replace(/^claude-team:/, '')
        .replace(/^team:/, '')
      groups.set(member.teamId, {
        teamId: member.teamId,
        title: teamEntry?.title || teamEntry?.name || fallbackTitle,
        status: teamEntry?.status || (member.status === 'deleted' ? 'deleted' : 'ended'),
        members: []
      })
    }

    groups.get(member.teamId).members.push(member)
  }

  return Array.from(groups.values()).map(group => ({
    ...group,
    status: group.status === 'deleted' || group.members.every(member => member.status === 'deleted')
      ? 'deleted'
      : 'ended'
  }))
})

const railActiveTeamGroups = computed(() => {
  return railTeamGroups.value
    .filter(group => group.status !== 'deleted')
    .map(group => ({
      ...group,
      members: group.members.filter(member => member.status !== 'deleted')
    }))
    .filter(group => group.members.length > 0)
})

const railDeletedTeamGroups = computed(() => {
  return railTeamGroups.value
    .map(group => ({
      ...group,
      members: group.status === 'deleted'
        ? group.members
        : group.members.filter(member => member.status === 'deleted')
    }))
    .filter(group => group.members.length > 0)
})

const railStandaloneEntries = computed(() => {
  const groupedMemberIds = new Set(railTeamGroups.value.flatMap(group => group.members.map(member => member.agentId)))
  return props.agentEntries.filter(entry => {
    if (entry.isMain) return false
    if (entry.agentType === 'team' || entry.agentType === 'team-lead') return false
    if (entry.status === 'deleted') return false
    return !groupedMemberIds.has(entry.agentId)
  })
})

const railDeletedStandaloneEntries = computed(() => {
  const groupedMemberIds = new Set(railTeamGroups.value.flatMap(group => group.members.map(member => member.agentId)))
  return props.agentEntries.filter(entry => {
    if (entry.isMain || entry.status !== 'deleted') return false
    if (entry.agentType === 'team' || entry.agentType === 'team-lead') return false
    return !groupedMemberIds.has(entry.agentId)
  })
})

const railDeletedAgentCount = computed(() => {
  return railDeletedTeamGroups.value.reduce((count, group) => count + group.members.length, 0) +
    railDeletedStandaloneEntries.value.length
})

const railRunningAgentCount = computed(() => {
  const entries = [
    ...railActiveTeamGroups.value.flatMap(group => group.members || []),
    ...railStandaloneEntries.value
  ]
  return entries.filter(isAgentRunning).length
})

const visibleSplitSessions = computed(() => {
  const deletedTeamIds = new Set(
    railTeamGroups.value
      .filter(group => group.status === 'deleted')
      .map(group => group.teamId)
  )
  const focusedSession = availableSplitSessions.value.find(session => session.agentId === props.focusedPaneAgentId) || null
  const focusedTeamId = focusedSession?.registry?.teamId || null

  if (focusedTeamId && deletedTeamIds.has(focusedTeamId)) {
    return availableSplitSessions.value.filter(session => session.registry?.teamId === focusedTeamId)
  }

  return availableSplitSessions.value.filter(session => !session.registry?.teamId || !deletedTeamIds.has(session.registry.teamId))
})
const hasVisibleSplitSessions = computed(() => visibleSplitSessions.value.length > 0)
const renderableSplitMainMessages = computed(() => {
  return buildRenderableMessageEntries(splitMainSession.value?.messages || [])
})
const renderableVisibleSplitSessions = computed(() => {
  return visibleSplitSessions.value.map(sessionItem => ({
    ...sessionItem,
    renderableMessages: buildRenderableMessageEntries(sessionItem.messages || [])
  }))
})

watch(
  () => visibleSplitSessions.value.map(sessionItem => {
    const lastMessage = sessionItem.messages?.[sessionItem.messages.length - 1]
    return `${sessionItem.agentId}:${sessionItem.messages.length}:${lastMessage?.id || ''}`
  }),
  async () => {
    await nextTick()
    autoScrollSplitPanes()
  },
  { flush: 'post' }
)

const shouldShowRail = computed(() => {
  if (!props.railVisible) {
    return false
  }

  return (
    railActiveTeamGroups.value.length > 0 ||
    railDeletedAgentCount.value > 0 ||
    railStandaloneEntries.value.length > 0
  )
})
</script>

<template>
  <div
    class="agent-workspace"
    :class="{
      'agent-workspace--plain': props.agentEntries.length === 0,
      'agent-workspace--split': hasCollaborativeChildren && viewMode === 'split',
      'agent-workspace--split-empty': hasCollaborativeChildren && viewMode === 'split' && !hasVisibleSplitSessions,
      'agent-workspace--no-rail': !shouldShowRail,
      'agent-workspace--rail-top': shouldShowRail && props.railPlacement === 'top'
    }"
  >
    <AgentWorkspaceTopRail
      v-if="shouldShowRail && props.railPlacement === 'top'"
      :master-entry="railMasterEntry"
      :active-team-groups="railActiveTeamGroups"
      :standalone-entries="railStandaloneEntries"
      :deleted-team-groups="railDeletedTeamGroups"
      :deleted-standalone-entries="railDeletedStandaloneEntries"
      :active-session="activeSession"
      :view-mode="viewMode"
      @open-agent-menu="openAgentContextMenu"
      @select-agent="selectAgent"
      @toggle-view-mode="toggleViewMode"
    />

    <div
      ref="contentElementRef"
      class="agent-workspace__content"
      :style="contentLayoutStyle"
    >
      <div class="agent-workspace__main-stage" @click="selectMainAgentFromStage">
        <StickyHeader
          v-if="showStickyHeader && stickyMessage"
          :message="stickyMessage"
          :is-processing="stickyIsProcessing"
          :current-time="currentTime"
          :container-height="containerHeight"
          :right-inset="0"
          :content-width="0"
          :is-copied="stickyCopied"
          :user-questions="mainStageUserQuestions"
          @copy="forward('copySticky')"
          @scroll-to-user="forward('scrollToSticky')"
          @jump-to-question="forward('jumpToQuestion', $event)"
        />
        <div ref="mainScrollElementRef" class="agent-workspace__main-scroll" @scroll="handleContentScroll">
          <template v-if="splitMainSession?.isMain">
            <template v-for="renderBlock in renderableMainTimelineBlocks" :key="renderBlock.key">
              <div
                v-if="renderBlock.type === 'process-run'"
                :ref="element => setProcessRunRef(renderBlock.key, element)"
                class="process-run"
                :class="{ 'is-expanded': isProcessRunExpanded(renderBlock.key) }"
              >
                <ProcessSummaryMessage
                  :run-key="renderBlock.key"
                  :stats="getProcessRunStats(renderBlock)"
                  :collapsed="!isProcessRunExpanded(renderBlock.key)"
                  :chat-theme="chatTheme"
                  @toggle="toggleProcessRun(renderBlock.key)"
                />

                <template v-if="isProcessRunExpanded(renderBlock.key)">
                  <template
                    v-for="nestedBlock in renderBlock.foldableBlocks"
                    :key="nestedBlock.key || `nested-${nestedBlock.displayIndex}`"
                  >
                    <MessageItem
                      v-if="nestedBlock.type === 'message'"
                      :message="nestedBlock.message"
                      :message-index="nestedBlock.displayIndex"
                      :total-messages="mainStageDisplayMessages.length"
                      :session-id="sessionId"
                      :working-directory="workingDirectory"
                      :current-time="getMessageCurrentTime(nestedBlock.message)"
                      :all-messages="mainStageDisplayMessages"
                      :chat-theme="chatTheme"
                      :pane-width="mainStageWidth"
                      response-collapse-prefiltered
                      @message-click="forward('messageClick', $event)"
                      @rewind="forward('rewind', $event)"
                      @fork="forward('fork', $event)"
                      @rewind-and-fork="forward('rewindAndFork', $event)"
                      @jump-to-message="forward('jumpToMessage', $event)"
                      @copy-content="forward('copyContent', $event)"
                      @copy-question-content="forward('copyQuestionContent', $event)"
                    />
                    <MessageItem
                      v-else
                      :message="nestedBlock.shellMessage"
                      :message-index="nestedBlock.displayIndex"
                      :total-messages="mainStageDisplayMessages.length"
                      :session-id="sessionId"
                      :working-directory="workingDirectory"
                      :current-time="getMessageCurrentTime(nestedBlock.shellMessage)"
                      :all-messages="mainStageDisplayMessages"
                      :chat-theme="chatTheme"
                      :pane-width="mainStageWidth"
                      response-collapse-prefiltered
                      @message-click="forward('messageClick', $event)"
                      @rewind="forward('rewind', $event)"
                      @fork="forward('fork', $event)"
                      @rewind-and-fork="forward('rewindAndFork', $event)"
                      @jump-to-message="forward('jumpToMessage', $event)"
                      @copy-content="forward('copyContent', $event)"
                      @copy-question-content="forward('copyQuestionContent', $event)"
                    >
                      <ExecutionAgentCard
                        :card="nestedBlock.card"
                        :working-directory="workingDirectory"
                        :current-time="getExecutionCardCurrentTime(nestedBlock.card)"
                        :chat-theme="chatTheme"
                      />
                    </MessageItem>
                  </template>
                </template>
              </div>

              <template v-else-if="renderBlock.type === 'activity-group'">
                <div class="activity-group" :class="{ collapsed: resolveActivityGroupCollapsed(renderBlock) }">
                  <div class="activity-group__foldable">
                    <button
                      class="activity-group__rail-toggle"
                      type="button"
                      :title="resolveActivityGroupCollapsed(renderBlock) ? '展开活动段' : '折叠活动段'"
                      @click="toggleActivityGroup(renderBlock.key)"
                    ><span class="activity-group__rail"></span></button>
                    <div v-if="!resolveActivityGroupCollapsed(renderBlock)" class="activity-group__content">
                      <template v-for="nestedBlock in renderBlock.foldableBlocks" :key="nestedBlock.key || `nested-${nestedBlock.displayIndex}`">
                        <MessageItem
                          v-if="nestedBlock.type === 'message'"
                          :message="nestedBlock.message"
                          :message-index="nestedBlock.displayIndex"
                          :total-messages="mainStageDisplayMessages.length"
                          :session-id="sessionId"
                          :working-directory="workingDirectory"
                          :current-time="getMessageCurrentTime(nestedBlock.message)"
                          :all-messages="mainStageDisplayMessages"
                          :chat-theme="chatTheme"
                          :pane-width="mainStageWidth"
                          response-collapse-prefiltered
                          @message-click="forward('messageClick', $event)"
                          @rewind="forward('rewind', $event)"
                          @fork="forward('fork', $event)"
                          @rewind-and-fork="forward('rewindAndFork', $event)"
                          @jump-to-message="forward('jumpToMessage', $event)"
                          @copy-content="forward('copyContent', $event)"
                          @copy-question-content="forward('copyQuestionContent', $event)"
                        />
                        <MessageItem
                          v-else
                          :message="nestedBlock.shellMessage"
                          :message-index="nestedBlock.displayIndex"
                          :total-messages="mainStageDisplayMessages.length"
                          :session-id="sessionId"
                          :working-directory="workingDirectory"
                          :current-time="getMessageCurrentTime(nestedBlock.shellMessage)"
                          :all-messages="mainStageDisplayMessages"
                          :chat-theme="chatTheme"
                          :pane-width="mainStageWidth"
                          response-collapse-prefiltered
                          @message-click="forward('messageClick', $event)"
                          @rewind="forward('rewind', $event)"
                          @fork="forward('fork', $event)"
                          @rewind-and-fork="forward('rewindAndFork', $event)"
                          @jump-to-message="forward('jumpToMessage', $event)"
                          @copy-content="forward('copyContent', $event)"
                          @copy-question-content="forward('copyQuestionContent', $event)"
                        >
                          <ExecutionAgentCard
                            :card="nestedBlock.card"
                            :working-directory="workingDirectory"
                            :current-time="getExecutionCardCurrentTime(nestedBlock.card)"
                            :chat-theme="chatTheme"
                          />
                        </MessageItem>
                      </template>
                    </div>
                    <button
                      v-else
                      class="activity-group__summary"
                      type="button"
                      @click="toggleActivityGroup(renderBlock.key)"
                    >
                      {{ getActivityGroupCollapsedLabel(renderBlock) }}
                    </button>
                  </div>
                </div>
              </template>

              <MessageItem
                v-else-if="renderBlock.type === 'block' && renderBlock.block.type === 'message'"
                :message="renderBlock.block.message"
                :message-index="renderBlock.block.displayIndex"
                :total-messages="mainStageDisplayMessages.length"
                :session-id="sessionId"
                :working-directory="workingDirectory"
                :current-time="getMessageCurrentTime(renderBlock.block.message)"
                :all-messages="mainStageDisplayMessages"
                :chat-theme="chatTheme"
                :pane-width="mainStageWidth"
                response-collapse-prefiltered
                @message-click="forward('messageClick', $event)"
                @rewind="forward('rewind', $event)"
                @fork="forward('fork', $event)"
                @rewind-and-fork="forward('rewindAndFork', $event)"
                @jump-to-message="forward('jumpToMessage', $event)"
                @copy-content="forward('copyContent', $event)"
                @copy-question-content="forward('copyQuestionContent', $event)"
              />
              <MessageItem
                v-else-if="renderBlock.type === 'block'"
                :message="renderBlock.block.shellMessage"
                :message-index="renderBlock.block.displayIndex"
                :total-messages="mainStageDisplayMessages.length"
                :session-id="sessionId"
                :working-directory="workingDirectory"
                :current-time="getMessageCurrentTime(renderBlock.block.shellMessage)"
                :all-messages="mainStageDisplayMessages"
                :chat-theme="chatTheme"
                :pane-width="mainStageWidth"
                response-collapse-prefiltered
                @message-click="forward('messageClick', $event)"
                @rewind="forward('rewind', $event)"
                @fork="forward('fork', $event)"
                @rewind-and-fork="forward('rewindAndFork', $event)"
                @jump-to-message="forward('jumpToMessage', $event)"
                @copy-content="forward('copyContent', $event)"
                @copy-question-content="forward('copyQuestionContent', $event)"
              >
                <ExecutionAgentCard
                  :card="renderBlock.block.card"
                  :working-directory="workingDirectory"
                  :current-time="getExecutionCardCurrentTime(renderBlock.block.card)"
                  :chat-theme="chatTheme"
                />
              </MessageItem>
            </template>
          </template>

          <template v-else-if="splitMainSession">
            <MessageItem
              v-for="entry in renderableSplitMainMessages"
              :key="entry.message.id || `${splitMainSession.agentId}-${entry.index}`"
              :message="entry.message"
              :message-index="entry.index"
              :total-messages="splitMainSession.messages.length"
              :session-id="sessionId"
              :working-directory="workingDirectory"
              :current-time="getMessageCurrentTime(entry.message)"
              :all-messages="splitMainSession.messages"
              :chat-theme="chatTheme"
              :pane-width="mainStageWidth"
              response-collapse-prefiltered
              @message-click="forward('messageClick', $event)"
              @rewind="forward('rewind', $event)"
              @fork="forward('fork', $event)"
              @rewind-and-fork="forward('rewindAndFork', $event)"
              @jump-to-message="forward('jumpToMessage', $event)"
              @copy-content="forward('copyContent', $event)"
              @copy-question-content="forward('copyQuestionContent', $event)"
            />
          </template>
        </div>
        <TaskFloatingWindow />
      </div>

      <div
        v-if="shouldShowSplitDivider"
        class="agent-workspace__split-resizebar"
        :class="{ dragging: isDraggingSplitDivider }"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整主会话与子会话宽度"
        @pointerdown.prevent="startSplitDividerDrag"
      ></div>

      <aside
        v-if="hasCollaborativeChildren && viewMode === 'split' && hasVisibleSplitSessions"
        class="agent-workspace__split-side"
      >
        <section
          v-for="sessionItem in renderableVisibleSplitSessions"
          :key="sessionItem.agentId"
          class="agent-workspace__split-pane"
          :class="{
            focused: focusedPaneAgentId === sessionItem.agentId,
            collapsed: isSplitPaneCollapsed(sessionItem.agentId)
          }"
          @click="focusAgent(sessionItem.agentId)"
        >
          <div
            class="agent-workspace__session-header agent-workspace__session-header--compact"
            :aria-expanded="!isSplitPaneCollapsed(sessionItem.agentId)"
            @click.stop="toggleSplitPane(sessionItem.agentId)"
          >
            <div class="agent-workspace__session-identity">
              <span class="agent-workspace__session-title">{{ sessionItem.title }}</span>
            </div>
          </div>
          <div
            v-show="!isSplitPaneCollapsed(sessionItem.agentId)"
            :ref="element => setSplitPaneScrollRef(sessionItem.agentId, element)"
            class="agent-workspace__split-pane-scroll"
            @scroll="handleSplitPaneScroll(sessionItem.agentId, $event)"
          >
            <MessageItem
              v-for="entry in sessionItem.renderableMessages"
              :key="entry.message.id || `${sessionItem.agentId}-${entry.index}`"
              :message="entry.message"
              :message-index="entry.index"
              :total-messages="sessionItem.messages.length"
              :session-id="sessionId"
              :working-directory="workingDirectory"
              :current-time="getMessageCurrentTime(entry.message)"
              :all-messages="sessionItem.messages"
              :chat-theme="chatTheme"
              :pane-width="splitPaneWidths[sessionItem.agentId] || 0"
              response-collapse-prefiltered
              @message-click="forward('messageClick', $event)"
              @rewind="forward('rewind', $event)"
              @fork="forward('fork', $event)"
              @rewind-and-fork="forward('rewindAndFork', $event)"
              @jump-to-message="forward('jumpToMessage', $event)"
              @copy-content="forward('copyContent', $event)"
              @copy-question-content="forward('copyQuestionContent', $event)"
            />
          </div>
        </section>
      </aside>
    </div>

    <aside v-if="shouldShowRail && props.railPlacement !== 'top'" class="agent-workspace__rail">
      <div class="agent-workspace__rail-pinned">
        <div class="agent-workspace__rail-header">
          <span>代理</span>
          <span
            v-if="railRunningAgentCount > 0"
            class="agent-workspace__rail-running-count"
            :title="`${railRunningAgentCount} 个代理运行中`"
            :aria-label="`${railRunningAgentCount} 个代理运行中`"
          >
            {{ railRunningAgentCount }}
          </span>
        </div>
        <button
          v-if="railMasterEntry"
          class="agent-workspace__rail-tab agent-workspace__rail-tab--master"
          :class="{
            active: activeSession?.agentId === railMasterEntry.agentId,
            focused: focusedPaneAgentId === railMasterEntry.agentId
          }"
          type="button"
          @click="selectAgent(railMasterEntry.agentId)"
          @mouseenter="hoveredRailAgentId = railMasterEntry.agentId; onRailTabEnter($event)"
          @mouseleave="hoveredRailAgentId = null"
        >
          <span
            class="agent-workspace__rail-dot"
            :class="{ 'agent-workspace__rail-dot--idle': !isAgentRunning(railMasterEntry) }"
            :style="{ background: railMasterEntry.color || '#60A5FA' }"
          ></span>
          <span class="agent-workspace__rail-tab-name">{{ railMasterEntry.title }}</span>
          <span v-if="isAgentRunning(railMasterEntry)" class="agent-workspace__rail-spinner" aria-label="运行中"></span>
        </button>
      </div>

      <div class="agent-workspace__rail-scroll">
        <div
          v-for="group in railActiveTeamGroups"
          :key="group.teamId"
          class="agent-workspace__rail-group"
        >
          <div class="agent-workspace__rail-group-title">{{ group.title }}</div>
          <button
            v-for="agentItem in group.members"
            :key="agentItem.agentId"
            class="agent-workspace__rail-tab"
            :class="{
              active: activeSession?.agentId === agentItem.agentId,
              focused: focusedPaneAgentId === agentItem.agentId
            }"
            type="button"
            :disabled="agentItem.canActivate === false"
            @click="selectAgent(agentItem.agentId)"
            @contextmenu.prevent.stop="openAgentContextMenu($event, agentItem)"
            @mouseenter="hoveredRailAgentId = agentItem.agentId; onRailTabEnter($event)"
            @mouseleave="hoveredRailAgentId = null"
          >
            <span
              class="agent-workspace__rail-dot"
              :class="{ 'agent-workspace__rail-dot--idle': !isAgentRunning(agentItem) }"
              :style="{ background: agentItem.color || '#60A5FA' }"
            ></span>
            <span class="agent-workspace__rail-tab-name">{{ agentItem.title }}</span>
            <span v-if="isAgentRunning(agentItem)" class="agent-workspace__rail-spinner" aria-label="运行中"></span>
          </button>
        </div>

        <button
          v-for="agentItem in railStandaloneEntries"
          :key="agentItem.agentId"
          class="agent-workspace__rail-tab"
          :class="{
            active: activeSession?.agentId === agentItem.agentId,
            focused: focusedPaneAgentId === agentItem.agentId
          }"
          type="button"
          :disabled="agentItem.canActivate === false"
          @click="selectAgent(agentItem.agentId)"
          @contextmenu.prevent.stop="openAgentContextMenu($event, agentItem)"
          @mouseenter="hoveredRailAgentId = agentItem.agentId; onRailTabEnter($event)"
          @mouseleave="hoveredRailAgentId = null"
        >
          <span
            class="agent-workspace__rail-dot"
            :class="{ 'agent-workspace__rail-dot--idle': !isAgentRunning(agentItem) }"
            :style="{ background: agentItem.color || '#60A5FA' }"
          ></span>
          <span class="agent-workspace__rail-tab-name">{{ agentItem.title }}</span>
          <span v-if="isAgentRunning(agentItem)" class="agent-workspace__rail-spinner" aria-label="运行中"></span>
        </button>

        <div v-if="railDeletedAgentCount > 0" class="agent-workspace__rail-deleted">
          <button
            class="agent-workspace__rail-tab agent-workspace__rail-tab--deleted"
            type="button"
            @click="toggleDeletedAgents"
          >
            <span class="agent-workspace__rail-tab-name">{{ showDeletedAgents ? '收起' : `已关闭 ${railDeletedAgentCount}` }}</span>
          </button>

          <template v-if="showDeletedAgents">
            <div
              v-for="group in railDeletedTeamGroups"
              :key="`deleted-${group.teamId}`"
              class="agent-workspace__rail-deleted-group"
            >
              <button
                class="agent-workspace__rail-tab agent-workspace__rail-tab--deleted"
                :class="{ active: expandedDeletedTeamId === group.teamId }"
                type="button"
                @click="toggleDeletedTeam(group.teamId)"
              >
                <span class="agent-workspace__rail-dot agent-workspace__rail-dot--deleted"></span>
                <span class="agent-workspace__rail-tab-name">{{ group.title }}</span>
              </button>
              <template v-if="expandedDeletedTeamId === group.teamId">
                <button
                  v-for="agentItem in group.members"
                  :key="agentItem.agentId"
                  class="agent-workspace__rail-tab agent-workspace__rail-tab--deleted"
                  :class="{ active: activeSession?.agentId === agentItem.agentId }"
                  type="button"
                  :disabled="agentItem.canActivate === false"
                  @click="selectAgent(agentItem.agentId)"
                >
                  <span class="agent-workspace__rail-dot agent-workspace__rail-dot--deleted"></span>
                  <span class="agent-workspace__rail-tab-name">{{ agentItem.title }}</span>
                </button>
              </template>
            </div>

            <button
              v-for="agentItem in railDeletedStandaloneEntries"
              :key="agentItem.agentId"
              class="agent-workspace__rail-tab agent-workspace__rail-tab--deleted"
              :class="{ active: activeSession?.agentId === agentItem.agentId }"
              type="button"
              :disabled="agentItem.canActivate === false"
              @click="selectAgent(agentItem.agentId)"
              @mouseenter="hoveredRailAgentId = agentItem.agentId; onRailTabEnter($event)"
              @mouseleave="hoveredRailAgentId = null"
            >
              <span class="agent-workspace__rail-dot agent-workspace__rail-dot--deleted"></span>
              <span class="agent-workspace__rail-tab-name">{{ agentItem.title }}</span>
            </button>
          </template>
        </div>
      </div>

      <Teleport to="body">
        <div
          v-if="hoveredRailAgent"
          class="rail-tooltip"
          :style="{
            position: 'fixed',
            top: railTooltipPosition.top + 'px',
            left: railTooltipPosition.left + 'px',
            transform: 'translate(-100%, -50%)'
          }"
        >
          <span class="rail-tooltip__title">{{ hoveredRailAgent.title }}</span>
          <span class="rail-tooltip__line">类型: {{ railItemTypeLabel(hoveredRailAgent) }}</span>
          <span v-if="hoveredRailAgent.status" class="rail-tooltip__line">状态: {{ agentStatusLabel(hoveredRailAgent) }}</span>
          <span v-if="hoveredRailAgent.model" class="rail-tooltip__line">模型: {{ hoveredRailAgent.model }}</span>
        </div>
      </Teleport>

      <Teleport to="body">
        <div
          v-if="agentContextMenu"
          class="agent-context-menu"
          :style="{ top: `${agentContextMenu.y}px`, left: `${agentContextMenu.x}px` }"
          @contextmenu.prevent
        >
          <button type="button" class="agent-context-menu__item" @click="closeSelectedAgent">
            关闭
          </button>
        </div>
      </Teleport>

    </aside>
  </div>
</template>

<style scoped>
.agent-workspace {
  min-height: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 72px;
  gap: 0;
  align-items: start;
}

.agent-workspace--plain {
  display: block;
}

.agent-workspace--no-rail {
  grid-template-columns: minmax(0, 1fr);
}

.agent-workspace--rail-top {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
}

.agent-workspace--split {
  grid-template-columns: minmax(0, 1fr) 72px;
}

.agent-workspace--rail-top.agent-workspace--split {
  grid-template-columns: minmax(0, 1fr);
}

.agent-workspace--split.agent-workspace--no-rail {
  grid-template-columns: minmax(0, 1fr);
}

.agent-workspace__content {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  overflow-y: hidden;
  overflow-x: visible;
  padding: 20px 6px 20px 20px;
  border-right: 4px solid transparent;
}

.agent-workspace--split .agent-workspace__content {
  grid-template-columns:
    minmax(0, 1fr)
    var(--agent-workspace-split-divider-width, 10px)
    minmax(280px, var(--agent-workspace-split-side-width, 360px));
  align-items: start;
}

.agent-workspace--split-empty .agent-workspace__content {
  grid-template-columns: minmax(0, 1fr);
}

.agent-workspace__main-stage {
  position: relative;
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow-y: clip;
  overflow-x: visible;
}

.agent-workspace__split-resizebar {
  width: 5px;
  flex: 0 0 5px;
  margin-left: -2px;
  margin-right: -3px;
  min-width: 0;
  min-height: 0;
  align-self: stretch;
  cursor: col-resize;
  background: transparent;
  transition: background-color 0.15s ease;
  touch-action: none;
  user-select: none;
  position: relative;
  z-index: 2;
}

.agent-workspace__split-resizebar::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
  background: rgba(255, 255, 255, 0.05);
  transition: width 0.15s ease, background-color 0.15s ease;
}

.agent-workspace__split-resizebar::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 3px;
  transform: translateX(-50%);
  background: transparent;
  transition: background-color 0.15s ease;
}

.agent-workspace__split-resizebar:hover,
.agent-workspace__split-resizebar.dragging {
  background: transparent;
}

.agent-workspace__split-resizebar:hover::after,
.agent-workspace__split-resizebar.dragging::after {
  background: #F97316;
}

.agent-workspace__main-scroll {
  min-width: 0;
  min-height: 0;
  flex: 1;
  margin-left: -48px;
  padding-left: 48px;
  overflow-y: auto;
  overflow-x: visible;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: #52525B transparent;
}

.process-run {
  position: relative;
  isolation: isolate;
  min-width: 0;
}

.process-run.is-expanded::before {
  content: "";
  position: absolute;
  left: calc(var(--process-line-x, 5px) - 0.5px);
  top: var(--process-line-top, 18px);
  bottom: var(--process-line-bottom, 16px);
  width: 1px;
  z-index: -1;
  border-radius: 999px;
  background: repeating-linear-gradient(
    180deg,
    color-mix(in srgb, var(--accent-primary) 46%, transparent) 0 3px,
    transparent 3px 6px
  );
  opacity: var(--process-line-opacity, 0);
  pointer-events: none;
}

.activity-group {
  position: relative;
  min-width: 0;
}

.activity-group__foldable {
  position: relative;
  min-width: 0;
  margin-left: -14px;
  padding-left: 14px;
  overflow: visible;
}

.activity-group__rail-toggle {
  position: absolute;
  left: 0;
  top: 0;
  bottom: 5px;
  z-index: 3;
  width: 12px;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  transition: opacity 0.15s ease;
}



.activity-group__rail-toggle:hover .activity-group__rail {
  box-shadow: 0 0 0 1px rgba(161, 161, 170, 0.42);
}

.activity-group__rail-toggle:hover::before,
.activity-group__rail-toggle:hover::after {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(212, 212, 216, 0.9);
  font-size: 8px;
  line-height: 1;
  pointer-events: none;
}

.activity-group__rail-toggle:hover::before {
  top: -2px;
  content: '⌄';
}

.activity-group__rail-toggle:hover::after {
  bottom: 8px;
  content: '⌃';
}

.activity-group__rail {
  position: absolute;
  left: 3px;
  top: 0;
  bottom: 10px;
  width: 6px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(161, 161, 170, 0.2), rgba(161, 161, 170, 0.12));
}

.activity-group.collapsed .activity-group__rail-toggle {
  bottom: auto;
  top: 0;
  height: 24px;
}

.activity-group.collapsed .activity-group__rail-toggle:hover::before {
  top: 1px;
  content: '⌃';
}

.activity-group.collapsed .activity-group__rail-toggle:hover::after {
  bottom: 1px;
  content: '⌄';
}

.activity-group.collapsed .activity-group__rail {
  top: 0;
  bottom: auto;
  height: 24px;
}

.activity-group__content {
  display: flow-root;
  min-width: 0;
}

.activity-group__summary {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 0 10px;
  border: none;
  background: transparent;
  color: #71717A;
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
  text-align: left;
}

.activity-group__summary:hover {
  color: #A1A1AA;
}

.activity-group__content > :first-child {
  margin-top: 0;
}

.agent-workspace__split-side {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
  min-height: 0;
  height: 100%;
  overflow: hidden;
}

.agent-workspace__split-pane {
  min-width: 0;
  min-height: 0;
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 0 10px 12px;
  border: 1px solid rgba(63, 63, 70, 0.88);
  border-radius: 16px;
  background: rgba(17, 24, 39, 0.26);
}

.agent-workspace__split-pane.collapsed {
  flex: 0 0 auto;
}

.agent-workspace__split-pane-scroll {
  min-width: 0;
  min-height: 0;
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: #52525B transparent;
}

.agent-workspace__session-header--compact {
  margin: 8px 0 8px;
  padding: 4px 2px 2px;
  border: none;
  border-radius: 0;
  background: transparent;
  gap: 8px;
  cursor: pointer;
  user-select: none;
}

.agent-workspace__split-pane.focused {
  border-color: rgba(96, 165, 250, 0.62);
  box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.16);
}

.agent-workspace__session-header {
  margin: 8px 0 16px;
  padding: 14px 16px;
  border: 1px solid rgba(59, 130, 246, 0.22);
  border-radius: 14px;
  background: rgba(23, 37, 84, 0.18);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.agent-workspace__session-identity {
  min-width: 0;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.agent-workspace__session-title {
  color: #f4f4f5;
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
}

.agent-workspace__session-flags {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
}

.agent-workspace__session-status {
  color: #93c5fd;
  font-size: 10px;
  line-height: 1;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.agent-workspace__session-target {
  padding: 1px 6px;
  border-radius: 999px;
  background: rgba(96, 165, 250, 0.18);
  color: #bfdbfe;
  font-size: 10px;
  line-height: 1.3;
}

.agent-workspace__rail {
  position: sticky;
  top: 0;
  align-self: stretch;
  height: 100%;
  min-height: 0;
  max-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding: 4px 0;
  border-left: 1px solid rgba(63, 63, 70, 0.75);
  background: transparent;
  overflow: hidden;
}

.agent-workspace__rail-pinned {
  flex: 0 0 auto;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-bottom: 6px;
  margin-bottom: 4px;
  border-bottom: 1px solid rgba(96, 165, 250, 0.22);
  border-radius: 4px 4px 0 0;
  background: linear-gradient(180deg, rgba(96, 165, 250, 0.08), rgba(96, 165, 250, 0.02));
}

.agent-workspace__rail-scroll {
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding-right: 1px;
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: #52525B transparent;
}

.agent-workspace__rail-scroll > * {
  flex: 0 0 auto;
}

.agent-workspace__rail-header {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-wrap: wrap;
  gap: 4px;
  padding: 2px 0 2px;
  color: #71717a;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1;
  user-select: none;
}

.agent-workspace__rail-header span {
  display: inline;
}

.agent-workspace__rail-running-count {
  padding: 1px 4px;
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 999px;
  background: rgba(34, 197, 94, 0.1);
  color: #86EFAC;
  font-size: 9px;
  letter-spacing: 0;
}

.agent-workspace__rail-tab {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 4px;

  width: 100%;
  padding: 4px 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #a1a1aa;
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  overflow: hidden;
  transition: background 0.12s ease, color 0.12s ease;
}

.agent-workspace__rail-tab:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #d4d4d8;
}

.agent-workspace__rail-tab.active {
  background: rgba(255, 255, 255, 0.1);
  color: #f4f4f5;
}

.agent-workspace__rail-tab--master {
  padding-top: 6px;
  padding-bottom: 6px;
  background: rgba(96, 165, 250, 0.08);
  color: #d4d4d8;
  font-weight: 600;
}

.agent-workspace__rail-tab--master:hover {
  background: rgba(96, 165, 250, 0.13);
  color: #f4f4f5;
}

.agent-workspace__rail-tab--master.active {
  background: rgba(96, 165, 250, 0.16);
  box-shadow: inset 2px 0 0 #60A5FA;
  color: #f4f4f5;
}

.agent-workspace__rail-tab--deleted {
  opacity: 0.55;
}

.agent-workspace__rail-tab--deleted:hover {
  opacity: 0.85;
}

.agent-workspace__rail-dot {
  flex-shrink: 0;
  width: 5px;
  height: 5px;
  margin-top: 4px;
  border-radius: 50%;
  background: #60A5FA;
}

.agent-workspace__rail-dot--deleted {
  background: #71717a;
}

.agent-workspace__rail-dot--idle {
  opacity: 0.4;
}

.agent-workspace__rail-spinner {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  margin-top: 2px;
  border: 1.5px solid rgba(134, 239, 172, 0.28);
  border-top-color: #86EFAC;
  border-radius: 50%;
  animation: agent-workspace-spin 0.8s linear infinite;
}

.agent-workspace__rail-tab-name {
  flex: 1;
  min-width: 0;
  text-align: left;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-all;
  line-height: 1.3;
}

@keyframes agent-workspace-spin {
  to {
    transform: rotate(360deg);
  }
}

.agent-workspace__rail-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 2px 4px;
  border: 1px solid rgba(182, 182, 196, 0.55);
  border-radius: 4px;
  background: rgba(39, 39, 42, 0.28);
}

.agent-workspace__rail-group-title {
  color: #71717a;
  font-size: 9px;
  font-weight: 600;
  text-align: left;
  padding: 2px 4px 1px;
  border-bottom: 1px solid rgba(63, 63, 70, 0.35);
  margin-bottom: 1px;
}

.agent-workspace__rail-deleted {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-top: 4px;
}

.agent-workspace__rail-deleted > .agent-workspace__rail-tab .agent-workspace__rail-tab-name {
  text-align: center;
}

.agent-workspace__rail-deleted-group {
  display: flex;
  flex-direction: column;
}

@media (max-width: 1320px) {
  .agent-workspace__content {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 1100px) {
  .agent-workspace {
    grid-template-columns: minmax(0, 1fr);
  }

  .agent-workspace__rail {
    position: static;
    order: -1;
    height: auto;
    min-height: 0;
    max-height: none;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding: 0 0 4px;
    border-left: none;
    border-bottom: 1px solid rgba(63, 63, 70, 0.75);
    overflow: visible;
  }

  .agent-workspace__rail-pinned {
    flex: 0 0 auto;
    flex-direction: row;
    align-items: center;
    gap: 4px;
    padding: 0;
    margin: 0;
    border-bottom: none;
    background: transparent;
  }

  .agent-workspace__rail-scroll {
    flex: 1 1 auto;
    min-width: 0;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding-right: 0;
    overflow: visible;
  }

  .agent-workspace__rail-header {
    width: auto;
    justify-content: flex-start;
    padding: 0 6px 0 0;
  }

  .agent-workspace__rail-tab {
    width: auto;
    padding: 2px 8px;
  }

  .agent-workspace__rail-group {
    flex: 0 0 auto;
    flex-direction: row;
    align-items: center;
    gap: 1px;
    padding: 0 6px 0 0;
  }

  .agent-workspace__rail-group-title {
    padding: 0 4px 0 2px;
    border-bottom: none;
    margin-bottom: 0;
    white-space: nowrap;
  }

  .agent-workspace__rail-deleted {
    margin-top: 0;
    margin-left: auto;
    max-height: none;
    overflow: visible;
    flex: 0 0 auto;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 2px;
    padding-top: 0;
  }

  .agent-workspace__rail-deleted-group {
    flex-direction: row;
    align-items: center;
    gap: 2px;
  }
}

.agent-workspace__main-scroll::-webkit-scrollbar,
.agent-workspace__split-pane-scroll::-webkit-scrollbar,
.agent-workspace__rail-scroll::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}

.agent-workspace__main-scroll::-webkit-scrollbar-track,
.agent-workspace__split-pane-scroll::-webkit-scrollbar-track,
.agent-workspace__rail-scroll::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 999px;
}

.agent-workspace__main-scroll::-webkit-scrollbar-thumb,
.agent-workspace__split-pane-scroll::-webkit-scrollbar-thumb,
.agent-workspace__rail-scroll::-webkit-scrollbar-thumb {
  background: #52525B;
  border-radius: 999px;
  border: none;
}

.agent-workspace__main-scroll::-webkit-scrollbar-thumb:hover,
.agent-workspace__split-pane-scroll::-webkit-scrollbar-thumb:hover,
.agent-workspace__rail-scroll::-webkit-scrollbar-thumb:hover {
  background: #71717A;
}

.agent-workspace__main-scroll::-webkit-scrollbar-thumb:active,
.agent-workspace__split-pane-scroll::-webkit-scrollbar-thumb:active,
.agent-workspace__rail-scroll::-webkit-scrollbar-thumb:active {
  background: #A1A1AA;
}
</style>

<style>
.rail-tooltip {
  min-width: 120px;
  max-width: 260px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(18, 18, 20, 0.98);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 9999;
  pointer-events: none;
  white-space: nowrap;
}

.rail-tooltip__title {
  font-size: 12px;
  font-weight: 600;
  color: #FAFAFA;
  margin-bottom: 2px;
}

.rail-tooltip__line {
  font-size: 11px;
  line-height: 1.4;
  color: #A1A1AA;
}

.agent-context-menu {
  position: fixed;
  min-width: 108px;
  padding: 4px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  background: rgba(18, 18, 20, 0.98);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.42);
  z-index: 10000;
}

.agent-context-menu__item {
  width: 100%;
  height: 28px;
  padding: 0 10px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: #E4E4E7;
  font-size: 12px;
  text-align: left;
  cursor: pointer;
}

.agent-context-menu__item:hover {
  background: rgba(239, 68, 68, 0.14);
  color: #FCA5A5;
}
</style>
