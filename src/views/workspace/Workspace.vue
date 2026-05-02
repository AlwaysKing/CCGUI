<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAppStore } from '../../stores/useAppStore'
import { useSessionStore } from '../../stores/useSessionStore'
import { useFileBrowserStore } from '../../stores/useFileBrowserStore'
import SessionSidebar from './components/SessionSidebar.vue'
import FilePreviewPanel from './components/FilePreviewPanel.vue'
import TerminalPanel from './components/TerminalPanel.vue'
import TaskWorkspace from './components/TaskWorkspace.vue'
import TaskLauncherConfigDialog from './components/TaskLauncherConfigDialog.vue'
import Chat from './chat/Chat.vue'
import NewSessionDialog from './components/NewSessionDialog.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import RenameDialog from './components/RenameDialog.vue'
import ProjectSwitchDialog from './components/ProjectSwitchDialog.vue'
import SwitchConfirmDialog from './components/SwitchConfirmDialog.vue'
import ProjectConfigDialog from './components/ProjectConfigDialog.vue'
import SessionConfigDialog from './components/SessionConfigDialog.vue'
import SettingsDialog from '@/views/settings/SettingsDialog.vue'
import SkillsDialog from '@/views/tools/SkillsDialog.vue'
import McpDialog from '@/views/tools/McpDialog.vue'
import ProviderDialog from '@/views/tools/ProviderDialog.vue'
import PromptDialog from '@/views/tools/PromptDialog.vue'
import TaskTemplatesDialog from '@/views/tools/TaskTemplatesDialog.vue'
import { useWorkspaceLayout } from './hooks/useWorkspaceLayout'
import { useWorkspaceDialogs } from './hooks/useWorkspaceDialogs'
import { useProjectWorkspacePersistence } from './hooks/useProjectWorkspacePersistence'
import { createSimpleTaskDefinition, parseSupportedTasksJson, parseTasksDocument, serializeTasksDocument } from '@/utils/vscodeTasks'

const SESSION_FILTER_STORAGE_KEY = 'ccgui_session_list_filters'

const store = useAppStore()
const sessionStore = useSessionStore()
const fileBrowserStore = useFileBrowserStore()
const previewWidth = ref(42)
const isPreviewResizing = ref(false)
const isChatCollapsed = ref(false)
const lastExpandedPreviewWidth = ref(42)
const terminalPanelRef = ref(null)
const terminalPanelVisible = ref(false)
const terminalPanelHeight = ref(220)
const isTerminalResizing = ref(false)
const terminalRunningState = ref({ hasRunning: false, count: 0 })
const showClaudeSessions = ref(true)
const showCodexSessions = ref(true)
const showSkillsDialog = ref(false)
const showMcpDialog = ref(false)
const showClaudeDialog = ref(false)
const showCodexDialog = ref(false)
const showPromptDialog = ref(false)
const showTaskTemplatesDialog = ref(false)
const showTaskLauncherConfigDialog = ref(false)
const taskTemplatesInitialSection = ref('routine')
const primaryView = ref('chat')
const taskLauncherTasks = ref([])
const taskLauncherConfigDocument = ref({ version: '2.0.0', tasks: [] })
const taskLauncherUnsupportedTasks = ref([])
const taskLauncherConfigSaving = ref(false)
const runningTaskLabels = ref([])
const taskDockItems = ref([])
const CHAT_MIN_WIDTH = 360
const CHAT_COLLAPSE_THRESHOLD = CHAT_MIN_WIDTH / 3
const CHAT_EXPAND_THRESHOLD = (CHAT_MIN_WIDTH * 2) / 3
const COLLAPSED_SIDEBAR_SAFE_WIDTH = 200
const TERMINAL_MIN_HEIGHT = 140
const TERMINAL_MAX_HEIGHT = 420
const MAX_TASK_DOCK_ITEMS = 3
const {
  sessionSidebarRef,
  chatRef,
  sidebarWidth,
  sidebarCollapsed,
  toggleSidebar,
  startResize,
  handleResize,
  stopResize
} = useWorkspaceLayout()

const {
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
  handleProjectConfigSaved: handleProjectConfigSavedBase,
  handleSettingsSaved: handleWorkspaceSettingsSaved,
  handleOpenSessionConfig,
  handleDeleteSessionConfig,
  handleCopySession,
  handleSessionConfigSaved,
  handleProjectSelected,
  handleReplaceProject,
  handleNewWindow,
  handleGoHomeFromDialog,
  handleSelectSession
} = useWorkspaceDialogs({
  store,
  sessionStore,
  sessionSidebarRef,
  chatRef
})

async function handleSettingsSaved() {
  await handleWorkspaceSettingsSaved()
  await terminalPanelRef.value?.refreshAppearance?.()
}

async function handleProjectConfigSaved() {
  await handleProjectConfigSavedBase()
  await refreshProjectSettingsCache()
}

async function handlePreviewFile(node) {
  await fileBrowserStore.previewFile(node.path)
}

async function handlePinFile(node) {
  await fileBrowserStore.pinFile(node.path)
}

function handleSelectPrimaryView(nextView) {
  primaryView.value = nextView === 'tasks' ? 'tasks' : 'chat'
}

function openTaskTemplatesDialog(section = 'routine') {
  taskTemplatesInitialSection.value = section === 'run' ? 'run' : 'routine'
  showTaskTemplatesDialog.value = true
}

async function handleSelectSessionWithView(session) {
  primaryView.value = 'chat'
  await handleSelectSession(session)
}

