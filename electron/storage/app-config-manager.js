/**
 * 应用配置管理器
 * 管理 ~/.ccgui/app.json 文件
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const logger = require('../logger')

/**
 * 应用配置文件路径
 */
function getConfigPath() {
  return path.join(os.homedir(), '.ccgui', 'app.json')
}

/**
 * 默认应用配置
 */
function getDefaultConfig() {
  return {
    version: '1.0.0',
    lastOpenedProjects: [],
    windowStates: {},
    settings: {
      // 软件配置
      theme: 'dark',
      language: 'zh-CN',
      terminalTheme: 'ccgui-dark',
      terminalFontFamily: 'Menlo, Monaco, "Courier New", monospace',
      customTerminalThemeText: '',
      notificationSound: 'Glass',
      chatMessageThemePreset: 'classic',
      chatMessageTheme: {
        avatarMode: 'large',
        statusPosition: 'top',
        statusStyle: 'full',
        messageSurface: 'bubble',
        toolStyle: 'bubble',
        messageSpacing: 'large'
      },
      autoStart: false,
      showNotifications: true,
      shortcutBindings: {
        'toggle-sidebar': 'Mod+B',
        'toggle-project-board': 'Mod+Shift+E',
        'toggle-preview': 'Mod+\\',
        'toggle-file-panel': 'Mod+Shift+F',
        'toggle-terminal': 'Ctrl+`',
        'toggle-chat-panel': 'Mod+Alt+M',
        'open-settings': 'Mod+,',
        'create-primary': 'Mod+N'
      },

      // 模型配置
      claudeModels: [],
      codexModels: [],
      selectedClaudeModelId: null,
      selectedCodexModelId: null,
      selectedClaudeCredentialId: null,
      selectedCodexCredentialId: null,
      codexAccounts: [],
      selectedCodexAccountId: null,
      codexProxy: '',

      // 提示词配置
      prompts: []
    }
  }
}

/**
 * 确保配置目录存在
 */
function ensureConfigDir() {
  const configDir = path.dirname(getConfigPath())
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true })
    logger.info('[AppConfigManager] Created config directory', { path: configDir })
  }
}

/**
 * 读取应用配置
 * @returns {object} 应用配置对象
 */
function loadConfig() {
  try {
    const configPath = getConfigPath()

    // 如果文件不存在,返回默认配置
    if (!fs.existsSync(configPath)) {
      logger.info('[AppConfigManager] Config file not found, using default config')
      return getDefaultConfig()
    }

    // 读取并解析配置文件
    const content = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(content)

    logger.debug('[AppConfigManager] Loaded app config', { configPath })

    // 合并默认配置,确保所有字段都存在
    return migrateModelSettings(deepMerge(getDefaultConfig(), config))
  } catch (error) {
    logger.error('[AppConfigManager] Failed to load config', {
      error: error.message,
      stack: error.stack
    })

    // 出错时返回默认配置
    return getDefaultConfig()
  }
}

function migrateModelSettings(config) {
  const settings = config?.settings
  if (!settings) {
    return config
  }

  if (Array.isArray(settings.models) && settings.models.length > 0 && (!Array.isArray(settings.claudeModels) || settings.claudeModels.length === 0)) {
    settings.claudeModels = settings.models
  }

  if (settings.selectedModelId && !settings.selectedClaudeModelId) {
    settings.selectedClaudeModelId = settings.selectedModelId
  }

  delete settings.models
  delete settings.selectedModelId

  const normalizeModelEntry = (model = {}) => {
    const rawCredentials = Array.isArray(model.credentials) ? model.credentials : []
    const migratedCredentials = rawCredentials.length > 0
      ? rawCredentials
          .map((credential, index) => {
            const token = typeof credential?.token === 'string'
              ? credential.token
              : (typeof credential?.authToken === 'string' ? credential.authToken : '')
            if (!token) return null
            return {
              id: credential?.id || `credential-${index + 1}`,
              name: credential?.name || `令牌 ${index + 1}`,
              token
            }
          })
          .filter(Boolean)
      : (
          typeof model.authToken === 'string' && model.authToken.trim()
            ? [{
                id: model.defaultCredentialId || 'default',
                name: '默认令牌',
                token: model.authToken
              }]
            : []
        )

    const defaultCredentialId = (
      typeof model.defaultCredentialId === 'string' && model.defaultCredentialId.trim()
        ? model.defaultCredentialId.trim()
        : migratedCredentials[0]?.id || null
    )
    const defaultCredential = migratedCredentials.find(credential => credential.id === defaultCredentialId) || migratedCredentials[0] || null

    return {
      ...model,
      credentials: migratedCredentials,
      defaultCredentialId: defaultCredential?.id || null,
      authToken: defaultCredential?.token || ''
    }
  }

  settings.claudeModels = Array.isArray(settings.claudeModels)
    ? settings.claudeModels.map(normalizeModelEntry)
    : []
  settings.codexModels = Array.isArray(settings.codexModels)
    ? settings.codexModels.map(normalizeModelEntry)
    : []

  return config
}

