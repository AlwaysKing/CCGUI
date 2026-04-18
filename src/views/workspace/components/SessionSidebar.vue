<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { IconButton } from '@/components/base'
import { useAppStore } from '../../../stores/useAppStore'
import { findProviderModel } from '../../../utils/provider-models'
import FileTreePanel from './FileTreePanel.vue'

const props = defineProps({
  primaryView: {
    type: String,
    default: 'chat'
  },
  sessions: {
    type: Array,
    default: () => []
  },
  currentSession: {
    type: Object,
    default: null
  },
  sessionStatuses: {
    type: Object,
    default: () => ({})
  },
  projectPath: {
    type: String,
    default: ''
  },
  fileTree: {
    type: Array,
    default: () => []
  },
  fileTreeLoading: {
    type: Boolean,
    default: false
  },
  fileTreeError: {
    type: String,
    default: ''
  },
  expandedDirs: {
    type: Object,
    default: () => new Set()
  },
  activeFilePath: {
    type: String,
    default: ''
  },
  selectedNodePath: {
    type: String,
    default: ''
  },
  editingNodePath: {
    type: String,
    default: ''
  },
  isFilePanelVisible: {
    type: Boolean,
    default: true
  },
  hasOpenFiles: {
    type: Boolean,
    default: false
  },
  previewPanelVisible: {
    type: Boolean,
    default: false
  },
  terminalPanelVisible: {
    type: Boolean,
    default: false
  },
  terminalRunningCount: {
    type: Number,
    default: 0
  },
  taskLauncherTasks: {
    type: Array,
    default: () => []
  },
  runningTaskLabels: {
    type: Array,
    default: () => []
  },
  showClaudeFilter: {
    type: Boolean,
    default: true
  },
  showCodexFilter: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['select', 'delete', 'newSession', 'toggle', 'rename', 'switchProject', 'home', 'openAppSettings', 'close', 'start', 'openProjectConfig', 'openSessionConfig', 'deleteSessionConfig', 'copySession', 'toggleFilePanel', 'togglePreviewPanel', 'toggleTerminalPanel', 'runTaskLauncher', 'toggleTaskLauncher', 'deleteTaskLauncher', 'openTaskLauncherConfig', 'openTaskLauncherFile', 'refreshTaskLauncherTasks', 'refreshFileTree', 'toggleDirectory', 'previewFile', 'pinFile', 'selectFileNode', 'startRenameFileNode', 'stopRenameFileNode', 'renameFileNode', 'createFileNode', 'deleteFileNode', 'addFileToChat', 'layoutChange', 'toggleShowClaude', 'toggleShowCodex', 'deleteInactiveSessions', 'openSkillsDialog', 'openMcpDialog', 'openClaudeDialog', 'openCodexDialog', 'openPromptDialog', 'openTaskTemplatesDialog', 'selectPrimaryView'])

const appStore = useAppStore()
const projectConfig = ref(null)
const systemConfig = ref(null)
const loadingConfig = ref(false)
const showConfigPanel = ref(false)
const sessionConfigs = ref({}) // Map of sessionId -> hasCustomConfig
const compactCountLabels = ref(new Set()) // Sessions with compact count labels
const showSessionListMenu = ref(false)
const sessionListMenuRef = ref(null)
const sessionListDropdownRef = ref(null)

const showConfigMenu = ref(false)
const configMenuBtnRef = ref(null)
const configMenuRef = ref(null)
const configMenuDropdownStyle = ref({})
const fileLauncherRef = ref(null)
const fileLauncherTriggerRef = ref(null)
const fileLauncherMenuRef = ref(null)
const fileLauncherMenuStyle = ref({})
const showFileLauncherMenu = ref(false)
const taskLauncherRef = ref(null)
const taskLauncherTriggerRef = ref(null)
const taskLauncherMenuRef = ref(null)
const taskLauncherMenuStyle = ref({})
const showTaskLauncherMenu = ref(false)

function toggleConfigMenu() {
  showConfigMenu.value = !showConfigMenu.value
  if (showConfigMenu.value) {
    updateConfigMenuPosition()
  }
}

function closeConfigMenu() {
  showConfigMenu.value = false
}

function toggleFileLauncherMenu() {
  showFileLauncherMenu.value = !showFileLauncherMenu.value
  if (showFileLauncherMenu.value) {
    updateFileLauncherMenuPosition()
  }
}

function closeFileLauncherMenu() {
  showFileLauncherMenu.value = false
}

function toggleTaskLauncherMenu() {
  showTaskLauncherMenu.value = !showTaskLauncherMenu.value
  if (showTaskLauncherMenu.value) {
    updateTaskLauncherMenuPosition()
  }
}

function closeTaskLauncherMenu() {
  showTaskLauncherMenu.value = false
}

function handleRunTaskLauncher(task) {
  if (!task) return
  emit('runTaskLauncher', task)
  closeTaskLauncherMenu()
}

function handleToggleTaskLauncher(task) {
  if (!task) return
  emit('toggleTaskLauncher', task)
}

function handleDeleteTaskLauncher(task) {
  if (!task) return
  emit('deleteTaskLauncher', task)
}

function isTaskRunning(task) {
  const taskLabel = String(task?.label || '').trim()
  return Boolean(taskLabel && props.runningTaskLabels.includes(taskLabel))
}

function handleOpenTaskLauncherConfig() {
  emit('openTaskLauncherConfig')
  closeTaskLauncherMenu()
}

function handleOpenTaskLauncherFile() {
  emit('openTaskLauncherFile')
  closeTaskLauncherMenu()
}

function handleRefreshTaskLauncherTasks() {
  emit('refreshTaskLauncherTasks')
}

function handleOpenProjectDirectory() {
  void openProjectInFinder()
  closeFileLauncherMenu()
}

function updateConfigMenuPosition() {
  nextTick(() => {
    const btn = configMenuBtnRef.value
    if (!btn) {
      configMenuDropdownStyle.value = {}
      return
    }
    const rect = btn.getBoundingClientRect()
    const vw = window.innerWidth
    const menuWidth = 180
    configMenuDropdownStyle.value = {
      position: 'fixed',
      right: `${vw - rect.right}px`,
      top: `${rect.bottom + 4}px`,
      minWidth: `${menuWidth}px`,
      zIndex: 1000
    }
  })
}

function updateTaskLauncherMenuPosition() {
  nextTick(() => {
    const trigger = taskLauncherTriggerRef.value
    if (!trigger) {
      taskLauncherMenuStyle.value = {}
      return
    }

    const rect = trigger.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const estimatedMenuWidth = 320
    const left = Math.min(rect.left - 8, viewportWidth - estimatedMenuWidth - 12)

    taskLauncherMenuStyle.value = {
      position: 'fixed',
      left: `${Math.max(12, left)}px`,
      top: `${rect.bottom + 6}px`,
      minWidth: '260px',
      maxWidth: '320px',
      zIndex: 1400
    }
  })
}

function updateFileLauncherMenuPosition() {
  nextTick(() => {
    const trigger = fileLauncherTriggerRef.value
    if (!trigger) {
      fileLauncherMenuStyle.value = {}
      return
    }

    const rect = trigger.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const estimatedMenuWidth = 250
    const left = Math.min(rect.left - 8, viewportWidth - estimatedMenuWidth - 12)

    fileLauncherMenuStyle.value = {
      position: 'fixed',
      left: `${Math.max(12, left)}px`,
      top: `${rect.bottom + 6}px`,
      minWidth: '220px',
      maxWidth: '260px',
      zIndex: 1400
    }
  })
}

const contextMenuRef = ref(null)
const contextMenu = ref({
  show: false,
  x: 0,
  y: 0,
  session: null
})

// ResizeObserver for detecting width changes
let resizeObserver = null
const fileSectionHeight = ref(48)
const isDraggingFileSplit = ref(false)

function checkLabelCollapse() {
  nextTick(() => {
    const rows = document.querySelectorAll('.session-row2')
    rows.forEach(row => {
      const sessionId = row.closest('.session-item')?.dataset?.sessionId
      if (!sessionId) return

      const modelEl = row.querySelector('.session-model')
      const badgesMeasureEl = row.querySelector('.session-counts-measure')

      if (badgesMeasureEl) {
        const rowWidth = row.clientWidth
        const modelWidth = modelEl?.scrollWidth || 0
        const badgesWidth = badgesMeasureEl.scrollWidth
        const gap = modelEl ? 8 : 0

        // If the full version does not fit, switch to the compact count-only labels.
        if (modelWidth + badgesWidth + gap > rowWidth) {
          compactCountLabels.value.add(sessionId)
        } else {
          compactCountLabels.value.delete(sessionId)
        }
      }
    })
  })
}

function clampMenuPosition(x, y) {
  const menuElement = contextMenuRef.value
  if (!menuElement) {
    return { x, y }
  }

  const viewportWidth = window.innerWidth
  const viewportHeight = window.innerHeight
  const menuRect = menuElement.getBoundingClientRect()
  const margin = 8

  return {
    x: Math.max(margin, Math.min(x, viewportWidth - menuRect.width - margin)),
    y: Math.max(margin, Math.min(y, viewportHeight - menuRect.height - margin))
  }
}

async function openContextMenuAt(x, y, session) {
  contextMenu.value = {
    show: true,
    x,
    y,
    session
  }

  await nextTick()
  const clamped = clampMenuPosition(x, y)
  if (clamped.x !== contextMenu.value.x || clamped.y !== contextMenu.value.y) {
    contextMenu.value = {
      ...contextMenu.value,
      x: clamped.x,
      y: clamped.y
    }
  }
}

function closeContextMenu() {
  contextMenu.value.show = false
}

function handleGlobalPointerDown(event) {
  if (contextMenu.value.show) {
    if (contextMenuRef.value?.contains(event.target)) return
    closeContextMenu()
  }

  if (showTaskLauncherMenu.value) {
    if (taskLauncherRef.value?.contains(event.target)) return
    if (taskLauncherMenuRef.value?.contains(event.target)) return
    closeTaskLauncherMenu()
  }

  if (showFileLauncherMenu.value) {
    if (fileLauncherRef.value?.contains(event.target)) return
    if (fileLauncherMenuRef.value?.contains(event.target)) return
    closeFileLauncherMenu()
  }
  if (showSessionListMenu.value) {
    if (sessionListMenuRef.value?.contains(event.target)) return
    if (sessionListDropdownRef.value?.contains(event.target)) return
    showSessionListMenu.value = false
  }
  if (showConfigMenu.value) {
    if (configMenuRef.value?.contains(event.target)) return
    if (configMenuBtnRef.value?.contains(event.target)) return
    closeConfigMenu()
  }
}

function handleGlobalContextMenu(event) {
  if (!contextMenu.value.show) return
  if (contextMenuRef.value?.contains(event.target)) return
  closeContextMenu()
}

function handleWindowBlur() {
  closeContextMenu()
  showSessionListMenu.value = false
}

function toggleSessionListMenu() {
  showSessionListMenu.value = !showSessionListMenu.value
  if (showSessionListMenu.value) {
    updateSessionListDropdownPosition()
  }
}

const sessionListDropdownStyle = ref({})

function updateSessionListDropdownPosition() {
  nextTick(() => {
    const btn = sessionListMenuRef.value?.querySelector('.session-list-menu-btn')
    if (!btn) {
      sessionListDropdownStyle.value = {}
      return
    }
    const rect = btn.getBoundingClientRect()
    const vw = window.innerWidth
    const menuWidth = 180
    const left = Math.max(4, Math.min(rect.left, vw - menuWidth - 4))
    sessionListDropdownStyle.value = {
      position: 'fixed',
      left: `${left}px`,
      top: `${rect.bottom + 4}px`,
      minWidth: `${menuWidth}px`,
      zIndex: 1000
    }
  })
}

function handleViewportChange() {
  if (showSessionListMenu.value) {
    updateSessionListDropdownPosition()
  }

  if (showConfigMenu.value) {
    updateConfigMenuPosition()
  }

  if (showTaskLauncherMenu.value) {
    updateTaskLauncherMenuPosition()
  }

  if (showFileLauncherMenu.value) {
    updateFileLauncherMenuPosition()
  }

  if (!contextMenu.value.show) return
  nextTick(() => {
    const clamped = clampMenuPosition(contextMenu.value.x, contextMenu.value.y)
    contextMenu.value = {
      ...contextMenu.value,
      x: clamped.x,
      y: clamped.y
    }
  })
}

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    checkLabelCollapse()
  })

  // Observe the session list container
  const sessionList = document.querySelector('.session-list')
  if (sessionList) {
    resizeObserver.observe(sessionList)
  }

  window.addEventListener('pointerdown', handleGlobalPointerDown, true)
  window.addEventListener('contextmenu', handleGlobalContextMenu, true)
  window.addEventListener('blur', handleWindowBlur)
  window.addEventListener('resize', handleViewportChange)
})

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
  stopFileSplitResize()
  window.removeEventListener('pointerdown', handleGlobalPointerDown, true)
  window.removeEventListener('contextmenu', handleGlobalContextMenu, true)
  window.removeEventListener('blur', handleWindowBlur)
  window.removeEventListener('resize', handleViewportChange)
})

