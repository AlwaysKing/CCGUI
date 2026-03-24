const fs = require('fs')
const os = require('os')
const path = require('path')
const { decodeProjectPath } = require('../../project-paths')
const logger = require('../../logger')

function getClaudeProjectsDir() {
  return path.join(os.homedir(), '.claude', 'projects')
}

function scanClaudeProjects() {
  const projectsDir = getClaudeProjectsDir()

  if (!fs.existsSync(projectsDir)) {
    logger.info('[Projects] Claude projects directory does not exist:', projectsDir)
    return []
  }

  const entries = fs.readdirSync(projectsDir, { withFileTypes: true })
  const projects = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue

    const projectPath = decodeProjectPath(entry.name)
    const fullProjectDir = path.join(projectsDir, entry.name)
    const files = fs.readdirSync(fullProjectDir)
    const sessionFiles = files.filter(file => file.endsWith('.jsonl') && !fs.statSync(path.join(fullProjectDir, file)).isDirectory())

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
  const projectsDir = getClaudeProjectsDir()
  const projectDir = path.join(projectsDir, projectId)
  const sessions = []

  if (!fs.existsSync(projectDir)) {
    return sessions
  }

  const files = fs.readdirSync(projectDir)
  for (const file of files) {
    if (!file.endsWith('.jsonl')) continue

    const filePath = path.join(projectDir, file)
    const stat = fs.statSync(filePath)
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
  const projectDir = path.join(getClaudeProjectsDir(), projectId)
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

function loadClaudeSessionHistory({ projectId, sessionId }) {
  const sessionFile = path.join(getClaudeProjectsDir(), projectId, `${sessionId}.jsonl`)
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
  const sessionFile = path.join(getClaudeProjectsDir(), projectId, `${sessionId}.jsonl`)
  if (!fs.existsSync(sessionFile)) {
    return
  }

  fs.unlinkSync(sessionFile)
  logger.info('[Sessions] Deleted Claude session file', { sessionId, projectId })
}

function deleteClaudeProject({ projectId }) {
  const projectDir = path.join(getClaudeProjectsDir(), projectId)
  if (!fs.existsSync(projectDir)) {
    return
  }

  fs.rmSync(projectDir, { recursive: true })
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
