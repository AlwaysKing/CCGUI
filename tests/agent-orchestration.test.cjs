const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
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

function testClaudeTeamLifecycleComesFromExplicitEvents() {
  const adapter = new ClaudeAdapter(process.cwd(), 'claude-team-test-session')
  const events = createEventSink(adapter)

  adapter.emitTeamCreateLifecycle({
    team_name: 'debate-team',
    lead_agent_id: 'team-lead@debate-team',
    team_file_path: '/tmp/debate-team.json'
  })

  const teamLifecycleEvents = events.filter(event => event.type === 'silent-message')
  assert.strictEqual(teamLifecycleEvents.length, 1, 'expected team create to emit only team lifecycle')
  assert.strictEqual(teamLifecycleEvents[0].payload.ccgui.registry.agentType, 'team')

  adapter.rememberAgentToolUse({
    rawName: 'Agent',
    toolUseId: 'tool-team-agent-1',
    toolInput: {
      name: 'Debater',
      team_name: 'debate-team',
      agent_type: 'general-purpose',
      prompt: 'Join the debate'
    }
  })

  adapter.handleSystemMessage({
    subtype: 'task_started',
    task_id: 'team-task-1',
    task_type: 'in_process_teammate',
    tool_use_id: 'tool-team-agent-1',
    team_name: 'debate-team',
    teammate_id: 'proponent@debate-team',
    agent_type: 'general-purpose'
  })

  const taskStartedBeforeSpawn = findLastEvent(events, 'task-event')
  assert.strictEqual(
    taskStartedBeforeSpawn,
    null,
    'expected teammate task_started to stay pending until spawn metadata arrives'
  )

  adapter.handleToolResultMessage({
    tool_use_result: {
      status: 'teammate_spawned',
      teammate_id: 'proponent@debate-team',
      agent_id: 'proponent@debate-team',
      agent_type: 'general-purpose',
      name: 'proponent',
      team_name: 'debate-team',
      color: 'blue'
    }
  }, {
    tool_use_id: 'tool-team-agent-1',
    content: 'Spawned successfully',
    is_error: false
  })

  const lifecycle = findLastEvent(events, 'silent-message')
  assert(lifecycle, 'expected explicit teammate lifecycle event')
  assert.strictEqual(lifecycle.payload.ccgui.orchestration.eventType, 'start')
  assert.strictEqual(lifecycle.payload.ccgui.registry.agentKind, 'collaborative')
  assert.strictEqual(lifecycle.payload.ccgui.registry.color, 'blue')
  assert.strictEqual(
    lifecycle.payload.ccgui.registry.agentId,
    'claude-team-member:claude-team-debate-team:proponent-debate-team'
  )

  const taskStarted = findLastEvent(events, 'task-event')
  assert(taskStarted, 'expected buffered teammate task-event after spawn')
  assert.strictEqual(taskStarted.payload.taskId, 'team-task-1')
  assert.strictEqual(
    taskStarted.payload.ccgui?.attribution?.agentId,
    'claude-team-member:claude-team-debate-team:proponent-debate-team',
    'expected buffered teammate task to be rebound to finalized agent identity'
  )

  const leadAttribution = adapter.getAttributionForClaudeMessage({
    agent_id: 'team-lead@debate-team'
  })
  assert.strictEqual(leadAttribution.agentId, 'master')

  const teammateAttribution = adapter.getAttributionForClaudeMessage({
    teammate_id: 'proponent@debate-team'
  })
  assert.strictEqual(
    teammateAttribution.agentId,
    'claude-team-member:claude-team-debate-team:proponent-debate-team'
  )

  const routingAttribution = adapter.getAttributionForClaudeMessage({
    team_name: 'debate-team',
    routing: {
      sender: '@proponent'
    }
  })
  assert.strictEqual(
    routingAttribution.agentId,
    'claude-team-member:claude-team-debate-team:proponent-debate-team'
  )
}

