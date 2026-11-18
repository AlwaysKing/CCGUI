/**
 * CCGUI 内置模型代理
 * 启动后在后台监听本地端口，所有 claude / codex 的模型请求都经由这里转发到真实供应商
 */

const appConfigManager = require('../../storage/app-config-manager')
const logger = require('../../logger')
const { getDefaultProxyPort } = require('../../runtime-paths')
const { SessionRegistry } = require('./session-registry')
const { createProxyServer } = require('./server')
const {
  DEFAULT_ENTRY,
  REASONING_EFFORT_VALUES,
  buildCatalogSlug,
  getCatalogPath,
  hasCatalogConfig,
  listImportCandidates,
  normalizeCatalogConfig,
  writeCatalogFile
} = require('./model-catalog')
const { buildModelName, resolveProxyTarget } = require('./router')

const DEFAULT_PROXY_PORT = getDefaultProxyPort()
const PROXY_HOST = '127.0.0.1'
const MAX_PORT_ATTEMPTS = 100

function stringifyTomlString(value) {
  return `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

class LocalProxy {
  constructor() {
    this.server = null
    this.port = null
    this.status = 'stopped'
    this.error = null
    this.registry = new SessionRegistry()
  }

  getConfiguredPort() {
    try {
      const appConfig = appConfigManager.loadConfig()
      const port = Number(appConfig?.settings?.proxyPort)
      return Number.isInteger(port) && port > 0 && port < 65536 ? port : DEFAULT_PROXY_PORT
    } catch (error) {
      return DEFAULT_PROXY_PORT
    }
  }

  async start() {
    // 并发调用（应用启动与首个会话同时触发）时复用同一次启动过程，避免重复绑定端口
    if (this.startPromise) {
      return this.startPromise
    }

    if (this.server) {
      return this.getStatus()
    }

    this.startPromise = this.startServer()
    try {
      return await this.startPromise
    } finally {
      this.startPromise = null
    }
  }

  async startServer() {
    const preferredPort = this.getConfiguredPort()
    logger.info('[LocalProxy] 启动本地模型代理', { preferredPort })

    let candidatePort = preferredPort
    let lastError = null
    for (let attempt = 0; attempt < MAX_PORT_ATTEMPTS; attempt += 1) {
      const server = createProxyServer({ registry: this.registry })
      try {
        await new Promise((resolve, reject) => {
          const handleError = error => {
            server.off('listening', handleListening)
            reject(error)
          }
          const handleListening = () => {
            server.off('error', handleError)
            resolve()
          }
          server.once('error', handleError)
          server.once('listening', handleListening)
          server.listen(candidatePort, PROXY_HOST)
        })

        this.server = server
        this.port = candidatePort
        this.status = 'running'
        this.error = null
        if (candidatePort !== preferredPort) {
          logger.warn('[LocalProxy] 首选端口被占用，已自动选择可用端口', {
            preferredPort,
            actualPort: candidatePort
          })
        }
        logger.info('[LocalProxy] 已启动', {
          url: this.getBaseUrl(),
          claudeBaseUrl: this.getClaudeBaseUrl(),
          codexBaseUrl: this.getCodexBaseUrl(),
          endpoints: ['/api/hello', '/v1/messages', '/v1/messages/count_tokens', '/codex/responses']
        })
        return this.getStatus()
      } catch (error) {
        lastError = error
        server.close(() => {})
        if (error.code !== 'EADDRINUSE') {
          this.status = 'error'
          this.error = error.message
          logger.error('[LocalProxy] 启动失败', { port: candidatePort, error: this.error })
          return this.getStatus()
        }
        candidatePort = candidatePort >= 65535 ? 1024 : candidatePort + 1
      }
    }

    this.status = 'error'
    this.error = `连续 ${MAX_PORT_ATTEMPTS} 个端口均被占用，请检查本机端口使用情况`
    logger.error('[LocalProxy] 启动失败', {
      preferredPort,
      error: this.error,
      lastError: lastError?.message || null
    })
    return this.getStatus()
  }

  async restart() {
    await this.stop()
    return this.start()
  }

  async stop() {
    if (!this.server) {
      this.status = 'stopped'
      return
    }

    const server = this.server
    this.server = null
    this.status = 'stopped'
    this.port = null
    this.registry.clear()

    await new Promise(resolve => {
      server.close(() => resolve())
    })
  }

  getStatus() {
    return {
      status: this.status,
      port: this.port,
      error: this.error
    }
  }

  getBaseUrl() {
    return this.port ? `http://${PROXY_HOST}:${this.port}` : ''
  }

  getClaudeBaseUrl() {
    return this.getBaseUrl()
  }

  getCodexBaseUrl() {
    const baseUrl = this.getBaseUrl()
    return baseUrl ? `${baseUrl}/codex` : ''
  }

  /**
   * 构造 codex 的供应商启动参数
   * 所有 codex 进程（会话、会话列表、配置检查）都用同一份参数，保证供应商恒为 CCGUI
   */
  buildCodexProviderArgs(options = {}) {
    const appConfig = options.appConfig || appConfigManager.loadConfig()
    const baseUrl = this.getCodexBaseUrl()
    if (!baseUrl) {
      return []
    }

    const args = [
      '-c', `model_provider=${stringifyTomlString('ccgui')}`,
      '-c', `model_providers.ccgui.name=${stringifyTomlString('CCGUI')}`,
      '-c', `model_providers.ccgui.base_url=${stringifyTomlString(baseUrl)}`,
      '-c', `model_providers.ccgui.wire_api=${stringifyTomlString('responses')}`
    ]

    if (options.token) {
      args.push('-c', `model_providers.ccgui.experimental_bearer_token=${stringifyTomlString(options.token)}`)
    }

    const catalogPath = options.catalogPath || writeCatalogFile(appConfig)
    if (catalogPath) {
      args.push('-c', `model_catalog_json=${stringifyTomlString(catalogPath)}`)
    }

    if (options.model) {
      args.push('-c', `model=${stringifyTomlString(options.model)}`)
    }

    return args
  }

  registerSession(meta) {
    return this.registry.register(meta)
  }

  unregisterSession(token) {
    return this.registry.unregister(token)
  }

  buildModelName(providerId, modelName) {
    return buildModelName(providerId, modelName)
  }

  resolveTarget(options) {
    return resolveProxyTarget(options)
  }

  writeCodexCatalog(appConfig) {
    return writeCatalogFile(appConfig)
  }

  listCodexCatalogImportCandidates(appConfig) {
    return listImportCandidates(appConfig)
  }
}

const localProxy = new LocalProxy()

module.exports = {
  DEFAULT_PROXY_PORT,
  DEFAULT_CATALOG_ENTRY: DEFAULT_ENTRY,
  REASONING_EFFORT_VALUES,
  buildCatalogSlug,
  getCatalogPath,
  hasCatalogConfig,
  localProxy,
  normalizeCatalogConfig
}
