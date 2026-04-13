function createTimestamp() {
  return new Date().toISOString()
}

export const DEFAULT_APP_RUN_TEMPLATE_ID = 'app-default-run-template'
export const DEFAULT_APP_RUN_TEMPLATE = {
  id: DEFAULT_APP_RUN_TEMPLATE_ID,
  title: '默认运行模板',
  content: '请完成一下task.md中任务标号为{{task_id}}的任务, 如果{{task_document}}文档存在就按照文档设计的去实施, 完成之后请启动一个独立的subagent进行验收, 如果验收不通过则继续修改,直到验收通过位置. subanget的提示词可以是这样的"请验收一下task.md中任务标号为{{task_id}}的任务是否已经完成, 没有功能的遗漏和代码的错漏, 如果有问题请全部指出来".',
  builtIn: true,
  locked: true
}

function createTemplateId(prefix = 'template') {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  return `${prefix}-${Math.random().toString(16).slice(2, 10)}-${Date.now().toString(16)}`
}

function normalizeTemplateItem(item = {}) {
  const title = String(item?.title || item?.name || '').trim()
  const content = String(item?.content || item?.summary || '').trim()
  const createdAt = String(item?.createdAt || '').trim() || createTimestamp()
  const updatedAt = String(item?.updatedAt || '').trim() || createdAt

  return {
    id: String(item?.id || createTemplateId()).trim() || createTemplateId(),
    title,
    content,
    createdAt,
    updatedAt,
    builtIn: Boolean(item?.builtIn),
    locked: Boolean(item?.locked)
  }
}

function ensureDefaultAppRunTemplates(collection = {}) {
  const normalized = normalizeTaskTemplateCollection(collection)
  const hasDefaultTemplate = normalized.run.some(item => item.id === DEFAULT_APP_RUN_TEMPLATE_ID)

  if (!hasDefaultTemplate) {
    normalized.run = [
      normalizeTemplateItem(DEFAULT_APP_RUN_TEMPLATE),
      ...normalized.run
    ]
  }

  return normalized
}

function hasDefaultAppRunTemplate(collection = {}) {
  return normalizeTaskTemplateCollection(collection).run.some(item => item.id === DEFAULT_APP_RUN_TEMPLATE_ID)
}

export function createEmptyTaskTemplateCollection() {
  return {
    routine: [],
    run: []
  }
}

export function normalizeTaskTemplateCollection(collection = {}) {
  const normalized = createEmptyTaskTemplateCollection()

  for (const key of ['routine', 'run']) {
    const source = Array.isArray(collection?.[key]) ? collection[key] : []
    normalized[key] = source.map(item => normalizeTemplateItem(item))
  }

  return normalized
}

function readLegacyTemplateCollection(settings = {}) {
  return normalizeTaskTemplateCollection(settings?.taskTemplates)
}

function readNamedTemplateCollection(settings = {}) {
  return normalizeTaskTemplateCollection({
    routine: settings?.taskLibrary?.routines,
    run: settings?.taskRunTemplates?.items
  })
}

function extractTemplateCollection(settings = {}) {
  const namedCollection = readNamedTemplateCollection(settings)
  const legacyCollection = readLegacyTemplateCollection(settings)

  return {
    routine: namedCollection.routine.length ? namedCollection.routine : legacyCollection.routine,
    run: namedCollection.run.length ? namedCollection.run : legacyCollection.run
  }
}

async function saveAppTaskTemplates(collection) {
  const normalized = ensureDefaultAppRunTemplates(collection)
  const result = await window.electronAPI.updateAppConfig({
    updates: {
      settings: {
        taskLibrary: {
          routines: normalized.routine
        },
        taskRunTemplates: {
          items: normalized.run
        }
      }
    }
  })

  if (!result?.success) {
    throw new Error(result?.error || '保存应用任务模板失败')
  }

  return normalized
}

async function saveProjectTaskTemplates(projectId, collection) {
  if (!projectId) {
    throw new Error('缺少 projectId，无法保存项目任务模板')
  }

  const configResult = await window.electronAPI.getProjectConfig({ projectId })
  if (!configResult?.success) {
    throw new Error(configResult?.error || '读取项目配置失败')
  }

  const currentConfig = configResult.config || {}
  const normalized = normalizeTaskTemplateCollection(collection)

  const result = await window.electronAPI.updateProjectConfig({
    projectId,
    updates: {
      settings: {
        ...(currentConfig.settings || {}),
        taskLibrary: {
          routines: normalized.routine
        },
        taskRunTemplates: {
          items: normalized.run
        }
      }
    }
  })

  if (!result?.success) {
    throw new Error(result?.error || '保存项目任务模板失败')
  }

  return normalized
}

export async function loadTaskTemplates({ projectId = '' } = {}) {
  const [appResult, projectResult] = await Promise.all([
    window.electronAPI.getAppConfig(),
    projectId
      ? window.electronAPI.getProjectConfig({ projectId })
      : Promise.resolve({ success: true, config: null })
  ])

  if (!appResult?.success) {
    throw new Error(appResult?.error || '读取应用任务模板失败')
  }

  if (!projectResult?.success) {
    throw new Error(projectResult?.error || '读取项目任务模板失败')
  }

  const rawAppCollection = extractTemplateCollection(appResult.config?.settings)
  const appCollection = ensureDefaultAppRunTemplates(rawAppCollection)
  if (!hasDefaultAppRunTemplate(rawAppCollection)) {
    await saveAppTaskTemplates(appCollection)
  }

  return {
    app: appCollection,
    project: extractTemplateCollection(projectResult.config?.settings)
  }
}

export async function saveTaskTemplates({ scope, projectId = '', collection }) {
  if (scope === 'project') {
    return saveProjectTaskTemplates(projectId, collection)
  }

  return saveAppTaskTemplates(collection)
}

export function createTaskTemplateDraft() {
  return {
    id: '',
    title: '',
    content: '',
    createdAt: '',
    updatedAt: ''
  }
}

export function emitTaskTemplatesUpdated(detail = {}) {
  window.dispatchEvent(new CustomEvent('ccgui-task-templates-updated', { detail }))
}