// 当前项目ID
const currentProjectId = computed(() => appStore.currentProject?.id)

const readySessionCount = computed(() =>
  props.sessions.filter(session => {
    const status = props.sessionStatuses[session.id]
    return Boolean(status?.ready)
  }).length
)

const respondingSessionCount = computed(() =>
  props.sessions.filter(session => {
    const status = props.sessionStatuses[session.id]
    return Boolean(status?.ready && (status.processing || status.streaming))
  }).length
)

// 加载系统配置
async function loadSystemConfig() {
  try {
    const result = await window.electronAPI.getAppConfig()
    if (result && result.success && result.config) {
      systemConfig.value = result.config
    }
  } catch (error) {
    console.error('Failed to load system config:', error)
  }
}

// 加载项目配置
async function loadProjectConfig() {
  if (!currentProjectId.value) {
    projectConfig.value = null
    return
  }

  loadingConfig.value = true
  try {
    const result = await window.electronAPI.getProjectConfig({ projectId: currentProjectId.value })
    if (result && result.config) {
      projectConfig.value = result.config
    } else {
      projectConfig.value = null
    }
  } catch (error) {
    console.error('Failed to load project config:', error)
    projectConfig.value = null
  } finally {
    loadingConfig.value = false
  }
}

// 检查单个 session 是否有独立配置，返回配置对象或 null
async function checkSessionHasConfig(sessionId) {
  if (!sessionId || !currentProjectId.value) return null
  try {
    const result = await window.electronAPI.getSessionConfig({
      projectId: currentProjectId.value,
      sessionId
    })
    if (result.success && result.config?.settings && Object.keys(result.config.settings).length > 0) {
      return result.config
    }
    return null
  } catch (e) {
    console.error('Failed to check session config:', e)
    return null
  }
}

// 加载所有 session 的配置状态
async function loadSessionConfigStatus() {
  for (const session of props.sessions) {
    sessionConfigs.value[session.id] = await checkSessionHasConfig(session.id)
  }
}

// 判断 session 是否有独立配置
function sessionHasConfig(sessionId) {
  return resolveSessionSettingsForDisplay(sessionId).hasSessionOverride
}

// 监听项目ID变化
watch(currentProjectId, (newId) => {
  if (newId) {
    loadProjectConfig()
  } else {
    projectConfig.value = null
  }
}, { immediate: true })

// 监听 sessions 变化，加载配置状态
watch(() => props.sessions, () => {
  loadSessionConfigStatus()
}, { immediate: true, deep: true })

watch(sessionConfigs, () => {
  checkLabelCollapse()
}, { deep: true })

watch([projectConfig, systemConfig], () => {
  checkLabelCollapse()
}, { deep: true })

// 初始加载系统配置
loadSystemConfig()

// 根据ID获取模型信息
function getModelInfo(provider, modelId) {
  if (!modelId) return null
  return findProviderModel(systemConfig.value, provider, modelId)
}

// 根据ID获取模型卡片信息
function getModelCardInfo(model, cardId) {
  if (!model?.modelCards) return null
  return model.modelCards.find(c => c.id === cardId)
}

// 根据ID获取提示词信息
function getPromptInfo(promptId) {
  if (!systemConfig.value?.settings?.prompts) return null
  return systemConfig.value.settings.prompts.find(p => p.id === promptId)
}

// 根据ID获取文档信息
function getDocumentInfo(docId) {
  if (!systemConfig.value?.documents) return null
  return systemConfig.value.documents.find(d => d.id === docId)
}

function getBasePromptIds() {
  return systemConfig.value?.settings?.prompts?.filter(p => p.isBase === true).map(p => p.id) || []
}

function getBaseDocumentIds() {
  return systemConfig.value?.documents?.filter(d => d.isBase !== false).map(d => d.id) || []
}

function normalizeProjectSettings(settings = {}) {
  const modelMode = settings.modelMode || (settings.modelId ? 'custom' : 'system')
  const promptMode = settings.promptMode || (
    Array.isArray(settings.promptIds) ? (settings.promptIds.length > 0 ? 'custom' : 'none') : 'system'
  )
  const documentMode = settings.documentMode || (
    Array.isArray(settings.documentIds) ? (settings.documentIds.length > 0 ? 'custom' : 'none') : 'system'
  )

  return {
    modelMode,
    modelId: modelMode === 'custom' ? settings.modelId || null : null,
    modelCardId: modelMode === 'custom' ? settings.modelCardId || null : null,
    promptMode,
    promptIds: promptMode === 'custom' && Array.isArray(settings.promptIds) ? settings.promptIds : [],
    documentMode,
    documentIds: documentMode === 'custom' && Array.isArray(settings.documentIds) ? settings.documentIds : []
  }
}

