const assert = require('assert')
const { EventEmitter } = require('events')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { ClaudeAdapter } = require('../electron/adapters/claude/adapter')
const { CodexAdapter } = require('../electron/adapters/codex/adapter')
const { SessionInstance } = require('../electron/session/session-instance')
const historyManager = require('../electron/storage/history-manager')

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

  const toolResult = findLastEvent(events, 'message-result')
  assert(toolResult, 'expected Claude message-result')
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

function testClaudeBackgroundTaskEventsAreModeledWithoutProviderNotifications() {
  const adapter = new ClaudeAdapter(process.cwd(), 'claude-background-task-test-session')
  const events = createEventSink(adapter)

  adapter.handleSystemMessage({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: [
      {
        task_id: 'background-task-1',
        task_type: 'local_agent',
        description: 'Inspect the repository'
      }
    ]
  })

  assert.deepStrictEqual(adapter.backgroundTasks.get('background-task-1'), {
    task_id: 'background-task-1',
    task_type: 'local_agent',
    description: 'Inspect the repository'
  })
  assert.strictEqual(
    events.some(event => event.type === 'system-notification'),
    false,
    'background task snapshots must not become provider notifications'
  )

  adapter.handleSystemMessage({
    type: 'system',
    subtype: 'background_tasks_changed',
    tasks: []
  })
  assert.strictEqual(adapter.backgroundTasks.size, 0)
}

