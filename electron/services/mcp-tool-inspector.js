/**
 * MCP Tool Inspector — 公共 MCP 工具描述获取组件
 *
 * 通过直接连接 MCP server（stdio / SSE / HTTP）调用 tools/list，
 * 获取完整的工具描述（description、inputSchema、annotations）。
 *
 * 使用场景：adapter 在 mcp_status 返回基础工具数据后，
 * 调用此组件补充缺失的 description/inputSchema。
 *
 * 不依赖 @modelcontextprotocol/sdk，纯 JSON-RPC 2.0 实现。
 */

const { spawn } = require('child_process')
const logger = require('../logger')

const CACHE_TTL = 30 * 60 * 1000       // 缓存 30 分钟
const STDIO_TIMEOUT = 30 * 1000         // stdio 整体超时 30s
const HTTP_TIMEOUT = 15 * 1000          // HTTP 单请求超时 15s
const PROTOCOL_VERSION = '2025-03-26'

class McpToolInspector {
  constructor() {
    /** @type {Map<string, { tools: Map<string, object>, timestamp: number }>} */
    this._cache = new Map()

    /** 防止同一 server 并发获取 */
    this._inflight = new Map()
  }

  /**
   * 主入口：传入 mcp_status 返回的 servers 数组，
   * 返回补充了 description/inputSchema 的 tool map。
   *
   * @param {Array} servers - mcp_status 响应中的 mcpServers 数组
   *   每个 server: { name, status, config: { type, command?, args?, url?, headers? }, tools: [{name, annotations}] }
   * @returns {Promise<Map<string, { description: string, inputSchema: object|null, annotations: object|null }>>}
   *   key 格式: "serverName::toolName"
   */
  async fetchToolDetails(servers) {
    if (!Array.isArray(servers) || servers.length === 0) {
      return new Map()
    }

    const result = new Map()
    const tasks = []

    for (const server of servers) {
      // 只处理已连接的 server
      if (server.status !== 'connected') continue
      if (!server.config) continue

      const normalizedName = this._normalizeServerName(server.name)

      // 检查缓存
      const cached = this._getCached(normalizedName)
      if (cached) {
        for (const [toolName, detail] of cached) {
          result.set(`${normalizedName}::${toolName}`, detail)
        }
        continue
      }

      // 需要获取：加入并发任务
      tasks.push(this._fetchServerTools(server))
    }

    if (tasks.length > 0) {
      const settled = await Promise.allSettled(tasks)
      for (const outcome of settled) {
        if (outcome.status === 'fulfilled' && outcome.value) {
          const { serverName, tools } = outcome.value
          for (const [toolName, detail] of tools) {
            result.set(`${serverName}::${toolName}`, detail)
          }
        }
      }
    }

    return result
  }

  /**
   * 清除指定 server 的缓存
   */
  invalidateCache(serverName) {
    this._cache.delete(serverName)
    this._inflight.delete(serverName)
  }

  /**
   * 清除所有缓存
   */
  clearAllCache() {
    this._cache.clear()
    this._inflight.clear()
  }

  // ─── 内部方法 ───────────────────────────────────────

  /**
   * 获取单个 server 的工具详情，带缓存和去重
   */
  async _fetchServerTools(server) {
    const serverName = this._normalizeServerName(server.name)

    // 去重：同一 server 同时只发起一个请求
    if (this._inflight.has(serverName)) {
      return this._inflight.get(serverName)
    }

    const promise = this._doFetchServerTools(server).finally(() => {
      this._inflight.delete(serverName)
    })
    this._inflight.set(serverName, promise)
    return promise
  }

  async _doFetchServerTools(server) {
    const serverName = this._normalizeServerName(server.name)
    const config = server.config

    if (!config || !config.type) {
      logger.info(`[McpToolInspector] No config for server: ${serverName}`)
      return { serverName, tools: new Map() }
    }

    let rawTools = []

    try {
      switch (config.type) {
        case 'stdio':
          rawTools = await this._fetchViaStdio(serverName, config)
          break
        case 'sse':
        case 'http':
          rawTools = await this._fetchViaHttp(serverName, config)
          break
        case 'claudeai-proxy':
          logger.info(`[McpToolInspector] Skipping claudeai-proxy server: ${serverName}`)
          break
        default:
          logger.info(`[McpToolInspector] Unsupported transport type '${config.type}' for server: ${serverName}`)
          break
      }
    } catch (e) {
      logger.warn(`[McpToolInspector] Failed to fetch tools from '${serverName}': ${e.message}`)
    }

    // 转换为统一格式
    const tools = new Map()
    for (const tool of rawTools) {
      tools.set(tool.name, {
        description: typeof tool.description === 'string' ? tool.description : '',
        inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : null,
        annotations: tool.annotations && typeof tool.annotations === 'object' ? tool.annotations : null
      })
    }

    // 写入缓存
    if (tools.size > 0) {
      this._cache.set(serverName, { tools, timestamp: Date.now() })
      logger.info(`[McpToolInspector] Cached ${tools.size} tools from '${serverName}'`)
    }

    return { serverName, tools }
  }

  // ─── stdio 传输 ─────────────────────────────────────

