const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { transformSync } = require('esbuild')

const sourcePath = path.join(__dirname, '..', 'src', 'stores', 'systemNotificationOperation.js')
const source = fs.readFileSync(sourcePath, 'utf8')
const transformed = transformSync(source, {
  loader: 'js',
  format: 'cjs',
  platform: 'node'
})
const testModule = { exports: {} }
new Function('module', 'exports', 'require', transformed.code)(testModule, testModule.exports, require)

const {
  findMcpNotificationByOperationId,
  isMcpLifecycleNotificationType,
  isMcpNotificationType,
  shouldIgnoreMcpNotificationUpdate
} = testModule.exports

function createQueue(entries) {
  return { entries }
}

const operationId = 'mcp-startup:codex:thread-1:node_repl'
const startingMessage = {
  id: 'notification-1',
  role: 'system_notification',
  notificationType: 'mcp-server-starting',
  data: { operationId }
}
const unrelatedMessage = {
  id: 'notification-2',
  role: 'system_notification',
  notificationType: 'mcp-server-ready',
  data: { operationId: 'mcp-startup:codex:thread-1:xcode' }
}
const queues = [
  createQueue([unrelatedMessage]),
  createQueue([startingMessage])
]

assert.strictEqual(isMcpNotificationType('mcp-server-starting'), true)
assert.strictEqual(isMcpNotificationType('mcp-server-ready'), true)
assert.strictEqual(isMcpNotificationType('mcp-server-error'), true)
assert.strictEqual(isMcpNotificationType('mcp-server-status'), true)
assert.strictEqual(isMcpNotificationType('session-runtime-ready'), false)
assert.strictEqual(isMcpLifecycleNotificationType('mcp-server-starting'), true)
assert.strictEqual(isMcpLifecycleNotificationType('mcp-server-ready'), true)
assert.strictEqual(isMcpLifecycleNotificationType('mcp-server-error'), true)
assert.strictEqual(isMcpLifecycleNotificationType('mcp-server-status'), false)
assert.strictEqual(shouldIgnoreMcpNotificationUpdate('mcp-server-ready', 'mcp-server-ready'), true)
assert.strictEqual(shouldIgnoreMcpNotificationUpdate('mcp-server-error', 'mcp-server-ready'), true)
assert.strictEqual(shouldIgnoreMcpNotificationUpdate('mcp-server-ready', 'mcp-server-error'), false)
assert.strictEqual(shouldIgnoreMcpNotificationUpdate('mcp-server-starting', 'mcp-server-ready'), false)

assert.strictEqual(findMcpNotificationByOperationId(queues, ''), null)
assert.deepStrictEqual(findMcpNotificationByOperationId(queues, operationId), {
  queue: queues[1],
  message: startingMessage
})
assert.strictEqual(
  findMcpNotificationByOperationId([createQueue([unrelatedMessage])], operationId),
  null
)

console.log('system-notification-operation-tests: ok')
