const { SessionInstance } = require('./session-instance')
const logger = require('./logger')

/**
 * SessionManager
 * 管理多个 SessionInstance，每个会话都是独立的
 */
class SessionManager {
  constructor(sendToRenderer = null) {
    this.sessions = new Map() // sessionId -> SessionInstance
    this.sendToRenderer = sendToRenderer // 向前端发送事件的回调
  }

  /**
   * 设置发送到前端的回调
   */
  setSendToRenderer(callback) {
    this.sendToRenderer = callback
    // 更新所有已存在的 session 的回调
    for (const session of this.sessions.values()) {
      session.sendToRenderer = callback
    }
  }

  /**
   * 获取或创建 SessionInstance
   * @param {string} sessionId - 会话 ID
   * @param {string} projectPath - 项目路径
   * @param {boolean} createIfNotExists - 如果不存在是否创建
   */
  async getOrCreateSession(sessionId, projectPath, createIfNotExists = true) {
    // 如果已存在，直接返回
    if (this.sessions.has(sessionId)) {
      return this.sessions.get(sessionId)
    }

    if (!createIfNotExists) {
      return null
    }

    logger.info(`[SessionManager] Creating session ${sessionId} for project ${projectPath}`)

    // 创建新的 SessionInstance
    const session = new SessionInstance(sessionId, projectPath, this.sendToRenderer)

    // 初始化（加载历史）
    await session.initialize()

    // 存储
    this.sessions.set(sessionId, session)

    return session
  }

  /**
   * 获取 SessionInstance（不创建）
   */
  getSession(sessionId) {
    return this.sessions.get(sessionId) || null
  }

  /**
   * 检查会话是否存在
   */
  hasSession(sessionId) {
    return this.sessions.has(sessionId)
  }

  /**
   * 获取会话状态
   */
  getSessionState(sessionId) {
    const session = this.sessions.get(sessionId)
    return session ? session.getState() : null
  }

  /**
   * 启动会话（启动 Claude 进程）
   */
  async startSession(sessionId) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error(`Session ${sessionId} not found`)
    }

    return session.start()
  }

  /**
   * 更新会话 UI 状态
   */
  updateSessionUIState(sessionId, state) {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.updateUIState(state)
    }
  }

  /**
   * 发送消息
   */
  async sendMessage(sessionId, content) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      logger.warn(`[SessionManager] Session ${sessionId} not found, message may have been sent after session closed`)
      return
    }

    return session.sendMessage(content)
  }

  /**
   * 发送控制响应
   */
  async sendControlResponse(sessionId, requestId, approved, options = {}) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      logger.warn(`[SessionManager] Session ${sessionId} not found, control response may have been sent after session closed`)
      return
    }

    return session.sendControlResponse(requestId, approved, options)
  }

  /**
   * 发送中断
   */
  async sendInterrupt(sessionId) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      logger.warn(`[SessionManager] Session ${sessionId} not found, interrupt may have been sent after session closed`)
      return
    }

    return session.sendInterrupt()
  }

  /**
   * 发送控制请求（主动请求，如切换权限模式）
   */
  async sendControlRequest(sessionId, request) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      logger.warn(`[SessionManager] Session ${sessionId} not found, control request may have been sent after session closed`)
      return
    }

    return session.sendControlRequest(request)
  }

  /**
   * 设置权限模式
   */
  async setPermissionMode(sessionId, mode) {
    const session = this.sessions.get(sessionId)
    if (!session) {
      logger.warn(`[SessionManager] Session ${sessionId} not found`)
      return
    }

    return session.setPermissionMode(mode)
  }

  /**
   * 关闭会话
   */
  closeSession(sessionId) {
    const session = this.sessions.get(sessionId)
    if (session) {
      logger.info(`[SessionManager] Closing session ${sessionId}`)
      session.stop()
      this.sessions.delete(sessionId)
    }
  }

  /**
   * 获取所有活跃会话 ID
   */
  getActiveSessionIds() {
    return Array.from(this.sessions.keys())
  }

  /**
   * 关闭所有会话
   */
  closeAll() {
    for (const [sessionId, session] of this.sessions) {
      logger.info(`[SessionManager] Closing session ${sessionId}`)
      session.stop()
    }
    this.sessions.clear()
  }
}

module.exports = { SessionManager }
