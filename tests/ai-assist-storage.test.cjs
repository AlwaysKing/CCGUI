const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-ai-assist-storage-test-'))
process.env.HOME = tempHome

const historyManager = require('../electron/storage/history-manager')

async function run() {
  const projectId = 'project-ai-assist'
  const sessionId = 'session-ai-assist'

  historyManager.appendTurn(projectId, sessionId, {
    id: 'user-1',
    role: 'user',
    content: '排查会话摘要',
    serializedContent: '排查会话摘要',
    timestamp: '2026-11-16T01:00:00.000Z'
  })
  historyManager.appendTurn(projectId, sessionId, {
    id: 'internal-1',
    role: 'user',
    content: '内部 Agent 消息',
    serializedContent: '内部 Agent 消息',
    ccgui: {
      internalMessage: {
        senderSessionId: 'other-session'
      }
    },
    timestamp: '2026-11-16T01:01:00.000Z'
  })
  historyManager.appendTurn(projectId, sessionId, {
    id: 'subagent-1',
    role: 'user',
    content: '子代理请求',
    serializedContent: '子代理请求',
    ccgui: {
      attribution: {
        agentId: 'planner'
      }
    },
    timestamp: '2026-11-16T01:02:00.000Z'
  })
  historyManager.appendTurn(projectId, sessionId, {
    id: 'command-1',
    role: 'command',
    content: '/review',
    serializedContent: '/review',
    timestamp: '2026-11-16T01:03:00.000Z'
  })
  historyManager.appendTurn(projectId, sessionId, {
    id: 'user-2',
    role: 'user',
    content: '继续调整终端字体',
    serializedContent: '继续调整终端字体',
    timestamp: '2026-11-16T01:04:00.000Z'
  })

  assert.deepStrictEqual(
    historyManager.listRecentUserMessages(projectId, sessionId, 20),
    ['排查会话摘要', '继续调整终端字体']
  )
  assert.deepStrictEqual(
    historyManager.listRecentUserMessages(projectId, sessionId, 1),
    ['继续调整终端字体']
  )

  const saved = historyManager.updateSessionAiSummary(projectId, sessionId, {
    text: '修复会话摘要并调整终端字体',
    updatedAt: '2026-11-16T02:00:00.000Z',
    model: 'provider/model',
    userMessageCount: 2
  })
  assert.strictEqual(saved.text, '修复会话摘要并调整终端字体')
  assert.deepStrictEqual(
    historyManager.loadSessionAiSummary(projectId, sessionId),
    {
      text: '修复会话摘要并调整终端字体',
      updatedAt: '2026-11-16T02:00:00.000Z',
      model: 'provider/model',
      userMessageCount: 2
    }
  )

  console.log('ai-assist-storage-tests: ok')
}

run()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    fs.rmSync(tempHome, { recursive: true, force: true })
  })