function testClaudeToolProgressUpdatesExistingToolMessage() {
  const adapter = new ClaudeAdapter(process.cwd(), 'claude-tool-progress-test-session')
  const events = createEventSink(adapter)
  adapter.toolUseMessages.set('tool-use-1', { toolInputBuffer: '' })

  adapter.handleMessage({
    type: 'tool_progress',
    tool_use_id: 'tool-use-1-heartbeat-2',
    parent_tool_use_id: 'tool-use-1',
    tool_name: 'Bash',
    elapsed_time_seconds: 60,
    heartbeat: true,
    uuid: 'progress-1'
  })

  const update = findLastEvent(events, 'message-update')
  assert(update, 'expected tool progress to update the existing tool message')
  assert.strictEqual(update.payload.messageId, 'tool-use-1')
  assert.strictEqual(update.payload.updates.elapsedSeconds, 60)
  assert.strictEqual(update.payload.updates.toolProgress.heartbeat, true)
  assert.strictEqual(
    events.some(event => event.type === 'system-notification'),
    false,
    'tool progress must not become a provider notification'
  )
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

  const spawnToolStart = events.find(event =>
    event.type === 'message-start' &&
    event.payload.id === 'spawn-item-1'
  )
  assert(spawnToolStart, 'expected Codex agent tool message-start')
  assert.strictEqual(spawnToolStart.payload.toolInput.agentAction, 'spawnAgent')

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

function testCodexSubAgentActivitySemantics() {
  const adapter = new CodexAdapter(process.cwd(), 'codex-subagent-activity-test-session')
  const events = createEventSink(adapter)
  adapter.currentThreadId = 'main-thread'

  adapter.handleItemCompleted({
    threadId: 'main-thread',
    turnId: 'turn-main',
    item: {
      id: 'subagent-activity-1',
      type: 'SubAgentActivity',
      kind: 'started',
      agent_thread_id: 'child-thread-activity',
      agent_path: '/root/favorite_fix_acceptance'
    }
  })

  const lifecycle = findLastEvent(events, 'silent-message')
  assert(lifecycle, 'expected Codex SubAgentActivity lifecycle event')
  assert.strictEqual(lifecycle.payload.ccgui.orchestration.eventType, 'start')
  assert.strictEqual(lifecycle.payload.ccgui.orchestration.source, 'subagent_activity')
  assert.strictEqual(lifecycle.payload.ccgui.registry.agentKind, 'collaborative')
  assert.strictEqual(lifecycle.payload.ccgui.registry.name, 'favorite_fix_acceptance')
  assert.strictEqual(
    lifecycle.payload.ccgui.registry.agentId,
    'codex-agent:child-thread-activity'
  )

  adapter.handleNotification({
    method: 'item/agentMessage/delta',
    params: {
      threadId: 'child-thread-activity',
      turnId: 'turn-child-activity',
      itemId: 'child-activity-message-1',
      delta: 'Hello from SubAgentActivity'
    }
  })

  const childAssistantStart = events.find(event =>
    event.type === 'message-start' &&
    event.payload.id === 'codex-assistant-turn-child-activity-1'
  )
  assert(childAssistantStart, 'expected child assistant message-start')
  assert.strictEqual(
    childAssistantStart.payload.ccgui.attribution.agentId,
    lifecycle.payload.ccgui.registry.agentId,
    'expected SubAgentActivity child messages to map to the subagent'
  )

  adapter.handleNotification({
    method: 'turn/diff/updated',
    params: {
      threadId: 'child-thread-activity',
      turnId: 'turn-child-activity',
      diff: 'diff --git a/example.js b/example.js\n+child change'
    }
  })

  const childDiff = events.find(event =>
    event.type === 'message-start' &&
    event.payload.id === 'codex-diff-turn-child-activity'
  )
  assert(childDiff, 'expected child diff message-start')
  assert.strictEqual(
    childDiff.payload.ccgui.attribution.agentId,
    lifecycle.payload.ccgui.registry.agentId,
    'expected child diffs to map to the subagent'
  )

  adapter.handleItemCompleted({
    threadId: 'main-thread',
    turnId: 'turn-main',
    item: {
      id: 'subagent-completed-1',
      type: 'SubAgentActivity',
      kind: 'completed',
      agent_thread_id: 'child-thread-activity',
      agent_path: '/root/favorite_fix_acceptance'
    }
  })

  const completedLifecycle = findLastEvent(events, 'silent-message')
  assert.strictEqual(completedLifecycle.payload.ccgui.orchestration.eventType, 'end')
  assert.strictEqual(completedLifecycle.payload.ccgui.registry.status, 'ended')

  adapter.handleItemCompleted({
    threadId: 'main-thread',
    turnId: 'turn-main',
    item: {
      id: 'subagent-interacted-1',
      type: 'SubAgentActivity',
      kind: 'interacted',
      agent_thread_id: 'child-thread-activity',
      agent_path: '/root/favorite_fix_acceptance'
    }
  })

  const interactedLifecycle = findLastEvent(events, 'silent-message')
  assert.strictEqual(interactedLifecycle.payload.ccgui.registry.status, 'running')
  assert.strictEqual(interactedLifecycle.payload.ccgui.orchestration.eventType, 'start')

  adapter.handleItemCompleted({
    threadId: 'main-thread',
    turnId: 'turn-main',
    item: {
      id: 'subagent-completed-2',
      type: 'SubAgentActivity',
      kind: 'completed',
      agent_thread_id: 'child-thread-activity',
      agent_path: '/root/favorite_fix_acceptance'
    }
  })

  adapter.handleNotification({
    method: 'turn/started',
    params: {
      threadId: 'child-thread-activity',
      turn: { id: 'turn-child-resumed' }
    }
  })

  const resumedLifecycle = findLastEvent(events, 'silent-message')
  assert.strictEqual(resumedLifecycle.payload.ccgui.orchestration.eventType, 'start')
  assert.strictEqual(resumedLifecycle.payload.ccgui.registry.status, 'running')

  adapter.handleItemCompleted({
    threadId: 'main-thread',
    turnId: 'turn-main',
    item: {
      id: 'subagent-interrupted-1',
      type: 'SubAgentActivity',
      kind: 'interrupted',
      agent_thread_id: 'child-thread-activity',
      agent_path: '/root/favorite_fix_acceptance'
    }
  })

  const interruptedLifecycle = findLastEvent(events, 'silent-message')
  assert.strictEqual(interruptedLifecycle.payload.ccgui.orchestration.eventType, 'end')
  assert.strictEqual(interruptedLifecycle.payload.ccgui.orchestration.reason, 'interrupted')
  assert.strictEqual(interruptedLifecycle.payload.ccgui.registry.status, 'interrupted')
}

function testCodexSubAgentThreadsDoNotReplaceMainThread() {
  const adapter = new CodexAdapter(process.cwd(), 'codex-subagent-thread-test-session')
  const events = createEventSink(adapter)
  adapter.currentThreadId = 'main-thread'

  adapter.handleNotification({
    method: 'thread/started',
    params: {
      thread: {
        id: 'child-thread',
        parentThreadId: 'main-thread',
        name: 'Child Agent',
        agentNickname: 'Researcher',
        agentRole: 'explore',
        status: { type: 'active', activeFlags: [] }
      }
    }
  })

  assert.strictEqual(adapter.currentThreadId, 'main-thread', 'child thread must not replace the main thread')
  const threadStart = findLastEvent(events, 'silent-message')
  assert.strictEqual(threadStart.payload.ccgui.registry.agentId, 'codex-agent:child-thread')
  assert.strictEqual(threadStart.payload.ccgui.registry.name, 'Researcher')
  assert.strictEqual(threadStart.payload.ccgui.registry.agentType, 'explore')
  assert.strictEqual(threadStart.payload.ccgui.registry.parentAgentId, 'master')
  assert.strictEqual(threadStart.payload.ccgui.registry.status, 'running')

  adapter.handleNotification({
    method: 'turn/started',
    params: {
      threadId: 'main-thread',
      turn: { id: 'turn-main' }
    }
  })
  adapter.handleNotification({
    method: 'turn/started',
    params: {
      threadId: 'child-thread',
      turn: { id: 'turn-child' }
    }
  })
  adapter.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: 'child-thread',
      turn: {
        id: 'turn-child',
        status: 'completed'
      }
    }
  })

  assert.strictEqual(
    events.filter(event => event.type === 'result').length,
    0,
    'child turn completion must not complete the main turn'
  )
  const childCompleted = findLastEvent(events, 'silent-message')
  assert.strictEqual(childCompleted.payload.ccgui.registry.status, 'ended')

  adapter.handleNotification({
    method: 'thread/status/changed',
    params: {
      threadId: 'child-thread',
      status: { type: 'idle' }
    }
  })
  const idleLifecycle = findLastEvent(events, 'silent-message')
  assert.strictEqual(idleLifecycle.payload.ccgui.orchestration.source, 'thread_status')
  assert.strictEqual(idleLifecycle.payload.ccgui.registry.status, 'ended')

  adapter.handleNotification({
    method: 'thread/status/changed',
    params: {
      threadId: 'child-thread',
      status: { type: 'active', activeFlags: [] }
    }
  })
  adapter.handleNotification({
    method: 'thread/closed',
    params: { threadId: 'child-thread' }
  })
  const closedLifecycle = findLastEvent(events, 'silent-message')
  assert.strictEqual(closedLifecycle.payload.ccgui.orchestration.source, 'thread_lifecycle')
  assert.strictEqual(closedLifecycle.payload.ccgui.orchestration.reason, 'closed')
  assert.strictEqual(closedLifecycle.payload.ccgui.registry.status, 'ended')

  adapter.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: 'main-thread',
      turn: {
        id: 'turn-main',
        status: 'completed'
      }
    }
  })
  assert.strictEqual(
    events.filter(event => event.type === 'result').length,
    1,
    'main turn completion must still produce the session result'
  )
}