const {
  refreshProjectSettingsCache,
  handleSidebarLayoutChange
} = useProjectWorkspacePersistence({
  store,
  fileBrowserStore,
  sessionSidebarRef,
  sidebarWidth,
  sidebarCollapsed,
  previewWidth,
  isChatCollapsed,
  lastExpandedPreviewWidth,
  terminalPanelVisible,
  terminalPanelHeight,
  terminalMinHeight: TERMINAL_MIN_HEIGHT,
  terminalMaxHeight: TERMINAL_MAX_HEIGHT
})

async function handleCreateFileNode(payload) {
  await fileBrowserStore.createEntry(payload?.parentPath || '', payload?.type || 'file')
}

async function handleRenameFileNode(payload) {
  await fileBrowserStore.renameEntry(payload?.path || '', payload?.name || '')
}

async function handleDeleteFileNode(targetPath) {
  await fileBrowserStore.deleteEntry(targetPath)
}

function handleAddFileToChat(filePath) {
  if (!filePath) return
  chatRef.value?.appendTextToInput?.(filePath)
}

async function toggleTerminalPanel() {
  terminalPanelVisible.value = !terminalPanelVisible.value
  if (terminalPanelVisible.value) {
    await nextTick()
    terminalPanelRef.value?.fitActiveTerminal?.()
  }
}

async function loadTaskLauncherTasks(projectPath = store.currentProject?.path || '') {
  if (!projectPath) {
    taskLauncherTasks.value = []
    taskLauncherUnsupportedTasks.value = []
    taskLauncherConfigDocument.value = { version: '2.0.0', tasks: [] }
    taskDockItems.value = []
    return
  }

  const result = await window.electronAPI.readProjectFile({
    projectPath,
    filePath: '.vscode/tasks.json'
  })

  if (!result?.success) {
    taskLauncherTasks.value = []
    taskLauncherUnsupportedTasks.value = []
    taskLauncherConfigDocument.value = { version: '2.0.0', tasks: [] }
    taskDockItems.value = []
    return
  }

  try {
    const content = result.file?.content || ''
    taskLauncherTasks.value = parseSupportedTasksJson(content, projectPath)

    const document = parseTasksDocument(content)
    const allTasks = Array.isArray(document.tasks) ? document.tasks : []
    taskLauncherConfigDocument.value = document

    taskLauncherUnsupportedTasks.value = allTasks.filter(task => {
      const type = String(task?.type || 'shell')
      if (!['shell', 'process'].includes(type)) return true
      if (!String(task?.label || '').trim() || !String(task?.command || '').trim()) return true
      return Boolean(task?.options?.env) || Boolean(task?.dependsOn)
    })
  } catch (error) {
    console.error('[Workspace] Failed to parse .vscode/tasks.json:', error)
    taskLauncherTasks.value = []
    taskLauncherUnsupportedTasks.value = []
    taskLauncherConfigDocument.value = { version: '2.0.0', tasks: [] }
    taskDockItems.value = []
  }
}

function normalizeTaskDockTask(task) {
  const label = String(task?.label || '').trim()
  if (!label) {
    return null
  }

  return {
    id: String(task?.id || label),
    label,
    command: String(task?.command || '').trim(),
    commandLine: String(task?.commandLine || '').trim(),
    cwd: String(task?.cwd || '').trim(),
    detail: String(task?.detail || '').trim()
  }
}

function sortTaskDockItems(items) {
  return [...items].sort((left, right) => {
    if (left.running !== right.running) {
      return left.running ? -1 : 1
    }

    return Number(right.lastUsedAt || 0) - Number(left.lastUsedAt || 0)
  })
}

function trimTaskDockItems(items) {
  return sortTaskDockItems(items).slice(0, MAX_TASK_DOCK_ITEMS)
}

function upsertTaskDockItem(task, overrides = {}) {
  const normalizedTask = normalizeTaskDockTask(task)
  if (!normalizedTask) {
    return
  }

  const existingIndex = taskDockItems.value.findIndex(item => item.label === normalizedTask.label)
  const existingItem = existingIndex >= 0 ? taskDockItems.value[existingIndex] : null
  const nextItem = {
    ...existingItem,
    ...normalizedTask,
    ...overrides,
    running: overrides.running ?? existingItem?.running ?? false,
    lastUsedAt: overrides.lastUsedAt ?? existingItem?.lastUsedAt ?? Date.now()
  }

  const nextItems = existingIndex >= 0
    ? taskDockItems.value.map((item, index) => (index === existingIndex ? nextItem : item))
    : [...taskDockItems.value, nextItem]

  taskDockItems.value = trimTaskDockItems(nextItems)
}

function syncTaskDockItems() {
  const tasksByLabel = new Map(
    taskLauncherTasks.value
      .map(task => normalizeTaskDockTask(task))
      .filter(Boolean)
      .map(task => [task.label, task])
  )
  const runningLabels = new Set(
    runningTaskLabels.value
      .map(label => String(label || '').trim())
      .filter(Boolean)
  )
  const syncedItems = []

  for (const item of taskDockItems.value) {
    const latestTask = tasksByLabel.get(item.label)
    if (!latestTask) {
      continue
    }

    syncedItems.push({
      ...item,
      ...latestTask,
      running: runningLabels.has(item.label)
    })
  }

  for (const label of runningLabels) {
    if (syncedItems.some(item => item.label === label)) {
      continue
    }

    const task = tasksByLabel.get(label)
    if (!task) {
      continue
    }

    syncedItems.push({
      ...task,
      running: true,
      lastUsedAt: Date.now()
    })
  }

  taskDockItems.value = trimTaskDockItems(syncedItems)
}

