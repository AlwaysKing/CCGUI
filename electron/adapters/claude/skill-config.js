/**
 * Claude Skill 启用/禁用
 *
 * Claude 原生支持 skill 启用/禁用：settings 里的 skillOverrides（对象，按 skill 名匹配）：
 *   取值 "on" | "name-only" | "user-invocable-only" | "off"，"off" = 完全不可见、不可调用
 *   Scope = 任意 settings 文件，对象按键跨文件深合并，且项目覆盖用户
 *   plugin 提供的 skill 不受 skillOverrides 管辖（由 plugins 的 enabledPlugins 控制），此处不处理
 *
 *   全局：~/.claude/settings.json                      → skillOverrides[<slug>]
 *   项目：<项目>/.claude/settings.local.json（官方 /skills 菜单也写这里）→ skillOverrides[<slug>]
 *
 * 缺省（不在 skillOverrides 里）= 启用；项目缺省 = 跟随全局。
 * 因为 provider 自己按 key 合并、项目覆盖用户，这里不需要 CCGUI 额外记账或物化。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const logger = require('../../logger')
const projectConfigManager = require('../../storage/project-config-manager')

const OVERRIDES_KEY = 'skillOverrides'

function userSettingsPath() {
  return path.join(os.homedir(), '.claude', 'settings.json')
}

function projectSettingsPath(projectPath) {
  return path.join(projectPath, '.claude', 'settings.local.json')
}

// ============================================
// settings 文件读写
// ============================================

function readSettingsFile(filePath) {
  if (!fs.existsSync(filePath)) return {}
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf-8'))
  } catch (_) {
    return {}
  }
}

// 写入前读取：文件存在却解析失败时抛错，避免用空对象覆盖用户设置
function loadSettingsForWrite(filePath) {
  if (!fs.existsSync(filePath)) return {}
  let raw
  try {
    raw = fs.readFileSync(filePath, 'utf-8')
  } catch (e) {
    throw new Error(`无法读取 ${filePath}：${e.message}`)
  }
  try {
    return JSON.parse(raw)
  } catch (_) {
    throw new Error(`${filePath} 解析失败，已中止写入以避免覆盖现有配置`)
  }
}

function writeSettingsFile(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

// ============================================
// skillOverrides 读写
// ============================================

function readOverrides(filePath) {
  const overrides = readSettingsFile(filePath)[OVERRIDES_KEY]
  return overrides && typeof overrides === 'object' ? overrides : {}
}

// skillOverrides 里只有 "off" 算禁用，其余取值（on / name-only / user-invocable-only）都算启用
function overridesToMap(overrides) {
  const map = {}
  for (const [slug, value] of Object.entries(overrides)) {
    map[slug] = value !== 'off'
  }
  return map
}

// 写/删 skillOverrides 里的一条：
//   - 无实际变化时不落盘（避免"跟随全局"这类空操作凭空建出空 settings 文件）
//   - 整块写空后删掉该键；文件随之再无其它内容且原本存在时，连文件一起删掉，保持干净
function setOverrideEntry(filePath, slug, value) {
  const fileExists = fs.existsSync(filePath)
  const data = loadSettingsForWrite(filePath)
  const overrides = data[OVERRIDES_KEY] && typeof data[OVERRIDES_KEY] === 'object' ? data[OVERRIDES_KEY] : {}
  const hasEntry = Object.prototype.hasOwnProperty.call(overrides, slug)

  if (value === null || value === undefined) {
    if (!hasEntry) return // 本来就没有这一条，删了也无变化 → 不写
    delete overrides[slug]
  } else {
    if (hasEntry && overrides[slug] === value) return // 值相同 → 不写
    overrides[slug] = value
  }

  if (Object.keys(overrides).length === 0) {
    delete data[OVERRIDES_KEY]
    if (fileExists && Object.keys(data).length === 0) {
      fs.rmSync(filePath, { force: true })
      return
    }
  } else {
    data[OVERRIDES_KEY] = overrides
  }
  writeSettingsFile(filePath, data)
}

// ============================================
// 启用状态（上层接口）
// ============================================

function readEnableStates(projectPath) {
  return {
    global: overridesToMap(readOverrides(userSettingsPath())),
    project: projectPath ? overridesToMap(readOverrides(projectSettingsPath(projectPath))) : {}
  }
}

// 全局切换：启用 = 删条目（缺省即启用），禁用 = 写 "off"
function setGlobalEnabled(slug, enabled) {
  setOverrideEntry(userSettingsPath(), slug, enabled ? null : 'off')
}

// 项目切换：enabled 为 null 表示恢复"跟随全局"（删掉项目层条目）
function setProjectEnabled(projectPath, slug, enabled) {
  if (!projectPath) return
  const value = enabled === null || enabled === undefined ? null : (enabled ? 'on' : 'off')
  setOverrideEntry(projectSettingsPath(projectPath), slug, value)
}

// Claude 原生按 key 合并、项目覆盖用户，打开项目时无需物化
function syncProject() {}

// ============================================
// 卸载 / 停用后的残留清理
// ============================================

// 清掉全局 skillOverrides[<slug>]（~/.claude/settings.json）
function clearGlobalOverride(slug) {
  try {
    setOverrideEntry(userSettingsPath(), slug, null)
  } catch (error) {
    logger.warn('[Skill] 清理全局 skillOverrides 失败', { slug, error: error.message })
  }
}

// 清掉某个项目 skillOverrides[<slug>]（<项目>/.claude/settings.local.json）
function clearProjectOverride(projectPath, slug) {
  if (!projectPath) return
  try {
    setOverrideEntry(projectSettingsPath(projectPath), slug, null)
  } catch (error) {
    logger.warn('[Skill] 清理项目 skillOverrides 失败', { slug, projectPath, error: error.message })
  }
}

// 卸载/停用某个 slug 后清掉它在 settings 里的 skillOverrides 残留，
// 避免以后重新安装、重新启用时被旧记录自动禁用（对齐 MCP 的 cleanupSlugEverywhere）：
//   onlyProjectPath = null        → 清全局 + 所有项目
//   onlyProjectPath = <项目路径>   → 只清该项目
function clearSlugEverywhere(slug, { onlyProjectPath = null } = {}) {
  if (onlyProjectPath === null) clearGlobalOverride(slug)

  let projects
  if (onlyProjectPath) {
    projects = [{ path: onlyProjectPath }]
  } else {
    try {
      projects = projectConfigManager.getAllProjects() || []
    } catch (_) {
      projects = []
    }
  }
  for (const project of projects) {
    if (project?.path) clearProjectOverride(project.path, slug)
  }
}

module.exports = {
  readEnableStates,
  setGlobalEnabled,
  setProjectEnabled,
  syncProject,
  clearGlobalOverride,
  clearProjectOverride,
  clearSlugEverywhere
}
