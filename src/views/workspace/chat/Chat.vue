<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue'
import { useSessionStore } from '../../../stores/useSessionStore'
import { useAppStore } from '../../../stores/useAppStore'

// 引入对话框组件
import PermissionDialog from './components/dialogs/PermissionDialog.vue'
import AskUserQuestionDialog from './components/dialogs/AskUserQuestionDialog.vue'
import MessageDetailDialog from './components/dialogs/MessageDetailDialog.vue'

// 引入子组件
import EnvInfoBar from './components/layout/EnvInfoBar.vue'
import ChatInput from './components/layout/ChatInput.vue'
import StickyHeader from './components/layout/StickyHeader.vue'
import MessageList from './components/messages/MessageList.vue'

// 引入 composables
// useMessageList composable 的功能已移至 MessageList 组件
// useScroll 和 useHistory composables 已创建，可在未来需要时使用
// import { useScroll } from '../chat/composables/useScroll'
// import { useHistory } from '../chat/composables/useHistory'

const sessionStore = useSessionStore()
const appStore = useAppStore()

// 使用 composables
// useMessage composable 的功能已移至 MessageList 组件

// Props
const props = defineProps({
  sidebarCollapsed: {
    type: Boolean,
    default: false
  }
})

// Emits
const emit = defineEmits(['toggleSidebar', 'startSession', 'closeSession'])

// 使用 SessionStore 的状态（只读 computed）
const messages = computed(() => sessionStore.currentMessages)

// UI 状态
const pendingPermission = computed(() => sessionStore.currentSession?.pendingPermission)
const pendingControlRequest = computed(() => sessionStore.currentSession?.pendingControlRequest)
const pendingQuestion = computed(() => sessionStore.currentSession?.pendingQuestion)
const envInfo = computed(() => sessionStore.currentSession?.envInfo)
const inputMessage = computed({
  get: () => sessionStore.inputMessage,
  set: (val) => { sessionStore.inputMessage = val }
})

const isProcessing = computed(() => sessionStore.isProcessing)
const messagesContainer = ref(null)
// pendingPermission and pendingControlRequest are now computed from sessionStore (defined above)
// pendingQuestion is also now computed from sessionStore
const workingDirectory = ref('') // 工作目录
const selectedMessage = ref(null) // 当前选中的消息（用于显示详情）
const currentTime = ref(Date.now()) // 用于实时更新消耗时间
const stickyMessageIndex = ref(-1) // 当前粘性显示的消息索引
const containerHeight = ref(400) // 聊天容器高度，用于限制粘性面板
const messagesHeight = ref(null) // 消息区域高度，null 表示自动
const isResizing = ref(false) // 是否正在调整大小
let previousMessageCount = 0 // 追踪之前的消息数量
let durationTimer = null // 消耗时间更新定时器
let previousWindowHeight = null // 上一次窗口高度
const inputHistory = [] // 输入历史记录
// Note: isLoadingHistory removed - history is now loaded by SessionStore/SessionInstance

// 权限模式
const permissionMode = ref('default') // 当前权限模式
const showPermissionMenu = ref(false) // 是否显示权限菜单
const permissionModes = [
  { value: 'default', label: '默认', icon: '💡' },
  { value: 'acceptEdits', label: '允许编辑', icon: '✏️' },
  { value: 'plan', label: '计划模式', icon: '📋' },
  { value: 'bypassPermissions', label: '全部允许', icon: '✅' }
]

onMounted(async () => {
  // 启动 SessionStore 的事件监听器（监听后端的 session-event 统一通道）
  sessionStore.startEventListener()

  // 启动消耗时间更新定时器
  durationTimer = setInterval(() => {
    currentTime.value = Date.now()
  }, 100)

  // 记录初始窗口高度
  previousWindowHeight = window.innerHeight

  // 监听窗口大小变化，将高度变化全部作用到 messages 区域
  window.addEventListener('resize', handleWindowResize)

  // 监听聊天容器高度变化
  if (messagesContainer.value) {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerHeight.value = entry.contentRect.height
      }
    })
    resizeObserver.observe(messagesContainer.value)
  }

  // 点击外部关闭操作菜单 - 现在由 MessageList 组件内部处理

  // Get working directory
  try {
    const info = await window.electronAPI.getClaudeInfo()
    workingDirectory.value = info.workingDirectory || ''
  } catch (error) {
    // Ignore error
  }

  // 注意：所有事件现在通过 SessionStore 的 session-event 通道处理
  // 不再需要旧的事件监听器（onClaudeMessage, onStreamEvent 等）

  // 点击外部关闭权限菜单
  document.addEventListener('click', handleClickOutsidePermissionMenu)
})

