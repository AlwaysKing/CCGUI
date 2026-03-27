const assert = require('assert')
const { ClaudeAdapter } = require('../electron/adapters/claude/adapter')
const { CodexAdapter } = require('../electron/adapters/codex/adapter')

function createEventSink(instance) {
  const events = []
  const originalEmit = instance.emit.bind(instance)
  instance.emit = (type, payload) => {
    events.push({ type, payload })
    return originalEmit(type, payload)
  }
  return events
}

function findLastEvent(events, type) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    if (events[index].type === type) {
      return events[index]
    }
  }
  return null
}

function testClaudeSubagentSemantics() {
  const adapter = new ClaudeAdapter(process.cwd(), 'claude-test-session')
  const events = createEventSink(adapter)

  adapter.rememberAgentToolUse({
    rawName: 'Agent',
    toolUseId: 'tool-agent-1',
    toolInput: {
      subagent_type: 'researcher',
      prompt: 'Find the answer',
      model: 'claude-sonnet'
    }
  })

  adapter.handleSystemMessage({
    subtype: 'task_started',
    task_id: 'task-1',
    task_type: 'subagent',
    tool_use_id: 'tool-agent-1',
    prompt: 'Find the answer'
  })

  const taskStarted = findLastEvent(events, 'task-event')
  assert(taskStarted, 'expected Claude task-event')
  assert.strictEqual(taskStarted.payload.ccgui.orchestration.eventType, 'start')
  assert.strictEqual(taskStarted.payload.ccgui.registry.agentKind, 'execution')
  assert.strictEqual(taskStarted.payload.ccgui.registry.agentType, 'researcher')

  adapter.handleAssistantMessage({
    parent_tool_use_id: 'tool-agent-1',
    message: {
      id: 'assistant-child-1',
      content: [{ type: 'text', text: 'Working on it' }]
    }
  })

  const assistantStart = findLastEvent(events, 'message-start')
  assert(assistantStart, 'expected Claude message-start')
  assert.strictEqual(
    assistantStart.payload.ccgui.attribution.agentId,
    taskStarted.payload.ccgui.registry.agentId,
    'expected child assistant message to inherit unified agentId'
  )

  adapter.handleToolResultMessage({
    tool_use_result: {
      agentId: 'provider-agent-1'
    }
  }, {
    tool_use_id: 'tool-agent-1',
    content: 'Done',
    is_error: false
  })

  const toolResult = findLastEvent(events, 'tool-result')
  assert(toolResult, 'expected Claude tool-result')
  assert.strictEqual(toolResult.payload.ccgui.orchestration.eventType, 'end')
  assert.strictEqual(toolResult.payload.ccgui.attribution.agentId, taskStarted.payload.ccgui.registry.agentId)
}

function testCodexSpawnAgentSemantics() {
  const adapter = new CodexAdapter(process.cwd(), 'codex-test-session')
  const events = createEventSink(adapter)
  adapter.currentThreadId = 'main-thread'

  adapter.handleItemStarted({
    threadId: 'main-thread',
    turnId: 'turn-main',
    item: {
      id: 'spawn-item-1',
      type: 'collabAgentToolCall',
      tool: 'spawnAgent',
      arguments: {
        name: 'Planner',
        prompt: 'Plan the work',
        model: 'gpt-5.4',
        agentType: 'planner'
      },
      status: 'inProgress'
    }
  })

  adapter.handleItemCompleted({
    threadId: 'main-thread',
    turnId: 'turn-main',
    item: {
      id: 'spawn-item-1',
      type: 'collabAgentToolCall',
      tool: 'spawnAgent',
      arguments: {
        name: 'Planner',
        prompt: 'Plan the work',
        model: 'gpt-5.4',
        agentType: 'planner'
      },
      result: {
        receiverThreadIds: ['child-thread-1']
      },
      status: 'completed'
    }
  })

  const spawnSilent = findLastEvent(events, 'silent-message')
  assert(spawnSilent, 'expected Codex agent orchestration silent-message')
  assert.strictEqual(spawnSilent.payload.ccgui.orchestration.eventType, 'start')
  assert.strictEqual(spawnSilent.payload.ccgui.registry.agentKind, 'collaborative')
  assert.strictEqual(spawnSilent.payload.ccgui.registry.agentType, 'planner')

  adapter.handleNotification({
    method: 'item/agentMessage/delta',
    params: {
      threadId: 'child-thread-1',
      turnId: 'turn-child',
      itemId: 'child-msg-1',
      delta: 'Hello from child'
    }
  })

  const childAssistantStart = events.find(event =>
    event.type === 'message-start' && event.payload.id === 'codex-assistant-turn-child-1'
  )
  assert(childAssistantStart, 'expected child assistant message-start')
  assert.strictEqual(
    childAssistantStart.payload.ccgui.attribution.agentId,
    spawnSilent.payload.ccgui.registry.agentId,
    'expected child thread messages to map back to unified agentId'
  )
}

testClaudeSubagentSemantics()
testCodexSpawnAgentSemantics()
console.log('agent-orchestration-tests: ok')
