import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useSessionStore } from './useSessionStore'
import { logger } from '../utils/logger'

// CCAgent 项目路径（跨平台）
const CCAGENT_PROJECT_PATH = window.electronAPI
  ? null // 将在运行时通过 IPC 获取
  : null

// 判断是否为 ccagent 项目
function isCCAgentProject(project) {
  if (!project?.path) return false
  // 匹配 ~/.ccgui/ccagent 路径（兼容不同平台）
  const normalized = project.path.replace(/\\/g, '/')
  return normalized.endsWith('/.ccgui/ccagent')
}

// Local storage keys
const STORAGE_KEYS = {
  SIDEBAR_STATE: 'ccgui_sidebar_state',
  LAST_PROJECT: 'ccgui_last_project',
  LAST_SESSION: 'ccgui_last_session'
}

let hasBoundSessionCompletionListener = false
let hasBoundSessionsChangedListener = false
let hasBoundSessionPreviewListener = false
let hasBoundInboxChangedListener = false
let hasBoundSessionStatusListener = false
let hasBoundFloatingMonitorModeListener = false

// 播放后台权限请求提示音
async function playPermissionAlertSound() {
  try {
    const result = await window.electronAPI.getAppConfig()
    const config = result?.config
    if (config?.settings?.alertSoundEnabled === false) return
    const sound = config?.settings?.alertSound || 'Glass'
    await window.electronAPI?.playSystemSound?.({ sound })
  } catch {}
}

// 窗口不在前台时用系统级提醒（Dock 图标跳动），避免用户看不到待授权的会话
async function requestPermissionAttention(sessionId) {
  try {
    await window.electronAPI?.notifyPermissionAttention?.({ sessionId })
  } catch {}
}

// Helper to load from localStorage
function loadFromStorage(key, defaultValue) {
  try {
    const stored = localStorage.getItem(key)
    return stored ? JSON.parse(stored) : defaultValue
  } catch {
    return defaultValue
  }
}

// Helper to save to localStorage
function saveToStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Ignore storage errors
  }
}