// Note: Session history is now loaded by SessionStore/SessionInstance
// The messages computed property automatically reflects sessionStore.currentMessages

onUnmounted(() => {
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
})

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
  if (hasStreaming && messagesContainer.value) {
    // 在 DOM 更新前检查滚动位置
    const container = messagesContainer.value
    wasNearBottomBeforeStreaming = container.scrollHeight - container.scrollTop - container.clientHeight < 150
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
  const container = messagesContainer.value
  if (!container) return

  const wasNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150

  // 等待 DOM 更新
  await nextTick()

  // 如果用户之前在底部，自动滚动到底部
  if (wasNearBottom) {
    scrollToBottom(true)
  }
}, { deep: true, immediate: false })

// 监听消息变化，当有新消息时自动折叠之前已完成的消息
watch(() => messages.value, async (newMessages) => {
  const newLength = newMessages?.length || 0

  if (newLength > previousMessageCount && newLength > 1) {
    // 检查用户是否在底部（在折叠前检查）
    const container = messagesContainer.value
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

      // 折叠已完成的 tool_use 消息
      if (message.role === 'tool_use' && message.result && !message.isError && !message.isExecuting) {
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
}, { deep: true })

// 监听 session 切换，自动滚动到底部
watch(() => sessionStore.currentSessionId, async (newSessionId, oldSessionId) => {
  if (newSessionId && newSessionId !== oldSessionId) {
    // 等待 DOM 更新
    await nextTick()
    // 切换 session 时强制滚动到底部
    setTimeout(() => {
      scrollToBottom(true)
    }, 100)
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

// 处理 PID 点击（启动/关闭 Claude）
function handlePidClick() {
  const currentSession = sessionStore.currentSession
  if (!currentSession) return

  // 根据 PID 状态决定操作
  if (envInfo.value?.claudePid) {
    // 有关闭 Claude
    emit('closeSession', { id: currentSession.id })
  } else {
    // 有启动 Claude
    emit('startSession', { id: currentSession.id })
  }
}

// Rewind 确认对话框状态
const showRewindDialog = ref(false)
const rewindPreviewData = ref(null)
const rewindTargetMessageId = ref(null)
const rewindTargetMessageIndex = ref(null)

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
  // 折叠之前所有用户消息的回答
  messages.value.forEach(msg => {
    if (msg.role === 'user') {
      msg.responseCollapsed = true
    }
  })

  inputMessage.value = ''
  scrollToBottom(true) // 用户发送消息时强制滚动

  try {
    // 使用 SessionStore 发送消息（会自动处理 sessionId）
    await sessionStore.sendMessage(userText)
  } catch (error) {
    messages.value.push({
      role: 'system',
      content: `Error: ${error.message}`,
      timestamp: new Date()
    })
  }
}

// 添加到历史记录（从 ChatInput 组件调用）
function addToHistory(text) {
  if (text && (inputHistory.length === 0 || inputHistory[inputHistory.length - 1] !== text)) {
    inputHistory.push(text)
    // 限制历史记录数量
    if (inputHistory.length > 100) {
      inputHistory.shift()
    }
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

// 滚动到底部
function scrollToBottom(forceScroll = false) {
  if (!messagesContainer.value) return

  const container = messagesContainer.value

  // 如果不强制滚动，检查当前是否接近底部
  if (!forceScroll) {
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100

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

  // 使用 requestAnimationFrame 确保在下一帧渲染后滚动
  // 这能更好地处理高高度元素的异步渲染
  const doScroll = () => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  }

  // 立即滚动一次
  doScroll()

  // 等待 DOM 完全更新后再滚动一次（处理异步渲染的高高度元素）
  nextTick(() => {
    requestAnimationFrame(() => {
      doScroll()

      // 再延迟一点时间，确保所有内容都已渲染完成
      setTimeout(() => {
        doScroll()
      }, 100)
    })
  })
}

// 处理用户滚动事件
function handleUserScroll() {
  if (!messagesContainer.value) return
  const container = messagesContainer.value
  const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100

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
  if (!messagesContainer.value) return
  const container = messagesContainer.value

  // 获取所有消息元素
  const messageElements = container.querySelectorAll('.message')

  let currentStickyIndex = -1

  // 从上往下遍历，找到最后一个已经滚过顶部的用户消息
  messageElements.forEach((el, idx) => {
    const rect = el.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()

    // 如果消息顶部已经在容器顶部以上（或刚好在顶部）
    if (rect.top <= containerRect.top + 10) {
      // 检查这个消息是否是用户消息，或者它前面的最近用户消息
      const msgIndex = parseInt(el.getAttribute('data-index') || idx)
      const msg = messages.value[msgIndex]

      if (msg && msg.role === 'user') {
        currentStickyIndex = msgIndex
      }
    }
  })

  // 检查可见区域内是否有用户消息
  let hasVisibleUserMessage = false
  messageElements.forEach((el, idx) => {
    const rect = el.getBoundingClientRect()
    const containerRect = container.getBoundingClientRect()

    // 消息在可见区域内
    if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
      const msgIndex = parseInt(el.getAttribute('data-index') || idx)
      const msg = messages.value[msgIndex]
      if (msg && msg.role === 'user') {
        hasVisibleUserMessage = true
      }
    }
  })

  // 只有当可见区域内没有用户消息时，才显示粘性头部
  if (hasVisibleUserMessage) {
    stickyMessageIndex.value = -1
  } else if (currentStickyIndex >= 0) {
    stickyMessageIndex.value = currentStickyIndex
  } else {
    stickyMessageIndex.value = -1
  }
}

// 通过索引获取粘性消息（确保响应式更新）
const stickyMessage = computed(() => {
  if (stickyMessageIndex.value >= 0 && stickyMessageIndex.value < messages.value.length) {
    return messages.value[stickyMessageIndex.value]
  }
  return null
})

// 判断粘性消息是否正在被回答（基于消息是否有 duration）
const isStickyMessageProcessing = computed(() => {
  // 如果粘性消息存在且没有 duration，说明还在处理中
  return !!(stickyMessage.value && !stickyMessage.value.duration)
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
  // 如果没有设置高度（自动模式），则不需要处理，让 flex 布局自动调整
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
    // 计算最大高度：窗口高度 - env-header(约50px) - 输入区域最小高度(160px，包含padding)
    const maxHeight = window.innerHeight - 50 - 160
    const newHeight = Math.max(200, Math.min(maxHeight, startHeight + deltaY))

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

async function handlePermissionApprove(requestId, toolName, displayDetail) {
  const permission = pendingPermission.value
  const controlRequest = pendingControlRequest.value

  // 清除权限请求，并保存请求信息用于后续添加权限结果消息
  // 气泡会在 CLI 返回 control_response 后添加
  sessionStore.clearPendingPermissions(true)

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

      await sessionStore.sendToolResult(requestId, '', false)
    }
  } catch (error) {
    // 找到对应的 tool_use 消息并更新状态
    // 对于 control_request，消息使用 tool_use_id 作为 request_id
    const searchId = controlRequest?.tool_use_id || requestId
    const toolUseMsg = messages.value.find(m => m.role === 'tool_use' && m.request_id === searchId)
    if (toolUseMsg) {
      toolUseMsg.isError = true
      toolUseMsg.result = `发送权限响应失败: ${error.message}`
    }
  }
}

async function handlePermissionDeny(requestId) {
  const permission = pendingPermission.value
  const controlRequest = pendingControlRequest.value

  // 清除权限请求，并保存请求信息用于后续添加权限结果消息
  sessionStore.clearPendingPermissions(true)

  // 找到对应的 tool_use 消息并更新状态
  // 对于 control_request，消息使用 tool_use_id 作为 request_id
  const searchId = controlRequest?.tool_use_id || requestId
  const toolUseMsg = messages.value.find(m => m.role === 'tool_use' && m.request_id === searchId)
  if (toolUseMsg) {
    toolUseMsg.isExecuting = false
    toolUseMsg.isError = true
    toolUseMsg.result = '用户拒绝'
    // 计算 duration
    if (toolUseMsg.startTime) {
      toolUseMsg.duration = Date.now() - toolUseMsg.startTime
    }
  }

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
      await sessionStore.sendToolResult(requestId, 'Permission denied by user', true)
    }
  } catch (error) {
    if (toolUseMsg) {
      toolUseMsg.result = `发送拒绝响应失败: ${error.message}`
    }
  }
}

async function handlePermissionApproveAll(requestId) {
  const permission = pendingPermission.value
  const controlRequest = pendingControlRequest.value

  // 清除权限请求，并保存请求信息用于后续添加权限结果消息
  // 气泡会在 CLI 返回 control_response 后添加
  sessionStore.clearPendingPermissions(true)

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

      await sessionStore.sendToolResult(requestId, '', false)
    }
  } catch (error) {
    // Ignore error
  }
}

// 处理代码还原 - 接收 MessageList 发出的事件对象
async function handleRewind({ messageId, messageIndex }) {
  console.log('[Rewind] handleRewind called with messageId:', messageId, 'index:', messageIndex)

  // 先显示对话框（用于测试）
  rewindTargetMessageId.value = messageId
  rewindTargetMessageIndex.value = messageIndex
  rewindPreviewData.value = {
    files: [],
    insertions: 0,
    deletions: 0
  }

  console.log('[Rewind] Setting showRewindDialog to true (before API call)')
  showRewindDialog.value = true
  console.log('[Rewind] showRewindDialog is now:', showRewindDialog.value)

  try {
    // 调用 dry_run: true 获取预览
    const previewResponse = await sessionStore.sendControlRequest({
      subtype: 'rewind_files',
      user_message_id: messageId,
      dry_run: true
    })

    console.log('[Rewind] Preview response:', previewResponse)
    console.log('[Rewind] previewResponse.response:', previewResponse?.response)

    // 更新预览数据
    let data = null
    if (previewResponse && previewResponse.response) {
      data = previewResponse.response.response || previewResponse.response
      console.log('[Rewind] Extracted data:', data)

      rewindPreviewData.value = {
        files: data?.filesChanged || data?.restored_files || [],
        insertions: data?.insertions || data?.lines_added || 0,
        deletions: data?.deletions || data?.lines_removed || 0
      }
      console.log('[Rewind] Updated rewindPreviewData:', rewindPreviewData.value)
    }

  } catch (error) {
    console.error('[Rewind] Preview error:', error)

    // 关闭对话框并显示错误
    showRewindDialog.value = false

    messages.value.push({
      role: 'system',
      content: `❌ 获取还原预览失败: ${error.message || error}`,
      timestamp: new Date()
    })
    scrollToBottom()
  }
}

// 确认执行还原
async function confirmRewind() {
  showRewindDialog.value = false

  try {
    // 执行实际还原
    const response = await sessionStore.sendControlRequest({
      subtype: 'rewind_files',
      user_message_id: rewindTargetMessageId.value,
      dry_run: false
    })

    console.log('[Rewind] Response:', response)

    // 显示还原结果
    if (response && response.response) {
      const result = response.response
      const data = result.response || {}

      const originalMessage = messages.value.find(m => m.id === rewindTargetMessageId.value)
      const originalContent = originalMessage?.content || '未知消息'

      // 使用预览数据（如果可用），否则使用实际响应数据
      const changedFiles = rewindPreviewData.value?.files || data.filesChanged || data.restored_files || []
      const insertions = rewindPreviewData.value?.insertions || data.insertions || 0
      const deletions = rewindPreviewData.value?.deletions || data.deletions || 0

      const hasRestoredFiles = changedFiles.length > 0
      const canRewind = data.canRewind === true

      let noticeContent = `已还原到「${originalContent.substring(0, 30)}${originalContent.length > 30 ? '...' : ''}」前的文件状态`

      if (hasRestoredFiles) {
        const restoredCount = changedFiles.length
        noticeContent += `\n共还原了 ${restoredCount} 个文件`
      }

      messages.value.push({
        id: `rewind-${Date.now()}`,
        role: 'system',
        subtype: 'rewind-notice',
        content: noticeContent,
        rewindToMessageId: rewindTargetMessageId.value,
        originalMessageContent: originalContent,
        restoredFilesCount: hasRestoredFiles ? changedFiles.length : (canRewind ? null : 0),
        restoredFiles: changedFiles, // 保存完整的文件列表
        insertions: insertions,
        deletions: deletions,
        timestamp: new Date()
      })

      scrollToBottom()
    }
  } catch (error) {
    console.error('[Rewind] Error:', error)

    messages.value.push({
      role: 'system',
      content: `❌ 还原失败: ${error.message || error}`,
      timestamp: new Date()
    })
    scrollToBottom()
  }
}

// 取消还原
function cancelRewind() {
  showRewindDialog.value = false
  rewindPreviewData.value = null
  rewindTargetMessageId.value = null
  rewindTargetMessageIndex.value = null
}

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
    // 后端会自动处理 Claude 启动（如果需要）
    const response = await sessionStore.sendControlRequest({
      subtype: 'fork_session',
      message_id: messageId
    })

    console.log('[Fork] Response:', response)

    if (response && response.response) {
      const result = response.response
      messages.value.push({
        role: 'system',
        content: `✅ 会话分支创建成功\n新会话 ID: ${result.session_id || '已生成'}\n\n您可以在项目列表中找到这个新会话`,
        timestamp: new Date()
      })
      scrollToBottom()
    }
  } catch (error) {
    console.error('[Fork] Error:', error)
    messages.value.push({
      role: 'system',
      content: `❌ 创建分支失败: ${error.message || error}`,
      timestamp: new Date()
    })
    scrollToBottom()
  }
}

