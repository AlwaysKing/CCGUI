<script setup>
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import { useAppStore } from '../../../stores/useAppStore'
import FileTreePanel from './FileTreePanel.vue'

const props = defineProps({
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
  }
})

const emit = defineEmits(['select', 'delete', 'newSession', 'toggle', 'rename', 'switchProject', 'home', 'openAppSettings', 'close', 'start', 'openProjectConfig', 'openSessionConfig', 'deleteSessionConfig', 'copySession', 'toggleFilePanel', 'togglePreviewPanel', 'refreshFileTree', 'toggleDirectory', 'previewFile', 'pinFile', 'selectFileNode', 'startRenameFileNode', 'stopRenameFileNode', 'renameFileNode', 'createFileNode', 'deleteFileNode', 'addFileToChat'])

const appStore = useAppStore()
const projectConfig = ref(null)
const systemConfig = ref(null)
const loadingConfig = ref(false)
const showConfigPanel = ref(false)
const sessionConfigs = ref({}) // Map of sessionId -> hasCustomConfig
const compactCountLabels = ref(new Set()) // Sessions with compact count labels

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
  if (!contextMenu.value.show) return
  if (contextMenuRef.value?.contains(event.target)) return
  closeContextMenu()
}

function handleGlobalContextMenu(event) {
  if (!contextMenu.value.show) return
  if (contextMenuRef.value?.contains(event.target)) return
  closeContextMenu()
}

function handleWindowBlur() {
  closeContextMenu()
}