async function testCodexSendMessageToSubagentThread() {
  const adapter = new CodexAdapter(process.cwd(), 'codex-subagent-send-test-session')
  const requests = []
  adapter.currentThreadId = 'main-thread'
  adapter.ensureInitialized = async () => {}
  adapter.buildDeveloperInstructions = async () => null
  adapter.request = async (method, params) => {
    requests.push({ method, params })
    if (method === 'thread/resume') {
      return { thread: { id: params.threadId } }
    }
    if (method === 'turn/start') {
      return { turn: { id: 'turn-child-resumed' } }
    }
    throw new Error(`unexpected request: ${method}`)
  }

  const message = {
    type: 'user',
    uuid: 'user-message-child',
    message: {
      role: 'user',
      content: [{ type: 'text', text: 'Continue the child task' }]
    },
    ccgui: {
      attribution: {
        agentId: 'codex-agent:child-thread',
        actorId: 'codex-agent:child-thread'
      }
    }
  }

  await adapter.sendMessage(message)

  assert.deepStrictEqual(
    requests.map(request => request.method),
    ['thread/resume', 'turn/start'],
    'expected a persisted child thread to be resumed before starting its turn'
  )
  assert.strictEqual(requests[0].params.threadId, 'child-thread')
  assert.strictEqual(requests[1].params.threadId, 'child-thread')
  assert.strictEqual(adapter.currentThreadId, 'main-thread')
  assert.strictEqual(
    adapter.turnUserMessageUuids.get('turn-child-resumed'),
    'user-message-child'
  )

  requests.length = 0
  await adapter.sendMessage({
    ...message,
    uuid: 'user-message-child-2'
  })
  assert.deepStrictEqual(
    requests.map(request => request.method),
    ['turn/start'],
    'an already loaded child thread should be reused'
  )
}

