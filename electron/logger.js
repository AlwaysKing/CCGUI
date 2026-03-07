/**
 * 后端日志模块
 * 用于 Electron 主进程的日志记录
 */

const fs = require('fs')
const path = require('path')
const os = require('os')

/**
 * 日志级别
 */
const LogLevel = {
  DEBUG: 'DEBUG',
  INFO: 'INFO',
  WARN: 'WARN',
  ERROR: 'ERROR',
}

/**
 * 日志配置
 */
const config = {
  baseDir: '/tmp/ccgui',
  appLogFile: 'app.log',
  streamLogDir: 'stream',
  maxFileSize: 10 * 1024 * 1024, // 10MB
  maxFiles: 5
}

/**
 * 确保目录存在
 */
function ensureDir(dirPath) {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true })
  }
}

/**
 * 获取日志文件路径
 */
function getAppLogPath() {
  return path.join(config.baseDir, config.appLogFile)
}

/**
 * 获取流日志文件路径
 */
function getStreamLogPath(sessionId) {
  return path.join(config.baseDir, config.streamLogDir, `${sessionId}.log`)
}

/**
 * 初始化日志系统
 */
function initialize() {
  try {
    // 创建应用程序日志目录
    ensureDir(path.dirname(getAppLogPath()))

    // 创建流日志目录
    ensureDir(path.join(config.baseDir, config.streamLogDir))

    console.log(`[Logger] Log system initialized at ${config.baseDir}`)
    return true
  } catch (error) {
    console.error('[Logger] Failed to initialize:', error)
    return false
  }
}

/**
 * 格式化日志条目
 */
function formatLogEntry(level, message, data = null) {
  const timestamp = new Date().toISOString()
  const entry = {
    timestamp,
    level,
    message,
    data: data !== null && data !== undefined ? data : undefined
  }
  return JSON.stringify(entry)
}

/**
 * 写入应用程序日志
 */
function writeAppLog(level, message, data = null) {
  try {
    const entry = formatLogEntry(level, message, data)
    const logPath = getAppLogPath()

    // 确保目录存在
    ensureDir(path.dirname(logPath))

    fs.appendFileSync(logPath, entry + '\n')

    // 同时输出到控制台
    const consoleMethod = {
      [LogLevel.DEBUG]: console.debug,
      [LogLevel.INFO]: console.info,
      [LogLevel.WARN]: console.warn,
      [LogLevel.ERROR]: console.error,
    }[level] || console.log

    consoleMethod(`[${level}] ${message}`, data || '')

    return true
  } catch (error) {
    console.error('[Logger] Failed to write app log:', error)
    return false
  }
}

/**
 * 写入数据流日志
 */
function writeStreamLog(sessionId, direction, data) {
  try {
    const timestamp = new Date().toISOString()
    const entry = {
      timestamp,
      sessionId,
      direction,
      data
    }
    const entryStr = JSON.stringify(entry)
    const logPath = getStreamLogPath(sessionId)

    // 确保目录存在
    ensureDir(path.dirname(logPath))

    fs.appendFileSync(logPath, entryStr + '\n')
    return true
  } catch (error) {
    console.error('[Logger] Failed to write stream log:', error)
    return false
  }
}

/**
 * 便捷方法
 */
function debug(message, data = null) {
  return writeAppLog(LogLevel.DEBUG, message, data)
}

function info(message, data = null) {
  return writeAppLog(LogLevel.INFO, message, data)
}

function warn(message, data = null) {
  return writeAppLog(LogLevel.WARN, message, data)
}

function error(message, data = null) {
  return writeAppLog(LogLevel.ERROR, message, data)
}

function logSend(sessionId, data) {
  return writeStreamLog(sessionId, 'send', data)
}

function logReceive(sessionId, data) {
  return writeStreamLog(sessionId, 'receive', data)
}

// 导出模块
module.exports = {
  LogLevel,
  config,
  initialize,
  debug,
  info,
  warn,
  error,
  logSend,
  logReceive,
  writeAppLog,
  writeStreamLog,
  getAppLogPath,
  getStreamLogPath
}