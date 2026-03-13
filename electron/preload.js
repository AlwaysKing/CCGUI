const { contextBridge, ipcRenderer } = require('electron')

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
  stopClaude: (options) => ipcRenderer.invoke('stop-claude', options),

  // Start session (initialize Claude process without sending message)
  startSession: (options) => ipcRenderer.invoke('start-session', options),

  // Listen to session events (统一的事件通道 - 新架构推荐使用)
  // 回调函数接收: { sessionId, eventType, data }
  onSessionEvent: (callback) => {
    const listener = (event, data) => callback(data)
    ipcRenderer.on('session-event', listener)
    return () => ipcRenderer.removeListener('session-event', listener)
  },

  // ============================================
  // Legacy Event APIs (向后兼容)
  // 这些 API 仍然可用，但新代码应该使用 onSessionEvent
  // ============================================

  onClaudeMessage: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('claude-message', listener)
    return () => ipcRenderer.removeListener('claude-message', listener)
  },

  onClaudeResult: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('claude-result', listener)
    return () => ipcRenderer.removeListener('claude-result', listener)
  },

  onClaudeInit: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('claude-init', listener)
    return () => ipcRenderer.removeListener('claude-init', listener)
  },

  onSystemMessage: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('system-message', listener)
    return () => ipcRenderer.removeListener('system-message', listener)
  },

  onToolUse: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('tool-use', listener)
    return () => ipcRenderer.removeListener('tool-use', listener)
  },

  onToolResult: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('tool-result', listener)
    return () => ipcRenderer.removeListener('tool-result', listener)
  },

  onToolUseRequest: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('tool-use-request', listener)
    return () => ipcRenderer.removeListener('tool-use-request', listener)
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

  onStreamEvent: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('stream-event', listener)
    return () => ipcRenderer.removeListener('stream-event', listener)
  },

  onUnknownMessage: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('unknown-message', listener)
    return () => ipcRenderer.removeListener('unknown-message', listener)
  },

  // Legacy APIs
  getClaudeInfo: (options) => ipcRenderer.invoke('get-claude-info', options),
  getInitInfo: () => ipcRenderer.invoke('get-init-info'),
  isClaudeReady: (options) => ipcRenderer.invoke('is-claude-ready', options),
  sendToolResult: (options) => ipcRenderer.invoke('send-tool-result', options),

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

  // Platform info
  platform: process.platform,
  nodeVersion: process.version,

  // ============================================
  // Logging API (前端日志打印到后端终端)
  // ============================================
  log: (...args) => ipcRenderer.send('frontend-log', args),

  // ============================================
  // File Logging API (新的文件日志系统)
  // ============================================
  ensureLogDir: (options) => ipcRenderer.invoke('ensure-log-dir', options),
  writeAppLog: (options) => ipcRenderer.invoke('write-app-log', options),
  writeStreamLog: (options) => ipcRenderer.invoke('write-stream-log', options),

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
  sendNotification: (options) => ipcRenderer.invoke('send-notification', options)
})