function normalizeSessionSettings(settings = {}) {
  const modelMode = settings.modelMode || (settings.modelId === '' ? 'system' : (settings.modelId ? 'custom' : 'project'))
  const promptMode = settings.promptMode || (
    Array.isArray(settings.promptIds) ? (settings.promptIds.length > 0 ? 'custom' : 'none') : 'project'
  )
  const documentMode = settings.documentMode || (
    Array.isArray(settings.documentIds) ? (settings.documentIds.length > 0 ? 'custom' : 'none') : 'project'
  )

  return {
    modelMode,
    modelId: modelMode === 'custom' ? settings.modelId || null : null,
    modelCardId: modelMode === 'custom' ? settings.modelCardId || null : null,
    targetKind: typeof settings.targetKind === 'string' ? settings.targetKind : null,
    credentialId: typeof settings.credentialId === 'string' ? settings.credentialId : null,
    debug: settings.debug === true,
    promptMode,
    promptIds: promptMode === 'custom' && Array.isArray(settings.promptIds) ? settings.promptIds : [],
    documentMode,
    documentIds: documentMode === 'custom' && Array.isArray(settings.documentIds) ? settings.documentIds : []
  }
}

function getSessionListEntry(sessionId) {
  return props.sessions.find(session => session.id === sessionId) || null
}

function hasMeaningfulSessionDisplaySettings(settings = {}) {
  if (!settings || typeof settings !== 'object') return false

  return (
    settings.debug === true ||
    settings.modelMode !== undefined ||
    settings.modelId !== undefined ||
    settings.modelCardId !== undefined ||
    settings.promptMode !== undefined ||
    settings.documentMode !== undefined ||
    (Array.isArray(settings.promptIds) && settings.promptIds.length > 0) ||
    (Array.isArray(settings.documentIds) && settings.documentIds.length > 0)
  )
}

function buildPromptDetails(ids) {
  return ids.map(id => {
    const prompt = getPromptInfo(id)
    return {
      id,
      name: prompt?.name || id,
      isBase: prompt?.isBase
    }
  })
}

function buildDocumentDetails(ids) {
  return ids.map(id => {
    const doc = getDocumentInfo(id)
    return {
      id,
      name: doc?.name || id,
      isBase: doc?.isBase !== false
    }
  })
}

function buildModelDisplay(provider, modelId, modelCardId, fallbackText) {
  if (!modelId) {
    return {
      configName: fallbackText,
      cardName: null,
      text: fallbackText
    }
  }

  const model = getModelInfo(provider, modelId)
  if (!model) {
    return {
      configName: modelId,
      cardName: null,
      text: modelId
    }
  }

  const targetCard = modelCardId
    ? getModelCardInfo(model, modelCardId)
    : (model.modelCards?.find(card => card.id === model.defaultCardId) || model.modelCards?.[0] || null)
  const configName = model.friendlyName || model.id
  const cardName = targetCard?.modelName || targetCard?.id || null

  return {
    configName,
    cardName,
    text: cardName ? `${configName}(${cardName})` : configName
  }
}

function buildTargetDisplay(provider, settings = {}, fallbackText = '系统') {
  const targetKind = typeof settings?.targetKind === 'string' ? settings.targetKind.trim() : ''

  if (provider === 'codex' && targetKind === 'openai') {
    return {
      configName: 'OpenAI',
      cardName: null,
      text: 'OpenAI'
    }
  }

  if (targetKind && targetKind !== 'provider' && targetKind !== 'project' && targetKind !== 'system') {
    return {
      configName: targetKind,
      cardName: null,
      text: targetKind
    }
  }

  const modelId = typeof settings?.modelId === 'string' && settings.modelId.trim()
    ? settings.modelId.trim()
    : null
  const modelCardId = typeof settings?.modelCardId === 'string' && settings.modelCardId.trim()
    ? settings.modelCardId.trim()
    : null
  return buildModelDisplay(provider, modelId, modelCardId, fallbackText)
}

function resolveProjectSettingsForDisplay() {
  const provider = 'claude'
  const normalized = normalizeProjectSettings(projectConfig.value?.settings || {})
  const promptIds = normalized.promptMode === 'custom'
    ? normalized.promptIds
    : (normalized.promptMode === 'none' ? [] : getBasePromptIds())
  const documentIds = normalized.documentMode === 'custom'
    ? normalized.documentIds
    : (normalized.documentMode === 'none' ? [] : getBaseDocumentIds())
  const modelDisplay = normalized.modelMode === 'custom'
    ? buildModelDisplay(provider, normalized.modelId, normalized.modelCardId, '系统')
    : { configName: '系统', cardName: null, text: '系统' }

  return {
    modelMode: normalized.modelMode,
    modelId: normalized.modelMode === 'custom' ? normalized.modelId : null,
    modelCardId: normalized.modelMode === 'custom' ? normalized.modelCardId : null,
    modelDisplay,
    prompts: buildPromptDetails(promptIds),
    documents: buildDocumentDetails(documentIds),
    hasCustomConfig: normalized.modelMode === 'custom' || normalized.promptMode !== 'system' || normalized.documentMode !== 'system',
    meta: normalized
  }
}

function resolveSessionSettingsForDisplay(sessionId) {
  const sessionConfig = sessionConfigs.value[sessionId]
  const sessionEntry = getSessionListEntry(sessionId)
  const projectResolved = resolveProjectSettingsForDisplay()
  const effectiveSettings = sessionConfig?.settings || sessionEntry?.settings || {}
  const provider = effectiveSettings.tool || effectiveSettings.provider || 'claude'

  if (!hasMeaningfulSessionDisplaySettings(effectiveSettings)) {
    return {
      ...projectResolved,
      source: 'project',
      sessionMeta: null,
      hasSessionOverride: false
    }
  }

  const normalized = normalizeSessionSettings(effectiveSettings)
  const promptIds = normalized.promptMode === 'custom'
    ? normalized.promptIds
    : (normalized.promptMode === 'project'
        ? projectResolved.prompts.map(prompt => prompt.id)
        : (normalized.promptMode === 'none' ? [] : getBasePromptIds()))
  const documentIds = normalized.documentMode === 'custom'
    ? normalized.documentIds
    : (normalized.documentMode === 'project'
        ? projectResolved.documents.map(doc => doc.id)
        : (normalized.documentMode === 'none' ? [] : getBaseDocumentIds()))
  const modelDisplay = normalized.modelMode === 'custom'
    ? buildTargetDisplay(provider, effectiveSettings, '系统')
    : (normalized.modelMode === 'system' ? buildTargetDisplay(provider, effectiveSettings, '系统') : projectResolved.modelDisplay)
  const hasSessionOverride = normalized.modelMode !== 'project' || normalized.promptMode !== 'project' || normalized.documentMode !== 'project' || normalized.debug === true

  return {
    modelMode: normalized.modelMode,
    modelId: normalized.modelMode === 'custom' ? normalized.modelId : (normalized.modelMode === 'project' ? projectResolved.modelId : null),
    modelCardId: normalized.modelMode === 'custom' ? normalized.modelCardId : (normalized.modelMode === 'project' ? projectResolved.modelCardId : null),
    modelDisplay,
    prompts: buildPromptDetails(promptIds),
    documents: buildDocumentDetails(documentIds),
    source: 'session',
    sessionMeta: normalized,
    hasSessionOverride
  }
}

// 配置摘要
const configSummary = computed(() => {
  const resolved = resolveProjectSettingsForDisplay()
  return {
    configName: resolved.modelDisplay.configName,
    cardName: resolved.modelDisplay.cardName,
    modelId: resolved.modelId,
    prompts: resolved.prompts,
    documents: resolved.documents,
    hasCustomConfig: resolved.hasCustomConfig
  }
})

function toggleConfigPanel() {
  showConfigPanel.value = !showConfigPanel.value
}

function getLayoutState() {
  return {
    showConfigPanel: Boolean(showConfigPanel.value),
    fileSectionHeight: Number(fileSectionHeight.value || 48)
  }
}

function applyLayoutState(layout = {}) {
  if (typeof layout?.showConfigPanel === 'boolean') {
    showConfigPanel.value = layout.showConfigPanel
  }

  if (typeof layout?.fileSectionHeight === 'number' && Number.isFinite(layout.fileSectionHeight)) {
    fileSectionHeight.value = Math.max(20, Math.min(75, layout.fileSectionHeight))
  }
}

function handleSelect(session) {
  if (session?.sessionAvailable === false) {
    return
  }
  emit('select', session.id)
}

function handleContextMenu(event, session) {
  event.preventDefault()
  openContextMenuAt(event.clientX, event.clientY, session)
}

function handleRename() {
  if (contextMenu.value.session) {
    emit('rename', contextMenu.value.session)
  }
  closeContextMenu()
}

function handleDelete() {
  if (contextMenu.value.session) {
    emit('delete', contextMenu.value.session)
  }
  closeContextMenu()
}

