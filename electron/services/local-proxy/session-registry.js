/**
 * 本地代理会话注册表
 * 每次启动 claude / codex 进程时注册一个会话令牌，代理通过令牌反查该会话当前的供应商与凭据
 */

const crypto = require('crypto')

class SessionRegistry {
  constructor() {
    this.sessions = new Map()
  }

  register(meta = {}) {
    const tool = meta.tool === 'codex' ? 'codex' : 'claude'
    const token = `ccgui-${tool}-${crypto.randomBytes(16).toString('hex')}`

    this.sessions.set(token, {
      ...meta,
      tool,
      token,
      createdAt: Date.now()
    })

    return token
  }

  unregister(token) {
    if (!token) {
      return false
    }

    return this.sessions.delete(token)
  }

  get(token) {
    if (!token) {
      return null
    }

    return this.sessions.get(token) || null
  }

  get size() {
    return this.sessions.size
  }

  clear() {
    this.sessions.clear()
  }
}

module.exports = {
  SessionRegistry
}
