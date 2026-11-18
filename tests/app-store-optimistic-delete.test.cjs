const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { buildSync } = require('esbuild')

const deleteCalls = []
let deleteSessionsImpl = null
let softDeleteSessionImpl = null
let destroyTeamImpl = null
const sessionEventListeners = new Set()

global.window = {
  electronAPI: {
    onSessionEvent: callback => {
      sessionEventListeners.add(callback)
      return () => sessionEventListeners.delete(callback)
    },
    onSessionsChanged: () => () => {},
    onInboxChanged: () => () => {},
    ensureLogDir: async () => ({ success: true, baseDir: '/tmp/ccgui-app-store-optimistic-delete-test' }),
    writeAppLog: async () => ({ success: true }),
    getSessionAvailable: async () => ({ success: true, available: true }),
    markProjectActivitySessionSeen: async () => ({ success: true }),
    getAppConfig: async () => ({ config: {} }),
    notifyPermissionAttention: async () => ({ success: true }),
    playSystemSound: async () => ({ success: true }),
    resizeWindow: async () => ({ success: true }),
    deleteSessions: options => {
      deleteCalls.push(options)
      return deleteSessionsImpl(options)
    },
    softDeleteSession: options => softDeleteSessionImpl(options),
    destroyTeam: options => destroyTeamImpl(options)
  },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true
}
global.localStorage = {
  getItem: () => null,
  setItem: () => {},
  removeItem: () => {}
}
global.CustomEvent = class CustomEvent {
  constructor(type, options = {}) {
    this.type = type
    this.detail = options.detail
  }
}

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-app-store-optimistic-delete-test-'))
const entryFile = path.join(outputDir, 'entry.js')
const outputFile = path.join(outputDir, 'stores.cjs')
const projectRoot = path.join(__dirname, '..')

fs.writeFileSync(entryFile, [
  "import { createPinia, setActivePinia } from 'pinia'",
  `import { useAppStore } from ${JSON.stringify(path.join(projectRoot, 'src/stores/useAppStore.js'))}`,
  `import { useSessionStore } from ${JSON.stringify(path.join(projectRoot, 'src/stores/useSessionStore.js'))}`,
  'export { createPinia, setActivePinia, useAppStore, useSessionStore }'
].join('\n'))

buildSync({
  entryPoints: [entryFile],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: outputFile,
  absWorkingDir: projectRoot,
  nodePaths: [path.join(projectRoot, 'node_modules')],
  logLevel: 'silent'
})

function buildSession(id, deleted = true) {
  return {
    id,
    projectId: 'optimistic-delete-project',
    deleted,
    deletedAt: deleted ? new Date().toISOString() : null,
    settings: {}
  }
}

function waitForEventLoop() {
  return new Promise(resolve => setImmediate(resolve))
}