async function testCodexInterruptsMainAndSubAgentTurns() {
  const adapter = new CodexAdapter(process.cwd(), 'codex-interrupt-test-session')
  const requests = []
  adapter.currentThreadId = 'main-thread'
  adapter.ensureInitialized = async () => {}
  adapter.request = async (method, params) => {
    requests.push({ method, params })
    return {}
  }

  adapter.handleNotification({
    method: 'turn/started',
    params: {
      threadId: 'main-thread',
      turn: { id: 'turn-main-active' }
    }
  })
  adapter.handleItemCompleted({
    threadId: 'main-thread',
    turnId: 'turn-main-active',
    item: {
      id: 'subagent-activity-active',
      type: 'SubAgentActivity',
      kind: 'started',
      agent_thread_id: 'child-thread-active',
      agent_path: '/root/active_subagent'
    }
  })
  adapter.handleNotification({
    method: 'turn/started',
    params: {
      threadId: 'child-thread-active',
      turn: { id: 'turn-child-active' }
    }
  })

  await adapter.sendInterrupt()

  assert.strictEqual(requests.length, 2, 'expected main and child turns to be interrupted')
  const interruptTargets = requests
    .filter(request => request.method === 'turn/interrupt')
    .map(request => `${request.params.threadId}:${request.params.turnId}`)
    .sort()
  assert.deepStrictEqual(interruptTargets, [
    'child-thread-active:turn-child-active',
    'main-thread:turn-main-active'
  ])
  assert.strictEqual(adapter.interruptRequested, true, 'interrupt state should persist after dispatch')

  adapter.handleNotification({
    method: 'turn/started',
    params: {
      threadId: 'late-child-thread',
      turn: { id: 'turn-late-child' }
    }
  })
  await Promise.resolve()

  assert.strictEqual(requests.length, 3, 'expected a late subagent turn to be interrupted immediately')
  assert.strictEqual(requests[2].params.threadId, 'late-child-thread')
  assert.strictEqual(requests[2].params.turnId, 'turn-late-child')

  adapter.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: 'child-thread-active',
      turn: {
        id: 'turn-child-active',
        status: 'interrupted'
      }
    }
  })
  adapter.handleNotification({
    method: 'turn/completed',
    params: {
      threadId: 'late-child-thread',
      turn: {
        id: 'turn-late-child',
        status: 'interrupted'
      }
    }
  })
  requests.length = 0
  await adapter.sendInterrupt()

  assert.strictEqual(requests.length, 1, 'completed child turn should not be interrupted again')
  assert.strictEqual(requests[0].params.threadId, 'main-thread')
  assert.strictEqual(requests[0].params.turnId, 'turn-main-active')
}

