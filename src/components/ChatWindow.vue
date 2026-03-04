<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import MarkdownRenderer from './MarkdownRenderer.vue'
import PermissionDialog from './PermissionDialog.vue'
import AskUserQuestionDialog from './AskUserQuestionDialog.vue'
import ToolUseMessage from './ToolUseMessage.vue'

const messages = ref([])
const inputMessage = ref('')
const isProcessing = ref(false)
const messagesContainer = ref(null)
const pendingPermission = ref(null)
const pendingQuestion = ref(null)
const pendingControlRequest = ref(null)
const isDragOver = ref(false)
const questionActiveTabs = ref({}) // 存储每条问答消息的 active tab
const workingDirectory = ref('') // 工作目录
let previousMessageCount = 0 // 追踪之前的消息数量

// Store unsubscribe functions
let unsubscribers = []

onMounted(async () => {
  // Get working directory
  try {
    const info = await window.electronAPI.getClaudeInfo()
    workingDirectory.value = info.workingDirectory || ''
    console.log('Working directory:', workingDirectory.value)
  } catch (error) {
    console.error('Failed to get working directory:', error)
  }

  // Listen to Claude messages
  const unsubs = []

  const msgUnsub = window.electronAPI.onClaudeMessage((message) => {
    // 打印原始消息
    console.log('⬅️ IN [MESSAGE]:', message.type, message.message?.role || '', message)

    // 如果正在使用流式事件，跳过 onClaudeMessage 处理（避免重复）
    if (isUsingStreamEvents) {
      console.log('  ↳ 跳过（正在使用流式事件）')
      return
    }

    // 处理非流式消息
    if (message.message && message.message.content) {
      // 处理文本内容
      const textContent = message.message.content.find(c => c.type === 'text')
      if (textContent) {
        messages.value.push({
          role: 'assistant',
          content: textContent.text,
          timestamp: new Date()
        })
        scrollToBottom()
      }

      // 也处理 tool_use 内容（但排除 AskUserQuestion，它由 control_request 处理）
      const toolUseContent = message.message.content.find(c => c.type === 'tool_use')
      if (toolUseContent && toolUseContent.name !== 'AskUserQuestion') {
        const toolUseId = toolUseContent.id

        // 检查是否已经显示过这个 tool_use（避免与 control_request 重复）
        const existingMsg = messages.value.find(m => m.role === 'tool_use' && m.request_id === toolUseId)
        if (!existingMsg) {
          // 添加工具使用消息
          messages.value.push({
            role: 'tool_use',
            toolName: toolUseContent.name,
            toolInput: toolUseContent.input,
            result: '',
            isError: false,
            isExecuting: true,
            request_id: toolUseId,
            collapsed: false,
            timestamp: new Date()
          })
          scrollToBottom()
        }
      }
    }
  })
  unsubs.push(msgUnsub)

  const resultUnsub = window.electronAPI.onClaudeResult((message) => {
    isProcessing.value = false
    scrollToBottom()
  })
  unsubs.push(resultUnsub)

  const systemUnsub = window.electronAPI.onSystemMessage((message) => {
    // 打印系统消息
    console.log('⬅️ IN [SYSTEM]:', message.subtype || message.type || '', message)
  })
  unsubs.push(systemUnsub)

  const toolUnsub = window.electronAPI.onToolUse((message) => {
    // 打印 tool_use 消息
    const toolName = message.message?.content?.find(c => c.type === 'tool_use')?.name || 'unknown'
    console.log('⬅️ IN [TOOL_USE]:', toolName, message)

    // 显示工具使用消息
    if (message.message && message.message.content) {
      const toolUseContent = message.message.content.find(c => c.type === 'tool_use')
      if (toolUseContent) {
        const toolUseId = toolUseContent.id

        // AskUserQuestion 由 control_request 处理，不在这里创建消息
        if (toolUseContent.name === 'AskUserQuestion') {
          console.log('  ↳ 跳过（AskUserQuestion 由 control_request 处理）')
          return
        }

        // 检查是否已经显示过这个 tool_use（避免与 control_request 重复）
        const existingMsg = messages.value.find(m => m.role === 'tool_use' && m.request_id === toolUseId)
        if (existingMsg) {
          console.log('  ↳ 跳过（已通过 control_request 显示）')
          return
        }

        // 添加工具使用消息
        messages.value.push({
          role: 'tool_use',
          toolName: toolUseContent.name,
          toolInput: toolUseContent.input,
          result: '',
          isError: false,
          isExecuting: true,
          request_id: toolUseId,
          timestamp: new Date()
        })
        scrollToBottom()
      }
    }
  })
  unsubs.push(toolUnsub)

  const toolResultUnsub = window.electronAPI.onToolResult((message) => {
    // 打印 tool_result 消息
    const hasAnswers = !!message.tool_use_result?.answers
    console.log('⬅️ IN [TOOL_RESULT]:', hasAnswers ? 'AskUserQuestion' : 'tool_result', message)

    // Display tool result and reset processing state
    isProcessing.value = false

    // 检查是否是 AskUserQuestion 的结果
    if (message.tool_use_result?.answers) {
      // tool_use_id 在 message.message.content 中
      const toolResultContent = message.message?.content?.find(c => c.type === 'tool_result')
      const toolUseId = toolResultContent?.tool_use_id || message.uuid
      const receivedAnswers = message.tool_use_result.answers

      console.log('AskUserQuestion result:', { toolUseId, receivedAnswers })

      // 找到对应的问答消息
      const questionMsg = messages.value.find(m => m.role === 'question' && m.tool_use_id === toolUseId)
      if (questionMsg) {
        // 比较答案
        const userAnswers = questionMsg.userAnswers || {}
        const isConsistent = compareAnswers(userAnswers, receivedAnswers)

        console.log('Question message found:', { userAnswers, isConsistent })

        questionMsg.resultReceived = true
        questionMsg.answersConsistent = isConsistent
        questionMsg.receivedAnswers = receivedAnswers
      } else {
        console.log('Question message not found for tool_use_id:', toolUseId)
      }
      scrollToBottom()
      return
    }

    if (message.message && message.message.content) {
      const toolResultContent = message.message.content.find(c => c.type === 'tool_result')
      if (toolResultContent) {
        const isError = toolResultContent.is_error
        const content = toolResultContent.content || ''
        const toolUseId = toolResultContent.tool_use_id

        // 找到对应的 tool_use 消息并更新结果
        const toolUseMsg = messages.value.find(m => m.role === 'tool_use' && m.request_id === toolUseId)
        if (toolUseMsg) {
          toolUseMsg.isExecuting = false
          toolUseMsg.isError = isError
          toolUseMsg.result = content || '(无输出)'
        } else {
          // 如果没有找到对应的 tool_use 消息，添加为系统消息
          messages.value.push({
            role: 'status',
            content: isError
              ? `❌ ${toolUseId} 失败: ${content}`
              : `✅ ${toolUseId} 完成: ${content || '(无输出)'}`,
            timestamp: new Date()
          })
        }
        scrollToBottom()
      }
    }
  })
  unsubs.push(toolResultUnsub)

  // Listen for tool_use requests (permission dialog or question dialog)
  const toolUseRequestUnsub = window.electronAPI.onToolUseRequest((message) => {
    // 打印 tool_use_request 消息
    const toolName = message.message?.content?.find(c => c.type === 'tool_use')?.name || 'unknown'
    console.log('⬅️ IN [TOOL_USE_REQUEST]:', toolName, message)

    if (message.message && message.message.content) {
      const toolUseContent = message.message.content.find(c => c.type === 'tool_use')
      if (toolUseContent) {
        if (toolUseContent.name === 'AskUserQuestion') {
          // Show question dialog for AskUserQuestion
          pendingQuestion.value = {
            request_id: toolUseContent.id,
            tool_use_id: toolUseContent.id, // 存储 tool_use_id 以便关联 tool_result
            tool_name: toolUseContent.name,
            tool_input: toolUseContent.input
          }
        } else {
          // Show permission dialog for regular tools
          pendingPermission.value = {
            request_id: toolUseContent.id,
            tool_name: toolUseContent.name,
            tool_input: toolUseContent.input
          }
        }
      }
    }
  })
  unsubs.push(toolUseRequestUnsub)

  // Listen for control_request (for --permission-prompt-tool stdio)
  const controlRequestUnsub = window.electronAPI.onControlRequest((message) => {
    // 打印原始 control_request
    console.log('⬅️ IN [CONTROL_REQUEST]:', message.request?.subtype || '', message.request?.tool_name || '', message)
    if (message.request && message.request.subtype === 'can_use_tool') {
      // Check if this is an AskUserQuestion request
      if (message.request.tool_name === 'AskUserQuestion') {
        // Show question dialog for AskUserQuestion
        pendingQuestion.value = {
          request_id: message.request_id,
          tool_use_id: message.request.tool_use_id, // 存储 tool_use_id 以便关联 tool_result
          tool_name: message.request.tool_name,
          tool_input: message.request.input
        }
      } else {
        // Clear any pending permission (control_request takes precedence)
        pendingPermission.value = null

        // 只有当 tool_use_id 存在时才创建 tool_use 消息
        // 这样可以确保 request_id 与 onToolUse 中使用的 toolUseContent.id 一致
        // 如果 tool_use_id 不存在，让 onToolUse 来创建消息
        if (message.request.tool_use_id) {
          // 检查是否已经存在相同的消息（避免重复）
          const existingMsg = messages.value.find(m => m.role === 'tool_use' && m.request_id === message.request.tool_use_id)
          if (!existingMsg) {
            // Add tool use message to chat (显示工具使用，等待权限确认)
            messages.value.push({
              role: 'tool_use',
              toolName: message.request.tool_name,
              toolInput: message.request.input,
              result: '',
              isError: false,
              isExecuting: true,
              request_id: message.request.tool_use_id,
              collapsed: false,
              timestamp: new Date()
            })
            scrollToBottom()
          }
        }

        // Show permission dialog for control_request
        pendingControlRequest.value = {
          request_id: message.request_id,
          tool_name: message.request.tool_name,
          tool_input: message.request.input,
          permission_suggestions: message.request.permission_suggestions,
          tool_use_id: message.request.tool_use_id
        }
      }
    }
  })
  unsubs.push(controlRequestUnsub)

  // Listen for CLI status messages (connection status, retries, errors)
  const cliStatusUnsub = window.electronAPI.onCliStatus((message) => {
    // 打印 CLI 状态消息
    console.log('⬅️ IN [CLI_STATUS]:', message.subtype || message.type || '', message)

    // 显示状态消息
    if (message.message) {
      messages.value.push({
        role: 'status',
        content: message.message,
        timestamp: new Date()
      })
      scrollToBottom()
    }
  })
  unsubs.push(cliStatusUnsub)

  // Listen for stream events (thinking_delta, text_delta, etc.)
  let currentAssistantMessage = null
  let currentThinkingMessage = null
  let isUsingStreamEvents = false // 标记是否使用了流式事件

  const streamEventUnsub = window.electronAPI.onStreamEvent((message) => {
    // 打印所有 stream events 到 console
    const event = message.event
    console.log('⬅️ IN [STREAM_EVENT]:', event?.type || 'unknown', message)

    if (!event) return

    // 标记正在使用流式事件
    isUsingStreamEvents = true

    // Handle message_start - reset current message tracking
    if (event.type === 'message_start') {
      currentAssistantMessage = null
      currentThinkingMessage = null
      return
    }

    // Handle content_block_start
    if (event.type === 'content_block_start') {
      const contentBlock = event.content_block
      if (contentBlock?.type === 'thinking') {
        // Start a new thinking message
        currentThinkingMessage = {
          role: 'thinking',
          content: '',
          timestamp: new Date()
        }
        messages.value.push(currentThinkingMessage)
        scrollToBottom()
      } else if (contentBlock?.type === 'text') {
        // Start a new assistant text message
        currentAssistantMessage = {
          role: 'assistant',
          content: '',
          timestamp: new Date()
        }
        messages.value.push(currentAssistantMessage)
        scrollToBottom()
      }
      return
    }

    // Handle content_block_delta
    if (event.type === 'content_block_delta') {
      const delta = event.delta

      // Handle thinking_delta
      if (delta?.type === 'thinking_delta' && delta.thinking) {
        if (currentThinkingMessage) {
          currentThinkingMessage.content += delta.thinking
          scrollToBottom()
        }
      }

      // Handle text_delta
      if (delta?.type === 'text_delta' && delta.text) {
        if (currentAssistantMessage) {
          currentAssistantMessage.content += delta.text
          scrollToBottom()
        }
      }
      return
    }

    // Handle content_block_stop
    if (event.type === 'content_block_stop') {
      // Finalize the current block
      return
    }

    // Handle message_stop
    if (event.type === 'message_stop') {
      currentAssistantMessage = null
      currentThinkingMessage = null
      isProcessing.value = false
      isUsingStreamEvents = false // 重置流式事件标志
      return
    }
  })
  unsubs.push(streamEventUnsub)

  // Listen for unknown/unsupported message types
  const unknownMessageUnsub = window.electronAPI.onUnknownMessage((message) => {
    console.log('⬅️ IN [UNKNOWN MESSAGE]:', message.type || 'unknown', message)

    // 在界面中显示未知消息
    messages.value.push({
      role: 'unknown',
      messageType: message.type,
      content: JSON.stringify(message, null, 2),
      timestamp: new Date()
    })
    scrollToBottom()
  })
  unsubs.push(unknownMessageUnsub)

  unsubscribers = unsubs
})

