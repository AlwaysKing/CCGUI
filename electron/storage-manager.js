/**
 * StorageManager - 存储系统主控制器
 * 负责初始化存储目录结构,协调各个子模块,提供统一的 API
 */

const fs = require('fs').promises
const path = require('path')
const os = require('os')
const logger = require('./logger')

/**
 * 存储配置
 */
const STORAGE_CONFIG = {
  baseDir: '.ccgui',
  projectsDir: 'projects',
  appConfigFile: 'app.json'
}

/**
 * StorageManager 类
 */
class StorageManager {
  constructor() {
    this.initialized = false
    this.basePath = null
    this.projectsPath = null
    this.appConfigPath = null

    // 子模块实例(将在后续实现)
    this.appConfigManager = null
    this.projectConfigManager = null
    this.sessionConfigManager = null
    this.historyManager = null
    this.syncManager = null
  }

  /**
   * 初始化存储系统
   * @returns {Promise<boolean>}
   */
  async initialize() {
    try {
      logger.info('[StorageManager] Initializing storage system...')

      // 设置基础路径
      this.basePath = path.join(os.homedir(), STORAGE_CONFIG.baseDir)
      this.projectsPath = path.join(this.basePath, STORAGE_CONFIG.projectsDir)
      this.appConfigPath = path.join(this.basePath, STORAGE_CONFIG.appConfigFile)

      logger.info('[StorageManager] Base path:', this.basePath)

      // 创建目录结构
      await this.ensureDirectoryStructure()

      // 初始化子模块(将在后续实现)
      // await this.initializeSubModules()

      this.initialized = true
      logger.info('[StorageManager] Storage system initialized successfully')

      return true
    } catch (error) {
      logger.error('[StorageManager] Failed to initialize storage system:', error)
      throw error
    }
  }

  /**
   * 确保目录结构存在
   * @returns {Promise<void>}
   */
  async ensureDirectoryStructure() {
    try {
      // 创建基础目录
      await this.ensureDir(this.basePath)
      logger.info('[StorageManager] Created base directory:', this.basePath)

      // 创建 projects 目录
      await this.ensureDir(this.projectsPath)
      logger.info('[StorageManager] Created projects directory:', this.projectsPath)

      // 初始化 app.json (如果不存在)
      await this.initializeAppConfig()
    } catch (error) {
      logger.error('[StorageManager] Failed to ensure directory structure:', error)
      throw error
    }
  }

  /**
   * 确保目录存在
   * @param {string} dirPath - 目录路径
   * @returns {Promise<void>}
   */
  async ensureDir(dirPath) {
    try {
      await fs.access(dirPath)
    } catch (error) {
      if (error.code === 'ENOENT') {
        await fs.mkdir(dirPath, { recursive: true })
        logger.info('[StorageManager] Created directory:', dirPath)
      } else {
        throw error
      }
    }
  }

  /**
   * 初始化应用配置文件
   * @returns {Promise<void>}
   */
  async initializeAppConfig() {
    try {
      await fs.access(this.appConfigPath)
      logger.info('[StorageManager] App config already exists')
    } catch (error) {
      if (error.code === 'ENOENT') {
        const defaultConfig = {
          version: '1.0.0',
          lastOpenedProjects: [],
          windowStates: {},
          settings: {
            theme: 'dark',
            language: 'zh-CN',
            autoStart: false,
            showNotifications: true,
            systemPrompt: '',
            models: [],
            selectedModelId: null
          }
        }

        await fs.writeFile(
          this.appConfigPath,
          JSON.stringify(defaultConfig, null, 2),
          'utf-8'
        )
        logger.info('[StorageManager] Created default app config')
      } else {
        throw error
      }
    }
  }

  /**
   * 读取应用配置
   * @returns {Promise<Object>}
   */
  async loadAppConfig() {
    try {
      const content = await fs.readFile(this.appConfigPath, 'utf-8')
      return JSON.parse(content)
    } catch (error) {
      logger.error('[StorageManager] Failed to load app config:', error)
      throw error
    }
  }

  /**
   * 保存应用配置
   * @param {Object} config - 配置对象
   * @returns {Promise<void>}
   */
  async saveAppConfig(config) {
    try {
      await fs.writeFile(
        this.appConfigPath,
        JSON.stringify(config, null, 2),
        'utf-8'
      )
      logger.info('[StorageManager] App config saved successfully')
    } catch (error) {
      logger.error('[StorageManager] Failed to save app config:', error)
      throw error
    }
  }

  /**
   * 获取基础存储路径
   * @returns {string}
   */
  getBasePath() {
    if (!this.initialized) {
      throw new Error('StorageManager not initialized')
    }
    return this.basePath
  }

  /**
   * 获取项目存储路径
   * @returns {string}
   */
  getProjectsPath() {
    if (!this.initialized) {
      throw new Error('StorageManager not initialized')
    }
    return this.projectsPath
  }

