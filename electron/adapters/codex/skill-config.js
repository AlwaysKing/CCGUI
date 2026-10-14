/**
 * Codex Skill 启用/禁用 —— 底层不支持，全部空转
 *
 * Codex 的 skill 只是 ~/.codex/skills/ 下的目录，~/.codex/config.toml 里没有任何 skill 段，
 * 也没有像 [mcp_servers.*] 的 enabled 那样的字段，因此 Codex 侧无法做启用/禁用。
 * 这里保留与 claude 完全一致的接口，供上层按 target 统一分派，但读写均为空、不产生任何副作用。
 */

function readEnableStates() {
  return { global: {}, project: {} }
}

function setGlobalEnabled() {}

function setProjectEnabled() {}

function syncProject() {}

function clearGlobalOverride() {}

function clearProjectOverride() {}

function clearSlugEverywhere() {}

module.exports = {
  readEnableStates,
  setGlobalEnabled,
  setProjectEnabled,
  syncProject,
  clearGlobalOverride,
  clearProjectOverride,
  clearSlugEverywhere
}
