<script setup>
/**
 * RewindNoticeMessage - 还原消息通知组件
 * 从 ChatWindow.vue 提取
 */
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  chatTheme: {
    type: Object,
    default: () => ({})
  },
  isCollapsed: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['toggleCollapse', 'jumpToMessage'])
const wrapperRef = ref(null)
const connectorPath = ref('')
const connectorVisible = ref(false)
let connectorFrame = 0
let resizeObserver = null
let mutationObserver = null
let observedSource = null
let observedTarget = null
let observedContainer = null

const isTextStyle = computed(() => false)
const restoredFilesCount = computed(() => props.message.restoredFilesCount ?? props.message.restoredFiles?.length ?? 0)
const rewindMode = computed(() => props.message.rewindMode === 'patch' ? 'patch' : 'reset')
const rewindTitle = computed(() => rewindMode.value === 'patch' ? '已撤销本次修改' : '已重置文件')
const rewindTitleGhost = computed(() => rewindMode.value === 'patch' ? '撤销修改' : '重置文件')
const formattedTime = computed(() => {
  if (!props.message?.timestamp) return ''
  const date = new Date(props.message.timestamp)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
})

// 预览文本
const previewText = computed(() => {
  const content = props.message.originalMessageContent || props.message.content || ''
  return content.replace(/\n/g, ' ').substring(0, 80) + (content.length > 80 ? '...' : '')
})

// 嶈息内容
const messageContent = computed(() => {
  return props.message.originalMessageContent || props.message.content || '(空消息)'
})

function toggleCollapse() {
  emit('toggleCollapse', props.message.id)
}

function jumpToMessage(event) {
  event.stopPropagation()
  emit('jumpToMessage', props.message.rewindToMessageId)
}

function scheduleConnectorUpdate() {
  if (connectorFrame) return
  connectorFrame = window.requestAnimationFrame(() => {
    connectorFrame = 0
    updateConnector()
  })
}

function resolveTargetElements() {
  const source = wrapperRef.value
  const targetId = String(props.message?.rewindToMessageId || '').trim()
  if (!source || !targetId) {
    return {
      source: null,
      target: null,
      targetAnchor: null,
      messagesContainer: null
    }
  }

  const target = document.querySelector(`[data-message-id="${CSS.escape(targetId)}"]`)
  const targetAnchor =
    target?.querySelector('.message-user-container .message-text') ||
    target?.querySelector('.message-user-container .message-content') ||
    target ||
    null
  const messagesContainer = source.closest('.messages') || document.querySelector('.chat-window .messages')

  return {
    source,
    target,
    targetAnchor,
    messagesContainer
  }
}

function syncConnectorObservers() {
  if (!resizeObserver) return

  const { source, targetAnchor, messagesContainer } = resolveTargetElements()

  if (observedSource !== source) {
    if (observedSource) resizeObserver.unobserve(observedSource)
    observedSource = source
    if (observedSource) resizeObserver.observe(observedSource)
  }

  if (observedTarget !== targetAnchor) {
    if (observedTarget) resizeObserver.unobserve(observedTarget)
    observedTarget = targetAnchor
    if (observedTarget) resizeObserver.observe(observedTarget)
  }

  if (observedContainer !== messagesContainer) {
    if (observedContainer) resizeObserver.unobserve(observedContainer)
    observedContainer = messagesContainer
    if (observedContainer) resizeObserver.observe(observedContainer)
  }
}

