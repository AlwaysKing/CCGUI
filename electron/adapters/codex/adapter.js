const {
  CodexClient,
  normalizeToolName,
  normalizeCodexUsage,
  buildSessionUsageSummary,
  normalizeControlRequest,
  applyCodexEnvInfoPatch,
  createEmptyTurnUsage,
  mergeTurnUsage
} = require('./client')

/**
 * CodexAdapter
 *
 * 在 CodexClient 的传输层之上，将 Codex 原始协议翻译成
 * CCGUI 统一语义事件。
 */
class CodexAdapter extends CodexClient {
  handleNotification(message) {
    const { method, params } = message

    switch (method) {
      case 'thread/started':
        this.currentThreadId = params.thread.id
        this.envInfo = applyCodexEnvInfoPatch({
          ...this.envInfo,
          session_id: params.thread.id,
          providerPid: this.getPid()
        }, {
          provider: 'codex',
          providerPid: this.getPid()
        })
        this.emit('env-info', this.envInfo)
        break

      case 'turn/started':
        this.currentTurnId = params.turn.id
        this.currentAssistantMessageId = null
        this.turnMessageMap.set(params.turn.id, null)
        this.turnAssistantState.delete(params.turn.id)
        this.turnStats.set(params.turn.id, {
          numTurns: 0,
          usage: createEmptyTurnUsage()
        })
        break

      case 'turn/completed': {
        this.currentTurnId = params.turn.id
        const turnStats = this.turnStats.get(params.turn.id) || null
        this.emit('result', {
          duration_ms: null,
          num_turns: turnStats?.numTurns || this.getTurnSegmentCount(params.turn.id),
          usage: turnStats?.usage || null,
          turn: params.turn
        })
        this.turnStats.delete(params.turn.id)
        this.turnAssistantState.delete(params.turn.id)

        // 处理 turn 失败错误
        if (params.turn?.status === 'failed' && params.turn?.error) {
          const error = params.turn.error
          const errorType = error.codexErrorInfo || error.type || 'unknown'

          this.emit('system-notification', {
            type: 'turn-error',
            provider: 'codex',
            errorType,
            message: error.message || 'Turn failed',
            additionalDetails: error.additionalDetails || null,
            turnId: params.turn.id,
            metadata: error
          })
        }
        break
      }

      case 'item/started':
        this.handleItemStarted(params)
        break

      case 'item/completed':
        this.handleItemCompleted(params)
        break

      case 'item/agentMessage/delta':
        this.emitAssistantDelta(params.turnId, params.itemId, 'content', params.delta)
        break

      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta':
        this.emitAssistantDelta(params.turnId, params.itemId, 'thinking', params.delta)
        break

      case 'item/plan/delta':
        this.emitAssistantDelta(params.turnId, params.itemId, 'thinking', `${params.delta}`)
        break

      case 'item/commandExecution/outputDelta':
      case 'command/exec/outputDelta':
      case 'item/fileChange/outputDelta':
        this.handleToolOutputDelta(params)
        break

      case 'thread/status/changed':
        this.emit('env-info', applyCodexEnvInfoPatch({
          ...this.envInfo,
          thread_status: params.status
        }, {
          provider: 'codex',
          providerPid: this.getPid()
        }))
        break

      case 'thread/tokenUsage/updated':
        this.updateTurnUsage(params.turnId, normalizeCodexUsage(params.tokenUsage, 'last'))
        this.envInfo = {
          ...this.envInfo,
          session_usage: buildSessionUsageSummary(
            params.tokenUsage,
            this.envInfo.session_usage || null
          )
        }
        this.emit('env-info', this.envInfo)
        {
          const messageId = this.turnMessageMap.get(params.turnId)
          if (messageId) {
            this.emit('message-update', {
              messageId,
              updates: {
                usage: normalizeCodexUsage(params.tokenUsage, 'last')
              }
            })
          }
        }
        break

      case 'thread/compacted':
        this.envInfo = {
          ...this.envInfo,
          session_usage: {
            ...(this.envInfo.session_usage || {}),
            compacted: true,
            compacted_at: new Date().toISOString(),
            compact_summary: params.summary || params.compactSummary || ''
          }
        }
        this.emit('env-info', this.envInfo)
        this.emit('system-notification', {
          type: 'context_compacted',
          provider: 'codex',
          threadId: params.threadId,
          turnId: params.turnId,
          summary: params.summary || params.compactSummary || '',
          metadata: params
        })
        break

      case 'model/rerouted':
        this.envInfo = {
          ...this.envInfo,
          requested_model: params.requestedModel || params.from || null,
          rerouted_model: params.reroutedModel || params.to || params.model || null,
          model: params.reroutedModel || params.to || params.model || this.envInfo.model
        }
        this.emit('env-info', this.envInfo)
        this.emit('system-notification', {
          type: 'model-rerouted',
          provider: 'codex',
          requestedModel: params.requestedModel || params.from || null,
          reroutedModel: params.reroutedModel || params.to || params.model || null,
          metadata: params
        })
        break

      case 'rawResponseItem/completed':
      case 'serverRequest/resolved':
        this.emit('silent-message', {
          messageType: method,
          params,
          timestamp: new Date().toISOString()
        })
        break

      case 'account/rateLimits/updated':
        this.envInfo = applyCodexEnvInfoPatch({
          ...this.envInfo,
          rate_limits: params.rateLimits || null
        }, {
          provider: 'codex',
          providerPid: this.getPid()
        })
        this.emit('env-info', this.envInfo)
        break

      case 'deprecationNotice':
        this.emit('system-notification', {
          type: 'provider-deprecation',
          provider: 'codex',
          title: params?.summary || '配置项已弃用',
          message: params?.details || '',
          metadata: params || {}
        })
        break

      case 'error':
        this.emit('cli-status', {
          type: 'error',
          message: params?.message || 'Codex error'
        })
        break

      default:
        this.emit('unknown_message', message)
        break
    }
  }

