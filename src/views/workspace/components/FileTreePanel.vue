<script setup>
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue'
import FileTreeNode from './FileTreeNode.vue'

const props = defineProps({
  tree: {
    type: Array,
    default: () => []
  },
  isLoading: {
    type: Boolean,
    default: false
  },
  error: {
    type: String,
    default: ''
  },
  expandedDirs: {
    type: Object,
    required: true
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
  hasOpenFiles: {
    type: Boolean,
    default: false
  },
  previewPanelVisible: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits([
  'refresh',
  'toggle-preview-panel',
  'toggle-directory',
  'preview-file',
  'pin-file',
  'select-node',
  'start-rename-node',
  'stop-rename-node',
  'rename-node',
  'create-entry',
  'delete-node'
])

const panelRef = ref(null)
const contextMenuRef = ref(null)
const contextMenu = ref({
  show: false,
  x: 0,
  y: 0,
  node: null
})

function focusPanel() {
  panelRef.value?.focus()
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

async function openContextMenu({ x, y, node }) {
  contextMenu.value = {
    show: true,
    x,
    y,
    node
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

function normalizePath(value = '') {
  return String(value || '').replace(/\\/g, '/')
}

function getParentPath(targetPath = '') {
  const normalizedPath = normalizePath(targetPath)
  if (!normalizedPath) return ''
  const segments = normalizedPath.split('/').filter(Boolean)
  segments.pop()
  return segments.join('/')
}

function findNodeByPath(nodes, targetPath) {
  for (const node of nodes) {
    if (node.path === targetPath) {
      return node
    }
    if (node.children?.length) {
      const found = findNodeByPath(node.children, targetPath)
      if (found) return found
    }
  }
  return null
}

function resolveCreateParentPath(nodePath = props.selectedNodePath) {
  const normalizedPath = normalizePath(nodePath)
  if (!normalizedPath) return ''

  const node = findNodeByPath(props.tree, normalizedPath)
  if (!node) {
    return getParentPath(normalizedPath)
  }

  return node.type === 'directory' ? node.path : getParentPath(node.path)
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

function handlePanelKeydown(event) {
  if (event.key !== 'Enter') return
  if (props.editingNodePath) return
  if (!props.selectedNodePath) return
  emit('start-rename-node', props.selectedNodePath)
}

function handleSelectNode(node) {
  emit('select-node', node.path)
  focusPanel()
}

function handleContextMenu(payload) {
  openContextMenu({
    x: payload.event.clientX,
    y: payload.event.clientY,
    node: payload.node
  })
  emit('select-node', payload.node.path)
  focusPanel()
}

function handleCreateFromToolbar(type) {
  emit('create-entry', { parentPath: resolveCreateParentPath(), type })
  focusPanel()
}

function handleCreateFromMenu(type) {
  const node = contextMenu.value.node
  const parentPath = resolveCreateParentPath(node?.path || '')
  emit('create-entry', { parentPath, type })
  closeContextMenu()
  focusPanel()
}

function handleRenameFromMenu() {
  if (contextMenu.value.node) {
    emit('start-rename-node', contextMenu.value.node.path)
  }
  closeContextMenu()
  focusPanel()
}

function handleDeleteFromMenu() {
  if (contextMenu.value.node) {
    emit('delete-node', contextMenu.value.node.path)
  }
  closeContextMenu()
}

onMounted(() => {
  window.addEventListener('pointerdown', handleGlobalPointerDown, true)
  window.addEventListener('contextmenu', handleGlobalContextMenu, true)
  window.addEventListener('blur', handleWindowBlur)
  window.addEventListener('resize', handleViewportChange)
})

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handleGlobalPointerDown, true)
  window.removeEventListener('contextmenu', handleGlobalContextMenu, true)
  window.removeEventListener('blur', handleWindowBlur)
  window.removeEventListener('resize', handleViewportChange)
})
</script>

<template>
  <section
    ref="panelRef"
    class="file-tree-panel"
    tabindex="0"
    @keydown="handlePanelKeydown"
  >
    <div class="file-tree-header">
      <div class="header-text">
        <div class="panel-title">文件</div>
        <div class="panel-subtitle">当前项目目录</div>
      </div>
      <div class="header-actions">
        <button class="refresh-btn" title="新建文件" @click.stop="handleCreateFromToolbar('file')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
            <path d="M14 2v6h6"></path>
            <path d="M12 18v-6"></path>
            <path d="M9 15h6"></path>
          </svg>
        </button>
        <button class="refresh-btn" title="新建文件夹" @click.stop="handleCreateFromToolbar('directory')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"></path>
            <path d="M12 11v6"></path>
            <path d="M9 14h6"></path>
          </svg>
        </button>
        <button class="refresh-btn" title="刷新文件树" @click.stop="emit('refresh')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 2v6h-6"></path>
            <path d="M3 11a9 9 0 0 1 15.55-5.36L21 8"></path>
            <path d="M3 22v-6h6"></path>
            <path d="M21 13a9 9 0 0 1-15.55 5.36L3 16"></path>
          </svg>
        </button>
        <button
          class="refresh-btn"
          :title="previewPanelVisible ? '隐藏预览区' : '显示预览区'"
          @click.stop="emit('toggle-preview-panel')"
        >
          <svg v-if="previewPanelVisible" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="16" rx="2"></rect>
            <path d="M9 4v16"></path>
          </svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="16" rx="2"></rect>
            <path d="M15 4v16"></path>
          </svg>
        </button>
      </div>
    </div>

    <div class="file-tree-body">
      <div v-if="isLoading" class="tree-placeholder">正在加载文件列表...</div>
      <div v-else-if="error" class="tree-placeholder error">{{ error }}</div>
      <div v-else-if="tree.length === 0" class="tree-placeholder">当前目录暂无可展示文件</div>
      <FileTreeNode
        v-for="node in tree"
        :key="node.path"
        :node="node"
        :depth="0"
        :expanded-dirs="expandedDirs"
        :active-file-path="activeFilePath"
        :selected-node-path="selectedNodePath"
        :editing-node-path="editingNodePath"
        @toggle-directory="emit('toggle-directory', $event)"
        @preview-file="emit('preview-file', $event)"
        @pin-file="emit('pin-file', $event)"
        @select-node="handleSelectNode"
        @context-menu="handleContextMenu"
        @rename-node="emit('rename-node', $event)"
        @stop-rename-node="emit('stop-rename-node')"
      />
    </div>

    <div
      v-if="contextMenu.show"
      ref="contextMenuRef"
      class="context-menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @click.stop
    >
      <button class="menu-item" @click="handleCreateFromMenu('directory')">新建文件夹</button>
      <button class="menu-item" @click="handleCreateFromMenu('file')">新建文件</button>
      <div class="menu-divider"></div>
      <button class="menu-item" @click="handleRenameFromMenu">重命名</button>
      <button class="menu-item danger" @click="handleDeleteFromMenu">删除</button>
    </div>

  </section>
</template>

<style scoped>
.file-tree-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-bottom: 1px solid #3F3F46;
  outline: none;
  position: relative;
}

.file-tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 8px;
  border-bottom: 1px solid #2C2C31;
  background: #1A1B1F;
  gap: 8px;
}

.header-text {
  min-width: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
  color: #E4E4E7;
}

.panel-subtitle {
  font-size: 10px;
  color: #71717A;
  margin-top: 2px;
}

.refresh-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: #A1A1AA;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background 0.15s, color 0.15s;
}

.refresh-btn:hover {
  background: #2A2D33;
  color: #E4E4E7;
}

.file-tree-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.tree-placeholder {
  font-size: 12px;
  color: #71717A;
  padding: 12px 8px;
}

.tree-placeholder.error {
  color: #FCA5A5;
}

.context-menu {
  position: fixed;
  min-width: 140px;
  padding: 4px 0;
  background: #1E1E1E;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  box-shadow: 0 10px 15px rgba(0, 0, 0, 0.5);
  z-index: 1200;
}

.menu-item {
  width: 100%;
  min-height: 34px;
  border: none;
  background: transparent;
  color: #E4E4E7;
  text-align: left;
  padding: 8px 12px;
  cursor: pointer;
  font-size: 13px;
  display: flex;
  align-items: center;
}

.menu-item:hover {
  background: #27272A;
}

.menu-item.danger {
  color: #EF4444;
}

.menu-item.danger:hover {
  background: rgba(239, 68, 68, 0.1);
}

.menu-divider {
  height: 1px;
  margin: 4px 8px;
  background: #3F3F46;
}

</style>
