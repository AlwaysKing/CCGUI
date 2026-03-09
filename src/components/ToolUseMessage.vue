<script setup>
import { computed } from 'vue'

const emit = defineEmits(['toggle-collapse'])

// 检测是否为空的 old_string（文件末尾添加内容）
const isAddOperation = computed(() => {
  if (props.toolName !== 'Edit') return false
  const input = mergedToolInput.value
  return input?.old_string === '' || input?.old_string === null || input?.old_string === undefined
})

// 检测是否为空的 new_string（删除内容）
const isDeleteOperation = computed(() => {
  if (props.toolName !== 'Edit') return false
  const input = mergedToolInput.value
  return input?.new_string === '' || input?.new_string === null || input?.new_string === undefined
})

// Edit 工具的 diff 数据
const editDiffData = computed(() => {
  if (props.toolName !== 'Edit') return null
  const input = mergedToolInput.value
  if (!input) return null

  const oldStr = input.old_string || ''
  const newStr = input.new_string || ''

  // 将字符串按行分割
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')

  return {
    oldLines,
    newLines,
    oldContent: oldStr,
    newContent: newStr,
    operationType: isAddOperation.value ? 'add' : isDeleteOperation.value ? 'delete' : 'replace'
  }
})

// Write 工具的内容数据
const writeContentData = computed(() => {
  if (props.toolName !== 'Write') return null
  const input = mergedToolInput.value
  if (!input) return null

  const content = input.content || ''
  const lines = content.split('\n')

  return {
    content,
    lines,
    lineCount: lines.length,
    charCount: content.length
  }
})

// Bash 工具的数据
const bashData = computed(() => {
  if (props.toolName !== 'Bash') return null
  const input = mergedToolInput.value
  if (!input) return null

  return {
    command: input.command || '',
    description: input.description || '',
    timeout: input.timeout,
    isBackground: input.run_in_background
  }
})

// Agent 工具的数据
const agentData = computed(() => {
  if (props.toolName !== 'Agent') return null
  const input = mergedToolInput.value
  if (!input) return null

  return {
    subagentType: input.subagent_type || input.subagentType || '',
    description: input.description || '',
    prompt: input.prompt || ''
  }
})

// WebSearch 工具的数据
const webSearchData = computed(() => {
  if (props.toolName !== 'WebSearch') return null
  const input = mergedToolInput.value
  if (!input) return null

  return {
    query: input.query || '',
    allowedDomains: input.allowed_domains || [],
    blockedDomains: input.blocked_domains || []
  }
})

// Grep 工具的数据
const grepData = computed(() => {
  if (props.toolName !== 'Grep') return null
  const input = mergedToolInput.value
  if (!input) return null

  return {
    pattern: input.pattern || '',
    path: input.path || '',
    glob: input.glob || '',
    outputMode: input.output_mode || 'content',
    ignoreCase: input['-i'] || false,
    contextLines: input['-C'] || input['-B'] || input['-A'] || 0,
    headLimit: input.head_limit || null,
    type: input.type || ''
  }
})

// Skill 工具的数据
const skillData = computed(() => {
  if (props.toolName !== 'Skill') return null
  const input = mergedToolInput.value
  if (!input) return null

  return {
    skill: input.skill || '',
    args: input.args || ''
  }
})

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
    type: [String, Array],
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
  },
  workingDirectory: {
    type: String,
    default: ''
  },
  isPartial: {
    type: Boolean,
    default: false
  },
  rawMessages: {
    type: Array,
    default: () => []
  }
})

const isExpanded = computed(() => !props.collapsed)

// 合并部分消息中的 tool_input
const mergedToolInput = computed(() => {
  const toolInput = props.toolInput || {}

  console.log('[ToolUseMessage] mergedToolInput computed:', {
    toolName: props.toolName,
    isPartial: props.isPartial,
    toolInputKeys: Object.keys(toolInput),
    toolInput: JSON.stringify(toolInput)
  })

  // toolInput 已经在 ChatWindow.vue 中通过 content_block_delta 事件合并完成
  // 直接返回 props.toolInput，无需额外的合并逻辑
  return toolInput
})

// 获取工具图标 (已更新)
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

