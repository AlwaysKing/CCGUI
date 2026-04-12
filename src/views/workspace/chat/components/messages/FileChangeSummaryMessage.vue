<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  messageIndex: {
    type: Number,
    default: -1
  },
  canPatchRewind: {
    type: Boolean,
    default: false
  },
  rewindBusy: {
    type: Boolean,
    default: false
  },
  chatTheme: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['rewind'])

const expanded = ref(false)

const totalFiles = computed(() => props.message.totalFiles || props.message.files?.length || 0)
const totalInsertions = computed(() => props.message.totalInsertions || 0)
const totalDeletions = computed(() => props.message.totalDeletions || 0)
const files = computed(() => props.message.files || [])
const fileCountText = computed(() => `${totalFiles.value} 个文件已更改`)
const isPatchUndone = computed(() => props.message.patchState === 'undone')
const showPatchActionButton = computed(() => props.canPatchRewind && typeof props.message.userMessageId === 'string' && props.message.userMessageId.trim())
const patchActionLabel = computed(() => isPatchUndone.value ? '重做' : '撤销')
const patchActionTitle = computed(() => isPatchUndone.value ? '重新应用本次补丁修改' : '撤销本次补丁修改')

function toggleExpand() {
  expanded.value = !expanded.value
}

function handlePatchActionClick() {
  if (!showPatchActionButton.value || props.rewindBusy) {
    return
  }

  emit('rewind', {
    messageId: props.message.userMessageId,
    summaryMessageId: props.message.id,
    messageIndex: props.messageIndex,
    rewindMode: 'patch',
    actionType: isPatchUndone.value ? 'redo' : 'undo'
  })
}
</script>

<template>
  <div class="file-change-summary-wrapper">
    <div class="file-change-summary" :class="{ expanded, 'is-patch-undone': isPatchUndone }">
      <div class="summary-content">
        <div class="summary-header" @click="toggleExpand">
          <div class="summary-main">
            <span class="summary-title">{{ fileCountText }}</span>
            <span v-if="totalInsertions > 0" class="summary-stat stat-add">+{{ totalInsertions }}</span>
            <span v-if="totalDeletions > 0" class="summary-stat stat-del">-{{ totalDeletions }}</span>
            <span v-if="isPatchUndone" class="summary-status">已撤销</span>
          </div>
          <div class="summary-actions">
            <button
              v-if="showPatchActionButton"
              class="summary-action-btn"
              type="button"
              :disabled="rewindBusy"
              :title="patchActionTitle"
              @click.stop="handlePatchActionClick"
            >
              {{ patchActionLabel }}
            </button>
            <span v-if="files.length > 1" class="summary-toggle">{{ expanded ? '收起' : '展开' }}</span>
          </div>
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
  width: min(100%, 600px);
  color: #71717a;
  font-size: 12px;
}

.summary-content {
  width: 100%;
  max-width: 600px;
  min-width: 0;
  background: linear-gradient(180deg, rgba(27, 30, 36, 0.94) 0%, rgba(22, 24, 29, 0.96) 100%);
  border: 1px solid rgba(120, 136, 168, 0.16);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03), 0 8px 24px rgba(3, 8, 20, 0.16);
}

.summary-header {
  display: flex;
  width: 100%;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  padding: 12px 16px;
  border-radius: 8px 8px 0 0;
  color: #e7edf8;
  opacity: 1;
  font-size: 15px;
  font-weight: 700;
  cursor: pointer;
  user-select: none;
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
  flex-wrap: wrap;
}

.summary-actions {
  display: inline-flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.summary-action-btn {
  appearance: none;
  border: 1px solid rgba(120, 136, 168, 0.28);
  background: rgba(19, 27, 41, 0.6);
  color: #dce6f6;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease, opacity 0.15s ease;
}

.summary-action-btn:hover:not(:disabled) {
  background: rgba(69, 87, 121, 0.4);
  border-color: rgba(148, 163, 184, 0.5);
}

.summary-action-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.summary-stat {
  font-weight: 700;
  letter-spacing: -0.01em;
}

.summary-status {
  display: inline-flex;
  align-items: center;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(181, 83, 9, 0.18);
  border: 1px solid rgba(245, 158, 11, 0.32);
  color: #fbbf24;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.4;
}

.summary-toggle {
  font-size: 12px;
  color: #8f9bb3;
  font-weight: 600;
}

.file-change-summary.is-patch-undone .summary-content {
  opacity: 0.92;
}

.summary-file-list {
  margin-top: 0;
  padding: 0;
  background: rgba(13, 17, 24, 0.28);
  border: none;
  border-top: 1px solid rgba(120, 136, 168, 0.14);
  border-radius: 0;
}

.summary-file-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  font-size: 14px;
  line-height: 1.3;
}

.summary-file-item + .summary-file-item {
  border-top: 1px solid rgba(120, 136, 168, 0.12);
}

.file-path {
  color: #d7deea;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
  font-size: 0.92em;
  font-weight: 600;
  line-height: 1.35;
  word-break: break-word;
  min-width: 0;
  flex: 1;
}

.file-stats {
  display: inline-flex;
  gap: 8px;
  align-items: baseline;
  flex-shrink: 0;
  font-family: monospace;
  font-size: 0.95em;
  font-weight: 700;
}

.stat-add {
  color: #3ddc84;
}

.stat-del {
  color: #ff6b6b;
}
</style>
