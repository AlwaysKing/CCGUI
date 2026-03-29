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
    this.contentBlockState = new Map()
    this.toolUseMessages = new Map()
    this.envInfo = {
      cwd: this.workingDirectory,
      session_id: this.sessionId,
      provider: 'claude',
      providerPid: null
    }
    this.pendingAgentToolUses = new Map()
    this.taskIdToAgentId = new Map()
    this.toolUseIdToAgentId = new Map()
    this.providerAgentIdToAgentId = new Map()
    this.agentRegistry = new Map()
    this.teamNameToTeamId = new Map()
    this.teamLeadByTeamId = new Map()
    this.teamMembersByTeamId = new Map()
    this.teammateNameToAgentId = new Map()
    this.sidechainMessageIds = new Set()
  }

  getCollaborativeReadOnlyFields() {
    return {
      canWrite: false,
      interactionMode: 'read-only'
    }
  }

  resolveAgentColor(value) {
    if (typeof value !== 'string') {
      return null
    }
    const trimmed = value.trim()
    return trimmed || null
  }

  sanitizeSemanticId(value, fallback = 'agent') {
    const normalized = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    return normalized || fallback
  }

  buildCcguiPatch({ registry = null, orchestration = null, attribution = null } = {}) {
    const ccgui = {}
    if (registry?.agentId) {
      ccgui.registry = registry
      ccgui.subagentId = registry.agentId
      ccgui.subagentType = registry.agentType || null
      ccgui.isSubagent = true
    }
    if (orchestration?.agentId && orchestration?.eventType) {
      ccgui.orchestration = orchestration
    }
    if (attribution?.agentId || attribution?.actorId || attribution?.targetId) {
      ccgui.attribution = {
        agentId: attribution.agentId || attribution.actorId || null,
        actorId: attribution.actorId || attribution.agentId || null,
        ...(attribution.targetId ? { targetId: attribution.targetId } : {})
      }
      if (!ccgui.subagentId && ccgui.attribution.agentId) {
        ccgui.subagentId = ccgui.attribution.agentId
        ccgui.isSubagent = true
      }
    }
    if (!ccgui.registry && !ccgui.orchestration && !ccgui.attribution) {
      ccgui.attribution = {
        agentId: 'master',
        actorId: 'master'
      }
    }
    return Object.keys(ccgui).length > 0 ? ccgui : null
  }

  mergeRegistry(entry = {}) {
    if (!entry?.agentId) {
      return null
    }

    const nextEntry = {
      ...(this.agentRegistry.get(entry.agentId) || {}),
      ...Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== null && value !== undefined))
    }
    this.agentRegistry.set(entry.agentId, nextEntry)
    return nextEntry
  }

  emitAgentSilent(ccgui, rawMessage = null, extra = {}) {
    if (!ccgui) {
      return
    }

    this.emit('silent-message', {
      messageType: 'agent-orchestration',
      provider: 'claude',
      ...(rawMessage ? { rawMessage } : {}),
      ...extra,
      ccgui,
      timestamp: new Date().toISOString()
    })
  }

  buildLifecycleCcgui(entry = {}, orchestration = {}) {
    const mergedRegistry = this.mergeRegistry(entry)
    return this.buildCcguiPatch({
      registry: mergedRegistry,
      orchestration: {
        timestamp: new Date().toISOString(),
        ...orchestration,
        agentId: orchestration.agentId || mergedRegistry?.agentId
      }
    })
  }

  resolveTeamId(teamName) {
    if (!teamName) {
      return null
    }
    const normalizedTeamName = String(teamName).trim()
    if (!normalizedTeamName) {
      return null
    }
    if (!this.teamNameToTeamId.has(normalizedTeamName)) {
      this.teamNameToTeamId.set(normalizedTeamName, `claude-team:${this.sanitizeSemanticId(normalizedTeamName, 'team')}`)
    }
    return this.teamNameToTeamId.get(normalizedTeamName)
  }

  resolveExecutionAgentId({ taskId = null, toolUseId = null, providerAgentId = null } = {}) {
    if (providerAgentId && this.providerAgentIdToAgentId.has(providerAgentId)) {
      return this.providerAgentIdToAgentId.get(providerAgentId)
    }
    if (taskId && this.taskIdToAgentId.has(taskId)) {
      return this.taskIdToAgentId.get(taskId)
    }
    if (toolUseId && this.toolUseIdToAgentId.has(toolUseId)) {
      return this.toolUseIdToAgentId.get(toolUseId)
    }

    const unifiedAgentId = taskId
      ? `claude-agent:${this.sanitizeSemanticId(taskId)}`
      : (toolUseId ? `claude-agent:${this.sanitizeSemanticId(toolUseId)}` : null)

    if (taskId && unifiedAgentId) {
      this.taskIdToAgentId.set(taskId, unifiedAgentId)
    }
    if (toolUseId && unifiedAgentId) {
      this.toolUseIdToAgentId.set(toolUseId, unifiedAgentId)
    }
    if (providerAgentId && unifiedAgentId) {
      this.providerAgentIdToAgentId.set(providerAgentId, unifiedAgentId)
    }

    return unifiedAgentId
  }

  resolveTeamMemberAgentId({
    teamId = null,
    taskId = null,
    teammateId = null,
    providerAgentId = null,
    name = null,
    toolUseId = null
  } = {}) {
    if (providerAgentId && this.providerAgentIdToAgentId.has(providerAgentId)) {
      return this.providerAgentIdToAgentId.get(providerAgentId)
    }
    if (taskId && this.taskIdToAgentId.has(taskId)) {
      return this.taskIdToAgentId.get(taskId)
    }
    if (toolUseId && this.toolUseIdToAgentId.has(toolUseId)) {
      return this.toolUseIdToAgentId.get(toolUseId)
    }

    const identity = providerAgentId || teammateId || taskId || toolUseId || name
    if (!identity) {
      return null
    }

    const unifiedAgentId = teamId
      ? `claude-team-member:${this.sanitizeSemanticId(teamId)}:${this.sanitizeSemanticId(identity)}`
      : `claude-team-member:${this.sanitizeSemanticId(identity)}`

    if (taskId) {
      this.taskIdToAgentId.set(taskId, unifiedAgentId)
    }
    if (toolUseId) {
      this.toolUseIdToAgentId.set(toolUseId, unifiedAgentId)
    }
    if (providerAgentId) {
      this.providerAgentIdToAgentId.set(providerAgentId, unifiedAgentId)
    }
    if (name) {
      this.teammateNameToAgentId.set(String(name).trim(), unifiedAgentId)
    }
    if (teamId) {
      const memberSet = this.teamMembersByTeamId.get(teamId) || new Set()
      memberSet.add(unifiedAgentId)
      this.teamMembersByTeamId.set(teamId, memberSet)
    }

    return unifiedAgentId
  }

  getAttributionForClaudeMessage(message = {}) {
    const providerAgentId = message?.agent_id || message?.agentId || null
    if (providerAgentId && this.providerAgentIdToAgentId.has(providerAgentId)) {
      const agentId = this.providerAgentIdToAgentId.get(providerAgentId)
      return {
        agentId,
        actorId: agentId
      }
    }

    const taskId = message?.task_id || message?.taskId || null
    if (taskId && this.taskIdToAgentId.has(taskId)) {
      const agentId = this.taskIdToAgentId.get(taskId)
      return {
        agentId,
        actorId: agentId
      }
    }

    const parentToolUseId = message?.parent_tool_use_id || message?.parentToolUseId || null
    if (parentToolUseId && this.toolUseIdToAgentId.has(parentToolUseId)) {
      const agentId = this.toolUseIdToAgentId.get(parentToolUseId)
      return {
        agentId,
        actorId: agentId
      }
    }

    const teamName = message?.team_name || message?.teamName || null
    const sender = message?.routing?.sender || message?.sender || null
    const target = message?.routing?.target || null
    const teamId = this.resolveTeamId(teamName)
    const actorId = sender
      ? (this.teammateNameToAgentId.get(String(sender).replace(/^@/, '').trim()) || this.teamLeadByTeamId.get(teamId) || null)
      : null
    const targetId = target
      ? (target === '@team'
          ? teamId
          : (this.teammateNameToAgentId.get(String(target).replace(/^@/, '').trim()) || null))
      : null

    if (actorId || targetId) {
      return {
        agentId: actorId || targetId,
        actorId: actorId || targetId,
        ...(targetId ? { targetId } : {})
      }
    }

    return null
  }

  rememberAgentToolUse(toolUse, rawMessage = null) {
    if (!toolUse?.toolUseId) {
      return
    }

    const input = toolUse.toolInput || {}
    const rawName = String(toolUse.rawName || '').trim()
    this.pendingAgentToolUses.set(toolUse.toolUseId, {
      rawName,
      toolUseId: toolUse.toolUseId,
      prompt: input.prompt || input.task || input.description || null,
      description: input.description || null,
      model: input.model || null,
      name: input.name || input.role || null,
      agentType: input.subagent_type || input.subagentType || input.agentType || input.agent_type || input.role || null,
      teamName: input.team_name || input.teamName || null,
      rawMessage
    })
  }

  emitTeamCreateLifecycle(toolResult = {}, rawMessage = null) {
    const teamName = toolResult.team_name || toolResult.teamName || null
    const teamId = this.resolveTeamId(teamName)
    if (!teamId) {
      return
    }

    const teamCcgui = this.buildLifecycleCcgui({
      agentId: teamId,
      agentKind: 'collaborative',
      agentType: 'team',
      name: teamName,
      prompt: toolResult.team_file_path || null,
      status: 'running',
      ...this.getCollaborativeReadOnlyFields()
    }, {
      eventType: 'start',
      agentId: teamId,
      agentKind: 'collaborative',
      agentType: 'team',
      name: teamName,
      source: 'team_create',
      status: 'running'
    })
    this.emitAgentSilent(teamCcgui, rawMessage)

    const leadProviderId = toolResult.lead_agent_id || toolResult.leadAgentId || null
    if (!leadProviderId) {
      return
    }

    this.teamLeadByTeamId.set(teamId, leadProviderId)
    const leadCcgui = this.buildLifecycleCcgui({
      agentId: leadProviderId,
      agentKind: 'collaborative',
      agentType: 'team-lead',
      name: 'Team Lead',
      teamId,
      status: 'running',
      ...this.getCollaborativeReadOnlyFields()
    }, {
      eventType: 'start',
      agentId: leadProviderId,
      agentKind: 'collaborative',
      agentType: 'team-lead',
      teamId,
      source: 'team_create',
      status: 'running'
    })
    this.emitAgentSilent(leadCcgui, rawMessage)
  }

  emitTeamDeleteLifecycle(toolResult = {}, rawMessage = null) {
    const teamName = toolResult.team_name || toolResult.teamName || null
    const teamId = this.resolveTeamId(teamName)
    if (!teamId) {
      return
    }

    for (const agentId of this.teamMembersByTeamId.get(teamId) || []) {
      const memberDelete = this.buildLifecycleCcgui({
        agentId,
        status: 'deleted'
      }, {
        eventType: 'delete',
        agentId,
        reason: 'team_cleanup',
        targetKind: 'agent',
        status: 'deleted',
        actorId: this.teamLeadByTeamId.get(teamId) || null,
        targetId: agentId
      })
      this.emitAgentSilent(memberDelete, rawMessage)
    }

    const teamDelete = this.buildLifecycleCcgui({
      agentId: teamId,
      status: 'deleted'
    }, {
      eventType: 'delete',
      agentId: teamId,
      reason: 'team_cleanup',
      targetKind: 'team',
      status: 'deleted',
      actorId: this.teamLeadByTeamId.get(teamId) || null,
      targetId: teamId
    })
    this.emitAgentSilent(teamDelete, rawMessage)
  }

  emitProviderSystemNotification(type, payload = {}) {
    this.emit('system-notification', {
      type,
      provider: 'claude',
      ...payload
    })
  }

  normalizeToolUseBlock(contentBlock = {}) {
    const blockType = String(contentBlock?.type || '').toLowerCase()
    if (blockType !== 'tool_use' && blockType !== 'server_tool_use' && blockType !== 'mcp_tool_use') {
      return null
    }

    const rawName =
      contentBlock.name ||
      contentBlock.tool_name ||
      contentBlock.tool ||
      'UnknownTool'
    const serverName =
      contentBlock.mcp_server_name ||
      contentBlock.server_name ||
      contentBlock.server ||
      ''
    const toolName = serverName ? `${serverName}.${rawName}` : rawName
    const toolUseId =
      contentBlock.id ||
      contentBlock.tool_use_id ||
      contentBlock.call_id ||
      `${blockType}-${Date.now()}`

    return {
      blockType,
      rawName,
      toolName,
      toolUseId,
      toolInput: contentBlock.input || contentBlock.arguments || {}
    }
  }

  shouldTreatAsErrorResult(resultMessage = {}) {
    if (resultMessage?.is_error === true) {
      return true
    }
    const subtype = String(resultMessage?.subtype || '').toLowerCase()
    return subtype.startsWith('error')
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

    if (message.type === 'sidechain_entry') {
      this.handleSidechainEntry(message)
      return
    }

    if (message.type === 'result') {
      if (this.shouldTreatAsErrorResult(message)) {
        const subtype = message?.subtype || 'error'
        const errorText =
          message?.result ||
          message?.error ||
          message?.message ||
          'Claude turn failed'
        this.emitProviderSystemNotification('turn-error', {
          errorType: subtype,
          message: String(errorText),
          metadata: message
        })
      }
      this.emit('result', message)
      return
    }

    this.emitProviderSystemNotification('provider-message', {
      messageType: message?.type || 'unknown',
      metadata: message
    })
    this.emit('silent-message', {
      messageType: `claude/${message?.type || 'unknown'}`,
      params: message,
      timestamp: new Date().toISOString()
    })
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
      if (request?.silent !== true) {
        this.emit('system-notification', {
          type: 'session-model-changed',
          provider: 'claude',
          model: String(request.model)
        })
      }
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
      if (request?.silent !== true) {
        this.emit('system-notification', {
          type: 'session-model-changed',
          provider: 'claude',
          model: String(request.model)
        })
      }
    }
  }

  getSessionIdentifier() {
    return this.sessionId || null
  }

  getSessionSettingsPatch() {
    return {
      toolBinding: {
        tool: 'claude',
        nativeSessionId: this.sessionId || null
      }
    }
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
      const candidate = this.pendingAgentToolUses.get(message.tool_use_id) || null
      const teamId = this.resolveTeamId(message.team_name || candidate?.teamName || null)
      const isTeamMember = message.task_type === 'in_process_teammate' || Boolean(message.teammate_id || message.agent_id || teamId)
      const isKnownExecutionTask = Boolean(
        candidate?.rawName === 'Agent' ||
        (message.task_id && this.taskIdToAgentId.has(message.task_id)) ||
        (message.tool_use_id && this.toolUseIdToAgentId.has(message.tool_use_id)) ||
        (message.agent_id && this.providerAgentIdToAgentId.has(message.agent_id))
      )
      const agentId = isTeamMember
        ? this.resolveTeamMemberAgentId({
            teamId,
            taskId: message.task_id,
            teammateId: message.teammate_id,
            providerAgentId: message.agent_id,
            name: message.name || candidate?.name || candidate?.agentType,
            toolUseId: message.tool_use_id || candidate?.toolUseId || null
          })
        : (isKnownExecutionTask
            ? this.resolveExecutionAgentId({
                taskId: message.task_id,
                toolUseId: message.tool_use_id || candidate?.toolUseId || null,
                providerAgentId: message.agent_id || null
              })
            : null)
      const agentKind = isTeamMember ? 'collaborative' : 'execution'
      const agentType = isTeamMember
        ? (candidate?.agentType || message.name || 'team-member')
        : (candidate?.agentType || 'subagent')
      const lifecycleCcgui = agentId
        ? this.buildLifecycleCcgui({
            agentId,
            agentKind,
            agentType,
            name: message.name || candidate?.name || agentType,
            prompt: message.prompt || candidate?.prompt || candidate?.description || null,
            model: candidate?.model || null,
            teamId,
            parentAgentId: teamId ? (this.teamLeadByTeamId.get(teamId) || null) : null,
            status: 'running',
            ...(isTeamMember ? this.getCollaborativeReadOnlyFields() : {})
          }, {
            eventType: 'start',
            agentId,
            agentKind,
            agentType,
            name: message.name || candidate?.name || agentType,
            prompt: message.prompt || candidate?.prompt || candidate?.description || null,
            model: candidate?.model || null,
            teamId,
            parentAgentId: teamId ? (this.teamLeadByTeamId.get(teamId) || null) : null,
            source: isTeamMember ? 'team_member_spawn' : 'subagent_spawn',
            status: 'running'
          })
        : null
      if (isTeamMember && agentId) {
        this.watchSidechainAgent({
          agentId,
          name: message.name || candidate?.name || agentType,
          prompt: message.prompt || candidate?.prompt || candidate?.description || null,
          teamId,
          agentType: candidate?.agentType || agentType || null
        })
      }
      this.emit('task-event', {
        eventType: 'started',
        taskId: message.task_id,
        taskType: message.task_type,
        description: message.description,
        prompt: message.prompt,
        tool_use_id: message.tool_use_id || null,
        ccgui: lifecycleCcgui,
        rawMessage: message
      })
      return
    }

    if (message.subtype === 'task_progress') {
      const agentId = this.taskIdToAgentId.get(message.task_id) || null
      this.emit('task-event', {
        eventType: 'progress',
        taskId: message.task_id,
        usage: message.usage,
        summary: message.summary,
        description: message.description,
        tool_use_id: message.tool_use_id || null,
        ccgui: this.buildCcguiPatch({
          attribution: agentId
            ? {
                agentId,
                actorId: agentId
              }
            : null
        }),
        rawMessage: message
      })
      return
    }

    if (message.subtype === 'task_notification') {
      const agentId = this.taskIdToAgentId.get(message.task_id) || null
      this.emit('task-event', {
        eventType: 'notification',
        taskId: message.task_id,
        tool_use_id: message.tool_use_id || null,
        ccgui: this.buildCcguiPatch({
          attribution: agentId
            ? {
                agentId,
                actorId: agentId
              }
            : null
        }),
        rawMessage: message
      })
      return
    }

    this.emitProviderSystemNotification('provider-system-message', {
      subtype: message?.subtype || 'unknown',
      metadata: message
    })
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
      const assistantAttribution = this.getAttributionForClaudeMessage(event.message || {})
      this.currentAssistantMessage = {
        id: messageId,
        usage: event.message?.usage || null,
        stopReason: null,
        attribution: assistantAttribution
      }
      this.assistantSnapshots.set(messageId, {
        thinking: '',
        content: ''
      })
      this.currentTurnNumber = 0
      this.hasSeenToolUseInCurrentTurn = false
      this.contentBlockIndexToId.clear()
      this.contentBlockState.clear()

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
      const blockIndex = typeof event.index === 'number' ? event.index : null

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

      const toolUse = this.normalizeToolUseBlock(contentBlock)
      if (toolUse) {
        this.hasSeenToolUseInCurrentTurn = true
        if (toolUse.rawName === 'AskUserQuestion') {
          return
        }

        if (blockIndex !== null) {
          this.contentBlockIndexToId.set(blockIndex, toolUse.toolUseId)
          this.contentBlockState.set(blockIndex, {
            type: 'tool_use',
            toolUseId: toolUse.toolUseId
          })
        }
        this.toolUseMessages.set(toolUse.toolUseId, {
          toolInputBuffer: ''
        })
        if (['Agent', 'TeamCreate', 'SendMessage', 'TeamDelete'].includes(toolUse.rawName)) {
          this.rememberAgentToolUse(toolUse, message)
        }

        this.emit('message-start', {
          id: toolUse.toolUseId,
          role: this.isDiffToolName(toolUse.rawName) ? 'diff' : 'tool_use',
          toolName: toolUse.toolName,
          toolInput: toolUse.toolInput ? { ...toolUse.toolInput } : {},
          result: '',
          isError: false,
          isExecuting: true,
          request_id: toolUse.toolUseId,
          collapsed: false,
          thinking: '',
          hasThinking: false,
          timestamp: new Date(),
          startTime: Date.now(),
          ccgui: this.buildCcguiPatch({
            attribution: this.currentAssistantMessage?.attribution || this.getAttributionForClaudeMessage(event.message || message)
          }),
          rawMessages: [message]
        })
        return
      }

      if (contentBlock?.type === 'compaction') {
        if (blockIndex !== null) {
          this.contentBlockState.set(blockIndex, {
            type: 'compaction',
            content: ''
          })
        }
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

      if (delta?.type === 'citations_delta' && this.currentAssistantMessage?.id) {
        this.emit('silent-message', {
          messageType: 'claude/citations_delta',
          params: {
            messageId: this.currentAssistantMessage.id,
            index: event.index,
            citation: delta.citation || null
          },
          timestamp: new Date().toISOString()
        })
      }

      if (delta?.type === 'signature_delta' && this.currentAssistantMessage?.id) {
        this.emit('message-update', {
          messageId: this.currentAssistantMessage.id,
          updates: {
            thinkingSignature: delta.signature || null
          }
        })
      }

      if (delta?.type === 'compaction_delta' && typeof event.index === 'number') {
        const blockState = this.contentBlockState.get(event.index)
        if (blockState?.type === 'compaction') {
          blockState.content = `${blockState.content || ''}${delta.content || ''}`
          this.contentBlockState.set(event.index, blockState)
        }
      }
      return
    }

    if (event.type === 'content_block_stop') {
      if (typeof event.index === 'number') {
        const blockState = this.contentBlockState.get(event.index)
        if (blockState?.type === 'compaction' && blockState.content.trim()) {
          this.emitProviderSystemNotification('context_compacted', {
            summary: blockState.content,
            metadata: {
              source: 'claude-compaction-block',
              index: event.index
            }
          })
        }
        this.contentBlockState.delete(event.index)
        this.contentBlockIndexToId.delete(event.index)
      }

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

    const candidate = this.pendingAgentToolUses.get(toolUseId) || null
    const toolResult = message?.tool_use_result || {}
    const resultUsage = toolResult?.usage || toolResultContent?.usage || null
    const teamId = this.resolveTeamId(toolResult.team_name || candidate?.teamName || null)
    const isTeamCreate = candidate?.rawName === 'TeamCreate'
    const isTeamDelete = candidate?.rawName === 'TeamDelete'
    const isSendMessage = candidate?.rawName === 'SendMessage'
    const isTeamMember = toolResult.status === 'teammate_spawned' || Boolean(toolResult.teammate_id || toolResult.agent_id || teamId)
    const isExecutionAgentResult = Boolean(
      candidate?.rawName === 'Agent' ||
      this.toolUseIdToAgentId.has(toolUseId) ||
      ((toolResult.agent_id || toolResult.agentId || null) && this.providerAgentIdToAgentId.has(toolResult.agent_id || toolResult.agentId || null))
    )
    const agentId = isTeamMember
      ? this.resolveTeamMemberAgentId({
          teamId,
          teammateId: toolResult.teammate_id,
          providerAgentId: toolResult.agent_id || toolResult.agentId || null,
          name: toolResult.name || candidate?.name || null,
          toolUseId
        })
      : (isExecutionAgentResult
          ? this.resolveExecutionAgentId({
              toolUseId,
              providerAgentId: toolResult.agent_id || toolResult.agentId || null
            })
          : null)
    const toolAttribution = isSendMessage
      ? this.getAttributionForClaudeMessage({
          ...message,
          team_name: toolResult.team_name || candidate?.teamName || null,
          routing: toolResult.routing || null
        })
      : this.getAttributionForClaudeMessage(message)

    if (isTeamCreate) {
      this.emitTeamCreateLifecycle(toolResult, message)
    } else if (isTeamDelete) {
      this.emitTeamDeleteLifecycle(toolResult, message)
    } else if (isTeamMember && agentId) {
      const startCcgui = this.buildLifecycleCcgui({
        agentId,
        agentKind: 'collaborative',
        agentType: candidate?.agentType || toolResult.name || 'team-member',
        name: toolResult.name || candidate?.name || null,
        color: this.resolveAgentColor(
          toolResult.color
          || toolResult.agent_color
          || toolResult.routing?.targetColor
          || toolResult.routing?.senderColor
          || candidate?.color
          || candidate?.agentColor
          || null
        ),
        prompt: candidate?.prompt || candidate?.description || null,
        model: candidate?.model || null,
        teamId,
        parentAgentId: teamId ? (this.teamLeadByTeamId.get(teamId) || null) : null,
        status: 'running',
        ...this.getCollaborativeReadOnlyFields()
      }, {
        eventType: 'start',
        agentId,
        agentKind: 'collaborative',
        agentType: candidate?.agentType || toolResult.name || 'team-member',
        name: toolResult.name || candidate?.name || null,
        color: this.resolveAgentColor(
          toolResult.color
          || toolResult.agent_color
          || toolResult.routing?.targetColor
          || toolResult.routing?.senderColor
          || candidate?.color
          || candidate?.agentColor
          || null
        ),
        prompt: candidate?.prompt || candidate?.description || null,
        model: candidate?.model || null,
        teamId,
        parentAgentId: teamId ? (this.teamLeadByTeamId.get(teamId) || null) : null,
        source: 'team_member_spawn',
        status: 'running'
      })
      this.emitAgentSilent(startCcgui, message)
      this.watchSidechainAgent({
        agentId,
        name: toolResult.name || candidate?.name || null,
        prompt: candidate?.prompt || candidate?.description || null,
        teamId,
        agentType: candidate?.agentType || toolResult.name || null
      })
    }

    if (!isTeamCreate && !isTeamDelete && !isTeamMember && isExecutionAgentResult && agentId && !this.agentRegistry.has(agentId)) {
      const startCcgui = this.buildLifecycleCcgui({
        agentId,
        agentKind: 'execution',
        agentType: candidate?.agentType || 'subagent',
        name: candidate?.name || candidate?.agentType || 'Agent',
        prompt: candidate?.prompt || candidate?.description || null,
        model: candidate?.model || null,
        status: 'running'
      }, {
        eventType: 'start',
        agentId,
        agentKind: 'execution',
        agentType: candidate?.agentType || 'subagent',
        name: candidate?.name || candidate?.agentType || 'Agent',
        prompt: candidate?.prompt || candidate?.description || null,
        model: candidate?.model || null,
        source: 'subagent_spawn',
        status: 'running'
      })
      this.emitAgentSilent(startCcgui, message)
    }

    const lifecycleCcgui = (!isTeamCreate && !isTeamDelete && !isTeamMember && isExecutionAgentResult && agentId)
      ? this.buildLifecycleCcgui({
          agentId,
          agentKind: 'execution',
          agentType: candidate?.agentType || 'subagent',
          name: candidate?.name || candidate?.agentType || 'Agent',
          prompt: candidate?.prompt || candidate?.description || null,
          model: candidate?.model || null,
          status: 'ended'
        }, {
          eventType: 'end',
          agentId,
          reason: 'completed',
          result: toolResultContent.content || null,
          status: 'ended'
        })
      : null

    this.emit('tool-result', {
      toolUseId,
      content: toolResultContent.content || '(无输出)',
      isError: toolResultContent.is_error || false,
      usage: resultUsage,
      answers: toolResult.answers || toolResultContent?.answers || null,
      agentId: toolResult.agentId || toolResult.agent_id || null,
      parent_tool_use_id: message?.parent_tool_use_id || null,
      ccgui: this.buildCcguiPatch({
        ...(lifecycleCcgui?.registry ? { registry: lifecycleCcgui.registry } : {}),
        ...(lifecycleCcgui?.orchestration ? { orchestration: lifecycleCcgui.orchestration } : {}),
        attribution: toolAttribution || (agentId ? { agentId, actorId: agentId } : null)
      }),
      rawMessage: message
    })

    const updateAttribution = agentId
      ? { agentId, actorId: agentId }
      : (toolAttribution?.agentId ? toolAttribution : null)

    this.emit('message-update', {
      messageId: toolUseId,
      updates: {
        isExecuting: false,
        isError: toolResultContent.is_error || false,
        result: toolResultContent.content || '(无输出)',
        ...(resultUsage ? { usage: resultUsage } : {}),
        ...(updateAttribution
          ? {
              ccgui: this.buildCcguiPatch({
                attribution: updateAttribution
              })
            }
          : {}),
        rawMessages: [message]
      }
    })

    this.pendingAgentToolUses.delete(toolUseId)
  }

  handleAssistantMessage(message) {
    const assistantMessage = message.message || {}
    const messageId = assistantMessage.id || message.uuid || `assistant-${Date.now()}`
    const messageTimestamp = message?.timestamp ? new Date(message.timestamp) : new Date()
    const messageStartTime = message?.timestamp ? Date.parse(message.timestamp) : Date.now()
    const content = Array.isArray(assistantMessage.content) ? assistantMessage.content : []
    const thinkingText = content
      .filter(block => block?.type === 'thinking' && typeof block.thinking === 'string')
      .map(block => block.thinking)
      .join('')
    const textContent = content
      .filter(block => block?.type === 'text' && typeof block.text === 'string')
      .map(block => block.text)
      .join('')
    const toolUses = content
      .map(block => this.normalizeToolUseBlock(block))
      .filter(Boolean)
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
          startTime: Number.isFinite(messageStartTime) ? messageStartTime : Date.now(),
          timestamp: messageTimestamp,
          usage: assistantMessage.usage || null,
          turnNumber: this.currentTurnNumber || 1,
          ccgui: this.buildCcguiPatch({
            attribution: this.getAttributionForClaudeMessage(message)
          }),
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
      if (toolUse.rawName === 'AskUserQuestion') {
        continue
      }

      const toolUseId = toolUse.toolUseId || `tool-${Date.now()}`
      if (this.toolUseMessages.has(toolUseId)) {
        continue
      }
      this.toolUseMessages.set(toolUseId, {
        toolInputBuffer: ''
      })
      if (['Agent', 'TeamCreate', 'SendMessage', 'TeamDelete'].includes(toolUse.rawName)) {
        this.rememberAgentToolUse(toolUse, message)
      }

      this.emit('message-start', {
        id: toolUseId,
        role: this.isDiffToolName(toolUse.rawName) ? 'diff' : 'tool_use',
        toolName: toolUse.toolName,
        toolInput: toolUse.toolInput ? { ...toolUse.toolInput } : {},
        result: '',
        isError: false,
        isExecuting: true,
        request_id: toolUseId,
        collapsed: false,
        thinking: '',
        hasThinking: false,
        timestamp: messageTimestamp,
        startTime: Number.isFinite(messageStartTime) ? messageStartTime : Date.now(),
        ccgui: this.buildCcguiPatch({
          attribution: this.getAttributionForClaudeMessage(message)
        }),
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

  resolveSidechainAgentId(message = {}) {
    return message?.agentId || null
  }

  parseTeammateMessage(text = '') {
    if (typeof text !== 'string' || !text.trim()) {
      return null
    }

    const match = text.match(/^<teammate-message\b([^>]*)>([\s\S]*?)<\/teammate-message>\s*$/)
    if (!match) {
      return null
    }

    const [, rawAttrs = '', rawBody = ''] = match
    const attrs = {}
    for (const attrMatch of rawAttrs.matchAll(/([a-zA-Z0-9_:-]+)="([^"]*)"/g)) {
      attrs[attrMatch[1]] = attrMatch[2]
    }

    return {
      sender: attrs.teammate_id || attrs.sender || '',
      summary: attrs.summary || '',
      content: rawBody.trim()
    }
  }

  handleSidechainEntry(message) {
    const entry = message?.entry
    if (!entry || typeof entry !== 'object') {
      return
    }

    const stableId = entry.uuid || entry.message?.id || null
    if (stableId && this.sidechainMessageIds.has(stableId)) {
      return
    }
    if (stableId) {
      this.sidechainMessageIds.add(stableId)
    }

    const agentId = this.resolveSidechainAgentId(message)
    if (!agentId) {
      return
    }

    const attribution = {
      agentId,
      actorId: agentId
    }

    const timestamp = entry.timestamp ? new Date(entry.timestamp) : new Date()
    const startTime = entry.timestamp ? Date.parse(entry.timestamp) : Date.now()
    const ccgui = this.buildCcguiPatch({
      attribution
    })
    const messageContent = entry.message?.content

    if (entry.type === 'assistant' && entry.message && typeof entry.message === 'object') {
      const assistantMessage = entry.message
      const assistantContent = Array.isArray(assistantMessage.content) ? assistantMessage.content : []
      const textContent = assistantContent
        .filter(item => item?.type === 'text' && typeof item.text === 'string')
        .map(item => item.text)
        .join('\n')
      const thinkingContent = assistantContent
        .filter(item => item?.type === 'thinking' && typeof item.thinking === 'string')
        .map(item => item.thinking)
        .join('\n')
      const assistantMessageId = assistantMessage.id || `sidechain-assistant:${agentId}:${entry.uuid || Date.now()}`

      if (textContent || thinkingContent) {
        this.emit('message-start', {
          id: assistantMessageId,
          role: 'assistant',
          content: textContent,
          thinking: thinkingContent,
          hasThinking: Boolean(thinkingContent),
          isStreaming: false,
          timestamp,
          startTime: Number.isFinite(startTime) ? startTime : Date.now(),
          usage: assistantMessage.usage || null,
          ccgui,
          rawMessages: [entry]
        })
        this.emit('message-complete', {
          messageId: assistantMessageId,
          updates: {
            isStreaming: false,
            thinkingCollapsed: Boolean(thinkingContent)
          }
        })
      }

      for (const item of assistantContent) {
        const toolUse = this.normalizeToolUseBlock(item)
        if (!toolUse || toolUse.rawName === 'AskUserQuestion') {
          continue
        }

        if (['Agent', 'TeamCreate', 'SendMessage', 'TeamDelete'].includes(toolUse.rawName)) {
          this.rememberAgentToolUse(toolUse, entry)
        }

        if (this.toolUseMessages.has(toolUse.toolUseId)) {
          continue
        }

        this.toolUseMessages.set(toolUse.toolUseId, {
          toolInputBuffer: ''
        })

        this.emit('message-start', {
          id: toolUse.toolUseId,
          role: this.isDiffToolName(toolUse.rawName) ? 'diff' : 'tool_use',
          toolName: toolUse.toolName,
          toolInput: toolUse.toolInput ? { ...toolUse.toolInput } : {},
          result: '',
          isError: false,
          isExecuting: true,
          request_id: toolUse.toolUseId,
          collapsed: false,
          thinking: '',
          hasThinking: false,
          timestamp,
          startTime: Number.isFinite(startTime) ? startTime : Date.now(),
          ccgui,
          rawMessages: [entry]
        })
      }
      return
    }

    if (Array.isArray(messageContent)) {
      const toolResultContent = messageContent.find(item => item?.type === 'tool_result')
      if (toolResultContent) {
        this.handleToolResultMessage({
          ...entry,
          type: 'user',
          agentId: entry.agentId,
          message: entry.message,
          tool_use_result: entry.toolUseResult || entry.tool_use_result || {}
        }, toolResultContent)
        return
      }
    }

    const textContent = typeof messageContent === 'string'
      ? messageContent
      : (Array.isArray(messageContent)
          ? messageContent
            .filter(item => item?.type === 'text' && typeof item.text === 'string')
            .map(item => item.text)
            .join('\n')
          : '')

    if (!textContent) {
      return
    }

    const teammateMessage = this.parseTeammateMessage(textContent)
    if (teammateMessage) {
      const messageId = `sidechain-receive:${agentId}:${entry.uuid || entry.parentUuid || Date.now()}`
      this.emit('message-start', {
        id: messageId,
        role: 'tool_use',
        toolName: 'ReceiveMessage',
        toolInput: {
          from: teammateMessage.sender,
          summary: teammateMessage.summary,
          content: teammateMessage.content
        },
        result: '',
        isError: false,
        isExecuting: false,
        request_id: messageId,
        collapsed: false,
        thinking: '',
        hasThinking: false,
        timestamp,
        startTime: Number.isFinite(startTime) ? startTime : Date.now(),
        ccgui,
        rawMessages: [entry]
      })
      this.emit('message-complete', {
        messageId,
        updates: {
          isStreaming: false
        }
      })
      return
    }

    const messageId = `sidechain:${agentId}:${entry.uuid || entry.parentUuid || Date.now()}`
    this.emit('message-start', {
      id: messageId,
      role: 'user',
      content: textContent,
      thinking: '',
      hasThinking: false,
      isStreaming: false,
      timestamp,
      startTime: Number.isFinite(startTime) ? startTime : Date.now(),
      ccgui,
      rawMessages: [entry]
    })
    this.emit('message-complete', {
      messageId,
      updates: {
        isStreaming: false
      }
    })
  }
}

module.exports = { ClaudeAdapter }