onUnmounted(() => {
  // Clean up listeners
  unsubscribers.forEach(unsub => {
    if (typeof unsub === 'function') {
      unsub()
    }
  })
})

// 监听消息变化，当有新消息时自动折叠之前已完成的消息
watch(() => messages.value, async (newMessages) => {
  const newLength = newMessages?.length || 0
  console.log('[watch] 消息数量变化:', previousMessageCount, '->', newLength)

  if (newLength > previousMessageCount && newLength > 1) {
    console.log('[watch] 有新消息添加，准备自动折叠')
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
        console.log('[watch] 跳过手动展开的消息')
        return
      }

      // 折叠已完成的 tool_use 消息
      if (message.role === 'tool_use' && message.result && !message.isError && !message.isExecuting) {
        console.log('[watch] 折叠 tool_use:', message.toolName)
        message.collapsed = true
        collapsedCount++
      }

      // 折叠已完成的 question 消息
      if (message.role === 'question' && message.resultReceived) {
        console.log('[watch] 折叠 question')
        message.collapsed = true
        collapsedCount++
      }
    })

    console.log('[watch] 折叠了', collapsedCount, '条已完成消息')
  }
  previousMessageCount = newLength
}, { deep: true })

async function sendMessage() {
  if (!inputMessage.value.trim() || isProcessing.value) return

  const userText = inputMessage.value
  messages.value.push({
    role: 'user',
    content: userText,
    timestamp: new Date()
  })

  inputMessage.value = ''
  isProcessing.value = true
  scrollToBottom(true) // 用户发送消息时强制滚动

  // Send to Claude
  const userMessage = {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: userText }]
    }
  }
  // 打印原始发送消息
  console.log('➡️ OUT [SEND_MESSAGE]:', 'user', userMessage)

  try {
    await window.electronAPI.sendMessage(userMessage)
  } catch (error) {
    console.error('Failed to send message:', error)
    isProcessing.value = false
    messages.value.push({
      role: 'system',
      content: `Error: ${error.message}`,
      timestamp: new Date()
    })
  }
}

