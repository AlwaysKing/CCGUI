<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue'
import { useSessionStore } from '../stores/useSessionStore'
import MarkdownRenderer from './MarkdownRenderer.vue'
import PermissionDialog from './PermissionDialog.vue'
import AskUserQuestionDialog from './AskUserQuestionDialog.vue'
import ToolUseMessage from './ToolUseMessage.vue'
import MessageDetailDialog from './MessageDetailDialog.vue'

const sessionStore = useSessionStore()

// Props
const props = defineProps({
  sidebarCollapsed: {
    type: Boolean,
    default: false
  }
})

// Emits
const emit = defineEmits(['toggleSidebar'])

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
const inputArea = ref(null)
// pendingPermission and pendingControlRequest are now computed from sessionStore (defined above)
// pendingQuestion is also now computed from sessionStore
const isDragOver = ref(false)
const questionActiveTabs = ref({}) // 存储每条问答消息的 active tab
const workingDirectory = ref('') // 工作目录
const selectedMessage = ref(null) // 当前选中的消息（用于显示详情）
const currentTime = ref(Date.now()) // 用于实时更新消耗时间
const showEnvDetail = ref(false) // 是否显示环境详情
const stickyMessageIndex = ref(-1) // 当前粘性显示的消息索引
const containerHeight = ref(400) // 聊天容器高度，用于限制粘性面板
let previousMessageCount = 0 // 追踪之前的消息数量
let durationTimer = null // 消耗时间更新定时器
const inputHistory = [] // 输入历史记录
let historyIndex = -1 // 当前历史索引，-1 表示不在浏览历史
let isHistoryNavigation = false // 标记是否正在通过历史导航设置值
const showHistoryPicker = ref(false) // 显示历史记录选择弹窗
// Note: isLoadingHistory removed - history is now loaded by SessionStore/SessionInstance

onMounted(async () => {
  // 启动 SessionStore 的事件监听器（监听后端的 session-event 统一通道）
  sessionStore.startEventListener()

  // 启动消耗时间更新定时器
  durationTimer = setInterval(() => {
    currentTime.value = Date.now()
  }, 100)

  // 监听聊天容器高度变化
  if (messagesContainer.value) {
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        containerHeight.value = entry.contentRect.height
      }
    })
    resizeObserver.observe(messagesContainer.value)
  }

  // Get working directory
  try {
    const info = await window.electronAPI.getClaudeInfo()
    workingDirectory.value = info.workingDirectory || ''
  } catch (error) {
    // Ignore error
  }

  // 注意：所有事件现在通过 SessionStore 的 session-event 通道处理
  // 不再需要旧的事件监听器（onClaudeMessage, onStreamEvent 等）
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
})

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

