/**
 * 上游转发
 * 只替换鉴权头并透传请求体与响应流，不做协议转换
 */

const http = require('http')
const https = require('https')
const { URL } = require('url')

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
])

const REQUEST_HEADER_BLOCKLIST = new Set([
  ...HOP_BY_HOP_HEADERS,
  'host',
  'content-length',
  'accept-encoding',
  'authorization',
  'x-api-key'
])

const STREAM_FIRST_BYTE_TIMEOUT = 60 * 1000
const STREAM_IDLE_TIMEOUT = 120 * 1000
const NON_STREAM_TIMEOUT = 600 * 1000

const VERSION_SEGMENT_PATTERN = /^v\d+(?:beta\d*)?$/i

/**
 * 供应商地址通常已经带了版本前缀（如 /v1），而 CLI 也会带上一份，
 * 这里把重复的版本段去掉，避免拼出 /v1/v1/responses
 */
function dropDuplicatedVersionSegment(baseUrl, suffix) {
  const baseSegments = baseUrl.split('/')
  const lastBaseSegment = baseSegments[baseSegments.length - 1]
  const match = String(suffix || '').match(/^\/([^/?#]+)([\s\S]*)$/)
  if (!match) {
    return suffix
  }

  const [, firstSuffixSegment, rest] = match
  if (VERSION_SEGMENT_PATTERN.test(firstSuffixSegment)
    && firstSuffixSegment.toLowerCase() === String(lastBaseSegment).toLowerCase()) {
    return rest
  }

  return suffix
}

function buildUpstreamUrl(baseUrl = '', pathWithQuery = '') {
  const normalizedBase = String(baseUrl || '').trim().replace(/\/+$/, '')
  if (!normalizedBase) {
    return ''
  }

  let suffix = pathWithQuery
    ? (pathWithQuery.startsWith('/') ? pathWithQuery : `/${pathWithQuery}`)
    : ''
  suffix = dropDuplicatedVersionSegment(normalizedBase, suffix)

  try {
    return new URL(`${normalizedBase}${suffix}`).toString()
  } catch (error) {
    return ''
  }
}

function pickRequestHeaders(requestHeaders = {}, credentialToken = '') {
  const headers = {}

  for (const [key, value] of Object.entries(requestHeaders)) {
    if (REQUEST_HEADER_BLOCKLIST.has(String(key).toLowerCase())) {
      continue
    }
    headers[key] = value
  }

  if (credentialToken) {
    headers.Authorization = `Bearer ${credentialToken}`
  }

  return headers
}

function pickResponseHeaders(upstreamHeaders = {}) {
  const headers = {}

  for (const [key, value] of Object.entries(upstreamHeaders)) {
    if (HOP_BY_HOP_HEADERS.has(String(key).toLowerCase())) {
      continue
    }
    headers[key] = value
  }

  return headers
}

function respondWithError(res, statusCode, message) {
  if (res.headersSent) {
    res.destroy()
    return
  }

  const payload = JSON.stringify({
    type: 'error',
    error: {
      type: 'ccgui_proxy_error',
      message
    }
  })

  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload)
  })
  res.end(payload)
}

/**
 * 转发请求到真实供应商
 * @returns {Promise<{statusCode: number, durationMs: number}>}
 */
function forwardRequest(options = {}) {
  const { req, res, targetUrl, body, credentialToken, isStreaming } = options

  return new Promise(resolve => {
    const startTime = Date.now()
    const target = new URL(targetUrl)
    const client = target.protocol === 'https:' ? https : http
    const headers = pickRequestHeaders(req.headers, credentialToken)

    if (body !== null && body !== undefined) {
      headers['Content-Length'] = Buffer.byteLength(body)
    }

    const upstreamReq = client.request({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port || (target.protocol === 'https:' ? 443 : 80),
      method: req.method,
      path: `${target.pathname}${target.search}`,
      headers
    })

    let settled = false
    const finish = statusCode => {
      if (settled) {
        return
      }
      settled = true
      resolve({
        statusCode,
        durationMs: Date.now() - startTime
      })
    }

    const firstByteTimer = isStreaming
      ? setTimeout(() => {
          upstreamReq.destroy(new Error('upstream first byte timeout'))
        }, STREAM_FIRST_BYTE_TIMEOUT)
      : null

    upstreamReq.setTimeout(NON_STREAM_TIMEOUT, () => {
      upstreamReq.destroy(new Error('upstream request timeout'))
    })

    upstreamReq.on('response', upstreamRes => {
      if (firstByteTimer) {
        clearTimeout(firstByteTimer)
      }

      res.writeHead(upstreamRes.statusCode || 502, pickResponseHeaders(upstreamRes.headers))

      if (isStreaming) {
        upstreamRes.socket?.setTimeout(STREAM_IDLE_TIMEOUT)
        upstreamRes.on('data', () => {
          upstreamRes.socket?.setTimeout(STREAM_IDLE_TIMEOUT)
        })
      }

      upstreamRes.pipe(res)
      upstreamRes.on('end', () => finish(upstreamRes.statusCode || 502))
      upstreamRes.on('error', () => finish(upstreamRes.statusCode || 502))
      res.on('close', () => {
        if (!upstreamRes.complete) {
          upstreamRes.destroy()
        }
        finish(upstreamRes.statusCode || 499)
      })
    })

    upstreamReq.on('error', error => {
      if (firstByteTimer) {
        clearTimeout(firstByteTimer)
      }

      respondWithError(res, 502, `转发到上游失败: ${error.message}`)
      finish(502)
    })

    if (body !== null && body !== undefined) {
      upstreamReq.write(body)
    }
    upstreamReq.end()
  })
}

module.exports = {
  buildUpstreamUrl,
  forwardRequest
}