function handleStart() {
  if (contextMenu.value.session) {
    emit('start', contextMenu.value.session)
  }
  closeContextMenu()
}

function handleClose() {
  if (contextMenu.value.session) {
    emit('close', contextMenu.value.session)
  }
  closeContextMenu()
}

function handleOpenSessionConfig() {
  if (contextMenu.value.session) {
    emit('openSessionConfig', contextMenu.value.session)
  }
  closeContextMenu()
}

function handleDeleteSessionConfig() {
  if (contextMenu.value.session) {
    emit('deleteSessionConfig', contextMenu.value.session)
  }
  closeContextMenu()
}

function handleCopySession() {
  if (contextMenu.value.session) {
    emit('copySession', contextMenu.value.session)
  }
  closeContextMenu()
}

function handleToggleShowClaudeFilter() {
  emit('toggleShowClaude')
}

function handleToggleShowCodexFilter() {
  emit('toggleShowCodex')
}

function handleDeleteInactiveSessionsClick() {
  emit('deleteInactiveSessions')
  showSessionListMenu.value = false
}

function getSessionStatus(sessionId) {
  const status = props.sessionStatuses[sessionId]
  if (!status || !status.ready) return 'inactive'
  if (status.processing || status.streaming) return 'streaming'
  if (status.unseenCompleted) return 'completed-unseen'
  return 'ready'
}

function isSessionRunning(sessionId) {
  const status = props.sessionStatuses[sessionId]
  return status && status.ready
}

function isSessionInactive(sessionId) {
  const status = props.sessionStatuses[sessionId]
  return !status || !status.ready
}