// 处理还原并创建分支 - 接收 MessageList 发出的事件对象
async function handleRewindAndFork({ messageId, messageIndex }) {
  const confirmed = confirm(
    '确定要还原并创建分支吗？\n\n' +
    '这将：\n' +
    '• 先将当前状态保存到新分支\n' +
    '• 然后还原到此次提问之前的状态\n' +
    '• 删除此次提问后的所有消息\n' +
    '• 此操作无法撤销\n\n' +
    '适用于：想保留当前进度，同时回滚代码探索其他方案'
  )

  if (!confirmed) return

  try {
    // 后端会自动处理 Claude 启动（如果需要）
    const response = await sessionStore.sendControlRequest({
      subtype: 'rewind_and_fork',
      user_message_id: messageId,
      dry_run: false
    })

    console.log('[RewindAndFork] Response:', response)

    if (response && response.response) {
      const result = response.response

      // 删除此次提问之后的所有消息
      const deleteCount = messages.value.length - messageIndex - 1
      if (deleteCount > 0) {
        messages.value.splice(messageIndex + 1, deleteCount)
      }

      const restoredCount = result.restored_files?.length || 0
      const newSessionId = result.new_session_id || '已生成'

      messages.value.push({
        role: 'system',
        content: `✅ 已还原并创建分支\n\n` +
          `📦 新分支 ID: ${newSessionId}\n` +
          ` (已保存当前状态)\n` +
          `🔄 还原了 ${restoredCount} 个文件\n\n` +
          `您可以在项目列表中找到新分支继续探索`,
        timestamp: new Date()
      })
      scrollToBottom()
    }
  } catch (error) {
    console.error('[RewindAndFork] Error:', error)
    messages.value.push({
      role: 'system',
      content: `❌ 还原并创建分支失败: ${error.message || error}`,
      timestamp: new Date()
    })
    scrollToBottom()
  }
}