async function handleRunTaskLauncher(task) {
  if (!task?.commandLine) {
    return
  }

  upsertTaskDockItem(task, {
    running: true,
    lastUsedAt: Date.now()
  })

  try {
    await terminalPanelRef.value?.runTaskTerminal?.(task)
  } catch (error) {
    syncTaskDockItems()
    console.error('[Workspace] Failed to run launcher task:', error)
  }
}

async function handleRunTaskDockItem(task) {
  await handleRunTaskLauncher(task)
}

async function handleStopTaskDockItem(task) {
  if (!task?.label) {
    return
  }

  try {
    await terminalPanelRef.value?.stopTaskTerminal?.(task)
  } catch (error) {
    console.error('[Workspace] Failed to stop dock task:', error)
  }
}

async function handleOpenTaskLauncherConfig() {
  const projectPath = store.currentProject?.path || ''
  if (!projectPath) {
    return
  }

  try {
    const ensureVsCodeDirResult = await window.electronAPI.createProjectEntry({
      projectPath,
      parentPath: '',
      entryType: 'directory',
      name: '.vscode'
    })

    if (!ensureVsCodeDirResult?.success && !String(ensureVsCodeDirResult?.error || '').includes('已存在')) {
      throw new Error(ensureVsCodeDirResult?.error || '创建 .vscode 目录失败')
    }

    const taskConfigPath = '.vscode/tasks.json'
    const readResult = await window.electronAPI.readProjectFile({ projectPath, filePath: taskConfigPath })

    if (!readResult?.success) {
      const defaultTaskConfig = `{
  "version": "2.0.0",
  "tasks": []
}
`

      const writeResult = await window.electronAPI.writeProjectFile({
        projectPath,
        filePath: taskConfigPath,
        content: defaultTaskConfig
      })

      if (!writeResult?.success) {
        throw new Error(writeResult?.error || '写入 tasks.json 失败')
      }
    }

    await loadTaskLauncherTasks(projectPath)
    await fileBrowserStore.refreshTree()
    showTaskLauncherConfigDialog.value = true
  } catch (error) {
    console.error('[Workspace] Failed to open task launcher config:', error)
  }
}

async function handleSaveTaskLauncherConfig(task) {
  const projectPath = store.currentProject?.path || ''
  if (!projectPath) {
    return
  }

  taskLauncherConfigSaving.value = true
  try {
    const nextDocument = {
      ...taskLauncherConfigDocument.value,
      version: taskLauncherConfigDocument.value?.version || '2.0.0',
      tasks: [
        ...((Array.isArray(taskLauncherConfigDocument.value?.tasks) ? taskLauncherConfigDocument.value.tasks : [])
          .filter(existingTask => !taskLauncherUnsupportedTasks.value.includes(existingTask))),
        createSimpleTaskDefinition(task),
        ...taskLauncherUnsupportedTasks.value
      ]
    }

    const result = await window.electronAPI.writeProjectFile({
      projectPath,
      filePath: '.vscode/tasks.json',
      content: serializeTasksDocument(nextDocument)
    })

    if (!result?.success) {
      throw new Error(result?.error || '保存 tasks.json 失败')
    }

    await loadTaskLauncherTasks(projectPath)
    await fileBrowserStore.refreshTree()
    showTaskLauncherConfigDialog.value = false
  } catch (error) {
    console.error('[Workspace] Failed to save task launcher config:', error)
  } finally {
    taskLauncherConfigSaving.value = false
  }
}

async function handleOpenTaskLauncherFile() {
  const projectPath = store.currentProject?.path || ''
  if (!projectPath) {
    return
  }

  try {
    await handleOpenTaskLauncherConfig()
    showTaskLauncherConfigDialog.value = false
    await fileBrowserStore.previewFile('.vscode/tasks.json')
  } catch (error) {
    console.error('[Workspace] Failed to open raw task launcher file:', error)
  }
}

async function handleToggleTaskLauncher(task) {
  const taskLabel = String(task?.label || '').trim()
  if (!taskLabel) {
    return
  }

  if (runningTaskLabels.value.includes(taskLabel)) {
    try {
      await terminalPanelRef.value?.stopTaskTerminal?.(task)
    } catch (error) {
      console.error('[Workspace] Failed to stop launcher task:', error)
    }
    return
  }

  await handleRunTaskLauncher(task)
}

async function handleDeleteTaskLauncher(task) {
  const projectPath = store.currentProject?.path || ''
  if (!projectPath) {
    return
  }

  confirmDialogConfig.value = {
    title: '删除快捷命令',
    message: `确定要删除快捷命令“${String(task?.label || '').trim() || '未命名任务'}”吗？`,
    onConfirm: async () => {
      try {
        if (runningTaskLabels.value.includes(String(task?.label || '').trim())) {
          await terminalPanelRef.value?.stopTaskTerminal?.(task)
        }

        const currentTasks = Array.isArray(taskLauncherConfigDocument.value?.tasks)
          ? taskLauncherConfigDocument.value.tasks
          : []

        const nextTasks = currentTasks.filter(existingTask => {
          const isSameSimpleTask =
            ['shell', 'process'].includes(String(existingTask?.type || 'shell')) &&
            String(existingTask?.label || '').trim() === String(task?.label || '').trim() &&
            String(existingTask?.command || '').trim() === String(task?.command || '').trim()

          return !isSameSimpleTask
        })

        const result = await window.electronAPI.writeProjectFile({
          projectPath,
          filePath: '.vscode/tasks.json',
          content: serializeTasksDocument({
            ...taskLauncherConfigDocument.value,
            version: taskLauncherConfigDocument.value?.version || '2.0.0',
            tasks: nextTasks
          })
        })

        if (!result?.success) {
          throw new Error(result?.error || '删除 tasks.json 任务失败')
        }

        await loadTaskLauncherTasks(projectPath)
        await fileBrowserStore.refreshTree()
        showConfirmDialog.value = false
      } catch (error) {
        console.error('[Workspace] Failed to delete launcher task:', error)
      }
    }
  }
  showConfirmDialog.value = true
}

