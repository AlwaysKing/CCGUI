const fs = require('fs')
const os = require('os')
const path = require('path')

let cachedCodexPath = null

/**
 * 统一探测 Codex CLI 可执行文件路径（进程内只探测一次，结果缓存）。
 * 搜索顺序：
 * 1. CODEX_CLI_PATH 环境变量
 * 2. 应用内置路径（Codex.app / ChatGPT.app，含新版 codex-cli/bin 布局）
 * 3. 常见安装路径（Homebrew、usr/local、~/.local/bin）
 * 4. nvm 各 node 版本的 bin 目录
 * 5. 传入 environment.PATH（通常是登录 shell 解析出的 PATH）中的所有目录
 * 找不到时返回 null，不缓存失败结果，下次调用会重新探测。
 */
function getCodexExecutablePath(environment = process.env) {
  if (cachedCodexPath) return cachedCodexPath

  const nvmBinPaths = []
  const nvmVersionsPath = path.join(os.homedir(), '.nvm', 'versions', 'node')
  try {
    for (const version of fs.readdirSync(nvmVersionsPath)) {
      nvmBinPaths.push(path.join(nvmVersionsPath, version, 'bin', 'codex'))
    }
  } catch (_) {
    // nvm is optional
  }

  const possiblePaths = [
    ...(environment.CODEX_CLI_PATH ? [environment.CODEX_CLI_PATH] : []),
    '/Applications/Codex.app/Contents/Resources/codex',
    '/Applications/ChatGPT.app/Contents/Resources/codex',
    // ChatGPT.app 新版本把 codex 从 Resources/codex 移到了 codex-cli/bin/codex
    '/Applications/ChatGPT.app/Contents/Resources/codex-cli/bin/codex',
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    path.join(os.homedir(), '.local', 'bin', 'codex'),
    ...nvmBinPaths,
    ...(environment.PATH ? environment.PATH.split(path.delimiter).map(dir => path.join(dir, 'codex')) : [])
  ]

  cachedCodexPath = possiblePaths.find(candidate => candidate && fs.existsSync(candidate)) || null
  return cachedCodexPath
}

/**
 * 清除缓存的路径（主要用于测试）。
 */
function clearCodexPathCache() {
  cachedCodexPath = null
}

module.exports = {
  getCodexExecutablePath,
  clearCodexPathCache
}
