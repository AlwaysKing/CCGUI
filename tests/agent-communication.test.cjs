const assert = require('assert')
const { spawn } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')
const {
  AgentCommunicationService,
  sameTeam
} = require('../electron/agent-communication/agent-communication-service')
const { loadTeams, saveTeams } = require('../electron/agent-communication/team-store')

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

class FakeSession {
  constructor({ id, projectId, isProcessing = false }) {
    this.id = id
    this.projectId = projectId
    this.isProcessing = isProcessing
    this.runtimeReady = false
    this.sentMessages = []
  }

  isRuntimeReady() {
    return this.runtimeReady
  }

  async sendMessage(content) {
    this.sentMessages.push(content)
    this.isProcessing = true
  }
}

class FakeSessionManager {
  constructor(sessions = []) {
    this.sessions = new Map(sessions.map(session => [session.id, session]))
    this.interrupts = []
  }

  getSession(sessionId) {
    return this.sessions.get(sessionId) || null
  }

  async sendInterrupt(sessionId) {
    this.interrupts.push(sessionId)
    const session = this.sessions.get(sessionId)
    if (session) {
      session.isProcessing = false
    }
  }

  closeSession(sessionId) {
    this.sessions.delete(sessionId)
  }

  stopSessionRuntime(sessionId) {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.runtimeReady = false
    }
  }
}

function createMcpClient(prepared) {
  const command = process.env.CCGUI_TEST_MCP_COMMAND || process.execPath
  const child = spawn(command, prepared.mcpConfig.args, {
    env: {
      ...process.env,
      ...prepared.mcpConfig.env
    },
    stdio: ['pipe', 'pipe', 'pipe']
  })
  let buffer = ''
  let nextId = 1
  const pending = new Map()

  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = lines.pop()
    for (const line of lines) {
      if (!line.trim()) continue
      const message = JSON.parse(line)
      if (message.id !== undefined && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id)
        pending.delete(message.id)
        if (message.error) {
          reject(new Error(message.error.message || 'MCP request failed'))
        } else {
          resolve(message.result)
        }
      }
    }
  })

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => {
    const text = String(chunk || '').trim()
    if (text) {
      process.stderr.write(`[bridge-test] ${text}\n`)
    }
  })

  function request(method, params = {}) {
    const id = nextId++
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      child.stdin.write(`${JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params
      })}\n`)
    })
  }

  async function callTool(name, args = {}) {
    const result = await request('tools/call', {
      name,
      arguments: args
    })
    const text = result?.content?.find(item => item.type === 'text')?.text || '{}'
    return JSON.parse(text)
  }

  async function close() {
    try {
      child.stdin.end()
    } catch {}
    await delay(20)
    if (!child.killed) {
      child.kill('SIGTERM')
    }
  }

  return {
    request,
    callTool,
    close
  }
}

async function initializeClient(client) {
  await client.request('initialize', {
    protocolVersion: '2024-11-05',
    capabilities: {},
    clientInfo: {
      name: 'ccgui-agent-communication-test',
      version: '1.0.0'
    }
  })
}

