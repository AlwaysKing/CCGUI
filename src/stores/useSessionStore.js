import { defineStore } from 'pinia'
import { ref, computed, watch, reactive } from 'vue'
import { logger } from '../utils/logger'

/**
 * 日志工具 - 使用新的文件日志系统
 */
function log(...args) {
  const message = args.map(arg =>
    typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
  ).join(' ')

  logger.info(`[SessionStore] ${message}`)
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
    this.pendingPermissions = []
    this.pendingControlRequests = [] // 改为队列以支持并发请求
    this.pendingQuestion = null  // AskUserQuestion 请求
    this.lastPermissionRequest = null // 用于在收到 CLI 响应时添加权限结果消息

    // 环境信息
    this.envInfo = null
    this.silentMessages = []

    // Runtime 状态
    this.runtimeReady = false

    // 流式状态
    this.currentAssistantMessageIndex = -1
    this.currentContentBlockType = null
    this.contentBlockIndexToId = new Map()
    this.currentTurnNumber = 0
    this.hasSeenToolUseInCurrentTurn = false
    this.currentStreamingAssistantId = null // 用于去重

    this.permissionMode = 'default' // 当前权限模式
    this.fastModeState = 'off' // 快速模式状态: 'off' | 'auto' | 'on'
    this.activeTasks = new Map() // 活跃的子任务 Map<taskId, taskData>
  }
}

/**
 * SessionStore
 * 管理所有会话的状态
 */
