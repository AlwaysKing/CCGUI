const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { buildSync } = require('esbuild')

const eventListeners = new Set()

global.window = {
  electronAPI: {
    onSessionEvent: callback => {
      eventListeners.add(callback)
      return () => eventListeners.delete(callback)
    },
    writeAppLog: async () => ({ success: true }),
    ensureLogDir: async () => ({ success: true, baseDir: '/tmp/ccgui-agent-registry-store-test' }),
    getAppConfig: async () => ({ config: {} }),
    getRunningSessions: async () => ({}),
    notifyPermissionAttention: async () => ({ success: true }),
    playSystemSound: async () => ({ success: true }),
    getRuntimeInitInfo: async () => ({}),
    getSessionState: async () => ({ envInfo: null })
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

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-agent-registry-store-test-'))
const entryFile = path.join(outputDir, 'entry.js')
const outputFile = path.join(outputDir, 'useSessionStore.cjs')
const projectRoot = path.join(__dirname, '..')
const storePath = path.join(projectRoot, 'src', 'stores', 'useSessionStore.js')

fs.writeFileSync(entryFile, [
  "import { createPinia, setActivePinia } from 'pinia'",
  `import { useSessionStore } from ${JSON.stringify(storePath)}`,
  'export { createPinia, setActivePinia, useSessionStore }'
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

const { createPinia, setActivePinia, useSessionStore } = require(outputFile)

function dispatchSessionEvent(event) {
  for (const listener of eventListeners) {
    listener(event)
  }
}

async function run() {
  setActivePinia(createPinia())
  const store = useSessionStore()
  const sessionId = 'agent-registry-store-test-session'

  window.electronAPI.selectSession = async () => ({
    success: true,
    state: {
      messages: [],
      eventLog: [],
      inputAttachments: [],
      inputHistory: [],
      envInfo: null,
      silentMessages: [],
      taskEvents: [],
      subagentHistories: [],
      activeAgentIds: [],
      runtimeReady: false
    }
  })

  await store.initSession(sessionId, '/tmp/ccgui-agent-registry-store-test')
  store.startEventListener()

  const session = store.sessions.get(sessionId)
  const agentId = 'claude-execution-agent'
  const registry = {
    agentId,
    agentKind: 'execution',
    agentType: 'Explore',
    name: 'Explore',
    status: 'running'
  }

  dispatchSessionEvent({
    sessionId,
    eventType: 'task-event',
    data: {
      eventType: 'started',
      taskId: 'execution-task',
      taskType: 'subagent',
      description: 'Explore',
      ccgui: {
        registry,
        orchestration: {
          eventType: 'start',
          agentId,
          agentKind: 'execution',
          agentType: 'Explore',
          status: 'running'
        }
      }
    }
  })

  assert.strictEqual(session.agentRegistry.get(agentId)?.agentKind, 'execution')

  session.subagentHistories = [{
    agentId,
    registry,
    entries: [{
      turnId: 'execution-subagent-turn',
      sourceUserTurnId: 'source-user-turn',
      inputText: 'Explore',
      status: 'streaming',
      registry
    }]
  }]
  session.activeAgentIds.delete(agentId)

  dispatchSessionEvent({
    sessionId,
    eventType: 'result',
    data: {
      turn: {
        id: 'interrupted-main-turn',
        status: 'interrupted'
      }
    }
  })

  const rebuiltAgent = session.agentRegistry.get(agentId)
  assert.strictEqual(
    rebuiltAgent?.agentKind,
    'execution',
    'execution subagent must keep its agentKind when history is rebuilt after interrupt'
  )
  assert.strictEqual(rebuiltAgent?.status, 'interrupted')
  assert.deepStrictEqual(
    store.agentWorkspaceAgents.filter(item => !item.isMain).map(item => item.agentId),
    [],
    'execution subagent must not appear in the collaborative agent rail'
  )
  assert.deepStrictEqual(
    store.collaborativeAgentSessions.filter(item => !item.isMain).map(item => item.agentId),
    [],
    'execution subagent must not become a collaborative session'
  )
  assert(
    store.executionAgentCards.some(card => card.agentId === agentId),
    'execution subagent should remain visible as an execution card'
  )

  console.log('agent-registry-store-tests: ok')
}

run()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    fs.rmSync(outputDir, { recursive: true, force: true })
  })