function formatTime(date) {
  if (!date) return ''
  const d = new Date(date)
  const now = new Date()
  const diff = now - d

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

function getSessionName(session) {
  return session.name || session.id.slice(0, 8)
}

// 获取会话的模型信息显示
function getSessionModelInfo(session) {
  const resolved = resolveSessionSettingsForDisplay(session.id)
  if (resolved.sessionMeta?.modelMode === 'custom') {
    return resolved.modelDisplay.text
  }
  if (resolved.sessionMeta?.modelMode === 'system') {
    return resolved.modelDisplay.text
  }
  return null
}

// 获取会话的提示词/文档数量显示
function getSessionPromptDocCounts(session) {
  const resolved = resolveSessionSettingsForDisplay(session.id)
  return {
    promptCount: resolved.sessionMeta?.promptMode === 'project' ? 0 : resolved.prompts.length,
    docCount: resolved.sessionMeta?.documentMode === 'project' ? 0 : resolved.documents.length
  }
}

function hasSessionSecondaryInfo(session) {
  const modelInfo = getSessionModelInfo(session)
  const counts = getSessionPromptDocCounts(session)
  return Boolean(modelInfo || counts.promptCount > 0 || counts.docCount > 0)
}

function getSessionTool(session) {
  const tool = session?.settings?.tool || session?.settings?.provider || 'claude'
  return tool === 'codex' ? 'codex' : 'claude'
}

function getSessionBindingLabel(session) {
  return typeof session?.bindingLabel === 'string' ? session.bindingLabel.trim() : ''
}

function getSessionBindingClass(session) {
  const state = typeof session?.bindingState === 'string' ? session.bindingState : 'none'
  if (state === 'missing') return 'missing'
  if (state === 'pending') return 'pending'
  return ''
}

function getSessionAvailabilityLabel(session) {
  return session?.sessionAvailable === false ? '不可用' : ''
}

function getProviderDisplayName(providerId) {
  if (!providerId || providerId === '未知') return '未知'
  if (providerId === 'openai') return 'OpenAI'
  // 尝试从 codex 模型中查找
  const codexModel = getModelInfo('codex', providerId)
  if (codexModel) return codexModel.friendlyName || codexModel.id
  // 尝试从 claude 模型中查找
  const claudeModel = getModelInfo('claude', providerId)
  if (claudeModel) return claudeModel.friendlyName || claudeModel.id
  return providerId
}

function getSessionAvailabilityTitle(session) {
  if (session?.sessionAvailable !== false) return ''
  const initProvider = getProviderDisplayName(session?.initProvider)
  const currentProvider = getProviderDisplayName(session?.currentProvider)
  return `创建时供应商: ${initProvider}；当前供应商: ${currentProvider}`
}

function isSessionDebugEnabled(sessionId) {
  return resolveSessionSettingsForDisplay(sessionId).sessionMeta?.debug === true
}

// 判断会话的标签是否应该折叠
function shouldUseCompactCountLabels(sessionId) {
  return compactCountLabels.value.has(sessionId)
}

function getProjectName(path) {
  if (!path) return '会话'
  // 提取路径最后一部分作为项目名称
  const parts = path.split('/').filter(p => p)
  return parts[parts.length - 1] || '会话'
}

async function openProjectInFinder() {
  if (!props.projectPath) return
  try {
    await window.electronAPI.openPathInFinder({ targetPath: props.projectPath, mode: 'open' })
  } catch (error) {
    console.error('[SessionSidebar] Failed to open project in Finder:', error)
  }
}

function startFileSplitResize(event) {
  event.preventDefault()
  isDraggingFileSplit.value = true
  document.addEventListener('mousemove', handleFileSplitResize)
  document.addEventListener('mouseup', stopFileSplitResize)
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
}

function handleFileSplitResize(event) {
  if (!isDraggingFileSplit.value) return

  const body = document.querySelector('.sidebar-body')
  if (!body) return

  const rect = body.getBoundingClientRect()
  const offset = event.clientY - rect.top
  const percentage = (offset / rect.height) * 100
  fileSectionHeight.value = Math.max(20, Math.min(75, percentage))
}

function stopFileSplitResize() {
  if (!isDraggingFileSplit.value) return
  isDraggingFileSplit.value = false
  document.removeEventListener('mousemove', handleFileSplitResize)
  document.removeEventListener('mouseup', stopFileSplitResize)
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
}

async function refreshConfig() {
  await Promise.all([
    loadSystemConfig(),
    loadProjectConfig(),
    loadSessionConfigStatus()
  ])
  checkLabelCollapse()
}

// 暴露刷新配置的方法
defineExpose({
  refreshConfig,
  toggleConfigPanel,
  getLayoutState,
  applyLayoutState
})

watch([showConfigPanel, fileSectionHeight], () => {
  emit('layoutChange', getLayoutState())
}, { immediate: true })
</script>

<template>
  <aside class="session-sidebar">
    <!-- 第一行：红绿灯占位 | Logo | 折叠按钮 -->
    <div class="sidebar-header-row1">
      <div class="traffic-light-placeholder"></div>
      <div class="header-actions">
        <span class="app-logo">CCGUI</span>
      </div>
      <IconButton class="toggle-btn" size="sm" @click="emit('toggle')" title="折叠">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 6l-6 6 6 6"/>
          <path d="M20 5v14"/>
        </svg>
      </IconButton>
    </div>
    <!-- 第二行：项目名称 | 配置菜单 -->
    <div class="sidebar-header-row2">
      <IconButton class="home-btn" size="sm" @click="emit('home')" title="返回首页">
        <svg class="home-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 10.5L12 3l9 7.5"/>
          <path d="M5 9.5V21h14V9.5"/>
          <path d="M9 21v-6h6v6"/>
        </svg>
      </IconButton>
      <div class="sidebar-title" :title="projectPath" @click="emit('switchProject')">
        <span class="project-name">{{ getProjectName(projectPath) }}</span>
      </div>
      <div class="config-menu-wrapper" ref="configMenuBtnRef">
        <IconButton class="config-menu-btn" size="sm" @click.stop="toggleConfigMenu" title="配置">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </IconButton>
        <Teleport to="body">
          <div
            v-if="showConfigMenu"
            ref="configMenuRef"
            class="config-menu-dropdown"
            :style="configMenuDropdownStyle"
            @click.stop
          >
            <button class="menu-item" @click="emit('openClaudeDialog'); closeConfigMenu()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M4 6h16"/>
                <path d="M4 12h16"/>
                <path d="M4 18h10"/>
              </svg>
              Claude 面板
            </button>
            <button class="menu-item" @click="emit('openCodexDialog'); closeConfigMenu()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="3"/>
                <path d="M8 8h8v8H8z"/>
              </svg>
              Codex 面板
            </button>
            <div class="menu-divider"></div>
            <button class="menu-item" @click="emit('openPromptDialog'); closeConfigMenu()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
              </svg>
              提示词面板
            </button>
            <button class="menu-item" @click="emit('openTaskTemplatesDialog'); closeConfigMenu()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2H3V5z"/>
                <path d="M3 9h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z"/>
                <path d="M8 13h8"/>
                <path d="M12 9v8"/>
              </svg>
              任务模板
            </button>
            <div class="menu-divider"></div>
            <button class="menu-item" @click="emit('openSkillsDialog'); closeConfigMenu()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
                <line x1="3" y1="6" x2="21" y2="6"/>
                <path d="M16 10a4 4 0 0 1-8 0"/>
              </svg>
              技能管理
            </button>
            <button class="menu-item" @click="emit('openMcpDialog'); closeConfigMenu()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
                <line x1="6" y1="6" x2="6.01" y2="6"/>
                <line x1="6" y1="18" x2="6.01" y2="18"/>
            </svg>
            MCP 服务
          </button>
          <div class="menu-divider"></div>
            <button class="menu-item" @click="emit('openProjectConfig'); closeConfigMenu()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="4" y1="21" x2="4" y2="14"/>
                <line x1="4" y1="10" x2="4" y2="3"/>
                <line x1="12" y1="21" x2="12" y2="12"/>
                <line x1="12" y1="8" x2="12" y2="3"/>
                <line x1="20" y1="21" x2="20" y2="16"/>
                <line x1="20" y1="12" x2="20" y2="3"/>
                <line x1="2" y1="14" x2="6" y2="14"/>
                <line x1="10" y1="8" x2="14" y2="8"/>
                <line x1="18" y1="16" x2="22" y2="16"/>
              </svg>
              项目设置
            </button>
            <button class="menu-item" @click="emit('openAppSettings'); closeConfigMenu()">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="3"/>
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
              </svg>
              应用设置
            </button>
          </div>
        </Teleport>
      </div>
    </div>

    <div class="sidebar-toolbar-row">
      <div
        ref="fileLauncherRef"
        class="terminal-launcher"
        :class="{ active: isFilePanelVisible || showFileLauncherMenu }"
      >
        <IconButton
          class="file-toggle-btn terminal-launcher-main"
          size="sm"
          :class="{ active: isFilePanelVisible }"
          @click="emit('toggleFilePanel'); closeFileLauncherMenu()"
          :title="isFilePanelVisible ? '隐藏文件列表' : '显示文件列表'"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
          </svg>
        </IconButton>
        <button
          ref="fileLauncherTriggerRef"
          class="terminal-launcher-trigger"
          :class="{ active: showFileLauncherMenu }"
          title="打开文件菜单"
          @click.stop="toggleFileLauncherMenu"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <Teleport to="body">
          <div
            v-if="showFileLauncherMenu"
            ref="fileLauncherMenuRef"
            class="terminal-launcher-menu"
            :style="fileLauncherMenuStyle"
            @click.stop
          >
            <button class="terminal-launcher-item" @click="emit('togglePreviewPanel')">
              <span class="terminal-launcher-item-label">{{ previewPanelVisible ? '隐藏预览区' : '显示预览区' }}</span>
              <span class="terminal-launcher-item-detail">切换右侧文件预览面板</span>
            </button>
            <div class="terminal-launcher-divider"></div>
            <button class="terminal-launcher-item" @click="handleOpenProjectDirectory">
              <span class="terminal-launcher-item-label">打开目录</span>
              <span class="terminal-launcher-item-detail">在 Finder 中打开当前项目</span>
            </button>
          </div>
        </Teleport>
      </div>
      <div
        ref="taskLauncherRef"
        class="terminal-launcher"
        :class="{ active: terminalPanelVisible || showTaskLauncherMenu }"
      >
        <IconButton
          class="file-toggle-btn terminal-launcher-main"
          size="sm"
          :class="{ active: terminalPanelVisible }"
          @click="emit('toggleTerminalPanel'); closeTaskLauncherMenu()"
          :title="terminalPanelVisible ? '隐藏终端面板' : '显示终端面板'"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z"/>
            <path d="M7 9l3 3-3 3"/>
            <path d="M12 15h5"/>
          </svg>
          <span
            v-if="!terminalPanelVisible && terminalRunningCount > 0"
            class="terminal-running-badge"
            :title="`有 ${terminalRunningCount} 个终端正在运行命令`"
          >
            {{ terminalRunningCount > 9 ? '9+' : terminalRunningCount }}
          </span>
        </IconButton>
        <button
          ref="taskLauncherTriggerRef"
          class="terminal-launcher-trigger"
          :class="{ active: showTaskLauncherMenu }"
          title="打开终端启动菜单"
          @click.stop="toggleTaskLauncherMenu"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <Teleport to="body">
          <div
            v-if="showTaskLauncherMenu"
            ref="taskLauncherMenuRef"
            class="terminal-launcher-menu"
            :style="taskLauncherMenuStyle"
            @click.stop
          >
            <div class="terminal-launcher-inline-actions">
              <button class="terminal-launcher-inline-main" @click="handleOpenTaskLauncherConfig">
                <span class="terminal-launcher-inline-plus">+</span>
                <span class="terminal-launcher-inline-text">新建快捷命令</span>
              </button>
              <button class="terminal-launcher-inline-icon" title="刷新任务列表" @click="handleRefreshTaskLauncherTasks">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 2v6h-6"/>
                  <path d="M3 12a9 9 0 0 1 15.55-6.36L21 8"/>
                  <path d="M3 22v-6h6"/>
                  <path d="M21 12a9 9 0 0 1-15.55 6.36L3 16"/>
                </svg>
              </button>
              <button class="terminal-launcher-inline-icon" title="打开配置文件" @click="handleOpenTaskLauncherFile">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M14 3h7v7"/>
                  <path d="M10 14L21 3"/>
                  <path d="M21 14v7H3V3h7"/>
                </svg>
              </button>
            </div>
            <div v-if="taskLauncherTasks.length > 0" class="terminal-launcher-divider"></div>
            <button
              v-for="task in taskLauncherTasks"
              :key="task.id"
              class="terminal-launcher-item task-launcher-task-item"
              :title="task.commandLine"
            >
              <span class="terminal-launcher-item-content">
                <span class="terminal-launcher-item-label">{{ task.label }}</span>
                <span v-if="task.detail" class="terminal-launcher-item-detail">{{ task.detail }}</span>
                <span class="terminal-launcher-item-command">{{ task.commandLine }}</span>
              </span>
              <span class="terminal-launcher-item-actions">
                <button
                  class="terminal-task-action terminal-task-toggle"
                  :class="{ running: isTaskRunning(task) }"
                  :title="isTaskRunning(task) ? '停止任务' : '启动任务'"
                  @click.stop="handleToggleTaskLauncher(task)"
                >
                  <svg
                    v-if="!isTaskRunning(task)"
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <path d="M8 5.5v13l10-6.5-10-6.5Z"/>
                  </svg>
                  <svg
                    v-else
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="currentColor"
                    aria-hidden="true"
                  >
                    <rect x="7" y="7" width="10" height="10" rx="1.5"/>
                  </svg>
                </button>
                <button
                  class="terminal-task-action terminal-task-delete"
                  title="删除任务"
                  @click.stop="handleDeleteTaskLauncher(task)"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M3 6h18"/>
                    <path d="M8 6V4h8v2"/>
                    <path d="M19 6l-1 14H6L5 6"/>
                    <path d="M10 11v6"/>
                    <path d="M14 11v6"/>
                  </svg>
                </button>
              </span>
            </button>
            <div v-if="taskLauncherTasks.length === 0" class="terminal-launcher-empty">
              没有可运行的 tasks.json 任务
            </div>
          </div>
        </Teleport>
      </div>
      <IconButton
        class="file-toggle-btn"
        size="sm"
        :class="{ active: primaryView === 'tasks' }"
        :title="primaryView === 'tasks' ? '切换到会话视图' : '切换到任务视图'"
        @click="emit('selectPrimaryView', primaryView === 'tasks' ? 'chat' : 'tasks')"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 11l3 3L22 4"/>
          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>
        </svg>
      </IconButton>
    </div>

    <div class="sidebar-body">
      <FileTreePanel
        v-if="isFilePanelVisible"
        class="file-tree-section"
        :style="{ flexBasis: `${fileSectionHeight}%` }"
        :project-path="projectPath"
        :tree="fileTree"
        :is-loading="fileTreeLoading"
        :error="fileTreeError"
        :expanded-dirs="expandedDirs"
        :active-file-path="activeFilePath"
        :selected-node-path="selectedNodePath"
        :editing-node-path="editingNodePath"
        :has-open-files="hasOpenFiles"
        :preview-panel-visible="previewPanelVisible"
        @refresh="emit('refreshFileTree')"
        @toggle-preview-panel="emit('togglePreviewPanel')"
        @toggle-directory="emit('toggleDirectory', $event)"
        @preview-file="emit('previewFile', $event)"
        @pin-file="emit('pinFile', $event)"
        @select-node="emit('selectFileNode', $event)"
        @start-rename-node="emit('startRenameFileNode', $event)"
        @stop-rename-node="emit('stopRenameFileNode')"
        @rename-node="emit('renameFileNode', $event)"
        @create-entry="emit('createFileNode', $event)"
        @delete-node="emit('deleteFileNode', $event)"
        @add-to-chat="emit('addFileToChat', $event)"
      />

      <div
        v-if="isFilePanelVisible"
        class="file-session-resize"
        :class="{ dragging: isDraggingFileSplit }"
        @mousedown="startFileSplitResize"
      ></div>

      <div class="session-section">
        <div class="session-section-header">
          <div class="session-section-title">
            <span>会话列表</span>
            <button class="session-add-btn" @click="emit('newSession')" title="新建会话">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
            <div class="session-list-menu-wrapper" ref="sessionListMenuRef">
              <button class="session-list-menu-btn" @click.stop="toggleSessionListMenu" title="会话管理">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                  <circle cx="12" cy="5" r="2"/>
                  <circle cx="12" cy="12" r="2"/>
                  <circle cx="12" cy="19" r="2"/>
                </svg>
              </button>
              <Teleport to="body">
              <div
                v-if="showSessionListMenu"
                ref="sessionListDropdownRef"
                class="session-list-dropdown"
                :style="sessionListDropdownStyle"
                @click.stop
              >
                <button class="menu-item" @click="handleToggleShowClaudeFilter">
                  <svg v-if="showClaudeFilter" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span v-else class="menu-icon-placeholder"></span>
                  显示Claude会话
                </button>
                <button class="menu-item" @click="handleToggleShowCodexFilter">
                  <svg v-if="showCodexFilter" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <span v-else class="menu-icon-placeholder"></span>
                  显示Codex会话
                </button>
                <div class="menu-divider"></div>
                <button class="menu-item danger" @click="handleDeleteInactiveSessionsClick">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                  删除未激活会话
                </button>
              </div>
              </Teleport>
            </div>
          </div>
          <div class="session-section-counts">
            <span class="session-section-count responding" :title="`正在对答会话 ${respondingSessionCount}`">
              <span class="session-count-dot" />
              <span>{{ respondingSessionCount }}</span>
            </span>
            <span class="session-section-count ready" :title="`已启动会话 ${readySessionCount}`">
              <span class="session-count-dot" />
              <span>{{ readySessionCount }}</span>
            </span>
            <span class="session-section-count total" :title="`总会话数 ${sessions.length}`">
              <span class="session-count-dot" />
              <span>{{ sessions.length }}</span>
            </span>
          </div>
        </div>

        <div class="session-list">
          <div
            v-for="session in sessions"
            :key="session.id"
            :data-session-id="session.id"
            class="session-item"
            :class="{
              active: currentSession?.id === session.id,
              unavailable: session.sessionAvailable === false,
              'permission-pending': sessionStatuses[session.id]?.pendingPermission && currentSession?.id !== session.id
            }"
            @click="handleSelect(session)"
            @contextmenu="handleContextMenu($event, session)"
          >
            <div class="session-status-column">
              <template v-if="session.sessionAvailable === false">
                <div
                  class="session-unavailable-icon"
                  :title="getSessionAvailabilityTitle(session)"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
                  </svg>
                </div>
              </template>
              <template v-else>
                <div class="session-status" :class="getSessionStatus(session.id)" />
              </template>
              <div
                v-if="isSessionDebugEnabled(session.id)"
                class="session-debug-badge"
                title="Debug 已开启"
              >
                <span>🐞</span>
              </div>
            </div>

            <div class="session-info">
              <div class="session-row1">
                <span class="session-name">
                  <span class="session-name-text">{{ getSessionName(session) }}</span>
                  <template v-if="getSessionBindingLabel(session)"> - <span class="session-binding-label">{{ getSessionBindingLabel(session) }}</span></template>
                  <span v-else class="session-id"> - {{ session.id.slice(0, 8) }}</span>
                </span>
              </div>
              <div v-if="hasSessionSecondaryInfo(session)" class="session-row2" :data-session-id="session.id">
                <span v-if="getSessionModelInfo(session)" class="session-model">{{ getSessionModelInfo(session) }}</span>
                <div class="session-counts-badges">
                  <span v-if="getSessionPromptDocCounts(session).promptCount > 0" class="count-badge-item">
                    <span class="badge-label" v-if="!shouldUseCompactCountLabels(session.id)">提示词:</span>{{ getSessionPromptDocCounts(session).promptCount }}
                  </span>
                  <span v-if="getSessionPromptDocCounts(session).docCount > 0" class="count-badge-item">
                    <span class="badge-label" v-if="!shouldUseCompactCountLabels(session.id)">规范:</span>{{ getSessionPromptDocCounts(session).docCount }}
                  </span>
                </div>
                <div class="session-counts-measure" aria-hidden="true">
                  <span v-if="getSessionPromptDocCounts(session).promptCount > 0" class="count-badge-item">
                    <span class="badge-label">提示词:</span>{{ getSessionPromptDocCounts(session).promptCount }}
                  </span>
                  <span v-if="getSessionPromptDocCounts(session).docCount > 0" class="count-badge-item">
                    <span class="badge-label">规范:</span>{{ getSessionPromptDocCounts(session).docCount }}
                  </span>
                </div>
              </div>
              <div class="session-row3">
                <span v-if="session.preview" class="session-preview">{{ session.preview }}</span>
              </div>
              <div class="session-row4">
                <span>{{ session.messageCount || 0 }} 条消息, {{ formatTime(session.updatedAt) }}</span>
                <span
                  v-if="false"
                  class="session-binding-badge"
                  :class="getSessionBindingClass(session)"
                >
                  {{ getSessionBindingLabel(session) }}
                </span>
                <span
                  v-if="false"
                  class="session-binding-badge unavailable"
                  :title="getSessionAvailabilityTitle(session)"
                >
                  {{ getSessionAvailabilityLabel(session) }}
                </span>
                <span
                  class="session-tool-badge"
                  :class="getSessionTool(session) === 'codex' ? 'codex' : 'claude'"
                >
                  {{ getSessionTool(session) === 'codex' ? 'Codex' : 'Claude' }}
                </span>
              </div>
            </div>

            <button
              class="session-menu-btn"
              @click.stop="handleContextMenu($event, session)"
              title="更多操作"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="2"/>
                <circle cx="12" cy="12" r="2"/>
                <circle cx="12" cy="19" r="2"/>
              </svg>
            </button>
          </div>

          <div v-if="sessions.length === 0" class="empty-list">
            <p>暂无会话</p>
            <p class="hint">点击 + 创建新会话</p>
          </div>
        </div>
      </div>
    </div>

    <!-- Context Menu -->
    <div
      v-if="contextMenu.show"
      ref="contextMenuRef"
      class="context-menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @click.stop
    >
      <!-- Start session option - only show when session is inactive -->
      <button
        v-if="isSessionInactive(contextMenu.session?.id)"
        class="menu-item success"
        @click="handleStart"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polygon points="5 3 19 12 5 21 5 3"/>
        </svg>
        启动会话
      </button>

      <!-- Close session option - only show when session is running -->
      <button
        v-if="isSessionRunning(contextMenu.session?.id)"
        class="menu-item warning"
        @click="handleClose"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <line x1="15" y1="9" x2="9" y2="15"/>
          <line x1="9" y1="9" x2="15" y2="15"/>
        </svg>
        关闭会话
      </button>

      <!-- Divider -->
      <div
        v-if="isSessionInactive(contextMenu.session?.id) || isSessionRunning(contextMenu.session?.id)"
        class="menu-divider"
      ></div>

      <!-- Session Config -->
      <button
        class="menu-item"
        @click="handleOpenSessionConfig"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        配置
      </button>

      <!-- Copy Session -->
      <button class="menu-item" @click="handleCopySession">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
        </svg>
        复制会话
      </button>

      <!-- Divider -->
      <div class="menu-divider"></div>

      <button class="menu-item" @click="handleRename">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
        </svg>
        重命名
      </button>
      <button class="menu-item danger" @click="handleDelete">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
        </svg>
        删除会话
      </button>
    </div>
  </aside>
