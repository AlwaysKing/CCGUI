const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
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
const logger = require('../../logger')
const codexAppServer = require('../../services/codex-app-server')

function buildCodexUsageStateError(errorLike = null, fallbackMessage = 'Codex usage refresh failed') {
  if (!errorLike || typeof errorLike !== 'object') {
    return {
      code: 'unknown',
      message: fallbackMessage,
      status: null
    }
  }

  const code = typeof errorLike.code === 'string' && errorLike.code.trim()
    ? errorLike.code.trim()
    : (typeof errorLike.type === 'string' && errorLike.type.trim() ? errorLike.type.trim() : null)
  const message = typeof errorLike.message === 'string' && errorLike.message.trim()
    ? errorLike.message.trim()
    : fallbackMessage
  const status = Number(errorLike.status || errorLike.statusCode || 0) || null

  return {
    code: code || 'unknown',
    message,
    status
  }
}

function normalizeSkillSourceSegment(value = '') {
  return String(value || '')
    .trim()
    .replace(/^[._-]+|[._-]+$/g, '')
}

function toTitleLabel(value = '') {
  const normalized = normalizeSkillSourceSegment(value)
  if (!normalized) return ''
  return normalized
    .split(/[-_.:/]+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

function deriveCodexSkillSource(skill = {}) {
  const skillName = typeof skill?.name === 'string' ? skill.name.trim() : ''
  const skillPath = typeof skill?.path === 'string' ? skill.path.trim() : ''

  if (skillName.includes(':')) {
    const namespace = normalizeSkillSourceSegment(skillName.split(':')[0])
    if (namespace) {
      return {
        key: namespace.toLowerCase(),
        label: toTitleLabel(namespace) || namespace
      }
    }
  }

  if (skillPath.includes('/.codex/skills/.system/')) {
    return {
      key: 'built-in',
      label: 'Built-in'
    }
  }

  const pluginCacheMatch = skillPath.match(/\/plugins\/cache\/([^/]+)\/([^/]+)/)
  if (pluginCacheMatch) {
    const pluginId = normalizeSkillSourceSegment(pluginCacheMatch[2] || pluginCacheMatch[1] || '')
    if (pluginId) {
      return {
        key: pluginId.toLowerCase(),
        label: toTitleLabel(pluginId) || pluginId
      }
    }
  }

  const pluginPathMatch = skillPath.match(/\/plugins\/(?:[^/]+\/)?([^/]+)\/(?:[^/]+\/)?skills\//)
  if (pluginPathMatch) {
    const pluginId = normalizeSkillSourceSegment(pluginPathMatch[1] || '')
    if (pluginId) {
      return {
        key: pluginId.toLowerCase(),
        label: toTitleLabel(pluginId) || pluginId
      }
    }
  }

  return {
    key: 'other',
    label: 'Other'
  }
}

/**
 * CodexAdapter
 *
 * 在 CodexClient 的传输层之上，将 Codex 原始协议翻译成
 * CCGUI 统一语义事件。
 */
class CodexAdapter extends CodexClient {
  constructor(workingDirectory = null, sessionId = null, isNewSession = true, permissionMode = 'default', projectSettings = null, options = {}) {
    super(workingDirectory, sessionId, isNewSession, permissionMode, projectSettings, options)
    this.turnDiffMessageMap = new Map()
    this.agentRegistry = new Map()
    this.threadIdToAgentId = new Map()
    this.pendingSpawnItems = new Map()
    this.sessionStoragePath = options.sessionStoragePath || null
    this.pendingUserMessageUuid = null
  }

  async sendMessage(message) {
    const uuid = message?.uuid || null
    if (uuid) {
      this.pendingUserMessageUuid = uuid
    }
    return super.sendMessage(message)
  }

  async queryAtReferences() {
    const groups = []
    const cwd = this.workingDirectory || process.cwd()

    let pluginServiceData = null
    let skillsServiceData = null
    let appsServiceData = null

    const [pluginsResult, skillsResult, appsResult] = await Promise.allSettled([
      codexAppServer.listPluginsWithDetails(cwd),
      codexAppServer.listSkills(cwd),
      codexAppServer.listApps(cwd)
    ])

    if (pluginsResult.status === 'fulfilled') {
      pluginServiceData = pluginsResult.value
    } else {
      logger.warn(`[CodexAdapter] Failed to load codex-service plugins: ${pluginsResult.reason?.message || String(pluginsResult.reason)}`)
    }

    if (skillsResult.status === 'fulfilled') {
      skillsServiceData = skillsResult.value
    } else {
      logger.warn(`[CodexAdapter] Failed to load codex-service skills: ${skillsResult.reason?.message || String(skillsResult.reason)}`)
    }

    if (appsResult.status === 'fulfilled') {
      appsServiceData = appsResult.value
    } else {
      logger.warn(`[CodexAdapter] Failed to load codex-service apps: ${appsResult.reason?.message || String(appsResult.reason)}`)
    }

    const marketplaces = Array.isArray(pluginServiceData?.marketplaces) ? pluginServiceData.marketplaces : []
    const detailMap = pluginServiceData?.detailMap && typeof pluginServiceData.detailMap === 'object'
      ? pluginServiceData.detailMap
      : {}
    const enabledPlugins = []

    for (const marketplace of marketplaces) {
      const marketplacePath = marketplace?.path || ''
      const marketplaceLabel = marketplace?.interface?.displayName || marketplace?.name || ''
      const plugins = Array.isArray(marketplace?.plugins) ? marketplace.plugins : []

      for (const plugin of plugins) {
        if (!plugin || plugin.enabled !== true) continue

        const pluginId = plugin?.id || plugin?.name || ''
        const pluginName = plugin?.name || ''
        if (!pluginId || !pluginName) continue

        enabledPlugins.push({
          pluginId,
          pluginName,
          marketplacePath,
          marketplaceLabel,
          summary: plugin,
          detail: detailMap[`${marketplacePath}::${pluginName}`] || null
        })
      }
    }

    const pluginChildren = enabledPlugins
      .map(plugin => {
        const pluginId = plugin.pluginId
        const label = plugin.summary?.interface?.displayName || plugin.pluginName || pluginId
        const detailInterface = plugin.detail?.summary?.interface || {}
        const summaryInterface = plugin.summary?.interface || {}
        const iconPath = detailInterface?.composerIcon
          || detailInterface?.logo
          || summaryInterface?.composerIcon
          || summaryInterface?.logo
          || ''
        return {
          id: `plugin:${pluginId}`,
          label,
          name: label,
          value: `plugin://${pluginId}`,
          kind: 'plugin',
          description: plugin.detail?.summary?.interface?.shortDescription || plugin.summary?.interface?.shortDescription || '',
          providerMeta: {
            pluginId,
            path: `plugin://${pluginId}`,
            iconPath,
            marketplaceName: plugin.marketplaceLabel || '',
            marketplacePath: plugin.marketplacePath || ''
          }
        }
      })
      .sort((a, b) => a.label.localeCompare(b.label))

    if (pluginChildren.length > 0) {
      groups.push({
        id: 'plugins',
        label: 'Plugins',
        children: pluginChildren
      })
    }

    const skillSubGroups = []
    const normalizedSkillEntries = Array.isArray(skillsServiceData?.data)
      ? skillsServiceData.data
      : []
    const scopeLabelMap = {
      system: 'System',
      user: 'User',
      repo: 'Repo',
      project: 'Project',
      team: 'Team',
      admin: 'Admin',
      personal: 'Personal',
      'built-in': 'Built-in',
      builtin: 'Built-in'
    }
    const skillsByScopeAndSource = new Map()

    normalizedSkillEntries.forEach((entry, entryIndex) => {
      const sourceCwd = typeof entry?.cwd === 'string' ? entry.cwd : ''
      const skills = Array.isArray(entry?.skills) ? entry.skills : []

      skills
        .filter(skill => skill && typeof skill === 'object')
        .forEach((skill, skillIndex) => {
          const label = skill?.interface?.displayName || skill?.name || `skill-${skillIndex + 1}`
          const skillPath = typeof skill?.path === 'string' ? skill.path : ''
          const rawScope = typeof skill?.scope === 'string' && skill.scope.trim()
            ? skill.scope.trim().toLowerCase()
            : 'user'
          const scopeKey = rawScope || 'user'
          const sourceInfo = deriveCodexSkillSource(skill)
          const groupKey = `${scopeKey}::${sourceInfo.key}`

          if (!skillPath) {
            return
          }

          if (!skillsByScopeAndSource.has(groupKey)) {
            skillsByScopeAndSource.set(groupKey, {
              scopeKey,
              sourceKey: sourceInfo.key,
              sourceLabel: sourceInfo.label,
              children: []
            })
          }

          skillsByScopeAndSource.get(groupKey).children.push({
            id: `skill:${entryIndex}:${skill?.id || skill?.name || skillIndex}`,
            label,
            name: label,
            value: skillPath,
            kind: 'skill',
            description: skill?.interface?.shortDescription || skill?.shortDescription || skill?.short_description || skill?.description || '',
            providerMeta: {
              path: skillPath,
              sourceCwd,
              scope: scopeKey,
              skillId: skill?.id || '',
              slug: skill?.name || ''
            }
          })
        })
    })

    const normalizedSkillGroups = Array.from(skillsByScopeAndSource.values())
      .map(({ scopeKey, sourceKey, sourceLabel, children }) => ({
        id: `skills:${scopeKey}:${sourceKey}`,
        label: sourceLabel,
        children: children.sort((a, b) => a.label.localeCompare(b.label))
      }))
      .filter(group => group.children.length > 0)
      .sort((a, b) => a.label.localeCompare(b.label))

    const normalizedAppsRoot = Array.isArray(appsServiceData?.apps)
      ? appsServiceData.apps
      : (Array.isArray(appsServiceData?.data)
        ? appsServiceData.data
        : (Array.isArray(appsServiceData)
          ? appsServiceData
          : []))
    const appChildren = normalizedAppsRoot
      .filter(app => app && typeof app === 'object')
      .map((app, index) => {
        const appId = app?.id || app?.appId || app?.connector_id || app?.connectorId || ''
        const label = app?.name || app?.displayName || appId || `app-${index + 1}`
        const path = appId ? `app://${appId}` : ''
        return {
          id: `app:${appId || index}`,
          label,
          name: label,
          value: path,
          kind: 'app',
          description: app?.description || app?.shortDescription || '',
          providerMeta: {
            appId,
            path,
            connectorId: app?.connector_id || app?.connectorId || '',
            enabled: app?.enabled === true,
            connected: app?.connected === true
          }
        }
      })
      .filter(app => app.providerMeta.path)
      .sort((a, b) => a.label.localeCompare(b.label))

    if (normalizedSkillGroups.length > 0) {
      skillSubGroups.push(...normalizedSkillGroups)
    }

    if (skillSubGroups.length > 0) {
      groups.push({
        id: 'skills',
        label: 'Skills',
        children: [],
        subGroups: skillSubGroups
      })
    }

    if (appChildren.length > 0) {
      groups.push({
        id: 'apps',
        label: 'Apps',
        children: appChildren
      })
    }

    return {
      provider: 'codex',
      groups
    }
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
      provider: 'codex',
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

  resolveAgentIdFromThreadId(threadId) {
    if (!threadId || threadId === this.currentThreadId) {
      return null
    }
    return this.threadIdToAgentId.get(threadId) || null
  }

  resolveAttributionFromThreadId(threadId) {
    const agentId = this.resolveAgentIdFromThreadId(threadId)
    if (!agentId) {
      return null
    }

    return {
      agentId,
      actorId: agentId
    }
  }

  isSpawnAgentItem(item = {}) {
    const tool = String(item.tool || item.name || '').trim().toLowerCase()
    return item.type === 'collabAgentToolCall' && (tool === 'spawnagent' || tool === 'agent' || tool === 'spawn_agent')
  }

  rememberSpawnItem(item = {}, params = {}) {
    if (!item?.id || !this.isSpawnAgentItem(item)) {
      return
    }

    const input = item.arguments || item.input || {}
    this.pendingSpawnItems.set(item.id, {
      itemId: item.id,
      name: input.name || item.name || null,
      prompt: input.prompt || input.task || input.description || null,
      model: input.model || null,
      agentType: input.agentType || input.agent_type || input.template || input.role || null,
      parentAgentId: this.resolveAgentIdFromThreadId(params.threadId) || null
    })
  }

  parseReceiverThreadIds(item = {}) {
    const rawResult = item.result || {}
    const candidates = [
      item.receiverThreadIds,
      rawResult.receiverThreadIds,
      rawResult.receiver_thread_ids,
      item.threadIds,
      rawResult.threadIds
    ]

    for (const candidate of candidates) {
      if (Array.isArray(candidate) && candidate.length > 0) {
        return candidate.filter(Boolean)
      }
    }

    return []
  }

  registerSpawnedAgents(item = {}, params = {}) {
    const pending = this.pendingSpawnItems.get(item.id) || null
    const receiverThreadIds = this.parseReceiverThreadIds(item)
    if (receiverThreadIds.length === 0) {
      return
    }

    for (const receiverThreadId of receiverThreadIds) {
      const agentId = `codex-agent:${this.sanitizeSemanticId(receiverThreadId)}`
      this.threadIdToAgentId.set(receiverThreadId, agentId)
      const ccgui = this.buildLifecycleCcgui({
        agentId,
        agentKind: 'collaborative',
        agentType: pending?.agentType || 'subagent',
        name: pending?.name || pending?.agentType || 'Codex Agent',
        prompt: pending?.prompt || null,
        model: pending?.model || null,
        parentAgentId: pending?.parentAgentId || null,
        status: 'starting'
      }, {
        eventType: 'start',
        agentId,
        agentKind: 'collaborative',
        agentType: pending?.agentType || 'subagent',
        name: pending?.name || pending?.agentType || 'Codex Agent',
        prompt: pending?.prompt || null,
        model: pending?.model || null,
        parentAgentId: pending?.parentAgentId || null,
        source: 'spawned_thread',
        status: 'starting',
        actorId: pending?.parentAgentId || null
      })
      this.emitAgentSilent(ccgui, { item, params })
    }
  }

  emitCodexSystemNotification(type, payload = {}) {
    this.emit('system-notification', {
      type,
      provider: 'codex',
      ...payload
    })
  }

  emitCodexSilentEvent(eventType, payload = {}) {
    this.emit('silent-message', {
      messageType: 'provider-event',
      eventType,
      provider: 'codex',
      params: payload,
      timestamp: new Date().toISOString()
    })
  }

  buildControlResponse(requestId, response = {}, options = {}) {
    return {
      type: 'control_response',
      response: {
        subtype: options.subtype || 'success',
        request_id: requestId,
        response
      }
    }
  }

  collectDiffStats(diffText = '') {
    if (typeof diffText !== 'string' || !diffText.trim()) {
      return { insertions: 0, deletions: 0 }
    }

    let insertions = 0
    let deletions = 0
    for (const line of diffText.split('\n')) {
      if (!line) continue
      if (
        line.startsWith('+++') ||
        line.startsWith('---') ||
        line.startsWith('@@') ||
        line.startsWith('diff --git')
      ) {
        continue
      }
      if (line === '\\ No newline at end of file') {
        continue
      }
      if (line.startsWith('+')) {
        insertions += 1
      } else if (line.startsWith('-')) {
        deletions += 1
      }
    }

    return { insertions, deletions }
  }

  collectRollbackPreviewFromThread(thread = null, numTurns = 0) {
    const turns = Array.isArray(thread?.turns) ? thread.turns : []
    if (turns.length === 0 || !Number.isFinite(numTurns) || numTurns <= 0) {
      return {
        files: [],
        insertions: 0,
        deletions: 0
      }
    }

    const targetTurns = turns.slice(-numTurns)
    const files = new Set()
    let insertions = 0
    let deletions = 0

    for (const turn of targetTurns) {
      const items = Array.isArray(turn?.items) ? turn.items : []
      for (const item of items) {
        if (item?.type !== 'fileChange') {
          continue
        }

        const changes = Array.isArray(item.changes) ? item.changes : []
        for (const change of changes) {
          const filePath = typeof change?.path === 'string' ? change.path.trim() : ''
          if (filePath) {
            files.add(filePath)
          }

          const stats = this.collectDiffStats(change?.diff || '')
          insertions += stats.insertions
          deletions += stats.deletions
        }
      }
    }

    return {
      files: Array.from(files),
      insertions,
      deletions
    }
  }

  collectRollbackPreviewFromSessionLog(numTurns = 0, sessionLogPath = this.currentThreadPath) {
    if (!Number.isFinite(numTurns) || numTurns <= 0 || typeof sessionLogPath !== 'string' || !sessionLogPath.trim()) {
      return {
        files: [],
        insertions: 0,
        deletions: 0
      }
    }

    let rawContent = ''
    try {
      rawContent = fs.readFileSync(sessionLogPath, 'utf8')
    } catch (error) {
      logger.warn('[CodexAdapter] Failed to read session log for rollback preview', {
        path: sessionLogPath,
        error: error.message
      })
      return {
        files: [],
        insertions: 0,
        deletions: 0
      }
    }

    const activeTurnIds = []
    const turnSummaries = new Map()

    const ensureTurnSummary = (turnId) => {
      if (!turnId) {
        return null
      }
      if (!turnSummaries.has(turnId)) {
        turnSummaries.set(turnId, {
          files: new Set(),
          insertions: 0,
          deletions: 0
        })
      }
      return turnSummaries.get(turnId)
    }

    for (const line of rawContent.split(/\r?\n/)) {
      if (!line.trim()) {
        continue
      }

      let entry = null
      try {
        entry = JSON.parse(line)
      } catch (error) {
        continue
      }

      const payload = entry?.payload
      if (!payload || entry?.type !== 'event_msg') {
        continue
      }

      if (payload.type === 'task_started') {
        const turnId = typeof payload.turn_id === 'string' ? payload.turn_id : ''
        if (!turnId) {
          continue
        }
        ensureTurnSummary(turnId)
        if (!activeTurnIds.includes(turnId)) {
          activeTurnIds.push(turnId)
        }
        continue
      }

      if (payload.type === 'patch_apply_end') {
        const turnId = typeof payload.turn_id === 'string' ? payload.turn_id : ''
        const summary = ensureTurnSummary(turnId)
        if (!summary) {
          continue
        }

        const changes = payload.changes && typeof payload.changes === 'object'
          ? payload.changes
          : {}

        for (const [filePath, change] of Object.entries(changes)) {
          const normalizedPath = typeof filePath === 'string' ? filePath.trim() : ''
          if (normalizedPath) {
            summary.files.add(normalizedPath)
          }

          const diffText = typeof change?.unified_diff === 'string'
            ? change.unified_diff
            : ''
          const stats = this.collectDiffStats(diffText)
          summary.insertions += stats.insertions
          summary.deletions += stats.deletions
        }
        continue
      }

      if (payload.type === 'thread_rolled_back') {
        const rollbackCount = Number(payload.num_turns || payload.numTurns || 0)
        if (!Number.isFinite(rollbackCount) || rollbackCount <= 0) {
          continue
        }
        activeTurnIds.splice(Math.max(0, activeTurnIds.length - rollbackCount), rollbackCount)
      }
    }

    const targetTurnIds = activeTurnIds.slice(-numTurns)
    const files = new Set()
    let insertions = 0
    let deletions = 0

    for (const turnId of targetTurnIds) {
      const summary = turnSummaries.get(turnId)
      if (!summary) {
        continue
      }
      for (const filePath of summary.files) {
        files.add(filePath)
      }
      insertions += summary.insertions
      deletions += summary.deletions
    }

    return {
      files: Array.from(files),
      insertions,
      deletions
    }
  }

  normalizeRollbackResponse(result = {}, options = {}) {
    const turnDiff = result?.turnDiff || result?.turn_diff || null
    const rawChanges = Array.isArray(result?.changes)
      ? result.changes
      : Array.isArray(turnDiff?.changes)
        ? turnDiff.changes
        : []
    const resultThread = result?.thread || null
    const resultThreadHasTurns = Array.isArray(resultThread?.turns) && resultThread.turns.length > 0
    const threadPreview = this.collectRollbackPreviewFromThread(
      resultThreadHasTurns ? resultThread : (options.fallbackThread || resultThread || null),
      options.numTurns || 0
    )
    const sessionLogPreview = this.collectRollbackPreviewFromSessionLog(
      options.numTurns || 0,
      options.sessionLogPath || this.currentThreadPath || null
    )

    const files = Array.from(new Set(
      rawChanges
        .map(change => (
          change?.path ||
          change?.file ||
          change?.filePath ||
          change?.fsPath ||
          change?.move_path ||
          null
        ))
        .filter(Boolean)
    ))

    const changedFiles = result?.changed_files || result?.filesChanged || result?.restored_files || files
    const normalizedChangedFiles = Array.isArray(changedFiles) && changedFiles.length > 0
      ? changedFiles
      : (
          sessionLogPreview.files.length > 0
            ? sessionLogPreview.files
            : threadPreview.files
        )

    return {
      ...result,
      changed_files: normalizedChangedFiles,
      filesChanged: normalizedChangedFiles,
      restored_files: result?.restored_files || normalizedChangedFiles,
      insertions: result?.insertions || result?.linesAdded || result?.lines_added || turnDiff?.insertions || sessionLogPreview.insertions || threadPreview.insertions || 0,
      deletions: result?.deletions || result?.linesRemoved || result?.lines_removed || turnDiff?.deletions || sessionLogPreview.deletions || threadPreview.deletions || 0,
      dry_run: options.dryRun === true
    }
  }

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

      case 'thread/name/updated':
        this.handleThreadNameUpdated(params)
        break

      case 'thread/archived':
      case 'thread/unarchived':
        this.handleThreadLifecycleEvent(method, params)
        break

      case 'turn/started':
        this.currentTurnId = params.turn.id
        this.currentAssistantMessageId = null
        this.turnMessageMap.set(params.turn.id, null)
        this.turnAssistantState.delete(params.turn.id)
        // pendingUserMessageUuid 在 turn 勾结束（turn/completed 或 diff 更新时）前持续保留
        // 不在这里清除，由 handleTurnDiffUpdated 和 turn/completed 消费
        this.turnStats.set(params.turn.id, {
          numTurns: 0,
          usage: createEmptyTurnUsage()
        })
        {
          const agentId = this.resolveAgentIdFromThreadId(params.threadId)
          if (agentId && this.agentRegistry.get(agentId)?.status !== 'running') {
            const ccgui = this.buildLifecycleCcgui({
              agentId,
              status: 'running'
            }, {
              eventType: 'start',
              agentId,
              agentKind: 'collaborative',
              source: 'spawned_thread',
              status: 'running'
            })
            this.emitAgentSilent(ccgui, { method, params })
          }
        }
        break

      case 'turn/completed': {
        this.currentTurnId = params.turn.id
        const completedUserMessageUuid = this.pendingUserMessageUuid
        this.pendingUserMessageUuid = null
        const turnStats = this.turnStats.get(params.turn.id) || null
        const diffMessageId = this.turnDiffMessageMap.get(params.turn.id)
        if (diffMessageId) {
          this.emit('message-update', {
            messageId: diffMessageId,
            updates: {
              isExecuting: false
            }
          })
          this.turnDiffMessageMap.delete(params.turn.id)
        }
        this.emit('result', {
          duration_ms: null,
          num_turns: turnStats?.numTurns || this.getTurnSegmentCount(params.turn.id),
          usage: turnStats?.usage || null,
          turn: params.turn
        })
        this.turnStats.delete(params.turn.id)
        this.turnAssistantState.delete(params.turn.id)
        {
          const agentId = this.resolveAgentIdFromThreadId(params.threadId)
          if (agentId) {
            const ccgui = this.buildLifecycleCcgui({
              agentId,
              status: 'ended'
            }, {
              eventType: 'end',
              agentId,
              reason: params.turn?.status === 'failed' ? 'failed' : 'completed',
              result: params.turn?.result || null,
              status: 'ended'
            })
            this.emitAgentSilent(ccgui, { method, params })
          }
        }

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

        // turn 结束后推送文件变更统计
        this.emitFileChangeSummary(completedUserMessageUuid)
        break
      }

      case 'item/started':
        this.handleItemStarted(params)
        break

      case 'item/completed':
        this.handleItemCompleted(params)
        break

      case 'item/agentMessage/delta':
        this.emitAssistantDelta(params.turnId, params.itemId, 'content', params.delta, params.threadId)
        break

      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta':
        this.emitAssistantDelta(params.turnId, params.itemId, 'thinking', params.delta, params.threadId)
        break

      case 'item/plan/delta':
        this.emitAssistantDelta(params.turnId, params.itemId, 'thinking', `${params.delta}`, params.threadId)
        break

      case 'item/commandExecution/outputDelta':
      case 'command/exec/outputDelta':
      case 'item/fileChange/outputDelta':
        this.handleToolOutputDelta(params)
        break

      case 'item/commandExecution/terminalInteraction':
      case 'command/exec/terminalInteraction':
        this.handleCommandTerminalInteraction(params)
        break

      case 'turn/diff/updated':
        this.handleTurnDiffUpdated(params)
        break

      case 'turn/plan/updated':
        this.handleTurnPlanUpdated(params)
        break

      case 'hook/started':
      case 'hook/completed':
        this.handleHookEvent(method, params)
        break

      case 'item/autoApprovalReview/started':
      case 'item/autoApprovalReview/completed':
        this.handleAutoApprovalReviewEvent(method, params)
        break

      case 'item/mcpToolCall/progress':
        this.handleMcpToolProgress(params)
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

      case 'thread/rolled_back':
        this.emitCodexSystemNotification('thread-event', {
          event: 'rolled-back',
          metadata: params || {}
        })
        break

      case 'undo/completed':
        this.emitCodexSystemNotification('thread-event', {
          event: 'undo-completed',
          metadata: params || {}
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
        this.emitCodexSystemNotification('model-rerouted', {
          requestedModel: params.requestedModel || params.from || null,
          reroutedModel: params.reroutedModel || params.to || params.model || null,
          metadata: params
        })
        break

      case 'rawResponseItem/completed':
      case 'serverRequest/resolved':
        this.emitCodexSilentEvent(
          method === 'serverRequest/resolved'
            ? 'server-request-resolved'
            : 'raw-response-item-completed',
          params || {}
        )
        break

      case 'account/rateLimits/updated':
        this.envInfo = applyCodexEnvInfoPatch({
          ...this.envInfo,
          rate_limits: params.rateLimits || this.envInfo?.rate_limits || null,
          codex_usage_error: params.rateLimits
            ? null
            : buildCodexUsageStateError(
                params.error || {
                  code: 'empty_usage',
                  message: 'Codex rate limit refresh returned empty data'
                },
                'Codex rate limit refresh returned empty data'
              )
        }, {
          provider: 'codex',
          providerPid: this.getPid()
        })
        this.emit('env-info', this.envInfo)
        break

      case 'account/updated':
        this.handleAccountUpdated(params)
        break

      case 'account/login/completed':
        this.handleAccountLoginCompleted(params)
        break

      case 'app/list/updated':
        this.handleAppListUpdated(params)
        break

      case 'skills/changed':
        this.handleSkillsChanged(params)
        break

      case 'deprecationNotice':
        this.emitCodexSystemNotification('provider-deprecation', {
          title: params?.summary || '配置项已弃用',
          message: params?.details || '',
          metadata: params || {}
        })
        break

      case 'configWarning':
        this.handleConfigWarning(params)
        break

      case 'error':
        // 提取更详细的错误信息
        const errorMessage = params?.message || params?.error?.message || params?.details || 'Codex error'
        const errorDetails = {
          type: 'error',
          message: errorMessage,
          // 附加更多上下文信息
          errorType: params?.type || params?.errorType || params?.codexErrorInfo || null,
          details: params?.details || params?.error?.details || null,
          suggestion: params?.suggestion || params?.hint || null,
          raw: params
        }
        logger.error('[CodexAdapter] CLI error notification', errorDetails)
        this.emit('cli-status', errorDetails)
        break

      default:
        this.emit('unknown_message', message)
        break
    }
  }

  handleThreadNameUpdated(params = {}) {
    const threadId = params.threadId || params.thread?.id || this.currentThreadId || null
    const threadName = String(params.threadName || params.name || params.title || '').trim()

    this.envInfo = applyCodexEnvInfoPatch({
      ...this.envInfo,
      thread_id: threadId || this.envInfo.thread_id || null,
      thread_title: threadName || this.envInfo.thread_title || null
    }, {
      provider: 'codex',
      providerPid: this.getPid()
    })
    this.emit('env-info', this.envInfo)

    this.emitCodexSystemNotification('thread-event', {
      event: 'name-updated',
      threadId,
      threadName: threadName || null,
      metadata: params
    })
  }

  handleThreadLifecycleEvent(method, params = {}) {
    const threadId = params.threadId || params.thread?.id || this.currentThreadId || null
    const event = method === 'thread/archived' ? 'archived' : 'unarchived'
    const threadStatus = event === 'archived' ? 'archived' : 'active'

    this.envInfo = applyCodexEnvInfoPatch({
      ...this.envInfo,
      thread_status: threadStatus
    }, {
      provider: 'codex',
      providerPid: this.getPid()
    })
    this.emit('env-info', this.envInfo)

    this.emitCodexSystemNotification('thread-event', {
      event,
      threadId,
      metadata: params
    })
  }

  handleTurnPlanUpdated(params = {}) {
    this.emitCodexSystemNotification('turn-plan-updated', {
      threadId: params.threadId || this.currentThreadId || null,
      turnId: params.turnId || this.currentTurnId || null,
      explanation: params.explanation || null,
      plan: Array.isArray(params.plan) ? params.plan : [],
      metadata: params
    })
  }

  handleHookEvent(method, params = {}) {
    const event = method === 'hook/started' ? 'started' : 'completed'
    const run = params.run || {}
    const errorMessage = params.error?.message || run.error?.message || null
    const payload = {
      event,
      threadId: params.threadId || this.currentThreadId || null,
      turnId: params.turnId || this.currentTurnId || null,
      hookId: run.id || params.hookId || null,
      hookName: run.hookName || run.name || params.hookName || null,
      status: run.status || null,
      errorMessage,
      metadata: params
    }

    this.emitCodexSilentEvent('hook-event', payload)
    if (event === 'completed' && errorMessage) {
      this.emitCodexSystemNotification('hook-event', {
        ...payload,
        message: errorMessage
      })
    }
  }

  handleAutoApprovalReviewEvent(method, params = {}) {
    const event = method === 'item/autoApprovalReview/started' ? 'started' : 'completed'
    const payload = {
      event,
      threadId: params.threadId || this.currentThreadId || null,
      turnId: params.turnId || this.currentTurnId || null,
      itemId: params.itemId || params.item?.id || null,
      targetItemId: params.targetItemId || params.item?.targetItemId || null,
      status: params.status || params.item?.status || null,
      riskLevel: params.riskLevel || params.item?.riskLevel || null,
      riskScore: params.riskScore || params.item?.riskScore || null,
      metadata: params
    }

    this.emitCodexSilentEvent('auto-approval-review-event', payload)
  }

  handleMcpToolProgress(params = {}) {
    const messageId = this.itemToMessageMap.get(params.itemId)
    const progressMessage = typeof params.message === 'string' ? params.message.trim() : ''

    if (messageId && progressMessage) {
      this.emit('message-delta', {
        messageId,
        field: 'result',
        delta: `\n[progress] ${progressMessage}`
      })
    }

    if (messageId) {
      this.emit('message-update', {
        messageId,
        updates: {
          progressMessage: progressMessage || null,
          progressUpdatedAt: Date.now()
        }
      })
    }

    this.emitCodexSilentEvent('tool-progress', {
      toolType: 'mcpToolCall',
      threadId: params.threadId || this.currentThreadId || null,
      turnId: params.turnId || this.currentTurnId || null,
      itemId: params.itemId || null,
      message: progressMessage || null,
      metadata: params
    })
  }

  handleSkillsChanged(params = {}) {
    const changedSkills = Array.isArray(params.skills)
      ? params.skills
      : (Array.isArray(params.data) ? params.data : [])

    this.emitCodexSilentEvent('inventory-changed', {
      domain: 'skills',
      action: 'updated',
      count: changedSkills.length,
      metadata: params
    })
  }

  handleAppListUpdated(params = {}) {
    const apps = Array.isArray(params.apps) ? params.apps : []
    this.emitCodexSilentEvent('inventory-changed', {
      domain: 'apps',
      action: 'updated',
      count: apps.length,
      metadata: params
    })
  }

  handleAccountUpdated(params = {}) {
    const authMode = params.authMode || params.auth_mode || null
    const account = params.account || params.accountInfo || null

    this.envInfo = applyCodexEnvInfoPatch({
      ...this.envInfo,
      auth_mode: authMode || this.envInfo.auth_mode || null,
      account: account || this.envInfo.account || null
    }, {
      provider: 'codex',
      providerPid: this.getPid()
    })
    this.emit('env-info', this.envInfo)

    this.emitCodexSilentEvent('account-updated', {
      authMode,
      account,
      metadata: params
    })
  }

  handleAccountLoginCompleted(params = {}) {
    const success = typeof params.success === 'boolean'
      ? params.success
      : !params.error
    this.emitCodexSystemNotification('account-login-completed', {
      loginId: params.loginId || params.login_id || null,
      success,
      error: params.error || null,
      metadata: params
    })
  }

  handleConfigWarning(params = {}) {
    this.emitCodexSystemNotification('provider-config-warning', {
      title: params.summary || '配置警告',
      message: params.details || '',
      path: params.path || null,
      range: params.range || null,
      metadata: params
    })
  }

  handleTurnDiffUpdated(params = {}) {
    const turnId = params.turnId || params.turn?.id || this.currentTurnId
    const diffText = typeof params.diff === 'string' ? params.diff : ''
    if (!turnId || !diffText.trim()) {
      return
    }

    // 写 patch 文件
    this.savePatchForTurn(diffText)

    const messageId = this.turnDiffMessageMap.get(turnId)
    const rawMessage = { method: 'turn/diff/updated', params }

    if (messageId) {
      this.emit('message-update', {
        messageId,
        updates: {
          toolInput: { diff: diffText },
          rawMessages: [rawMessage]
        }
      })
      return
    }

    const nextMessageId = `codex-diff-${turnId}`
    this.turnDiffMessageMap.set(turnId, nextMessageId)
    this.emit('message-start', {
      id: nextMessageId,
      role: 'diff',
      toolName: 'Diff',
      toolInput: { diff: diffText },
      result: '',
      isError: false,
      isExecuting: true,
      request_id: nextMessageId,
      collapsed: false,
      timestamp: new Date(),
      startTime: Date.now(),
      rawMessages: [rawMessage]
    })
  }

  handleItemStarted(params) {
    const item = params.item
    if (!item) {
      return
    }

    this.itemState.set(item.id, item)
    this.rememberSpawnItem(item, params)

    if (item.type === 'fileChange') {
      return
    }

    if (item.type === 'agentMessage' || item.type === 'reasoning' || item.type === 'plan') {
      if (item.type === 'agentMessage' && item.text) {
        const messageId = this.ensureAssistantMessage(params.turnId, item.id, params.threadId)
        this.emit('message-delta', {
          messageId,
          field: 'content',
          delta: item.text
        })
      }
      if (item.type === 'reasoning' && Array.isArray(item.content) && item.content.length > 0) {
        const messageId = this.ensureAssistantMessage(params.turnId, item.id, params.threadId)
        const thinkingText = item.content.join('\n')
        this.emit('message-delta', {
          messageId,
          field: 'thinking',
          delta: thinkingText
        })
      }
      if (item.type === 'plan' && item.text) {
        const messageId = this.ensureAssistantMessage(params.turnId, item.id, params.threadId)
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
      message.ccgui = this.buildCcguiPatch({
        attribution: this.resolveAttributionFromThreadId(params.threadId)
      })
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

    if (item.type === 'fileChange') {
      this.emit('silent-message', {
        messageType: 'item/fileChange',
        params: {
          itemId: item.id,
          turnId: params.turnId || this.currentTurnId,
          changes: Array.isArray(item.changes) ? item.changes : [],
          path: item.path || null,
          timestamp: new Date().toISOString()
        }
      })
      return
    }

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
    if (this.isSpawnAgentItem(item)) {
      this.registerSpawnedAgents(item, params)
      this.pendingSpawnItems.delete(item.id)
    }
    this.emit('message-update', {
      messageId,
      updates: {
        ...updates,
        ccgui: this.buildCcguiPatch({
          attribution: this.resolveAttributionFromThreadId(params.threadId)
        })
      }
    })
  }

  ensureAssistantMessage(turnId, itemId, threadId = null) {
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
      ccgui: this.buildCcguiPatch({
        attribution: this.resolveAttributionFromThreadId(threadId)
      }),
      rawMessages: []
    })

    return messageId
  }

  emitAssistantDelta(turnId, itemId, field, delta, threadId = null) {
    const messageId = this.ensureAssistantMessage(turnId, itemId, threadId)
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
        role: 'diff',
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
    const itemState = this.itemState.get(params.itemId)
    if (itemState?.type === 'fileChange') {
      return
    }

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

  handleCommandTerminalInteraction(params = {}) {
    const itemId = params.itemId || params.callId || null
    const stdin = typeof params.stdin === 'string' ? params.stdin : ''
    const itemState = itemId ? this.itemState.get(itemId) : null

    if (itemId && itemState?.type === 'commandExecution') {
      this.itemState.set(itemId, {
        ...itemState,
        lastTerminalInteractionAt: new Date().toISOString(),
        ...(stdin ? { lastTerminalInput: stdin } : {})
      })
    }

    this.emit('silent-message', {
      messageType: 'item/commandExecution/terminalInteraction',
      provider: 'codex',
      params: {
        itemId,
        processId: params.processId || null,
        threadId: params.threadId || this.currentThreadId || null,
        turnId: params.turnId || this.currentTurnId || null,
        stdin,
        timestamp: new Date().toISOString()
      }
    })
  }

  handleServerRequest(message) {
    const { id, method, params } = message
    const requestParams = params || {}

    if (method === 'account/chatgptAuthTokens/refresh') {
      this.sendResponse(id, {})
      this.pendingServerRequests.delete(String(id))
      this.emitCodexSilentEvent('account-token-refresh-request', {
        requestId: id,
        metadata: requestParams
      })
      return
    }

    if (method === 'item/plan/requestImplementation') {
      const normalized = normalizeControlRequest({
        request_id: id,
        tool_use_id: requestParams.itemId || requestParams.callId || id,
        requestMethod: method,
        questions: Array.isArray(requestParams.questions) && requestParams.questions.length > 0
          ? requestParams.questions
          : [{
              id: 'planImplementation',
              question: requestParams.planContent || requestParams.description || '是否执行当前计划实现？'
            }],
        ...requestParams
      })
      this.emit('control-request', normalized)
      return
    }

    if (method === 'item/tool/requestUserInput' || method === 'mcpServer/elicitation/request') {
      const normalized = normalizeControlRequest({
        request_id: id,
        tool_use_id: requestParams.itemId || requestParams.callId || id,
        questions: requestParams.questions || [],
        requestMethod: method,
        ...requestParams
      })
      this.emit('control-request', normalized)
      return
    }

    const controlRequest = normalizeControlRequest({
      request_id: id,
      tool_use_id: requestParams.itemId || requestParams.callId || id,
      requestMethod: method,
      tool_name: this.mapRequestMethodToToolName(method),
      tool_input: this.buildControlToolInput(method, requestParams),
      ...requestParams
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
      case 'item/plan/requestImplementation':
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

    if (method === 'item/plan/requestImplementation') {
      return {
        description: params.description || 'Codex 请求确认执行计划实现',
        planContent: params.planContent || '',
        questions: Array.isArray(params.questions) ? params.questions : []
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
    } else if (method === 'item/plan/requestImplementation') {
      result = { decision: approved ? 'accept' : 'decline' }
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

  async sendControlRequest(request) {
    if (request?.subtype === 'rewind') {
      request = {
        ...request,
        subtype: 'undo_patch'
      }
    } else if (request?.subtype === 'rewind_and_fork') {
      request = {
        ...request,
        subtype: 'undo_patch_and_fork'
      }
    }

    if (request?.subtype === 'changed_files' || request?.subtype === 'rewind_files') {
      // 从 patch 文件读取预览，不走 thread/rollback(dryRun)
      const userMessageUuid = request.user_message_id || null
      const diffText = userMessageUuid ? this.readPatchFile(userMessageUuid) : null

      if (diffText) {
        const { files, insertions, deletions } = this.parseDiffInfo(diffText)
        return this.buildControlResponse(
          `codex-rewind-preview-${Date.now()}`,
          {
            changed_files: files,
            filesChanged: files,
            restored_files: files,
            insertions,
            deletions,
            dry_run: true
          }
        )
      }

      // fallback：没有 patch 文件时走原来的 thread/rollback
      return super.sendControlRequest(request)
    }

    if (request?.subtype === 'undo_patch') {
      // 从 patch 文件反向应用，不走 thread/rollback
      const userMessageUuid = request.user_message_id || null
      const diffText = userMessageUuid ? this.readPatchFile(userMessageUuid) : null

      if (diffText) {
        const { files, insertions, deletions } = this.parseDiffInfo(diffText)
        await this.applyReversePatch(userMessageUuid)
        return this.buildControlResponse(
          `codex-rewind-${Date.now()}`,
          {
            changed_files: files,
            filesChanged: files,
            restored_files: files,
            insertions,
            deletions,
            dry_run: false
          }
        )
      }

      // fallback：没有 patch 文件时走原来的 thread/rollback
      return super.sendControlRequest(request)
    }

    if (request?.subtype === 'redo_patch') {
      const userMessageUuid = request.user_message_id || null
      const diffText = userMessageUuid ? this.readPatchFile(userMessageUuid) : null

      if (diffText) {
        const { files, insertions, deletions } = this.parseDiffInfo(diffText)
        await this.applyForwardPatch(userMessageUuid)
        return this.buildControlResponse(
          `codex-redo-${Date.now()}`,
          {
            changed_files: files,
            filesChanged: files,
            restored_files: files,
            insertions,
            deletions,
            dry_run: false
          }
        )
      }

      throw new Error('Codex provider cannot redo patch without a saved patch file')
    }

    if (request?.subtype === 'reset_files' || request?.subtype === 'reset_files_and_fork') {
      throw new Error('Codex provider does not support reset-based file restore')
    }

    if (request?.subtype === 'undo_patch_and_fork') {
      throw new Error('Codex provider does not support patch undo with fork')
    }

    return super.sendControlRequest(request)
  }

  // ─── Patch 文件管理 ───────────────────────────────────────

  getDiffDir() {
    if (!this.sessionStoragePath) {
      return null
    }
    return path.join(this.sessionStoragePath, 'diffs')
  }

  ensureDiffDir() {
    const diffDir = this.getDiffDir()
    if (!diffDir) {
      return null
    }
    if (!fs.existsSync(diffDir)) {
      fs.mkdirSync(diffDir, { recursive: true })
    }
    return diffDir
  }

  resolvePatchFilePath(userMessageUuid) {
    const diffDir = this.ensureDiffDir()
    if (!diffDir || !userMessageUuid) {
      return null
    }
    return path.join(diffDir, `${userMessageUuid}.patch`)
  }

  savePatchForTurn(diffText) {
    const userMessageUuid = this.pendingUserMessageUuid
    if (!userMessageUuid || !diffText?.trim()) {
      return
    }
    const patchFilePath = this.resolvePatchFilePath(userMessageUuid)
    if (!patchFilePath) {
      return
    }
    try {
      fs.writeFileSync(patchFilePath, diffText, 'utf8')
      logger.debug('[CodexAdapter] Saved patch for turn', { userMessageUuid, size: diffText.length })
    } catch (error) {
      logger.warn('[CodexAdapter] Failed to save patch', { userMessageUuid, error: error.message })
    }
  }

  readPatchFile(userMessageUuid) {
    const patchFilePath = this.resolvePatchFilePath(userMessageUuid)
    if (!patchFilePath || !fs.existsSync(patchFilePath)) {
      return null
    }
    try {
      return fs.readFileSync(patchFilePath, 'utf8')
    } catch (error) {
      logger.warn('[CodexAdapter] Failed to read patch', { userMessageUuid, error: error.message })
      return null
    }
  }

  parseDiffInfo(diffText) {
    if (!diffText?.trim()) {
      return { files: [], insertions: 0, deletions: 0 }
    }

    const files = new Set()
    let insertions = 0
    let deletions = 0
    let inHunk = false

    for (const line of diffText.split('\n')) {
      // 匹配 diff --git a/path b/path
      const gitMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
      if (gitMatch) {
        files.add(gitMatch[2])
        inHunk = false
        continue
      }
      // 跳过元数据行
      if (line.startsWith('---') || line.startsWith('+++') || line.startsWith('@@') || line.startsWith('\\ ')) {
        if (line.startsWith('@@')) {
          inHunk = true
        }
        continue
      }
      if (!inHunk) {
        continue
      }
      if (line.startsWith('+')) {
        insertions += 1
      } else if (line.startsWith('-')) {
        deletions += 1
      }
    }

    return {
      files: Array.from(files),
      insertions,
      deletions
    }
  }

  async applyReversePatch(userMessageUuid) {
    const diffText = this.readPatchFile(userMessageUuid)
    if (!diffText?.trim()) {
      throw new Error(`No patch found for message: ${userMessageUuid}`)
    }

    const { execSync } = require('child_process')
    const patchFilePath = this.resolvePatchFilePath(userMessageUuid)

    try {
      execSync(`git apply -R --allow-empty "${patchFilePath}"`, {
        cwd: this.workingDirectory,
        timeout: 30000,
        encoding: 'utf8'
      })
      logger.info('[CodexAdapter] Applied reverse patch', { userMessageUuid })
      return true
    } catch (error) {
      logger.error('[CodexAdapter] Failed to apply reverse patch', {
        userMessageUuid,
        error: error.message,
        stderr: error.stderr?.toString?.() || ''
      })
      throw new Error(`Failed to apply reverse patch: ${error.message}`)
    }
  }

  async applyForwardPatch(userMessageUuid) {
    const diffText = this.readPatchFile(userMessageUuid)
    if (!diffText?.trim()) {
      throw new Error(`No patch found for message: ${userMessageUuid}`)
    }

    const { execSync } = require('child_process')
    const patchFilePath = this.resolvePatchFilePath(userMessageUuid)

    try {
      execSync(`git apply --allow-empty "${patchFilePath}"`, {
        cwd: this.workingDirectory,
        timeout: 30000,
        encoding: 'utf8'
      })
      logger.info('[CodexAdapter] Applied forward patch', { userMessageUuid })
      return true
    } catch (error) {
      logger.error('[CodexAdapter] Failed to apply forward patch', {
        userMessageUuid,
        error: error.message,
        stderr: error.stderr?.toString?.() || ''
      })
      throw new Error(`Failed to apply forward patch: ${error.message}`)
    }
  }

  // ─── 文件变更统计 ────────────────────────────────────────

  parseDiffFileStats(diffText = '') {
    if (typeof diffText !== 'string' || !diffText.trim()) {
      return { files: [], totalInsertions: 0, totalDeletions: 0 }
    }

    const fileMap = new Map()
    let currentFile = null
    let inHunk = false

    for (const line of diffText.split('\n')) {
      const gitMatch = line.match(/^diff --git a\/(.+?) b\/(.+)$/)
      if (gitMatch) {
        currentFile = gitMatch[2]
        inHunk = false
        continue
      }
      if (line.startsWith('---') || line.startsWith('+++')) continue
      if (line.startsWith('@@')) { inHunk = true; continue }
      if (line.startsWith('\\ ')) continue
      if (!inHunk || !currentFile) continue

      if (!fileMap.has(currentFile)) {
        fileMap.set(currentFile, { path: currentFile, insertions: 0, deletions: 0 })
      }
      const stats = fileMap.get(currentFile)
      if (line.startsWith('+')) stats.insertions += 1
      else if (line.startsWith('-')) stats.deletions += 1
    }

    const files = Array.from(fileMap.values())
    return {
      files,
      totalInsertions: files.reduce((sum, f) => sum + f.insertions, 0),
      totalDeletions: files.reduce((sum, f) => sum + f.deletions, 0)
    }
  }

  emitFileChangeSummary(userMessageUuid) {
    if (!userMessageUuid) return
    const diffText = this.readPatchFile(userMessageUuid)
    if (!diffText?.trim()) return

    const stats = this.parseDiffFileStats(diffText)
    if (stats.files.length === 0) return

    this.emit('file-change-summary', {
      id: `file-change-summary-${Date.now()}`,
      role: 'file_change_summary',
      files: stats.files,
      totalFiles: stats.files.length,
      totalInsertions: stats.totalInsertions,
      totalDeletions: stats.totalDeletions,
      patchState: 'applied',
      userMessageId: userMessageUuid,
      timestamp: new Date()
    })
  }

  // ─── Control Request（rewind via patch） ─────────────────

  getSessionIdentifier() {
    return this.getThreadId?.() || this.sessionId || null
  }

  getSessionSettingsPatch() {
    const threadId = this.getThreadId?.()
    return threadId ? {
      codexThreadId: threadId,
      toolBinding: {
        tool: 'codex',
        nativeSessionId: threadId
      }
    } : null
  }
}

module.exports = { CodexAdapter }
