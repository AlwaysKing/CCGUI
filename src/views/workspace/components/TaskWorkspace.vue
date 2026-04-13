<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseCard from '@/components/base/BaseCard.vue'
import BaseInput from '@/components/base/BaseInput.vue'
import Badge from '@/components/base/Badge.vue'
import AppSelect from '@/components/base/AppSelect.vue'
import AppMultiSelect from '@/components/base/AppMultiSelect.vue'
import IconButton from '@/components/base/IconButton.vue'
import {
  createTaskDraft,
  parseTaskMarkdown,
  serializeTaskMarkdown
} from '@/utils/taskMarkdown'
import {
  emitTaskTemplatesUpdated,
  loadTaskTemplates,
  normalizeTaskTemplateCollection,
  saveTaskTemplates
} from '@/utils/taskTemplates'

const props = defineProps({
  projectId: {
    type: String,
    default: ''
  },
  projectPath: {
    type: String,
    default: ''
  },
  showSidebarToggle: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['toggleSidebar', 'openTaskTemplatesDialog'])

const TASK_FILE_PATH = 'task.md'
const loadState = ref('idle')
const saveState = ref('idle')
const errorMessage = ref('')
const documentTitle = ref('项目任务')
const tasks = ref([])
const selectedTaskId = ref('')
const editorDraft = ref(null)
const metaExpanded = ref(false)
const detailPaneRef = ref(null)
const taskBoardStageRef = ref(null)
const routineEditorDraft = ref(null)
const routineEditorMode = ref('edit')
const appTaskTemplates = ref({ routine: [], run: [] })
const projectTaskTemplates = ref({ routine: [], run: [] })
const priorityFilter = ref('all')
const routineScopeFilter = ref('all')
const searchQuery = ref('')
const designDocOptions = ref([])
const detailPaneSide = ref('right')
let removeProjectFilesChangedListener = null
const priorityFilterOptions = [
  { value: 'all', label: '全部' },
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' }
]
const routineScopeFilterOptions = [
  { value: 'all', label: '全部' },
  { value: 'system', label: '系统' },
  { value: 'project', label: '项目' }
]
const taskStatusOptions = [
  { value: 'pending', label: '未开始' },
  { value: 'running', label: '进行中' },
  { value: 'completed', label: '已完成' },
  { value: 'error', label: '异常' }
]
const taskPriorityOptions = [
  { value: 'high', label: '高' },
  { value: 'medium', label: '中' },
  { value: 'low', label: '低' }
]

function cloneTask(task) {
  return JSON.parse(JSON.stringify(task))
}

function normalizeTaskForEditor(task) {
  return {
    id: String(task?.id || ''),
    title: String(task?.title || '').trim(),
    metadata: {
      status: task?.metadata?.status || 'pending',
      priority: task?.metadata?.priority || 'medium',
      'run-template': task?.metadata?.['run-template'] || '',
      'design-doc': task?.metadata?.['design-doc'] || '',
      'depends-on': getTaskDependsOn(task).slice().sort()
    },
    sections: {
      描述: String(task?.sections?.描述 || '').trim()
    }
  }
}

function createTodayStamp() {
  return new Date().toISOString().slice(0, 10)
}

function stripTaskDocumentTitle(content = '') {
  return String(content || '')
    .replace(/^#\s+.+\n?/, '')
    .replace(/^\n+/, '')
    .trim()
}

function buildTaskDocument(task) {
  return stripTaskDocumentTitle(serializeTaskMarkdown({
    title: '项目任务',
    tasks: [task]
  }))
}

function buildEmbeddedTaskDocument(task) {
  return buildTaskDocument(task)
    .split('\n')
    .map(line => line ? `> ${line}` : '>')
    .join('\n')
}

function renderRunTemplateContent(templateContent, task) {
  const replacements = {
    '{{task_id}}': String(task?.id || ''),
    '{{task_title}}': String(task?.title || ''),
    '{{task_document}}': buildEmbeddedTaskDocument(task)
  }

  return Object.entries(replacements).reduce((content, [placeholder, value]) => {
    return content.split(placeholder).join(value)
  }, String(templateContent || ''))
}

function normalizeTemplateScope(scope = '') {
  return scope === 'project' ? 'project' : 'app'
}

function buildRunTemplateRef(template) {
  const scope = normalizeTemplateScope(template?.scope)
  const id = String(template?.id || '').trim()
  return id ? `${scope}:${id}` : ''
}

function parseRunTemplateRef(value = '') {
  const raw = String(value || '').trim()
  if (!raw) {
    return { scope: '', id: '' }
  }

  const scopedMatch = raw.match(/^(app|project):(.*)$/)
  if (scopedMatch) {
    return {
      scope: scopedMatch[1],
      id: String(scopedMatch[2] || '').trim()
    }
  }

  return {
    scope: '',
    id: raw
  }
}

function findRunTemplateByRef(value = '') {
  const reference = parseRunTemplateRef(value)
  if (!reference.id) {
    return null
  }

  return runTemplateLibrary.value.find(item => {
    if (item.id !== reference.id) {
      return false
    }
    if (!reference.scope) {
      return true
    }
    return normalizeTemplateScope(item.scope) === reference.scope
  }) || null
}

async function loadDesignDocOptions() {
  if (!props.projectPath) {
    designDocOptions.value = []
    return
  }

  const result = await window.electronAPI.listProjectFiles({
    projectPath: props.projectPath,
    relativePath: 'plain'
  })

  if (!result?.success) {
    designDocOptions.value = []
    return
  }

  designDocOptions.value = (Array.isArray(result.entries) ? result.entries : [])
    .filter(entry => entry?.type === 'file' && String(entry.name || '').toLowerCase().endsWith('.md'))
    .map(entry => ({
      value: entry.name,
      label: entry.name
    }))
    .sort((left, right) => left.label.localeCompare(right.label, 'zh-Hans-CN', { sensitivity: 'base' }))
}

async function loadTaskDocument() {
  if (!props.projectPath) {
    return
  }

  loadState.value = 'loading'
  errorMessage.value = ''

  const result = await window.electronAPI.readProjectFile({
    projectPath: props.projectPath,
    filePath: TASK_FILE_PATH
  })

  if (!result?.success) {
    const isMissing = result?.error?.includes('ENOENT')
    loadState.value = isMissing ? 'missing' : 'error'
    errorMessage.value = isMissing ? '' : (result?.error || '读取 task.md 失败')
    tasks.value = []
    selectedTaskId.value = ''
    return
  }

  const parsed = parseTaskMarkdown(result.file?.content || '')
  documentTitle.value = parsed.title || '项目任务'
  tasks.value = parsed.tasks.map(task => cloneTask(task))
  if (selectedTaskId.value && !tasks.value.find(task => task.id === selectedTaskId.value)) {
    selectedTaskId.value = ''
    editorDraft.value = null
  }
  loadState.value = 'ready'
}

async function loadRoutineTaskLibrary() {
  try {
    const result = await loadTaskTemplates({ projectId: props.projectId })
    appTaskTemplates.value = result.app
    projectTaskTemplates.value = result.project
  } catch (error) {
    errorMessage.value = error.message || '读取常规任务失败'
  }
}

async function saveTaskDocument() {
  if (!props.projectPath) {
    return false
  }

  saveState.value = 'saving'
  errorMessage.value = ''

  const content = serializeTaskMarkdown({
    title: documentTitle.value,
    tasks: tasks.value
  })

  const result = await window.electronAPI.writeProjectFile({
    projectPath: props.projectPath,
    filePath: TASK_FILE_PATH,
    content
  })

  if (!result?.success) {
    saveState.value = 'error'
    errorMessage.value = result?.error || '保存 task.md 失败'
    return false
  }

  saveState.value = 'idle'
  return true
}

async function createTaskDocument() {
  documentTitle.value = '项目任务'
  tasks.value = [createTaskDraft([])]
  selectedTaskId.value = tasks.value[0].id
  loadState.value = 'ready'
  await saveTaskDocument()
}

const selectedTask = computed(() => {
  return tasks.value.find(task => task.id === selectedTaskId.value) || null
})

const isCreatingTask = computed(() => !selectedTaskId.value && Boolean(editorDraft.value))
const activeEditorTask = computed(() => editorDraft.value)
const canCreateTask = computed(() => {
  const title = String(editorDraft.value?.title || '').trim()
  const description = String(editorDraft.value?.sections?.描述 || '').trim()
  return Boolean(editorDraft.value?.id && title && description)
})
const canSaveTask = computed(() => {
  if (!selectedTask.value || !editorDraft.value) {
    return false
  }
  return JSON.stringify(normalizeTaskForEditor(selectedTask.value)) !== JSON.stringify(normalizeTaskForEditor(editorDraft.value))
})
const dependencyOptions = computed(() => {
  const currentTaskId = editorDraft.value?.id || ''
  return tasks.value
    .filter(task => task.id !== currentTaskId)
    .map(task => ({
      value: task.id,
      label: task.title || task.id,
      shortLabel: task.title || getCollapsedTaskId(task.id),
      description: `${getCollapsedTaskId(task.id)} · ${taskStatusLabel(task.metadata?.status || 'pending')}`,
      menuLabel: `${task.title || task.id} (${getCollapsedTaskId(task.id)})`
    }))
})

const filteredTasks = computed(() => {
  return tasks.value.filter(task => {
    if (isTaskArchived(task)) return false

    const priority = task.metadata?.priority || 'medium'
    const keyword = searchQuery.value.trim().toLowerCase()

    if (priorityFilter.value !== 'all' && priority !== priorityFilter.value) return false

    if (!keyword) return true

    const searchHaystack = [
      task.id,
      task.title,
      task.sections?.描述,
      task.metadata?.['design-doc']
    ].join('\n').toLowerCase()

    return searchHaystack.includes(keyword)
  })
})

const boardColumns = computed(() => {
  const groups = [
    { key: 'pending', title: '未开始' },
    { key: 'running', title: '进行中' },
    { key: 'completed', title: '已完成' },
    { key: 'error', title: '异常' }
  ]

  return groups.map(group => ({
    ...group,
    tasks: filteredTasks.value.filter(task => (task.metadata?.status || 'pending') === group.key)
  }))
})

const filteredRoutineTaskLibrary = computed(() => {
  const mergedRoutineLibrary = [
    ...(appTaskTemplates.value.routine || []).map(item => ({
      ...item,
      description: item.content,
      scope: 'system'
    })),
    ...(projectTaskTemplates.value.routine || []).map(item => ({
      ...item,
      description: item.content,
      scope: 'project'
    }))
  ]

  if (routineScopeFilter.value === 'all') {
    return mergedRoutineLibrary
  }
  return mergedRoutineLibrary.filter(task => task.scope === routineScopeFilter.value)
})
const runTemplateLibrary = computed(() => {
  return [
    ...(projectTaskTemplates.value.run || []).map(item => ({
      ...item,
      scope: 'project'
    })),
    ...(appTaskTemplates.value.run || []).map(item => ({
      ...item,
      scope: 'app'
    }))
  ]
})
const runTemplateOptions = computed(() => {
  return [
    { value: '', label: '不使用' },
    ...runTemplateLibrary.value.map(item => ({
      value: buildRunTemplateRef(item),
      label: item.title,
      description: item.scope === 'project' ? '项目' : 'App'
    }))
  ]
})
const taskDetailRunTemplate = computed(() => {
  return findRunTemplateByRef(editorDraft.value?.metadata?.['run-template'] || '')
})
const selectedRunTemplate = computed(() => {
  return findRunTemplateByRef(routineEditorDraft.value?.runTemplateId || '')
})
const routineRunPreviewTask = computed(() => {
  if (routineEditorMode.value !== 'run' || !routineEditorDraft.value) {
    return null
  }

  const previewTask = createTaskDraft(tasks.value)
  previewTask.id = String(routineEditorDraft.value.previewTaskId || previewTask.id)
  previewTask.title = String(routineEditorDraft.value.title || '').trim()
  previewTask.sections = {
    描述: String(routineEditorDraft.value.content || '').trim()
  }
  return previewTask
})
const renderedRunTemplatePreview = computed(() => {
  if (!selectedRunTemplate.value || !routineRunPreviewTask.value) {
    return ''
  }
  return renderRunTemplateContent(selectedRunTemplate.value.content, routineRunPreviewTask.value)
})

function routineScopeFilterLabel() {
  return {
    all: '全部',
    system: '系统',
    project: '项目'
  }[routineScopeFilter.value] || '全部'
}

function selectTask(taskId) {
  selectTaskWithAnchor(taskId, null)
}

function updateDetailPaneSide(anchorElement = null, task = null) {
  const boardElement = taskBoardStageRef.value
  if (!(boardElement instanceof Element) || !(anchorElement instanceof Element)) {
    detailPaneSide.value = 'right'
    return
  }

  const boardRect = boardElement.getBoundingClientRect()
  const anchorRect = anchorElement.getBoundingClientRect()
  const taskStatus = String(task?.metadata?.status || '')
  const detailWidth = 392
  const safeGap = 24
  const rightSpace = boardRect.right - anchorRect.right

  if (taskStatus === 'error') {
    detailPaneSide.value = 'left'
    return
  }

  if (taskStatus === 'completed') {
    detailPaneSide.value = boardRect.width > 1400 ? 'right' : 'left'
    return
  }

  if (rightSpace < detailWidth + safeGap) {
    detailPaneSide.value = 'left'
    return
  }

  detailPaneSide.value = 'right'
}

function selectTaskWithAnchor(taskId, anchorElement = null) {
  selectedTaskId.value = taskId
  const task = tasks.value.find(entry => entry.id === taskId) || null
  editorDraft.value = task ? cloneTask(task) : null
  metaExpanded.value = false
  updateDetailPaneSide(anchorElement, task)
}

function closeTaskDetail() {
  selectedTaskId.value = ''
  editorDraft.value = null
  metaExpanded.value = false
}

function closeRoutineTaskEditor() {
  routineEditorDraft.value = null
  routineEditorMode.value = 'edit'
}

function handleDocumentPointerDown(event) {
  if (!activeEditorTask.value || routineEditorDraft.value) {
    return
  }

  const target = event.target
  if (!(target instanceof Element)) {
    return
  }

  if (detailPaneRef.value?.contains(target)) {
    return
  }

  if (target.closest('.app-select-menu[teleported]') || target.closest('.app-multi-select-menu[teleported]')) {
    return
  }

  if (target.closest('.task-board-card') || target.closest('.task-board-add-btn')) {
    return
  }

  closeTaskDetail()
}

function updateEditorDraft(mutator) {
  if (!editorDraft.value) return
  const draft = cloneTask(editorDraft.value)
  mutator(draft)
  editorDraft.value = draft
}

function openCreateTaskEditor(anchorElement = null) {
  selectedTaskId.value = ''
  editorDraft.value = createTaskDraft(tasks.value)
  metaExpanded.value = false
  updateDetailPaneSide(anchorElement, editorDraft.value)
}

function openRoutineTaskEditor(routineTask, mode = 'edit') {
  const defaultRunTemplate = runTemplateLibrary.value[0] || null
  const previewTask = mode === 'run' ? createTaskDraft(tasks.value) : null
  routineEditorMode.value = mode
  routineEditorDraft.value = {
    id: routineTask?.id || '',
    title: routineTask?.title || '',
    content: routineTask?.description || routineTask?.content || '',
    scope: routineTask?.scope || 'system',
    runTemplateId: mode === 'run' ? buildRunTemplateRef(defaultRunTemplate) : '',
    previewTaskId: previewTask?.id || '',
    createdAt: routineTask?.createdAt || '',
    updatedAt: routineTask?.updatedAt || ''
  }
  closeTaskDetail()
}

function handleRunRoutineTask(routineTask) {
  openRoutineTaskEditor(routineTask, 'run')
}

function openRunTemplateManager() {
  emit('openTaskTemplatesDialog', 'run')
}

function syncTaskRunTemplate(task) {
  const nextTask = cloneTask(task)
  const runTemplateRef = String(nextTask?.metadata?.['run-template'] || '').trim()
  const matchedTemplate = findRunTemplateByRef(runTemplateRef)

  nextTask.metadata = {
    ...(nextTask.metadata || {}),
    'run-template': matchedTemplate ? buildRunTemplateRef(matchedTemplate) : ''
  }

  nextTask.sections = {
    ...(nextTask.sections || {})
  }

  if ('运行提示' in nextTask.sections) {
    delete nextTask.sections['运行提示']
  }

  return nextTask
}

const canSaveRoutineTemplate = computed(() => {
  const title = String(routineEditorDraft.value?.title || '').trim()
  const content = String(routineEditorDraft.value?.content || '').trim()
  return routineEditorMode.value !== 'run' && Boolean(routineEditorDraft.value?.id && title && content)
})

const canRunRoutineTask = computed(() => {
  const title = String(routineEditorDraft.value?.title || '').trim()
  const content = String(routineEditorDraft.value?.content || '').trim()
  return routineEditorMode.value === 'run' && Boolean(title && content)
})

async function saveRoutineTaskTemplate() {
  if (!canSaveRoutineTemplate.value || !routineEditorDraft.value) {
    return
  }

  try {
    errorMessage.value = ''
    const scope = routineEditorDraft.value.scope === 'project' ? 'project' : 'app'
    const sourceCollection = normalizeTaskTemplateCollection(
      scope === 'project' ? projectTaskTemplates.value : appTaskTemplates.value
    )
    const nextList = (sourceCollection.routine || []).map(item => {
      if (item.id !== routineEditorDraft.value.id) {
        return item
      }

      return {
        ...item,
        title: routineEditorDraft.value.title,
        content: routineEditorDraft.value.content,
        updatedAt: new Date().toISOString()
      }
    })

    const normalized = await saveTaskTemplates({
      scope,
      projectId: props.projectId,
      collection: {
        ...sourceCollection,
        routine: nextList
      }
    })

    if (scope === 'project') {
      projectTaskTemplates.value = normalized
    } else {
      appTaskTemplates.value = normalized
    }

    emitTaskTemplatesUpdated({
      scope,
      kind: 'routine',
      projectId: props.projectId
    })
    closeRoutineTaskEditor()
  } catch (error) {
    errorMessage.value = error.message || '保存常规任务失败'
  }
}

async function runRoutineTask() {
  if (!canRunRoutineTask.value || !routineEditorDraft.value) {
    return
  }

  try {
    const draft = createTaskDraft(tasks.value)
    draft.title = String(routineEditorDraft.value.title || '').trim()
    draft.sections = {
      描述: String(routineEditorDraft.value.content || '').trim()
    }
    if (selectedRunTemplate.value) {
      draft.metadata['run-template'] = buildRunTemplateRef(selectedRunTemplate.value)
    }

    tasks.value = [...tasks.value, draft]
    selectedTaskId.value = draft.id
    editorDraft.value = cloneTask(draft)
    errorMessage.value = ''
    const saved = await saveTaskDocument()
    if (!saved) {
      return
    }
    closeRoutineTaskEditor()
  } catch (error) {
    errorMessage.value = error.message || '运行常规任务失败'
  }
}

function duplicateTask() {
  if (!editorDraft.value) return
  const draft = createTaskDraft(tasks.value)
  draft.title = `${editorDraft.value.title} - 副本`
  draft.metadata.priority = editorDraft.value.metadata?.priority || 'medium'
  draft.metadata['run-template'] = editorDraft.value.metadata?.['run-template'] || ''
  draft.metadata['design-doc'] = editorDraft.value.metadata?.['design-doc'] || ''
  draft.metadata['depends-on'] = [...getTaskDependsOn(editorDraft.value)]
  draft.sections = {
    描述: editorDraft.value.sections?.描述 || ''
  }
  if (editorDraft.value.sections?.['运行提示']) {
    draft.sections['运行提示'] = editorDraft.value.sections['运行提示']
  }
  selectedTaskId.value = ''
  editorDraft.value = draft
}

function removeTask() {
  if (!selectedTask.value) return
  const confirmed = window.confirm(`确定删除 ${selectedTask.value.id} 吗？`)
  if (!confirmed) return

  const nextTasks = tasks.value.filter(task => task.id !== selectedTaskId.value)
  tasks.value = nextTasks
  selectedTaskId.value = ''
  editorDraft.value = null
  metaExpanded.value = false
  saveTaskDocument()
}

async function openDesignDoc() {
  const designDocName = editorDraft.value?.metadata?.['design-doc']
  if (!designDocName) return

  await window.electronAPI.openProjectEntryInFinder({
    projectPath: props.projectPath,
    targetPath: `plain/${designDocName}`,
    mode: 'open'
  })
}

function updateTaskField(field, value) {
  updateEditorDraft(task => {
    task[field] = value
  })
}

function updateTaskTitle(value) {
  updateEditorDraft(task => {
    task.title = value
  })
}

function updateMetadata(key, value) {
  updateEditorDraft(task => {
    task.metadata = {
      ...(task.metadata || {}),
      [key]: value
    }
  })
}

function updateSection(section, value) {
  updateEditorDraft(task => {
    task.sections = {
      ...(task.sections || {}),
      [section]: value
    }
  })
}

function getTaskDependsOn(task) {
  const value = task?.metadata?.['depends-on']
  if (Array.isArray(value)) {
    return [...new Set(value.map(entry => String(entry || '').trim()).filter(Boolean))]
  }
  return [...new Set(
    String(value || '')
      .split(/[,\n]/)
      .map(entry => String(entry || '').trim())
      .filter(Boolean)
  )]
}

function updateTaskDependencies(values) {
  const uniqueValues = [...new Set((Array.isArray(values) ? values : []).map(value => String(value || '').trim()).filter(Boolean))]
  updateMetadata('depends-on', uniqueValues)
}

function hasDependencyPath(taskMap, startId, targetId, visited = new Set()) {
  if (!startId || !targetId || visited.has(startId)) {
    return false
  }
  if (startId === targetId) {
    return true
  }

  visited.add(startId)
  const task = taskMap.get(startId)
  if (!task) {
    return false
  }

  return getTaskDependsOn(task).some(nextId => hasDependencyPath(taskMap, nextId, targetId, visited))
}

function validateTaskDependencies(task) {
  const taskId = task?.id
  if (!taskId) {
    return ''
  }

  const dependsOn = getTaskDependsOn(task)
  if (dependsOn.includes(taskId)) {
    return '任务不能依赖自己'
  }

  const taskMap = new Map(tasks.value.map(entry => [entry.id, entry]))
  taskMap.set(taskId, task)

  for (const dependencyId of dependsOn) {
    if (hasDependencyPath(taskMap, dependencyId, taskId, new Set())) {
      return '检测到循环依赖，请调整依赖关系'
    }
  }

  return ''
}

async function applyTaskChanges() {
  if (!selectedTaskId.value || !editorDraft.value) return
  const index = tasks.value.findIndex(task => task.id === selectedTaskId.value)
  if (index < 0) return
  const nextTask = syncTaskRunTemplate(editorDraft.value)
  const dependencyError = validateTaskDependencies(nextTask)
  if (dependencyError) {
    errorMessage.value = dependencyError
    return
  }
  nextTask.metadata = {
    ...(nextTask.metadata || {}),
    'depends-on': getTaskDependsOn(nextTask),
    created: tasks.value[index]?.metadata?.created || nextTask.metadata?.created || createTodayStamp(),
    updated: createTodayStamp()
  }
  tasks.value.splice(index, 1, nextTask)
  editorDraft.value = cloneTask(nextTask)
  errorMessage.value = ''
  const saved = await saveTaskDocument()
  if (saved) {
    closeTaskDetail()
  }
}

async function createTaskFromDraft() {
  if (!editorDraft.value) return
  const draft = syncTaskRunTemplate(editorDraft.value)
  const dependencyError = validateTaskDependencies(draft)
  if (dependencyError) {
    errorMessage.value = dependencyError
    return
  }
  draft.metadata = {
    ...(draft.metadata || {}),
    'depends-on': getTaskDependsOn(draft),
    created: draft.metadata?.created || createTodayStamp(),
    updated: createTodayStamp()
  }
  tasks.value = [...tasks.value, draft]
  selectedTaskId.value = draft.id
  editorDraft.value = cloneTask(draft)
  errorMessage.value = ''
  const saved = await saveTaskDocument()
  if (saved) {
    closeTaskDetail()
  }
}

function taskStatusVariant(status = '') {
  if (status === 'completed') return 'success'
  if (status === 'running') return 'info'
  if (status === 'error') return 'error'
  return 'default'
}

function taskPriorityVariant(priority = '') {
  if (priority === 'high') return 'warning'
  if (priority === 'low') return 'default'
  return 'primary'
}

function taskStatusLabel(status = '') {
  return {
    pending: '未开始',
    running: '进行中',
    completed: '已完成',
    error: '异常'
  }[status] || status || '未开始'
}

function taskPriorityLabel(priority = '') {
  return {
    high: '高',
    medium: '中',
    low: '低'
  }[priority] || priority || '中'
}

function getCollapsedTaskId(id = '') {
  const value = String(id || '').trim()
  if (!value) return '-'
  if (value.length <= 12) return value
  return value.slice(0, 8)
}

function isTaskArchived(task) {
  return String(task?.metadata?.archived || '').trim().toLowerCase() === 'true'
}

function getTaskDesignDocLabel(task) {
  const designDoc = String(task?.metadata?.['design-doc'] || '').trim()
  return designDoc && designDoc !== '-' ? designDoc : ''
}

function getTaskDependencyLabel(task) {
  const dependencyIds = getTaskDependsOn(task)
  if (!dependencyIds.length) {
    return ''
  }

  return dependencyIds
    .map(dependencyId => {
      const matchedTask = tasks.value.find(item => item.id === dependencyId)
      return matchedTask?.title || getCollapsedTaskId(dependencyId)
    })
    .join('、')
}

function getTaskCardActionSpec(task) {
  const status = String(task?.metadata?.status || 'pending')

  if (status === 'running') {
    return { title: '停止任务', icon: 'stop' }
  }
  if (status === 'completed') {
    return { title: '归档任务', icon: 'archive' }
  }
  if (status === 'error') {
    return { title: '重试任务', icon: 'retry' }
  }

  return { title: '开始任务', icon: 'play' }
}

async function handleTaskCardAction(task) {
  if (!task?.id) return

  const index = tasks.value.findIndex(entry => entry.id === task.id)
  if (index < 0) return

  const nextTask = cloneTask(tasks.value[index])
  const status = String(nextTask.metadata?.status || 'pending')

  if (status === 'completed') {
    nextTask.metadata = {
      ...(nextTask.metadata || {}),
      archived: 'true',
      updated: createTodayStamp()
    }
  } else if (status === 'running') {
    nextTask.metadata = {
      ...(nextTask.metadata || {}),
      status: 'pending',
      updated: createTodayStamp()
    }
  } else if (status === 'error') {
    nextTask.metadata = {
      ...(nextTask.metadata || {}),
      status: 'running',
      updated: createTodayStamp()
    }
  } else {
    nextTask.metadata = {
      ...(nextTask.metadata || {}),
      status: 'running',
      updated: createTodayStamp()
    }
  }

  tasks.value.splice(index, 1, nextTask)

  if (selectedTaskId.value === nextTask.id) {
    if (isTaskArchived(nextTask)) {
      closeTaskDetail()
    } else {
      editorDraft.value = cloneTask(nextTask)
    }
  }

  errorMessage.value = ''
  await saveTaskDocument()
}

watch(() => [props.projectId, props.projectPath], () => {
  loadTaskDocument()
  loadDesignDocOptions()
  loadRoutineTaskLibrary()
}, { immediate: true })

onMounted(() => {
  document.addEventListener('pointerdown', handleDocumentPointerDown)
  window.addEventListener('ccgui-task-templates-updated', loadRoutineTaskLibrary)
  if (!removeProjectFilesChangedListener && window.electronEvents?.onProjectFilesChanged) {
    removeProjectFilesChangedListener = window.electronEvents.onProjectFilesChanged((payload) => {
      const relativePath = String(payload?.relativePath || '').replace(/\\/g, '/')
      const payloadProjectPath = String(payload?.projectPath || '')
      if (!props.projectPath || payloadProjectPath !== props.projectPath) {
        return
      }
      if (relativePath !== TASK_FILE_PATH) {
        return
      }
      void loadTaskDocument()
    })
  }
})

onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', handleDocumentPointerDown)
  window.removeEventListener('ccgui-task-templates-updated', loadRoutineTaskLibrary)
  removeProjectFilesChangedListener?.()
  removeProjectFilesChangedListener = null
})
</script>

