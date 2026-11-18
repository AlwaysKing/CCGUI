const os = require('os')
const path = require('path')

const MAIN_PROFILE = 'main'
const DEBUG_PROFILE = 'debug'
const PROFILE = process.env.CCGUI_PROFILE === DEBUG_PROFILE ? DEBUG_PROFILE : MAIN_PROFILE
const DATA_DIRECTORY = '.ccgui'
const DEFAULT_PROXY_PORT = 18921
const LOG_DIRECTORY = PROFILE === DEBUG_PROFILE ? '/tmp/ccgui-dev' : '/tmp/ccgui'

function getProfile() {
  return PROFILE
}

function getCcguiHome() {
  const configuredHome = typeof process.env.CCGUI_HOME === 'string'
    ? process.env.CCGUI_HOME.trim()
    : ''
  return configuredHome || path.join(os.homedir(), DATA_DIRECTORY)
}

function getCcguiPath(...segments) {
  return path.join(getCcguiHome(), ...segments)
}

function getDefaultProxyPort() {
  return DEFAULT_PROXY_PORT
}

function getLogDir() {
  return LOG_DIRECTORY
}

module.exports = {
  MAIN_PROFILE,
  DEBUG_PROFILE,
  getProfile,
  getCcguiHome,
  getCcguiPath,
  getDefaultProxyPort,
  getLogDir
}
