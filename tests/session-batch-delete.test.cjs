const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-batch-delete-test-'))
process.env.CCGUI_HOME = tempHome
process.env.HOME = tempHome

const projectService = require('../electron/services/project-service')
const { sessionConfigManager } = require('../electron/storage')
const { claudeSessionSource } = require('../electron/adapters/claude/session-source')
const { codexSessionSource } = require('../electron/adapters/codex/session-source')

const projectId = 'batch-delete-project'
const providerCalls = {
  claude: [],
  codex: []
}
const providerScanCalls = {
  claude: 0,
  codex: 0
}
let projectSessionScanCount = 0

function createSession(sessionId, settings) {
  const sessionDir = path.join(tempHome, 'projects', projectId, 'sessions', sessionId)
  fs.mkdirSync(path.join(sessionDir, 'history'), { recursive: true })
  fs.writeFileSync(
    path.join(sessionDir, 'session.json'),
    JSON.stringify({
      id: sessionId,
      projectId,
      name: sessionId,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      messageCount: 0,
      settings
    }, null, 2)
  )
}

createSession('claude-a', {
  tool: 'claude',
  toolBinding: { tool: 'claude', nativeSessionId: 'claude-a' }
})
createSession('claude-b', {
  tool: 'claude',
  toolBinding: { tool: 'claude', nativeSessionId: 'claude-b' }
})
createSession('claude-c', {
  tool: 'claude',
  toolBinding: { tool: 'claude', nativeSessionId: 'claude-c' }
})
createSession('codex-a', {
  tool: 'codex',
  codexThreadId: 'thread-codex-a',
  toolBinding: { tool: 'codex', nativeSessionId: 'thread-codex-a' }
})

sessionConfigManager.getProjectSessions = () => {
  projectSessionScanCount += 1
  return []
}
claudeSessionSource.listProjectSessions = () => {
  providerScanCalls.claude += 1
  return []
}
codexSessionSource.listProjectSessions = () => {
  providerScanCalls.codex += 1
  return []
}
claudeSessionSource.deleteSessions = async ({ sessions }) => {
  providerCalls.claude.push(sessions.map(session => session.id))
  return {
    deletedSessionIds: sessions.map(session => session.id),
    failures: []
  }
}
codexSessionSource.deleteSessions = async ({ sessions }) => {
  providerCalls.codex.push(sessions.map(session => session.id))
  return {
    deletedSessionIds: sessions.map(session => session.id),
    failures: [{
      sessionId: sessions[0].id,
      error: 'mock provider archive failure'
    }]
  }
}

async function run() {
  const result = await projectService.deleteSessions(projectId, [
    'claude-a',
    'claude-b',
    'codex-a',
    'claude-a'
  ])

  assert.deepStrictEqual(result.deletedSessionIds.sort(), ['claude-a', 'claude-b', 'codex-a'])
  assert.strictEqual(result.failures.length, 0)
  assert.strictEqual(result.warnings.length, 1)
  assert.strictEqual(result.warnings[0].sessionId, 'codex-a')
  assert.strictEqual(result.warnings[0].type, 'provider-delete-failed')
  assert.deepStrictEqual(providerCalls.claude, [['claude-a', 'claude-b']])
  assert.deepStrictEqual(providerCalls.codex, [['codex-a']])
  assert.strictEqual(projectSessionScanCount, 0, 'batch deletion must not scan project sessions')
  assert.strictEqual(providerScanCalls.claude, 0, 'batch deletion must not scan Claude sessions')
  assert.strictEqual(providerScanCalls.codex, 0, 'batch deletion must not scan Codex sessions')
  assert.strictEqual(
    result.sessionResults.find(item => item.sessionId === 'codex-a')?.providerDeleted,
    false
  )

  for (const sessionId of ['claude-a', 'claude-b', 'codex-a']) {
    assert.strictEqual(
      sessionConfigManager.sessionExists(projectId, sessionId),
      false,
      `${sessionId} must be removed`
    )
  }

  const singleDeleteResult = await projectService.deleteSession(projectId, 'claude-c')
  assert.strictEqual(singleDeleteResult.success, true)
  assert.strictEqual(singleDeleteResult.providerDeleted, true)
  assert.deepStrictEqual(singleDeleteResult.warnings, [])
  assert.deepStrictEqual(providerCalls.claude.at(-1), ['claude-c'])
  assert.strictEqual(projectSessionScanCount, 0)
  assert.strictEqual(providerScanCalls.claude, 0)
  assert.strictEqual(providerScanCalls.codex, 0)
  assert.strictEqual(sessionConfigManager.sessionExists(projectId, 'claude-c'), false)

  console.log('session-batch-delete-tests: ok')
}

run()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    fs.rmSync(tempHome, { recursive: true, force: true })
  })
