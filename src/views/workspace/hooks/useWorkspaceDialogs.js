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
      message: `确定要删除会话 "${session.name || session.id.slice(0, 8)}" 吗？\n会话将移入回收站，可随时还原。`,
      onConfirm: async () => {
        await store.softDeleteSession(session.id)
        showConfirmDialog.value = false
      }
    }
    showConfirmDialog.value = true
  }

  async function handleRestoreSession(session) {
    await store.restoreSession(session.id)
  }

  async function handlePermanentDeleteSession(session) {
    confirmDialogConfig.value = {
      title: '永久删除会话',
      message: `确定要永久删除会话 "${session.name || session.id.slice(0, 8)}" 吗？\n此操作不可撤销，会话数据将被彻底清除。`,
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
    const t0 = performance.now()
    logger.info('[Workspace] performCloseSession START', { sessionId: session.id, t0 })
    try {
      await window.electronAPI.stopSessionRuntime({ sessionId: session.id })
      const elapsed = (performance.now() - t0).toFixed(1)
      logger.info(`[Workspace] performCloseSession END (${elapsed}ms)`, { sessionId: session.id })
    } catch (error) {
      const elapsed = (performance.now() - t0).toFixed(1)
      logger.error(`[Workspace] performCloseSession ERROR (${elapsed}ms)`, { sessionId: session.id, error: error.message })
      alert('关闭运行时进程失败: ' + error.message)
    }
  }

  async function handleCloseSession(session) {
    const sessionState = sessionStore.sessions.get(session.id)
    const isProcessing = sessionState?.isProcessing
    logger.info('[Workspace] handleCloseSession', { sessionId: session.id, isProcessing: !!isProcessing })

    if (isProcessing) {
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
      const availabilityResult = await window.electronAPI.getSessionAvailable({
        projectId: store.currentProject?.id,
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

  async function handleGoHomeFromSidebar() {
    // 先刷新 session 状态，确保检测的是最新数据
    await store.fetchRunningSessions()
    const hasActiveWork = store.hasRunningSessions || store.hasRunningTerminals
    handleGoHomeFromDialog(hasActiveWork)
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

  async function handleGoHomeFromDialog(hasActiveWork) {
    // 如果传入的参数没包含最新状态，先刷新
    if (!hasActiveWork) {
      await store.fetchRunningSessions()
      hasActiveWork = store.hasRunningSessions || store.hasRunningTerminals
    }
    if (hasActiveWork) {
      confirmDialogConfig.value = {
        title: '返回首页',
        message: '当前有正在运行的会话或终端任务，返回首页将中断这些操作。确定要返回吗？',
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
    handleRestoreSession,
    handlePermanentDeleteSession,
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
