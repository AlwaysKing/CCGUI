const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')
const logger = require('../../logger')
const appConfigManager = require('../../storage/app-config-manager')
const { findProviderModel, getDefaultCredential } = require('../shared/model-config')
const { buildDeveloperInstructions } = require('../shared/developer-instructions')

function encodeProjectPathForClaude(projectPath, { replaceNonAscii = false } = {}) {
  let encodedPath = projectPath
  if (process.platform === 'win32') {
    encodedPath = encodedPath.replace(/:/g, '').replace(/\\/g, '-')
  } else {
    encodedPath = encodedPath.replace(/\//g, '-')
  }
  if (replaceNonAscii) {
    encodedPath = encodedPath.replace(/[^A-Za-z0-9._-]/g, '-')
  }
  if (encodedPath.startsWith('-')) {
    encodedPath = encodedPath.slice(1)
  }
  return '-' + encodedPath
}

// Helper to calculate project ID from path (same as SessionInstance)
function calculateProjectId(projectPath) {
  return encodeProjectPathForClaude(projectPath)
}

function calculateSanitizedProjectId(projectPath) {
  return encodeProjectPathForClaude(projectPath, { replaceNonAscii: true })
}

function hasNonAsciiPath(projectPath) {
  return /[^\x00-\x7F]/.test(String(projectPath || ''))
}

/**
 * Claude CLI client
 * Handles raw process I/O and protocol transport for Claude.
 */
class ClaudeClient {
  constructor(workingDirectory = null, sessionId = null, isNewSession = true, permissionMode = 'default', projectSettings = null, options = {}) {
    this.process = null
    this.messageHandlers = new Map()
    this.claudePath = null
    this.pendingPermissions = new Map()
    this.workingDirectory = workingDirectory || process.cwd()
    this.sessionId = sessionId
    this.isNewSession = isNewSession
    this.permissionMode = permissionMode // 权限模式
    this.projectSettings = projectSettings // 已解析的最终配置 { modelId, modelCardId, promptIds, documentIds }
    this.debugEnabled = options.debug === true
    this.initializeResponse = null
    this.sidechainMonitorTimer = null
    this.sidechainFileState = new Map()
    this.sidechainSeenEntryIds = new Set()
    this.sidechainFileAgents = new Map()
    this.watchedSidechainAgents = new Map()
    this.sidechainAgentFiles = new Map()
    this.shouldLinkSanitizedSessionArtifacts = false
    this.commandInventory = { commands: [], mcpServers: [] }
    this.commandInventoryReadyPromise = null
    this.commandInventoryReadyResolve = null
  }

  /**
   * Get the working directory
   */
  getWorkingDirectory() {
    return this.workingDirectory
  }

  setDebugEnabled(enabled) {
    this.debugEnabled = enabled === true
  }

  normalizeSlashCommandEntry(entry = null) {
    if (!entry) return null

    const rawValue = typeof entry === 'string' ? entry : (typeof entry.name === 'string' ? entry.name : '')
    const normalizedValue = rawValue.trim()
    if (!normalizedValue) return null

    const commandValue = normalizedValue.startsWith('/') ? normalizedValue : `/${normalizedValue}`
    const bareValue = commandValue.slice(1)
    const isMcpPrompt = bareValue.startsWith('mcp__')
    const mcpParts = bareValue.split('__').filter(Boolean)
    const namespaceIndex = bareValue.indexOf(':')
    const namespace = namespaceIndex > 0 ? bareValue.slice(0, namespaceIndex) : ''
    let groupId = 'builtin'
    let groupLabel = '内置命令'
    let kind = 'builtin-command'

    if (isMcpPrompt && mcpParts.length >= 2) {
      groupId = `mcp:${mcpParts[1]}`
      groupLabel = mcpParts[1]
      kind = 'mcp-prompt'
    } else if (namespace) {
      groupId = `namespace:${namespace}`
      groupLabel = namespace
      kind = namespace === 'mcp' ? 'mcp-prompt' : 'namespaced-command'
    }

    const description = typeof entry?.description === 'string' ? entry.description.trim() : ''
    const argumentHint = typeof entry?.argumentHint === 'string'
      ? entry.argumentHint
      : (typeof entry?.argument_hint === 'string' ? entry.argument_hint : '')

    return {
      id: `claude:${bareValue}`,
      label: commandValue,
      description,
      argumentHint,
      category: 'slash_command',
      submitMode: 'runCommand',
      kind,
      value: commandValue,
      groupId,
      groupLabel,
      providerMeta: {
        rawType: typeof entry,
        rawName: typeof entry?.name === 'string' ? entry.name : null
      }
    }
  }

  updateCommandInventoryFromInit(message = {}) {
    const mcpServers = Array.isArray(message.mcp_servers) ? message.mcp_servers : []

    if (mcpServers.length > 0) {
      this.commandInventory.mcpServers = mcpServers
    }

    logger.info('[ClaudeClient] Received system/init metadata', {
      slashCommandsCount: Array.isArray(message.slash_commands) ? message.slash_commands.length : 0,
      mcpServers,
      commandInventoryCount: Array.isArray(this.commandInventory?.commands) ? this.commandInventory.commands.length : 0
    })
  }

  getCommandInventory() {
    return {
      commands: Array.isArray(this.commandInventory?.commands) ? [...this.commandInventory.commands] : [],
      mcpServers: Array.isArray(this.commandInventory?.mcpServers) ? [...this.commandInventory.mcpServers] : []
    }
  }

  async waitForCommandInventory(timeoutMs = 3000) {
    const current = this.getCommandInventory()
    if (Array.isArray(current.commands) && current.commands.length > 0) {
      return current
    }

    if (!this.commandInventoryReadyPromise) {
      this.commandInventoryReadyPromise = new Promise(resolve => {
        this.commandInventoryReadyResolve = resolve
      })
    }

    await Promise.race([
      this.commandInventoryReadyPromise.catch(() => null),
      new Promise(resolve => setTimeout(resolve, timeoutMs))
    ])

    return this.getCommandInventory()
  }

  async queryCommands(params = {}) {
    const category = typeof params?.category === 'string' ? params.category : 'slash_command'
    if (category !== 'slash_command') {
      return { provider: 'claude', category, groups: [] }
    }

    let inventory = this.getCommandInventory() || {}

    if (typeof this.refreshCommandInventoryFromInitialize === 'function') {
      inventory = await this.refreshCommandInventoryFromInitialize()
    } else if ((!Array.isArray(inventory.commands) || inventory.commands.length === 0) && typeof this.waitForCommandInventory === 'function') {
      inventory = await this.waitForCommandInventory(3000)
    } else if (!Array.isArray(inventory.commands) || inventory.commands.length === 0) {
      await new Promise(resolve => setTimeout(resolve, 250))
      inventory = this.getCommandInventory() || {}
    }

    const commands = Array.isArray(inventory.commands) ? inventory.commands : []
    const groupsMap = new Map()

    for (const command of commands) {
      if (!command || command.category !== 'slash_command') continue
      const groupId = command.groupId || 'builtin'
      const groupLabel = command.groupLabel || '内置命令'
      if (!groupsMap.has(groupId)) {
        groupsMap.set(groupId, { id: groupId, label: groupLabel, children: [] })
      }
      groupsMap.get(groupId).children.push(command)
    }

    return {
      provider: 'claude',
      category,
      groups: Array.from(groupsMap.values())
    }
  }

  /**
   * Get session file path
   */
  getSessionFilePath() {
    if (!this.sessionId || !this.workingDirectory) return null
    const projectId = calculateProjectId(this.workingDirectory)

    return path.join(os.homedir(), '.claude', 'projects', projectId, `${this.sessionId}.jsonl`)
  }

  getPrimaryProjectId() {
    if (!this.workingDirectory) {
      return null
    }
    return calculateProjectId(this.workingDirectory)
  }

  getSanitizedProjectId() {
    if (!this.workingDirectory || !hasNonAsciiPath(this.workingDirectory)) {
      return this.getPrimaryProjectId()
    }
    return calculateSanitizedProjectId(this.workingDirectory)
  }

  getProjectDirectory({ sanitized = false } = {}) {
    const projectId = sanitized ? this.getSanitizedProjectId() : this.getPrimaryProjectId()
    if (!projectId) {
      return null
    }
    return path.join(os.homedir(), '.claude', 'projects', projectId)
  }

  resolveSessionMode() {
    this.shouldLinkSanitizedSessionArtifacts = false
    const sessionFile = this.getSessionFilePath()
    if (!sessionFile || !fs.existsSync(sessionFile)) {
      return 'new'
    }

    const stat = fs.statSync(sessionFile)
    if (stat.size === 0) {
      logger.info(`[ClaudeClient] Empty session file found, deleting: ${sessionFile}`)
      fs.unlinkSync(sessionFile)
      this.shouldLinkSanitizedSessionArtifacts = hasNonAsciiPath(this.workingDirectory)
      return 'new'
    }

    return 'resume'
  }

  ensureSessionArtifactLinks() {
    if (!this.shouldLinkSanitizedSessionArtifacts || !this.sessionId) {
      return
    }

    const primaryProjectDir = this.getProjectDirectory()
    const sanitizedProjectDir = this.getProjectDirectory({ sanitized: true })
    if (!primaryProjectDir || !sanitizedProjectDir || primaryProjectDir === sanitizedProjectDir) {
      return
    }

    fs.mkdirSync(primaryProjectDir, { recursive: true })
    fs.mkdirSync(sanitizedProjectDir, { recursive: true })

    const links = [
      {
        linkPath: path.join(primaryProjectDir, `${this.sessionId}.jsonl`),
        targetPath: path.join(sanitizedProjectDir, `${this.sessionId}.jsonl`),
        type: 'file'
      }
    ]

    for (const { linkPath, targetPath, type } of links) {
      let existingStat = null
      try {
        existingStat = fs.lstatSync(linkPath)
      } catch {
        // 链接不存在时继续创建
      }

      if (existingStat) {
        if (!existingStat.isSymbolicLink()) {
          continue
        }

        try {
          const rawTarget = fs.readlinkSync(linkPath)
          const resolvedTarget = path.isAbsolute(rawTarget)
            ? rawTarget
            : path.resolve(path.dirname(linkPath), rawTarget)
          if (resolvedTarget === targetPath) {
            continue
          }
        } catch {
          // 读取失败则重建 link
        }

        try {
          fs.unlinkSync(linkPath)
        } catch (error) {
          logger.warn(`[ClaudeClient] Failed to replace Claude session artifact link ${linkPath}: ${error.message}`)
          continue
        }
      }

      try {
        fs.symlinkSync(targetPath, linkPath, type)
        logger.info(`[ClaudeClient] Linked Claude session artifact: ${linkPath} -> ${targetPath}`)
      } catch (error) {
        logger.warn(`[ClaudeClient] Failed to link Claude session artifact ${linkPath}: ${error.message}`)
      }
    }
  }

  /**
   * Detect Claude CLI installation path
   */
  detectClaudePath() {
    const possiblePaths = [
      '/opt/homebrew/bin/claude',
      '/usr/local/bin/claude',
      path.join(process.env.HOME, '.local/bin/claude'),
      ...(process.env.PATH ? process.env.PATH.split(':').map(p => path.join(p, 'claude')) : []),
    ]

    for (const basePath of possiblePaths) {
      try {
        if (basePath.includes('*')) {
          const dir = path.dirname(basePath)
          if (fs.existsSync(dir)) {
            const versions = fs.readdirSync(dir)
            for (const version of versions) {
              const fullPath = path.join(dir, version, 'claude')
              if (fs.existsSync(fullPath)) {
                return fullPath
              }
            }
          }
        } else if (fs.existsSync(basePath)) {
          return basePath
        }
      } catch (error) {
        // Continue to next path
      }
    }

    throw new Error('Claude CLI not found. Please install Claude Code first.')
  }

  /**
   * Build system prompt from project settings
   * @returns {Promise<string|null>} 系统提示词内容
   */
  async buildSystemPrompt() {
    logger.info(`[ClaudeClient] buildSystemPrompt called, projectSettings:`, this.projectSettings)

    if (!this.projectSettings) {
      logger.info('[ClaudeClient] No projectSettings, returning null')
      return null
    }

    try {
      const prompt = buildDeveloperInstructions(this.projectSettings)
      logger.info(`[ClaudeClient] buildSystemPrompt result: ${prompt ? 1 : 0} parts, total ${prompt?.length || 0} chars`)
      return prompt
    } catch (error) {
      logger.error('[ClaudeClient] Failed to build system prompt:', error)
      return null
    }
  }

  /**
   * Get model environment variables from project settings
   * @returns {object} 环境变量对象
   */
  getModelEnvVars() {
    const envVars = {}

    if (!this.projectSettings || !this.projectSettings.modelId) return envVars

    try {
      const appConfig = appConfigManager.loadConfig()
      const modelConfig = findProviderModel(appConfig, 'claude', this.projectSettings.modelId)
      if (!modelConfig) {
        logger.warn(`[ClaudeClient] Model config not found: ${this.projectSettings.modelId}`)
        return envVars
      }

      // 设置 API URL (ANTHROPIC_BASE_URL)
      if (modelConfig.apiUrl) {
        envVars.ANTHROPIC_BASE_URL = modelConfig.apiUrl
        logger.info(`[ClaudeClient] Setting ANTHROPIC_BASE_URL: ${modelConfig.apiUrl}`)
      }

      // 设置 Auth Token (ANTHROPIC_AUTH_TOKEN)
      const credential = getDefaultCredential(modelConfig, this.projectSettings?.credentialId)
      if (credential?.token) {
        envVars.ANTHROPIC_AUTH_TOKEN = credential.token
        logger.info(`[ClaudeClient] Setting ANTHROPIC_AUTH_TOKEN: ${credential.token.substring(0, 10)}...`)
      }

      // 获取模型卡片列表
      const modelCards = modelConfig.modelCards || []
      if (modelCards.length === 0) {
        logger.warn(`[ClaudeClient] No model cards found for: ${this.projectSettings.modelId}`)
        return envVars
      }

      // 确定使用哪个 modelCard
      let targetCard = null
      if (this.projectSettings.modelCardId) {
        // 使用指定的 modelCardId
        targetCard = modelCards.find(c => c.id === this.projectSettings.modelCardId)
      }
      if (!targetCard) {
        // 使用默认的 modelCard
        const defaultCardId = modelConfig.defaultCardId || modelCards[0]?.id
        targetCard = modelCards.find(c => c.id === defaultCardId) || modelCards[0]
      }

      if (targetCard && targetCard.modelName) {
        envVars.ANTHROPIC_MODEL = targetCard.modelName
        logger.info(`[ClaudeClient] Setting ANTHROPIC_MODEL: ${targetCard.modelName} (from card: ${targetCard.id})`)
      } else {
        logger.warn(`[ClaudeClient] No valid modelName found in model card`)
      }
    } catch (error) {
      logger.error('[ClaudeClient] Failed to get model env vars:', error)
    }

    return envVars
  }

  /**
   * Start Claude CLI process
   */
  async start() {
    if (this.process) {
      return
    }

    this.commandInventory = { commands: [], mcpServers: [] }
    this.commandInventoryReadyPromise = null
    this.commandInventoryReadyResolve = null

    // 启动时清理上一轮残留的 subagents 文件
    this.cleanupSubagentsOnStart()

    try {
      this.claudePath = this.detectClaudePath()
    } catch (error) {
      throw error
    }

    const args = [
      '--print',  // 使用 print 模式以支持流式输入输出
      '--verbose',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--permission-prompt-tool', 'stdio',
      '--include-partial-messages',
      '--replay-user-messages',  // 重新发送用户消息以便跟踪消息 ID
      '--max-thinking-tokens', '31999',
      '--setting-sources', 'user,project,local'  // 启用设置源
    ]

    // Add permission mode if not default
    if (this.permissionMode && this.permissionMode !== 'default') {
      args.push('--permission-mode', this.permissionMode)
      logger.info(`[ClaudeClient] Setting permission mode: ${this.permissionMode}`)
    }

    if (this.projectSettings?.effort) {
      args.push('--effort', this.projectSettings.effort)
      logger.info(`[ClaudeClient] Setting effort: ${this.projectSettings.effort}`)
    }

    const sessionMode = this.resolveSessionMode()

    // Add session-id to resume or create session
    if (this.sessionId) {
      if (sessionMode === 'new') {
        // New session: use --session-id to create a new session with specific ID
        args.push('--session-id', this.sessionId)
        logger.info(`[ClaudeClient] Creating new session with ID: ${this.sessionId}`)
      } else {
        // Existing session: use --resume to resume the session
        args.push('--resume', this.sessionId)
        logger.info(`[ClaudeClient] Resuming session with ID: ${this.sessionId}`)
      }
    }

    // Add system prompt from project settings
    const systemPrompt = await this.buildSystemPrompt()
    if (systemPrompt) {
      args.push('--append-system-prompt', systemPrompt)
      logger.info(`[ClaudeClient] Added system prompt (${systemPrompt.length} chars)`)
    }

    // Get model environment variables
    const modelEnvVars = this.getModelEnvVars()

    // 构建完整的环境变量
    const fullEnv = {
      ...process.env,
      CLAUDE_CODE_ENABLE_TELEMETRY: '0',
      DISABLE_TELEMETRY: '1',
      CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1',
      CLAUDE_CODE_ENABLE_SDK_FILE_CHECKPOINTING: 'true',  // 启用文件历史快照功能
      ...modelEnvVars
    }

    // 打印启动参数供调试
    logger.info('[ClaudeClient] ========== Claude CLI 启动参数 ==========')
    logger.info(`[ClaudeClient] Claude路径: ${this.claudePath}`)
    logger.info(`[ClaudeClient] 工作目录: ${this.workingDirectory}`)
    logger.info(`[ClaudeClient] 参数: ${JSON.stringify(args, null, 2)}`)
    logger.info(`[ClaudeClient] 环境变量(自定义): ${JSON.stringify(modelEnvVars, null, 2)}`)
    logger.info(`[ClaudeClient] Agent Teams: ${fullEnv.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS}`)
    if (systemPrompt) {
      logger.info(`[ClaudeClient] 系统提示词内容: ${systemPrompt.substring(0, 500)}${systemPrompt.length > 500 ? '...' : ''}`)
    }
    logger.info('[ClaudeClient] ===========================================')

    try {
      this.process = spawn(this.claudePath, args, {
        cwd: this.workingDirectory,
        env: fullEnv
      })

      this.setupStdioHandlers()

      // Wait a bit to check if process starts successfully
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          resolve()
        }, 500)

        this.process.once('error', (error) => {
          clearTimeout(timeout)
          reject(error)
        })

        this.process.once('exit', (code, signal) => {
          clearTimeout(timeout)
          reject(new Error(`Claude CLI exited with code ${code}`))
        })
      })

      this.ensureSessionArtifactLinks()

      // Emit init event after process starts with current working directory
      this.handleMessage({
        type: 'system',
        subtype: 'init',
        cwd: this.workingDirectory,
        session_id: null,
        tools: []
      })

      // Newer Claude Code builds may not emit an initialize response.
      // Treat initialization as best-effort so session startup is not blocked.
      try {
        await this.sendInitializeRequest()
      } catch (error) {
        logger.warn(`[ClaudeClient] Initialize request did not complete, continuing startup: ${error.message}`)
      }

    } catch (error) {
      this.process = null
      throw error
    }
  }

  /**
   * Send initialize control request to enable features like file history
   */
  async refreshCommandInventoryFromInitialize() {
    if (!this.process || !this.process.stdin?.writable) {
      return this.getCommandInventory()
    }

    try {
      await this.sendInitializeRequest()
    } catch (error) {
      logger.warn(`[ClaudeClient] Failed to refresh command inventory from initialize: ${error.message}`)
    }

    return this.getCommandInventory()
  }

  async sendInitializeRequest() {
    return new Promise((resolve, reject) => {
      const requestId = `init_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      let settled = false
      let timeout = null

      const cleanup = () => {
        if (timeout) {
          clearTimeout(timeout)
          timeout = null
        }
        this.off('control-response', responseHandler)
      }

      // Set up one-time handler for the response
      const responseHandler = (message) => {
        if (settled) {
          return
        }

        if (message.type === 'control_response' &&
            message.response?.request_id === requestId) {
          settled = true
          cleanup()
          logger.info('[ClaudeClient] Initialize response received:', message)

          // Check if initialization was successful
          if (message.response?.subtype === 'success') {
            this.initializeResponse = message.response?.response || null
            const initCommands = Array.isArray(this.initializeResponse?.commands)
              ? this.initializeResponse.commands
              : []
            if (initCommands.length > 0) {
              this.commandInventory.commands = initCommands
                .map(entry => this.normalizeSlashCommandEntry(entry))
                .filter(Boolean)
              if (typeof this.commandInventoryReadyResolve === 'function') {
                this.commandInventoryReadyResolve(this.getCommandInventory())
                this.commandInventoryReadyResolve = null
                this.commandInventoryReadyPromise = null
              }
            }
            logger.info('[ClaudeClient] Claude initialized successfully, file history should be enabled')
            resolve(message)
          } else {
            logger.error('[ClaudeClient] Initialize failed:', message.response?.error)
            reject(new Error(`Initialize failed: ${message.response?.error}`))
          }
        }
      }

      this.on('control-response', responseHandler)

      // Send initialize request
      const initRequest = {
        type: 'control_request',
        request_id: requestId,
        request: {
          subtype: 'initialize',
          hooks: {},
          sdkMcpServers: [],
          jsonSchema: null,
          systemPrompt: null
        }
      }

      logger.info('[ClaudeClient] Sending initialize request:', initRequest)
      this.sendMessage(initRequest)

      // Timeout after 10 seconds
      timeout = setTimeout(() => {
        if (settled) {
          return
        }
        settled = true
        cleanup()
        reject(new Error('Initialize request timeout'))
      }, 10000)
    })
  }

  /**
   * Setup stdout, stderr, and exit handlers
   */
  setupStdioHandlers() {
    let buffer = ''

    // Handle stdout
    this.process.stdout.on('data', (data) => {
      const rawData = data.toString()
      buffer += rawData
      const lines = buffer.split('\n')
      buffer = lines.pop() // Keep incomplete line

      lines.forEach(line => {
        if (line.trim()) {
          try {
            const message = JSON.parse(line)
            this.handleMessage(message)
          } catch (error) {
            // Ignore JSON parse errors for incomplete lines
          }
        }
      })
    })

    // Handle stderr - 系统状态消息
    this.process.stderr.on('data', (data) => {
      const errorMsg = data.toString()
      if (errorMsg.trim()) {
        // 将 stderr 消息发送到前端显示
        const statusHandlers = this.messageHandlers.get('cli-status') || []
        statusHandlers.forEach(handler => {
          try {
            handler({
              type: 'status',
              message: errorMsg.trim()
            })
          } catch (error) {
            // Ignore handler errors
          }
        })
      }
    })

    // Handle exit
    this.process.on('exit', (code, signal) => {
      this.stopSidechainMonitor()
      // Emit exit event so SessionInstance can update envInfo
      const exitHandlers = this.messageHandlers.get('exit') || []
      exitHandlers.forEach(handler => {
        try {
          handler({ code, signal })
        } catch (error) {
          // Ignore handler errors
        }
      })
      this.process = null
    })

    // Handle error
    this.process.on('error', (error) => {
      // Ignore error
    })
  }

  /**
   * Handle incoming messages from Claude CLI
   */
  handleMessage(message) {
    // 记录接收到的消息到数据流日志
    if (this.debugEnabled && this.sessionId) {
      logger.logReceive(this.sessionId, message)
    }

    // Handle stream_event (thinking_delta, text_delta, message_start, etc.)
    if (message.type === 'stream_event') {
      this.handleStreamEvent(message)
      return
    }

    // Handle control_request (permission prompts when using --permission-prompt-tool stdio)
    if (message.type === 'control_request') {
      // Send to front-end for permission dialog
      const requestHandlers = this.messageHandlers.get('control_request') || []
      requestHandlers.forEach(handler => {
        try {
          handler(message)
        } catch (error) {
          // Ignore handler errors
        }
      })
      return
    }

    // Handle control_response (e.g., interrupt confirmation)
    if (message.type === 'control_response') {
      const responseHandlers = this.messageHandlers.get('control_response') || []
      responseHandlers.forEach(handler => {
        try {
          handler(message)
        } catch (error) {
          // Ignore handler errors
        }
      })
      return
    }

    // Handle control_cancel_request (confirmation of interrupt/cancel)
    if (message.type === 'control_cancel_request') {
      logger.info('[ClaudeClient] Received control_cancel_request, treating as interrupt confirmation')
      const interruptHandlers = this.messageHandlers.get('interrupt') || []
      interruptHandlers.forEach(handler => {
        try {
          handler(message)
        } catch (error) {
          // Ignore handler errors
        }
      })
      return
    }

    // Handle user messages (which may contain tool_result from CLI)
    if (message.type === 'user') {
      // Check if this is a tool_result message from CLI
      if (message.message && message.message.content) {
        const toolResultContent = message.message.content.find(c => c.type === 'tool_result')
        if (toolResultContent) {
          // Trigger tool_result event
          const toolResultHandlers = this.messageHandlers.get('tool_result') || []
          toolResultHandlers.forEach(handler => {
            try {
              handler(message)
            } catch (error) {
              // Ignore handler errors
            }
          })
          return
        }

        // Check if this is an interrupt message
        const interruptContent = message.message.content.find(c =>
          c.type === 'text' && c.text === '[Request interrupted by user]'
        )
        if (interruptContent) {
          // Trigger interrupt event
          const interruptHandlers = this.messageHandlers.get('interrupt') || []
          interruptHandlers.forEach(handler => {
            try {
              handler(message)
            } catch (error) {
              // Ignore handler errors
            }
          })
          return
        }
      }
      // 调用注册的 user 处理器（如果有），否则忽略
      // 用户消息已在 sendMessage 中处理，这里只处理 CLI 回放
      const userHandlers = this.messageHandlers.get('user') || []
      userHandlers.forEach(handler => {
        try {
          handler(message)
        } catch (error) {
          // Ignore handler errors
        }
      })
      return
    }

    // Handle result messages (contains usage information after message_stop)
    if (message.type === 'result') {
      const resultHandlers = this.messageHandlers.get('result') || []
      resultHandlers.forEach(handler => {
        try {
          handler(message)
        } catch (error) {
          // Ignore handler errors
        }
      })
      return
    }

    if (message.type === 'system' && message.subtype === 'init') {
      this.updateCommandInventoryFromInit(message)
    }

    // Handle regular messages (assistant, user, etc.)
    const handlers = this.messageHandlers.get(message.type) || []
    if (handlers.length > 0) {
      handlers.forEach(handler => {
        try {
          handler(message)
        } catch (error) {
          // Ignore handler errors
        }
      })
    } else {
      // 没有处理器的消息类型，发送到前端显示
      const unknownHandlers = this.messageHandlers.get('unknown_message') || []
      unknownHandlers.forEach(handler => {
        try {
          handler(message)
        } catch (error) {
          // Ignore handler errors
        }
      })
    }
  }

  /**
   * Handle stream_event messages
   */
  handleStreamEvent(message) {
    const event = message.event
    if (!event) return

    // Send all stream events to front-end
    const streamHandlers = this.messageHandlers.get('stream_event') || []
    streamHandlers.forEach(handler => {
      try {
        handler(message)
      } catch (error) {
        // Ignore handler errors
      }
    })
  }

  /**
   * Send control response (for permission prompts with --permission-prompt-tool stdio)
   * @param {string} requestId - 请求 ID
   * @param {boolean} approved - 是否批准
   * @param {object} options - 额外选项，可以包含 toolUseID, updatedInput, permissionRules 等
   */
  sendControlResponse(requestId, approved, options = {}) {
    if (!this.process) {
      throw new Error('Claude process not running')
    }
    if (!this.process.stdin.writable) {
      throw new Error('Claude process stdin is not writable')
    }

    // 构建响应内容 - 根据 VSCode 插件分析，需要包含:
    // - behavior: 'allow' 或 'deny'
    // - toolUseID: 工具使用ID
    // - updatedInput: 工具的输入参数（如果批准）
    // - updatedPermissions: 权限规则数组（用于 allow all，可选）
    const responseData = {
      behavior: approved ? 'allow' : 'deny'
    }

    // 添加 toolUseID (从 options 中获取)
    if (options.toolUseID) {
      responseData.toolUseID = options.toolUseID
    }

    // 如果批准且有更新后的输入，添加到响应中
    if (approved && options.updatedInput) {
      responseData.updatedInput = options.updatedInput
    }

    // 如果有权限规则（非空数组），放在 updatedPermissions 数组中
    // permissionRules 的格式是: [{type: "setMode", ...}, {type: "addDirectories", ...}]
    // 需要将所有建议都放在 updatedPermissions 数组中
    if (approved && options.permissionRules && Array.isArray(options.permissionRules) && options.permissionRules.length > 0) {
      responseData.updatedPermissions = options.permissionRules
    }

    // 正确的格式：request_id 必须在 response 对象内部，并且需要 subtype
    const responseMessage = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id: requestId,
        response: responseData
      }
    }

    this.sendMessage(responseMessage)
  }

  /**
   * Send tool result (permission response) to Claude CLI
   */
  sendToolResult(toolUseId, content, isError = false) {
    const resultMessage = {
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: toolUseId,
            content: content,
            is_error: isError
          }
        ]
      }
    }
    this.sendMessage(resultMessage)
  }

  /**
   * Send message to Claude CLI
   */
  sendMessage(message) {
    if (this.process && this.process.stdin.writable) {
      const jsonMessage = JSON.stringify(message) + '\n'
      // 记录发送的消息到数据流日志
      if (this.debugEnabled && this.sessionId) {
        logger.logSend(this.sessionId, message)
      }
      this.process.stdin.write(jsonMessage)
    } else {
      throw new Error('Claude process not ready')
    }
  }

  /**
   * Send interrupt request to stop current generation
   */
  sendInterrupt() {
    const interruptMessage = {
      type: 'control_request',
      request: {
        subtype: 'interrupt'
      },
      request_id: `interrupt_${Date.now()}`
    }
    this.sendMessage(interruptMessage)
  }

  /**
   * Send control request (主动请求，如切换权限模式)
   */
  sendControlRequest(request) {
    const normalizedRequest = { ...(request || {}) }
    const requestId =
      normalizedRequest.__ccguiRequestId ||
      `control_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`

    delete normalizedRequest.__ccguiRequestId

    const controlRequestMessage = {
      type: 'control_request',
      request: normalizedRequest,
      request_id: requestId
    }
    this.sendMessage(controlRequestMessage)
  }

  /**
   * Register message handler
   */
  on(messageType, handler) {
    if (!this.messageHandlers.has(messageType)) {
      this.messageHandlers.set(messageType, [])
    }
    this.messageHandlers.get(messageType).push(handler)
  }

  /**
   * Remove message handler
   */
  off(messageType, handler) {
    if (this.messageHandlers.has(messageType)) {
      const handlers = this.messageHandlers.get(messageType)
      const index = handlers.indexOf(handler)
      if (index > -1) {
        handlers.splice(index, 1)
      }
    }
  }

  /**
   * Emit an event to registered handlers
   */
  emit(messageType, payload) {
    const handlers = this.messageHandlers.get(messageType) || []
    handlers.forEach(handler => {
      try {
        handler(payload)
      } catch (error) {
        logger.error('[ClaudeClient] Handler error', { messageType, error: error.message })
      }
    })
  }

  /**
   * Stop Claude CLI process
   */
  stop() {
    if (this.process) {
      this.stopSidechainMonitor()
      this.process.kill('SIGTERM')
      this.process = null
    }
    this.commandInventory = { commands: [], mcpServers: [] }
    this.commandInventoryReadyPromise = null
    this.commandInventoryReadyResolve = null
  }

  /**
   * Check if Claude is ready
   */
  isReady() {
    return this.process !== null && this.process.stdin.writable
  }

  /**
   * Get Claude process PID
   */
  getPid() {
    return this.process?.pid || null
  }

  getSupportedModels() {
    return Array.isArray(this.initializeResponse?.models)
      ? this.initializeResponse.models
      : []
  }

  getSubagentsDirectory() {
    if (!this.sessionId || !this.workingDirectory) {
      return null
    }

    const projectId = this.getSanitizedProjectId()
    return path.join(os.homedir(), '.claude', 'projects', projectId, this.sessionId, 'subagents')
  }

  startSidechainMonitor() {
    if (this.sidechainMonitorTimer) {
      return
    }

    this.pollSidechainEntries()
    this.sidechainMonitorTimer = setInterval(() => {
      this.pollSidechainEntries()
    }, 1000)
  }

  stopSidechainMonitor() {
    if (this.sidechainMonitorTimer) {
      clearInterval(this.sidechainMonitorTimer)
      this.sidechainMonitorTimer = null
    }
    this.sidechainFileState.clear()
    this.sidechainSeenEntryIds.clear()
    this.sidechainFileAgents.clear()
    this.sidechainAgentFiles.clear()
    this.watchedSidechainAgents.clear()
  }

  cleanupSubagentsOnStart() {
    const subagentsDir = this.getSubagentsDirectory()
    if (!subagentsDir || !fs.existsSync(subagentsDir)) {
      return
    }

    try {
      const files = fs.readdirSync(subagentsDir)
      if (files.length === 0) {
        return
      }
      let cleanedCount = 0
      for (const file of files) {
        const filePath = path.join(subagentsDir, file)
        try {
          fs.unlinkSync(filePath)
          cleanedCount += 1
        } catch {
          // 忽略单个文件删除失败
        }
      }
      if (cleanedCount > 0) {
        logger.info(`[ClaudeClient] Cleaned up ${cleanedCount} residual subagents files on session start: ${subagentsDir}`)
      }
    } catch (error) {
      logger.warn(`[ClaudeClient] Failed to cleanup subagents on start: ${error.message}`)
    }
  }

  watchSidechainAgent(agentInfo) {
    const normalizedAgentId = String(
      typeof agentInfo === 'string'
        ? agentInfo
        : (agentInfo?.agentId || '')
    ).trim()
    if (!normalizedAgentId) {
      return
    }

    const normalizedPrompt = String(agentInfo?.prompt || '').replace(/\s+/g, ' ').trim()
    const normalizedName = String(agentInfo?.name || '').trim()
    const normalizedTeamId = String(agentInfo?.teamId || '').trim()
    const normalizedAgentType = String(agentInfo?.agentType || '').trim()
    const normalizedFilePath = String(
      agentInfo?.sidechainFilePath || agentInfo?.filePath || ''
    ).trim()

    this.watchedSidechainAgents.set(normalizedAgentId, {
      agentId: normalizedAgentId,
      name: normalizedName,
      prompt: normalizedPrompt,
      teamId: normalizedTeamId,
      agentType: normalizedAgentType,
      registeredAt: Date.now()
    })

    if (normalizedFilePath) {
      this.bindSidechainFile(normalizedAgentId, normalizedFilePath)
    } else {
      // 文件路径未知，启动 monitor 等待文件出现后自动匹配
      this.startSidechainMonitor()
    }
  }

  bindSidechainFile(agentId, filePath) {
    const normalizedAgentId = String(agentId || '').trim()
    const normalizedFilePath = String(filePath || '').trim()
    if (!normalizedAgentId || !normalizedFilePath) {
      return
    }

    // 支持 agentId → 多个文件的映射（team 场景下每轮都是新文件）
    const existingFiles = this.sidechainAgentFiles.get(normalizedAgentId) || new Set()
    if (existingFiles.has(normalizedFilePath)) {
      return
    }

    existingFiles.add(normalizedFilePath)
    this.sidechainAgentFiles.set(normalizedAgentId, existingFiles)
    this.sidechainFileAgents.set(normalizedFilePath, normalizedAgentId)
    this.startSidechainMonitor()
  }

  /**
   * 扫描 subagents 目录，通过 meta.json 的 agentType 将文件映射到已注册的 agent。
   * 支持 team 场景下每轮问答产生新文件：同名 agentType 的多个文件都归入同一个 agentId。
   */
  discoverSidechainFiles(subagentsDir) {
    const watchedAgents = Array.from(this.watchedSidechainAgents.values())
    if (watchedAgents.length === 0) {
      return
    }

    const alreadyBoundFiles = new Set(this.sidechainFileAgents.keys())

    let dirEntries
    try {
      dirEntries = fs.readdirSync(subagentsDir)
    } catch {
      return
    }

    // 收集所有未绑定的 meta.json 文件
    const unboundMetaFiles = dirEntries.filter(fileName =>
      fileName.startsWith('agent-') &&
      fileName.endsWith('.meta.json')
    )

    if (unboundMetaFiles.length === 0) {
      return
    }

    // 构建 agentType → agentId 的映射
    const typeToAgentId = new Map()
    for (const info of watchedAgents) {
      const lookupKey = (info.agentType || info.name || '').trim()
      if (lookupKey) {
        typeToAgentId.set(lookupKey, info.agentId)
      }
    }

    for (const metaFileName of unboundMetaFiles) {
      const metaPath = path.join(subagentsDir, metaFileName)
      const jsonlName = metaFileName.replace('.meta.json', '.jsonl')
      const jsonlPath = path.join(subagentsDir, jsonlName)

      // 已绑定过就跳过
      if (alreadyBoundFiles.has(jsonlPath)) {
        continue
      }

      // jsonl 文件不存在则跳过
      if (!fs.existsSync(jsonlPath)) {
        continue
      }

      let meta
      try {
        meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'))
      } catch {
        continue
      }

      const agentType = (meta.agentType || '').trim()
      if (!agentType) {
        continue
      }

      // 精确匹配 agentType → agentId
      const matchedAgentId = typeToAgentId.get(agentType)
      if (matchedAgentId) {
        this.bindSidechainFile(matchedAgentId, jsonlPath)
        alreadyBoundFiles.add(jsonlPath)
        logger.info(`[ClaudeClient] Discovered sidechain file for ${matchedAgentId} (agentType=${agentType}): ${jsonlName}`)
        continue
      }

      // 模糊匹配：如果 agentType 和 agent name 相似
      for (const info of watchedAgents) {
        const normalizedName = (info.name || '').trim()
        if (normalizedName && agentType.includes(normalizedName)) {
          this.bindSidechainFile(info.agentId, jsonlPath)
          alreadyBoundFiles.add(jsonlPath)
          logger.info(`[ClaudeClient] Discovered sidechain file for ${info.agentId} (fuzzy match ${agentType}~${normalizedName}): ${jsonlName}`)
          break
        }
      }
    }
  }

  emitAgentUpdate(payload = {}) {
    if (!payload || !payload.agentId) {
      return
    }

    const registry = Object.fromEntries(
      Object.entries({
        agentId: payload.agentId,
        agentKind: payload.agentKind || null,
        agentType: payload.agentType || null,
        name: payload.name || null,
        color: payload.color || null,
        prompt: payload.prompt || null,
        model: payload.model || null,
        teamId: payload.teamId || null,
        parentAgentId: payload.parentAgentId || null,
        status: payload.status || null,
        canWrite: typeof payload.canWrite === 'boolean' ? payload.canWrite : null,
        interactionMode: payload.interactionMode || null
      }).filter(([, value]) => value !== null && value !== undefined)
    )

    this.emit('agent-update', {
      provider: 'claude',
      source: payload.source || 'provider',
      ccgui: typeof this.buildCcguiPatch === 'function'
        ? this.buildCcguiPatch({ registry })
        : { registry },
      timestamp: new Date().toISOString()
    })
  }

  pollSidechainEntries() {
    const subagentsDir = this.getSubagentsDirectory()
    if (!subagentsDir || !fs.existsSync(subagentsDir)) {
      return
    }

    // 每次先扫描目录，发现新文件并归类
    this.discoverSidechainFiles(subagentsDir)

    if (this.sidechainFileAgents.size === 0) {
      return
    }

    const files = Array.from(this.sidechainFileAgents.keys())
      .filter(filePath => filePath.startsWith(subagentsDir))
      .sort()

    for (const filePath of files) {
      if (!fs.existsSync(filePath)) {
        continue
      }

      try {
        const raw = fs.readFileSync(filePath, 'utf8')
        const lines = raw.split('\n').filter(Boolean)
        const state = this.sidechainFileState.get(filePath) || { lineCount: 0 }
        if (lines.length < state.lineCount) {
          state.lineCount = 0
        }

        for (let index = state.lineCount; index < lines.length; index += 1) {
          let entry = null
          try {
            entry = JSON.parse(lines[index])
          } catch (error) {
            logger.warn(`[ClaudeClient] Failed to parse sidechain entry from ${filePath}: ${error.message}`)
            continue
          }

          const stableEntryId = entry?.uuid || entry?.message?.id || null
          const entryId = stableEntryId
            ? `sidechain:${stableEntryId}`
            : `${filePath}::${index}`
          if (this.sidechainSeenEntryIds.has(entryId)) {
            continue
          }

          this.sidechainSeenEntryIds.add(entryId)
          const fileAgentId = this.sidechainFileAgents.get(filePath) || null
          if (!fileAgentId) {
            continue
          }

          this.handleMessage({
            type: 'sidechain_entry',
            agentId: fileAgentId,
            entry
          })
        }

        state.lineCount = lines.length
        this.sidechainFileState.set(filePath, state)
      } catch (error) {
        logger.warn(`[ClaudeClient] Failed to poll sidechain file ${filePath}: ${error.message}`)
      }
    }
  }
}

module.exports = { ClaudeClient }
