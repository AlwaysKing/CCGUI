<script setup>
import { ref, computed } from 'vue'

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

const formatInput = computed(() => {
  if (!toolInput.value) return ''
  return JSON.stringify(toolInput.value, null, 2)
})

function handleApprove() {
  emit('approve', props.request.request_id)
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
      <div class="permission-header">
        <span class="icon">🔐</span>
        <span class="tool-name">{{ toolName }}</span>
        <span class="permission-description">{{ request.tool_input?.description || 'Claude 需要使用此工具' }}</span>
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
  width: 80%;
  max-width: 700px;
}

.permission-bar {
  pointer-events: auto;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  padding: 12px 16px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.permission-header {
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 1;
  min-width: 0;
}

.icon {
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
}

.tool-name {
  font-size: 14px;
  font-weight: 600;
  color: #F97316;
  white-space: nowrap;
  flex-shrink: 0;
}

.permission-description {
  font-size: 13px;
  color: #A1A1AA;
  line-height: 1.4;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action-buttons {
  display: flex;
  gap: 8px;
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
