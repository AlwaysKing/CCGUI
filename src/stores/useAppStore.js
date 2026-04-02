import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useSessionStore } from './useSessionStore'
import { logger } from '../utils/logger'

// Local storage keys
const STORAGE_KEYS = {
  SIDEBAR_STATE: 'ccgui_sidebar_state',
  LAST_PROJECT: 'ccgui_last_project',
  LAST_SESSION: 'ccgui_last_session'
}

let hasBoundSessionCompletionListener = false
let hasBoundSessionStatusListener = false

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
  const currentProject = ref(null)
  const currentSession = ref(null) // 会话元信息（从文件系统扫描）
  const sessionStatuses = ref({}) // session 状态对象：{ ready, processing, streaming, unseenCompleted }
  const sidebarCollapsed = ref(loadFromStorage(STORAGE_KEYS.SIDEBAR_STATE, {
    project: false,
    session: false
  }))
  const isLoading = ref(false)
  const error = ref(null)

  // Watch sidebar state and persist
  watch(sidebarCollapsed, (newValue) => {
    saveToStorage(STORAGE_KEYS.SIDEBAR_STATE, newValue)
  }, { deep: true })

  watch(() => currentSession.value?.id, (sessionId) => {
    if (sessionId) {
      clearSessionUnseenCompleted(sessionId)
    }
  })

  // Computed
  const currentProjectSessions = computed(() => {
    if (!currentProject.value) return []

    // 基础数据：从文件系统扫描的session列表
    const baseSessions = sessions.value.filter(s => s.projectId === currentProject.value.id)

    // 合并运行时的实时数据
    return baseSessions.map(session => {
      const runtimeStatus = sessionStatuses.value[session.id]
      if (runtimeStatus) {
        // 如果session正在运行，使用内存中的实时数据
        return {
          ...session,
          messageCount: runtimeStatus.messageCount ?? session.messageCount,
          updatedAt: runtimeStatus.updatedAt ?? session.updatedAt,
          status: runtimeStatus.processing || runtimeStatus.streaming ? 'processing' : 'ready'
        }
      }
      // 否则使用文件扫描的静态数据
      return session
    })
  })

  // 检查当前项目是否有正在处理的 session
  const hasProcessingSessions = computed(() => {
    if (!currentProject.value) return false
    return currentProjectSessions.value.some(session => {
      const status = sessionStatuses.value[session.id]
      return status?.processing || status?.streaming
    })
  })

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
      unseenCompleted: false,
      messageCount: 0,
      updatedAt: new Date().toISOString()
    }
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
          updatedAt: new Date().toISOString()
        })
        break

      case 'message':
        bumpSessionActivity(sessionId, {
          incrementMessageCount: true,
          updatedAt: data?.timestamp || new Date().toISOString()
        })
        break

      case 'message-start':
        bumpSessionActivity(sessionId, {
          incrementMessageCount: true,
          updatedAt: data?.timestamp || new Date().toISOString(),
          updates: {
            processing: true,
            streaming: true
          }
        })
        break

      case 'message-complete':
      case 'result':
      case 'interrupt':
        patchSessionStatus(sessionId, {
          streaming: false,
          processing: eventType === 'interrupt' ? false : ensureSessionStatus(sessionId)?.processing || false,
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
            updatedAt: new Date().toISOString()
          })
          break
        }

        if (data?.type === 'session-runtime-ready') {
          patchSessionStatus(sessionId, {
            ready: true,
            streaming: false,
            updatedAt: new Date().toISOString()
          })
          break
        }

        break

      case 'normal-exit':
      case 'abnormal-exit':
        patchSessionStatus(sessionId, {
          ready: false,
          processing: false,
          streaming: false,
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
      projects.value = result
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
          unseenCompleted: Boolean(
            previousStatus?.unseenCompleted &&
            status?.ready &&
            !status?.processing &&
            !status?.streaming
          )
        }
      })

      sessionStatuses.value = nextStatuses
    } catch (e) {
      logger.error('Failed to fetch running sessions', { error: e.message })
    }
  }

  function markSessionCompletedUnseen(sessionId) {
    if (!sessionId) {
      return
    }

    if (currentSession.value?.id === sessionId) {
      clearSessionUnseenCompleted(sessionId)
      return
    }

    const currentStatus = sessionStatuses.value[sessionId]
    if (!currentStatus?.ready) {
      return
    }

    sessionStatuses.value = {
      ...sessionStatuses.value,
      [sessionId]: {
        ...currentStatus,
        unseenCompleted: true
      }
    }
  }

  function clearSessionUnseenCompleted(sessionId) {
    if (!sessionId || !sessionStatuses.value[sessionId]?.unseenCompleted) {
      return
    }

    sessionStatuses.value = {
      ...sessionStatuses.value,
      [sessionId]: {
        ...sessionStatuses.value[sessionId],
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

  async function deleteSession(sessionId) {
    try {
      isLoading.value = true
      error.value = null

      // 关闭 SessionStore 中的会话
      const sessionStore = useSessionStore()
      await sessionStore.closeSession(sessionId)

      // 删除文件系统中的会话
      const result = await window.electronAPI.deleteSession({ sessionId, projectId: currentProject.value?.id })
      if (!result?.success) {
        throw new Error(result?.error || '删除会话失败')
      }

      sessions.value = sessions.value.filter(s => s.id !== sessionId)

      if (currentSession.value?.id === sessionId) {
        currentSession.value = null
      }
    } catch (e) {
      error.value = e.message
      logger.error('Failed to delete session', { error: e.message })
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
        const initProvider = availabilityResult.initProvider || '未知'
        const currentProvider = availabilityResult.currentProvider || '未知'
        throw new Error(`当前会话不可用：创建时供应商为 ${initProvider}，当前供应商为 ${currentProvider}`)
      }

      clearSessionUnseenCompleted(session.id)

      // 更新当前会话元信息
      currentSession.value = session

      // 委托给 SessionStore 初始化会话
      const sessionStore = useSessionStore()
      await sessionStore.switchToSession(session.id, currentProject.value.path)

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
      window.electronAPI?.resizeWindow({ width: 1600, height: 1000, center: true }).catch(() => {})
    } else {
      window.electronAPI?.resizeWindow({ width: 1200, height: 800, center: true }).catch(() => {})
    }
  })

  return {
    // State
    projects,
    sessions,
    currentProject,
    currentSession,
    sessionStatuses,
    sidebarCollapsed,
    isLoading,
    error,

    // Computed
    currentProjectSessions,
    hasProcessingSessions,

    // Actions
    fetchProjects,
    addProject,
    removeProject,
    renameProject,
    selectProject,
    fetchSessions,
    fetchRunningSessions,
    markSessionCompletedUnseen,
    clearSessionUnseenCompleted,
    createSession,
    deleteSession,
    renameSession,
    selectSession,
    toggleSidebar,
    setSidebarCollapsed
  }
})