export const useSessionStore = defineStore('session', () => {
  function resolveNotificationScope(notificationType, data = {}) {
    const type = notificationType || data?.type || ''
    if (
      type === 'runtime-exit' ||
      type === 'runtime-stopped' ||
      type === 'session-runtime-starting' ||
      type === 'session-runtime-restarting' ||
      type === 'session-runtime-ready' ||
      type === 'session-config-applied' ||
      type === 'session-effort-changed'
    ) {
      return 'session'
    }

    return 'turn'
  }

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

  // 当前会话的工具权限请求（队列中的第一个）
  const pendingPermission = computed(() => {
    const requests = currentSession.value?.pendingPermissions
    return (requests && requests.length > 0) ? requests[0] : null
  })

  // 当前会话的 AskUserQuestion 请求
  const pendingQuestion = computed(() => currentSession.value?.pendingQuestion || null)

  // 当前会话的控制请求（队列中的第一个）
  const pendingControlRequest = computed(() => {
    const requests = currentSession.value?.pendingControlRequests
    return (requests && requests.length > 0) ? requests[0] : null
  })

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
        sessionData.silentMessages = (result.state.silentMessages || []).map(msg => reactive(msg))
        sessionData.runtimeReady = result.state.runtimeReady || false
        if (result.state.pendingPermission) {
          sessionData.pendingPermissions = [reactive(result.state.pendingPermission)]
        }
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

    // 清理悬浮框中的任务（发起新提问时清理上一轮的任务）
    session.activeTasks.clear()
    log('[SessionStore] Cleared active tasks for new message')

    try {
      const result = await window.electronAPI.sendMessage({
        sessionId,
        content
      })

      if (!result?.success) {
        throw new Error(result?.error || '发送消息失败')
      }
    } catch (error) {
      session.isProcessing = false
      session.inputMessage = content
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

    removePendingControlRequest(session, requestId)
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
  async function sendRuntimeToolResult(toolUseId, content, isError = false) {
    const session = currentSession.value
    if (!session) return

    removePendingPermission(session, toolUseId)

    await window.electronAPI.sendRuntimeToolResult({
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

  async function listSessionSubmodels(options = {}) {
    const session = currentSession.value
    if (!session) {
      throw new Error('No active session')
    }

    return window.electronAPI.listSessionSubmodels({
      sessionId: session.id,
      ...options
    })
  }

  async function setSessionSubmodel(options = {}) {
    const session = currentSession.value
    if (!session) {
      throw new Error('No active session')
    }

    return window.electronAPI.setSessionSubmodel({
      sessionId: session.id,
      ...options
    })
  }

  async function setSessionModel(options = {}) {
    const session = currentSession.value
    if (!session) {
      throw new Error('No active session')
    }

    return window.electronAPI.setSessionModel({
      sessionId: session.id,
      ...options
    })
  }

  async function listSessionEffortOptions(options = {}) {
    const session = currentSession.value
    if (!session) {
      throw new Error('No active session')
    }

    return window.electronAPI.listSessionEffortOptions({
      sessionId: session.id,
      ...options
    })
  }

  async function setSessionEffort(options = {}) {
    const session = currentSession.value
    if (!session) {
      throw new Error('No active session')
    }

    return window.electronAPI.setSessionEffort({
      sessionId: session.id,
      ...options
    })
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

      case 'message-start':
        // 后端发送的消息创建事件
        handleMessageStart(session, data)
        break

      case 'message-delta':
        // 后端发送的增量更新事件
        handleMessageDelta(session, data)
        break

      case 'message-complete':
        // 后端发送的消息完成事件
        handleMessageComplete(session, data)
        break

      case 'message-update':
        // 后端发送的字段更新事件
        handleMessageUpdate(session, data)
        break

      case 'tool-result':
        handleToolResult(session, data)
        break

      case 'result':
        handleResult(session, data)
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
        session.runtimeReady = Boolean(data?.providerPid)
        break

      case 'silent-message':
        session.silentMessages.push(reactive(data))
        break

      case 'cli-status':
        // CLI 状态消息，显示在消息列表中
        log('[CLI Status]', data.message)
        handleCliStatus(session, data)
        break

      case 'state-update':
        handleStateUpdate(session, data)
        break

      case 'permission-mode-change':
        // Runtime 主动切换权限模式
        log('[SessionStore] Permission mode changed:', data)
        session.permissionMode = data
        break

      case 'fast-mode-change':
        // 快速模式状态变化
        log('[SessionStore] Fast mode state changed:', data)
        session.fastModeState = data
        break

      case 'system-notification':
        // 系统通知（权限模式切换、压缩边界等）
        log('[SessionStore] System notification:', data)
        handleSystemNotification(session, data)
        break

      case 'task-event':
        // 子任务事件（started/progress/notification）
        log('[SessionStore] Task event:', data)
        handleTaskEvent(session, data)
        break

      case 'system-message':
        // 未处理的 system 消息，显示为 unknown 消息
        log('[SessionStore] System message:', data)
        handleUnknownMessage(session, data)
        break

      case 'unknown-message':
        // 未知消息类型，显示为 unknown 消息
        log('[SessionStore] Unknown message:', data)
        handleUnknownMessage(session, data)
        break

      case 'abnormal-exit':
        // Runtime 进程异常退出
        log('[SessionStore] Runtime process abnormal exit:', data)
        handleAbnormalExit(session, data)
        break

      case 'normal-exit':
        // Runtime 进程正常停止（用户手动停止）
        log('[SessionStore] Runtime process normal exit:', data)
        handleNormalExit(session, data)
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

      // 处理 tool_result 之后的 assistant 消息（ID 不匹配的情况）
      // 查找是否有刚完成 tool_use 的 assistant 消息（isStreaming 已设置为 false 但没有 content）
      const justFinishedIndex = session.messages.findIndex(m =>
        m.role === 'assistant' && m.content === '' && !m.isStreaming
      )
      if (justFinishedIndex >= 0) {
        const existingMsg = session.messages[justFinishedIndex]
        existingMsg.content = message.content || existingMsg.content
        existingMsg.isStreaming = false
        if (message.rawMessage) {
          existingMsg.rawMessage = message.rawMessage
        }
        log('[SessionStore] handleAddMessage: updated assistant message after tool_result')
        return
      }
    }

    // 处理 tool_result 消息：更新对应的 tool_use 消息而不是添加新消息
    if (message.role === 'user' && Array.isArray(message.content)) {
      const toolResultContent = message.content.find(c => c.type === 'tool_result')
      if (toolResultContent) {
        const toolUseId = toolResultContent.tool_use_id
        log('[SessionStore] handleAddMessage: found tool_result for tool_use_id:', toolUseId)

        // 查找对应的 tool_use 消息并更新结果
        for (let i = session.messages.length - 1; i >= 0; i--) {
          const msg = session.messages[i]
          if (msg.role === 'tool_use' && (msg.id === toolUseId || msg.request_id === toolUseId)) {
            msg.isExecuting = false
            msg.isError = toolResultContent.is_error
            msg.result = toolResultContent.content || '(无输出)'
            msg.duration = Date.now() - (msg.startTime || Date.now())
            log('[SessionStore] handleAddMessage: updated tool_use message result')
            return // 不添加新消息
          }
        }
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

    // 移除 status 消息（如"正在启动运行时..."）
    const statusIndex = session.messages.findIndex(m => m.role === 'status')
    if (statusIndex >= 0) {
      session.messages.splice(statusIndex, 1)
    }

    // 清除流式消息标记
    session.currentStreamingAssistantId = null
    session.pendingQuestion = null
    session.pendingPermissions = []
    session.pendingControlRequests = []

    // 强制收尾残留的流式/执行态，避免某些边缘事件没成对回来时 UI 一直卡住
    session.messages.forEach(msg => {
      if (msg.isStreaming) {
        msg.isStreaming = false
        if (!msg.duration && msg.startTime) {
          msg.duration = Date.now() - msg.startTime
        }
      }

      if (msg.isExecuting) {
        msg.isExecuting = false
        if (!msg.duration && msg.startTime) {
          msg.duration = Date.now() - msg.startTime
        }
      }
    })

    // 提取统一 result 语义
    const latestUserMessage = [...session.messages].reverse().find(msg => msg.role === 'user') || null
    const latestAssistantMessage = [...session.messages].reverse().find(msg =>
      msg.role === 'assistant' && ((msg.content && msg.content.trim()) || (msg.thinking && msg.thinking.trim()))
    ) || [...session.messages].reverse().find(msg => msg.role === 'assistant') || null

    const durationMs =
      result.duration_ms ??
      latestUserMessage?.duration ??
      (latestUserMessage?.startTime ? Date.now() - latestUserMessage.startTime : null)

    const numTurns =
      result.num_turns ??
      latestUserMessage?.numTurns ??
      1

    const usage =
      result.usage ??
      latestUserMessage?.usage ??
      latestAssistantMessage?.usage ??
      null

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

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('ccgui-session-complete', {
        detail: {
          sessionId: session.id,
          timestamp: Date.now()
        }
      }))
    }
  }

  function getLatestUserMessage(session) {
    for (let i = session.messages.length - 1; i >= 0; i--) {
      if (session.messages[i].role === 'user') {
        return session.messages[i]
      }
    }
    return null
  }

  function syncUserRealtimeStats(session, updates = {}) {
    const userMsg = getLatestUserMessage(session)
    if (!userMsg) return

    const nextStats = {}

    if (updates.turnNumber !== undefined && updates.turnNumber !== null) {
      nextStats.numTurns = updates.turnNumber
    }

    if (updates.usage !== undefined && updates.usage !== null) {
      nextStats.usage = updates.usage
    }

    if (Object.keys(nextStats).length > 0) {
      Object.assign(userMsg, nextStats)
    }
  }

  /**
   * 处理消息创建事件（来自后端）
   */
  function handleMessageStart(session, message) {
    log('[SessionStore] handleMessageStart:', message.role, message.id)

    const existingIndex = session.messages.findIndex(item => item.id === message.id)
    if (existingIndex >= 0) {
      const existingMessage = session.messages[existingIndex]
      Object.assign(existingMessage, {
        ...message,
        content: existingMessage.content || message.content || '',
        thinking: existingMessage.thinking || message.thinking || '',
        hasThinking: existingMessage.hasThinking || message.hasThinking || false
      })

      if (message.role === 'assistant') {
        session.currentAssistantMessageIndex = existingIndex
      }
      session.currentStreamingAssistantId = message.id
      if (message.role === 'assistant') {
        syncUserRealtimeStats(session, {
          turnNumber: message.turnNumber,
          usage: message.usage
        })
      }
      log('[SessionStore] handleMessageStart: reused existing message', message.id)
      return
    }

    // 添加消息到列表
    session.messages.push(reactive(message))
    session.currentStreamingAssistantId = message.id

    // 根据角色设置初始状态
    if (message.role === 'assistant') {
      session.currentAssistantMessageIndex = session.messages.length - 1
      syncUserRealtimeStats(session, {
        turnNumber: message.turnNumber,
        usage: message.usage
      })
    } else if (message.role === 'tool_use') {
      // 记录 tool_use 的索引
      if (typeof message.request_id === 'number') {
        session.contentBlockIndexToId.set(message.request_id, message.id)
      }
    }
  }

  /**
   * 处理消息增量更新（来自后端）
   */
  function handleMessageDelta(session, data) {
    const { messageId, field, delta } = data

    // 查找对应的消息
    const msgIndex = session.messages.findIndex(m => m.id === messageId)
    if (msgIndex === -1) {
      log('[SessionStore] handleMessageDelta: message not found', messageId)
      return
    }

    const msg = session.messages[msgIndex]

    // 根据字段类型增量更新
    if (field === 'content') {
      msg.content = (msg.content || '') + delta
    } else if (field === 'thinking') {
      msg.thinking = (msg.thinking || '') + delta
      msg.hasThinking = true
    }

    log('[SessionStore] handleMessageDelta:', field, 'delta length:', delta.length)
  }

  /**
   * 处理消息完成事件（来自后端）
   */
  function handleMessageComplete(session, data) {
    const { messageId, updates } = data

    // 查找对应的消息
    const msgIndex = session.messages.findIndex(m => m.id === messageId)
    if (msgIndex === -1) {
      log('[SessionStore] handleMessageComplete: message not found', messageId)
      return
    }

    // 应用更新
    const msg = session.messages[msgIndex]
    Object.assign(msg, updates)
    if (!msg.duration && msg.startTime) {
      msg.duration = Date.now() - msg.startTime
    }

    // 清除流式标记
    if (msg.role === 'assistant') {
      session.currentAssistantMessageIndex = -1
    }
    session.currentStreamingAssistantId = null

    log('[SessionStore] handleMessageComplete:', messageId)
  }

  /**
   * 处理消息字段更新（来自后端）
   */
  function handleMessageUpdate(session, data) {
    const { messageId, updates } = data

    // 查找对应的消息
    const msgIndex = session.messages.findIndex(m => m.id === messageId)
    if (msgIndex === -1) {
      log('[SessionStore] handleMessageUpdate: message not found', messageId)
      return
    }

    // 应用更新
    const msg = session.messages[msgIndex]
    Object.assign(msg, updates)
    if ((updates.isStreaming === false || updates.isExecuting === false) && !msg.duration && msg.startTime) {
      msg.duration = Date.now() - msg.startTime
    }

    if (msg.role === 'assistant') {
      syncUserRealtimeStats(session, {
        turnNumber: updates.turnNumber ?? msg.turnNumber,
        usage: updates.usage ?? msg.usage
      })
    }

    log('[SessionStore] handleMessageUpdate:', messageId, 'updates:', Object.keys(updates))

    // 处理 TodoWrite 工具：显示在悬浮窗中
    if (msg.role === 'tool_use' && msg.toolName === 'TodoWrite' && updates.toolInput?.todos) {
      log('[SessionStore] TodoWrite detected in handleMessageUpdate:', {
        toolUseId: messageId,
        todosCount: updates.toolInput.todos.length
      })
      handleTodoWrite(session, messageId, updates.toolInput.todos)
    }
  }

  function handleToolResult(session, data) {
    const toolUseId = data?.toolUseId
    if (!toolUseId) return

    for (let i = session.messages.length - 1; i >= 0; i--) {
      const msg = session.messages[i]
      if (msg.role === 'question' && msg.tool_use_id === toolUseId) {
        msg.resultReceived = true
        msg.receivedAnswers = data.answers || null
        msg.answersConsistent = data.answers ? compareAnswers(msg.userAnswers, data.answers) : true
        return
      }
    }

    for (let i = session.messages.length - 1; i >= 0; i--) {
      const msg = session.messages[i]
      if (msg.role === 'tool_use' && (msg.id === toolUseId || msg.request_id === toolUseId)) {
        msg.isExecuting = false
        msg.isError = !!data.isError
        msg.result = data.content || '(无输出)'
        if (!msg.duration && msg.startTime) {
          msg.duration = Date.now() - msg.startTime
        }
        return
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

    // 检查是否是 AskUserQuestion 请求
    // 支持多种可能的字段名格式
    const toolName = requestData.tool_name || requestData.toolName
    // 支持多种字段名：input, tool_input, toolInput
    let toolInput = requestData.input || requestData.tool_input || requestData.toolInput

    log('[SessionStore] toolName:', toolName)
    log('[SessionStore] tool_use_id:', toolUseId)
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

    // 将解析后的 input 放入 mergedRequestData
    const mergedRequestData = {
      ...requestData,
      request_id: outerRequestId || requestData.request_id,
      tool_use_id: toolUseId, // 确保 tool_use_id 被保留
      input: toolInput // 使用解析后的 input
    }

    log('[SessionStore] mergedRequestData:', JSON.stringify(mergedRequestData, null, 2))

    const hasQuestions = toolInput?.questions || requestData.questions

    if (toolName === 'AskUserQuestion' || hasQuestions) {
      log('[SessionStore] Setting pendingQuestion, request_id:', mergedRequestData.request_id)
      session.pendingQuestion = mergedRequestData
    } else {
      // 添加到队列而不是覆盖
      log('[SessionStore] Adding to pendingControlRequests queue, toolName:', toolName, 'request_id:', mergedRequestData.request_id)
      session.pendingControlRequests.push(mergedRequestData)
    }
  }

  function removePendingPermission(session, requestId) {
    if (!session || !requestId) return null

    const index = session.pendingPermissions.findIndex(permission =>
      permission?.request_id === requestId ||
      permission?.tool_use_id === requestId ||
      permission?.id === requestId
    )

    if (index === -1) return null
    return session.pendingPermissions.splice(index, 1)[0] || null
  }

  function removePendingControlRequest(session, requestId) {
    if (!session || !requestId) return null

    const index = session.pendingControlRequests.findIndex(request =>
      request?.request_id === requestId ||
      request?.tool_use_id === requestId ||
      request?.id === requestId
    )

    if (index === -1) return null
    return session.pendingControlRequests.splice(index, 1)[0] || null
  }

  /**
   * 处理控制响应（rewind/fork 等操作的结果，以及权限确认的响应）
   */
  function handleControlResponse(session, data) {
    log('[SessionStore] handleControlResponse called')
    log('[SessionStore] Response data:', JSON.stringify(data, null, 2))

    // 检查是否是权限确认的响应（包含 behavior 字段）
    const responseData = data.response?.response || data.response
    if (responseData?.behavior && session.lastPermissionRequest) {
      addPermissionResultMessage(session, responseData)
    }

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
      subtype: 'interrupt',
      content: '已中断',
      timestamp: new Date()
    })
  }

  function addPermissionResultMessage(session, responseData = {}) {
    if (!session?.lastPermissionRequest) return

    const behavior = responseData.behavior
    const updatedInput = responseData.updatedInput || {}
    const updatedPermissions = responseData.updatedPermissions || []
    const toolName = session.lastPermissionRequest.tool_name || session.lastPermissionRequest.toolName || 'Unknown'
    const isAllowAll = behavior === 'allow' && updatedPermissions.length > 0

    let content = ''
    if (behavior === 'deny') {
      content = `❌ 已拒绝: ${toolName}`
    } else if (isAllowAll) {
      content = `✅ 已允许 (所有): ${toolName}`
    } else {
      content = `✅ 已允许: ${toolName}`
    }

    if (updatedInput.command) {
      if (updatedInput.description) {
        content += `\n说明: ${updatedInput.description}`
      }
      content += `\n命令: ${updatedInput.command}`
    } else if (updatedInput.file_path) {
      if (updatedInput.description) {
        content += `\n说明: ${updatedInput.description}`
      }
      content += `\n文件: ${updatedInput.file_path}`
    } else if (updatedInput.pattern) {
      if (updatedInput.description) {
        content += `\n说明: ${updatedInput.description}`
      }
      content += `\n模式: ${updatedInput.pattern}`
      if (updatedInput.path) {
        content += `\n路径: ${updatedInput.path}`
      }
    } else if (updatedInput.query) {
      if (updatedInput.description) {
        content += `\n说明: ${updatedInput.description}`
      }
      content += `\n查询: ${updatedInput.query}`
    } else if (updatedInput.description) {
      content += `\n说明: ${updatedInput.description}`
    }

    session.messages.push({
      id: `permission-result-${Date.now()}`,
      role: 'permission_result',
      content,
      timestamp: new Date()
    })

    session.lastPermissionRequest = null
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
   * 处理未知消息类型
   * 显示为 unknown 消息气泡，方便调试和发现漏掉的消息
   */
  function handleUnknownMessage(session, data) {
    log('[SessionStore] handleUnknownMessage:', data)

    // 创建 unknown 消息
    const unknownMsg = {
      id: `unknown-${Date.now()}`,
      role: 'unknown',
      messageType: data.type || 'unknown',
      subtype: data.subtype || null,
      content: typeof data === 'string' ? data : JSON.stringify(data, null, 2),
      rawMessage: data,
      timestamp: new Date()
    }

    session.messages.push(unknownMsg)
  }

  /**
   * 处理运行时进程异常退出
   */
  function handleAbnormalExit(session, data) {
    log('[SessionStore] handleAbnormalExit:', data)

    // 停止所有正在流式传输的消息
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const msg = session.messages[i]

      // 停止流式传输的 assistant 消息
      if (msg.isStreaming) {
        msg.isStreaming = false
        if (msg.startTime && !msg.duration) {
          msg.duration = Date.now() - msg.startTime
        }
      }

      // 停止正在执行的工具
      if (msg.isExecuting) {
        msg.isExecuting = false
        if (msg.startTime && !msg.duration) {
          msg.duration = Date.now() - msg.startTime
        }
      }
    }

    // 停止处理状态
    session.isProcessing = false
    session.runtimeReady = false

    // 添加异常退出提示消息（使用 system_notification 类型，显示为居中通知样式）
    const exitMsg = {
      id: `abnormal-exit-${Date.now()}`,
      role: 'system_notification',
      notificationType: 'runtime-exit',
      scope: 'session',
      data: {
        provider: data.provider || session.envInfo?.provider || 'claude',
        reason: data.reason || 'crash',
        code: data.code,
        message: data.message
      },
      timestamp: new Date()
    }
    session.messages.push(exitMsg)
  }

  /**
   * 处理正常退出（用户手动停止）
   */
  function handleNormalExit(session, data) {
    // 停止所有正在执行的工具和流式传输
    for (let i = session.messages.length - 1; i >= 0; i--) {
      const msg = session.messages[i]

      // 停止流式传输的 assistant 消息
      if (msg.isStreaming) {
        msg.isStreaming = false
        if (msg.startTime && !msg.duration) {
          msg.duration = Date.now() - msg.startTime
        }
      }

      // 停止正在执行的工具
      if (msg.isExecuting) {
        msg.isExecuting = false
        if (msg.startTime && !msg.duration) {
          msg.duration = Date.now() - msg.startTime
        }
      }
    }

    // 停止处理状态
    session.isProcessing = false
    session.runtimeReady = false

    // 添加正常停止提示消息（使用 system_notification 类型，显示为居中通知样式）
    const exitMsg = {
      id: `normal-exit-${Date.now()}`,
      role: 'system_notification',
      notificationType: 'runtime-stopped',
      scope: 'session',
      data: {
        provider: data.provider || session.envInfo?.provider || 'claude',
        reason: data.reason || 'user-stop',
        message: data.message || '运行时已停止'
      },
      timestamp: new Date()
    }
    session.messages.push(exitMsg)
  }

  /**
   * 处理系统通知（权限模式切换、快速模式切换、压缩边界等）
   * 添加到消息列表显示为系统通知气泡
   */
  function handleSystemNotification(session, data) {
    log('[SessionStore] handleSystemNotification:', data)

    if (data?.type === 'session-runtime-starting' || data?.type === 'session-runtime-restarting') {
      session.runtimeReady = false
    } else if (data?.type === 'session-runtime-ready') {
      session.runtimeReady = true
    }

    const operationId = typeof data?.operationId === 'string' ? data.operationId : ''
    if (
      operationId && (
        data.type === 'session-runtime-ready' ||
        data.type === 'session-config-applied' ||
        data.type === 'session-effort-changed'
      )
    ) {
      const pendingMessage = [...session.messages].reverse().find(message =>
        message.role === 'system_notification' &&
        (message.notificationType === 'session-runtime-starting' || message.notificationType === 'session-runtime-restarting') &&
        message.data?.operationId === operationId
      )

      if (pendingMessage) {
        const applyUpdate = () => {
          pendingMessage.notificationType = data.type
          pendingMessage.scope = resolveNotificationScope(data.type, data)
          pendingMessage.data = {
            ...pendingMessage.data,
            ...data,
            completedAt: Date.now(),
            durationMs: data.durationMs ?? pendingMessage.data?.durationMs ?? null
          }
          pendingMessage.timestamp = new Date()
        }

        const startedAt = pendingMessage.data?.startedAt || pendingMessage.timestamp?.getTime?.() || Date.now()
        const elapsed = Math.max(0, Date.now() - startedAt)
        const minDisplayMs = 700
        if (elapsed < minDisplayMs) {
          setTimeout(applyUpdate, minDisplayMs - elapsed)
        } else {
          applyUpdate()
        }
        return
      }
    }

    // 创建系统通知消息
    const notificationMsg = {
      id: `system-notification-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      role: 'system_notification',
      notificationType: data.type,
      scope: resolveNotificationScope(data.type, data),
      data: data,
      timestamp: new Date()
    }

    session.messages.push(notificationMsg)
  }

  /**
   * 处理子任务事件（started/progress/notification）
   */
  function handleTaskEvent(session, data) {
    const { eventType, taskId } = data

    if (eventType === 'started') {
      // 任务开始：添加到活跃任务列表
      const taskData = {
        id: taskId,
        taskType: data.taskType,
        description: data.description,
        prompt: data.prompt,
        status: 'running',
        startTime: Date.now(),
        usage: null,
        summary: null
      }
      session.activeTasks.set(taskId, taskData)
      log('[SessionStore] Task started:', taskId, data.description)
    } else if (eventType === 'progress') {
      // 任务进度：更新任务信息
      const task = session.activeTasks.get(taskId)
      if (task) {
        task.usage = data.usage || task.usage
        task.summary = data.summary || task.summary
        task.description = data.description || task.description
        log('[SessionStore] Task progress:', taskId, data.summary)
      }
    } else if (eventType === 'notification') {
      // 任务通知：通常是任务结束，从活跃列表移除
      const task = session.activeTasks.get(taskId)
      if (task) {
        task.status = 'completed'
        // 添加任务完成消息到聊天
        session.messages.push({
          id: `task-complete-${taskId}`,
          role: 'task_complete',
          taskId: taskId,
          taskType: task.taskType,
          description: task.description,
          summary: task.summary,
          usage: task.usage,
          duration: Date.now() - task.startTime,
          timestamp: new Date()
        })
        // 从活跃列表移除
        session.activeTasks.delete(taskId)
        log('[SessionStore] Task completed:', taskId)
      }
    }
  }

  /**
   * 处理 TodoWrite 工具调用
   * 将 todos 显示在悬浮窗中
   */
  function handleTodoWrite(session, toolUseId, todos) {
    log('[SessionStore] handleTodoWrite called:', { toolUseId, todosCount: todos.length })

    // TodoWrite 固定使用 'todowrite' 作为 ID
    const taskId = 'todowrite'
    const existingTask = session.activeTasks.get(taskId)

    // 找到当前正在进行的 todo（用于显示描述）
    const currentTodo = todos.find(t => t.status === 'in_progress') || todos[todos.length - 1]
    const completedCount = todos.filter(t => t.status === 'completed').length

    // 创建新的 Map 以触发 Vue 响应式更新
    const newActiveTasks = new Map(session.activeTasks)

    if (existingTask) {
      // 更新现有任务
      newActiveTasks.set(taskId, {
        ...existingTask,
        todos: todos,
        description: currentTodo?.activeForm || currentTodo?.content || '任务列表',
        status: completedCount === todos.length ? 'completed' : 'in_progress'
      })
      log('[SessionStore] Updated todo task:', taskId, `(${completedCount}/${todos.length})`)
    } else {
      // 创建新任务
      newActiveTasks.set(taskId, {
        id: taskId,
        taskType: 'todo',
        description: currentTodo?.activeForm || currentTodo?.content || '任务列表',
        status: completedCount === todos.length ? 'completed' : 'in_progress',
        startTime: Date.now(),
        todos: todos,
        toolUseId: toolUseId
      })
      log('[SessionStore] Created todo task:', taskId)
    }

    // 替换整个 Map 以触发响应式更新
    session.activeTasks = newActiveTasks
  }

  /**
   * 处理 CLI 状态消息（如"正在启动运行时..."）
   * 添加一个临时的 status 消息到消息列表
   */
  function handleCliStatus(session, data) {
    // 移除之前的 status 消息（如果有的话）
    const existingStatusIndex = session.messages.findIndex(m => m.role === 'status')
    if (existingStatusIndex >= 0) {
      session.messages.splice(existingStatusIndex, 1)
    }

    // 添加新的 status 消息
    if (data.message) {
      session.messages.push({
        id: `status-${Date.now()}`,
        role: 'status',
        content: data.message,
        timestamp: new Date()
      })
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
      session.pendingPermissions.push(permission)
    }
  }

  /**
   * 设置控制请求（来自后端事件）
   */
  function setPendingControlRequest(request) {
    const session = currentSession.value
    if (session) {
      // 添加到队列而不是覆盖
      session.pendingControlRequests.push(request)
    }
  }

  /**
   * 清除当前会话的权限和控制请求
   * @param {string|null} requestId - 要清除的请求 ID；为空时清除当前展示中的请求
   * @param {boolean} saveForResponse - 是否保存请求信息用于后续添加权限结果消息
   */
  function clearPendingPermissions(requestId = null, saveForResponse = false) {
    const session = currentSession.value
    if (session) {
      const currentPermission = requestId
        ? session.pendingPermissions.find(permission =>
            permission?.request_id === requestId ||
            permission?.tool_use_id === requestId ||
            permission?.id === requestId
          ) || null
        : (session.pendingPermissions[0] || null)
      const currentRequest = requestId
        ? session.pendingControlRequests.find(request =>
            request?.request_id === requestId ||
            request?.tool_use_id === requestId ||
            request?.id === requestId
          ) || null
        : (session.pendingControlRequests[0] || null)

      // 如果需要保存，先保存请求信息
      if (saveForResponse && (currentPermission || currentRequest)) {
        session.lastPermissionRequest = currentPermission || currentRequest
      }

      if (currentPermission) {
        removePendingPermission(
          session,
          currentPermission.request_id || currentPermission.tool_use_id || currentPermission.id
        )
      }
      if (currentRequest) {
        removePendingControlRequest(
          session,
          currentRequest.request_id || currentRequest.tool_use_id || currentRequest.id
        )
      }
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
    pendingPermission,
    pendingQuestion,
    pendingControlRequest,

    // Actions
    initSession,
    switchToSession,
    closeSession,
    sendMessage,
    sendControlResponse,
    sendRuntimeToolResult,
    sendInterrupt,
    sendControlRequest,
    setSessionModel,
    listSessionSubmodels,
    setSessionSubmodel,
    listSessionEffortOptions,
    setSessionEffort,
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