  handleItemStarted(params) {
    const item = params.item
    if (!item) {
      return
    }

    this.itemState.set(item.id, item)

    if (item.type === 'agentMessage' || item.type === 'reasoning' || item.type === 'plan') {
      if (item.type === 'agentMessage' && item.text) {
        const messageId = this.ensureAssistantMessage(params.turnId, item.id)
        this.emit('message-delta', {
          messageId,
          field: 'content',
          delta: item.text
        })
      }
      if (item.type === 'reasoning' && Array.isArray(item.content) && item.content.length > 0) {
        const messageId = this.ensureAssistantMessage(params.turnId, item.id)
        const thinkingText = item.content.join('\n')
        this.emit('message-delta', {
          messageId,
          field: 'thinking',
          delta: thinkingText
        })
      }
      if (item.type === 'plan' && item.text) {
        const messageId = this.ensureAssistantMessage(params.turnId, item.id)
        this.emit('message-delta', {
          messageId,
          field: 'thinking',
          delta: item.text
        })
      }
      return
    }

    if (item.type === 'contextCompaction') {
      this.emit('system-notification', {
        type: 'context_compacted',
        provider: 'codex',
        summary: item.summary || item.text || '',
        metadata: item
      })
      return
    }

    if (
      item.type === 'commandExecution' ||
      item.type === 'fileChange' ||
      item.type === 'mcpToolCall' ||
      item.type === 'dynamicToolCall' ||
      item.type === 'collabAgentToolCall' ||
      item.type === 'webSearch' ||
      item.type === 'imageView' ||
      item.type === 'imageGeneration'
    ) {
      const assistantState = this.turnAssistantState.get(params.turnId)
      if (assistantState) {
        assistantState.messageId = null
        assistantState.itemId = null
        assistantState.completed = true
        this.turnAssistantState.set(params.turnId, assistantState)
      }
      const message = this.buildToolMessage(item)
      this.itemToMessageMap.set(item.id, message.id)
      this.emit('message-start', message)
    }
  }

  handleItemCompleted(params) {
    const item = params.item
    if (!item) {
      return
    }

    this.itemState.set(item.id, item)

    if (item.type === 'agentMessage' || item.type === 'reasoning' || item.type === 'plan') {
      const assistantState = this.turnAssistantState.get(params.turnId)
      const messageId = assistantState?.itemId === item.id
        ? assistantState.messageId
        : this.itemToMessageMap.get(item.id)
      if (messageId) {
        this.emit('message-complete', {
          messageId,
          updates: {
            isStreaming: false
          }
        })
      }
      if (assistantState && assistantState.itemId === item.id) {
        assistantState.completed = true
        this.turnAssistantState.set(params.turnId, assistantState)
      }
      return
    }

    const messageId = this.itemToMessageMap.get(item.id)
    if (!messageId) {
      return
    }

    const updates = this.buildToolCompletionUpdates(item)
    this.emit('message-update', {
      messageId,
      updates
    })
  }