function handleTerminalRunningChange(nextState) {
  terminalRunningState.value = {
    hasRunning: Boolean(nextState?.hasRunning),
    count: Number(nextState?.count || 0)
  }
  runningTaskLabels.value = Array.isArray(nextState?.taskLabels) ? nextState.taskLabels : []
}

const shouldShowChatPanel = computed(() => {
  return !fileBrowserStore.shouldShowPreviewPanel || !isChatCollapsed.value
})

const previewPanelStyle = computed(() => {
  if (!fileBrowserStore.shouldShowPreviewPanel) {
    return undefined
  }

  if (isChatCollapsed.value) {
    return {
      width: '100%',
      maxWidth: '100%',
      minWidth: '0',
      flex: '1 1 auto'
    }
  }

  return {
    width: `${previewWidth.value}%`
  }
})

const chatPanelHostStyle = computed(() => {
  if (!store.currentSession) {
    return undefined
  }

    if (!shouldShowChatPanel.value) {
      return {
        width: '0px',
        minWidth: '0px',
        flex: '0 0 0px',
      overflow: 'hidden',
      border: 'none'
    }
  }

  return undefined
})

function syncExpandedPreviewWidth() {
  if (!isChatCollapsed.value) {
    lastExpandedPreviewWidth.value = previewWidth.value
  }
}

function collapseChatPanel() {
  if (!fileBrowserStore.shouldShowPreviewPanel || isChatCollapsed.value) return
  lastExpandedPreviewWidth.value = previewWidth.value
  isChatCollapsed.value = true
}

function expandChatPanel(restorePreviousWidth = true) {
  if (!fileBrowserStore.shouldShowPreviewPanel) return
  isChatCollapsed.value = false
  if (restorePreviousWidth) {
    previewWidth.value = Math.max(24, Math.min(65, lastExpandedPreviewWidth.value))
  }
}

function toggleChatPanelCollapse() {
  if (!fileBrowserStore.shouldShowPreviewPanel) return

  if (isChatCollapsed.value) {
    expandChatPanel(true)
    return
  }

  collapseChatPanel()
}

function startPreviewResize(event) {
  isPreviewResizing.value = true
  event.preventDefault()
}

function handlePreviewResize(event) {
  if (!isPreviewResizing.value) return

  const mainContent = document.querySelector('.main-content')
  if (!mainContent) return

  const mainRect = mainContent.getBoundingClientRect()
  const previewWidthPx = event.clientX - mainRect.left
  const chatWidthPx = mainRect.right - event.clientX

  if (isChatCollapsed.value) {
    if (chatWidthPx >= CHAT_EXPAND_THRESHOLD) {
      isChatCollapsed.value = false
      previewWidth.value = ((mainRect.width - CHAT_MIN_WIDTH) / mainRect.width) * 100
      syncExpandedPreviewWidth()
    }
    return
  }

  if (chatWidthPx <= CHAT_COLLAPSE_THRESHOLD) {
    collapseChatPanel()
    return
  }

  const nextPercent = (previewWidthPx / mainRect.width) * 100
  previewWidth.value = Math.max(24, Math.min(65, nextPercent))
  syncExpandedPreviewWidth()
}

function stopPreviewResize() {
  isPreviewResizing.value = false
}

function startTerminalResize(event) {
  isTerminalResizing.value = true
  event.preventDefault()
}

function handleTerminalResize(event) {
  if (!isTerminalResizing.value) return

  const mainStack = document.querySelector('.main-stack')
  if (!mainStack) return

  const stackRect = mainStack.getBoundingClientRect()
  const nextHeight = stackRect.bottom - event.clientY
  terminalPanelHeight.value = Math.max(TERMINAL_MIN_HEIGHT, Math.min(TERMINAL_MAX_HEIGHT, nextHeight))
  terminalPanelRef.value?.fitActiveTerminal?.()
}

function stopTerminalResize() {
  isTerminalResizing.value = false
}

function loadSessionFilterState() {
  try {
    const saved = JSON.parse(localStorage.getItem(SESSION_FILTER_STORAGE_KEY) || '{}')
    showClaudeSessions.value = saved.showClaudeSessions !== false
    showCodexSessions.value = saved.showCodexSessions !== false
  } catch {
    showClaudeSessions.value = true
    showCodexSessions.value = true
  }
}

function saveSessionFilterState() {
  try {
    localStorage.setItem(SESSION_FILTER_STORAGE_KEY, JSON.stringify({
      showClaudeSessions: showClaudeSessions.value,
      showCodexSessions: showCodexSessions.value
    }))
  } catch {
    // Ignore storage errors.
  }
}

watch(() => fileBrowserStore.shouldShowPreviewPanel, (visible) => {
  if (!visible) {
    isChatCollapsed.value = false
  } else {
    previewWidth.value = Math.max(24, Math.min(65, previewWidth.value))
    syncExpandedPreviewWidth()
  }
})

