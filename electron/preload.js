const { contextBridge, ipcRenderer } = require('electron')

let appQuitting = false

ipcRenderer.on('app-before-quit', () => {
  appQuitting = true
})

process.once('loaded', () => {
  const nativeAlert = window.alert?.bind(window)
  const nativeConfirm = window.confirm?.bind(window)

  window.alert = (...args) => {
    if (appQuitting) {
      console.warn('[Preload] Suppressed alert during app shutdown:', args[0] || '')
      return
    }
    return nativeAlert?.(...args)
  }

  window.confirm = (...args) => {
    if (appQuitting) {
      console.warn('[Preload] Suppressed confirm during app shutdown:', args[0] || '')
      return false
    }
    return nativeConfirm?.(...args) ?? false
  }
})

/**
 * Preload script
 * Exposes secure APIs to the renderer process
 *
 * 新架构：所有会话相关的通信都通过 session-event 统一通道
 * 同时保留旧 API 以保持向后兼容
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // ============================================
  // Session Instance APIs (新架构)
  // ============================================

  // Select/Activate a session - creates SessionInstance and returns state
  selectSession: (options) => ipcRenderer.invoke('select-session', options),

  // Get session state
  getSessionState: (options) => ipcRenderer.invoke('get-session-state', options),

  // Update session UI state (sync input state, etc.)
  updateSessionUIState: (options) => ipcRenderer.invoke('update-session-ui-state', options),

  // Send message (will start Claude instance if not running)
  sendMessage: (options) => ipcRenderer.invoke('send-message', options),

  // Send control response (for permission prompts)
  sendControlResponse: (options) => ipcRenderer.invoke('send-control-response', options),

  // Send interrupt request
  sendInterrupt: (options) => ipcRenderer.invoke('send-interrupt', options),

  // Send control request (主动请求，如切换权限模式)
  sendControlRequest: (options) => ipcRenderer.invoke('send-control-request', options),

  // Set permission mode
  setPermissionMode: (options) => ipcRenderer.invoke('set-permission-mode', options),

  // Close session
  closeSession: (options) => ipcRenderer.invoke('close-session', options),

  // Stop Claude process (keep session alive for restart)
  stopSessionRuntime: (options) => ipcRenderer.invoke('stop-session-runtime', options),

  // Start session (initialize runtime process without sending message)
  startSession: (options) => ipcRenderer.invoke('start-session', options),

  // Listen to session events (统一的事件通道 - 新架构推荐使用)
  // 回调函数接收: { sessionId, eventType, data }
  onSessionEvent: (callback) => {
    const listener = (event, data) => callback(data)
    ipcRenderer.on('session-event', listener)
    return () => ipcRenderer.removeListener('session-event', listener)
  },

  onSystemMessage: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('system-message', listener)
    return () => ipcRenderer.removeListener('system-message', listener)
  },

  onControlRequest: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('control-request', listener)
    return () => ipcRenderer.removeListener('control-request', listener)
  },

  onControlResponse: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('control-response', listener)
    return () => ipcRenderer.removeListener('control-response', listener)
  },

  onInterrupt: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('interrupt', listener)
    return () => ipcRenderer.removeListener('interrupt', listener)
  },

  onCliStatus: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('cli-status', listener)
    return () => ipcRenderer.removeListener('cli-status', listener)
  },

  onUnknownMessage: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('unknown-message', listener)
    return () => ipcRenderer.removeListener('unknown-message', listener)
  },

  getRuntimeInfo: (options) => ipcRenderer.invoke('get-runtime-info', options),
  getRuntimeInitInfo: () => ipcRenderer.invoke('get-runtime-init-info'),
  isRuntimeReady: (options) => ipcRenderer.invoke('is-runtime-ready', options),
  sendRuntimeToolResult: (options) => ipcRenderer.invoke('send-runtime-tool-result', options),

  // ============================================
  // Project & Session Management APIs
  // ============================================

  getProjects: () => ipcRenderer.invoke('get-projects'),
  addProject: (options) => ipcRenderer.invoke('add-project', options),
  removeProject: (options) => ipcRenderer.invoke('remove-project', options),
  renameProject: (options) => ipcRenderer.invoke('rename-project', options),
  getSessions: (options) => ipcRenderer.invoke('get-sessions', options),
  createSession: (options) => ipcRenderer.invoke('create-session', options),
  deleteSession: (options) => ipcRenderer.invoke('delete-session', options),
  openSession: (options) => ipcRenderer.invoke('open-session', options),
  renameSession: (options) => ipcRenderer.invoke('rename-session', options),
  getSessionMessages: (options) => ipcRenderer.invoke('get-session-messages', options),
  getRunningSessions: () => ipcRenderer.invoke('get-running-sessions'),
  openProjectInNewWindow: (options) => ipcRenderer.invoke('open-project-in-new-window', options),
  checkProjectExists: (options) => ipcRenderer.invoke('check-project-exists', options),
  selectDirectory: () => ipcRenderer.invoke('select-directory'),
  updateWindowTitle: (options) => ipcRenderer.invoke('update-window-title', options),
  listProjectFiles: (options) => ipcRenderer.invoke('list-project-files', options),
  getProjectGitStatus: (options) => ipcRenderer.invoke('get-project-git-status', options),
  watchProjectFiles: (options) => ipcRenderer.invoke('watch-project-files', options),
  unwatchProjectFiles: () => ipcRenderer.invoke('unwatch-project-files'),
  statProjectEntry: (options) => ipcRenderer.invoke('stat-project-entry', options),
  getProjectFileGitBase: (options) => ipcRenderer.invoke('get-project-file-git-base', options),
  readProjectFile: (options) => ipcRenderer.invoke('read-project-file', options),
  writeProjectFile: (options) => ipcRenderer.invoke('write-project-file', options),
  createProjectEntry: (options) => ipcRenderer.invoke('create-project-entry', options),
  renameProjectEntry: (options) => ipcRenderer.invoke('rename-project-entry', options),
  deleteProjectEntry: (options) => ipcRenderer.invoke('delete-project-entry', options),
  openProjectEntryInFinder: (options) => ipcRenderer.invoke('open-project-entry-in-finder', options),
  createTerminal: (options) => ipcRenderer.invoke('create-terminal', options),
  writeTerminal: (options) => ipcRenderer.invoke('write-terminal', options),
  resizeTerminal: (options) => ipcRenderer.invoke('resize-terminal', options),
  closeTerminal: (options) => ipcRenderer.invoke('close-terminal', options),

  // ============================================
  // Project Config API
  // ============================================
  getProjectConfig: (options) => ipcRenderer.invoke('get-project-config', options),
  updateProjectConfig: (options) => ipcRenderer.invoke('update-project-config', options),

  // ============================================
  // Session Config API
  // ============================================
  getSessionConfig: (options) => ipcRenderer.invoke('get-session-config', options),
  updateSessionConfig: (options) => ipcRenderer.invoke('update-session-config', options),
  deleteSessionConfig: (options) => ipcRenderer.invoke('delete-session-config', options),
  copySession: (options) => ipcRenderer.invoke('copy-session', options),

  // Platform info
  platform: process.platform,
  nodeVersion: process.version,
  isAppQuitting: () => appQuitting,

  // ============================================
  // Logging API (前端日志打印到后端终端)
  // ============================================
  log: (...args) => ipcRenderer.send('frontend-log', args),

  // ============================================
  // File Logging API (新的文件日志系统)
  // ============================================
  ensureLogDir: (options) => ipcRenderer.invoke('ensure-log-dir', options),
  writeAppLog: (options) => ipcRenderer.invoke('write-app-log', options),

  // ============================================
  // App Config API
  // ============================================
  getAppConfig: () => ipcRenderer.invoke('get-app-config'),
  saveAppConfig: (options) => ipcRenderer.invoke('save-app-config', options),
  updateAppConfig: (options) => ipcRenderer.invoke('update-app-config', options),

  // ============================================
  // Claude Settings API (from ~/.claude/settings.json)
  // ============================================
  getClaudeSettings: () => ipcRenderer.invoke('get-claude-settings'),
  updateClaudeSettings: (options) => ipcRenderer.invoke('update-claude-settings', options),

  // ============================================
  // Codex Settings API (from ~/.codex/config.toml)
  // ============================================
  getCodexSettings: () => ipcRenderer.invoke('get-codex-settings'),
  updateCodexSettings: (options) => ipcRenderer.invoke('update-codex-settings', options),
  syncCodexModelProviders: () => ipcRenderer.invoke('sync-codex-model-providers'),
  loadCodexAuthTokens: () => ipcRenderer.invoke('load-codex-auth-tokens'),
  applyCodexAccount: (options) => ipcRenderer.invoke('apply-codex-account', options),
  getCodexUsageStatus: (options) => ipcRenderer.invoke('get-codex-usage-status', options),
  refreshCodexAuthToken: () => ipcRenderer.invoke('refresh-codex-auth-token'),

  // ============================================
  // Docs API (规范文档)
  // ============================================
  listDocs: () => ipcRenderer.invoke('list-docs'),
  getDoc: (options) => ipcRenderer.invoke('get-doc', options),
  saveDoc: (options) => ipcRenderer.invoke('save-doc', options),
  renameDoc: (options) => ipcRenderer.invoke('rename-doc', options),
  deleteDoc: (options) => ipcRenderer.invoke('delete-doc', options),

  // ============================================
  // Notification API
  // ============================================
  sendNotification: (options) => ipcRenderer.invoke('send-notification', options),
  playSystemSound: (options) => ipcRenderer.invoke('play-system-sound', options)
})

contextBridge.exposeInMainWorld('electronEvents', {
  onProjectFilesChanged: (callback) => {
    const listener = (event, payload) => callback(payload)
    ipcRenderer.on('project-files-changed', listener)
    return () => ipcRenderer.removeListener('project-files-changed', listener)
  },
  onTerminalData: (callback) => {
    const listener = (event, payload) => callback(payload)
    ipcRenderer.on('terminal-data', listener)
    return () => ipcRenderer.removeListener('terminal-data', listener)
  },
  onTerminalExit: (callback) => {
    const listener = (event, payload) => callback(payload)
    ipcRenderer.on('terminal-exit', listener)
    return () => ipcRenderer.removeListener('terminal-exit', listener)
  },
  onTerminalStatus: (callback) => {
    const listener = (event, payload) => callback(payload)
    ipcRenderer.on('terminal-status', listener)
    return () => ipcRenderer.removeListener('terminal-status', listener)
  }
})
