const path = require('path')
const fs = require('fs')

let cachedClaudePath = null

/**
 * 检测 Claude CLI 的绝对路径。
 * 搜索顺序：
 * 1. 常见安装路径（Homebrew、usr/local、~/.local/bin）
 * 2. 系统 PATH 中的所有目录
 * 结果会被缓存，后续调用直接返回缓存值。
 */
function detectClaudePath() {
  if (cachedClaudePath) {
    return cachedClaudePath
  }

  const possiblePaths = [
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude',
    path.join(process.env.HOME || '', '.local/bin/claude'),
    ...(process.env.PATH ? process.env.PATH.split(':').map(p => path.join(p, 'claude')) : [])
  ]

  for (const basePath of possiblePaths) {
    try {
      if (basePath.includes('*')) {
        const dir = path.dirname(basePath)
        if (fs.existsSync(dir)) {
          const versions = fs.readdirSync(dir)
          for (const version of versions) {
            const fullPath = path.join(dir, version, 'claude')
            if (fs.existsSync(fullPath)) {
              cachedClaudePath = fullPath
              return cachedClaudePath
            }
          }
        }
      } else if (fs.existsSync(basePath)) {
        cachedClaudePath = basePath
        return cachedClaudePath
      }
    } catch {
      // 继续尝试下一个路径
    }
  }

  return null
}

/**
 * 获取 Claude CLI 绝对路径，找不到时回退到裸命令 'claude'。
 */
function getClaudePath() {
  return detectClaudePath() || 'claude'
}

/**
 * 清除缓存的路径（主要用于测试）。
 */
function clearCache() {
  cachedClaudePath = null
}

module.exports = {
  detectClaudePath,
  getClaudePath,
  clearCache
}
