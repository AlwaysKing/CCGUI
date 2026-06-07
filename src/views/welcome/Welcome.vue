<script setup>
import { computed, defineAsyncComponent, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { IconButton } from '@/components/base'
import { useAppStore } from '../../stores/useAppStore'
import NewProjectDialog from './components/NewProjectDialog.vue'
import { logger } from '../../utils/logger'
import { useWelcomeProjects } from './hooks/useWelcomeProjects'
import { useProjectDrop } from './hooks/useProjectDrop'
import { useDialogStack } from '../../composables/useDialogStack'

const SettingsDialog = defineAsyncComponent(() => import('@/views/settings/SettingsDialog.vue'))
const SkillsDialog = defineAsyncComponent(() => import('@/views/tools/SkillsDialog.vue'))
const McpDialog = defineAsyncComponent(() => import('@/views/tools/McpDialog.vue'))
const ProviderDialog = defineAsyncComponent(() => import('@/views/tools/ProviderDialog.vue'))
const PromptDialog = defineAsyncComponent(() => import('@/views/tools/PromptDialog.vue'))
const TaskTemplatesDialog = defineAsyncComponent(() => import('@/views/tools/TaskTemplatesDialog.vue'))

const store = useAppStore()
const version = __APP_VERSION__

const props = defineProps({
  dockDropPath: {
    type: String,
    default: null
  }
})

const emit = defineEmits(['dock-drop-consumed'])
const {
  searchQuery,
  showSettingsDialog,
  showOldProjects,
  showMissingProjects,
  showDeleteConfirm,
  projectToDelete,
  deleteProjectFolder,
  isClearingMissing,
  categorizedProjects,
  categoryCounts,
  selectProject,
  handleDeleteClick,
  cancelDelete,
  confirmDeleteProject,
  checkProjectsExistence,
  clearMissingProjects,
  formatLastActive
} = useWelcomeProjects(store)

const showConfigMenu = ref(false)
const showSkillsDialog = ref(false)
const showMcpDialog = ref(false)
const showClaudeDialog = ref(false)
const showCodexDialog = ref(false)
const showPromptDialog = ref(false)
const showTaskTemplatesDialog = ref(false)
const configMenuRef = ref(null)
const configMenuBtnRef = ref(null)
const configMenuDropdownStyle = ref({})

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

function toggleConfigMenu() {
  showConfigMenu.value = !showConfigMenu.value
  if (showConfigMenu.value) {
    updateConfigMenuPosition()
  }
}

function closeConfigMenu() {
  showConfigMenu.value = false
}

function handleConfigMenuPointerDown(event) {
  if (!showConfigMenu.value) return
  if (configMenuRef.value?.contains(event.target)) return
  if (configMenuBtnRef.value?.contains(event.target)) return
  closeConfigMenu()
}

const {
  isDragging,
  initialProjectPath,
  showNewProjectDialog,
  handleDragEnter,
  handleDragOver,
  handleDragLeave,
  handleDrop,
  resetNewProjectDialog
} = useProjectDrop(store, logger)

useDialogStack(computed(() => showDeleteConfirm.value), cancelDelete)

onMounted(async () => {
  const mountedAt = performance.now()
  logger.info('[Welcome] mount start', { sinceMountedMs: 0 })

  const fetchProjectsStartedAt = performance.now()
  await store.fetchProjects()
  logger.info('[Welcome] fetchProjects complete', {
    elapsedMs: Math.round(performance.now() - fetchProjectsStartedAt)
  })

  const existenceCheckStartedAt = performance.now()
  await checkProjectsExistence()
  logger.info('[Welcome] checkProjectsExistence complete', {
    elapsedMs: Math.round(performance.now() - existenceCheckStartedAt)
  })

  window.addEventListener('ccgui-shortcut', handleShortcutEvent)
  window.addEventListener('pointerdown', handleConfigMenuPointerDown, true)
  window.addEventListener('resize', updateConfigMenuPosition)

  logger.info('[Welcome] mount complete', {
    sinceMountedMs: Math.round(performance.now() - mountedAt)
  })

  // 处理 Dock 拖拽文件夹：自动弹出新建项目对话框
  if (props.dockDropPath) {
    logger.info('[Welcome] Dock drop path received, checking project existence', { path: props.dockDropPath })

    // 检查是否已有该项目（防止竞态）
    const found = store.projects.find(project => project.path === props.dockDropPath)
    if (found) {
      logger.info('[Welcome] Dock drop path already has a project, opening it', { projectId: found.id })
      store.selectProject(found)
      emit('dock-drop-consumed')
    } else {
      logger.info('[Welcome] Dock drop path has no project, opening new project dialog', { path: props.dockDropPath })
      initialProjectPath.value = props.dockDropPath
      showNewProjectDialog.value = true
      emit('dock-drop-consumed')
    }
  }
})

onUnmounted(() => {
  window.removeEventListener('ccgui-shortcut', handleShortcutEvent)
  window.removeEventListener('pointerdown', handleConfigMenuPointerDown, true)
  window.removeEventListener('resize', updateConfigMenuPosition)
})

async function refreshProjects() {
  await store.fetchProjects()
  await checkProjectsExistence()
}

async function openCCAgent() {
  try {
    const project = await store.ensureCCAgentProject()
    if (project) {
      store.selectProject(project)
    }
  } catch (e) {
    logger.error('[Welcome] Failed to open CCAgent', { error: e.message })
  }
}

async function openProjectInFinder(event, project) {
  event.stopPropagation()

  if (!project?.path) {
    return
  }

  await window.electronAPI.openProjectEntryInFinder({
    projectPath: project.path,
    targetPath: '.',
    mode: 'open'
  })
}

function handleShortcutEvent(event) {
  const action = event?.detail?.action

  if (action === 'open-settings') {
    closeConfigMenu()
    showSettingsDialog.value = true
    return
  }

  if (action === 'create-primary') {
    showNewProjectDialog.value = true
  }
}
</script>

<template>
  <div
    class="welcome-page"
    :class="{ 'drag-over': isDragging }"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
    <!-- Config Menu Button - 右上角 -->
    <div class="config-menu-wrapper" ref="configMenuBtnRef">
      <IconButton class="settings-btn" size="lg" @click="toggleConfigMenu" title="配置">
        <svg class="settings-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
          <button class="menu-item" @click="showClaudeDialog = true; closeConfigMenu()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 6h16"/>
              <path d="M4 12h16"/>
              <path d="M4 18h10"/>
            </svg>
            Claude 面板
          </button>
          <button class="menu-item" @click="showCodexDialog = true; closeConfigMenu()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="3" y="3" width="18" height="18" rx="3"/>
              <path d="M8 8h8v8H8z"/>
            </svg>
            Codex 面板
          </button>
          <div class="menu-divider"></div>
          <button class="menu-item" @click="showPromptDialog = true; closeConfigMenu()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            提示词面板
          </button>
          <button class="menu-item" @click="showTaskTemplatesDialog = true; closeConfigMenu()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2H3V5z"/>
              <path d="M3 9h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z"/>
              <path d="M8 13h8"/>
              <path d="M12 9v8"/>
            </svg>
            任务模板
          </button>
          <div class="menu-divider"></div>
          <button class="menu-item" @click="showSkillsDialog = true; closeConfigMenu()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 0 1-8 0"/>
            </svg>
            技能管理
          </button>
          <button class="menu-item" @click="showMcpDialog = true; closeConfigMenu()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
              <line x1="6" y1="6" x2="6.01" y2="6"/>
              <line x1="6" y1="18" x2="6.01" y2="18"/>
            </svg>
            MCP 服务
          </button>
          <div class="menu-divider"></div>
          <button class="menu-item" @click="showSettingsDialog = true; closeConfigMenu()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            设置
          </button>
        </div>
      </Teleport>
    </div>

    <div class="welcome-header">
      <div class="logo">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 2L2 7l10 5 10-5 10 5z"/>
          <path d="M2 17l10 5 10-5"/>
          <path d="M2 12l10 5 10-5"/>
        </svg>
      </div>
      <h1>Claude Code GUI</h1>
      <p class="subtitle">选择一个项目开始工作</p>
      <p class="version">{{ version }}</p>
    </div>

    <div class="search-bar">
      <div class="search-input-wrapper">
        <svg class="search-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"/>
          <path d="m21 21-4.35-4.35"/>
        </svg>
        <input
          v-model="searchQuery"
          type="text"
          placeholder="搜索项目..."
          class="search-input"
        />
      </div>
      <button class="ccagent-btn" @click="openCCAgent" title="CCAgent">
        <svg width="32" height="32" viewBox="0 0 24 24" shape-rendering="geometricPrecision" fill="currentColor" stroke="none">
          <polygon points="12,1.5 12.8,8.5 12,11.2 11.2,8.5"/>
          <polygon points="19.4,4.6 15.0,10.1 12.6,11.4 13.9,9.0"/>
          <polygon points="22.5,12 15.5,12.8 12.8,12 15.5,11.2"/>
          <polygon points="19.4,19.4 13.9,15.0 12.6,12.6 15.0,13.9"/>
          <polygon points="12,22.5 11.2,15.5 12,12.8 12.8,15.5"/>
          <polygon points="4.6,19.4 9.0,13.9 11.4,12.6 10.1,15.0"/>
          <polygon points="1.5,12 8.5,11.2 11.2,12 8.5,12.8"/>
          <polygon points="4.6,4.6 10.1,9.0 11.4,11.4 9.0,10.1"/>
        </svg>
      </button>
    </div>

    <div class="projects-container">
      <!-- 近期项目 -->
      <div class="project-section">
        <div class="section-header">
          <h4 class="section-title">近期项目</h4>
          <span class="section-count">{{ categoryCounts.recent }}</span>
          <IconButton class="section-refresh-btn" size="sm" @click="refreshProjects" title="刷新项目列表">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 2v6h-6"/>
              <path d="M3 12a9 9 0 0 1 15.55-6.36L21 8"/>
              <path d="M3 22v-6h6"/>
              <path d="M21 12a9 9 0 0 1-15.55 6.36L3 16"/>
            </svg>
          </IconButton>
        </div>
        <div class="projects-grid">
          <!-- New Project Card -->
          <div class="project-card new-project" @click="showNewProjectDialog = true">
            <div class="new-project-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </div>
            <span>新建项目</span>
          </div>

          <!-- Recent Project Cards -->
          <div
            v-for="project in categorizedProjects.recent"
            :key="project.id"
            class="project-card"
            @click="selectProject(project)"
          >
            <div class="project-actions">
              <IconButton class="project-action-btn" size="sm" @click="openProjectInFinder($event, project)" title="在 Finder 中打开">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2z"/>
                </svg>
              </IconButton>
              <IconButton class="project-action-btn" size="sm" danger @click="handleDeleteClick($event, project)" title="删除项目">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </IconButton>
            </div>
            <div class="project-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div class="project-info">
              <h3 class="project-name">
                <span class="project-name-text">{{ project.name }}</span>
                <span v-if="project.sourceFlags?.claude || project.sourceFlags?.codex" class="project-badges">
                  <span v-if="project.sourceFlags?.claude" class="source-badge claude-badge">Claude</span>
                  <span v-if="project.sourceFlags?.codex" class="source-badge codex-badge">Codex</span>
                </span>
              </h3>
              <p class="project-path">{{ project.path }}</p>
              <div class="project-meta">
                <span>{{ project.sessionCount || 0 }} 个会话</span>
                <span class="dot">·</span>
                <span>{{ formatLastActive(project.lastActiveAt) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 旧项目（10天外） -->
      <div v-if="categoryCounts.old > 0" class="project-section">
        <button class="section-toggle" @click="showOldProjects = !showOldProjects">
          <svg
            class="toggle-icon"
            :class="{ rotated: showOldProjects }"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="9 18 15 12 9 6"/>
          </svg>
          <h4 class="section-title">旧项目</h4>
          <span class="section-count">{{ categoryCounts.old }}</span>
          <span class="section-hint">（超过10天未使用）</span>
        </button>
        <div v-if="showOldProjects" class="projects-grid">
          <div
            v-for="project in categorizedProjects.old"
            :key="project.id"
            class="project-card old"
            @click="selectProject(project)"
          >
            <div class="project-actions">
              <IconButton class="project-action-btn" size="sm" @click="openProjectInFinder($event, project)" title="在 Finder 中打开">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2z"/>
                </svg>
              </IconButton>
              <IconButton class="project-action-btn" size="sm" danger @click="handleDeleteClick($event, project)" title="删除项目">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </IconButton>
            </div>
            <div class="project-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
            </div>
            <div class="project-info">
              <h3 class="project-name">
                <span class="project-name-text">{{ project.name }}</span>
                <span v-if="project.sourceFlags?.claude || project.sourceFlags?.codex" class="project-badges">
                  <span v-if="project.sourceFlags?.claude" class="source-badge claude-badge">Claude</span>
                  <span v-if="project.sourceFlags?.codex" class="source-badge codex-badge">Codex</span>
                </span>
              </h3>
              <p class="project-path">{{ project.path }}</p>
              <div class="project-meta">
                <span>{{ project.sessionCount || 0 }} 个会话</span>
                <span class="dot">·</span>
                <span>{{ formatLastActive(project.lastActiveAt) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- 不存在的项目 -->
      <div v-if="categoryCounts.missing > 0" class="project-section">
        <button class="section-toggle" @click="showMissingProjects = !showMissingProjects">
          <svg
            class="toggle-icon"
            :class="{ rotated: showMissingProjects }"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <polyline points="9 18 15 12 9 6"/>
          </svg>
          <h4 class="section-title missing-title">不存在的项目</h4>
          <span class="section-count">{{ categoryCounts.missing }}</span>
          <span class="section-hint">（文件夹已删除）</span>
        </button>
        <div v-if="showMissingProjects" class="missing-actions-row">
          <button
            class="missing-clean-btn"
            :disabled="isClearingMissing"
            @click="clearMissingProjects"
          >
            {{ isClearingMissing ? '清理中...' : '清理所有不存在项目' }}
          </button>
        </div>
        <div v-if="showMissingProjects" class="projects-grid">
          <div
            v-for="project in categorizedProjects.missing"
            :key="project.id"
            class="project-card missing"
            @click="selectProject(project)"
          >
            <div class="project-actions">
              <IconButton class="project-action-btn" size="sm" @click="openProjectInFinder($event, project)" title="在 Finder 中打开">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5l2 2h9a2 2 0 0 1 2 2z"/>
                </svg>
              </IconButton>
              <IconButton class="project-action-btn" size="sm" danger @click="handleDeleteClick($event, project)" title="删除项目">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </IconButton>
            </div>
            <div class="project-icon missing-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                <line x1="2" y1="2" x2="22" y2="22" stroke-width="2.5"/>
              </svg>
            </div>
            <div class="project-info">
              <h3 class="project-name">
                <span class="project-name-text">{{ project.name }}</span>
                <span v-if="project.sourceFlags?.claude || project.sourceFlags?.codex" class="project-badges">
                  <span v-if="project.sourceFlags?.claude" class="source-badge claude-badge">Claude</span>
                  <span v-if="project.sourceFlags?.codex" class="source-badge codex-badge">Codex</span>
                </span>
                <span class="missing-badge">不存在</span>
              </h3>
              <p class="project-path">{{ project.path }}</p>
              <div class="project-meta">
                <span>{{ project.sessionCount || 0 }} 个会话</span>
                <span class="dot">·</span>
                <span>{{ formatLastActive(project.lastActiveAt) }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div v-if="store.projects.length === 0 && !store.isLoading" class="empty-state">
        <p>还没有任何项目</p>
        <p class="hint">点击上方"新建项目"添加一个项目</p>
      </div>
    </div>

    <!-- New Project Dialog -->
    <NewProjectDialog
      v-if="showNewProjectDialog"
      :initial-path="initialProjectPath"
      @close="resetNewProjectDialog"
      @created="resetNewProjectDialog"
    />

    <!-- Settings Dialog -->
    <SettingsDialog
      v-if="showSettingsDialog"
      @close="showSettingsDialog = false"
    />

    <!-- Skills Dialog -->
    <SkillsDialog
      v-if="showSkillsDialog"
      @close="showSkillsDialog = false"
    />

    <!-- MCP Dialog -->
    <McpDialog
      v-if="showMcpDialog"
      @close="showMcpDialog = false"
    />

    <ProviderDialog
      v-if="showClaudeDialog"
      provider="claude"
      @close="showClaudeDialog = false"
    />

    <ProviderDialog
      v-if="showCodexDialog"
      provider="codex"
      @close="showCodexDialog = false"
    />

    <PromptDialog
      v-if="showPromptDialog"
      @close="showPromptDialog = false"
    />

    <TaskTemplatesDialog
      v-if="showTaskTemplatesDialog"
      :project-id="''"
      @close="showTaskTemplatesDialog = false"
    />

    <!-- Delete Project Confirmation Dialog -->
    <div v-if="showDeleteConfirm" class="confirm-dialog-overlay">
      <div class="confirm-dialog" @click.stop>
        <div class="confirm-dialog-content">
          <div class="confirm-dialog-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 2L12 12"/>
              <path d="M12 22L7 10"/>
              <line x1="12" y1="12" x2="22" y2="12"/>
            </svg>
          </div>
          <div class="confirm-dialog-text">
            <h3>确认删除项目？</h3>
            <p>此操作将删除项目的所有会话和相关数据，无法恢复。</p>
            <p><strong>{{ projectToDelete?.path }}</strong></p>
            <label class="checkbox-label">
              <input type="checkbox" v-model="deleteProjectFolder" />
              <span>同时删除实际项目文件夹</span>
            </label>
            <p v-if="deleteProjectFolder" class="warning-text">
              ⚠️ 警告：项目文件夹将被永久删除，无法恢复！
            </p>
          </div>
        </div>
        <div class="confirm-dialog-actions">
          <button class="confirm-dialog-btn cancel" @click="cancelDelete">
            取消
          </button>
          <button class="confirm-dialog-btn confirm" @click="confirmDeleteProject">
            删除
          </button>
        </div>
      </div>
    </div>

    <!-- Drag Overlay (always in DOM, controlled by opacity) -->
    <div class="drag-overlay" :class="{ 'drag-active': isDragging }">
      <div class="drag-content">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <p>拖放文件夹到此处</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.welcome-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 0 0;
  position: relative;
}

.welcome-page::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 32px;
  -webkit-app-region: drag;
  z-index: 999;
}

.config-menu-wrapper {
  position: absolute;
  top: 12px;
  right: 16px;
  z-index: 1000;
  -webkit-app-region: no-drag;
}

.config-menu-wrapper .settings-btn {
  position: static;
}

.config-menu-dropdown {
  background: #1E1E1E;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  padding: 4px 0;
  min-width: 180px;
  z-index: 1000;
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

.config-menu-dropdown .menu-divider {
  height: 1px;
  background: #3F3F46;
  margin: 4px 8px;
}

.settings-icon {
  transition: transform 0.2s ease-in-out;
}

.settings-btn:hover .settings-icon {
  transform: rotate(45deg);
}

.settings-btn:active .settings-icon {
  transform: rotate(90deg);
}

.welcome-header {
  text-align: center;
  margin-bottom: 48px;
  flex-shrink: 0;
  padding: 0 32px;
}

.logo {
  color: #F97316;
  margin-bottom: 16px;
}

.welcome-header h1 {
  font-size: 32px;
  font-weight: 700;
  color: #F4F4F5;
  margin: 0 0 8px;
}

.subtitle {
  font-size: 16px;
  color: #71717A;
  margin: 0;
}

.welcome-header .version {
  font-size: 12px;
  color: #52525B;
  margin: 6px 0 0;
}

.search-bar {
  position: relative;
  width: 100%;
  max-width: 600px;
  margin-bottom: 32px;
  flex-shrink: 0;
  padding: 0 32px;
}

.search-input-wrapper {
  position: relative;
}

.search-icon {
  position: absolute;
  left: 16px;
  top: 50%;
  transform: translateY(-50%);
  color: #71717A;
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 12px 12px 12px 48px;
  background: rgba(255, 255, 255, 0.024);
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 12px;
  color: #F4F4F5;
  font-size: 14px;
  transition: background 0.2s, border-color 0.2s, box-shadow 0.2s;
  box-sizing: border-box;
}

.search-input:focus {
  outline: none;
  border-color: #F97316;
  background: rgba(255, 255, 255, 0.05);
  box-shadow: 0 0 0 3px rgba(249, 115, 22, 0.1);
}

.search-input::placeholder {
  color: #71717A;
}

.ccagent-btn {
  position: absolute;
  right: -30px;
  top: 50%;
  transform: translateY(-50%);
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #A1A1AA;
  transition: all 0.2s;
  padding: 0;
}

.ccagent-btn:hover {
  background: rgba(249, 115, 22, 0.12);
  border-color: rgba(249, 115, 22, 0.3);
  color: #F97316;
}

.ccagent-btn:active {
  background: rgba(249, 115, 22, 0.18);
}

.projects-container {
  flex: 1;
  overflow-y: auto;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 0 32px 0;
}

.project-section {
  width: 100%;
  max-width: 1200px;
  margin-bottom: 32px;
  padding: 0 32px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid #3F3F46;
}

.section-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 0;
  background: transparent;
  border: none;
  border-bottom: 1px solid #3F3F46;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 16px;
}

.section-toggle:hover {
  background: rgba(255, 255, 255, 0.02);
}

.toggle-icon {
  color: #71717A;
  transition: transform 0.2s;
}

.toggle-icon.rotated {
  transform: rotate(90deg);
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: #A1A1AA;
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.missing-title {
  color: #EF4444;
}

.section-count {
  font-size: 12px;
  color: #71717A;
  background: #27272A;
  padding: 2px 8px;
  border-radius: 12px;
  font-weight: 500;
}

.section-refresh-btn {
  width: 26px;
  height: 26px;
  margin-left: 2px;
}

.section-hint {
  font-size: 11px;
  color: #52525B;
  margin-left: auto;
}

.missing-actions-row {
  display: flex;
  justify-content: flex-end;
  margin: -4px 0 12px;
}

.missing-clean-btn {
  padding: 5px 10px;
  background: transparent;
  border: 1px solid rgba(239, 68, 68, 0.26);
  border-radius: 7px;
  color: #F87171;
  font-size: 12px;
  line-height: 1.2;
  cursor: pointer;
  transition: background 0.18s, border-color 0.18s, color 0.18s;
}

.missing-clean-btn:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.34);
  color: #FCA5A5;
}

.missing-clean-btn:disabled {
  opacity: 0.6;
  cursor: default;
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
  gap: 16px;
  width: 100%;
}

.project-card {
  background: rgba(255, 255, 255, 0.024);
  border: 1px solid rgba(255, 255, 255, 0.13);
  border-radius: 12px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: flex-start;
  gap: 16px;
  position: relative;
}

.project-actions {
  position: absolute;
  top: 12px;
  right: 12px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.project-action-btn {
  opacity: 0;
}

.project-card:hover .project-action-btn {
  opacity: 1;
}

.project-badges {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.source-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 20px;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.2px;
  border: 1px solid transparent;
}

.claude-badge {
  color: #FED7AA;
  background: rgba(249, 115, 22, 0.14);
  border-color: rgba(249, 115, 22, 0.28);
}

.codex-badge {
  color: #BFDBFE;
  background: rgba(59, 130, 246, 0.14);
  border-color: rgba(59, 130, 246, 0.28);
}

.project-card:hover {
  background: rgba(255, 255, 255, 0.05);
  border-color: rgba(255, 255, 255, 0.18);
  transform: translateY(-2px);
}

.project-card.new-project {
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 92px;
  padding-top: 16px;
  padding-bottom: 16px;
  border-style: dashed;
}

.project-card.new-project:hover {
  border-color: rgba(249, 115, 22, 0.42);
}

.new-project-icon {
  color: #71717A;
  margin-bottom: 6px;
}

.project-card.new-project:hover .new-project-icon {
  color: #F97316;
}

.project-card.new-project span {
  color: #A1A1AA;
  font-size: 14px;
}

.project-card.old {
  opacity: 0.7;
}

.project-card.old:hover {
  opacity: 1;
}

.project-card.missing {
  opacity: 0.5;
  border-color: rgba(248, 113, 113, 0.3);
  background: rgba(255, 255, 255, 0.024);
}

.project-card.missing:hover {
  opacity: 0.8;
  background: rgba(255, 255, 255, 0.05);
}

.project-icon {
  color: #F97316;
  flex-shrink: 0;
}

.project-icon.missing-icon {
  color: #EF4444;
  position: relative;
}

.project-info {
  flex: 1;
  min-width: 0;
  padding-right: 72px;
}

.project-name {
  font-size: 16px;
  font-weight: 600;
  color: #F4F4F5;
  margin: 0 0 4px;
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}

.project-name-text {
  min-width: 0;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.missing-badge {
  font-size: 11px;
  font-weight: 500;
  color: #EF4444;
  background: rgba(239, 68, 68, 0.2);
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.project-path {
  font-size: 12px;
  color: #71717A;
  margin: 0 0 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.project-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #52525B;
}

.dot {
  color: #3F3F46;
}

.empty-state {
  text-align: center;
  color: #71717A;
  padding: 48px;
}

.empty-state p {
  margin: 0;
  font-size: 16px;
}

.empty-state .hint {
  margin-top: 8px;
  font-size: 14px;
  color: #52525B;
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
  z-index: 2100;
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

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 12px;
  background: rgba(239, 68, 68, 0.05);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.checkbox-label:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
}

.checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #EF4444;
}

.checkbox-label span {
  font-size: 14px;
  color: #E5E7EB;
  user-select: none;
}

.warning-text {
  margin-top: 12px !important;
  padding: 8px 12px;
  background: rgba(239, 68, 68, 0.1);
  border-left: 3px solid #EF4444;
  border-radius: 4px;
  font-size: 13px !important;
  color: #FCA5A5 !important;
}

/* Drag & Drop Styles */
.welcome-page.drag-over {
  /* 不要设置 pointer-events: none，否则会阻止 drop 事件 */
}

.welcome-page.drag-over::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(96, 165, 250, 0.1);
  border: 3px dashed #60A5FA;
  border-radius: 8px;
  z-index: 1000;
  pointer-events: none;
}

.drag-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(96, 165, 250, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease-in-out;
}

.drag-overlay.drag-active {
  opacity: 1;
}

.drag-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: white;
}

.drag-content svg {
  opacity: 0.9;
}

.drag-content p {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
}

/* App shell gradient trial */
.welcome-page {
  background:
    radial-gradient(circle at top right, rgba(249, 115, 22, 0.08), transparent 24%),
    radial-gradient(circle at top left, rgba(255, 255, 255, 0.03), transparent 18%),
    linear-gradient(180deg, #121316 0%, #17191D 100%);
}
</style>
