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
  const sessionStatuses = ref({}) // session 状态对象：{ ready, processing, streaming }
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

  // 检查是否有正在处理的 session
  const hasProcessingSessions = computed(() => {
    return Object.values(sessionStatuses.value).some(s => s.processing || s.streaming)
  })

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

  async function addProject(projectPath) {
    try {
      isLoading.value = true
      error.value = null
      const newProject = await window.electronAPI.addProject({ projectPath })
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
    fetchSessions(project.id)
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
      sessionStatuses.value = statuses
    } catch (e) {
      logger.error('Failed to fetch running sessions', { error: e.message })
    }
  }

  async function createSession(projectId, name) {
    try {
      isLoading.value = true
      error.value = null
      const newSession = await window.electronAPI.createSession({ projectId, name })
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
      await window.electronAPI.deleteSession({ sessionId, projectId: currentProject.value?.id })
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
      await window.electronAPI.renameSession({ sessionId, name: newName })
      const session = sessions.value.find(s => s.id === sessionId)
      if (session) {
        session.name = newName
      }
      if (currentSession.value?.id === sessionId) {
        currentSession.value = { ...currentSession.value, name: newName }
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
    createSession,
    deleteSession,
    renameSession,
    selectSession,
    toggleSidebar,
    setSidebarCollapsed
  }
})
