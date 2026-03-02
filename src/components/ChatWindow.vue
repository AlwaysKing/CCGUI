<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch } from 'vue'
import MarkdownRenderer from './MarkdownRenderer.vue'
import PermissionDialog from './PermissionDialog.vue'
import AskUserQuestionDialog from './AskUserQuestionDialog.vue'

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
    console.log('◀ Received:', JSON.stringify(message, null, 2))
    if (message.message && message.message.content) {
      // Process text content only (tool_use is handled via permission dialog)
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
    console.log('◀ Received (system):', JSON.stringify(message, null, 2))
  })
  unsubs.push(systemUnsub)

  const toolUnsub = window.electronAPI.onToolUse((message) => {
    // Tool use messages handled via tool_use_request
  })
  unsubs.push(toolUnsub)

  const toolResultUnsub = window.electronAPI.onToolResult((message) => {
    // Display tool result and reset processing state
    isProcessing.value = false

    if (message.message && message.message.content) {
      const toolResultContent = message.message.content.find(c => c.type === 'tool_result')
      if (toolResultContent) {
        const isError = toolResultContent.is_error
        const content = toolResultContent.content || ''
        const toolUseId = toolResultContent.tool_use_id

        messages.value.push({
          role: 'system',
          content: isError
            ? `❌ ${toolUseId} 失败: ${content}`
            : `✅ ${toolUseId} 完成: ${content || '(无输出)'}`,
          timestamp: new Date()
        })
        scrollToBottom()
      }
    }
  })
  unsubs.push(toolResultUnsub)

  // Listen for tool_use requests (permission dialog or question dialog)
  const toolUseRequestUnsub = window.electronAPI.onToolUseRequest((message) => {
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
    console.log('◀ Received (control_request):', JSON.stringify(message, null, 2))
    if (message.request && message.request.subtype === 'can_use_tool') {
      // Check if this is an AskUserQuestion request
      if (message.request.tool_name === 'AskUserQuestion') {
        // Show question dialog for AskUserQuestion
        pendingQuestion.value = {
          request_id: message.request_id,
          tool_name: message.request.tool_name,
          tool_input: message.request.input
        }
        console.log('Set pendingQuestion (from control_request):', pendingQuestion.value)
      } else {
        // Clear any pending permission (control_request takes precedence)
        pendingPermission.value = null
        // Show permission dialog for control_request
        pendingControlRequest.value = {
          request_id: message.request_id,
          tool_name: message.request.tool_name,
          tool_input: message.request.input,
          permission_suggestions: message.request.permission_suggestions
        }
        console.log('Set pendingControlRequest:', pendingControlRequest.value)
      }
    }
  })
  unsubs.push(controlRequestUnsub)

  // Listen for CLI status messages (connection status, retries, errors)
  const cliStatusUnsub = window.electronAPI.onCliStatus((message) => {
    console.log('◀ Received (cli-status):', message)
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
  console.log('▶ Sent:', JSON.stringify(userMessage, null, 2))

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

async function handlePermissionApprove(requestId) {
  const permission = pendingPermission.value
  const controlRequest = pendingControlRequest.value

  pendingPermission.value = null
  pendingControlRequest.value = null

  if (permission) {
    messages.value.push({
      role: 'system',
      content: `✅ 已允许: ${permission.tool_name}`,
      timestamp: new Date()
    })
    scrollToBottom()
  }

  console.log('▶ Sent (approval):', { requestId, isControlRequest: !!controlRequest, controlRequest })

  try {
    // Check if this is a control_request (for --permission-prompt-tool stdio)
    if (controlRequest && controlRequest.request_id === requestId) {
      console.log('Sending control_response for:', requestId)
      // 传递权限建议规则和更新后的输入 - 使用 JSON 序列化来确保可以克隆
      const options = {}
      if (controlRequest.permission_suggestions && controlRequest.permission_suggestions.length > 0) {
        options.permissionRules = JSON.parse(JSON.stringify(controlRequest.permission_suggestions))
      }
      // 传递工具的输入参数作为 updatedInput
      if (controlRequest.tool_input) {
        options.updatedInput = JSON.parse(JSON.stringify(controlRequest.tool_input))
      }
      await window.electronAPI.sendControlResponse(requestId, true, options)
      console.log('control_response sent successfully')
    } else {
      // Regular tool_use permission
      console.log('Sending tool_result for:', requestId)
      await window.electronAPI.sendToolResult(requestId, '', false)
      console.log('tool_result sent successfully')
    }
  } catch (error) {
    console.error('Failed to send approval:', error)
    messages.value.push({
      role: 'system',
      content: `❌ 发送权限响应失败: ${error.message}`,
      timestamp: new Date()
    })
    scrollToBottom()
  }
}

async function handlePermissionDeny(requestId) {
  const permission = pendingPermission.value
  const controlRequest = pendingControlRequest.value

  pendingPermission.value = null
  pendingControlRequest.value = null

  if (permission) {
    messages.value.push({
      role: 'system',
      content: `❌ 已拒绝: ${permission.tool_name}`,
      timestamp: new Date()
    })
    scrollToBottom()
  }

  console.log('▶ Sent (denial):', { requestId, isControlRequest: !!controlRequest, controlRequest })

  try {
    // Check if this is a control_request (for --permission-prompt-tool stdio)
    if (controlRequest && controlRequest.request_id === requestId) {
      console.log('Sending denial control_response for:', requestId)
      await window.electronAPI.sendControlResponse(requestId, false, {
        reason: 'Permission denied by user'
      })
      console.log('Denial control_response sent successfully')
    } else {
      // Regular tool_use permission
      console.log('Sending denial tool_result for:', requestId)
      await window.electronAPI.sendToolResult(requestId, 'Permission denied by user', true)
      console.log('Denial tool_result sent successfully')
    }
  } catch (error) {
    console.error('Failed to send denial:', error)
    messages.value.push({
      role: 'system',
      content: `❌ 发送拒绝响应失败: ${error.message}`,
      timestamp: new Date()
    })
    scrollToBottom()
  }
}

async function handlePermissionApproveAll(requestId) {
  const permission = pendingPermission.value
  pendingPermission.value = null

  if (permission) {
    messages.value.push({
      role: 'system',
      content: `✅ 已允许 (所有): ${permission.tool_name}`,
      timestamp: new Date()
    })
    scrollToBottom()
  }

  const toolResult = {
    type: 'user',
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: requestId,
        content: '',
        is_error: false
      }]
    }
  }
  console.log('▶ Sent (approve all):', JSON.stringify(toolResult, null, 2))

  try {
    await window.electronAPI.sendToolResult(requestId, '', false)
  } catch (error) {
    console.error('Failed to send approve all:', error)
  }
}

async function handleQuestionAnswer(requestId, answer) {
  const question = pendingQuestion.value
  pendingQuestion.value = null

  if (question) {
    messages.value.push({
      role: 'assistant',
      content: `❓ Question: ${question.tool_input?.questions?.[0]?.question || ''}`,
      timestamp: new Date()
    })
    messages.value.push({
      role: 'user',
      content: `✓ Answer: ${answer}`,
      timestamp: new Date()
    })
    scrollToBottom()
  }

  console.log('▶ Sent (answer):', { requestId, answer })

  try {
    // 对于 AskUserQuestion，发送 control_response 并包含答案
    // 答案格式需要匹配 AskUserQuestion 的预期响应格式
    await window.electronAPI.sendControlResponse(requestId, true, {
      updatedInput: {
        answers: { [requestId]: answer }
      }
    })
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
        @keydown.enter.prevent="sendMessage"
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
  background: #7F1D1D;
  border: 1px solid #EF4444;
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
</style>