watch(() => store.currentSession?.id, (nextSessionId, previousSessionId) => {
  if (!nextSessionId || nextSessionId === previousSessionId) {
    return
  }

  primaryView.value = 'chat'

  // 从 session 恢复 task-dock 历史
  const session = sessionStore.currentSession
  if (session?.taskDockHistory?.length && taskLauncherTasks.value.length) {
    const tasksByLabel = new Map(
      taskLauncherTasks.value
        .map(t => normalizeTaskDockTask(t))
        .filter(Boolean)
        .map(t => [t.label, t])
    )
    const restored = session.taskDockHistory
      .filter(h => tasksByLabel.has(h.label))
      .map(h => {
        const task = tasksByLabel.get(h.label)
        return {
          ...task,
          running: false,
          lastUsedAt: h.lastUsedAt || Date.now()
        }
      })
    taskDockItems.value = trimTaskDockItems(restored)
  } else if (!session?.taskDockHistory?.length) {
    taskDockItems.value = []
  }

  if (fileBrowserStore.shouldShowPreviewPanel && isChatCollapsed.value) {
    expandChatPanel(true)
  }
})

watch(() => store.currentProject?.path, nextProjectPath => {
  void loadTaskLauncherTasks(nextProjectPath || '')
}, { immediate: true })

watch([taskLauncherTasks, runningTaskLabels], () => {
  syncTaskDockItems()
}, { deep: true })

// taskDockItems 变化时保存到 session（debounce 1s）
let taskDockSaveTimer = null
watch(taskDockItems, (items) => {
  if (!items.length) return
  const session = sessionStore.currentSession
  if (!session) return

  clearTimeout(taskDockSaveTimer)
  taskDockSaveTimer = setTimeout(async () => {
    try {
      await window.electronAPI.saveTaskDockHistory({
        sessionId: session.id,
        items: items.map(item => ({
          label: item.label,
          commandLine: item.commandLine,
          lastUsedAt: item.lastUsedAt
        }))
      })
    } catch (e) {
      console.error('[Workspace] Failed to save task-dock history:', e)
    }
  }, 1000)
}, { deep: true })

// Initialize
onMounted(async () => {
  loadSessionFilterState()

  // Render the workspace first, then hydrate project data in the background.
  if (store.currentProject) {
    requestAnimationFrame(() => {
      if (store.currentProject?.id) {
        void store.fetchSessions(store.currentProject.id)
      }
    })
  }

  // Add global event listeners
  window.addEventListener('mousemove', handleResize)
  window.addEventListener('mouseup', stopResize)
  window.addEventListener('mousemove', handlePreviewResize)
  window.addEventListener('mouseup', stopPreviewResize)
  window.addEventListener('mousemove', handleTerminalResize)
  window.addEventListener('mouseup', stopTerminalResize)
  window.addEventListener('ccgui-shortcut', handleShortcutEvent)

})

onUnmounted(() => {
  window.removeEventListener('mousemove', handleResize)
  window.removeEventListener('mouseup', stopResize)
  window.removeEventListener('mousemove', handlePreviewResize)
  window.removeEventListener('mouseup', stopPreviewResize)
  window.removeEventListener('mousemove', handleTerminalResize)
  window.removeEventListener('mouseup', stopTerminalResize)
  window.removeEventListener('ccgui-shortcut', handleShortcutEvent)
  clearTimeout(taskDockSaveTimer)
})

function handleShortcutEvent(event) {
  const action = event?.detail?.action

  if (action === 'open-settings') {
    showSettingsDialog.value = true
    return
  }

  if (action === 'create-primary') {
    handleNewSession()
    return
  }

  if (action === 'toggle-sidebar') {
    toggleSidebar()
    return
  }

  if (action === 'toggle-terminal') {
    toggleTerminalPanel()
    return
  }

  if (action === 'toggle-preview') {
    fileBrowserStore.togglePreviewPanel()
    return
  }

  if (action === 'toggle-file-panel') {
    fileBrowserStore.toggleFilePanel()
    return
  }

  if (action === 'toggle-chat-panel') {
    toggleChatPanelCollapse()
  }
}

const filteredProjectSessions = computed(() => {
  const sessions = store.currentProjectSessions
  if (showClaudeSessions.value && showCodexSessions.value) {
    return sessions
  }
  return sessions.filter(session => {
    const tool = session?.settings?.tool || session?.settings?.provider || 'claude'
    const isCodex = tool === 'codex'
    if (isCodex) return showCodexSessions.value
    return showClaudeSessions.value
  })
})

function handleToggleShowClaude() {
  showClaudeSessions.value = !showClaudeSessions.value
}

function handleToggleShowCodex() {
  showCodexSessions.value = !showCodexSessions.value
}

watch([showClaudeSessions, showCodexSessions], () => {
  saveSessionFilterState()
}, { immediate: true })

async function handleDeleteInactiveSessions() {
  const inactiveSessions = store.currentProjectSessions.filter(session => {
    const status = store.sessionStatuses[session.id]
    return !status || !status.ready
  })
  if (inactiveSessions.length === 0) return

  confirmDialogConfig.value = {
    title: '删除未激活会话',
    message: `确定要删除 ${inactiveSessions.length} 个未激活的会话吗？\n此操作不可撤销。`,
    onConfirm: async () => {
      for (const session of inactiveSessions) {
        try {
          await store.deleteSession(session.id)
        } catch (e) {
          console.error('Failed to delete inactive session:', session.id, e)
        }
      }
      showConfirmDialog.value = false
    }
  }
  showConfirmDialog.value = true
}
</script>