function testClaudeTeamMemberIdsKeepDistinctNonAsciiNames() {
  const adapter = new ClaudeAdapter(process.cwd(), 'claude-team-non-ascii-test-session')

  adapter.emitTeamCreateLifecycle({
    team_name: 'math-debate',
    lead_agent_id: 'team-lead@math-debate',
    team_file_path: '/tmp/math-debate.json'
  })

  adapter.rememberAgentToolUse({
    rawName: 'Agent',
    toolUseId: 'tool-zhangsan',
    toolInput: {
      name: '张三',
      team_name: 'math-debate',
      prompt: 'Join the debate'
    }
  })
  adapter.rememberAgentToolUse({
    rawName: 'Agent',
    toolUseId: 'tool-lisi',
    toolInput: {
      name: '李四',
      team_name: 'math-debate',
      prompt: 'Join the debate'
    }
  })

  adapter.handleSystemMessage({
    subtype: 'task_started',
    task_id: 'task-zhangsan',
    task_type: 'in_process_teammate',
    tool_use_id: 'tool-zhangsan'
  })
  adapter.handleSystemMessage({
    subtype: 'task_started',
    task_id: 'task-lisi',
    task_type: 'in_process_teammate',
    tool_use_id: 'tool-lisi'
  })

  const zhangsanId = adapter.resolveTeamMemberAgentId({
    teamId: adapter.resolveTeamId('math-debate'),
    taskId: 'task-zhangsan',
    toolUseId: 'tool-zhangsan',
    providerAgentId: '张三@math-debate',
    teammateId: '张三@math-debate',
    name: '张三'
  })
  const lisiId = adapter.resolveTeamMemberAgentId({
    teamId: adapter.resolveTeamId('math-debate'),
    taskId: 'task-lisi',
    toolUseId: 'tool-lisi',
    providerAgentId: '李四@math-debate',
    teammateId: '李四@math-debate',
    name: '李四'
  })

  assert.strictEqual(
    zhangsanId,
    'claude-team-member:claude-team-math-debate:张三-math-debate'
  )
  assert.strictEqual(
    lisiId,
    'claude-team-member:claude-team-math-debate:李四-math-debate'
  )
  assert.notStrictEqual(zhangsanId, lisiId)
}

function testClaudeCollaborativePendingStateClearsAtTurnBoundary() {
  const adapter = new ClaudeAdapter(process.cwd(), 'claude-team-clear-test-session')

  adapter.rememberAgentToolUse({
    rawName: 'Agent',
    toolUseId: 'tool-pending-team-agent-1',
    toolInput: {
      name: '张三',
      team_name: 'math-debate',
      prompt: 'Join the debate'
    }
  })

  adapter.handleSystemMessage({
    subtype: 'task_started',
    task_id: 'pending-task-1',
    task_type: 'in_process_teammate',
    tool_use_id: 'tool-pending-team-agent-1',
    team_name: 'math-debate'
  })

  assert.strictEqual(adapter.pendingCollaborativePreAgentsByToolUseId.size, 1)
  assert.strictEqual(adapter.pendingAgentToolUses.size, 1)

  adapter.handleMessage({
    type: 'result',
    subtype: 'success',
    duration_ms: 1,
    result: 'done'
  })

  assert.strictEqual(adapter.pendingCollaborativePreAgentsByToolUseId.size, 0)
  assert.strictEqual(adapter.pendingAgentToolUses.size, 0)
}