<template>
  <section class="task-workspace">
    <header class="task-topbar">
      <div class="task-topbar-left">
        <button
          v-if="showSidebarToggle"
          class="sidebar-safe-btn"
          title="展开侧边栏"
          @click="emit('toggleSidebar')"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10 6l6 6-6 6"/>
            <path d="M4 5v14"/>
          </svg>
        </button>
        <div>
          <h1>任务管理</h1>
        </div>
      </div>

    </header>

    <div v-if="errorMessage" class="task-banner error">
      {{ errorMessage }}
    </div>

    <div v-if="loadState === 'missing'" class="task-empty-state">
        <div class="empty-card empty-card-muted">
          <div class="empty-kicker">任务文件</div>
          <h2>当前项目还没有 task.md</h2>
          <p>创建后就可以在这里维护任务列表、设计文档引用和依赖信息。</p>
          <div class="empty-actions">
            <BaseButton variant="secondary" size="sm" @click="createTaskDocument">创建 task.md</BaseButton>
          </div>
        </div>
    </div>

    <div v-else-if="loadState === 'error'" class="task-empty-state">
      <BaseCard padding="lg" class="empty-card">
        <h2>读取 task.md 失败</h2>
        <p>{{ errorMessage }}</p>
        <BaseButton variant="secondary" @click="loadTaskDocument">重试</BaseButton>
      </BaseCard>
    </div>

    <div v-else class="task-shell task-shell-board">
      <aside class="task-list-pane">
        <div class="task-filters">
          <div class="filter-row">
            <AppSelect v-model="priorityFilter" :options="priorityFilterOptions" full-width />
          </div>
          <BaseInput v-model="searchQuery" size="sm" placeholder="搜索任务标题、描述、设计文档" />
          <IconButton
            class="task-filter-refresh"
            size="sm"
            title="刷新"
            @click="loadTaskDocument"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 2v6h-6"></path>
              <path d="M3 12a9 9 0 0 1 15.55-6.36L21 8"></path>
              <path d="M3 22v-6h6"></path>
              <path d="M21 12a9 9 0 0 1-15.55 6.36L3 16"></path>
            </svg>
          </IconButton>
        </div>

        <div ref="taskBoardStageRef" class="task-board-stage">
        <div class="task-board">
          <div class="task-board-column task-board-column-routine">
            <div class="task-board-column-header">
              <div class="task-board-column-title">
                <span>常规任务</span>
                <div class="task-board-routine-filter">
                  <AppSelect
                    v-model="routineScopeFilter"
                    :options="routineScopeFilterOptions"
                    :menu-min-width="92"
                    class="task-board-routine-filter-select"
                    selected-label=""
                  />
                  <svg class="task-board-routine-filter-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 5h18"></path>
                    <path d="M6 12h12"></path>
                    <path d="M10 19h4"></path>
                  </svg>
                  <span class="task-routine-filter-chip">{{ routineScopeFilterLabel() }}</span>
                </div>
              </div>
              <div class="task-board-column-actions">
                <button
                  type="button"
                  class="task-board-template-entry"
                  title="任务模板"
                  @click="emit('openTaskTemplatesDialog')"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M3 5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2H3V5z"></path>
                    <path d="M3 9h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z"></path>
                    <path d="M8 13h8"></path>
                    <path d="M12 9v8"></path>
                  </svg>
                </button>
              </div>
            </div>
            <div class="task-board-column-body">
              <BaseCard
                v-for="routineTask in filteredRoutineTaskLibrary"
                :key="routineTask.id"
                hoverable
                padding="sm"
                class="task-board-card task-board-card-routine"
                :class="{ 'task-board-card-routine-project': routineTask.scope === 'project' }"
                @click="openRoutineTaskEditor(routineTask)"
              >
                <div class="task-board-card-topbar">
                  <div class="task-board-card-title">{{ routineTask.title }}</div>
                  <button
                    type="button"
                    class="task-board-run-icon"
                    title="运行"
                    @click.stop="handleRunRoutineTask(routineTask)"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                      <polygon points="8,5 19,12 8,19"></polygon>
                    </svg>
                  </button>
                </div>
                <div class="task-board-card-desc">{{ routineTask.description }}</div>
              </BaseCard>
            </div>
          </div>

          <div v-for="column in boardColumns" :key="column.key" class="task-board-column">
            <div class="task-board-column-header">
              <div class="task-board-column-title">
                <span>{{ column.title }}</span>
                <button
                  v-if="column.key === 'pending'"
                  class="task-board-add-btn"
                  title="新建任务"
                  @click="openCreateTaskEditor($event.currentTarget)"
                >
                  +
                </button>
              </div>
              <Badge size="sm">{{ column.tasks.length }}</Badge>
            </div>
            <div class="task-board-column-body">
              <BaseCard
                v-for="task in column.tasks"
                :key="task.id"
                hoverable
                padding="sm"
                :selected="task.id === selectedTaskId"
                class="task-board-card"
                @click="selectTaskWithAnchor(task.id, $event.currentTarget)"
              >
                <div class="task-board-card-head">
                  <div class="task-board-card-title">{{ task.title }}</div>
                  <button
                    type="button"
                    class="task-board-card-action"
                    :class="`is-${getTaskCardActionSpec(task).icon}`"
                    :title="getTaskCardActionSpec(task).title"
                    @click.stop="handleTaskCardAction(task)"
                  >
                    <svg
                      v-if="getTaskCardActionSpec(task).icon === 'play'"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      stroke="none"
                    >
                      <polygon points="8,5 19,12 8,19"></polygon>
                    </svg>
                    <svg
                      v-else-if="getTaskCardActionSpec(task).icon === 'stop'"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                      stroke="none"
                    >
                      <rect x="7" y="7" width="10" height="10" rx="1.5"></rect>
                    </svg>
                    <svg
                      v-else-if="getTaskCardActionSpec(task).icon === 'archive'"
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M3 7h18"></path>
                      <path d="M5 7l1 11a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-11"></path>
                      <path d="M9 11h6"></path>
                      <path d="M10 3h4l1 4H9l1-4z"></path>
                    </svg>
                    <svg
                      v-else
                      width="12"
                      height="12"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      stroke-width="2"
                    >
                      <path d="M21 2v6h-6"></path>
                      <path d="M3 12a9 9 0 0 1 15.55-6.36L21 8"></path>
                      <path d="M3 22v-6h6"></path>
                      <path d="M21 12a9 9 0 0 1-15.55 6.36L3 16"></path>
                    </svg>
                  </button>
                </div>
                <div class="task-board-card-desc">{{ task.sections?.描述 || '' }}</div>
                <div v-if="getTaskDesignDocLabel(task)" class="task-board-card-meta-line">
                  <span class="task-board-card-meta-label">引用文件</span>
                  <span class="task-board-card-meta-value">{{ getTaskDesignDocLabel(task) }}</span>
                </div>
                <div v-if="getTaskDependencyLabel(task)" class="task-board-card-meta-line">
                  <span class="task-board-card-meta-label">依赖任务</span>
                  <span class="task-board-card-meta-value">{{ getTaskDependencyLabel(task) }}</span>
                </div>
                <div class="task-board-card-footer">
                  <Badge :variant="taskPriorityVariant(task.metadata?.priority)" size="sm">
                    {{ taskPriorityLabel(task.metadata?.priority) }}
                  </Badge>
                  <div class="task-board-card-id task-board-card-id-subtle">{{ getCollapsedTaskId(task.id) }}</div>
                </div>
              </BaseCard>
            </div>
          </div>
        </div>

        <section
          v-if="activeEditorTask"
          ref="detailPaneRef"
          class="task-detail-pane task-detail-pane-floating"
          :class="{ 'is-left': detailPaneSide === 'left', 'is-right': detailPaneSide !== 'left' }"
        >
        <div class="task-detail-scroll">
          <div class="detail-header">
            <div class="detail-heading">
              <div class="detail-eyebrow">{{ isCreatingTask ? '新建任务' : '任务详情' }}</div>
              <BaseButton
                v-if="!isCreatingTask"
                variant="secondary"
                size="sm"
                @click="duplicateTask"
              >
                fork
              </BaseButton>
            </div>
            <div class="detail-actions">
              <BaseButton variant="ghost" size="sm" @click="closeTaskDetail">关闭</BaseButton>
              <BaseButton
                v-if="isCreatingTask"
                size="sm"
                :disabled="!canCreateTask"
                @click="createTaskFromDraft"
              >
                创建
              </BaseButton>
              <BaseButton
                v-else
                size="sm"
                :disabled="!canSaveTask"
                @click="applyTaskChanges"
              >
                保存
              </BaseButton>
            </div>
          </div>

          <button class="task-meta-toggle" @click="metaExpanded = !metaExpanded">
            <div class="task-meta-summary">
              <span class="task-meta-label">任务编号</span>
              <code class="task-meta-chip">{{ activeEditorTask.id }}</code>
            </div>
            <svg
              class="task-meta-caret"
              :class="{ expanded: metaExpanded }"
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>

          <div v-if="metaExpanded" class="task-meta-panel">
            <div class="task-meta-row">
              <span>创建日期</span>
              <span>{{ activeEditorTask.metadata?.created || '-' }}</span>
            </div>
            <div class="task-meta-row">
              <span>更新日期</span>
              <span>{{ activeEditorTask.metadata?.updated || '-' }}</span>
            </div>
          </div>

          <div class="detail-grid">
            <label class="field field-span-2">
              <span>任务标题</span>
              <input
                :value="activeEditorTask.title"
                class="field-input"
                placeholder="输入任务标题"
                @input="updateTaskTitle($event.target.value)"
              />
            </label>

            <label class="field">
              <span>状态</span>
              <AppSelect
                :model-value="activeEditorTask.metadata?.status || 'pending'"
                :options="taskStatusOptions"
                full-width
                @update:model-value="updateMetadata('status', $event)"
              />
            </label>

            <label class="field">
              <span>优先级</span>
              <AppSelect
                :model-value="activeEditorTask.metadata?.priority || 'medium'"
                :options="taskPriorityOptions"
                full-width
                @update:model-value="updateMetadata('priority', $event)"
              />
            </label>

            <label class="field field-span-2">
              <span>运行模板</span>
              <div class="field-inline">
                <AppSelect
                  :model-value="activeEditorTask.metadata?.['run-template'] || ''"
                  :options="runTemplateOptions"
                  full-width
                  @update:model-value="updateMetadata('run-template', $event)"
                />
                <BaseButton variant="secondary" size="sm" @click="openRunTemplateManager">模板管理</BaseButton>
              </div>
            </label>

            <label class="field field-span-2">
              <span>设计文档</span>
              <div class="field-inline">
                  <AppSelect
                    :model-value="activeEditorTask.metadata?.['design-doc'] || ''"
                    :options="[{ value: '', label: '未选择' }, ...designDocOptions]"
                    full-width
                    @update:model-value="updateMetadata('design-doc', $event)"
                  />
                  <BaseButton
                    variant="secondary"
                    size="sm"
                    :disabled="!activeEditorTask.metadata?.['design-doc']"
                    @click="openDesignDoc"
                  >
                  打开
                </BaseButton>
              </div>
            </label>

            <div class="field field-span-2">
              <span>依赖任务</span>
              <AppMultiSelect
                :model-value="getTaskDependsOn(activeEditorTask)"
                :options="dependencyOptions"
                placeholder="选择依赖任务"
                full-width
                @update:model-value="updateTaskDependencies"
              />
            </div>
          </div>

          <label class="field field-block">
            <span>描述</span>
            <textarea
              class="field-textarea"
              :value="activeEditorTask.sections?.描述 || ''"
              placeholder="补充任务描述。"
              @input="updateSection('描述', $event.target.value)"
            ></textarea>
          </label>

          <div class="detail-primary-actions">
            <BaseButton
              v-if="!isCreatingTask"
              variant="danger"
              size="sm"
              @click="removeTask"
            >
              删除
            </BaseButton>
          </div>
        </div>
      </section>
      </div>
      </aside>
    </div>

    <Teleport to="body">
      <div v-if="routineEditorDraft" class="routine-editor-overlay" @click.self="closeRoutineTaskEditor">
        <div class="routine-editor-dialog" @click.stop>
          <div class="routine-editor-header">
            <h3>{{ routineEditorMode === 'run' ? '运行常规任务' : '编辑常规任务' }}</h3>
            <button class="routine-editor-close" type="button" title="关闭" @click="closeRoutineTaskEditor">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>

          <div class="routine-editor-body">
            <label class="field field-block">
              <span>名称</span>
              <input v-model="routineEditorDraft.title" class="field-input" placeholder="输入任务名称" />
            </label>

            <label class="field field-block">
              <span>任务内容</span>
              <textarea
                v-model="routineEditorDraft.content"
                class="field-textarea"
                placeholder="输入任务内容"
              ></textarea>
            </label>

            <template v-if="routineEditorMode === 'run'">
              <label class="field field-block">
                <span>运行模板</span>
                <AppSelect
                  v-model="routineEditorDraft.runTemplateId"
                  :options="runTemplateOptions"
                  full-width
                />
              </label>

              <label v-if="selectedRunTemplate" class="field field-block">
                <span>替换预览</span>
                <textarea
                  class="field-textarea routine-preview-textarea"
                  :value="renderedRunTemplatePreview"
                  readonly
                ></textarea>
              </label>
            </template>
          </div>

          <div class="routine-editor-actions">
            <BaseButton variant="ghost" size="sm" @click="closeRoutineTaskEditor">取消</BaseButton>
            <BaseButton v-if="routineEditorMode !== 'run'" size="sm" :disabled="!canSaveRoutineTemplate" @click="saveRoutineTaskTemplate">保存模板</BaseButton>
            <BaseButton v-else size="sm" :disabled="!canRunRoutineTask" @click="runRoutineTask">运行</BaseButton>
          </div>
        </div>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.task-workspace {
  height: 100%;
  display: flex;
  flex-direction: column;
  background:
    radial-gradient(circle at top right, rgba(249, 115, 22, 0.12), transparent 26%),
    linear-gradient(180deg, #111319 0%, #0d1016 100%);
  color: #e4e4e7;
}

.task-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 20px 24px 18px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  -webkit-app-region: drag;
}

