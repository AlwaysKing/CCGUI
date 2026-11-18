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
assert.strictEqual(applyPatchEvent.eventType, 'system-notification')
assert.strictEqual(applyPatchEvent.data.type, 'tool-error')
assert.strictEqual(applyPatchEvent.data.toolName, 'apply_patch')
assert.strictEqual(applyPatchEvent.data.errorType, 'apply_patch_verification_failed')
assert.strictEqual(applyPatchEvent.data.filePath, '/Users/example/project/scripts/rebuild.sh')
assert(applyPatchEvent.data.message.startsWith('apply_patch verification failed:'))
assert(!applyPatchEvent.data.message.includes('\u001b'))

assert.deepStrictEqual(buildCodexStderrEvent('\u001b[33mruntime warning\u001b[0m'), {
  eventType: 'cli-status',
  data: {
    type: 'status',
    message: 'runtime warning'
  }
})
assert.strictEqual(buildCodexStderrEvent(' \n '), null)

async function run() {
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
    eventType: applyPatchEvent.eventType,
    data: applyPatchEvent.data,
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
