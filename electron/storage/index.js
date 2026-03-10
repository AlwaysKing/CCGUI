/**
 * 存储系统统一导出
 */

const appConfigManager = require('./app-config-manager')
const projectConfigManager = require('./project-config-manager')
const sessionConfigManager = require('./session-config-manager')
const historyManager = require('./history-manager')
const syncManager = require('./sync-manager')
const docsManager = require('./docs-manager')

module.exports = {
  appConfigManager,
  projectConfigManager,
  sessionConfigManager,
  historyManager,
  syncManager,
  docsManager
}