export const useAppStore = defineStore('app', () => {
  // State
  const projects = ref([])
  const sessions = ref([])
  const floatingMonitorMode = ref('auto')
  const currentProject = ref(null)
  const currentSession = ref(null) // 会话元信息（从文件系统扫描）
  const sessionStatuses = ref({}) // session 状态对象：{ ready, processing, streaming, unseenCompleted }
  const pendingSessionDeletionIds = ref(new Set())
  const inboxUnreadCounts = ref({})
  const currentInboxMessages = ref([])
  const hasRunningTerminals = ref(false) // 终端运行状态（由 Workspace 同步）
  const sidebarCollapsed = ref(loadFromStorage(STORAGE_KEYS.SIDEBAR_STATE, {
    project: false,
    session: false
  }))
  const isLoading = ref(false)
  const error = ref(null)
  const showRecycleBin = ref(false)

  // Watch sidebar state and persist
  watch(sidebarCollapsed, (newValue) => {
    saveToStorage(STORAGE_KEYS.SIDEBAR_STATE, newValue)
  }, { deep: true })

  watch(() => currentSession.value?.id, (sessionId) => {
    if (sessionId) {
      clearSessionUnseenCompleted(sessionId)
      fetchCurrentInboxMessages(sessionId)
    } else {
      currentInboxMessages.value = []
    }
  })

  // Computed
  const currentProjectSessions = computed(() => {
    if (!currentProject.value) return []

    // 基础数据：从文件系统扫描的session列表，根据回收站模式过滤
    const baseSessions = sessions.value.filter(s => {
      if (pendingSessionDeletionIds.value.has(s.id)) return false
      if (s.projectId !== currentProject.value.id) return false
      return showRecycleBin.value ? s.deleted === true : s.deleted !== true
    })

    // 合并运行时的实时数据
    return baseSessions.map(session => {
      const runtimeStatus = sessionStatuses.value[session.id]
      if (runtimeStatus) {
        // 如果session正在运行，使用内存中的实时数据
        return {
          ...session,
          messageCount: runtimeStatus.messageCount ?? session.messageCount,
          updatedAt: runtimeStatus.updatedAt || session.updatedAt,
          status: isSessionResponding(runtimeStatus) ? 'processing' : 'ready'
        }
      }
      // 否则使用文件扫描的静态数据
      return session
    })
  })

  // 检查当前项目是否有正在处理的 session（用于侧边栏显示计数等）
  const hasProcessingSessions = computed(() => {
    if (!currentProject.value) return false
    return currentProjectSessions.value.some(session => {
      const status = sessionStatuses.value[session.id]
      return isSessionResponding(status)
    })
  })

  // 检查当前项目是否有 runtime 在运行的 session（即侧边栏显示绿点的那些）
  const hasRunningSessions = computed(() => {
    if (!currentProject.value) return false
    return currentProjectSessions.value.some(session => {
      const status = sessionStatuses.value[session.id]
      return status?.ready
    })
  })

  // 综合检查：session 或终端是否有运行中的任务
  const hasActiveWork = computed(() => {
    return hasRunningSessions.value || hasRunningTerminals.value
  })

  function setHasRunningTerminals(value) {
    hasRunningTerminals.value = Boolean(value)
  }

  function normalizeFloatingMonitorMode(value) {
    return ['off', 'auto', 'always'].includes(value) ? value : 'auto'
  }

  function setFloatingMonitorMode(value) {
    floatingMonitorMode.value = normalizeFloatingMonitorMode(value)
  }

  async function loadFloatingMonitorMode() {
    try {
      const result = await window.electronAPI.getAppConfig()
      if (result?.success) {
        setFloatingMonitorMode(result.config?.settings?.floatingMonitorMode)
      }
    } catch (e) {
      logger.warn('[AppStore] Failed to load floating monitor mode', { error: e.message })
    }
  }

  function bindFloatingMonitorModeListener() {
    if (hasBoundFloatingMonitorModeListener || typeof window === 'undefined') {
      return
    }
    window.electronAPI.onFloatingMonitorModeChanged(({ mode }) => {
      setFloatingMonitorMode(mode)
    })
    hasBoundFloatingMonitorModeListener = true
  }

  function ensureSessionStatus(sessionId) {
    if (!sessionId) {
      return null
    }

    const currentStatus = sessionStatuses.value[sessionId]
    if (currentStatus) {
      return currentStatus
    }

    return {
      ready: false,
      processing: false,
      streaming: false,
      // 当前仍在运行的子代理。session 是否正在回话必须同时聚合主代理和子代理。
      activeAgentIds: [],
      pendingCompletion: false,
      unseenCompleted: false,
      pendingPermission: false,
      autoApprove: false,
      messageCount: 0,
      updatedAt: null
    }
  }

  function isSessionResponding(status = null) {
    return Boolean(
      status?.ready &&
      (
        status.processing ||
        status.streaming ||
        (Array.isArray(status.activeAgentIds) && status.activeAgentIds.length > 0)
      )
    )
  }

  function getStatusAgentId(sessionId, data = {}) {
    const ccgui = data?.ccgui || {}
    const payloadAgentId = ccgui.attribution?.agentId ||
      ccgui.attribution?.actorId ||
      ccgui.registry?.agentId ||
      ccgui.orchestration?.agentId ||
      data.agentId ||
      data.agent_id ||
      data.teammate_id ||
      data.teammateId ||
      null
    if (payloadAgentId) {
      return payloadAgentId
    }
    if (ccgui.subagentId) {
      return ccgui.subagentId === 'master' ? null : ccgui.subagentId
    }

    const messageId = data.messageId || data.id
    if (messageId) {
      const session = useSessionStore().sessions?.get?.(sessionId)
      const message = session?.queueManager?.findEntryGlobal(messageId)
      const messageAgentId = message?.ccgui?.attribution?.agentId ||
        message?.ccgui?.registry?.agentId ||
        message?.ccgui?.orchestration?.agentId ||
        null
      if (messageAgentId) {
        return messageAgentId
      }
    }

    const rawMessage = data.rawMessage || data.rawMessages?.[0] || null
    if (
      ccgui.isSubagent ||
      ccgui.subagentId ||
      rawMessage?.parent_tool_use_id ||
      rawMessage?.teammate_id ||
      rawMessage?.agent_thread_id
    ) {
      return '__subagent__'
    }

    return null
  }

  function isMainStatusAgent(sessionId, data = {}) {
    const agentId = getStatusAgentId(sessionId, data)
    return !agentId || agentId === 'master'
  }

  function updateActiveAgentStatus(sessionId, data = {}) {
    const registry = data?.ccgui?.registry || null
    const orchestration = data?.ccgui?.orchestration || null
    const agentId = registry?.agentId || orchestration?.agentId || getStatusAgentId(sessionId, data)
    if (!agentId || agentId === '__subagent__' || agentId === 'master') {
      return
    }
    const agentType = registry?.agentType || orchestration?.agentType
    if (agentType === 'team') {
      return
    }

    const status = registry?.status || orchestration?.status || null
    const eventType = orchestration?.eventType || null
    const isInactive = status === 'ended' ||
      status === 'failed' ||
      status === 'interrupted' ||
      status === 'deleted' ||
      eventType === 'end' ||
      eventType === 'delete'
    const isActive = !isInactive && (
      status === 'starting' ||
      status === 'running' ||
      eventType === 'start'
    )
    if (!isActive && !isInactive) {
      return
    }

    setActiveAgentStatus(sessionId, agentId, isActive)
  }

  function setActiveAgentStatus(sessionId, agentId, isActive) {
    if (!agentId || agentId === '__subagent__' || agentId === 'master') {
      return
    }

    const currentStatus = ensureSessionStatus(sessionId)
    const activeAgentIds = new Set(currentStatus?.activeAgentIds || [])
    if (isActive) {
      activeAgentIds.add(agentId)
    } else {
      activeAgentIds.delete(agentId)
    }
    const nextStatus = {
      ...currentStatus,
      activeAgentIds: Array.from(activeAgentIds),
      updatedAt: new Date().toISOString()
    }
    if (isActive) {
      nextStatus.pendingCompletion = false
      nextStatus.unseenCompleted = false
    } else if (!isSessionResponding(nextStatus) && nextStatus.pendingCompletion) {
      nextStatus.pendingCompletion = false
      nextStatus.unseenCompleted = currentSession.value?.id !== sessionId
    }
    patchSessionStatus(sessionId, nextStatus)
  }

  function patchSessionStatus(sessionId, updates = {}) {
    if (!sessionId) {
      return
    }

    const currentStatus = ensureSessionStatus(sessionId)
    sessionStatuses.value = {
      ...sessionStatuses.value,
      [sessionId]: {
        ...currentStatus,
        ...updates
      }
    }
  }

  function patchSessionBindingLinked(sessionId) {
    if (!sessionId || !Array.isArray(sessions.value)) {
      return
    }

    let changed = false
    const nextSessions = sessions.value.map(session => {
      if (session?.id !== sessionId) {
        return session
      }
      if (
        session.bindingState === 'linked' &&
        !session.bindingLabel &&
        !session.bindingMissing
      ) {
        return session
      }

      changed = true
      return {
        ...session,
        bindingState: 'linked',
        bindingLabel: '',
        bindingMissing: false
      }
    })

    if (changed) {
      sessions.value = nextSessions
    }
  }

  function bumpSessionActivity(sessionId, options = {}) {
    const currentStatus = ensureSessionStatus(sessionId)
    if (!currentStatus) {
      return
    }

    const nextMessageCount = options.incrementMessageCount
      ? Math.max(0, Number(currentStatus.messageCount || 0) + 1)
      : currentStatus.messageCount

    patchSessionStatus(sessionId, {
      messageCount: nextMessageCount,
      updatedAt: options.updatedAt || new Date().toISOString(),
      ...(options.updates || {})
    })
  }

  function handleSessionStatusEvent(event) {
    const sessionId = event?.sessionId
    const eventType = event?.eventType
    const data = event?.data || {}

    if (!sessionId || !eventType) {
      return
    }

    switch (eventType) {
      case 'state-update':
        patchSessionStatus(sessionId, {
          processing: Boolean(data?.isProcessing),
          ...(Array.isArray(data?.activeAgentIds) ? { activeAgentIds: data.activeAgentIds } : {}),
          ...(
            data?.isProcessing || (Array.isArray(data?.activeAgentIds) && data.activeAgentIds.length > 0)
              ? { pendingCompletion: false }
              : {}
          ),
          updatedAt: new Date().toISOString()
        })
        break

      case 'message':
        {
          const agentId = getStatusAgentId(sessionId, data)
          if (agentId && agentId !== 'master') {
            setActiveAgentStatus(sessionId, agentId, true)
          }
        }
        bumpSessionActivity(sessionId, {
          incrementMessageCount: true,
          updatedAt: data?.timestamp || new Date().toISOString()
        })
        break

      case 'message-start':
        if (!isMainStatusAgent(sessionId, data)) {
          updateActiveAgentStatus(sessionId, data)
          bumpSessionActivity(sessionId, {
            incrementMessageCount: true,
            updatedAt: data?.timestamp || new Date().toISOString()
          })
          break
        }
        bumpSessionActivity(sessionId, {
          incrementMessageCount: true,
          updatedAt: data?.timestamp || new Date().toISOString(),
          updates: {
            processing: true,
            streaming: true,
            pendingCompletion: false
          }
        })
        break

      case 'message-complete':
        if (!isMainStatusAgent(sessionId, data)) {
          // 单条消息完成不代表子代理 turn 结束；只有生命周期事件可以结束代理。
          updateActiveAgentStatus(sessionId, data)
          bumpSessionActivity(sessionId, {
            updatedAt: data?.timestamp || new Date().toISOString()
          })
          break
        }
        patchSessionStatus(sessionId, {
          streaming: false,
          updatedAt: new Date().toISOString()
        })
        break

      case 'result':
        patchSessionStatus(sessionId, {
          streaming: false,
          processing: false,
          updatedAt: new Date().toISOString()
        })
        break

      case 'interrupt':
        patchSessionStatus(sessionId, {
          streaming: false,
          processing: false,
          updatedAt: new Date().toISOString()
        })
        break

      case 'env-info':
        patchSessionStatus(sessionId, {
          ready: Boolean(data?.providerPid),
          updatedAt: new Date().toISOString()
        })
        break

      case 'system-notification':
        if (data?.type === 'session-runtime-starting' || data?.type === 'session-runtime-restarting') {
          patchSessionStatus(sessionId, {
            ready: false,
            streaming: false,
            activeAgentIds: [],
            updatedAt: new Date().toISOString()
          })
          break
        }

        if (data?.type === 'session-runtime-ready') {
          patchSessionBindingLinked(sessionId)
          patchSessionStatus(sessionId, {
            ready: true,
            streaming: false,
            activeAgentIds: [],
            updatedAt: new Date().toISOString()
          })
          break
        }

        if (data?.type === 'runtime-stopped' || data?.type === 'runtime-exit') {
          patchSessionStatus(sessionId, {
            ready: false,
            processing: false,
            streaming: false,
            activeAgentIds: [],
            pendingPermission: false,
            updatedAt: new Date().toISOString()
          })
          break
        }

        break

      case 'silent-message':
      case 'agent-update':
      case 'task-event':
        updateActiveAgentStatus(sessionId, data)
        break

      case 'control-request': {
        const status = sessionStatuses.value[sessionId]
        // 以会话自身的 autoApprove 为准（appStore 里的状态可能滞后），避免误判为"会自动批准"而吞掉提醒
        const sessionAutoApprove = useSessionStore().sessions?.get?.(sessionId)?.autoApprove
        const isAutoApproved = sessionAutoApprove !== undefined && sessionAutoApprove !== null
          ? Boolean(sessionAutoApprove)
          : Boolean(status?.autoApprove)

        // 判断是否为 AskUserQuestion（即使开启自动批准，仍需用户交互，应通知）
        const requestData = data?.request || data
        const toolName = requestData?.tool_name || requestData?.toolName
        const isAskUserQuestion = toolName === 'AskUserQuestion'

        // 判断是否为 ~/.ccgui 目录下的文件请求（自动批准，无需音效）
        let isCcGuiFile = false
        try {
          const toolInput = requestData?.input || requestData?.tool_input || requestData?.toolInput
          const parsedInput = typeof toolInput === 'string' ? JSON.parse(toolInput) : toolInput
          const filePath = parsedInput?.file_path || parsedInput?.filePath || parsedInput?.path || ''
          const normalized = String(filePath || '').replace(/\\/g, '/')
          isCcGuiFile = normalized.includes('/.ccgui/') || normalized.endsWith('/.ccgui')
        } catch {
          // 解析失败，不做特殊处理
        }

        // 自动批准模式或 ~/.ccgui 文件请求，非 AskUserQuestion 不播放通知
        if ((isAutoApproved || isCcGuiFile) && !isAskUserQuestion) {
          break
        }

        patchSessionStatus(sessionId, {
          pendingPermission: true,
          updatedAt: new Date().toISOString()
        })

        // 用户可能看不到授权框时提醒：窗口不在前台，或请求不属于当前会话
        const isCurrentSession = sessionId === currentSession.value?.id
        const windowFocused = typeof document !== 'undefined' && document.hasFocus()
        if (!isCurrentSession || !windowFocused) {
          logger.info('[AppStore] Permission attention', {
            sessionId,
            isCurrentSession,
            windowFocused
          })
          playPermissionAlertSound()
          if (!windowFocused) {
            requestPermissionAttention(sessionId)
          }
        }
        break
      }

      case 'control-response':
        patchSessionStatus(sessionId, {
          pendingPermission: false,
          updatedAt: new Date().toISOString()
        })
        break

      case 'normal-exit':
      case 'abnormal-exit':
        patchSessionStatus(sessionId, {
          ready: false,
          processing: false,
          streaming: false,
          activeAgentIds: [],
          pendingPermission: false,
          updatedAt: new Date().toISOString()
        })
        break

      default:
        break
    }
  }

  // Actions - Projects
  async function fetchProjects() {
    try {
      isLoading.value = true
      error.value = null
      const result = await window.electronAPI.getProjects()
      // 过滤掉 ccagent 内置项目，不显示在项目列表中
      projects.value = result.filter(p => !isCCAgentProject(p))
    } catch (e) {
      error.value = e.message
      logger.error('Failed to fetch projects', { error: e.message })
    } finally {
      isLoading.value = false
    }
  }

  async function addProject(projectPath, settings = null) {
    try {
      isLoading.value = true
      error.value = null
      const newProject = await window.electronAPI.addProject({ projectPath, settings })
      projects.value.unshift(newProject)
      return newProject
    } catch (e) {
      error.value = e.message
      logger.error('Failed to add project', { error: e.message })
      throw e
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 确保 CCAgent 内置项目存在并返回项目对象
   * - 创建 ~/.ccgui/ccagent 目录（如不存在）
   * - 创建 .ccagent.md 和 .ccagentmemory.md（如不存在）
   * - 注册项目到后端（不添加到前端列表）
   */
  async function ensureCCAgentProject() {
    try {
      isLoading.value = true
      error.value = null
      const project = await window.electronAPI.ensureCCAgentProject()
      return project
    } catch (e) {
      error.value = e.message
      logger.error('Failed to ensure CCAgent project', { error: e.message })
      throw e
    } finally {
      isLoading.value = false
    }
  }

  async function removeProject(projectId, deleteFolder = false) {
    try {
      isLoading.value = true
      error.value = null
      await window.electronAPI.removeProject({ projectId, deleteFolder })
      projects.value = projects.value.filter(p => p.id !== projectId)
      if (currentProject.value?.id === projectId) {
        currentProject.value = null
        sessions.value = []
        currentSession.value = null
      }
    } catch (e) {
      error.value = e.message
      logger.error('Failed to remove project', { error: e.message })
      throw e
    } finally {
      isLoading.value = false
    }
  }

  function selectProject(project) {
    currentProject.value = project
    currentSession.value = null
    // 打开项目时同步 MCP / Skill 的启用状态（MCP 是收编+物化；Skill 交给 provider 原生层叠）
    const projectPath = project?.path
    if (projectPath) {
      for (const target of ['claude', 'codex']) {
        window.electronAPI?.syncProjectMcps?.({ target, projectPath }).catch(() => {})
        window.electronAPI?.syncProjectSkills?.({ target, projectPath }).catch(() => {})
      }
    }
  }

  // Actions - Sessions
  async function fetchSessions(projectId) {
    try {
      isLoading.value = true
      error.value = null
      const result = await window.electronAPI.getSessions({ projectId })
      sessions.value = result
      // Also fetch running sessions
      await fetchRunningSessions()
      await fetchInboxSummary(projectId)
    } catch (e) {
      error.value = e.message
      logger.error('Failed to fetch sessions', { error: e.message })
    } finally {
      isLoading.value = false
    }
  }

  async function fetchRunningSessions() {
    try {
      const statuses = await window.electronAPI.getRunningSessions()
      const previousStatuses = sessionStatuses.value
      const nextStatuses = {}

      Object.entries(statuses || {}).forEach(([sessionId, status]) => {
        const previousStatus = previousStatuses[sessionId]
        nextStatuses[sessionId] = {
          ...status,
          pendingCompletion: Boolean(previousStatus?.pendingCompletion),
          unseenCompleted: Boolean(
            previousStatus?.unseenCompleted &&
            status?.ready &&
            !status?.processing &&
            !status?.streaming &&
            (!Array.isArray(status?.activeAgentIds) || status.activeAgentIds.length === 0)
          )
        }
      })

      sessionStatuses.value = nextStatuses
    } catch (e) {
      logger.error('Failed to fetch running sessions', { error: e.message })
    }
  }

  async function fetchInboxSummary(projectId = currentProject.value?.id) {
    if (!projectId || typeof window === 'undefined') return
    try {
      inboxUnreadCounts.value = await window.electronAPI.getInboxSummary({ projectId })
    } catch (e) {
      logger.error('Failed to fetch inbox summary', { error: e.message })
    }
  }

  async function fetchCurrentInboxMessages(sessionId = currentSession.value?.id) {
    if (!currentProject.value?.id || !sessionId || typeof window === 'undefined') {
      currentInboxMessages.value = []
      return
    }
    try {
      currentInboxMessages.value = await window.electronAPI.getSessionInbox({
        projectId: currentProject.value.id,
        sessionId,
        unreadOnly: false
      })
    } catch (e) {
      logger.error('Failed to fetch current inbox messages', { error: e.message })
      currentInboxMessages.value = []
    }
  }

  async function ackCurrentInboxMessages(messageIds = []) {
    if (!currentProject.value?.id || !currentSession.value?.id || !Array.isArray(messageIds) || messageIds.length === 0) {
      return
    }
    try {
      await window.electronAPI.ackSessionInbox({
        projectId: currentProject.value.id,
        sessionId: currentSession.value.id,
        messageIds
      })
      await fetchInboxSummary(currentProject.value.id)
      await fetchCurrentInboxMessages(currentSession.value.id)
    } catch (e) {
      logger.error('Failed to acknowledge inbox messages', { error: e.message })
    }
  }

  async function dissolveTeam(projectId, teamId) {
    if (!projectId || !teamId) return
    const result = await window.electronAPI.dissolveTeam({ projectId, teamId })
    if (!result?.success) {
      throw new Error(result?.error || '解散团队失败')
    }
    await fetchSessions(projectId)
    await fetchInboxSummary(projectId)
  }

  async function destroyTeam(projectId, teamId, options = {}) {
    if (!projectId || !teamId) return
    const optimistic = options?.optimistic === true
    const teamSessionIds = optimistic
      ? sessions.value
        .filter(session => session.projectId === projectId && session.teamId === teamId)
        .map(session => session.id)
      : []

    if (teamSessionIds.length > 0) {
      updatePendingSessionDeletions(teamSessionIds, true)
      if (teamSessionIds.includes(currentSession.value?.id)) {
        currentSession.value = null
      }
    }

    try {
      const result = await window.electronAPI.destroyTeam({ projectId, teamId })
      if (!result?.success) {
        throw new Error(result?.error || '销毁团队失败')
      }
      await fetchSessions(projectId)
      await fetchInboxSummary(projectId)
      if (teamSessionIds.length > 0) {
        updatePendingSessionDeletions(teamSessionIds, false)
      }
      return result
    } catch (error) {
      if (teamSessionIds.length > 0) {
        updatePendingSessionDeletions(teamSessionIds, false)
      }
      throw error
    }
  }

  function markSessionCompletedUnseen(sessionId) {
    if (!sessionId) {
      return
    }

    const currentStatus = sessionStatuses.value[sessionId]
    if (!currentStatus?.ready) {
      return
    }

    if (isSessionResponding(currentStatus)) {
      patchSessionStatus(sessionId, {
        pendingCompletion: true,
        unseenCompleted: false,
        updatedAt: new Date().toISOString()
      })
      return
    }

    sessionStatuses.value = {
      ...sessionStatuses.value,
      [sessionId]: {
        ...currentStatus,
        pendingCompletion: false,
        unseenCompleted: currentSession.value?.id !== sessionId
      }
    }
  }

  function clearSessionUnseenCompleted(sessionId) {
    const currentStatus = sessionStatuses.value[sessionId]
    if (!sessionId || (!currentStatus?.unseenCompleted && !currentStatus?.pendingCompletion)) {
      return
    }

    sessionStatuses.value = {
      ...sessionStatuses.value,
      [sessionId]: {
        ...currentStatus,
        pendingCompletion: false,
        unseenCompleted: false
      }
    }
  }

  function bindSessionCompletionListener() {
    if (hasBoundSessionCompletionListener || typeof window === 'undefined') {
      return
    }

    window.addEventListener('ccgui-session-complete', (event) => {
      const sessionId = event.detail?.sessionId
      if (!sessionId) {
        return
      }
      markSessionCompletedUnseen(sessionId)
    })

    hasBoundSessionCompletionListener = true
  }

  bindSessionCompletionListener()

  function bindSessionStatusListener() {
    if (hasBoundSessionStatusListener || typeof window === 'undefined') {
      return
    }

    window.electronAPI.onSessionEvent((event) => {
      handleSessionStatusEvent(event)
    })

    hasBoundSessionStatusListener = true
  }

  bindSessionStatusListener()

  function bindSessionsChangedListener() {
    if (hasBoundSessionsChangedListener || typeof window === 'undefined') {
      return
    }

    window.electronAPI.onSessionsChanged((payload) => {
      if (!currentProject.value || payload?.projectId !== currentProject.value.id) {
        return
      }
      fetchSessions(currentProject.value.id).catch(() => {})
    })

    hasBoundSessionsChangedListener = true
  }

  bindSessionsChangedListener()

  function bindSessionPreviewListener() {
    if (hasBoundSessionPreviewListener || typeof window === 'undefined') {
      return
    }

    window.electronAPI.onSessionPreviewUpdated?.((payload) => {
      const projectId = payload?.projectId
      const sessionId = payload?.sessionId
      const preview = typeof payload?.preview === 'string' ? payload.preview.trim() : ''
      if (!projectId || !sessionId || !preview) {
        return
      }

      let changed = false
      const nextSessions = sessions.value.map(session => {
        if (session?.id !== sessionId || session?.projectId !== projectId) {
          return session
        }
        if (session.preview === preview) {
          return session
        }
        changed = true
        return {
          ...session,
          preview
        }
      })

      if (changed) {
        sessions.value = nextSessions
      }
      if (currentSession.value?.id === sessionId && currentSession.value?.projectId === projectId) {
        currentSession.value = {
          ...currentSession.value,
          preview
        }
      }
    })

    hasBoundSessionPreviewListener = true
  }

  bindSessionPreviewListener()

  function bindInboxChangedListener() {
    if (hasBoundInboxChangedListener || typeof window === 'undefined') {
      return
    }

    window.electronAPI.onInboxChanged((payload) => {
      if (!currentProject.value || payload?.projectId !== currentProject.value.id) {
        return
      }
      fetchInboxSummary(currentProject.value.id)
      if (payload?.sessionId && payload.sessionId === currentSession.value?.id) {
        fetchCurrentInboxMessages(currentSession.value.id)
      }
    })

    hasBoundInboxChangedListener = true
  }

  bindInboxChangedListener()

  async function createSession(projectId, name, options = {}) {
    try {
      isLoading.value = true
      error.value = null
      const newSession = await window.electronAPI.createSession({ projectId, name, ...options })
      sessions.value.unshift(newSession)
      return newSession
    } catch (e) {
      error.value = e.message
      logger.error('Failed to create session', { error: e.message })
      throw e
    } finally {
      isLoading.value = false
    }
  }

  function updatePendingSessionDeletions(sessionIds = [], pending = true) {
    const next = new Set(pendingSessionDeletionIds.value)
    for (const sessionId of sessionIds) {
      if (pending) {
        next.add(sessionId)
      } else {
        next.delete(sessionId)
      }
    }
    pendingSessionDeletionIds.value = next
  }

  async function deleteSessions(sessionIds = [], options = {}) {
    const optimistic = options?.optimistic === true
    const uniqueSessionIds = [...new Set(
      (Array.isArray(sessionIds) ? sessionIds : []).filter(Boolean)
    )]
    if (uniqueSessionIds.length === 0) {
      return { deletedSessionIds: [], failures: [], warnings: [] }
    }

    const targetSessionIds = optimistic
      ? uniqueSessionIds.filter(sessionId => !pendingSessionDeletionIds.value.has(sessionId))
      : uniqueSessionIds
    if (targetSessionIds.length === 0) {
      return { deletedSessionIds: [], failures: [], warnings: [] }
    }

    try {
      if (!optimistic) {
        isLoading.value = true
      }
      error.value = null

      const projectId = currentProject.value?.id
      if (!projectId) {
        throw new Error('No project selected')
      }

      if (optimistic) {
        updatePendingSessionDeletions(targetSessionIds, true)
        if (targetSessionIds.includes(currentSession.value?.id)) {
          currentSession.value = null
        }
      }

      const sessionStore = useSessionStore()
      for (const sessionId of targetSessionIds) {
        try {
          await sessionStore.closeSession(sessionId)
        } catch (closeError) {
          logger.warn('Failed to close session before batch delete', {
            sessionId,
            error: closeError.message
          })
        }
      }

      const result = await window.electronAPI.deleteSessions({
        sessionIds: targetSessionIds,
        projectId
      })
      if (!result || !Array.isArray(result.deletedSessionIds)) {
        throw new Error(result?.error || '删除会话失败')
      }

      const deletedSessionIds = [...new Set(result.deletedSessionIds)]
      const failures = Array.isArray(result.failures) ? result.failures : []
      const warnings = Array.isArray(result.warnings) ? result.warnings : []

      if (deletedSessionIds.length > 0) {
        const deletedSessionIdSet = new Set(deletedSessionIds)
        sessions.value = sessions.value.filter(session => !deletedSessionIdSet.has(session.id))

        if (deletedSessionIdSet.has(currentSession.value?.id)) {
          currentSession.value = null
        }
      }

      if (optimistic) {
        updatePendingSessionDeletions(targetSessionIds, false)
      }

      if (failures.length > 0) {
        error.value = `有 ${failures.length} 个会话删除失败`
        logger.error('Failed to delete sessions', {
          failures,
          deletedCount: deletedSessionIds.length
        })
      }

      return { deletedSessionIds, failures, warnings }
    } catch (e) {
      if (optimistic) {
        updatePendingSessionDeletions(targetSessionIds, false)
      }
      error.value = e.message
      logger.error('Failed to delete sessions', { error: e.message })
      throw e
    } finally {
      if (!optimistic) {
        isLoading.value = false
      }
    }
  }

  async function deleteSession(sessionId, options = {}) {
    const result = await deleteSessions([sessionId], options)
    if (!result.deletedSessionIds.includes(sessionId)) {
      const failure = result.failures.find(item => item.sessionId === sessionId)
      throw new Error(failure?.error || '删除会话失败')
    }
  }

  /**
   * 软删除会话（移入回收站）
   */
  async function softDeleteSession(sessionId, options = {}) {
    const optimistic = options?.optimistic === true
    if (optimistic) {
      updatePendingSessionDeletions([sessionId], true)
      if (currentSession.value?.id === sessionId) {
        currentSession.value = null
      }
    }

    try {
      if (!optimistic) {
        isLoading.value = true
      }
      error.value = null

      // 关闭运行中的 session
      const sessionStore = useSessionStore()
      await sessionStore.closeSession(sessionId)

      const result = await window.electronAPI.softDeleteSession({
        sessionId,
        projectId: currentProject.value?.id
      })
      if (!result?.success) {
        throw new Error(result?.error || '软删除会话失败')
      }

      // 更新内存中的 session 数据
      const idx = sessions.value.findIndex(s => s.id === sessionId)
      if (idx !== -1) {
        sessions.value[idx] = { ...sessions.value[idx], deleted: true, deletedAt: result.session?.deletedAt }
      }

      if (currentSession.value?.id === sessionId) {
        currentSession.value = null
      }

      if (optimistic) {
        updatePendingSessionDeletions([sessionId], false)
      }
      return result
    } catch (e) {
      if (optimistic) {
        updatePendingSessionDeletions([sessionId], false)
      }
      error.value = e.message
      logger.error('Failed to soft delete session', { error: e.message })
      throw e
    } finally {
      if (!optimistic) {
        isLoading.value = false
      }
    }
  }

  /**
   * 还原被软删除的会话（从回收站恢复）
   */
  async function restoreSession(sessionId) {
    try {
      isLoading.value = true
      error.value = null

      const result = await window.electronAPI.restoreSession({
        sessionId,
        projectId: currentProject.value?.id
      })
      if (!result?.success) {
        throw new Error(result?.error || '还原会话失败')
      }

      // 更新内存中的 session 数据
      const idx = sessions.value.findIndex(s => s.id === sessionId)
      if (idx !== -1) {
        sessions.value[idx] = { ...sessions.value[idx], deleted: false, deletedAt: null }
      }
    } catch (e) {
      error.value = e.message
      logger.error('Failed to restore session', { error: e.message })
      throw e
    } finally {
      isLoading.value = false
    }
  }

  /**
   * 选择会话
   * 新架构：委托给 SessionStore 初始化会话实例
   */
  async function selectSession(session) {
    if (!currentProject.value) {
      throw new Error('No project selected')
    }

    try {
      isLoading.value = true
      error.value = null

      const availabilityResult = await window.electronAPI.getSessionAvailable({
        projectId: currentProject.value.id,
        sessionId: session.id
      })
      if (!availabilityResult?.success) {
        throw new Error(availabilityResult?.error || '获取会话可用性失败')
      }
      if (availabilityResult.available === false) {
        const initProvider = availabilityResult.initProviderLabel || availabilityResult.initProvider || '未知'
        const currentProvider = availabilityResult.currentProviderLabel || availabilityResult.currentProvider || '未知'
        throw new Error(`当前会话不可用：创建时供应商为 ${initProvider}，当前供应商为 ${currentProvider}`)
      }

      // 委托给 SessionStore 初始化会话
      const sessionStore = useSessionStore()
      await sessionStore.switchToSession(session.id, currentProject.value.path)

      try {
        await window.electronAPI?.markProjectActivitySessionSeen?.({
          projectId: currentProject.value.id,
          sessionId: session.id
        })
      } catch (activityError) {
        logger.warn('Failed to mark project activity session as seen', {
          error: activityError.message,
          sessionId: session.id
        })
      }

      // 仅在会话切换成功后更新当前会话和已查看状态，避免失败时丢失待查看目标。
      currentSession.value = session
      clearSessionUnseenCompleted(session.id)
      patchSessionStatus(session.id, { pendingPermission: false })

      return session
    } catch (e) {
      error.value = e.message
      logger.error('Failed to select session', { error: e.message })
      throw e
    } finally {
      isLoading.value = false
    }
  }

  async function renameProject(projectId, newName) {
    try {
      isLoading.value = true
      error.value = null
      await window.electronAPI.renameProject({ projectId, name: newName })
      const project = projects.value.find(p => p.id === projectId)
      if (project) {
        project.name = newName
      }
      if (currentProject.value?.id === projectId) {
        currentProject.value = { ...currentProject.value, name: newName }
      }
    } catch (e) {
      error.value = e.message
      logger.error('Failed to rename project', { error: e.message })
      throw e
    } finally {
      isLoading.value = false
    }
  }

  async function renameSession(sessionId, newName) {
    try {
      isLoading.value = true
      error.value = null
      const result = await window.electronAPI.renameSession({
        sessionId,
        projectId: currentProject.value?.id,
        name: newName
      })
      if (!result?.success) {
        throw new Error(result?.error || '重命名会话失败')
      }
      if (currentProject.value?.id) {
        await fetchSessions(currentProject.value.id)
      }
      if (currentSession.value?.id === sessionId) {
        const refreshedSession = sessions.value.find(s => s.id === sessionId)
        currentSession.value = refreshedSession
          ? { ...currentSession.value, ...refreshedSession, name: refreshedSession.name || newName }
          : { ...currentSession.value, name: newName }
      }
    } catch (e) {
      error.value = e.message
      logger.error('Failed to rename session', { error: e.message })
      throw e
    } finally {
      isLoading.value = false
    }
  }

  async function toggleSessionLock(sessionId) {
    try {
      isLoading.value = true
      error.value = null
      const result = await window.electronAPI.toggleSessionLock({
        sessionId,
        projectId: currentProject.value?.id
      })
      if (!result?.success) {
        throw new Error(result?.error || '切换会话锁定状态失败')
      }
      // 更新内存中的 session 数据
      const idx = sessions.value.findIndex(s => s.id === sessionId)
      if (idx !== -1) {
        sessions.value[idx] = { ...sessions.value[idx], locked: result.session?.locked }
      }
      if (currentSession.value?.id === sessionId) {
        currentSession.value = { ...currentSession.value, locked: result.session?.locked }
      }
    } catch (e) {
      error.value = e.message
      logger.error('Failed to toggle session lock', { error: e.message })
      throw e
    } finally {
      isLoading.value = false
    }
  }

  // UI state
  function toggleSidebar(type) {
    sidebarCollapsed.value[type] = !sidebarCollapsed.value[type]
  }

  function setSidebarCollapsed(type, collapsed) {
    sidebarCollapsed.value[type] = collapsed
  }

  // 打开/关闭项目时自动调整窗口大小
  watch(currentProject, (project) => {
    if (project) {
      window.electronAPI?.resizeWindow({ width: 1600, height: 1000, anchor: true }).catch(() => {})
    } else {
      window.electronAPI?.resizeWindow({ width: 1200, height: 800, anchor: true }).catch(() => {})
    }
  })

  return {
    // State
    projects,
    sessions,
    floatingMonitorMode,
    currentProject,
    currentSession,
    sessionStatuses,
    inboxUnreadCounts,
    currentInboxMessages,
    hasRunningTerminals,
    sidebarCollapsed,
    isLoading,
    error,
    showRecycleBin,

    // Computed
    currentProjectSessions,
    hasProcessingSessions,
    hasRunningSessions,
    hasActiveWork,

    // Actions
    fetchProjects,
    addProject,
    ensureCCAgentProject,
    removeProject,
    renameProject,
    selectProject,
    fetchSessions,
    fetchRunningSessions,
    fetchInboxSummary,
    fetchCurrentInboxMessages,
    ackCurrentInboxMessages,
    dissolveTeam,
    destroyTeam,
    isSessionResponding,
    setHasRunningTerminals,
    setFloatingMonitorMode,
    loadFloatingMonitorMode,
    bindFloatingMonitorModeListener,
    markSessionCompletedUnseen,
    clearSessionUnseenCompleted,
    createSession,
    deleteSession,
    deleteSessions,
    softDeleteSession,
    restoreSession,
    renameSession,
    toggleSessionLock,
    selectSession,
    toggleSidebar,
    setSidebarCollapsed
  }
})
