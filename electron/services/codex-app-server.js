const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn, spawnSync } = require('child_process')
const logger = require('../logger')
const appConfigManager = require('../storage/app-config-manager')

const RECOMMENDED_SKILLS_REPO = 'https://github.com/openai/skills.git'
const RECOMMENDED_SKILLS_BRANCH = 'main'
const RECOMMENDED_SKILLS_PATHS = [
  ['skills', '.curated'],
  ['skills', '.experimental']
]

function getCodexExecutablePath() {
  const possiblePaths = [
    '/Applications/Codex.app/Contents/Resources/codex',
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    path.join(os.homedir(), '.local', 'bin', 'codex')
  ]

  return possiblePaths.find(candidate => fs.existsSync(candidate)) || null
}

function getCodexResourcesPath() {
  const codexPath = getCodexExecutablePath()
  return codexPath ? path.dirname(codexPath) : null
}

function getBundledRecommendedSkillsRoot() {
  const resourcesPath = getCodexResourcesPath()
  if (!resourcesPath) return null
  const bundledRoot = path.join(resourcesPath, 'skills')
  return fs.existsSync(bundledRoot) ? bundledRoot : null
}

function getVendorImportsRoot() {
  return path.join(os.homedir(), '.codex', 'vendor_imports')
}

function getRecommendedSkillsRepoRoot() {
  return path.join(getVendorImportsRoot(), 'skills')
}

function getRecommendedSkillsCachePath() {
  return path.join(getVendorImportsRoot(), 'skills-curated-cache.json')
}

function hasRecommendedSkillsContent(repoRoot = '') {
  if (!repoRoot) return false
  return RECOMMENDED_SKILLS_PATHS.some((segments) => fs.existsSync(path.join(repoRoot, ...segments)))
}

function normalizeRecommendedRepoPath(repoPath = '') {
  const normalized = String(repoPath || '')
    .split('/')
    .filter(Boolean)
  if (!normalized.length) {
    throw new Error('缺少推荐技能路径')
  }
  return normalized
}

function resolveRecommendedSkillPath(repoRoot = '', repoPath = '') {
  const segments = normalizeRecommendedRepoPath(repoPath)
  const resolved = path.resolve(repoRoot, ...segments)
  const rootResolved = path.resolve(repoRoot)
  if (resolved !== rootResolved && !resolved.startsWith(`${rootResolved}${path.sep}`)) {
    throw new Error(`非法技能路径: ${repoPath}`)
  }
  return resolved
}

function runGitCommand(args = [], cwd = undefined) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 30000,
    env: {
      ...process.env
    }
  })

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim())
  }

  return result
}

function ensureRecommendedSkillsRepo({ refresh = false } = {}) {
  const vendorRoot = getVendorImportsRoot()
  const repoRoot = getRecommendedSkillsRepoRoot()
  const gitRoot = path.join(repoRoot, '.git')

  if (!fs.existsSync(gitRoot)) {
    fs.mkdirSync(vendorRoot, { recursive: true })
    runGitCommand(['clone', '--depth', '1', '--filter=blob:none', '--sparse', RECOMMENDED_SKILLS_REPO, repoRoot])
    runGitCommand(['sparse-checkout', 'set', ...RECOMMENDED_SKILLS_PATHS.map((segments) => segments.join('/'))], repoRoot)
    return repoRoot
  }

  if (refresh) {
    runGitCommand(['fetch', '--depth', '1', 'origin', RECOMMENDED_SKILLS_BRANCH], repoRoot)
    runGitCommand(['reset', '--hard', 'FETCH_HEAD'], repoRoot)
    runGitCommand(['sparse-checkout', 'set', ...RECOMMENDED_SKILLS_PATHS.map((segments) => segments.join('/'))], repoRoot)
  }

  return repoRoot
}

function parseRecommendedSkillFrontmatter(content = '') {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*/)
  if (!match) return {}

  const metadata = {}
  const keyMap = {
    name: 'name',
    description: 'description',
    summary: 'description',
    shortDescription: 'shortDescription',
    'short-description': 'shortDescription',
    short_description: 'shortDescription',
    iconSmall: 'iconSmall',
    'icon-small': 'iconSmall',
    icon_small: 'iconSmall',
    iconLarge: 'iconLarge',
    'icon-large': 'iconLarge',
    icon_large: 'iconLarge'
  }

  for (const rawLine of match[1].split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) continue

    const rawKey = line.slice(0, separatorIndex).trim()
    const mappedKey = keyMap[rawKey]
    if (!mappedKey) continue

    metadata[mappedKey] = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
  }

  return metadata
}