// 获取主要显示内容（使用合并后的 toolInput）
const primaryContent = computed(() => {
  const input = mergedToolInput.value
  if (!input) return null

  switch (props.toolName) {
    case 'Bash':
      return {
        label: '命令',
        value: input.command,
        description: input.description,
        isBackground: input.run_in_background
      }
    case 'Read':
      // 显示文件路径，以及描述（如果有）
      const readPath = formatFilePath(input.file_path)
      const readDesc = input.description ? `${readPath}    ${input.description}` : readPath
      return {
        label: '读取文件',
        value: input.file_path,
        description: readDesc
      }
    case 'Edit':
      // 根据操作类型显示不同的描述，包含文件路径
      const editPath = formatFilePath(input.file_path)
      let editDesc = ''
      if (isAddOperation.value) {
        editDesc = `${editPath}    添加内容`
      } else if (isDeleteOperation.value) {
        editDesc = `${editPath}    删除内容`
      } else {
        const oldLen = input.old_string?.length || 0
        const newLen = input.new_string?.length || 0
        editDesc = `${editPath}    替换 ${oldLen} 字符 → ${newLen} 字符`
      }
      return {
        label: '编辑文件',
        value: input.file_path,
        description: editDesc
      }
    case 'Write':
      const content = input.content || ''
      const lineCount = content.split('\n').length
      const writePath = formatFilePath(input.file_path)
      return {
        label: '写入文件',
        value: input.file_path,
        description: `${writePath}    ${lineCount} 行 · ${content.length} 字符`,
        hasContent: !!content
      }
    case 'Glob':
      return {
        label: '匹配模式',
        value: input.pattern,
        description: input.path ? `在 ${input.path}` : null
      }
    case 'Grep':
      const grepDesc = input.path ? `在 ${formatFilePath(input.path)}` : '全局搜索'
      return {
        label: '搜索',
        value: input.pattern,
        description: grepDesc,
        glob: input.glob,
        ignoreCase: input['-i']
      }
    case 'WebSearch':
      const domainInfo = input.allowed_domains?.length
        ? `限定: ${input.allowed_domains.join(', ')}`
        : input.blocked_domains?.length
          ? `排除: ${input.blocked_domains.join(', ')}`
          : null
      return {
        label: '网络搜索',
        value: input.query,
        description: domainInfo
      }
    case 'Skill':
      return {
        label: '技能调用',
        value: input.skill,
        description: input.args || null
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
    case 'Agent':
      return {
        label: '代理任务',
        value: input.subagent_type || input.subagentType || '通用代理',
        description: input.description || null
      }
    default:
      if (input.description) {
        return { label: '描述', value: input.description, description: null }
      }
      return null
  }
})

// 格式化文件路径（用于折叠摘要）
const formatFilePath = (filePath) => {
  if (!filePath) return ''

  // 如果有工作目录且路径在其下面，显示相对路径
  if (props.workingDirectory && filePath.startsWith(props.workingDirectory)) {
    const relativePath = filePath.slice(props.workingDirectory.length)
    // 移除开头的斜杠
    const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath
    return `@/${cleanPath}`
  }

  // 否则显示完整路径
  return filePath
}

// 折叠时显示的精简摘要
const collapsedSummary = computed(() => {
  const input = mergedToolInput.value
  if (!input) return ''

  switch (props.toolName) {
    case 'Bash':
      // 显示命令的前40个字符
      const cmd = input.command || ''
      const bgIcon = input.run_in_background ? '/bg' : ''
      return cmd.length > 40 ? cmd.substring(0, 40) + '...' + bgIcon : cmd + bgIcon
    case 'Read':
      // 显示文件路径和描述（如果有）
      const readFilePath = formatFilePath(input.file_path)
      const readSummary = input.description ? `${readFilePath}    ${input.description}` : readFilePath
      return readSummary
    case 'Write':
      // 显示文件路径和统计信息
      const writeFilePath = formatFilePath(input.file_path)
      const writeContent = input.content || ''
      const writeLineCount = writeContent.split('\n').length
      return `${writeFilePath}    ${writeLineCount} 行 · ${writeContent.length} 字符`
    case 'Edit':
      // 显示完整路径或相对路径，以及操作说明
      const editFilePath = formatFilePath(input.file_path)
      let editOpDesc = ''
      if (isAddOperation.value) {
        editOpDesc = '添加内容'
      } else if (isDeleteOperation.value) {
        editOpDesc = '删除内容'
      } else {
        const oldLen = input.old_string?.length || 0
        const newLen = input.new_string?.length || 0
        editOpDesc = `替换 ${oldLen} 字符 → ${newLen} 字符`
      }
      return `${editFilePath}    ${editOpDesc}`
    case 'Glob':
      return input.pattern || ''
    case 'Grep':
      const grepPath = input.path ? ` ${formatFilePath(input.path)}` : ''
      return `${input.pattern || ''}${grepPath}`
    case 'WebSearch':
      const webQuery = input.query || ''
      return webQuery.length > 40 ? webQuery.substring(0, 40) + '...' : webQuery
    case 'Skill':
      const skillName = input.skill || ''
      const skillArgs = input.args || ''
      const shortArgs = skillArgs.length > 20 ? skillArgs.substring(0, 20) + '...' : skillArgs
      return shortArgs ? `${skillName} ${shortArgs}` : skillName
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
    case 'Agent':
      // 显示代理类型和描述
      const agentType = input.subagent_type || input.subagentType || '代理'
      const agentDesc = input.description || input.prompt || ''
      const shortDesc = agentDesc.length > 40 ? agentDesc.substring(0, 40) + '...' : agentDesc
      return `🤖 ${agentType}${shortDesc ? ': ' + shortDesc : ''}`
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

// 复制功能
import { ref } from 'vue'

const copiedType = ref('') // 'header' | 'description' | 'content' | 'result'
const copiedToolName = ref('')

async function copyToClipboard(text, type) {
  try {
    await navigator.clipboard.writeText(text)
    copiedType.value = type
    setTimeout(() => {
      copiedType.value = ''
    }, 2000)
  } catch (err) {
    console.error('复制失败:', err)
  }
}

// 复制整个工具调用信息
async function copyToolCall() {
  let content = `Tool: ${props.toolName}\n`
  if (primaryContent.value?.description) {
    content += `\n说明:\n${primaryContent.value.description}\n`
  }
  if (primaryContent.value?.value) {
    content += `\n${primaryContent.value.label}:\n${typeof primaryContent.value.value === 'string' ? primaryContent.value.value : JSON.stringify(primaryContent.value.value, null, 2)}\n`
  }
  if (formattedResult.value) {
    content += `\n结果:\n${formattedResult.value}\n`
  }
  await copyToClipboard(content, 'header')
}

// 复制描述
async function copyDescription() {
  if (primaryContent.value?.description) {
    await copyToClipboard(primaryContent.value.description, 'description')
  }
}

// 复制主要内容
async function copyContent() {
  if (primaryContent.value?.value) {
    const content = typeof primaryContent.value.value === 'string' ? primaryContent.value.value : JSON.stringify(primaryContent.value.value, null, 2)
    await copyToClipboard(content, 'content')
  }
}

// 复制结果
async function copyResult() {
  if (formattedResult.value) {
    await copyToClipboard(formattedResult.value, 'result')
  }
}
</script>

<template>
  <div class="tool-use-card" :class="{ error: isError, executing: isExecuting, collapsed: !isExpanded }">
    <div class="tool-header" @click="toggleExpand">
      <div class="tool-info">
        <span class="tool-icon">{{ toolIcon }}</span>
        <span class="tool-name">{{ toolName }}</span>
        <!-- 部分消息状态指示器 - 只在工具正在执行且没有输入数据时显示 -->
        <span v-if="isPartial && isExecuting" class="partial-status">
          <span>⏳ 等待数据...</span>
        </span>
        <span v-if="isExecuting" class="status-badge executing">执行中...</span>
        <span v-else-if="isError" class="status-badge error">失败</span>
        <span v-else-if="result" class="status-badge success">完成</span>
      </div>
      <div class="header-actions">
        <!-- 复制按钮 -->
        <button class="copy-btn" @click.stop="copyToolCall" :title="copiedType === 'header' ? '已复制' : '复制工具调用'">
          <svg v-if="copiedType === 'header'" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="20 6 9 17 4 12"></polyline>
          </svg>
          <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>
        </button>
        <span class="expand-icon">{{ isExpanded ? '▼' : '▶' }}</span>
      </div>
    </div>
    <!-- 折叠时显示精简摘要 -->
    <div v-if="!isExpanded && collapsedSummary" class="collapsed-summary-line" :class="{ 'todo-collapsed': props.toolName === 'TodoWrite' }" @click="toggleExpand" v-html="collapsedSummary">
    </div>

    <div v-if="isExpanded" class="tool-body">
      <!-- 描述 -->
      <div v-if="primaryContent?.description" class="tool-section has-copy">
        <div class="section-label">说明</div>
        <div class="section-content description">
          <button class="section-copy-btn" @click.stop="copyDescription" :title="copiedType === 'description' ? '已复制' : '复制'">
            <svg v-if="copiedType === 'description'" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          {{ primaryContent.description }}
        </div>
      </div>

      <!-- 主要内容 -->
      <div v-if="primaryContent" class="tool-section has-copy">
        <div class="section-label" :class="{ 'todo-label': props.toolName === 'TodoWrite' }">{{ primaryContent.label }}</div>
        <!-- TodoWrite 专用样式 -->
        <template v-if="props.toolName === 'TodoWrite'">
          <div class="section-content todo-list" v-html="primaryContent.value"></div>
        </template>
        <!-- Edit 专用 diff 视图 -->
        <template v-else-if="props.toolName === 'Edit' && editDiffData">
          <div class="diff-container">
            <!-- 操作类型标识 -->
            <div class="diff-operation-badge" :class="editDiffData.operationType">
              <span v-if="editDiffData.operationType === 'add'">➕ 新增内容</span>
              <span v-else-if="editDiffData.operationType === 'delete'">➖ 删除内容</span>
              <span v-else>🔄 替换内容</span>
            </div>

            <!-- 左右对比视图 -->
            <div class="diff-panels">
              <!-- 左侧：原始内容 -->
              <div class="diff-panel old-panel">
                <div class="diff-panel-header">
                  <span class="panel-title">📤 原始内容</span>
                  <span class="line-count">{{ editDiffData.oldLines.length }} 行</span>
                </div>
                <div class="diff-panel-content">
                  <template v-if="editDiffData.oldContent">
                    <div v-for="(line, index) in editDiffData.oldLines" :key="'old-' + index" class="diff-line old-line">
                      <span class="line-number">{{ index + 1 }}</span>
                      <span class="line-content">{{ line || ' ' }}</span>
                    </div>
                  </template>
                  <div v-else class="empty-content">
                    <span class="empty-icon">📭</span>
                    <span>（空内容 - 文件末尾添加）</span>
                  </div>
                </div>
              </div>

              <!-- 分隔箭头 -->
              <div class="diff-arrow">
                <span>⟹</span>
              </div>

              <!-- 右侧：新内容 -->
              <div class="diff-panel new-panel">
                <div class="diff-panel-header">
                  <span class="panel-title">📥 新内容</span>
                  <span class="line-count">{{ editDiffData.newLines.length }} 行</span>
                </div>
                <div class="diff-panel-content">
                  <template v-if="editDiffData.newContent">
                    <div v-for="(line, index) in editDiffData.newLines" :key="'new-' + index" class="diff-line new-line">
                      <span class="line-number">{{ index + 1 }}</span>
                      <span class="line-content">{{ line || ' ' }}</span>
                    </div>
                  </template>
                  <div v-else class="empty-content">
                    <span class="empty-icon">🗑️</span>
                    <span>（删除内容）</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- replace_all 标识 -->
            <div v-if="mergedToolInput?.replace_all" class="replace-all-badge">
              🔄 替换所有匹配项
            </div>
          </div>
        </template>
        <!-- Write 专用内容预览 -->
        <template v-else-if="props.toolName === 'Write' && writeContentData">
          <div class="write-container">
            <!-- 内容统计 -->
            <div class="write-stats">
              <span class="stat-item">📄 {{ writeContentData.lineCount }} 行</span>
              <span class="stat-item">📝 {{ writeContentData.charCount }} 字符</span>
            </div>
            <!-- 代码预览 -->
            <div class="write-preview">
              <div class="write-preview-header">
                <span class="preview-title">📄 文件内容</span>
              </div>
              <div class="write-preview-content">
                <div v-for="(line, index) in writeContentData.lines.slice(0, 100)" :key="'write-' + index" class="write-line">
                  <span class="line-number">{{ index + 1 }}</span>
                  <span class="line-content">{{ line || ' ' }}</span>
                </div>
                <div v-if="writeContentData.lineCount > 100" class="write-truncated">
                  ... 省略 {{ writeContentData.lineCount - 100 }} 行 ...
                </div>
              </div>
            </div>
          </div>
        </template>
        <!-- Bash 专用命令显示 -->
        <template v-else-if="props.toolName === 'Bash' && bashData">
          <div class="bash-container">
            <!-- 后台运行标识 -->
            <div v-if="bashData.isBackground" class="bash-background-badge">
              🔄 后台运行
            </div>
            <!-- 命令显示 -->
            <div class="bash-command">
              <button class="section-copy-btn" @click.stop="copyContent" :title="copiedType === 'content' ? '已复制' : '复制命令'">
                <svg v-if="copiedType === 'content'" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
              <div class="bash-command-header">
                <span class="bash-prompt">$</span>
                <span class="bash-cmd-text">{{ bashData.command }}</span>
              </div>
            </div>
            <!-- 超时信息 -->
            <div v-if="bashData.timeout" class="bash-timeout">
              ⏱️ 超时: {{ bashData.timeout }}ms
            </div>
          </div>
        </template>
        <!-- Agent 专用信息卡片 -->
        <template v-else-if="props.toolName === 'Agent' && agentData">
          <div class="agent-container">
            <div class="agent-info-card">
              <div class="agent-type-badge">
                🤖 {{ agentData.subagentType || '通用代理' }}
              </div>
              <div v-if="agentData.description" class="agent-description">
                {{ agentData.description }}
              </div>
              <div v-if="agentData.prompt" class="agent-prompt">
                <div class="agent-prompt-label">任务提示</div>
                <div class="agent-prompt-content">{{ agentData.prompt }}</div>
              </div>
            </div>
          </div>
        </template>
        <!-- WebSearch 专用搜索卡片 -->
        <template v-else-if="props.toolName === 'WebSearch' && webSearchData">
          <div class="websearch-container">
            <div class="websearch-query-box">
              <div class="websearch-icon">🔍</div>
              <div class="websearch-query">{{ webSearchData.query }}</div>
            </div>
            <!-- 域名限制 -->
            <div v-if="webSearchData.allowedDomains.length" class="websearch-domains">
              <span class="domain-label">限定域名:</span>
              <span v-for="domain in webSearchData.allowedDomains" :key="domain" class="domain-tag allowed">{{ domain }}</span>
            </div>
            <div v-if="webSearchData.blockedDomains.length" class="websearch-domains">
              <span class="domain-label">排除域名:</span>
              <span v-for="domain in webSearchData.blockedDomains" :key="domain" class="domain-tag blocked">{{ domain }}</span>
            </div>
          </div>
        </template>
        <!-- Grep 专用搜索卡片 -->
        <template v-else-if="props.toolName === 'Grep' && grepData">
          <div class="grep-container">
            <div class="grep-pattern-box">
              <div class="grep-icon">🔎</div>
              <div class="grep-pattern">{{ grepData.pattern }}</div>
            </div>
            <!-- 搜索选项 -->
            <div class="grep-options">
              <span v-if="grepData.path" class="grep-option">
                <span class="option-label">路径:</span>
                {{ formatFilePath(grepData.path) }}
              </span>
              <span v-if="grepData.glob" class="grep-option">
                <span class="option-label">文件:</span>
                {{ grepData.glob }}
              </span>
              <span v-if="grepData.type" class="grep-option">
                <span class="option-label">类型:</span>
                {{ grepData.type }}
              </span>
              <span v-if="grepData.ignoreCase" class="grep-option-tag">忽略大小写</span>
              <span v-if="grepData.contextLines" class="grep-option-tag">上下文 {{ grepData.contextLines }} 行</span>
              <span v-if="grepData.headLimit" class="grep-option-tag">限制 {{ grepData.headLimit }} 条</span>
            </div>
          </div>
        </template>
        <!-- Skill 专用卡片 -->
        <template v-else-if="props.toolName === 'Skill' && skillData">
          <div class="skill-container">
            <div class="skill-header">
              <span class="skill-icon">⚡</span>
              <span class="skill-name">{{ skillData.skill }}</span>
            </div>
            <div v-if="skillData.args" class="skill-args">
              <div class="skill-args-label">参数</div>
              <div class="skill-args-content">{{ skillData.args }}</div>
            </div>
          </div>
        </template>
        <template v-else>
          <div class="section-content-wrapper">
            <button class="section-copy-btn" @click.stop="copyContent" :title="copiedType === 'content' ? '已复制' : '复制'">
              <svg v-if="copiedType === 'content'" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
            <div class="section-content todo-list">{{ primaryContent.value }}</div>
          </div>
        </template>
      </div>

      <!-- 结果 -->
      <div v-if="formattedResult" class="tool-section result-section">
        <div class="section-label">结果</div>
        <div class="section-content-wrapper">
          <button class="section-copy-btn" @click.stop="copyResult" :title="copiedType === 'result' ? '已复制' : '复制'">
            <svg v-if="copiedType === 'result'" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <pre class="section-content result" :class="{ 'error-text': isError }">{{ formattedResult }}</pre>
        </div>
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

/* 部分消息状态指示器样式 */
.partial-status {
  font-size: 11px;
  color: #F59E0B;
  animation: pulse 2s ease-in-out infinite;
  flex-shrink: 0;
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
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

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.copy-btn {
  font-size: 12px;
  color: #71717A;
  background: transparent;
  border: none;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  opacity: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.copy-btn svg {
  display: block;
}

.tool-header:hover .copy-btn {
  opacity: 0.6;
}

.copy-btn:hover {
  background: #27272A;
  color: #A1A1AA;
  opacity: 1 !important;
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
  position: relative;
}

/* section 内容包装器 - 用于定位复制按钮 */
.section-content-wrapper {
  position: relative;
}

/* section 内的复制按钮 */
.section-copy-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: 12px;
  color: #71717A;
  background: rgba(39, 39, 42, 0.9);
  border: none;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.section-copy-btn svg {
  display: block;
}

.section-content-wrapper:hover .section-copy-btn,
.section-content:hover .section-copy-btn,
.bash-command:hover .section-copy-btn {
  opacity: 0.6;
}

.section-copy-btn:hover {
  opacity: 1 !important;
  background: #27272A;
  color: #A1A1AA;
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

/* ========== Edit Diff 视图样式 ========== */
.diff-container {
  margin-top: 8px;
  border-radius: 8px;
  overflow: hidden;
  background: #0D1117;
  border: 1px solid #30363D;
}

/* 操作类型标识 */
.diff-operation-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  border-radius: 0;
  background: #21262D;
  border-bottom: 1px solid #30363D;
}

.diff-operation-badge.add {
  color: #3FB950;
  background: linear-gradient(90deg, rgba(63, 185, 80, 0.15) 0%, transparent 100%);
}

.diff-operation-badge.delete {
  color: #F85149;
  background: linear-gradient(90deg, rgba(248, 81, 73, 0.15) 0%, transparent 100%);
}

.diff-operation-badge.replace {
  color: #58A6FF;
  background: linear-gradient(90deg, rgba(88, 166, 255, 0.15) 0%, transparent 100%);
}

/* 左右面板容器 */
.diff-panels {
  display: flex;
  gap: 0;
  min-height: 120px;
  max-height: 400px;
}

/* 单个面板 */
.diff-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
}

.diff-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  border-bottom: 1px solid #30363D;
}

.panel-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.line-count {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.1);
  color: #8B949E;
}

/* 左侧面板（原始内容） */
.old-panel {
  border-right: 1px solid #30363D;
}

.old-panel .diff-panel-header {
  background: linear-gradient(90deg, rgba(248, 81, 73, 0.1) 0%, transparent 100%);
  color: #F85149;
}

/* 右侧面板（新内容） */
.new-panel .diff-panel-header {
  background: linear-gradient(90deg, rgba(63, 185, 80, 0.1) 0%, transparent 100%);
  color: #3FB950;
}

/* 面板内容 */
.diff-panel-content {
  flex: 1;
  overflow: auto;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.5;
}

/* 空内容提示 */
.empty-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  min-height: 80px;
  color: #6E7681;
  font-size: 12px;
  gap: 8px;
}

.empty-icon {
  font-size: 24px;
  opacity: 0.5;
}

/* 行样式 */
.diff-line {
  display: flex;
  min-height: 22px;
  line-height: 22px;
}

.diff-line:hover {
  background: rgba(255, 255, 255, 0.03);
}

.line-number {
  flex-shrink: 0;
  width: 40px;
  padding: 0 8px;
  text-align: right;
  color: #6E7681;
  background: rgba(0, 0, 0, 0.2);
  user-select: none;
  font-size: 10px;
  border-right: 1px solid #30363D;
}

.line-content {
  flex: 1;
  padding: 0 10px;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 旧行样式（红色背景） */
.old-line {
  background: rgba(248, 81, 73, 0.08);
}

.old-line .line-content {
  color: #FFA198;
}

.old-line .line-number {
  background: rgba(248, 81, 73, 0.1);
  border-right-color: rgba(248, 81, 73, 0.3);
}

/* 新行样式（绿色背景） */
.new-line {
  background: rgba(63, 185, 80, 0.08);
}

.new-line .line-content {
  color: #7EE787;
}

.new-line .line-number {
  background: rgba(63, 185, 80, 0.1);
  border-right-color: rgba(63, 185, 80, 0.3);
}

/* 中间箭头 */
.diff-arrow {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  background: #161B22;
  color: #58A6FF;
  font-size: 18px;
  flex-shrink: 0;
}

/* replace_all 标识 */
.replace-all-badge {
  padding: 6px 12px;
  font-size: 11px;
  color: #8B949E;
  background: #161B22;
  border-top: 1px solid #30363D;
}

/* Diff 视图滚动条 */
.diff-panel-content::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.diff-panel-content::-webkit-scrollbar-track {
  background: #0D1117;
}

.diff-panel-content::-webkit-scrollbar-thumb {
  background: #30363D;
  border-radius: 3px;
}

.diff-panel-content::-webkit-scrollbar-thumb:hover {
  background: #484F58;
}

/* ========== Write 工具样式 ========== */
.write-container {
  margin-top: 8px;
  border-radius: 8px;
  overflow: hidden;
  background: #0D1117;
  border: 1px solid #30363D;
}

.write-stats {
  display: flex;
  gap: 16px;
  padding: 8px 12px;
  background: #161B22;
  border-bottom: 1px solid #30363D;
}

.stat-item {
  font-size: 12px;
  color: #8B949E;
}

.write-preview {
  overflow: hidden;
}

.write-preview-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  background: linear-gradient(90deg, rgba(88, 166, 255, 0.1) 0%, transparent 100%);
  border-bottom: 1px solid #30363D;
}

.preview-title {
  font-size: 11px;
  font-weight: 600;
  color: #58A6FF;
}

.write-preview-content {
  max-height: 300px;
  overflow: auto;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.5;
}

.write-line {
  display: flex;
  min-height: 22px;
  line-height: 22px;
  background: rgba(63, 185, 80, 0.03);
}

.write-line:hover {
  background: rgba(63, 185, 80, 0.08);
}

.write-line .line-number {
  flex-shrink: 0;
  width: 40px;
  padding: 0 8px;
  text-align: right;
  color: #6E7681;
  background: rgba(0, 0, 0, 0.2);
  user-select: none;
  font-size: 10px;
  border-right: 1px solid #30363D;
}

.write-line .line-content {
  flex: 1;
  padding: 0 10px;
  white-space: pre;
  overflow: hidden;
  text-overflow: ellipsis;
  color: #7EE787;
}

.write-truncated {
  padding: 12px;
  text-align: center;
  color: #6E7681;
  font-size: 12px;
  background: rgba(0, 0, 0, 0.2);
}

/* Write 预览滚动条 */
.write-preview-content::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.write-preview-content::-webkit-scrollbar-track {
  background: #0D1117;
}

.write-preview-content::-webkit-scrollbar-thumb {
  background: #30363D;
  border-radius: 3px;
}

/* ========== Bash 工具样式 ========== */
.bash-container {
  margin-top: 8px;
  border-radius: 8px;
  overflow: hidden;
  background: #0D1117;
  border: 1px solid #30363D;
}

.bash-background-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  color: #F0883E;
  background: linear-gradient(90deg, rgba(240, 136, 62, 0.15) 0%, transparent 100%);
  border-bottom: 1px solid #30363D;
}

.bash-command {
  padding: 12px;
  position: relative;
}

.bash-command-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.5;
}

