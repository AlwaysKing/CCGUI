const path = require('path')
const { EventEmitter } = require('events')
const logger = require('../logger')

const FLOATING_MONITOR_MODES = new Set(['off', 'auto', 'always'])
const USER_INPUT_TOOL_NAMES = new Set(['AskUserQuestion', 'request_user_input'])
const ACTIVITY_EVENT_TYPES = new Set([
  'state-update',
  'message-start',
  'result',
  'interrupt',
  'control-request',
  'control-response',
  'system-notification',
  'normal-exit',
  'abnormal-exit'
])

function normalizeFloatingMonitorMode(value) {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return FLOATING_MONITOR_MODES.has(normalized) ? normalized : 'auto'
}

function updateSessionMembership(target, sessionId, active) {
  if (active) {
    if (target.has(sessionId)) {
      return false
    }
    target.add(sessionId)
    return true
  }
  return target.delete(sessionId)
}

function pickFirstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== '') {
      return value
    }
  }
  return null
}

function getControlRequestData(event) {
  const data = event?.data
  if (!data || typeof data !== 'object') {
    return {}
  }
  return data.request && typeof data.request === 'object'
    ? { ...data.request, ...data }
    : data
}

function getControlRequestId(event) {
  const data = getControlRequestData(event)
  return pickFirstDefined(
    data.request_id,
    data.tool_use_id,
    data.toolUseId,
    data.id,
    data.request?.request_id,
    data.request?.tool_use_id,
    data.request?.toolUseId
  )
}

function getControlResponseRequestId(event) {
  const data = event?.data
  if (!data || typeof data !== 'object') {
    return null
  }
  return pickFirstDefined(
    data.response?.request_id,
    data.request_id,
    data.request?.request_id
  )
}

function isUserInputControlRequest(event) {
  const requestData = getControlRequestData(event)
  const toolName = String(pickFirstDefined(
    requestData.tool_name,
    requestData.toolName,
    requestData.request?.tool_name,
    requestData.request?.toolName,
    ''
  )).trim()
  if (USER_INPUT_TOOL_NAMES.has(toolName)) {
    return true
  }

  const toolInput = pickFirstDefined(
    requestData.input,
    requestData.tool_input,
    requestData.toolInput,
    requestData.request?.input,
    requestData.request?.tool_input,
    requestData.request?.toolInput,
    null
  )
  const questions = pickFirstDefined(
    toolInput?.questions,
    requestData.questions,
    requestData.request?.questions,
    null
  )
  return Array.isArray(questions) && questions.length > 0
}

function controlRequestNeedsAttention(event, session) {
  return isUserInputControlRequest(event) || session?.autoApprove !== true
}

function updateSessionAttention(project, sessionId, requestId, active) {
  const requestKey = String(requestId || '__unknown__')
  let requests = project.attentionRequestsBySession.get(sessionId)

  if (active) {
    if (!requests) {
      requests = new Map()
      project.attentionRequestsBySession.set(sessionId, requests)
    }
    if (requests.has(requestKey)) {
      return false
    }
    requests.set(requestKey, true)
  } else {
    if (!requests?.delete(requestKey)) {
      return false
    }
    if (requests.size === 0) {
      project.attentionRequestsBySession.delete(sessionId)
    }
  }

  return updateSessionMembership(
    project.attentionSessionIds,
    sessionId,
    Boolean(requests?.size)
  )
}

function clearSessionAttention(project, sessionId) {
  const removedRequests = project.attentionRequestsBySession.delete(sessionId)
  return updateSessionMembership(project.attentionSessionIds, sessionId, false) || removedRequests
}

/**
 * 聚合工程窗口、Session 待处理状态与 tasks.json Task 运行状态，供工程监控悬浮窗消费。
 */
class ProjectActivityService extends EventEmitter {
  constructor() {
    super()
    this.mode = 'auto'
    this.stageManagerEnabled = false
    this.projects = new Map()
    this.windowProjects = new Map()
    this.focusedProjectId = null
    this.nextProjectOrder = 0
    this.nextSessionActivityOrder = 0
  }

  setMode(mode) {
    const nextMode = normalizeFloatingMonitorMode(mode)
    if (this.mode === nextMode) {
      return
    }
    this.mode = nextMode
    this.notifyUpdated()
  }

