<script setup>
import { ref, onMounted, onUnmounted, nextTick, watch, computed } from 'vue'
import MarkdownRenderer from './MarkdownRenderer.vue'
import PermissionDialog from './PermissionDialog.vue'
import AskUserQuestionDialog from './AskUserQuestionDialog.vue'
import ToolUseMessage from './ToolUseMessage.vue'
import MessageDetailDialog from './MessageDetailDialog.vue'

const messages = ref([])
const inputMessage = ref('')
const isProcessing = ref(false)
const messagesContainer = ref(null)
const inputArea = ref(null)
const pendingPermission = ref(null)
const pendingQuestion = ref(null)
const pendingControlRequest = ref(null)
const isDragOver = ref(false)
const questionActiveTabs = ref({}) // 存储每条问答消息的 active tab
const workingDirectory = ref('') // 工作目录
const selectedMessage = ref(null) // 当前选中的消息（用于显示详情）
const currentTime = ref(Date.now()) // 用于实时更新消耗时间
const envInfo = ref(null) // 环境信息（来自 system init）
const showEnvDetail = ref(false) // 是否显示环境详情
const stickyMessageIndex = ref(-1) // 当前粘性显示的消息索引
const containerHeight = ref(400) // 聊天容器高度，用于限制粘性面板
let previousMessageCount = 0 // 追踪之前的消息数量
let durationTimer = null // 消耗时间更新定时器
const inputHistory = [] // 输入历史记录
let historyIndex = -1 // 当前历史索引，-1 表示不在浏览历史
let isHistoryNavigation = false // 标记是否正在通过历史导航设置值
const showHistoryPicker = ref(false) // 显示历史记录选择弹窗

// Store unsubscribe functions
let unsubscribers = []

