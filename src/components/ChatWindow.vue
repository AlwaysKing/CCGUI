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

// Store unsubscribe functions
let unsubscribers = []

onMounted(() => {
  // Listen to Claude messages
  const unsubs = []

  const msgUnsub = window.electronAPI.onClaudeMessage((message) => {
    // 打印原始消息
    console.log('◀ [MESSAGE]:', JSON.stringify(message, null, 2))

    // 如果正在使用流式事件，跳过 onClaudeMessage 处理（避免重复）
    if (isUsingStreamEvents) {
      console.log('  ↳ 跳过（正在使用流式事件）')
      return
    }

    // 处理非流式消息
    if (message.message && message.message.content) {
      // 只处理文本内容
      const textContent = message.message.content.find(c => c.type === 'text')
      if (textContent) {
        messages.value.push({
          role: 'assistant',
          content: textContent.text,
          timestamp: new Date()
        })
        scrollToBottom()
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
    console.log('◀ [SYSTEM]:', JSON.stringify(message, null, 2))
  })
  unsubs.push(systemUnsub)

  const toolUnsub = window.electronAPI.onToolUse((message) => {
    // 打印 tool_use 消息
    console.log('◀ [TOOL_USE]:', JSON.stringify(message, null, 2))
    // Tool use messages handled via tool_use_request
  })
  unsubs.push(toolUnsub)

  const toolResultUnsub = window.electronAPI.onToolResult((message) => {
    // 打印 tool_result 消息
    console.log('◀ [TOOL_RESULT]:', JSON.stringify(message, null, 2))

    // Display tool result and reset processing state
    isProcessing.value = false

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
    console.log('◀ [TOOL_USE_REQUEST]:', JSON.stringify(message, null, 2))

    if (message.message && message.message.content) {
      const toolUseContent = message.message.content.find(c => c.type === 'tool_use')
      if (toolUseContent) {
        if (toolUseContent.name === 'AskUserQuestion') {
          // Show question dialog for AskUserQuestion
          pendingQuestion.value = {
            request_id: toolUseContent.id,
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
    console.log('◀', JSON.stringify(message, null, 2))
    if (message.request && message.request.subtype === 'can_use_tool') {
      // Check if this is an AskUserQuestion request
      if (message.request.tool_name === 'AskUserQuestion') {
        // Show question dialog for AskUserQuestion
        pendingQuestion.value = {
          request_id: message.request_id,
          tool_name: message.request.tool_name,
          tool_input: message.request.input
        }
      } else {
        // Clear any pending permission (control_request takes precedence)
        pendingPermission.value = null

        // Add tool use message to chat (显示工具使用，等待权限确认)
        messages.value.push({
          role: 'tool_use',
          toolName: message.request.tool_name,
          toolInput: message.request.input,
          result: '',
          isError: false,
          isExecuting: true,
          request_id: message.request.tool_use_id || message.request_id, // 使用 tool_use_id 以便与 tool_result 关联
          timestamp: new Date()
        })
        scrollToBottom()

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
    console.log('◀ [CLI_STATUS]:', JSON.stringify(message, null, 2))

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
    console.log('◀ [STREAM_EVENT]:', JSON.stringify(message, null, 2))

    const event = message.event
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
    console.log('◀ [UNKNOWN MESSAGE]:', JSON.stringify(message, null, 2))

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
  scrollToBottom()

  // Send to Claude
  const userMessage = {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: userText }]
    }
  }
  // 打印原始发送消息
  console.log('▶', JSON.stringify(userMessage, null, 2))

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

function scrollToBottom() {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
}

function handleEnterKey(event) {
  // 如果正在使用输入法组合（如中文输入），不触发发送
  if (event.isComposing) {
    return
  }
  sendMessage()
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
      console.log('▶', JSON.stringify(responseMessage, null, 2))

      await window.electronAPI.sendControlResponse(requestId, true, options)
    } else {
      // Regular tool_use permission
      const responseMessage = {
        type: 'tool_result',
        tool_use_id: requestId,
        content: '',
        is_error: false
      }
      console.log('▶', JSON.stringify(responseMessage, null, 2))

      await window.electronAPI.sendToolResult(requestId, '', false)
    }
  } catch (error) {
    console.error('Failed to send approval:', error)
    // 找到对应的 tool_use 消息并更新状态
    const toolUseMsg = messages.value.find(m => m.role === 'tool_use' && m.request_id === requestId)
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
  const toolUseMsg = messages.value.find(m => m.role === 'tool_use' && m.request_id === requestId)
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
      console.log('▶', JSON.stringify(responseMessage, null, 2))

      await window.electronAPI.sendControlResponse(requestId, false, options)
    } else {
      // Regular tool_use permission
      const responseMessage = {
        type: 'tool_result',
        tool_use_id: requestId,
        content: 'Permission denied by user',
        is_error: true
      }
      console.log('▶', JSON.stringify(responseMessage, null, 2))

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
      console.log('▶', JSON.stringify(responseMessage, null, 2))

      await window.electronAPI.sendControlResponse(requestId, true, options)
    } else {
      // Regular tool_use permission
      const responseMessage = {
        type: 'tool_result',
        tool_use_id: requestId,
        content: '',
        is_error: false
      }
      console.log('▶', JSON.stringify(responseMessage, null, 2))

      await window.electronAPI.sendToolResult(requestId, '', false)
    }
  } catch (error) {
    console.error('Failed to send approve all:', error)
  }
}

async function handleQuestionAnswer(requestId, answers) {
  const question = pendingQuestion.value
  pendingQuestion.value = null

  if (question) {
    // answers 现在是一个数组，每个元素包含 { question, header, answer }
    const questionsData = question.tool_input?.questions || []

    // 为每个问题创建一条消息
    answers.forEach((answerItem, index) => {
      const questionData = questionsData[index]
      const questionText = answerItem.question || questionData?.question || ''
      const header = answerItem.header || questionData?.header || `问题 ${index + 1}`
      const options = questionData?.options || []

      // 找到选中的选项的完整信息
      const selectedOption = options.find(opt => opt.label === answerItem.answer)
      const selectedDescription = selectedOption?.description || ''

      // 添加问答消息
      messages.value.push({
        role: 'question',
        header: header,
        question: questionText,
        options: options,
        selectedAnswer: answerItem.answer,
        selectedDescription: selectedDescription,
        timestamp: new Date()
      })
    })
    scrollToBottom()
  }

  try {
    // 对于 AskUserQuestion，发送 control_response 并包含所有答案
    // 答案格式：answers 数组，包含每个问题的选择
    const responseAnswers = answers.map(a => ({
      question: a.question,
      answer: a.answer
    }))

    const options = {
      updatedInput: {
        answers: responseAnswers
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
    console.log('▶', JSON.stringify(responseMessage, null, 2))

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
        <ToolUseMessage
          v-if="message.role === 'tool_use'"
          :tool-name="message.toolName"
          :tool-input="message.toolInput"
          :result="message.result"
          :is-error="message.isError"
          :is-executing="message.isExecuting"
        />
        <!-- Question message -->
        <div v-else-if="message.role === 'question'" class="question-message">
          <div class="question-header">
            <span class="question-icon">❓</span>
            <span class="question-label">{{ message.header }}</span>
          </div>
          <div class="question-text">{{ message.question }}</div>
          <div class="question-options" v-if="message.options && message.options.length > 0">
            <div class="options-label">选项：</div>
            <div class="options-list">
              <div
                v-for="(option, index) in message.options"
                :key="index"
                class="option-item"
                :class="{ selected: option.label === message.selectedAnswer }"
              >
                <span class="option-marker">{{ option.label === message.selectedAnswer ? '✓' : '○' }}</span>
                <div class="option-content">
                  <span class="option-text">{{ option.label }}</span>
                  <span v-if="option.description" class="option-description">{{ option.description }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
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
        @keydown.enter.prevent="handleEnterKey"
        placeholder="输入消息... (Enter 发送)"
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

.message-content {
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
