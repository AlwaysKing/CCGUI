<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import CodeEditor from './CodeEditor.vue'
import MarkdownRenderer from '../../../components/base/MarkdownRenderer.vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: true
  },
  tabs: {
    type: Array,
    default: () => []
  },
  activeTab: {
    type: Object,
    default: null
  },
  activeGitStatus: {
    type: String,
    default: ''
  },
  isChatCollapsed: {
    type: Boolean,
    default: false
  },
  showSidebarToggle: {
    type: Boolean,
    default: false
  },
  projectPath: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['activate-tab', 'close-tab', 'close-others', 'update-content', 'save-file', 'close-panel', 'toggle-chat-panel', 'toggle-sidebar', 'toggle-diff', 'open-markdown-preview'])

const contextMenuRef = ref(null)
const contextMenu = reactive({
  show: false,
  x: 0,
  y: 0,
  tab: null
})

const titleText = computed(() => {
  if (!props.activeTab) return '文件预览'
  return props.activeTab.path
})

function normalizePath(value = '') {
  return String(value || '').replace(/\\/g, '/')
}

function isAbsolutePath(targetPath = '') {
  const normalizedPath = normalizePath(targetPath)
  return normalizedPath.startsWith('/') || /^[A-Za-z]:\//.test(normalizedPath)
}

function resolveTabAbsolutePath(tab) {
  const targetPath = tab?.path || ''
  if (!targetPath) {
    return ''
  }

  if (isAbsolutePath(targetPath)) {
    return normalizePath(targetPath)
  }

  const projectPath = normalizePath(props.projectPath)
  if (!projectPath) {
    return normalizePath(targetPath)
  }

  return normalizePath(`${projectPath.replace(/\/$/, '')}/${targetPath.replace(/^\//, '')}`)
}

function handleTabClose(event, tabId) {
  event.preventDefault()
  event.stopPropagation()
  emit('close-tab', tabId)
}

function handleCloseOthers(event, tabId) {
  event.preventDefault()
  emit('close-others', tabId)
}

function closeContextMenu() {
  contextMenu.show = false
  contextMenu.tab = null
}

function handleContextMenu(event, tab) {
  event.preventDefault()
  event.stopPropagation()
  contextMenu.show = true
  contextMenu.x = event.clientX
  contextMenu.y = event.clientY
  contextMenu.tab = tab
}

function handleGlobalPointerDown(event) {
  if (!contextMenu.show) return
  if (contextMenuRef.value?.contains(event.target)) return
  closeContextMenu()
}

function handleGlobalContextMenu(event) {
  if (!contextMenu.show) return
  if (contextMenuRef.value?.contains(event.target)) return
  closeContextMenu()
}

function handleWindowBlur() {
  closeContextMenu()
}

function handleViewportChange() {
  closeContextMenu()
}

function handleClosePanel(event) {
  event.preventDefault()
  event.stopPropagation()
  emit('close-panel')
}

function handleActivateTab(event, tabId) {
  event.preventDefault()
  event.stopPropagation()
  emit('activate-tab', tabId)
}

function handleToggleChatPanel(event) {
  event.preventDefault()
  event.stopPropagation()
  emit('toggle-chat-panel')
}

function ensureActionSucceeded(result, fallbackMessage) {
  if (result?.success) {
    return true
  }

  const message = result?.error || fallbackMessage
  window.alert(message)
  return false
}

async function handleOpenInFinder(mode = 'reveal') {
  const targetPath = resolveTabAbsolutePath(contextMenu.tab)
  if (!targetPath) {
    closeContextMenu()
    return
  }

  const result = await window.electronAPI.openPathInFinder({
    targetPath,
    mode
  })
  if (!ensureActionSucceeded(result, '在 Finder 中打开失败')) {
    return
  }
  closeContextMenu()
}

async function handleOpenWithApplication(application = 'default') {
  const targetPath = resolveTabAbsolutePath(contextMenu.tab)
  if (!targetPath) {
    closeContextMenu()
    return
  }

  const result = await window.electronAPI.openFileWithApplication({
    targetPath,
    application
  })
  if (!ensureActionSucceeded(result, '打开文件失败')) {
    return
  }
  closeContextMenu()
}

function handleCloseOthersFromMenu() {
  const targetId = contextMenu.tab?.id
  if (!targetId) {
    closeContextMenu()
    return
  }

  emit('close-others', targetId)
  closeContextMenu()
}