onMounted(async () => {
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

  // Get cached init info (for envbar display)
  try {
    const initInfo = await window.electronAPI.getInitInfo()
    if (initInfo) {
      envInfo.value = initInfo
    }
  } catch (error) {
    // Ignore error
  }

  // Listen to Claude messages
  const unsubs = []

  const msgUnsub = window.electronAPI.onClaudeMessage((message) => {
    // 如果正在使用流式事件，跳过 onClaudeMessage 处理（避免重复）
    if (isUsingStreamEvents) {
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
          timestamp: new Date(),
          rawMessages: [message]
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
            timestamp: new Date(),
            startTime: Date.now(),
            rawMessages: [message]
          })
          scrollToBottom()
        }
      }
    }
  })
  unsubs.push(msgUnsub)

  const resultUnsub = window.electronAPI.onClaudeResult((message) => {
    // 找到最后一个用户消息并更新统计信息
    // result.usage 是这一轮请求的总消耗，result.num_turns 是轮次数量
    for (let i = messages.value.length - 1; i >= 0; i--) {
      if (messages.value[i].role === 'user') {
        const userMsg = messages.value[i]
        // 更新统计信息
        userMsg.duration = message.duration_ms || null
        userMsg.numTurns = message.num_turns || null
        userMsg.usage = message.usage || null
        // 强制触发 Vue 响应式更新
        messages.value[i] = { ...messages.value[i] }
        break
      }
    }

    // 解锁输入框 - 在这里解锁确保和问答计时同步
    isProcessing.value = false

    // 聚焦输入框
    nextTick(() => {
      inputArea.value?.focus()
    })

    scrollToBottom()
  })
  unsubs.push(resultUnsub)

  const systemUnsub = window.electronAPI.onSystemMessage((message) => {
    // 系统消息处理
  })
  unsubs.push(systemUnsub)

  const toolUnsub = window.electronAPI.onToolUse((message) => {
    // 显示工具使用消息
    if (message.message && message.message.content) {
      const toolUseContent = message.message.content.find(c => c.type === 'tool_use')
      if (toolUseContent) {
        const toolUseId = toolUseContent.id

        // AskUserQuestion 由 control_request 处理，不在这里创建消息
        if (toolUseContent.name === 'AskUserQuestion') {
          return
        }

        // 检查是否已经显示过这个 tool_use（避免与 control_request 重复）
        const existingMsg = messages.value.find(m => m.role === 'tool_use' && m.request_id === toolUseId)
        if (existingMsg) {
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
          timestamp: new Date(),
          startTime: Date.now(),
          rawMessages: [message]
        })
        scrollToBottom()
      }
    }
  })
  unsubs.push(toolUnsub)

  const toolResultUnsub = window.electronAPI.onToolResult((message) => {
    // 检查是否是 AskUserQuestion 的结果
    if (message.tool_use_result?.answers) {
      // tool_use_id 在 message.message.content 中
      const toolResultContent = message.message?.content?.find(c => c.type === 'tool_result')
      const toolUseId = toolResultContent?.tool_use_id || message.uuid
      const receivedAnswers = message.tool_use_result.answers

      // 找到对应的问答消息
      const questionMsg = messages.value.find(m => m.role === 'question' && m.tool_use_id === toolUseId)
      if (questionMsg) {
        // 比较答案
        const userAnswers = questionMsg.userAnswers || {}
        const isConsistent = compareAnswers(userAnswers, receivedAnswers)

        questionMsg.resultReceived = true
        questionMsg.answersConsistent = isConsistent
        questionMsg.receivedAnswers = receivedAnswers
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
          // 计算 duration
          if (toolUseMsg.startTime) {
            toolUseMsg.duration = Date.now() - toolUseMsg.startTime
          }
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
              timestamp: new Date(),
              startTime: Date.now(),
              rawMessages: [message]
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
    // 显示状态消息
    if (message.message) {
      messages.value.push({
        role: 'status',
        content: message.message,
        timestamp: new Date(),
        rawMessages: [message]
      })
      scrollToBottom()
    }
  })
  unsubs.push(cliStatusUnsub)

  // Listen for stream events (thinking_delta, text_delta, etc.)
  let currentAssistantMessageIndex = -1
  let currentContentBlockType = null // 当前正在处理的内容块类型
  let isUsingStreamEvents = false // 标记是否使用了流式事件
  let contentBlockIndexToId = new Map() // 追踪 content_block index 到 id 的映射
  let currentTurnNumber = 0 // 当前 turn 编号
  let hasSeenToolUseInCurrentTurn = false // 当前 turn 是否已经见过 tool_use

  // 辅助函数：累加更新最后一个用户消息的 usage 统计
  function accumulateUserMessageUsage(newUsage) {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      if (messages.value[i].role === 'user') {
        const userMsg = messages.value[i]
        // 累加 usage
        const currentUsage = userMsg.usage || { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 }
        userMsg.usage = {
          input_tokens: (currentUsage.input_tokens || 0) + (newUsage.input_tokens || 0),
          output_tokens: (currentUsage.output_tokens || 0) + (newUsage.output_tokens || 0),
          cache_read_input_tokens: (currentUsage.cache_read_input_tokens || 0) + (newUsage.cache_read_input_tokens || 0)
        }
        // 强制触发 Vue 响应式更新
        messages.value[i] = { ...messages.value[i] }
        break
      }
    }
  }

  // 辅助函数：更新最后一个用户消息的 turn 数量
  function updateUserMessageTurns(numTurns) {
    for (let i = messages.value.length - 1; i >= 0; i--) {
      if (messages.value[i].role === 'user') {
        messages.value[i].numTurns = numTurns
        // 强制触发 Vue 响应式更新
        messages.value[i] = { ...messages.value[i] }
        break
      }
    }
  }

  const streamEventUnsub = window.electronAPI.onStreamEvent((message) => {
    const event = message.event

    if (!event) return

    // 标记正在使用流式事件
    isUsingStreamEvents = true

    // Handle turn_start - 统计 turn 数量
    if (event.type === 'turn_start') {
      currentTurnNumber++
      updateUserMessageTurns(currentTurnNumber)
      // 继续处理，因为 turn_start 可能也包含 usage
    }

    // 检查是否有 usage 信息并累加到用户消息
    // usage 可能在多个位置: message.usage, event.usage, event.message.usage, event.content_block.usage
    const usage = message.usage || event.usage || event.message?.usage || event.content_block?.usage
    if (usage) {
      // 累加更新用户消息的 usage 统计
      accumulateUserMessageUsage(usage)
    }

    // 更新 assistant 消息的 usage（用于显示在回答气泡上）
    if (usage && currentAssistantMessageIndex >= 0) {
      const currentMsg = messages.value[currentAssistantMessageIndex]
      if (currentMsg && currentMsg.role === 'assistant') {
        currentMsg.usage = usage
        // 强制触发 Vue 响应式更新
        messages.value[currentAssistantMessageIndex] = { ...messages.value[currentAssistantMessageIndex] }
      }
      // 同时累加更新用户消息的 usage 统计
      accumulateUserMessageUsage(usage)
    }

    // Handle message_start - 创建消息并显示"正在思考"状态
    if (event.type === 'message_start') {
      currentAssistantMessageIndex = -1
      currentContentBlockType = null
      contentBlockIndexToId.clear() // 清除 index 到 id 的映射
      currentTurnNumber = 0 // 重置 turn 编号
      hasSeenToolUseInCurrentTurn = false // 重置 tool_use 标记
      // 标记正在使用流式事件（message_start 也是 stream_event 的一部分）
      isUsingStreamEvents = true

      // 从 message_start 中提取初始 usage 信息
      const initialUsage = event.message?.usage || null

      // 创建新的 assistant 消息，带有"正在思考"状态
      messages.value.push({
        role: 'assistant',
        content: '',
        thinking: '',
        hasThinking: false,
        isStreaming: true, // 正在流式传输
        startTime: Date.now(), // 记录开始时间
        timestamp: new Date(),
        usage: initialUsage, // 初始 usage
        turnNumber: 1, // 初始 turn 编号
        rawMessages: [message]
      })
      currentAssistantMessageIndex = messages.value.length - 1

      // 初始化用户消息的统计（默认 1 turn）
      updateUserMessageTurns(1)
      if (initialUsage) {
        accumulateUserMessageUsage(initialUsage)
      }

      scrollToBottom()
      return
    }

    // Handle content_block_start
    if (event.type === 'content_block_start') {
      const contentBlock = event.content_block
      currentContentBlockType = contentBlock?.type

      if (contentBlock?.type === 'thinking') {
        // 检测新 turn：如果之前已经见过 tool_use，现在又看到 thinking，说明是新 turn
        if (hasSeenToolUseInCurrentTurn) {
          currentTurnNumber++
          hasSeenToolUseInCurrentTurn = false
          // 注意：turn 统计由 turn_start 事件处理
        }
        // 复用 message_start 创建的消息，添加 thinking
        const currentMsg = currentAssistantMessageIndex >= 0 ? messages.value[currentAssistantMessageIndex] : null
        if (currentMsg && currentMsg.role === 'assistant') {
          currentMsg.hasThinking = true
          currentMsg.thinkingCollapsed = false
          // 更新当前 turn 编号
          currentMsg.turnNumber = currentTurnNumber + 1
          // 如果是第二个及之后的 turn，标记需要显示分割线
          if (currentTurnNumber > 0) {
            currentMsg.showTurnSeparator = true
          }
        }
        scrollToBottom()
      } else if (contentBlock?.type === 'text') {
        // 复用 message_start 创建的消息
        scrollToBottom()
      } else if (contentBlock?.type === 'tool_use') {
        // 标记当前 turn 已经见过 tool_use
        hasSeenToolUseInCurrentTurn = true
        // AskUserQuestion 由 control_request 处理，不在这里创建消息
        if (contentBlock.name === 'AskUserQuestion') {
          return
        }
        // Start a new tool use message with partial data
        const toolUseData = contentBlock
        // 记录 index 到 id 的映射（用于后续 content_block_delta）
        if (typeof event.index === 'number') {
          contentBlockIndexToId.set(event.index, toolUseData.id)
        }
        // 创建消息对象，确保 toolInput 是一个新的对象引用
        const newMessage = {
          role: 'tool_use',
          toolName: toolUseData.name,
          toolInput: toolUseData.input ? { ...toolUseData.input } : {}, // 初始输入（可能不完整）- 使用展开运算符确保新对象
          result: '',
          isError: false,
          isExecuting: true,
          request_id: toolUseData.id,
          collapsed: false,
          thinking: '', // tool_use 也可能有 thinking
          hasThinking: false,
          timestamp: new Date(),
          startTime: Date.now(),
          rawMessages: [message]
        }
        messages.value.push(newMessage)
        // 注意：不更新 currentAssistantMessageIndex，因为它应该只指向 assistant 消息
        // tool_use 消息的索引通过 contentBlockIndexToId 映射来追踪
        scrollToBottom()
      }
      return
    }

    // Handle content_block_delta
    if (event.type === 'content_block_delta') {
      const delta = event.delta

      // Handle thinking_delta - 更新 assistant 消息的 thinking 字段
      if (delta?.type === 'thinking_delta' && delta.thinking) {
        if (currentAssistantMessageIndex >= 0 && messages.value[currentAssistantMessageIndex]) {
          const msg = messages.value[currentAssistantMessageIndex]
          msg.thinking = (msg.thinking || '') + delta.thinking
          msg.hasThinking = true
          // 存储原始消息 - 使用 reactive 更新
          if (!msg.rawMessages) msg.rawMessages = []
          msg.rawMessages.push(message)
          scrollToBottom()
        }
      }

      // Handle text_delta
      if (delta?.type === 'text_delta' && delta.text) {
        if (currentAssistantMessageIndex >= 0 && messages.value[currentAssistantMessageIndex]) {
          const msg = messages.value[currentAssistantMessageIndex]
          const prevContent = msg.content
          // 使用显式的 reactive 更新
          msg.content = prevContent + delta.text
          // 存储原始消息 - 使用 reactive 更新
          if (!msg.rawMessages) msg.rawMessages = []
          msg.rawMessages.push(message)
          // 只有在用户位于底部时才滚动
          scrollToBottom()
        }
      }

      // Handle tool_use_delta - 处理工具调用的部分数据
      if (delta?.type === 'tool_use_delta' && delta.input) {
        // 使用 event.index 从映射中获取 content_block_id
        const contentBlockId = contentBlockIndexToId.get(event.index)

        // 找到最近创建的 tool use 消息（使用索引方式确保 reactivity）
        const toolUseMsgIndex = messages.value.findLastIndex(m =>
          m.role === 'tool_use' && m.request_id === contentBlockId
        )

        if (toolUseMsgIndex >= 0 && toolUseMsgIndex < messages.value.length) {
          const toolUseMsg = messages.value[toolUseMsgIndex]

          // 使用深度合并策略来更新 toolInput - 确保创建新的对象引用
          const currentInput = toolUseMsg.toolInput || {}
          const deltaInput = delta.input

          // 创建新的 toolInput 对象来确保 Vue reactivity
          const newToolInput = { ...currentInput }

          // 深度合并输入数据，根据不同类型采用不同策略
          Object.keys(deltaInput).forEach(key => {
            const currentValue = currentInput[key]
            const deltaValue = deltaInput[key]

            // 如果值不存在，直接赋值
            if (currentValue === undefined || currentValue === null) {
              newToolInput[key] = deltaValue
            }
            // 如果是对象（非数组），递归合并
            else if (typeof currentValue === 'object' && !Array.isArray(currentValue)) {
              newToolInput[key] = { ...currentValue, ...deltaValue }
            }
            // 字符串：追加（如果部分内容）
            else if (typeof currentValue === 'string' && typeof deltaValue === 'string') {
              // 对于字符串，只在 deltaValue 包含新内容时才追加
              // 避免重复追加相同的内容
              if (!currentValue.includes(deltaValue) || deltaValue.length > currentValue.length) {
                newToolInput[key] = deltaValue
              }
            }
            // 数组：如果不是完整替换，则追加
            else if (Array.isArray(currentValue) && Array.isArray(deltaValue)) {
              // 简单的数组合并策略：如果 delta 是更大/更完整的数组，则替换
              if (deltaValue.length >= currentValue.length) {
                newToolInput[key] = deltaValue
              }
            }
            // 其他情况：直接覆盖
            else {
              newToolInput[key] = deltaValue
            }
          })

          // 更新消息的 toolInput 为新对象，确保 Vue reactivity
          toolUseMsg.toolInput = newToolInput

          // 强制触发 Vue 的响应式更新 - 创建新的消息对象
          messages.value[toolUseMsgIndex] = { ...messages.value[toolUseMsgIndex] }

          // 存储原始消息 - 使用 reactive 更新
          if (!toolUseMsg.rawMessages) toolUseMsg.rawMessages = []
          toolUseMsg.rawMessages.push(message)
          // 只有在用户位于底部时才滚动
          scrollToBottom()
        }
      }

      // Handle input_json_delta - 处理工具调用的 JSON 部分数据（Claude API 使用这种格式）
      if (delta?.type === 'input_json_delta' && delta.partial_json) {
        // 使用 event.index 从映射中获取 content_block_id
        const contentBlockId = contentBlockIndexToId.get(event.index)

        // 找到对应的 tool use 消息
        const toolUseMsgIndex = messages.value.findLastIndex(m =>
          m.role === 'tool_use' && m.request_id === contentBlockId
        )

        if (toolUseMsgIndex >= 0 && toolUseMsgIndex < messages.value.length) {
          const toolUseMsg = messages.value[toolUseMsgIndex]

          try {
            // 解析 partial_json
            const parsedInput = JSON.parse(delta.partial_json)

            // 直接替换 toolInput 为解析后的对象（确保新对象引用）
            toolUseMsg.toolInput = { ...parsedInput }

            // 强制触发 Vue 的响应式更新 - 创建新的消息对象
            messages.value[toolUseMsgIndex] = { ...messages.value[toolUseMsgIndex] }

            // 存储原始消息 - 使用 reactive 更新
            if (!toolUseMsg.rawMessages) toolUseMsg.rawMessages = []
            toolUseMsg.rawMessages.push(message)
            // 只有在用户位于底部时才滚动
            scrollToBottom()
          } catch (error) {
            // Ignore parse errors for partial JSON
          }
        }
      }
      return
    }

    // Handle content_block_stop
    if (event.type === 'content_block_stop') {
      // 检查是否是 thinking block 结束 - 自动折叠 thinking
      if (currentContentBlockType === 'thinking') {
        if (currentAssistantMessageIndex >= 0 && messages.value[currentAssistantMessageIndex]) {
          const msg = messages.value[currentAssistantMessageIndex]
          if (msg.hasThinking && msg.thinking) {
            msg.thinkingCollapsed = true
          }
        }
      }

      // 使用 event.index 从映射中获取 content_block_id
      const contentBlockId = contentBlockIndexToId.get(event.index)
      if (contentBlockId) {
        // 标记 tool_use 消息部分数据接收完成 - 使用索引方式
        const toolUseMsgIndex = messages.value.findLastIndex(m =>
          m.role === 'tool_use' && m.isExecuting && m.request_id === contentBlockId
        )
        if (toolUseMsgIndex >= 0 && toolUseMsgIndex < messages.value.length) {
          const toolUseMsg = messages.value[toolUseMsgIndex]
          // 重要：设置 isExecuting 为 false，表示数据已接收完毕
          toolUseMsg.isExecuting = false
          // 计算 duration
          if (toolUseMsg.startTime) {
            toolUseMsg.duration = Date.now() - toolUseMsg.startTime
          }
          // 强制触发 Vue 的响应式更新
          messages.value[toolUseMsgIndex] = { ...messages.value[toolUseMsgIndex] }
        }
      }

      // 重置当前内容块类型
      currentContentBlockType = null
      return
    }

    // Handle message_delta - 包含 usage 更新
    if (event.type === 'message_delta') {
      // message_delta 中包含 usage 信息
      const usage = event.usage || null
      if (usage && currentAssistantMessageIndex >= 0) {
        const currentMsg = messages.value[currentAssistantMessageIndex]
        if (currentMsg && currentMsg.role === 'assistant') {
          currentMsg.usage = usage
          // 强制触发 Vue 响应式更新
          messages.value[currentAssistantMessageIndex] = { ...messages.value[currentAssistantMessageIndex] }
        }
      }
      return
    }

    // Handle message_stop
    if (event.type === 'message_stop') {
      // 更新当前消息的状态为完成
      // 注意：需要找到所有正在流式传输的 assistant 消息并更新它们
      // 从 event.message 或 event 中提取 usage 信息
      const usage = event.message?.usage || event.usage || null

      messages.value.forEach((msg, idx) => {
        if (msg.role === 'assistant' && msg.isStreaming) {
          msg.isStreaming = false
          msg.endTime = Date.now()
          msg.duration = msg.endTime - msg.startTime
          // 如果有 thinking，折叠它
          if (msg.hasThinking) {
            msg.thinkingCollapsed = true
          }
          // 更新 usage 信息
          if (usage) {
            msg.usage = usage
          }
          // 强制触发 Vue 响应式更新
          messages.value[idx] = { ...messages.value[idx] }
        }
      })
      currentAssistantMessageIndex = -1
      currentContentBlockType = null
      // 注意：不在这里设置 isProcessing.value = false
      // 应该等 onClaudeResult 事件来解锁，确保和问答计时同步
      isUsingStreamEvents = false // 重置流式事件标志
      return
    }
  })
  unsubs.push(streamEventUnsub)

  // Listen for unknown/unsupported message types
  const unknownMessageUnsub = window.electronAPI.onUnknownMessage((message) => {
    // 在界面中显示未知消息
    messages.value.push({
      role: 'unknown',
      messageType: message.type,
      content: JSON.stringify(message, null, 2),
      timestamp: new Date(),
      rawMessages: [message]
    })
    scrollToBottom()
  })
  unsubs.push(unknownMessageUnsub)

  // Listen for Claude init (environment info)
  const claudeInitUnsub = window.electronAPI.onClaudeInit((message) => {
    envInfo.value = message
  })
  unsubs.push(claudeInitUnsub)

  // Listen for control_response (e.g., interrupt confirmation)
  const controlResponseUnsub = window.electronAPI.onControlResponse((message) => {
    console.log('[Control Response]', message)
    // 处理打断成功响应
    if (message.response?.subtype === 'success' && message.response?.request_id?.startsWith('interrupt_')) {
      // 重置处理状态
      isProcessing.value = false
    }
  })
  unsubs.push(controlResponseUnsub)

  // Listen for interrupt messages (user interrupted the response)
  const interruptUnsub = window.electronAPI.onInterrupt((message) => {
    console.log('[Interrupt]', message)
    // 更新所有正在流式传输的 assistant 消息状态
    messages.value.forEach((msg, idx) => {
      if (msg.role === 'assistant' && msg.isStreaming) {
        msg.isStreaming = false
        msg.endTime = Date.now()
        msg.duration = msg.endTime - msg.startTime
        // 如果有 thinking，折叠它
        if (msg.hasThinking) {
          msg.thinkingCollapsed = true
        }
        // 强制触发 Vue 响应式更新
        messages.value[idx] = { ...messages.value[idx] }
      }
    })
    // 重置当前消息索引
    currentAssistantMessageIndex = -1
    currentContentBlockType = null
    // 添加系统消息显示打断
    messages.value.push({
      role: 'system',
      content: '⏹️ 已打断',
      timestamp: new Date()
    })
    // 重置处理状态
    isProcessing.value = false
    scrollToBottom()
  })
  unsubs.push(interruptUnsub)

  unsubscribers = unsubs
})

