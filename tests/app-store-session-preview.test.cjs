const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { buildSync } = require('esbuild')

const previewListeners = new Set()

global.window = {
  electronAPI: {
    onSessionEvent: () => () => {},
    onSessionsChanged: () => () => {},
    onSessionPreviewUpdated: callback => {
      previewListeners.add(callback)
      return () => previewListeners.delete(callback)
    },
    onInboxChanged: () => () => {},
    ensureLogDir: async () => ({ success: true, baseDir: '/tmp/ccgui-app-store-session-preview-test' }),
    writeAppLog: async () => ({ success: true }),
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

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-app-store-session-preview-test-'))
const entryFile = path.join(outputDir, 'entry.js')
const outputFile = path.join(outputDir, 'appStore.cjs')
const projectRoot = path.join(__dirname, '..')
const appStorePath = path.join(projectRoot, 'src', 'stores', 'useAppStore.js')

fs.writeFileSync(entryFile, [
  "import { createPinia, setActivePinia } from 'pinia'",
  `import { useAppStore } from ${JSON.stringify(appStorePath)}`,
  'export { createPinia, setActivePinia, useAppStore }'
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

const { createPinia, setActivePinia, useAppStore } = require(outputFile)

async function run() {
  setActivePinia(createPinia())
  const appStore = useAppStore()
  const session = {
    id: 'session-preview',
    projectId: 'project-preview',
    preview: '旧摘要',
    deleted: false,
    settings: {}
  }

  appStore.currentProject = {
    id: session.projectId,
    path: '/tmp/ccgui-session-preview-test'
  }
  appStore.sessions = [session]
  appStore.currentSession = session

  for (const listener of previewListeners) {
    listener({
      projectId: session.projectId,
      sessionId: session.id,
      preview: '新的 AI 会话摘要'
    })
  }

  assert.strictEqual(appStore.sessions[0].preview, '新的 AI 会话摘要')
  assert.strictEqual(appStore.currentSession.preview, '新的 AI 会话摘要')
  console.log('app-store-session-preview-tests: ok')
}

run()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    fs.rmSync(outputDir, { recursive: true, force: true })
  })