  getMode() {
    return this.mode
  }

  setStageManagerEnabled(enabled) {
    const nextEnabled = Boolean(enabled)
    if (this.stageManagerEnabled === nextEnabled) {
      return
    }
    this.stageManagerEnabled = nextEnabled
    this.notifyUpdated()
  }

  isStageManagerEnabled() {
    return this.stageManagerEnabled
  }

  getOrCreateProject(projectId, projectPath = '', projectName = '') {
    if (!projectId) {
      return null
    }

    let project = this.projects.get(projectId)
    if (!project) {
      project = {
        projectId,
        projectPath: projectPath || '',
        projectName: projectName || (projectPath ? path.basename(projectPath) : projectId),
        open: false,
        hidden: false,
        windowVisible: false,
        order: this.nextProjectOrder++,
        activeSessionId: null,
        lastTargetSessionId: null,
        sessionActivityOrder: new Map(),
        runningSessionIds: new Set(),
        runningTaskLabels: new Set(),
        attentionSessionIds: new Set(),
        attentionRequestsBySession: new Map(),
        completedSessionIds: new Set(),
        errorSessionIds: new Set()
      }
      this.projects.set(projectId, project)
    }

    if (projectPath) {
      project.projectPath = projectPath
    }
    if (projectName) {
      project.projectName = projectName
    } else if (!project.projectName) {
      project.projectName = project.projectPath ? path.basename(project.projectPath) : projectId
    }

    return project
  }

  registerProjectWindow({ projectId, projectPath = '', projectName = '', webContentsId = null }) {
    const previousProject = this.projects.get(projectId)
    const previousName = previousProject?.projectName || ''
    const previousPath = previousProject?.projectPath || ''
    const project = this.getOrCreateProject(projectId, projectPath, projectName)
    if (!project) {
      return
    }

    const previousProjectId = webContentsId ? this.windowProjects.get(webContentsId) : null
    if (previousProjectId && previousProjectId !== projectId) {
      this.detachProjectWindow(previousProjectId)
    }
    if (webContentsId) {
      this.windowProjects.set(webContentsId, projectId)
    }

    const wasOpen = project.open
    project.open = true
    if (!wasOpen || project.projectName !== previousName || project.projectPath !== previousPath) {
      this.notifyUpdated()
    }
  }

  unregisterProjectWindow(webContentsId) {
    if (!webContentsId) {
      return
    }

    const projectId = this.windowProjects.get(webContentsId)
    if (!projectId) {
      return
    }

    this.windowProjects.delete(webContentsId)
    this.detachProjectWindow(projectId)
  }

  detachProjectWindow(projectId) {
    const project = this.projects.get(projectId)
    if (!project) {
      return
    }

    project.open = false
    project.hidden = false
    project.windowVisible = false
    project.runningSessionIds.clear()
    project.runningTaskLabels.clear()
    project.attentionSessionIds.clear()
    project.attentionRequestsBySession.clear()
    project.completedSessionIds.clear()
    project.errorSessionIds.clear()
    project.activeSessionId = null
    project.lastTargetSessionId = null
    project.sessionActivityOrder.clear()
    if (this.focusedProjectId === projectId) {
      this.focusedProjectId = null
    }
    this.notifyUpdated()
  }

  setProjectFocused(projectId, focused) {
    if (!projectId) {
      return
    }

    if (focused) {
      this.focusedProjectId = projectId
      const project = this.projects.get(projectId)
      if (project?.activeSessionId) {
        this.markSessionSeen(projectId, project.activeSessionId)
      }
      return
    }

    if (this.focusedProjectId === projectId) {
      this.focusedProjectId = null
    }
  }

  hideProject(projectId) {
    const project = this.projects.get(projectId)
    if (!project) {
      return false
    }
    project.hidden = true
    this.notifyUpdated()
    return true
  }

  restoreProject(projectId) {
    const project = this.projects.get(projectId)
    if (!project) {
      return false
    }
    project.hidden = false
    this.notifyUpdated()
    return true
  }

