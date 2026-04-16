const fs = require('fs')
const os = require('os')
const path = require('path')
const { decodeProjectPath, encodeProjectPath } = require('../../project-paths')
const logger = require('../../logger')

function getClaudeProjectsDir() {
  return path.join(os.homedir(), '.claude', 'projects')
}

function hasNonAsciiPath(projectPath) {
  return /[^\x00-\x7F]/.test(String(projectPath || ''))
}

function getSanitizedClaudeProjectId(projectPath) {
  if (!projectPath) {
    return null
  }
  return encodeProjectPath(projectPath).replace(/[^A-Za-z0-9._-]/g, '-')
}

function resolveClaudeProjectPaths(projectId) {
  const projectPath = decodeProjectPath(projectId)
  const sourceProjectDir = path.join(getClaudeProjectsDir(), projectId)
  const sanitizedProjectId = hasNonAsciiPath(projectPath)
    ? getSanitizedClaudeProjectId(projectPath)
    : projectId
  const sanitizedProjectDir = path.join(getClaudeProjectsDir(), sanitizedProjectId)

  return {
    projectPath,
    sourceProjectDir,
    sanitizedProjectId,
    sanitizedProjectDir
  }
}

function resolveSessionFilePath(projectId, sessionId) {
  const { sourceProjectDir, sanitizedProjectDir } = resolveClaudeProjectPaths(projectId)
  const sourceFile = path.join(sourceProjectDir, `${sessionId}.jsonl`)
  const sanitizedFile = path.join(sanitizedProjectDir, `${sessionId}.jsonl`)

  if (fs.existsSync(sourceFile)) {
    return sourceFile
  }
  if (sanitizedFile !== sourceFile && fs.existsSync(sanitizedFile)) {
    return sanitizedFile
  }
  return sourceFile
}

function sanitizeDirName(name) {
  return String(name || '').replace(/[^A-Za-z0-9]/g, '-')
}

function scanClaudeProjects() {
  const projectsDir = getClaudeProjectsDir()

  if (!fs.existsSync(projectsDir)) {
    logger.info('[Projects] Claude projects directory does not exist:', projectsDir)
    return []
  }

  const dirEntries = fs.readdirSync(projectsDir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())

  // 识别 Claude 因非 ASCII 路径创建的 sanitized 别名目录
  const sanitizedAliases = new Set()
  for (const entry of dirEntries) {
    if (/[^\x00-\x7F]/.test(entry.name)) {
      sanitizedAliases.add(sanitizeDirName(entry.name))
    }
  }

  // 从 CCGUI 项目配置中获取 id → path 映射，不使用 decodeProjectPath
  const ccguiPathMap = new Map()
  try {
    const ccguiProjectsDir = path.join(os.homedir(), '.ccgui', 'projects')
    if (fs.existsSync(ccguiProjectsDir)) {
      for (const dir of fs.readdirSync(ccguiProjectsDir, { withFileTypes: true })) {
        if (!dir.isDirectory()) continue
        const configPath = path.join(ccguiProjectsDir, dir.name, 'project.json')
        try {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'))
          if (config.path) {
            ccguiPathMap.set(dir.name, config.path)
          }
        } catch { /* ignore broken config */ }
      }
    }
  } catch { /* ignore */ }

  const projects = []
  const seenPaths = new Set()

  for (const entry of dirEntries) {
    if (sanitizedAliases.has(entry.name)) continue

    const projectPath = ccguiPathMap.get(entry.name)
    if (!projectPath) continue
    if (seenPaths.has(projectPath)) continue
    seenPaths.add(projectPath)

    const fullProjectDir = path.join(projectsDir, entry.name)
    const files = fs.readdirSync(fullProjectDir)
    const sessionFiles = files.filter((file) => {
      if (!file.endsWith('.jsonl')) {
        return false
      }

      const filePath = path.join(fullProjectDir, file)
      let lstat
      try {
        lstat = fs.lstatSync(filePath)
      } catch {
        return false
      }

      if (lstat.isDirectory()) {
        return false
      }

      try {
        return !fs.statSync(filePath).isDirectory()
      } catch {
        return false
      }
    })

    let lastActiveAt = null
    try {
      const stats = fs.statSync(fullProjectDir)
      lastActiveAt = stats.mtime.toISOString()
    } catch (error) {
      // Ignore stat errors.
    }

    projects.push({
      id: entry.name,
      name: path.basename(projectPath),
      path: projectPath,
      sessionCount: sessionFiles.length,
      lastActiveAt,
      settings: {},
      sourceFlags: {
        ccgui: false,
        claude: true,
        codex: false
      }
    })
  }

  projects.sort((a, b) => {
    if (!a.lastActiveAt) return 1
    if (!b.lastActiveAt) return -1
    return new Date(b.lastActiveAt) - new Date(a.lastActiveAt)
  })

  return projects
}