<template>
  <div class="workspace-layout">
    <div class="workspace-body">
      <!-- Session Sidebar -->
      <SessionSidebar
        ref="sessionSidebarRef"
        v-show="!sidebarCollapsed"
        :style="{ width: `${sidebarWidth}px` }"
        :primary-view="primaryView"
        :sessions="filteredProjectSessions"
        :current-session="store.currentSession"
        :session-statuses="store.sessionStatuses"
        :project-path="store.currentProject?.path"
        :show-claude-filter="showClaudeSessions"
        :show-codex-filter="showCodexSessions"
        :file-tree="fileBrowserStore.tree"
        :file-tree-loading="fileBrowserStore.isTreeLoading"
        :file-tree-error="fileBrowserStore.treeError"
        :expanded-dirs="fileBrowserStore.expandedDirs"
        :active-file-path="fileBrowserStore.activeFilePath"
        :selected-node-path="fileBrowserStore.selectedNodePath"
        :editing-node-path="fileBrowserStore.editingNodePath"
        :is-file-panel-visible="fileBrowserStore.isFilePanelVisible"
        :has-open-files="fileBrowserStore.hasOpenFiles"
        :preview-panel-visible="fileBrowserStore.shouldShowPreviewPanel"
        :terminal-panel-visible="terminalPanelVisible"
        :terminal-running-count="terminalRunningState.count"
        :task-launcher-tasks="taskLauncherTasks"
        :running-task-labels="runningTaskLabels"
        @select="handleSelectSessionWithView"
        @delete="handleDeleteSession"
        @start="handleStartSession"
        @close="handleCloseSession"
        @newSession="handleNewSession"
        @toggle="toggleSidebar"
        @rename="handleRenameSession"
        @switchProject="handleSwitchProject"
        @home="handleGoHomeFromSidebar"
        @openAppSettings="showSettingsDialog = true"
        @openSkillsDialog="showSkillsDialog = true"
        @openMcpDialog="showMcpDialog = true"
        @openClaudeDialog="showClaudeDialog = true"
        @openCodexDialog="showCodexDialog = true"
        @openPromptDialog="showPromptDialog = true"
        @openTaskTemplatesDialog="openTaskTemplatesDialog"
        @openProjectConfig="handleOpenProjectConfig"
        @openSessionConfig="handleOpenSessionConfig"
        @deleteSessionConfig="handleDeleteSessionConfig"
        @copySession="handleCopySession"
        @toggleFilePanel="fileBrowserStore.toggleFilePanel"
        @togglePreviewPanel="fileBrowserStore.togglePreviewPanel"
        @runTaskLauncher="handleRunTaskLauncher"
        @toggleTaskLauncher="handleToggleTaskLauncher"
        @deleteTaskLauncher="handleDeleteTaskLauncher"
        @openTaskLauncherConfig="handleOpenTaskLauncherConfig"
        @openTaskLauncherFile="handleOpenTaskLauncherFile"
        @refreshTaskLauncherTasks="() => loadTaskLauncherTasks(store.currentProject?.path || '')"
        @refreshFileTree="fileBrowserStore.refreshTree"
        @toggleDirectory="fileBrowserStore.toggleDirectory"
        @previewFile="handlePreviewFile"
        @pinFile="handlePinFile"
        @selectFileNode="fileBrowserStore.setSelectedNode"
        @startRenameFileNode="fileBrowserStore.startRenaming"
        @stopRenameFileNode="fileBrowserStore.stopRenaming"
        @renameFileNode="handleRenameFileNode"
        @createFileNode="handleCreateFileNode"
        @deleteFileNode="handleDeleteFileNode"
        @addFileToChat="handleAddFileToChat"
        @toggleTerminalPanel="toggleTerminalPanel"
        @layoutChange="handleSidebarLayoutChange"
        @toggleShowClaude="handleToggleShowClaude"
        @toggleShowCodex="handleToggleShowCodex"
        @deleteInactiveSessions="handleDeleteInactiveSessions"
        @selectPrimaryView="handleSelectPrimaryView"
      />

      <!-- Resize Handle -->
      <div
        v-show="!sidebarCollapsed"
        class="resize-handle"
        @mousedown="startResize"
      />

      <!-- Main Content -->
      <main class="main-stack">
        <div class="main-content">
          <FilePreviewPanel
            :visible="fileBrowserStore.shouldShowPreviewPanel"
            :style="previewPanelStyle"
            :project-path="store.currentProject?.path || ''"
            :tabs="fileBrowserStore.tabs"
            :active-tab="fileBrowserStore.activeTab"
            :active-git-status="fileBrowserStore.activeFileGitStatus"
            :is-chat-collapsed="isChatCollapsed"
            :show-sidebar-toggle="sidebarCollapsed"
            @activate-tab="fileBrowserStore.setActiveTab"
            @close-tab="fileBrowserStore.closeTab"
            @close-others="fileBrowserStore.closeOtherTabs"
            @update-content="fileBrowserStore.updateTabContent"
            @save-file="fileBrowserStore.saveFile"
            @close-panel="fileBrowserStore.hidePreviewPanel"
            @toggle-sidebar="toggleSidebar"
            @toggle-diff="fileBrowserStore.toggleTabDiff"
            @toggle-chat-panel="toggleChatPanelCollapse"
          />

          <div
            v-if="fileBrowserStore.shouldShowPreviewPanel && shouldShowChatPanel"
            class="preview-resize-handle"
            :class="{ resizing: isPreviewResizing }"
            @mousedown="startPreviewResize"
          ></div>

          <div
            v-if="store.currentSession || primaryView === 'tasks'"
            class="chat-panel-host"
            :class="{ collapsed: !shouldShowChatPanel }"
            :style="chatPanelHostStyle"
          >
            <TaskWorkspace
              v-if="primaryView === 'tasks'"
              class="chat-panel"
              :project-id="store.currentProject?.id || ''"
              :project-path="store.currentProject?.path || ''"
              :show-sidebar-toggle="sidebarCollapsed && !fileBrowserStore.shouldShowPreviewPanel"
              @openTaskTemplatesDialog="openTaskTemplatesDialog"
              @toggleSidebar="toggleSidebar"
            />
            <Chat
              v-else
              class="chat-panel"
              ref="chatRef"
              :sidebar-collapsed="sidebarCollapsed"
              :sidebar-width="sidebarWidth"
              :show-collapse-toggle="fileBrowserStore.shouldShowPreviewPanel"
              :is-collapsed-by-preview="isChatCollapsed"
              :show-sidebar-toggle="sidebarCollapsed && !fileBrowserStore.shouldShowPreviewPanel"
              :task-dock-items="taskDockItems"
              @toggleSidebar="toggleSidebar"
              @toggleCollapse="toggleChatPanelCollapse"
              @startSession="handleStartSession"
              @closeSession="handleCloseSession"
              @runTaskDockItem="handleRunTaskDockItem"
              @stopTaskDockItem="handleStopTaskDockItem"
            />
          </div>
          <div v-if="!store.currentSession && primaryView !== 'tasks'" class="empty-state-wrapper">
            <div class="empty-top-bar" :class="{ 'with-sidebar-toggle': sidebarCollapsed }">
              <div v-if="sidebarCollapsed" class="sidebar-safe-spacer">
                <span v-if="store.currentProject?.path" class="sidebar-project-name" :title="store.currentProject.path">{{ store.currentProject.path.split('/').pop() }}</span>
                <button class="sidebar-safe-btn" @click="toggleSidebar" title="展开侧边栏">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M10 6l6 6-6 6"/>
                    <path d="M4 5v14"/>
                  </svg>
                </button>
              </div>
              <div class="empty-top-drag-fill"></div>
            </div>

            <div class="empty-state">
              <div class="empty-icon">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <p>选择或创建一个会话开始聊天</p>
              <button class="start-btn" @click="handleNewSession">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
                新建会话
              </button>
            </div>
          </div>
        </div>

        <div
          v-show="terminalPanelVisible"
          class="terminal-resize-handle"
          :class="{ resizing: isTerminalResizing }"
          @mousedown="startTerminalResize"
        ></div>

        <div
          v-show="terminalPanelVisible"
          class="terminal-panel-host"
          :style="{ height: `${terminalPanelHeight}px` }"
        >
          <TerminalPanel
            ref="terminalPanelRef"
            :visible="terminalPanelVisible"
            :project-path="store.currentProject?.path || ''"
            @running-change="handleTerminalRunningChange"
            @hide="toggleTerminalPanel"
          />
        </div>
      </main>
    </div>

    <!-- Dialogs -->
    <NewSessionDialog
      v-if="showNewSessionDialog"
      :project-id="store.currentProject?.id"
      @close="showNewSessionDialog = false"
      @created="showNewSessionDialog = false"
    />

    <ConfirmDialog
      v-if="showConfirmDialog"
      :title="confirmDialogConfig.title"
      :message="confirmDialogConfig.message"
      @confirm="confirmDialogConfig.onConfirm"
      @cancel="showConfirmDialog = false"
    />

    <RenameDialog
      v-if="showRenameDialog"
      :title="renameDialogConfig.title"
      :initial-name="renameDialogConfig.initialName"
      @close="showRenameDialog = false"
      @confirm="handleRenameConfirm"
    />

    <ProjectSwitchDialog
      v-if="showProjectSwitchDialog"
      :currentProjectId="store.currentProject?.id"
      @close="showProjectSwitchDialog = false"
      @select="handleProjectSelected"
      @goHome="handleGoHomeFromDialog"
    />

    <SwitchConfirmDialog
      v-if="showSwitchConfirmDialog"
      :projectName="selectedProject?.name"
      :hasRunningSessions="store.hasProcessingSessions"
      @close="showSwitchConfirmDialog = false"
      @replace="handleReplaceProject"
      @newWindow="handleNewWindow"
    />

    <ProjectConfigDialog
      v-if="showProjectConfigDialog"
      :visible="showProjectConfigDialog"
      :project-id="store.currentProject?.id"
      @close="showProjectConfigDialog = false"
      @saved="handleProjectConfigSaved"
    />

    <SessionConfigDialog
      v-if="showSessionConfigDialog"
      :visible="showSessionConfigDialog"
      :project-id="store.currentProject?.id"
      :session-id="selectedSessionForConfig?.id"
      @close="showSessionConfigDialog = false"
      @saved="handleSessionConfigSaved"
    />

    <SettingsDialog
      v-if="showSettingsDialog"
      @saved="handleSettingsSaved"
      @close="showSettingsDialog = false"
    />

    <SkillsDialog
      v-if="showSkillsDialog"
      :project-path="store.currentProject?.path || ''"
      @close="showSkillsDialog = false"
    />

    <McpDialog
      v-if="showMcpDialog"
      :project-path="store.currentProject?.path || ''"
      @close="showMcpDialog = false"
    />

    <ProviderDialog
      v-if="showClaudeDialog"
      provider="claude"
      :project-path="store.currentProject?.path || ''"
      @saved="handleSettingsSaved"
      @close="showClaudeDialog = false"
    />

    <ProviderDialog
      v-if="showCodexDialog"
      provider="codex"
      :project-path="store.currentProject?.path || ''"
      @saved="handleSettingsSaved"
      @close="showCodexDialog = false"
    />

    <PromptDialog
      v-if="showPromptDialog"
      @saved="handleSettingsSaved"
      @close="showPromptDialog = false"
    />

    <TaskTemplatesDialog
      v-if="showTaskTemplatesDialog"
      :project-id="store.currentProject?.id || ''"
      :project-path="store.currentProject?.path || ''"
      :initial-section="taskTemplatesInitialSection"
      @close="showTaskTemplatesDialog = false"
    />

    <TaskLauncherConfigDialog
      v-model="showTaskLauncherConfigDialog"
      :saving="taskLauncherConfigSaving"
      @save="handleSaveTaskLauncherConfig"
    />
  </div>