// 格式化消耗时间
function formatDuration(ms) {
  if (!ms) return ''
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

// 复制消息内容
const copiedMessageIndex = ref(-1)
async function copyMessageContent(index) {
  const message = messages.value[index]
  if (!message) return

  let content = ''
  if (message.role === 'user') {
    content = typeof message.content === 'string' ? message.content : message.content
  } else if (message.role === 'assistant') {
    content = typeof message.content === 'string' ? message.content : message.content
  } else {
    content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
  }

  try {
    await navigator.clipboard.writeText(content)
    copiedMessageIndex.value = index
    setTimeout(() => {
      copiedMessageIndex.value = -1
    }, 2000)
  } catch (err) {
    console.error('复制失败:', err)
  }
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

// 复制问答内容
async function copyQuestionContent(index) {
  const message = messages.value[index]
  if (!message || !message.questions) return

  let content = '问答记录:\n\n'
  message.questions.forEach((q, idx) => {
    content += `【${q.header}】\n`
    if (q.question) content += `问题: ${q.question}\n`
    content += `答案: ${q.selectedAnswer || '未选择'}\n`
    if (idx < message.questions.length - 1) content += '\n'
  })

  try {
    await navigator.clipboard.writeText(content)
    copiedMessageIndex.value = index
    setTimeout(() => {
      copiedMessageIndex.value = -1
    }, 2000)
  } catch (err) {
    console.error('复制失败:', err)
  }
}

// 格式化 token 消耗
function formatTokens(usage) {
  if (!usage) return ''
  const cache = usage.cache_read_input_tokens || 0
  const input = usage.input_tokens || 0
  const output = usage.output_tokens || 0
  if (cache === 0 && input === 0 && output === 0) return ''

  const parts = []
  if (cache > 0) parts.push(`缓存:${cache}`)
  if (input > 0) parts.push(`输入:${input}`)
  if (output > 0) parts.push(`输出:${output}`)
  return parts.join(' ')
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

async function sendMessage() {
  if (!inputMessage.value.trim() || isProcessing.value) return

  const userText = inputMessage.value

  // 折叠之前所有用户消息的回答
  messages.value.forEach(msg => {
    if (msg.role === 'user') {
      msg.responseCollapsed = true
    }
  })

  // 保存到历史记录（避免重复）
  if (userText && (inputHistory.length === 0 || inputHistory[inputHistory.length - 1] !== userText)) {
    inputHistory.push(userText)
    // 限制历史记录数量
    if (inputHistory.length > 100) {
      inputHistory.shift()
    }
  }
  historyIndex = -1 // 重置历史索引

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

// 记录用户是否主动滚动离开底部
let userScrolledAway = false

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

// 判断是否是最后一个用户消息
function isLastUserMessage(index) {
  for (let i = messages.value.length - 1; i >= 0; i--) {
    if (messages.value[i].role === 'user') {
      return i === index
    }
  }
  return false
}

function handleEnterKey(event) {
  // 如果正在使用输入法组合（如中文输入），不触发发送
  if (event.isComposing) {
    return
  }

  // Shift+Enter 换行，Enter 发送
  if (event.shiftKey) {
    // 换行：不做任何处理，让默认行为发生
    return
  }

  // Enter 发送消息
  event.preventDefault() // 阻止换行
  sendMessage()
}

// 处理输入框上下键历史导航
function handleHistoryKey(event) {
  // 如果输入框有内容且不在历史浏览模式，不触发历史导航
  if (inputMessage.value.trim() && historyIndex === -1) {
    return
  }

  // 如果没有历史记录，不处理
  if (inputHistory.length === 0) {
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    // 向上：浏览更早的历史（索引增大）
    if (historyIndex < inputHistory.length - 1) {
      historyIndex++
      isHistoryNavigation = true
      inputMessage.value = inputHistory[inputHistory.length - 1 - historyIndex]
      isHistoryNavigation = false
    }
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    // 向下：浏览更新的历史（索引减小）
    if (historyIndex > 0) {
      historyIndex--
      isHistoryNavigation = true
      inputMessage.value = inputHistory[inputHistory.length - 1 - historyIndex]
      isHistoryNavigation = false
    } else if (historyIndex === 0) {
      // 回到最新状态，清空输入框
      historyIndex = -1
      isHistoryNavigation = true
      inputMessage.value = ''
      isHistoryNavigation = false
    }
  }
}

// 处理用户手动输入，退出历史浏览模式
function handleInputChange() {
  if (!isHistoryNavigation && historyIndex !== -1) {
    historyIndex = -1
  }
}

// 处理打断请求
async function handleInterrupt() {
  try {
    await sessionStore.sendInterrupt()
  } catch (error) {
    console.error('发送打断请求失败:', error)
  }
}

// 打开历史记录选择弹窗
function openHistoryPicker(event) {
  // Escape 关闭弹窗
  if (event.key === 'Escape' && showHistoryPicker.value) {
    event.preventDefault()
    closeHistoryPicker()
    return
  }

  // Cmd+Up (Mac) 或 Ctrl+Up (Windows) 打开弹窗
  if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowUp') {
    event.preventDefault()
    if (inputHistory.length > 0) {
      showHistoryPicker.value = true
    }
  }
}

// 关闭历史记录选择弹窗
function closeHistoryPicker() {
  showHistoryPicker.value = false
}

// 选择历史记录
function selectHistory(item) {
  isHistoryNavigation = true
  inputMessage.value = item
  isHistoryNavigation = false
  historyIndex = -1
  closeHistoryPicker()
  nextTick(() => {
    inputArea.value?.focus()
  })
}

// 处理文件拖放
function handleFileDrop(event) {
  event.preventDefault()
  isDragOver.value = false

  const files = event.dataTransfer?.files
  if (!files || files.length === 0) return

  // 提取文件路径并添加到输入框
  const filePaths = []
  for (const file of files) {
    // file.path 在 Electron 中可用，包含完整文件路径
    if (file.path) {
      filePaths.push(file.path)
    }
  }

  if (filePaths.length > 0) {
    // 如果输入框已有内容，先添加空格
    if (inputMessage.value.trim()) {
      inputMessage.value += ' '
    }
    inputMessage.value += filePaths.join(' ')
  }
}

function handleDragEnter(event) {
  event.preventDefault()
  isDragOver.value = true
}

function handleDragLeave(event) {
  event.preventDefault()
  isDragOver.value = false
}

async function handlePermissionApprove(requestId, toolName, displayDetail) {
  const permission = pendingPermission.value
  const controlRequest = pendingControlRequest.value

  // 清除权限请求（使用 sessionStore 方法）
  sessionStore.clearPendingPermissions()

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

  // 清除权限请求（使用 sessionStore 方法）
  sessionStore.clearPendingPermissions()

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

      // 构建完整的响应消息用于日志
      const responseMessage = {
        type: 'control_response',
        response: {
          subtype: 'success',
          request_id: requestId,
          response: {
            behavior: 'deny',
            ...options
          }
        }
      }

      await sessionStore.sendControlResponse(requestId, false, options)
    } else {
      // Regular tool_use permission
      const responseMessage = {
        type: 'tool_result',
        tool_use_id: requestId,
        content: 'Permission denied by user',
        is_error: true
      }

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

  // 清除权限请求（使用 sessionStore 方法）
  sessionStore.clearPendingPermissions()

  if (permission || controlRequest) {
    const toolName = permission?.tool_name || controlRequest?.tool_name
    messages.value.push({
      role: 'system',
      content: `✅ 已允许 (所有): ${toolName}`,
      timestamp: new Date()
    })
    scrollToBottom()
  }

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

// 切换问答消息的 tab
function switchQuestionTab(messageIndex, tabIndex) {
  questionActiveTabs.value[messageIndex] = tabIndex
}

// 获取问答消息的 active tab
function getQuestionActiveTab(messageIndex) {
  return questionActiveTabs.value[messageIndex] ?? 0
}

// 切换工具使用消息的折叠状态
function handleToolToggleCollapse(message) {
  if (message) {
    message.collapsed = !message.collapsed
    // 标记为手动操作
    message.manuallyExpanded = !message.collapsed
  }
}

// 切换 thinking 折叠状态
function toggleThinkingCollapse(message) {
  if (message) {
    message.thinkingCollapsed = !message.thinkingCollapsed
  }
}

// 切换问答消息的折叠状态
function toggleQuestionCollapse(messageIndex) {
  const message = messages.value[messageIndex]
  if (message) {
    message.collapsed = !message.collapsed
    // 标记为手动操作
    message.manuallyExpanded = !message.collapsed
  }
}

// 获取问答消息的折叠状态（默认折叠）
function isQuestionCollapsed(messageIndex) {
  const message = messages.value[messageIndex]
  return message?.collapsed ?? true
}

// 判断某条消息是否因为前面的用户消息回答被折叠而应该隐藏
// 返回 { collapsed: boolean, byUserIndex: number|null }
function getResponseCollapseState(messageIndex) {
  // 向前查找最近的用户消息
  for (let i = messageIndex - 1; i >= 0; i--) {
    if (messages.value[i].role === 'user') {
      if (messages.value[i].responseCollapsed) {
        return { collapsed: true, byUserIndex: i }
      }
      break // 找到最近的用户消息就停止
    }
  }
  return { collapsed: false, byUserIndex: null }
}

// 切换用户消息的回答折叠状态
function toggleResponseCollapse(messageIndex) {
  const message = messages.value[messageIndex]
  if (message && message.role === 'user') {
    message.responseCollapsed = !message.responseCollapsed
  }
}

// 比较两个答案对象是否一致
function compareAnswers(userAnswers, receivedAnswers) {
  const userKeys = Object.keys(userAnswers)
  const receivedKeys = Object.keys(receivedAnswers)

  if (userKeys.length !== receivedKeys.length) {
    return false
  }

  for (const key of userKeys) {
    if (!receivedAnswers.hasOwnProperty(key)) {
      return false
    }
    // 标准化答案进行比较（处理空格差异）
    const userAnswer = String(userAnswers[key]).trim()
    const receivedAnswer = String(receivedAnswers[key]).trim()
    if (userAnswer !== receivedAnswer) {
      return false
    }
  }

  return true
}

// 检查选项是否被选中（支持数组和逗号分隔字符串两种格式）
function isOptionSelected(question, optionLabel) {
  if (question.multiSelect) {
    const answer = question.selectedAnswer
    if (Array.isArray(answer)) {
      return answer.includes(optionLabel)
    }
    if (typeof answer === 'string') {
      // 支持逗号分隔或逗号+空格分隔
      const selectedOptions = answer.split(/,\s*/).map(s => s.trim())
      return selectedOptions.includes(optionLabel)
    }
    return false
  }
  return optionLabel === question.selectedAnswer
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
    <!-- Top Bar: Expand Button + Environment Bar -->
    <div v-if="envInfo || sidebarCollapsed" class="top-bar" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
      <!-- Expand Button (when sidebar collapsed) -->
      <button
        v-if="sidebarCollapsed"
        class="expand-btn-top"
        @click="emit('toggleSidebar')"
        title="展开侧边栏"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>

      <!-- Environment Bar -->
      <div v-if="envInfo" class="env-bar" :class="{ 'with-expand-btn': sidebarCollapsed }">
        <div class="env-main">
          <span class="env-item">
            <span class="env-icon">📁</span>
            <span class="env-label">{{ envInfo.cwd?.split('/').pop() || envInfo.cwd }}</span>
          </span>
          <span v-if="envInfo.model" class="env-item">
            <span class="env-icon">🤖</span>
            <span class="env-label">{{ envInfo.model }}</span>
          </span>
          <span v-if="envInfo.session_id" class="env-item">
            <span class="env-icon">🔗</span>
            <span class="env-label">{{ envInfo.session_id?.substring(0, 8) }}</span>
          </span>
        <span v-if="envInfo.tools?.length" class="env-item">
          <span class="env-icon">🔧</span>
          <span class="env-label">{{ envInfo.tools.length }} 工具</span>
        </span>
        <button class="env-detail-btn" @click="showEnvDetail = !showEnvDetail">
          {{ showEnvDetail ? '收起' : '详情' }}
        </button>
      </div>
      <!-- 浮动详情面板 -->
      <div v-if="showEnvDetail" class="env-detail-dropdown">
        <div class="env-detail-row">
          <span class="env-detail-label">工作目录</span>
          <span class="env-detail-value">{{ envInfo.cwd }}</span>
        </div>
        <div v-if="envInfo.model" class="env-detail-row">
          <span class="env-detail-label">模型</span>
          <span class="env-detail-value">{{ envInfo.model }}</span>
        </div>
        <div v-if="envInfo.session_id" class="env-detail-row">
          <span class="env-detail-label">会话 ID</span>
          <span class="env-detail-value">{{ envInfo.session_id }}</span>
        </div>
        <div v-if="envInfo.plugins?.length" class="env-detail-row">
          <span class="env-detail-label">插件</span>
          <span class="env-detail-value tools-list">{{ envInfo.plugins.join(', ') }}</span>
        </div>
        <div v-if="envInfo.mcp_servers?.length" class="env-detail-row">
          <span class="env-detail-label">MCP</span>
          <span class="env-detail-value tools-list">{{ envInfo.mcp_servers.join(', ') }}</span>
        </div>
        <div v-if="envInfo.skills?.length" class="env-detail-row">
          <span class="env-detail-label">技能</span>
          <span class="env-detail-value tools-list">{{ envInfo.skills.join(', ') }}</span>
        </div>
        <div v-if="envInfo.tools?.length" class="env-detail-row env-tools">
          <span class="env-detail-label">工具</span>
          <span class="env-detail-value tools-list">{{ envInfo.tools.join(', ') }}</span>
        </div>
      </div>
    </div>
    </div>
    <div class="messages" ref="messagesContainer" @scroll="handleUserScroll">
      <!-- 粘性头部 - 浮动在聊天内容上方 -->
      <div v-if="stickyMessage" class="sticky-header">
        <div class="sticky-content" :style="{ '--max-height': (containerHeight * 0.5) + 'px' }">
          <!-- 折叠状态：简单信息 -->
          <div class="sticky-collapsed">
            <div class="sticky-info">
              <span class="sticky-time">
                <span class="sticky-info-icon">🕐</span>
                {{ stickyMessage.timestamp ? new Date(stickyMessage.timestamp).toLocaleTimeString() : '' }}
              </span>
              <span v-if="stickyMessage.duration" class="sticky-duration">
                <span class="sticky-info-icon">⏳</span>
                {{ formatDuration(stickyMessage.duration) }}
              </span>
              <span v-else-if="isStickyMessageProcessing && stickyMessage.startTime" class="sticky-duration streaming">
                <span class="sticky-info-icon">⏳</span>
                {{ formatDuration(currentTime - stickyMessage.startTime) }}
              </span>
              <span v-if="stickyMessage.numTurns" class="sticky-turns">
                <span class="sticky-info-icon">🔄</span>
                {{ stickyMessage.numTurns }}
              </span>
              <span v-if="stickyMessage.usage && formatTokens(stickyMessage.usage)" class="sticky-usage">
                <span class="sticky-info-icon">⚡</span>
                {{ formatTokens(stickyMessage.usage) }}
              </span>
            </div>
            <div class="sticky-text">{{ stickyMessage.content }}</div>
          </div>
          <!-- 展开状态：Markdown 渲染 -->
          <div class="sticky-expanded">
            <div class="sticky-info">
              <span class="sticky-time">
                <span class="sticky-info-icon">🕐</span>
                {{ stickyMessage.timestamp ? new Date(stickyMessage.timestamp).toLocaleTimeString() : '' }}
              </span>
              <span v-if="stickyMessage.duration" class="sticky-duration">
                <span class="sticky-info-icon">⏳</span>
                {{ formatDuration(stickyMessage.duration) }}
              </span>
              <span v-else-if="isStickyMessageProcessing && stickyMessage.startTime" class="sticky-duration streaming">
                <span class="sticky-info-icon">⏳</span>
                {{ formatDuration(currentTime - stickyMessage.startTime) }}
              </span>
              <span v-if="stickyMessage.numTurns" class="sticky-turns">
                <span class="sticky-info-icon">🔄</span>
                {{ stickyMessage.numTurns }}
              </span>
              <span v-if="stickyMessage.usage && formatTokens(stickyMessage.usage)" class="sticky-usage">
                <span class="sticky-info-icon">⚡</span>
                {{ formatTokens(stickyMessage.usage) }}
              </span>
            </div>
            <div class="sticky-text-md">
              <button
                class="copy-btn bubble-copy-btn"
                @click.stop="copyStickyMessage"
                :title="stickyCopied ? '已复制' : '复制内容'"
              >
                <svg v-if="stickyCopied" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
              <MarkdownRenderer :content="stickyMessage.content" />
            </div>
          </div>
        </div>
      </div>
      <template v-for="(message, index) in messages" :key="index">
        <div
          class="message"
          :class="message.role"
          :data-index="index"
          :style="{ display: message.role !== 'user' && getResponseCollapseState(index).collapsed ? 'none' : '' }"
          @click="handleMessageClick($event, message)"
        >
        <!-- Tool use message -->
        <template v-if="message.role === 'tool_use'">
          <div class="message-avatar">T</div>
          <div class="tool-use-message-wrapper">
            <!-- Tool use 消息头部：时间、耗时 -->
            <div v-if="message.timestamp || message.duration" class="message-header tool-use-header">
              <span v-if="message.timestamp" class="header-time">
                <span class="header-icon">🕐</span>
                {{ new Date(message.timestamp).toLocaleTimeString() }}
              </span>
              <span v-if="message.duration" class="header-duration">
                <span class="header-icon">⏳</span>
                {{ formatDuration(message.duration) }}
              </span>
              <span v-else-if="message.isExecuting && message.startTime" class="header-duration streaming">
                <span class="header-icon">⏳</span>
                {{ formatDuration(currentTime - message.startTime) }}
              </span>
            </div>
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
              @toggle-collapse="() => handleToolToggleCollapse(message)"
            />
          </div>
        </template>
        <!-- Question message -->
        <template v-else-if="message.role === 'question'">
          <div class="message-avatar">Q</div>
          <div class="question-message-wrapper">
            <div
              class="question-message"
              :class="{ 'answer-mismatch': message.resultReceived && !message.answersConsistent }"
            >
          <!-- Header with collapse button -->
          <div class="question-message-header" @click="toggleQuestionCollapse(index)">
            <div class="question-title">
              <span class="question-icon">❓</span>
              <span class="question-count" v-if="message.questions && message.questions.length > 1">{{ message.questions.length }} 个问题</span>
              <span class="question-count" v-else>问答</span>
              <span v-if="message.resultReceived && message.answersConsistent" class="status-badge success">答案已确认</span>
              <span v-else-if="message.resultReceived && !message.answersConsistent" class="status-badge warning">答案不一致</span>
            </div>
            <div class="header-actions">
              <button class="copy-btn" @click.stop="copyQuestionContent(index)" :title="copiedMessageIndex === index ? '已复制' : '复制问答内容'">
                <svg v-if="copiedMessageIndex === index" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
              <span class="expand-icon">{{ isQuestionCollapsed(index) ? '▶' : '▼' }}</span>
            </div>
          </div>

          <!-- Collapsed view: show only answers -->
          <div v-if="isQuestionCollapsed(index)" class="collapsed-answers">
            <div
              v-for="(q, qIdx) in message.questions"
              :key="qIdx"
              class="collapsed-answer-item"
            >
              <span class="collapsed-question-label">{{ q.header }}:</span>
              <span class="collapsed-answer-content">{{ q.selectedAnswer || '未选择' }}</span>
            </div>
          </div>

          <!-- Expanded view: show full content -->
          <template v-else>
          <!-- Tab Headers (only show if multiple questions) -->
          <div v-if="message.questions && message.questions.length > 1" class="question-tab-headers">
            <button
              v-for="(q, qIdx) in message.questions"
              :key="qIdx"
              type="button"
              class="question-tab-button"
              :class="{ active: qIdx === getQuestionActiveTab(index) }"
              @click="switchQuestionTab(index, qIdx)"
            >
              <span class="tab-status">✓</span>
              <span class="tab-label">{{ q.header }}</span>
            </button>
          </div>

          <!-- Question content -->
          <div
            v-for="(q, qIndex) in message.questions"
            :key="qIndex"
            v-show="qIndex === getQuestionActiveTab(index)"
            class="question-content"
          >
            <div class="question-header">
              <span class="question-icon">❓</span>
              <span class="question-label">{{ q.header }}</span>
              <span v-if="q.multiSelect" class="multi-select-hint">(可多选)</span>
            </div>
            <div class="question-text">{{ q.question }}</div>
            <div class="question-options" v-if="q.options && q.options.length > 0">
              <div class="options-label">选项：</div>
              <div class="options-list">
                <div
                  v-for="(option, optIndex) in q.options"
                  :key="optIndex"
                  class="option-item"
                  :class="{
                    selected: isOptionSelected(q, option.label)
                  }"
                >
                  <span class="option-marker">
                    <template v-if="q.multiSelect">
                      {{ isOptionSelected(q, option.label) ? '☑' : '☐' }}
                    </template>
                    <template v-else>
                      {{ option.label === q.selectedAnswer ? '✓' : '○' }}
                    </template>
                  </span>
                  <div class="option-content">
                    <span class="option-text">{{ option.label }}</span>
                    <span v-if="option.description" class="option-description">{{ option.description }}</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          </template>

          <!-- Result status (only show expanded with mismatch) -->
          <div v-if="!isQuestionCollapsed(index) && message.resultReceived && !message.answersConsistent" class="answer-result">
            <div class="result-mismatch">
              <div class="mismatch-header">
                <span class="result-icon">⚠️</span>
                <span class="result-text">实际收到的答案：</span>
              </div>
              <div class="mismatch-answers">
                <div
                  v-for="(answer, questionText) in message.receivedAnswers"
                  :key="questionText"
                  class="mismatch-item"
                >
                  <span class="mismatch-question">{{ questionText }}</span>
                  <span class="mismatch-answer">{{ answer }}</span>
                </div>
              </div>
            </div>
          </div>
            </div>
          </div>
        </template>
        <!-- Unknown/unsupported message -->
        <template v-else-if="message.role === 'unknown'">
          <div class="message-avatar">?</div>
          <div class="message-content-wrapper">
            <div class="message-header">
              <span class="header-time">
                <span class="header-icon">🕐</span>
                {{ new Date(message.timestamp).toLocaleTimeString() }}
              </span>
            </div>
            <div class="message-text unknown-message">
              <button
                class="copy-btn bubble-copy-btn"
                @click.stop="copyMessageContent(index)"
                :title="copiedMessageIndex === index ? '已复制' : '复制内容'"
              >
                <svg v-if="copiedMessageIndex === index" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1 2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
              <div class="unknown-header">
                <span class="unknown-icon">⚠️</span>
                <span class="unknown-label">暂未支持的消息类型: {{ message.messageType }}</span>
              </div>
              <pre class="unknown-content">{{ message.content }}</pre>
            </div>
          </div>
        </template>
        <!-- Regular messages (user, assistant, status) -->
        <template v-else>
          <div class="message-avatar" v-if="message.role !== 'status'">
            {{ message.role === 'user' ? 'U' : message.role === 'assistant' ? 'C' : 'S' }}
          </div>
          <!-- User 消息特殊布局：头部在气泡外部 -->
          <template v-if="message.role === 'user'">
            <div class="message-user-container">
              <div class="message-header user-header">
                <span class="header-time">
                  <span class="header-icon">🕐</span>
                  {{ new Date(message.timestamp).toLocaleTimeString() }}
                </span>
                <span v-if="message.duration" class="header-duration">
                  <span class="header-icon">⏳</span>
                  {{ formatDuration(message.duration) }}
                </span>
                <span v-else-if="!message.duration && isLastUserMessage(index) && message.startTime" class="header-duration streaming">
                  <span class="header-icon">⏳</span>
                  {{ formatDuration(currentTime - message.startTime) }}
                </span>
                <span v-if="message.numTurns" class="header-turns">
                  <span class="header-icon">🔄</span>
                  {{ message.numTurns }} turns
                </span>
                <span v-if="message.usage && formatTokens(message.usage)" class="header-tokens">
                  <span class="header-icon">⚡</span>
                  {{ formatTokens(message.usage) }}
                </span>
                <!-- 回答折叠/展开按钮 -->
                <button
                  v-if="message.responseCollapsed !== undefined"
                  class="response-toggle-btn"
                  @click.stop="toggleResponseCollapse(index)"
                  :title="message.responseCollapsed ? '展开回答' : '折叠回答'"
                >
                  {{ message.responseCollapsed ? '▶ 展开回答' : '▼ 折叠回答' }}
                </button>
              </div>
              <div class="message-content user-content">
                <div class="message-text">
                  <!-- 复制按钮 -->
                  <button
                    class="copy-btn bubble-copy-btn"
                    @click.stop="copyMessageContent(index)"
                    :title="copiedMessageIndex === index ? '已复制' : '复制内容'"
                  >
                    <svg v-if="copiedMessageIndex === index" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="20 6 9 17 4 12"></polyline>
                    </svg>
                    <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                    </svg>
                  </button>
                  {{ message.content }}
                </div>
              </div>
            </div>
          </template>
          <!-- Assistant 和其他消息保持原布局 -->
          <div v-else class="message-content" :class="{ 'status-content': message.role === 'status' }">
            <!-- Assistant 消息头部：状态、时间、消耗 -->
            <div v-if="message.role === 'assistant'" class="message-header">
              <span v-if="message.isStreaming" class="header-status streaming">
                <span class="loading-spinner"></span>
              </span>
              <span class="header-time">
                <span class="header-icon">🕐</span>
                {{ new Date(message.timestamp).toLocaleTimeString() }}
              </span>
              <span v-if="message.duration" class="header-duration">
                <span class="header-icon">⏳</span>
                {{ formatDuration(message.duration) }}
              </span>
              <span v-else-if="message.isStreaming" class="header-duration streaming">
                <span class="header-icon">⏳</span>
                {{ formatDuration(currentTime - message.startTime) }}
              </span>
              <span v-if="message.usage && formatTokens(message.usage)" class="header-tokens">
                <span class="header-icon">⚡</span>
                {{ formatTokens(message.usage) }}
              </span>
            </div>
            <!-- Turn 分割线 - 当有多个 turn 时显示 -->
            <div v-if="message.role === 'assistant' && message.showTurnSeparator" class="turn-separator">
              <div class="turn-separator-line"></div>
              <span class="turn-separator-label">Turn {{ message.turnNumber || 2 }}</span>
              <div class="turn-separator-line"></div>
            </div>
            <!-- Thinking section - 显示在内容上方，可折叠 -->
            <div
              v-if="message.role === 'assistant' && message.hasThinking && message.thinking"
              class="thinking-section"
              :class="{ 'thinking-collapsed': message.thinkingCollapsed }"
            >
              <div class="thinking-header-inline" @click="message.thinkingCollapsed = !message.thinkingCollapsed">
                <span class="thinking-icon">💭</span>
                <span class="thinking-label">思考过程</span>
                <span v-if="message.thinkingCollapsed" class="thinking-preview">{{ message.thinking.substring(0, 50) }}...</span>
                <span class="thinking-toggle">{{ message.thinkingCollapsed ? '▶' : '▼' }}</span>
              </div>
              <div v-if="!message.thinkingCollapsed" class="thinking-content-inline">{{ message.thinking }}</div>
            </div>
            <!-- 消息内容 - 只在有内容时显示 -->
            <div
              v-if="message.content"
              class="message-text"
              :class="{ 'status-text': message.role === 'status' }"
            >
              <!-- 复制按钮 (assistant 内容右上角) -->
              <button
                v-if="message.role === 'assistant'"
                class="copy-btn bubble-copy-btn"
                @click.stop="copyMessageContent(index)"
                :title="copiedMessageIndex === index ? '已复制' : '复制内容'"
              >
                <svg v-if="copiedMessageIndex === index" xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
              <MarkdownRenderer v-if="message.role === 'assistant'" :content="message.content" />
              <div v-else>{{ message.content }}</div>
            </div>
            <div class="message-time" v-if="message.role !== 'status' && message.role !== 'assistant' && message.role !== 'user'">
              {{ new Date(message.timestamp).toLocaleTimeString() }}
            </div>
          </div>
        </template>
      </div>
      <!-- 折叠的回答占位符 - 显示在用户消息后面 -->
      <div
        v-if="message.role === 'user' && message.responseCollapsed"
        class="collapsed-response-placeholder"
        @click="toggleResponseCollapse(index)"
      >
        <span class="collapsed-icon">▶</span>
        <span class="collapsed-text">回答已折叠，点击展开</span>
      </div>
      </template>
    </div>
    <div class="input-area">
      <!-- 历史记录选择弹窗 -->
      <div v-if="showHistoryPicker" class="history-picker">
        <div class="history-picker-header">
          <span>历史记录</span>
          <button class="history-picker-close" @click="closeHistoryPicker">×</button>
        </div>
        <div class="history-picker-list">
          <div
            v-for="(item, idx) in [...inputHistory].reverse()"
            :key="idx"
            class="history-picker-item"
            @click="selectHistory(item)"
          >
            {{ item }}
          </div>
        </div>
      </div>
      <textarea
        ref="inputArea"
        v-model="inputMessage"
        @keydown.enter="handleEnterKey"
        @keydown.up="handleHistoryKey"
        @keydown.down="handleHistoryKey"
        @keydown="openHistoryPicker"
        @input="handleInputChange"
        @dragover.prevent
        @dragenter="handleDragEnter"
        @dragleave="handleDragLeave"
        @drop="handleFileDrop"
        :class="{ 'drag-over': isDragOver }"
        placeholder="输入消息... (Enter 发送, Shift+Enter 换行，可拖拽文件)"
        rows="3"
        :disabled="isProcessing || pendingPermission !== null || pendingControlRequest !== null"
      />
      <button
        v-if="!isProcessing"
        @click="sendMessage"
        :disabled="!inputMessage.trim() || isProcessing || pendingPermission !== null || pendingControlRequest !== null"
        class="send-button"
      >
        发送
      </button>
      <button
        v-else
        @click="handleInterrupt"
        class="interrupt-button"
        title="打断"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <rect x="6" y="6" width="12" height="12" rx="2"></rect>
        </svg>
      </button>
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
  padding-left: 52px;
}

/* Expand Button in Top Bar */
.expand-btn-top {
  width: 44px;
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
  margin-left: -52px; /* 负边距使其回到红绿灯区域 */
}

.expand-btn-top:hover {
  background: #27272A;
  color: #A1A1AA;
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
}

.env-detail-value.tools-list {
  line-height: 1.6;
}

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
}

.sticky-info-icon {
  font-size: 10px;
}

/* 折叠时的文本：单行截断 */
.sticky-text {
  font-size: 13px;
  color: #F1F5F9;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 300px;
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

.messages {
  flex: 1;
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
  cursor: pointer;
  transition: opacity 0.15s;
}

.message:hover {
  opacity: 0.85;
}

.message:active {
  opacity: 0.75;
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

/* Tool use 消息头部样式 - 在气泡外面 */
.message-header.tool-use-header {
  padding: 0 0 6px 0;
  margin-bottom: 8px;
  border-bottom: 1px solid #27272A;
  font-size: 11px;
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

/* 用户消息头部样式 */
.message-header.user-header {
  padding: 0 0 8px 0;
  margin-bottom: 8px;
  border-bottom: 1px solid #27272A;
  flex-wrap: wrap;
}

.header-turns {
  font-size: 11px;
  color: #71717A;
  background: #27272A;
  padding: 2px 6px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.header-tokens {
  font-size: 11px;
  color: #71717A;
  background: #27272A;
  padding: 2px 6px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

/* 回答折叠/展开按钮 */
.response-toggle-btn {
  font-size: 11px;
  color: #71717A;
  background: transparent;
  border: 1px solid #3F3F46;
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  margin-left: 8px;
}

.response-toggle-btn:hover {
  background: #27272A;
  color: #A1A1AA;
  border-color: #52525B;
}

/* 复制按钮 */
.copy-btn {
  font-size: 12px;
  color: #71717A;
  background: transparent;
  border: none;
  padding: 2px 6px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  margin-left: 8px;
  opacity: 0.6;
  -webkit-app-region: no-drag;
}

.copy-btn:hover {
  background: #27272A;
  color: #A1A1AA;
  opacity: 1;
}

.copy-btn:active {
  transform: scale(0.95);
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

.message-text:hover .bubble-copy-btn,
.sticky-text-md:hover .bubble-copy-btn {
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
  align-items: flex-end;
  max-width: 70%;
}

/* 用户消息气泡：宽度适配内容 */
.message-content.user-content {
  width: fit-content;
  max-width: 100%;
}

/* 用户消息头部：右对齐 */
.message-header.user-header {
  justify-content: flex-end;
  padding: 0 0 6px 0;
  margin-bottom: 6px;
}

.question-message-wrapper {
  flex: 1;
  max-width: 70%;
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

/* Thinking section within assistant message - 低调但可读 */
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

.thinking-section {
  background: #18181B;
  border: 1px solid #27272A;
  border-left: 3px solid #6366F1;
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 10px;
  cursor: pointer;
  user-select: none;
  transition: all 0.2s ease;
}

.thinking-section:hover {
  background: #1F1F23;
  border-color: #3F3F46;
  border-left-color: #818CF8;
}

.thinking-header-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 0;
}

.thinking-toggle {
  font-size: 10px;
  color: #71717A;
  transition: transform 0.2s ease;
  margin-left: auto;
}

.thinking-preview {
  flex: 1;
  font-size: 11px;
  color: #71717A;
  font-style: italic;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.thinking-content-inline {
  font-size: 12px;
  color: #A1A1AA;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  max-height: 250px;
  overflow-y: auto;
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid #27272A;
}

/* Thinking scrollbar */
.thinking-content-inline::-webkit-scrollbar {
  width: 3px;
}

.thinking-content-inline::-webkit-scrollbar-track {
  background: transparent;
}

.thinking-content-inline::-webkit-scrollbar-thumb {
  background: #3F3F46;
  border-radius: 2px;
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

.input-area {
  position: relative;
  padding: 20px;
  border-top: 1px solid #3F3F46;
  display: flex;
  gap: 12px;
  -webkit-app-region: no-drag;
}

.input-area textarea {
  flex: 1;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  padding: 12px;
  color: #E4E4E7;
  font-size: 14px;
  resize: none;
  font-family: inherit;
}

.input-area textarea:focus {
  outline: none;
  border-color: #F97316;
}

.input-area textarea:disabled {
  opacity: 0.5;
}

.input-area textarea.drag-over {
  border-color: #F97316;
  background: rgba(249, 115, 22, 0.1);
  box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.2);
}

.send-button {
  padding: 12px 24px;
  background: #F97316;
  border: none;
  border-radius: 8px;
  color: white;
  font-weight: bold;
  cursor: pointer;
  align-self: flex-end;
  -webkit-app-region: no-drag;
}

.send-button:hover:not(:disabled) {
  background: #EA580C;
}

.send-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.interrupt-button {
  padding: 12px 24px;
  background: #F97316;
  border: none;
  border-radius: 8px;
  color: white;
  font-weight: bold;
  cursor: pointer;
  align-self: flex-end;
  transition: background 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
  -webkit-app-region: no-drag;
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

/* Question message styles */
.question-message {
  background: linear-gradient(135deg, #1E2A1E 0%, #18181B 100%);
  border: 1px solid #10B981;
  border-left: 3px solid #10B981;
  border-radius: 8px;
  padding: 12px 16px;
  margin: 8px 0;
  width: 100%;
}

.question-message.answer-mismatch {
  background: linear-gradient(135deg, #2E1E1E 0%, #18181B 100%);
  border-color: #EF4444;
  border-left-color: #EF4444;
}

/* Question message header */
.question-message-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid #3F3F46;
}

.question-message-header .header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.question-message-header .copy-btn {
  font-size: 12px;
  color: #71717A;
  background: transparent;
  border: none;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.question-message-header:hover .copy-btn {
  opacity: 0.6;
}

.question-message-header .copy-btn:hover {
  background: #27272A;
  color: #A1A1AA;
  opacity: 1 !important;
}

.question-message-header .header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.question-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.question-count {
  font-size: 13px;
  font-weight: 600;
  color: #6EE7B7;
}

/* Status badge in question title */
.question-title .status-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}

.question-title .status-badge.success {
  background: #065F46;
  color: #6EE7B7;
}

.question-title .status-badge.warning {
  background: #713F12;
  color: #FCD34D;
}

.question-message-header .expand-icon {
  font-size: 10px;
  color: #71717A;
  cursor: pointer;
  transition: color 0.15s;
}

.question-message-header .expand-icon:hover {
  color: #A1A1AA;
}

/* Collapsed answers */
.collapsed-answers {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 6px 0;
  flex-wrap: wrap;
}

.collapsed-answer-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: rgba(59, 130, 246, 0.06);
  border-radius: 4px;
  border: 1px solid rgba(59, 130, 246, 0.12);
}

.collapsed-question-label {
  font-size: 11px;
  color: #6EE7B7;
  font-weight: 600;
}

.collapsed-answer-content {
  font-size: 12px;
  color: #F1F5F9;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  font-weight: 500;
}

.collapsed-answer-separator {
  margin: 0 4px;
}

/* Answer result styles */
.answer-result {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #3F3F46;
}

.result-consistent {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #10B981;
  font-size: 12px;
}

.result-mismatch {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.mismatch-header {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #F87171;
  font-size: 12px;
  font-weight: 500;
}

.mismatch-answers {
  background: rgba(239, 68, 68, 0.1);
  border-radius: 6px;
  padding: 10px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.mismatch-item {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.mismatch-question {
  font-size: 11px;
  color: #A1A1AA;
}

.mismatch-answer {
  font-size: 12px;
  color: #FCA5A5;
  font-weight: 500;
}

.result-icon {
  font-size: 12px;
}

.result-text {
  font-weight: 500;
}

/* Question Tab Headers */
.question-tab-headers {
  display: flex;
  gap: 6px;
  flex-wrap: wrap;
  margin-bottom: 12px;
  padding-bottom: 10px;
  border-bottom: 1px solid #3F3F46;
}

.question-tab-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #6EE7B7;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.question-tab-button:hover {
  background: rgba(110, 231, 183, 0.1);
  border-color: rgba(110, 231, 183, 0.3);
}

.question-tab-button.active {
  background: #10B981;
  color: white;
  border-color: #10B981;
}

.question-tab-button .tab-status {
  font-size: 11px;
}

.question-tab-button .tab-label {
  font-weight: 500;
}

.question-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.question-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.question-icon {
  font-size: 14px;
}

.question-label {
  font-size: 12px;
  font-weight: 600;
  color: #6EE7B7;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.multi-select-hint {
  font-size: 11px;
  color: #FB923C;
  font-weight: normal;
  text-transform: none;
}

.question-text {
  font-size: 13px;
  color: #E4E4E7;
  line-height: 1.6;
  margin-bottom: 12px;
  padding: 10px 12px;
  background: #18181B;
  border-radius: 6px;
}

.question-options {
  margin-bottom: 12px;
}

.options-label {
  font-size: 11px;
  color: #71717A;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.options-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.option-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  background: #18181B;
  border-radius: 6px;
  border: 1px solid #27272A;
  transition: all 0.15s ease;
}

.option-item.selected {
  background: #065F46;
  border-color: #10B981;
}

.option-marker {
  font-size: 12px;
  color: #71717A;
  flex-shrink: 0;
}

.option-item.selected .option-marker {
  color: #6EE7B7;
}

.option-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.option-text {
  font-size: 13px;
  color: #A1A1AA;
  flex-shrink: 0;
  font-weight: 500;
  line-height: 1.5;
}

.option-item.selected .option-text {
  color: #E4E4E7;
}

.option-description {
  font-size: 12px;
  color: #71717A;
  line-height: 1.4;
}

.option-item.selected .option-description {
  color: #A1A1AA;
}

/* Question Result Section */
.question-result-section {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid #3F3F46;
}

.result-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  transition: all 0.15s ease;
}

.result-status:hover {
  opacity: 0.8;
}

.result-status.success {
  background: #065F46;
  color: #6EE7B7;
}

.result-status.error {
  background: #7F1D1D;
  color: #FCA5A5;
}

.result-status.mismatch {
  background: #78350F;
  color: #FCD34D;
}

.status-icon {
  font-size: 11px;
}

.status-text {
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.expand-arrow {
  font-size: 9px;
  margin-left: 4px;
  opacity: 0.7;
}

.result-detail {
  margin-top: 10px;
  background: #18181B;
  border-radius: 6px;
  padding: 10px 12px;
}

.detail-label {
  font-size: 11px;
  color: #A1A1AA;
  margin-bottom: 8px;
  font-weight: 500;
}

.detail-item {
  padding: 6px 0;
  border-bottom: 1px solid #27272A;
}

.detail-item:last-child {
  border-bottom: none;
}

.detail-item.match .detail-header {
  color: #71717A;
}

.detail-item.mismatch .detail-header {
  color: #FCA5A5;
}

.detail-header {
  font-size: 11px;
  color: #71717A;
  display: block;
  margin-bottom: 4px;
}

.detail-values {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-user {
  font-size: 12px;
  color: #6EE7B7;
}

.detail-item.mismatch .detail-user {
  color: #FCA5A5;
}

.detail-claude {
  font-size: 12px;
  color: #93C5FD;
}

.detail-item.match .detail-claude {
  color: #6EE7B7;
}

.detail-item.mismatch .detail-claude {
  color: #FCD34D;
}

/* Unknown message styles */
.unknown-message {
  background: linear-gradient(135deg, #2D1F1F 0%, #1F1F1F 100%);
  border: 1px solid #EF4444;
  border-left: 3px solid #EF4444;
  border-radius: 8px;
  padding: 12px 16px;
  margin: 8px 0;
  width: 100%;
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
  font-size: 12px;
  font-weight: 600;
  color: #FCA5A5;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.unknown-content {
  font-size: 11px;
  color: #D4D4D4;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  background: #18181B;
  padding: 8px 12px;
  border-radius: 6px;
  margin: 0;
  max-height: 300px;
  overflow: auto;
}
</style>
