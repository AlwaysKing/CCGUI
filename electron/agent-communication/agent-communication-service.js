const crypto = require('crypto')
const fs = require('fs')
const net = require('net')
const os = require('os')
const path = require('path')
const logger = require('../logger')
const runtimePaths = require('../runtime-paths')
const {
  findTeam,
  isTeamMember,
  loadTeams,
  removeTeam,
  saveTeams
} = require('./team-store')
const {
  ackMessages,
  addMessage: addInboxMessage,
  listMessages: listInboxMessages,
  loadInbox
} = require('./inbox-store')

const MCP_SERVER_NAME = 'ccgui_internal'
const MCP_SERVER_VERSION = '1.0.0'
const MAX_MESSAGE_LENGTH = 64 * 1024
const MAX_QUEUE_SIZE = 100

const MCP_INSTRUCTIONS = [
  '你是 CCGUI 内部 Agent 通讯系统中的一个 Session。',
  '你的身份由 bridge 连接绑定，禁止在工具参数中伪造 project_id、team_id、role 或 sender。',
  '使用 `info` 获取当前 session_id、project_id、team_id、role。',
  '所有 Agent 通讯只允许同一 project。有 team 时只允许同一 team；无 team 时只允许同项目内同样无 team 的 Session。',
  '回复其他 Session 的任务或消息时，默认使用 `send_inbox_message`，不要用 `send_message` 发送完整回复。',
  '`send_message` 只用于 leader 初次派发任务，或目标空闲时发送“请查看收件箱”的短提醒。',
  '`send_inbox_message` 是收件箱投递，不打断目标；目标通过 `list_inbox_messages` 主动轮询，并用 `ack_inbox_messages` 标记已读。',
  '回复前先通过 `list_sessions` 检查目标的 `is_processing`。完整回复始终写入收件箱；若目标不在 processing，再发送一条简短的 `send_message` 提醒其查看收件箱。',
  '`create_team` 仅允许当前无 team 的 Session 调用，创建者自动成为 leader。',
  '`join_team` 仅允许当前无 team 的 Session 调用，加入后角色为 member。',
  '`create_session` 仅 leader 可调用，新 Session 自动加入 leader 当前 team，角色为 member；可通过 provider/model 覆盖默认继承的 leader 模型设置。',
  '`start_session`、`stop_session`、`delete_session` 仅 leader 可操作同 team 的 member。',
  '`delete_session` 默认软删除到回收站；permanent=true 时永久删除。',
  '`list_sessions` 会返回当前 team 的全部有效 Session，包括未运行和未连接的 Session。',
  '`interrupt_session` 仅允许同项目、同非空 team 的 leader 中断其他 Session。',
  '同一 Session 同时只能属于一个 team。'
].join('\n')

function normalizeOptionalString(value) {
  if (value === null || value === undefined) return null
  const normalized = String(value).trim()
  return normalized || null
}

function normalizeRole(value) {
  const normalized = normalizeOptionalString(value)
  return normalized ? normalized.toLowerCase() : null
}

function sameTeam(left, right) {
  return normalizeOptionalString(left) === normalizeOptionalString(right)
}

function removeTeamMember(projectId, teamId, sessionId) {
  const teams = loadTeams(projectId)
  const team = findTeam(teams, teamId)
  if (!team?.members?.[sessionId]) {
    return false
  }
  delete team.members[sessionId]
  saveTeams(projectId, teams)
  return true
}

function secureTokenEquals(left, right) {
  const leftBuffer = Buffer.from(String(left || ''))
  const rightBuffer = Buffer.from(String(right || ''))
  if (leftBuffer.length !== rightBuffer.length || leftBuffer.length === 0) {
    return false
  }
  return crypto.timingSafeEqual(leftBuffer, rightBuffer)
}

function writeJsonLine(socket, payload) {
  if (!socket || socket.destroyed) return false
  socket.write(`${JSON.stringify(payload)}\n`)
  return true
}

function cloneIdentity(identity) {
  return {
    sessionId: identity.sessionId,
    projectId: identity.projectId,
    teamId: identity.teamId || null,
    role: identity.role || null,
    name: identity.name || identity.sessionId
  }
}

function createInternalMessageContent(sender, entry) {
  const internalMessage = {
    id: entry.id,
    senderSessionId: sender.sessionId,
    senderName: sender.name,
    senderProjectId: sender.projectId,
    senderTeamId: sender.teamId || null,
    senderRole: sender.role || null,
    receiverSessionId: entry.receiverSessionId,
    message: entry.message,
    time: entry.time
  }
  const providerText = [
    '[CCGUI INTERNAL AGENT MESSAGE]',
    `message_id: ${entry.id}`,
    `sender_session_id: ${sender.sessionId}`,
    `sender_name: ${sender.name}`,
    `sender_team_id: ${sender.teamId || ''}`,
    `sender_role: ${sender.role || ''}`,
    `time: ${entry.time}`,
    '---',
    entry.message
  ].join('\n')

  return {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: providerText }]
    },
    ccgui: {
      internalMessage
    }
  }
}