</template>

<style scoped>
.session-sidebar {
  background: #1E1E1E;
  border-right: 1px solid #3F3F46;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  -webkit-app-region: no-drag;
}

/* 第一行：红绿灯占位 | Logo | 折叠按钮 */
.sidebar-header-row1 {
  padding: 8px 16px;
  border-bottom: 1px solid #3F3F46;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  -webkit-app-region: drag;
}

.sidebar-header-row1 button {
  -webkit-app-region: no-drag;
}

.traffic-light-placeholder {
  width: 52px;
  /* 为红绿灯留出空间 */
}

.app-logo {
  font-size: 16px;
  font-weight: 700;
  color: #F97316;
  letter-spacing: 0.5px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.app-settings-btn {
  opacity: 0.72;
  transition: opacity 0.15s;
}

.config-menu-wrapper {
  flex-shrink: 0;
}

.config-menu-btn {
  opacity: 0.72;
  transition: opacity 0.15s;
}

.config-menu-btn:hover {
  opacity: 1;
}

.config-menu-dropdown {
  background: #1E1E1E;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  padding: 4px 0;
  min-width: 180px;
  box-shadow: 0 10px 15px rgba(0, 0, 0, 0.5);
}

.config-menu-dropdown .menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: none;
  color: #E4E4E7;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
  transition: background 0.15s;
}

