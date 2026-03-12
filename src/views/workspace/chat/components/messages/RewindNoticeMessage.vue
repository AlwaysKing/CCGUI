<script setup>
/**
 * RewindNoticeMessage - 还原消息通知组件
 * 从 ChatWindow.vue 提取
 */
import { computed } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  isCollapsed: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits(['toggleCollapse', 'jumpToMessage'])

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
</script>

<template>
  <div class="rewind-message-wrapper">
    <!-- 气泡 -->
    <div
      class="rewind-notice"
      :class="{ 'rewind-collapsed': isCollapsed }"
    >
      <!-- 折叠时的布局 -->
      <template v-if="isCollapsed">
        <div class="rewind-header-collapsed" @click="toggleCollapse">
          <div class="rewind-header-row-1">
            <span class="rewind-icon">↩️</span>
            <span class="rewind-title">已还原到消息</span>
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
          <span class="rewind-title">已还原到消息</span>
          <span class="rewind-spacer"></span>
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
</template>

<style scoped>
.rewind-message-wrapper {
  flex: 1;
  max-width: 70%;
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

.rewind-notice:hover {
  box-shadow: 0 2px 8px rgba(245, 158, 11, 0.2);
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

.rewind-header:hover {
  background: #2D2D30;
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
