const assert = require('assert')
const { resolveSessionBindingMeta } = require('../electron/services/project-service')

const codexSession = {
  id: 'ccgui-session',
  settings: {
    tool: 'codex',
    toolBinding: {
      tool: 'codex',
      nativeSessionId: 'codex-thread'
    }
  }
}

assert.deepStrictEqual(
  resolveSessionBindingMeta({ id: 'plain-session', settings: {} }),
  {
    bindingState: 'none',
    bindingLabel: '',
    bindingMissing: false
  }
)

assert.deepStrictEqual(
  resolveSessionBindingMeta({
    id: 'new-session',
    settings: {
      tool: 'codex',
      toolBinding: {
        tool: 'codex',
        nativeSessionId: null
      }
    }
  }),
  {
    bindingState: 'pending',
    bindingLabel: '待启动 Codex',
    bindingMissing: false
  }
)

assert.deepStrictEqual(
  resolveSessionBindingMeta(codexSession, { id: 'codex-thread' }, false),
  {
    bindingState: 'linked',
    bindingLabel: '',
    bindingMissing: false
  }
)

assert.deepStrictEqual(
  resolveSessionBindingMeta(codexSession, null, true),
  {
    bindingState: 'missing',
    bindingLabel: 'Codex 绑定失效',
    bindingMissing: true
  }
)

assert.deepStrictEqual(
  resolveSessionBindingMeta(codexSession, null, false),
  {
    bindingState: 'unknown',
    bindingLabel: '',
    bindingMissing: false
  }
)

console.log('session-binding-state-tests: ok')
