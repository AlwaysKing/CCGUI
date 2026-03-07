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
  runningSessions: {
    type: Set,
    default: () => new Set()
  },
  projectPath: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['select', 'delete', 'newSession', 'toggle', 'rename'])

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

function closeContextMenu() {
  contextMenu.value.show = false
}

function isRunning(sessionId) {
  return props.runningSessions.has(sessionId)
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
      <span class="sidebar-title" :title="projectPath">{{ getProjectName(projectPath) }}</span>
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
        <div class="session-status" :class="{ running: isRunning(session.id) }" />

        <div class="session-info">
          <span class="session-name">{{ getSessionName(session) }}</span>
          <span class="session-id">{{ session.id.slice(0, 8) }}</span>
          <span v-if="session.preview" class="session-preview">{{ session.preview }}</span>
          <span class="session-meta">
            {{ session.messageCount || 0 }} 条消息 · {{ formatTime(session.updatedAt) }}
          </span>
        </div>
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
  font-size: 12px;
  font-weight: 600;
  color: #9CA3AF;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
  cursor: pointer;
}

.add-btn {
  padding: 4px;
  background: transparent;
  border: none;
  color: #6B7280;
  cursor: pointer;
  border-radius: 4px;
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
}

.session-item:hover {
  background: #374151;
}

.session-item.active {
  background: #374151;
}

.session-status {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #4B5563;
  margin-top: 4px;
  flex-shrink: 0;
}

.session-status.running {
  background: #10B981;
  box-shadow: 0 0 6px #10B981;
  animation: pulse 2s infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
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
</style>
