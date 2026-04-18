const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const yaml = require('js-yaml')
const appService = require('./app-service')

function fileExists(targetPath) {
  if (!targetPath) return false
  try {
    return fs.existsSync(targetPath)
  } catch {
    return false
  }
}

function safeReadJson(targetPath, fallback = null) {
  try {
    if (!fileExists(targetPath)) return fallback
    return JSON.parse(fs.readFileSync(targetPath, 'utf-8'))
  } catch {
    return fallback
  }
}

function safeStat(targetPath) {
  try {
    return fs.statSync(targetPath)
  } catch {
    return null
  }
}

function listDir(targetPath) {
  try {
    return fs.readdirSync(targetPath, { withFileTypes: true })
  } catch {
    return []
  }
}

function uniqueBy(items = [], getKey = item => item?.id) {
  const seen = new Set()
  const result = []

  for (const item of items) {
    const key = getKey(item)
    if (!key || seen.has(key)) continue
    seen.add(key)
    result.push(item)
  }

  return result
}

function safeExecJson(command, args = []) {
  try {
    const output = execFileSync(command, args, {
      encoding: 'utf-8',
      timeout: 15000,
      maxBuffer: 10 * 1024 * 1024
    })
    return JSON.parse(output)
  } catch {
    return null
  }
}

function createHookSource(source = {}) {
  const sourcePath = source.sourcePath || ''
  const hooks = Array.isArray(source.hooks) ? source.hooks : []
  return {
    id: source.id || [source.provider || 'provider', source.scope || 'scope', source.sourceLabel || sourcePath || 'source'].join(':'),
    provider: source.provider || 'claude',
    scope: source.scope || 'user',
    sourceLabel: source.sourceLabel || source.scope || '配置',
    sourcePath,
    exists: sourcePath ? fileExists(sourcePath) : false,
    fileType: source.fileType || '',
    parsed: source.parsed !== false,
    hookCount: hooks.length,
    hasHooksField: source.hasHooksField !== false,
    featureEnabled: source.featureEnabled !== undefined ? Boolean(source.featureEnabled) : null,
    note: source.note || '',
    hooks
  }
}

function countSkillsInDir(dirPath) {
  if (!fileExists(dirPath)) return 0
  const entries = listDir(dirPath)
  let count = 0

  for (const entry of entries) {
    const nextPath = path.join(dirPath, entry.name)
    if (entry.isDirectory()) {
      if (fileExists(path.join(nextPath, 'SKILL.md'))) {
        count += 1
      }
      continue
    }
    if (entry.isFile() && entry.name === 'SKILL.md') {
      count += 1
    }
  }

  return count
}

function countChildren(targetPath) {
  const stat = safeStat(targetPath)
  if (!stat) return 0
  if (stat.isFile()) return 1
  return listDir(targetPath).length
}

function readMarkdownMeta(filePath = '', fallbackName = '') {
  let name = fallbackName
  let description = ''

  try {
    if (!fileExists(filePath)) return { name, description }
    const content = fs.readFileSync(filePath, 'utf-8')
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
    if (fmMatch) {
      const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m)
      if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, '')
      const descMatch = fmMatch[1].match(/^(?:description|summary):\s*(.+)$/m)
      if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, '')
    }

    if (!description) {
      const lines = content
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(Boolean)
        .filter(line => line !== '---')
      const summaryLine = lines.find(line => !line.startsWith('#'))
      if (summaryLine) description = summaryLine
    }
  } catch {}

  return { name, description }
}

function readMarkdownContent(filePath = '') {
  try {
    if (!fileExists(filePath)) return ''
    return fs.readFileSync(filePath, 'utf-8').replace(/^---\n[\s\S]*?\n---\n?/, '')
  } catch {
    return ''
  }
}

function readMarkdownDocument(filePath = '', fallbackName = '') {
  const fallback = {
    name: fallbackName,
    description: '',
    frontmatter: {},
    body: ''
  }

  try {
    if (!fileExists(filePath)) return fallback
    const raw = fs.readFileSync(filePath, 'utf-8')
    const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
    if (!match) {
      return {
        ...fallback,
        body: raw
      }
    }

    const frontmatter = yaml.load(match[1]) || {}
    return {
      name: frontmatter.name || fallbackName,
      description: frontmatter.description || frontmatter.summary || '',
      frontmatter,
      body: match[2] || ''
    }
  } catch {
    return fallback
  }
}

function normalizeAgentTools(tools) {
  if (Array.isArray(tools)) return tools.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
  if (typeof tools === 'string' && tools.trim()) {
    return tools.split(',').map(item => item.trim()).filter(Boolean)
  }
  return []
}

function normalizeAgentSkills(skills) {
  if (Array.isArray(skills)) return skills.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim())
  if (typeof skills === 'string' && skills.trim()) {
    return skills.split(',').map(item => item.trim()).filter(Boolean)
  }
  return []
}

function scanClaudeScopedAgents(projectPath = '') {
  const sources = [
    {
      scope: 'user',
      rootDir: path.join(os.homedir(), '.claude', 'agents'),
      sourceLabel: '用户'
    },
    ...(projectPath ? [{
      scope: 'project',
      rootDir: path.join(projectPath, '.claude', 'agents'),
      sourceLabel: '项目'
    }] : [])
  ]
  const items = []

  for (const source of sources) {
    if (!fileExists(source.rootDir)) continue
    for (const entry of listDir(source.rootDir)) {
      if (!entry.isFile() || !/\.(md|markdown)$/i.test(entry.name)) continue
      const filePath = path.join(source.rootDir, entry.name)
      const slug = entry.name.replace(/\.(md|markdown)$/i, '')
      const doc = readMarkdownDocument(filePath, slug)
      items.push({
        id: ['claude', source.scope, slug, filePath].join(':'),
        provider: 'claude',
        scope: source.scope,
        source: source.scope,
        sourceLabel: source.sourceLabel,
        name: slug,
        title: doc.name || slug,
        description: doc.description || '',
        path: filePath,
        content: doc.body || '',
        model: typeof doc.frontmatter.model === 'string' ? doc.frontmatter.model : '',
        tools: normalizeAgentTools(doc.frontmatter.tools),
        permissionMode: typeof doc.frontmatter.permissionMode === 'string' ? doc.frontmatter.permissionMode : '',
        skills: normalizeAgentSkills(doc.frontmatter.skills),
        editable: true,
        plugin: false
      })
    }
  }

  return uniqueBy(items, item => item.id)
}

