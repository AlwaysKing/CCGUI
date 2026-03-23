const { ClaudeClient } = require('./client')
const attachmentService = require('../../services/attachment-service')
const {
  replaceAttachmentTokens,
  buildClaudeAttachmentReference
} = require('../shared/ccgui-attachments')

const CLAUDE_IMAGE_MAX_BYTES = 5 * 1024 * 1024
const CLAUDE_TEXT_FILE_MAX_BYTES = 256 * 1024
const CLAUDE_PDF_MAX_BYTES = 4 * 1024 * 1024

/**
 * ClaudeAdapter
 *
 * 在 ClaudeClient 的进程通信能力之上，把 Claude 原始协议翻译成
 * CCGUI 统一语义事件。
 */
class ClaudeAdapter extends ClaudeClient {
  constructor(...args) {
    super(...args)
    this.currentAssistantMessage = null
    this.assistantSnapshots = new Map()
    this.currentTurnNumber = 0
    this.hasSeenToolUseInCurrentTurn = false
    this.contentBlockIndexToId = new Map()
    this.toolUseMessages = new Map()
    this.envInfo = {
      cwd: this.workingDirectory,
      session_id: this.sessionId,
      provider: 'claude',
      providerPid: null
    }
  }

  isDiffToolName(toolName) {
    const normalized = String(toolName || '').trim().toLowerCase()
    return normalized === 'edit' ||
      normalized === 'write' ||
      normalized === 'multiedit' ||
      normalized === 'applypatch' ||
      normalized === 'apply_patch'
  }

