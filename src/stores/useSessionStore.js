import { defineStore } from 'pinia'
import { ref, computed, watch, reactive } from 'vue'
import { logger } from '../utils/logger'

/**
 * 日志工具 - 使用新的文件日志系统
 */
function log(...args) {
  // 使用新的日志系统
  const message = args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ')

  logger.info(`[SessionStore] ${message}`)

  // 同时也保留控制台输出（方便调试）
  console.log('[SessionStore]', ...args)
}

/**
 * SessionData
 * 每个会话的完整状态（包含 UI 状态和消息）
 */
class SessionData {
  constructor(id, projectPath) {
    this.id = id
    this.projectPath = projectPath

    // 消息列表
    this.messages = []
    this.rawMessages = [] // 原始消息数据

    // UI 状态
    this.inputMessage = ''
    this.isProcessing = false
    this.inputHistory = []
    this.historyIndex = -1

    // 权限相关
    this.pendingPermission = null
    this.pendingControlRequest = null
    this.pendingQuestion = null  // AskUserQuestion 请求

    // 环境信息
    this.envInfo = null

    // Claude 状态
    this.claudeReady = false

    // 流式状态
    this.currentAssistantMessageIndex = -1
    this.currentContentBlockType = null
    this.contentBlockIndexToId = new Map()
    this.currentTurnNumber = 0
    this.hasSeenToolUseInCurrentTurn = false
    this.currentStreamingAssistantId = null // 用于去重
  }
}

/**
 * SessionStore
 * 管理所有会话的状态
 */