</template>

<style scoped>
.workspace-layout {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #1E1E1E;
  color: #E4E4E7;
  position: relative;
}

.workspace-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}

.resize-handle {
  width: 4px;
  margin-left: -2px;
  margin-right: -2px;
  background: transparent;
  cursor: col-resize;
  transition: background 0.2s;
  position: relative;
  z-index: 2;
}

.resize-handle:hover {
  background: #F97316;
}

.main-stack {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
  background:
    radial-gradient(circle at top right, rgba(249, 115, 22, 0.045) 0%, transparent 24%),
    radial-gradient(circle at top left, rgba(255, 255, 255, 0.022) 0%, transparent 20%),
    linear-gradient(180deg, #14161a 0%, #17191e 100%);
}

.main-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: row;
  min-width: 0;
  min-height: 0;
  background: transparent;
}

.chat-panel {
  flex: 1;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 0;
}

.chat-panel-host {
  flex: 1;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  min-height: 0;
  display: flex;
  overflow: hidden;
  background: transparent;
}

.chat-panel-host.collapsed {
  pointer-events: none;
}

.preview-resize-handle {
  width: 4px;
  margin-left: -2px;
  margin-right: -2px;
  background: transparent;
  cursor: col-resize;
  transition: background 0.2s;
  flex-shrink: 0;
  position: relative;
  z-index: 2;
}

