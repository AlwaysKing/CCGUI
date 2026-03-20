const fs = require('fs')
const path = require('path')
const logger = require('../logger')
const { encodeProjectPath, decodeProjectPath } = require('../project-paths')
const { providerSessionSources, providerSessionSourcesById } = require('../adapters/session-sources')
const {
  appConfigManager,
  historyManager,
  projectConfigManager,
  sessionConfigManager
} = require('../storage')
const { resolveSessionSettings } = require('../config-resolution')
const pendingHistoryImports = new Map()
const pendingHistoryRetries = new Map()
const HISTORY_RETRY_DELAY_MS = 5000

function buildScannedProjectDefaultSettings() {
  return {
    modelMode: 'system',
    modelId: null,
    modelCardId: null,
    promptMode: 'none',
    promptIds: [],
    documentMode: 'none',
    documentIds: []
  }
}

function buildScannedSessionDefaultSettings() {
  return {
    modelMode: 'system',
    modelId: null,
    modelCardId: null,
    promptMode: 'none',
    promptIds: [],
    documentMode: 'none',
    documentIds: []
  }
}

function ensureProjectConfig(project) {
  if (!project?.id || !project?.path) {
    return null
  }

  const existing = projectConfigManager.loadProjectConfig(project.id)
  if (existing) {
    return existing
  }

  const config = projectConfigManager.createProjectConfig(
    project.id,
    project.path,
    project.name || path.basename(project.path)
  )
  config.settings = buildScannedProjectDefaultSettings()
  projectConfigManager.saveProjectConfig(project.id, config)
  logger.info('[ProjectService] Created CCGUI project config for scanned provider project', {
    projectId: project.id,
    projectPath: project.path
  })
  return config
}

function ensureSessionConfig(projectId, providerSession) {
  if (!projectId || !providerSession?.id) {
    return null
  }

  const existing = sessionConfigManager.getSession(projectId, providerSession.id)
  const providerSettings = {
    ...buildScannedSessionDefaultSettings(),
    ...(providerSession.settings || {})
  }

  if (existing) {
    const mergedSettings = {
      ...providerSettings,
      ...(existing.settings || {})
    }

    const needsSettingsPatch = Object.keys(providerSettings).some(key => existing.settings?.[key] !== providerSettings[key])
    const needsNamePatch = !existing.name && providerSession.name

    if (needsSettingsPatch || needsNamePatch) {
      return {
        config: sessionConfigManager.updateSession(projectId, providerSession.id, {
          name: existing.name || providerSession.name || '会话',
          settings: mergedSettings
        }),
        created: false
      }
    }

    return {
      config: existing,
      created: false
    }
  }

  return {
    config: sessionConfigManager.updateSession(projectId, providerSession.id, {
      name: providerSession.name || '会话',
      settings: providerSettings
    }),
    created: true
  }
}

async function importProviderSessionHistory(projectId, providerSession) {
  const provider = providerSession?.settings?.provider
  if (!provider) {
    return
  }

  if (historyManager.historyExists(projectId, providerSession.id)) {
    return
  }

  const source = providerSessionSourcesById[provider]
  if (!source?.loadSessionHistory) {
    return
  }

  const messages = await Promise.resolve(source.loadSessionHistory({
    projectId,
    projectPath: decodeProjectPath(projectId),
    sessionId: providerSession.id,
    session: providerSession
  }))

  if (!Array.isArray(messages) || messages.length === 0) {
    return
  }

  historyManager.saveAllMessages(projectId, providerSession.id, messages)
  logger.info('[ProjectService] Imported provider session history into CCGUI', {
    projectId,
    sessionId: providerSession.id,
    provider,
    messageCount: messages.length
  })
}