.task-topbar-left {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  min-width: 0;
}

.task-topbar-left h1 {
  margin: 0;
  font-size: 28px;
  line-height: 1.1;
}

.task-topbar-left p {
  margin: 6px 0 0;
  color: #a1a1aa;
  font-size: 13px;
}

.sidebar-safe-btn {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: #d4d4d8;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.task-topbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
}

.task-topbar-action-item {
  -webkit-app-region: no-drag;
}

.task-banner {
  margin: 16px 24px 0;
  padding: 10px 14px;
  border-radius: 12px;
  background: rgba(34, 197, 94, 0.12);
  border: 1px solid rgba(34, 197, 94, 0.24);
  color: #bbf7d0;
}

.task-banner.error {
  background: rgba(239, 68, 68, 0.12);
  border-color: rgba(239, 68, 68, 0.24);
  color: #fecaca;
}

.task-shell {
  flex: 1;
  min-height: 0;
  display: flex;
  gap: 20px;
  padding: 20px 24px 24px;
  overflow: hidden;
}

.task-shell.task-shell-board {
  display: flex;
}

.task-list-pane {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.task-filters {
  padding: 18px;
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.filter-row {
  min-width: 0;
}

.filter-row :deep(.app-select) {
  min-width: 0;
}

.task-filters :deep(.app-select-trigger),
.task-filters :deep(.base-input-wrapper) {
  height: 40px;
}

.task-filters :deep(.base-input) {
  height: 100%;
  line-height: 40px;
  padding-top: 0;
  padding-bottom: 0;
}

.task-filter-refresh {
  justify-self: end;
}

.filter-row select,
.field-input,
.field-readonly,
.field-textarea {
  width: 100%;
  border-radius: 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: #f4f4f5;
  padding: 10px 12px;
  outline: none;
}

.field-readonly {
  min-height: 42px;
  display: flex;
  align-items: center;
  color: #a1a1aa;
  user-select: text;
  word-break: break-all;
}

.task-board,
.task-detail-scroll {
  min-height: 0;
  overflow: auto;
}

.task-board-card-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.task-board-card-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 6px;
}

.task-board-run-icon {
  width: 22px;
  height: 22px;
  padding: 0;
  border: none;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(255, 255, 255, 0.04);
  color: #a1a1aa;
  cursor: pointer;
  flex-shrink: 0;
}

.task-board-run-icon:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #f4f4f5;
}