  setProjectWindowVisible(projectId, visible) {
    const project = this.projects.get(projectId)
    if (!project) {
      return false
    }

    const nextVisible = Boolean(visible)
    if (project.windowVisible === nextVisible) {
      return false
    }
    project.windowVisible = nextVisible
    this.notifyUpdated()
    return true
  }

  markSessionSeen(projectId, sessionId) {
    const project = this.projects.get(projectId)
    if (!project || !sessionId) {
      return false
    }

    const activeSessionChanged = project.activeSessionId !== sessionId
    project.activeSessionId = sessionId
    this.rememberSessionActivity(project, sessionId)
    const completedChanged = project.completedSessionIds.delete(sessionId)
    if (activeSessionChanged || completedChanged) {
      this.notifyUpdated()
    }
    return completedChanged
  }

  markProjectSeen(projectId) {
    const project = this.projects.get(projectId)
    if (!project || project.completedSessionIds.size === 0) {
      return
    }
    project.completedSessionIds.clear()
    this.notifyUpdated()
  }

  setProjectRunningTasks(projectId, labels = []) {
    if (!projectId) {
      return false
    }

    const project = this.getOrCreateProject(projectId)
    if (!project) {
      return false
    }

    const nextLabels = new Set(
      (Array.isArray(labels) ? labels : [])
        .map(label => String(label || '').trim())
        .filter(Boolean)
    )
    const unchanged = nextLabels.size === project.runningTaskLabels.size &&
      Array.from(nextLabels).every(label => project.runningTaskLabels.has(label))
    if (unchanged) {
      return false
    }

    project.runningTaskLabels = nextLabels
    this.notifyUpdated()
    return true
  }

  getHiddenProjectIds() {
    return Array.from(this.projects.values())
      .filter(project => project.hidden)
      .map(project => project.projectId)
  }

  hasHiddenProjects() {
    return Array.from(this.projects.values()).some(project => project.hidden)
  }

  registerSession(session) {
    if (!session?.id || !session.projectId) {
      return
    }
    const project = this.getOrCreateProject(session.projectId, session.projectPath)
    if (!project) {
      return
    }
    this.rememberSessionActivity(project, session.id)
    if (updateSessionMembership(project.runningSessionIds, session.id, session.isProcessing === true)) {
      this.notifyUpdated()
    }
  }

  handleSessionEvent(event, session) {
    const sessionId = event?.sessionId
    const eventType = event?.eventType
    if (!sessionId || !eventType || !ACTIVITY_EVENT_TYPES.has(eventType)) {
      return
    }

    const project = this.getOrCreateProject(session?.projectId, session?.projectPath)
    if (!project) {
      return
    }

    this.rememberSessionActivity(project, sessionId)
    let changed = false

    switch (eventType) {
      case 'state-update': {
        const isProcessing = event.data?.isProcessing
        if (typeof isProcessing === 'boolean') {
          changed = updateSessionMembership(project.runningSessionIds, sessionId, isProcessing) || changed
        }
        if (isProcessing === true) {
          changed = updateSessionMembership(project.completedSessionIds, sessionId, false) || changed
        }
        break
      }

      case 'message-start':
        changed = updateSessionMembership(project.runningSessionIds, sessionId, true) || changed
        changed = updateSessionMembership(project.completedSessionIds, sessionId, false) || changed
        changed = updateSessionMembership(project.errorSessionIds, sessionId, false) || changed
        break

      case 'result':
        changed = updateSessionMembership(project.runningSessionIds, sessionId, false) || changed
        changed = clearSessionAttention(project, sessionId) || changed
        changed = updateSessionMembership(project.errorSessionIds, sessionId, false) || changed
        changed = updateSessionMembership(
          project.completedSessionIds,
          sessionId,
          !(this.focusedProjectId === project.projectId && project.activeSessionId === sessionId)
        ) || changed
        break

      case 'interrupt':
        changed = updateSessionMembership(project.runningSessionIds, sessionId, false) || changed
        changed = clearSessionAttention(project, sessionId) || changed
        break

      case 'control-request':
        changed = updateSessionAttention(
          project,
          sessionId,
          getControlRequestId(event),
          controlRequestNeedsAttention(event, session)
        )
        break

      case 'control-response':
        changed = updateSessionAttention(
          project,
          sessionId,
          getControlResponseRequestId(event),
          false
        )
        break

      case 'system-notification': {
        const notificationType = event.data?.type
        if (notificationType === 'runtime-exit') {
          changed = updateSessionMembership(project.runningSessionIds, sessionId, false) || changed
          changed = clearSessionAttention(project, sessionId) || changed
          changed = updateSessionMembership(project.errorSessionIds, sessionId, true) || changed
        } else if (notificationType === 'runtime-stopped') {
          changed = updateSessionMembership(project.runningSessionIds, sessionId, false) || changed
          changed = clearSessionAttention(project, sessionId) || changed
        } else {
          return
        }
        break
      }

      case 'normal-exit':
        changed = updateSessionMembership(project.runningSessionIds, sessionId, false) || changed
        changed = clearSessionAttention(project, sessionId) || changed
        break

      case 'abnormal-exit':
        changed = updateSessionMembership(project.runningSessionIds, sessionId, false) || changed
        changed = clearSessionAttention(project, sessionId) || changed
        changed = updateSessionMembership(project.errorSessionIds, sessionId, true) || changed
        break

      default:
        return
    }

    if (changed) {
      this.notifyUpdated()
    }
  }

