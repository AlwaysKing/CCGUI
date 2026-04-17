function stripJsonComments(source) {
  let result = ''
  let inString = false
  let inLineComment = false
  let inBlockComment = false
  let stringQuote = ''
  let escaped = false

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    const nextChar = source[index + 1]

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false
        result += char
      }
      continue
    }

    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false
        index += 1
      }
      continue
    }

    if (inString) {
      result += char
      if (escaped) {
        escaped = false
        continue
      }
      if (char === '\\') {
        escaped = true
        continue
      }
      if (char === stringQuote) {
        inString = false
        stringQuote = ''
      }
      continue
    }

    if ((char === '"' || char === "'") && !inString) {
      inString = true
      stringQuote = char
      result += char
      continue
    }

    if (char === '/' && nextChar === '/') {
      inLineComment = true
      index += 1
      continue
    }

    if (char === '/' && nextChar === '*') {
      inBlockComment = true
      index += 1
      continue
    }

    result += char
  }

  return result
}

export function parseTasksDocument(source) {
  if (!source || typeof source !== 'string') {
    return {
      version: '2.0.0',
      tasks: []
    }
  }

  const parsed = JSON.parse(stripJsonComments(source))
  return {
    ...parsed,
    version: parsed?.version || '2.0.0',
    tasks: Array.isArray(parsed?.tasks) ? parsed.tasks : []
  }
}

function getPlatformTaskOverrides(task) {
  if (!task || typeof task !== 'object') {
    return {}
  }

  const platformKey = window.electronAPI.platform === 'darwin'
    ? 'osx'
    : (window.electronAPI.platform === 'win32' ? 'windows' : 'linux')

  const override = task[platformKey]
  return override && typeof override === 'object' ? override : {}
}

function applyTaskOverrides(task) {
  if (!task || typeof task !== 'object') {
    return {}
  }

  return {
    ...task,
    ...getPlatformTaskOverrides(task)
  }
}

function replaceVariables(value, projectPath) {
  if (typeof value !== 'string') {
    return value
  }

  const workspaceFolder = String(projectPath || '')
  const workspaceFolderBasename = workspaceFolder
    ? workspaceFolder.replace(/\/$/, '').split('/').pop() || ''
    : ''

  return value
    .replaceAll('${workspaceFolder}', workspaceFolder)
    .replaceAll('${workspaceFolderBasename}', workspaceFolderBasename)
}

function quoteShellArg(value) {
  const text = String(value ?? '')
  if (!text) {
    return "''"
  }
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) {
    return text
  }
  return `'${text.replaceAll("'", `'\"'\"'`)}'`
}

function resolveTaskCwd(task, projectPath) {
  const rawCwd = replaceVariables(task?.options?.cwd || '', projectPath).trim()
  if (!rawCwd) {
    return String(projectPath || '')
  }
  if (rawCwd.startsWith('/')) {
    return rawCwd
  }
  return String(projectPath || '').replace(/\/$/, '') + '/' + rawCwd.replace(/^\.\//, '').replace(/^\//, '')
}

function toCommandLine(task, projectPath) {
  const rawCommand = replaceVariables(task?.command || '', projectPath).trim()
  const command = String(task?.type || 'shell').trim() === 'process'
    ? quoteShellArg(rawCommand)
    : rawCommand
  if (!command) {
    return ''
  }

  const args = Array.isArray(task?.args) ? task.args : []
  const resolvedArgs = args.map(arg => replaceVariables(String(arg), projectPath))

  if (resolvedArgs.length === 0) {
    return command
  }

  return `${command} ${resolvedArgs.map(quoteShellArg).join(' ')}`
}

function isSupportedTask(task) {
  const type = String(task?.type || 'shell').trim()
  const label = String(task?.label || '').trim()
  const hasEnv = task?.options?.env && typeof task.options.env === 'object' && Object.keys(task.options.env).length > 0
  const hasDependsOn = Array.isArray(task?.dependsOn)
    ? task.dependsOn.length > 0
    : Boolean(task?.dependsOn)
  const argsAreValid = !Array.isArray(task?.args) || task.args.every(arg => ['string', 'number', 'boolean'].includes(typeof arg))

  if (!label || !String(task?.command || '').trim()) {
    return false
  }

  if (!['shell', 'process'].includes(type)) {
    return false
  }

  if (hasEnv || hasDependsOn || !argsAreValid) {
    return false
  }

  return true
}

export function parseSupportedTasksJson(source, projectPath) {
  const parsed = parseTasksDocument(source)
  const tasks = Array.isArray(parsed?.tasks) ? parsed.tasks : []

  return tasks
    .map(task => applyTaskOverrides(task))
    .filter(isSupportedTask)
    .map((task, index) => ({
      id: `${String(task.label || 'task')}-${index}`,
      label: String(task.label || '').trim(),
      type: String(task.type || 'shell').trim(),
      command: String(task.command || '').trim(),
      commandLine: toCommandLine(task, projectPath),
      cwd: resolveTaskCwd(task, projectPath),
      detail: String(task.detail || '').trim()
    }))
    .filter(task => task.commandLine)
}

export function createSimpleTaskDefinition(task) {
  const label = String(task?.label || '').trim()
  const command = String(task?.command || '').trim()
  const cwd = String(task?.cwd || '').trim()

  const definition = {
    label,
    type: 'shell',
    command
  }

  if (cwd) {
    definition.options = {
      cwd
    }
  }

  return definition
}

export function serializeTasksDocument(document) {
  return `${JSON.stringify({
    version: document?.version || '2.0.0',
    tasks: Array.isArray(document?.tasks) ? document.tasks : []
  }, null, 2)}\n`
}