function testSessionActiveAgentTracking() {
  const session = new SessionInstance('active-agent-test-session', '/tmp/ccgui-active-agent-test')
  session.runtimeManager = new EventEmitter()
  session.setupRuntimeHandlers()

  const runningCcgui = {
    registry: {
      agentId: 'codex-agent:child-thread',
      agentKind: 'collaborative',
      agentType: 'subagent',
      status: 'running'
    },
    orchestration: {
      eventType: 'start',
      agentId: 'codex-agent:child-thread',
      agentKind: 'collaborative',
      agentType: 'subagent',
      status: 'running'
    }
  }

  session.runtimeManager.emit('silent-message', {
    messageType: 'agent-orchestration',
    ccgui: runningCcgui
  })
  assert.deepStrictEqual(session.getActiveAgentIds(), ['codex-agent:child-thread'])
  assert.deepStrictEqual(
    session.getState().activeAgentIds,
    ['codex-agent:child-thread'],
    'session state should expose live agent ids to the renderer'
  )

  session.runtimeManager.emit('message-start', {
    id: 'child-assistant-message',
    role: 'assistant',
    content: '',
    isStreaming: true,
    ccgui: {
      attribution: {
        agentId: 'codex-agent:child-thread'
      }
    }
  })
  session.runtimeManager.emit('message-complete', {
    messageId: 'child-assistant-message',
    updates: {
      isStreaming: false
    }
  })
  assert.deepStrictEqual(
    session.getActiveAgentIds(),
    ['codex-agent:child-thread'],
    'one completed assistant message must not end the subagent turn'
  )

  session.runtimeManager.emit('silent-message', {
    messageType: 'agent-orchestration',
    ccgui: {
      registry: {
        ...runningCcgui.registry,
        status: 'ended'
      },
      orchestration: {
        ...runningCcgui.orchestration,
        eventType: 'end',
        status: 'ended'
      }
    }
  })
  assert.deepStrictEqual(session.getActiveAgentIds(), [])

  session.runtimeManager.emit('task-event', {
    eventType: 'notification',
    ccgui: {
      registry: {
        agentId: 'claude-task-agent',
        agentKind: 'execution',
        status: 'running'
      },
      orchestration: {
        eventType: 'start',
        agentId: 'claude-task-agent',
        status: 'running'
      }
    }
  })
  assert.deepStrictEqual(session.getActiveAgentIds(), ['claude-task-agent'])

  session.runtimeManager.emit('task-event', {
    eventType: 'notification',
    ccgui: {
      registry: {
        agentId: 'claude-task-agent',
        agentKind: 'execution',
        status: 'ended'
      },
      orchestration: {
        eventType: 'end',
        agentId: 'claude-task-agent',
        status: 'ended'
      }
    }
  })
  assert.deepStrictEqual(session.getActiveAgentIds(), [])
}

async function testCodexCloseSubagentAgent() {
  const adapter = new CodexAdapter(process.cwd(), 'codex-close-subagent-test-session')
  const events = createEventSink(adapter)
  const requests = []
  adapter.currentThreadId = 'main-thread'
  adapter.ensureInitialized = async () => {}
  adapter.request = async (method, params) => {
    requests.push({ method, params })
    return {}
  }

  adapter.handleItemCompleted({
    threadId: 'main-thread',
    turnId: 'turn-main',
    item: {
      id: 'subagent-close-start',
      type: 'SubAgentActivity',
      kind: 'started',
      agent_thread_id: 'child-thread-close',
      agent_path: '/root/close_me'
    }
  })
  adapter.activeTurnByThreadId.set('child-thread-close', 'turn-child-close')

  await adapter.closeSubagentAgent('codex-agent:child-thread-close')

  assert.deepStrictEqual(
    requests.map(request => request.method),
    ['turn/interrupt', 'thread/archive']
  )
  assert.strictEqual(requests[0].params.threadId, 'child-thread-close')
  assert.strictEqual(requests[1].params.threadId, 'child-thread-close')

  const deleteEvent = findLastEvent(events, 'silent-message')
  assert.strictEqual(deleteEvent.payload.ccgui.orchestration.eventType, 'delete')
  assert.strictEqual(deleteEvent.payload.ccgui.registry.status, 'deleted')
}