.config-menu-dropdown .menu-item:hover:not(:disabled) {
  background: #27272A;
}

.config-menu-dropdown .menu-item:disabled {
  color: #52525B;
  cursor: default;
}

.toggle-btn {
  flex-shrink: 0;
}

/* 第二行：项目名称 | 新建按钮 */
.sidebar-header-row2 {
  padding: 8px 16px;
  border-bottom: 1px solid #3F3F46;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.sidebar-toolbar-row {
  padding: 6px 16px;
  border-bottom: 1px solid #3F3F46;
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  flex-shrink: 0;
  position: relative;
  z-index: 6;
  overflow: visible;
  -webkit-app-region: no-drag;
}

.home-btn {
  flex-shrink: 0;
}

.sidebar-title {
  display: flex;
  align-items: center;
  height: 28px;
  padding: 0 10px;
  font-size: 20px;
  font-weight: 700;
  color: #E4E4E7;
  letter-spacing: 0.5px;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
  border-radius: 6px;
  border: 1px solid transparent;
  transition: background 0.2s, color 0.2s, border-color 0.2s, transform 0.2s;
  flex: 0 1 auto;
  max-width: 180px;
  margin-right: auto;
  min-width: 0;
}

.project-name {
  line-height: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  display: inline-block;
}

.sidebar-title:hover {
  background: #27272A;
  border-color: #3F3F46;
  color: #F4F4F5;
  transform: translateY(-1px);
}

.add-btn {
  padding: 4px;
  background: transparent;
  border: none;
  color: #6B7280;
  cursor: pointer;
  border-radius: 4px;
  flex-shrink: 0;
}

.add-btn:hover {
  background: #374151;
  color: #D1D5DB;
}

.file-toggle-btn {
  flex-shrink: 0;
  position: relative;
}

.terminal-launcher {
  position: relative;
  display: flex;
  align-items: stretch;
  flex-shrink: 0;
  gap: 0;
}

.terminal-launcher-main {
  border-top-right-radius: 0;
  border-bottom-right-radius: 0;
}

.terminal-launcher-trigger {
  width: 13px;
  padding: 0;
  border: none;
  margin-left: -3px;
  border-top-right-radius: 8px;
  border-bottom-right-radius: 8px;
  background: transparent;
  color: #71717A;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease, box-shadow 0.18s ease;
}

.terminal-launcher-trigger:hover,
.terminal-launcher-trigger.active {
  background: rgba(255, 255, 255, 0.04);
  color: #F4F4F5;
  box-shadow: inset 1px 0 0 rgba(255, 255, 255, 0.08);
}

.terminal-launcher-menu {
  padding: 6px;
  border: 1px solid #3F3F46;
  border-radius: 10px;
  background: #15171c;
  box-shadow: 0 14px 32px rgba(0, 0, 0, 0.36);
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.terminal-launcher-item {
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #E4E4E7;
  text-align: left;
  display: flex;
  flex-direction: column;
  gap: 3px;
  cursor: pointer;
}

.terminal-launcher-item:hover {
  background: rgba(255, 255, 255, 0.06);
}

.task-launcher-task-item {
  flex-direction: row;
  align-items: center;
}

.terminal-launcher-item-content {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
  flex: 1;
}

.terminal-launcher-item-actions {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  flex: 0 0 auto;
  margin-left: 10px;
}

.terminal-launcher-item-create {
  border: 1px solid rgba(249, 115, 22, 0.16);
  background: rgba(249, 115, 22, 0.06);
}

.terminal-launcher-inline-actions {
  display: flex;
  align-items: stretch;
  gap: 6px;
}

.terminal-launcher-inline-main,
.terminal-launcher-inline-icon {
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #6B7280;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.terminal-launcher-inline-main {
  flex: 1;
  min-width: 0;
  padding: 8px 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
}

.terminal-launcher-inline-icon {
  flex: 0 0 auto;
  width: 32px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.terminal-launcher-inline-main:hover,
.terminal-launcher-inline-icon:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #D4D4D8;
}

.terminal-launcher-inline-plus {
  color: #FDBA74;
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
}

.terminal-launcher-inline-text {
  font-size: 12px;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.terminal-launcher-divider {
  height: 1px;
  margin: 2px 4px;
  background: rgba(255, 255, 255, 0.08);
}

.terminal-launcher-item-label {
  font-size: 12px;
  font-weight: 700;
}

.terminal-launcher-item-detail {
  font-size: 11px;
  color: #A1A1AA;
}

.terminal-launcher-item-command {
  font-size: 10px;
  color: #71717A;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.terminal-task-action {
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #6B7280;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.terminal-task-action:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #D4D4D8;
}

.terminal-task-toggle {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.terminal-task-toggle.running {
  color: #F87171;
}

.terminal-task-toggle.running:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #F87171;
}

.terminal-task-delete {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.terminal-task-delete:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #F87171;
}

.terminal-launcher-empty {
  padding: 10px;
  color: #A1A1AA;
  font-size: 12px;
}

.file-toggle-btn.active {
  background: rgba(255, 255, 255, 0.06);
  color: #F4F4F5;
}

.terminal-running-badge {
  position: absolute;
  top: -2px;
  right: -2px;
  min-width: 12px;
  height: 12px;
  padding: 0 4px;
  border-radius: 9999px;
  background: #F97316;
  color: #18181B;
  font-size: 9px;
  font-weight: 700;
  line-height: 12px;
  text-align: center;
  box-shadow: 0 0 0 2px #1E1E1E;
}

.sidebar-body {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.file-tree-section {
  flex: 0 0 48%;
  min-height: 220px;
}

.file-session-resize {
  height: 5px;
  flex-shrink: 0;
  margin-top: -2px;
  margin-bottom: -3px;
  background: transparent;
  cursor: row-resize;
  transition: background 0.15s;
  position: relative;
  z-index: 2;
}

.file-session-resize:hover,
.file-session-resize.dragging {
  background: #F97316;
}

.session-section {
  flex: 1;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.session-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 8px;
  border-bottom: 1px solid #27272A;
  background: #1E1E1E;
  color: #D4D4D8;
  font-size: 12px;
  font-weight: 600;
}

.session-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.session-section-counts {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: flex-end;
}

.session-section-count {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: #71717A;
  font-weight: 500;
  font-size: 11px;
  line-height: 1;
}

.session-count-dot {
  width: 6px;
  height: 6px;
  border-radius: 999px;
  background: currentColor;
  flex-shrink: 0;
}

.session-section-count.total {
  color: #71717A;
}

.session-section-count.ready {
  color: #60A5FA;
}

.session-section-count.responding {
  color: #22C55E;
}

.session-add-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #6B7280;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.session-add-btn:hover {
  background: #27272A;
  color: #E4E4E7;
}

.session-list-menu-wrapper {
  position: relative;
}

.session-list-menu-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #6B7280;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.session-list-menu-btn:hover {
  background: #27272A;
  color: #E4E4E7;
}

.session-list-dropdown {
  background: #1E1E1E;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  padding: 4px 0;
  min-width: 180px;
  z-index: 1000;
  box-shadow: 0 10px 15px rgba(0, 0, 0, 0.5);
}

.menu-icon-placeholder {
  display: inline-block;
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.session-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 8px;
}

.session-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  position: relative;
}

.session-item:hover {
  background: rgba(255, 255, 255, 0.024);
  border-color: rgba(255, 255, 255, 0.13);
}

.session-item.active {
  background: rgba(249, 115, 22, 0.1);
  border-color: #F97316;
}

.session-item.permission-pending {
  overflow: hidden;
}

.session-item.permission-pending::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background:
    linear-gradient(to right, rgba(34, 197, 94, 0.5), transparent 3%, transparent 97%, rgba(34, 197, 94, 0.5)),
    linear-gradient(to bottom, rgba(34, 197, 94, 0.5), transparent 15%, transparent 85%, rgba(34, 197, 94, 0.5));
  animation: permission-blink 1.5s ease-in-out infinite;
  pointer-events: none;
  z-index: 0;
}

.session-item.permission-pending > * {
  position: relative;
  z-index: 1;
}

@keyframes permission-blink {
  0%, 100% {
    opacity: 0.3;
  }
  50% {
    opacity: 1;
  }
}

/* Three-dot menu button - 默认隐藏 */
.session-menu-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px;
  background: transparent;
  border: none;
  color: #71717A;
  cursor: pointer;
  border-radius: 4px;
  opacity: 0;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.session-menu-btn:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #E4E4E7;
}

/* Hover 时显示菜单按钮 */
.session-item:hover .session-menu-btn {
  opacity: 1;
}

/* Active 时也显示菜单按钮 */
.session-item.active .session-menu-btn {
  opacity: 1;
}

.session-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #52525B;  /* 灰色 - inactive */
  flex-shrink: 0;
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
}

