/**
 * SyncManager 集成示例
 *
 * 这个文件展示如何将 SyncManager 集成到 electron/main.cjs
 */

// ============================================
// 步骤 1: 导入 SyncManager
// ============================================

// 在 electron/main.cjs 文件顶部添加:
const SyncManager = require('./storage/sync-manager')

// 创建全局实例
let syncManager

// ============================================
// 步骤 2: 在 app.whenReady() 中初始化和同步
// ============================================

// 修改 app.whenReady() 如下:
app.whenReady().then(async () => {
  // 初始化日志系统
  logger.initialize()

  // 创建 SyncManager 实例
  syncManager = new SyncManager()

  // 初始化同步管理器
  const initSuccess = syncManager.initialize()
  if (!initSuccess) {
    logger.error('[Main] Failed to initialize SyncManager')
  }

  // 执行启动同步
  try {
    const report = await syncManager.performFullSync()

    logger.info('[Main] Startup sync completed', {
      projectsImported: report.projects.imported.length,
      projectsDeleted: report.projects.deleted.length,
      sessionsImported: report.sessions.imported.length,
      sessionsDeleted: report.sessions.deleted.length,
      errors: report.errors.length
    })

    // 如果有错误,记录详细信息
    if (report.errors.length > 0) {
      logger.warn('[Main] Sync completed with errors', {
        errors: report.errors
      })
    }
  } catch (error) {
    logger.error('[Main] Startup sync failed', { error: error.message })
  }

  // 初始化 Session Manager
  initSessionManager()

  // 创建窗口
  createWindow()

  logger.info('[Main] Application ready')
})

// ============================================
// 步骤 3: 注册 IPC Handlers
// ============================================

// 在 IPC handlers 部分添加:

// 手动触发同步
ipcMain.handle('sync-with-claude', async () => {
  try {
    if (!syncManager) {
      throw new Error('SyncManager not initialized')
    }

    logger.info('[Main] Manual sync triggered')

    const report = await syncManager.performFullSync()

    logger.info('[Main] Manual sync completed', {
      projectsImported: report.projects.imported.length,
      projectsDeleted: report.projects.deleted.length,
      errors: report.errors.length
    })

    return {
      success: true,
      report
    }
  } catch (error) {
    logger.error('[Main] Manual sync failed', { error: error.message })
    return {
      success: false,
      error: error.message
    }
  }
})

// 获取同步状态
ipcMain.handle('get-sync-status', () => {
  try {
    if (!syncManager) {
      throw new Error('SyncManager not initialized')
    }

    const status = syncManager.getSyncStatus()
    return {
      success: true,
      status
    }
  } catch (error) {
    logger.error('[Main] Failed to get sync status', { error: error.message })
    return {
      success: false,
      error: error.message
    }
  }
})

// ============================================
// 步骤 4: 在 preload.js 中暴露 API
// ============================================

// 在 electron/preload.js 的 contextBridge.exposeInMainWorld 中添加:
contextBridge.exposeInMainWorld('electronAPI', {
  // ... 其他 API

  // 同步相关
  syncWithClaude: () => ipcRenderer.invoke('sync-with-claude'),
  getSyncStatus: () => ipcRenderer.invoke('get-sync-status')
})

// ============================================
// 步骤 5: 在前端使用
// ============================================

// 在 Vue 组件中:
/*
async function handleManualSync() {
  try {
    const result = await window.electronAPI.syncWithClaude()

    if (result.success) {
      console.log('同步成功:', result.report)

      // 显示同步结果
      const { projects, sessions } = result.report
      alert(`
        同步完成!
        导入项目: ${projects.imported.length}
        删除项目: ${projects.deleted.length}
        导入会话: ${sessions.imported.length}
        删除会话: ${sessions.deleted.length}
      `)

      // 刷新项目列表
      await loadProjects()
    } else {
      console.error('同步失败:', result.error)
      alert('同步失败: ' + result.error)
    }
  } catch (error) {
    console.error('同步出错:', error)
    alert('同步出错: ' + error.message)
  }
}

async function checkSyncStatus() {
  try {
    const result = await window.electronAPI.getSyncStatus()

    if (result.success) {
      console.log('同步状态:', result.status)
    }
  } catch (error) {
    console.error('获取状态失败:', error)
  }
}
*/

module.exports = {
  // 这个文件仅作为示例,不需要导出任何内容
}