function scheduleProviderSessionHistoryImport(projectId, providerSession) {
  const key = `${projectId}:${providerSession.id}`
  if (pendingHistoryImports.has(key)) {
    return pendingHistoryImports.get(key)
  }

  const existingRetryTimer = pendingHistoryRetries.get(key)
  if (existingRetryTimer) {
    clearTimeout(existingRetryTimer)
    pendingHistoryRetries.delete(key)
  }

  const task = importProviderSessionHistory(projectId, providerSession)
    .catch(error => {
      if (error?.retryable) {
        logger.info('[ProjectService] Provider session history not ready yet, will retry', {
          projectId,
          sessionId: providerSession.id,
          provider: providerSession?.settings?.provider || 'unknown',
          error: error.message
        })
        const retryTimer = setTimeout(() => {
          pendingHistoryRetries.delete(key)
          if (!historyManager.historyExists(projectId, providerSession.id)) {
            scheduleProviderSessionHistoryImport(projectId, providerSession)
          }
        }, HISTORY_RETRY_DELAY_MS)
        pendingHistoryRetries.set(key, retryTimer)
        return
      }

      logger.warn('[ProjectService] Provider session history import failed', {
        projectId,
        sessionId: providerSession.id,
        provider: providerSession?.settings?.provider || 'unknown',
        error: error.message
      })
    })
    .finally(() => {
      pendingHistoryImports.delete(key)
    })

  pendingHistoryImports.set(key, task)
  return task
}

function ensureProviderSessions(projectId, providerSessions) {
  for (const providerSession of providerSessions.values()) {
    const ensured = ensureSessionConfig(projectId, providerSession)
    if (ensured?.created || !historyManager.historyExists(projectId, providerSession.id)) {
      scheduleProviderSessionHistoryImport(projectId, providerSession)
    }
  }
}

function scanCCGUIProjects() {
  try {
    const projects = projectConfigManager.getAllProjects() || []
    return projects.map(project => ({
      id: project.id || encodeProjectPath(project.path),
      name: project.name || path.basename(project.path),
      path: project.path,
      sessionCount: project.sessionCount || 0,
      lastActiveAt: project.updatedAt || project.createdAt || null,
      settings: project.settings || {},
      sourceFlags: {
        ccgui: true,
        claude: false,
        codex: false
      }
    }))
  } catch (error) {
    logger.warn('[ProjectService] Failed to scan CCGUI projects', { error: error.message })
    return []
  }
}

function pickLatestTimestamp(a, b) {
  if (!a) return b || null
  if (!b) return a || null
  return new Date(a) >= new Date(b) ? a : b
}

function mergeProjectsByPath(...projectLists) {
  const merged = new Map()

  for (const projects of projectLists) {
    for (const project of projects) {
      if (!project?.path) continue

      const existing = merged.get(project.path)
      if (!existing) {
        merged.set(project.path, {
          ...project,
          id: project.id || encodeProjectPath(project.path),
          sourceFlags: {
            ccgui: !!project.sourceFlags?.ccgui,
            claude: !!project.sourceFlags?.claude,
            codex: !!project.sourceFlags?.codex
          }
        })
        continue
      }

      merged.set(project.path, {
        ...existing,
        ...project,
        id: existing.id || project.id || encodeProjectPath(project.path),
        name: existing.name || project.name || path.basename(project.path),
        settings: existing.settings && Object.keys(existing.settings).length > 0 ? existing.settings : (project.settings || {}),
        sessionCount: Math.max(existing.sessionCount || 0, project.sessionCount || 0),
        lastActiveAt: pickLatestTimestamp(existing.lastActiveAt, project.lastActiveAt),
        sourceFlags: {
          ccgui: !!(existing.sourceFlags?.ccgui || project.sourceFlags?.ccgui),
          claude: !!(existing.sourceFlags?.claude || project.sourceFlags?.claude),
          codex: !!(existing.sourceFlags?.codex || project.sourceFlags?.codex)
        }
      })
    }
  }

  return Array.from(merged.values()).sort((a, b) => {
    if (!a.lastActiveAt) return 1
    if (!b.lastActiveAt) return -1
    return new Date(b.lastActiveAt) - new Date(a.lastActiveAt)
  })
}