function testCodexMcpStartupNotificationKeepsSubagentAttribution() {
  const adapter = new CodexAdapter(process.cwd(), 'codex-mcp-subagent-test-session')
  const events = createEventSink(adapter)
  adapter.currentThreadId = 'main-thread'

  adapter.handleNotification({
    method: 'thread/started',
    params: {
      thread: {
        id: 'child-thread',
        parentThreadId: 'main-thread',
        agentNickname: 'Verifier',
        status: { type: 'active', activeFlags: [] }
      }
    }
  })

  adapter.handleNotification({
    method: 'mcpServer/startupStatus/updated',
    params: {
      threadId: 'child-thread',
      name: 'xcode',
      status: 'ready'
    }
  })

  const unknownMessage = findLastEvent(events, 'unknown_message')
  assert(unknownMessage, 'expected MCP startup notification to remain an unknown provider event')
  assert.strictEqual(
    unknownMessage.payload.ccgui.attribution.agentId,
    'codex-agent:child-thread',
    'expected MCP startup notification to retain child thread attribution'
  )

  adapter.handleNotification({
    method: 'mcpServer/startupStatus/updated',
    params: {
      threadId: 'unregistered-child-thread',
      name: 'rea',
      status: 'starting'
    }
  })

  const fallbackMessage = findLastEvent(events, 'unknown_message')
  assert.strictEqual(
    fallbackMessage.payload.ccgui.attribution.agentId,
    'codex-agent:unregistered-child-thread',
    'expected MCP startup notification to retain attribution before child registration'
  )
}

function testCodexReadStateNotificationIsIgnored() {
  const adapter = new CodexAdapter(process.cwd(), 'codex-read-state-test-session')
  const events = createEventSink(adapter)

  adapter.handleNotification({
    method: 'thread/readState/changed',
    params: {
      threadId: 'main-thread',
      readState: {
        firstUnread: null,
        revision: 'read-state-revision'
      }
    }
  })

  assert.strictEqual(
    findLastEvent(events, 'unknown_message'),
    null,
    'expected thread read state notification to be recognized and ignored'
  )
}

