<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../../stores/useAppStore'
import Header from './Header.vue'
import ProjectSidebar from './ProjectSidebar.vue'
import SessionSidebar from './SessionSidebar.vue'
import ChatWindow from '../ChatWindow.vue'
import NewProjectDialog from '../dialogs/NewProjectDialog.vue'
import NewSessionDialog from '../dialogs/NewSessionDialog.vue'
import ConfirmDialog from '../dialogs/ConfirmDialog.vue'
import RenameDialog from '../dialogs/RenameDialog.vue'

const store = useAppStore()

// Dialog states
const showNewProjectDialog = ref(false)
const showNewSessionDialog = ref(false)
const showConfirmDialog = ref(false)
const showRenameDialog = ref(false)
const renameDialogConfig = ref({
  title: '',
  initialName: '',
  type: '', // 'project' or 'session'
  item: null
})
const confirmDialogConfig = ref({
  title: '',
  message: '',
  onConfirm: () => {}
})

// Resizable sidebar widths
const projectSidebarWidth = ref(200)
const sessionSidebarWidth = ref(240)
const isResizing = ref(null)

// Start resizing
function startResize(type, event) {
  isResizing.value = type
  event.preventDefault()
}

// Handle resize
function handleResize(event) {
  if (!isResizing.value) return

  if (isResizing.value === 'project') {
    const newWidth = event.clientX
    if (newWidth >= 150 && newWidth <= 400) {
      projectSidebarWidth.value = newWidth
    }
  } else if (isResizing.value === 'session') {
    const newWidth = event.clientX - projectSidebarWidth.value
    if (newWidth >= 180 && newWidth <= 500) {
      sessionSidebarWidth.value = newWidth
    }
  }
}

// Stop resizing
function stopResize() {
  isResizing.value = null
}

// Dialog handlers
function handleNewProject() {
  showNewProjectDialog.value = true
}

function handleNewSession() {
  if (!store.currentProject) {
    alert('请先选择一个项目')
    return
  }
  showNewSessionDialog.value = true
}

async function handleDeleteProject(project) {
  confirmDialogConfig.value = {
    title: '删除项目',
    message: `确定要从列表中移除项目 "${project.name}" 吗？\n（不会删除实际数据）`,
    onConfirm: async () => {
      await store.removeProject(project.id)
      showConfirmDialog.value = false
    }
  }
  showConfirmDialog.value = true
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

// Rename handlers
function handleRenameProject(project) {
  renameDialogConfig.value = {
    title: '重命名项目',
    initialName: project.name,
    type: 'project',
    item: project
  }
  showRenameDialog.value = true
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
    if (type === 'project') {
      await store.renameProject(item.id, newName)
    } else if (type === 'session') {
      await store.renameSession(item.id, newName)
    }
  } catch (e) {
    alert('重命名失败: ' + e.message)
  }
  showRenameDialog.value = false
}

// Sidebar expand buttons
function expandProjectSidebar() {
  store.setSidebarCollapsed('project', false)
}

function expandSessionSidebar() {
  store.setSidebarCollapsed('session', false)
}

// Keyboard shortcuts
function handleKeyboardShortcuts(event) {
  // Ignore if any dialog is open or if typing in an input
  if (showNewProjectDialog.value || showNewSessionDialog.value ||
      showConfirmDialog.value || showRenameDialog.value) {
    return
  }

  const isInputFocused = document.activeElement?.tagName === 'INPUT' ||
                         document.activeElement?.tagName === 'TEXTAREA' ||
                         document.activeElement?.isContentEditable

  if (isInputFocused) return

  // Cmd/Ctrl + N: New session
  if ((event.metaKey || event.ctrlKey) && event.key === 'n' && !event.shiftKey) {
    event.preventDefault()
    handleNewSession()
    return
  }

  // Cmd/Ctrl + Shift + N: New project
  if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === 'N') {
    event.preventDefault()
    handleNewProject()
    return
  }

  // Cmd/Ctrl + B: Toggle sidebars
  if ((event.metaKey || event.ctrlKey) && event.key === 'b') {
    event.preventDefault()
    // Toggle both sidebars
    const bothCollapsed = store.sidebarCollapsed.project && store.sidebarCollapsed.session
    store.setSidebarCollapsed('project', !bothCollapsed)
    store.setSidebarCollapsed('session', !bothCollapsed)
    return
  }

  // Cmd/Ctrl + 1: Toggle project sidebar
  if ((event.metaKey || event.ctrlKey) && event.key === '1') {
    event.preventDefault()
    store.toggleSidebar('project')
    return
  }

  // Cmd/Ctrl + 2: Toggle session sidebar
  if ((event.metaKey || event.ctrlKey) && event.key === '2') {
    event.preventDefault()
    store.toggleSidebar('session')
    return
  }
}

