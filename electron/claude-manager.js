const { spawn } = require('child_process')
const path = require('path')
const fs = require('fs')

/**
 * Claude CLI Manager
 * Manages communication with Claude CLI using stream-json format
 */
class ClaudeManager {
  constructor() {
    this.process = null
    this.messageHandlers = new Map()
    this.claudePath = null
    this.pendingPermissions = new Map()
    this.workingDirectory = process.cwd()
  }

  /**
   * Get the working directory
   */
  getWorkingDirectory() {
    return this.workingDirectory
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
      console.error('Failed to detect Claude path:', error.message)
      throw error
    }

    const args = [
      '--print',
      '--verbose',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--permission-prompt-tool', 'stdio',
      '--include-partial-messages',
      '--thinking', 'adaptive'
    ]

    try {
      this.process = spawn(this.claudePath, args, {
        cwd: process.cwd(),
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

      // Emit init event after process starts
      this.handleMessage({
        type: 'system',
        subtype: 'init',
        message: 'Claude CLI initialized'
      })

    } catch (error) {
      console.error('Failed to start Claude CLI:', error)
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
      console.log('[ClaudeManager] stdout RAW:', JSON.stringify(rawData.substring(0, 500)))
      buffer += rawData
      const lines = buffer.split('\n')
      buffer = lines.pop() // Keep incomplete line

      lines.forEach(line => {
        if (line.trim()) {
          try {
            const message = JSON.parse(line)
            this.handleMessage(message)
          } catch (error) {
            console.error('JSON parse error:', line.substring(0, 200))
          }
        }
      })
    })

    // Handle stderr - 系统状态消息
    this.process.stderr.on('data', (data) => {
      const errorMsg = data.toString()
      console.log('[ClaudeManager] stderr RAW:', JSON.stringify(errorMsg))
      if (errorMsg.trim()) {
        console.log('[ClaudeManager] stderr:', errorMsg.trim())

        // 将 stderr 消息发送到前端显示
        const statusHandlers = this.messageHandlers.get('cli-status') || []
        statusHandlers.forEach(handler => {
          try {
            handler({
              type: 'status',
              message: errorMsg.trim()
            })
          } catch (error) {
            console.error('Status handler error:', error)
          }
        })

        // Check if this is a permission prompt
        if (errorMsg.includes('Permission') || errorMsg.includes('Allow') || errorMsg.includes('Deny')) {
          console.log('[ClaudeManager] This looks like a permission prompt!')
        }
      }
    })

    // Handle exit
    this.process.on('exit', (code, signal) => {
      console.log(`[ClaudeManager] Process exited: code=${code}, signal=${signal}`)
      this.process = null
    })

    // Handle error
    this.process.on('error', (error) => {
      console.error('Claude process error:', error.message)
    })
  }

  /**
   * Handle incoming messages from Claude CLI
   */
  handleMessage(message) {
    // 打印完整的消息内容到 console
    console.log('[ClaudeManager] ◀ RECEIVED MESSAGE:')
    console.log(JSON.stringify(message, null, 2))

    // Handle stream_event (thinking_delta, text_delta, message_start, etc.)
    if (message.type === 'stream_event') {
      this.handleStreamEvent(message)
      return
    }

    // Handle control_request (permission prompts when using --permission-prompt-tool stdio)
    if (message.type === 'control_request') {
      console.log('[ClaudeManager] Control request:', message.request?.subtype)
      // Send to front-end for permission dialog
      const requestHandlers = this.messageHandlers.get('control_request') || []
      requestHandlers.forEach(handler => {
        try {
          handler(message)
        } catch (error) {
          console.error('Handler error:', error)
        }
      })
      return
    }

    // Handle user messages (which may contain tool_result from CLI)
    if (message.type === 'user') {
      console.log('[ClaudeManager] User message received, checking for tool_result')
      // Check if this is a tool_result message from CLI
      if (message.message && message.message.content) {
        const toolResultContent = message.message.content.find(c => c.type === 'tool_result')
        if (toolResultContent) {
          console.log('[ClaudeManager] Found tool_result in user message:', toolResultContent.tool_use_id)
          // Trigger tool_result event
          const toolResultHandlers = this.messageHandlers.get('tool_result') || []
          toolResultHandlers.forEach(handler => {
            try {
              handler(message)
            } catch (error) {
              console.error('Tool result handler error:', error)
            }
          })
          return
        }
      }
      // If not a tool_result, treat as unknown message
      console.log('[ClaudeManager] User message is not a tool_result, treating as unknown')
      const unknownHandlers = this.messageHandlers.get('unknown_message') || []
      unknownHandlers.forEach(handler => {
        try {
          handler(message)
        } catch (error) {
          console.error('Unknown message handler error:', error)
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
          console.error('Handler error:', error)
        }
      })
    } else {
      // 没有处理器的消息类型，发送到前端显示
      console.log('[ClaudeManager] ⚠️ No handlers for message type:', message.type)
      const unknownHandlers = this.messageHandlers.get('unknown_message') || []
      unknownHandlers.forEach(handler => {
        try {
          handler(message)
        } catch (error) {
          console.error('Unknown message handler error:', error)
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

    // 打印 stream event 详情
    console.log(`[ClaudeManager] 📊 Stream event: ${event.type}`)

    // Send all stream events to front-end
    const streamHandlers = this.messageHandlers.get('stream_event') || []
    streamHandlers.forEach(handler => {
      try {
        handler(message)
      } catch (error) {
        console.error('Stream event handler error:', error)
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
      console.error('[ClaudeManager] Cannot send control response: process is null')
      throw new Error('Claude process not running')
    }
    if (!this.process.stdin.writable) {
      console.error('[ClaudeManager] Cannot send control response: stdin is not writable')
      throw new Error('Claude process stdin is not writable')
    }

    console.log('[ClaudeManager] sendControlResponse called with:', {
      requestId,
      approved,
      options: JSON.stringify(options, null, 2)
    })

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
      console.log('[ClaudeManager] Processing permission rules:', {
        count: options.permissionRules.length,
        rules: JSON.stringify(options.permissionRules, null, 2)
      })
    } else if (approved) {
      console.log('[ClaudeManager] No permission rules (single approval only)')
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

    // 详细日志：显示完整的响应内容
    console.log('[ClaudeManager] Sending FULL control_response:', JSON.stringify(responseMessage, null, 2))
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
      console.log('[ClaudeManager] Sending:', jsonMessage.substring(0, 200))
      this.process.stdin.write(jsonMessage)
    } else {
      console.error('[ClaudeManager] Process not ready:', { hasProcess: !!this.process, writable: this.process?.stdin?.writable })
      throw new Error('Claude process not ready')
    }
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
}

module.exports = { ClaudeManager }