function listClaudeSessions({ projectId }) {
  const { sourceProjectDir: projectDir } = resolveClaudeProjectPaths(projectId)
  const sessions = []

  if (!fs.existsSync(projectDir)) {
    return sessions
  }

  const files = fs.readdirSync(projectDir)
  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue

    const filePath = path.join(projectDir, file)
    let lstat
    try {
      lstat = fs.lstatSync(filePath)
    } catch {
      continue
    }
    if (lstat.isDirectory()) {
      continue
    }
    let stat
    try {
      stat = fs.statSync(filePath)
    } catch {
      continue
    }
    const sessionId = file.replace('.jsonl', '')
    let preview = ''
    let messageCount = 0

    try {
      if (stat.size > 0) {
        const content = fs.readFileSync(filePath, 'utf-8')
        const lines = content.trim().split('\n')
        messageCount = lines.length

        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const data = JSON.parse(line)
            if (data.type !== 'user' || !data.message?.content) continue

            const messageContent = data.message.content
            if (Array.isArray(messageContent)) {
              const textContent = messageContent.find(item => item.type === 'text')
              if (textContent?.text) {
                preview = textContent.text.slice(0, 100)
                break
              }
            } else if (typeof messageContent === 'string') {
              preview = messageContent.slice(0, 100)
              break
            }
          } catch (error) {
            // Skip invalid JSON lines.
          }
        }
      }
    } catch (error) {
      logger.warn('[Sessions] Error reading Claude session file:', error.message)
    }

    sessions.push({
      id: sessionId,
      name: '会话',
      preview,
      messageCount,
      createdAt: stat.birthtime.toISOString(),
      updatedAt: stat.mtime.toISOString(),
      settings: {
        provider: 'claude',
        toolBinding: {
          tool: 'claude',
          nativeSessionId: sessionId
        }
      }
    })
  }

  return sessions
}

function createClaudeSession({ projectId, sessionId }) {
  const { sourceProjectDir: projectDir } = resolveClaudeProjectPaths(projectId)
  fs.mkdirSync(projectDir, { recursive: true })
  const sessionFile = path.join(projectDir, `${sessionId}.jsonl`)
  if (!fs.existsSync(sessionFile)) {
    fs.writeFileSync(sessionFile, '', 'utf-8')
  }
  return {
    nativeSessionId: sessionId
  }
}

function extractClaudeTextContent(content) {
  if (typeof content === 'string') {
    return content
  }

  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .filter(item => item?.type === 'text' && typeof item.text === 'string')
    .map(item => item.text)
    .join('')
}

function extractClaudeThinkingContent(content) {
  if (!Array.isArray(content)) {
    return ''
  }

  return content
    .filter(item => item?.type === 'thinking' && typeof item.thinking === 'string')
    .map(item => item.thinking)
    .join('')
}