function testSubagentMcpNotificationRoutesToSubagentHistory() {
  const session = new SessionInstance('mcp-route-test-session', '/tmp/ccgui-mcp-route-test')
  session.provider = 'codex'
  session.runtimeManager = new EventEmitter()
  session.setupRuntimeHandlers()
  session.currentHistoryTurnId = 'main-user-turn'
  session.agentSourceTurnIds.set('codex-agent:child-thread', 'main-user-turn')

  const originalAppendIndexMessage = historyManager.appendIndexMessage
  const originalLoadIndexEntries = historyManager.loadIndexEntries
  const originalEnsureSubagentTurn = historyManager.ensureSubagentTurn
  const originalAppendSubagentTurnEvent = historyManager.appendSubagentTurnEvent
  let mainIndexWrites = 0
  const subagentEvents = []

  historyManager.appendIndexMessage = () => {
    mainIndexWrites += 1
    return {}
  }
  historyManager.loadIndexEntries = () => []
  historyManager.ensureSubagentTurn = () => 'subagent-turn'
  historyManager.appendSubagentTurnEvent = (projectId, sessionId, agentId, turnId, event) => {
    subagentEvents.push({ projectId, sessionId, agentId, turnId, event })
    return true
  }

  try {
    session.runtimeManager.emit('unknown_message', {
      method: 'mcpServer/startupStatus/updated',
      params: {
        threadId: 'child-thread',
        name: 'xcode',
        status: 'starting'
      },
      ccgui: {
        attribution: {
          agentId: 'codex-agent:child-thread',
          actorId: 'codex-agent:child-thread'
        }
      }
    })

    assert.strictEqual(mainIndexWrites, 0, 'subagent MCP notification must not write to main index')
    assert.strictEqual(subagentEvents.length, 1, 'expected subagent MCP notification in subagent history')
    assert.strictEqual(subagentEvents[0].agentId, 'codex-agent:child-thread')
    assert(
      subagentEvents[0].turnId.startsWith('subagent-turn:'),
      'expected a subagent turn id for the child notification'
    )
    assert.strictEqual(
      subagentEvents[0].event.data.ccgui.history.targetAgentId,
      'codex-agent:child-thread'
    )
    const firstOperationId = subagentEvents[0].event.data.operationId
    assert(
      firstOperationId.startsWith('mcp-startup:codex:child-thread:xcode:'),
      'expected a cycle-specific MCP operation id'
    )
    const firstMessageId = subagentEvents[0].event.data.messageId
    assert(firstMessageId, 'expected the backend notification message id')
    assert.strictEqual(
      session.messages.find(message => message.id === firstMessageId)?.notificationType,
      'mcp-server-starting'
    )

    session.runtimeManager.emit('unknown_message', {
      method: 'mcpServer/startupStatus/updated',
      params: {
        threadId: 'child-thread',
        name: 'xcode',
        status: 'ready'
      },
      ccgui: {
        attribution: {
          agentId: 'codex-agent:child-thread',
          actorId: 'codex-agent:child-thread'
        }
      }
    })

    assert.strictEqual(mainIndexWrites, 0, 'subagent MCP ready must not write to main index')
    assert.strictEqual(subagentEvents.length, 2, 'expected both subagent MCP state changes in subagent history')
    assert.strictEqual(subagentEvents[1].event.data.operationId, firstOperationId)
    assert.strictEqual(subagentEvents[1].event.data.messageId, firstMessageId)
    assert(Number.isFinite(subagentEvents[1].event.data.durationMs))
    assert.strictEqual(
      session.messages.find(message => message.notificationType === 'mcp-server-ready')?.scope,
      'turn'
    )

    session.runtimeManager.emit('unknown_message', {
      method: 'mcpServer/startupStatus/updated',
      params: {
        threadId: 'main-thread',
        name: 'xcode',
        status: 'ready'
      }
    })

    assert.strictEqual(mainIndexWrites, 1, 'main thread MCP notification should remain session scoped')
    assert.strictEqual(subagentEvents.length, 2, 'main thread MCP notification must not enter subagent history')
  } finally {
    historyManager.appendIndexMessage = originalAppendIndexMessage
    historyManager.loadIndexEntries = originalLoadIndexEntries
    historyManager.ensureSubagentTurn = originalEnsureSubagentTurn
    historyManager.appendSubagentTurnEvent = originalAppendSubagentTurnEvent
  }
}

function testMcpStartupOperationCyclesAreIsolated() {
  const session = new SessionInstance('mcp-cycle-test-session', '/tmp/ccgui-mcp-cycle-test')
  session.provider = 'codex'

  const message = status => ({
    method: 'mcpServer/startupStatus/updated',
    params: {
      threadId: 'main-thread',
      name: 'node_repl',
      status
    }
  })

  const firstStarting = session.resolveMcpStartupOperationId(message('starting'))
  const duplicateStarting = session.resolveMcpStartupOperationId(message('starting'))
  const firstReady = session.resolveMcpStartupOperationId(message('ready'))
  const duplicateReady = session.resolveMcpStartupOperationId(message('ready'))
  const secondStarting = session.resolveMcpStartupOperationId(message('starting'))
  const secondReady = session.resolveMcpStartupOperationId(message('ready'))

  assert(firstStarting.startsWith('mcp-startup:codex:main-thread:node_repl:'))
  assert.strictEqual(duplicateStarting, firstStarting)
  assert.strictEqual(firstReady, firstStarting)
  assert.strictEqual(duplicateReady, firstStarting)
  assert.notStrictEqual(secondStarting, firstStarting)
  assert.strictEqual(secondReady, secondStarting)
  assert(secondStarting.startsWith('mcp-startup:codex:main-thread:node_repl:'))
}

