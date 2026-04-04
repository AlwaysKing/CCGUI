<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  }
})

const expanded = ref(false)

const totalFiles = computed(() => props.message.totalFiles || props.message.files?.length || 0)
const totalInsertions = computed(() => props.message.totalInsertions || 0)
const totalDeletions = computed(() => props.message.totalDeletions || 0)
const files = computed(() => props.message.files || [])

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
    <div class="file-change-summary" :class="{ expanded }">
      <span class="summary-line" aria-hidden="true"></span>
      <div class="summary-content">
        <div class="summary-header" @click="toggleExpand">
          <span class="summary-icon">📝</span>
          <span class="summary-title">{{ summaryText }}</span>
          <span v-if="files.length > 1" class="summary-toggle">{{ expanded ? '收起' : '展开' }}</span>
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

.summary-line {
  flex: 1;
  min-width: 28px;
  border-top: 1px dashed rgba(113, 113, 122, 0.42);
}

.summary-content {
  flex-shrink: 0;
  max-width: min(70%, 720px);
  min-width: 0;
  text-align: center;
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

.summary-icon {
  font-size: 12px;
  line-height: 1;
  opacity: 0.8;
}

.summary-toggle {
  font-size: 11px;
  color: #71717a;
  opacity: 0.6;
}

.summary-file-list {
  margin-top: 6px;
  text-align: left;
  padding: 6px 10px;
  background: rgba(39, 39, 42, 0.5);
  border-radius: 6px;
  border: 1px solid rgba(63, 63, 70, 0.4);
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

.file-path {
  color: #a1a1aa;
  word-break: break-all;
  min-width: 0;
  flex: 1;
}

.file-stats {
  display: inline-flex;
  gap: 6px;
  flex-shrink: 0;
  font-family: monospace;
  font-size: 11px;
}

.stat-add {
  color: #4ade80;
  opacity: 0.8;
}

.stat-del {
  color: #f87171;
  opacity: 0.8;
}
</style>
