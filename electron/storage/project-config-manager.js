/**
 * 项目配置管理器
 * 管理 ~/.ccgui/projects/{projectId}/project.json
 */

const fs = require('fs')
const path = require('path')
const os = require('os')
const logger = require('../logger')

/**
 * 获取项目配置根目录
 */
function getProjectsRoot() {
  return path.join(os.homedir(), '.ccgui', 'projects')
}

/**
 * 获取项目配置文件路径
 * @param {string} projectId - 项目ID (编码后的路径)
 */
function getProjectConfigPath(projectId) {
  return path.join(getProjectsRoot(), projectId, 'project.json')
}

/**
 * 确保项目目录存在
 * @param {string} projectId - 项目ID
 */
function ensureProjectDir(projectId) {
  const projectDir = path.join(getProjectsRoot(), projectId)
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true })
    logger.info('[ProjectConfigManager] Created project directory', { projectId })
  }
}

/**
 * 创建默认项目配置
 * @param {string} projectId - 项目ID
 * @param {string} projectPath - 项目路径
 * @param {string} name - 项目名称
 */
function createDefaultProjectConfig(projectId, projectPath, name) {
  return {
    id: projectId,
    name: name || path.basename(projectPath),
    path: projectPath,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    sessionCount: 0,
    settings: {}
  }
}

/**
 * 加载项目配置
 * @param {string} projectId - 项目ID
 * @returns {object|null} 项目配置对象,不存在时返回 null
 */
function loadProjectConfig(projectId) {
  try {
    const configPath = getProjectConfigPath(projectId)

    if (!fs.existsSync(configPath)) {
      logger.debug('[ProjectConfigManager] Config file not found', { projectId })
      return null
    }

    const content = fs.readFileSync(configPath, 'utf-8')
    const config = JSON.parse(content)

    logger.debug('[ProjectConfigManager] Loaded project config', { projectId })
    return config
  } catch (error) {
    logger.error('[ProjectConfigManager] Failed to load project config', {
      projectId,
      error: error.message
    })
    return null
  }
}

/**
 * 保存项目配置
 * @param {string} projectId - 项目ID
 * @param {object} config - 项目配置对象
 * @returns {boolean} 保存是否成功
 */
function saveProjectConfig(projectId, config) {
  try {
    ensureProjectDir(projectId)

    const configPath = getProjectConfigPath(projectId)
    config.updatedAt = new Date().toISOString()

    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8')

    logger.info('[ProjectConfigManager] Saved project config', { projectId })
    return true
  } catch (error) {
    logger.error('[ProjectConfigManager] Failed to save project config', {
      projectId,
      error: error.message
    })
    return false
  }
}

/**
 * 创建项目配置
 * @param {string} projectId - 项目ID
 * @param {string} projectPath - 项目路径
 * @param {string} name - 项目名称
 * @returns {object} 创建的项目配置
 */
function createProjectConfig(projectId, projectPath, name) {
  const config = createDefaultProjectConfig(projectId, projectPath, name)

  if (saveProjectConfig(projectId, config)) {
    logger.info('[ProjectConfigManager] Created project config', { projectId, name })
    return config
  } else {
    throw new Error('Failed to create project config')
  }
}

/**
 * 更新项目配置
 * @param {string} projectId - 项目ID
 * @param {object} updates - 要更新的字段
 * @returns {object|null} 更新后的配置,失败返回 null
 */
function updateProjectConfig(projectId, updates) {
  try {
    const config = loadProjectConfig(projectId)

    if (!config) {
      logger.warn('[ProjectConfigManager] Project config not found for update', { projectId })
      return null
    }

    // 合并更新
    const updatedConfig = { ...config, ...updates }

    if (saveProjectConfig(projectId, updatedConfig)) {
      logger.info('[ProjectConfigManager] Updated project config', { projectId })
      return updatedConfig
    } else {
      return null
    }
  } catch (error) {
    logger.error('[ProjectConfigManager] Failed to update project config', {
      projectId,
      error: error.message
    })
    return null
  }
}

/**
 * 删除项目配置
 * @param {string} projectId - 项目ID
 * @returns {boolean} 删除是否成功
 */
function deleteProjectConfig(projectId) {
  try {
    const projectDir = path.join(getProjectsRoot(), projectId)

    if (fs.existsSync(projectDir)) {
      fs.rmSync(projectDir, { recursive: true })
      logger.info('[ProjectConfigManager] Deleted project config', { projectId })
      return true
    }

    return false
  } catch (error) {
    logger.error('[ProjectConfigManager] Failed to delete project config', {
      projectId,
      error: error.message
    })
    return false
  }
}

/**
 * 获取所有项目列表
 * @returns {Array} 项目配置数组
 */
function getAllProjects() {
  try {
    const projectsRoot = getProjectsRoot()

    if (!fs.existsSync(projectsRoot)) {
      logger.debug('[ProjectConfigManager] Projects root does not exist')
      return []
    }

    const projectDirs = fs.readdirSync(projectsRoot, { withFileTypes: true })
      .filter(entry => entry.isDirectory())
      .map(entry => entry.name)

    const projects = []
    for (const projectId of projectDirs) {
      const config = loadProjectConfig(projectId)
      if (config) {
        projects.push(config)
      }
    }

    logger.debug('[ProjectConfigManager] Loaded all projects', { count: projects.length })
    return projects
  } catch (error) {
    logger.error('[ProjectConfigManager] Failed to get all projects', {
      error: error.message
    })
    return []
  }
}

/**
 * 检查项目是否存在
 * @param {string} projectId - 项目ID
 * @returns {boolean}
 */
function projectExists(projectId) {
  const configPath = getProjectConfigPath(projectId)
  return fs.existsSync(configPath)
}

module.exports = {
  getProjectsRoot,
  getProjectConfigPath,
  loadProjectConfig,
  saveProjectConfig,
  createProjectConfig,
  updateProjectConfig,
  deleteProjectConfig,
  getAllProjects,
  projectExists
}