.preview-resize-handle:hover,
.preview-resize-handle.resizing {
  background: #F97316;
}

.terminal-resize-handle {
  height: 4px;
  margin-top: -2px;
  margin-bottom: -2px;
  background: transparent;
  cursor: row-resize;
  transition: background 0.2s;
  flex-shrink: 0;
  position: relative;
  z-index: 2;
}

.terminal-resize-handle:hover,
.terminal-resize-handle.resizing {
  background: #F97316;
}

.terminal-panel-host {
  flex: 0 0 auto;
  min-height: 0;
  overflow: hidden;
  border-top: 1px solid #27272A;
  background: transparent;
}

.empty-state-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.empty-top-bar {
  height: 41.5px;
  background: transparent;
  flex-shrink: 0;
  display: flex;
  align-items: stretch;
  -webkit-app-region: drag;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
}

.empty-top-bar.with-sidebar-toggle {
  justify-content: flex-start;
}

.empty-top-drag-fill {
  flex: 1;
  min-width: 0;
  background: transparent;
}

.sidebar-safe-spacer {
  flex: 0 0 200px;
  height: 41.5px;
  display: flex;
  align-items: stretch;
  background: transparent;
  -webkit-app-region: drag;
}

.sidebar-project-name {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  padding: 0 4px 0 76px;
  font-size: 18px;
  font-weight: 600;
  color: rgba(228, 228, 231, 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  -webkit-app-region: drag;
}

.sidebar-safe-btn {
  flex-shrink: 0;
  width: 44px;
  height: 41.5px;
  padding: 0;
  border: none;
  border-left: 1px solid rgba(255, 255, 255, 0.05);
  background: transparent;
  color: #E4E4E7;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s;
  -webkit-app-region: no-drag;
}

.sidebar-safe-btn:hover {
  background: rgba(255, 255, 255, 0.05);
}

.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #6B7280;
  gap: 16px;
}

.empty-icon {
  color: #3F3F46;
}

.empty-state p {
  font-size: 16px;
  margin: 0;
}

.start-btn {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  background: #F97316;
  border: none;
  border-radius: 8px;
  color: white;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.start-btn:hover {
  background: #EA580C;
}

/* App shell gradient trial */
.workspace-layout {
  background:
    radial-gradient(circle at top right, rgba(249, 115, 22, 0.05), transparent 22%),
    radial-gradient(circle at top left, rgba(255, 255, 255, 0.03), transparent 18%),
    linear-gradient(180deg, #121316 0%, #17191D 100%);
}

.terminal-panel-host {
  border-top-color: rgba(255, 255, 255, 0.06);
  background: linear-gradient(180deg, rgba(18, 19, 22, 0.96), rgba(14, 15, 18, 0.98));
}

.empty-top-bar,
.sidebar-safe-spacer,
.sidebar-safe-btn {
  background: #15171B;
}

.empty-state {
  background:
    radial-gradient(circle at top, rgba(249, 115, 22, 0.05), transparent 22%),
    transparent;
}
</style>