.task-board-card-desc {
  margin: 2px 0 12px;
  color: #8b8b95;
  font-size: 12px;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.task-design-flag {
  color: #fdba74;
  font-weight: 600;
}

.task-board {
  flex: 1 1 auto;
  height: 100%;
  min-width: 1000px;
  padding: 16px;
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  align-items: stretch;
  gap: 12px;
  min-height: 0;
  overflow: visible;
}

.task-board-stage {
  position: relative;
  display: flex;
  flex: 1 1 auto;
  min-width: 0;
  min-height: 0;
  overflow-x: auto;
  overflow-y: hidden;
}

.task-board-column {
  min-height: 0;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.05);
}

.task-board-column-routine {
  background: rgba(255, 255, 255, 0.015);
  border-color: rgba(255, 255, 255, 0.06);
}

.task-board-card {
  background: rgba(255, 255, 255, 0.018);
  border-color: rgba(255, 255, 255, 0.06);
}

.task-board-card.card-hoverable:hover {
  border-color: rgba(255, 255, 255, 0.1);
}

.task-board-card.card-selected {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.12);
}

.task-board-card-routine {
  background: rgba(255, 255, 255, 0.02);
  border-color: rgba(255, 255, 255, 0.06);
}

.task-board-card-routine.task-board-card-routine-project {
  background: rgba(255, 255, 255, 0.03);
  border-color: rgba(255, 255, 255, 0.08);
}