  ensureAssistantMessage(turnId, itemId) {
    const currentState = this.turnAssistantState.get(turnId)
    if (currentState?.messageId && currentState.itemId === itemId) {
      this.itemToMessageMap.set(itemId, currentState.messageId)
      return currentState.messageId
    }

    if (currentState?.messageId && !currentState.completed) {
      this.itemToMessageMap.set(itemId, currentState.messageId)
      return currentState.messageId
    }

    const segmentIndex = (currentState?.segmentIndex || 0) + 1
    const messageId = `codex-assistant-${turnId}-${segmentIndex}`
    this.turnMessageMap.set(turnId, messageId)
    this.turnAssistantState.set(turnId, {
      messageId,
      itemId,
      completed: false,
      segmentIndex
    })
    this.itemToMessageMap.set(itemId, messageId)
    this.currentAssistantMessageId = messageId
    const turnStats = this.turnStats.get(turnId) || { numTurns: 0, usage: null }
    turnStats.numTurns = segmentIndex
    this.turnStats.set(turnId, turnStats)

    this.emit('message-start', {
      id: messageId,
      role: 'assistant',
      content: '',
      thinking: '',
      hasThinking: false,
      isStreaming: true,
      startTime: Date.now(),
      timestamp: new Date(),
      rawMessages: []
    })

    return messageId
  }

  emitAssistantDelta(turnId, itemId, field, delta) {
    const messageId = this.ensureAssistantMessage(turnId, itemId)
    this.emit('message-delta', {
      messageId,
      field,
      delta
    })
  }

  getTurnSegmentCount(turnId) {
    const state = this.turnAssistantState.get(turnId)
    return state?.segmentIndex || 1
  }

  updateTurnUsage(turnId, usage) {
    if (!turnId || !usage) return

    const currentStats = this.turnStats.get(turnId) || {
      numTurns: this.getTurnSegmentCount(turnId),
      usage: createEmptyTurnUsage()
    }

    currentStats.usage = mergeTurnUsage(currentStats.usage, usage)
    currentStats.numTurns = this.getTurnSegmentCount(turnId)
    this.turnStats.set(turnId, currentStats)
  }

  buildToolMessage(item) {
    const now = new Date()

    if (item.type === 'commandExecution') {
      return {
        id: item.id,
        role: 'tool_use',
        toolName: normalizeToolName('exec_command'),
        toolInput: {
          command: item.command,
          cwd: item.cwd
        },
        result: item.aggregatedOutput || '',
        isError: false,
        isExecuting: item.status === 'inProgress',
        request_id: item.id,
        collapsed: false,
        timestamp: now,
        startTime: Date.now(),
        rawMessages: [item]
      }
    }

    if (item.type === 'fileChange') {
      return {
        id: item.id,
        role: 'tool_use',
        toolName: normalizeToolName('apply_patch'),
        toolInput: {
          changes: item.changes || []
        },
        result: '',
        isError: false,
        isExecuting: item.status === 'inProgress',
        request_id: item.id,
        collapsed: false,
        timestamp: now,
        startTime: Date.now(),
        rawMessages: [item]
      }
    }

    if (item.type === 'mcpToolCall') {
      return {
        id: item.id,
        role: 'tool_use',
        toolName: normalizeToolName(item.tool || `${item.server}/${item.tool}`),
        toolInput: item.arguments || {},
        result: item.result ? JSON.stringify(item.result, null, 2) : '',
        isError: false,
        isExecuting: item.status === 'inProgress',
        request_id: item.id,
        collapsed: false,
        timestamp: now,
        startTime: Date.now(),
        rawMessages: [item]
      }
    }

    if (item.type === 'dynamicToolCall') {
      return {
        id: item.id,
        role: 'tool_use',
        toolName: normalizeToolName(item.tool),
        toolInput: item.arguments || {},
        result: '',
        isError: false,
        isExecuting: item.status === 'inProgress',
        request_id: item.id,
        collapsed: false,
        timestamp: now,
        startTime: Date.now(),
        rawMessages: [item]
      }
    }

    if (item.type === 'collabAgentToolCall') {
      return {
        id: item.id,
        role: 'tool_use',
        toolName: normalizeToolName('agent'),
        toolInput: item.arguments || item.input || {},
        result: item.result ? JSON.stringify(item.result, null, 2) : '',
        isError: false,
        isExecuting: item.status === 'inProgress',
        request_id: item.id,
        collapsed: false,
        timestamp: now,
        startTime: Date.now(),
        rawMessages: [item]
      }
    }

    if (item.type === 'webSearch') {
      return {
        id: item.id,
        role: 'tool_use',
        toolName: normalizeToolName('web_search'),
        toolInput: {
          query: item.query || item.input || ''
        },
        result: item.result ? JSON.stringify(item.result, null, 2) : '',
        isError: false,
        isExecuting: item.status === 'inProgress',
        request_id: item.id,
        collapsed: false,
        timestamp: now,
        startTime: Date.now(),
        rawMessages: [item]
      }
    }

    if (item.type === 'imageView') {
      return {
        id: item.id,
        role: 'tool_use',
        toolName: normalizeToolName('view_image'),
        toolInput: {
          path: item.path || item.imagePath || item.uri || ''
        },
        result: item.caption || '',
        isError: false,
        isExecuting: item.status === 'inProgress',
        request_id: item.id,
        collapsed: false,
        timestamp: now,
        startTime: Date.now(),
        rawMessages: [item]
      }
    }

    if (item.type === 'imageGeneration') {
      return {
        id: item.id,
        role: 'tool_use',
        toolName: normalizeToolName('generate_image'),
        toolInput: {
          prompt: item.prompt || ''
        },
        result: item.result ? JSON.stringify(item.result, null, 2) : '',
        isError: false,
        isExecuting: item.status === 'inProgress',
        request_id: item.id,
        collapsed: false,
        timestamp: now,
        startTime: Date.now(),
        rawMessages: [item]
      }
    }

    return {
      id: item.id,
      role: 'tool_use',
      toolName: normalizeToolName(item.tool || item.type, item.type || 'UnknownTool'),
      toolInput: {},
      result: '',
      isError: false,
      isExecuting: true,
      request_id: item.id,
      collapsed: false,
      timestamp: now,
      startTime: Date.now(),
      rawMessages: [item]
    }
  }