async function scanProjects() {
  const providerProjectResults = await Promise.all(
    providerSessionSources.map(async (source) => ({
      provider: source.provider,
      projects: await Promise.resolve(source.scanProjects())
    }))
  )

  for (const entry of providerProjectResults) {
    for (const project of entry.projects) {
      ensureProjectConfig(project)
    }
  }

  const ccguiProjects = scanCCGUIProjects()
  const merged = mergeProjectsByPath(
    ccguiProjects,
    ...providerProjectResults.map(entry => entry.projects)
  )
  const providerSummary = providerProjectResults
    .map(entry => `${entry.provider}=${entry.projects.length}`)
    .join(', ')
  logger.info(`[ProjectService] Found ${merged.length} merged projects (ccgui=${ccguiProjects.length}${providerSummary ? `, ${providerSummary}` : ''})`)
  return merged
}

async function getProjectSessions(projectId) {
  const projectPath = decodeProjectPath(projectId)

  const providerSessionResults = await Promise.all(
    providerSessionSources.map(async (source) => ({
      provider: source.provider,
      sessions: await Promise.resolve(source.listProjectSessions({ projectId, projectPath }))
    }))
  )

  const providerSessions = new Map()
  for (const entry of providerSessionResults) {
    for (const session of entry.sessions) {
      providerSessions.set(session.id, session)
    }
  }

  ensureProviderSessions(projectId, providerSessions)

  let ccguiSessions = []
  try {
    ccguiSessions = sessionConfigManager.getProjectSessions(projectId) || []
  } catch (error) {
    logger.warn('[ProjectService] Failed to read CCGUI sessions', { projectId, error: error.message })
  }

  const mergedSessions = []
  const processedIds = new Set()

  for (const ccguiSession of ccguiSessions) {
    processedIds.add(ccguiSession.id)
    const providerData = providerSessions.get(ccguiSession.id)
    mergedSessions.push({
      id: ccguiSession.id,
      projectId,
      name: ccguiSession.name || '会话',
      preview: providerData?.preview || '',
      createdAt: ccguiSession.createdAt || providerData?.createdAt,
      updatedAt: ccguiSession.updatedAt || providerData?.updatedAt,
      messageCount: providerData?.messageCount || ccguiSession.messageCount || 0,
      status: 'idle',
      settings: {
        ...(providerData?.settings || {}),
        ...(ccguiSession.settings || {})
      }
    })
  }

  for (const entry of providerSessionResults) {
    for (const providerSession of entry.sessions) {
      if (processedIds.has(providerSession.id)) continue
      mergedSessions.push({
        id: providerSession.id,
        projectId,
        name: providerSession.name || '会话',
        preview: providerSession.preview,
        createdAt: providerSession.createdAt,
        updatedAt: providerSession.updatedAt,
        messageCount: providerSession.messageCount || 0,
        status: 'idle',
        settings: providerSession.settings || {}
      })
    }
  }

  mergedSessions.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))
  return mergedSessions
}

function addProject(projectPath, settings) {
  const name = path.basename(projectPath)
  const projectId = encodeProjectPath(projectPath)
  let projectConfig = projectConfigManager.createProjectConfig(projectId, projectPath, name)
  if (settings) {
    projectConfig.settings = settings
    projectConfigManager.saveProjectConfig(projectId, projectConfig)
  }

  return {
    id: projectId,
    name,
    path: projectPath,
    sessionCount: 0,
    lastActiveAt: new Date().toISOString(),
    settings: projectConfig.settings || {},
    sourceFlags: {
      ccgui: true,
      claude: false,
      codex: false
    }
  }
}

function getProjectConfig(projectId) {
  return projectConfigManager.loadProjectConfig(projectId)
}

function updateProjectConfig(projectId, updates) {
  return projectConfigManager.updateProjectConfig(projectId, updates)
}

async function removeProject(projectId, deleteFolder) {
  const projects = await scanProjects()
  const project = projects.find(item => item.id === projectId) || null
  const projectPath = project?.path || null

  for (const source of providerSessionSources) {
    if (!source.deleteProject) continue
    await Promise.resolve(source.deleteProject({ projectId, projectPath }))
  }

  projectConfigManager.deleteProjectConfig(projectId)

  if (deleteFolder && projectPath && fs.existsSync(projectPath)) {
    fs.rmSync(projectPath, { recursive: true })
  }

  return { success: true }
}

function getSessionConfig(projectId, sessionId) {
  return sessionConfigManager.getSession(projectId, sessionId)
}