// 处理权限模式切换
async function handlePermissionModeChange(mode) {
  if (mode === permissionMode.value) return

  const previousMode = permissionMode.value
  permissionMode.value = mode

  const modeLabel = permissionModes.find(m => m.value === mode)?.label || mode

  try {
    // 调用 sessionStore 的 setPermissionMode
    // 后端会自动判断：
    // - 如果 Claude 已启动，发送 control_request
    // - 如果 Claude 未启动，保存模式，启动时应用
    await sessionStore.setPermissionMode(mode)

    // 添加系统消息提示
    const isClaudeReady = envInfo.value?.claudePid != null
    if (isClaudeReady) {
      messages.value.push({
        role: 'system',
        content: `🔄 权限模式已切换: ${modeLabel}`,
        timestamp: new Date()
      })
    } else {
      messages.value.push({
        role: 'system',
        content: `💡 权限模式已设置为: ${modeLabel} (将在 Claude 启动时生效)`,
        timestamp: new Date()
      })
    }
    scrollToBottom()
  } catch (error) {
    // 恢复之前的模式
    permissionMode.value = previousMode
    console.error('Failed to set permission mode:', error)

    messages.value.push({
      role: 'system',
      content: `❌ 设置权限模式失败: ${error.message}`,
      timestamp: new Date()
    })
    scrollToBottom()
  }
}

