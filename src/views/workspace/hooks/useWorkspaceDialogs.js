import { ref } from 'vue'
import { logger } from '@/utils/logger'

export function useWorkspaceDialogs({
  store,
  sessionStore,
  sessionSidebarRef,
  chatRef
}) {
  const showNewSessionDialog = ref(false)
  const showConfirmDialog = ref(false)
  const showRenameDialog = ref(false)
  const showProjectSwitchDialog = ref(false)
  const showSwitchConfirmDialog = ref(false)
  const showProjectConfigDialog = ref(false)
  const showSessionConfigDialog = ref(false)
  const showSettingsDialog = ref(false)
  const selectedSessionForConfig = ref(null)
  const selectedProject = ref(null)
  const confirmDialogConfig = ref({
    title: '',
    message: '',
    onConfirm: () => {}
  })
  const renameDialogConfig = ref({
    title: '',
    initialName: '',
    type: '',
    item: null
  })

  function handleNewSession() {
    if (!store.currentProject) {
      alert('请先选择一个项目')
      return
    }
    showNewSessionDialog.value = true
  }

  async function handleDeleteSession(session) {
    confirmDialogConfig.value = {
      title: '删除会话',
      message: `确定要删除会话 "${session.name || session.id.slice(0, 8)}" 吗？\n此操作不可撤销。`,
      onConfirm: async () => {
        await store.deleteSession(session.id)
        showConfirmDialog.value = false
      }
    }
    showConfirmDialog.value = true
  }

  function handleRenameSession(session) {
    renameDialogConfig.value = {
      title: '重命名会话',
      initialName: session.name || '',
      type: 'session',
      item: session
    }
    showRenameDialog.value = true
  }

  async function handleRenameConfirm(newName) {
    const { type, item } = renameDialogConfig.value
    try {
      if (type === 'session') {
        await store.renameSession(item.id, newName)
      }
    } catch (error) {
      alert('重命名失败: ' + error.message)
    }
    showRenameDialog.value = false
  }

  async function performCloseSession(session) {
    try {
      await window.electronAPI.stopSessionRuntime({ sessionId: session.id })
      logger.info('[Workspace] Runtime process stopped for session:', session.id)
    } catch (error) {
      logger.error('[Workspace] Failed to close runtime process:', { error: error.message })
      alert('关闭运行时进程失败: ' + error.message)
    }
  }

  async function handleCloseSession(session) {
    const sessionState = sessionStore.sessions.get(session.id)
    if (sessionState?.isProcessing) {
      confirmDialogConfig.value = {
        title: '确认关闭',
        message: '会话正在处理中，关闭将中断当前操作。确定要关闭吗？',
        onConfirm: () => {
          performCloseSession(session)
          showConfirmDialog.value = false
        }
      }
      showConfirmDialog.value = true
      return
    }

    await performCloseSession(session)
  }

  async function handleStartSession(session) {
    try {
      await window.electronAPI.startSession({
        sessionId: session.id,
        projectPath: store.currentProject?.path
      })
      logger.info('[Workspace] Runtime process started for session:', session.id)
    } catch (error) {
      logger.error('[Workspace] Failed to start runtime process:', { error: error.message })
      alert('启动运行时进程失败: ' + error.message)
    }
  }

  function handleSwitchProject() {
    showProjectSwitchDialog.value = true
  }

  function handleGoHomeFromSidebar() {
    handleGoHomeFromDialog(store.hasProcessingSessions)
  }

  function handleOpenProjectConfig() {
    showProjectConfigDialog.value = true
  }

  function handleProjectConfigSaved() {
    showProjectConfigDialog.value = false
    sessionSidebarRef.value?.refreshConfig()
  }

  async function handleSettingsSaved() {
    await Promise.all([
      sessionSidebarRef.value?.refreshConfig?.(),
      chatRef.value?.refreshModelConfig?.()
    ])
  }

  function handleOpenSessionConfig(session) {
    selectedSessionForConfig.value = session
    showSessionConfigDialog.value = true
  }

  async function handleDeleteSessionConfig(session) {
    confirmDialogConfig.value = {
      title: '删除独立配置',
      message: `确定要删除会话 "${session.name || session.id.slice(0, 8)}" 的独立配置吗？\n删除后将使用项目配置。`,
      onConfirm: async () => {
        try {
          await window.electronAPI.deleteSessionConfig({
            projectId: store.currentProject?.id,
            sessionId: session.id
          })
          showConfirmDialog.value = false
          sessionSidebarRef.value?.refreshConfig()
        } catch (error) {
          alert('删除配置失败: ' + error.message)
        }
      }
    }
    showConfirmDialog.value = true
  }

  async function handleCopySession(session) {
    try {
      const result = await window.electronAPI.copySession({
        projectId: store.currentProject?.id,
        sessionId: session.id
      })
      if (result.success) {
        await store.fetchSessions(store.currentProject?.id)
      } else {
        alert('复制会话失败: ' + result.error)
      }
    } catch (error) {
      alert('复制会话失败: ' + error.message)
    }
  }

  function handleSessionConfigSaved() {
    showSessionConfigDialog.value = false
    sessionSidebarRef.value?.refreshConfig()
  }

  function handleProjectSelected(project) {
    if (project.id === store.currentProject?.id) {
      showProjectSwitchDialog.value = false
      return
    }

    selectedProject.value = project
    showProjectSwitchDialog.value = false
    showSwitchConfirmDialog.value = true
  }

  async function handleReplaceProject() {
    try {
      for (const session of store.sessions) {
        await sessionStore.closeSession(session.id)
      }

      store.selectProject(selectedProject.value)
      showSwitchConfirmDialog.value = false
      selectedProject.value = null
    } catch (error) {
      logger.error('Failed to switch project', { error: error.message })
      alert('切换项目失败: ' + error.message)
    }
  }

  async function handleNewWindow() {
    try {
      await window.electronAPI.openProjectInNewWindow({
        projectId: selectedProject.value.id
      })

      showSwitchConfirmDialog.value = false
      selectedProject.value = null
    } catch (error) {
      logger.error('Failed to open new window', { error: error.message })
      alert('打开新窗口失败: ' + error.message)
    }
  }

  async function performGoHome() {
    try {
      for (const session of store.sessions) {
        await sessionStore.closeSession(session.id)
      }

      store.currentProject = null
      store.currentSession = null
      showProjectSwitchDialog.value = false
      logger.info('[Workspace] Returned to home page')
    } catch (error) {
      logger.error('[Workspace] Failed to go home', { error: error.message })
      alert('返回首页失败: ' + error.message)
    }
  }

  async function handleGoHomeFromDialog(hasRunningSessions) {
    if (hasRunningSessions) {
      confirmDialogConfig.value = {
        title: '返回首页',
        message: '当前有正在运行的会话，返回首页将中断这些操作。确定要返回吗？',
        onConfirm: async () => {
          await performGoHome()
          showConfirmDialog.value = false
        }
      }
      showConfirmDialog.value = true
      return
    }

    await performGoHome()
  }

  async function handleSelectSession(sessionId) {
    const session = store.currentProjectSessions.find(item => item.id === sessionId)
    if (!session) return

    try {
      await store.selectSession(session)
    } catch (error) {
      logger.error('Failed to select session', { error: error.message, sessionId })
      alert('打开会话失败: ' + error.message)
    }
  }

  return {
    showNewSessionDialog,
    showConfirmDialog,
    showRenameDialog,
    showProjectSwitchDialog,
    showSwitchConfirmDialog,
    showProjectConfigDialog,
    showSessionConfigDialog,
    showSettingsDialog,
    selectedSessionForConfig,
    selectedProject,
    confirmDialogConfig,
    renameDialogConfig,
    handleNewSession,
    handleDeleteSession,
    handleRenameSession,
    handleRenameConfirm,
    handleCloseSession,
    handleStartSession,
    handleSwitchProject,
    handleGoHomeFromSidebar,
    handleOpenProjectConfig,
    handleProjectConfigSaved,
    handleSettingsSaved,
    handleOpenSessionConfig,
    handleDeleteSessionConfig,
    handleCopySession,
    handleSessionConfigSaved,
    handleProjectSelected,
    handleReplaceProject,
    handleNewWindow,
    handleGoHomeFromDialog,
    handleSelectSession
  }
}