async function updateSessionConfig(projectId, sessionId, updates) {
  const normalizedUpdates = { ...(updates || {}) }
  if (!normalizedUpdates.name) {
    const existingSessions = await getProjectSessions(projectId)
    const existingSession = existingSessions.find(session => session.id === sessionId)
    if (existingSession?.name) {
      normalizedUpdates.name = existingSession.name
    }
  }

  return sessionConfigManager.updateSession(projectId, sessionId, normalizedUpdates)
}

function resetSessionConfig(projectId, sessionId) {
  return sessionConfigManager.updateSession(projectId, sessionId, { settings: {} })
}

function copySession(projectId, sessionId) {
  const existingSessions = sessionConfigManager.getProjectSessions(projectId) || []
  let maxNum = 0
  for (const session of existingSessions) {
    const match = session.name?.match(/^会话(\d+)$/)
    if (match) {
      maxNum = Math.max(maxNum, parseInt(match[1], 10))
    }
  }

  const sourceConfig = sessionConfigManager.getSession(projectId, sessionId)
  const hasSettings = sourceConfig?.settings && Object.keys(sourceConfig.settings).length > 0
  return sessionConfigManager.createSession(projectId, {
    name: `会话${maxNum + 1}`,
    settings: hasSettings ? { ...sourceConfig.settings } : {}
  })
}

function createSession(projectId, name, settings) {
  return sessionConfigManager.createSession(projectId, {
    name: name || '新会话',
    settings: settings || {}
  })
}

async function deleteSession(projectId, sessionId) {
  const existingSessions = await getProjectSessions(projectId)
  const existingSession = existingSessions.find(session => session.id === sessionId) || null
  const provider = existingSession?.settings?.provider || null

  if (provider) {
    const source = providerSessionSourcesById[provider]
    if (source?.deleteSession) {
      await source.deleteSession({
        projectId,
        sessionId,
        session: existingSession
      })
    }
  }

  sessionConfigManager.deleteSession(projectId, sessionId)
  return { success: true, session: existingSession }
}

async function openSession(sessionId) {
  const projects = await scanProjects()
  for (const project of projects) {
    const sessions = await getProjectSessions(project.id)
    const session = sessions.find(item => item.id === sessionId)
    if (!session) continue
    return {
      id: session.id,
      projectId: project.id,
      projectPath: project.path,
      name: session.name || '会话',
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      status: 'idle',
      settings: session.settings || {}
    }
  }

  return null
}

async function renameSession(sessionId, projectId, name) {
  let targetProjectId = projectId

  if (!targetProjectId) {
    const projects = await scanProjects()
    for (const project of projects) {
      const sessions = await getProjectSessions(project.id)
      if (sessions.some(session => session.id === sessionId) || sessionConfigManager.sessionExists(project.id, sessionId)) {
        targetProjectId = project.id
        break
      }
    }
  }

  if (!targetProjectId) {
    return null
  }

  return sessionConfigManager.updateSession(targetProjectId, sessionId, {
    name: name.trim()
  })
}

function getSessionMessages(projectId, sessionId) {
  return historyManager.loadHistory(projectId, sessionId)
}

function resolveRuntimeConfig(projectId, sessionId) {
  const appConfig = appConfigManager.loadConfig()
  const projectConfig = projectConfigManager.loadProjectConfig(projectId)
  const sessionConfig = sessionConfigManager.getSession(projectId, sessionId)

  return {
    settings: resolveSessionSettings(
      appConfig,
      projectConfig?.settings || {},
      sessionConfig?.settings || null
    ),
    appConfig,
    projectConfig,
    sessionConfig
  }
}

function updateSessionSettings(projectId, sessionId, settings) {
  return sessionConfigManager.updateSession(projectId, sessionId, { settings })
}

module.exports = {
  addProject,
  copySession,
  createSession,
  deleteSession,
  getProjectConfig,
  getProjectSessions,
  getSessionConfig,
  getSessionMessages,
  openSession,
  removeProject,
  renameSession,
  resolveRuntimeConfig,
  resetSessionConfig,
  scanProjects,
  updateProjectConfig,
  updateSessionConfig,
  updateSessionSettings
}
