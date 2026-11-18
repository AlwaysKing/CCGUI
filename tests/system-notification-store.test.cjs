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
    ensureLogDir: async () => ({ success: true, baseDir: '/tmp/ccgui-notification-store-test' }),
    getAppConfig: async () => ({ config: {} }),
    getRunningSessions: async () => ({}),
    notifyPermissionAttention: async () => ({ success: true }),
    playSystemSound: async () => ({ success: true })
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

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-notification-store-test-'))
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

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function run() {
  setActivePinia(createPinia())
  const store = useSessionStore()
  const sessionId = 'notification-store-test-session'

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
  window.electronAPI.getRuntimeInitInfo = async () => ({})
  window.electronAPI.getSessionState = async () => ({ envInfo: null })

  await store.initSession(sessionId, '/tmp/ccgui-notification-store-test')
  store.startEventListener()

  const session = store.sessions.get(sessionId)

  // starting 在子代理队列，ready 不带归属时也必须更新原消息。
  const crossQueueOperationId = 'mcp-startup:codex:thread-cross-queue:node_repl'
  dispatchSessionEvent({
    sessionId,
    eventType: 'system-notification',
    data: {
      type: 'mcp-server-starting',
      provider: 'codex',
      name: 'node_repl',
      status: 'starting',
      operationId: crossQueueOperationId,
      startedAt: Date.now(),
      ccgui: {
        attribution: {
          agentId: 'codex-agent:child-thread'
        }
      }
    }
  })
  dispatchSessionEvent({
    sessionId,
    eventType: 'system-notification',
    data: {
      type: 'mcp-server-ready',
      provider: 'codex',
      name: 'node_repl',
      status: 'ready',
      operationId: crossQueueOperationId
    }
  })

  await wait(760)

  const mainQueue = session.queueManager.getQueue(session.mainAgentId)
  const childQueue = session.queueManager.getQueue('codex-agent:child-thread')
  const childNotifications = childQueue.entries.filter(message =>
    message.data?.operationId === crossQueueOperationId
  )
  assert.strictEqual(mainQueue.entries.filter(message => message.data?.operationId === crossQueueOperationId).length, 0)
  assert.strictEqual(childNotifications.length, 1)
  assert.strictEqual(childNotifications[0].notificationType, 'mcp-server-ready')
  assert.strictEqual(childNotifications[0].scope, 'turn')

  // turn-completed 快照必须复用实时通知的规范消息 ID，不能追加第二条 MCP 通知。
  const snapshotOperationId = 'mcp-startup:codex:thread-main:node_repl:snapshot'
  const snapshotMessageId = 'system-notification-mcp-snapshot-test'
  const snapshotStartedAt = Date.now() - 1000
  dispatchSessionEvent({
    sessionId,
    eventType: 'system-notification',
    data: {
      type: 'mcp-server-starting',
      provider: 'codex',
      name: 'node_repl',
      status: 'starting',
      operationId: snapshotOperationId,
      messageId: snapshotMessageId,
      startedAt: snapshotStartedAt
    }
  })
  dispatchSessionEvent({
    sessionId,
    eventType: 'system-notification',
    data: {
      type: 'mcp-server-ready',
      provider: 'codex',
      name: 'node_repl',
      status: 'ready',
      operationId: snapshotOperationId,
      messageId: snapshotMessageId,
      completedAt: snapshotStartedAt + 900,
      durationMs: 900
    }
  })

  await wait(760)

  const liveSnapshotNotifications = mainQueue.entries.filter(message =>
    message.data?.operationId === snapshotOperationId
  )
  assert.strictEqual(liveSnapshotNotifications.length, 1)
  assert.strictEqual(liveSnapshotNotifications[0].id, snapshotMessageId)
  assert.strictEqual(liveSnapshotNotifications[0].notificationType, 'mcp-server-ready')
  assert.strictEqual(liveSnapshotNotifications[0].data.durationMs, 900)

  dispatchSessionEvent({
    sessionId,
    eventType: 'message-snapshot',
    data: {
      reason: 'turn-completed',
      message: {
        id: snapshotMessageId,
        role: 'system_notification',
        notificationType: 'mcp-server-ready',
        scope: 'session',
        data: {
          type: 'mcp-server-ready',
          provider: 'codex',
          name: 'node_repl',
          status: 'ready',
          operationId: snapshotOperationId,
          startedAt: snapshotStartedAt,
          completedAt: snapshotStartedAt + 900,
          durationMs: 900
        },
        timestamp: new Date()
      }
    }
  })

  const snapshotNotificationsAfterTurn = mainQueue.entries.filter(message =>
    message.data?.operationId === snapshotOperationId
  )
  assert.strictEqual(snapshotNotificationsAfterTurn.length, 1)
  assert.strictEqual(snapshotNotificationsAfterTurn[0].id, snapshotMessageId)
  assert.strictEqual(snapshotNotificationsAfterTurn[0].data.durationMs, 900)

  // 同一 server 的不同启动周期使用不同 operationId，必须各自保留一条。
  const firstCycleOperationId = 'mcp-startup:codex:thread-main:node_repl:cycle-1'
  const secondCycleOperationId = 'mcp-startup:codex:thread-main:node_repl:cycle-2'
  for (const operationId of [firstCycleOperationId, secondCycleOperationId]) {
    dispatchSessionEvent({
      sessionId,
      eventType: 'system-notification',
      data: {
        type: 'mcp-server-starting',
        provider: 'codex',
        name: 'node_repl',
        status: 'starting',
        operationId,
        startedAt: Date.now() - 1000
      }
    })
    dispatchSessionEvent({
      sessionId,
      eventType: 'system-notification',
      data: {
        type: 'mcp-server-ready',
        provider: 'codex',
        name: 'node_repl',
        status: 'ready',
        operationId
      }
    })
  }
  await wait(0)
  const repeatedCycleNotifications = mainQueue.entries.filter(message =>
    [firstCycleOperationId, secondCycleOperationId].includes(message.data?.operationId)
  )
  assert.strictEqual(repeatedCycleNotifications.length, 2)
  assert(repeatedCycleNotifications.every(message => message.notificationType === 'mcp-server-ready'))

  // starting → error → ready 都落在 700ms 展示窗口内时，后到的 ready 不得覆盖 error。
  const raceOperationId = 'mcp-startup:codex:thread-main:rea'
  dispatchSessionEvent({
    sessionId,
    eventType: 'system-notification',
    data: {
      type: 'mcp-server-starting',
      provider: 'codex',
      name: 'rea',
      status: 'starting',
      operationId: raceOperationId,
      startedAt: Date.now()
    }
  })
  dispatchSessionEvent({
    sessionId,
    eventType: 'system-notification',
    data: {
      type: 'mcp-server-error',
      provider: 'codex',
      name: 'rea',
      status: 'error',
      operationId: raceOperationId,
      error: { message: 'startup failed' }
    }
  })
  dispatchSessionEvent({
    sessionId,
    eventType: 'system-notification',
    data: {
      type: 'mcp-server-ready',
      provider: 'codex',
      name: 'rea',
      status: 'ready',
      operationId: raceOperationId
    }
  })

  await wait(820)

  const mainNotifications = mainQueue.entries.filter(message =>
    message.data?.operationId === raceOperationId
  )
  assert.strictEqual(mainNotifications.length, 1)
  assert.strictEqual(mainNotifications[0].notificationType, 'mcp-server-error')
  assert.strictEqual(mainNotifications[0].scope, 'session')

  // 终态重复 ready 不再追加。
  dispatchSessionEvent({
    sessionId,
    eventType: 'system-notification',
    data: {
      type: 'mcp-server-ready',
      provider: 'codex',
      name: 'rea',
      status: 'ready',
      operationId: raceOperationId
    }
  })
  assert.strictEqual(mainQueue.entries.filter(message => message.data?.operationId === raceOperationId).length, 1)

  store.stopEventListener()
  console.log('system-notification-store-tests: ok')
}

run()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    fs.rmSync(outputDir, { recursive: true, force: true })
  })
