/**
 * 供应商模型列表拉取
 * 按协议用固定地址（{上游地址}/v1/models）与固定认证头请求上游，供模型编辑弹窗的"下载"按钮使用
 * 走主进程 Node 请求绕开渲染进程的 CORS 限制；与转发层同一契约：绝不 reject，成败都 resolve
 */

const http = require('http')
const https = require('https')
const { URL } = require('url')
const { buildUpstreamUrl } = require('./local-proxy/upstream')

const FETCH_TIMEOUT_MS = 10 * 1000

// 模型列表接口按协议固定：Anthropic / OpenAI 都是 GET {base}/v1/models
const MODELS_PATH = '/v1/models'

function resolveProtocolId(tool) {
  return tool === 'claude' ? 'anthropic' : 'openai'
}

// 认证方式按协议固定：Anthropic 用 x-api-key，OpenAI 用 Authorization: Bearer
function buildRequestHeaders(protocolId, token) {
  const headers = { accept: 'application/json' }

  if (protocolId === 'anthropic') {
    headers['anthropic-version'] = '2023-06-01'
    if (token) {
      headers['x-api-key'] = token
    }
    return headers
  }

  if (token) {
    headers.authorization = `Bearer ${token}`
  }
  return headers
}

function pickString(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim()
    }
  }
  return ''
}

function pickPositiveNumber(...values) {
  for (const value of values) {
    const number = Number(value)
    if (Number.isFinite(number) && number > 0) {
      return number
    }
  }
  return null
}

function pickStringArray(value) {
  if (!Array.isArray(value)) {
    return null
  }

  const items = value
    .map(item => (typeof item === 'string' ? item.trim() : ''))
    .filter(Boolean)

  return items.length > 0 ? items : null
}

// 上游按「每 token 美元」上报，卡片上的价格按「每百万 token 美元」填写
function toPricePerMillion(value) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) {
    return null
  }

  return String(Number((number * 1000000).toFixed(6)))
}

function pickPrice(pricing, keys) {
  for (const key of keys) {
    const price = toPricePerMillion(pricing[key])
    if (price) {
      return price
    }
  }
  return null
}

// 价格字段名各家不一：OpenRouter 是 prompt/completion/input_cache_read，部分中转是 input/output/cache
function normalizePricing(pricing) {
  if (!pricing || typeof pricing !== 'object') {
    return null
  }

  const normalized = {
    cache: pickPrice(pricing, ['input_cache_read', 'cache', 'cached_input', 'cache_read']),
    input: pickPrice(pricing, ['prompt', 'input']),
    output: pickPrice(pricing, ['completion', 'output'])
  }

  return normalized.cache || normalized.input || normalized.output ? normalized : null
}

function normalizeModelEntry(entry) {
  const id = pickString(entry?.id, entry?.model, entry?.name)
  if (!id) {
    return null
  }

  // 不同上游给的窗口字段名不同，能认出来的都收下；拿不到就留空，由生成阶段走默认元数据
  const contextWindow = pickPositiveNumber(
    entry?.context_length,
    entry?.context_window,
    entry?.max_input_tokens,
    entry?.max_model_len,
    entry?.top_provider?.context_length
  )
  const maxContextWindow = pickPositiveNumber(entry?.max_context_length, entry?.max_context_window) || contextWindow

  return {
    id,
    displayName: pickString(entry?.display_name, entry?.name),
    ownedBy: pickString(entry?.owned_by, entry?.provider, entry?.organization),
    description: pickString(entry?.description),
    contextWindow,
    maxContextWindow,
    inputModalities: pickStringArray(entry?.architecture?.input_modalities) || pickStringArray(entry?.input_modalities),
    pricing: normalizePricing(entry?.pricing)
  }
}

function normalizeModelList(payload) {
  const rawList = Array.isArray(payload?.data)
    ? payload.data
    : (Array.isArray(payload?.models) ? payload.models : null)

  if (!rawList) {
    return null
  }

  const models = []
  const seenIds = new Set()

  for (const rawEntry of rawList) {
    const entry = typeof rawEntry === 'string'
      ? normalizeModelEntry({ id: rawEntry })
      : normalizeModelEntry(rawEntry)

    if (!entry || seenIds.has(entry.id)) {
      continue
    }

    seenIds.add(entry.id)
    models.push(entry)
  }

  return models
}

/**
 * 拉取上游模型列表
 * @param {{tool?: string, baseUrl?: string, token?: string}} options
 * @returns {Promise<{success: boolean, endpoint?: string, models?: Array, error?: string}>}
 */
function fetchProviderModels(options = {}) {
  const protocolId = resolveProtocolId(options.tool)
  const baseUrl = String(options.baseUrl || '').trim()
  const token = String(options.token || '').trim()

  return new Promise(resolve => {
    let settled = false
    const finish = result => {
      if (settled) {
        return
      }
      settled = true
      resolve(result)
    }

    const endpoint = buildUpstreamUrl(baseUrl, MODELS_PATH)
    let target = null
    try {
      target = new URL(endpoint)
    } catch (error) {
      finish({ success: false, error: `上游地址无效：${error.message}` })
      return
    }

    const client = target.protocol === 'https:' ? https : http
    const request = client.get(endpoint, { headers: buildRequestHeaders(protocolId, token) }, response => {
      const chunks = []
      response.on('data', chunk => chunks.push(chunk))
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          finish({ success: false, endpoint, error: `上游返回 HTTP ${response.statusCode}` })
          return
        }

        let payload = null
        try {
          payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        } catch (error) {
          payload = null
        }

        const models = normalizeModelList(payload)
        if (!models) {
          finish({ success: false, endpoint, error: '上游响应里没有可识别的模型列表' })
          return
        }

        finish({ success: true, endpoint, models })
      })
    })

    request.on('error', error => finish({ success: false, endpoint, error: error.message }))
    request.setTimeout(FETCH_TIMEOUT_MS, () => {
      request.destroy(new Error(`拉取超时（${FETCH_TIMEOUT_MS / 1000} 秒）`))
    })
  })
}

module.exports = {
  fetchProviderModels,
  resolveProtocolId
}