// Initialize
onMounted(async () => {
  await store.fetchProjects()

  // Auto-select first project if available
  if (store.projects.length > 0 && !store.currentProject) {
    store.selectProject(store.projects[0])
  }

  // Add global event listeners
  window.addEventListener('mousemove', handleResize)
  window.addEventListener('mouseup', stopResize)
  window.addEventListener('keydown', handleKeyboardShortcuts)
})

onUnmounted(() => {
  window.removeEventListener('mousemove', handleResize)
  window.removeEventListener('mouseup', stopResize)
  window.removeEventListener('keydown', handleKeyboardShortcuts)
})
</script>

<template>
  <div class="app-layout">
    <!-- Header -->
    <Header
      :project-name="store.currentProject?.name"
      @new-project="handleNewProject"
      @new-session="handleNewSession"
    />

    <div class="app-body">
      <!-- Collapsed Project Sidebar Toggle -->
      <div v-if="store.sidebarCollapsed.project" class="collapsed-toggle project-toggle" @click="expandProjectSidebar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        <span>项目</span>
      </div>

      <!-- Project Sidebar -->
      <ProjectSidebar
        v-if="!store.sidebarCollapsed.project"
        :style="{ width: `${projectSidebarWidth}px` }"
        :projects="store.projects"
        :current-project="store.currentProject"
        @select="store.selectProject"
        @delete="handleDeleteProject"
        @rename="handleRenameProject"
        @toggle="store.toggleSidebar('project')"
      />
      <div
        v-if="!store.sidebarCollapsed.project"
        class="resize-handle"
        @mousedown="startResize('project', $event)"
      />

      <!-- Collapsed Session Sidebar Toggle -->
      <div v-if="store.sidebarCollapsed.session" class="collapsed-toggle session-toggle" @click="expandSessionSidebar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
        <span>会话</span>
      </div>

      <!-- Session Sidebar -->
      <SessionSidebar
        v-if="!store.sidebarCollapsed.session"
        :style="{ width: `${sessionSidebarWidth}px` }"
        :sessions="store.currentProjectSessions"
        :current-session="store.currentSession"
        :running-sessions="store.runningSessions"
        @select="store.openSession"
        @delete="handleDeleteSession"
        @rename="handleRenameSession"
        @new-session="handleNewSession"
        @toggle="store.toggleSidebar('session')"
      />
      <div
        v-if="!store.sidebarCollapsed.session"
        class="resize-handle"
        @mousedown="startResize('session', $event)"
      />

      <!-- Main Content -->
      <main class="main-content">
        <ChatWindow v-if="store.currentSession" />
        <div v-else class="empty-state">
          <p>选择或创建一个会话开始聊天</p>
        </div>
      </main>
    </div>

    <!-- Dialogs -->
    <NewProjectDialog
      v-if="showNewProjectDialog"
      @close="showNewProjectDialog = false"
      @created="showNewProjectDialog = false"
    />

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
  </div>
</template>

<style scoped>
.app-layout {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #1E1E1E;
  color: #E4E4E7;
}

.app-body {
  flex: 1;
  display: flex;
  overflow: hidden;
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

.collapsed-toggle {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 8px 4px;
  background: #252526;
  border-right: 1px solid #3F3F46;
  cursor: pointer;
  color: #6B7280;
  font-size: 11px;
  transition: all 0.2s;
}

.collapsed-toggle:hover {
  background: #374151;
  color: #D1D5DB;
}

.main-content {
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6B7280;
  font-size: 16px;
}
</style>
