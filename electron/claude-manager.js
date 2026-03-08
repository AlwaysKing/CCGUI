const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')
const logger = require('./logger')

/**
 * Claude CLI Manager
 * Manages communication with Claude CLI using stream-json format
 */
class ClaudeManager {
  constructor(workingDirectory = null, sessionId = null, isNewSession = true, permissionMode = 'default') {
    this.process = null
    this.messageHandlers = new Map()
    this.claudePath = null
    this.pendingPermissions = new Map()
    this.workingDirectory = workingDirectory || process.cwd()
    this.sessionId = sessionId
    this.isNewSession = isNewSession
    this.permissionMode = permissionMode // 权限模式
  }

  /**
   * Get the working directory
   */
  getWorkingDirectory() {
    return this.workingDirectory
  }

  /**
   * Get session file path
   */
  getSessionFilePath() {
    if (!this.sessionId || !this.workingDirectory) return null

    // Encode path to match Claude's format
    let encodedPath = this.workingDirectory
    if (process.platform === 'win32') {
      encodedPath = encodedPath.replace(/:/g, '').replace(/\\/g, '-')
    } else {
      encodedPath = encodedPath.replace(/\//g, '-')
    }
    if (encodedPath.startsWith('-')) {
      encodedPath = encodedPath.slice(1)
    }
    const projectId = '-' + encodedPath

    return path.join(os.homedir(), '.claude', 'projects', projectId, `${this.sessionId}.jsonl`)
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
   * Start Claude CLI process
   */
  async start() {
    if (this.process) {
      return
    }

    try {
      this.claudePath = this.detectClaudePath()
    } catch (error) {
      throw error
    }

    const args = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--permission-prompt-tool', 'stdio',
      '--include-partial-messages',
      '--max-thinking-tokens', '31999'
    ]

    // Add permission mode if not default
    if (this.permissionMode && this.permissionMode !== 'default') {
      args.push('--permission-mode', this.permissionMode)
      logger.info(`[ClaudeManager] Setting permission mode: ${this.permissionMode}`)
    }

    // Add session-id to resume or create session
    if (this.sessionId) {
      if (this.isNewSession) {
        // New session: use --session-id to create a new session with specific ID
        args.push('--session-id', this.sessionId)
        logger.info(`[ClaudeManager] Creating new session with ID: ${this.sessionId}`)
      } else {
        // Existing session: use --resume to resume the session
        args.push('--resume', this.sessionId)
        logger.info(`[ClaudeManager] Resuming session with ID: ${this.sessionId}`)
      }
    }

    try {
      this.process = spawn(this.claudePath, args, {
        cwd: this.workingDirectory,
        env: {
          ...process.env,
          CLAUDE_CODE_ENABLE_TELEMETRY: '0',
          DISABLE_TELEMETRY: '1'
        }
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

      // Emit init event after process starts with current working directory
      this.handleMessage({
        type: 'system',
        subtype: 'init',
        cwd: this.workingDirectory,
        session_id: null,
        tools: []
      })

    } catch (error) {
      this.process = null
      throw error
    }
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
    if (this.sessionId) {
      logger.logReceive(this.sessionId, message)
    }
    // 打印所有接收到的消息
    console.log('[RECEIVED]', JSON.stringify(message, null, 2))

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
      // If not a tool_result or interrupt, treat as unknown message
      const unknownHandlers = this.messageHandlers.get('unknown_message') || []
      unknownHandlers.forEach(handler => {
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
      if (this.sessionId) {
        logger.logSend(this.sessionId, message)
      }
      // 同时保留控制台输出（方便调试）
      console.log('[SENT]', JSON.stringify(message, null, 2))
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
    const controlRequestMessage = {
      type: 'control_request',
      request: request,
      request_id: `control_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
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
   * Stop Claude CLI process
   */
  stop() {
    if (this.process) {
      this.process.kill('SIGTERM')
      this.process = null
    }
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
}

module.exports = { ClaudeManager }