// 选择权限模式（从菜单）
function selectPermissionMode(mode) {
  showPermissionMenu.value = false
  handlePermissionModeChange(mode)
}

async function handleQuestionAnswer(requestId, answers) {
  console.log('[ChatWindow] handleQuestionAnswer called, requestId:', requestId, 'answers:', answers)
  const question = pendingQuestion.value
  console.log('[ChatWindow] question:', question ? 'exists' : 'null')
  if (question) {
    console.log('[ChatWindow] question.tool_use_id:', question.tool_use_id)
    console.log('[ChatWindow] question.toolUseId:', question.toolUseId)
    console.log('[ChatWindow] question.id:', question.id)
    console.log('[ChatWindow] question.request_id:', question.request_id)
    console.log('[ChatWindow] Full question object:', JSON.stringify(question, null, 2))
  }
  sessionStore.clearPendingQuestion()

  if (question) {
    // 获取 tool_use_id - 支持多种可能的字段名
    const toolUseId = question.tool_use_id || question.toolUseId || question.id || requestId
    console.log('[ChatWindow] Using toolUseId:', toolUseId)

    // 获取问题数据 - 支持多种字段名格式
    let toolInput = question.input || question.tool_input || question.toolInput

    // 如果 toolInput 是字符串，尝试解析为 JSON
    if (typeof toolInput === 'string') {
      try {
        toolInput = JSON.parse(toolInput)
        console.log('[ChatWindow] Parsed toolInput for questions')
      } catch (e) {
        console.log('[ChatWindow] Failed to parse toolInput:', e.message)
      }
    }

    let questionsData = []
    if (toolInput && toolInput.questions) {
      questionsData = toolInput.questions
    } else if (question.questions) {
      questionsData = question.questions
    }

    console.log('[ChatWindow] questionsData count:', questionsData.length)

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

    // 添加一个包含所有问题的问答消息
    // 注意：resultReceived 将在收到 tool_result 后设置为 true
    const newMessage = {
      role: 'question',
      tool_use_id: toolUseId, // 存储 tool_use_id 以便关联 tool_result
      questions: questionItems,
      userAnswers: answers, // 存储用户提交的答案
      resultReceived: false, // 等待 tool_result 确认
      answersConsistent: true, // 默认一致，收到 tool_result 后会更新
      receivedAnswers: null, // 收到 tool_result 后会填充
      collapsed: false,
      timestamp: new Date(),
      rawMessages: [question] // 存储原始请求
    }
    messages.value.push(newMessage)

    scrollToBottom(true) // 用户提交答案时强制滚动

    // 发送 control_response 必须在 if (question) 块内部
    // 因为需要访问 toolUseId
    try {
      // 对于 AskUserQuestion，发送 control_response 并包含所有答案
      // 答案格式：{ "问题": "答案" }
      const options = {
        toolUseID: toolUseId, // 必须传递 toolUseID 以便关联响应
        updatedInput: {
          answers: answers
        }
      }

      console.log('[ChatWindow] Sending control response with options:', JSON.stringify(options, null, 2))
      await sessionStore.sendControlResponse(requestId, true, options)
    } catch (error) {
      console.error('[ChatWindow] Failed to send control response:', error)
    }
  } else {
    console.warn('[ChatWindow] handleQuestionAnswer: question is null, cannot send response')
  }
}
</script>