function convertClaudeHistoryEntry(entry, index) {
  const timestampValue = entry?.timestamp || entry?.created_at || entry?.createdAt || Date.now()
  const timestamp = new Date(timestampValue)
  const id = entry?.uuid || entry?.message?.id || `${entry?.type || 'message'}-${index}`

  if (entry?.type === 'user') {
    const content = extractClaudeTextContent(entry?.message?.content)
    if (!content) return null
    return {
      id,
      role: 'user',
      content,
      timestamp,
      rawMessage: entry
    }
  }

  if (entry?.type === 'assistant') {
    const content = extractClaudeTextContent(entry?.message?.content)
    const thinking = extractClaudeThinkingContent(entry?.message?.content)
    if (!content && !thinking) return null
    return {
      id,
      role: 'assistant',
      content,
      thinking,
      timestamp,
      rawMessage: entry
    }
  }

  return null
}

function loadClaudeSessionHistory({ projectId, sessionId, session }) {
  const nativeSessionId = session?.settings?.toolBinding?.nativeSessionId || sessionId
  const sessionFile = resolveSessionFilePath(projectId, nativeSessionId)
  if (!fs.existsSync(sessionFile)) {
    return []
  }

  try {
    const content = fs.readFileSync(sessionFile, 'utf-8')
    const lines = content.split('\n').filter(line => line.trim())
    const messages = []

    for (const [index, line] of lines.entries()) {
      try {
        const entry = JSON.parse(line)
        const message = convertClaudeHistoryEntry(entry, index)
        if (message) {
          messages.push(message)
        }
      } catch (error) {
        logger.warn('[Sessions] Failed to parse Claude history line', {
          projectId,
          sessionId,
          index,
          error: error.message
        })
      }
    }

    return messages
  } catch (error) {
    logger.warn('[Sessions] Failed to load Claude session history', {
      projectId,
      sessionId,
      error: error.message
    })
    return []
  }
}

function deleteClaudeSession({ projectId, sessionId }) {
  const { sourceProjectDir, sanitizedProjectDir } = resolveClaudeProjectPaths(projectId)
  const pathsToDelete = [
    path.join(sourceProjectDir, `${sessionId}.jsonl`),
    path.join(sourceProjectDir, sessionId),
    path.join(sanitizedProjectDir, `${sessionId}.jsonl`),
    path.join(sanitizedProjectDir, sessionId)
  ]

  for (const targetPath of new Set(pathsToDelete)) {
    let lstat = null
    try {
      lstat = fs.lstatSync(targetPath)
    } catch {
      continue
    }

    if (lstat.isSymbolicLink()) {
      try {
        const realTarget = fs.realpathSync(targetPath)
        if (fs.existsSync(realTarget)) {
          fs.rmSync(realTarget, { recursive: true, force: true })
        }
      } catch {
        // Ignore broken target cleanup failure.
      }
      fs.unlinkSync(targetPath)
      continue
    }

    fs.rmSync(targetPath, { recursive: true, force: true })
  }

  logger.info('[Sessions] Deleted Claude session artifacts', { sessionId, projectId })
}

function deleteClaudeProject({ projectId }) {
  const { sourceProjectDir, sanitizedProjectDir } = resolveClaudeProjectPaths(projectId)
  const targets = new Set([sourceProjectDir, sanitizedProjectDir])

  for (const projectDir of targets) {
    if (!fs.existsSync(projectDir)) {
      continue
    }
    fs.rmSync(projectDir, { recursive: true, force: true })
  }

  logger.info('[Projects] Removed Claude project data', { projectId })
}

const claudeSessionSource = {
  provider: 'claude',
  scanProjects: scanClaudeProjects,
  listProjectSessions: listClaudeSessions,
  createSession: createClaudeSession,
  loadSessionHistory: loadClaudeSessionHistory,
  deleteSession: deleteClaudeSession,
  deleteProject: deleteClaudeProject
}

module.exports = {
  getClaudeProjectsDir,
  claudeSessionSource
}
