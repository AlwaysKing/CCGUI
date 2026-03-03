<script setup>
import { computed } from 'vue'

const props = defineProps({
  request: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['approve', 'deny', 'approve-all'])

const toolName = computed(() => props.request?.tool_name || 'Unknown')
const toolInput = computed(() => {
  if (!props.request?.tool_input) return null
  try {
    if (typeof props.request.tool_input === 'string') {
      return JSON.parse(props.request.tool_input)
    }
    return props.request.tool_input
  } catch {
    return props.request.tool_input
  }
})

// 获取要显示的详细信息
const displayDetail = computed(() => {
  if (!toolInput.value) return null

  const input = toolInput.value

  // Bash 工具显示命令
  if (props.request?.tool_name === 'Bash' && input.command) {
    return {
      label: '命令',
      value: input.command,
      description: input.description
    }
  }

  // Read 工具显示文件路径
  if (props.request?.tool_name === 'Read' && input.file_path) {
    return {
      label: '文件',
      value: input.file_path
    }
  }

  // Write/Edit 工具显示文件路径
  if ((props.request?.tool_name === 'Write' || props.request?.tool_name === 'Edit') && input.file_path) {
    return {
      label: '文件',
      value: input.file_path
    }
  }

  // Glob 工具显示模式
  if (props.request?.tool_name === 'Glob' && input.pattern) {
    return {
      label: '模式',
      value: input.pattern
    }
  }

  // Grep 工具显示搜索模式
  if (props.request?.tool_name === 'Grep' && input.pattern) {
    return {
      label: '搜索',
      value: input.pattern,
      path: input.path
    }
  }

  return null
})

function handleApprove() {
  emit('approve', props.request.request_id, toolName.value, displayDetail.value)
}

function handleDeny() {
  emit('deny', props.request.request_id)
}

function handleApproveAll() {
  emit('approve-all', props.request.request_id)
}
</script>

<template>
  <div class="permission-dialog-overlay" v-if="request" data-permission-dialog>
    <div class="permission-bar" data-permission-dialog-inner>
      <div class="permission-content">
        <div class="permission-header">
          <span class="icon">🔐</span>
          <span class="tool-name">{{ toolName }}</span>
        </div>

        <!-- 显示详细操作信息 -->
        <div class="permission-detail" v-if="displayDetail">
          <div class="detail-row" v-if="displayDetail.description">
            <span class="detail-label">说明:</span>
            <span class="detail-value description">{{ displayDetail.description }}</span>
          </div>
          <div class="detail-row">
            <span class="detail-label">{{ displayDetail.label }}:</span>
            <code class="detail-value code">{{ displayDetail.value }}</code>
          </div>
          <div class="detail-row" v-if="displayDetail.path">
            <span class="detail-label">路径:</span>
            <code class="detail-value code">{{ displayDetail.path }}</code>
          </div>
        </div>

        <div class="permission-description" v-else>
          {{ request.tool_input?.description || 'Claude 需要使用此工具' }}
        </div>
      </div>

      <div class="action-buttons">
        <button @click="handleDeny" class="action-btn deny">
          拒绝
        </button>
        <button @click="handleApprove" class="action-btn approve">
          允许
        </button>
        <button @click="handleApproveAll" class="action-btn approve-all">
          都允许
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.permission-dialog-overlay {
  position: fixed;
  bottom: 120px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 99999;
  pointer-events: none;
  width: 90%;
  max-width: 800px;
}

.permission-bar {
  pointer-events: auto;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  padding: 14px 18px;
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.permission-content {
  flex: 1;
  min-width: 0;
}

.permission-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}

.icon {
  font-size: 18px;
  line-height: 1;
}

.tool-name {
  font-size: 14px;
  font-weight: 600;
  color: #F97316;
}

.permission-detail {
  background: #18181B;
  border-radius: 8px;
  padding: 10px 12px;
  margin-top: 4px;
}

.detail-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 6px;
}

.detail-row:last-child {
  margin-bottom: 0;
}

.detail-label {
  font-size: 12px;
  color: #71717A;
  flex-shrink: 0;
  min-width: 45px;
}

.detail-value {
  font-size: 12px;
  color: #E4E4E7;
}

.detail-value.description {
  color: #A1A1AA;
}

.detail-value.code {
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  background: #27272A;
  padding: 2px 6px;
  border-radius: 4px;
  color: #93C5FD;
  word-break: break-all;
  display: inline-block;
  max-width: 100%;
  overflow-wrap: break-word;
}

.permission-description {
  font-size: 13px;
  color: #A1A1AA;
  line-height: 1.4;
}

.action-buttons {
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}

.action-btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.action-btn.deny {
  background: #3F3F46;
  color: #E4E4E7;
}

.action-btn.deny:hover {
  background: #52525B;
}

.action-btn.approve {
  background: #F97316;
  color: white;
}

.action-btn.approve:hover {
  background: #EA580C;
}

.action-btn.approve-all {
  background: #059669;
  color: white;
}

.action-btn.approve-all:hover {
  background: #047857;
}

.action-btn:active {
  transform: scale(0.96);
}
</style>