.session-status-column {
  width: 16px;
  min-height: 30px;
  flex-shrink: 0;
  position: relative;
}

.session-status.ready {
  background: #60A5FA;  /* 蓝色 - ready */
  box-shadow: 0 0 6px rgba(96, 165, 250, 0.45);
}

.session-status.streaming {
  background: #22C55E;  /* 闪烁绿色 - streaming */
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
  animation: pulse 1s infinite;
}

.session-status.completed-unseen {
  background: #F59E0B;  /* 橙色 - completed but unseen */
  box-shadow: 0 0 8px rgba(245, 158, 11, 0.45);
}

.session-unavailable-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: #EF4444;
  flex-shrink: 0;
  position: absolute;
  top: 4px;
  left: 50%;
  transform: translateX(-50%);
  cursor: default;
}

.session-debug-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 14px;
  height: 14px;
  color: #F97316;
  opacity: 0.92;
  flex-shrink: 0;
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.4; }
}

.session-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.session-row1,
.session-row2,
.session-row3 {
  padding-right: 24px;
}

.session-row1 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.session-row2 {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  position: relative;
  flex-wrap: nowrap;
  white-space: nowrap;
  overflow: visible;
}

.session-row3 {
  display: flex;
  align-items: center;
}

.session-row4 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #71717A;
  flex-wrap: wrap;
  width: 100%;
}

.session-binding-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 18px;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.1px;
  border: 1px solid rgba(148, 163, 184, 0.28);
  background: rgba(63, 63, 70, 0.5);
  color: #D4D4D8;
  flex-shrink: 0;
}

.session-binding-badge.pending {
  color: #FCD34D;
  background: rgba(245, 158, 11, 0.12);
  border-color: rgba(245, 158, 11, 0.34);
}

.session-binding-badge.missing {
  color: #FCA5A5;
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.34);
}

.session-tool-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 18px;
  padding: 0 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.2px;
  border: 1px solid transparent;
  flex-shrink: 0;
  margin-left: auto;
}

.session-tool-badge.claude {
  color: #FED7AA;
  background: rgba(249, 115, 22, 0.14);
  border-color: rgba(249, 115, 22, 0.28);
}

.session-tool-badge.codex {
  color: #BFDBFE;
  background: rgba(59, 130, 246, 0.14);
  border-color: rgba(59, 130, 246, 0.28);
}

.session-name {
  display: flex;
  align-items: center;
  min-width: 0;
  font-size: 13px;
  color: #E4E4E7;
}

.session-name-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
  flex: 1;
}

.session-name .session-id {
  font-size: 11px;
  color: #71717A;
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  margin-left: 4px;
  flex-shrink: 0;
}

.session-name .session-binding-label {
  font-size: 10px;
  color: #FCD34D;
  background: rgba(245, 158, 11, 0.12);
  border: 1px solid rgba(245, 158, 11, 0.34);
  border-radius: 999px;
  padding: 0 6px;
  margin-left: 2px;
  flex-shrink: 0;
}

.config-badge {
  font-size: 10px;
  color: #F97316;
  background: rgba(249, 115, 22, 0.15);
  padding: 1px 6px;
  border-radius: 3px;
  flex-shrink: 0;
  font-weight: 500;
  border: 1px solid rgba(249, 115, 22, 0.3);
}

.session-preview {
  font-size: 12px;
  color: #A1A1AA;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.session-counts {
  font-size: 11px;
  color: #6B7280;
  flex-shrink: 0;
}

.session-counts2 {
  font-size: 11px;
  color: #6B7280;
  flex-shrink: 0;
}

.session-counts-badges {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  white-space: nowrap;
}

.count-badge-item {
  font-size: 10px;
  color: #F97316;
  background: rgba(249, 115, 22, 0.1);
  padding: 1px 6px;
  border-radius: 3px;
  white-space: nowrap;
  font-weight: 500;
  border: 1px solid rgba(249, 115, 22, 0.18);
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.badge-label {
  font-weight: 400;
  white-space: nowrap;
}

.session-model {
  font-size: 10px;
  color: #F97316;
  background: rgba(249, 115, 22, 0.1);
  padding: 1px 6px;
  border-radius: 3px;
  font-weight: 500;
  border: 1px solid rgba(249, 115, 22, 0.18);
  white-space: nowrap;
  flex-shrink: 0;
}

.session-item.unavailable {
  opacity: 0.56;
}

.session-item.unavailable.active {
  opacity: 0.72;
}

.session-counts-measure {
  position: absolute;
  visibility: hidden;
  pointer-events: none;
  white-space: nowrap;
  display: inline-flex;
  gap: 4px;
}

.empty-list {
  padding: 24px 16px;
  text-align: center;
  color: #71717A;
}

.empty-list p {
  margin: 0;
  font-size: 13px;
}

.empty-list .hint {
  margin-top: 4px;
  font-size: 11px;
  color: #71717A;
}

/* Context Menu */
.context-menu {
  position: fixed;
  background: #1E1E1E;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  padding: 4px 0;
  min-width: 120px;
  z-index: 1000;
  box-shadow: 0 10px 15px rgba(0, 0, 0, 0.5);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: none;
  color: #E4E4E7;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}

.menu-item:hover {
  background: #27272A;
}

.menu-item.warning {
  color: #F59E0B;
}

.menu-item.warning:hover {
  background: rgba(245, 158, 11, 0.1);
}

.session-binding-badge.unavailable {
  color: #FCA5A5;
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(239, 68, 68, 0.28);
}

.menu-item.success {
  color: #22C55E;
}

.menu-item.success:hover {
  background: rgba(34, 197, 94, 0.1);
}

.menu-item.danger {
  color: #EF4444;
}

.menu-item.danger:hover {
  background: rgba(239, 68, 68, 0.1);
}

.menu-divider {
  height: 1px;
  background: #3F3F46;
  margin: 4px 8px;
}

/* Confirmation Dialog */
.confirm-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.confirm-dialog {
  background: #2D2D2D;
  border: 1px solid #3F3F46;
  border-radius: 12px;
  width: 90%;
  max-width: 480px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.confirm-dialog-content {
  padding: 32px 24px;
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

.confirm-dialog-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.confirm-dialog-text {
  flex: 1;
}

.confirm-dialog-text h3 {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 600;
  color: #E5E7EB;
}

.confirm-dialog-text p {
  margin: 0 0 8px;
  font-size: 14px;
  color: #9CA3AF;
  line-height: 1.5;
}

.confirm-dialog-text p:last-child {
  margin: 0;
}

.confirm-dialog-text strong {
  color: #F4F4F5;
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 12px;
  word-break: break-all;
}

.confirm-dialog-actions {
  padding: 16px 24px;
  border-top: 1px solid #3F3F46;
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.confirm-dialog-btn {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.confirm-dialog-btn.cancel {
  background: #374151;
  color: #D1D5DB;
}

.confirm-dialog-btn.cancel:hover {
  background: #4B5563;
}

.confirm-dialog-btn.confirm {
  background: #EF4444;
  color: white;
}

.confirm-dialog-btn.confirm:hover {
  background: #DC2626;
}

/* 第三行：项目配置摘要 */
.sidebar-header-row3 {
  border-bottom: 1px solid #3F3F46;
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
  background: #1E1E1E;
}

.config-panel-header {
  padding: 10px 12px 8px;
  border-bottom: 1px solid #2C2C31;
  background: #1A1B1F;
}

.config-panel-title {
  font-size: 12px;
  font-weight: 600;
  color: #D4D4D8;
  line-height: 1;
}

.config-loading-panel {
  padding: 10px 12px 12px;
  font-size: 12px;
  color: #71717A;
}

/* 展开后的详细内容 */
.config-details {
  padding: 8px 16px 12px;
  border-top: 1px solid #2D2D2D;
  background: #1E1E1E;
  max-height: 200px;
  overflow-y: auto;
}

.detail-section {
  margin-bottom: 8px;
}

.detail-section:last-child {
  margin-bottom: 0;
}

.detail-title {
  font-size: 10px;
  color: #6B7280;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 4px;
}

.detail-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-item {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: #D1D5DB;
  padding: 2px 0;
}

.item-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.item-badge {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 2px;
  flex-shrink: 0;
}

.item-badge.base {
  background: #F97316;
  color: white;
}

.detail-empty {
  font-size: 11px;
  color: #6B7280;
  text-align: center;
  padding: 8px 0;
}

.config-loading {
  color: #9CA3AF;
  font-size: 11px;
  flex: 1;
}

/* App shell gradient trial */
.session-sidebar {
  background:
    radial-gradient(circle at top right, rgba(249, 115, 22, 0.06), transparent 22%),
    linear-gradient(180deg, #17191D 0%, #14161A 100%);
  border-right-color: rgba(255, 255, 255, 0.06);
}

.sidebar-header-row1,
.sidebar-header-row2,
.sidebar-toolbar-row,
.session-section-header {
  border-bottom-color: rgba(255, 255, 255, 0.05);
}

</style>