  /**
   * 通过 stdio 连接 MCP server 获取工具列表
   * 协议：NDJSON（每行一个 JSON-RPC 2.0 消息）
   */
  async _fetchViaStdio(serverName, config) {
    const command = config.command
    const args = Array.isArray(config.args) ? config.args : []

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        cleanup()
        reject(new Error(`stdio connection to '${serverName}' timed out after ${STDIO_TIMEOUT}ms`))
      }, STDIO_TIMEOUT)

      let child = null
      let buffer = ''
      let settled = false
      let initDone = false

      const pending = new Map()  // id → { resolve, reject }
      let nextId = 1

      const cleanup = () => {
        clearTimeout(timeout)
        if (child && !child.killed) {
          const childRef = child
          child.kill('SIGTERM')
          child = null
          // 3s 后如果还没退出就强制杀死
          setTimeout(() => {
            if (!childRef.killed) childRef.kill('SIGKILL')
          }, 3000)
        }
      }

      const sendRequest = (method, params = {}) => {
        return new Promise((res, rej) => {
          const id = nextId++
          const msg = { jsonrpc: '2.0', id, method, params }
          try {
            child.stdin.write(JSON.stringify(msg) + '\n')
          } catch (e) {
            rej(new Error(`Failed to write to stdin: ${e.message}`))
            return
          }
          pending.set(id, { resolve: res, reject: rej })
        })
      }

      const handleMessage = (data) => {
        try {
          const msg = JSON.parse(data)
          if (msg.id != null && pending.has(msg.id)) {
            const { resolve: res, reject: rej } = pending.get(msg.id)
            pending.delete(msg.id)
            if (msg.error) {
              rej(new Error(msg.error.message || `JSON-RPC error ${msg.error.code}`))
            } else {
              res(msg.result)
            }
          }
        } catch (e) {
          // 非 JSON 行，忽略（可能是 server 日志混入 stdout）
        }
      }

      try {
        child = spawn(command, args, {
          stdio: ['pipe', 'pipe', 'pipe'],
          env: { ...process.env }
        })
      } catch (e) {
        clearTimeout(timeout)
        reject(new Error(`Failed to spawn '${command}': ${e.message}`))
        return
      }

      child.stdout.on('data', (chunk) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop()  // 保留未完成的行
        for (const line of lines) {
          if (line.trim()) handleMessage(line)
        }
      })

      child.stderr.on('data', () => {
        // 忽略 stderr（server 日志）
      })

      child.on('error', (err) => {
        if (!settled) {
          settled = true
          cleanup()
          reject(new Error(`Process error for '${serverName}': ${err.message}`))
        }
      })

      child.on('close', (code) => {
        // 处理 buffer 中剩余数据
        if (buffer.trim()) handleMessage(buffer)
        buffer = ''
      })

      // 握手 + 获取工具列表
      ;(async () => {
        try {
          // 1. initialize
          await sendRequest('initialize', {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: { name: 'ccgui', version: '1.0.0' }
          })
          initDone = true

          // 2. 发送 initialized 通知（MCP 协议要求）
          child.stdin.write(JSON.stringify({
            jsonrpc: '2.0',
            method: 'notifications/initialized'
          }) + '\n')

          // 3. tools/list
          const toolsResult = await sendRequest('tools/list')
          const tools = Array.isArray(toolsResult?.tools) ? toolsResult.tools : []

          settled = true
          cleanup()
          resolve(tools)
        } catch (e) {
          if (!settled) {
            settled = true
            cleanup()
            reject(e)
          }
        }
      })()
    })
  }

  // ─── HTTP / SSE 传输 ───────────────────────────────

  /**
   * 通过 HTTP/SSE 连接 MCP server 获取工具列表
   */
  async _fetchViaHttp(serverName, config) {
    const url = config.url
    const headers = {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      ...(config.headers || {})
    }

    // 尝试获取 SSE endpoint（有些 server 需要先建立 SSE 连接）
    // 但大多数 HTTP streamable transport 直接用 POST 即可
    let sessionHeaders = { ...headers }

    // 1. initialize
    const initResult = await this._httpPost(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'ccgui', version: '1.0.0' }
      }
    }, sessionHeaders)

    // 如果响应包含 Mcp-Session-Id，后续请求带上
    if (initResult.sessionId) {
      sessionHeaders['Mcp-Session-Id'] = initResult.sessionId
    }

    // 2. 发送 initialized 通知（MCP 协议要求）
    await this._httpPost(url, {
      jsonrpc: '2.0',
      method: 'notifications/initialized'
    }, sessionHeaders)

    // 3. tools/list
    const toolsResult = await this._httpPost(url, {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/list'
    }, sessionHeaders)

    return Array.isArray(toolsResult?.tools) ? toolsResult.tools : []
  }

  /**
   * 发送 HTTP POST 请求并解析 JSON-RPC 响应
   */
  async _httpPost(url, body, headers = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT)

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal
      })

      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`)
      }

      // 提取 session id
      const sessionId = response.headers.get('Mcp-Session-Id')

      const data = await response.json()

      if (data.error) {
        throw new Error(data.error.message || `JSON-RPC error ${data.error.code}`)
      }

      return { ...data.result, sessionId }
    } finally {
      clearTimeout(timer)
    }
  }

  // ─── 缓存 ───────────────────────────────────────────

  /**
   * 获取缓存的工具数据
   * @returns {Map<string, object>|null}
   */
  _getCached(serverName) {
    const entry = this._cache.get(serverName)
    if (!entry) return null
    if (Date.now() - entry.timestamp > CACHE_TTL) {
      this._cache.delete(serverName)
      return null
    }
    return entry.tools
  }

  /**
   * 规范化 server name，与 adapter.js 的 normalizeServerName 保持一致
   * plugin:superpowers-chrome:chrome → plugin_superpowers-chrome_chrome
   */
  _normalizeServerName(value) {
    const raw = String(value || '').trim()
    if (!raw) return ''
    if (raw.startsWith('plugin:')) {
      return raw.replace(/^plugin:/, 'plugin_').replace(/:/g, '_')
    }
    return raw
  }
}

module.exports = { McpToolInspector }
