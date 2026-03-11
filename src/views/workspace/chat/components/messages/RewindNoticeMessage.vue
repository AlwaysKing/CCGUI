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
  <div class="message-avatar">↩️</div>
  <div class="rewind-message-wrapper">
    <!-- 时间头部 -->
    <div v-if="message.timestamp" class="message-header rewind-header-time">
      <span class="header-time">
        <span class="header-icon">🕐</span>
        {{ new Date(message.timestamp).toLocaleTimeString() }}
      </span>
    </div>
    <!-- 实际的气泡 -->
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
              <div class="rewind-files-grid">
                <div
                  v-for="(file, fileIndex) in message.restoredFiles"
                  :key="fileIndex"
                  class="rewind-file-chip"
                >
                  <span class="file-icon">📝</span>
                  <span class="file-path">{{ file.split('/').pop() }}</span>
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

.rewind-header-time {
  padding: 4px 0;
}

.rewind-notice {
  background: var(--bg-secondary);
  border-radius: var(--radius-lg);
  overflow: hidden;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.rewind-notice:hover {
  background: var(--bg-tertiary);
}

.rewind-notice.rewind-collapsed {
  background: var(--bg-secondary);
}

.rewind-notice.rewind-collapsed:hover {
  background: var(--bg-tertiary);
}

.rewind-header-collapsed,
.rewind-header {
  display: flex;
  flex-direction: column;
  padding: 10px 12px;
  gap: 6px;
}

.rewind-header-row-1 {
  display: flex;
  align-items: center;
  gap: 8px;
}

.rewind-header-row-2 {
  overflow: hidden;
}

.rewind-icon {
  font-size: 14px;
}

.rewind-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}

.rewind-stat-badge {
  font-size: var(--font-size-xs);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
  background: var(--bg-tertiary);
}

.rewind-stat-badge.files {
  color: var(--text-secondary);
}

.rewind-stat-badge.lines {
  background: var(--bg-tertiary);
}

.stat-mini {
  font-family: var(--font-family-mono);
}

.stat-mini.deletions {
  color: var(--color-error);
}

.stat-mini.insertions {
  color: var(--color-success);
}

.stat-mini.separator {
  color: var(--text-muted);
  margin: 0 2px;
}

.stat-unit {
  color: var(--text-muted);
  font-size: var(--font-size-xs);
}

.rewind-spacer {
  flex: 1;
}

.rewind-hint {
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px;
  border-radius: var(--radius-sm);
  transition: all var(--transition-fast);
}

.rewind-hint:hover {
  background: var(--bg-hover);
  color: var(--accent-primary);
}

.rewind-collapse-btn {
  font-size: 10px;
  color: var(--text-muted);
  transition: transform var(--transition-fast);
}

.rewind-preview-text {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.rewind-body {
  padding: 0 12px 12px;
  border-top: 1px solid var(--border-default);
}

.rewind-tool-section {
  margin-top: 10px;
}

.rewind-section-label {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
  margin-bottom: 6px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.rewind-section-content {
  font-size: var(--font-size-sm);
}

.rewind-message-box {
  background: var(--bg-tertiary);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
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

.rewind-files-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.rewind-file-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: var(--bg-tertiary);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
}

.rewind-file-chip .file-icon {
  font-size: 12px;
}

.rewind-file-chip .file-path{
  max-width: 150px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
