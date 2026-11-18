const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { buildSync } = require('esbuild')

const sessionEventListeners = new Set()

global.window = {
  electronAPI: {
    onSessionEvent: callback => {
      sessionEventListeners.add(callback)
      return () => sessionEventListeners.delete(callback)
    },
    onSessionsChanged: () => () => {},
    onInboxChanged: () => () => {},
    ensureLogDir: async () => ({ success: true, baseDir: '/tmp/ccgui-session-selection-sort-test' }),
    writeAppLog: async () => ({ success: true }),
    getSessionAvailable: async () => ({ success: true, available: true }),
    markProjectActivitySessionSeen: async () => ({ success: true }),
    getAppConfig: async () => ({ config: {} }),
    notifyPermissionAttention: async () => ({ success: true }),
    playSystemSound: async () => ({ success: true }),
    resizeWindow: async () => ({ success: true })
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

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-session-selection-sort-test-'))
const entryFile = path.join(outputDir, 'entry.js')
const outputFile = path.join(outputDir, 'sessionStores.cjs')
const projectRoot = path.join(__dirname, '..')
const appStorePath = path.join(projectRoot, 'src', 'stores', 'useAppStore.js')
const sessionStorePath = path.join(projectRoot, 'src', 'stores', 'useSessionStore.js')

fs.writeFileSync(entryFile, [
  "import { createPinia, setActivePinia } from 'pinia'",
  `import { useAppStore } from ${JSON.stringify(appStorePath)}`,
  `import { useSessionStore } from ${JSON.stringify(sessionStorePath)}`,
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

const {
  createPinia,
  setActivePinia,
  useAppStore,
  useSessionStore
} = require(outputFile)

async function run() {
  setActivePinia(createPinia())

  const appStore = useAppStore()
  const sessionStore = useSessionStore()
  const originalUpdatedAt = '2026-11-15T10:00:00.000Z'
  const session = {
    id: 'selection-sort-session',
    projectId: 'selection-sort-project',
    name: '普通会话',
    updatedAt: originalUpdatedAt,
    createdAt: '2026-11-01T00:00:00.000Z',
    deleted: false,
    settings: {}
  }

  appStore.currentProject = {
    id: session.projectId,
    path: '/tmp/ccgui-session-selection-sort'
  }
  appStore.sessions = [session]
  sessionStore.switchToSession = async () => null

  await appStore.selectSession(session)

  assert.strictEqual(
    appStore.sessionStatuses[session.id].updatedAt,
    null,
    'selecting a session must not create a synthetic activity timestamp'
  )
  assert.strictEqual(
    appStore.currentProjectSessions.find(item => item.id === session.id).updatedAt,
    originalUpdatedAt,
    'UI status creation must not overwrite the persisted session activity time'
  )

  const messageTimestamp = '2026-11-15T12:30:00.000Z'
  for (const listener of sessionEventListeners) {
    listener({
      sessionId: session.id,
      eventType: 'message',
      data: {
        role: 'assistant',
        timestamp: messageTimestamp,
        ccgui: { attribution: { agentId: 'master' } }
      }
    })
  }

  assert.strictEqual(
    appStore.sessionStatuses[session.id].updatedAt,
    messageTimestamp,
    'actual message activity should still update the timestamp'
  )
  assert.strictEqual(
    appStore.currentProjectSessions.find(item => item.id === session.id).updatedAt,
    messageTimestamp,
    'actual message activity should still update runtime metadata'
  )

  console.log('session-selection-sort-tests: ok')
}

run()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    fs.rmSync(outputDir, { recursive: true, force: true })
  })
