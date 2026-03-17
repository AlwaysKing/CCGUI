<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAppStore } from '../../stores/useAppStore'
import { useSessionStore } from '../../stores/useSessionStore'
import { useFileBrowserStore } from '../../stores/useFileBrowserStore'
import SessionSidebar from './components/SessionSidebar.vue'
import FilePreviewPanel from './components/FilePreviewPanel.vue'
import Chat from './chat/Chat.vue'
import NewSessionDialog from './components/NewSessionDialog.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import RenameDialog from './components/RenameDialog.vue'
import ProjectSwitchDialog from './components/ProjectSwitchDialog.vue'
import SwitchConfirmDialog from './components/SwitchConfirmDialog.vue'
import ProjectConfigDialog from './components/ProjectConfigDialog.vue'
import SessionConfigDialog from './components/SessionConfigDialog.vue'
import SettingsDialog from '@/views/settings/SettingsDialog.vue'
import { useWorkspaceLayout } from './hooks/useWorkspaceLayout'
import { useWorkspaceDialogs } from './hooks/useWorkspaceDialogs'

const store = useAppStore()
const sessionStore = useSessionStore()
const fileBrowserStore = useFileBrowserStore()
const previewWidth = ref(42)
const isPreviewResizing = ref(false)
const isChatCollapsed = ref(false)
const lastExpandedPreviewWidth = ref(42)
const CHAT_MIN_WIDTH = 360
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
} = useWorkspaceDialogs({
  store,
  sessionStore,
  sessionSidebarRef,
  chatRef
})

async function handlePreviewFile(node) {
  await fileBrowserStore.previewFile(node.path)
}

