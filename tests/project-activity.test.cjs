const assert = require('assert')
const { ProjectActivityService } = require('../electron/services/project-activity-service')

const PROJECT_ID = 'project-activity-test'
const PROJECT_PATH = '/tmp/project-activity-test'
const SESSION_ID = 'session-activity-test'

function createService(autoApprove = true) {
  const service = new ProjectActivityService()
  service.setMode('always')
  service.registerProjectWindow({
    projectId: PROJECT_ID,
    projectPath: PROJECT_PATH,
    projectName: 'project-activity-test',
    webContentsId: 1
  })

  const session = {
    id: SESSION_ID,
    projectId: PROJECT_ID,
    projectPath: PROJECT_PATH,
    isProcessing: true,
    autoApprove
  }
  service.registerSession(session)
  return { service, session }
}

function createSession(id, autoApprove = true) {
  return {
    id,
    projectId: PROJECT_ID,
    projectPath: PROJECT_PATH,
    isProcessing: true,
    autoApprove
  }
}

function getProject(service) {
  return service.getSnapshot().projects.find(project => project.projectId === PROJECT_ID)
}

function emitControlRequest(service, session, requestId, toolName, toolInput = {}) {
  service.handleSessionEvent({
    sessionId: session.id,
    eventType: 'control-request',
    data: {
      request_id: requestId,
      tool_use_id: `tool-${requestId}`,
      tool_name: toolName,
      tool_input: toolInput,
      input: toolInput
    }
  }, session)
}

function emitControlResponse(service, session, requestId) {
  service.handleSessionEvent({
    sessionId: session.id,
    eventType: 'control-response',
    data: {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: { behavior: 'allow' }
      }
    }
  }, session)
}

function testAutoApprovedPermissionDoesNotRequireAttention() {
  const { service, session } = createService(true)
  emitControlRequest(service, session, 1, 'Bash', { command: 'pwd' })
  assert.strictEqual(getProject(service).attentionCount, 0)
  assert.strictEqual(getProject(service).runningSessionCount, 1)
  assert.strictEqual(getProject(service).runningTaskCount, 0)
}

function testSessionProcessingDoesNotCountAsRunningTask() {
  const { service } = createService()
  service.handleSessionEvent({
    sessionId: SESSION_ID,
    eventType: 'message-start',
    data: {}
  }, { id: SESSION_ID, projectId: PROJECT_ID, projectPath: PROJECT_PATH })

  assert.strictEqual(getProject(service).runningSessionCount, 1)
  assert.strictEqual(getProject(service).runningTaskCount, 0)
}

function testRunningTaskLabelsDriveProjectRunningState() {
  const { service } = createService()
  let updateCount = 0
  service.on('updated', () => {
    updateCount++
  })

  assert.strictEqual(service.setProjectRunningTasks(PROJECT_ID, ['Dev: Electron', ' Build&Install ', 'Dev: Electron']), true)
  assert.strictEqual(getProject(service).runningTaskCount, 2)
  assert.strictEqual(updateCount, 1)

  assert.strictEqual(service.setProjectRunningTasks(PROJECT_ID, ['Build&Install', 'Dev: Electron']), false)
  assert.strictEqual(updateCount, 1)

  assert.strictEqual(service.setProjectRunningTasks(PROJECT_ID, ['Build&Install']), true)
  assert.strictEqual(getProject(service).runningTaskCount, 1)
  assert.strictEqual(updateCount, 2)

  assert.strictEqual(service.setProjectRunningTasks(PROJECT_ID, []), true)
  assert.strictEqual(getProject(service).runningTaskCount, 0)
  assert.strictEqual(updateCount, 3)
}

function testQuestionsRemainPendingWhenPermissionsAreAutoApproved() {
  const { service, session } = createService(true)
  emitControlRequest(service, session, 2, 'Bash', { command: 'pwd' })
  emitControlRequest(service, session, 3, 'request_user_input', {
    questions: [{ question: 'Continue?', options: [] }]
  })
  assert.strictEqual(getProject(service).attentionCount, 1)

  emitControlResponse(service, session, 2)
  assert.strictEqual(getProject(service).attentionCount, 1)

  emitControlResponse(service, session, 3)
  assert.strictEqual(getProject(service).attentionCount, 0)
}

function testOnlyMatchingRequestClearsAttention() {
  const { service, session } = createService(false)
  emitControlRequest(service, session, 4, 'Bash', { command: 'pwd' })
  emitControlRequest(service, session, 5, 'AskUserQuestion', {
    questions: [{ question: 'Continue?', options: [] }]
  })
  assert.strictEqual(getProject(service).attentionCount, 1)

  emitControlResponse(service, session, 4)
  assert.strictEqual(getProject(service).attentionCount, 1)

  emitControlResponse(service, session, 5)
  assert.strictEqual(getProject(service).attentionCount, 0)
}