function inferHookType(handler = {}) {
  if (typeof handler.command === 'string' && handler.command.trim()) return 'command'
  if (typeof handler.url === 'string' && handler.url.trim()) return 'http'
  if (typeof handler.prompt === 'string' && handler.prompt.trim()) return 'prompt'
  if (typeof handler.agent === 'string' && handler.agent.trim()) return 'agent'
  if (typeof handler.type === 'string' && handler.type.trim()) return handler.type.trim()
  return 'unknown'
}

function summarizeHook(handler = {}) {
  const type = inferHookType(handler)
  if (type === 'command') return handler.command || ''
  if (type === 'http') return handler.url || ''
  if (type === 'prompt') return handler.prompt || ''
  if (type === 'agent') return handler.agent || ''
  return ''
}

function flattenHooks(hooksConfig = {}, source = {}) {
  const hooks = hooksConfig && typeof hooksConfig === 'object' && !Array.isArray(hooksConfig)
    ? hooksConfig
    : {}
  const result = []

  for (const [eventName, rawEntries] of Object.entries(hooks)) {
    const entries = Array.isArray(rawEntries) ? rawEntries : [rawEntries]
    for (let groupIndex = 0; groupIndex < entries.length; groupIndex += 1) {
      const rawEntry = entries[groupIndex]
      const entry = rawEntry && typeof rawEntry === 'object'
        ? rawEntry
        : { command: String(rawEntry || '') }

      const groupedHooks = Array.isArray(entry.hooks) && entry.hooks.length > 0
        ? entry.hooks
        : [entry]

      for (let hookIndex = 0; hookIndex < groupedHooks.length; hookIndex += 1) {
        const rawHook = groupedHooks[hookIndex]
        const handler = rawHook && typeof rawHook === 'object'
          ? rawHook
          : { command: String(rawHook || '') }

        result.push({
          id: [
            source.provider || 'provider',
            source.scope || 'scope',
            source.pluginName || 'config',
            source.sourcePath || 'source',
            eventName,
            groupIndex,
            hookIndex
          ].join(':'),
          provider: source.provider || 'claude',
          eventName,
          scope: source.scope || 'user',
          sourcePath: source.sourcePath || '',
          sourceLabel: source.sourceLabel || source.scope || '',
          pluginName: source.pluginName || '',
          pluginId: source.pluginId || '',
          pluginScope: source.pluginScope || '',
          pluginEnabled: source.pluginEnabled !== false,
          hooksDisabled: source.hooksDisabled === true,
          type: inferHookType(handler),
          summary: summarizeHook(handler),
          matcher: entry.matcher || entry.matchers || handler.matcher || handler.matchers || null,
          timeout: Number(handler.timeout || entry.timeout || 0) || null,
          async: handler.async === true,
          groupIndex,
          hookIndex,
          raw: handler,
          rawGroup: entry
        })
      }
    }
  }

  return result
}

function scanHookFiles(rootDir, source = {}) {
  if (!fileExists(rootDir)) return []
  const candidates = [
    path.join(rootDir, 'hooks.json'),
    path.join(rootDir, 'hooks', 'hooks.json')
  ]
  const hookFiles = candidates.filter(fileExists)
  const result = []

  for (const filePath of hookFiles) {
    const parsed = safeReadJson(filePath, null)
    const hooks = parsed?.hooks && typeof parsed.hooks === 'object' ? parsed.hooks : parsed
    result.push(...flattenHooks(hooks, {
      ...source,
      sourcePath: filePath
    }))
  }

  return result
}

function detectPluginCountsFromDir(rootDir, manifest = {}) {
  const counts = {
    skills: 0,
    apps: 0,
    mcp: 0,
    hooks: 0,
    agents: 0,
    lsp: 0,
    monitors: 0
  }

  if (!rootDir || !fileExists(rootDir)) {
    return counts
  }

  if (typeof manifest.skills === 'string') {
    counts.skills = countSkillsInDir(path.resolve(rootDir, manifest.skills))
  } else if (fileExists(path.join(rootDir, 'skills'))) {
    counts.skills = countSkillsInDir(path.join(rootDir, 'skills'))
  }

  if (typeof manifest.apps === 'string') {
    counts.apps = countChildren(path.resolve(rootDir, manifest.apps))
  } else if (fileExists(path.join(rootDir, 'apps'))) {
    counts.apps = countChildren(path.join(rootDir, 'apps'))
  }

  if (manifest?.mcpServers && typeof manifest.mcpServers === 'object' && !Array.isArray(manifest.mcpServers)) {
    counts.mcp = Object.keys(manifest.mcpServers).length
  } else if (typeof manifest?.mcpServers === 'string') {
    const configPath = path.join(rootDir, manifest.mcpServers)
    const config = safeReadJson(configPath, {})
    if (config?.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)) {
      counts.mcp = Object.keys(config.mcpServers).length
    }
  } else if (fileExists(path.join(rootDir, 'mcp'))) {
    counts.mcp = countChildren(path.join(rootDir, 'mcp'))
  } else if (fileExists(path.join(rootDir, 'mcpServers'))) {
    counts.mcp = countChildren(path.join(rootDir, 'mcpServers'))
  }

  if (fileExists(path.join(rootDir, 'agents'))) {
    counts.agents = countChildren(path.join(rootDir, 'agents'))
  }
  if (fileExists(path.join(rootDir, 'lsp'))) {
    counts.lsp = countChildren(path.join(rootDir, 'lsp'))
  }
  if (fileExists(path.join(rootDir, 'monitors'))) {
    counts.monitors = countChildren(path.join(rootDir, 'monitors'))
  }

  counts.hooks = scanHookFiles(rootDir).length

  return counts
}

