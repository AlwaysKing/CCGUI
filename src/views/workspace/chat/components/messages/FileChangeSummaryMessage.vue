<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  chatTheme: {
    type: Object,
    default: () => ({})
  }
})

const expanded = ref(false)

const totalFiles = computed(() => props.message.totalFiles || props.message.files?.length || 0)
const totalInsertions = computed(() => props.message.totalInsertions || 0)
const totalDeletions = computed(() => props.message.totalDeletions || 0)
const files = computed(() => props.message.files || [])
const isTextStyle = computed(() => (props.chatTheme?.messageSurface || 'bubble') === 'ghost')
const fileCountText = computed(() => `${totalFiles.value} 个文件已更改`)

const summaryText = computed(() => {
  const parts = []
  parts.push(`${totalFiles.value} 个文件`)
  if (totalInsertions.value > 0) parts.push(`+${totalInsertions.value}`)
  if (totalDeletions.value > 0) parts.push(`-${totalDeletions.value}`)
  return parts.join(' ')
})

function toggleExpand() {
  expanded.value = !expanded.value
}
</script>

<template>
  <div class="file-change-summary-wrapper">
    <div class="file-change-summary" :class="{ expanded, 'surface-ghost': isTextStyle }">
      <span class="summary-line" aria-hidden="true"></span>
      <div class="summary-content">
        <div class="summary-header" @click="toggleExpand">
          <template v-if="isTextStyle">
            <div class="summary-main">
              <span class="summary-title">{{ fileCountText }}</span>
              <span v-if="totalInsertions > 0" class="summary-stat stat-add">+{{ totalInsertions }}</span>
              <span v-if="totalDeletions > 0" class="summary-stat stat-del">-{{ totalDeletions }}</span>
            </div>
            <span v-if="files.length > 1" class="summary-toggle">{{ expanded ? '收起' : '展开' }}</span>
          </template>
          <template v-else>
            <span class="summary-icon">📝</span>
            <span class="summary-title">{{ summaryText }}</span>
            <span v-if="files.length > 1" class="summary-toggle">{{ expanded ? '收起' : '展开' }}</span>
          </template>
        </div>
        <div v-if="expanded && files.length > 0" class="summary-file-list">
          <div v-for="file in files" :key="file.path" class="summary-file-item">
            <span class="file-path" :title="file.path">{{ file.path }}</span>
            <span class="file-stats">
              <span v-if="file.insertions" class="stat-add">+{{ file.insertions }}</span>
              <span v-if="file.deletions" class="stat-del">-{{ file.deletions }}</span>
            </span>
          </div>
        </div>
      </div>
      <span class="summary-line" aria-hidden="true"></span>
    </div>
  </div>
</template>

<style scoped>
.file-change-summary-wrapper {
  display: flex;
  justify-content: center;
  width: 100%;
  margin: 6px 0;
}

.file-change-summary {
  display: flex;
  align-items: center;
  gap: 12px;
  width: min(100%, 820px);
  color: #a1a1aa;
  font-size: 12px;
}

.file-change-summary.surface-ghost {
  gap: 0;
  width: min(100%, 600px);
  color: #71717a;
}

.summary-line {
  flex: 1;
  min-width: 28px;
  border-top: 1px dashed rgba(113, 113, 122, 0.42);
}

.file-change-summary.surface-ghost .summary-line {
  display: none;
}

.summary-content {
  flex-shrink: 0;
  max-width: min(70%, 720px);
  min-width: 0;
  text-align: center;
}

.file-change-summary.surface-ghost .summary-content {
  width: 100%;
  max-width: 600px;
  background: linear-gradient(180deg, rgba(27, 30, 36, 0.94) 0%, rgba(22, 24, 29, 0.96) 100%);
  border: 1px solid rgba(120, 136, 168, 0.16);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 8px 24px rgba(3, 8, 20, 0.16);
}

.summary-header {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: #d4d4d8;
  opacity: 0.72;
  cursor: default;
  user-select: none;
}

.file-change-summary .summary-header {
  cursor: pointer;
}

.file-change-summary.surface-ghost .summary-header {
  display: flex;
  width: 100%;
  justify-content: space-between;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 8px 8px 0 0;
  color: #e7edf8;
  opacity: 1;
  font-size: 15px;
  font-weight: 700;
}

.summary-icon {
  font-size: 12px;
  line-height: 1;
  opacity: 0.8;
}

.file-change-summary.surface-ghost .summary-icon {
  font-size: 11px;
  opacity: 0.6;
}

.summary-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-main {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  min-width: 0;
}

.file-change-summary.surface-ghost .summary-main {
  flex-wrap: wrap;
}

.summary-stat {
  font-weight: 700;
  letter-spacing: -0.01em;
}

.summary-toggle {
  font-size: 11px;
  color: #71717a;
  opacity: 0.6;
}

.file-change-summary.surface-ghost .summary-toggle {
  color: #8f9bb3;
  opacity: 1;
  font-size: 12px;
  font-weight: 600;
}

.summary-file-list {
  margin-top: 6px;
  text-align: left;
  padding: 6px 10px;
  background: rgba(39, 39, 42, 0.5);
  border-radius: 6px;
  border: 1px solid rgba(63, 63, 70, 0.4);
}

.file-change-summary.surface-ghost .summary-file-list {
  margin-top: 0;
  padding: 0;
  background: rgba(13, 17, 24, 0.28);
  border: none;
  border-top: 1px solid rgba(120, 136, 168, 0.14);
  border-radius: 0;
}

.summary-file-item {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;
  padding: 2px 0;
  font-size: 11px;
  line-height: 1.5;
}

.file-change-summary.surface-ghost .summary-file-item {
  align-items: center;
  padding: 14px 16px;
  gap: 12px;
  font-size: 14px;
  line-height: 1.3;
}

.file-change-summary.surface-ghost .summary-file-item + .summary-file-item {
  border-top: 1px solid rgba(120, 136, 168, 0.12);
}

.file-path {
  color: #a1a1aa;
  word-break: break-all;
  min-width: 0;
  flex: 1;
}

.file-change-summary.surface-ghost .file-path {
  color: #d7deea;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.92em;
  font-weight: 600;
  line-height: 1.35;
  word-break: break-word;
}

.file-stats {
  display: inline-flex;
  gap: 6px;
  flex-shrink: 0;
  font-family: monospace;
  font-size: 11px;
}

.file-change-summary.surface-ghost .file-stats {
  gap: 8px;
  align-items: baseline;
  font-size: 0.95em;
  font-weight: 700;
}

.stat-add {
  color: #3ddc84;
  opacity: 0.9;
}

.stat-del {
  color: #ff6b6b;
  opacity: 0.9;
}

.file-change-summary.surface-ghost .stat-add,
.file-change-summary.surface-ghost .stat-del {
  opacity: 1;
}
</style>