function isMarkdownTab(tab) {
  if (!tab) return false
  const name = tab.name || ''
  return name.endsWith('.md') || name.endsWith('.markdown')
}

function handleOpenMarkdownPreview() {
  const targetPath = contextMenu.tab?.path
  if (!targetPath) {
    closeContextMenu()
    return
  }

  emit('open-markdown-preview', targetPath)
  closeContextMenu()
}

// ===== Image preview =====
const imageRef = ref(null)
const imageContainerRef = ref(null)
const imageNaturalWidth = ref(0)
const imageNaturalHeight = ref(0)
const fitScale = ref(1)
const imageScale = ref(1)
const imageTranslateX = ref(0)
const imageTranslateY = ref(0)
const isDragging = ref(false)
const imageLoadError = ref(false)
const dragStartX = ref(0)
const dragStartY = ref(0)
const translateStartX = ref(0)
const translateStartY = ref(0)
let dragMoveHandler = null
let dragUpHandler = null

function isImageTab(tab) {
  if (!tab) return false
  return !!tab.isImage
}

function resolveImageUrl(tab) {
  if (!tab || !tab.content) return ''
  return tab.content
}

function onImageLoad(event) {
  const img = event.target
  imageNaturalWidth.value = img.naturalWidth
  imageNaturalHeight.value = img.naturalHeight
  const container = imageContainerRef.value
  if (!container || !imageNaturalWidth.value || !imageNaturalHeight.value) {
    fitScale.value = 1
    imageScale.value = 1
    return
  }
  const padding = 40
  const containerW = container.clientWidth - padding
  const containerH = container.clientHeight - padding
  if (containerW <= 0 || containerH <= 0) {
    fitScale.value = 1
    imageScale.value = 1
    return
  }
  const scaleW = containerW / imageNaturalWidth.value
  const scaleH = containerH / imageNaturalHeight.value
  fitScale.value = Math.min(scaleW, scaleH)
  imageScale.value = fitScale.value
  imageTranslateX.value = 0
  imageTranslateY.value = 0
}

function onImageError() {
  imageLoadError.value = true
}

function zoomIn() {
  imageScale.value = Math.min(imageScale.value * 1.25, 20)
}

function zoomOut() {
  imageScale.value = Math.max(imageScale.value / 1.25, 0.02)
}

function zoomFit() {
  imageScale.value = fitScale.value
  imageTranslateX.value = 0
  imageTranslateY.value = 0
}

function zoomActual() {
  imageScale.value = 1
  imageTranslateX.value = 0
  imageTranslateY.value = 0
}

const zoomPercentage = computed(() => Math.round(imageScale.value * 100))

function onImageWheel(event) {
  if (event.deltaY < 0) {
    zoomIn()
  } else {
    zoomOut()
  }
}

function onImageMouseDown(event) {
  if (event.button !== 0) return
  isDragging.value = true
  dragStartX.value = event.clientX
  dragStartY.value = event.clientY
  translateStartX.value = imageTranslateX.value
  translateStartY.value = imageTranslateY.value
  event.preventDefault()

  if (dragMoveHandler) window.removeEventListener('mousemove', dragMoveHandler)
  if (dragUpHandler) window.removeEventListener('mouseup', dragUpHandler)

  dragMoveHandler = (e) => {
    imageTranslateX.value = translateStartX.value + (e.clientX - dragStartX.value)
    imageTranslateY.value = translateStartY.value + (e.clientY - dragStartY.value)
  }
  dragUpHandler = () => {
    isDragging.value = false
    window.removeEventListener('mousemove', dragMoveHandler)
    window.removeEventListener('mouseup', dragUpHandler)
    dragMoveHandler = null
    dragUpHandler = null
  }
  window.addEventListener('mousemove', dragMoveHandler)
  window.addEventListener('mouseup', dragUpHandler)
}

watch(() => props.activeTab?.id, () => {
  imageLoadError.value = false
  imageScale.value = 1
  imageTranslateX.value = 0
  imageTranslateY.value = 0
  isDragging.value = false
  if (dragMoveHandler) {
    window.removeEventListener('mousemove', dragMoveHandler)
    dragMoveHandler = null
  }
  if (dragUpHandler) {
    window.removeEventListener('mouseup', dragUpHandler)
    dragUpHandler = null
  }
})

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
  if (dragMoveHandler) window.removeEventListener('mousemove', dragMoveHandler)
  if (dragUpHandler) window.removeEventListener('mouseup', dragUpHandler)
})
</script>