class AgentCommunicationService {
  constructor({
    sessionManager,
    getSessionConfig = null,
    persistSessionIdentity = null,
    createSessionRecord = null,
    resolveSessionCreationSettings = null,
    listProjectSessions = null,
    startSessionRecord = null,
    stopSessionRecord = null,
    deleteSessionRecord = null,
    sessionConnectionTimeoutMs = 15000,
    onSessionsChanged = null,
    onInboxChanged = null,
    socketPath = null
  } = {}) {
    if (!sessionManager) {
      throw new Error('AgentCommunicationService requires sessionManager')
    }

    this.sessionManager = sessionManager
    this.getSessionConfig = typeof getSessionConfig === 'function'
      ? getSessionConfig
      : (projectId, sessionId) => {
          const projectService = require('../services/project-service')
          return projectService.getSessionConfig(projectId, sessionId)
        }
    this.persistSessionIdentity = typeof persistSessionIdentity === 'function'
      ? persistSessionIdentity
      : (projectId, sessionId, identity) => {
          const sessionConfigManager = require('../storage/session-config-manager')
          return sessionConfigManager.updateSession(projectId, sessionId, identity)
        }
    this.createSessionRecord = typeof createSessionRecord === 'function'
      ? createSessionRecord
      : async ({ projectId, name, teamId, role, settings }) => {
          const projectService = require('../services/project-service')
          return projectService.createSession(projectId, name, settings, { teamId, role })
        }
    this.resolveSessionCreationSettings = typeof resolveSessionCreationSettings === 'function'
      ? resolveSessionCreationSettings
      : options => {
          const projectService = require('../services/project-service')
          return projectService.resolveSessionCreationSettings(options)
        }
    this.listProjectSessions = typeof listProjectSessions === 'function'
      ? listProjectSessions
      : projectId => {
          const sessionConfigManager = require('../storage/session-config-manager')
          return sessionConfigManager.getProjectSessions(projectId)
        }
    this.startSessionRecord = typeof startSessionRecord === 'function'
      ? startSessionRecord
      : async ({ projectId, sessionId }) => {
          const projectService = require('../services/project-service')
          await projectService.ensureSessionHistoryHydrated(projectId, sessionId)
          const session = await this.sessionManager.getOrCreateSession(
            sessionId,
            projectService.getProjectPath(projectId),
            null,
            true
          )
          if (!session.isRuntimeReady()) {
            await session.start({ reason: 'agent-leader-start' })
          }
          return { success: true }
        }
    this.stopSessionRecord = typeof stopSessionRecord === 'function'
      ? stopSessionRecord
      : ({ sessionId }) => {
          this.sessionManager.stopSessionRuntime(sessionId, { reason: 'agent-leader-stop' })
          return { success: true }
        }
    this.deleteSessionRecord = typeof deleteSessionRecord === 'function'
      ? deleteSessionRecord
      : ({ projectId, sessionId, permanent }) => {
          const projectService = require('../services/project-service')
          return permanent
            ? projectService.deleteSession(projectId, sessionId)
            : projectService.softDeleteSession(projectId, sessionId)
        }
    this.sessionConnectionTimeoutMs = Math.max(0, Number(sessionConnectionTimeoutMs) || 0)
    this.notifySessionsChanged = typeof onSessionsChanged === 'function'
      ? onSessionsChanged
      : () => {}
    this.notifyInboxChanged = typeof onInboxChanged === 'function'
      ? onInboxChanged
      : () => {}

    const profile = runtimePaths.getProfile()
    this.socketPath = socketPath || path.join(os.tmpdir(), `ccgui-agent-comm-${profile}-${process.pid}.sock`)
    this.tempDir = path.join(os.tmpdir(), `ccgui-agent-mcp-${profile}-${process.pid}`)
    this.bridgePath = this.resolveBridgePath()

    this.server = null
    this.startPromise = null
    this.preparedSessions = new Map()
    this.connections = new Map()
    this.queues = new Map()
    this.stopped = false
  }

  resolveBridgePath() {
    if (process.resourcesPath) {
      const packagedPath = path.join(process.resourcesPath, 'agent-communication', 'internal-mcp-bridge.cjs')
      if (fs.existsSync(packagedPath)) {
        return packagedPath
      }
    }
    return path.join(__dirname, 'internal-mcp-bridge.cjs')
  }

  async start() {
    if (this.startPromise) {
      return this.startPromise
    }

    this.startPromise = new Promise((resolve, reject) => {
      try {
        fs.mkdirSync(this.tempDir, { recursive: true, mode: 0o700 })
        fs.chmodSync(this.tempDir, 0o700)
        fs.rmSync(this.socketPath, { force: true })
      } catch (error) {
        reject(error)
        return
      }

      this.server = net.createServer(socket => this.handleConnection(socket))
      const startupErrorHandler = error => {
        logger.error('[AgentCommunication] Socket server error:', error.message)
        reject(error)
      }
      this.server.once('error', startupErrorHandler)
      this.server.listen(this.socketPath, () => {
        this.server.off('error', startupErrorHandler)
        this.server.on('error', error => {
          logger.error('[AgentCommunication] Socket server error:', error.message)
        })
        try {
          fs.chmodSync(this.socketPath, 0o600)
        } catch (error) {
          logger.warn('[AgentCommunication] Failed to set socket permissions:', error.message)
        }
        logger.info('[AgentCommunication] Listening', { socketPath: this.socketPath })
        resolve()
      })
    })

    return this.startPromise
  }

  async prepareSession({ session, provider = null } = {}) {
    if (!session?.id || !session?.projectId) {
      throw new Error('prepareSession requires an active session')
    }

    await this.start()
    this.revokeSession(session.id, { preserveQueue: false })

    const sessionConfig = this.getSessionConfig(session.projectId, session.id) || {}
    const identity = {
      sessionId: session.id,
      projectId: normalizeOptionalString(sessionConfig.projectId) || session.projectId,
      teamId: normalizeOptionalString(sessionConfig.teamId),
      role: normalizeRole(sessionConfig.role),
      name: normalizeOptionalString(sessionConfig.name) || session.id
    }
    const token = crypto.randomBytes(32).toString('hex')
    const env = {
      ELECTRON_RUN_AS_NODE: '1',
      CCGUI_AGENT_SOCKET: this.socketPath,
      CCGUI_SESSION_ID: identity.sessionId,
      CCGUI_BRIDGE_TOKEN: token
    }

    let claudeConfigPath = null
    if (provider === 'claude') {
      const configFileName = `${crypto.createHash('sha256').update(identity.sessionId).digest('hex')}.json`
      claudeConfigPath = path.join(this.tempDir, configFileName)
      const config = {
        mcpServers: {
          [MCP_SERVER_NAME]: {
            type: 'stdio',
            command: process.execPath,
            args: [this.bridgePath],
            env
          }
        }
      }
      fs.writeFileSync(claudeConfigPath, JSON.stringify(config, null, 2), {
        encoding: 'utf8',
        mode: 0o600
      })
      fs.chmodSync(claudeConfigPath, 0o600)
    }

    this.preparedSessions.set(identity.sessionId, {
      ...identity,
      token,
      provider,
      claudeConfigPath
    })

    return {
      identity,
      mcpConfig: {
        serverName: MCP_SERVER_NAME,
        command: process.execPath,
        args: [this.bridgePath],
        env,
        claudeConfigPath
      }
    }
  }

  revokeSession(sessionId, { preserveQueue = false } = {}) {
    const normalizedSessionId = normalizeOptionalString(sessionId)
    if (!normalizedSessionId) return

    const prepared = this.preparedSessions.get(normalizedSessionId)
    if (prepared?.claudeConfigPath) {
      try {
        fs.rmSync(prepared.claudeConfigPath, { force: true })
      } catch (error) {
        logger.warn('[AgentCommunication] Failed to remove temporary MCP config:', error.message)
      }
    }

    const connection = this.connections.get(normalizedSessionId)
    if (connection) {
      connection.destroy()
      this.connections.delete(normalizedSessionId)
    }

    this.preparedSessions.delete(normalizedSessionId)
    if (!preserveQueue) {
      this.queues.delete(normalizedSessionId)
    }
  }