function testResultClearsAllPendingAttention() {
  const { service, session } = createService(false)
  emitControlRequest(service, session, 6, 'Bash', { command: 'pwd' })
  emitControlRequest(service, session, 7, 'AskUserQuestion', {
    questions: [{ question: 'Continue?', options: [] }]
  })

  service.handleSessionEvent({
    sessionId: session.id,
    eventType: 'result',
    data: {}
  }, session)

  const project = getProject(service)
  assert.strictEqual(project.attentionCount, 0)
  assert.strictEqual(project.completedCount, 1)
}

function testTaskRunningStateIsIndependentFromSessionState() {
  const { service, session } = createService()
  service.setProjectRunningTasks(PROJECT_ID, ['Dev: Electron'])
  emitControlRequest(service, session, 8, 'AskUserQuestion', {
    questions: [{ question: 'Continue?', options: [] }]
  })
  service.handleSessionEvent({
    sessionId: session.id,
    eventType: 'result',
    data: {}
  }, session)

  const project = getProject(service)
  assert.strictEqual(project.runningSessionCount, 0)
  assert.strictEqual(project.runningTaskCount, 1)
  assert.strictEqual(project.attentionCount, 0)
  assert.strictEqual(project.completedCount, 1)
}

function testSessionRunningStateTracksProcessingLifecycle() {
  const { service, session } = createService()
  assert.strictEqual(getProject(service).runningSessionCount, 1)

  service.handleSessionEvent({
    sessionId: session.id,
    eventType: 'state-update',
    data: { isProcessing: false }
  }, session)
  assert.strictEqual(getProject(service).runningSessionCount, 0)

  service.handleSessionEvent({
    sessionId: session.id,
    eventType: 'message-start',
    data: {}
  }, session)
  assert.strictEqual(getProject(service).runningSessionCount, 1)
}

function testMostRecentCompletedSessionIsTheTarget() {
  const { service, session: runningSession } = createService()
  const completedSession = createSession('completed-session')

  service.markSessionSeen(PROJECT_ID, runningSession.id)
  service.registerSession(completedSession)
  service.setProjectRunningTasks(PROJECT_ID, ['Dev: Electron'])
  service.handleSessionEvent({
    sessionId: completedSession.id,
    eventType: 'result',
    data: {}
  }, completedSession)

  assert.strictEqual(service.getNextProjectTargetSessionId(PROJECT_ID), completedSession.id)
}

function testNewerCompletionWinsWhenSeveralSessionsAreUnseen() {
  const { service } = createService()
  const firstSession = createSession('first-completed-session')
  const latestSession = createSession('latest-completed-session')
  service.registerSession(firstSession)
  service.registerSession(latestSession)

  service.handleSessionEvent({
    sessionId: firstSession.id,
    eventType: 'result',
    data: {}
  }, firstSession)
  service.handleSessionEvent({
    sessionId: latestSession.id,
    eventType: 'result',
    data: {}
  }, latestSession)

  assert.strictEqual(service.getNextProjectTargetSessionId(PROJECT_ID), latestSession.id)
}

function testSessionRestartClearsStaleCompletedState() {
  const { service, session } = createService()
  service.markSessionSeen(PROJECT_ID, session.id)
  service.handleSessionEvent({
    sessionId: session.id,
    eventType: 'result',
    data: {}
  }, session)
  assert.strictEqual(getProject(service).completedCount, 1)

  service.handleSessionEvent({
    sessionId: session.id,
    eventType: 'message-start',
    data: {}
  }, session)

  assert.strictEqual(getProject(service).completedCount, 0)
  assert.strictEqual(service.getNextProjectTargetSessionId(PROJECT_ID), session.id)
}

function testProcessingStateClearsStaleCompletedState() {
  const { service, session } = createService()
  service.handleSessionEvent({
    sessionId: session.id,
    eventType: 'result',
    data: {}
  }, session)

  service.handleSessionEvent({
    sessionId: session.id,
    eventType: 'state-update',
    data: { isProcessing: true }
  }, session)

  assert.strictEqual(getProject(service).completedCount, 0)
}