async function handlePinFile(node) {
  await fileBrowserStore.pinFile(node.path)
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

  const workspaceBody = document.querySelector('.workspace-body')
  const mainContent = document.querySelector('.main-content')
  if (!workspaceBody || !mainContent) return

  const mainRect = mainContent.getBoundingClientRect()
  const previewWidthPx = event.clientX - mainRect.left
  const chatWidthPx = mainRect.right - event.clientX

  if (isChatCollapsed.value) {
    if (previewWidthPx < mainRect.width - 2) {
      isChatCollapsed.value = false
      previewWidth.value = ((mainRect.width - CHAT_MIN_WIDTH) / mainRect.width) * 100
      syncExpandedPreviewWidth()
    }
    return
  }

  if (chatWidthPx <= CHAT_MIN_WIDTH) {
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

watch(() => fileBrowserStore.shouldShowPreviewPanel, (visible) => {
  if (!visible) {
    isChatCollapsed.value = false
  } else {
    previewWidth.value = Math.max(24, Math.min(65, previewWidth.value))
    syncExpandedPreviewWidth()
  }
})

// Initialize
onMounted(async () => {
  // Fetch sessions for current project
  if (store.currentProject) {
    await store.fetchSessions(store.currentProject.id)
  }

  // Add global event listeners
  window.addEventListener('mousemove', handleResize)
  window.addEventListener('mouseup', stopResize)
  window.addEventListener('mousemove', handlePreviewResize)
  window.addEventListener('mouseup', stopPreviewResize)

  // Periodically update running sessions status (every 2 seconds)
  // This also fetches messageCount and updatedAt from memory
  const updateRunningInterval = setInterval(() => {
    store.fetchRunningSessions()
  }, 2000)

  // Store interval ID for cleanup
  window.runningSessionsInterval = updateRunningInterval
})

onUnmounted(() => {
  window.removeEventListener('mousemove', handleResize)
  window.removeEventListener('mouseup', stopResize)
  window.removeEventListener('mousemove', handlePreviewResize)
  window.removeEventListener('mouseup', stopPreviewResize)

  // Clear interval
  if (window.runningSessionsInterval) {
    clearInterval(window.runningSessionsInterval)
  }
})
</script>

<template>
  <div class="workspace-layout">
    <!-- Draggable Title Bar Area - 只在没有选择 session 时显示 -->
    <div
      v-if="!store.currentSession && !fileBrowserStore.shouldShowPreviewPanel"
      class="titlebar-drag-area"
      :style="{
        left: sidebarCollapsed ? '140px' : `${sidebarWidth}px`,
        right: 0
      }"
    ></div>

    <div class="workspace-body">
      <!-- Session Sidebar -->
      <SessionSidebar
        ref="sessionSidebarRef"
        v-show="!sidebarCollapsed"
        :style="{ width: `${sidebarWidth}px` }"
        :sessions="store.currentProjectSessions"
        :current-session="store.currentSession"
        :session-statuses="store.sessionStatuses"
        :project-path="store.currentProject?.path"
        :file-tree="fileBrowserStore.tree"
        :file-tree-loading="fileBrowserStore.isTreeLoading"
        :file-tree-error="fileBrowserStore.treeError"
        :expanded-dirs="fileBrowserStore.expandedDirs"
        :active-file-path="fileBrowserStore.activeFilePath"
        :is-file-panel-visible="fileBrowserStore.isFilePanelVisible"
        :has-open-files="fileBrowserStore.hasOpenFiles"
        :preview-panel-visible="fileBrowserStore.shouldShowPreviewPanel"
        @select="handleSelectSession"
        @delete="handleDeleteSession"
        @start="handleStartSession"
        @close="handleCloseSession"
        @newSession="handleNewSession"
        @toggle="toggleSidebar"
        @rename="handleRenameSession"
        @switchProject="handleSwitchProject"
        @home="handleGoHomeFromSidebar"
        @openAppSettings="showSettingsDialog = true"
        @openProjectConfig="handleOpenProjectConfig"
        @openSessionConfig="handleOpenSessionConfig"
        @deleteSessionConfig="handleDeleteSessionConfig"
        @copySession="handleCopySession"
        @toggleFilePanel="fileBrowserStore.toggleFilePanel"
        @togglePreviewPanel="fileBrowserStore.togglePreviewPanel"
        @refreshFileTree="fileBrowserStore.refreshTree"
        @toggleDirectory="fileBrowserStore.toggleDirectory"
        @previewFile="handlePreviewFile"
        @pinFile="handlePinFile"
      />

      <!-- Resize Handle -->
      <div
        v-show="!sidebarCollapsed"
        class="resize-handle"
        @mousedown="startResize"
      />

      <!-- Main Content -->
      <main class="main-content">
        <FilePreviewPanel
          :visible="fileBrowserStore.shouldShowPreviewPanel"
          :style="previewPanelStyle"
          :tabs="fileBrowserStore.tabs"
          :active-tab="fileBrowserStore.activeTab"
          :is-chat-collapsed="isChatCollapsed"
          @activate-tab="fileBrowserStore.setActiveTab"
          @close-tab="fileBrowserStore.closeTab"
          @close-others="fileBrowserStore.closeOtherTabs"
          @update-content="fileBrowserStore.updateTabContent"
          @save-file="fileBrowserStore.saveFile"
          @close-panel="fileBrowserStore.hidePreviewPanel"
          @toggle-chat-panel="toggleChatPanelCollapse"
        />

        <div
          v-if="fileBrowserStore.shouldShowPreviewPanel"
          class="preview-resize-handle"
          :class="{ resizing: isPreviewResizing }"
          @mousedown="startPreviewResize"
        ></div>

        <div
          v-if="store.currentSession"
          class="chat-panel-host"
          :class="{ collapsed: !shouldShowChatPanel }"
          :style="chatPanelHostStyle"
        >
          <Chat
            class="chat-panel"
            ref="chatRef"
            :sidebar-collapsed="sidebarCollapsed"
            :sidebar-width="sidebarWidth"
            :show-collapse-toggle="fileBrowserStore.shouldShowPreviewPanel"
            :is-collapsed-by-preview="isChatCollapsed"
            @toggleSidebar="toggleSidebar"
            @toggleCollapse="toggleChatPanelCollapse"
            @startSession="handleStartSession"
            @closeSession="handleCloseSession"
          />
        </div>
        <div v-if="!store.currentSession" class="empty-state-wrapper">
          <!-- Top Bar when sidebar collapsed -->
          <div v-if="sidebarCollapsed" class="empty-top-bar">
            <button
              class="expand-btn-empty"
              @click="toggleSidebar"
              title="展开侧边栏"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="9 18 15 12 9 6"/>
              </svg>
            </button>
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

.titlebar-drag-area {
  position: absolute;
  top: 0;
  height: 60px;
  -webkit-app-region: drag;
  z-index: 999;
}

.workspace-body {
  flex: 1;
  display: flex;
  overflow: hidden;
  position: relative;
}

.resize-handle {
  width: 4px;
  background: transparent;
  cursor: col-resize;
  transition: background 0.2s;
}

.resize-handle:hover {
  background: #F97316;
}

.main-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: row;
  min-width: 0;
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
}

.chat-panel-host.collapsed {
  pointer-events: none;
}

.preview-resize-handle {
  width: 4px;
  background: transparent;
  cursor: col-resize;
  transition: background 0.2s;
  flex-shrink: 0;
}

.preview-resize-handle:hover,
.preview-resize-handle.resizing {
  background: #F97316;
}

.empty-state-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.empty-top-bar {
  display: flex;
  align-items: stretch;
  padding-left: 80px;
  -webkit-app-region: drag;
  height: 41.5px;
}

.expand-btn-empty {
  padding: 4px;
  background: transparent;
  border: none;
  color: #6B7280;
  border-radius: 4px;
align-self: center;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-right: 1px solid #27272A;
  cursor: pointer;
  transition: all 0.2s;
  -webkit-app-region: no-drag;
  flex-shrink: 0;
}

.expand-btn-empty:hover {
  background: #374151;
  color: #D1D5DB;
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
</style>
