<script setup>
import { ref } from 'vue'

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
  }
})

const emit = defineEmits(['select', 'delete', 'newSession', 'toggle', 'rename', 'switchProject', 'close', 'start'])

const contextMenu = ref({
  show: false,
  x: 0,
  y: 0,
  session: null
})

function handleSelect(session) {
  emit('select', session.id)
}

function handleContextMenu(event, session) {
  event.preventDefault()
  contextMenu.value = {
    show: true,
    x: event.clientX,
    y: event.clientY,
    session
  }
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

function closeContextMenu() {
  contextMenu.value.show = false
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

function getProjectName(path) {
  if (!path) return '会话'
  // 提取路径最后一部分作为项目名称
  const parts = path.split('/').filter(p => p)
  return parts[parts.length - 1] || '会话'
}
</script>

<template>
  <aside class="session-sidebar">
    <!-- 第一行：红绿灯占位 | Logo | 折叠按钮 -->
    <div class="sidebar-header-row1">
      <div class="traffic-light-placeholder"></div>
      <span class="app-logo">CCGUI</span>
      <button class="toggle-btn" @click="emit('toggle')" title="折叠">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
    </div>
    <!-- 第二行：项目名称 | 新建按钮 -->
    <div class="sidebar-header-row2">
      <div class="sidebar-title" :title="projectPath" @click="emit('switchProject')">
        <svg class="switch-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <span class="project-name">{{ getProjectName(projectPath) }}</span>
      </div>
      <button class="add-btn" @click="emit('newSession')" title="新建会话">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>
    </div>

    <div class="session-list">
      <div
        v-for="session in sessions"
        :key="session.id"
        class="session-item"
        :class="{ active: currentSession?.id === session.id }"
        @click="handleSelect(session)"
        @contextmenu="handleContextMenu($event, session)"
      >
        <div class="session-status" :class="getSessionStatus(session.id)" />

        <div class="session-info">
          <span class="session-name">{{ getSessionName(session) }}</span>
          <span class="session-id">{{ session.id.slice(0, 8) }}</span>
          <span v-if="session.preview" class="session-preview">{{ session.preview }}</span>
          <span class="session-meta">
            {{ session.messageCount || 0 }} 条消息 · {{ formatTime(session.updatedAt) }}
          </span>
        </div>

        <!-- Three-dot menu button -->
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

    <!-- Context Menu -->
    <div
      v-if="contextMenu.show"
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

    <!-- Click outside to close menu -->
    <div v-if="contextMenu.show" class="menu-overlay" @click="closeContextMenu" />
  </aside>
</template>

<style scoped>
.session-sidebar {
  background: #252526;
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
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
  -webkit-app-region: no-drag;
}

.sidebar-title {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 20px;
  font-weight: 700;
  color: #60A5FA;
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

.switch-icon {
  flex-shrink: 0;
  opacity: 0.7;
  transition: opacity 0.2s;
}

.sidebar-title:hover {
  color: #93C5FD;
}

.sidebar-title:hover .switch-icon {
  opacity: 1;
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

.session-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.session-item {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
  position: relative;
}

.session-item:hover {
  background: #374151;
}

.session-item.active {
  background: #374151;
}

/* Three-dot menu button - 默认隐藏 */
.session-menu-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  padding: 4px;
  background: transparent;
  border: none;
  color: #6B7280;
  cursor: pointer;
  border-radius: 4px;
  opacity: 0;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.session-menu-btn:hover {
  background: #4B5563;
  color: #D1D5DB;
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
  background: #4B5563;  /* 灰色 - inactive */
  margin-top: 4px;
  flex-shrink: 0;
}

.session-status.ready {
  background: #10B981;  /* 绿色 - ready */
  box-shadow: 0 0 6px #10B981;
}

.session-status.streaming {
  background: #10B981;  /* 闪烁绿色 - streaming */
  box-shadow: 0 0 8px #10B981;
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
  gap: 2px;
}

.session-name {
  font-size: 13px;
  color: #E5E7EB;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-id {
  font-size: 11px;
  color: #6B7280;
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
}

.session-preview {
  font-size: 12px;
  color: #9CA3AF;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.session-meta {
  font-size: 11px;
  color: #6B7280;
}

.empty-list {
  padding: 24px 16px;
  text-align: center;
  color: #6B7280;
}

.empty-list p {
  margin: 0;
  font-size: 13px;
}

.empty-list .hint {
  margin-top: 4px;
  font-size: 11px;
  color: #4B5563;
}

/* Context Menu */
.context-menu {
  position: fixed;
  background: #374151;
  border: 1px solid #4B5563;
  border-radius: 6px;
  padding: 4px 0;
  min-width: 120px;
  z-index: 1000;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  background: transparent;
  border: none;
  color: #D1D5DB;
  cursor: pointer;
  font-size: 13px;
  text-align: left;
}

.menu-item:hover {
  background: #4B5563;
}

.menu-item.warning {
  color: #F59E0B;
}

.menu-item.warning:hover {
  background: #78350F;
}

.menu-item.success {
  color: #10B981;
}

.menu-item.success:hover {
  background: #064E3B;
}

.menu-item.danger {
  color: #EF4444;
}

.menu-item.danger:hover {
  background: #7F1D1D;
}

.menu-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 999;
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

</style>