  async buildUserContentWithAttachments(message) {
    const attachments = Array.isArray(message?.attachments) ? message.attachments : []
    const rawText = Array.isArray(message?.message?.content)
      ? (message.message.content.find(item => item?.type === 'text')?.text || '')
      : ''

    const content = []
    const tokenSafeText = replaceAttachmentTokens(rawText, attachments, buildClaudeAttachmentReference)

    for (const attachment of attachments) {
      if (!attachment?.path) {
        continue
      }

      const size = Number.isFinite(attachment.size)
        ? attachment.size
        : attachmentService.getAttachmentSize(attachment.path)
      const mimeType = attachment.mimeType || attachmentService.inferMimeType(attachment.path)

      if (attachment.kind === 'image') {
        if (size && size > CLAUDE_IMAGE_MAX_BYTES) {
          continue
        }

        const base64 = attachmentService.readFileAsBase64(attachment.path)
        content.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: mimeType || 'image/png',
            data: base64
          }
        })
        continue
      }

      if (attachment.kind === 'file-range') {
        const snippet = attachmentService.readFileRange(
          attachment.path,
          attachment.startLine,
          attachment.endLine
        )

        content.push({
          type: 'text',
          text: `<attached_file_range path="${attachment.path}" startLine="${attachment.startLine || ''}" endLine="${attachment.endLine || ''}">\n${snippet}\n</attached_file_range>`
        })
        continue
      }

      if (mimeType === 'application/pdf') {
        if (size && size > CLAUDE_PDF_MAX_BYTES) {
          continue
        }

        content.push({
          type: 'document',
          source: {
            type: 'base64',
            media_type: 'application/pdf',
            data: attachmentService.readFileAsBase64(attachment.path)
          },
          title: attachment.name
        })
        continue
      }

      if (attachmentService.isTextMimeType(mimeType, attachment.path)) {
        if (size && size > CLAUDE_TEXT_FILE_MAX_BYTES) {
          continue
        }

        content.push({
          type: 'document',
          source: {
            type: 'text',
            media_type: 'text/plain',
            data: attachmentService.readTextFile(attachment.path)
          },
          title: attachment.name
        })
      }
    }

    content.push({
      type: 'text',
      text: tokenSafeText
    })

    return content
  }

  async sendMessage(message) {
    if (message?.type === 'user' && Array.isArray(message?.attachments)) {
      const transformed = {
        ...message,
        message: {
          ...message.message,
          role: 'user',
          content: await this.buildUserContentWithAttachments(message)
        }
      }
      super.sendMessage(transformed)
      return
    }

    super.sendMessage(message)
  }

  collapseThinkingIfNeeded(messageId, snapshot, hasNewText = false) {
    if (!messageId || !snapshot?.thinking) return
    if (!hasNewText) return

    this.emit('message-update', {
      messageId,
      updates: {
        thinkingCollapsed: true
      }
    })
  }

  handleMessage(message) {
    if (this.debugEnabled && this.sessionId) {
      require('../../logger').logReceive(this.sessionId, message)
    }

    if (message.type === 'stream_event') {
      this.handleStreamEvent(message)
      return
    }

    if (message.type === 'control_request') {
      this.emit('control-request', message)
      return
    }

    if (message.type === 'control_response') {
      this.emit('control-response', message)
      return
    }

    if (message.type === 'control_cancel_request') {
      this.currentAssistantMessage = null
      this.emit('interrupt', message)
      return
    }

    if (message.type === 'system') {
      this.handleSystemMessage(message)
      return
    }

    if (message.type === 'user') {
      const toolResultContent = message.message?.content?.find(c => c.type === 'tool_result')
      if (toolResultContent) {
        this.handleToolResultMessage(message, toolResultContent)
      }
      return
    }

    if (message.type === 'assistant') {
      this.handleAssistantMessage(message)
      return
    }

    if (message.type === 'result') {
      this.emit('result', message)
      return
    }

    this.emit('unknown_message', message)
  }

  async setPermissionMode(mode) {
    this.permissionMode = mode
    this.sendControlRequest({
      subtype: 'set_permission_mode',
      mode
    })
  }

  sendControlRequest(request) {
    if (request?.subtype === 'set_session_submodel' && request.model) {
      super.sendControlRequest({
        subtype: 'set_model',
        model: String(request.model)
      })

      this.envInfo = {
        ...this.envInfo,
        model: String(request.model),
        provider: 'claude',
        providerPid: this.getPid() || null
      }
      this.emit('env-info', this.envInfo)
      this.emit('system-notification', {
        type: 'session-model-changed',
        provider: 'claude',
        model: String(request.model)
      })
      return
    }

    super.sendControlRequest(request)

    if (request?.subtype === 'set_model' && request.model) {
      this.envInfo = {
        ...this.envInfo,
        model: String(request.model),
        provider: 'claude',
        providerPid: this.getPid() || null
      }
      this.emit('env-info', this.envInfo)
      this.emit('system-notification', {
        type: 'session-model-changed',
        provider: 'claude',
        model: String(request.model)
      })
    }
  }

  getSessionIdentifier() {
    return this.sessionId || null
  }

  getSessionSettingsPatch() {
    return null
  }

  handleSystemMessage(message) {
    if (message.subtype === 'init') {
      const filteredMessage = {}
      for (const [key, value] of Object.entries(message)) {
        if (value !== null) {
          filteredMessage[key] = value
        }
      }

      this.envInfo = {
        ...this.envInfo,
        ...filteredMessage,
        provider: 'claude',
        providerPid: this.getPid() || null
      }
      this.emit('env-info', this.envInfo)
      if (message.fast_mode_state) {
        this.emit('fast-mode-change', message.fast_mode_state)
      }
      return
    }

    if (message.subtype === 'status') {
      if (message.permissionMode) {
        this.emit('permission-mode-change', message.permissionMode)
        this.emit('system-notification', {
          type: 'permission-mode-change',
          permissionMode: message.permissionMode,
          source: 'auto'
        })
      }

      if (message.fast_mode_state) {
        this.emit('fast-mode-change', message.fast_mode_state)
        this.emit('system-notification', {
          type: 'fast-mode-change',
          fastModeState: message.fast_mode_state,
          source: 'auto'
        })
      }

      if (message.status) {
        this.envInfo = {
          ...this.envInfo,
          status: message.status,
          provider: 'claude',
          providerPid: this.getPid() || null
        }
        this.emit('env-info', this.envInfo)
      }
      return
    }

    if (message.subtype === 'compact_boundary') {
      this.emit('system-notification', {
        type: 'compact-boundary',
        compactMetadata: message.compact_metadata || message.compactMetadata,
        compactSummary: message.compactSummary || message.compact_summary
      })
      return
    }

    if (message.subtype === 'task_started') {
      this.emit('task-event', {
        eventType: 'started',
        taskId: message.task_id,
        taskType: message.task_type,
        description: message.description,
        prompt: message.prompt
      })
      return
    }

    if (message.subtype === 'task_progress') {
      this.emit('task-event', {
        eventType: 'progress',
        taskId: message.task_id,
        usage: message.usage,
        summary: message.summary,
        description: message.description
      })
      return
    }

    if (message.subtype === 'task_notification') {
      this.emit('task-event', {
        eventType: 'notification',
        taskId: message.task_id
      })
      return
    }

    this.emit('system-message', message)
  }

  handleStreamEvent(message) {
    const event = message.event
    if (!event) return

    if (event.type === 'turn_start') {
      this.currentTurnNumber += 1
      return
    }

    if (event.type === 'message_start') {
      const messageId = event.message?.id || `assistant-${Date.now()}`
      this.currentAssistantMessage = {
        id: messageId,
        usage: event.message?.usage || null,
        stopReason: null
      }
      this.assistantSnapshots.set(messageId, {
        thinking: '',
        content: ''
      })
      this.currentTurnNumber = 0
      this.hasSeenToolUseInCurrentTurn = false
      this.contentBlockIndexToId.clear()

      this.emit('message-start', {
        id: messageId,
        role: 'assistant',
        content: '',
        thinking: '',
        hasThinking: false,
        isStreaming: true,
        startTime: Date.now(),
        timestamp: new Date(),
        usage: event.message?.usage || null,
        turnNumber: 1,
        rawMessages: [message]
      })
      return
    }

    if (event.type === 'content_block_start') {
      const contentBlock = event.content_block

      if (contentBlock?.type === 'thinking') {
        if (this.hasSeenToolUseInCurrentTurn) {
          this.currentTurnNumber += 1
          this.hasSeenToolUseInCurrentTurn = false
        }

        if (this.currentAssistantMessage?.id) {
          const snapshot = this.assistantSnapshots.get(this.currentAssistantMessage.id) || { thinking: '', content: '' }
          this.emit('message-update', {
            messageId: this.currentAssistantMessage.id,
            updates: {
              hasThinking: true,
              turnNumber: this.currentTurnNumber + 1,
              showTurnSeparator: this.currentTurnNumber > 0,
              ...(snapshot.thinking ? {} : { thinkingCollapsed: false })
            }
          })
        }
        return
      }

      if (contentBlock?.type === 'tool_use') {
        this.hasSeenToolUseInCurrentTurn = true
        if (contentBlock.name === 'AskUserQuestion') {
          return
        }

        const toolUseId = contentBlock.id || `tool-${Date.now()}`
        if (typeof event.index === 'number') {
          this.contentBlockIndexToId.set(event.index, toolUseId)
        }
        this.toolUseMessages.set(toolUseId, {
          toolInputBuffer: ''
        })

        this.emit('message-start', {
          id: toolUseId,
          role: this.isDiffToolName(contentBlock.name) ? 'diff' : 'tool_use',
          toolName: contentBlock.name,
          toolInput: contentBlock.input ? { ...contentBlock.input } : {},
          result: '',
          isError: false,
          isExecuting: true,
          request_id: toolUseId,
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

    if (event.type === 'content_block_delta') {
      const delta = event.delta

      if (delta?.type === 'thinking_delta' && delta.thinking && this.currentAssistantMessage?.id) {
        const snapshot = this.assistantSnapshots.get(this.currentAssistantMessage.id) || { thinking: '', content: '' }
        snapshot.thinking += delta.thinking
        this.assistantSnapshots.set(this.currentAssistantMessage.id, snapshot)
        this.emit('message-delta', {
          messageId: this.currentAssistantMessage.id,
          field: 'thinking',
          delta: delta.thinking
        })
      }

      if (delta?.type === 'text_delta' && delta.text && this.currentAssistantMessage?.id) {
        const snapshot = this.assistantSnapshots.get(this.currentAssistantMessage.id) || { thinking: '', content: '' }
        const hadNoContent = !snapshot.content
        snapshot.content += delta.text
        this.assistantSnapshots.set(this.currentAssistantMessage.id, snapshot)
        if (hadNoContent) {
          this.collapseThinkingIfNeeded(this.currentAssistantMessage.id, snapshot, true)
        }
        this.emit('message-delta', {
          messageId: this.currentAssistantMessage.id,
          field: 'content',
          delta: delta.text
        })
      }

      if (delta?.type === 'input_json_delta' && delta.partial_json) {
        const contentBlockId = this.contentBlockIndexToId.get(event.index)
        if (!contentBlockId) return

        const toolState = this.toolUseMessages.get(contentBlockId) || { toolInputBuffer: '' }
        toolState.toolInputBuffer += delta.partial_json
        this.toolUseMessages.set(contentBlockId, toolState)

        try {
          const parsedInput = JSON.parse(toolState.toolInputBuffer)
          this.emit('message-update', {
            messageId: contentBlockId,
            updates: { toolInput: { ...parsedInput } }
          })
        } catch {
          // Wait for complete JSON buffer.
        }
      }
      return
    }

    if (event.type === 'content_block_stop') {
      const snapshot = this.currentAssistantMessage?.id
        ? (this.assistantSnapshots.get(this.currentAssistantMessage.id) || { thinking: '', content: '' })
        : null

      if (this.currentAssistantMessage?.id && snapshot?.thinking) {
        this.emit('message-update', {
          messageId: this.currentAssistantMessage.id,
          updates: {
            thinkingCollapsed: true
          }
        })
      }
      return
    }

    if (event.type === 'message_delta' && this.currentAssistantMessage?.id) {
      if (event.usage) {
        this.currentAssistantMessage.usage = event.usage
      }
      if (event.delta?.stop_reason) {
        this.currentAssistantMessage.stopReason = event.delta.stop_reason
      }

      this.emit('message-update', {
        messageId: this.currentAssistantMessage.id,
        updates: {
          usage: this.currentAssistantMessage.usage,
          stopReason: this.currentAssistantMessage.stopReason
        }
      })
      return
    }

    if (event.type === 'message_stop' && this.currentAssistantMessage?.id) {
      this.emit('message-complete', {
        messageId: this.currentAssistantMessage.id,
        updates: {
          isStreaming: false,
          thinkingCollapsed: true
        }
      })
      this.assistantSnapshots.delete(this.currentAssistantMessage.id)
      this.currentAssistantMessage = null
    }
  }

  handleToolResultMessage(message, toolResultContent) {
    const toolUseId = toolResultContent.tool_use_id
    if (!toolUseId) return

    this.emit('tool-result', {
      toolUseId,
      content: toolResultContent.content || '(无输出)',
      isError: toolResultContent.is_error || false,
      answers: message?.tool_use_result?.answers || toolResultContent?.answers || null,
      rawMessage: message
    })

    this.emit('message-update', {
      messageId: toolUseId,
      updates: {
        isExecuting: false,
        isError: toolResultContent.is_error || false,
        result: toolResultContent.content || '(无输出)'
      }
    })
  }

  handleAssistantMessage(message) {
    const assistantMessage = message.message || {}
    const messageId = assistantMessage.id || message.uuid || `assistant-${Date.now()}`
    const content = Array.isArray(assistantMessage.content) ? assistantMessage.content : []
    const thinkingText = content
      .filter(block => block?.type === 'thinking' && typeof block.thinking === 'string')
      .map(block => block.thinking)
      .join('')
    const textContent = content
      .filter(block => block?.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('')
    const toolUses = content.filter(block => block?.type === 'tool_use')
    const hasAssistantTextContent = !!(thinkingText || textContent)
    const existingSnapshot = this.assistantSnapshots.get(messageId) || {
      thinking: '',
      content: ''
    }
    const thinkingDelta = thinkingText.startsWith(existingSnapshot.thinking)
      ? thinkingText.slice(existingSnapshot.thinking.length)
      : thinkingText
    const textDelta = textContent.startsWith(existingSnapshot.content)
      ? textContent.slice(existingSnapshot.content.length)
      : textContent

    const currentAssistantState = {
      id: messageId,
      usage: assistantMessage.usage || null,
      stopReason: assistantMessage.stop_reason || assistantMessage.stopReason || null
    }

    if (!this.currentAssistantMessage || this.currentAssistantMessage.id === messageId) {
      this.currentAssistantMessage = currentAssistantState
    }

    if (hasAssistantTextContent) {
      if (!this.assistantSnapshots.has(messageId)) {
        this.emit('message-start', {
          id: messageId,
          role: 'assistant',
          content: '',
          thinking: '',
          hasThinking: false,
          isStreaming: true,
          startTime: Date.now(),
          timestamp: new Date(),
          usage: assistantMessage.usage || null,
          turnNumber: this.currentTurnNumber || 1,
          rawMessages: [message]
        })
      }
      this.assistantSnapshots.set(messageId, {
        thinking: thinkingText,
        content: textContent
      })
    }

    if (thinkingDelta && hasAssistantTextContent) {
      if (!existingSnapshot.thinking) {
        this.emit('message-update', {
          messageId,
          updates: {
            hasThinking: true,
            thinkingCollapsed: false
          }
        })
      }
      this.emit('message-delta', {
        messageId,
        field: 'thinking',
        delta: thinkingDelta
      })
    }

    if (textDelta && hasAssistantTextContent) {
      if (!existingSnapshot.content) {
        this.collapseThinkingIfNeeded(messageId, {
          thinking: thinkingText,
          content: textContent
        }, true)
      }
      this.emit('message-delta', {
        messageId,
        field: 'content',
        delta: textDelta
      })
    }

    if (hasAssistantTextContent) {
      this.emit('message-update', {
        messageId,
        updates: {
          usage: assistantMessage.usage || null,
          stopReason: assistantMessage.stop_reason || assistantMessage.stopReason || null
        }
      })
    }

    for (const toolUse of toolUses) {
      if (toolUse.name === 'AskUserQuestion') {
        continue
      }

      const toolUseId = toolUse.id || `tool-${Date.now()}`
      this.emit('message-start', {
        id: toolUseId,
        role: this.isDiffToolName(toolUse.name) ? 'diff' : 'tool_use',
        toolName: toolUse.name,
        toolInput: toolUse.input ? { ...toolUse.input } : {},
        result: '',
        isError: false,
        isExecuting: true,
        request_id: toolUseId,
        collapsed: false,
        thinking: '',
        hasThinking: false,
        timestamp: new Date(),
        startTime: Date.now(),
        rawMessages: [message]
      })
    }

    if (assistantMessage.stop_reason || assistantMessage.stopReason) {
      this.emit('message-complete', {
        messageId,
        updates: {
          isStreaming: false,
          thinkingCollapsed: !!thinkingText
        }
      })
      this.assistantSnapshots.delete(messageId)
      if (this.currentAssistantMessage?.id === messageId) {
        this.currentAssistantMessage = null
      }
    }
  }
}

module.exports = { ClaudeAdapter }