.bash-prompt {
  color: #3FB950;
  font-weight: 600;
  flex-shrink: 0;
}

.bash-cmd-text {
  color: #F8F8F2;
  white-space: pre-wrap;
  word-break: break-all;
}

.bash-timeout {
  padding: 6px 12px;
  font-size: 11px;
  color: #8B949E;
  background: #161B22;
  border-top: 1px solid #30363D;
}

/* ========== Agent 工具样式 ========== */
.agent-container {
  margin-top: 8px;
}

.agent-info-card {
  background: linear-gradient(135deg, #1E293B 0%, #0F172A 100%);
  border-radius: 8px;
  border: 1px solid rgba(88, 166, 255, 0.2);
  overflow: hidden;
}

.agent-type-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  font-size: 14px;
  font-weight: 600;
  color: #58A6FF;
  background: linear-gradient(90deg, rgba(88, 166, 255, 0.15) 0%, transparent 100%);
  border-bottom: 1px solid rgba(88, 166, 255, 0.2);
}

.agent-description {
  padding: 12px 14px;
  font-size: 13px;
  color: #A1A1AA;
  line-height: 1.6;
  border-bottom: 1px solid rgba(88, 166, 255, 0.1);
}

.agent-prompt {
  padding: 12px 14px;
}

.agent-prompt-label {
  font-size: 11px;
  color: #71717A;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.agent-prompt-content {
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 12px;
  color: #94A3B8;
  background: rgba(0, 0, 0, 0.2);
  padding: 10px 12px;
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 200px;
  overflow: auto;
  line-height: 1.6;
}

