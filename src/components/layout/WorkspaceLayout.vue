<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../../stores/useAppStore'
import SessionSidebar from './SessionSidebar.vue'
import ChatWindow from '../ChatWindow.vue'
import NewSessionDialog from '../dialogs/NewSessionDialog.vue'
import ConfirmDialog from '../dialogs/ConfirmDialog.vue'
import RenameDialog from '../dialogs/RenameDialog.vue'

const store = useAppStore()

// Dialog states
const showNewSessionDialog = ref(false)
const showConfirmDialog = ref(false)
const showRenameDialog = ref(false)
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

// Sidebar width (resizable)
const sidebarWidth = ref(260)
const isResizing = ref(false)
const sidebarCollapsed = ref(false)

// Toggle sidebar
function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
}

// Start resizing
function startResize(event) {
  isResizing.value = true
  event.preventDefault()
}

// Handle resize
function handleResize(event) {
  if (!isResizing.value) return

  const newWidth = event.clientX
  if (newWidth >= 180 && newWidth <= 500) {
    sidebarWidth.value = newWidth
  }
}

// Stop resizing
function stopResize() {
  isResizing.value = null
}

// Dialog handlers
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
  } catch (e) {
    alert('重命名失败: ' + e.message)
  }
  showRenameDialog.value = false
}

// Go back to welcome page
function goBack() {
  store.currentProject = null
  store.currentSession = null
  store.sessions = []
}

// Handle session selection
async function handleSelectSession(sessionId) {
  // Find the session object from the list
  const session = store.currentProjectSessions.find(s => s.id === sessionId)
  if (session) {
    try {
      await store.selectSession(session)
    } catch (e) {
      console.error('Failed to select session:', e)
      alert('打开会话失败: ' + e.message)
    }
  }
}

// Initialize
onMounted(async () => {
  // Fetch sessions for current project
  if (store.currentProject) {
    await store.fetchSessions(store.currentProject.id)
  }

  // Add global event listeners
  window.addEventListener('mousemove', handleResize)
  window.addEventListener('mouseup', stopResize)

  // Periodically update running sessions
  const updateInterval = setInterval(() => {
    store.fetchRunningSessions()
  }, 2000) // Update every 2 seconds

  // Store interval ID for cleanup
  window.runningSessionsInterval = updateInterval
})

onUnmounted(() => {
  window.removeEventListener('mousemove', handleResize)
  window.removeEventListener('mouseup', stopResize)

  // Clear running sessions update interval
  if (window.runningSessionsInterval) {
    clearInterval(window.runningSessionsInterval)
  }
})
</script>

<template>
  <div class="workspace-layout">
    <div class="workspace-body">
      <!-- Session Sidebar -->
      <SessionSidebar
        v-show="!sidebarCollapsed"
        :style="{ width: `${sidebarWidth}px` }"
        :sessions="store.currentProjectSessions"
        :current-session="store.currentSession"
        :running-sessions="store.runningSessions"
        :project-path="store.currentProject?.path"
        @select="handleSelectSession"
        @delete="handleDeleteSession"
        @rename="handleRenameSession"
        @new-session="handleNewSession"
        @toggle="toggleSidebar"
      />

      <!-- Resize Handle -->
      <div
        v-show="!sidebarCollapsed"
        class="resize-handle"
        @mousedown="startResize"
      />

      <!-- Expand Button (when collapsed) - 绝对定位 -->
      <button
        v-show="sidebarCollapsed"
        class="expand-btn-floating"
        @click="toggleSidebar"
        title="展开侧边栏"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>

      <!-- Main Content -->
      <main class="main-content">
        <ChatWindow v-if="store.currentSession" :sidebar-collapsed="sidebarCollapsed" />
        <div v-else class="empty-state" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
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
  </div>
</template>

<style scoped>
.workspace-layout {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #1E1E1E;
  color: #E4E4E7;
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

.expand-btn-floating {
  position: absolute;
  left: 8px;
  top: 8px;
  width: 28px;
  height: 28px;
  background: #18181B;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  color: #9CA3AF;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  z-index: 100;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

.expand-btn-floating:hover {
  background: #374151;
  color: #E5E7EB;
  border-color: #F97316;
  z-index: 101;
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
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #6B7280;
  gap: 16px;
  transition: padding-left 0.2s ease;
}

.empty-state.sidebar-collapsed {
  padding-left: 52px;
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