  buildToolCompletionUpdates(item) {
    if (item.type === 'commandExecution') {
      const hasOutput = typeof item.aggregatedOutput === 'string' && item.aggregatedOutput.length > 0
      const isSuccessWithoutOutput = item.status === 'completed' && item.exitCode === 0 && !hasOutput
      return {
        isExecuting: false,
        isError: item.status === 'failed',
        result: item.aggregatedOutput || (isSuccessWithoutOutput ? '已完成（无输出）' : ''),
        duration: item.durationMs || null
      }
    }

    if (item.type === 'fileChange') {
      return {
        isExecuting: false,
        isError: item.status === 'failed',
        result: Array.isArray(item.changes) ? JSON.stringify(item.changes, null, 2) : '',
        duration: null
      }
    }

    if (item.type === 'mcpToolCall') {
      return {
        isExecuting: false,
        isError: item.status === 'failed',
        result: item.result ? JSON.stringify(item.result, null, 2) : (item.error ? JSON.stringify(item.error, null, 2) : ''),
        duration: item.durationMs || null
      }
    }

    if (item.type === 'dynamicToolCall') {
      return {
        isExecuting: false,
        isError: item.success === false,
        result: item.contentItems ? JSON.stringify(item.contentItems, null, 2) : '',
        duration: item.durationMs || null
      }
    }

    if (item.type === 'collabAgentToolCall' || item.type === 'webSearch' || item.type === 'imageGeneration') {
      return {
        isExecuting: false,
        isError: item.status === 'failed' || item.success === false,
        result: item.result ? JSON.stringify(item.result, null, 2) : (item.contentItems ? JSON.stringify(item.contentItems, null, 2) : ''),
        duration: item.durationMs || null
      }
    }

    if (item.type === 'imageView') {
      return {
        isExecuting: false,
        isError: item.status === 'failed',
        result: item.caption || item.path || item.imagePath || '',
        duration: item.durationMs || null
      }
    }

    return {
      isExecuting: false
    }
  }

  handleToolOutputDelta(params) {
    const messageId = this.itemToMessageMap.get(params.itemId)
    if (!messageId) {
      return
    }

    this.emit('message-delta', {
      messageId,
      field: 'result',
      delta: params.delta
    })
  }

  handleServerRequest(message) {
    const { id, method, params } = message

    if (method === 'item/tool/requestUserInput' || method === 'mcpServer/elicitation/request') {
      const normalized = normalizeControlRequest({
        request_id: id,
        tool_use_id: params.itemId || params.callId || id,
        questions: params.questions || [],
        requestMethod: method,
        ...params
      })
      this.emit('control-request', normalized)
      return
    }

    const controlRequest = normalizeControlRequest({
      request_id: id,
      tool_use_id: params.itemId || params.callId || id,
      requestMethod: method,
      tool_name: this.mapRequestMethodToToolName(method),
      tool_input: this.buildControlToolInput(method, params),
      ...params
    })

    this.emit('control-request', controlRequest)
  }