function updateConnector() {
  const { source, target, targetAnchor, messagesContainer } = resolveTargetElements()
  if (!source || !target || !targetAnchor) {
    connectorVisible.value = false
    connectorPath.value = ''
    return
  }

  const containerRect = messagesContainer?.getBoundingClientRect?.()
  const sourceRect = source.getBoundingClientRect()
  const targetRect = targetAnchor.getBoundingClientRect()
  const sourceVisible = !containerRect || (sourceRect.bottom >= containerRect.top && sourceRect.top <= containerRect.bottom)
  const targetVisible = !containerRect || (targetRect.bottom >= containerRect.top && targetRect.top <= containerRect.bottom)

  if (containerRect) {
    if (!sourceVisible && !targetVisible) {
      connectorVisible.value = false
      connectorPath.value = ''
      return
    }
  }

  const visibleTop = containerRect ? containerRect.top + 8 : 0
  const visibleBottom = containerRect ? containerRect.bottom - 8 : window.innerHeight
  const clampY = (value) => Math.max(visibleTop, Math.min(value, visibleBottom))

  const sourceX = sourceRect.right
  const rawSourceY = sourceRect.top + Math.min(44, sourceRect.height * 0.5)
  const sourceY = clampY(rawSourceY)
  const targetX = targetRect.right + 6
  const rawTargetY = targetRect.top + targetRect.height * 0.5
  const targetY = clampY(rawTargetY)
  const railOffset = 69
  const maxRailX = containerRect ? containerRect.right - 11 : Math.max(sourceX, targetX) + railOffset
  const railX = Math.min(Math.max(sourceX, targetX) + railOffset, maxRailX)

  if (sourceVisible && targetVisible) {
    connectorPath.value = `M ${sourceX} ${sourceY} L ${railX} ${sourceY} L ${railX} ${targetY} L ${targetX} ${targetY}`
  } else if (sourceVisible) {
    connectorPath.value = `M ${sourceX} ${sourceY} L ${railX} ${sourceY} L ${railX} ${targetY}`
  } else {
    connectorPath.value = `M ${railX} ${sourceY} L ${railX} ${targetY} L ${targetX} ${targetY}`
  }
  connectorVisible.value = true
  syncConnectorObservers()
}

onMounted(() => {
  resizeObserver = new ResizeObserver(() => {
    scheduleConnectorUpdate()
  })
  mutationObserver = new MutationObserver(() => {
    scheduleConnectorUpdate()
  })

  nextTick(() => {
    scheduleConnectorUpdate()
    mutationObserver?.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['style', 'class']
    })
  })
  window.addEventListener('resize', scheduleConnectorUpdate)
  window.addEventListener('scroll', scheduleConnectorUpdate, true)
})

onUnmounted(() => {
  if (connectorFrame) {
    window.cancelAnimationFrame(connectorFrame)
    connectorFrame = 0
  }
  if (observedSource && resizeObserver) resizeObserver.unobserve(observedSource)
  if (observedTarget && resizeObserver) resizeObserver.unobserve(observedTarget)
  if (observedContainer && resizeObserver) resizeObserver.unobserve(observedContainer)
  resizeObserver?.disconnect()
  mutationObserver?.disconnect()
  window.removeEventListener('resize', scheduleConnectorUpdate)
  window.removeEventListener('scroll', scheduleConnectorUpdate, true)
})

watch(
  () => [props.message?.rewindToMessageId, props.message?.id, props.isCollapsed],
  async () => {
    await nextTick()
    scheduleConnectorUpdate()
  }
)
</script>

