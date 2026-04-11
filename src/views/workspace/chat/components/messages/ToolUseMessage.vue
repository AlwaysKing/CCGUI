<script setup>
import { computed, ref } from 'vue'
import CollapseToggle from '../ui/CollapseToggle.vue'
import { useFileBrowserStore } from '../../../../../stores/useFileBrowserStore'

const emit = defineEmits(['toggle-collapse'])
const fileBrowserStore = useFileBrowserStore()

function parseUnifiedDiffMetadata(diffText = '') {
  if (typeof diffText !== 'string' || !diffText.trim()) {
    return { files: [], insertions: 0, deletions: 0 }
  }

  const fileMatches = Array.from(diffText.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm))
  const files = Array.from(new Set(
    fileMatches
      .map(match => match[2] || match[1] || '')
      .filter(Boolean)
  ))

  return {
    files,
    insertions: (diffText.match(/^\+(?!\+\+).*/gm) || []).length,
    deletions: (diffText.match(/^-(?!--).*/gm) || []).length
  }
}

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

const unifiedDiffData = computed(() => {
  if (props.toolName !== 'Diff') return null
  const input = mergedToolInput.value
  const diff = input?.diff || input?.patch || props.result || ''
  if (!diff) return null

  const metadata = parseUnifiedDiffMetadata(diff)
  return {
    diff,
    files: metadata.files,
    insertions: metadata.insertions,
    deletions: metadata.deletions
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
    description: input.description || input.task || input.instructions || input.message || '',
    prompt: input.prompt || input.task || input.instructions || input.message || ''
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

const sendMessageData = computed(() => {
  if (props.toolName !== 'SendMessage') return null

  const input = mergedToolInput.value || {}
  let parsedResult = null

  try {
    if (typeof props.result === 'string' && props.result.trim()) {
      parsedResult = JSON.parse(props.result)
    } else if (Array.isArray(props.result) && props.result[0]?.text) {
      parsedResult = JSON.parse(props.result[0].text)
    }
  } catch (error) {
    parsedResult = null
  }

  const routing = parsedResult?.routing || {}
  return {
    sender: routing.sender || input.from || '',
    target: routing.target || input.to || '',
    targetColor: routing.targetColor || '',
    summary: routing.summary || input.summary || '',
    content: routing.content || input.content || input.message || ''
  }
})

const receiveMessageData = computed(() => {
  if (props.toolName !== 'ReceiveMessage') return null

  const input = mergedToolInput.value || {}
  return {
    sender: input.from || input.sender || '',
    summary: input.summary || '',
    content: input.content || input.message || ''
  }
})

const cronCreateData = computed(() => {
  if (props.toolName !== 'CronCreate') return null

  const input = mergedToolInput.value || {}
  let parsedResult = {}
  const rawResult = typeof props.result === 'string'
    ? props.result
    : Array.isArray(props.result)
      ? props.result.map(item => item?.text || '').join('\n')
      : ''

  const toolUseResult = props.rawMessages?.find(msg => msg?.tool_use_result)?.tool_use_result || {}
  const taskIdMatch = rawResult.match(/task\s+([a-z0-9]+)/i)

  parsedResult = {
    id: toolUseResult.id || taskIdMatch?.[1] || '',
    schedule: toolUseResult.humanSchedule || input.cron || '',
    recurring: typeof toolUseResult.recurring === 'boolean' ? toolUseResult.recurring : !!input.recurring,
    durable: typeof toolUseResult.durable === 'boolean' ? toolUseResult.durable : !!input.durable,
    sessionOnly: /Session-only/i.test(rawResult),
    autoDelete: /auto-delete/i.test(rawResult)
  }

  return {
    prompt: input.prompt || '',
    schedule: parsedResult.schedule,
    recurring: parsedResult.recurring,
    durable: parsedResult.durable,
    sessionOnly: parsedResult.sessionOnly,
    autoDelete: parsedResult.autoDelete,
    id: parsedResult.id
  }
})

const cronDeleteData = computed(() => {
  if (props.toolName !== 'CronDelete') return null
  const input = mergedToolInput.value || {}
  return {
    id: input.id || input.task_id || input.taskId || '',
    description: input.description || ''
  }
})

const cronListData = computed(() => {
  if (props.toolName !== 'CronList') return null
  const rawResult = typeof props.result === 'string'
    ? props.result
    : Array.isArray(props.result)
      ? props.result.map(item => item?.text || '').join('\n')
      : ''

  let parsed = null
  try {
    parsed = JSON.parse(rawResult)
  } catch {
    parsed = null
  }

  const tasks = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsed?.tasks)
      ? parsed.tasks
      : []

  return {
    tasks,
    rawResult
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
  },
  chatTheme: {
    type: Object,
    default: () => ({})
  },
  textStyleLabelOverride: {
    type: String,
    default: null
  },
  textStyleSummaryOverride: {
    type: String,
    default: null
  },
  textStyleStatusOverride: {
    type: String,
    default: null
  },
  hideTextStyleToggle: {
    type: Boolean,
    default: false
  },
  nonInteractive: {
    type: Boolean,
    default: false
  }
})

const isExpanded = computed(() => !props.collapsed)
const isTextStyle = computed(() => (props.chatTheme?.messageSurface || 'bubble') === 'ghost')
const isFloatingStatus = computed(() => props.chatTheme?.statusStyle === 'floating')

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
    ApplyPatch: '🩹',
    Diff: '🩹',
    Write: '📝',
    Glob: '🔍',
    Grep: '🔎',
    Agent: '🤖',
    TaskOutput: '📋',
    TaskStop: '⏹️',
    WebSearch: '🌐',
    ViewImage: '🖼️',
    GenerateImage: '🎨',
    ClientToolCall: '🧩',
    RequestPermissions: '🔐',
    SendMessage: '✉️',
    ReceiveMessage: '📩',
    TeamCreate: '👥',
    CronCreate: '⏰',
    CronDelete: '🗑️',
    CronList: '🕒',
    AskUserQuestion: '❓',
    EnterPlanMode: '📋',
    EnterWorktree: '🌳',
    TodoWrite: '✅'
  }
  return icons[props.toolName] || '🔧'
})

