const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { buildSync } = require('esbuild')

const batchDeleteCalls = []
const sessionEventListeners = new Set()

global.window = {
  electronAPI: {
    onSessionEvent: callback => {
      sessionEventListeners.add(callback)
      return () => sessionEventListeners.delete(callback)
    },
    onSessionsChanged: () => () => {},
    onInboxChanged: () => () => {},
    ensureLogDir: async () => ({ success: true, baseDir: '/tmp/ccgui-app-store-batch-delete-test' }),
    writeAppLog: async () => ({ success: true }),
    getSessionAvailable: async () => ({ success: true, available: true }),
    markProjectActivitySessionSeen: async () => ({ success: true }),
    getAppConfig: async () => ({ config: {} }),
    notifyPermissionAttention: async () => ({ success: true }),
    playSystemSound: async () => ({ success: true }),
    resizeWindow: async () => ({ success: true }),
    deleteSessions: async options => {
      batchDeleteCalls.push(options)
      return {
        success: false,
        deletedSessionIds: ['session-a'],
        failures: [
          { sessionId: 'session-b', error: 'delete failed' },
          { sessionId: 'missing-session', error: 'not found' }
        ]
      }
    }
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

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-app-store-batch-delete-test-'))
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
    id: 'batch-delete-project',
    path: '/tmp/ccgui-app-store-batch-delete-test'
  }
  appStore.sessions = ['session-a', 'session-b', 'session-c'].map(id => ({
    id,
    projectId: 'batch-delete-project',
    deleted: true,
    settings: {}
  }))

  const result = await appStore.deleteSessions([
    'session-a',
    'session-b',
    'session-b',
    'missing-session'
  ])

  assert.strictEqual(batchDeleteCalls.length, 1, 'batch deletion must use one IPC call')
  assert.deepStrictEqual(batchDeleteCalls[0], {
    sessionIds: ['session-a', 'session-b', 'missing-session'],
    projectId: 'batch-delete-project'
  })
  assert.deepStrictEqual(result.deletedSessionIds, ['session-a'])
  assert.strictEqual(result.failures.length, 2)
  assert.deepStrictEqual(appStore.sessions.map(session => session.id), ['session-b', 'session-c'])
  assert.strictEqual(appStore.error, '有 2 个会话删除失败')

  console.log('app-store-batch-delete-tests: ok')
}

run()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    fs.rmSync(outputDir, { recursive: true, force: true })
  })
