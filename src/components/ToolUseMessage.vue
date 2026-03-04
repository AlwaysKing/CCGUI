<script setup>
import { computed } from 'vue'

const emit = defineEmits(['toggle-collapse'])

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
  },
  collapsed: {
    type: Boolean,
    default: false
  }
})

const isExpanded = computed(() => !props.collapsed)

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
    EnterWorktree: '🌳',
    TodoWrite: '✅'
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
    case 'TodoWrite':
      // 显示任务列表
      const todos = input.todos || []
      const completed = todos.filter(t => t.status === 'completed').length
      const inProgress = todos.filter(t => t.status === 'in_progress').length
      const pending = todos.filter(t => t.status === 'pending').length

      // 格式化每个任务，使用更清晰的状态标识
      const formattedTodos = todos.map(t => {
        const status = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⏳'
        return `${status}  ${t.content}`
      }).join('<br>')

      return {
        label: `${todos.length} 个任务 (✅${completed} ⏳${pending} 🔄${inProgress})`,
        value: formattedTodos,
        description: null
      }
    default:
      if (input.description) {
        return { label: '描述', value: input.description, description: null }
      }
      return null
  }
})

// 折叠时显示的精简摘要
const collapsedSummary = computed(() => {
  const input = props.toolInput
  if (!input) return ''

  switch (props.toolName) {
    case 'Bash':
      // 显示命令的前30个字符
      const cmd = input.command || ''
      return cmd.length > 40 ? cmd.substring(0, 40) + '...' : cmd
    case 'Read':
    case 'Edit':
    case 'Write':
      // 只显示文件名
      const path = input.file_path || ''
      const fileName = path.split('/').pop() || path
      return fileName
    case 'Glob':
    case 'Grep':
      return input.pattern || ''
    case 'WebSearch':
      const query = input.query || ''
      return query.length > 40 ? query.substring(0, 40) + '...' : query
    case 'TodoWrite':
      const todos = input.todos || []
      if (todos.length === 0) return '无任务'

      // 格式化每个任务，和展开时一样的样式
      const formattedTodos = todos.map(t => {
        const status = t.status === 'completed' ? '✅' : t.status === 'in_progress' ? '🔄' : '⏳'
        return `${status}  ${t.content}`
      }).join('<br>')

      // 如果所有任务都完成，只显示最后一步
      const allCompleted = todos.every(t => t.status === 'completed')
      if (allCompleted) {
        return formattedTodos.split('<br>')[todos.length - 1]
      }

      // 如果第一个任务正在进行，只显示执行中的任务
      const firstTodo = todos[0]
      if (firstTodo?.status === 'in_progress') {
        return formattedTodos.split('<br>')[0]
      }

      // 如果有任务正在进行，找到正在进行的任务和它的前一个已完成任务
      const inProgressIndex = todos.findIndex(t => t.status === 'in_progress')
      if (inProgressIndex !== -1 && inProgressIndex > 0) {
        const lastCompletedIndex = inProgressIndex - 1
        return [formattedTodos.split('<br>')[lastCompletedIndex], formattedTodos.split('<br>')[inProgressIndex]].join('<br>')
      }

      // 默认显示第一个任务
      return formattedTodos.split('<br>')[0]
    default:
      return ''
  }
})

// 格式化结果显示
const formattedResult = computed(() => {
  if (!props.result) return null
  return props.result
})

function toggleExpand() {
  emit('toggle-collapse')
}
</script>

<template>
  <div class="tool-use-card" :class="{ error: isError, executing: isExecuting, collapsed: !isExpanded }">
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
    <!-- 折叠时显示精简摘要 -->
    <div v-if="!isExpanded && collapsedSummary" class="collapsed-summary-line" :class="{ 'todo-collapsed': props.toolName === 'TodoWrite' }" @click="toggleExpand" v-html="collapsedSummary">
    </div>

    <div v-if="isExpanded" class="tool-body">
      <!-- 描述 -->
      <div v-if="primaryContent?.description" class="tool-section">
        <div class="section-label">说明</div>
        <div class="section-content description">{{ primaryContent.description }}</div>
      </div>

      <!-- 主要内容 -->
      <div v-if="primaryContent" class="tool-section">
        <div class="section-label" :class="{ 'todo-label': props.toolName === 'TodoWrite' }">{{ primaryContent.label }}</div>
        <!-- TodoWrite 专用样式 -->
        <template v-if="props.toolName === 'TodoWrite'">
          <div class="section-content todo-list" v-html="primaryContent.value"></div>
        </template>
        <template v-else>
          <div class="section-content todo-list">{{ primaryContent.value }}</div>
        </template>
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
  background: linear-gradient(135deg, #1E1E2E 0%, #18181B 100%);
  border: 1px solid #3B82F6;
  border-left: 3px solid #3B82F6;
  border-radius: 8px;
  overflow: hidden;
  margin: 8px 0;
  max-width: 100%;
}

.tool-use-card.error {
  border-color: #EF4444;
  border-left-color: #EF4444;
}

.tool-use-card.executing {
  border-color: #3B82F6;
  border-left-color: #3B82F6;
}

.tool-use-card.collapsed {
  opacity: 0.85;
}

.tool-use-card.collapsed:hover {
  opacity: 1;
}

.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #252526;
  cursor: pointer;
  user-select: none;
  min-width: 0;
}

.tool-header:hover {
  background: #2D2D30;
}

.tool-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.tool-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.tool-name {
  font-size: 13px;
  font-weight: 600;
  color: #E4E4E7;
  flex-shrink: 0;
}

.collapsed-summary-line {
  padding: 8px 14px;
  font-size: 12px;
  color: #94A3B8;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-top: 1px solid rgba(59, 130, 246, 0.15);
  cursor: pointer;
  background: rgba(59, 130, 246, 0.03);
}

.collapsed-summary-line:hover {
  background: rgba(59, 130, 246, 0.06);
}

/* TodoWrite 折叠时允许多行显示 */
.collapsed-summary-line.todo-collapsed {
  white-space: pre-wrap;
  line-height: 1.6;
  padding: 10px 14px;
  font-size: 13px;
}

.status-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
  flex-shrink: 0;
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
  flex-shrink: 0;
  margin-left: 8px;
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

/* TodoWrite 标签样式 */
.section-label.todo-label {
  font-size: 13px;
  color: #60A5FA;
  font-weight: 600;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.section-content {
  font-size: 12px;
  color: #D4D4D4;
  line-height: 1.5;
}

.section-content.description {
  color: #A1A1AA;
  white-space: pre-wrap;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  background: #18181B;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.6;
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

.section-content.todo-list {
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  background: linear-gradient(135deg, #1E293B 0%, #0F172A 100%);
  padding: 14px 16px;
  border-radius: 8px;
  color: #F8FAFC;
  font-size: 15px;
  line-height: 1.8;
  white-space: pre-wrap;
  word-break: break-word;
  border: 1px solid rgba(59, 130, 246, 0.2);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
}

/* 任务之间的间距增强 */
.section-content.todo-list .task-separator {
  display: block;
  height: 1px;
  background: rgba(59, 130, 246, 0.1);
  margin: 4px 0;
}

.section-content.result {
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  background: #18181B;
  padding: 10px 12px;
  border-radius: 6px;
  max-height: 600px;
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
