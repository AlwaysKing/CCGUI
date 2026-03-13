<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../../stores/useAppStore'
import { useSessionStore } from '../../stores/useSessionStore'
import { logger } from '../../utils/logger'
import SessionSidebar from './components/SessionSidebar.vue'
import Chat from './chat/Chat.vue'
import NewSessionDialog from './components/NewSessionDialog.vue'
import ConfirmDialog from './components/ConfirmDialog.vue'
import RenameDialog from './components/RenameDialog.vue'
import ProjectSwitchDialog from './components/ProjectSwitchDialog.vue'
import SwitchConfirmDialog from './components/SwitchConfirmDialog.vue'

const store = useAppStore()
const sessionStore = useSessionStore()

// Dialog states
const showNewSessionDialog = ref(false)
const showConfirmDialog = ref(false)
const showRenameDialog = ref(false)
const showProjectSwitchDialog = ref(false)
const showSwitchConfirmDialog = ref(false)
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

async function handleCloseSession(session) {
  // 获取会话的完整状态
  const sessionState = sessionStore.sessions.get(session.id)

  // 如果正在处理，显示确认对话框
  if (sessionState?.isProcessing) {
    confirmDialogConfig.value = {
      title: '确认关闭',
      message: '会话正在处理中，关闭将中断当前操作。确定要关闭吗？',
      onConfirm: () => {
        performCloseSession(session, sessionState)
        showConfirmDialog.value = false
      }
    }
    showConfirmDialog.value = true
  } else {
    // 不在处理中，直接关闭
    await performCloseSession(session, sessionState)
  }
}

async function performCloseSession(session, sessionState) {
  try {
    // 如果正在处理，添加中断消息并停止计时
    if (sessionState?.isProcessing) {
      // 停止所有正在执行的工具和流式传输
      for (let i = sessionState.messages.length - 1; i >= 0; i--) {
        const msg = sessionState.messages[i]

        // 停止流式传输的 assistant 消息
        if (msg.isStreaming) {
          msg.isStreaming = false
          if (msg.startTime && !msg.duration) {
            msg.duration = Date.now() - msg.startTime
          }
        }

        // 停止正在执行的工具
        if (msg.isExecuting) {
          msg.isExecuting = false
          if (msg.startTime && !msg.duration) {
            msg.duration = Date.now() - msg.startTime
          }
        }
      }

      // 添加中断消息
      sessionState.messages.push({
        id: `interrupt-${Date.now()}`,
        role: 'system',
        content: '已中断',
        timestamp: new Date()
      })

      // 停止处理状态
      sessionState.isProcessing = false
    }

    // 关闭 Claude 进程（保留 session，以便后续可以重新启动）
    await window.electronAPI.stopClaude({ sessionId: session.id })
    logger.info('[Workspace] Claude process stopped for session:', session.id)
  } catch (e) {
    logger.error('[Workspace] Failed to close Claude process:', { error: e.message })
    alert('关闭 Claude 进程失败: ' + e.message)
  }
}

async function handleStartSession(session) {
  try {
    // 启动 Claude 进程（不发送消息）
    await window.electronAPI.startSession({
      sessionId: session.id,
      projectPath: store.currentProject?.path
    })
    logger.info('[Workspace] Claude process started for session:', session.id)

    // 立即刷新运行状态
    await store.fetchRunningSessions()
  } catch (e) {
    logger.error('[Workspace] Failed to start Claude process:', { error: e.message })
    alert('启动 Claude 进程失败: ' + e.message)
  }
}

// Project switching handlers
function handleSwitchProject() {
  showProjectSwitchDialog.value = true
}

function handleProjectSelected(project) {
  // If selected current project, just close dialog
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
    // Close all current sessions
    for (const session of store.sessions) {
      await sessionStore.closeSession(session.id)
    }

    // Switch project
    store.selectProject(selectedProject.value)

    showSwitchConfirmDialog.value = false
    selectedProject.value = null
  } catch (e) {
    logger.error('Failed to switch project', { error: e.message })
    alert('切换项目失败: ' + e.message)
  }
}

async function handleNewWindow() {
  try {
    await window.electronAPI.openProjectInNewWindow({
      projectId: selectedProject.value.id
    })

    showSwitchConfirmDialog.value = false
    selectedProject.value = null
  } catch (e) {
    logger.error('Failed to open new window', { error: e.message })
    alert('打开新窗口失败: ' + e.message)
  }
}

async function handleGoHomeFromDialog(hasRunningSessions) {
  // If there are running sessions, show confirmation
  if (hasRunningSessions) {
    confirmDialogConfig.value = {
      title: '返回首页',
      message: '当前有正在运行的会话，返回首页将中断这些操作。确定要返回吗？',
      onConfirm: async () => {
        await performGoHome()
        showConfirmDialog.value = false
      }
    }
    showConfirmDialog.value = true
  } else {
    // No running sessions, go home directly
    await performGoHome()
  }
}

async function performGoHome() {
  try {
    // Close all sessions
    for (const session of store.sessions) {
      await sessionStore.closeSession(session.id)
    }

    // Clear current project to return to welcome page
    store.currentProject = null
    store.currentSession = null

    showProjectSwitchDialog.value = false
    logger.info('[Workspace] Returned to home page')
  } catch (e) {
    logger.error('[Workspace] Failed to go home', { error: e.message })
    alert('返回首页失败: ' + e.message)
  }
}

// Handle session selection
async function handleSelectSession(sessionId) {
  // Find the session object from the list
  const session = store.currentProjectSessions.find(s => s.id === sessionId)
  if (session) {
    try {
      await store.selectSession(session)
    } catch (e) {
      logger.error('Failed to select session', { error: e.message, sessionId })
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
          :sidebar-collapsed="sidebarCollapsed"
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