function testWindowVisibilityIsBroadcastOnlyWhenChanged() {
  const { service } = createService()
  let updateCount = 0
  service.on('updated', () => {
    updateCount++
  })

  assert.strictEqual(getProject(service).windowVisible, false)
  assert.strictEqual(service.setProjectWindowVisible(PROJECT_ID, true), true)
  assert.strictEqual(getProject(service).windowVisible, true)
  assert.strictEqual(updateCount, 1)

  assert.strictEqual(service.setProjectWindowVisible(PROJECT_ID, true), false)
  assert.strictEqual(updateCount, 1)

  assert.strictEqual(service.setProjectWindowVisible(PROJECT_ID, false), true)
  assert.strictEqual(getProject(service).windowVisible, false)
  assert.strictEqual(updateCount, 2)
}

function testProjectToggleActionPrioritizesSpecialSessions() {
  const { service, session } = createService()

  assert.strictEqual(service.getProjectToggleAction(PROJECT_ID, {
    windowVisible: false,
    windowForeground: false
  }), 'show')
  assert.strictEqual(service.getProjectToggleAction(PROJECT_ID, {
    windowVisible: true,
    windowForeground: false
  }), 'focus')
  assert.strictEqual(service.getProjectToggleAction(PROJECT_ID, {
    windowVisible: true,
    windowForeground: true
  }), 'hide')

  service.handleSessionEvent({
    sessionId: session.id,
    eventType: 'result',
    data: {}
  }, session)

  assert.strictEqual(service.getProjectToggleAction(PROJECT_ID, {
    windowVisible: true,
    windowForeground: true
  }), 'activate-session')

  service.markSessionSeen(PROJECT_ID, session.id)
  assert.strictEqual(service.getProjectToggleAction(PROJECT_ID, {
    windowVisible: true,
    windowForeground: true
  }), 'hide')
}

function testVisibleForegroundProjectOpensUnseenSessionBeforeHiding() {
  const { service, session: activeSession } = createService()
  const completedSession = createSession('unseen-completed-session')

  service.markSessionSeen(PROJECT_ID, activeSession.id)
  service.registerSession(completedSession)
  service.handleSessionEvent({
    sessionId: completedSession.id,
    eventType: 'result',
    data: {}
  }, completedSession)

  assert.strictEqual(service.getProjectToggleAction(PROJECT_ID, {
    windowVisible: true,
    windowForeground: true
  }), 'activate-session')
  assert.strictEqual(
    service.getNextProjectTargetSessionId(PROJECT_ID, { advance: true }),
    completedSession.id
  )

  service.markSessionSeen(PROJECT_ID, completedSession.id)

  assert.strictEqual(service.getProjectToggleAction(PROJECT_ID, {
    windowVisible: true,
    windowForeground: true
  }), 'hide')
}

function testPendingSessionTargetsAdvanceOnEachClick() {
  const { service } = createService()
  const firstSession = createSession('first-pending-session')
  const secondSession = createSession('second-pending-session')
  service.registerSession(firstSession)
  service.registerSession(secondSession)
  emitControlRequest(service, firstSession, 20, 'AskUserQuestion', {
    questions: [{ question: 'First?', options: [] }]
  })
  emitControlRequest(service, secondSession, 21, 'AskUserQuestion', {
    questions: [{ question: 'Second?', options: [] }]
  })

  assert.strictEqual(
    service.getNextProjectTargetSessionId(PROJECT_ID, { advance: true }),
    secondSession.id
  )
  assert.strictEqual(
    service.getNextProjectTargetSessionId(PROJECT_ID, { advance: true }),
    firstSession.id
  )
  assert.strictEqual(
    service.getNextProjectTargetSessionId(PROJECT_ID, { advance: true }),
    secondSession.id
  )
}

testAutoApprovedPermissionDoesNotRequireAttention()
testSessionProcessingDoesNotCountAsRunningTask()
testRunningTaskLabelsDriveProjectRunningState()
testQuestionsRemainPendingWhenPermissionsAreAutoApproved()
testOnlyMatchingRequestClearsAttention()
testResultClearsAllPendingAttention()
testTaskRunningStateIsIndependentFromSessionState()
testMostRecentCompletedSessionIsTheTarget()
testNewerCompletionWinsWhenSeveralSessionsAreUnseen()
testSessionRestartClearsStaleCompletedState()
testProcessingStateClearsStaleCompletedState()
testSessionRunningStateTracksProcessingLifecycle()
testWindowVisibilityIsBroadcastOnlyWhenChanged()
testProjectToggleActionPrioritizesSpecialSessions()
testVisibleForegroundProjectOpensUnseenSessionBeforeHiding()
testPendingSessionTargetsAdvanceOnEachClick()
console.log('project-activity-tests: ok')
