const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-session-order-test-'))
process.env.HOME = tempHome

const projectConfigManager = require('../electron/storage/project-config-manager')
const sessionConfigManager = require('../electron/storage/session-config-manager')
const projectService = require('../electron/services/project-service')

function run() {
  const projectId = '-tmp-ccgui-session-order'
  const projectPath = '/tmp/ccgui-session-order'
  projectConfigManager.createProjectConfig(projectId, projectPath, 'Session Order Test')

  const first = sessionConfigManager.createSession(projectId, { name: 'first' })
  const second = sessionConfigManager.createSession(projectId, { name: 'second' })

  assert.deepStrictEqual(
    projectConfigManager.getProjectSessionOrder(projectId),
    [second.id, first.id],
    'new sessions must be prepended to the project order'
  )
  assert.deepStrictEqual(
    sessionConfigManager.getProjectSessions(projectId).map(session => session.id),
    [second.id, first.id],
    'session reads must use the stored order instead of timestamps'
  )

  projectConfigManager.setProjectSessionOrder(projectId, [first.id, second.id])
  assert.deepStrictEqual(
    sessionConfigManager.getProjectSessions(projectId).map(session => session.id),
    [first.id, second.id],
    'manual order must be preserved'
  )

  sessionConfigManager.softDeleteSession(projectId, second.id)
  assert.deepStrictEqual(
    projectConfigManager.getProjectSessionOrder(projectId),
    [first.id, second.id],
    'soft-deleted sessions must keep their position for restore'
  )
  sessionConfigManager.restoreSession(projectId, second.id)

  sessionConfigManager.deleteSession(projectId, first.id)
  assert.deepStrictEqual(
    projectConfigManager.getProjectSessionOrder(projectId),
    [second.id],
    'permanently deleted sessions must be removed from the stored order'
  )

  projectConfigManager.setProjectSessionOrder(projectId, [])
  const third = sessionConfigManager.createSession(projectId, { name: 'third' })
  const initializedOrder = projectConfigManager.getProjectSessionOrder(projectId)
  assert.strictEqual(
    initializedOrder[0],
    third.id,
    'the first new session must initialize the full order and stay on top'
  )
  assert.strictEqual(
    initializedOrder.length,
    2,
    'initializing the order must include existing sessions'
  )

  const legacyProjectId = '-tmp-ccgui-session-order-legacy'
  projectConfigManager.createProjectConfig(legacyProjectId, '/tmp/ccgui-session-order-legacy', 'Legacy')
  const legacyOld = sessionConfigManager.createSession(legacyProjectId, { name: 'legacy-old' })
  const legacyNew = sessionConfigManager.createSession(legacyProjectId, { name: 'legacy-new' })
  projectConfigManager.setProjectSessionOrder(legacyProjectId, [])

  const setSessionUpdatedAt = (sessionId, updatedAt) => {
    const configPath = path.join(
      tempHome,
      '.ccgui',
      'projects',
      legacyProjectId,
      'sessions',
      sessionId,
      'session.json'
    )
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    config.updatedAt = updatedAt
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
  }
  setSessionUpdatedAt(legacyOld.id, '2026-11-17T01:00:00.000Z')
  setSessionUpdatedAt(legacyNew.id, '2026-11-17T02:00:00.000Z')

  assert.deepStrictEqual(
    sessionConfigManager.getProjectSessions(legacyProjectId).map(session => session.id),
    [legacyNew.id, legacyOld.id],
    'legacy projects without a fixed order should keep the previous list order once'
  )
  projectConfigManager.setProjectSessionOrder(legacyProjectId, [legacyOld.id, legacyNew.id])
  assert.deepStrictEqual(
    sessionConfigManager.getProjectSessions(legacyProjectId).map(session => session.id),
    [legacyOld.id, legacyNew.id],
    'once migrated, updatedAt must not affect the fixed order'
  )

  const providerProjectId = '-tmp-ccgui-session-order-provider'
  projectConfigManager.createProjectConfig(providerProjectId, '/tmp/provider-order', 'Provider')
  const migratedSessions = projectService.orderProjectSessions(providerProjectId, [
    { id: 'provider-old', updatedAt: '2026-11-17T01:00:00.000Z' },
    { id: 'session-new', updatedAt: '2026-11-17T03:00:00.000Z' },
    { id: 'session-old', updatedAt: '2026-11-17T02:00:00.000Z' }
  ], { initializeLegacyOrder: true })
  assert.deepStrictEqual(
    migratedSessions.map(session => session.id),
    ['session-new', 'session-old', 'provider-old'],
    'legacy migration must sort the full merged provider and CCGUI list once'
  )
  assert.deepStrictEqual(
    projectConfigManager.getProjectSessionOrder(providerProjectId),
    ['session-new', 'session-old', 'provider-old']
  )

  projectConfigManager.setProjectSessionOrder(
    providerProjectId,
    ['provider-old', 'session-new', 'session-old']
  )
  assert.deepStrictEqual(
    projectService.orderProjectSessions(providerProjectId, [
      { id: 'provider-old', updatedAt: '2026-11-17T01:00:00.000Z' },
      { id: 'session-new', updatedAt: '2026-11-17T03:00:00.000Z' },
      { id: 'session-old', updatedAt: '2026-11-17T02:00:00.000Z' }
    ]).map(session => session.id),
    ['provider-old', 'session-new', 'session-old'],
    'migrated projects must ignore updatedAt afterwards'
  )

  console.log('session-order-storage-tests: ok')
}

try {
  run()
} finally {
  fs.rmSync(tempHome, { recursive: true, force: true })
}
