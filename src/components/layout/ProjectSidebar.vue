<script setup>
import { ref } from 'vue'

const props = defineProps({
  projects: {
    type: Array,
    default: () => []
  },
  currentProject: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['select', 'delete', 'toggle', 'rename'])

const contextMenu = ref({
  show: false,
  x: 0,
  y: 0,
  project: null
})

function handleSelect(project) {
  emit('select', project)
}

function handleContextMenu(event, project) {
  event.preventDefault()
  contextMenu.value = {
    show: true,
    x: event.clientX,
    y: event.clientY,
    project
  }
}

function handleRename() {
  if (contextMenu.value.project) {
    emit('rename', contextMenu.value.project)
  }
  closeContextMenu()
}

function handleDelete() {
  if (contextMenu.value.project) {
    emit('delete', contextMenu.value.project)
  }
  closeContextMenu()
}

function closeContextMenu() {
  contextMenu.value.show = false
}
</script>

<template>
  <aside class="project-sidebar">
    <div class="sidebar-header">
      <span class="sidebar-title">项目</span>
      <button class="toggle-btn" @click="emit('toggle')" title="折叠">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>
    </div>

    <div class="project-list">
      <div
        v-for="project in projects"
        :key="project.id"
        class="project-item"
        :class="{ active: currentProject?.id === project.id }"
        @click="handleSelect(project)"
        @contextmenu="handleContextMenu($event, project)"
      >
        <div class="project-icon">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div class="project-info">
          <span class="project-name">{{ project.name }}</span>
          <span class="project-meta">
            {{ project.sessionCount || 0 }} 个会话
          </span>
        </div>
      </div>

      <div v-if="projects.length === 0" class="empty-list">
        <p>暂无项目</p>
        <p class="hint">点击上方"新建项目"添加</p>
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
        从列表移除
      </button>
    </div>

    <!-- Click outside to close menu -->
    <div v-if="contextMenu.show" class="menu-overlay" @click="closeContextMenu" />
  </aside>
</template>

<style scoped>
.project-sidebar {
  background: #252526;
  border-right: 1px solid #3F3F46;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.sidebar-header {
  padding: 12px 16px;
  border-bottom: 1px solid #3F3F46;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.sidebar-title {
  font-size: 12px;
  font-weight: 600;
  color: #9CA3AF;
  text-transform: uppercase;
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

.project-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.project-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background 0.15s;
}

.project-item:hover {
  background: #374151;
}

.project-item.active {
  background: #374151;
  border-left: 3px solid #F97316;
}

.project-icon {
  color: #6B7280;
  flex-shrink: 0;
}

.project-item.active .project-icon {
  color: #F97316;
}

.project-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.project-name {
  font-size: 13px;
  color: #E5E7EB;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.project-meta {
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
  min-width: 140px;
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
