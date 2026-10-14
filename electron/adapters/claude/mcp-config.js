/**
 * Claude MCP 配置读写 + 启用/禁用
 *
 * ~/.claude.json 布局：
 *   全局接入(user scope)：顶层 mcpServers
 *   项目接入(local scope)：projects["<项目路径>"].mcpServers
 *   项目禁用：projects["<项目路径>"].disabledMcpServers
 *
 * Claude 没有"全局禁用"字段——禁用永远是按项目的，所以 CCGUI 自己记一份账：
 *   全局：~/.ccgui/app.json → settings.mcpEnabled.claude = { <slug>: bool }         缺 = 默认启用
 *   项目：~/.ccgui/projects/<projectId>/project.json → settings.mcpEnabled.claude = { <slug>: bool }  缺 = 跟随全局
 *   有效值 = 项目值 ?? 全局值 ?? true
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const logger = require('../../logger')
const appConfigManager = require('../../storage/app-config-manager')
const projectConfigManager = require('../../storage/project-config-manager')
const { encodeProjectPath } = require('../../project-paths')

const GLOBAL_ENABLED_KEY = 'settings.mcpEnabled.claude'
const CCGUI_MCPS_DIR = path.join(os.homedir(), '.ccgui', 'mcps')

function claudeJsonPath() {
  return path.join(os.homedir(), '.claude.json')
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key)
}

// ============================================
// ~/.claude.json 基础读写
// ============================================

function readClaudeJsonConfig() {
  const configPath = claudeJsonPath()
  if (!fs.existsSync(configPath)) return {}
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf-8'))
  } catch (_) {
    return {}
  }
}

function writeClaudeJsonConfig(data) {
  fs.writeFileSync(claudeJsonPath(), JSON.stringify(data, null, 2), 'utf-8')
}

// 写入前读取：文件存在却解析失败时抛错，避免用空对象覆盖用户的 ~/.claude.json
function loadClaudeJsonForWrite() {
  const configPath = claudeJsonPath()
  if (!fs.existsSync(configPath)) return {}
  let raw
  try {
    raw = fs.readFileSync(configPath, 'utf-8')
  } catch (e) {
    throw new Error(`无法读取 ~/.claude.json：${e.message}`)
  }
  try {
    return JSON.parse(raw)
  } catch (_) {
    throw new Error('~/.claude.json 解析失败，已中止写入以避免覆盖现有配置')
  }
}

// ============================================
// 安装状态
// ============================================

// 全局已接入的 MCP（user scope）
function readGlobalInstalled() {
  return readClaudeJsonConfig().mcpServers || {}
}

// 项目已接入的 MCP（local scope）
function readProjectInstalled(projectPath) {
  if (!projectPath) return {}
  const entry = readClaudeJsonConfig().projects?.[projectPath]
  return entry?.mcpServers || {}
}

// 项目显式禁用的 MCP 集合
function readProjectDisabledSet(claudeJson, projectPath) {
  const entry = claudeJson.projects?.[projectPath]
  const list = entry?.disabledMcpServers
  return new Set(Array.isArray(list) ? list : [])
}

// ============================================
// CCGUI 记账
// ============================================

function readGlobalEnabledMap() {
  const map = appConfigManager.getConfigValue(GLOBAL_ENABLED_KEY, {})
  return map && typeof map === 'object' ? map : {}
}

function writeGlobalEnabledMap(map) {
  appConfigManager.setConfigValue(GLOBAL_ENABLED_KEY, map)
}

function projectIdOf(projectPath) {
  return encodeProjectPath(projectPath)
}

function readProjectEnabledMap(projectPath) {
  if (!projectPath) return {}
  const config = projectConfigManager.loadProjectConfig(projectIdOf(projectPath))
  const map = config?.settings?.mcpEnabled?.claude
  return map && typeof map === 'object' ? map : {}
}

function writeProjectEnabledMap(projectPath, map) {
  if (!projectPath) return
  const projectId = projectIdOf(projectPath)
  const config = projectConfigManager.loadProjectConfig(projectId) || {
    id: projectId,
    name: path.basename(projectPath),
    path: projectPath,
    createdAt: new Date().toISOString(),
    sessionCount: 0,
    settings: {}
  }
  config.settings = config.settings || {}
  config.settings.mcpEnabled = config.settings.mcpEnabled || {}
  if (Object.keys(map).length === 0) {
    delete config.settings.mcpEnabled.claude
    if (Object.keys(config.settings.mcpEnabled).length === 0) {
      delete config.settings.mcpEnabled
    }
  } else {
    config.settings.mcpEnabled.claude = map
  }
  projectConfigManager.saveProjectConfig(projectId, config)
}

// 被 CCGUI 管理的 slug 集合：
//   CCGUI 注册表 ∪ 全局记账 ∪ 项目记账 ∪ ~/.claude.json 里实际出现的 MCP（含用户手配的"外部"MCP）
// 把外部 MCP 也纳入，才能对它们做启用/禁用，并让收编/物化逻辑覆盖到它们。
function listManagedSlugs(projectPath, claudeJson) {
  const slugs = new Set()
  try {
    if (fs.existsSync(CCGUI_MCPS_DIR)) {
      for (const file of fs.readdirSync(CCGUI_MCPS_DIR)) {
        if (file.endsWith('.json')) slugs.add(file.replace(/\.json$/, ''))
      }
    }
  } catch (_) {}

  const data = claudeJson || readClaudeJsonConfig()
  for (const slug of Object.keys(data.mcpServers || {})) slugs.add(slug)
  if (projectPath) {
    for (const slug of Object.keys(data.projects?.[projectPath]?.mcpServers || {})) slugs.add(slug)
  }

  for (const slug of Object.keys(readGlobalEnabledMap())) slugs.add(slug)
  for (const slug of Object.keys(readProjectEnabledMap(projectPath))) slugs.add(slug)
  return slugs
}

function effectiveEnabled(slug, globalMap, projectMap) {
  if (hasOwn(projectMap, slug)) return Boolean(projectMap[slug])
  if (hasOwn(globalMap, slug)) return Boolean(globalMap[slug])
  return true
}

function sameStringSet(a, b) {
  if (a.length !== b.length) return false
  const sortedA = [...a].sort()
  const sortedB = [...b].sort()
  return sortedA.every((value, index) => value === sortedB[index])
}

// ============================================
// 启用状态（上层接口）
// ============================================

function readEnableStates(projectPath) {
  return {
    global: readGlobalEnabledMap(),
    project: readProjectEnabledMap(projectPath)
  }
}

// 全局切换：改记账 + fan-out 到所有"跟随全局"的项目
function setGlobalEnabled(slug, enabled) {
  // 先收编各项目里这一条的手工改动（此刻全局记账还是旧值，才能正确判定文件是否被手工改过），
  // 否则接下来的 fan-out 会以"跟随全局"为名把用户手工设过的项目状态抹掉
  adoptManualProjectStates(slug)
  const globalMap = readGlobalEnabledMap()
  globalMap[slug] = Boolean(enabled)
  writeGlobalEnabledMap(globalMap)
  fanOutGlobal(slug, Boolean(enabled))
}

// 项目切换：enabled 为 null 表示恢复"跟随全局"
function setProjectEnabled(projectPath, slug, enabled) {
  if (!projectPath) return
  // 先收编外部改动，否则接下来的物化会把用户手改过的项目状态当成"该启用"而清掉
  reconcileProject(projectPath)
  const projectMap = readProjectEnabledMap(projectPath)
  if (enabled === null || enabled === undefined) {
    delete projectMap[slug]
  } else {
    projectMap[slug] = Boolean(enabled)
  }
  writeProjectEnabledMap(projectPath, projectMap)
  materializeProject(projectPath)
}

// 打开项目时：先收编外部改动，再把有效值物化进 ~/.claude.json
function syncProject(projectPath) {
  if (!projectPath) return
  reconcileProject(projectPath)
  materializeProject(projectPath)
}

// ============================================
// 物化 / fan-out / 收编
// ============================================

// 把某项目的有效值写入 ~/.claude.json 的 disabledMcpServers
function materializeProject(projectPath) {
  if (!projectPath) return
  const data = loadClaudeJsonForWrite()
  const entry = data.projects?.[projectPath]
  if (!entry) return

  const globalMap = readGlobalEnabledMap()
  const projectMap = readProjectEnabledMap(projectPath)
  const existing = Array.isArray(entry.disabledMcpServers) ? entry.disabledMcpServers : []
  const managed = listManagedSlugs(projectPath, data)

  // CCGUI 不管理的条目（外部 MCP）原样保留
  const kept = existing.filter(name => !managed.has(name))
  const disabled = [...managed].filter(slug => !effectiveEnabled(slug, globalMap, projectMap))
  const next = Array.from(new Set([...kept, ...disabled]))

  if (sameStringSet(existing, next)) return
  entry.disabledMcpServers = next
  writeClaudeJsonConfig(data)
}

// 全局变化时：所有"没有项目覆盖"的项目跟着改
function fanOutGlobal(slug, enabled) {
  let data
  try {
    data = loadClaudeJsonForWrite()
  } catch (error) {
    logger.error('[MCP] fanOutGlobal 读取 ~/.claude.json 失败', { error: error.message })
    return
  }

  const projects = data.projects || {}
  let changed = false
  for (const projectPath of Object.keys(projects)) {
    if (hasOwn(readProjectEnabledMap(projectPath), slug)) continue // 有项目覆盖，跳过
    const entry = projects[projectPath]
    const list = Array.isArray(entry.disabledMcpServers) ? entry.disabledMcpServers : []
    const has = list.includes(slug)
    if (enabled && has) {
      entry.disabledMcpServers = list.filter(name => name !== slug)
      changed = true
    } else if (!enabled && !has) {
      entry.disabledMcpServers = [...list, slug]
      changed = true
    }
  }

  if (changed) writeClaudeJsonConfig(data)
}

// 收编外部改动：文件里"和预期不一致"的项目状态记为项目覆盖
function reconcileProject(projectPath) {
  if (!projectPath) return
  const data = readClaudeJsonConfig()
  if (!data.projects?.[projectPath]) return

  const globalMap = readGlobalEnabledMap()
  const projectMap = readProjectEnabledMap(projectPath)
  const disabledSet = readProjectDisabledSet(data, projectPath)
  const managed = listManagedSlugs(projectPath, data)

  let changed = false
  for (const slug of managed) {
    const fileEnabled = !disabledSet.has(slug)
    const expected = effectiveEnabled(slug, globalMap, projectMap)
    if (fileEnabled !== expected) {
      projectMap[slug] = fileEnabled
      changed = true
    }
  }
  if (changed) writeProjectEnabledMap(projectPath, projectMap)
}

// 全局切换前：把各项目里"这一条"的外部改动收编为项目覆盖。
// 必须在改动全局记账之前调用——用旧的全局值判定，文件与预期不一致才记为覆盖；
// 一致（真正跟随全局）的项目不记，好让 fan-out 正常生效。
function adoptManualProjectStates(slug) {
  const data = readClaudeJsonConfig()
  const globalMap = readGlobalEnabledMap()
  const projects = data.projects || {}
  for (const projectPath of Object.keys(projects)) {
    const projectMap = readProjectEnabledMap(projectPath)
    if (hasOwn(projectMap, slug)) continue
    const fileEnabled = !readProjectDisabledSet(data, projectPath).has(slug)
    if (fileEnabled !== effectiveEnabled(slug, globalMap, projectMap)) {
      projectMap[slug] = fileEnabled
      writeProjectEnabledMap(projectPath, projectMap)
    }
  }
}

// ============================================
// 安装 / 卸载
// ============================================

// 安装到全局（user scope）
function installGlobal(slug, config) {
  const data = loadClaudeJsonForWrite()
  if (!data.mcpServers) data.mcpServers = {}
  data.mcpServers[slug] = config
  writeClaudeJsonConfig(data)
  logger.info(`[MCP] Installed ${slug} to Claude`)
}

// 从全局卸载（user scope），并清理记账与各项目黑名单
function uninstallGlobal(slug) {
  const data = readClaudeJsonConfig()
  if (data.mcpServers?.[slug]) {
    delete data.mcpServers[slug]
    writeClaudeJsonConfig(data)
    logger.info(`[MCP] Uninstalled ${slug} from Claude`)
  }
  cleanupSlugEverywhere(slug, { onlyProjectPath: null })
}

// 安装到项目（local scope），并自动从该项目禁用列表中移除
function installProject(projectPath, slug, config) {
  const data = loadClaudeJsonForWrite()
  if (!data.projects) data.projects = {}
  if (!data.projects[projectPath]) data.projects[projectPath] = {}
  const entry = data.projects[projectPath]
  if (!entry.mcpServers) entry.mcpServers = {}
  entry.mcpServers[slug] = config
  if (Array.isArray(entry.disabledMcpServers)) {
    entry.disabledMcpServers = entry.disabledMcpServers.filter(name => name !== slug)
  }
  writeClaudeJsonConfig(data)
  logger.info(`[MCP] Installed ${slug} to project Claude (local scope)`)
}

// 从项目卸载（local scope），并清理该项目记账与禁用列表
function uninstallProject(projectPath, slug) {
  const data = readClaudeJsonConfig()
  const entry = data.projects?.[projectPath]
  if (entry?.mcpServers?.[slug]) {
    delete entry.mcpServers[slug]
    writeClaudeJsonConfig(data)
    logger.info(`[MCP] Uninstalled ${slug} from project Claude (local scope)`)
  }
  cleanupSlugEverywhere(slug, { onlyProjectPath: projectPath })
}

// 卸载某个 slug 后，清掉它在 CCGUI 记账和其它项目黑名单里的残留，
// 避免以后重新安装时被旧记录自动禁用
function cleanupSlugEverywhere(slug, { onlyProjectPath = null } = {}) {
  const globalMap = readGlobalEnabledMap()
  if (onlyProjectPath === null && hasOwn(globalMap, slug)) {
    delete globalMap[slug]
    writeGlobalEnabledMap(globalMap)
  }

  // ~/.claude.json 各项目的 disabledMcpServers
  try {
    const data = loadClaudeJsonForWrite()
    let changed = false
    for (const projectPath of Object.keys(data.projects || {})) {
      if (onlyProjectPath && projectPath !== onlyProjectPath) continue
      const entry = data.projects[projectPath]
      if (Array.isArray(entry.disabledMcpServers) && entry.disabledMcpServers.includes(slug)) {
        entry.disabledMcpServers = entry.disabledMcpServers.filter(name => name !== slug)
        changed = true
      }
    }
    if (changed) writeClaudeJsonConfig(data)
  } catch (error) {
    logger.error('[MCP] 清理 disabledMcpServers 失败', { slug, error: error.message })
  }

  // CCGUI 各项目的记账
  try {
    for (const project of projectConfigManager.getAllProjects() || []) {
      if (onlyProjectPath && project.path !== onlyProjectPath) continue
      const map = project?.settings?.mcpEnabled?.claude
      if (!map || !hasOwn(map, slug)) continue
      const next = { ...map }
      delete next[slug]
      writeProjectEnabledMap(project.path, next)
    }
  } catch (error) {
    logger.error('[MCP] 清理项目记账失败', { slug, error: error.message })
  }
}

module.exports = {
  // 安装状态
  readGlobalInstalled,
  readProjectInstalled,
  // 安装 / 卸载
  installGlobal,
  uninstallGlobal,
  installProject,
  uninstallProject,
  // 启用 / 禁用
  readEnableStates,
  setGlobalEnabled,
  setProjectEnabled,
  syncProject
}