function scrollToBottom(forceScroll = false) {
  nextTick(() => {
    if (!messagesContainer.value) return

    // 如果不强制滚动，检查当前是否接近底部
    if (!forceScroll) {
      const container = messagesContainer.value
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 50

      if (!isNearBottom) {
        console.log('[scrollToBottom] 滚动条不在底部，不自动滚动')
        return
      }
    }

    messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
  })
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

  pendingPermission.value = null
  pendingControlRequest.value = null

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
      if (controlRequest.tool_input) {
        options.updatedInput = JSON.parse(JSON.stringify(controlRequest.tool_input))
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
      console.log('➡️ OUT [CONTROL_RESPONSE]:', responseMessage.response?.subtype || '', responseMessage)

      await window.electronAPI.sendControlResponse(requestId, true, options)
    } else {
      // Regular tool_use permission
      const responseMessage = {
        type: 'tool_result',
        tool_use_id: requestId,
        content: '',
        is_error: false
      }
      console.log('➡️ OUT [CONTROL_RESPONSE]:', responseMessage.response?.subtype || '', responseMessage)

      await window.electronAPI.sendToolResult(requestId, '', false)
    }
  } catch (error) {
    console.error('Failed to send approval:', error)
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

  pendingPermission.value = null
  pendingControlRequest.value = null

  // 找到对应的 tool_use 消息并更新状态
  // 对于 control_request，消息使用 tool_use_id 作为 request_id
  const searchId = controlRequest?.tool_use_id || requestId
  const toolUseMsg = messages.value.find(m => m.role === 'tool_use' && m.request_id === searchId)
  if (toolUseMsg) {
    toolUseMsg.isExecuting = false
    toolUseMsg.isError = true
    toolUseMsg.result = '用户拒绝'
  }

  try {
    // Check if this is a control_request (for --permission-prompt-tool stdio)
    if (controlRequest && controlRequest.request_id === requestId) {
      const options = {
        reason: 'Permission denied by user'
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
      console.log('➡️ OUT [CONTROL_RESPONSE]:', responseMessage.response?.subtype || '', responseMessage)

      await window.electronAPI.sendControlResponse(requestId, false, options)
    } else {
      // Regular tool_use permission
      const responseMessage = {
        type: 'tool_result',
        tool_use_id: requestId,
        content: 'Permission denied by user',
        is_error: true
      }
      console.log('➡️ OUT [CONTROL_RESPONSE]:', responseMessage.response?.subtype || '', responseMessage)

      await window.electronAPI.sendToolResult(requestId, 'Permission denied by user', true)
    }
  } catch (error) {
    console.error('Failed to send denial:', error)
    if (toolUseMsg) {
      toolUseMsg.result = `发送拒绝响应失败: ${error.message}`
    }
  }
}

async function handlePermissionApproveAll(requestId) {
  const permission = pendingPermission.value
  const controlRequest = pendingControlRequest.value

  pendingPermission.value = null
  pendingControlRequest.value = null

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
      if (controlRequest.tool_input) {
        options.updatedInput = JSON.parse(JSON.stringify(controlRequest.tool_input))
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
      console.log('➡️ OUT [CONTROL_RESPONSE]:', responseMessage.response?.subtype || '', responseMessage)

      await window.electronAPI.sendControlResponse(requestId, true, options)
    } else {
      // Regular tool_use permission
      const responseMessage = {
        type: 'tool_result',
        tool_use_id: requestId,
        content: '',
        is_error: false
      }
      console.log('➡️ OUT [CONTROL_RESPONSE]:', responseMessage.response?.subtype || '', responseMessage)

      await window.electronAPI.sendToolResult(requestId, '', false)
    }
  } catch (error) {
    console.error('Failed to send approve all:', error)
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
  const question = pendingQuestion.value
  pendingQuestion.value = null

  if (question) {
    // answers 是一个对象 { "问题": "答案" }
    const questionsData = question.tool_input?.questions || []

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
    const newMessage = {
      role: 'question',
      tool_use_id: question.tool_use_id, // 存储 tool_use_id 以便关联 tool_result
      questions: questionItems,
      userAnswers: answers, // 存储用户提交的答案
      collapsed: false,
      timestamp: new Date()
    }
    console.log('Creating question message:', { tool_use_id: question.tool_use_id, userAnswers: answers })
    messages.value.push(newMessage)

    scrollToBottom(true) // 用户提交答案时强制滚动
  }

  try {
    // 对于 AskUserQuestion，发送 control_response 并包含所有答案
    // 答案格式：{ "问题": "答案" }
    const options = {
      updatedInput: {
        answers: answers
      }
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
    console.log('➡️ OUT [CONTROL_RESPONSE]:', responseMessage.response?.subtype || '', responseMessage)

    await window.electronAPI.sendControlResponse(requestId, true, options)
  } catch (error) {
    console.error('Failed to send answer:', error)
  }
}
</script>

<template>
  <div class="chat-window">
    <div class="messages" ref="messagesContainer">
      <div
        v-for="(message, index) in messages"
        :key="index"
        class="message"
        :class="message.role"
      >
        <!-- Tool use message -->
        <template v-if="message.role === 'tool_use'">
          <div class="message-avatar">T</div>
          <div class="tool-use-message-wrapper">
            <ToolUseMessage
              :tool-name="message.toolName"
              :tool-input="message.toolInput"
              :result="message.result"
              :is-error="message.isError"
              :is-executing="message.isExecuting"
              :collapsed="message.collapsed"
              :working-directory="workingDirectory"
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
          <div class="question-message-header">
            <div class="question-title">
              <span class="question-icon">❓</span>
              <span class="question-count" v-if="message.questions && message.questions.length > 1">{{ message.questions.length }} 个问题</span>
              <span class="question-count" v-else>问答</span>
              <span v-if="message.resultReceived && message.answersConsistent" class="status-badge success">答案已确认</span>
              <span v-else-if="message.resultReceived && !message.answersConsistent" class="status-badge warning">答案不一致</span>
            </div>
            <button
              type="button"
              class="collapse-button"
              @click="toggleQuestionCollapse(index)"
            >
              {{ isQuestionCollapsed(index) ? '展开' : '折叠' }}
            </button>
          </div>

          <!-- Collapsed view: show only answers -->
          <div v-if="isQuestionCollapsed(index)" class="collapsed-answers">
            <template
              v-for="(q, qIdx) in message.questions"
              :key="qIdx"
            >
              <div class="collapsed-answer-item">
                <span class="collapsed-question-label">{{ q.header }}:</span>
                <span class="collapsed-answer-content">{{ q.selectedAnswer || '未选择' }}</span>
              </div>
              <span v-if="qIdx < message.questions.length - 1" class="collapsed-answer-separator">|</span>
            </template>
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
        <!-- Thinking message -->
        <div v-else-if="message.role === 'thinking'" class="thinking-message">
          <div class="thinking-header">
            <span class="thinking-icon">💭</span>
            <span class="thinking-label">思考中</span>
          </div>
          <div class="thinking-content">{{ message.content }}</div>
        </div>
        <!-- Unknown/unsupported message -->
        <div v-else-if="message.role === 'unknown'" class="unknown-message">
          <div class="unknown-header">
            <span class="unknown-icon">⚠️</span>
            <span class="unknown-label">暂未支持的消息类型: {{ message.messageType }}</span>
          </div>
          <pre class="unknown-content">{{ message.content }}</pre>
        </div>
        <!-- Regular messages -->
        <template v-else>
          <div class="message-avatar" v-if="message.role !== 'status'">
            {{ message.role === 'user' ? 'U' : message.role === 'assistant' ? 'C' : 'S' }}
          </div>
          <div class="message-content" :class="{ 'status-content': message.role === 'status' }">
            <div class="message-text" :class="{ 'status-text': message.role === 'status' }">
              <MarkdownRenderer v-if="message.role === 'assistant'" :content="message.content" />
              <div v-else>{{ message.content }}</div>
            </div>
            <div class="message-time" v-if="message.role !== 'status'">
              {{ new Date(message.timestamp).toLocaleTimeString() }}
            </div>
          </div>
        </template>
      </div>
      <div v-if="isProcessing" class="message assistant typing">
        <div class="message-avatar">C</div>
        <div class="message-content">
          <div class="typing-indicator">正在思考...</div>
        </div>
      </div>
    </div>
    <div class="input-area">
      <textarea
        v-model="inputMessage"
        @keydown.enter="handleEnterKey"
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
        @click="sendMessage"
        :disabled="!inputMessage.trim() || isProcessing || pendingPermission !== null || pendingControlRequest !== null"
        class="send-button"
      >
        发送
      </button>
    </div>

  </div>

  <!-- Permission Dialog for tool_use -->
  <Teleport to="body">
    <PermissionDialog
      v-if="pendingPermission"
      :request="pendingPermission"
      @approve="handlePermissionApprove"
      @deny="handlePermissionDeny"
      @approve-all="handlePermissionApproveAll"
    />
  </Teleport>

  <!-- Permission Dialog for control_request (--permission-prompt-tool stdio) -->
  <Teleport to="body">
    <PermissionDialog
      v-if="pendingControlRequest"
      :request="pendingControlRequest"
      @approve="handlePermissionApprove"
      @deny="handlePermissionDeny"
      @approve-all="handlePermissionApproveAll"
    />
  </Teleport>

  <!-- Ask User Question Dialog -->
  <Teleport to="body">
    <AskUserQuestionDialog
      v-if="pendingQuestion"
      :request="pendingQuestion"
      @answer="handleQuestionAnswer"
    />
  </Teleport>
</template>

<style scoped>
.chat-window {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
  /* Modern scrollbar styling */
  scrollbar-width: thin;
  scrollbar-color: #52525B #18181B;
}

.message {
  display: flex;
  margin-bottom: 16px;
  gap: 12px;
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

.message-content {
  max-width: 70%;
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
}

.message-text:not(:has(.markdown-content)) {
  white-space: pre-wrap;
}

.message.user .message-text {
  background: #3F3F46;
}

.message.assistant .message-text {
  background: #27272A;
  border: 1px solid #3F3F46;
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

.input-area {
  padding: 20px;
  border-top: 1px solid #3F3F46;
  display: flex;
  gap: 12px;
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
}

.send-button:hover:not(:disabled) {
  background: #EA580C;
}

.send-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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
  font-weight: 600;
  color: #93C5FD;
  text-transform: uppercase;
  letter-spacing: 0.05em;
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

.collapse-button {
  padding: 4px 12px;
  background: transparent;
  border: 1px solid #10B981;
  border-radius: 4px;
  color: #6EE7B7;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
}

.collapse-button:hover {
  background: rgba(110, 231, 183, 0.1);
}

/* Collapsed answers */
.collapsed-answers {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 16px;
  padding: 14px 0;
  flex-wrap: wrap;
}

.collapsed-answer-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 12px;
  background: rgba(59, 130, 246, 0.06);
  border-radius: 6px;
  border: 1px solid rgba(59, 130, 246, 0.12);
}

.collapsed-question-label {
  font-size: 12px;
  color: #6EE7B7;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.collapsed-answer-content {
  font-size: 13px;
  color: #F1F5F9;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  font-weight: 500;
}

.collapsed-answer-separator {
  color: #475569;
  font-size: 14px;
  font-weight: 300;
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
