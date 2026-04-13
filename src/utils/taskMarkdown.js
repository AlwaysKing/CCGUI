function normalizeLineEndings(value = '') {
  return String(value || '').replace(/\r\n/g, '\n')
}

function trimTrailingBlankLines(value = '') {
  return normalizeLineEndings(value).replace(/\n+$/g, '')
}

function trimSurroundingBlankLines(value = '') {
  return trimTrailingBlankLines(normalizeLineEndings(value).replace(/^\n+/g, ''))
}

function ensureTrailingNewline(value = '') {
  return `${trimTrailingBlankLines(value)}\n`
}

function parseMetadataLine(line = '') {
  const match = line.match(/^- \*\*([^*]+)\*\*:\s*(.*)$/)
  if (!match) {
    return null
  }

  return {
    key: String(match[1] || '').trim(),
    value: String(match[2] || '').trim()
  }
}

function normalizeTaskIdNumber(id = '') {
  const match = String(id || '').match(/(\d+)\s*$/)
  return match ? Number(match[1]) : null
}

function normalizeDesignDocName(value = '') {
  const raw = String(value || '').trim()
  if (!raw || raw === '-') {
    return ''
  }

  const normalized = raw.replace(/\\/g, '/')
  const name = normalized.split('/').filter(Boolean).pop() || ''
  return name || ''
}

function parseDependsOnValue(value = '') {
  const raw = String(value || '').trim()
  if (!raw || raw.toLowerCase() === 'null') {
    return []
  }

  return [...new Set(
    raw
      .split(/[,\n]/)
      .map(entry => String(entry || '').trim())
      .filter(Boolean)
  )]
}

function parseLegacyDependencySection(value = '') {
  const raw = String(value || '').trim()
  if (!raw || raw === '- 无') {
    return []
  }

  return [...new Set(
    raw
      .split('\n')
      .map(line => line.replace(/^[-*]\s*/, '').trim())
      .flatMap(line => line.split(','))
      .map(entry => String(entry || '').trim())
      .filter(Boolean)
  )]
}

function createTaskId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }

  const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
  return template.replace(/[xy]/g, char => {
    const random = Math.floor(Math.random() * 16)
    const value = char === 'x' ? random : ((random & 0x3) | 0x8)
    return value.toString(16)
  })
}

