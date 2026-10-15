/**
 * Codex 模型元数据目录（models.json）管理
 * CCGUI 自己维护一份，通过 model_catalog_json 启动参数注入，不写入 ~/.codex
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const logger = require('../../logger')

const DEFAULT_ENTRY = {
  base_instructions: 'You are Codex, a coding agent. You and the user share the same workspace and collaborate to achieve the user\'s goals.',
  support_verbosity: false,
  default_verbosity: 'medium',
  apply_patch_tool_type: 'freeform',
  web_search_tool_type: 'text',
  input_modalities: ['text'],
  supports_image_detail_original: false,
  truncation_policy: { limit: 10000, mode: 'bytes' },
  supports_parallel_tool_calls: true,
  tool_mode: null,
  multi_agent_version: 'v2',
  use_responses_lite: false,
  include_skills_usage_instructions: false,
  auto_review_model_override: null,
  context_window: 200000,
  max_context_window: 200000,
  effective_context_window_percent: 95,
  auto_compact_token_limit: null,
  reasoning_summary_format: 'experimental',
  default_reasoning_summary: 'none',
  description: '',
  default_reasoning_level: 'high',
  supported_reasoning_levels: [
    { effort: 'none', description: 'Disable thinking' },
    { effort: 'low', description: 'Fast responses with lighter reasoning' },
    { effort: 'high', description: 'Enabled high reasoning' }
  ],
  shell_type: 'shell_command',
  visibility: 'list',
  supported_in_api: true,
  availability_nux: null,
  upgrade: null,
  priority: 1,
  prefer_websockets: false,
  supports_search_tool: false,
  supports_reasoning_summaries: true,
  experimental_supported_tools: [],
  service_tiers: [],
  additional_speed_tiers: [],
  default_service_tier: null
}

// Codex 只接受这些思考等级，非法值会导致 CLI 无法启动
const REASONING_EFFORT_VALUES = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh']
const REASONING_EFFORT_ALIASES = {
  max: 'xhigh',
  maximum: 'xhigh'
}

// Codex 只接受这些可见性取值
const VISIBILITY_VALUES = ['list', 'hide', 'none']
const VISIBILITY_ALIASES = {
  hidden: 'hide',
  normal: 'list'
}

const REQUIRED_CATALOG_FIELDS = [
  'base_instructions',
  'support_verbosity',
  'context_window',
  'max_context_window',
  'supported_reasoning_levels'
]

// Codex 要求 model_catalog_json 至少包含一个模型，一份条目都没有时用隐藏占位条目兜底
const PLACEHOLDER_SLUG = '__ccgui_placeholder__'
const PLACEHOLDER_ENTRY = {
  ...DEFAULT_ENTRY,
  slug: PLACEHOLDER_SLUG,
  display_name: 'CCGUI 占位条目',
  description: 'CCGUI 内部占位条目，用于满足 Codex 对模型目录非空的要求',
  visibility: 'hide'
}

function getCatalogPath() {
  return path.join(os.homedir(), '.ccgui', 'models.json')
}

function getUserCatalogPath() {
  return path.join(os.homedir(), '.codex', 'models.json')
}

function normalizeReasoningLevels(levels = []) {
  const normalized = []

  for (const level of Array.isArray(levels) ? levels : []) {
    if (!level || typeof level !== 'object') {
      continue
    }

    const rawEffort = String(level.effort || '').trim().toLowerCase()
    const effort = REASONING_EFFORT_ALIASES[rawEffort] || rawEffort
    if (!REASONING_EFFORT_VALUES.includes(effort)) {
      continue
    }

    if (normalized.some(item => item.effort === effort)) {
      continue
    }

    normalized.push({
      ...level,
      effort,
      description: typeof level.description === 'string' ? level.description : ''
    })
  }

  return normalized.length > 0 ? normalized : DEFAULT_ENTRY.supported_reasoning_levels
}

function normalizeCatalogConfig(catalog = {}) {
  const normalized = {}

  for (const [key, value] of Object.entries(catalog || {})) {
    if (key === 'slug' || key === 'display_name') {
      continue
    }
    if (value === undefined || value === null || value === '') {
      continue
    }
    normalized[key] = value
  }

  if (normalized.supported_reasoning_levels) {
    normalized.supported_reasoning_levels = normalizeReasoningLevels(normalized.supported_reasoning_levels)
  }

  if (normalized.visibility !== undefined) {
    const rawVisibility = String(normalized.visibility).trim().toLowerCase()
    const visibility = VISIBILITY_ALIASES[rawVisibility] || rawVisibility
    if (VISIBILITY_VALUES.includes(visibility)) {
      normalized.visibility = visibility
    } else {
      delete normalized.visibility
    }
  }

  return normalized
}

function hasCatalogConfig(card = null) {
  const catalog = card?.catalog
  if (!catalog || typeof catalog !== 'object') {
    return false
  }

  return Object.keys(catalog).length > 0
}

function buildCatalogSlug(providerId, modelName) {
  return `${providerId}/${modelName || ''}`
}

function buildCatalogEntry(provider, card) {
  const catalogConfig = normalizeCatalogConfig(card.catalog)
  const entry = {
    ...DEFAULT_ENTRY,
    ...catalogConfig,
    slug: buildCatalogSlug(provider.id, card.modelName),
    display_name: `${provider.friendlyName || provider.id} / ${card.modelName}`,
    description: catalogConfig.description || `${provider.friendlyName || provider.id} 提供的 ${card.modelName}`
  }

  // 只填了上下文窗口时，最大上下文窗口跟随它，不要落回与它不一致的默认值
  if (catalogConfig.context_window !== undefined && catalogConfig.max_context_window === undefined) {
    entry.max_context_window = entry.context_window
  }

  for (const field of REQUIRED_CATALOG_FIELDS) {
    if (entry[field] === undefined || entry[field] === null) {
      entry[field] = DEFAULT_ENTRY[field]
    }
  }

  return entry
}

function buildCatalog(appConfig) {
  const models = Array.isArray(appConfig?.settings?.codexModels) ? appConfig.settings.codexModels : []
  const entries = []
  const seenSlugs = new Set()

  for (const provider of models) {
    if (!provider?.id) {
      continue
    }

    for (const card of Array.isArray(provider.modelCards) ? provider.modelCards : []) {
      if (!card?.modelName) {
        continue
      }

      const entry = buildCatalogEntry(provider, card)

      // 同一供应商下同名模型只保留第一条，避免目录里出现重复 slug
      if (seenSlugs.has(entry.slug)) {
        continue
      }

      seenSlugs.add(entry.slug)
      entries.push(entry)
    }
  }

  if (entries.length === 0) {
    entries.push({ ...PLACEHOLDER_ENTRY })
  }

  return { models: entries }
}

function writeCatalogFile(appConfig) {
  const catalogPath = getCatalogPath()
  const catalog = buildCatalog(appConfig)
  const content = `${JSON.stringify(catalog, null, 2)}\n`

  try {
    fs.mkdirSync(path.dirname(catalogPath), { recursive: true })

    // 内容没变化就不重复落盘，避免频繁启动 codex 时反复写文件
    if (fs.existsSync(catalogPath) && fs.readFileSync(catalogPath, 'utf-8') === content) {
      return catalogPath
    }

    fs.writeFileSync(catalogPath, content, 'utf-8')
  } catch (error) {
    logger.error('[LocalProxy] 写入 Codex 模型目录失败', {
      catalogPath,
      error: error.message
    })
    return ''
  }

  return catalogPath
}

function readUserCatalog() {
  const catalogPath = getUserCatalogPath()

  try {
    if (!fs.existsSync(catalogPath)) {
      return null
    }

    const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'))
    const models = Array.isArray(raw?.models) ? raw.models : []
    return { path: catalogPath, models }
  } catch (error) {
    logger.warn('[LocalProxy] 读取 Codex 模型目录失败', {
      error: error.message
    })
    return null
  }
}

/**
 * 找出用户 Codex 目录里、本机模型卡片还没有元数据的模型
 */