.task-board-column-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 12px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  color: #e5e7eb;
  font-weight: 600;
}

.task-board-column-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.task-board-column-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-board-template-entry {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 7px;
  background: transparent;
  color: #a1a1aa;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}

.task-board-template-entry:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #f4f4f5;
}

.task-board-column-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.task-board-routine-filter {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #8b8b95;
  flex: 0 0 auto;
  padding-right: 2px;
}

.task-board-routine-filter-select {
  position: absolute;
  inset: 0;
  width: 52px;
  min-width: 52px;
  max-width: 52px;
}

.task-board-routine-filter-select :deep(.app-select-trigger) {
  opacity: 0;
  min-width: 0;
  width: 52px;
  height: 100%;
  padding: 0;
}

.task-board-routine-filter-select :deep(.app-select) {
  min-width: 0;
  width: 52px;
}


.task-board-routine-filter-icon {
  flex-shrink: 0;
}

.task-routine-filter-chip {
  color: #8b8b95;
  font-size: 11px;
  font-weight: 500;
}

.task-board-add-btn {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 999px;
  background: rgba(249, 115, 22, 0.18);
  color: #fdba74;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
}

.task-board-add-btn:hover {
  background: rgba(249, 115, 22, 0.28);
  color: #fff7ed;
}

.task-board-column-body {
  flex: 1 1 auto;
  min-height: 0;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  overflow: auto;
}