.agent-prompt-content::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.agent-prompt-content::-webkit-scrollbar-track {
  background: transparent;
}

.agent-prompt-content::-webkit-scrollbar-thumb {
  background: #30363D;
  border-radius: 3px;
}

/* ========== WebSearch 工具样式 ========== */
.websearch-container {
  margin-top: 8px;
  border-radius: 8px;
  overflow: hidden;
  background: #0D1117;
  border: 1px solid #30363D;
}

.websearch-query-box {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  background: linear-gradient(135deg, #1E293B 0%, #0F172A 100%);
}

.websearch-icon {
  font-size: 20px;
  flex-shrink: 0;
}

.websearch-query {
  font-size: 14px;
  color: #F8FAFC;
  line-height: 1.5;
  word-break: break-word;
}

.websearch-domains {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: #161B22;
  border-top: 1px solid #30363D;
}

.domain-label {
  font-size: 11px;
  color: #8B949E;
}

.domain-tag {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
}

.domain-tag.allowed {
  background: rgba(63, 185, 80, 0.15);
  color: #3FB950;
}

.domain-tag.blocked {
  background: rgba(248, 81, 73, 0.15);
  color: #F85149;
}

/* ========== Grep 工具样式 ========== */
.grep-container {
  margin-top: 8px;
  border-radius: 8px;
  overflow: hidden;
  background: #0D1117;
  border: 1px solid #30363D;
}

.grep-pattern-box {
  display: flex;
  align-items: flex-start;
  gap: 12px;
  padding: 14px;
  background: linear-gradient(135deg, #1E293B 0%, #0F172A 100%);
}

.grep-icon {
  font-size: 20px;
  flex-shrink: 0;
}

.grep-pattern {
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 14px;
  color: #F0883E;
  line-height: 1.5;
  word-break: break-all;
}

.grep-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  background: #161B22;
  border-top: 1px solid #30363D;
}

.grep-option {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: #94A3B8;
}

.grep-option .option-label {
  color: #6E7681;
}

.grep-option-tag {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  background: rgba(88, 166, 255, 0.15);
  color: #58A6FF;
}

/* ========== Skill 工具样式 ========== */
.skill-container {
  margin-top: 8px;
  border-radius: 8px;
  overflow: hidden;
  background: linear-gradient(135deg, #1E293B 0%, #0F172A 100%);
  border: 1px solid rgba(240, 136, 62, 0.3);
}

.skill-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
  background: linear-gradient(90deg, rgba(240, 136, 62, 0.15) 0%, transparent 100%);
  border-bottom: 1px solid rgba(240, 136, 62, 0.2);
}

.skill-icon {
  font-size: 18px;
}

.skill-name {
  font-size: 14px;
  font-weight: 600;
  color: #F0883E;
}

.skill-args {
  padding: 12px 14px;
}

.skill-args-label {
  font-size: 11px;
  color: #71717A;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 8px;
}

.skill-args-content {
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 12px;
  color: #94A3B8;
  background: rgba(0, 0, 0, 0.2);
  padding: 10px 12px;
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-word;
}
</style>