function deferred() {
  let resolve
  let reject
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

async function run() {
  const {
    createPinia,
    setActivePinia,
    useAppStore,
    useSessionStore
  } = require(outputFile)

  setActivePinia(createPinia())
  const appStore = useAppStore()
  const sessionStore = useSessionStore()
  sessionStore.closeSession = async () => {}

  appStore.currentProject = {
    id: 'optimistic-delete-project',
    path: '/tmp/ccgui-app-store-optimistic-delete-test'
  }
  appStore.showRecycleBin = true

  const deleteDeferred = deferred()
  deleteSessionsImpl = () => deleteDeferred.promise
  appStore.sessions = [
    buildSession('session-a'),
    buildSession('session-b'),
    buildSession('session-c')
  ]

  const deletePromise = appStore.deleteSessions(
    ['session-a', 'session-b'],
    { optimistic: true }
  )

  assert.deepStrictEqual(
    appStore.currentProjectSessions.map(session => session.id),
    ['session-c'],
    'optimistic deletion must hide sessions before the IPC finishes'
  )
  assert.strictEqual(appStore.isLoading, false, 'optimistic deletion must not block global loading state')

  deleteDeferred.resolve({
    success: true,
    deletedSessionIds: ['session-a', 'session-b'],
    failures: [],
    warnings: [{
      sessionId: 'session-b',
      provider: 'codex',
      error: 'mock provider warning',
      type: 'provider-delete-failed'
    }]
  })
  const deleteResult = await deletePromise

  assert.deepStrictEqual(appStore.sessions.map(session => session.id), ['session-c'])
  assert.strictEqual(deleteResult.warnings.length, 1)
  assert.strictEqual(deleteCalls.length, 1)
  assert.deepStrictEqual(deleteCalls[0], {
    sessionIds: ['session-a', 'session-b'],
    projectId: 'optimistic-delete-project'
  })

  const partialDeferred = deferred()
  deleteSessionsImpl = () => partialDeferred.promise
  appStore.sessions = [
    buildSession('session-a'),
    buildSession('session-b'),
    buildSession('session-c')
  ]

  const partialPromise = appStore.deleteSessions(
    ['session-a', 'session-b'],
    { optimistic: true }
  )

  assert.deepStrictEqual(
    appStore.currentProjectSessions.map(session => session.id),
    ['session-c'],
    'partial deletion failures are hidden until the backend responds'
  )

  partialDeferred.resolve({
    success: false,
    deletedSessionIds: ['session-a'],
    failures: [{ sessionId: 'session-b', error: 'mock delete failure' }]
  })
  const partialResult = await partialPromise

  assert.deepStrictEqual(partialResult.failures, [
    { sessionId: 'session-b', error: 'mock delete failure' }
  ])
  assert.deepStrictEqual(
    appStore.currentProjectSessions.map(session => session.id),
    ['session-b', 'session-c'],
    'failed sessions must be restored to the visible list'
  )

  deleteSessionsImpl = async () => {
    throw new Error('mock IPC failure')
  }
  appStore.sessions = [
    buildSession('session-a'),
    buildSession('session-b')
  ]

  const rejectedPromise = appStore.deleteSessions(
    ['session-a'],
    { optimistic: true }
  )

  assert.deepStrictEqual(
    appStore.currentProjectSessions.map(session => session.id),
    ['session-b']
  )
  await assert.rejects(rejectedPromise, /mock IPC failure/)
  assert.deepStrictEqual(
    appStore.currentProjectSessions.map(session => session.id),
    ['session-a', 'session-b'],
    'rejected deletions must restore the visible session list'
  )

  const softDeleteDeferred = deferred()
  softDeleteSessionImpl = () => softDeleteDeferred.promise
  appStore.showRecycleBin = false
  appStore.sessions = [
    buildSession('session-a', false),
    buildSession('session-b', false)
  ]

  const softDeletePromise = appStore.softDeleteSession(
    'session-a',
    { optimistic: true }
  )

  assert.deepStrictEqual(
    appStore.currentProjectSessions.map(session => session.id),
    ['session-b'],
    'soft deletion must hide the session immediately'
  )

  softDeleteDeferred.resolve({
    success: true,
    session: { deletedAt: new Date().toISOString() }
  })
  await softDeletePromise
  appStore.showRecycleBin = true

  assert.deepStrictEqual(
    appStore.currentProjectSessions.map(session => session.id),
    ['session-a'],
    'successfully soft-deleted sessions must become available in the recycle bin'
  )

  appStore.showRecycleBin = false
  appStore.sessions = [
    { ...buildSession('session-a', false), teamId: 'team-a' },
    { ...buildSession('session-b', false), teamId: 'team-a' },
    buildSession('session-c', false)
  ]
  destroyTeamImpl = async () => ({
    success: false,
    error: 'mock destroy failure'
  })

  const destroyTeamPromise = appStore.destroyTeam(
    'optimistic-delete-project',
    'team-a',
    { optimistic: true }
  )

  assert.deepStrictEqual(
    appStore.currentProjectSessions.map(session => session.id),
    ['session-c'],
    'destroying a team must hide its sessions immediately'
  )
  await assert.rejects(destroyTeamPromise, /mock destroy failure/)
  assert.deepStrictEqual(
    appStore.currentProjectSessions.map(session => session.id),
    ['session-a', 'session-b', 'session-c'],
    'failed team destruction must restore all team sessions'
  )

  console.log('app-store-optimistic-delete-tests: ok')
}

run()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    fs.rmSync(outputDir, { recursive: true, force: true })
  })