const displayToolName = computed(() => {
  const labels = {
    Agent: '代理任务',
    ApplyPatch: '补丁',
    TeamCreate: '创建团队',
    TeamDelete: '删除团队',
    CronCreate: '创建定时任务',
    CronDelete: '删除定时任务',
    CronList: '查看定时任务',
    SendMessage: '发送消息',
    ReceiveMessage: '接收消息',
    Bash: '命令',
    Glob: '匹配',
    Grep: '搜索',
    Read: '读取',
    Write: '写入',
    Edit: '编辑',
    Diff: '差异',
    WebSearch: '网络搜索',
    ViewImage: '查看图片',
    GenerateImage: '生成图片',
    ClientToolCall: '客户端工具',
    RequestPermissions: '额外权限',
    AskUserQuestion: '提问',
    EnterPlanMode: '进入规划',
    EnterWorktree: '进入工作树',
    TodoWrite: '任务清单',
    Skill: '技能调用',
    TaskOutput: '任务输出',
    TaskStop: '停止任务'
  }
  return labels[props.toolName] || props.toolName
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
    case 'ApplyPatch':
      const changes = Array.isArray(input.changes) ? input.changes : []
      return {
        label: '补丁修改',
        value: `${changes.length} 处变更`,
        description: changes.length ? 'Codex 通过补丁批量修改文件' : (input.description || null)
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
    case 'Diff':
      return {
        label: '文件变更',
        value: unifiedDiffData.value?.files?.length ? unifiedDiffData.value.files.join(', ') : '补丁更新',
        description: unifiedDiffData.value?.files?.length ? `${unifiedDiffData.value.files.length} 个文件` : '统一 diff 更新'
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
    case 'SendMessage':
      return {
        label: '发送消息',
        value: input.to || '',
        description: input.summary || null
      }
    case 'ReceiveMessage':
      return {
        label: '接收消息',
        value: input.from || input.sender || '',
        description: input.summary || null
      }
    case 'TeamCreate':
      return {
        label: '名称',
        value: input.team_name || input.teamName || '',
        description: input.description || null
      }
    case 'TeamDelete':
      return {
        label: '名称',
        value: input.team_name || input.teamName || input.name || '',
        description: input.description || null
      }
    case 'CronCreate':
      return {
        label: '时间',
        value: input.cron || '',
        description: input.prompt || null
      }
    case 'CronDelete':
      return {
        label: '任务 ID',
        value: input.id || input.task_id || input.taskId || '',
        description: input.description || null
      }
    case 'CronList':
      return {
        label: '定时任务',
        value: '查看当前会话任务',
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
    case 'Agent':
      return {
        label: '代理任务',
        value: input.subagent_type || input.subagentType || '通用代理',
        description: input.description || input.prompt || input.task || input.instructions || input.message || null
      }
    case 'ViewImage':
      return {
        label: '查看图片',
        value: input.path || input.image_path || '',
        description: input.description || null
      }
    case 'GenerateImage':
      return {
        label: '生成图片',
        value: input.prompt || '',
        description: input.description || null
      }
    case 'ClientToolCall':
      return {
        label: '客户端工具',
        value: input.tool || input.name || 'tool_call',
        description: input.description || null
      }
    case 'RequestPermissions':
      return {
        label: '额外权限',
        value: Array.isArray(input.permissions) ? input.permissions.join(', ') : (input.permissions || '权限请求'),
        description: input.description || null
      }
    default:
      if (input.description) {
        return { label: '描述', value: input.description, description: null }
      }
      if (Object.keys(input).length > 0) {
        return {
          label: '参数',
          value: JSON.stringify(input, null, 2),
          description: null
        }
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

const toFiniteNumber = (value) => {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

const formatReadRange = (input = {}) => {
  const startLine = toFiniteNumber(
    input.start_line ??
    input.startLine ??
    input.line_start ??
    input.lineStart ??
    input.from_line ??
    input.fromLine
  )
  const endLine = toFiniteNumber(
    input.end_line ??
    input.endLine ??
    input.line_end ??
    input.lineEnd ??
    input.to_line ??
    input.toLine
  )

  if (startLine !== null && endLine !== null) {
    return `(${startLine}-${endLine})`
  }

  const offset = toFiniteNumber(input.offset ?? input.line_offset ?? input.lineOffset)
  const limit = toFiniteNumber(input.limit ?? input.line_limit ?? input.lineLimit)
  if (offset !== null && limit !== null && limit > 0) {
    const normalizedStart = offset <= 0 ? 1 : offset
    return `(${normalizedStart}-${normalizedStart + limit - 1})`
  }

  const singleLine = toFiniteNumber(input.line ?? input.lineNumber)
  if (singleLine !== null) {
    return `(${singleLine})`
  }

  return ''
}

const describeCronExpression = (cron) => {
  const text = String(cron || '').trim()
  if (!text) return ''

  const parts = text.split(/\s+/)
  if (parts.length !== 5) return text

  const [minute, hour, dayOfMonth, month, dayOfWeek] = parts
  const isNumber = value => /^\d+$/.test(value)
  const paddedHour = isNumber(hour) ? hour.padStart(2, '0') : hour
  const paddedMinute = isNumber(minute) ? minute.padStart(2, '0') : minute
  const timeText = `${paddedHour}:${paddedMinute}`

  if (dayOfMonth === '*' && month === '*' && dayOfWeek === '*') {
    return `每天 ${timeText}（${text}）`
  }

  if (dayOfMonth === '*' && month === '*' && isNumber(dayOfWeek)) {
    const weekMap = {
      '0': '周日',
      '1': '周一',
      '2': '周二',
      '3': '周三',
      '4': '周四',
      '5': '周五',
      '6': '周六',
      '7': '周日'
    }
    return `${weekMap[dayOfWeek] || `每周 ${dayOfWeek}`} ${timeText}（${text}）`
  }

  if (isNumber(dayOfMonth) && isNumber(month) && dayOfWeek === '*') {
    return `${month.padStart(2, '0')}-${dayOfMonth.padStart(2, '0')} ${timeText}（${text}）`
  }

  if (isNumber(dayOfMonth) && month === '*' && dayOfWeek === '*') {
    return `每月 ${dayOfMonth} 日 ${timeText}（${text}）`
  }

  return `${timeText}（${text}）`
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
      const readRange = formatReadRange(input)
      const readSummary = input.description
        ? `${readFilePath}${readRange ? ` ${readRange}` : ''}    ${input.description}`
        : `${readFilePath}${readRange ? ` ${readRange}` : ''}`
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
    case 'ApplyPatch':
      const patchChanges = Array.isArray(input.changes) ? input.changes : []
      return `${patchChanges.length} 处补丁变更`
    case 'Diff':
      if (!unifiedDiffData.value) return ''
      if (unifiedDiffData.value.files.length === 1) {
        return `${formatFilePath(unifiedDiffData.value.files[0])}    (+${unifiedDiffData.value.insertions} -${unifiedDiffData.value.deletions})`
      }
      if (unifiedDiffData.value.files.length > 1) {
        return `${unifiedDiffData.value.files.length} 个文件    (+${unifiedDiffData.value.insertions} -${unifiedDiffData.value.deletions})`
      }
      return `(+${unifiedDiffData.value.insertions} -${unifiedDiffData.value.deletions})`
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
    case 'SendMessage':
      const sendTarget = input.to || ''
      const sendSummary = input.summary || ''
      return sendSummary ? `${sendTarget} - ${sendSummary}` : sendTarget
    case 'ReceiveMessage':
      const receiveSender = input.from || input.sender || ''
      const receiveSummary = input.summary || ''
      return receiveSummary ? `${receiveSender} - ${receiveSummary}` : receiveSender
    case 'TeamCreate':
      const teamName = input.team_name || input.teamName || ''
      const teamDescription = input.description || ''
      return teamDescription ? `${teamName} - ${teamDescription}` : teamName
    case 'CronCreate':
      return input.prompt || input.cron || ''
    case 'CronDelete':
      return input.id || input.task_id || input.taskId || ''
    case 'CronList':
      return '当前会话任务'
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
    case 'ViewImage':
      return input.path || input.image_path || ''
    case 'GenerateImage':
      return input.prompt || ''
    case 'ClientToolCall':
      return input.tool || input.name || 'tool_call'
    case 'RequestPermissions':
      return input.description || '权限请求'
    default:
      return ''
  }
})

const displayCollapsedSummary = computed(() => {
  if (!collapsedSummary.value) return ''
  if (!isTextStyle.value) return collapsedSummary.value
  const label = primaryContent.value?.label || props.toolName
  return `${label}: ${collapsedSummary.value}`
})

function collapseHtmlToSingleLine(value = '') {
  return String(value || '')
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function truncateFromStart(value = '', maxLength = 56) {
  const text = String(value || '')
  if (text.length <= maxLength) {
    return text
  }
  return `...${text.slice(-(maxLength - 3))}`
}

function truncatePathFromStart(value = '', maxLength = 48) {
  const text = String(value || '')
  if (text.length <= maxLength) {
    return text
  }

  const normalized = text.replace(/\\/g, '/')
  const segments = normalized.split('/').filter(Boolean)
  if (segments.length > 1) {
    const tailSegments = segments.slice(-4)
    const compactPath = `.../${tailSegments.join('/')}`
    if (compactPath.length <= maxLength || tailSegments.length <= 1) {
      return compactPath
    }
  }

  const rawSuffix = text.slice(-(maxLength - 3))
  const slashIndex = rawSuffix.indexOf('/')
  if (slashIndex > 0) {
    return `...${rawSuffix.slice(slashIndex)}`
  }

  return `...${rawSuffix}`
}

const headerCollapsedSummary = computed(() => {
  if (isTextStyle.value || isExpanded.value || !displayCollapsedSummary.value) {
    return ''
  }
  const summary = collapseHtmlToSingleLine(displayCollapsedSummary.value)
  if (/[\\/]/.test(summary)) {
    return truncatePathFromStart(summary)
  }
  return truncateFromStart(summary, 160)
})

const headerCollapsedMeta = computed(() => {
  if (isTextStyle.value || isExpanded.value) {
    return ''
  }
  return textStyleMeta.value || ''
})

const textStyleLabel = computed(() => {
  if (props.textStyleLabelOverride !== null) {
    return props.textStyleLabelOverride
  }
  return displayToolName.value
})

const textStyleSummary = computed(() => {
  if (props.textStyleSummaryOverride !== null) {
    return props.textStyleSummaryOverride
  }
  const input = mergedToolInput.value || {}

  switch (props.toolName) {
    case 'Edit':
    case 'Write':
    case 'Read':
      return previewFileName.value || formatFilePath(input.file_path || input.path || '')
    case 'ApplyPatch':
      return Array.isArray(input.changes) && input.changes.length ? `${input.changes.length} 处变更` : ''
    case 'Diff':
      if (unifiedDiffData.value?.files?.length === 1) {
        return formatFilePath(unifiedDiffData.value.files[0])
      }
      return unifiedDiffData.value?.files?.length ? `${unifiedDiffData.value.files.length} 个文件` : '补丁更新'
    case 'Bash':
      return input.command || ''
    case 'Grep':
      return input.pattern || (input.path ? formatFilePath(input.path) : '')
    case 'Glob':
      return input.pattern || ''
    default:
      return typeof collapsedSummary.value === 'string'
        ? collapsedSummary.value.replace(/<br\s*\/?>/gi, ' ').trim()
        : ''
  }
})

const textStyleMeta = computed(() => {
  const input = mergedToolInput.value || {}

  switch (props.toolName) {
    case 'Read':
      return formatReadRange(input)
    case 'Write':
      return input.content ? `(+${input.content.split('\n').length})` : ''
    case 'Edit':
      if (isAddOperation.value) {
        return `(+${(input.new_string || '').split('\n').length})`
      }
      if (isDeleteOperation.value) {
        return `(-${(input.old_string || '').split('\n').length})`
      }
      if (input.old_string || input.new_string) {
        return `(+${(input.new_string || '').split('\n').length} -${(input.old_string || '').split('\n').length})`
      }
      return ''
    case 'Diff':
      return unifiedDiffData.value ? `(+${unifiedDiffData.value.insertions} -${unifiedDiffData.value.deletions})` : ''
    default:
      return ''
  }
})

const previewFilePath = computed(() => {
  const input = mergedToolInput.value || {}

  switch (props.toolName) {
    case 'Edit':
    case 'Read':
    case 'Write':
      return input.file_path || input.path || ''
    case 'Diff':
      return unifiedDiffData.value?.files?.[0] || ''
    default:
      return ''
  }
})

const previewFileName = computed(() => {
  const filePath = previewFilePath.value
  if (!filePath) return ''
  const normalized = String(filePath).replace(/\\/g, '/')
  return normalized.split('/').pop() || normalized
})

const showTextStyleSummary = computed(() => {
  return !isExpanded.value && !!textStyleSummary.value
})

const textStyleStatus = computed(() => {
  if (props.textStyleStatusOverride !== null) {
    return props.textStyleStatusOverride
  }
  if (props.isExecuting) return 'executing'
  if (props.isError) return 'error'
  if (props.toolName === 'Diff' && unifiedDiffData.value?.diff) return 'success'
  if (props.result) return 'success'
  return ''
})

// 格式化结果显示
const formattedResult = computed(() => {
  if (!props.result) return null
  if (typeof props.result === 'string') return props.result
  if (Array.isArray(props.result)) {
    return props.result
      .map(item => (typeof item?.text === 'string' ? item.text : JSON.stringify(item, null, 2)))
      .join('\n')
  }
  if (typeof props.result === 'object') {
    return JSON.stringify(props.result, null, 2)
  }
  return String(props.result)
})

function toggleExpand() {
  if (props.nonInteractive) {
    return
  }
  emit('toggle-collapse')
}

// 复制功能
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
  if (props.toolName === 'Diff' && unifiedDiffData.value?.diff) {
    content += `\nDiff:\n${unifiedDiffData.value.diff}\n`
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
  if (props.toolName === 'Diff' && unifiedDiffData.value?.diff) {
    await copyToClipboard(unifiedDiffData.value.diff, 'content')
    return
  }
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

async function handlePreviewFile(event) {
  if (!previewFilePath.value) return
  event?.stopPropagation()
  try {
    await fileBrowserStore.previewFile(previewFilePath.value)
  } catch (error) {
    console.error('预览文件失败:', error)
  }
}
</script>

<template>
  <div class="tool-use-message-wrapper">
    <div class="tool-use-card" :class="{ error: isError, executing: isExecuting, collapsed: !isExpanded, 'text-style': isTextStyle }">
    <div class="tool-header" @click="toggleExpand">
      <div class="tool-info">
        <template v-if="isTextStyle">
          <span class="tool-name text-style-label">{{ textStyleLabel }}</span>
          <CollapseToggle v-if="!hideTextStyleToggle" :collapsed="!isExpanded" @toggle="toggleExpand" />
          <button
            v-if="showTextStyleSummary && previewFileName"
            class="text-style-summary text-style-file"
            type="button"
            @click.stop="handlePreviewFile"
          >
            {{ textStyleSummary }}
          </button>
          <span v-else-if="showTextStyleSummary && textStyleSummary" class="text-style-summary">{{ textStyleSummary }}</span>
          <span v-if="showTextStyleSummary && textStyleMeta" class="text-style-meta">{{ textStyleMeta }}</span>
          <span v-if="textStyleStatus" class="text-style-status" :class="`is-${textStyleStatus}`" aria-hidden="true">
            <svg v-if="textStyleStatus === 'success'" viewBox="0 0 12 12" fill="none">
              <path d="M2.2 6.2L4.7 8.7L9.8 3.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
            <svg v-else-if="textStyleStatus === 'error'" viewBox="0 0 12 12" fill="none">
              <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
            </svg>
            <span v-else class="status-spinner"></span>
          </span>
        </template>
        <template v-else>
          <span class="tool-name">{{ displayToolName }}</span>
        </template>
        <!-- 部分消息状态指示器 - 只在工具正在执行且没有输入数据时显示 -->
        <span v-if="isPartial && isExecuting" class="partial-status">
          <span>⏳ 等待数据...</span>
        </span>
        <span
          v-if="!isTextStyle && (isExecuting || isError || result || (props.toolName === 'Diff' && unifiedDiffData?.diff))"
          class="text-style-status"
          :class="{
            'is-executing': isExecuting,
            'is-error': !isExecuting && isError,
            'is-success': !isExecuting && !isError
          }"
          aria-hidden="true"
        >
          <svg v-if="!isExecuting && isError" viewBox="0 0 12 12" fill="none">
            <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
          </svg>
          <svg v-else-if="!isExecuting" viewBox="0 0 12 12" fill="none">
            <path d="M2.2 6.2L4.7 8.7L9.8 3.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
          </svg>
          <span v-else class="status-spinner"></span>
        </span>
        <span
          v-if="headerCollapsedSummary"
          class="header-summary-inline"
        >{{ headerCollapsedSummary }}</span>
        <span
          v-if="headerCollapsedMeta"
          class="header-summary-meta"
        >{{ headerCollapsedMeta }}</span>
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
        <CollapseToggle v-if="!isTextStyle" :collapsed="!isExpanded" @toggle="toggleExpand" />
      </div>
    </div>
    <div v-if="isExpanded" class="tool-body" :class="{ 'text-style-body': isTextStyle }">
      <div :class="{ 'text-style-body-card': isTextStyle }">
      <!-- 描述 -->
      <div v-if="primaryContent?.description && props.toolName !== 'TeamCreate' && props.toolName !== 'TeamDelete' && props.toolName !== 'SendMessage' && props.toolName !== 'ReceiveMessage' && props.toolName !== 'Agent' && props.toolName !== 'CronCreate' && props.toolName !== 'CronDelete'" class="tool-section has-copy">
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
      <div v-if="primaryContent && props.toolName !== 'SendMessage' && props.toolName !== 'ReceiveMessage' && props.toolName !== 'TeamDelete' && props.toolName !== 'CronCreate' && props.toolName !== 'CronDelete' && props.toolName !== 'CronList'" class="tool-section has-copy">
        <div
          v-if="props.toolName !== 'Agent' && props.toolName !== 'Grep'"
          class="section-label"
          :class="{ 'todo-label': props.toolName === 'TodoWrite' }"
        >{{ primaryContent.label }}</div>
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
        <template v-else-if="props.toolName === 'Diff' && unifiedDiffData">
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
            <pre class="section-content result">{{ unifiedDiffData.diff }}</pre>
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
          <div v-if="isTextStyle" class="agent-flat">
            <div class="tool-section">
              <div class="section-label">类型</div>
              <div class="section-content code">{{ agentData.subagentType || '通用代理' }}</div>
            </div>
            <div v-if="agentData.description" class="tool-section has-copy">
              <div class="section-label">说明</div>
              <div class="section-content description">{{ agentData.description }}</div>
            </div>
            <div v-if="agentData.prompt" class="tool-section has-copy">
              <div class="section-label">任务提示</div>
              <div class="section-content description">{{ agentData.prompt }}</div>
            </div>
          </div>
          <div v-else class="agent-container">
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
            <div class="grep-row">
              <div class="grep-field-label">关键字</div>
              <div class="grep-field-value grep-field-value--inline">
                <span class="grep-pattern">{{ grepData.pattern }}</span>
              </div>
            </div>
            <div v-if="grepData.path" class="grep-row">
              <div class="grep-field-label">路径</div>
              <div class="grep-field-value">{{ formatFilePath(grepData.path) }}</div>
            </div>
            <div class="grep-options">
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
            <div class="section-content code">{{ primaryContent.value }}</div>
          </div>
        </template>
      </div>

      <div v-if="props.toolName === 'TeamCreate' && primaryContent?.description" class="tool-section has-copy">
        <div class="section-label">描述</div>
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

      <template v-if="props.toolName === 'TeamDelete' && primaryContent">
        <div class="tool-section">
          <div class="section-label">名称</div>
          <div class="section-content code">{{ primaryContent.value }}</div>
        </div>
        <div v-if="primaryContent.description" class="tool-section has-copy">
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
      </template>

      <template v-if="props.toolName === 'CronCreate' && cronCreateData">
        <div v-if="cronCreateData.schedule" class="tool-section">
          <div class="section-label">时间</div>
          <div class="section-content code">{{ describeCronExpression(cronCreateData.schedule) }}</div>
        </div>
        <div v-if="cronCreateData.prompt" class="tool-section has-copy">
          <div class="section-label">提示词</div>
          <div class="section-content description">{{ cronCreateData.prompt }}</div>
        </div>
        <div v-if="cronCreateData.id || cronCreateData.sessionOnly || cronCreateData.autoDelete || cronCreateData.recurring || cronCreateData.durable" class="tool-section">
          <div class="section-label">任务信息</div>
          <div class="section-content code cron-meta">
            <div v-if="cronCreateData.id" class="cron-meta__row"><span class="cron-meta__label">任务 ID</span><span>{{ cronCreateData.id }}</span></div>
            <div class="cron-meta__row"><span class="cron-meta__label">类型</span><span>{{ cronCreateData.recurring ? '循环任务' : '一次性任务' }}</span></div>
            <div class="cron-meta__row"><span class="cron-meta__label">作用域</span><span>{{ cronCreateData.sessionOnly ? '仅当前会话' : (cronCreateData.durable ? '持久化' : '当前运行期') }}</span></div>
            <div v-if="!cronCreateData.recurring && cronCreateData.autoDelete" class="cron-meta__row"><span class="cron-meta__label">清理</span><span>执行后自动删除</span></div>
          </div>
        </div>
      </template>

      <template v-if="props.toolName === 'CronDelete' && cronDeleteData">
        <div v-if="cronDeleteData.id" class="tool-section">
          <div class="section-label">任务 ID</div>
          <div class="section-content code">{{ cronDeleteData.id }}</div>
        </div>
        <div v-if="cronDeleteData.description" class="tool-section has-copy">
          <div class="section-label">说明</div>
          <div class="section-content description">{{ cronDeleteData.description }}</div>
        </div>
      </template>

      <template v-if="props.toolName === 'CronList' && cronListData">
        <div v-if="cronListData.tasks.length" class="tool-section">
          <div class="section-label">任务列表</div>
          <div class="section-content code cron-list">
            <div v-for="(task, index) in cronListData.tasks" :key="task.id || index" class="cron-list__item">
              <div class="cron-list__line"><span class="cron-meta__label">任务</span><span>{{ task.id || `#${index + 1}` }}</span></div>
              <div v-if="task.humanSchedule || task.cron" class="cron-list__line"><span class="cron-meta__label">时间</span><span>{{ task.humanSchedule || task.cron }}</span></div>
              <div v-if="task.prompt" class="cron-list__line"><span class="cron-meta__label">提示词</span><span>{{ task.prompt }}</span></div>
            </div>
          </div>
        </div>
      </template>

      <template v-if="props.toolName === 'SendMessage' && sendMessageData">
        <div v-if="sendMessageData.sender" class="tool-section">
          <div class="section-label">发送者</div>
          <div class="section-content code">{{ sendMessageData.sender }}</div>
        </div>
        <div v-if="sendMessageData.target" class="tool-section">
          <div class="section-label">目标</div>
          <div class="section-content code">{{ sendMessageData.target }}</div>
        </div>
        <div v-if="sendMessageData.summary" class="tool-section has-copy">
          <div class="section-label">摘要</div>
          <div class="section-content description">{{ sendMessageData.summary }}</div>
        </div>
        <div v-if="sendMessageData.content" class="tool-section has-copy">
          <div class="section-label">内容</div>
          <div class="section-content description">{{ sendMessageData.content }}</div>
        </div>
      </template>

      <template v-if="props.toolName === 'ReceiveMessage' && receiveMessageData">
        <div v-if="receiveMessageData.sender" class="tool-section">
          <div class="section-label">发送者</div>
          <div class="section-content code">{{ receiveMessageData.sender }}</div>
        </div>
        <div v-if="receiveMessageData.summary" class="tool-section has-copy">
          <div class="section-label">摘要</div>
          <div class="section-content description">{{ receiveMessageData.summary }}</div>
        </div>
        <div v-if="receiveMessageData.content" class="tool-section has-copy">
          <div class="section-label">内容</div>
          <div class="section-content description">{{ receiveMessageData.content }}</div>
        </div>
      </template>

      <!-- 结果 -->
      <div v-if="formattedResult && props.toolName !== 'TeamCreate' && props.toolName !== 'TeamDelete' && props.toolName !== 'SendMessage' && props.toolName !== 'ReceiveMessage' && props.toolName !== 'Agent' && props.toolName !== 'CronCreate' && props.toolName !== 'CronDelete' && props.toolName !== 'CronList'" class="tool-section result-section">
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
  </div>
  </div>
</template>

<style scoped>
/* 工具消息包装器：宽度约束 */
.tool-use-message-wrapper {
  flex: 1;
  max-width: 70%;
}

.tool-use-message-wrapper:has(.tool-use-card.text-style) {
  margin: 0;
}

.tool-use-card {
  background: linear-gradient(135deg, #1E1E2E 0%, #18181B 100%);
  border: 1px solid #3B82F6;
  border-left: 3px solid #3B82F6;
  border-radius: 8px;
  overflow: hidden;
  margin: 0;
  max-width: 100%;
}

.tool-use-card.text-style {
  background: transparent;
  border: none;
  border-radius: 0;
  margin: 0;
}

.tool-use-card.error {
  border-color: #EF4444;
  border-left-color: #EF4444;
}

.tool-use-card.executing {
  border-color: #3B82F6;
  border-left-color: #3B82F6;
}

.cron-meta,
.cron-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.cron-meta__row,
.cron-list__line {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}

.cron-meta__label {
  color: #71717A;
  flex-shrink: 0;
}

.cron-list__item {
  padding: 8px 0;
  border-bottom: 1px solid rgba(63, 63, 70, 0.5);
}

.cron-list__item:last-child {
  border-bottom: none;
  padding-bottom: 0;
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
  position: relative;
}

.tool-use-card.text-style .tool-header {
  padding: 0;
  background: transparent;
  justify-content: flex-start;
  gap: 6px;
}

.tool-use-card.text-style.non-interactive .tool-header {
  cursor: default;
}

.tool-header:hover {
  background: #2D2D30;
}

.tool-use-card.text-style .tool-header:hover {
  background: transparent;
}

.tool-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.tool-use-card.text-style .tool-info {
  flex: 0 1 auto;
}

.header-summary-inline {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  color: #A1A1AA;
  font-size: 12px;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  flex: 1 1 auto;
}

.header-summary-meta {
  flex: 0 0 auto;
  color: #8B93A7;
  font-size: 11px;
  letter-spacing: 0.01em;
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

.tool-use-card.text-style .tool-name {
  font-size: 12px;
  font-weight: 500;
  color: #C4C7CF;
}

.text-style-label {
  flex-shrink: 0;
}

.text-style-summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #8B93A7;
  font-size: 12px;
}

.text-style-meta {
  flex-shrink: 0;
  color: #6B7280;
  font-size: 11px;
  letter-spacing: 0.01em;
}

.text-style-file {
  appearance: none;
  border: none;
  background: transparent;
  padding: 0;
  color: #60A5FA;
  cursor: pointer;
  font: inherit;
  text-decoration: none;
}

.text-style-file:hover {
  color: #93C5FD;
  text-decoration: underline;
}

.text-style-status {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.text-style-status svg {
  width: 12px;
  height: 12px;
}

.text-style-status.is-success {
  color: #6EE7B7;
}

.text-style-status.is-error {
  color: #F87171;
}

.text-style-status.is-executing {
  color: #94A3B8;
}

.status-spinner {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.35px solid rgba(148, 163, 184, 0.28);
  border-top-color: currentColor;
  animation: tool-status-spin 0.9s linear infinite;
}

@keyframes tool-status-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
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

.tool-use-card.text-style .collapsed-summary-line {
  padding: 0 0 8px 24px;
  border-top: none;
  background: transparent;
  color: #8B93A7;
  font-family: inherit;
}

.collapsed-summary-line:hover {
  background: rgba(59, 130, 246, 0.06);
}

.tool-use-card.text-style .collapsed-summary-line:hover {
  background: transparent;
  color: #B4BCD0;
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

.status-badge.inline-spinner {
  padding: 0;
  width: 16px;
  height: 16px;
  background: transparent;
  border: none;
}

.tool-use-card.text-style .status-badge {
  padding: 0;
  background: transparent;
  border-radius: 0;
  font-size: 11px;
}

.header-stats {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-left: auto;
  margin-right: 12px;
}

.header-stat {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #71717A;
  background: #27272A;
  padding: 2px 6px;
  border-radius: 4px;
}

.header-stat .stat-icon {
  font-size: 10px;
}

.header-stat.duration.streaming {
  color: #A78BFA;
  background: #1E1B4B;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0;
  flex: 0 0 auto;
  margin-left: 10px;
}

.tool-use-card.text-style .header-actions {
  gap: 4px;
  justify-content: flex-start;
  margin-left: 0;
}

/* 简约模式下复制按钮跟随内容，不使用绝对定位 */
.tool-use-card.text-style .copy-btn {
  position: static;
  transform: none;
  opacity: 0;
  pointer-events: none;
}

.tool-use-card.text-style .tool-header:hover .copy-btn {
  opacity: 0.6;
  pointer-events: auto;
}

.copy-btn {
  font-size: 12px;
  color: #71717A;
  background: transparent;
  border: none;
  padding: 2px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  opacity: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  width: 16px;
  height: 16px;
  pointer-events: none;
  position: absolute;
  right: 28px;
  top: 50%;
  transform: translateY(-50%);
}

.copy-btn svg {
  display: block;
}

.tool-header:hover .copy-btn {
  opacity: 0.6;
  pointer-events: auto;
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

.tool-use-card.text-style .tool-body {
  padding: 0 0 10px 24px;
  border-top: none;
}

.tool-use-card.text-style .tool-body.text-style-body {
  padding: 8px 0 10px 24px;
}

.text-style-body-card {
  background: linear-gradient(135deg, #1E1E2E 0%, #18181B 100%);
  border: 1px solid #3B82F6;
  border-left: 3px solid #3B82F6;
  border-radius: 8px;
  overflow: hidden;
  padding: 12px 14px;
}

.tool-use-card.text-style .text-style-body-card .section-content.description {
  color: #A1A1AA;
  white-space: pre-wrap;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  background: #18181B;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.6;
}

.tool-use-card.text-style .text-style-body-card .section-content.code {
  background: #18181B;
  padding: 8px 12px;
  border-radius: 6px;
  color: #A1A1AA;
}

.tool-use-card.text-style .text-style-body-card .section-content.result {
  background: #18181B;
  padding: 10px 12px;
  border-radius: 6px;
  color: #A1A1AA;
}

.tool-use-card.text-style .text-style-body-card .section-copy-btn {
  background: rgba(39, 39, 42, 0.9);
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

.tool-use-card.text-style .section-content.description {
  padding: 0;
  background: transparent;
  border-radius: 0;
  color: #9CA3AF;
}

.section-content.code {
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  background: #18181B;
  padding: 8px 12px;
  border-radius: 6px;
  color: #A1A1AA;
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
  background: transparent;
  border: none;
  padding: 0;
}

.grep-field-label {
  font-size: 11px;
  color: #71717A;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: 6px;
}

.grep-row {
  margin-bottom: 10px;
}

.grep-row:last-child {
  margin-bottom: 0;
}

.grep-field-value {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 10px 12px;
  background: #18181B;
  border-radius: 6px;
  color: #A1A1AA;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.6;
  word-break: break-word;
}

.grep-pattern {
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 12px;
  color: inherit;
  line-height: 1.6;
  word-break: break-word;
}

.grep-options {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  padding-top: 2px;
}

.grep-option {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #8B93A7;
}

.grep-option .option-label {
  color: #6B7280;
}

.grep-option-tag {
  display: inline-flex;
  align-items: center;
  padding: 3px 8px;
  border-radius: 12px;
  font-size: 11px;
  font-weight: 500;
  background: rgba(39, 39, 42, 0.9);
  color: #A1A1AA;
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
