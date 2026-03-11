<script setup>
/**
 * DiffViewer - 代码差异对比视图组件
 */
import { computed } from 'vue'

const props = defineProps({
  oldContent: {
    type: String,
    default: ''
  },
  newContent: {
    type: String,
    default: ''
  },
  operationType: {
    type: String,
    default: 'replace' // 'add', 'delete', 'replace'
  }
})

// 按行分割
const oldLines = computed(() => props.oldContent.split('\n'))
const newLines = computed(() => props.newContent.split('\n'))

// 操作类型标签
const operationLabel = computed(() => {
  switch (props.operationType) {
    case 'add':
      return '添加内容'
    case 'delete':
      return '删除内容'
    default:
      return '替换内容'
  }
})

// 统计信息
const stats = computed(() => {
  const oldCount = oldLines.value.length
  const newCount = newLines.value.length
  const added = props.operationType === 'add' ? newCount : Math.max(0, newCount - oldCount)
  const removed = props.operationType === 'delete' ? oldCount : Math.max(0, oldCount - newCount)
  return { added, removed, oldCount, newCount }
})
</script>

<template>
  <div class="diff-viewer">
    <!-- 统计信息 -->
    <div class="diff-stats">
      <span class="diff-operation">{{ operationLabel }}</span>
      <span class="diff-stat-item added">+{{ stats.added }}</span>
      <span class="diff-stat-item removed">-{{ stats.removed }}</span>
    </div>

    <!-- 差异内容 -->
    <div class="diff-content">
      <!-- 删除/旧内容 -->
      <div v-if="oldContent && operationType !== 'add'" class="diff-section removed">
        <div class="diff-section-header">
          <span class="diff-section-label">删除的内容</span>
          <span class="diff-section-count">{{ stats.oldCount }} 行</span>
        </div>
        <div class="diff-lines">
          <div v-for="(line, idx) in oldLines" :key="'old-' + idx" class="diff-line removed">
            <span class="line-number">{{ idx + 1 }}</span>
            <span class="line-content">{{ line || ' ' }}</span>
          </div>
        </div>
      </div>

      <!-- 添加/新内容 -->
      <div v-if="newContent && operationType !== 'delete'" class="diff-section added">
        <div class="diff-section-header">
          <span class="diff-section-label">添加的内容</span>
          <span class="diff-section-count">{{ stats.newCount }} 行</span>
        </div>
        <div class="diff-lines">
          <div v-for="(line, idx) in newLines" :key="'new-' + idx" class="diff-line added">
            <span class="line-number">{{ idx + 1 }}</span>
            <span class="line-content">{{ line || ' ' }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.diff-viewer {
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.diff-stats {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-xs) var(--spacing-sm);
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-default);
}

.diff-operation {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
}

.diff-stat-item {
  font-size: var(--font-size-xs);
  font-family: var(--font-family-mono);
}

.diff-stat-item.added {
  color: var(--color-success);
}

.diff-stat-item.removed {
  color: var(--color-error);
}

.diff-content {
  max-height: 300px;
  overflow: auto;
}

.diff-section {
  border-bottom: 1px solid var(--border-default);
}

.diff-section:last-child {
  border-bottom: none;
}

.diff-section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-xs) var(--spacing-sm);
  font-size: var(--font-size-xs);
}

.diff-section.added .diff-section-header {
  background: var(--color-success-bg);
}

.diff-section.removed .diff-section-header {
  background: var(--color-error-bg);
}

.diff-section-label {
  color: var(--text-secondary);
  font-weight: var(--font-weight-medium);
}

.diff-section-count {
  color: var(--text-muted);
}

.diff-lines {
  background: var(--code-bg);
}

.diff-line {
  display: flex;
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  line-height: 1.5;
}

.diff-line.added {
  background: rgba(34, 197, 94, 0.1);
}

.diff-line.removed {
  background: rgba(239, 68, 68, 0.1);
}

.line-number {
  min-width: 40px;
  padding: 0 var(--spacing-sm);
  text-align: right;
  color: var(--text-muted);
  background: var(--bg-secondary);
  user-select: none;
}

.line-content {
  flex: 1;
  padding: 0 var(--spacing-sm);
  white-space: pre;
  overflow-x: auto;
}

.diff-line.added .line-content::before {
  content: '+';
  color: var(--color-success);
  margin-right: var(--spacing-xs);
}

.diff-line.removed .line-content::before {
  content: '-';
  color: var(--color-error);
  margin-right: var(--spacing-xs);
}
</style>