  /**
   * 获取应用配置文件路径
   * @returns {string}
   */
  getAppConfigPath() {
    if (!this.initialized) {
      throw new Error('StorageManager not initialized')
    }
    return this.appConfigPath
  }

  /**
   * 获取特定项目的路径
   * @param {string} encodedProjectName - 编码后的项目名称
   * @returns {string}
   */
  getProjectPath(encodedProjectName) {
    if (!this.initialized) {
      throw new Error('StorageManager not initialized')
    }
    return path.join(this.projectsPath, encodedProjectName)
  }

  /**
   * 获取特定项目配置文件路径
   * @param {string} encodedProjectName - 编码后的项目名称
   * @returns {string}
   */
  getProjectConfigPath(encodedProjectName) {
    return path.join(this.getProjectPath(encodedProjectName), 'project.json')
  }

  /**
   * 获取特定会话的路径
   * @param {string} encodedProjectName - 编码后的项目名称
   * @param {string} sessionId - 会话 ID
   * @returns {string}
   */
  getSessionPath(encodedProjectName, sessionId) {
    return path.join(this.getProjectPath(encodedProjectName), 'sessions', sessionId)
  }

  /**
   * 获取特定会话配置文件路径
   * @param {string} encodedProjectName - 编码后的项目名称
   * @param {string} sessionId - 会话 ID
   * @returns {string}
   */
  getSessionConfigPath(encodedProjectName, sessionId) {
    return path.join(this.getSessionPath(encodedProjectName, sessionId), 'session.json')
  }

  /**
   * 获取会话历史目录路径
   * @param {string} encodedProjectName - 编码后的项目名称
   * @param {string} sessionId - 会话 ID
   * @returns {string}
   */
  getHistoryPath(encodedProjectName, sessionId) {
    return path.join(this.getSessionPath(encodedProjectName, sessionId), 'history')
  }

  /**
   * 获取会话消息文件路径
   * @param {string} encodedProjectName - 编码后的项目名称
   * @param {string} sessionId - 会话 ID
   * @returns {string}
   */
  getMessagesPath(encodedProjectName, sessionId) {
    return path.join(this.getHistoryPath(encodedProjectName, sessionId), 'messages.jsonl')
  }

  /**
   * 获取会话元数据文件路径
   * @param {string} encodedProjectName - 编码后的项目名称
   * @param {string} sessionId - 会话 ID
   * @returns {string}
   */
  getMetadataPath(encodedProjectName, sessionId) {
    return path.join(this.getHistoryPath(encodedProjectName, sessionId), 'metadata.json')
  }

  /**
   * 确保项目目录存在
   * @param {string} encodedProjectName - 编码后的项目名称
   * @returns {Promise<void>}
   */
  async ensureProjectDir(encodedProjectName) {
    const projectPath = this.getProjectPath(encodedProjectName)
    const sessionsPath = path.join(projectPath, 'sessions')

    await this.ensureDir(projectPath)
    await this.ensureDir(sessionsPath)

    logger.info('[StorageManager] Ensured project directory:', encodedProjectName)
  }

  /**
   * 确保会话目录存在
   * @param {string} encodedProjectName - 编码后的项目名称
   * @param {string} sessionId - 会话 ID
   * @returns {Promise<void>}
   */
  async ensureSessionDir(encodedProjectName, sessionId) {
    const sessionPath = this.getSessionPath(encodedProjectName, sessionId)
    const historyPath = this.getHistoryPath(encodedProjectName, sessionId)

    await this.ensureDir(sessionPath)
    await this.ensureDir(historyPath)

    logger.info('[StorageManager] Ensured session directory:', sessionId)
  }

  /**
   * 检查是否已初始化
   * @returns {boolean}
   */
  isInitialized() {
    return this.initialized
  }

  /**
   * 获取存储统计信息
   * @returns {Promise<Object>}
   */
  async getStorageStats() {
    try {
      const stats = {
        basePath: this.basePath,
        projectsPath: this.projectsPath,
        appConfigPath: this.appConfigPath,
        initialized: this.initialized
      }

      // 获取项目列表
      const projectDirs = await fs.readdir(this.projectsPath)
      stats.projectCount = projectDirs.length
      stats.projects = []

      // 统计每个项目的信息
      for (const projectName of projectDirs) {
        const projectPath = this.getProjectPath(projectName)
        const sessionsPath = path.join(projectPath, 'sessions')

        try {
          const sessionDirs = await fs.readdir(sessionsPath)
          stats.projects.push({
            name: projectName,
            sessionCount: sessionDirs.length
          })
        } catch (error) {
          // sessions 目录可能不存在
          stats.projects.push({
            name: projectName,
            sessionCount: 0
          })
        }
      }

      return stats
    } catch (error) {
      logger.error('[StorageManager] Failed to get storage stats:', error)
      throw error
    }
  }
}

// 导出单例实例
const storageManager = new StorageManager()

module.exports = {
  StorageManager,
  storageManager,
  STORAGE_CONFIG
}
