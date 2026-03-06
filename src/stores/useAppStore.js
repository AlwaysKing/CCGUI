import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { useSessionStore } from './useSessionStore'

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
  const runningSessions = ref(new Set()) // 正在运行的 session IDs
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
    return sessions.value.filter(s => s.projectId === currentProject.value.id)
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
      console.error('Failed to fetch projects:', e)
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
      console.error('Failed to add project:', e)
      throw e
    } finally {
      isLoading.value = false
    }
  }

  async function removeProject(projectId) {
    try {
      isLoading.value = true
      error.value = null
      await window.electronAPI.removeProject({ projectId })
      projects.value = projects.value.filter(p => p.id !== projectId)
      if (currentProject.value?.id === projectId) {
        currentProject.value = null
        sessions.value = []
        currentSession.value = null
      }
    } catch (e) {
      error.value = e.message
      console.error('Failed to remove project:', e)
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
      console.error('Failed to fetch sessions:', e)
    } finally {
      isLoading.value = false
    }
  }

  async function fetchRunningSessions() {
    try {
      const runningIds = await window.electronAPI.getRunningSessions()
      runningSessions.value = new Set(runningIds)
    } catch (e) {
      console.error('Failed to fetch running sessions:', e)
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
      console.error('Failed to create session:', e)
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
      console.error('Failed to delete session:', e)
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
      console.error('Failed to select session:', e)
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
      console.error('Failed to rename project:', e)
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
      console.error('Failed to rename session:', e)
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
    runningSessions,
    sidebarCollapsed,
    isLoading,
    error,

    // Computed
    currentProjectSessions,

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