  async stop() {
    if (this.stopped) return
    this.stopped = true

    for (const connection of this.connections.values()) {
      try {
        connection.destroy()
      } catch {}
    }
    this.connections.clear()
    this.queues.clear()
    this.preparedSessions.clear()

    try {
      fs.rmSync(this.socketPath, { force: true })
    } catch (error) {
      logger.warn('[AgentCommunication] Failed to remove socket file:', error.message)
    }

    if (this.server) {
      if (this.server.listening) {
        await new Promise(resolve => this.server.close(() => resolve()))
      }
      this.server = null
    }

    try {
      fs.rmSync(this.tempDir, { recursive: true, force: true })
    } catch (error) {
      logger.warn('[AgentCommunication] Failed to clean runtime files:', error.message)
    }
  }

  handleConnection(socket) {
    socket.setEncoding('utf8')
    socket.setNoDelay(true)
    socket.agentCommunicationBuffer = ''
    socket.agentCommunicationRegistered = false

    socket.on('data', chunk => {
      socket.agentCommunicationBuffer += chunk
      const lines = socket.agentCommunicationBuffer.split('\n')
      socket.agentCommunicationBuffer = lines.pop()
      for (const line of lines) {
        this.handleConnectionLine(socket, line)
      }
    })

    socket.on('error', error => {
      logger.warn('[AgentCommunication] Bridge socket error:', error.message)
    })

    socket.on('close', () => {
      if (socket.agentCommunicationRegistered && socket.agentCommunicationSessionId) {
        if (this.connections.get(socket.agentCommunicationSessionId) === socket) {
          this.connections.delete(socket.agentCommunicationSessionId)
          this.queues.delete(socket.agentCommunicationSessionId)
        }
      }
    })
  }

  handleConnectionLine(socket, rawLine) {
    const line = String(rawLine || '').trim()
    if (!line) return

    let payload = null
    try {
      payload = JSON.parse(line)
    } catch {
      if (!socket.agentCommunicationRegistered) {
        writeJsonLine(socket, {
          type: 'ccgui_register_ack',
          ok: false,
          error: 'invalid registration payload'
        })
        socket.end()
      } else {
        writeJsonLine(socket, this.buildJsonRpcError(null, -32700, 'Parse error'))
      }
      return
    }

    if (!socket.agentCommunicationRegistered) {
      this.handleRegistration(socket, payload)
      return
    }

    if (payload?.method) {
      this.handleMcpMessage(socket, payload).catch(error => {
        logger.error('[AgentCommunication] MCP request failed:', error.message)
        if (payload.id !== undefined) {
          writeJsonLine(socket, this.buildJsonRpcError(payload.id, -32603, error.message || 'Internal error'))
        }
      })
    }
  }

  handleRegistration(socket, payload) {
    if (payload?.type !== 'ccgui_register') {
      writeJsonLine(socket, {
        type: 'ccgui_register_ack',
        ok: false,
        error: 'register required'
      })
      socket.end()
      return
    }

    const sessionId = normalizeOptionalString(payload.session_id)
    const bridgeToken = normalizeOptionalString(payload.bridge_token)
    const prepared = sessionId ? this.preparedSessions.get(sessionId) : null
    const session = sessionId ? this.sessionManager.getSession(sessionId) : null

    if (!prepared || !session || !bridgeToken || !secureTokenEquals(prepared.token, bridgeToken)) {
      writeJsonLine(socket, {
        type: 'ccgui_register_ack',
        ok: false,
        error: 'invalid session binding'
      })
      socket.end()
      return
    }

    const existing = this.connections.get(sessionId)
    if (existing && existing !== socket) {
      existing.destroy()
    }

    socket.agentCommunicationRegistered = true
    socket.agentCommunicationSessionId = sessionId
    socket.agentCommunicationIdentity = cloneIdentity(prepared)
    this.connections.set(sessionId, socket)

    writeJsonLine(socket, {
      type: 'ccgui_register_ack',
      ok: true
    })
    logger.info('[AgentCommunication] Agent connected', {
      sessionId,
      projectId: prepared.projectId,
      teamId: prepared.teamId,
      role: prepared.role
    })
  }

  buildJsonRpcResult(id, result) {
    return {
      jsonrpc: '2.0',
      id,
      result
    }
  }

