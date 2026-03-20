/**
 * 日志系统工具模块
 *
 * 提供两种类型的日志记录：
 * 1. 应用程序日志 - 记录软件本身的各种日志
 * 2. 应用运行辅助能力
 *
 * 前端使用：通过 Electron API 发送日志到后端
 * 后端使用：直接写入文件系统
 */

/**
 * 日志级别
 */
export const LogLevel = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
}

/**
 * 日志工具类
 */
class Logger {
  constructor() {
    this.appLogPath = null
    this.initialized = false
  }

  /**
   * 初始化日志系统
   * @param {string} baseDir - 基础目录，默认为 /tmp/ccgui
   */
  async initialize(baseDir = '/tmp/ccgui') {
    if (this.initialized) return

    try {
      // 确保目录存在
      if (window.electronAPI?.ensureLogDir) {
        // 前端：通过 Electron API 创建目录
        await window.electronAPI.ensureLogDir({ baseDir })
      } else {
        // 后端：直接创建目录
        const fs = require('fs')
        const path = require('path')

        const appLogDir = path.dirname(path.join(baseDir, 'app.log'))
        if (!fs.existsSync(appLogDir)) {
          fs.mkdirSync(appLogDir, { recursive: true })
        }
      }

      this.appLogPath = `${baseDir}/app.log`
      this.initialized = true

      this.info('Logger initialized', { baseDir })
    } catch (error) {
      console.error('Failed to initialize logger:', error)
      throw error
    }
  }

  /**
   * 格式化日志条目
   */
  formatLogEntry(level, message, data = null) {
    const timestamp = new Date().toISOString()
    const entry = {
      timestamp,
      level,
      message,
      data: data !== null && data !== undefined ? data : undefined
    }
    return JSON.stringify(entry)
  }

  /**
   * 写入应用程序日志
   */
  async writeAppLog(level, message, data = null) {
    if (!this.initialized) {
      await this.initialize()
    }

    const entry = this.formatLogEntry(level, message, data)

    if (window.electronAPI?.writeAppLog) {
      // 前端：通过 Electron API 写入日志
      await window.electronAPI.writeAppLog({ entry })
    } else {
      // 后端：直接写入文件
      const fs = require('fs')
      fs.appendFileSync(this.appLogPath, entry + '\n')
    }

  }

  /**
   * 记录调试信息
   */
  debug(message, data = null) {
    return this.writeAppLog(LogLevel.DEBUG, message, data)
  }

  /**
   * 记录一般信息
   */
  info(message, data = null) {
    return this.writeAppLog(LogLevel.INFO, message, data)
  }

  /**
   * 记录警告信息
   */
  warn(message, data = null) {
    return this.writeAppLog(LogLevel.WARN, message, data)
  }

  /**
   * 记录错误信息
   */
  error(message, data = null) {
    return this.writeAppLog(LogLevel.ERROR, message, data)
  }

}

// 创建默认日志实例
export const logger = new Logger()

// 导出便捷函数
export const logDebug = (message, data) => logger.debug(message, data)
export const logInfo = (message, data) => logger.info(message, data)
export const logWarn = (message, data) => logger.warn(message, data)
export const logError = (message, data) => logger.error(message, data)

export default logger
