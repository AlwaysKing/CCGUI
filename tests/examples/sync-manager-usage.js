/**
 * SyncManager 使用示例
 *
 * 这个文件展示如何在 Electron 主进程中使用 SyncManager
 */

const SyncManager = require('./storage/sync-manager')

// 创建 SyncManager 实例
const syncManager = new SyncManager()

// ============================================
// 1. 初始化
// ============================================

// 在应用启动时调用
function initializeApp() {
  // 初始化同步管理器
  const success = syncManager.initialize()

  if (!success) {
    console.error('Failed to initialize SyncManager')
    return false
  }

  console.log('SyncManager initialized successfully')
  return true
}

// ============================================
// 2. 启动时同步
// ============================================

// 应用启动后执行完整同步
async function performStartupSync() {
  try {
    console.log('Performing startup sync...')

    const report = await syncManager.performFullSync()

    console.log('Sync completed:')
    console.log(`  - Projects deleted: ${report.projects.deleted.length}`)
    console.log(`  - Projects imported: ${report.projects.imported.length}`)
    console.log(`  - Projects preserved: ${report.projects.preserved.length}`)
    console.log(`  - Sessions deleted: ${report.sessions.deleted.length}`)
    console.log(`  - Sessions imported: ${report.sessions.imported.length}`)
    console.log(`  - Sessions preserved: ${report.sessions.preserved.length}`)

    if (report.errors.length > 0) {
      console.warn('Sync completed with errors:')
      report.errors.forEach(error => {
        console.warn(`  - ${error.type}: ${error.error}`)
      })
    }

    return report
  } catch (error) {
    console.error('Startup sync failed:', error)
    throw error
  }
}

// ============================================
// 3. 手动触发同步 (IPC Handler)
// ============================================

// 注册 IPC handler 供前端调用
function registerSyncIPC(ipcMain) {
  // 手动触发同步
  ipcMain.handle('sync-with-claude', async () => {
    try {
      const report = await syncManager.performFullSync()
      return {
        success: true,
        report
      }
    } catch (error) {
      return {
        success: false,
        error: error.message
      }
    }
  })

  // 获取同步状态
  ipcMain.handle('get-sync-status', () => {
    return syncManager.getSyncStatus()
  })
}

// ============================================
// 4. 完整集成示例
// ============================================

/**
 * 在 electron/main.cjs 中的集成步骤:
 *
 * 1. 导入 SyncManager:
 *    const SyncManager = require('./storage/sync-manager')
 *
 * 2. 创建实例 (在文件顶部):
 *    const syncManager = new SyncManager()
 *
 * 3. 在 app.whenReady() 中初始化和同步:
 *
 *    app.whenReady().then(async () => {
 *      // 初始化同步管理器
 *      syncManager.initialize()
 *
 *      // 执行启动同步
 *      const report = await syncManager.performFullSync()
 *
 *      // 记录同步结果
 *      logger.info('[App] Startup sync completed', {
 *        projectsImported: report.projects.imported.length,
 *        projectsDeleted: report.projects.deleted.length,
 *        sessionsImported: report.sessions.imported.length,
 *        sessionsDeleted: report.sessions.deleted.length
 *      })
 *
 *      // 创建窗口
 *      createWindow()
 *    })
 *
 * 4. 注册 IPC handlers (在 IPC 注册部分):
 *    registerSyncIPC(ipcMain)
 */

// ============================================
// 5. 前端调用示例
// ============================================

/**
 * 在 Vue 组件中调用同步:
 *
 * // 手动触发同步
 * async function triggerSync() {
 *   try {
 *     const result = await window.electronAPI.syncWithClaude()
 *
 *     if (result.success) {
 *       console.log('Sync successful:', result.report)
 *       // 更新项目列表
 *       await loadProjects()
 *     } else {
 *       console.error('Sync failed:', result.error)
 *     }
 *   } catch (error) {
 *     console.error('Sync error:', error)
 *   }
 * }
 *
 * // 获取同步状态
 * async function checkSyncStatus() {
 *   const status = await window.electronAPI.getSyncStatus()
 *   console.log('Sync status:', status)
 * }
 */

module.exports = {
  initializeApp,
  performStartupSync,
  registerSyncIPC
}