.task-board-card-id {
  font-size: 12px;
  color: #a1a1aa;
}

.task-board-card-id-subtle {
  font-size: 11px;
  color: #71717a;
  line-height: 1;
}

.task-board-card-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.task-board-card-title {
  margin: 0;
  font-weight: 600;
  line-height: 1.4;
  flex: 1 1 auto;
  min-width: 0;
}

.task-board-card-action {
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.04);
  color: #a1a1aa;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition: background 0.16s ease, color 0.16s ease, opacity 0.16s ease;
}

.task-board-card:hover .task-board-card-action,
.task-board-card.card-selected .task-board-card-action {
  opacity: 1;
}

.task-board-card-action:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #f4f4f5;
}

.task-board-card-action.is-play {
  background: rgba(245, 158, 11, 0.12);
  color: #fbbf24;
}

.task-board-card-action.is-play:hover {
  background: rgba(245, 158, 11, 0.18);
  color: #fde68a;
}

.task-board-card-action.is-stop {
  background: rgba(239, 68, 68, 0.12);
  color: #f87171;
}

.task-board-card-action.is-stop:hover {
  background: rgba(239, 68, 68, 0.18);
  color: #fecaca;
}

.task-board-card-action.is-archive {
  background: rgba(255, 255, 255, 0.04);
  color: #a1a1aa;
}