  mapRequestMethodToToolName(method) {
    switch (method) {
      case 'item/commandExecution/requestApproval':
      case 'execCommandApproval':
        return normalizeToolName('exec_command')
      case 'item/fileChange/requestApproval':
      case 'applyPatchApproval':
        return normalizeToolName('apply_patch')
      case 'item/permissions/requestApproval':
        return normalizeToolName('request_permissions')
      case 'item/tool/requestUserInput':
      case 'mcpServer/elicitation/request':
        return normalizeToolName('request_user_input')
      case 'item/tool/call':
        return normalizeToolName('client_tool_call')
      default:
        return normalizeToolName(method, method)
    }
  }

  buildControlToolInput(method, params) {
    if (method === 'item/commandExecution/requestApproval' || method === 'execCommandApproval') {
      const command = Array.isArray(params.command)
        ? params.command.join(' ')
        : params.command
      return {
        description: params.reason || 'Codex 需要执行命令',
        command: command || '',
        cwd: params.cwd,
        commandActions: params.commandActions || params.parsedCmd || []
      }
    }

    if (method === 'item/fileChange/requestApproval' || method === 'applyPatchApproval') {
      return {
        description: params.reason || 'Codex 需要修改文件',
        changes: params.changes || params.fileChanges || {}
      }
    }

    if (method === 'item/permissions/requestApproval') {
      return {
        description: params.reason || 'Codex 需要额外权限',
        permissions: params.permissions
      }
    }

    if (method === 'item/tool/call') {
      return {
        description: params.description || params.reason || 'Codex 请求调用客户端工具',
        tool: params.tool || params.toolName || params.name || 'tool_call',
        arguments: params.arguments || params.input || {}
      }
    }

    if (method === 'mcpServer/elicitation/request') {
      return {
        description: params.reason || 'Codex 需要更多输入',
        questions: params.questions || []
      }
    }

    return params
  }

  async sendControlResponse(requestId, approved, options = {}) {
    const pendingRequest = this.pendingServerRequests.get(String(requestId))
    if (!pendingRequest) {
      throw new Error(`Pending Codex request not found: ${requestId}`)
    }

    const { method, params } = pendingRequest
    let result = null
    const responsePayload = {
      behavior: approved ? 'allow' : 'deny'
    }

    if (method === 'item/commandExecution/requestApproval') {
      result = { decision: approved ? 'accept' : 'decline' }
    } else if (method === 'item/fileChange/requestApproval') {
      result = { decision: approved ? 'accept' : 'decline' }
    } else if (method === 'item/permissions/requestApproval') {
      result = approved
        ? { permissions: params.permissions || {}, scope: 'session' }
        : { permissions: {}, scope: 'turn' }
    } else if (method === 'item/tool/requestUserInput' || method === 'mcpServer/elicitation/request') {
      const rawAnswers = options?.updatedInput?.answers || {}
      const mappedAnswers = {}
      for (const question of params.questions || []) {
        const answerValue = rawAnswers[question.id] ?? rawAnswers[question.question] ?? rawAnswers[question.header]
        if (answerValue === undefined || answerValue === null) {
          continue
        }

        mappedAnswers[question.id] = {
          answers: Array.isArray(answerValue) ? answerValue.map(String) : [String(answerValue)]
        }
      }
      result = { answers: mappedAnswers }
    } else if (method === 'item/tool/call') {
      result = approved
        ? (options?.updatedInput?.result || options?.result || {})
        : { error: 'Rejected by user' }
    } else if (method === 'execCommandApproval') {
      result = { decision: approved ? 'approved' : 'denied' }
    } else if (method === 'applyPatchApproval') {
      result = { decision: approved ? 'approved' : 'denied' }
    } else {
      result = approved ? {} : {}
    }

    if (options?.toolUseID) {
      responsePayload.toolUseID = options.toolUseID
    }
    if (approved && options?.updatedInput) {
      responsePayload.updatedInput = options.updatedInput
    }
    if (approved && Array.isArray(options?.permissionRules) && options.permissionRules.length > 0) {
      responsePayload.updatedPermissions = options.permissionRules
    }

    this.sendResponse(requestId, result)
    this.pendingServerRequests.delete(String(requestId))
    this.emit('control-response', {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: responsePayload
      }
    })
  }

  async setPermissionMode(mode) {
    this.permissionMode = mode
    this.emit('system-notification', {
      type: 'permission-mode-change',
      permissionMode: mode,
      source: 'manual'
    })
  }

  getSessionIdentifier() {
    return this.getThreadId?.() || this.sessionId || null
  }

  getSessionSettingsPatch() {
    const threadId = this.getThreadId?.()
    return threadId ? { codexThreadId: threadId } : null
  }
}

module.exports = { CodexAdapter }
