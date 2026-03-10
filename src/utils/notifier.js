/**
 * 通知系统模块
 *
 * 支持多种通知方式，目前实现：
 * - Bark (iOS 推送通知)
 *
 * 可扩展支持更多通知方式
 */

/**
 * 通知类型
 */
export const NotificationType = {
  BARK: 'bark',
  // 以后可扩展：
  // WEBHOOK: 'webhook',
  // EMAIL: 'email',
  // TELEGRAM: 'telegram',
}

/**
 * 通知结果
 */
export const NotificationResult = {
  success: false,
  message: '',
  error: null
}

/**
 * Bark 通知提供者
 */
class BarkProvider {
  /**
   * 发送 Bark 通知
   * @param {string} url - Bark URL（可包含 {message} 占位符）
   * @param {string} message - 消息内容
   * @returns {Promise<{success: boolean, message: string, error: string|null}>}
   */
  async send(url, message) {
    if (!url) {
      return {
        success: false,
        message: 'Bark URL 未配置',
        error: 'URL_NOT_CONFIGURED'
      }
    }

    try {
      // 构建请求 URL
      // 支持两种格式：
      // 1. https://api.day.app/your_key/{message}
      // 2. https://api.day.app/your_key/ (直接追加消息)
      let requestUrl
      if (url.includes('{message}')) {
        requestUrl = url.replace('{message}', encodeURIComponent(message))
      } else {
        // 确保 URL 以 / 结尾
        const baseUrl = url.endsWith('/') ? url : url + '/'
        requestUrl = baseUrl + encodeURIComponent(message)
      }

      // 通过 Electron 主进程发送请求（绕过 CSP 限制）
      if (window.electronAPI?.sendNotification) {
        return await window.electronAPI.sendNotification({ url: requestUrl })
      }

      // 降级：直接使用 fetch（可能在某些环境下可用）
      const response = await fetch(requestUrl)
      const result = await response.json()

      // Bark 返回格式：{ code: 200, message: "success", timestamp: ... }
      if (result.code === 200 || result.success) {
        return {
          success: true,
          message: '通知发送成功',
          error: null
        }
      } else {
        return {
          success: false,
          message: result.message || '发送失败',
          error: 'BARK_ERROR'
        }
      }
    } catch (error) {
      return {
        success: false,
        message: `发送失败: ${error.message}`,
        error: 'NETWORK_ERROR'
      }
    }
  }

  /**
   * 测试 Bark 连接
   * @param {string} url - Bark URL
   * @returns {Promise<{success: boolean, message: string, error: string|null}>}
   */
  async test(url) {
    return this.send(url, 'CCGUI 通知测试成功！')
  }

  /**
   * 验证 URL 格式
   * @param {string} url - Bark URL
   * @returns {boolean}
   */
  validateUrl(url) {
    if (!url) return false
    try {
      const parsed = new URL(url)
      return parsed.protocol === 'https:' || parsed.protocol === 'http:'
    } catch {
      return false
    }
  }
}

/**
 * 通知管理器
 */
class Notifier {
  constructor() {
    this.providers = {
      [NotificationType.BARK]: new BarkProvider(),
    }
    this.config = {
      enabled: false,
      type: NotificationType.BARK,
      barkUrl: '',
    }
  }

  /**
   * 初始化通知配置
   * @param {object} config - 通知配置
   * @param {boolean} config.enabled - 是否启用通知
   * @param {string} config.type - 通知类型
   * @param {string} config.barkUrl - Bark URL
   */
  initialize(config) {
    this.config = {
      enabled: config.enabled ?? false,
      type: config.type ?? NotificationType.BARK,
      barkUrl: config.barkUrl ?? '',
    }
  }

  /**
   * 更新配置
   * @param {object} config - 部分配置
   */
  updateConfig(config) {
    this.config = { ...this.config, ...config }
  }

  /**
   * 发送通知
   * @param {string} message - 消息内容
   * @param {object} options - 可选参数
   * @param {string} options.type - 指定通知类型（可选，默认使用配置的类型）
   * @returns {Promise<{success: boolean, message: string, error: string|null}>}
   */
  async send(message, options = {}) {
    if (!this.config.enabled) {
      return {
        success: false,
        message: '通知未启用',
        error: 'NOT_ENABLED'
      }
    }

    const type = options.type || this.config.type
    const provider = this.providers[type]

    if (!provider) {
      return {
        success: false,
        message: `不支持的通知类型: ${type}`,
        error: 'UNSUPPORTED_TYPE'
      }
    }

    // 根据类型获取对应的配置
    let config = {}
    if (type === NotificationType.BARK) {
      config = { url: this.config.barkUrl }
    }

    return provider.send(config.url, message)
  }

  /**
   * 发送 Bark 通知
   * @param {string} message - 消息内容
   * @returns {Promise<{success: boolean, message: string, error: string|null}>}
   */
  async sendBark(message) {
    return this.send(message, { type: NotificationType.BARK })
  }

  /**
   * 测试通知
   * @param {string} type - 通知类型
   * @param {object} config - 测试配置
   * @returns {Promise<{success: boolean, message: string, error: string|null}>}
   */
  async test(type, config) {
    const provider = this.providers[type]
    if (!provider) {
      return {
        success: false,
        message: `不支持的通知类型: ${type}`,
        error: 'UNSUPPORTED_TYPE'
      }
    }
    return provider.test(config.url || config.barkUrl)
  }

  /**
   * 获取支持的通知类型列表
   * @returns {Array<{type: string, name: string, description: string}>}
   */
  getSupportedTypes() {
    return [
      {
        type: NotificationType.BARK,
        name: 'Bark',
        description: 'iOS 推送通知',
        placeholder: '例如: https://api.day.app/your_key/{message}'
      },
      // 以后可扩展更多类型
    ]
  }

  /**
   * 检查通知是否已配置
   * @returns {boolean}
   */
  isConfigured() {
    if (!this.config.enabled) return false
    if (this.config.type === NotificationType.BARK) {
      return !!this.config.barkUrl
    }
    return false
  }
}

// 创建默认通知实例
export const notifier = new Notifier()

// 导出便捷函数
export const sendNotification = (message, options) => notifier.send(message, options)
export const sendBarkNotification = (message) => notifier.sendBark(message)
export const testNotification = (type, config) => notifier.test(type, config)

// 导出 Bark 提供者（供直接使用）
export const barkProvider = new BarkProvider()

export default notifier