export const useSessionStore = defineStore('session', () => {
  // 所有会话的数据
  const sessions = ref(new Map())

  // 当前活跃的会话 ID
  const currentSessionId = ref(null)

  // 当前会话的计算属性
  const currentSession = computed(() => {
    if (!currentSessionId.value) return null
    return sessions.value.get(currentSessionId.value) || null
  })

  // 当前会话的消息（便捷访问）
  const currentMessages = computed(() => {
    return currentSession.value?.messages || []
  })

  // 当前会话是否正在处理
  const isProcessing = computed(() => {
    return currentSession.value?.isProcessing || false
  })

  // 当前会话的 AskUserQuestion 请求
  const pendingQuestion = computed(() => currentSession.value?.pendingQuestion || null)

  // 当前会话的输入框内容
  const inputMessage = computed({
    get: () => currentSession.value?.inputMessage || '',
    set: (value) => {
      if (currentSession.value) {
        currentSession.value.inputMessage = value
      }
    }
  })

  // 事件取消订阅函数
  let eventUnsubscribe = null

  /**
   * 初始化会话
   */
  async function initSession(sessionId, projectPath) {
    log('[SessionStore] Initializing session:', sessionId)

    try {
      // 调用后端创建/获取 SessionInstance
      const result = await window.electronAPI.selectSession({
        sessionId,
        projectPath
      })

      if (!result.success) {
        console.error('[SessionStore] Failed to init session:', result.error)
        throw new Error(result.error)
      }

      // 创建前端 SessionData，使用 reactive 包装以支持响应式更新
      const sessionData = reactive(new SessionData(sessionId, projectPath))

      // 从后端状态恢复数据
      if (result.state) {
        // 使用 reactive 包装每个消息对象以确保响应式
        sessionData.messages = (result.state.messages || []).map(msg => reactive(msg))
        sessionData.inputHistory = result.state.inputHistory || []
        sessionData.envInfo = result.state.envInfo || null
        sessionData.claudeReady = result.state.claudeReady || false
      }

      // 存储到 Map
      sessions.value.set(sessionId, sessionData)

      // 设置为当前会话
      currentSessionId.value = sessionId

      log('[SessionStore] Session initialized:', sessionId)
      return sessionData
    } catch (error) {
      console.error('[SessionStore] Init session error:', error)
      throw error
    }
  }

  /**
   * 切换到指定会话
   */
  async function switchToSession(sessionId, projectPath) {
    // 如果会话已存在，直接切换
    if (sessions.value.has(sessionId)) {
      currentSessionId.value = sessionId
      return sessions.value.get(sessionId)
    }

    // 否则初始化新会话
    return initSession(sessionId, projectPath)
  }

  /**
   * 关闭会话
   */
  async function closeSession(sessionId) {
    try {
      await window.electronAPI.closeSession({ sessionId })
    } catch (e) {
      console.error('[SessionStore] Close session error:', e)
    }

    // 从 Map 中移除
    sessions.value.delete(sessionId)

    // 如果关闭的是当前会话，清除当前会话 ID
    if (currentSessionId.value === sessionId) {
      currentSessionId.value = null
    }
  }

  /**
   * 发送消息
   * 注意：不在这里添加消息，让后端统一管理并通过事件发送
   */
  async function sendMessage(content) {
    const session = currentSession.value
    if (!session) {
      throw new Error('No active session')
    }

    const sessionId = session.id

    // 保存输入历史
    if (content && (session.inputHistory.length === 0 || session.inputHistory[session.inputHistory.length - 1] !== content)) {
      session.inputHistory.push(content)
      if (session.inputHistory.length > 100) {
        session.inputHistory.shift()
      }
    }
    session.historyIndex = -1

    // 清空输入框，设置处理中
    // 注意：不在这里添加消息，后端会通过 'message' 事件发送
    session.inputMessage = ''
    session.isProcessing = true

    try {
      await window.electronAPI.sendMessage({
        sessionId,
        content
      })
    } catch (error) {
      session.isProcessing = false
      session.messages.push({
        id: `error-${Date.now()}`,
        role: 'system',
        content: `Error: ${error.message}`,
        timestamp: new Date()
      })
      throw error
    }
  }

  /**
   * 发送控制响应（权限批准/拒绝）
   */
  async function sendControlResponse(requestId, approved, options = {}) {
    const session = currentSession.value
    if (!session) return

    session.pendingControlRequest = null
    session.pendingQuestion = null

    await window.electronAPI.sendControlResponse({
      sessionId: session.id,
      requestId,
      approved,
      options
    })
  }

  /**
   * 发送工具结果（用于普通 tool_use 权限响应）
   */
  async function sendToolResult(toolUseId, content, isError = false) {
    const session = currentSession.value
    if (!session) return

    session.pendingPermission = null

    await window.electronAPI.sendToolResult({
      sessionId: session.id,
      toolUseId,
      content,
      isError
    })
  }

  /**
   * 发送中断请求
   */
  async function sendInterrupt() {
    const session = currentSession.value
    if (!session) return

    await window.electronAPI.sendInterrupt({ sessionId: session.id })
  }

  /**
   * 发送控制请求（主动请求，如切换权限模式、rewind）
   * @returns {Promise} 返回一个 Promise，在收到 control-response 时解析
   */
  async function sendControlRequest(request) {
    const session = currentSession.value
    if (!session) return

    // 创建一个 Promise 来等待响应
    const responsePromise = new Promise((resolve, reject) => {
      // 设置超时，避免永久等待
      const timeout = setTimeout(() => {
        session.pendingControlRequestResult = null
        reject(new Error('Control request timeout'))
      }, 30000) // 30 秒超时

      // 保存 resolve 和 reject 函数，在 handleControlResponse 中调用
      session.pendingControlRequestResult = {
        resolve: (data) => {
          clearTimeout(timeout)
          resolve(data)
        },
        reject: (error) => {
          clearTimeout(timeout)
          reject(error)
        }
      }
    })

    // 发送请求
    await window.electronAPI.sendControlRequest({
      sessionId: session.id,
      request
    })

    // 返回 Promise，让调用者可以 await 响应
    return responsePromise
  }

  /**
   * 设置权限模式
   */
  async function setPermissionMode(mode) {
    const session = currentSession.value
    if (!session) return

    await window.electronAPI.setPermissionMode({
      sessionId: session.id,
      mode
    })
  }

  /**
   * 处理从后端收到的事件
   */
  function handleSessionEvent(event) {
    const { sessionId, eventType, data } = event

    // 获取对应的会话
    const session = sessions.value.get(sessionId)
    if (!session) {
      log('[SessionStore] Event for unknown session:', sessionId)
      return
    }

    // 根据事件类型处理
    switch (eventType) {
      case 'message':
        handleAddMessage(session, data)
        break

      case 'result':
        handleResult(session, data)
        break

      case 'stream-event':
        handleStreamEvent(session, data)
        break

      case 'control-request':
        handleControlRequest(session, data)
        break

      case 'control-response':
        handleControlResponse(session, data)
        break

      case 'interrupt':
        handleInterrupt(session, data)
        break

      case 'env-info':
        session.envInfo = data
        break

      case 'cli-status':
        // CLI 状态消息，可以显示在状态栏
        log('[CLI Status]', data.message)
        break

      case 'tool-use':
        handleToolUse(session, data)
        break

      case 'tool-result':
        handleToolResult(session, data)
        break

      case 'state-update':
        handleStateUpdate(session, data)
        break

      default:
        log('[SessionStore] Unknown event type:', eventType)
    }
  }

  /**
   * 添加消息
   * 注意：对于 assistant 消息，需要检查是否已有流式创建的消息
   */
  function handleAddMessage(session, message) {
    // 如果是 assistant 消息，检查是否已有流式创建的消息
    if (message.role === 'assistant') {
      // 查找是否有正在流式传输的 assistant 消息
      const streamingIndex = session.messages.findIndex(m =>
        m.role === 'assistant' && (m.isStreaming || m.id === session.currentStreamingAssistantId)
      )

      if (streamingIndex >= 0) {
        // 更新现有消息而不是添加新消息
        const existingMsg = session.messages[streamingIndex]
        existingMsg.content = message.content || existingMsg.content
        existingMsg.isStreaming = false
        if (message.rawMessage) {
          existingMsg.rawMessage = message.rawMessage
        }
        return
      }
    }

    // 使用 reactive 包装消息对象以确保响应式
    session.messages.push(reactive(message))
  }

  /**
   * 处理 result（包含 usage 信息）
   */
  function handleResult(session, result) {
    log('[SessionStore] handleResult called')
    log('[SessionStore] Full result object:', JSON.stringify(result, null, 2))

    // 清除流式消息标记
    session.currentStreamingAssistantId = null

    // 提取数据 - 支持多种可能的字段名格式
    const durationMs = result.duration_ms || result.durationMs || result.duration || null
    const numTurns = result.num_turns || result.numTurns || result.turns || null
    const usage = result.usage || result.tokenUsage || null

    log('[SessionStore] Extracted: durationMs=', durationMs, 'numTurns=', numTurns, 'usage=', usage)

    // 更新最后一个用户消息的统计信息
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === 'user') {
        const userMsg = session.messages[i]
        log('[SessionStore] Found user message at index', i, 'startTime:', userMsg.startTime)

        // 使用 Object.assign 确保响应式更新
        Object.assign(userMsg, {
          duration: durationMs,
          numTurns: numTurns,
          usage: usage
        })

        log('[SessionStore] Updated user message:', JSON.stringify({
          duration: userMsg.duration,
          numTurns: userMsg.numTurns,
          usage: userMsg.usage
        }))
        break
      }
    }

    // 更新最后一个 assistant 消息的统计信息
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === 'assistant') {
        const assistantMsg = session.messages[i]
        log('[SessionStore] Found assistant message at index', i)

        // 只更新usage，保留duration（因为每个turn应该有自己的duration）
        // 只有当result中有durationMs时才更新（通常只有最终result才有）
        const updates = {
          usage: usage,
          isStreaming: false
        }
        if (durationMs !== null && durationMs !== undefined) {
          updates.duration = durationMs
        }

        Object.assign(assistantMsg, updates)

        log('[SessionStore] Updated assistant message:', JSON.stringify({
          duration: assistantMsg.duration,
          usage: assistantMsg.usage
        }))
        break
      }
    }

    // 解锁输入
    session.isProcessing = false
  }

  /**
   * 处理流式事件
   * 处理 content_block_start, content_block_delta, message_start 等
   */
  function handleStreamEvent(session, message) {
    const event = message.event
    if (!event) return

    // Handle turn_start - 统计 turn 数量
    if (event.type === 'turn_start') {
      session.currentTurnNumber++
      updateUserMessageTurns(session, session.currentTurnNumber)
      return
    }

    // 检查是否有 usage 信息，并更新到当前 assistant 消息
    const usage = message.usage || event.usage || event.message?.usage || event.content_block?.usage
    if (usage && session.currentAssistantMessageIndex >= 0 && session.messages[session.currentAssistantMessageIndex]) {
      // 更新当前 assistant 消息的 usage（每个 assistant 消息对应一个 turn）
      const assistantMsg = session.messages[session.currentAssistantMessageIndex]
      assistantMsg.usage = { ...usage }

      // 同时累加到 user 消息（用于显示总的使用量）
      accumulateUserMessageUsage(session, usage)
    }

    // Handle message_start - 创建消息并显示"正在思考"状态
    if (event.type === 'message_start') {
      session.currentAssistantMessageIndex = -1
      session.currentContentBlockType = null
      session.contentBlockIndexToId.clear()
      session.currentTurnNumber = 0
      session.hasSeenToolUseInCurrentTurn = false

      const initialUsage = event.message?.usage || null
      const messageId = event.message?.id || `assistant-${Date.now()}`

      // 保存当前流式消息 ID，用于去重
      session.currentStreamingAssistantId = messageId

      session.messages.push({
        id: messageId,
        role: 'assistant',
        content: '',
        thinking: '',
        hasThinking: false,
        isStreaming: true,
        startTime: Date.now(),
        timestamp: new Date(),
        usage: initialUsage,
        turnNumber: 1,
        rawMessages: [message]
      })
      session.currentAssistantMessageIndex = session.messages.length - 1

      updateUserMessageTurns(session, 1)
      if (initialUsage) {
        // 累加到 user 消息的 usage 统计
        accumulateUserMessageUsage(session, initialUsage)
      }
      return
    }

    // Handle content_block_start
    if (event.type === 'content_block_start') {
      const contentBlock = event.content_block
      session.currentContentBlockType = contentBlock?.type

      if (contentBlock?.type === 'thinking') {
        if (session.hasSeenToolUseInCurrentTurn) {
          session.currentTurnNumber++
          session.hasSeenToolUseInCurrentTurn = false
        }
        const currentMsg = session.currentAssistantMessageIndex >= 0 ? session.messages[session.currentAssistantMessageIndex] : null
        if (currentMsg && currentMsg.role === 'assistant') {
          currentMsg.hasThinking = true
          currentMsg.thinkingCollapsed = false
          currentMsg.turnNumber = session.currentTurnNumber + 1
          if (session.currentTurnNumber > 0) {
            currentMsg.showTurnSeparator = true
          }
        }
      } else if (contentBlock?.type === 'tool_use') {
        session.hasSeenToolUseInCurrentTurn = true
        if (contentBlock.name === 'AskUserQuestion') {
          return
        }
        const toolUseData = contentBlock
        log('[SessionStore] content_block_start tool_use:', {
          toolName: toolUseData.name,
          toolUseId: toolUseData.id,
          inputKeys: toolUseData.input ? Object.keys(toolUseData.input) : [],
          input: toolUseData.input,
          fullEvent: event
        })
        if (typeof event.index === 'number') {
          session.contentBlockIndexToId.set(event.index, toolUseData.id)
        }
        session.messages.push({
          id: toolUseData.id || `tool-${Date.now()}`,
          role: 'tool_use',
          toolName: toolUseData.name,
          toolInput: toolUseData.input ? { ...toolUseData.input } : {},
          toolInputBuffer: '', // 用于累积 input_json_delta 片段
          result: '',
          isError: false,
          isExecuting: true,
          request_id: toolUseData.id,
          collapsed: false,
          thinking: '',
          hasThinking: false,
          timestamp: new Date(),
          startTime: Date.now(),
          rawMessages: [message]
        })
      }
      return
    }

    // Handle content_block_delta
    if (event.type === 'content_block_delta') {
      const delta = event.delta

      // Handle thinking_delta
      if (delta?.type === 'thinking_delta' && delta.thinking) {
        if (session.currentAssistantMessageIndex >= 0 && session.messages[session.currentAssistantMessageIndex]) {
          const msg = session.messages[session.currentAssistantMessageIndex]
          msg.thinking = (msg.thinking || '') + delta.thinking
          msg.hasThinking = true
          if (!msg.rawMessages) msg.rawMessages = []
          msg.rawMessages.push(message)
        }
      }

      // Handle text_delta
      if (delta?.type === 'text_delta' && delta.text) {
        if (session.currentAssistantMessageIndex >= 0 && session.messages[session.currentAssistantMessageIndex]) {
          const msg = session.messages[session.currentAssistantMessageIndex]
          msg.content = (msg.content || '') + delta.text
          if (!msg.rawMessages) msg.rawMessages = []
          msg.rawMessages.push(message)
        }
      }

      // Handle input_json_delta (tool use partial JSON)
      if (delta?.type === 'input_json_delta' && delta.partial_json) {
        const contentBlockId = session.contentBlockIndexToId.get(event.index)
        const toolUseMsgIndex = session.messages.findLastIndex(m =>
          m.role === 'tool_use' && m.request_id === contentBlockId
        )

        if (toolUseMsgIndex >= 0) {
          const toolUseMsg = session.messages[toolUseMsgIndex]

          // 累积 partial_json 片段
          if (!toolUseMsg.toolInputBuffer) {
            toolUseMsg.toolInputBuffer = ''
          }
          toolUseMsg.toolInputBuffer += delta.partial_json

          log('[SessionStore] input_json_delta:', {
            contentBlockId,
            toolUseMsgIndex,
            partial_json: delta.partial_json,
            bufferLength: toolUseMsg.toolInputBuffer.length,
            currentToolInput: toolUseMsg.toolInput,
            toolName: toolUseMsg.toolName
          })

          // 尝试解析累积的缓冲区
          try {
            const parsedInput = JSON.parse(toolUseMsg.toolInputBuffer)
            toolUseMsg.toolInput = { ...parsedInput }
            log('[SessionStore] Updated toolInput from buffer:', {
              toolUseId: contentBlockId,
              parsedInputKeys: Object.keys(parsedInput),
              newToolInput: toolUseMsg.toolInput,
              buffer: toolUseMsg.toolInputBuffer
            })
          } catch (e) {
            // JSON 还不完整，忽略 - 继续累积
            log('[SessionStore] JSON not complete yet, buffer length:', toolUseMsg.toolInputBuffer.length)
          }
        }
      }

      return
    }

    // Handle content_block_stop
    if (event.type === 'content_block_stop') {
      // 可以在这里处理内容块结束
      return
    }

    // Handle message_stop - 计算并设置 duration
    if (event.type === 'message_stop') {
      if (session.currentAssistantMessageIndex >= 0 && session.messages[session.currentAssistantMessageIndex]) {
        const assistantMsg = session.messages[session.currentAssistantMessageIndex]
        assistantMsg.isStreaming = false

        // 计算并设置 duration（从消息开始到现在的耗时）
        if (assistantMsg.startTime && !assistantMsg.duration) {
          assistantMsg.duration = Date.now() - assistantMsg.startTime
        }

        // 自动折叠思考过程（如果有的话）
        if (assistantMsg.hasThinking && assistantMsg.thinking) {
          assistantMsg.thinkingCollapsed = true
        }
      }
      session.currentAssistantMessageIndex = -1
      session.currentContentBlockType = null
      // 注意：不清除 currentStreamingAssistantId，等待 result 或 assistant 消息到达后再清除
      return
    }
  }

  // 辅助函数：累加更新用户消息的 usage 统计
  function accumulateUserMessageUsage(session, newUsage) {
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === 'user') {
        const userMsg = session.messages[i]
        const currentUsage = userMsg.usage || { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 }
        userMsg.usage = {
          input_tokens: (currentUsage.input_tokens || 0) + (newUsage.input_tokens || 0),
          output_tokens: (currentUsage.output_tokens || 0) + (newUsage.output_tokens || 0),
          cache_read_input_tokens: (currentUsage.cache_read_input_tokens || 0) + (newUsage.cache_read_input_tokens || 0)
        }
        break
      }
    }
  }

  // 辅助函数：更新用户消息的 turn 数量
  function updateUserMessageTurns(session, numTurns) {
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === 'user') {
        session.messages[i].numTurns = numTurns
        break
      }
    }
  }

  /**
   * 处理控制请求（权限/AskUserQuestion）
   */
  function handleControlRequest(session, data) {
    log('[SessionStore] handleControlRequest called')
    log('[SessionStore] Full data object:', JSON.stringify(data, null, 2))

    // 保存外层的 request_id（用于响应）
    const outerRequestId = data.request_id

    // 获取实际的请求数据（可能嵌套在 request 字段中）
    const requestData = data.request || data

    log('[SessionStore] requestData:', JSON.stringify(requestData, null, 2))

    // 获取 tool_use_id - 支持多种可能的字段名
    const toolUseId = requestData.tool_use_id || requestData.toolUseId || requestData.id || data.tool_use_id

    // 将外层的 request_id 和内层的 tool_use_id 都保留到 mergedRequestData 中
    // 这样前端可以使用正确的 request_id 来响应，同时保留 tool_use_id 用于关联
    const mergedRequestData = {
      ...requestData,
      request_id: outerRequestId || requestData.request_id,
      tool_use_id: toolUseId // 确保 tool_use_id 被保留
    }

    log('[SessionStore] mergedRequestData:', JSON.stringify(mergedRequestData, null, 2))
    log('[SessionStore] tool_use_id:', toolUseId)

    // 检查是否是 AskUserQuestion 请求
    // 支持多种可能的字段名格式
    const toolName = requestData.tool_name || requestData.toolName
    // 支持多种字段名：input, tool_input, toolInput
    let toolInput = requestData.input || requestData.tool_input || requestData.toolInput

    log('[SessionStore] toolName:', toolName)
    log('[SessionStore] raw toolInput type:', typeof toolInput)

    // 如果 toolInput 是字符串，尝试解析为 JSON
    if (typeof toolInput === 'string') {
      try {
        toolInput = JSON.parse(toolInput)
        log('[SessionStore] parsed toolInput keys:', toolInput ? Object.keys(toolInput).join(', ') : 'null')
      } catch (e) {
        log('[SessionStore] Failed to parse input as JSON:', e.message)
      }
    }

    const hasQuestions = toolInput?.questions || requestData.questions
    log('[SessionStore] hasQuestions:', !!hasQuestions)

    if (toolName === 'AskUserQuestion' || hasQuestions) {
      log('[SessionStore] Setting pendingQuestion, request_id:', mergedRequestData.request_id)
      session.pendingQuestion = mergedRequestData
    } else {
      log('[SessionStore] Setting pendingControlRequest, toolName:', toolName, 'request_id:', mergedRequestData.request_id)
      session.pendingControlRequest = mergedRequestData
    }
  }

  /**
   * 处理控制响应（rewind/fork 等操作的结果）
   */
  function handleControlResponse(session, data) {
    log('[SessionStore] handleControlResponse called')
    log('[SessionStore] Response data:', JSON.stringify(data, null, 2))

    // 检查是否有待处理的控制请求
    if (session.pendingControlRequestResult) {
      // 解析响应并传递给等待的 Promise
      session.pendingControlRequestResult.resolve(data)
      session.pendingControlRequestResult = null
    }
  }

  /**
   * 处理中断
   */
  function handleInterrupt(session, data) {
    session.isProcessing = false

    // 添加中断消息
    session.messages.push({
      id: `interrupt-${Date.now()}`,
      role: 'system',
      content: '已中断',
      timestamp: new Date()
    })
  }

  /**
   * 处理工具使用
   */
  function handleToolUse(session, data) {
    log('[SessionStore] handleToolUse called:', {
      dataKeys: Object.keys(data),
      hasMessage: !!data.message,
      hasContent: !!data.content,
      messageContentKeys: data.message?.content ? data.message.content.map(c => c.type) : [],
      directContentKeys: data.content ? data.content.map(c => c.type) : []
    })

    // 支持两种格式：data.message.content 或 data.content
    const content = data.message?.content || data.content
    if (content) {
      const toolUseContent = content.find(c => c.type === 'tool_use')
      if (toolUseContent) {
        log('[SessionStore] toolUseContent found:', {
          toolName: toolUseContent.name,
          toolUseId: toolUseContent.id,
          inputKeys: toolUseContent.input ? Object.keys(toolUseContent.input) : [],
          input: toolUseContent.input
        })
        // 查找是否已存在相同的 tool_use 消息（通过 id 或 request_id 匹配）
        const existingMsgIndex = session.messages.findIndex(m =>
          (m.role === 'tool_use' && m.id === toolUseContent.id) ||
          (m.role === 'tool_use' && m.request_id === toolUseContent.id)
        )

        if (existingMsgIndex >= 0) {
          // 更新现有消息
          const existingMsg = session.messages[existingMsgIndex]
          log('[SessionStore] Updating existing tool_use message:', {
            index: existingMsgIndex,
            existingToolInput: existingMsg.toolInput,
            newToolInput: toolUseContent.input
          })
          existingMsg.toolInput = toolUseContent.input || {}
          existingMsg.toolName = toolUseContent.name
          existingMsg.isExecuting = true
          // 保留其他字段（如 startTime, timestamp 等）
        } else {
          // 创建新消息（如果流式传输没有创建）
          log('[SessionStore] Creating new tool_use message (no streamed version found)')
          session.messages.push({
            id: toolUseContent.id || `tool-${Date.now()}`,
            role: 'tool_use',
            toolName: toolUseContent.name,
            toolInput: toolUseContent.input,
            toolInputBuffer: '', // 用于一致性，虽然可能不需要
            result: '',
            isError: false,
            isExecuting: true,
            timestamp: new Date(),
            startTime: Date.now()
          })
        }
      }
    }
  }

  /**
   * 处理工具结果
   */
  function handleToolResult(session, data) {
    log('[SessionStore] handleToolResult called')
    log('[SessionStore] Full data:', JSON.stringify(data, null, 2))

    if (data.message?.content) {
      const toolResultContent = data.message.content.find(c => c.type === 'tool_result')
      if (toolResultContent) {
        const toolUseId = toolResultContent.tool_use_id
        log('[SessionStore] tool_result for tool_use_id:', toolUseId)

        // 先检查是否是 AskUserQuestion 的结果（对应 role === 'question' 的消息）
        for (let i = session.messages.length - 1; i >= 0; i--) {
          const msg = session.messages[i]
          if (msg.role === 'question' && msg.tool_use_id === toolUseId) {
            log('[SessionStore] Found question message for AskUserQuestion result')
            msg.resultReceived = true

            // 从 data.tool_use_result.answers 获取实际收到的答案
            // 这是原始的 JSON 答案对象，而不是 content 中的处理后的文本
            if (data.tool_use_result?.answers) {
              msg.receivedAnswers = data.tool_use_result.answers
              log('[SessionStore] receivedAnswers from tool_use_result:', JSON.stringify(msg.receivedAnswers))

              // 比较用户提交的答案和收到的答案是否一致
              if (msg.userAnswers) {
                msg.answersConsistent = compareAnswers(msg.userAnswers, msg.receivedAnswers)
                log('[SessionStore] userAnswers:', JSON.stringify(msg.userAnswers))
                log('[SessionStore] answersConsistent:', msg.answersConsistent)
              }
            }

            break
          }
        }

        // 然后检查普通的 tool_use 消息
        for (let i = session.messages.length - 1; i >= 0; i--) {
          const msg = session.messages[i]
          if (msg.role === 'tool_use' && msg.id === toolUseId) {
            msg.isExecuting = false
            msg.isError = toolResultContent.is_error
            msg.result = toolResultContent.content || '(无输出)'
            msg.duration = Date.now() - (msg.startTime || Date.now())
            break
          }
        }
      }
    }
  }

  /**
   * 比较用户答案和收到的答案是否一致
   */
  function compareAnswers(userAnswers, receivedAnswers) {
    if (!userAnswers || !receivedAnswers) return false

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

  /**
   * 处理状态更新
   */
  function handleStateUpdate(session, data) {
    if (data.isProcessing !== undefined) {
      session.isProcessing = data.isProcessing
    }
    if (data.inputMessage !== undefined) {
      session.inputMessage = data.inputMessage
    }
  }

  /**
   * 开始监听后端事件
   */
  function startEventListener() {
    if (eventUnsubscribe) {
      eventUnsubscribe()
    }

    eventUnsubscribe = window.electronAPI.onSessionEvent((event) => {
      handleSessionEvent(event)
    })
  }

  /**
   * 停止监听后端事件
   */
  function stopEventListener() {
    if (eventUnsubscribe) {
      eventUnsubscribe()
      eventUnsubscribe = null
    }
  }

  /**
   * 清除所有会话
   */
  function clearAll() {
    sessions.value.clear()
    currentSessionId.value = null
  }

  /**
   * 添加消息到当前会话（供前端直接添加消息使用）
   */
  function addMessage(message) {
    const session = currentSession.value
    if (session) {
      session.messages.push(message)
    }
  }

  /**
   * 更新指定消息（用于 tool_use 结果更新等）
   */
  function updateMessage(predicate, updates) {
    const session = currentSession.value
    if (!session) return false

    const index = session.messages.findIndex(predicate)
    if (index !== -1) {
      session.messages[index] = { ...session.messages[index], ...updates }
      return true
    }
    return false
  }

  /**
   * 设置权限请求（来自后端事件）
   */
  function setPendingPermission(permission) {
    const session = currentSession.value
    if (session) {
      session.pendingPermission = permission
    }
  }

  /**
   * 设置控制请求（来自后端事件）
   */
  function setPendingControlRequest(request) {
    const session = currentSession.value
    if (session) {
      session.pendingControlRequest = request
    }
  }

  /**
   * 清除当前会话的权限和控制请求
   */
  function clearPendingPermissions() {
    const session = currentSession.value
    if (session) {
      session.pendingPermission = null
      session.pendingControlRequest = null
      session.pendingQuestion = null
    }
  }

  /**
   * 清除当前会话的 AskUserQuestion 请求
   */
  function clearPendingQuestion() {
    const session = currentSession.value
    if (session) {
      session.pendingQuestion = null
    }
  }

  return {
    // State
    sessions,
    currentSessionId,
    currentSession,
    currentMessages,
    isProcessing,
    inputMessage,
    pendingQuestion,

    // Actions
    initSession,
    switchToSession,
    openSession: switchToSession, // 别名，兼容旧代码
    closeSession,
    sendMessage,
    sendControlResponse,
    sendToolResult,
    sendInterrupt,
    sendControlRequest,
    setPermissionMode,
    startEventListener,
    stopEventListener,
    clearAll,
    addMessage,
    updateMessage,
    setPendingPermission,
    setPendingControlRequest,
    clearPendingPermissions,
    clearPendingQuestion
  }
})