/**
 * 保存应用配置
 * @param {object} config - 配置对象
 * @returns {boolean} 是否保存成功
 */
function saveConfig(config) {
  try {
    ensureConfigDir()

    const configPath = getConfigPath()

    // 验证配置对象
    if (!config || typeof config !== 'object') {
      throw new Error('Invalid config object')
    }

    // 写入配置文件
    const content = JSON.stringify(config, null, 2)
    fs.writeFileSync(configPath, content, 'utf-8')

    logger.info('[AppConfigManager] Saved app config', { configPath })

    return true
  } catch (error) {
    logger.error('[AppConfigManager] Failed to save config', {
      error: error.message,
      stack: error.stack
    })

    return false
  }
}

/**
 * 深度合并对象
 */
function deepMerge(target, source) {
  const result = { ...target }
  for (const key of Object.keys(source)) {
    if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      result[key] = deepMerge(target[key] || {}, source[key])
    } else {
      result[key] = source[key]
    }
  }
  return result
}

/**
 * 更新部分配置
 * @param {object} updates - 要更新的配置项
 * @returns {object} 更新后的配置对象
 */
function updateConfig(updates) {
  try {
    logger.info('[AppConfigManager] updateConfig called with:', JSON.stringify(updates, null, 2))

    let config = loadConfig()

    // 确保 config 存在且有 settings 属性
    if (!config) {
      logger.warn('[AppConfigManager] loadConfig returned null/undefined, using default')
      config = getDefaultConfig()
    }

    if (!config.settings) {
      logger.warn('[AppConfigManager] config.settings is missing, initializing')
      config.settings = getDefaultConfig().settings
    }

    logger.info('[AppConfigManager] Before update, prompts:', config.settings?.prompts)
    logger.info('[AppConfigManager] Updates received, prompts:', updates.settings?.prompts)

    const newConfig = deepMerge(config, updates)
    logger.info('[AppConfigManager] After merge, prompts:', newConfig.settings?.prompts)

    const success = saveConfig(newConfig)
    if (success) {
      return newConfig
    } else {
      throw new Error('Failed to save config')
    }
  } catch (error) {
    logger.error('[AppConfigManager] Failed to update config', {
      error: error.message,
      stack: error.stack
    })
    throw error
  }
}

/**
 * 获取配置项
 * @param {string} key - 配置键名,支持点号分隔的路径 (如 'settings.theme')
 * @param {any} defaultValue - 默认值
 * @returns {any} 配置值
 */
function getConfigValue(key, defaultValue = undefined) {
  try {
    const config = loadConfig()
    const keys = key.split('.')
    let value = config

    for (const k of keys) {
      if (value && typeof value === 'object' && k in value) {
        value = value[k]
      } else {
        return defaultValue
      }
    }

    return value
  } catch (error) {
    logger.error('[AppConfigManager] Failed to get config value', {
      key,
      error: error.message
    })
    return defaultValue
  }
}

/**
 * 设置配置项
 * @param {string} key - 配置键名,支持点号分隔的路径
 * @param {any} value - 配置值
 * @returns {boolean} 是否设置成功
 */
function setConfigValue(key, value) {
  try {
    const config = loadConfig()
    const keys = key.split('.')
    let current = config

    // 遍历到倒数第二个键
    for (let i = 0; i < keys.length - 1; i++) {
      const k = keys[i]
      if (!(k in current) || typeof current[k] !== 'object') {
        current[k] = {}
      }
      current = current[k]
    }

    // 设置最后一个键的值
    current[keys[keys.length - 1]] = value

    return saveConfig(config)
  } catch (error) {
    logger.error('[AppConfigManager] Failed to set config value', {
      key,
      error: error.message
    })
    return false
  }
}

/**
 * 重置配置为默认值
 * @returns {boolean} 是否重置成功
 */
function resetConfig() {
  try {
    const defaultConfig = getDefaultConfig()
    return saveConfig(defaultConfig)
  } catch (error) {
    logger.error('[AppConfigManager] Failed to reset config', {
      error: error.message
    })
    return false
  }
}

// 导出模块
module.exports = {
  getConfigPath,
  getDefaultConfig,
  loadConfig,
  saveConfig,
  updateConfig,
  getConfigValue,
  setConfigValue,
  resetConfig
}
