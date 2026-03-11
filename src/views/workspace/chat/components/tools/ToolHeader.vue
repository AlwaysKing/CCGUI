<script setup>
/**
 * ToolHeader - 工具消息头部组件
 */
import { computed } from 'vue'

const props = defineProps({
  toolName: {
    type: String,
    required: true
  },
  isExecuting: {
    type: Boolean,
    default: false
  },
  isError: {
    type: Boolean,
    default: false
  },
  collapsed: {
    type: Boolean,
    default: false
  },
  summary: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['toggleCollapse'])

// 工具图标映射
const toolIcon = computed(() => {
  const icons = {
    Bash: '⌨️',
    Read: '📖',
    Edit: '✏️',
    Write: '📝',
    Glob: '🔍',
    Grep: '🔎',
    Agent: '🤖',
    TaskOutput: '📋',
    TaskStop: '⏹️',
    WebSearch: '🌐',
    AskUserQuestion: '❓',
    EnterPlanMode: '📋',
    EnterWorktree: '🌳',
    TodoWrite: '✅',
    Skill: '⚡'
  }
  return icons[props.toolName] || '🔧'
})

// 状态样式类
const statusClass = computed(() => {
  if (props.isExecuting) return 'executing'
  if (props.isError) return 'error'
  return 'success'
})

// 状态图标
const statusIcon = computed(() => {
  if (props.isExecuting) return '⏳'
  if (props.isError) return '✗'
  return '✓'
})

function toggle() {
  emit('toggleCollapse')
}
</script>

<template>
  <div class="tool-header" @click="toggle">
    <div class="tool-header-left">
      <span class="tool-icon">{{ toolIcon }}</span>
      <span class="tool-name">{{ toolName }}</span>
      <span class="tool-status" :class="statusClass">
        <span v-if="isExecuting" class="status-blinking">{{ statusIcon }}</span>
        <span v-else>{{ statusIcon }}</span>
      </span>
    </div>
    <div class="tool-header-right">
      <span v-if="collapsed && summary" class="tool-summary" v-html="summary"></span>
      <span class="collapse-toggle">{{ collapsed ? '▶' : '▼' }}</span>
    </div>
  </div>
</template>

<style scoped>
.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--bg-tertiary);
  border-radius: var(--radius-md);
  cursor: pointer;
  user-select: none;
  transition: background var(--transition-fast);
}

.tool-header:hover {
  background: var(--bg-hover);
}

.tool-header-left {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.tool-icon {
  font-size: 14px;
}

.tool-name {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: var(--text-primary);
}

.tool-status {
  font-size: var(--font-size-xs);
  padding: 2px 6px;
  border-radius: var(--radius-sm);
}

.tool-status.success {
  color: var(--color-success);
  background: var(--color-success-bg);
}

.tool-status.error {
  color: var(--color-error);
  background: var(--color-error-bg);
}

.tool-status.executing {
  color: var(--color-info);
  background: var(--color-info-bg);
}

.status-blinking {
  animation: blink 1s ease-in-out infinite;
}

@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.3; }
}

.tool-header-right {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
}

.tool-summary {
  font-size: var(--font-size-xs);
  color: var(--text-secondary);
  max-width: 400px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.collapse-toggle {
  font-size: 10px;
  color: var(--text-muted);
}
</style>