<template>
  <aside v-if="visible" class="file-preview-panel">
    <div class="preview-tabs">
      <div v-if="showSidebarToggle" class="sidebar-safe-spacer">
        <button class="sidebar-safe-btn" title="展开侧边栏" @mousedown.stop @click="emit('toggle-sidebar')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10 6l6 6-6 6"/>
            <path d="M4 5v14"/>
          </svg>
        </button>
      </div>

      <div class="tabs-list">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          class="preview-tab"
          :class="{ active: activeTab?.id === tab.id }"
          :title="tab.path"
          @click="handleActivateTab($event, tab.id)"
          @mousedown.stop
          @contextmenu="handleContextMenu($event, tab)"
        >
          <span v-if="tab.isDirty" class="tab-dirty-prefix">*</span>
          <span class="tab-name">{{ tab.name }}</span>
          <span v-if="tab.markdownPreview" class="tab-md-badge">MD</span>
          <span v-else-if="tab.isPreview && !tab.pinned && !tab.isDirty" class="tab-preview">预览</span>
          <span class="tab-close" @click="handleTabClose($event, tab.id)">×</span>
        </button>
      </div>

      <div class="tab-drag-spacer"></div>

      <button class="tab-bar-close-btn" title="隐藏预览" @mousedown.stop @click="handleClosePanel">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 6l-6 6 6 6"/>
          <path d="M20 5v14"/>
        </svg>
      </button>

      <button
        v-if="isChatCollapsed"
        class="tab-bar-chat-btn"
        title="展开聊天区"
        @mousedown.stop
        @click="handleToggleChatPanel"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </button>
    </div>

    <div
      v-if="contextMenu.show"
      ref="contextMenuRef"
      class="context-menu"
      :style="{ left: `${contextMenu.x}px`, top: `${contextMenu.y}px` }"
      @click.stop
    >
      <button v-if="isMarkdownTab(contextMenu.tab) && !contextMenu.tab?.markdownPreview" class="menu-item" @click="handleOpenMarkdownPreview">以预览方式打开</button>
      <button class="menu-item" @click="handleOpenInFinder('reveal')">在 Finder 中选中</button>
      <button class="menu-item" @click="handleOpenWithApplication('Visual Studio Code')">使用 VSCode 打开</button>
      <button class="menu-item" @click="handleOpenWithApplication('Sublime Text')">使用 Sublime 打开</button>
      <button class="menu-item" @click="handleOpenWithApplication('default')">使用外部编辑器打开</button>
      <div class="menu-divider"></div>
      <button class="menu-item" @click="handleCloseOthersFromMenu">关闭其他标签</button>
    </div>

    <div v-if="activeTab" class="preview-body">
      <div v-if="activeTab.loading" class="preview-state">正在读取文件...</div>
      <div v-else-if="activeTab.error" class="preview-state error">{{ activeTab.error }}</div>
      <template v-else-if="activeTab.markdownPreview">
        <div class="markdown-preview-container">
          <MarkdownRenderer :content="activeTab.content" />
        </div>
      </template>
      <template v-else-if="isImageTab(activeTab)">
        <div
          class="image-preview-container"
          ref="imageContainerRef"
          :style="{ cursor: isDragging ? 'grabbing' : (imageScale > fitScale ? 'grab' : 'default') }"
          @mousedown="onImageMouseDown"
          @wheel.prevent="onImageWheel"
        >
          <div v-if="imageLoadError" class="preview-state error">无法加载图片</div>
          <img
            v-else
            ref="imageRef"
            :src="resolveImageUrl(activeTab)"
            :style="{ transform: `translate(${imageTranslateX}px, ${imageTranslateY}px) scale(${imageScale})` }"
            class="preview-image"
            draggable="false"
            @load="onImageLoad"
            @error="onImageError"
          />
        </div>
        <div class="image-toolbar">
          <div class="statusbar-path" :title="titleText">{{ titleText }}</div>
          <div class="image-toolbar-actions">
            <button class="toolbar-btn" @click="zoomOut" title="缩小">−</button>
            <span class="toolbar-zoom-label">{{ zoomPercentage }}%</span>
            <button class="toolbar-btn" @click="zoomIn" title="放大">+</button>
            <span class="toolbar-sep"></span>
            <button class="toolbar-btn" @click="zoomFit" title="适应窗口">适应</button>
            <button class="toolbar-btn" @click="zoomActual" title="实际尺寸">1:1</button>
          </div>
        </div>
      </template>
      <CodeEditor
        v-else
        :model-value="activeTab.content"
        :original-value="activeTab.diffBaseContent"
        :language="activeTab.language"
        :diff-mode="activeTab.diffMode"
        :read-only="activeTab.readOnly"
        @update:model-value="emit('update-content', activeTab.path, $event)"
        @save="emit('save-file', activeTab.path)"
      />

      <div v-if="!activeTab.loading && !activeTab.error && !activeTab.markdownPreview && !isImageTab(activeTab)" class="preview-statusbar">
        <div class="statusbar-path" :title="titleText">{{ titleText }}</div>
        <div class="statusbar-actions">
          <span v-if="activeTab.diffMode && activeTab.diffBaseError" class="statusbar-note error">{{ activeTab.diffBaseError }}</span>
          <button
            v-if="activeGitStatus"
            class="statusbar-btn"
            :class="{ active: activeTab.diffMode }"
            :title="activeTab.diffMode ? '关闭 Diff' : '显示 Diff'"
            @click="emit('toggle-diff', activeTab.path)"
          >
            <span class="statusbar-btn-text plus">+</span>
            <span class="statusbar-btn-separator">/</span>
            <span class="statusbar-btn-text minus">-</span>
          </button>
        </div>
      </div>
    </div>

    <div v-else class="preview-empty">
      <div class="empty-title">文件预览区</div>
      <div class="empty-text">在左侧文件树中单击预览，双击固定为 Tab。</div>
    </div>
  </aside>