<template>
  <div class="chat-window">
    <!-- Top Bar: Environment Bar -->
    <EnvInfoBar
      :env-info="envInfo"
      :project-path="appStore.currentProject?.path"
      :sidebar-collapsed="sidebarCollapsed"
      @toggle-sidebar="emit('toggleSidebar')"
      @pid-click="handlePidClick"
    />
    <div class="messages" ref="messagesContainer" @scroll="handleUserScroll" :style="messagesHeight ? { height: messagesHeight, flex: '0 0 auto' } : {}">
      <!-- 粘性头部 - 浮动在聊天内容上方 -->
      <StickyHeader
        v-if="stickyMessage"
        :message="stickyMessage"
        :is-processing="isStickyMessageProcessing"
        :current-time="currentTime"
        :container-height="containerHeight"
        :is-copied="stickyCopied"
        @copy="copyStickyMessage"
        @scroll-to-user="scrollToStickyMessage"
      />
      <!-- 消息列表 -->
      <MessageList
        :messages="messages"
        :working-directory="workingDirectory"
        :current-time="currentTime"
        @message-click="handleMessageClick"
        @rewind="handleRewind"
        @fork="handleFork"
        @rewind-and-fork="handleRewindAndFork"
        @jump-to-message="handleRewindNoticeClick"
      />
    </div>

    <!-- 可拖拽的分隔条 -->
    <div
      class="resize-handle"
      :class="{ resizing: isResizing }"
      @mousedown="startResize"
    ></div>

    <!-- Input Area -->
    <ChatInput
      v-model="inputMessage"
      :is-processing="isProcessing"
      :has-permission="pendingPermission !== null || pendingControlRequest !== null"
      :permission-mode="permissionMode"
      :permission-modes="permissionModes"
      :input-history="inputHistory"
      @send="handleSendMessage"
      @interrupt="handleInterrupt"
      @permission-mode-change="selectPermissionMode"
      @add-to-history="addToHistory"
    />

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
    <div v-if="showRewindDialog" class="rewind-dialog-overlay" @click.self="cancelRewind">
      <div class="rewind-dialog">
        <div class="rewind-dialog-header">
          <div class="rewind-dialog-icon">↩️</div>
          <h3 class="rewind-dialog-title">确认还原</h3>
        </div>

        <div class="rewind-dialog-content">
          <!-- 文件变更 -->
          <div v-if="rewindPreviewData?.files?.length > 0" class="rewind-dialog-section">
            <div class="rewind-dialog-section-title">
              <span class="section-icon">📄</span>
              将还原 {{ rewindPreviewData.files.length }} 个文件
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
              没有文件需要还原
            </div>
          </div>

          <!-- 行数统计 -->
          <div v-if="rewindPreviewData?.deletions > 0 || rewindPreviewData?.insertions > 0" class="rewind-dialog-section">
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
                <span>撤销此次提问后的所有代码修改</span>
              </div>
              <div class="warning-item">
                <span class="warning-icon">•</span>
                <span>创建一个还原点提示，可点击跳转到此次提问</span>
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
          <button class="rewind-btn confirm" @click="confirmRewind">
            确认还原
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
  display: flex;
  flex-direction: column;
}

