/**
 * Codex MCP 配置读写 + 启用/禁用
 *
 *   全局：~/.codex/config.toml → [mcp_servers.<slug>]
 *   项目：<项目>/.codex/config.toml → [mcp_servers.<slug>]
 *        （需 ~/.codex/config.toml 里有 [projects."<路径>"] trust_level = "trusted" 才生效）
 *
 * Codex 原生支持 enabled 字段并自己层叠（项目覆盖全局、字段级深合并），
 * 所以这里不需要 CCGUI 额外记账——配置文件本身就是真相：
 *   enabled 缺省 = true；项目层没写 enabled = 继承全局。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const logger = require('../../logger')

function globalCodexConfigPath() {
  return path.join(os.homedir(), '.codex', 'config.toml')
}

function projectCodexConfigPath(projectPath) {
  return path.join(projectPath, '.codex', 'config.toml')
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key)
}

// ============================================
// TOML 读写小工具
// ============================================

function stringifyTomlString(value) {
  return `"${String(value ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

function parseTopLevelTomlValue(rawValue) {
  const value = rawValue.trim()
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1)
  }
  return value
}

function tomlBool(value) {
  if (typeof value === 'boolean') return value
  return String(value).trim() === 'true'
}

function readTomlRaw(tomlPath) {
  if (!fs.existsSync(tomlPath)) return ''
  return fs.readFileSync(tomlPath, 'utf-8')
}

function writeTomlRaw(tomlPath, raw) {
  fs.mkdirSync(path.dirname(tomlPath), { recursive: true })
  fs.writeFileSync(tomlPath, raw.replace(/\n{3,}/g, '\n\n').replace(/\n*$/, '\n'), 'utf-8')
}

// 从指定 toml 文件读取 mcp_servers（mcp_servers.<slug> 及其 <slug>.env 之类子表归入同一 server）
function readTomlMcpServers(tomlPath) {
  const result = {}
  const rawContent = readTomlRaw(tomlPath)
  if (!rawContent) return result
  let currentSlug = null
  let currentConfig = null

  const flush = () => {
    if (currentSlug && currentConfig) result[currentSlug] = currentConfig
  }

  for (const line of rawContent.split(/\r?\n/)) {
    const trimmed = line.trim()
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/)
    if (sectionMatch) {
      const section = sectionMatch[1]
      const mcpPrefix = 'mcp_servers.'
      if (section.startsWith(mcpPrefix)) {
        const rest = section.slice(mcpPrefix.length)
        const dotIndex = rest.indexOf('.')
        // 只取 mcp_servers 后的第一段作为 server 名，rea.env 这类子表归属父 server
        const slug = dotIndex === -1 ? rest : rest.slice(0, dotIndex)
        if (slug !== currentSlug) {
          flush()
          currentSlug = slug
          currentConfig = {}
        }
      } else {
        flush()
        currentSlug = null
        currentConfig = null
      }
      continue
    }
    if (!currentSlug || !currentConfig) continue
    const entryMatch = trimmed.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+)$/)
    if (entryMatch) {
      const key = entryMatch[1]
      const value = entryMatch[2].trim()
      if (value.startsWith('[')) {
        try { currentConfig[key] = JSON.parse(value.replace(/'/g, '"')) } catch (_) { currentConfig[key] = value }
      } else {
        currentConfig[key] = parseTopLevelTomlValue(value)
      }
    }
  }
  flush()
  return result
}

// 从 toml 文件移除 mcp_servers section（含 mcp_servers.<slug>.env 之类的子表）
function removeTomlMcpSection(tomlPath, slug) {
  if (!fs.existsSync(tomlPath)) return
  const rawContent = fs.readFileSync(tomlPath, 'utf-8')
  const sectionName = `mcp_servers.${slug}`
  const lines = rawContent.split(/\r?\n/)
  const output = []
  let skipping = false

  for (const line of lines) {
    const trimmed = line.trim()
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/)
    if (!skipping && sectionMatch && sectionMatch[1] === sectionName) {
      skipping = true
      continue
    }
    if (skipping) {
      // 该 server 的子表也一并跳过；遇到其它 section 才结束
      if (sectionMatch && !(sectionMatch[1] === sectionName || sectionMatch[1].startsWith(`${sectionName}.`))) {
        skipping = false
        output.push(line)
      }
      continue
    }
    output.push(line)
  }
  writeTomlRaw(tomlPath, output.join('\n'))
}

// 找到 [sectionName] 的行区间 [start, end)，end 为子表或下一个 section 的位置
function findSectionRange(lines, sectionName) {
  const header = `[${sectionName}]`
  const start = lines.findIndex(line => line.trim() === header)
  if (start === -1) return null
  let end = lines.length
  for (let i = start + 1; i < lines.length; i++) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[i])) { end = i; break }
  }
  return { start, end }
}

function findKeyIndex(lines, start, end, key) {
  const pattern = new RegExp(`^\\s*${key}\\s*=`)
  for (let i = start; i < end; i++) {
    if (pattern.test(lines[i])) return i
  }
  return -1
}

// 设置/更新某个 section 的顶层 key（section 不存在则新建）
function setTomlSectionKey(tomlPath, sectionName, key, value) {
  const raw = readTomlRaw(tomlPath)
  const lines = raw.split(/\r?\n/)
  const range = findSectionRange(lines, sectionName)
  const line = `${key} = ${value}`

  if (!range) {
    const prefix = raw.trim() ? '\n\n' : ''
    writeTomlRaw(tomlPath, `${raw.replace(/\n+$/, '')}${prefix}[${sectionName}]\n${line}\n`)
    return
  }

  const keyIdx = findKeyIndex(lines, range.start + 1, range.end, key)
  if (keyIdx !== -1) {
    lines[keyIdx] = line
  } else {
    lines.splice(range.end, 0, line) // 插到子表/下一个 section 之前，保证仍属于本 section
  }
  writeTomlRaw(tomlPath, lines.join('\n'))
}

// 移除某个 section 的顶层 key；若该 section 已空则整段删除
function removeTomlSectionKey(tomlPath, sectionName, key) {
  const raw = readTomlRaw(tomlPath)
  if (!raw) return
  const lines = raw.split(/\r?\n/)
  let range = findSectionRange(lines, sectionName)
  if (!range) return

  const keyIdx = findKeyIndex(lines, range.start + 1, range.end, key)
  if (keyIdx === -1) return
  lines.splice(keyIdx, 1)

  range = findSectionRange(lines, sectionName)
  if (range) {
    const hasDirectKey = lines.slice(range.start + 1, range.end).some(line => line.trim() !== '')
    let hasSubSection = false
    for (let i = range.end; i < lines.length; i++) {
      const match = lines[i].trim().match(/^\[([^\]]+)\]\s*$/)
      if (!match) continue
      if (match[1].startsWith(`${sectionName}.`)) { hasSubSection = true; continue }
      break
    }
    if (!hasDirectKey && !hasSubSection) lines.splice(range.start, range.end - range.start)
  }
  writeTomlRaw(tomlPath, lines.join('\n'))
}

// 生成 Codex TOML 格式的 MCP 配置行
function generateMcpTomlLines(config, slug) {
  const lines = [`[mcp_servers.${slug}]`]
  if (config.type) {
    lines.push(`type = ${stringifyTomlString(config.type)}`)
    if (config.url) lines.push(`url = ${stringifyTomlString(config.url)}`)
    if (config.headers && Object.keys(config.headers).length > 0) {
      for (const [hk, hv] of Object.entries(config.headers)) {
        lines.push(`header_${hk} = ${stringifyTomlString(hv)}`)
      }
    }
  } else if (config.command) {
    lines.push(`command = ${stringifyTomlString(config.command)}`)
    if (config.args?.length) {
      const argsItems = config.args.map(a => stringifyTomlString(a)).join(', ')
      lines.push(`args = [${argsItems}]`)
    }
  }
  if (config.env && Object.keys(config.env).length > 0) {
    for (const [ek, ev] of Object.entries(config.env)) {
      lines.push(`env_${ek} = ${stringifyTomlString(ev)}`)
    }
  }
  return lines
}

// 确保 Codex 把项目标记为 trusted（否则项目级 .codex/config.toml 不生效）
function ensureCodexProjectTrusted(projectPath) {
  if (!projectPath) return
  const configPath = globalCodexConfigPath()
  const sectionHeader = `[projects."${projectPath}"]`
  let raw = readTomlRaw(configPath)
  const lines = raw.split(/\r?\n/)
  const headerIdx = lines.findIndex(line => line.trim() === sectionHeader)

  if (headerIdx === -1) {
    const prefix = raw.trim() ? '\n\n' : ''
    raw = raw.replace(/\n+$/, '') + prefix + `${sectionHeader}\ntrust_level = "trusted"\n`
    writeTomlRaw(configPath, raw)
    return
  }

  let endIdx = lines.length
  for (let i = headerIdx + 1; i < lines.length; i++) {
    if (/^\s*\[[^\]]+\]\s*$/.test(lines[i])) { endIdx = i; break }
  }
  let trustIdx = -1
  for (let i = headerIdx + 1; i < endIdx; i++) {
    if (/^\s*trust_level\s*=/.test(lines[i])) { trustIdx = i; break }
  }
  if (trustIdx !== -1) {
    if (lines[trustIdx].trim() === 'trust_level = "trusted"') return
    lines[trustIdx] = 'trust_level = "trusted"'
  } else {
    lines.splice(headerIdx + 1, 0, 'trust_level = "trusted"')
  }
  writeTomlRaw(configPath, lines.join('\n'))
}

// ============================================
// 安装状态
// ============================================

function readGlobalInstalled() {
  return readTomlMcpServers(globalCodexConfigPath())
}

function readProjectInstalled(projectPath) {
  if (!projectPath) return {}
  return readTomlMcpServers(projectCodexConfigPath(projectPath))
}

// ============================================
// 启用状态（上层接口）
// ============================================

function collectExplicitEnabled(tomlPath) {
  const map = {}
  for (const [slug, config] of Object.entries(readTomlMcpServers(tomlPath))) {
    if (hasOwn(config, 'enabled')) map[slug] = tomlBool(config.enabled)
  }
  return map
}

function readEnableStates(projectPath) {
  return {
    global: collectExplicitEnabled(globalCodexConfigPath()),
    project: projectPath ? collectExplicitEnabled(projectCodexConfigPath(projectPath)) : {}
  }
}

// 全局切换：直接写 ~/.codex/config.toml（Codex 自己层叠到各项目）
function setGlobalEnabled(slug, enabled) {
  const configPath = globalCodexConfigPath()
  const lines = readTomlRaw(configPath).split(/\r?\n/)
  if (!findSectionRange(lines, `mcp_servers.${slug}`)) return
  setTomlSectionKey(configPath, `mcp_servers.${slug}`, 'enabled', enabled ? 'true' : 'false')
}

// 项目切换：enabled 为 null 表示恢复"跟随全局"（删掉项目层的 enabled 键）
function setProjectEnabled(projectPath, slug, enabled) {
  if (!projectPath) return
  const configPath = projectCodexConfigPath(projectPath)
  if (enabled === null || enabled === undefined) {
    removeTomlSectionKey(configPath, `mcp_servers.${slug}`, 'enabled')
    return
  }
  setTomlSectionKey(configPath, `mcp_servers.${slug}`, 'enabled', enabled ? 'true' : 'false')
  ensureCodexProjectTrusted(projectPath)
}

// Codex 原生层叠，打开项目时无需额外物化
function syncProject() {}

// ============================================
// 安装 / 卸载
// ============================================

function installGlobal(slug, config) {
  const configPath = globalCodexConfigPath()
  removeTomlMcpSection(configPath, slug)
  const rawContent = readTomlRaw(configPath)
  const content = rawContent.replace(/\n+$/, '') + '\n\n' + generateMcpTomlLines(config, slug).join('\n') + '\n'
  writeTomlRaw(configPath, content)
  logger.info(`[MCP] Installed ${slug} to Codex`)
}

function uninstallGlobal(slug) {
  removeTomlMcpSection(globalCodexConfigPath(), slug)
  logger.info(`[MCP] Uninstalled ${slug} from Codex`)
}

function installProject(projectPath, slug, config) {
  const configPath = projectCodexConfigPath(projectPath)
  fs.mkdirSync(path.dirname(configPath), { recursive: true })
  removeTomlMcpSection(configPath, slug)
  const rawContent = readTomlRaw(configPath)
  const content = rawContent.replace(/\n+$/, '') + '\n\n' + generateMcpTomlLines(config, slug).join('\n') + '\n'
  writeTomlRaw(configPath, content)
  ensureCodexProjectTrusted(projectPath)
  logger.info(`[MCP] Installed ${slug} to project Codex config`)
}

function uninstallProject(projectPath, slug) {
  if (!projectPath) return
  removeTomlMcpSection(projectCodexConfigPath(projectPath), slug)
  logger.info(`[MCP] Uninstalled ${slug} from project Codex config`)
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