function handleViewportChange() {
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
function getModelInfo(modelId) {
  if (!modelId || !systemConfig.value?.settings?.models) return null
  return systemConfig.value.settings.models.find(m => m.id === modelId)
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
    promptMode,
    promptIds: promptMode === 'custom' && Array.isArray(settings.promptIds) ? settings.promptIds : [],
    documentMode,
    documentIds: documentMode === 'custom' && Array.isArray(settings.documentIds) ? settings.documentIds : []
  }
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

function buildModelDisplay(modelId, modelCardId, fallbackText) {
  if (!modelId) {
    return {
      configName: fallbackText,
      cardName: null,
      text: fallbackText
    }
  }

  const model = getModelInfo(modelId)
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

function resolveProjectSettingsForDisplay() {
  const normalized = normalizeProjectSettings(projectConfig.value?.settings || {})
  const promptIds = normalized.promptMode === 'custom'
    ? normalized.promptIds
    : (normalized.promptMode === 'none' ? [] : getBasePromptIds())
  const documentIds = normalized.documentMode === 'custom'
    ? normalized.documentIds
    : (normalized.documentMode === 'none' ? [] : getBaseDocumentIds())
  const modelDisplay = normalized.modelMode === 'custom'
    ? buildModelDisplay(normalized.modelId, normalized.modelCardId, '系统')
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
  const projectResolved = resolveProjectSettingsForDisplay()

  if (!sessionConfig?.settings || Object.keys(sessionConfig.settings).length === 0) {
    return {
      ...projectResolved,
      source: 'project',
      sessionMeta: null,
      hasSessionOverride: false
    }
  }

  const normalized = normalizeSessionSettings(sessionConfig.settings)
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
    ? buildModelDisplay(normalized.modelId, normalized.modelCardId, '系统')
    : (normalized.modelMode === 'system' ? { configName: '系统', cardName: null, text: '系统' } : projectResolved.modelDisplay)
  const hasSessionOverride = normalized.modelMode !== 'project' || normalized.promptMode !== 'project' || normalized.documentMode !== 'project'

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

function handleSelect(session) {
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

function getSessionStatus(sessionId) {
  const status = props.sessionStatuses[sessionId]
  if (!status || !status.ready) return 'inactive'
  if (status.processing || status.streaming) return 'streaming'
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
    return '系统'
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
  refreshConfig
})
</script>

<template>
  <aside class="session-sidebar">
    <!-- 第一行：红绿灯占位 | Logo | 折叠按钮 -->
    <div class="sidebar-header-row1">
      <div class="traffic-light-placeholder"></div>
      <div class="header-actions">
        <span class="app-logo">CCGUI</span>
        <button class="app-settings-btn" @click="emit('openAppSettings')" title="软件配置">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
          </svg>
        </button>
      </div>
      <button class="toggle-btn" @click="emit('toggle')" title="折叠">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 6l-6 6 6 6"/>
          <path d="M20 5v14"/>
        </svg>
      </button>
    </div>
    <!-- 第二行：项目名称 | 新建按钮 -->
    <div class="sidebar-header-row2">
      <button class="home-btn" @click="emit('home')" title="返回首页">
        <svg class="home-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 10.5L12 3l9 7.5"/>
          <path d="M5 9.5V21h14V9.5"/>
          <path d="M9 21v-6h6v6"/>
        </svg>
      </button>
      <div class="sidebar-title" :title="projectPath" @click="emit('switchProject')">
        <span class="project-name">{{ getProjectName(projectPath) }}</span>
      </div>
      <button class="file-toggle-btn" @click.stop="emit('openProjectConfig')" title="项目配置">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
      <button
        class="file-toggle-btn"
        :class="{ active: showConfigPanel }"
        @click="toggleConfigPanel"
        :title="showConfigPanel ? '隐藏项目看板' : '显示项目看板'"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="4" width="18" height="16" rx="2"/>
          <path d="M9 4v16"/>
          <path d="M15 10v10"/>
        </svg>
      </button>
      <button
        class="file-toggle-btn"
        :class="{ active: isFilePanelVisible }"
        @click="emit('toggleFilePanel')"
        :title="isFilePanelVisible ? '隐藏文件列表' : '显示文件列表'"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
        </svg>
      </button>
    </div>

    <!-- 第三行：项目配置摘要 -->
    <div v-if="showConfigPanel" class="sidebar-header-row3">
      <div class="config-panel-header">
        <span class="config-panel-title">项目看板</span>
      </div>
      <div class="config-details" v-if="!loadingConfig">
        <div class="detail-section">
          <div class="detail-title">模型</div>
          <div class="detail-list">
            <div class="detail-item">
              <span class="item-name">{{ configSummary.configName }}<span v-if="configSummary.cardName" class="card-name">({{ configSummary.cardName }})</span></span>
            </div>
          </div>
        </div>
        <div class="detail-section" v-if="configSummary.prompts.length > 0">
          <div class="detail-title">提示词</div>
          <div class="detail-list">
            <div class="detail-item" v-for="prompt in configSummary.prompts" :key="prompt.id">
              <span class="item-name">{{ prompt.name }}</span>
              <span class="item-badge base" v-if="prompt.isBase">基础</span>
            </div>
          </div>
        </div>
        <div class="detail-section" v-if="configSummary.documents.length > 0">
          <div class="detail-title">文档</div>
          <div class="detail-list">
            <div class="detail-item" v-for="doc in configSummary.documents" :key="doc.id">
              <span class="item-name">{{ doc.name }}</span>
              <span class="item-badge base" v-if="doc.isBase">基础</span>
            </div>
          </div>
        </div>
        <div class="detail-empty" v-if="configSummary.prompts.length === 0 && configSummary.documents.length === 0">
          未配置提示词和文档
        </div>
      </div>
      <div v-else class="config-loading-panel">加载中...</div>
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
          </div>
          <span class="session-section-count">{{ sessions.length }}</span>
        </div>

        <div class="session-list">
          <div
            v-for="session in sessions"
            :key="session.id"
            :data-session-id="session.id"
            class="session-item"
            :class="{ active: currentSession?.id === session.id }"
            @click="handleSelect(session)"
            @contextmenu="handleContextMenu($event, session)"
          >
            <div class="session-status" :class="getSessionStatus(session.id)" />

            <div class="session-info">
              <div class="session-row1">
                <span class="session-name">
                  <span class="session-name-text">{{ getSessionName(session) }}</span>
                  <span class="session-id"> - {{ session.id.slice(0, 8) }}</span>
                </span>
              </div>
              <div v-if="sessionHasConfig(session.id)" class="session-row2" :data-session-id="session.id">
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
  background: #18181B;
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
  padding: 4px;
  background: transparent;
  border: none;
  color: #71717A;
  opacity: 0.72;
  cursor: pointer;
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: opacity 0.15s, background 0.15s, color 0.15s;
}

.app-settings-btn:hover {
  background: #3F3F46;
  color: #E4E4E7;
  opacity: 1;
}

.toggle-btn {
  padding: 4px;
  background: transparent;
  border: none;
  color: #6B7280;
  cursor: pointer;
  border-radius: 4px;
}

.toggle-btn:hover {
  background: #374151;
  color: #D1D5DB;
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

.home-btn {
  padding: 4px;
  background: transparent;
  border: none;
  color: #71717A;
  cursor: pointer;
  border-radius: 4px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.home-btn:hover {
  background: #3F3F46;
  color: #E4E4E7;
}

.sidebar-title {
  display: flex;
  align-items: center;
  font-size: 20px;
  font-weight: 700;
  color: #E4E4E7;
  letter-spacing: 0.5px;
  white-space: nowrap;
  overflow: hidden;
  cursor: pointer;
  transition: color 0.2s;
  flex: 1;
  min-width: 0;
}

.project-name {
  height: 20px;
  line-height: 20px;
  overflow: hidden;
  text-overflow: ellipsis;
  display: inline-block;
}

.sidebar-title:hover {
  color: #F4F4F5;
}

.sidebar-title + .file-toggle-btn {
  margin-left: -2px;
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
  padding: 4px;
  background: transparent;
  border: none;
  color: #6B7280;
  cursor: pointer;
  border-radius: 4px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.file-toggle-btn:hover,
.file-toggle-btn.active {
  background: #374151;
  color: #D1D5DB;
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
  background: transparent;
  cursor: row-resize;
  transition: background 0.15s;
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
  border-bottom: 1px solid #2C2C31;
  background: #1A1B1F;
  color: #D4D4D8;
  font-size: 12px;
  font-weight: 600;
}

.session-section-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.session-section-count {
  color: #71717A;
  font-weight: 500;
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
  background: #2A2D33;
  color: #E4E4E7;
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
  border: 1px solid transparent;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  position: relative;
}

.session-item:hover {
  background: #27272A;
  border-color: #3F3F46;
}

.session-item.active {
  background: rgba(249, 115, 22, 0.1);
  border-color: #F97316;
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
  background: #3F3F46;
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
  margin-top: 4px;
  flex-shrink: 0;
}

.session-status.ready {
  background: #22C55E;  /* 绿色 - ready */
  box-shadow: 0 0 6px rgba(34, 197, 94, 0.45);
}

.session-status.streaming {
  background: #22C55E;  /* 闪烁绿色 - streaming */
  box-shadow: 0 0 8px rgba(34, 197, 94, 0.5);
  animation: pulse 1s infinite;
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
  font-size: 11px;
  color: #71717A;
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
  background: #18181B;
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

</style>