onUnmounted(() => {
  // Clean up duration timer
  if (durationTimer) {
    clearInterval(durationTimer)
    durationTimer = null
  }
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

  // Send to Claude
  const userMessage = {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: userText }]
    }
  }

  // 创建显示消息并存储原始数据
  const displayMessage = {
    role: 'user',
    content: userText,
    timestamp: new Date(),
    startTime: Date.now(), // 记录开始时间，用于计算总耗时
    responseCollapsed: false, // 新消息的回答不折叠
    rawMessages: [userMessage]
  }
  messages.value.push(displayMessage)

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
  isProcessing.value = true
  scrollToBottom(true) // 用户发送消息时强制滚动

  try {
    await window.electronAPI.sendMessage(userMessage)
  } catch (error) {
    isProcessing.value = false
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

  // 使用多次 nextTick 确保 DOM 完全更新
  nextTick(() => {
    nextTick(() => {
      if (messagesContainer.value) {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
      }
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
    await window.electronAPI.sendInterrupt()
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

      await window.electronAPI.sendControlResponse(requestId, true, options)
    } else {
      // Regular tool_use permission
      const responseMessage = {
        type: 'tool_result',
        tool_use_id: requestId,
        content: '',
        is_error: false
      }

      await window.electronAPI.sendToolResult(requestId, '', false)
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
    // 计算 duration
    if (toolUseMsg.startTime) {
      toolUseMsg.duration = Date.now() - toolUseMsg.startTime
    }
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

      await window.electronAPI.sendControlResponse(requestId, false, options)
    } else {
      // Regular tool_use permission
      const responseMessage = {
        type: 'tool_result',
        tool_use_id: requestId,
        content: 'Permission denied by user',
        is_error: true
      }

      await window.electronAPI.sendToolResult(requestId, 'Permission denied by user', true)
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

      await window.electronAPI.sendControlResponse(requestId, true, options)
    } else {
      // Regular tool_use permission
      const responseMessage = {
        type: 'tool_result',
        tool_use_id: requestId,
        content: '',
        is_error: false
      }

      await window.electronAPI.sendToolResult(requestId, '', false)
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
      timestamp: new Date(),
      rawMessages: [question] // 存储原始请求
    }
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

    await window.electronAPI.sendControlResponse(requestId, true, options)
  } catch (error) {
    // Ignore error
  }
}
</script>

<template>
  <div class="chat-window">
    <!-- Environment Bar -->
    <div v-if="envInfo" class="env-bar">
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
  height: 100%;
  display: flex;
  flex-direction: column;
}

/* Environment Bar */
.env-bar {
  position: relative;
  background: #18181B;
  border-bottom: 1px solid #27272A;
  padding: 8px 16px;
  font-size: 12px;
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
  padding: 4px 10px;
  border-radius: 4px;
  cursor: pointer;
  font-size: 11px;
  transition: all 0.15s;
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