.task-board-card-action.is-archive:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #f4f4f5;
}

.task-board-card-action.is-retry {
  background: rgba(245, 158, 11, 0.12);
  color: #fbbf24;
}

.task-board-card-action.is-retry:hover {
  background: rgba(245, 158, 11, 0.18);
  color: #fde68a;
}

.task-board-card:not(.task-board-card-routine) .task-board-card-desc {
  margin: 0 0 12px;
}

.task-board-card-meta-line {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: #8b8b95;
  font-size: 11px;
  line-height: 1.5;
  margin-top: 6px;
}

.task-board-card-meta-label {
  flex: 0 0 auto;
  color: #71717a;
}

.task-board-card-meta-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.task-board-card-footer {
  margin-top: 10px;
}

.task-detail-pane {
  min-height: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 18px;
  background: rgba(17, 19, 25, 0.92);
  backdrop-filter: blur(12px);
  box-shadow: 0 24px 54px rgba(0, 0, 0, 0.42);
}

.task-detail-pane-floating {
  position: absolute;
  top: 16px;
  bottom: 16px;
  width: min(392px, calc(100% - 32px));
  z-index: 5;
}

.task-detail-pane-floating.is-right {
  right: 16px;
  animation: taskDetailSlideInRight 0.18s ease;
}