async function main() {
  assert.strictEqual(sameTeam(null, null), true)
  assert.strictEqual(sameTeam(null, 'alpha'), false)
  assert.strictEqual(sameTeam(' alpha ', 'alpha'), true)

  const projectA = 'project-a'
  const projectB = 'project-b'
  const sessions = [
    new FakeSession({ id: 'session-a', projectId: projectA }),
    new FakeSession({ id: 'session-b', projectId: projectA }),
    new FakeSession({ id: 'session-c', projectId: projectA }),
    new FakeSession({ id: 'session-d', projectId: projectB }),
    new FakeSession({ id: 'session-e', projectId: projectA }),
    new FakeSession({ id: 'session-f', projectId: projectA })
  ]
  const manager = new FakeSessionManager(sessions)
  let createdSessionCounter = 0
  const sessionChanges = []
  const sessionCreationRequests = []
  const resolvedSessionCreationRequests = []
  const startedSessions = []
  const stoppedSessions = []
  const deletedSessions = []
  const configs = {
    'session-a': { id: 'session-a', projectId: projectA, name: 'Leader A', teamId: 'alpha', role: 'leader' },
    'session-b': { id: 'session-b', projectId: projectA, name: 'Member B', teamId: 'alpha', role: 'member' },
    'session-c': { id: 'session-c', projectId: projectA, name: 'Beta C', teamId: 'beta', role: 'leader' },
    'session-d': { id: 'session-d', projectId: projectB, name: 'Project B D', teamId: 'alpha', role: 'leader' },
    'session-e': { id: 'session-e', projectId: projectA, name: 'Untamed E', teamId: null, role: null },
    'session-f': { id: 'session-f', projectId: projectA, name: 'Untamed F', teamId: null, role: null },
    'session-g': { id: 'session-g', projectId: projectA, name: 'Non-running G', teamId: 'alpha', role: 'member' }
  }
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-agent-comm-home-'))
  process.env.CCGUI_HOME = tempHome
  const socketPath = path.join(os.tmpdir(), `ccgui-agent-comm-test-${process.pid}.sock`)
  const service = new AgentCommunicationService({
    sessionManager: manager,
    socketPath,
    getSessionConfig: (projectId, sessionId) => configs[sessionId] || null,
    persistSessionIdentity: (projectId, sessionId, identity) => {
      configs[sessionId] = {
        ...(configs[sessionId] || { id: sessionId, projectId }),
        teamId: identity.teamId,
        role: identity.role
      }
      return configs[sessionId]
    },
    createSessionRecord: async ({ projectId, name, teamId, role, settings }) => {
      sessionCreationRequests.push({ projectId, name, teamId, role, settings })
      createdSessionCounter += 1
      const sessionId = `session-created-${createdSessionCounter}`
      const sessionConfig = {
        id: sessionId,
        projectId,
        name,
        teamId,
        role
      }
      configs[sessionId] = sessionConfig
      manager.sessions.set(sessionId, new FakeSession({ id: sessionId, projectId }))
      return sessionConfig
    },
    resolveSessionCreationSettings: options => {
      resolvedSessionCreationRequests.push(options)
      const provider = options.provider || 'claude'
      const model = options.model || 'leader-model'
      return {
        provider,
        settings: {
          tool: provider,
          modelMode: 'custom',
          modelId: model,
          modelCardId: `${model}-card`,
          credentialId: `${model}-credential`,
          targetKind: 'provider'
        },
        model,
        modelId: model,
        modelCardId: `${model}-card`,
        modelMode: 'custom'
      }
    },
    listProjectSessions: () => Object.values(configs),
    startSessionRecord: async ({ sessionId }) => {
      startedSessions.push(sessionId)
      const session = new FakeSession({ id: sessionId, projectId: projectA })
      session.runtimeReady = true
      manager.sessions.set(sessionId, session)
      return { success: true }
    },
    stopSessionRecord: ({ sessionId }) => {
      stoppedSessions.push(sessionId)
      const session = manager.getSession(sessionId)
      if (session) session.runtimeReady = false
      return { success: true }
    },
    deleteSessionRecord: async ({ sessionId, permanent }) => {
      deletedSessions.push({ sessionId, permanent })
      configs[sessionId] = {
        ...(configs[sessionId] || {}),
        deleted: true,
        deletedAt: new Date().toISOString()
      }
      manager.sessions.delete(sessionId)
      return {
        success: true,
        permanent,
        warnings: permanent
          ? [{
            sessionId,
            provider: 'codex',
            error: 'mock provider cleanup warning',
            type: 'provider-delete-failed'
          }]
          : []
      }
    },
    sessionConnectionTimeoutMs: 0,
    onSessionsChanged: payload => {
      sessionChanges.push(payload)
    }
  })

  const clients = []
  try {
    saveTeams(projectA, [{
      id: 'alpha',
      projectId: projectA,
      name: 'Alpha Team',
      members: {
        'session-a': { role: 'leader' },
        'session-b': { role: 'member' },
        'session-g': { role: 'member' }
      }
    }])
    await service.start()
    const prepared = new Map()
    for (const session of sessions) {
      prepared.set(session.id, await service.prepareSession({ session, provider: 'codex' }))
    }

    const clientA = createMcpClient(prepared.get('session-a'))
    const clientB = createMcpClient(prepared.get('session-b'))
    const clientC = createMcpClient(prepared.get('session-c'))
    const clientD = createMcpClient(prepared.get('session-d'))
    const clientE = createMcpClient(prepared.get('session-e'))
    const clientF = createMcpClient(prepared.get('session-f'))
    clients.push(clientA, clientB, clientC, clientD, clientE, clientF)
    await Promise.all([clientA, clientB, clientC, clientD, clientE, clientF].map(initializeClient))

    const initializeResult = await clientA.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'ccgui-agent-communication-test',
        version: '1.0.0'
      }
    })
    assert(initializeResult.instructions.includes('send_inbox_message'))

    const tools = await clientA.request('tools/list', {})
    assert.deepStrictEqual(
      tools.tools.map(tool => tool.name).sort(),
      [
        'ack_inbox_messages',
        'create_session',
        'create_team',
        'delete_session',
        'info',
        'interrupt_session',
        'join_team',
        'list_inbox_messages',
        'list_sessions',
        'send_inbox_message',
        'send_message',
        'start_session',
        'stop_session'
      ]
    )
    const createSessionTool = tools.tools.find(tool => tool.name === 'create_session')
    assert.deepStrictEqual(createSessionTool.inputSchema.properties.provider.enum, ['codex', 'claude'])
    assert(createSessionTool.inputSchema.properties.model)
    const deleteSessionTool = tools.tools.find(tool => tool.name === 'delete_session')
    assert.strictEqual(deleteSessionTool.inputSchema.properties.permanent.type, 'boolean')

    const listed = await clientA.callTool('list_sessions')
    assert.deepStrictEqual(
      listed.sessions.map(session => session.session_id).sort(),
      ['session-a', 'session-b', 'session-g']
    )
    assert.strictEqual(
      listed.sessions.find(session => session.session_id === 'session-g')?.is_running,
      false
    )
    assert.strictEqual(
      listed.sessions.find(session => session.session_id === 'session-g')?.connected,
      false
    )

    const crossTeam = await clientA.callTool('send_message', {
      target_session_id: 'session-c',
      message: 'cross-team should fail'
    })
    assert.strictEqual(crossTeam.status, 'denied_team')

    const crossProject = await clientA.callTool('send_message', {
      target_session_id: 'session-d',
      message: 'cross-project should fail'
    })
    assert.strictEqual(crossProject.status, 'denied_project')

    const delivered = await clientA.callTool('send_message', {
      target_session_id: 'session-b',
      message: 'first message'
    })
    assert.strictEqual(delivered.status, 'delivered')
    const sessionB = manager.getSession('session-b')
    assert.strictEqual(sessionB.sentMessages.length, 1)
    assert.strictEqual(
      sessionB.sentMessages[0].ccgui.internalMessage.senderSessionId,
      'session-a'
    )
    const listedBusy = await clientA.callTool('list_sessions')
    assert.strictEqual(
      listedBusy.sessions.find(session => session.session_id === 'session-b')?.is_processing,
      true
    )

    const queued = await clientA.callTool('send_message', {
      target_session_id: 'session-b',
      message: 'second message'
    })
    assert.strictEqual(queued.status, 'queued')

    sessionB.isProcessing = false
    service.handleSessionEvent({ eventType: 'result' }, sessionB)
    await delay(80)
    assert.strictEqual(sessionB.sentMessages.length, 2)
    assert.strictEqual(
      sessionB.sentMessages[1].ccgui.internalMessage.message,
      'second message'
    )

    sessionB.isProcessing = true
    const interrupted = await clientA.callTool('interrupt_session', {
      target_session_id: 'session-b',
      reason: 'test interrupt'
    })
    assert.strictEqual(interrupted.status, 'interrupted')
    assert.deepStrictEqual(manager.interrupts, ['session-b'])

    const nonLeaderInterrupt = await clientB.callTool('interrupt_session', {
      target_session_id: 'session-a'
    })
    assert.strictEqual(nonLeaderInterrupt.status, 'denied_role')

    const crossTeamInterrupt = await clientC.callTool('interrupt_session', {
      target_session_id: 'session-b'
    })
    assert.strictEqual(crossTeamInterrupt.status, 'denied_team')

    const listWithoutSelf = await clientA.callTool('list_sessions', {
      include_self: false
    })
    assert.deepStrictEqual(
      listWithoutSelf.sessions.map(session => session.session_id),
      ['session-b', 'session-g']
    )

    const memberStartAttempt = await clientB.callTool('start_session', {
      target_session_id: 'session-g'
    })
    assert.strictEqual(memberStartAttempt.status, 'denied_role')

    const crossTeamStartAttempt = await clientA.callTool('start_session', {
      target_session_id: 'session-c'
    })
    assert.strictEqual(crossTeamStartAttempt.status, 'denied_team')

    const selfDeleteAttempt = await clientA.callTool('delete_session', {
      target_session_id: 'session-a'
    })
    assert.strictEqual(selfDeleteAttempt.status, 'deny_self_target')

    sessionB.runtimeReady = true
    const stoppedMember = await clientA.callTool('stop_session', {
      target_session_id: 'session-b'
    })
    assert.strictEqual(stoppedMember.status, 'stopped')
    assert.deepStrictEqual(stoppedSessions, ['session-b'])

    const startedMember = await clientA.callTool('start_session', {
      target_session_id: 'session-g'
    })
    assert.strictEqual(startedMember.status, 'started')
    assert.strictEqual(startedMember.connected, false)
    assert.deepStrictEqual(startedSessions, ['session-g'])
    const listedAfterStart = await clientA.callTool('list_sessions')
    assert.strictEqual(
      listedAfterStart.sessions.find(session => session.session_id === 'session-g')?.is_running,
      true
    )

    const stoppedNonrunning = await clientA.callTool('stop_session', {
      target_session_id: 'session-g'
    })
    assert.strictEqual(stoppedNonrunning.status, 'stopped')
    const stoppedNotRunning = await clientA.callTool('stop_session', {
      target_session_id: 'session-g'
    })
    assert.strictEqual(stoppedNotRunning.status, 'not_running')

    await clientA.callTool('start_session', { target_session_id: 'session-g' })
    const softDeletedMember = await clientA.callTool('delete_session', {
      target_session_id: 'session-g'
    })
    assert.strictEqual(softDeletedMember.status, 'trashed')
    assert.strictEqual(softDeletedMember.permanent, false)
    assert.deepStrictEqual(deletedSessions, [{ sessionId: 'session-g', permanent: false }])
    assert.strictEqual(configs['session-g'].teamId, null)
    assert.strictEqual(configs['session-g'].role, null)
    assert.strictEqual(
      loadTeams(projectA)[0].members['session-g'],
      undefined
    )
    const listedAfterDelete = await clientA.callTool('list_sessions')
    assert.strictEqual(
      listedAfterDelete.sessions.some(session => session.session_id === 'session-g'),
      false
    )

    const initialInfoE = await clientE.callTool('info')
    assert.strictEqual(initialInfoE.identity.team_id, null)
    assert.strictEqual(initialInfoE.identity.role, null)

    const createdTeam = await clientE.callTool('create_team', { name: 'e-team' })
    assert.strictEqual(createdTeam.status, 'created')
    assert.strictEqual(createdTeam.role, 'leader')

    const leaderInfo = await clientE.callTool('info')
    assert.strictEqual(leaderInfo.identity.team_id, createdTeam.team_id)
    assert.strictEqual(leaderInfo.identity.role, 'leader')

    const duplicateTeam = await clientE.callTool('create_team', { name: 'e-team-2' })
    assert.strictEqual(duplicateTeam.status, 'already_in_team')

    const createdSession = await clientE.callTool('create_session', { name: 'Worker E' })
    assert.strictEqual(createdSession.status, 'created')
    assert.strictEqual(createdSession.team_id, createdTeam.team_id)
    assert.strictEqual(createdSession.role, 'member')
    assert.strictEqual(createdSession.provider, 'claude')
    assert.strictEqual(createdSession.model, 'leader-model')
    assert.strictEqual(resolvedSessionCreationRequests[0].provider, null)
    assert.strictEqual(resolvedSessionCreationRequests[0].model, null)
    assert.strictEqual(sessionCreationRequests[0].settings.modelId, 'leader-model')

    const joinedTeam = await clientF.callTool('join_team', { team_id: createdTeam.team_id })
    assert.strictEqual(joinedTeam.status, 'joined')
    assert.strictEqual(joinedTeam.role, 'member')

    const duplicateJoin = await clientF.callTool('join_team', { team_id: createdTeam.team_id })
    assert.strictEqual(duplicateJoin.status, 'already_in_team')

    const joinedInfo = await clientF.callTool('info')
    assert.strictEqual(joinedInfo.identity.team_id, createdTeam.team_id)
    assert.strictEqual(joinedInfo.identity.role, 'member')

    const teamList = await clientE.callTool('list_sessions')
    assert.deepStrictEqual(
      teamList.sessions.map(session => session.session_id).sort(),
      ['session-created-1', 'session-e', 'session-f']
    )

    const inboxSent = await clientE.callTool('send_inbox_message', {
      target_session_id: 'session-f',
      message: 'please reply without interrupting me'
    })
    assert.strictEqual(inboxSent.status, 'inbox')

    const inboxListF = await clientF.callTool('list_inbox_messages')
    const inboxMessage = inboxListF.messages.find(message => message.message_id === inboxSent.message_id)
    assert(inboxMessage, 'expected inbox message to be visible to session-f')
    assert.strictEqual(inboxMessage.sender_session_id, 'session-e')

    const acknowledged = await clientF.callTool('ack_inbox_messages', {
      message_ids: [inboxSent.message_id]
    })
    assert.deepStrictEqual(acknowledged.acknowledged_message_ids, [inboxSent.message_id])

    const remainingUnread = await clientF.callTool('list_inbox_messages')
    assert.strictEqual(
      remainingUnread.messages.some(message => message.message_id === inboxSent.message_id),
      false
    )

    const explicitCreatedSession = await clientE.callTool('create_session', {
      name: 'Worker Codex',
      provider: 'codex',
      model: 'codex-model'
    })
    assert.strictEqual(explicitCreatedSession.provider, 'codex')
    assert.strictEqual(explicitCreatedSession.model, 'codex-model')
    assert.strictEqual(resolvedSessionCreationRequests[1].provider, 'codex')
    assert.strictEqual(resolvedSessionCreationRequests[1].model, 'codex-model')
    assert.strictEqual(sessionCreationRequests[1].settings.modelId, 'codex-model')
    assert.strictEqual(sessionCreationRequests[1].settings.tool, 'codex')

    const permanentlyDeleted = await clientE.callTool('delete_session', {
      target_session_id: explicitCreatedSession.session_id,
      permanent: true
    })
    assert.strictEqual(permanentlyDeleted.status, 'deleted')
    assert.strictEqual(permanentlyDeleted.permanent, true)
    assert.strictEqual(permanentlyDeleted.warnings.length, 1)
    assert.strictEqual(permanentlyDeleted.warnings[0].type, 'provider-delete-failed')
    assert.deepStrictEqual(deletedSessions[1], {
      sessionId: explicitCreatedSession.session_id,
      permanent: true
    })

    assert(sessionChanges.some(item => item.reason === 'team-updated'))
    assert(sessionChanges.some(item => item.reason === 'session-created'))

    sessionB.isProcessing = true
    const senderIdentity = service.connections.get('session-a').agentCommunicationIdentity
    for (let index = 0; index < 100; index += 1) {
      const queuedResult = await service.sendMessage(senderIdentity, {
        target_session_id: 'session-b',
        message: `queue item ${index}`
      })
      assert.strictEqual(queuedResult.status, 'queued')
    }
    await assert.rejects(
      () => service.sendMessage(senderIdentity, {
        target_session_id: 'session-b',
        message: 'queue overflow'
      }),
      error => error.status === 'target_queue_full'
    )
    service.queues.delete('session-b')

    console.log('agent-communication.test.cjs passed')
  } finally {
    await Promise.all(clients.map(client => client.close()))
    await service.stop()
    fs.rmSync(tempHome, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