/* Top Bar: Expand Button + Environment Bar */
.top-bar {
  display: flex;
  align-items: stretch;
  background: #18181B;
  border-bottom: 1px solid #27272A;
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
  border-right: 1px solid #27272A;
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
  background: #27272A;
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
  background: #3F3F46;
  color: #A1A1AA;
}

.env-detail-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: #18181B;
  border-bottom: 1px solid #27272A;
  padding: 12px 16px;
  z-index: 100;
  -webkit-app-region: no-drag;
  cursor: default;
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
  min-height: 200px;
  overflow-y: auto;
  padding: 20px;
  position: relative;
  /* Modern scrollbar styling */
  scrollbar-width: thin;
  scrollbar-color: #52525B #18181B;
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
  background: transparent;
  cursor: ns-resize;
  transition: background 0.2s;
  -webkit-app-region: no-drag;
  flex-shrink: 0;
}

.resize-handle:hover {
  background: #F97316;
}

.resize-handle.resizing {
  background: #EA580C;
}

.input-area {
  position: relative;
  padding: 20px;
  border-top: 1px solid #3F3F46;
  display: flex;
  -webkit-app-region: no-drag;
  flex: 0 0 auto;
  min-height: 165px;
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

/* Modern scrollbar styles for Webkit browsers */
.messages::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

.messages::-webkit-scrollbar-track {
  background: #18181B;
  border-radius: 4px;
}

.messages::-webkit-scrollbar-thumb {
  background: #52525B;
  border-radius: 4px;
  border: 2px solid #18181B;
}

.messages::-webkit-scrollbar-thumb:hover {
  background: #71717A;
}

.messages::-webkit-scrollbar-thumb:active {
  background: #A1A1AA;
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

</style>