function normalizeRequestedContents(contents = []) {
  return Array.isArray(contents)
    ? contents.filter(Boolean)
    : []
}

function hasRequestedContent(contents = [], key = '') {
  return Array.isArray(contents) && contents.includes(key)
}

function parseTomlStringArray(rawContent = '', key = '') {
  if (!rawContent || !key) return []
  const matcher = new RegExp(`${key}\\s*=\\s*\\[([\\s\\S]*?)\\]`, 'm')
  const match = rawContent.match(matcher)
  if (!match) return []

  return match[1]
    .split(',')
    .map(item => item.trim())
    .map(item => item.replace(/^['"]|['"]$/g, ''))
    .filter(Boolean)
}

function parseCodexFeatureFlag(rawContent = '', featureName = '') {
  if (!rawContent || !featureName) return false
  const featurePattern = new RegExp(`\\[features\\][\\s\\S]*?\\b${featureName}\\s*=\\s*true`, 'm')
  const topLevelPattern = new RegExp(`\\b${featureName}\\s*=\\s*true`, 'm')
  return featurePattern.test(rawContent) || topLevelPattern.test(rawContent)
}

function normalizeClaudePluginManifestPath(pluginPath = '') {
  if (!pluginPath) return ''

  const candidates = [
    path.join(pluginPath, '.claude-plugin', 'plugin.json'),
    path.join(pluginPath, 'plugin.json')
  ]

  return candidates.find(fileExists) || candidates[0]
}

function readClaudeCliPluginState() {
  const installedPayload = safeExecJson('claude', ['plugin', 'list', '--json'])
  const availablePayload = safeExecJson('claude', ['plugin', 'list', '--available', '--json'])
  const marketplacesPayload = safeExecJson('claude', ['plugin', 'marketplace', 'list', '--json'])

  return {
    installed: Array.isArray(installedPayload)
      ? installedPayload
      : Array.isArray(installedPayload?.installed)
        ? installedPayload.installed
        : Array.isArray(availablePayload?.installed)
          ? availablePayload.installed
          : [],
    available: Array.isArray(availablePayload?.available) ? availablePayload.available : [],
    marketplaces: Array.isArray(marketplacesPayload) ? marketplacesPayload : []
  }
}

function discoverClaudePlugins(projectPath = '', cliInstalledPlugins = [], options = {}) {
  const requestedContents = normalizeRequestedContents(options.contents)
  const includeCounts = options.includeCounts === true
  const includeDetails = options.includeDetails === true
  const includeHooks = includeCounts || includeDetails || hasRequestedContent(requestedContents, 'hooks')
  const discovered = []

  for (const rawPlugin of cliInstalledPlugins) {
    const plugin = rawPlugin && typeof rawPlugin === 'object' ? rawPlugin : {}
    const pluginId = plugin.id || plugin.pluginId || ''
    const pluginPath = plugin.installPath || plugin.path || plugin.pluginPath || plugin.root || ''
    const manifestPath = normalizeClaudePluginManifestPath(pluginPath)
    const manifest = safeReadJson(manifestPath, {})
    const marketplaceName = pluginId.includes('@') ? pluginId.split('@').slice(1).join('@') : ''
    const pluginName = pluginId.includes('@') ? pluginId.split('@')[0] : (plugin.name || manifest.name || pluginId)
    discovered.push({
      id: pluginId,
      name: pluginName,
      displayName: plugin.displayName || manifest.displayName || pluginName || pluginId,
      description: plugin.description || manifest.description || '',
      version: plugin.version || manifest.version || '',
      scope: plugin.scope || 'user',
      enabled: plugin.enabled !== false && plugin.disabled !== true,
      managedByCli: true,
      sourcePath: pluginPath,
      manifestPath,
      marketplaceName,
      installedAt: plugin.installedAt || '',
      lastUpdated: plugin.lastUpdated || '',
      counts: includeCounts ? detectPluginCountsFromDir(pluginPath, manifest) : null,
      details: includeDetails ? buildPluginDetails({
        provider: 'claude',
        id: pluginId,
        name: pluginName,
        displayName: plugin.displayName || manifest.displayName || pluginName || pluginId,
        enabled: plugin.enabled !== false && plugin.disabled !== true,
        scope: plugin.scope || 'user',
        sourcePath: pluginPath,
        manifestPath
      }) : null,
      hookEntries: includeHooks
        ? scanHookFiles(pluginPath, {
            provider: 'claude',
            scope: 'plugin',
            pluginScope: plugin.scope || 'user',
            pluginEnabled: plugin.enabled !== false && plugin.disabled !== true,
            pluginName: pluginName || pluginId,
            pluginId,
            sourceLabel: `插件 · ${pluginName || pluginId}`
          })
        : []
    })
  }

  const projectPluginRoot = projectPath ? path.join(projectPath, '.claude', 'plugins') : ''
  const scannedRoots = [projectPluginRoot]
    .filter(Boolean)
    .filter(fileExists)

  for (const rootDir of scannedRoots) {
    for (const entry of listDir(rootDir)) {
      if (!entry.isDirectory()) continue
      const pluginPath = path.join(rootDir, entry.name)
      const manifestPath = normalizeClaudePluginManifestPath(pluginPath)
      const manifest = safeReadJson(manifestPath, {})
      discovered.push({
        id: `project:${entry.name}`,
        name: manifest.name || entry.name,
        displayName: manifest.displayName || manifest.name || entry.name,
        description: manifest.description || '',
        version: manifest.version || '',
        scope: 'project',
        enabled: true,
        managedByCli: false,
        sourcePath: pluginPath,
        manifestPath,
        marketplaceName: '',
        counts: includeCounts ? detectPluginCountsFromDir(pluginPath, manifest) : null,
        details: includeDetails ? buildPluginDetails({
          provider: 'claude',
          id: `project:${entry.name}`,
          name: manifest.name || entry.name,
          displayName: manifest.displayName || manifest.name || entry.name,
          enabled: true,
          scope: 'project',
          sourcePath: pluginPath,
          manifestPath
        }) : null,
        hookEntries: includeHooks
          ? scanHookFiles(pluginPath, {
              provider: 'claude',
              scope: 'plugin',
              pluginScope: 'project',
              pluginEnabled: true,
              pluginName: manifest.name || entry.name,
              pluginId: `project:${entry.name}`,
              sourceLabel: `插件 · ${manifest.name || entry.name}`
            })
          : []
      })
    }
  }

  return uniqueBy(discovered, plugin => plugin.id || `${plugin.scope}:${plugin.sourcePath}`)
}

function discoverClaudeMarketplaces(cliMarketplaces = [], cliAvailablePlugins = [], installedPlugins = []) {
  const installedById = new Map(
    installedPlugins
      .filter(plugin => plugin?.id)
      .map(plugin => [plugin.id, plugin])
  )
  const availableByMarketplace = new Map()

  for (const rawPlugin of cliAvailablePlugins) {
    const plugin = rawPlugin && typeof rawPlugin === 'object' ? rawPlugin : {}
    const marketplaceName = plugin.marketplaceName || (plugin.pluginId?.includes('@') ? plugin.pluginId.split('@').slice(1).join('@') : '')
    if (!marketplaceName) continue

    if (!availableByMarketplace.has(marketplaceName)) {
      availableByMarketplace.set(marketplaceName, [])
    }

    const installed = installedById.get(plugin.pluginId || '')
    availableByMarketplace.get(marketplaceName).push({
      id: plugin.pluginId || `${plugin.name || 'plugin'}@${marketplaceName}`,
      name: plugin.name || '',
      displayName: plugin.displayName || plugin.name || '',
      description: plugin.description || '',
      version: plugin.version || '',
      source: plugin.source || null,
      strict: plugin.strict === true,
      installed: Boolean(installed),
      installedPluginId: installed?.id || '',
      installedScope: installed?.scope || '',
      enabled: Boolean(installed) && installed?.enabled !== false && installed?.disabled !== true
    })
  }

  return cliMarketplaces.map(rawMarketplace => {
    const marketplace = rawMarketplace && typeof rawMarketplace === 'object' ? rawMarketplace : {}
    const marketplaceName = marketplace.name || ''
    const installLocation = marketplace.installLocation || ''
    const manifest = safeReadJson(path.join(installLocation, '.claude-plugin', 'marketplace.json'), {}) || {}
    const manifestPlugins = Array.isArray(manifest.plugins) ? manifest.plugins : []
    const cliItems = availableByMarketplace.get(marketplaceName) || []
    const cliItemsById = new Map(cliItems.map(item => [item.id, item]))
    const mergedItems = manifestPlugins.map(rawPlugin => {
      const plugin = rawPlugin && typeof rawPlugin === 'object' ? rawPlugin : {}
      const pluginId = `${plugin.name || 'plugin'}@${marketplaceName}`
      const cliItem = cliItemsById.get(pluginId)
      const installed = installedById.get(pluginId)

      return {
        id: pluginId,
        name: plugin.name || '',
        displayName: plugin.displayName || plugin.name || '',
        description: cliItem?.description || plugin.description || '',
        version: cliItem?.version || plugin.version || '',
        source: cliItem?.source || plugin.source || null,
        strict: cliItem?.strict === true || plugin.strict === true,
        installed: Boolean(installed),
        installedPluginId: installed?.id || '',
        installedScope: installed?.scope || '',
        enabled: Boolean(installed) && installed?.enabled !== false && installed?.disabled !== true
      }
    })

    for (const cliItem of cliItems) {
      if (mergedItems.some(item => item.id === cliItem.id)) continue
      mergedItems.push(cliItem)
    }

    return {
      id: marketplaceName,
      name: marketplaceName,
      description: manifest.metadata?.description || '',
      version: manifest.metadata?.version || '',
      ownerName: manifest.owner?.name || '',
      sourceType: marketplace.source || marketplace.sourceType || marketplace.sourceInfo?.source || '',
      repo: marketplace.repo || marketplace.sourceInfo?.repo || '',
      url: marketplace.url || marketplace.sourceInfo?.url || '',
      installLocation,
      pluginCount: mergedItems.length,
      plugins: mergedItems
        .filter(item => item.name)
        .sort((a, b) => (a.displayName || a.name).localeCompare(b.displayName || b.name))
    }
  }).filter(marketplace => marketplace.name)
}

function inspectClaudeProvider(options = {}) {
  const projectPath = options.projectPath || ''
  const cliState = readClaudeCliPluginState()
  const home = os.homedir()
  const userSettingsPath = path.join(home, '.claude', 'settings.json')
  const projectSettingsPath = projectPath ? path.join(projectPath, '.claude', 'settings.json') : ''
  const localSettingsPath = projectPath ? path.join(projectPath, '.claude', 'settings.local.json') : ''
  const userSettings = safeReadJson(userSettingsPath, {}) || {}
  const projectSettings = safeReadJson(projectSettingsPath, {}) || {}
  const localSettings = safeReadJson(localSettingsPath, {}) || {}
  const disableAllHooks = {
    user: userSettings.disableAllHooks === true,
    project: projectSettings.disableAllHooks === true,
    local: localSettings.disableAllHooks === true
  }

  const userHooks = flattenHooks(userSettings.hooks, {
      provider: 'claude',
      scope: 'user',
      sourcePath: userSettingsPath,
      sourceLabel: '用户设置',
      hooksDisabled: disableAllHooks.user
    })
  const projectHooks = flattenHooks(projectSettings.hooks, {
      provider: 'claude',
      scope: 'project',
      sourcePath: projectSettingsPath,
      sourceLabel: '项目设置',
      hooksDisabled: disableAllHooks.project
    })
  const localHooks = flattenHooks(localSettings.hooks, {
      provider: 'claude',
      scope: 'local',
      sourcePath: localSettingsPath,
      sourceLabel: '本地设置',
      hooksDisabled: disableAllHooks.local
    })

  const hooks = [
    ...userHooks,
    ...projectHooks,
    ...localHooks
  ]
  const hookSources = [
    createHookSource({
      provider: 'claude',
      scope: 'user',
      sourceLabel: '用户设置',
      sourcePath: userSettingsPath,
      fileType: 'settings.json',
      hasHooksField: Object.prototype.hasOwnProperty.call(userSettings, 'hooks'),
      hooks: userHooks,
      featureEnabled: !disableAllHooks.user,
      note: fileExists(userSettingsPath) ? '' : '未发现配置文件'
    }),
    createHookSource({
      provider: 'claude',
      scope: 'project',
      sourceLabel: '项目设置',
      sourcePath: projectSettingsPath,
      fileType: 'settings.json',
      hasHooksField: Object.prototype.hasOwnProperty.call(projectSettings, 'hooks'),
      hooks: projectHooks,
      featureEnabled: !disableAllHooks.project,
      note: projectSettingsPath && !fileExists(projectSettingsPath) ? '未发现项目配置文件' : ''
    }),
    createHookSource({
      provider: 'claude',
      scope: 'local',
      sourceLabel: '本地设置',
      sourcePath: localSettingsPath,
      fileType: 'settings.local.json',
      hasHooksField: Object.prototype.hasOwnProperty.call(localSettings, 'hooks'),
      hooks: localHooks,
      featureEnabled: !disableAllHooks.local,
      note: localSettingsPath && !fileExists(localSettingsPath) ? '未发现本地配置文件' : ''
    })
  ]

  const pluginCollection = collectPlugins({
    provider: 'claude',
    projectPath,
    contents: ['hooks']
  })
  const plugins = discoverClaudePlugins(projectPath, cliState.installed, {
    includeCounts: true,
    includeDetails: true
  }).map(plugin => ({
    ...plugin,
    provider: 'claude'
  }))
  for (const hook of pluginCollection.hooks) {
    const pluginScope = hook.pluginScope === 'project'
      ? 'project'
      : hook.pluginScope === 'local'
        ? 'local'
        : 'user'
    hook.hooksDisabled = disableAllHooks[pluginScope] === true
    hooks.push(hook)
  }
  for (const plugin of plugins) {
    hookSources.push(createHookSource({
      provider: 'claude',
      scope: 'plugin',
      sourceLabel: `插件 · ${plugin.displayName || plugin.name || plugin.id}`,
      sourcePath: plugin.sourcePath,
      fileType: 'plugin',
      hasHooksField: pluginCollection.hooks.some(hook => hook.pluginId === plugin.id || hook.pluginName === (plugin.displayName || plugin.name || plugin.id)),
      hooks: pluginCollection.hooks.filter(hook => hook.pluginId === plugin.id || hook.pluginName === (plugin.displayName || plugin.name || plugin.id)),
      note: pluginCollection.hooks.some(hook => hook.pluginId === plugin.id || hook.pluginName === (plugin.displayName || plugin.name || plugin.id))
        ? ''
        : '未在插件目录中发现 Hook 配置'
    }))
  }
  const marketplaces = discoverClaudeMarketplaces(cliState.marketplaces, cliState.available, plugins)
  const subagents = scanClaudeScopedAgents(projectPath)

  return {
    provider: 'claude',
    projectPath,
    configPaths: {
      user: userSettingsPath,
      project: projectSettingsPath,
      local: localSettingsPath
    },
    hookFeatureEnabled: true,
    disableAllHooks,
    hooks: uniqueBy(hooks, hook => hook.id),
    subagents,
    hookSources: uniqueBy(hookSources, source => source.id),
    plugins: plugins.map(plugin => ({
      ...plugin,
      hookEntries: undefined
    })),
    marketplaces,
    pluginSettings: {
      pluginTrustMessage: userSettings.pluginTrustMessage || '',
      strictKnownMarketplaces: Array.isArray(userSettings.strictKnownMarketplaces)
        ? userSettings.strictKnownMarketplaces
        : []
    }
  }
}

function discoverCodexPlugins(projectPath = '', rawConfig = '', options = {}) {
  const includeCounts = options.includeCounts === true
  const includeDetails = options.includeDetails === true
  const enabledPlugins = new Set(parseTomlStringArray(rawConfig, 'enabled_plugins'))
  const roots = [
    { root: path.join(os.homedir(), '.codex', 'plugins'), scope: 'user' },
    { root: path.join(os.homedir(), '.codex', '.tmp', 'plugins', 'plugins'), scope: 'catalog' },
    ...(projectPath ? [{ root: path.join(projectPath, '.codex', 'plugins'), scope: 'project' }] : [])
  ]
  const discovered = []

  for (const { root, scope } of roots) {
    if (!fileExists(root)) continue
    for (const entry of listDir(root)) {
      if (!entry.isDirectory()) continue
      const pluginPath = path.join(root, entry.name)
      const manifestPath = path.join(pluginPath, '.codex-plugin', 'plugin.json')
      const manifest = safeReadJson(manifestPath, null)
      if (!manifest || typeof manifest !== 'object') continue

      const counts = detectPluginCountsFromDir(pluginPath, manifest)
      discovered.push({
        id: `${scope}:${manifest.name || entry.name}`,
        name: manifest.name || entry.name,
        displayName: manifest.interface?.displayName || manifest.name || entry.name,
        description: manifest.description || manifest.interface?.shortDescription || '',
        version: manifest.version || '',
        scope,
        enabled: enabledPlugins.has(manifest.name || entry.name),
        sourcePath: pluginPath,
        manifestPath,
        repository: manifest.repository || '',
        homepage: manifest.homepage || manifest.interface?.websiteURL || '',
        developerName: manifest.interface?.developerName || manifest.author?.name || '',
        counts: includeCounts ? counts : null,
        details: includeDetails ? buildPluginDetails({
          provider: 'codex',
          id: `${scope}:${manifest.name || entry.name}`,
          name: manifest.name || entry.name,
          displayName: manifest.interface?.displayName || manifest.name || entry.name,
          enabled: enabledPlugins.has(manifest.name || entry.name),
          scope,
          sourcePath: pluginPath,
          manifestPath
        }) : null
      })
    }
  }

  return uniqueBy(discovered, plugin => plugin.id || plugin.manifestPath)
}

function readPluginManifest(plugin = {}) {
  if (!plugin?.manifestPath) return {}
  return safeReadJson(plugin.manifestPath, {}) || {}
}

function extractPluginSkills(plugin = {}) {
  const skillsDir = path.join(plugin.sourcePath || '', 'skills')
  if (!plugin.sourcePath || !fileExists(skillsDir)) return []
  const items = []

  for (const entry of listDir(skillsDir)) {
    if (!entry.isDirectory()) continue
    const skillPath = path.join(skillsDir, entry.name)
    const skillFile = path.join(skillPath, 'SKILL.md')
    if (!fileExists(skillFile)) continue

    let name = entry.name
    let description = ''
    try {
      const content = fs.readFileSync(skillFile, 'utf-8')
      const fmMatch = content.match(/^---\n([\s\S]*?)\n---/)
      if (fmMatch) {
        const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m)
        if (nameMatch) name = nameMatch[1].trim().replace(/^["']|["']$/g, '')
        const descMatch = fmMatch[1].match(/^(?:description|summary):\s*(.+)$/m)
        if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, '')
      }
    } catch {}

    items.push({
      id: `${plugin.provider || 'provider'}:${plugin.id || plugin.name}:${entry.name}`,
      name,
      slug: entry.name,
      source: 'plugin',
      sourceLabel: `${plugin.provider === 'codex' ? 'Codex' : 'Claude'} 插件 · ${plugin.displayName || plugin.name || plugin.id}`,
      pluginName: plugin.displayName || plugin.name || plugin.id,
      pluginId: plugin.id || '',
      provider: plugin.provider || 'claude',
      path: skillPath,
      description,
      installedTargets: [plugin.provider || 'claude'],
      external: true,
      plugin: true,
      pluginEnabled: plugin.enabled !== false,
      pluginScope: plugin.scope || ''
    })
  }

  return items
}

function buildMcpDescription(config = {}) {
  if (!config || typeof config !== 'object') return ''
  if (config.type === 'streamable-http' || config.url) return `远程服务: ${config.url || ''}`
  if (config.command) return `${config.command} ${Array.isArray(config.args) ? config.args.join(' ') : ''}`.trim()
  return ''
}

function getMcpTransport(config = {}) {
  if (!config || typeof config !== 'object') return ''
  if (typeof config.type === 'string' && config.type.trim()) return config.type.trim()
  if (config.url) return 'http'
  if (config.command) return 'stdio'
  return ''
}

function resolvePluginMcpServers(plugin = {}) {
  const manifest = readPluginManifest(plugin)
  if (manifest?.mcpServers && typeof manifest.mcpServers === 'object' && !Array.isArray(manifest.mcpServers)) {
    return manifest.mcpServers
  }
  if (typeof manifest?.mcpServers === 'string') {
    const configPath = path.join(plugin.sourcePath || '', manifest.mcpServers)
    const config = safeReadJson(configPath, {})
    if (config?.mcpServers && typeof config.mcpServers === 'object' && !Array.isArray(config.mcpServers)) {
      return config.mcpServers
    }
  }
  return {}
}

function extractPluginMcps(plugin = {}) {
  const mcpServers = resolvePluginMcpServers(plugin)
  const items = []

  for (const [serverName, config] of Object.entries(mcpServers)) {
    items.push({
      id: `${plugin.provider || 'provider'}:${plugin.id || plugin.name}:mcp:${serverName}`,
      name: serverName,
      slug: serverName,
      title: serverName,
      description: buildMcpDescription(config) || plugin.description || '',
      transport: getMcpTransport(config),
      version: plugin.version || '',
      source: 'plugin',
      sourceLabel: `${plugin.provider === 'codex' ? 'Codex' : 'Claude'} 插件 · ${plugin.displayName || plugin.name || plugin.id}`,
      pluginName: plugin.displayName || plugin.name || plugin.id,
      pluginId: plugin.id || '',
      provider: plugin.provider || 'claude',
      external: true,
      plugin: true,
      installedTargets: [plugin.provider || 'claude'],
      pluginEnabled: plugin.enabled !== false,
      pluginScope: plugin.scope || ''
    })
  }

  return items
}

function extractPluginAgents(plugin = {}) {
  const manifest = readPluginManifest(plugin)
  const items = []
  const pluginName = plugin.displayName || plugin.name || plugin.id || ''
  const provider = plugin.provider || 'claude'
  const baseFields = {
    source: 'plugin',
    sourceLabel: `${provider === 'codex' ? 'Codex' : 'Claude'} 插件 · ${pluginName}`,
    pluginName,
    pluginId: plugin.id || '',
    provider,
    external: true,
    plugin: true,
    pluginEnabled: plugin.enabled !== false,
    pluginScope: plugin.scope || ''
  }

  if (manifest?.agents && typeof manifest.agents === 'object' && !Array.isArray(manifest.agents)) {
    for (const [agentName, rawAgent] of Object.entries(manifest.agents)) {
      const agent = rawAgent && typeof rawAgent === 'object' ? rawAgent : {}
      items.push({
        id: `${provider}:${plugin.id || plugin.name}:agent:${agentName}`,
        name: agentName,
        title: agent.displayName || agentName,
        description: agent.description || agent.prompt || '',
        path: '',
        content: '',
        model: typeof agent.model === 'string' ? agent.model : '',
        tools: normalizeAgentTools(agent.tools),
        permissionMode: typeof agent.permissionMode === 'string' ? agent.permissionMode : '',
        skills: normalizeAgentSkills(agent.skills),
        ...baseFields
      })
    }
  }

  if (Array.isArray(manifest?.agents)) {
    for (const rawEntry of manifest.agents) {
      if (typeof rawEntry !== 'string' || !rawEntry.trim()) continue
      const resolvedPath = path.join(plugin.sourcePath || '', rawEntry)
      const agentKey = path.basename(rawEntry).replace(/\.(md|markdown)$/i, '')
      const meta = readMarkdownDocument(resolvedPath, agentKey)
      items.push({
        id: `${provider}:${plugin.id || plugin.name}:agent:${agentKey}`,
        name: agentKey,
        title: meta.name || agentKey,
        description: meta.description || '',
        path: resolvedPath,
        content: meta.body || '',
        model: typeof meta.frontmatter?.model === 'string' ? meta.frontmatter.model : '',
        tools: normalizeAgentTools(meta.frontmatter?.tools),
        permissionMode: typeof meta.frontmatter?.permissionMode === 'string' ? meta.frontmatter.permissionMode : '',
        skills: normalizeAgentSkills(meta.frontmatter?.skills),
        ...baseFields
      })
    }
  }

  const agentsDir = path.join(plugin.sourcePath || '', 'agents')
  if (plugin.sourcePath && fileExists(agentsDir)) {
    for (const entry of listDir(agentsDir)) {
      const entryPath = path.join(agentsDir, entry.name)
      if (!entry.isDirectory() && !entry.isFile()) continue

      let markdownPath = ''
      if (entry.isDirectory()) {
        markdownPath = ['AGENT.md', 'agent.md', 'README.md']
          .map(name => path.join(entryPath, name))
          .find(fileExists) || ''
      } else if (/\.(md|markdown)$/i.test(entry.name)) {
        markdownPath = entryPath
      }

      const agentKey = entry.isDirectory()
        ? entry.name
        : entry.name.replace(/\.(md|markdown)$/i, '')
      const meta = markdownPath
        ? readMarkdownDocument(markdownPath, agentKey)
        : { name: agentKey, description: '', frontmatter: {} }

      items.push({
        id: `${provider}:${plugin.id || plugin.name}:agent:${agentKey}`,
        name: agentKey,
        title: meta.name || agentKey,
        description: meta.description || '',
        path: entry.isDirectory() ? entryPath : (markdownPath || entryPath),
        content: markdownPath ? meta.body || '' : '',
        model: typeof meta.frontmatter?.model === 'string' ? meta.frontmatter.model : '',
        tools: normalizeAgentTools(meta.frontmatter?.tools),
        permissionMode: typeof meta.frontmatter?.permissionMode === 'string' ? meta.frontmatter.permissionMode : '',
        skills: normalizeAgentSkills(meta.frontmatter?.skills),
        ...baseFields
      })
    }
  }

  return uniqueBy(items, item => item.id)
}

function extractPluginHooks(plugin = {}) {
  if (Array.isArray(plugin.hookEntries) && plugin.hookEntries.length > 0) {
    return plugin.hookEntries
  }

  return scanHookFiles(plugin.sourcePath || '', {
    provider: plugin.provider || 'claude',
    scope: 'plugin',
    pluginScope: plugin.scope || '',
    pluginEnabled: plugin.enabled !== false,
    pluginName: plugin.displayName || plugin.name || plugin.id || '',
    pluginId: plugin.id || '',
    sourceLabel: `插件 · ${plugin.displayName || plugin.name || plugin.id || ''}`
  })
}

function buildPluginDetails(plugin = {}) {
  return {
    skills: extractPluginSkills(plugin),
    hooks: extractPluginHooks(plugin),
    mcp: extractPluginMcps(plugin),
    agents: extractPluginAgents(plugin)
  }
}

function collectPlugins(options = {}) {
  const requestedContents = normalizeRequestedContents(options.contents)
  const projectPath = options.projectPath || ''
  const providerFilter = options.provider === 'codex' ? ['codex'] : options.provider === 'claude' ? ['claude'] : ['claude', 'codex']
  const result = {
    plugins: [],
    skills: [],
    mcp: [],
    hooks: [],
    agents: []
  }

  for (const provider of providerFilter) {
    if (provider === 'claude') {
      const cliState = readClaudeCliPluginState()
      const plugins = discoverClaudePlugins(projectPath, cliState.installed, {
        contents: requestedContents,
        includeCounts: false
      }).map(plugin => ({
        ...plugin,
        provider: 'claude'
      }))

      result.plugins.push(...plugins)
      for (const plugin of plugins) {
        if (hasRequestedContent(requestedContents, 'skills')) {
          result.skills.push(...extractPluginSkills(plugin))
        }
        if (hasRequestedContent(requestedContents, 'mcp')) {
          result.mcp.push(...extractPluginMcps(plugin))
        }
        if (hasRequestedContent(requestedContents, 'hooks')) {
          result.hooks.push(...extractPluginHooks(plugin))
        }
      }
    }

    if (provider === 'codex') {
      const codexConfig = appService.readCodexConfigFile()
      const plugins = discoverCodexPlugins(projectPath, codexConfig.rawContent || '', {
        contents: requestedContents,
        includeCounts: false
      }).map(plugin => ({
        ...plugin,
        provider: 'codex'
      }))

      result.plugins.push(...plugins)
      for (const plugin of plugins) {
        if (hasRequestedContent(requestedContents, 'skills')) {
          result.skills.push(...extractPluginSkills(plugin))
        }
        if (hasRequestedContent(requestedContents, 'mcp')) {
          result.mcp.push(...extractPluginMcps(plugin))
        }
        if (hasRequestedContent(requestedContents, 'hooks')) {
          result.hooks.push(...extractPluginHooks(plugin))
        }
      }
    }
  }

  result.plugins = uniqueBy(result.plugins, item => item.id || item.sourcePath)
  result.skills = uniqueBy(result.skills, item => item.id || `${item.provider}:${item.pluginId}:${item.slug}`)
  result.mcp = uniqueBy(result.mcp, item => item.id || `${item.provider}:${item.pluginId}:${item.slug}`)
  result.hooks = uniqueBy(result.hooks, item => item.id)

  return result
}

function inspectCodexProvider(options = {}) {
  const projectPath = options.projectPath || ''
  const codexConfig = appService.readCodexConfigFile()
  const codexAuth = appService.readCodexAuthFile()
  const globalHooksPath = path.join(os.homedir(), '.codex', 'hooks.json')
  const projectHooksPath = projectPath ? path.join(projectPath, '.codex', 'hooks.json') : ''
  const globalHooksConfig = safeReadJson(globalHooksPath, null)
  const projectHooksConfig = safeReadJson(projectHooksPath, null)
  const globalHooks = flattenHooks(globalHooksConfig?.hooks || globalHooksConfig || {}, {
      provider: 'codex',
      scope: 'user',
      sourcePath: globalHooksPath,
      sourceLabel: '用户 hooks.json'
    })
  const projectHooks = flattenHooks(projectHooksConfig?.hooks || projectHooksConfig || {}, {
      provider: 'codex',
      scope: 'project',
      sourcePath: projectHooksPath,
      sourceLabel: '项目 hooks.json'
    })
  const hooks = [
    ...globalHooks,
    ...projectHooks
  ]
  const hookFeatureEnabled = parseCodexFeatureFlag(codexConfig.rawContent || '', 'codex_hooks')
  const hookSources = [
    createHookSource({
      provider: 'codex',
      scope: 'user',
      sourceLabel: '用户 hooks.json',
      sourcePath: globalHooksPath,
      fileType: 'hooks.json',
      hasHooksField: Boolean(globalHooksConfig && (globalHooksConfig.hooks || Object.keys(globalHooksConfig || {}).length > 0)),
      hooks: globalHooks,
      featureEnabled: hookFeatureEnabled,
      note: fileExists(globalHooksPath) ? '' : '未发现 hooks.json'
    }),
    createHookSource({
      provider: 'codex',
      scope: 'project',
      sourceLabel: '项目 hooks.json',
      sourcePath: projectHooksPath,
      fileType: 'hooks.json',
      hasHooksField: Boolean(projectHooksConfig && (projectHooksConfig.hooks || Object.keys(projectHooksConfig || {}).length > 0)),
      hooks: projectHooks,
      featureEnabled: hookFeatureEnabled,
      note: projectHooksPath && !fileExists(projectHooksPath) ? '未发现项目 hooks.json' : ''
    }),
    createHookSource({
      provider: 'codex',
      scope: 'config',
      sourceLabel: '用户 config.toml',
      sourcePath: appService.getCodexConfigPath(),
      fileType: 'config.toml',
      hasHooksField: /\bhook/i.test(codexConfig.rawContent || ''),
      hooks: [],
      featureEnabled: hookFeatureEnabled,
      note: hookFeatureEnabled
        ? '已解析 config.toml 的 Hook 特性开关'
        : '当前未在 config.toml 中发现已启用的 Hook 特性'
    })
  ]

  return {
    provider: 'codex',
    projectPath,
    configPaths: {
      user: appService.getCodexConfigPath(),
      project: projectPath ? path.join(projectPath, '.codex', 'config.toml') : '',
      globalHooks: globalHooksPath,
      projectHooks: projectHooksPath
    },
    hookFeatureEnabled,
    hooks: uniqueBy(hooks, hook => hook.id),
    hookSources: uniqueBy(hookSources, source => source.id),
    plugins: discoverCodexPlugins(projectPath, codexConfig.rawContent || '', {
      includeCounts: true,
      includeDetails: true
    }).map(plugin => ({
      ...plugin,
      provider: 'codex'
    })),
    runtime: {
      authMode: codexAuth.authMode || 'provider',
      model: codexConfig.model || '',
      modelProvider: codexConfig.modelProvider || '',
      modelReasoningEffort: codexConfig.modelReasoningEffort || 'medium',
      apiUrl: codexConfig.apiUrl || ''
    }
  }
}

function inspectProviderSetup(options = {}) {
  const provider = options.provider === 'codex' ? 'codex' : 'claude'
  return provider === 'codex'
    ? inspectCodexProvider(options)
    : inspectClaudeProvider(options)
}

module.exports = {
  inspectProviderSetup,
  collectPlugins
}