</template>

<style scoped>
.file-preview-panel {
  width: 42%;
  min-width: 340px;
  max-width: 58%;
  border-right: 1px solid rgba(255, 255, 255, 0.05);
  background: transparent;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.preview-tabs {
  display: flex;
  align-items: stretch;
  background: rgba(17, 19, 23, 0.36);
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  height: 41.5px;
  overflow: hidden;
  -webkit-app-region: no-drag;
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
}

.sidebar-safe-spacer {
  width: 200px;
  flex: 0 0 200px;
  display: flex;
  align-items: stretch;
  justify-content: flex-end;
  background: transparent;
  border-right: 1px solid rgba(255, 255, 255, 0.05);
  -webkit-app-region: drag;
}

.sidebar-safe-btn {
  width: 43px;
  height: 41.5px;
  padding: 0;
  border: none;
  background: transparent;
  color: #E4E4E7;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  -webkit-app-region: no-drag;
}

.sidebar-safe-btn:hover {
  background: rgba(255, 255, 255, 0.05);
}

.tabs-list {
  display: flex;
  align-items: stretch;
  gap: 1px;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  flex-shrink: 1;
  -webkit-app-region: no-drag;
}

.tab-drag-spacer {
  flex: 1;
  min-width: 24px;
  -webkit-app-region: drag;
}

.tab-bar-close-btn {
  width: 42px;
  height: 41.5px;
  padding: 0;
  border: none;
  border-left: 1px solid rgba(255, 255, 255, 0.05);
  background: transparent;
  color: #E4E4E7;
  cursor: pointer;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  -webkit-app-region: no-drag;
  position: relative;
  z-index: 2;
  pointer-events: auto;
}

.tab-bar-chat-btn {
  width: 42px;
  height: 41.5px;
  padding: 0;
  border: none;
  border-left: 1px solid rgba(255, 255, 255, 0.05);
  background: transparent;
  color: #E4E4E7;
  cursor: pointer;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  -webkit-app-region: no-drag;
  position: relative;
  z-index: 2;
  pointer-events: auto;
}

.tab-bar-chat-btn:hover,
.tab-bar-close-btn:hover {
  background: rgba(255, 255, 255, 0.05);
}

.preview-tab {
  min-width: 140px;
  max-width: 220px;
  height: 41.5px;
  border: none;
  background: rgba(255, 255, 255, 0.015);
  color: #A1A1AA;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  cursor: pointer;
  -webkit-app-region: no-drag;
  position: relative;
  z-index: 1;
  pointer-events: auto;
}

.preview-tab.active {
  background: rgba(255, 255, 255, 0.055);
  color: #F4F4F5;
}

.tab-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  -webkit-app-region: no-drag;
}

