const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-history-test-'))
process.env.HOME = tempHome

const historyManager = require('../../electron/storage/history-manager')
const { SessionInstance } = require('../../electron/session/session-instance')

function readJsonLines(filePath) {
  const raw = fs.readFileSync(filePath, 'utf8').trim()
  if (!raw) {
    return []
  }
  return raw.split('\n').map(line => JSON.parse(line))
}

function cleanup() {
  fs.rmSync(tempHome, { recursive: true, force: true })
}

function createSession() {
  return new SessionInstance(`test-session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, '/tmp/ccgui-history-project', null)
}

function emitCollaborativeFlow(session) {
  session.emit('silent-message', {
    id: 'agent-registry-1',
    timestamp: '2026-04-08T10:00:00.000Z',
    ccgui: {
      registry: {
        agentId: 'planner-agent',
        name: 'planner',
        agentKind: 'collaborative'
      }
    }
  })

  session.emit('message', {
    id: 'user-turn-1',
    role: 'user',
    content: 'Plan this task',
    serializedContent: 'Plan this task',
    attachments: [],
    timestamp: '2026-04-08T10:00:01.000Z'
  })

  session.emit('message-start', {
    id: 'tool-send-1',
    role: 'tool_use',
    toolName: 'SendMessage',
    toolInput: {
      to: 'planner',
      content: 'Break the task into steps'
    },
    timestamp: '2026-04-08T10:00:02.000Z',
    ccgui: {
      attribution: {
        agentId: 'master'
      }
    }
  })

  session.emit('message-start', {
    id: 'tool-receive-1',
    role: 'tool_use',
    toolName: 'ReceiveMessage',
    toolInput: {
      from: 'master',
      content: 'Break the task into steps'
    },
    timestamp: '2026-04-08T10:00:03.000Z',
    ccgui: {
      attribution: {
        agentId: 'planner-agent'
      }
    }
  })

  session.emit('message-start', {
    id: 'assistant-sub-1',
    role: 'assistant',
    content: 'Step 1, Step 2',
    isStreaming: false,
    timestamp: '2026-04-08T10:00:04.000Z',
    ccgui: {
      attribution: {
        agentId: 'planner-agent'
      }
    }
  })

  session.emit('message', {
    id: 'user-turn-2',
    role: 'user',
    content: 'Refine step 1',
    serializedContent: 'Refine step 1',
    attachments: [],
    timestamp: '2026-04-08T10:00:05.000Z',
    ccgui: {
      attribution: {
        agentId: 'planner-agent'
      }
    }
  })
}

function testMainHistoryStructure() {
  const session = createSession()
  emitCollaborativeFlow(session)

  const historyDir = historyManager.getSessionHistoryDir(session.projectId, session.id)
  const historyFiles = fs.readdirSync(historyDir).sort()
  assert.deepStrictEqual(historyFiles, ['index.jsonl', 'metadata.json', 'subagents', 'turns'])

  const indexEntries = historyManager.loadIndexEntries(session.projectId, session.id)
  assert.strictEqual(indexEntries.length, 2, 'main history should only contain user-visible turn anchors')
  assert.deepStrictEqual(
    indexEntries.map(entry => entry.turnId),
    ['user-turn-1', 'user-turn-2']
  )

  const mainTurn1Events = historyManager.loadTurnEvents(session.projectId, session.id, 'user-turn-1')
  assert.strictEqual(mainTurn1Events.length, 1, 'subagent collaboration events must not pollute main turn stream')
  assert.strictEqual(mainTurn1Events[0].data.role, 'user')

  const mainTurn2Events = historyManager.loadTurnEvents(session.projectId, session.id, 'user-turn-2')
  assert.strictEqual(mainTurn2Events.length, 1)
  assert.strictEqual(mainTurn2Events[0].data.ccgui.history.inputKind, 'direct_user')
}

function testSubagentHistoryStructure() {
  const session = createSession()
  emitCollaborativeFlow(session)

  const subagentDir = historyManager.getSubagentHistoryDir(session.projectId, session.id, 'planner-agent')
  const subagentFiles = fs.readdirSync(subagentDir).sort()
  assert.deepStrictEqual(subagentFiles, ['index.jsonl', 'turns'])

  const indexEntries = historyManager.loadSubagentIndexEntries(session.projectId, session.id, 'planner-agent')
  assert.strictEqual(indexEntries.length, 2, 'subagent should have one delegated turn and one direct-user turn')

  const delegatedTurn = indexEntries.find(entry => entry.inputKind === 'delegated_context')
  const directUserTurn = indexEntries.find(entry => entry.inputKind === 'direct_user')

  assert(delegatedTurn, 'delegated subagent turn should exist')
  assert(directUserTurn, 'direct user subagent turn should exist')
  assert.strictEqual(delegatedTurn.sourceUserTurnId, 'user-turn-1')
  assert.strictEqual(delegatedTurn.inputText, 'Plan this task')
  assert.strictEqual(directUserTurn.sourceUserTurnId, 'user-turn-2')
  assert.strictEqual(directUserTurn.inputText, 'Refine step 1')

  const delegatedEvents = historyManager.loadSubagentTurnEvents(
    session.projectId,
    session.id,
    'planner-agent',
    delegatedTurn.turnId
  )
  assert.deepStrictEqual(
    delegatedEvents.map(event => `${event.eventType}:${event.data.toolName || event.data.role}`),
    ['message-start:SendMessage', 'message-start:ReceiveMessage', 'message-start:assistant']
  )

  const directUserEvents = historyManager.loadSubagentTurnEvents(
    session.projectId,
    session.id,
    'planner-agent',
    directUserTurn.turnId
  )
  assert.strictEqual(directUserEvents.length, 1)
  assert.strictEqual(directUserEvents[0].data.role, 'user')
}

function testIndexJsonlIsJsonLines() {
  const session = createSession()
  emitCollaborativeFlow(session)

  const indexFile = historyManager.getIndexFilePath(session.projectId, session.id)
  const parsedLines = readJsonLines(indexFile)
  assert.strictEqual(parsedLines.length, 2)
  assert(parsedLines.every(entry => entry.entryType === 'turn'))

  const allSubagentHistories = historyManager.loadAllSubagentHistories(session.projectId, session.id)
  assert.strictEqual(allSubagentHistories.length, 1)
  assert.strictEqual(allSubagentHistories[0].agentId, 'planner-agent')
  assert.strictEqual(allSubagentHistories[0].registry.name, 'planner')
  assert.strictEqual(allSubagentHistories[0].registry.agentKind, 'collaborative')
  assert.strictEqual(allSubagentHistories[0].entries.length, 2)
  assert.strictEqual(Object.prototype.hasOwnProperty.call(allSubagentHistories[0].entries[0], 'events'), false)
}

function run() {
  try {
    testMainHistoryStructure()
    testSubagentHistoryStructure()
    testIndexJsonlIsJsonLines()
    console.log('history storage tests passed')
  } finally {
    cleanup()
  }
}

run()