function listImportCandidates(appConfig) {
  const userCatalog = readUserCatalog()
  if (!userCatalog) {
    return []
  }

  const codexModels = Array.isArray(appConfig?.settings?.codexModels) ? appConfig.settings.codexModels : []
  const candidates = []

  for (const provider of codexModels) {
    for (const card of Array.isArray(provider?.modelCards) ? provider.modelCards : []) {
      if (!card?.modelName || !card?.id || hasCatalogConfig(card)) {
        continue
      }

      const matchedEntry = userCatalog.models.find(entry =>
        entry && typeof entry === 'object' && entry.slug === card.modelName
      )
      if (!matchedEntry) {
        continue
      }

      candidates.push({
        providerId: provider.id,
        providerName: provider.friendlyName || provider.id,
        cardId: card.id,
        modelName: card.modelName,
        entry: matchedEntry
      })
    }
  }

  return candidates
}

module.exports = {
  DEFAULT_ENTRY,
  PLACEHOLDER_ENTRY,
  PLACEHOLDER_SLUG,
  REASONING_EFFORT_VALUES,
  VISIBILITY_VALUES,
  buildCatalog,
  buildCatalogEntry,
  buildCatalogSlug,
  getCatalogPath,
  getUserCatalogPath,
  hasCatalogConfig,
  listImportCandidates,
  normalizeCatalogConfig,
  normalizeReasoningLevels,
  readUserCatalog,
  writeCatalogFile
}