function testClaudeCollaborativeSpawnWorksWithStreamFirstOrdering() {
  const adapter = new ClaudeAdapter(process.cwd(), 'claude-team-stream-order-test-session')
  const events = createEventSink(adapter)

  adapter.handleStreamEvent({
    event: {
      type: 'content_block_start',
      index: 1,
      content_block: {
        type: 'tool_use',
        id: 'call-stream-team-agent-1',
        name: 'Agent',
        input: {}
      }
    }
  })

  adapter.handleStreamEvent({
    event: {
      type: 'content_block_delta',
      index: 1,
      delta: {
        type: 'input_json_delta',
        partial_json: JSON.stringify({
          name: '张三',
          team_name: 'math-discussion',
          description: '张三参与数学讨论',
          prompt: '开始第1轮发言'
        })
      }
    }
  })

  adapter.handleAssistantMessage({
    message: {
      id: 'assistant-stream-order-1',
      content: [{
        type: 'tool_use',
        id: 'call-stream-team-agent-1',
        name: 'Agent',
        input: {
          name: '张三',
          team_name: 'math-discussion',
          description: '张三参与数学讨论',
          prompt: '开始第1轮发言'
        }
      }]
    }
  })

  adapter.handleSystemMessage({
    subtype: 'task_started',
    task_id: 'task-stream-team-agent-1',
    task_type: 'in_process_teammate',
    tool_use_id: 'call-stream-team-agent-1',
    team_name: 'math-discussion'
  })

  const taskStartedBeforeSpawn = findLastEvent(events, 'task-event')
  assert.strictEqual(taskStartedBeforeSpawn, null)

  adapter.handleToolResultMessage({
    tool_use_result: {
      status: 'teammate_spawned',
      teammate_id: '张三@math-discussion',
      agent_id: '张三@math-discussion',
      name: '张三',
      team_name: 'math-discussion',
      color: 'blue'
    }
  }, {
    tool_use_id: 'call-stream-team-agent-1',
    content: 'Spawned successfully',
    is_error: false
  })

  const lifecycle = findLastEvent(events, 'silent-message')
  assert(lifecycle, 'expected collaborative start after spawn')
  assert.strictEqual(
    lifecycle.payload.ccgui.registry.agentId,
    'claude-team-member:claude-team-math-discussion:张三-math-discussion'
  )
  assert.strictEqual(lifecycle.payload.ccgui.registry.color, 'blue')

  const taskStarted = findLastEvent(events, 'task-event')
  assert(taskStarted, 'expected buffered task after spawn')
  assert.strictEqual(
    taskStarted.payload.ccgui.attribution.agentId,
    'claude-team-member:claude-team-math-discussion:张三-math-discussion'
  )
}

function testClaudeSidechainRequiresExplicitFileBinding() {
  const adapter = new ClaudeAdapter(process.cwd(), 'claude-sidechain-test-session')
  const events = createEventSink(adapter)
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-sidechain-'))
  const subagentsDir = path.join(tempDir, 'subagents')
  fs.mkdirSync(subagentsDir, { recursive: true })
  const filePath = path.join(subagentsDir, 'aaa.jsonl')

  fs.writeFileSync(filePath, `${JSON.stringify({
    type: 'assistant',
    uuid: 'sidechain-entry-1',
    timestamp: '2026-03-30T00:00:00.000Z',
    message: {
      id: 'sidechain-message-1',
      content: [{ type: 'text', text: 'hello from aaa' }]
    }
  })}\n`, 'utf8')

  adapter.getSubagentsDirectory = () => subagentsDir
  adapter.watchSidechainAgent({
    agentId: 'claude-team-member:debate:zhangsan',
    name: '张三'
  })
  adapter.pollSidechainEntries()

  const unboundSidechainMessage = events.find(event =>
    event.type === 'message-start' && event.payload.id === 'sidechain-message-1'
  )
  assert.strictEqual(
    unboundSidechainMessage,
    undefined,
    'expected sidechain file without explicit binding to stay ignored'
  )

  adapter.bindSidechainFile('claude-team-member:debate:zhangsan', filePath)
  adapter.pollSidechainEntries()

  const boundSidechainMessage = events.find(event =>
    event.type === 'message-start' && event.payload.id === 'sidechain-message-1'
  )
  assert(boundSidechainMessage, 'expected explicitly bound sidechain file to produce messages')
  assert.strictEqual(
    boundSidechainMessage.payload.ccgui.attribution.agentId,
    'claude-team-member:debate:zhangsan'
  )

  fs.rmSync(tempDir, { recursive: true, force: true })
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
testClaudeTeamLifecycleComesFromExplicitEvents()
testClaudeTeamMemberIdsKeepDistinctNonAsciiNames()
testClaudeCollaborativePendingStateClearsAtTurnBoundary()
testClaudeCollaborativeSpawnWorksWithStreamFirstOrdering()
testClaudeSidechainRequiresExplicitFileBinding()
testCodexSpawnAgentSemantics()
console.log('agent-orchestration-tests: ok')
