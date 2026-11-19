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
    confirmText: '确认',
    secondaryText: '',
    danger: false,
    onConfirm: () => {},
    onSecondary: () => {}
  })
  const renameDialogConfig = ref({
    title: '',
    initialName: '',
    type: '',
    item: null
  })

  function runSessionDeletionInBackground(task, operationLabel) {
    void Promise.resolve(task)
      .then(result => {
        const failures = Array.isArray(result?.failures) ? result.failures : []
        const warnings = Array.isArray(result?.warnings) ? result.warnings : []
        if (failures.length > 0) {
          const deletedCount = Array.isArray(result?.deletedSessionIds)
            ? result.deletedSessionIds.length
            : 0
          alert(`${operationLabel}失败：已删除 ${deletedCount} 个会话，另有 ${failures.length} 个删除失败。`)
          return
        }
        if (warnings.length > 0) {
          alert(`${operationLabel}已完成，但有 ${warnings.length} 个会话的供应商原生数据未清理干净。`)
        }
      })
      .catch(error => {
        logger.error(`${operationLabel}失败`, { error: error.message })
        alert(`${operationLabel}失败：${error.message || '未知错误'}`)
      })
  }

  function handleNewSession() {
    if (!store.currentProject) {
      alert('请先选择一个项目')
      return
    }
    showNewSessionDialog.value = true
  }

  async function handleNewSessionCreated(session) {
    showNewSessionDialog.value = false
    if (!session?.id) {
      return
    }

    try {
      await store.selectSession(session)
    } catch (error) {
      logger.error('新会话已创建但打开失败', {
        error: error.message,
        sessionId: session.id
      })
      alert(`新会话已创建，但打开失败: ${error.message || '未知错误'}`)
    }
  }

  function handleDeleteSession(session) {
    if (session?.role === 'leader' && session?.teamId) {
      confirmDialogConfig.value = {
        title: '删除 leader 会话',
        message: `会话 "${session.name || session.id.slice(0, 8)}" 是当前 team 的 leader。\n删除 leader 前，请选择如何处理 team。`,
        confirmText: '解散 team',
        secondaryText: '销毁 team',
        danger: true,
        onConfirm: () => {
          showConfirmDialog.value = false
          const projectId = store.currentProject?.id
          void store.softDeleteSession(session.id, { optimistic: true })
            .then(() => store.dissolveTeam(projectId, session.teamId))
            .catch(error => {
              logger.error('处理 leader 会话失败', { error: error.message })
              alert(`处理 leader 会话失败：${error.message || '未知错误'}`)
            })
        },
        onSecondary: () => {
          showConfirmDialog.value = false
          runSessionDeletionInBackground(
            store.destroyTeam(
              store.currentProject.id,
              session.teamId,
              { optimistic: true }
            ),
            '销毁 team'
          )
        }
      }
      showConfirmDialog.value = true
      return
    }

    confirmDialogConfig.value = {
      title: '删除会话',
      message: `确定要删除会话 "${session.name || session.id.slice(0, 8)}" 吗？\n会话将移入回收站，可随时还原。`,
      confirmText: '删除',
      secondaryText: '',
      danger: true,
      onConfirm: () => {
        showConfirmDialog.value = false
        runSessionDeletionInBackground(
          store.softDeleteSession(session.id, { optimistic: true }),
          '删除会话'
        )
      },
      onSecondary: () => {}
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
      confirmText: '永久删除',
      secondaryText: '',
      danger: true,
      onConfirm: () => {
        showConfirmDialog.value = false
        runSessionDeletionInBackground(
          store.deleteSessions([session.id], { optimistic: true }),
          '永久删除会话'
        )
      },
      onSecondary: () => {}
    }
    showConfirmDialog.value = true
  }

  function handleEmptyRecycleBin() {
    if (!store.showRecycleBin) return

    const sessions = [...store.currentProjectSessions]
    if (sessions.length === 0) return

    confirmDialogConfig.value = {
      title: '清空回收站',
      message: `确定要永久删除当前项目回收站中的全部 ${sessions.length} 个会话吗？\n此操作不可撤销，会话数据将被彻底清除。`,
      confirmText: '清空回收站',
      secondaryText: '',
      danger: true,
      onConfirm: () => {
        showConfirmDialog.value = false
        runSessionDeletionInBackground(
          store.deleteSessions(sessions.map(session => session.id), { optimistic: true }),
          '清空回收站'
        )
      },
      onSecondary: () => {}
    }
    showConfirmDialog.value = true
  }

  function handleDeleteSelectedSessions(sessionIds = []) {
    if (!store.showRecycleBin) return

    const targetIds = new Set(sessionIds)
    const sessions = store.currentProjectSessions.filter(session => targetIds.has(session.id))
    if (sessions.length === 0) return

    confirmDialogConfig.value = {
      title: '删除选中的会话',
      message: `确定要永久删除选中的 ${sessions.length} 个会话吗？\n此操作不可撤销，会话数据将被彻底清除。`,
      confirmText: '永久删除',
      secondaryText: '',
      danger: true,
      onConfirm: () => {
        showConfirmDialog.value = false
        runSessionDeletionInBackground(
          store.deleteSessions(sessions.map(session => session.id), { optimistic: true }),
          '删除选中的会话'
        )
      },
      onSecondary: () => {}
    }
    showConfirmDialog.value = true
  }

  async function handleDissolveTeam(teamId) {
    confirmDialogConfig.value = {
      title: '解散 team',
      message: '确定要解散这个 team 吗？\n所有成员 Session 将保留，但会清空 team 和 role。',
      confirmText: '解散',
      secondaryText: '',
      onConfirm: async () => {
        await store.dissolveTeam(store.currentProject.id, teamId)
        showConfirmDialog.value = false
      },
      onSecondary: () => {}
    }
    showConfirmDialog.value = true
  }

  function handleDestroyTeam(teamId) {
    confirmDialogConfig.value = {
      title: '销毁 team',
      message: '确定要销毁这个 team 吗？\n所有成员 Session 将被移入回收站。',
      confirmText: '销毁',
      secondaryText: '',
      danger: true,
      onConfirm: () => {
        showConfirmDialog.value = false
        runSessionDeletionInBackground(
          store.destroyTeam(
            store.currentProject.id,
            teamId,
            { optimistic: true }
          ),
          '销毁 team'
        )
      },
      onSecondary: () => {}
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
        const initProvider = availabilityResult.initProviderLabel || availabilityResult.initProvider || '未知'
        const currentProvider = availabilityResult.currentProviderLabel || availabilityResult.currentProvider || '未知'
        throw new Error(`当前会话不可用：创建时供应商为 ${initProvider}，当前供应商为 ${currentProvider}`)
      }

      await window.electronAPI.startSession({
        sessionId: session.id,
        projectPath: store.currentProject?.path,
        deferMcpStartupNotifications: session?.deferMcpStartupNotifications === true
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
      confirmText: '删除',
      danger: true,
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
    runSessionDeletionInBackground,
    handleNewSession,
    handleNewSessionCreated,
    handleDeleteSession,
    handleDissolveTeam,
    handleDestroyTeam,
    handleRestoreSession,
    handlePermanentDeleteSession,
    handleEmptyRecycleBin,
    handleDeleteSelectedSessions,
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
