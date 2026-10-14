/**
 * 本地代理 HTTP 服务
 * claude 走 /v1/*，codex 走 /codex/*，统一由模型名解析出真实供应商后转发
 */

const http = require('http')
const appConfigManager = require('../../storage/app-config-manager')
const logger = require('../../logger')
const { resolveProxyTarget } = require('./router')
const { buildUpstreamUrl, forwardRequest } = require('./upstream')

const CODEX_PATH_PREFIX = '/codex'
const MAX_REQUEST_BODY_SIZE = 64 * 1024 * 1024

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0

    req.on('data', chunk => {
      size += chunk.length
      if (size > MAX_REQUEST_BODY_SIZE) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })

    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

function extractBearerToken(req) {
  const authorization = String(req.headers?.authorization || '')
  const match = authorization.match(/^Bearer\s+(.+)$/i)
  if (match) {
    return match[1].trim()
  }

  return String(req.headers?.['x-api-key'] || '').trim()
}

function resolveToolFromPath(pathname) {
  if (pathname === CODEX_PATH_PREFIX || pathname.startsWith(`${CODEX_PATH_PREFIX}/`)) {
    return {
      tool: 'codex',
      upstreamPath: pathname.slice(CODEX_PATH_PREFIX.length) || '/'
    }
  }

  return {
    tool: 'claude',
    upstreamPath: pathname
  }
}

function rewriteRequestBody(bodyBuffer, modelName) {
  if (!bodyBuffer || bodyBuffer.length === 0) {
    return { body: bodyBuffer, modelName: '' }
  }

  let payload = null
  try {
    payload = JSON.parse(bodyBuffer.toString('utf-8'))
  } catch {
    return { body: bodyBuffer, modelName: '' }
  }

  if (!payload || typeof payload !== 'object') {
    return { body: bodyBuffer, modelName: '' }
  }

  return {
    payload,
    modelName: typeof payload.model === 'string' ? payload.model.trim() : ''
  }
}

async function handleRequest(req, res, options = {}) {
  const requestUrl = new URL(req.url || '/', 'http://127.0.0.1')
  const pathname = requestUrl.pathname
  const requestId = `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`

  if (pathname === '/api/hello') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end('{}')
    return
  }

  const { tool, upstreamPath } = resolveToolFromPath(pathname)
  const bodyBuffer = await readRequestBody(req)
  const rewritten = rewriteRequestBody(bodyBuffer, null)
  const sessionToken = extractBearerToken(req)
  const session = options.registry?.get(sessionToken) || null

  logger.info('[LocalProxy] 收到模型请求', {
    requestId,
    tool,
    path: `${pathname}${requestUrl.search}`,
    incomingModel: rewritten.modelName || null,
    hasSessionToken: Boolean(sessionToken),
    sessionTokenTail: sessionToken ? sessionToken.slice(-6) : null,
    sessionRecognized: Boolean(session),
    sessionId: session?.sessionId || null,
    streaming: Boolean(rewritten.payload?.stream)
  })

  const appConfig = appConfigManager.loadConfig()
  const target = resolveProxyTarget({
    tool,
    modelName: rewritten.modelName,
    appConfig,
    session
  })

  if (target.error) {
    logger.warn('[LocalProxy] 请求无法解析供应商', {
      tool,
      path: pathname,
      model: rewritten.modelName || null,
      error: target.error
    })
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({
      type: 'error',
      error: { type: 'ccgui_proxy_error', message: target.error }
    }))
    return
  }

  const upstreamUrl = buildUpstreamUrl(target.upstreamBaseUrl, `${upstreamPath}${requestUrl.search}`)
  if (!upstreamUrl) {
    res.writeHead(400, { 'content-type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({
      type: 'error',
      error: {
        type: 'ccgui_proxy_error',
        message: `供应商 ${target.providerName} 未配置有效的接口地址`
      }
    }))
    return
  }

  let forwardBody = bodyBuffer
  if (rewritten.payload && rewritten.modelName !== target.modelName) {
    rewritten.payload.model = target.modelName
    forwardBody = Buffer.from(JSON.stringify(rewritten.payload), 'utf-8')
  }

  const isStreaming = Boolean(rewritten.payload?.stream)
  const result = await forwardRequest({
    req,
    res,
    targetUrl: upstreamUrl,
    body: forwardBody,
    credentialToken: target.credential?.token || '',
    isStreaming
  })

  logger.info('[LocalProxy] 转发完成', {
    requestId,
    tool,
    path: pathname,
    provider: target.providerName,
    incomingModel: rewritten.modelName || null,
    upstreamHost: new URL(upstreamUrl).host,
    upstreamModel: target.modelName,
    credentialId: target.credential?.id || null,
    streaming: isStreaming,
    status: result.statusCode,
    durationMs: result.durationMs,
    hasCredential: Boolean(target.credential?.token)
  })
}

function createProxyServer(options = {}) {
  return http.createServer((req, res) => {
    handleRequest(req, res, options).catch(error => {
      logger.error('[LocalProxy] 请求处理失败', {
        path: req.url,
        error: error.message
      })

      if (!res.headersSent) {
        res.writeHead(500, { 'content-type': 'application/json; charset=utf-8' })
      }
      res.end(JSON.stringify({
        type: 'error',
        error: { type: 'ccgui_proxy_error', message: error.message }
      }))
    })
  })
}

module.exports = {
  CODEX_PATH_PREFIX,
  createProxyServer
}
