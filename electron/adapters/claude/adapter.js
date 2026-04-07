const fs = require('fs')
const path = require('path')
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
    this.lastVisibleMessageId = null  // 当前 raw message 内最后一个有效可见消息 ID，用于挂 usage
    this.contentBlockMessageIds = new Map()  // blockIndex → messageId 映射
    this.streamedAssistantMessageIds = new Set()
    this.envInfo = {
      cwd: this.workingDirectory,
      session_id: this.sessionId,
      provider: 'claude',
      providerPid: null,
      rewindCapabilities: {
        reset: true,
        patch: false,
        forkReset: true,
        forkPatch: false
      }
    }
    this.pendingAgentToolUses = new Map()
    this.pendingCollaborativePreAgentsByToolUseId = new Map()
    this.pendingCollaborativePreAgentsByAddressKey = new Map()
    this.pendingCollaborativePreAgentsByTaskId = new Map()
    this.pendingCollaborativePreAgentsByProviderAgentId = new Map()
    this.collaborativeAddressToAgentId = new Map()
    this.taskIdToAgentId = new Map()
    this.toolUseIdToAgentId = new Map()
    this.providerAgentIdToAgentId = new Map()
    this.startedExecutionAgentIds = new Set()
    this.teamNameToTeamId = new Map()
    this.sidechainMessageIds = new Set()
    this.turnInterrupted = false
    this.currentTurnUserMessageId = null
    // rewind 预获取状态：实际还原前先发 dry_run=true，拿到文件数据后再执行并注入响应
    this.rewindPreviewStage = null  // null | 'fetching' | 'pending'
    this.rewindPreviewData = null   // { files, insertions, deletions }
    this.pendingRewindRequest = null
    this.pendingRewindExecuteRequestId = null
    // dry_run 请求分流：rewind 预获取 / FileChangeSummary 都走 rewind_files + dry_run
    this.pendingDryRunRequests = new Map()
  }

  getCollaborativeReadOnlyFields() {
    return {
      canWrite: false,
      interactionMode: 'read-only'
    }
  }

  pickTeamMemberAgentType(...values) {
    for (const value of values) {
      if (typeof value !== 'string') {
        continue
      }
      const normalized = value.trim()
      if (!normalized) {
        continue
      }
      if (normalized.toLowerCase() === 'team-member') {
        continue
      }
      return normalized
    }
    return 'team-member'
  }

  resolveAgentColor(value) {
    if (typeof value !== 'string') {
      return null
    }
    const trimmed = value.trim()
    return trimmed || null
  }

  buildTeamMemberAddressKey(name = null, teamName = null) {
    const normalizedName = String(name || '').trim()
    const normalizedTeamName = String(teamName || '').trim()
    if (!normalizedName || !normalizedTeamName) {
      return null
    }
    return `${normalizedName}@${normalizedTeamName}`
  }

  createCollaborativePreAgent({
    toolUseId = null,
    name = null,
    teamName = null,
    prompt = null,
    description = null,
    model = null,
    agentType = null
  } = {}) {
    if (!toolUseId) {
      return null
    }

    const existing = this.pendingCollaborativePreAgentsByToolUseId.get(toolUseId) || null
    const nextPreAgent = {
      stage: 'pre',
      toolUseId,
      name: name || existing?.name || null,
      teamName: teamName || existing?.teamName || null,
      addressKey: this.buildTeamMemberAddressKey(name, teamName) || existing?.addressKey || null,
      prompt: prompt || existing?.prompt || null,
      description: description || existing?.description || null,
      model: model || existing?.model || null,
      agentType: agentType || existing?.agentType || null,
      taskId: existing?.taskId || null,
      providerAgentId: existing?.providerAgentId || null,
      teammateId: existing?.teammateId || null,
      pendingTaskStartedMessage: existing?.pendingTaskStartedMessage || null
    }

    return this.updateCollaborativePreAgent(nextPreAgent, {})
  }

  findCollaborativePreAgent({
    toolUseId = null,
    teammateId = null,
    providerAgentId = null,
    taskId = null,
    name = null,
    teamName = null
  } = {}) {
    if (toolUseId && this.pendingCollaborativePreAgentsByToolUseId.has(toolUseId)) {
      return this.pendingCollaborativePreAgentsByToolUseId.get(toolUseId)
    }
    if (providerAgentId && this.pendingCollaborativePreAgentsByProviderAgentId.has(providerAgentId)) {
      return this.pendingCollaborativePreAgentsByProviderAgentId.get(providerAgentId)
    }
    if (taskId && this.pendingCollaborativePreAgentsByTaskId.has(taskId)) {
      return this.pendingCollaborativePreAgentsByTaskId.get(taskId)
    }
    if (teammateId && this.pendingCollaborativePreAgentsByAddressKey.has(teammateId)) {
      return this.pendingCollaborativePreAgentsByAddressKey.get(teammateId)
    }
    const addressKey = this.buildTeamMemberAddressKey(name, teamName)
    if (addressKey && this.pendingCollaborativePreAgentsByAddressKey.has(addressKey)) {
      return this.pendingCollaborativePreAgentsByAddressKey.get(addressKey)
    }
    return null
  }

  updateCollaborativePreAgent(preAgent, patch = {}) {
    if (!preAgent?.toolUseId) {
      return null
    }

    const nextPreAgent = {
      ...preAgent,
      ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
    }

    const previous = this.pendingCollaborativePreAgentsByToolUseId.get(nextPreAgent.toolUseId) || null
    if (previous?.addressKey && previous.addressKey !== nextPreAgent.addressKey) {
      this.pendingCollaborativePreAgentsByAddressKey.delete(previous.addressKey)
    }
    if (previous?.taskId && previous.taskId !== nextPreAgent.taskId) {
      this.pendingCollaborativePreAgentsByTaskId.delete(previous.taskId)
    }
    if (previous?.providerAgentId && previous.providerAgentId !== nextPreAgent.providerAgentId) {
      this.pendingCollaborativePreAgentsByProviderAgentId.delete(previous.providerAgentId)
    }

    this.pendingCollaborativePreAgentsByToolUseId.set(nextPreAgent.toolUseId, nextPreAgent)
    if (nextPreAgent.addressKey) {
      this.pendingCollaborativePreAgentsByAddressKey.set(nextPreAgent.addressKey, nextPreAgent)
    }
    if (nextPreAgent.taskId) {
      this.pendingCollaborativePreAgentsByTaskId.set(nextPreAgent.taskId, nextPreAgent)
    }
    if (nextPreAgent.providerAgentId) {
      this.pendingCollaborativePreAgentsByProviderAgentId.set(nextPreAgent.providerAgentId, nextPreAgent)
    }

    return nextPreAgent
  }

  clearCollaborativePreAgent(preAgent) {
    if (!preAgent?.toolUseId) {
      return
    }
    this.pendingCollaborativePreAgentsByToolUseId.delete(preAgent.toolUseId)
    if (preAgent.addressKey) {
      this.pendingCollaborativePreAgentsByAddressKey.delete(preAgent.addressKey)
    }
    if (preAgent.taskId) {
      this.pendingCollaborativePreAgentsByTaskId.delete(preAgent.taskId)
    }
    if (preAgent.providerAgentId) {
      this.pendingCollaborativePreAgentsByProviderAgentId.delete(preAgent.providerAgentId)
    }
  }

  clearPendingCollaborativePreAgents() {
    this.pendingCollaborativePreAgentsByToolUseId.clear()
    this.pendingCollaborativePreAgentsByAddressKey.clear()
    this.pendingCollaborativePreAgentsByTaskId.clear()
    this.pendingCollaborativePreAgentsByProviderAgentId.clear()
  }

  clearPendingAgentToolUses() {
    this.pendingAgentToolUses.clear()
  }

  isTerminalTaskStatus(status) {
    const normalized = String(status || '').trim().toLowerCase()
    return normalized === 'completed' ||
      normalized === 'stopped' ||
      normalized === 'failed' ||
      normalized === 'cancelled' ||
      normalized === 'canceled'
  }

  clearProviderAgentMappings(agentId) {
    if (!agentId) {
      return
    }
    for (const [providerAgentId, mappedAgentId] of this.providerAgentIdToAgentId.entries()) {
      if (mappedAgentId === agentId) {
        this.providerAgentIdToAgentId.delete(providerAgentId)
      }
    }
  }

  clearCollaborativeAddressMappings(agentId) {
    if (!agentId) {
      return
    }
    for (const [addressKey, mappedAgentId] of this.collaborativeAddressToAgentId.entries()) {
      if (mappedAgentId === agentId) {
        this.collaborativeAddressToAgentId.delete(addressKey)
      }
    }
  }

  cleanupAgentCorrelation({ agentId = null, taskId = null, toolUseId = null, clearProvider = false } = {}) {
    if (taskId) {
      this.taskIdToAgentId.delete(taskId)
    }
    if (toolUseId) {
      this.toolUseIdToAgentId.delete(toolUseId)
    }
    if (agentId) {
      this.startedExecutionAgentIds.delete(agentId)
      if (clearProvider) {
        this.clearProviderAgentMappings(agentId)
        this.clearCollaborativeAddressMappings(agentId)
      }
    }
  }

  sanitizeSemanticId(value, fallback = 'agent') {
    const normalized = String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
    return normalized || fallback
  }

  normalizeMainAgentAlias(value) {
    const normalized = String(value || '')
      .replace(/^@/, '')
      .trim()
      .toLowerCase()

    if (!normalized) {
      return null
    }

    if (
      normalized === 'master' ||
      normalized === 'team-lead' ||
      normalized === 'team lead' ||
      normalized === 'teamlead' ||
      normalized.startsWith('team-lead@')
    ) {
      return 'master'
    }

    return null
  }

  isCollaborativeAgentId(agentId) {
    const normalized = String(agentId || '').trim()
    return normalized.startsWith('claude-team-member:') ||
      normalized.startsWith('claude-team:') ||
      normalized.startsWith('team-lead@') ||
      normalized === 'master'
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

  emitAgentUpdate(registry = {}, rawMessage = null, extra = {}) {
    const normalizedRegistry = registry?.agentId
      ? Object.fromEntries(Object.entries(registry).filter(([, value]) => value !== null && value !== undefined))
      : null
    if (!normalizedRegistry?.agentId) {
      return
    }

    this.emit('agent-update', {
      provider: 'claude',
      ...(rawMessage ? { rawMessage } : {}),
      ...extra,
      ccgui: this.buildCcguiPatch({ registry: normalizedRegistry }),
      timestamp: new Date().toISOString()
    })
  }

  buildLifecycleCcgui(entry = {}, orchestration = {}) {
    const registry = entry?.agentId
      ? Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== null && value !== undefined))
      : null
    return this.buildCcguiPatch({
      registry,
      orchestration: {
        timestamp: new Date().toISOString(),
        ...orchestration,
        agentId: orchestration.agentId || registry?.agentId
      }
    })
  }

  buildCollaborativeTaskCcgui({
    agentId = null,
    teamId = null,
    status = 'running'
  } = {}, orchestration = {}) {
    if (!agentId) {
      return null
    }

    return this.buildCcguiPatch({
      registry: {
        agentId,
        agentKind: 'collaborative',
        teamId: teamId || null,
        parentAgentId: teamId ? 'master' : null,
        status,
        ...this.getCollaborativeReadOnlyFields()
      },
      orchestration: {
        timestamp: new Date().toISOString(),
        ...orchestration,
        agentId
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
    teamName = null,
    toolUseId = null
  } = {}) {
    const preAgent = this.findCollaborativePreAgent({
      toolUseId,
      teammateId,
      providerAgentId,
      taskId
    })
    const stableAddressKey =
      teammateId ||
      preAgent?.addressKey ||
      this.buildTeamMemberAddressKey(name, teamName || preAgent?.teamName || null)
    let unifiedAgentId = null

    if (providerAgentId && this.providerAgentIdToAgentId.has(providerAgentId)) {
      unifiedAgentId = this.providerAgentIdToAgentId.get(providerAgentId)
    } else if (stableAddressKey && this.collaborativeAddressToAgentId.has(stableAddressKey)) {
      unifiedAgentId = this.collaborativeAddressToAgentId.get(stableAddressKey)
    } else if (toolUseId && this.toolUseIdToAgentId.has(toolUseId)) {
      unifiedAgentId = this.toolUseIdToAgentId.get(toolUseId)
    } else if (!stableAddressKey && taskId && this.taskIdToAgentId.has(taskId)) {
      unifiedAgentId = this.taskIdToAgentId.get(taskId)
    }

    const identity = providerAgentId || stableAddressKey
    if (!identity) {
      return null
    }

    if (!unifiedAgentId) {
      unifiedAgentId = teamId
        ? `claude-team-member:${this.sanitizeSemanticId(teamId)}:${this.sanitizeSemanticId(identity)}`
        : `claude-team-member:${this.sanitizeSemanticId(identity)}`
    }

    if (taskId) {
      this.taskIdToAgentId.set(taskId, unifiedAgentId)
    }
    if (toolUseId) {
      this.toolUseIdToAgentId.set(toolUseId, unifiedAgentId)
    }
    if (providerAgentId) {
      this.providerAgentIdToAgentId.set(providerAgentId, unifiedAgentId)
    }
    if (stableAddressKey) {
      this.collaborativeAddressToAgentId.set(stableAddressKey, unifiedAgentId)
    }
    return unifiedAgentId
  }

  getAttributionForClaudeMessage(message = {}) {
    const providerAgentId = message?.agent_id || message?.agentId || null
    const normalizedMainProviderAgentId = this.normalizeMainAgentAlias(providerAgentId)
    if (normalizedMainProviderAgentId) {
      return {
        agentId: normalizedMainProviderAgentId,
        actorId: normalizedMainProviderAgentId
      }
    }

    if (providerAgentId && this.providerAgentIdToAgentId.has(providerAgentId)) {
      const agentId = this.providerAgentIdToAgentId.get(providerAgentId)
      return {
        agentId,
        actorId: agentId
      }
    }

    const teammateId = message?.teammate_id || null
    if (teammateId && this.collaborativeAddressToAgentId.has(teammateId)) {
      const agentId = this.collaborativeAddressToAgentId.get(teammateId)
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
    const senderAddressKey = this.buildTeamMemberAddressKey(
      sender ? String(sender).replace(/^@/, '').trim() : null,
      teamName
    )
    if (senderAddressKey && this.collaborativeAddressToAgentId.has(senderAddressKey)) {
      const agentId = this.collaborativeAddressToAgentId.get(senderAddressKey)
      return {
        agentId,
        actorId: agentId
      }
    }
    const normalizedSender = sender
      ? String(sender).replace(/^@/, '').trim().toLowerCase()
      : null
    const actorId = this.normalizeMainAgentAlias(normalizedSender)
    const targetId = target
      ? (target === '@team'
          ? teamId
          : null)
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
    const previous = this.pendingAgentToolUses.get(toolUse.toolUseId) || null
    const nextCandidate = {
      rawName,
      toolUseId: toolUse.toolUseId,
      prompt: input.prompt || input.task || input.description || previous?.prompt || null,
      description: input.description || previous?.description || null,
      model: input.model || previous?.model || null,
      name: input.name || input.role || previous?.name || null,
      agentType: input.subagent_type || input.subagentType || input.agentType || input.agent_type || input.role || previous?.agentType || null,
      teamName: input.team_name || input.teamName || previous?.teamName || null,
      rawMessage
    }
    this.pendingAgentToolUses.set(toolUse.toolUseId, nextCandidate)

    if (rawName === 'Agent') {
      this.createCollaborativePreAgent({
        toolUseId: toolUse.toolUseId,
        name: nextCandidate.name || null,
        teamName: nextCandidate.teamName || null,
        prompt: nextCandidate.prompt || null,
        description: nextCandidate.description || null,
        model: nextCandidate.model || null,
        agentType: nextCandidate.agentType || null
      })
    }
  }

  updatePendingAgentToolUse(toolUseId, patch = {}) {
    if (!toolUseId || !this.pendingAgentToolUses.has(toolUseId)) {
      return null
    }

    const previous = this.pendingAgentToolUses.get(toolUseId) || {}
    const nextCandidate = {
      ...previous,
      ...Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined))
    }
    this.pendingAgentToolUses.set(toolUseId, nextCandidate)
    return nextCandidate
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
    this.providerAgentIdToAgentId.set(leadProviderId, 'master')
  }

  emitTeamDeleteLifecycle(toolResult = {}, rawMessage = null) {
    const teamName = toolResult.team_name || toolResult.teamName || null
    const teamId = this.resolveTeamId(teamName)
    if (!teamId) {
      return
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
      actorId: 'master',
      targetId: teamId
    })
    this.emitAgentSilent(teamDelete, rawMessage)

    // Team 删除时清理 subagents 目录下所有文件
    this.cleanupSubagentsDirectory()
  }

  cleanupSubagentsDirectory() {
    const subagentsDir = this.getSubagentsDirectory()
    if (!subagentsDir || !fs.existsSync(subagentsDir)) {
      return
    }

    try {
      const files = fs.readdirSync(subagentsDir)
      let cleanedCount = 0
      for (const file of files) {
        const filePath = path.join(subagentsDir, file)
        try {
          fs.unlinkSync(filePath)
          cleanedCount += 1
        } catch (e) {
          // 忽略单个文件删除失败
        }
      }
      logger.info(`[ClaudeAdapter] Cleaned up subagents directory: ${cleanedCount} files removed from ${subagentsDir}`)

      // 重置 sidechain 监控状态
      this.sidechainFileState.clear()
      this.sidechainSeenEntryIds.clear()
      this.sidechainFileAgents.clear()
      this.sidechainAgentFiles.clear()
      this.watchedSidechainAgents.clear()
    } catch (error) {
      logger.warn(`[ClaudeAdapter] Failed to cleanup subagents directory: ${error.message}`)
    }
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
    if (subtype === 'error_during_execution') {
      return false
    }
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
    if (message?.type === 'user') {
      this.currentTurnUserMessageId = message.uuid || message.user_message_id || this.currentTurnUserMessageId || null
    }

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
      // 检测中断确认：control_response 的 request_id 以 interrupt_ 开头
      const requestId = message?.response?.request_id || ''
      const requestContext = requestId
        ? (this.pendingDryRunRequests.get(requestId) || null)
        : null
      if (requestId.startsWith('interrupt_')) {
        this.turnInterrupted = true
        this.emitProviderSystemNotification('turn-interrupted', {
          message: '已中断响应'
        })
      }

      // rewind 预获取流程：先收到 dry_run=true 响应，再发实际 rewind_files，再收到执行响应
      const payload = message?.response?.response || {}
      if (this.rewindPreviewStage === 'fetching' && requestContext?.kind === 'rewind-preview') {
        this.pendingDryRunRequests.delete(requestId)
        if (payload?.error) {
          this.rewindPreviewStage = null
          this.rewindPreviewData = null
          this.pendingRewindRequest = null
          this.emit('control-response', message)
          return
        }

        this.rewindPreviewData = {
          files: payload.changed_files || payload.filesChanged || payload.restored_files || [],
          insertions: payload.insertions || payload.lines_added || 0,
          deletions: payload.deletions || payload.lines_removed || 0
        }
        this.rewindPreviewStage = 'pending'
        const pendingRequest = this.pendingRewindRequest
        this.pendingRewindRequest = null
        if (pendingRequest) {
          const executeRequestId = `control_rewind_execute_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
          this.pendingRewindExecuteRequestId = executeRequestId
          super.sendControlRequest({
            ...pendingRequest,
            __ccguiRequestId: executeRequestId
          })
          return
        }

        this.rewindPreviewStage = null
        this.rewindPreviewData = null
      }
      if (this.rewindPreviewStage === 'pending' && requestId === this.pendingRewindExecuteRequestId) {
        // rewind_files 执行响应：注入预获取的文件数据，对上层屏蔽 provider 差异
        const preview = this.rewindPreviewData || {}
        const responseFiles = payload.changed_files || payload.filesChanged || payload.restored_files || []
        const enriched = {
          ...message,
          response: {
            ...message.response,
            response: {
              ...payload,
              changed_files: responseFiles.length > 0 ? responseFiles : (preview.files || []),
              restored_files: responseFiles.length > 0 ? responseFiles : (preview.files || []),
              insertions: payload.insertions || payload.lines_added || preview.insertions || 0,
              deletions: payload.deletions || payload.lines_removed || preview.deletions || 0
            }
          }
        }
        this.rewindPreviewStage = null
        this.rewindPreviewData = null
        this.pendingRewindExecuteRequestId = null
        this.emit('control-response', enriched)
        return
      }

      // 文件变更摘要：拦截 changed_files（rewind_files dry_run）响应，提取文件数据后向上发出
      if (requestContext?.kind === 'file-change-summary') {
        this.pendingDryRunRequests.delete(requestId)
        const files = payload.changed_files || payload.filesChanged || payload.restored_files || []
        // Claude 的 changed_files 复用 rewind_files dry_run，
        // 返回的是“回滚将会如何变更”的统计，需要翻转回“本轮实际修改”的方向。
        const insertions = payload.deletions || payload.lines_removed || 0
        const deletions = payload.insertions || payload.lines_added || 0
        if (Array.isArray(files) && files.length > 0) {
          this.emit('file-change-summary', {
            id: `file-change-summary-${Date.now()}`,
            role: 'file_change_summary',
            files: files.map(f => typeof f === 'string' ? { path: f } : f),
            totalFiles: files.length,
            totalInsertions: insertions,
            totalDeletions: deletions,
            patchState: 'applied',
            userMessageId: requestContext?.userMessageId || null,
            timestamp: new Date()
          })
        }
      }

      this.emit('control-response', message)
      return
    }

    if (message.type === 'control_cancel_request') {
      this.turnInterrupted = true
      this.emitProviderSystemNotification('turn-interrupted', {
        message: '已中断响应'
      })
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
      const completedUserMessageId = this.currentTurnUserMessageId
      this.clearPendingCollaborativePreAgents()
      this.clearPendingAgentToolUses()
      this.currentAssistantMessage = null
      if (this.turnInterrupted) {
        // 中断后的 result，吃掉所有 error/failed 通知
        this.turnInterrupted = false
      } else if (this.shouldTreatAsErrorResult(message)) {
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
      } else if (completedUserMessageId) {
        this.sendControlRequest({
          subtype: 'changed_files',
          user_message_id: completedUserMessageId
        })
      }
      this.currentTurnUserMessageId = null
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

  // ─── 文件变更统计（通过 changed_files 请求的响应）──────────────

  sendControlRequest(request) {
    const normalizedRequest = { ...request }

    if (normalizedRequest?.subtype === 'rewind') {
      normalizedRequest.subtype = 'reset_files'
    } else if (normalizedRequest?.subtype === 'rewind_and_fork') {
      normalizedRequest.subtype = 'reset_files_and_fork'
    }

    if (normalizedRequest?.subtype === 'undo_patch' || normalizedRequest?.subtype === 'undo_patch_and_fork') {
      throw new Error('Claude provider does not support patch-based undo')
    }

    if (normalizedRequest?.subtype === 'changed_files') {
      const requestId = `control_file_change_summary_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      this.pendingDryRunRequests.set(requestId, {
        kind: normalizedRequest.preview_only === true ? 'file-change-preview' : 'file-change-summary',
        userMessageId: normalizedRequest.user_message_id || null
      })
      normalizedRequest.__ccguiRequestId = requestId
      normalizedRequest.subtype = 'rewind_files'
      normalizedRequest.dry_run = true
    } else if (normalizedRequest?.subtype === 'reset_files') {
      normalizedRequest.subtype = 'rewind_files'
      normalizedRequest.dry_run = false
    } else if (normalizedRequest?.subtype === 'reset_files_and_fork') {
      normalizedRequest.subtype = 'rewind_and_fork'
      normalizedRequest.dry_run = false
    }

    delete normalizedRequest.numTurns
    delete normalizedRequest.preview_only

    if (normalizedRequest?.subtype === 'set_session_submodel' && normalizedRequest.model) {
      super.sendControlRequest({
        subtype: 'set_model',
        model: String(normalizedRequest.model)
      })

      this.envInfo = {
        ...this.envInfo,
        model: String(normalizedRequest.model),
        provider: 'claude',
        providerPid: this.getPid() || null
      }
      this.emit('env-info', this.envInfo)
      if (normalizedRequest?.silent !== true) {
        this.emit('system-notification', {
          type: 'session-model-changed',
          provider: 'claude',
          model: String(normalizedRequest.model)
        })
      }
      return
    }

    // rewind_files 实际还原前，先发 dry_run=true 获取文件列表与统计
    // provider 对外始终吐统一的 rewind 响应，屏蔽 Claude CLI 的返回差异
    if (normalizedRequest?.subtype === 'rewind_files' && !normalizedRequest?.dry_run && normalizedRequest?.user_message_id) {
      this.rewindPreviewStage = 'fetching'
      this.rewindPreviewData = null
      this.pendingRewindExecuteRequestId = null
      this.pendingRewindRequest = normalizedRequest
      const previewRequestId = `control_rewind_preview_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
      this.pendingDryRunRequests.set(previewRequestId, {
        kind: 'rewind-preview'
      })
      super.sendControlRequest({
        ...normalizedRequest,
        dry_run: true,
        __ccguiRequestId: previewRequestId
      })
      return
    }

    super.sendControlRequest(normalizedRequest)

    if (normalizedRequest?.subtype === 'set_model' && normalizedRequest.model) {
      this.envInfo = {
        ...this.envInfo,
        model: String(normalizedRequest.model),
        provider: 'claude',
        providerPid: this.getPid() || null
      }
      this.emit('env-info', this.envInfo)
      if (normalizedRequest?.silent !== true) {
        this.emit('system-notification', {
          type: 'session-model-changed',
          provider: 'claude',
          model: String(normalizedRequest.model)
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
    if (message.subtype === 'api_retry') {
      this.emit('system-notification', {
        type: 'api-retry',
        provider: 'claude',
        attempt: Number.isFinite(message.attempt) ? message.attempt : null,
        maxRetries: Number.isFinite(message.max_retries) ? message.max_retries : null,
        retryDelayMs: Number.isFinite(message.retry_delay_ms) ? message.retry_delay_ms : null,
        errorStatus: Number.isFinite(message.error_status) ? message.error_status : null,
        error: message.error || null,
        metadata: message
      })
      return
    }

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
      const preAgent = isTeamMember
        ? this.findCollaborativePreAgent({
            toolUseId: message.tool_use_id || candidate?.toolUseId || null,
            taskId: message.task_id,
            providerAgentId: message.agent_id,
            teammateId: message.teammate_id,
            name: message.name || candidate?.name || candidate?.agentType,
            teamName: message.team_name || candidate?.teamName || null
          })
        : null
      const isKnownExecutionTask = Boolean(
        candidate?.rawName === 'Agent' ||
        (message.task_id && this.taskIdToAgentId.has(message.task_id)) ||
        (message.tool_use_id && this.toolUseIdToAgentId.has(message.tool_use_id)) ||
        (message.agent_id && this.providerAgentIdToAgentId.has(message.agent_id))
      )
      if (isTeamMember && preAgent) {
        this.updateCollaborativePreAgent(preAgent, {
          taskId: message.task_id || preAgent.taskId || null,
          pendingTaskStartedMessage: message,
          name: message.name || candidate?.name || preAgent.name || null,
          teamName: message.team_name || candidate?.teamName || preAgent.teamName || null,
          addressKey: preAgent.addressKey || this.buildTeamMemberAddressKey(
            message.name || candidate?.name || preAgent.name || null,
            message.team_name || candidate?.teamName || preAgent.teamName || null
          )
        })
        return
      }

      const agentId = isTeamMember
        ? this.resolveTeamMemberAgentId({
            teamId,
            taskId: message.task_id,
            teammateId: message.teammate_id,
            providerAgentId: message.agent_id,
            name: message.name || candidate?.name || candidate?.agentType,
            teamName: message.team_name || candidate?.teamName || preAgent?.teamName || null,
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
        ? this.pickTeamMemberAgentType(
            message.agent_type,
            message.agentType,
            candidate?.agentType
          )
        : (candidate?.agentType || 'subagent')
      const lifecycleCcgui = agentId
        ? (isTeamMember
            ? this.buildCcguiPatch({
                attribution: {
                  agentId,
                  actorId: agentId
                }
              })
            : this.buildLifecycleCcgui({
                agentId,
                agentKind,
                agentType,
                name: message.name || candidate?.name || agentType,
                prompt: message.prompt || candidate?.prompt || candidate?.description || null,
                model: candidate?.model || null,
                teamId,
                parentAgentId: teamId ? 'master' : null,
                status: 'running'
              }, {
                eventType: 'start',
                agentId,
                agentKind,
                agentType,
                name: message.name || candidate?.name || agentType,
                prompt: message.prompt || candidate?.prompt || candidate?.description || null,
                model: candidate?.model || null,
                teamId,
                parentAgentId: teamId ? 'master' : null,
                source: 'subagent_spawn',
                status: 'running'
              }))
        : null
      if (message.tool_use_id) {
        this.updatePendingAgentToolUse(message.tool_use_id, {
          taskId: message.task_id || candidate?.taskId || null,
          providerAgentId: message.agent_id || candidate?.providerAgentId || null,
          resolvedAgentId: agentId || candidate?.resolvedAgentId || null
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
      const terminalExecutionStatus = this.isTerminalTaskStatus(message.status) && agentId && !this.isCollaborativeAgentId(agentId)
      const executionTerminalCcgui = terminalExecutionStatus
        ? this.buildLifecycleCcgui({
            agentId,
            agentKind: 'execution',
            status: message.status === 'failed' ? 'failed' : 'ended'
          }, {
            eventType: 'end',
            agentId,
            agentKind: 'execution',
            reason: message.status || 'completed',
            status: message.status === 'failed' ? 'failed' : 'ended'
          })
        : null
      if (message.tool_use_id) {
        this.updatePendingAgentToolUse(message.tool_use_id, {
          taskId: message.task_id || null,
          resolvedAgentId: agentId || null
        })
      }
      this.emit('task-event', {
        eventType: 'notification',
        taskId: message.task_id,
        tool_use_id: message.tool_use_id || null,
        ccgui: this.buildCcguiPatch({
          ...(executionTerminalCcgui?.registry ? { registry: executionTerminalCcgui.registry } : {}),
          ...(executionTerminalCcgui?.orchestration ? { orchestration: executionTerminalCcgui.orchestration } : {}),
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
      this.streamedAssistantMessageIds.add(messageId)
      this.currentTurnNumber = 0
      this.hasSeenToolUseInCurrentTurn = false
      this.lastVisibleMessageId = null
      this.contentBlockIndexToId.clear()
      this.contentBlockState.clear()
      this.contentBlockMessageIds.clear()
      // 不再 emit message-start，等 content_block_start 再决定
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

        // thinking 作为独立消息
        const thinkingMessageId = `thinking-${this.currentAssistantMessage?.id || Date.now()}-${blockIndex ?? 0}`
        this.contentBlockMessageIds.set(blockIndex, thinkingMessageId)
        this.assistantSnapshots.set(thinkingMessageId, { thinking: '', content: '' })

        this.lastVisibleMessageId = thinkingMessageId

        this.emit('message-start', {
          id: thinkingMessageId,
          role: 'assistant',
          subtype: 'thinking',
          content: '',
          thinking: '',
          hasThinking: true,
          isStreaming: true,
          startTime: Date.now(),
          timestamp: new Date(),
          turnNumber: this.currentTurnNumber + 1,
          showTurnSeparator: this.currentTurnNumber > 0,
          thinkingCollapsed: false,
          ccgui: this.buildCcguiPatch({
            attribution: this.currentAssistantMessage?.attribution || this.getAttributionForClaudeMessage(event.message || message)
          }),
          rawMessages: [message]
        })
        return
      }

      if (contentBlock?.type === 'text') {
        // text 作为独立消息
        const textMessageId = `text-${this.currentAssistantMessage?.id || Date.now()}-${blockIndex ?? 0}`
        this.contentBlockMessageIds.set(blockIndex, textMessageId)
        this.assistantSnapshots.set(textMessageId, { thinking: '', content: '' })

        this.lastVisibleMessageId = textMessageId

        this.emit('message-start', {
          id: textMessageId,
          role: 'assistant',
          subtype: null,
          content: '',
          thinking: '',
          hasThinking: false,
          isStreaming: true,
          startTime: Date.now(),
          timestamp: new Date(),
          turnNumber: this.currentTurnNumber + 1,
          showTurnSeparator: this.currentTurnNumber > 0,
          ccgui: this.buildCcguiPatch({
            attribution: this.currentAssistantMessage?.attribution || this.getAttributionForClaudeMessage(event.message || message)
          }),
          rawMessages: [message]
        })
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
          this.contentBlockMessageIds.set(blockIndex, toolUse.toolUseId)
        }
        this.toolUseMessages.set(toolUse.toolUseId, {
          toolInputBuffer: '',
          rawName: toolUse.rawName,
          toolName: toolUse.toolName
        })
        if (['Agent', 'TeamCreate', 'SendMessage', 'TeamDelete'].includes(toolUse.rawName)) {
          this.rememberAgentToolUse(toolUse, message)
        }

        this.lastVisibleMessageId = toolUse.toolUseId

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
      const blockMessageId = typeof event.index === 'number'
        ? this.contentBlockMessageIds.get(event.index)
        : null

      if (delta?.type === 'thinking_delta' && delta.thinking && blockMessageId) {
        const snapshot = this.assistantSnapshots.get(blockMessageId) || { thinking: '', content: '' }
        snapshot.thinking += delta.thinking
        this.assistantSnapshots.set(blockMessageId, snapshot)
        this.emit('message-delta', {
          messageId: blockMessageId,
          field: 'thinking',
          delta: delta.thinking
        })
      }

      if (delta?.type === 'text_delta' && delta.text && blockMessageId) {
        const snapshot = this.assistantSnapshots.get(blockMessageId) || { thinking: '', content: '' }
        snapshot.content += delta.text
        this.assistantSnapshots.set(blockMessageId, snapshot)
        this.emit('message-delta', {
          messageId: blockMessageId,
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
          if (toolState.rawName && ['Agent', 'TeamCreate', 'SendMessage', 'TeamDelete'].includes(toolState.rawName)) {
            this.rememberAgentToolUse({
              rawName: toolState.rawName,
              toolName: toolState.toolName || toolState.rawName,
              toolUseId: contentBlockId,
              toolInput: parsedInput
            }, message)
          }
          this.emit('message-update', {
            messageId: contentBlockId,
            updates: { toolInput: { ...parsedInput } }
          })
        } catch {
          // Wait for complete JSON buffer.
        }
      }

      if (delta?.type === 'citations_delta' && blockMessageId) {
        this.emit('silent-message', {
          messageType: 'claude/citations_delta',
          params: {
            messageId: blockMessageId,
            index: event.index,
            citation: delta.citation || null
          },
          timestamp: new Date().toISOString()
        })
      }

      if (delta?.type === 'signature_delta' && blockMessageId) {
        this.emit('message-update', {
          messageId: blockMessageId,
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

        // thinking/text block 结束 → emit message-complete
        const blockMessageId = this.contentBlockMessageIds.get(event.index)
        const blockType = blockState?.type
        if (blockMessageId && blockType !== 'tool_use') {
          const snapshot = this.assistantSnapshots.get(blockMessageId)
          this.emit('message-complete', {
            messageId: blockMessageId,
            updates: {
              isStreaming: false,
              ...(snapshot?.thinking ? { thinkingCollapsed: true } : {})
            }
          })
          this.assistantSnapshots.delete(blockMessageId)
        }
        // tool_use block 结束 → emit message-stop（输入流结束，但仍执行中）
        if (blockMessageId && blockType === 'tool_use') {
          this.emit('message-stop', {
            messageId: blockMessageId,
            reason: 'input_complete'
          })
        }
        this.contentBlockMessageIds.delete(event.index)
      }
      return
    }

    if (event.type === 'message_delta') {
      // usage 挂给当前 raw message 内最后一个有效可见消息
      if (event.usage) {
        this.currentAssistantMessage.usage = event.usage
      }
      if (event.delta?.stop_reason) {
        this.currentAssistantMessage.stopReason = event.delta.stop_reason
      }

      // usage 挂给当前 raw message 内最后一个有效可见消息
      const targetId = this.lastVisibleMessageId
      if (targetId) {
        this.emit('message-update', {
          messageId: targetId,
          updates: {
            usage: this.currentAssistantMessage.usage,
            stopReason: this.currentAssistantMessage.stopReason
          }
        })
      }
      return
    }

    if (event.type === 'message_stop') {
      // 只清理内部状态，不发事件
      // thinking/text 的 message-complete 已在 content_block_stop 中发出
      // tool_use 等待 tool_result
      this.currentAssistantMessage = null
      this.lastVisibleMessageId = null
    }
  }

  handleToolResultMessage(message, toolResultContent) {
    const toolUseId = toolResultContent.tool_use_id
    if (!toolUseId) return

    const candidate = this.pendingAgentToolUses.get(toolUseId) || null
    const toolResult = message?.tool_use_result || {}
    const resultUsage = toolResult?.usage || toolResultContent?.usage || null
    const teamId = this.resolveTeamId(toolResult.team_name || candidate?.teamName || null)
    const preAgent = this.findCollaborativePreAgent({
      toolUseId,
      teammateId: toolResult.teammate_id,
      providerAgentId: toolResult.agent_id || toolResult.agentId || null,
      name: toolResult.name || candidate?.name || null,
      teamName: toolResult.team_name || candidate?.teamName || null
    })
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
          taskId: preAgent?.taskId || null,
          teammateId: toolResult.teammate_id,
          providerAgentId: toolResult.agent_id || toolResult.agentId || null,
          name: toolResult.name || candidate?.name || null,
          teamName: toolResult.team_name || candidate?.teamName || preAgent?.teamName || null,
          toolUseId
        })
      : (isExecutionAgentResult
          ? this.resolveExecutionAgentId({
              taskId: toolResult.task_id || toolResult.taskId || candidate?.taskId || null,
              toolUseId,
              providerAgentId: toolResult.agent_id || toolResult.agentId || candidate?.providerAgentId || null
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
      const nextPreAgent = preAgent
        ? this.updateCollaborativePreAgent(preAgent, {
            taskId: preAgent.taskId || null,
            providerAgentId: toolResult.agent_id || toolResult.agentId || preAgent.providerAgentId || null,
            teammateId: toolResult.teammate_id || preAgent.teammateId || null,
            name: toolResult.name || candidate?.name || preAgent.name || null,
            teamName: toolResult.team_name || candidate?.teamName || preAgent.teamName || null,
            addressKey: this.buildTeamMemberAddressKey(
              toolResult.name || candidate?.name || preAgent.name || null,
              toolResult.team_name || candidate?.teamName || preAgent.teamName || null
            ) || preAgent.addressKey,
            prompt: candidate?.prompt || candidate?.description || preAgent.prompt || null,
            description: candidate?.description || preAgent.description || null,
            model: candidate?.model || preAgent.model || null,
            agentType: candidate?.agentType || preAgent.agentType || null
          })
        : null
      const collaborativeAgentType = this.pickTeamMemberAgentType(
        toolResult.agent_type,
        toolResult.agentType,
        candidate?.agentType
      )
      const startCcgui = this.buildLifecycleCcgui({
        agentId,
        agentKind: 'collaborative',
        agentType: collaborativeAgentType,
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
        parentAgentId: teamId ? 'master' : null,
        status: 'running',
        ...this.getCollaborativeReadOnlyFields()
      }, {
        eventType: 'start',
        agentId,
        agentKind: 'collaborative',
        agentType: collaborativeAgentType,
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
        parentAgentId: teamId ? 'master' : null,
        source: 'agent_start',
        status: 'running'
      })
      this.emitAgentSilent(startCcgui, message)

      if (nextPreAgent?.pendingTaskStartedMessage) {
        this.emit('task-event', {
          eventType: 'started',
          taskId: nextPreAgent.pendingTaskStartedMessage.task_id,
          taskType: nextPreAgent.pendingTaskStartedMessage.task_type,
          description: nextPreAgent.pendingTaskStartedMessage.description,
          prompt: nextPreAgent.pendingTaskStartedMessage.prompt,
          tool_use_id: nextPreAgent.pendingTaskStartedMessage.tool_use_id || null,
          ccgui: this.buildCcguiPatch({
            attribution: {
              agentId,
              actorId: agentId
            }
          }),
          rawMessage: nextPreAgent.pendingTaskStartedMessage
        })
      }

      this.clearCollaborativePreAgent(nextPreAgent || preAgent)

      // 注册 sidechain 文件监听，文件可能延迟出现，resolveUnboundSidechainAgents 会持续尝试匹配
      this.watchSidechainAgent({
        agentId,
        name: toolResult.name || candidate?.name || null,
        agentType: toolResult.name || candidate?.name || null,
        teamId,
        prompt: candidate?.prompt || candidate?.description || null
      })
    } else if (isTeamMember && preAgent) {
      this.updateCollaborativePreAgent(preAgent, {
        taskId: preAgent.taskId || null,
        providerAgentId: toolResult.agent_id || toolResult.agentId || preAgent.providerAgentId || null,
        teammateId: toolResult.teammate_id || preAgent.teammateId || null,
        name: toolResult.name || candidate?.name || preAgent.name || null,
        teamName: toolResult.team_name || candidate?.teamName || preAgent.teamName || null,
        addressKey: this.buildTeamMemberAddressKey(
          toolResult.name || candidate?.name || preAgent.name || null,
          toolResult.team_name || candidate?.teamName || preAgent.teamName || null
        ) || preAgent.addressKey,
        prompt: toolResult.prompt || candidate?.prompt || preAgent.prompt || null,
        description: candidate?.description || preAgent.description || null,
        model: toolResult.model || candidate?.model || preAgent.model || null,
        agentType: toolResult.agent_type || toolResult.agentType || candidate?.agentType || preAgent.agentType || null
      })
    }

    if (!isTeamCreate && !isTeamDelete && !isTeamMember && isExecutionAgentResult && agentId && !this.startedExecutionAgentIds.has(agentId)) {
      this.startedExecutionAgentIds.add(agentId)
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

    // 用统一的 message-result 替代 tool-result + message-update
    const updateAttribution = agentId
      ? { agentId, actorId: agentId }
      : (toolAttribution?.agentId ? toolAttribution : null)

    this.emit('message-result', {
      messageId: toolUseId,
      content: toolResultContent.content || '(无输出)',
      isError: toolResultContent.is_error || false,
      usage: resultUsage,
      answers: toolResult.answers || toolResultContent?.answers || null,
      agentId: toolResult.agentId || toolResult.agent_id || null,
      parent_tool_use_id: message?.parent_tool_use_id || null,
      ccgui: this.buildCcguiPatch({
        ...(lifecycleCcgui?.registry ? { registry: lifecycleCcgui.registry } : {}),
        ...(lifecycleCcgui?.orchestration ? { orchestration: lifecycleCcgui.orchestration } : {}),
        attribution: updateAttribution || toolAttribution || (agentId ? { agentId, actorId: agentId } : null)
      }),
      rawMessage: message
    })

    if (!isTeamCreate && !isTeamDelete && !isTeamMember && isExecutionAgentResult && agentId) {
      this.cleanupAgentCorrelation({
        agentId,
        taskId: toolResult.task_id || toolResult.taskId || candidate?.taskId || null,
        toolUseId,
        clearProvider: true
      })
    }

    this.pendingAgentToolUses.delete(toolUseId)
  }

  handleAssistantMessage(message) {
    const assistantMessage = message.message || {}
    const messageId = assistantMessage.id || message.uuid || `assistant-${Date.now()}`
    const messageTimestamp = message?.timestamp ? new Date(message.timestamp) : new Date()
    const messageStartTime = message?.timestamp ? Date.parse(message.timestamp) : Date.now()
    const content = Array.isArray(assistantMessage.content) ? assistantMessage.content : []
    const assistantAttribution = this.getAttributionForClaudeMessage(message)
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

    if (this.streamedAssistantMessageIds.has(messageId)) {
      const finalThinkingBlocks = content
        .map((block, index) => ({ block, index }))
        .filter(({ block }) => block?.type === 'thinking' && typeof block.thinking === 'string')
      const finalTextBlocks = content
        .map((block, index) => ({ block, index }))
        .filter(({ block }) => block?.type === 'text' && typeof block.text === 'string')

      for (const { block, index } of finalThinkingBlocks) {
        const streamedMessageId = `thinking-${messageId}-${index}`
        this.emit('message-replace', {
          messageId: streamedMessageId,
          replacement: {
            thinking: block.thinking || '',
            hasThinking: Boolean(block.thinking),
            rawMessages: [message],
            ccgui: this.buildCcguiPatch({
              attribution: assistantAttribution
            })
          }
        })
      }

      for (const { block, index } of finalTextBlocks) {
        const streamedMessageId = `text-${messageId}-${index}`
        this.emit('message-replace', {
          messageId: streamedMessageId,
          replacement: {
            content: block.text || '',
            rawMessages: [message],
            ccgui: this.buildCcguiPatch({
              attribution: assistantAttribution
            })
          }
        })
      }

      const finalVisibleId = finalTextBlocks.length > 0
        ? `text-${messageId}-${finalTextBlocks[finalTextBlocks.length - 1].index}`
        : (finalThinkingBlocks.length > 0
            ? `thinking-${messageId}-${finalThinkingBlocks[finalThinkingBlocks.length - 1].index}`
            : null)

      if (finalVisibleId) {
        this.emit('message-update', {
          messageId: finalVisibleId,
          updates: {
            usage: assistantMessage.usage || null,
            stopReason: assistantMessage.stop_reason || assistantMessage.stopReason || null,
            rawMessages: [message],
            ccgui: this.buildCcguiPatch({
              attribution: assistantAttribution
            })
          }
        })
      }

      if (assistantMessage.stop_reason || assistantMessage.stopReason) {
        for (const { index } of finalThinkingBlocks) {
          this.emit('message-complete', {
            messageId: `thinking-${messageId}-${index}`,
            updates: {
              isStreaming: false,
              thinkingCollapsed: true
            }
          })
        }
        for (const { index } of finalTextBlocks) {
          this.emit('message-complete', {
            messageId: `text-${messageId}-${index}`,
            updates: {
              isStreaming: false
            }
          })
        }
        if (this.currentAssistantMessage?.id === messageId) {
          this.currentAssistantMessage = null
        }
      }
      return
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

      if (['Agent', 'TeamCreate', 'SendMessage', 'TeamDelete'].includes(toolUse.rawName)) {
        this.rememberAgentToolUse(toolUse, message)
      }

      const toolUseId = toolUse.toolUseId || `tool-${Date.now()}`
      if (this.toolUseMessages.has(toolUseId)) {
        continue
      }
      this.toolUseMessages.set(toolUseId, {
        toolInputBuffer: ''
      })

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
    if (message?.agentId) {
      return message.agentId
    }

    const teammateId = message?.teammate_id || message?.teammateId || null
    if (teammateId && this.collaborativeAddressToAgentId.has(teammateId)) {
      return this.collaborativeAddressToAgentId.get(teammateId)
    }

    const entry = message?.entry || null
    const sender = entry?.routing?.sender || entry?.sender || null
    const teamName = entry?.team_name || entry?.teamName || null
    const addressKey = this.buildTeamMemberAddressKey(
      sender ? String(sender).replace(/^@/, '').trim() : null,
      teamName
    )
    if (addressKey && this.collaborativeAddressToAgentId.has(addressKey)) {
      return this.collaborativeAddressToAgentId.get(addressKey)
    }

    return null
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
