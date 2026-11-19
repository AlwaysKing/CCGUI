const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-codex-stderr-test-'))
process.env.CCGUI_HOME = tempHome

const { buildCodexStderrEvent } = require('../electron/adapters/codex/client')
const { SessionInstance } = require('../electron/session/session-instance')
const historyManager = require('../electron/storage/history-manager')

const applyPatchStderr = [
  '\u001b[2m2026-11-18T09:35:54.944206Z\u001b[0m \u001b[31mERROR\u001b[0m \u001b[2mcodex_core::tools::router\u001b[0m\u001b[2m:\u001b[0m \u001b[3merror\u001b[0m\u001b[2m=\u001b[0mapply_patch verification failed: Failed to find expected lines in /Users/example/project/scripts/rebuild.sh:',
  'echo old content'
].join('\n')

const applyPatchEvent = buildCodexStderrEvent(applyPatchStderr)
assert.strictEqual(applyPatchEvent.eventType, 'runtime-diagnostic')
assert.strictEqual(applyPatchEvent.data.type, 'tool-router-error')
assert.strictEqual(applyPatchEvent.data.toolName, 'apply_patch')
assert.strictEqual(applyPatchEvent.data.errorType, 'apply_patch_verification_failed')
assert.strictEqual(applyPatchEvent.data.filePath, '/Users/example/project/scripts/rebuild.sh')
assert(applyPatchEvent.data.message.startsWith('apply_patch verification failed:'))
assert(!applyPatchEvent.data.message.includes('\u001b'))

const viewImageEvent = buildCodexStderrEvent(
  '2026-11-19T02:01:49.128466Z ERROR codex_core::tools::router: error=view_image is not allowed because you do not support image inputs'
)
assert.strictEqual(viewImageEvent.eventType, 'runtime-diagnostic')
assert.strictEqual(viewImageEvent.data.type, 'tool-router-error')
assert.strictEqual(viewImageEvent.data.toolName, 'view_image')
assert.strictEqual(viewImageEvent.data.errorType, 'unsupported_image_input')
assert.strictEqual(viewImageEvent.data.level, 'error')
assert.strictEqual(viewImageEvent.data.message, 'view_image is not allowed because you do not support image inputs')

const warningEvent = buildCodexStderrEvent('\u001b[33mruntime warning\u001b[0m')
assert.strictEqual(warningEvent.eventType, 'runtime-diagnostic')
assert.strictEqual(warningEvent.data.type, 'runtime-log')
assert.strictEqual(warningEvent.data.message, 'runtime warning')
assert.strictEqual(warningEvent.data.level, 'warning')
assert.strictEqual(buildCodexStderrEvent(' \n '), null)

async function run() {
  const { CodexAdapter } = require('../electron/adapters/codex/adapter')
  const adapter = new CodexAdapter(process.cwd(), 'stderr-test-session', false)
  const notifications = []
  adapter.on('system-notification', notification => notifications.push(notification))

  adapter.handleRuntimeDiagnostic(applyPatchEvent.data)
  await new Promise(resolve => setTimeout(resolve, 850))
  const toolErrorNotification = notifications.find(item => item.type === 'tool-error')
  assert(toolErrorNotification)
  assert.strictEqual(toolErrorNotification.toolName, 'apply_patch')

  adapter.handleRuntimeDiagnostic(warningEvent.data)
  const runtimeDiagnostic = notifications.find(item => item.type === 'runtime-diagnostic')
  assert(runtimeDiagnostic)
  assert.strictEqual(runtimeDiagnostic.level, 'warning')

  const rawAdapter = new CodexAdapter(process.cwd(), 'raw-tool-test-session', false)
  const rawNotifications = []
  const toolMessages = []
  rawAdapter.on('system-notification', notification => rawNotifications.push(notification))
  rawAdapter.on('message-start', message => toolMessages.push(message))

  rawAdapter.handleRuntimeDiagnostic(viewImageEvent.data)
  assert.strictEqual(rawAdapter.pendingStderrToolErrors.size, 1)
  rawAdapter.handleRawResponseItem({
    threadId: 'thread-1',
    turnId: 'turn-1',
    item: {
      type: 'function_call',
      id: 'fc_call_1',
      call_id: 'call_1',
      name: 'view_image',
      arguments: JSON.stringify({ path: '/tmp/example.png' })
    }
  })
  rawAdapter.handleRawResponseItem({
    threadId: 'thread-1',
    turnId: 'turn-1',
    item: {
      type: 'function_call_output',
      call_id: 'call_1',
      output: viewImageEvent.data.message
    }
  })
  assert.strictEqual(rawAdapter.pendingStderrToolErrors.size, 0)
  assert.strictEqual(toolMessages.length, 1)
  assert.strictEqual(toolMessages[0].id, 'call_1')
  assert.strictEqual(toolMessages[0].toolName, 'ViewImage')
  assert.strictEqual(toolMessages[0].isError, true)
  assert.strictEqual(toolMessages[0].result, viewImageEvent.data.message)
  assert.strictEqual(rawNotifications.length, 0)

  const projectId = 'project-id'
  const sessionId = 'session-id'
  const target = {
    projectId,
    id: sessionId,
    currentHistoryTurnId: null,
    historyTurns: [],
    getMainAgentId: () => 'main-agent',
    setAgentSourceTurnId: () => {},
    resolveNotificationScope: () => 'turn',
    shouldPersistEventInTurnHistory: SessionInstance.prototype.shouldPersistEventInTurnHistory,
    appendEventToTurnHistory: SessionInstance.prototype.appendEventToTurnHistory
  }
  const turn = historyManager.appendTurn(projectId, sessionId, {
    id: 'turn-id',
    role: 'user',
    content: 'test',
    timestamp: new Date().toISOString()
  })
  assert(turn?.turnId)
  target.currentHistoryTurnId = turn.turnId

  const event = {
    sessionId,
    eventType: 'system-notification',
    data: toolErrorNotification,
    timestamp: new Date().toISOString()
  }

  SessionInstance.prototype.appendEventToTurnHistory.call(target, event)
  await historyManager.waitForWriteQueueIdle()

  const persistedEvents = historyManager.loadTurnEvents(projectId, sessionId, turn.turnId)
  const persistedToolError = persistedEvents.find(item =>
    item.eventType === 'system-notification' && item.data?.type === 'tool-error'
  )
  assert(persistedToolError)
  assert.strictEqual(persistedToolError.data.filePath, '/Users/example/project/scripts/rebuild.sh')
  assert(!persistedToolError.data.message.includes('\u001b'))

  const indexEntries = historyManager.loadIndexEntries(projectId, sessionId)
  assert.notStrictEqual(indexEntries[0].status, 'error')

  SessionInstance.prototype.appendEventToTurnHistory.call(target, {
    ...event,
    eventType: 'cli-status'
  })
  await historyManager.waitForWriteQueueIdle()
  assert.strictEqual(
    historyManager.loadTurnEvents(projectId, sessionId, turn.turnId)
      .filter(item => item.eventType === 'cli-status')
      .length,
    0
  )

  console.log('codex-stderr-notification-tests: ok')
}

run()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    fs.rmSync(tempHome, { recursive: true, force: true })
  })
