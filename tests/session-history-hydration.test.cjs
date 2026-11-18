const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-session-history-hydration-'))
process.env.CCGUI_HOME = tempHome

const projectService = require('../electron/services/project-service')
const {
  projectConfigManager,
  sessionConfigManager
} = require('../electron/storage')
const { claudeSessionSource } = require('../electron/adapters/claude/session-source')
const { codexSessionSource } = require('../electron/adapters/codex/session-source')

const projectId = 'session-history-hydration-project'
let projectSessionScanCount = 0
let claudeProviderScanCount = 0
let codexProviderScanCount = 0
let codexHistoryLoadCount = 0

projectConfigManager.createProjectConfig(projectId, '/tmp/session-history-hydration-project', 'Hydration')

sessionConfigManager.getProjectSessions = () => {
  projectSessionScanCount += 1
  return []
}
claudeSessionSource.listProjectSessions = () => {
  claudeProviderScanCount += 1
  return []
}
codexSessionSource.listProjectSessions = () => {
  codexProviderScanCount += 1
  return []
}
codexSessionSource.loadSessionHistory = async ({ session }) => {
  codexHistoryLoadCount += 1
  assert.strictEqual(session.id, boundSession.id)
  return []
}

const unboundSession = sessionConfigManager.createSession(projectId, {
  name: 'New Codex Session',
  settings: {
    tool: 'codex',
    toolBinding: {
      tool: 'codex',
      nativeSessionId: null
    }
  }
})

const boundSession = sessionConfigManager.createSession(projectId, {
  name: 'Bound Codex Session',
  settings: {
    tool: 'codex',
    codexThreadId: 'thread-bound',
    toolBinding: {
      tool: 'codex',
      nativeSessionId: 'thread-bound'
    }
  }
})

async function run() {
  const unboundResult = await projectService.ensureSessionHistoryHydrated(projectId, unboundSession.id, {
    maxWaitMs: 0
  })
  assert.strictEqual(unboundResult.success, true)
  assert.strictEqual(unboundResult.imported, false)
  assert.strictEqual(projectSessionScanCount, 0, 'new sessions must not scan all project sessions')
  assert.strictEqual(claudeProviderScanCount, 0, 'new sessions must not scan Claude provider sessions')
  assert.strictEqual(codexProviderScanCount, 0, 'new sessions must not scan Codex provider sessions')
  assert.strictEqual(codexHistoryLoadCount, 0, 'unbound sessions must not load provider history')

  const boundResult = await projectService.ensureSessionHistoryHydrated(projectId, boundSession.id, {
    maxWaitMs: 0
  })
  assert.strictEqual(boundResult.success, true)
  assert.strictEqual(boundResult.imported, false)
  assert.strictEqual(projectSessionScanCount, 0, 'bound sessions must be read directly by ID')
  assert.strictEqual(claudeProviderScanCount, 0)
  assert.strictEqual(codexProviderScanCount, 0)
  assert.strictEqual(codexHistoryLoadCount, 1, 'bound sessions must load their provider history')

  console.log('session-history-hydration-tests: ok')
}

run()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    fs.rmSync(tempHome, { recursive: true, force: true })
  })
