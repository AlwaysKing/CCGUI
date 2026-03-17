<script setup>
import { onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../../stores/useAppStore'
import { useSessionStore } from '../../stores/useSessionStore'
import SessionSidebar from './components/SessionSidebar.vue'
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

// Initialize
onMounted(async () => {
  // Fetch sessions for current project
  if (store.currentProject) {
    await store.fetchSessions(store.currentProject.id)
  }

  // Add global event listeners
  window.addEventListener('mousemove', handleResize)
  window.addEventListener('mouseup', stopResize)

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
      v-if="!store.currentSession"
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
      />

      <!-- Resize Handle -->
      <div
        v-show="!sidebarCollapsed"
        class="resize-handle"
        @mousedown="startResize"
      />

      <!-- Main Content -->
      <main class="main-content">
        <Chat
          v-if="store.currentSession"
          ref="chatRef"
          :sidebar-collapsed="sidebarCollapsed"
          :sidebar-width="sidebarWidth"
          @toggleSidebar="toggleSidebar"
          @startSession="handleStartSession"
          @closeSession="handleCloseSession"
        />
        <div v-else class="empty-state-wrapper">
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
  flex-direction: column;
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