.task-detail-pane-floating.is-left {
  left: 16px;
  animation: taskDetailSlideInLeft 0.18s ease;
}

.task-detail-scroll {
  flex: 1 1 auto;
  padding: 24px;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-gutter: stable;
}

.detail-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  margin-bottom: 20px;
}

.detail-heading {
  display: flex;
  align-items: center;
  gap: 10px;
}

.detail-eyebrow {
  color: #fb923c;
  font-size: 12px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.detail-actions {
  display: flex;
  gap: 8px;
}

.detail-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
}

.task-meta-toggle {
  width: 100%;
  margin-bottom: 18px;
  padding: 0;
  border: none;
  background: transparent;
  color: #e4e4e7;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  cursor: pointer;
}

.task-meta-summary {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1 1 auto;
}

.task-meta-label {
  color: #8b8b95;
  font-size: 11px;
}

.task-meta-chip {
  padding: 0;
  background: transparent;
  color: #d4d4d8;
  font-size: 11px;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-meta-caret {
  flex-shrink: 0;
  color: #a1a1aa;
  transition: transform 0.15s ease;
}

.task-meta-caret.expanded {
  transform: rotate(180deg);
}

.task-meta-panel {
  margin: -6px 0 18px;
  padding: 0;
}

.task-meta-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 4px 0;
  color: #d4d4d8;
  font-size: 12px;
}

.task-meta-row span:first-child {
  color: #8b8b95;
}

.task-meta-row code {
  color: #e4e4e7;
  word-break: break-all;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 8px;
  color: #d4d4d8;
  font-size: 13px;
}

.field-span-2,
.field-block {
  grid-column: 1 / -1;
}

.detail-grid + .field-block {
  margin-top: 8px;
}

.field-inline {
  display: flex;
  align-items: stretch;
  gap: 10px;
}

.field-inline :deep(.app-select) {
  flex: 1 1 auto;
  min-width: 0;
}

.field-inline .field-input,
.field-inline textarea {
  flex: 1;
}

.field-textarea {
  min-height: 140px;
  resize: vertical;
  font: inherit;
  line-height: 1.5;
}

.field-textarea-sm {
  min-height: 96px;
}

.detail-primary-actions {
  margin-top: 18px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.task-empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
}

.empty-card {
  max-width: 520px;
  text-align: center;
}

.routine-editor-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.42);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1200;
}

.routine-editor-dialog {
  width: min(640px, calc(100vw - 32px));
  background: linear-gradient(180deg, #1b1e23 0%, #17191d 100%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.46);
  overflow: hidden;
}

.routine-editor-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 18px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.routine-editor-header h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: #f4f4f5;
}

.routine-editor-close {
  background: transparent;
  border: none;
  color: #9ca3af;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.routine-editor-close:hover {
  color: #f4f4f5;
  background: #3f3f46;
}

.routine-editor-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.routine-editor-actions {
  padding: 0 20px 20px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.empty-card-muted {
  width: min(520px, 100%);
  padding: 28px 24px;
  border-radius: 16px;
  border: 1px dashed rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.02);
}

.empty-kicker {
  margin-bottom: 10px;
  color: #71717a;
  font-size: 11px;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.empty-card-muted h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: #e4e4e7;
}

.empty-card-muted p {
  margin: 10px 0 0;
  color: #a1a1aa;
  font-size: 13px;
  line-height: 1.6;
}

.empty-actions {
  margin-top: 18px;
  display: flex;
  justify-content: center;
}

.empty-card h2,
.task-detail-empty h3 {
  margin-top: 0;
}

@keyframes taskDetailSlideInRight {
  from {
    opacity: 0;
    transform: translateX(18px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes taskDetailSlideInLeft {
  from {
    opacity: 0;
    transform: translateX(-18px);
  }

  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@media (max-width: 760px) {
  .task-topbar {
    flex-direction: column;
    align-items: stretch;
  }

  .task-topbar-actions {
    flex-wrap: wrap;
  }

  .task-filters {
    grid-template-columns: 1fr;
  }

  .filter-row,
  .detail-grid {
    grid-template-columns: 1fr;
  }
}
</style>