function parseIndentedMetadataBlock(content = '', blockName = '') {
  const result = {}
  const keyMap = {
    shortDescription: 'shortDescription',
    'short-description': 'shortDescription',
    short_description: 'shortDescription',
    iconSmall: 'iconSmall',
    'icon-small': 'iconSmall',
    icon_small: 'iconSmall',
    iconLarge: 'iconLarge',
    'icon-large': 'iconLarge',
    icon_large: 'iconLarge'
  }

  const lines = String(content || '').split(/\r?\n/)
  let insideBlock = false

  for (const rawLine of lines) {
    if (!insideBlock) {
      if (rawLine.trim() === `${blockName}:`) {
        insideBlock = true
      }
      continue
    }

    if (!/^\s+/.test(rawLine) || /^\S/.test(rawLine)) {
      break
    }

    const line = rawLine.trim()
    if (!line) continue

    const separatorIndex = line.indexOf(':')
    if (separatorIndex === -1) continue

    const rawKey = line.slice(0, separatorIndex).trim()
    const mappedKey = keyMap[rawKey]
    if (!mappedKey) continue

    result[mappedKey] = line
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^["']|["']$/g, '')
      .replace(/\\(["\\])/g, '$1')
  }

  return result
}

function readRecommendedSkillAgentMetadata(skillRoot = '') {
  try {
    const agentConfigPath = path.join(skillRoot, 'agents', 'openai.yaml')
    if (!fs.existsSync(agentConfigPath)) return {}
    return parseIndentedMetadataBlock(fs.readFileSync(agentConfigPath, 'utf8'), 'interface')
  } catch (error) {
    logger.debug('[CodexAppServer] Failed to read recommended skill agent metadata', {
      error: error.message,
      skillRoot
    })
    return {}
  }
}

function resolveSkillMetadataPath(skillRoot = '', value = '') {
  const source = String(value || '').trim()
  if (!source) return ''
  if (source.startsWith('http://') || source.startsWith('https://') || source.startsWith('data:')) {
    return source
  }

  const directPath = path.isAbsolute(source) ? source : path.resolve(skillRoot, source)
  if (fs.existsSync(directPath)) return directPath

  const assetPath = path.resolve(skillRoot, 'assets', source)
  if (fs.existsSync(assetPath)) return assetPath

  return ''
}

function resolveRecommendedSkillIcons(skillRoot = '', skillId = '', metadata = {}) {
  const resolved = {
    iconSmall: resolveSkillMetadataPath(skillRoot, metadata.iconSmall),
    iconLarge: resolveSkillMetadataPath(skillRoot, metadata.iconLarge)
  }

  const assetsRoot = path.join(skillRoot, 'assets')
  if (!fs.existsSync(assetsRoot)) {
    return resolved
  }

  const smallCandidates = [
    `${skillId}-small.svg`,
    `${skillId}-small.png`,
    'small.svg',
    'small.png',
    `${skillId}.svg`,
    `${skillId}.png`,
    'icon-small.svg',
    'icon-small.png'
  ]
  const largeCandidates = [
    `${skillId}.png`,
    `${skillId}.svg`,
    'icon.png',
    'icon.svg',
    `${skillId}-large.png`,
    `${skillId}-large.svg`
  ]

  if (!resolved.iconSmall) {
    resolved.iconSmall = smallCandidates
      .map((filename) => path.join(assetsRoot, filename))
      .find((candidate) => fs.existsSync(candidate)) || ''
  }

  if (!resolved.iconLarge) {
    resolved.iconLarge = largeCandidates
      .map((filename) => path.join(assetsRoot, filename))
      .find((candidate) => fs.existsSync(candidate)) || ''
  }

  return resolved
}

function loadRecommendedSkillsFromRoot(repoRoot = '') {
  const results = []
  const seen = new Set()

  for (const segments of RECOMMENDED_SKILLS_PATHS) {
    const skillsRoot = path.join(repoRoot, ...segments)
    if (!fs.existsSync(skillsRoot)) continue

    const sourceLabel = segments.includes('.experimental') ? 'OpenAI 实验' : 'OpenAI 推荐'
    const entries = fs.readdirSync(skillsRoot, { withFileTypes: true })

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue

      const entryPath = path.join(skillsRoot, entry.name)
      const skillFilePath = entry.isDirectory() ? path.join(entryPath, 'SKILL.md') : entryPath
      if (!fs.existsSync(skillFilePath)) continue

      const skillId = entry.isDirectory() ? entry.name : path.parse(entry.name).name
      if (!skillId || seen.has(skillId)) continue
      seen.add(skillId)

      const skillContent = fs.readFileSync(skillFilePath, 'utf8')
      const metadata = parseRecommendedSkillFrontmatter(skillContent)
      const agentMetadata = entry.isDirectory() ? readRecommendedSkillAgentMetadata(entryPath) : {}
      const iconMetadata = resolveRecommendedSkillIcons(entryPath, skillId, {
        iconSmall: metadata.iconSmall || agentMetadata.iconSmall,
        iconLarge: metadata.iconLarge || agentMetadata.iconLarge
      })
      const repoPath = path.relative(repoRoot, entryPath).split(path.sep).join('/')
      const description = metadata.description || metadata.shortDescription || agentMetadata.shortDescription || ''

      results.push({
        id: skillId,
        skillId,
        slug: skillId,
        name: metadata.name || skillId,
        displayName: metadata.name || skillId,
        summary: description,
        description,
        shortDescription: metadata.shortDescription || agentMetadata.shortDescription || '',
        iconSmall: iconMetadata.iconSmall || '',
        iconLarge: iconMetadata.iconLarge || '',
        path: entryPath,
        repoPath,
        sourceType: 'recommended',
        sourceLabel
      })
    }
  }

  return results.sort((left, right) => {
    const leftName = left.displayName || left.slug || ''
    const rightName = right.displayName || right.slug || ''
    return leftName.localeCompare(rightName)
  })
}

function readRecommendedSkillsCache() {
  try {
    const payload = JSON.parse(fs.readFileSync(getRecommendedSkillsCachePath(), 'utf8'))
    if (!Array.isArray(payload?.skills)) return null
    return payload
  } catch {
    return null
  }
}

function writeRecommendedSkillsCache(repoRoot = '', skills = []) {
  try {
    fs.mkdirSync(getVendorImportsRoot(), { recursive: true })
    fs.writeFileSync(
      getRecommendedSkillsCachePath(),
      JSON.stringify({
        fetchedAt: Date.now(),
        repoRoot,
        skills
      }, null, 2),
      'utf8'
    )
  } catch (error) {
    logger.warn('[CodexAppServer] Failed to write recommended skills cache', {
      error: error.message
    })
  }
}

async function listRecommendedSkills(options = {}) {
  const refresh = options?.refresh === true
  const bundledRoot = getBundledRecommendedSkillsRoot()
  const cache = readRecommendedSkillsCache()

  try {
    let repoRoot = null
    if (fs.existsSync(path.join(getRecommendedSkillsRepoRoot(), '.git')) || refresh) {
      repoRoot = ensureRecommendedSkillsRepo({ refresh })
    } else if (hasRecommendedSkillsContent(getRecommendedSkillsRepoRoot())) {
      repoRoot = getRecommendedSkillsRepoRoot()
    } else if (bundledRoot && hasRecommendedSkillsContent(bundledRoot)) {
      repoRoot = bundledRoot
    } else {
      repoRoot = ensureRecommendedSkillsRepo({ refresh: false })
    }

    const skills = loadRecommendedSkillsFromRoot(repoRoot)
    writeRecommendedSkillsCache(repoRoot, skills)
    return {
      repoRoot,
      skills
    }
  } catch (error) {
    logger.warn('[CodexAppServer] Failed to load recommended skills', {
      refresh,
      error: error.message
    })

    if (cache) {
      return {
        repoRoot: cache.repoRoot || getRecommendedSkillsRepoRoot(),
        skills: cache.skills
      }
    }

    return {
      repoRoot: bundledRoot || getRecommendedSkillsRepoRoot(),
      skills: []
    }
  }
}

async function installRecommendedSkill(skillId = '', repoPath = '') {
  const normalizedSkillId = String(skillId || '').trim()
  if (!normalizedSkillId) {
    throw new Error('缺少技能 ID')
  }

  let repoRoot = getRecommendedSkillsRepoRoot()
  let sourcePath = null
  const candidateRoots = [repoRoot, getBundledRecommendedSkillsRoot()].filter(Boolean)

  for (const root of candidateRoots) {
    try {
      const resolved = resolveRecommendedSkillPath(root, repoPath)
      if (fs.existsSync(resolved)) {
        sourcePath = resolved
        repoRoot = root
        break
      }
    } catch (_) {
      // ignore invalid candidate
    }
  }

  if (!sourcePath) {
    const refreshed = await listRecommendedSkills({ refresh: true })
    repoRoot = refreshed.repoRoot || repoRoot
    sourcePath = resolveRecommendedSkillPath(repoRoot, repoPath)
  }

  if (!sourcePath || !fs.existsSync(sourcePath)) {
    throw new Error('未找到推荐技能源文件')
  }

  const destinationRoot = path.join(os.homedir(), '.ccgui', 'skills', 'openai')
  const destinationPath = path.join(destinationRoot, normalizedSkillId)
  fs.mkdirSync(destinationRoot, { recursive: true })
  fs.rmSync(destinationPath, { recursive: true, force: true })

  const stat = fs.statSync(sourcePath)
  if (stat.isDirectory()) {
    fs.cpSync(sourcePath, destinationPath, { recursive: true })
  } else {
    fs.mkdirSync(destinationPath, { recursive: true })
    fs.copyFileSync(sourcePath, path.join(destinationPath, 'SKILL.md'))
  }

  return {
    path: destinationPath,
    repoRoot
  }
}

async function withCodexAppServer(run, options = {}) {
  const codexPath = getCodexExecutablePath()
  if (!codexPath) {
    throw new Error('Codex executable not found')
  }

  let child = null
  let rl = null
  const pending = new Map()
  let requestId = 0

  try {
    const appConfig = appConfigManager.loadConfig()
    const proxyUrl = appConfig.settings?.codexProxy || ''
    const codexEnv = {
      ...process.env
    }

    if (proxyUrl) {
      codexEnv.HTTP_PROXY = proxyUrl
      codexEnv.HTTPS_PROXY = proxyUrl
      codexEnv.ALL_PROXY = proxyUrl
    }

    child = spawn(codexPath, ['app-server', '--listen', 'stdio://'], {
      cwd: options.cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: codexEnv
    })

    const readline = require('readline')
    rl = readline.createInterface({ input: child.stdout })

    const send = (payload) => {
      child.stdin.write(JSON.stringify(payload) + '\n')
    }

    const request = (method, params) => {
      const id = String(++requestId)
      send({ id, method, params })
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        setTimeout(() => {
          if (!pending.has(id)) return
          pending.delete(id)
          reject(new Error(`Codex request timeout: ${method}`))
        }, options.timeoutMs || 15000)
      })
    }

    rl.on('line', (line) => {
      if (!line.trim()) return

      let message = null
      try {
        message = JSON.parse(line)
      } catch {
        return
      }

      if (message.id === undefined) return

      const key = String(message.id)
      const entry = pending.get(key)
      if (!entry) return
      pending.delete(key)

      if (message.error) {
        entry.reject(new Error(message.error.message || 'Codex request failed'))
      } else {
        entry.resolve(message.result)
      }
    })

    await request('initialize', {
      clientInfo: { name: options.clientName || 'ccgui', version: '1.0.0' },
      capabilities: { experimentalApi: true }
    })
    send({ method: 'initialized' })

    return await run({ request, send, child })
  } finally {
    if (rl) {
      rl.close()
    }
    if (child) {
      child.kill('SIGTERM')
    }
  }
}

function getLayerFilePath(layerName = {}) {
  if (!layerName || typeof layerName !== 'object') return null
  if (layerName.type === 'user' || layerName.type === 'system') {
    return layerName.file || null
  }
  if (layerName.type === 'project') {
    const dotCodexFolder = layerName.dotCodexFolder || ''
    return dotCodexFolder ? path.join(dotCodexFolder, 'config.toml') : null
  }
  return null
}

async function readCodexConfigSnapshot(projectPath = '') {
  return withCodexAppServer(async ({ request }) => {
    return request('config/read', {
      includeLayers: true,
      cwd: projectPath || null
    })
  }, {
    clientName: 'ccgui-codex-config',
    cwd: projectPath || process.cwd()
  })
}

async function resolveConfigWriteTarget(scope = 'user', projectPath = '') {
  const snapshot = await readCodexConfigSnapshot(projectPath)
  const layers = Array.isArray(snapshot?.layers) ? snapshot.layers : []
  const targetType = scope === 'project' ? 'project' : 'user'
  const layer = layers.find(item => item?.name?.type === targetType) || null
  if (!layer) {
    throw new Error(scope === 'project' ? '未找到项目配置层' : '未找到用户配置层')
  }

  const filePath = getLayerFilePath(layer.name)
  if (!filePath) {
    throw new Error('无法解析 Codex 配置写入目标')
  }

  return {
    filePath,
    expectedVersion: layer.version || null
  }
}

async function batchWriteConfig(scope = 'user', projectPath = '', edits = []) {
  const target = await resolveConfigWriteTarget(scope, projectPath)
  return withCodexAppServer(async ({ request }) => {
    return request('config/batchWrite', {
      edits,
      filePath: target.filePath,
      expectedVersion: target.expectedVersion
    })
  }, {
    clientName: 'ccgui-codex-config-write',
    cwd: projectPath || process.cwd()
  })
}

function mergePluginSummaries(primary = {}, secondary = {}) {
  return {
    ...primary,
    ...secondary,
    interface: {
      ...(primary?.interface || {}),
      ...(secondary?.interface || {})
    }
  }
}

function mergePluginMarketplaces(results = []) {
  const marketplaceMap = new Map()
  const featuredPluginIds = new Set()

  for (const result of results) {
    const ids = Array.isArray(result?.featuredPluginIds) ? result.featuredPluginIds : []
    ids.forEach((id) => {
      if (id) featuredPluginIds.add(id)
    })

    const marketplaces = Array.isArray(result?.marketplaces) ? result.marketplaces : []
    for (const rawMarketplace of marketplaces) {
      const marketplace = rawMarketplace && typeof rawMarketplace === 'object' ? rawMarketplace : {}
      const marketplaceKey = marketplace.path || marketplace.name || `marketplace:${marketplaceMap.size}`
      const existingMarketplace = marketplaceMap.get(marketplaceKey)

      if (!existingMarketplace) {
        marketplaceMap.set(marketplaceKey, {
          ...marketplace,
          interface: { ...(marketplace.interface || {}) },
          plugins: []
        })
      } else {
        Object.assign(existingMarketplace, {
          ...existingMarketplace,
          ...marketplace,
          interface: {
            ...(existingMarketplace.interface || {}),
            ...(marketplace.interface || {})
          }
        })
      }

      const targetMarketplace = marketplaceMap.get(marketplaceKey)
      const pluginMap = new Map(
        (Array.isArray(targetMarketplace.plugins) ? targetMarketplace.plugins : [])
          .map((plugin) => {
            const key = plugin?.id || plugin?.name || ''
            return key ? [key, plugin] : null
          })
          .filter(Boolean)
      )

      const plugins = Array.isArray(marketplace.plugins) ? marketplace.plugins : []
      for (const plugin of plugins) {
        const pluginKey = plugin?.id || plugin?.name || ''
        if (!pluginKey) continue
        const existingPlugin = pluginMap.get(pluginKey)
        pluginMap.set(
          pluginKey,
          existingPlugin
            ? mergePluginSummaries(existingPlugin, plugin)
            : plugin
        )
      }

      targetMarketplace.plugins = Array.from(pluginMap.values())
    }
  }

  return {
    featuredPluginIds: Array.from(featuredPluginIds),
    marketplaces: Array.from(marketplaceMap.values())
  }
}

async function listPluginsWithDetails(projectPath = '') {
  return withCodexAppServer(async ({ request }) => {
    const responses = [await request('plugin/list', {})]

    if (projectPath) {
      responses.push(await request('plugin/list', {
        cwds: [projectPath]
      }))
    }

    const mergedResult = mergePluginMarketplaces(responses)
    const marketplaces = Array.isArray(mergedResult?.marketplaces) ? mergedResult.marketplaces : []
    const detailEntries = await Promise.all(
      marketplaces.flatMap((marketplace) => {
        const marketplacePath = marketplace?.path || ''
        const plugins = Array.isArray(marketplace?.plugins) ? marketplace.plugins : []
        return plugins.map(async (plugin) => {
          try {
            const detail = await request('plugin/read', {
              marketplacePath,
              pluginName: plugin?.name || ''
            })
            return [`${marketplacePath}::${plugin?.name || ''}`, detail?.plugin || null]
          } catch (error) {
            logger.warn('[CodexAppServer] Failed to read plugin detail', {
              marketplacePath,
              pluginName: plugin?.name || '',
              error: error.message
            })
            return [`${marketplacePath}::${plugin?.name || ''}`, null]
          }
        })
      })
    )

    return {
      featuredPluginIds: mergedResult.featuredPluginIds || [],
      marketplaces,
      detailMap: Object.fromEntries(detailEntries)
    }
  }, {
    clientName: 'ccgui-codex-plugins',
    cwd: projectPath || process.cwd(),
    timeoutMs: 30000
  })
}

async function listSkills(projectPath = '', options = {}) {
  return withCodexAppServer(async ({ request }) => {
    const params = {
      ...(projectPath ? { cwds: [projectPath] } : {}),
      ...(options?.forceReload === true ? { forceReload: true } : {})
    }

    return request('skills/list', params)
  }, {
    clientName: 'ccgui-codex-skills',
    cwd: projectPath || process.cwd(),
    timeoutMs: 30000
  })
}

async function listApps(projectPath = '') {
  return withCodexAppServer(async ({ request }) => {
    return request('app/list', projectPath ? { cwds: [projectPath] } : {})
  }, {
    clientName: 'ccgui-codex-apps',
    cwd: projectPath || process.cwd(),
    timeoutMs: 30000
  })
}

async function readPluginDetail(projectPath = '', marketplacePath = '', pluginName = '') {
  return withCodexAppServer(async ({ request }) => {
    return request('plugin/read', {
      marketplacePath,
      pluginName
    })
  }, {
    clientName: 'ccgui-codex-plugin-detail',
    cwd: projectPath || process.cwd()
  })
}

async function installPlugin(scope = 'user', projectPath = '', plugin = {}) {
  if (scope === 'project') {
    const pluginId = plugin.pluginId || ''
    if (!pluginId) {
      throw new Error('缺少插件 ID')
    }
    return batchWriteConfig('project', projectPath, [{
      keyPath: `plugins.${pluginId}.enabled`,
      value: true,
      mergeStrategy: 'upsert'
    }])
  }

  return withCodexAppServer(async ({ request }) => {
    return request('plugin/install', {
      marketplacePath: plugin.marketplacePath || '',
      pluginName: plugin.pluginName || ''
    })
  }, {
    clientName: 'ccgui-codex-plugin-install',
    cwd: projectPath || process.cwd(),
    timeoutMs: 30000
  })
}

async function uninstallPlugin(scope = 'user', projectPath = '', plugin = {}) {
  if (scope === 'project') {
    const pluginId = plugin.pluginId || ''
    if (!pluginId) {
      throw new Error('缺少插件 ID')
    }
    return batchWriteConfig('project', projectPath, [{
      keyPath: `plugins.${pluginId}`,
      value: null,
      mergeStrategy: 'replace'
    }])
  }

  return withCodexAppServer(async ({ request }) => {
    return request('plugin/uninstall', {
      pluginId: plugin.pluginId || ''
    })
  }, {
    clientName: 'ccgui-codex-plugin-uninstall',
    cwd: projectPath || process.cwd(),
    timeoutMs: 30000
  })
}

async function setPluginEnabled(scope = 'user', projectPath = '', pluginId = '', enabled = true) {
  if (!pluginId) {
    throw new Error('缺少插件 ID')
  }

  return batchWriteConfig(scope, projectPath, [{
    keyPath: `plugins.${pluginId}.enabled`,
    value: enabled,
    mergeStrategy: 'upsert'
  }])
}

module.exports = {
  withCodexAppServer,
  readCodexConfigSnapshot,
  listPluginsWithDetails,
  listSkills,
  listApps,
  listRecommendedSkills,
  readPluginDetail,
  installPlugin,
  installRecommendedSkill,
  uninstallPlugin,
  setPluginEnabled
}