function splitTaskBlocks(content = '') {
  const normalized = normalizeLineEndings(content)
  const matches = [...normalized.matchAll(/^##\s+TaskID\s*$/gm)]
  if (!matches.length) {
    return []
  }

  return matches.map((match, index) => {
    const start = match.index || 0
    const end = index + 1 < matches.length ? (matches[index + 1].index || normalized.length) : normalized.length
    return trimTrailingBlankLines(normalized.slice(start, end))
  })
}

function parseTaskBlock(block = '') {
  const lines = normalizeLineEndings(block).split('\n')
  const header = lines[0] || ''
  if (!/^##\s+TaskID\s*$/.test(header)) {
    return null
  }

  let cursor = 1
  while (cursor < lines.length && !String(lines[cursor] || '').trim()) {
    cursor += 1
  }

  const id = String(lines[cursor] || '').trim()
  if (!id) {
    return null
  }

  cursor += 1
  const metadata = {}
  const sections = {}

  let activeSection = null
  let sectionLines = []

  function commitSection() {
    if (!activeSection) {
      return
    }
    const sectionContent = trimSurroundingBlankLines(sectionLines.join('\n'))
    if (activeSection === '属性') {
      const metadataLines = normalizeLineEndings(sectionContent)
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)

      for (const line of metadataLines) {
        const parsed = parseMetadataLine(line)
        if (parsed) {
          metadata[parsed.key] = parsed.value
        }
      }
    } else {
      sections[activeSection] = sectionContent
    }
    activeSection = null
    sectionLines = []
  }

  for (; cursor < lines.length; cursor += 1) {
    const line = lines[cursor]
    const sectionMatch = line.match(/^###\s+(.+)$/)
    if (sectionMatch) {
      commitSection()
      activeSection = String(sectionMatch[1] || '').trim()
      continue
    }

    if (line.trim() === '---' && cursor === lines.length - 1) {
      continue
    }

    if (activeSection) {
      sectionLines.push(line)
    }
  }

  commitSection()

  const designDocPath = metadata['design-doc']
    ? normalizeDesignDocName(metadata['design-doc'])
    : extractDesignDocPath(sections['设计文档'] || '')
  const dependsOn = metadata['depends-on']
    ? parseDependsOnValue(metadata['depends-on'])
    : parseLegacyDependencySection(sections['依赖'] || '')

  if (designDocPath) {
    metadata['design-doc'] = designDocPath
  }

  metadata['depends-on'] = dependsOn.join(', ')

  const title = String(sections['标题'] || '').trim()
  delete sections['标题']

  return {
    id,
    title,
    metadata,
    sections,
    designDocPath,
    dependsOn,
    order: normalizeTaskIdNumber(id)
  }
}

export function parseTaskMarkdown(content = '') {
  const normalized = normalizeLineEndings(content)
  const titleMatch = normalized.match(/^#\s+(.+)$/m)
  const projectTitle = titleMatch ? String(titleMatch[1] || '').trim() : '项目任务'
  const blocks = splitTaskBlocks(normalized)
  const tasks = blocks.map(parseTaskBlock).filter(Boolean)

  return {
    title: projectTitle,
    tasks
  }
}

function buildMetadataLines(metadata = {}, preferredOrder = []) {
  const usedKeys = new Set()
  const lines = []

  for (const key of preferredOrder) {
    if (!(key in metadata)) continue
    usedKeys.add(key)
    lines.push(`- **${key}**: ${metadata[key]}`)
  }

  for (const [key, value] of Object.entries(metadata)) {
    if (usedKeys.has(key)) continue
    lines.push(`- **${key}**: ${value}`)
  }

  return lines
}

function buildSection(title, content = '') {
  return `### ${title}\n\n${trimTrailingBlankLines(content)}`
}

function normalizeSectionContent(value = '', fallbackList = false) {
  const normalized = trimTrailingBlankLines(value)
  if (normalized) {
    return normalized
  }
  return fallbackList ? '- 无' : ''
}

export function serializeTaskMarkdown(model = {}) {
  const title = String(model.title || '项目任务').trim() || '项目任务'
  const tasks = Array.isArray(model.tasks) ? model.tasks : []

  const taskBlocks = tasks.map(task => {
    const designDocName = normalizeDesignDocName(task.metadata?.['design-doc'])

    const metadata = {
      status: task.metadata?.status || 'pending',
      priority: task.metadata?.priority || 'medium',
      'depends-on': Array.isArray(task.metadata?.['depends-on'])
        ? task.metadata['depends-on'].join(', ')
        : (task.metadata?.['depends-on'] || ''),
      session: task.metadata?.session || 'null',
      created: task.metadata?.created || '',
      updated: task.metadata?.updated || '',
      ...task.metadata
    }

    metadata['depends-on'] = parseDependsOnValue(metadata['depends-on']).join(', ')

    const metadataLines = buildMetadataLines(metadata, [
      'status',
      'priority',
      'depends-on',
      'session',
      'created',
      'updated',
      'run-template'
    ])

    const sections = []
    sections.push(buildSection('标题', normalizeSectionContent(task.title || '')))
    sections.push(buildSection('描述', normalizeSectionContent(task.sections?.描述 || '')))
    sections.push(buildSection(
      '设计文档',
      designDocName ? `plain/${designDocName}` : ''
    ))
    sections.push(buildSection('属性', metadataLines.join('\n')))

    for (const [sectionTitle, sectionContent] of Object.entries(task.sections || {})) {
      if (['标题', '属性', '描述', '设计文档', '验收标准', '依赖'].includes(sectionTitle)) {
        continue
      }
      sections.push(buildSection(sectionTitle, normalizeSectionContent(sectionContent)))
    }

    return [
      '## TaskID',
      '',
      String(task.id || '').trim(),
      '',
      sections.join('\n\n')
    ].join('\n')
  })

  const content = [`# ${title}`]
  if (taskBlocks.length > 0) {
    content.push('', taskBlocks.join('\n\n'))
  }

  return ensureTrailingNewline(content.join('\n'))
}

export function createEmptyTaskDocument() {
  return serializeTaskMarkdown({
    title: '项目任务',
    tasks: []
  })
}

export function createTaskDraft(tasks = []) {
  const maxOrder = tasks.reduce((maxValue, task) => {
    const order = Number.isFinite(task?.order) ? task.order : normalizeTaskIdNumber(task?.id)
    return Number.isFinite(order) && order > maxValue ? order : maxValue
  }, 0)
  const nextOrder = maxOrder + 1
  const today = new Date().toISOString().slice(0, 10)

  return {
    id: createTaskId(),
    title: '',
    metadata: {
      status: 'pending',
      priority: 'medium',
      'design-doc': '',
      'depends-on': '',
      session: 'null',
      created: today,
      updated: today
    },
    sections: {
      描述: ''
    },
    designDocPath: null,
    order: nextOrder
  }
}

export function extractDesignDocPath(sectionContent = '') {
  const content = String(sectionContent || '')
  const markdownLinkMatch = content.match(/\[[^\]]+\]\(([^)]+)\)/)
  if (markdownLinkMatch) {
    return normalizeDesignDocName(markdownLinkMatch[1])
  }

  const pathLine = content.split('\n').map(line => line.trim()).find(line => /^(plain\/|docs\/|design\/|.+\.md$)/i.test(line))
  return normalizeDesignDocName(pathLine || '')
}