  getOrderedSessionIds(project, sessionIds) {
    return Array.from(sessionIds).sort((left, right) => (
      (project.sessionActivityOrder.get(right) || 0) -
      (project.sessionActivityOrder.get(left) || 0)
    ))
  }

  getProjectToggleAction(projectId, { windowVisible = false, windowForeground = false } = {}) {
    const project = this.projects.get(projectId)
    if (!project) {
      return null
    }

    const hasSpecialState = project.attentionSessionIds.size > 0 ||
      project.completedSessionIds.size > 0 ||
      project.errorSessionIds.size > 0
    if (hasSpecialState) {
      return 'activate-session'
    }
    if (!windowVisible) {
      return 'show'
    }
    return windowForeground ? 'hide' : 'focus'
  }

  getNextProjectTargetSessionId(projectId, { advance = false } = {}) {
    const project = this.projects.get(projectId)
    if (!project) {
      return null
    }

    const sessionGroups = [
      project.attentionSessionIds,
      project.completedSessionIds,
      project.errorSessionIds
    ]
    const orderedSessionIds = sessionGroups
      .flatMap(sessionIds => this.getOrderedSessionIds(project, sessionIds))
    if (orderedSessionIds.length === 0) {
      return project.activeSessionId || null
    }

    const lastTargetIndex = advance
      ? orderedSessionIds.indexOf(project.lastTargetSessionId)
      : -1
    const targetIndex = lastTargetIndex >= 0 && lastTargetIndex < orderedSessionIds.length - 1
      ? lastTargetIndex + 1
      : 0
    const targetSessionId = orderedSessionIds[targetIndex]
    if (advance) {
      project.lastTargetSessionId = targetSessionId
    }
    return targetSessionId
  }

  rememberSessionActivity(project, sessionId) {
    if (!project || !sessionId) {
      return
    }
    project.sessionActivityOrder.set(sessionId, ++this.nextSessionActivityOrder)
  }

  getSnapshot() {
    const projects = Array.from(this.projects.values())
      .filter(project => this.mode === 'always' ? project.open : (this.mode === 'auto' && project.hidden))
      .sort((left, right) => left.order - right.order)
      .map(project => ({
        projectId: project.projectId,
        projectName: project.projectName,
        projectPath: project.projectPath,
        runningSessionCount: project.runningSessionIds.size,
        runningTaskCount: project.runningTaskLabels.size,
        attentionCount: project.attentionSessionIds.size,
        completedCount: project.completedSessionIds.size,
        errorCount: project.errorSessionIds.size,
        hidden: project.hidden,
        windowVisible: project.windowVisible
      }))

    return {
      mode: this.mode,
      stageManagerEnabled: this.stageManagerEnabled,
      projects
    }
  }

  notifyUpdated() {
    try {
      this.emit('updated', this.getSnapshot())
    } catch (error) {
      logger.warn('[ProjectActivity] Failed to notify activity update', {
        error: error.message
      })
    }
  }
}

module.exports = {
  ProjectActivityService,
  normalizeFloatingMonitorMode
}