  buildJsonRpcError(id, code, message) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code,
        message
      }
    }
  }

  buildToolResult(payload, isError = false) {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(payload, null, 2)
        }
      ],
      isError
    }
  }

  getToolDefinitions() {
    return [
      {
        name: 'info',
        description: 'Return the current session identity, including session_id, project_id, team_id and role.',
        inputSchema: {
          type: 'object',
          properties: {},
          additionalProperties: false
        },
        annotations: {
          readOnlyHint: true
        }
      },
      {
        name: 'create_team',
        description: 'Create a new team in the current project and make the current session its leader. Only available when the current session has no team.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Team name.'
            }
          },
          required: ['name'],
          additionalProperties: false
        }
      },
      {
        name: 'join_team',
        description: 'Join an existing team in the current project as a member. Only available when the current session has no team.',
        inputSchema: {
          type: 'object',
          properties: {
            team_id: {
              type: 'string',
              description: 'Target team ID.'
            }
          },
          required: ['team_id'],
          additionalProperties: false
        }
      },
      {
        name: 'create_session',
        description: 'Create a new CCGUI session in the same project and add it to the current leader team. Provider and model default to the leader session settings. Only team leaders may use this tool.',
        inputSchema: {
          type: 'object',
          properties: {
            name: {
              type: 'string',
              description: 'Optional session name.'
            },
            provider: {
              type: 'string',
              enum: ['codex', 'claude'],
              description: 'Optional provider. Defaults to the leader provider.'
            },
            model: {
              type: 'string',
              description: 'Optional model ID, friendly provider name, or model card name. Defaults to the leader model when the provider matches.'
            }
          },
          additionalProperties: false
        }
      },
      {
        name: 'send_inbox_message',
        description: 'Send a reply or non-urgent message to another session without interrupting it. This is the default tool for replying to tasks. Check list_sessions first; if the target is idle, also send a one-line direct reminder.',
        inputSchema: {
          type: 'object',
          properties: {
            target_session_id: {
              type: 'string',
              description: 'CCGUI session ID of the target agent.'
            },
            message: {
              type: 'string',
              description: 'Message text for the target agent.'
            }
          },
          required: ['target_session_id', 'message'],
          additionalProperties: false
        }
      },
      {
        name: 'list_inbox_messages',
        description: 'List messages waiting in the current session inbox.',
        inputSchema: {
          type: 'object',
          properties: {
            unread_only: {
              type: 'boolean',
              description: 'Return only unread messages. Defaults to true.'
            }
          },
          additionalProperties: false
        },
        annotations: {
          readOnlyHint: true
        }
      },
      {
        name: 'ack_inbox_messages',
        description: 'Mark inbox messages as read by message ID.',
        inputSchema: {
          type: 'object',
          properties: {
            message_ids: {
              type: 'array',
              items: {
                type: 'string'
              },
              description: 'Message IDs to mark as read.'
            }
          },
          required: ['message_ids'],
          additionalProperties: false
        }
      },
      {
        name: 'start_session',
        description: 'Start the runtime of a non-running member session in the current team. Only the team leader may use this tool.',
        inputSchema: {
          type: 'object',
          properties: {
            target_session_id: {
              type: 'string',
              description: 'Member session ID to start.'
            }
          },
          required: ['target_session_id'],
          additionalProperties: false
        }
      },
      {
        name: 'stop_session',
        description: 'Stop the runtime of a member session in the current team without deleting the session. Only the team leader may use this tool.',
        inputSchema: {
          type: 'object',
          properties: {
            target_session_id: {
              type: 'string',
              description: 'Member session ID to stop.'
            }
          },
          required: ['target_session_id'],
          additionalProperties: false
        }
      },
      {
        name: 'delete_session',
        description: 'Delete a member session in the current team. Soft-deletes to the recycle bin by default; permanent deletion requires permanent=true. Only the team leader may use this tool.',
        inputSchema: {
          type: 'object',
          properties: {
            target_session_id: {
              type: 'string',
              description: 'Member session ID to delete.'
            },
            permanent: {
              type: 'boolean',
              description: 'Permanently delete the session instead of moving it to the recycle bin.'
            }
          },
          required: ['target_session_id'],
          additionalProperties: false
        }
      },
      {
        name: 'list_sessions',
        description: 'List CCGUI sessions in the current team, including sessions whose runtime is not running.',
        inputSchema: {
          type: 'object',
          properties: {
            include_self: {
              type: 'boolean',
              description: 'Include the current session in the result.'
            }
          },
          additionalProperties: false
        },
        annotations: {
          readOnlyHint: true
        }
      },
      {
        name: 'send_message',
        description: 'Send a direct message to another session. Use this only for task assignment or a short inbox-wakeup reminder. For replies, use send_inbox_message instead.',
        inputSchema: {
          type: 'object',
          properties: {
            target_session_id: {
              type: 'string',
              description: 'CCGUI session ID of the target agent.'
            },
            message: {
              type: 'string',
              description: 'Message text for the target agent.'
            }
          },
          required: ['target_session_id', 'message'],
          additionalProperties: false
        }
      },
      {
        name: 'interrupt_session',
        description: 'Interrupt the current processing turn of another running session. Only a leader in the same non-empty team may use this tool.',
        inputSchema: {
          type: 'object',
          properties: {
            target_session_id: {
              type: 'string',
              description: 'CCGUI session ID of the target agent.'
            },
            reason: {
              type: 'string',
              description: 'Optional reason for the interruption.'
            }
          },
          required: ['target_session_id'],
          additionalProperties: false
        }
      }
    ]
  }

  async handleMcpMessage(socket, payload) {
    const { id, method } = payload

    if (method === 'notifications/initialized' || method === 'notifications/cancelled') {
      return
    }

    if (id === undefined) {
      return
    }

    if (method === 'initialize') {
      writeJsonLine(socket, this.buildJsonRpcResult(id, {
        protocolVersion: typeof payload.params?.protocolVersion === 'string'
          ? payload.params.protocolVersion
          : '2024-11-05',
        capabilities: {
          tools: {
            listChanged: false
          }
        },
        serverInfo: {
          name: MCP_SERVER_NAME,
          version: MCP_SERVER_VERSION
        },
        instructions: MCP_INSTRUCTIONS
      }))
      return
    }

    if (method === 'ping') {
      writeJsonLine(socket, this.buildJsonRpcResult(id, {}))
      return
    }

    if (method === 'tools/list') {
      writeJsonLine(socket, this.buildJsonRpcResult(id, {
        tools: this.getToolDefinitions()
      }))
      return
    }

    if (method === 'tools/call') {
      const name = payload.params?.name
      const args = payload.params?.arguments && typeof payload.params.arguments === 'object'
        ? payload.params.arguments
        : {}
      try {
        const result = await this.callTool(socket.agentCommunicationIdentity, name, args)
        writeJsonLine(socket, this.buildJsonRpcResult(id, this.buildToolResult(result)))
      } catch (error) {
        const status = error?.status || 'internal_error'
        writeJsonLine(socket, this.buildJsonRpcResult(id, this.buildToolResult({
          ok: false,
          status,
          error: error.message || 'Internal error'
        }, true)))
      }
      return
    }

    writeJsonLine(socket, this.buildJsonRpcError(id, -32601, `Unknown method: ${method}`))
  }

  async callTool(identity, name, args) {
    if (!identity) {
      throw Object.assign(new Error('Bridge is not registered'), { status: 'unauthenticated' })
    }

    switch (name) {
      case 'info':
        return this.getIdentityInfo(identity)
      case 'create_team':
        return this.createTeam(identity, args)
      case 'join_team':
        return this.joinTeam(identity, args)
      case 'create_session':
        return this.createSession(identity, args)
      case 'start_session':
        return this.startSession(identity, args)
      case 'stop_session':
        return this.stopSession(identity, args)
      case 'delete_session':
        return this.deleteSession(identity, args)
      case 'send_inbox_message':
        return this.sendInboxMessage(identity, args)
      case 'list_inbox_messages':
        return this.getInboxMessages(identity, args)
      case 'ack_inbox_messages':
        return this.ackInboxMessages(identity, args)
      case 'list_sessions':
        return this.listSessions(identity, args)
      case 'send_message':
        return this.sendMessage(identity, args)
      case 'interrupt_session':
        return this.interruptSession(identity, args)
      default:
        throw Object.assign(new Error(`Unknown tool: ${name}`), { status: 'unknown_tool' })
    }
  }

  getIdentityInfo(identity) {
    return {
      ok: true,
      status: 'ok',
      identity: {
        session_id: identity.sessionId,
        project_id: identity.projectId,
        team_id: identity.teamId || null,
        role: identity.role || null,
        name: identity.name || identity.sessionId
      }
    }
  }

  async updateLiveIdentity(sessionId, teamId, role, knownProjectId = null) {
    const normalizedSessionId = normalizeOptionalString(sessionId)
    const normalizedTeamId = normalizeOptionalString(teamId)
    const normalizedRole = normalizeRole(role)

    const prepared = this.preparedSessions.get(normalizedSessionId)
    if (prepared) {
      prepared.teamId = normalizedTeamId
      prepared.role = normalizedRole
    }

    const connection = this.connections.get(normalizedSessionId)
    if (connection?.agentCommunicationIdentity) {
      connection.agentCommunicationIdentity.teamId = normalizedTeamId
      connection.agentCommunicationIdentity.role = normalizedRole
    }

    const session = this.sessionManager.getSession(normalizedSessionId)
    if (session?.agentIdentity) {
      session.agentIdentity.teamId = normalizedTeamId
      session.agentIdentity.role = normalizedRole
    }

    await this.persistSessionIdentity(
      (knownProjectId || prepared?.projectId || connection?.agentCommunicationIdentity?.projectId || session?.projectId || null),
      normalizedSessionId,
      {
        teamId: normalizedTeamId,
        role: normalizedRole
      }
    )
  }

  async createTeam(identity, args = {}) {
    const name = normalizeOptionalString(args.name)
    if (!name) {
      throw Object.assign(new Error('Team name is required'), { status: 'invalid_team_name' })
    }
    if (identity.teamId) {
      throw Object.assign(new Error('The current session already belongs to a team'), { status: 'already_in_team' })
    }

    const teams = loadTeams(identity.projectId)
    const team = {
      id: crypto.randomUUID(),
      projectId: identity.projectId,
      name,
      createdBySessionId: identity.sessionId,
      createdAt: new Date().toISOString(),
      members: {
        [identity.sessionId]: {
          role: 'leader',
          joinedAt: new Date().toISOString()
        }
      }
    }
    teams.push(team)
    saveTeams(identity.projectId, teams)
    await this.updateLiveIdentity(identity.sessionId, team.id, 'leader')
    this.notifySessionsChanged({
      projectId: identity.projectId,
      sessionId: identity.sessionId,
      reason: 'team-updated'
    })

    return {
      ok: true,
      status: 'created',
      team_id: team.id,
      team_name: team.name,
      role: 'leader'
    }
  }

  async joinTeam(identity, args = {}) {
    const teamId = normalizeOptionalString(args.team_id)
    if (!teamId) {
      throw Object.assign(new Error('team_id is required'), { status: 'invalid_team_id' })
    }
    if (identity.teamId) {
      throw Object.assign(new Error('The current session already belongs to a team'), { status: 'already_in_team' })
    }

    const teams = loadTeams(identity.projectId)
    const team = findTeam(teams, teamId)
    if (!team) {
      throw Object.assign(new Error('Team not found'), { status: 'team_not_found' })
    }
    if (isTeamMember(team, identity.sessionId)) {
      throw Object.assign(new Error('The current session is already a member of this team'), { status: 'already_in_team' })
    }

    team.members = team.members || {}
    team.members[identity.sessionId] = {
      role: 'member',
      joinedAt: new Date().toISOString()
    }
    saveTeams(identity.projectId, teams)
    await this.updateLiveIdentity(identity.sessionId, team.id, 'member')
    this.notifySessionsChanged({
      projectId: identity.projectId,
      sessionId: identity.sessionId,
      reason: 'team-updated'
    })

    return {
      ok: true,
      status: 'joined',
      team_id: team.id,
      team_name: team.name,
      role: 'member'
    }
  }

  async dissolveTeam(projectId, teamId) {
    const teams = loadTeams(projectId)
    const team = removeTeam(teams, teamId)
    if (!team) {
      return {
        ok: false,
        status: 'team_not_found'
      }
    }
    saveTeams(projectId, teams)

    const memberIds = Object.keys(team.members || {})
    for (const sessionId of memberIds) {
      await this.updateLiveIdentity(sessionId, null, null, projectId)
    }

    this.notifySessionsChanged({
      projectId,
      teamId,
      reason: 'team-dissolved'
    })
    return {
      ok: true,
      status: 'dissolved',
      team_id: teamId,
      session_ids: memberIds
    }
  }

  async destroyTeam(projectId, teamId) {
    const teams = loadTeams(projectId)
    const team = removeTeam(teams, teamId)
    if (!team) {
      return {
        ok: false,
        status: 'team_not_found'
      }
    }
    saveTeams(projectId, teams)

    const memberIds = Object.keys(team.members || {})
    for (const sessionId of memberIds) {
      this.sessionManager.closeSession(sessionId)
      try {
        await Promise.resolve(this.deleteSessionRecord({
          projectId,
          sessionId,
          permanent: false
        }))
      } catch (error) {
        logger.warn('[AgentCommunication] Failed to soft-delete team member', {
          projectId,
          teamId,
          sessionId,
          error: error.message
        })
      }
    }

    this.notifySessionsChanged({
      projectId,
      teamId,
      reason: 'team-destroyed'
    })
    return {
      ok: true,
      status: 'destroyed',
      team_id: teamId,
      session_ids: memberIds
    }
  }

  async createSession(identity, args = {}) {
    if (identity.role !== 'leader' || !identity.teamId) {
      throw Object.assign(new Error('Only a team leader may create a session'), { status: 'denied_role' })
    }

    const teamId = identity.teamId
    const teams = loadTeams(identity.projectId)
    const team = findTeam(teams, teamId)
    if (!team) {
      throw Object.assign(new Error('Leader team not found'), { status: 'team_not_found' })
    }
    if (team.members?.[identity.sessionId]?.role !== 'leader') {
      throw Object.assign(new Error('The current session is not a leader of this team'), { status: 'denied_role' })
    }

    const requestedName = normalizeOptionalString(args.name)
    const name = requestedName || `Agent Session ${new Date().toISOString().replace(/[:.]/g, '-')}`
    const modelSelection = this.resolveSessionCreationSettings({
      projectId: identity.projectId,
      leaderSessionId: identity.sessionId,
      provider: args.provider || null,
      model: args.model || null
    })
    const sessionConfig = await this.createSessionRecord({
      projectId: identity.projectId,
      name,
      teamId,
      role: 'member',
      settings: modelSelection.settings
    })
    if (!sessionConfig?.id) {
      throw Object.assign(new Error('Failed to create session'), { status: 'create_session_failed' })
    }

    team.members = team.members || {}
    team.members[sessionConfig.id] = {
      role: 'member',
      joinedAt: new Date().toISOString()
    }
    saveTeams(identity.projectId, teams)
    this.notifySessionsChanged({
      projectId: identity.projectId,
      sessionId: sessionConfig.id,
      reason: 'session-created'
    })

    return {
      ok: true,
      status: 'created',
      session_id: sessionConfig.id,
      session_name: sessionConfig.name || name,
      team_id: teamId,
      role: 'member',
      provider: modelSelection.provider,
      model: modelSelection.model,
      model_id: modelSelection.modelId,
      model_card_id: modelSelection.modelCardId,
      model_mode: modelSelection.modelMode
    }
  }

  getAuthorizedMemberTarget(identity, targetSessionId) {
    const normalizedTargetId = normalizeOptionalString(targetSessionId)
    if (!normalizedTargetId) {
      throw Object.assign(new Error('target_session_id is required'), { status: 'invalid_target' })
    }
    if (normalizedTargetId === identity.sessionId) {
      throw Object.assign(new Error('Cannot target the current session'), { status: 'deny_self_target' })
    }
    if (identity.role !== 'leader' || !identity.teamId) {
      throw Object.assign(new Error('Only a team leader may manage member sessions'), { status: 'denied_role' })
    }

    const teams = loadTeams(identity.projectId)
    const team = findTeam(teams, identity.teamId)
    if (!team) {
      throw Object.assign(new Error('Leader team not found'), { status: 'team_not_found' })
    }
    if (team.members?.[identity.sessionId]?.role !== 'leader') {
      throw Object.assign(new Error('The current session is not a leader of this team'), { status: 'denied_role' })
    }

    const targetConfig = this.getSessionConfig(identity.projectId, normalizedTargetId)
    if (!targetConfig || targetConfig.deleted === true) {
      throw Object.assign(new Error('Target session not found'), { status: 'not_found' })
    }

    const targetProjectId = targetConfig.projectId || identity.projectId
    if (targetProjectId !== identity.projectId) {
      throw Object.assign(new Error('Cross-project session management is not allowed'), { status: 'denied_project' })
    }
    if (!sameTeam(targetConfig.teamId, identity.teamId)) {
      throw Object.assign(new Error('Cross-team session management is not allowed'), { status: 'denied_team' })
    }
    if (
      normalizeRole(targetConfig.role) !== 'member' ||
      normalizeRole(team.members?.[normalizedTargetId]?.role) !== 'member'
    ) {
      throw Object.assign(new Error('Only member sessions may be managed'), { status: 'denied_target_role' })
    }

    return {
      targetSessionId: normalizedTargetId,
      targetConfig,
      team,
      session: this.sessionManager.getSession(normalizedTargetId)
    }
  }

  async startSession(identity, args = {}) {
    const target = this.getAuthorizedMemberTarget(identity, args.target_session_id)
    if (target.session?.isRuntimeReady?.()) {
      const connected = await this.waitForSessionConnection(target.targetSessionId)
      return {
        ok: true,
        status: 'already_running',
        session_id: target.targetSessionId,
        connected
      }
    }

    try {
      await this.startSessionRecord({
        projectId: identity.projectId,
        sessionId: target.targetSessionId
      })
    } catch (error) {
      throw Object.assign(new Error(`Failed to start session: ${error.message}`), {
        status: 'start_failed'
      })
    }

    const connected = await this.waitForSessionConnection(target.targetSessionId)
    this.notifySessionsChanged({
      projectId: identity.projectId,
      sessionId: target.targetSessionId,
      reason: 'session-started'
    })

    return {
      ok: true,
      status: 'started',
      session_id: target.targetSessionId,
      is_running: true,
      connected,
      ...(connected ? {} : { warning: 'Runtime started but MCP bridge did not connect in time' })
    }
  }

  async waitForSessionConnection(sessionId, timeoutMs = this.sessionConnectionTimeoutMs) {
    if (this.connections.has(sessionId)) {
      return true
    }
    if (timeoutMs <= 0) {
      return false
    }

    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 100))
      if (this.connections.has(sessionId)) {
        return true
      }
    }
    return false
  }

  async stopSession(identity, args = {}) {
    const target = this.getAuthorizedMemberTarget(identity, args.target_session_id)
    if (!target.session) {
      return {
        ok: true,
        status: 'not_running',
        session_id: target.targetSessionId,
        is_running: false
      }
    }

    const wasRunning = Boolean(target.session.isRuntimeReady?.())
    try {
      await Promise.resolve(this.stopSessionRecord({
        projectId: identity.projectId,
        sessionId: target.targetSessionId
      }))
    } catch (error) {
      throw Object.assign(new Error(`Failed to stop session: ${error.message}`), {
        status: 'stop_failed'
      })
    }

    this.notifySessionsChanged({
      projectId: identity.projectId,
      sessionId: target.targetSessionId,
      reason: 'session-stopped'
    })

    return {
      ok: true,
      status: wasRunning ? 'stopped' : 'not_running',
      session_id: target.targetSessionId,
      is_running: false
    }
  }

  async deleteSession(identity, args = {}) {
    const target = this.getAuthorizedMemberTarget(identity, args.target_session_id)
    const permanent = args.permanent === true

    this.sessionManager.closeSession(target.targetSessionId)

    let result
    try {
      result = await Promise.resolve(this.deleteSessionRecord({
        projectId: identity.projectId,
        sessionId: target.targetSessionId,
        permanent
      }))
    } catch (error) {
      throw Object.assign(new Error(`Failed to delete session: ${error.message}`), {
        status: 'delete_failed'
      })
    }
    if (result?.success === false) {
      throw Object.assign(new Error(result.error || 'Failed to delete session'), {
        status: 'delete_failed'
      })
    }

    if (!permanent) {
      try {
        await Promise.resolve(this.persistSessionIdentity(identity.projectId, target.targetSessionId, {
          teamId: null,
          role: null
        }))
      } catch (error) {
        logger.warn('[AgentCommunication] Failed to clear soft-deleted member identity', {
          projectId: identity.projectId,
          sessionId: target.targetSessionId,
          error: error.message
        })
      }
    }
    removeTeamMember(identity.projectId, identity.teamId, target.targetSessionId)
    this.notifySessionsChanged({
      projectId: identity.projectId,
      sessionId: target.targetSessionId,
      reason: permanent ? 'session-deleted' : 'session-soft-deleted'
    })

    return {
      ok: true,
      status: permanent ? 'deleted' : 'trashed',
      session_id: target.targetSessionId,
      permanent,
      warnings: Array.isArray(result?.warnings) ? result.warnings : []
    }
  }

  getAuthorizedInboxTarget(identity, targetSessionId) {
    const normalizedTargetId = normalizeOptionalString(targetSessionId)
    if (!normalizedTargetId) {
      throw Object.assign(new Error('target_session_id is required'), { status: 'invalid_target' })
    }
    if (normalizedTargetId === identity.sessionId) {
      throw Object.assign(new Error('Cannot send an inbox message to the current session'), { status: 'deny_self_send' })
    }

    const targetConfig = this.getSessionConfig(identity.projectId, normalizedTargetId)
    if (!targetConfig) {
      throw Object.assign(new Error('Target session not found'), { status: 'not_found' })
    }

    const targetProjectId = targetConfig.projectId || identity.projectId
    const targetTeamId = normalizeOptionalString(targetConfig.teamId)
    if (targetProjectId !== identity.projectId) {
      throw Object.assign(new Error('Cross-project communication is not allowed'), { status: 'denied_project' })
    }
    if (!sameTeam(targetTeamId, identity.teamId)) {
      throw Object.assign(new Error('Cross-team communication is not allowed'), { status: 'denied_team' })
    }

    return {
      sessionId: normalizedTargetId,
      projectId: targetProjectId,
      teamId: targetTeamId,
      name: normalizeOptionalString(targetConfig.name) || normalizedTargetId,
      role: normalizeRole(targetConfig.role)
    }
  }

  async sendInboxMessage(sender, args = {}) {
    const message = typeof args.message === 'string' ? args.message.trim() : ''
    if (!message) {
      throw Object.assign(new Error('message is required'), { status: 'invalid_message' })
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw Object.assign(new Error(`message exceeds ${MAX_MESSAGE_LENGTH} characters`), { status: 'message_too_large' })
    }

    const target = this.getAuthorizedInboxTarget(sender, args.target_session_id)
    const entry = {
      message_id: crypto.randomUUID(),
      sender_session_id: sender.sessionId,
      sender_name: sender.name,
      sender_team_id: sender.teamId || null,
      sender_role: sender.role || null,
      receiver_session_id: target.sessionId,
      message,
      time: new Date().toISOString(),
      read_at: null
    }
    addInboxMessage(target.projectId, target.sessionId, entry)
    this.notifyInboxChanged({
      projectId: target.projectId,
      sessionId: target.sessionId,
      reason: 'inbox-message-received'
    })

    return {
      ok: true,
      status: 'inbox',
      message_id: entry.message_id,
      target_session_id: target.sessionId
    }
  }

  getInboxMessages(identity, args = {}) {
    const unreadOnly = args.unread_only !== false
    const messages = listInboxMessages(identity.projectId, identity.sessionId, {
      unreadOnly
    })

    return {
      ok: true,
      status: 'ok',
      messages
    }
  }

  ackInboxMessages(identity, args = {}) {
    const messageIds = Array.isArray(args.message_ids)
      ? args.message_ids.map(value => normalizeOptionalString(value)).filter(Boolean)
      : []
    if (messageIds.length === 0) {
      throw Object.assign(new Error('message_ids is required'), { status: 'invalid_message_ids' })
    }

    const acknowledged = ackMessages(identity.projectId, identity.sessionId, messageIds)
    this.notifyInboxChanged({
      projectId: identity.projectId,
      sessionId: identity.sessionId,
      reason: 'inbox-acknowledged'
    })
    return {
      ok: true,
      status: 'acknowledged',
      acknowledged_message_ids: acknowledged.map(message => message.message_id)
    }
  }

  getInboxUnreadCounts(projectId) {
    const inbox = loadInbox(projectId)
    const counts = {}
    for (const [sessionId, messages] of Object.entries(inbox || {})) {
      const unreadCount = Array.isArray(messages)
        ? messages.filter(message => !message.read_at).length
        : 0
      if (unreadCount > 0) {
        counts[sessionId] = unreadCount
      }
    }
    return counts
  }

  getSessionInbox(projectId, sessionId, { unreadOnly = false } = {}) {
    return listInboxMessages(projectId, sessionId, { unreadOnly })
  }

  ackSessionInbox(projectId, sessionId, messageIds = []) {
    const acknowledged = ackMessages(projectId, sessionId, messageIds)
    this.notifyInboxChanged({
      projectId,
      sessionId,
      reason: 'inbox-acknowledged'
    })
    return acknowledged.map(message => message.message_id)
  }

  async listSessions(identity, args = {}) {
    const includeSelf = args.include_self !== false
    const projectSessions = await Promise.resolve(this.listProjectSessions(identity.projectId))
    const team = identity.teamId
      ? findTeam(loadTeams(identity.projectId), identity.teamId)
      : null
    const teamMemberIds = new Set(Object.keys(team?.members || {}))
    const sessions = (Array.isArray(projectSessions) ? projectSessions : [])
      .filter(session => {
        if (!session?.id || session.deleted === true) return false
        if (!sameTeam(session.teamId, identity.teamId)) return false
        if (identity.teamId && !teamMemberIds.has(session.id)) return false
        if (!includeSelf && session.id === identity.sessionId) return false
        return true
      })
      .map(session => {
        const runtime = this.sessionManager.getSession(session.id)
        const connection = this.connections.get(session.id)
        const settings = session.settings || {}
        return {
          session_id: session.id,
          project_id: session.projectId || identity.projectId,
          name: normalizeOptionalString(session.name) || session.id,
          team_id: normalizeOptionalString(session.teamId),
          role: normalizeRole(session.role),
          is_running: Boolean(runtime?.isRuntimeReady?.()),
          is_processing: Boolean(runtime?.isProcessing),
          connected: Boolean(connection?.agentCommunicationIdentity),
          provider: settings.tool || settings.provider || 'claude',
          model_id: settings.modelId || null
        }
      })

    sessions.sort((left, right) => {
      return left.name.localeCompare(right.name) || left.session_id.localeCompare(right.session_id)
    })

    return {
      ok: true,
      status: 'ok',
      sessions
    }
  }

  getAuthorizedTarget(identity, targetSessionId, { requireLeader = false } = {}) {
    const normalizedTargetId = normalizeOptionalString(targetSessionId)
    if (!normalizedTargetId) {
      throw Object.assign(new Error('target_session_id is required'), { status: 'invalid_target' })
    }
    if (normalizedTargetId === identity.sessionId) {
      throw Object.assign(new Error('Cannot target the current session'), { status: 'deny_self_send' })
    }

    const connection = this.connections.get(normalizedTargetId)
    if (!connection?.agentCommunicationIdentity) {
      throw Object.assign(new Error('Target session is not running'), { status: 'not_found' })
    }

    const target = connection.agentCommunicationIdentity
    if (target.projectId !== identity.projectId) {
      throw Object.assign(new Error('Cross-project communication is not allowed'), { status: 'denied_project' })
    }
    if (!sameTeam(target.teamId, identity.teamId)) {
      throw Object.assign(new Error('Cross-team communication is not allowed'), { status: 'denied_team' })
    }
    if (requireLeader && identity.role !== 'leader') {
      throw Object.assign(new Error('Only a team leader may interrupt another session'), { status: 'denied_role' })
    }

    const session = this.sessionManager.getSession(normalizedTargetId)
    if (!session) {
      throw Object.assign(new Error('Target session is not running'), { status: 'not_found' })
    }

    return {
      connection,
      identity: target,
      session
    }
  }

  async sendMessage(sender, args = {}) {
    const message = typeof args.message === 'string' ? args.message.trim() : ''
    if (!message) {
      throw Object.assign(new Error('message is required'), { status: 'invalid_message' })
    }
    if (message.length > MAX_MESSAGE_LENGTH) {
      throw Object.assign(new Error(`message exceeds ${MAX_MESSAGE_LENGTH} characters`), { status: 'message_too_large' })
    }

    const target = this.getAuthorizedTarget(sender, args.target_session_id)
    const entry = {
      id: crypto.randomUUID(),
      senderSessionId: sender.sessionId,
      senderIdentity: cloneIdentity(sender),
      receiverSessionId: target.identity.sessionId,
      message,
      time: new Date().toISOString()
    }
    const state = this.getQueueState(target.identity.sessionId)

    if (target.session?.isProcessing || state.delivering || state.items.length > 0) {
      if (state.items.length >= MAX_QUEUE_SIZE) {
        throw Object.assign(new Error('Target message queue is full'), { status: 'target_queue_full' })
      }
      state.items.push(entry)
      return {
        ok: true,
        status: 'queued',
        message_id: entry.id,
        target_session_id: target.identity.sessionId
      }
    }

    await this.deliverEntry(sender, entry)
    return {
      ok: true,
      status: 'delivered',
      message_id: entry.id,
      target_session_id: target.identity.sessionId
    }
  }

  async interruptSession(sender, args = {}) {
    const target = this.getAuthorizedTarget(sender, args.target_session_id, { requireLeader: true })
    if (!sender.teamId || !target.identity.teamId) {
      throw Object.assign(new Error('Interrupt requires a non-empty team on both sessions'), { status: 'denied_team' })
    }
    if (!target.session?.isProcessing) {
      return {
        ok: true,
        status: 'not_processing',
        target_session_id: target.identity.sessionId
      }
    }

    await this.sessionManager.sendInterrupt(target.identity.sessionId)
    return {
      ok: true,
      status: 'interrupted',
      target_session_id: target.identity.sessionId,
      reason: typeof args.reason === 'string' && args.reason.trim() ? args.reason.trim() : null
    }
  }

  getQueueState(sessionId) {
    if (!this.queues.has(sessionId)) {
      this.queues.set(sessionId, {
        items: [],
        delivering: false
      })
    }
    return this.queues.get(sessionId)
  }

  async deliverEntry(sender, entry) {
    const targetConnection = this.connections.get(entry.receiverSessionId)
    const targetSession = this.sessionManager.getSession(entry.receiverSessionId)
    if (!targetConnection || !targetSession) {
      throw Object.assign(new Error('Target session is no longer available'), { status: 'not_found' })
    }

    const state = this.getQueueState(entry.receiverSessionId)
    state.delivering = true
    try {
      await targetSession.sendMessage(createInternalMessageContent(sender, entry))
      logger.info('[AgentCommunication] Delivered agent message', {
        senderSessionId: sender.sessionId,
        receiverSessionId: entry.receiverSessionId,
        messageId: entry.id
      })
    } catch (error) {
      state.delivering = false
      logger.warn('[AgentCommunication] Failed to deliver agent message', {
        senderSessionId: sender.sessionId,
        receiverSessionId: entry.receiverSessionId,
        messageId: entry.id,
        error: error.message
      })
      throw error
    }
  }

  handleSessionEvent(event, session) {
    if (!session?.id) return
    const eventType = event?.eventType
    if (!['result', 'normal-exit', 'abnormal-exit'].includes(eventType)) {
      return
    }

    const state = this.queues.get(session.id)
    if (state) {
      state.delivering = false
    }
    if (session.isProcessing || !state?.items?.length) {
      return
    }

    setImmediate(() => {
      this.flushQueue(session.id).catch(error => {
        logger.warn('[AgentCommunication] Failed to flush queued messages', {
          sessionId: session.id,
          error: error.message
        })
      })
    })
  }

  async flushQueue(sessionId) {
    const state = this.queues.get(sessionId)
    const targetConnection = this.connections.get(sessionId)
    const targetSession = this.sessionManager.getSession(sessionId)
    if (!state || state.delivering || state.items.length === 0 || !targetConnection || !targetSession) {
      return
    }
    if (targetSession.isProcessing) {
      return
    }

    const entry = state.items.shift()
    const sourceConnection = this.connections.get(entry.senderSessionId) || null
    const sourceIdentity = entry.senderIdentity || sourceConnection?.agentCommunicationIdentity

    if (!sourceIdentity) {
      logger.warn('[AgentCommunication] Dropping queued message without sender identity', {
        sessionId,
        messageId: entry.id
      })
      setImmediate(() => this.flushQueue(sessionId))
      return
    }

    try {
      await this.deliverEntry(sourceIdentity, entry)
    } catch (error) {
      state.delivering = false
      logger.warn('[AgentCommunication] Queued delivery failed, dropping message', {
        sessionId,
        messageId: entry.id,
        error: error.message
      })
      setImmediate(() => this.flushQueue(sessionId))
    }
  }
}

module.exports = {
  AgentCommunicationService,
  MCP_SERVER_NAME,
  normalizeRole,
  sameTeam
}
