const { contextBridge, ipcRenderer } = require('electron')

/**
 * Preload script
 * Exposes secure APIs to the renderer process
 */
contextBridge.exposeInMainWorld('electronAPI', {
  // Send message to Claude
  sendMessage: (message) => ipcRenderer.invoke('send-message', message),

  // Listen to Claude messages
  onClaudeMessage: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('claude-message', listener)
    // Return unsubscribe function
    return () => ipcRenderer.removeListener('claude-message', listener)
  },

  // Listen to Claude results
  onClaudeResult: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('claude-result', listener)
    return () => ipcRenderer.removeListener('claude-result', listener)
  },

  // Listen to Claude initialization
  onClaudeInit: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('claude-init', listener)
    return () => ipcRenderer.removeListener('claude-init', listener)
  },

  // Listen to system messages
  onSystemMessage: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('system-message', listener)
    return () => ipcRenderer.removeListener('system-message', listener)
  },

  // Listen to tool use messages
  onToolUse: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('tool-use', listener)
    return () => ipcRenderer.removeListener('tool-use', listener)
  },

  // Listen to tool results
  onToolResult: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('tool-result', listener)
    return () => ipcRenderer.removeListener('tool-result', listener)
  },

  // Get Claude info
  getClaudeInfo: () => ipcRenderer.invoke('get-claude-info'),

  // Check if Claude is ready
  isClaudeReady: () => ipcRenderer.invoke('is-claude-ready'),

  // Send tool result (for permission approval)
  sendToolResult: (toolUseId, content, isError) => ipcRenderer.invoke('send-tool-result', toolUseId, content, isError),

  // Send control response (for --permission-prompt-tool stdio permission approval)
  sendControlResponse: (requestId, approved, options) => ipcRenderer.invoke('send-control-response', requestId, approved, options),

  // Listen to tool_use requests (for permission dialog)
  onToolUseRequest: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('tool-use-request', listener)
    return () => ipcRenderer.removeListener('tool-use-request', listener)
  },

  // Listen to control_request (for --permission-prompt-tool stdio)
  onControlRequest: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('control-request', listener)
    return () => ipcRenderer.removeListener('control-request', listener)
  },

  // Listen to CLI status messages (connection status, retries, errors, etc.)
  onCliStatus: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('cli-status', listener)
    return () => ipcRenderer.removeListener('cli-status', listener)
  },

  // Listen to stream events (thinking_delta, text_delta, etc.)
  onStreamEvent: (callback) => {
    const listener = (event, message) => callback(message)
    ipcRenderer.on('stream-event', listener)
    return () => ipcRenderer.removeListener('stream-event', listener)
  },

  // Platform info
  platform: process.platform,

  // Node version
  nodeVersion: process.version
})
