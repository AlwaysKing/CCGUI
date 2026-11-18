const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { EventEmitter } = require('events')

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-history-test-'))
process.env.HOME = tempHome

const historyManager = require('../../electron/storage/history-manager')
const { SessionInstance } = require('../../electron/session/session-instance')
const { CodexAdapter } = require('../../electron/adapters/codex/adapter')

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

function flushHistoryWrites() {
  return new Promise(resolve => setImmediate(resolve))
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

async function testMainHistoryStructure() {
  const session = createSession()
  emitCollaborativeFlow(session)
  await flushHistoryWrites()

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

async function testSubagentHistoryStructure() {
  const session = createSession()
  emitCollaborativeFlow(session)
  await flushHistoryWrites()

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

  session.emit('silent-message', {
    messageType: 'agent-orchestration',
    ccgui: {
      registry: {
        agentId: 'planner-agent',
        agentKind: 'collaborative',
        status: 'ended'
      },
      orchestration: {
        eventType: 'end',
        agentId: 'planner-agent',
        agentKind: 'collaborative',
        status: 'ended'
      }
    }
  })
  await flushHistoryWrites()

  const updatedEntries = historyManager.loadSubagentIndexEntries(
    session.projectId,
    session.id,
    'planner-agent'
  )
  const endedTurn = updatedEntries.find(entry => entry.turnId === directUserTurn.turnId)
  assert.strictEqual(endedTurn.status, 'completed')
  assert.strictEqual(endedTurn.registry.status, 'ended')
}

async function testIndexJsonlIsJsonLines() {
  const session = createSession()
  emitCollaborativeFlow(session)
  await flushHistoryWrites()

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

async function testTargetedSubagentMessageKeepsMainProcessingIdle() {
  const session = createSession()
  const sentMessages = []
  session.runtimeManager = {
    isReady: () => true,
    sendMessage: async message => {
      sentMessages.push(message)
    }
  }

  await session.sendMessage({
    text: 'Continue child task',
    attachments: [],
    ccgui: {
      attribution: {
        agentId: 'planner-agent',
        actorId: 'planner-agent'
      }
    }
  })

  assert.strictEqual(session.isProcessing, false, 'targeted subagent send must not mark the main turn active')
  assert.deepStrictEqual(session.getActiveAgentIds(), ['planner-agent'])
  assert.strictEqual(sentMessages.length, 1)
  assert.strictEqual(sentMessages[0].ccgui.attribution.agentId, 'planner-agent')
}

async function testUnloadTurnReleasesSessionAndRuntimeCaches() {
  const session = createSession()
  const turnId = 'user-turn-unload'
  const releasedCaches = []
  const userMessage = {
    id: turnId,
    role: 'user',
    content: 'Unload this turn',
    serializedContent: 'Unload this turn',
    attachments: [],
    timestamp: new Date()
  }
  const assistantMessage = {
    id: 'assistant-unload',
    role: 'assistant',
    content: 'Finished answer',
    isStreaming: false,
    timestamp: new Date()
  }

  session.messages = [userMessage, assistantMessage]
  session.runtimeManager = {
    releaseTurnCaches: payload => releasedCaches.push(payload)
  }
  session.emit('message', userMessage)
  session.emit('message-start', {
    ...assistantMessage,
    isStreaming: true
  })
  session.emit('message-delta', {
    messageId: assistantMessage.id,
    field: 'content',
    delta: 'Finished answer'
  })
  session.emit('message-complete', {
    messageId: assistantMessage.id,
    updates: { isStreaming: false }
  })
  await historyManager.finalizeTurn(session.projectId, session.id, turnId)

  const result = await session.unloadHistoryTurns([turnId])
  assert.deepStrictEqual(result.unloadedTurnIds, [turnId])
  assert.strictEqual(session.messages.length, 1)
  assert.strictEqual(session.messages[0].id, turnId)
  assert.strictEqual(session.messages[0].historyTurn.loaded, false)
  assert(releasedCaches.length > 0, 'runtime turn caches should be released')
  assert(releasedCaches[0].turnIds.includes(turnId))
  assert.strictEqual(
    session.eventLog.some(event => event?.data?.messageId === assistantMessage.id),
    false,
    'turn streaming events must be removed from replay log'
  )

  const storedEvents = historyManager.loadTurnEvents(session.projectId, session.id, turnId)
  assert(storedEvents.length > 0, 'persisted turn events must remain on disk')
  assert.strictEqual(
    historyManager.loadIndexEntries(session.projectId, session.id)[0].turnId,
    turnId
  )
}

function testCodexTurnCacheCleanup() {
  const adapter = new CodexAdapter('/tmp/ccgui-codex-cache-test', 'cache-test')
  const turnId = 'turn-cache'
  const userMessageUuid = 'user-cache'

  adapter.turnStats.set(turnId, { numTurns: 1 })
  adapter.turnAssistantState.set(turnId, { messageId: 'assistant-cache' })
  adapter.turnMessageMap.set(turnId, 'assistant-cache')
  adapter.turnDiffMessageMap.set(turnId, 'diff-cache')
  adapter.turnUserMessageUuids.set(turnId, userMessageUuid)
  adapter.turnPatchFiles.set(turnId, new Set(['src/file.js']))
  adapter.turnPatchSections.set(userMessageUuid, new Map([['src/file.js', 'diff']]))
  adapter.itemTurnIds.set('item-cache', turnId)
  adapter.itemState.set('item-cache', { id: 'item-cache' })
  adapter.itemToMessageMap.set('item-cache', 'assistant-cache')

  adapter.finalizeTurnCaches(turnId, userMessageUuid)

  assert.strictEqual(adapter.turnStats.has(turnId), false)
  assert.strictEqual(adapter.turnAssistantState.has(turnId), false)
  assert.strictEqual(adapter.turnMessageMap.has(turnId), false)
  assert.strictEqual(adapter.turnDiffMessageMap.has(turnId), false)
  assert.strictEqual(adapter.turnUserMessageUuids.has(turnId), false)
  assert.strictEqual(adapter.turnPatchFiles.has(turnId), false)
  assert.strictEqual(adapter.turnPatchSections.has(userMessageUuid), false)
  assert.strictEqual(adapter.itemTurnIds.has('item-cache'), false)
  assert.strictEqual(adapter.itemState.has('item-cache'), false)
  assert.strictEqual(adapter.itemToMessageMap.has('item-cache'), false)
}

async function testFinalizeTurnFlushesBufferedToolUpdate() {
  const session = createSession()
  const turnId = 'user-turn-tool-cache'
  session.emit('message', {
    id: turnId,
    role: 'user',
    content: 'Run command',
    serializedContent: 'Run command',
    attachments: [],
    timestamp: new Date()
  })
  session.emit('message-start', {
    id: 'tool-cache',
    role: 'tool_use',
    toolName: 'Bash',
    toolInput: { command: 'pwd' },
    isExecuting: true,
    timestamp: new Date()
  })
  session.emit('message-update', {
    messageId: 'tool-cache',
    updates: {
      isExecuting: false,
      result: '/tmp'
    }
  })

  await historyManager.finalizeTurn(session.projectId, session.id, turnId)

  const events = historyManager.loadTurnEvents(session.projectId, session.id, turnId)
  const updateEvent = events.find(event =>
    event.eventType === 'message-update' && event.data?.messageId === 'tool-cache'
  )
  assert(updateEvent, 'buffered tool update should be persisted without loss')
  assert.strictEqual(updateEvent.data.updates.result, '/tmp')
}

async function testBatchedDeltasAndToolSnapshot() {
  const session = createSession()
  const sentEvents = []
  session.webContents = {
    id: 1,
    isDestroyed: () => false,
    send: (channel, event) => {
      assert.strictEqual(channel, 'session-event')
      sentEvents.push(event)
    }
  }

  const manager = new EventEmitter()
  manager.getPid = () => 12345
  manager.isReady = () => true
  manager.stop = () => {}
  session.runtimeManager = manager
  session.setupRuntimeHandlers()

  const userMessage = {
    id: 'user-streaming',
    role: 'user',
    content: 'stream',
    serializedContent: 'stream',
    attachments: [],
    timestamp: new Date()
  }
  session.messages.push(userMessage)
  session.emit('message', userMessage)
  manager.emit('message-start', {
    id: 'assistant-streaming',
    role: 'assistant',
    content: '',
    isStreaming: true,
    startTime: Date.now(),
    timestamp: new Date()
  })
  manager.emit('message-delta', {
    messageId: 'assistant-streaming',
    field: 'content',
    delta: 'A'
  })
  manager.emit('message-delta', {
    messageId: 'assistant-streaming',
    field: 'content',
    delta: 'B'
  })

  await new Promise(resolve => setTimeout(resolve, 30))

  const assistant = session.messages.find(message => message.id === 'assistant-streaming')
  assert.strictEqual(assistant.content, 'AB')
  const deltaEvents = sentEvents.filter(event =>
    event.eventType === 'message-delta' &&
    event.data?.messageId === 'assistant-streaming'
  )
  assert.strictEqual(deltaEvents.length, 1)
  assert.strictEqual(deltaEvents[0].data.delta, 'AB')

  manager.emit('message-start', {
    id: 'tool-snapshot',
    role: 'tool_use',
    toolName: 'Bash',
    toolInput: { command: 'pwd' },
    result: '',
    isExecuting: true,
    startTime: Date.now(),
    timestamp: new Date()
  })
  manager.emit('message-update', {
    messageId: 'tool-snapshot',
    updates: {
      toolInput: {
        cwd: '/tmp'
      }
    }
  })
  manager.emit('message-result', {
    messageId: 'tool-snapshot',
    content: '/tmp',
    isError: false
  })

  const toolMessage = session.messages.find(message => message.id === 'tool-snapshot')
  assert.strictEqual(toolMessage.toolInput.command, 'pwd')
  assert.strictEqual(toolMessage.toolInput.cwd, '/tmp')
  assert.strictEqual(toolMessage.result, '/tmp')
  assert.strictEqual(toolMessage.isExecuting, false)
  assert(
    sentEvents.some(event =>
      event.eventType === 'message-update' &&
      event.data?.messageId === 'tool-snapshot' &&
      event.data?.canonical === true
    ),
    'live message updates should be marked as canonical backend patches'
  )
  assert(
    sentEvents.some(event =>
      event.eventType === 'message-snapshot' &&
      event.data?.message?.id === 'tool-snapshot'
    ),
    'tool completion should send an authoritative message snapshot'
  )
  assert.strictEqual(
    sentEvents.some(event => event.eventType === 'message-result'),
    false,
    'message-result should be normalized to message updates'
  )

  manager.emit('result', {
    duration_ms: 10,
    num_turns: 1,
    usage: null,
    turn: { id: 'provider-turn' }
  })
  assert(
    sentEvents.some(event =>
      event.eventType === 'message-snapshot' &&
      event.data?.reason === 'turn-completed' &&
      event.data?.message?.id === 'assistant-streaming'
    ),
    'turn completion should send a final assistant snapshot'
  )
}

async function testInternalAgentMessageMetadataPersists() {
  const session = createSession()
  const internalMessage = {
    id: 'internal-message-1',
    senderSessionId: 'session-sender',
    senderName: 'Sender',
    senderTeamId: 'alpha',
    senderRole: 'leader',
    receiverSessionId: session.id,
    message: 'Please review this',
    time: '2026-11-15T10:00:00.000Z'
  }
  const message = {
    id: 'internal-user-turn-1',
    role: 'user',
    content: 'Please review this',
    serializedContent: '[CCGUI INTERNAL AGENT MESSAGE]\n---\nPlease review this',
    attachments: [],
    timestamp: '2026-11-15T10:00:01.000Z',
    ccgui: {
      internalMessage
    }
  }

  session.messages.push(message)
  session.emit('message', message)
  session.emit('result', {
    duration_ms: 10,
    num_turns: 1,
    usage: null,
    turn: { id: 'internal-provider-turn' }
  })
  await flushHistoryWrites()

  const entry = historyManager.loadIndexEntries(session.projectId, session.id)
    .find(item => item.turnId === message.id)
  assert(entry, 'expected internal agent message turn in history index')
  assert.strictEqual(entry.userText, 'Please review this')
  assert.strictEqual(entry.ccgui.internalMessage.senderSessionId, 'session-sender')
  assert.strictEqual(entry.ccgui.internalMessage.senderRole, 'leader')
}

async function run() {
  try {
    await testMainHistoryStructure()
    await testSubagentHistoryStructure()
    await testIndexJsonlIsJsonLines()
    await testTargetedSubagentMessageKeepsMainProcessingIdle()
    await testUnloadTurnReleasesSessionAndRuntimeCaches()
    testCodexTurnCacheCleanup()
    await testFinalizeTurnFlushesBufferedToolUpdate()
    await testBatchedDeltasAndToolSnapshot()
    await testInternalAgentMessageMetadataPersists()
    console.log('history storage tests passed')
  } finally {
    cleanup()
  }
}

run()