.tab-dirty-prefix {
  color: #FB923C;
  font-size: 13px;
  font-weight: 700;
  -webkit-app-region: no-drag;
}

.tab-preview {
  font-size: 10px;
  color: #71717A;
  -webkit-app-region: no-drag;
}

.tab-md-badge {
  font-size: 9px;
  padding: 1px 4px;
  border-radius: 3px;
  background: rgba(249, 115, 22, 0.15);
  color: #FB923C;
  -webkit-app-region: no-drag;
}

.tab-close {
  width: 16px;
  height: 16px;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #71717A;
  -webkit-app-region: no-drag;
  cursor: pointer;
  position: relative;
  z-index: 2;
  pointer-events: auto;
}

.tab-close:hover {
  background: #3F3F46;
  color: #F4F4F5;
}

.preview-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.preview-empty,
.preview-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 24px;
  color: #71717A;
  text-align: center;
}

.preview-state.error {
  color: #FCA5A5;
}

.preview-statusbar {
  height: 28px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(17, 19, 23, 0.28);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 12px;
  flex-shrink: 0;
}

.statusbar-path {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  color: #8B93A1;
}

.statusbar-actions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.statusbar-note {
  font-size: 11px;
  color: #A1A1AA;
}

.statusbar-note.error {
  color: #FCA5A5;
}

.statusbar-btn {
  width: 24px;
  height: 22px;
  padding: 0;
  border: 1px solid #3F3F46;
  border-radius: 4px;
  background: transparent;
  color: #D4D4D8;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.statusbar-btn:hover {
  background: rgba(255, 255, 255, 0.05);
}

.context-menu {
  position: fixed;
  min-width: 178px;
  padding: 6px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(24, 24, 27, 0.98);
  box-shadow: 0 18px 36px rgba(0, 0, 0, 0.42);
  display: flex;
  flex-direction: column;
  gap: 2px;
  z-index: 220;
  -webkit-app-region: no-drag;
}

.menu-item {
  width: 100%;
  padding: 8px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #E4E4E7;
  text-align: left;
  font-size: 12px;
  cursor: pointer;
}

.menu-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.menu-divider {
  height: 1px;
  margin: 4px 2px;
  background: rgba(255, 255, 255, 0.08);
}

.statusbar-btn-text {
  font-size: 13px;
  font-weight: 700;
  line-height: 1;
}

.statusbar-btn-text.plus {
  color: #22C55E;
}

.statusbar-btn-text.minus {
  color: #EF4444;
}

.statusbar-btn-separator {
  font-size: 11px;
  color: #71717A;
  line-height: 1;
}

.statusbar-btn.active {
  border-color: #52525B;
  background: rgba(255, 255, 255, 0.06);
}

.empty-title {
  font-size: 15px;
  color: #E4E4E7;
  margin-bottom: 8px;
}

.empty-text {
  font-size: 12px;
}

.markdown-preview-container {
  flex: 1;
  overflow-y: auto;
  padding: 20px 24px;
  background: rgba(17, 19, 23, 0.28);
}

.image-preview-container {
  flex: 1;
  min-height: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: rgba(17, 19, 23, 0.28);
  user-select: none;
}

.preview-image {
  display: block;
  max-width: none;
  max-height: none;
  transform-origin: center center;
}

.image-toolbar {
  height: 28px;
  border-top: 1px solid rgba(255, 255, 255, 0.05);
  background: rgba(17, 19, 23, 0.28);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 0 12px;
  flex-shrink: 0;
}

.image-toolbar-actions {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.toolbar-btn {
  height: 20px;
  padding: 0 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #A1A1AA;
  font-size: 12px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.toolbar-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #E4E4E7;
}

.toolbar-zoom-label {
  font-size: 11px;
  color: #A1A1AA;
  min-width: 40px;
  text-align: center;
}

.toolbar-sep {
  width: 1px;
  height: 14px;
  background: rgba(255, 255, 255, 0.08);
  margin: 0 4px;
}
</style>