function testMcpSystemNotificationUsesCanonicalMessageIdAndDuration() {
  const session = new SessionInstance('mcp-notification-identity-test-session', '/tmp/ccgui-mcp-notification-identity-test')
  session.provider = 'codex'
  const events = createEventSink(session)

  const originalAppendIndexMessage = historyManager.appendIndexMessage
  const originalLoadIndexEntries = historyManager.loadIndexEntries
  const originalUpdateMessage = historyManager.updateMessage
  const originalUpdateIndexMessage = historyManager.updateIndexMessage
  const originalSaveMessageToHistory = session.saveMessageToHistory

  try {
    session.saveMessageToHistory = () => {}
    historyManager.appendIndexMessage = () => true
    historyManager.loadIndexEntries = () => []
    historyManager.updateMessage = () => true
    historyManager.updateIndexMessage = () => true

    const startedAt = Date.now() - 1500
    const operationId = 'mcp-startup:codex:thread-main:node_repl:identity'
    const startingMessage = session.emitSystemNotification('mcp-server-starting', {
      type: 'mcp-server-starting',
      provider: 'codex',
      name: 'node_repl',
      status: 'starting',
      operationId,
      startedAt
    })
    const readyMessage = session.emitSystemNotification('mcp-server-ready', {
      type: 'mcp-server-ready',
      provider: 'codex',
      name: 'node_repl',
      status: 'ready',
      operationId,
      completedAt: startedAt + 1200
    })

    assert(startingMessage?.id)
    assert.strictEqual(readyMessage?.id, startingMessage.id)
    assert.strictEqual(readyMessage.data.durationMs, 1200)

    const notifications = events.filter(event => event.type === 'system-notification')
    assert.strictEqual(notifications.length, 2)
    assert.strictEqual(notifications[0].payload.messageId, startingMessage.id)
    assert.strictEqual(notifications[1].payload.messageId, startingMessage.id)
    assert.strictEqual(notifications[1].payload.durationMs, 1200)
  } finally {
    session.saveMessageToHistory = originalSaveMessageToHistory
    historyManager.appendIndexMessage = originalAppendIndexMessage
    historyManager.loadIndexEntries = originalLoadIndexEntries
    historyManager.updateMessage = originalUpdateMessage
    historyManager.updateIndexMessage = originalUpdateIndexMessage
  }
}

async function run() {
  if (!process.argv.includes('--codex-only')) {
    testClaudeSubagentSemantics()
    testClaudeTeamLifecycleComesFromExplicitEvents()
    testClaudeTeamMemberIdsKeepDistinctNonAsciiNames()
    testClaudeCollaborativePendingStateClearsAtTurnBoundary()
    testClaudeCollaborativeSpawnWorksWithStreamFirstOrdering()
    testClaudeSidechainRequiresExplicitFileBinding()
    testClaudeBackgroundTaskEventsAreModeledWithoutProviderNotifications()
    testClaudeToolProgressUpdatesExistingToolMessage()
  }
  testCodexSpawnAgentSemantics()
  testCodexSubAgentActivitySemantics()
  testCodexSubAgentThreadsDoNotReplaceMainThread()
  await testCodexSendMessageToSubagentThread()
  await testCodexInterruptsMainAndSubAgentTurns()
  testSessionActiveAgentTracking()
  await testCodexCloseSubagentAgent()
  testCodexMcpStartupNotificationKeepsSubagentAttribution()
  testCodexReadStateNotificationIsIgnored()
  testSubagentMcpNotificationRoutesToSubagentHistory()
  testMcpStartupOperationCyclesAreIsolated()
  testMcpSystemNotificationUsesCanonicalMessageIdAndDuration()
  console.log('agent-orchestration-tests: ok')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