<template>
  <div ref="wrapperRef" class="rewind-message-wrapper">
    <!-- 气泡 -->
    <div
      class="rewind-notice"
      :class="{ 'rewind-collapsed': isCollapsed, 'surface-ghost': isTextStyle }"
    >
      <template v-if="isTextStyle">
        <div class="rewind-ghost-shell">
          <div class="rewind-ghost-header" @click="toggleCollapse">
            <div class="rewind-ghost-info">
              <span class="rewind-title ghost">{{ rewindTitleGhost }} ({{ restoredFilesCount }})</span>
              <span class="rewind-collapse-btn ghost" aria-hidden="true">
                <svg v-if="isCollapsed" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M4.5 3.25L7.75 6L4.5 8.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 12 12" fill="none">
                  <path d="M3.25 4.5L6 7.75L8.75 4.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                </svg>
              </span>
              <span v-if="isCollapsed" class="rewind-preview-text ghost">{{ previewText }}</span>
              <span
                v-if="isCollapsed"
                class="rewind-hint ghost"
                @click="jumpToMessage"
                title="跳转到原消息"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>
              </span>
            </div>
          </div>

          <div v-if="!isCollapsed" class="rewind-ghost-body">
            <div class="rewind-ghost-card">
              <div class="rewind-tool-section">
                <div class="rewind-section-label">原消息</div>
                <div class="rewind-section-content">
                  <div class="rewind-message-box">
                    <button
                      class="rewind-inline-action ghost in-box"
                      type="button"
                      @click="jumpToMessage"
                      title="跳转到原消息"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                        <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                      </svg>
                    </button>
                    <div class="rewind-message-box-text">
                      {{ messageContent }}
                    </div>
                  </div>
                </div>
              </div>

              <div class="rewind-tool-section">
                <div class="rewind-section-label">
                  变更内容
                  <span class="rewind-inline-stats">
                    <span class="stat-mini deletions">-{{ message.deletions || 0 }}</span>
                    <span class="stat-mini separator">/</span>
                    <span class="stat-mini insertions">+{{ message.insertions || 0 }}</span>
                    <span class="stat-unit">行</span>
                  </span>
                </div>
                <div v-if="message.restoredFiles && message.restoredFiles.length > 0" class="rewind-section-content">
                  <div class="rewind-files-list">
                    <div
                      v-for="(file, fileIndex) in message.restoredFiles"
                      :key="`ghost-${fileIndex}`"
                      class="rewind-file-item"
                    >
                      <span class="file-icon">📝</span>
                      <span class="file-path">{{ file }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- 折叠时的布局 -->
      <template v-else-if="isCollapsed">
        <div class="rewind-header-collapsed" @click="toggleCollapse">
          <div class="rewind-header-row-1">
            <span class="rewind-icon">↩️</span>
            <span class="rewind-title">{{ rewindTitle }}</span>
            <!-- 文件数徽章 -->
            <span class="rewind-stat-badge files">
              {{ message.restoredFilesCount !== null ? message.restoredFilesCount : 0 }} 文件
            </span>
            <!-- 行数统计徽章 -->
            <span class="rewind-stat-badge lines">
              <span class="stat-mini deletions">-{{ message.deletions || 0 }}</span>
              <span class="stat-mini separator">/</span>
              <span class="stat-mini insertions">+{{ message.insertions || 0 }}</span>
            </span>
            <span class="rewind-spacer"></span>
            <span v-if="formattedTime" class="rewind-meta-time">{{ formattedTime }}</span>
            <!-- 链接图标 -->
            <span
              class="rewind-hint"
              @click="jumpToMessage"
              title="跳转到原消息"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
              </svg>
            </span>
            <span class="rewind-collapse-btn">▶</span>
          </div>
          <div class="rewind-header-row-2">
            <span class="rewind-preview-text">{{ previewText }}</span>
          </div>
        </div>
      </template>

      <!-- 展开时的布局 -->
      <template v-else>
        <div class="rewind-header" @click="toggleCollapse">
          <span class="rewind-icon">↩️</span>
          <span class="rewind-title">{{ rewindTitle }}</span>
          <span class="rewind-spacer"></span>
          <span v-if="formattedTime" class="rewind-meta-time">{{ formattedTime }}</span>
          <!-- 链接图标 -->
          <span
            class="rewind-hint"
            @click="jumpToMessage"
            title="跳转到原消息"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
            </svg>
          </span>
          <span class="rewind-collapse-btn">▼</span>
        </div>

        <!-- 展开内容 -->
        <div class="rewind-body">
          <!-- 消息引用部分 -->
          <div class="rewind-tool-section">
            <div class="rewind-section-label">原消息</div>
            <div class="rewind-section-content">
              <div class="rewind-message-box">
                {{ messageContent }}
              </div>
            </div>
          </div>

          <!-- 变更统计和文件列表 -->
          <div class="rewind-tool-section">
            <div class="rewind-section-label">
              变更内容
              <span class="rewind-inline-stats">
                <span class="stat-mini deletions">-{{ message.deletions || 0 }}</span>
                <span class="stat-mini separator">/</span>
                <span class="stat-mini insertions">+{{ message.insertions || 0 }}</span>
                <span class="stat-unit">行</span>
              </span>
            </div>
            <div v-if="message.restoredFiles && message.restoredFiles.length > 0" class="rewind-section-content">
              <div class="rewind-files-list">
                <div
                  v-for="(file, fileIndex) in message.restoredFiles"
                  :key="fileIndex"
                  class="rewind-file-item"
                >
                  <span class="file-icon">📝</span>
                  <span class="file-path">{{ file }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>
    </div>
  </div>
  <Teleport to="body">
    <svg v-if="connectorVisible" class="rewind-connector-overlay" aria-hidden="true">
      <path :d="connectorPath" class="rewind-connector-path" />
    </svg>
  </Teleport>
</template>

<style scoped>
.rewind-message-wrapper {
  flex: 0 1 auto;
  width: 100%;
  max-width: min(100%, 600px);
  margin: 20px auto;
}

.rewind-connector-overlay {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  pointer-events: none;
  z-index: 20;
  overflow: visible;
}

.rewind-connector-path {
  fill: none;
  stroke: rgba(245, 158, 11, 0.42);
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* Rewind notice 气泡 - 和参考项目保持一致 */
.rewind-notice {
  background: linear-gradient(135deg, #1E1E2E 0%, #18181B 100%);
  border: 1px solid #F59E0B;
  border-left: 3px solid #F59E0B;
  border-radius: 8px;
  overflow: hidden;
  transition: all 0.3s ease;
}

.rewind-notice.surface-ghost {
  background: transparent;
  border: none;
  border-radius: 0;
}

.rewind-notice:hover {
  box-shadow: 0 2px 8px rgba(245, 158, 11, 0.2);
}

.rewind-notice.surface-ghost:hover {
  box-shadow: none;
}

.rewind-ghost-shell {
  padding: 0;
  margin: 0;
}

.rewind-ghost-header {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  min-width: 0;
  cursor: pointer;
  margin: 0;
  padding: 0;
  background: transparent;
  position: relative;
}

.rewind-ghost-info {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 0 1 auto;
  min-width: 0;
  min-height: 20px;
}

.rewind-ghost-body {
  margin-top: 8px;
  padding-top: 0;
  padding-left: 24px;
}

.rewind-ghost-card {
  background: linear-gradient(135deg, #1E1E2E 0%, #18181B 100%);
  border: 1px solid #F59E0B;
  border-left: 3px solid #F59E0B;
  border-radius: 8px;
  overflow: hidden;
  padding: 12px 14px;
}

.rewind-title.ghost {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  font-weight: 500;
  color: #f59e0b;
  line-height: 20px;
  flex-shrink: 0;
}

.rewind-preview-text.ghost {
  min-width: 0;
  flex: 1 1 auto;
  color: #8B93A7;
  font-size: 12px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rewind-hint.ghost {
  flex-shrink: 0;
  padding: 0;
}

.rewind-collapse-btn.ghost {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 12px;
  height: 12px;
  font-size: 10px;
  color: #888;
  flex-shrink: 0;
}

.rewind-collapse-btn.ghost svg {
  display: block;
}

.rewind-notice.rewind-collapsed {
  opacity: 0.85;
}

.rewind-notice.rewind-collapsed:hover {
  opacity: 1;
}

/* 折叠时的两行布局 */
.rewind-header-collapsed {
  display: flex;
  flex-direction: column;
  padding: 10px 14px;
  gap: 6px;
  cursor: pointer;
  user-select: none;
  transition: background 0.2s ease;
}

.rewind-header-collapsed:hover {
  background: rgba(255, 255, 255, 0.03);
}

.rewind-notice.surface-ghost .rewind-header-collapsed:hover {
  background: rgba(245, 158, 11, 0.05);
}

.rewind-header-row-1 {
  display: flex;
  align-items: center;
  gap: 10px;
}

.rewind-header-row-2 {
  overflow: hidden;
}

/* 展开时的 header */
.rewind-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: #252526;
  cursor: pointer;
  user-select: none;
  min-width: 0;
  transition: background 0.2s ease;
}

.rewind-meta-time {
  flex-shrink: 0;
  font-size: 11px;
  color: #71717A;
  line-height: 1;
}

.rewind-notice.surface-ghost .rewind-header {
  background: transparent;
}

.rewind-header:hover {
  background: #2D2D30;
}

.rewind-notice.surface-ghost .rewind-header:hover {
  background: rgba(245, 158, 11, 0.05);
}

.rewind-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.rewind-title {
  font-size: 13px;
  font-weight: 600;
  color: #F59E0B;
}

.rewind-stat-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  flex-shrink: 0;
}

.rewind-stat-badge.files {
  background: rgba(245, 158, 11, 0.15);
  color: #FCD34D;
}

.rewind-stat-badge.lines {
  background: rgba(255, 255, 255, 0.05);
}

.stat-mini {
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  font-size: 11px;
}

.stat-mini.deletions {
  color: #ff6b6b;
}

.stat-mini.insertions {
  color: #51cf66;
}

.stat-mini.separator {
  color: #666;
  margin: 0 2px;
}

.stat-unit {
  color: #a0a0b0;
  font-size: 11px;
  margin-left: 2px;
}

.rewind-spacer {
  flex: 1;
}

.rewind-hint {
  color: #888;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.2s ease;
  flex-shrink: 0;
}

.rewind-hint:hover {
  background: rgba(245, 158, 11, 0.15);
  color: #F59E0B;
}

.rewind-collapse-btn {
  font-size: 10px;
  color: #888;
  transition: transform 0.2s ease;
  flex-shrink: 0;
}

.rewind-preview-text {
  font-size: 12px;
  color: #888;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 展开内容区 */
.rewind-body {
  padding: 0 14px 12px;
  border-top: 1px solid rgba(245, 158, 11, 0.2);
}

.rewind-notice.surface-ghost .rewind-body {
  border-top: 1px solid rgba(245, 158, 11, 0.12);
}

.rewind-notice.surface-ghost .rewind-section-label {
  color: #a1a1aa;
}

.rewind-tool-section {
  margin-top: 10px;
}

.rewind-section-label {
  font-size: 11px;
  color: #888;
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.rewind-section-content {
  font-size: 13px;
}

.rewind-message-box {
  background: rgba(0, 0, 0, 0.3);
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 12px;
  color: #ccc;
  max-height: 80px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
}

.rewind-notice.surface-ghost .rewind-message-box {
  background: #18181B;
  color: #a1a1aa;
}

.rewind-message-box {
  position: relative;
  padding-right: 32px;
}

.rewind-inline-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #888;
  cursor: pointer;
  flex-shrink: 0;
  transition: all 0.2s ease;
}

.rewind-inline-action:hover {
  color: #F59E0B;
}

.rewind-inline-action.in-box {
  position: absolute;
  top: 6px;
  right: 6px;
}

.rewind-message-box-text {
  white-space: pre-wrap;
  word-break: break-all;
}

.rewind-inline-stats {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  margin-left: auto;
}

.rewind-files-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 200px;
  overflow-y: auto;
  padding: 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 6px;
}

.rewind-notice.surface-ghost .rewind-files-list {
  background: #18181B;
}

.rewind-file-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: rgba(245, 158, 11, 0.08);
  border-radius: 4px;
  font-size: 12px;
  color: #C0C0D0;
}

.rewind-file-item .file-icon {
  font-size: 12px;
  flex-shrink: 0;
}

.rewind-file-item .file-path {
  font-family: 'SF Mono', Monaco, 'Courier New', monospace;
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}
</style>
