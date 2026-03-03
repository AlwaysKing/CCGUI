<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  toolName: {
    type: String,
    required: true
  },
  toolInput: {
    type: Object,
    default: () => ({})
  },
  result: {
    type: String,
    default: ''
  },
  isError: {
    type: Boolean,
    default: false
  },
  isExecuting: {
    type: Boolean,
    default: false
  }
})

const isExpanded = ref(true)

// 获取工具图标
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
    EnterWorktree: '🌳'
  }
  return icons[props.toolName] || '🔧'
})

// 获取主要显示内容
const primaryContent = computed(() => {
  const input = props.toolInput
  if (!input) return null

  switch (props.toolName) {
    case 'Bash':
      return {
        label: '命令',
        value: input.command,
        description: input.description
      }
    case 'Read':
      return {
        label: '读取文件',
        value: input.file_path,
        description: input.description
      }
    case 'Edit':
      return {
        label: '编辑文件',
        value: input.file_path,
        description: `替换: "${input.old_string?.substring(0, 50)}${input.old_string?.length > 50 ? '...' : ''}"`
      }
    case 'Write':
      return {
        label: '写入文件',
        value: input.file_path,
        description: input.description
      }
    case 'Glob':
      return {
        label: '匹配模式',
        value: input.pattern,
        description: input.path ? `在 ${input.path}` : null
      }
    case 'Grep':
      return {
        label: '搜索',
        value: input.pattern,
        description: input.path ? `在 ${input.path}` : null
      }
    case 'WebSearch':
      return {
        label: '搜索',
        value: input.query,
        description: null
      }
    default:
      if (input.description) {
        return { label: '描述', value: input.description, description: null }
      }
      return null
  }
})

// 格式化结果显示
const formattedResult = computed(() => {
  if (!props.result) return null
  // 限制显示长度
  if (props.result.length > 2000) {
    return props.result.substring(0, 2000) + '\n... (输出已截断)'
  }
  return props.result
})

function toggleExpand() {
  isExpanded.value = !isExpanded.value
}
</script>

<template>
  <div class="tool-use-card" :class="{ error: isError, executing: isExecuting }">
    <div class="tool-header" @click="toggleExpand">
      <div class="tool-info">
        <span class="tool-icon">{{ toolIcon }}</span>
        <span class="tool-name">{{ toolName }}</span>
        <span v-if="isExecuting" class="status-badge executing">执行中...</span>
        <span v-else-if="isError" class="status-badge error">失败</span>
        <span v-else-if="result" class="status-badge success">完成</span>
      </div>
      <span class="expand-icon">{{ isExpanded ? '▼' : '▶' }}</span>
    </div>

    <div v-if="isExpanded" class="tool-body">
      <!-- 描述 -->
      <div v-if="primaryContent?.description" class="tool-section">
        <div class="section-label">说明</div>
        <div class="section-content description">{{ primaryContent.description }}</div>
      </div>

      <!-- 主要内容 -->
      <div v-if="primaryContent" class="tool-section">
        <div class="section-label">{{ primaryContent.label }}</div>
        <div class="section-content code">{{ primaryContent.value }}</div>
      </div>

      <!-- 结果 -->
      <div v-if="formattedResult" class="tool-section result-section">
        <div class="section-label">结果</div>
        <pre class="section-content result" :class="{ 'error-text': isError }">{{ formattedResult }}</pre>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tool-use-card {
  background: #1E1E1E;
  border: 1px solid #333;
  border-radius: 8px;
  overflow: hidden;
  margin: 4px 0;
}

.tool-use-card.error {
  border-color: #52525B;
}

.tool-use-card.executing {
  border-color: #3B82F6;
}

.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #252526;
  cursor: pointer;
  user-select: none;
}

.tool-header:hover {
  background: #2D2D30;
}

.tool-info {
  display: flex;
  align-items: center;
  gap: 10px;
}

.tool-icon {
  font-size: 14px;
}

.tool-name {
  font-size: 13px;
  font-weight: 600;
  color: #E4E4E7;
}

.status-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}

.status-badge.executing {
  background: #1E3A5F;
  color: #93C5FD;
}

.status-badge.error {
  background: #3F3F46;
  color: #F87171;
}

.status-badge.success {
  background: #065F46;
  color: #6EE7B7;
}

.expand-icon {
  font-size: 10px;
  color: #71717A;
}

.tool-body {
  padding: 12px 14px;
  border-top: 1px solid #333;
}

.tool-section {
  margin-bottom: 10px;
}

.tool-section:last-child {
  margin-bottom: 0;
}

.section-label {
  font-size: 11px;
  color: #71717A;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.section-content {
  font-size: 12px;
  color: #D4D4D4;
  line-height: 1.5;
}

.section-content.description {
  color: #A1A1AA;
}

.section-content.code {
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  background: #18181B;
  padding: 8px 12px;
  border-radius: 6px;
  color: #93C5FD;
  word-break: break-all;
  white-space: pre-wrap;
}

.section-content.result {
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  background: #18181B;
  padding: 10px 12px;
  border-radius: 6px;
  max-height: 300px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: #A1A1AA;
}

.section-content.result.error-text {
  color: #F87171;
}

/* 滚动条样式 */
.section-content.result::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.section-content.result::-webkit-scrollbar-track {
  background: #18181B;
}

.section-content.result::-webkit-scrollbar-thumb {
  background: #3F3F46;
  border-radius: 3px;
}
</style>
