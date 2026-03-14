<script setup>
/**
 * TaskCompleteMessage - 任务完成消息组件
 * 显示子任务完成后的信息（description + summary + usage）
 */
import { computed, ref } from 'vue'
import CopyButton from '../ui/CopyButton.vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  messageIndex: {
    type: Number,
    required: true
  },
  copiedMessageIndex: {
    type: Number,
    default: -1
  }
})

const emit = defineEmits(['copyContent'])

const isCopied = computed(() => props.copiedMessageIndex === props.messageIndex)
const isCollapsed = ref(false)

// 格式化持续时间
const formattedDuration = computed(() => {
  const duration = props.message.duration
  if (!duration) return null
  if (duration < 1000) return `${duration}ms`
  if (duration < 60000) return `${(duration / 1000).toFixed(1)}s`
  return `${(duration / 60000).toFixed(1)}min`
})

// 格式化 token 用量
const formattedUsage = computed(() => {
  const usage = props.message.usage
  if (!usage) return null

  const parts = []
  if (usage.total_tokens) {
    parts.push(`${(usage.total_tokens / 1000).toFixed(1)}k tokens`)
  }
  if (usage.tool_uses) {
    parts.push(`${usage.tool_uses} tools`)
  }
  if (usage.duration_ms) {
    const d = usage.duration_ms
    if (d < 1000) parts.push(`${d}ms`)
    else if (d < 60000) parts.push(`${(d / 1000).toFixed(1)}s`)
    else parts.push(`${(d / 60000).toFixed(1)}min`)
  }
  return parts.join(' · ')
})

// 任务类型图标
const taskIcon = computed(() => {
  const taskType = props.message.taskType
  if (taskType === 'local_agent') return '🤖'
  if (taskType === 'explore') return '🔍'
  if (taskType === 'plan') return '📋'
  return '⚙️'
})

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}

function copyContent() {
  emit('copyContent', props.messageIndex)
}
</script>

<template>
  <div class="task-complete-wrapper">
    <div class="task-complete" :class="{ collapsed: isCollapsed }">
      <div class="task-header" @click="toggleCollapse">
        <span class="task-icon">{{ taskIcon }}</span>
        <div class="task-info">
          <div class="task-title">{{ message.description || '子任务完成' }}</div>
          <div class="task-meta">
            <span v-if="formattedDuration" class="meta-item">{{ formattedDuration }}</span>
            <span v-if="formattedUsage" class="meta-item">{{ formattedUsage }}</span>
          </div>
        </div>
        <div class="task-actions">
          <CopyButton
            :is-copied="isCopied"
            @copy="copyContent"
          />
          <span class="collapse-icon">{{ isCollapsed ? '▶' : '▼' }}</span>
        </div>
      </div>

      <div v-if="!isCollapsed" class="task-details">
        <!-- Prompt 信息 -->
        <div v-if="message.prompt" class="detail-section">
          <div class="detail-label">Prompt:</div>
          <pre class="detail-content prompt-content">{{ message.prompt }}</pre>
        </div>

        <!-- Summary 信息 -->
        <div v-if="message.summary" class="detail-section">
          <div class="detail-label">Summary:</div>
          <div class="detail-content summary-content">{{ message.summary }}</div>
        </div>

        <!-- Usage 详细信息 -->
        <div v-if="message.usage" class="detail-section">
          <div class="detail-label">Usage:</div>
          <div class="usage-grid">
            <div v-if="message.usage.total_tokens" class="usage-item">
              <span class="usage-key">Tokens:</span>
              <span class="usage-value">{{ message.usage.total_tokens.toLocaleString() }}</span>
            </div>
            <div v-if="message.usage.tool_uses" class="usage-item">
              <span class="usage-key">Tool Uses:</span>
              <span class="usage-value">{{ message.usage.tool_uses }}</span>
            </div>
            <div v-if="message.usage.duration_ms" class="usage-item">
              <span class="usage-key">Duration:</span>
              <span class="usage-value">{{ message.usage.duration_ms }}ms</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.task-complete-wrapper {
  display: flex;
  justify-content: flex-start;
  width: 100%;
  margin: 8px 0;
}

.task-complete {
  background: linear-gradient(135deg, #1E3A5F 0%, #1E293B 100%);
  border: 1px solid #3B82F6;
  border-left: 3px solid #3B82F6;
  border-radius: var(--radius-lg);
  max-width: 80%;
  min-width: 300px;
  overflow: hidden;
}

.task-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.15s;
}

.task-header:hover {
  background: rgba(59, 130, 246, 0.1);
}

.task-icon {
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
}

.task-info {
  flex: 1;
  min-width: 0;
}

.task-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: #93C5FD;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-meta {
  display: flex;
  gap: 8px;
  margin-top: 2px;
  font-size: var(--font-size-xs);
  color: #71717A;
}

.meta-item {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.task-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.collapse-icon {
  font-size: 10px;
  color: #71717A;
  transition: transform 0.15s;
}

.task-details {
  padding: 0 14px 12px 14px;
  border-top: 1px solid rgba(59, 130, 246, 0.2);
}

.detail-section {
  margin-top: 10px;
}

.detail-label {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: #60A5FA;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.detail-content {
  font-size: var(--font-size-xs);
  color: #D4D4D4;
  line-height: 1.5;
}

.prompt-content {
  background: rgba(0, 0, 0, 0.2);
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-family-mono);
  max-height: 150px;
  overflow: auto;
}

.summary-content {
  white-space: pre-wrap;
  word-break: break-word;
}

.usage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 6px;
}

.usage-item {
  display: flex;
  justify-content: space-between;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
}

.usage-key {
  color: #71717A;
}

.usage-value {
  color: #D4D4D4;
  font-family: var(--font-family-mono);
}
</style>
