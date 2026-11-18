const assert = require('assert')
const { spawnSync } = require('child_process')
const fs = require('fs')
const os = require('os')
const path = require('path')

function inspectProfile(profile) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `ccgui-${profile}-profile-`))
  try {
    const result = spawnSync(process.execPath, ['-e', `
      const paths = require('./electron/runtime-paths')
      const appConfig = require('./electron/storage/app-config-manager')
      const { DEFAULT_PROXY_PORT } = require('./electron/services/local-proxy')
      console.log(JSON.stringify({
        profile: paths.getProfile(),
        home: paths.getCcguiHome(),
        logDir: paths.getLogDir(),
        proxyPort: paths.getDefaultProxyPort(),
        localProxyPort: DEFAULT_PROXY_PORT,
        configPath: appConfig.getConfigPath(),
        configPort: appConfig.getDefaultConfig().settings.proxyPort
      }))
    `], {
      cwd: path.resolve(__dirname, '..'),
      env: {
        ...process.env,
        CCGUI_PROFILE: profile,
        CCGUI_HOME: home
      },
      encoding: 'utf8'
    })

    assert.strictEqual(result.status, 0, result.stderr)
    return JSON.parse(result.stdout.trim())
  } finally {
    fs.rmSync(home, { recursive: true, force: true })
  }
}

const mainProfile = inspectProfile('main')
assert.deepStrictEqual({
  profile: mainProfile.profile,
  logDir: mainProfile.logDir,
  proxyPort: mainProfile.proxyPort,
  localProxyPort: mainProfile.localProxyPort,
  configPort: mainProfile.configPort
}, {
  profile: 'main',
  logDir: '/tmp/ccgui',
  proxyPort: 18921,
  localProxyPort: 18921,
  configPort: 18921
})
assert.strictEqual(mainProfile.home, mainProfile.configPath.replace(/\/app\.json$/, ''))

const debugProfile = inspectProfile('debug')
assert.deepStrictEqual({
  profile: debugProfile.profile,
  logDir: debugProfile.logDir,
  proxyPort: debugProfile.proxyPort,
  localProxyPort: debugProfile.localProxyPort,
  configPort: debugProfile.configPort
}, {
  profile: 'debug',
  logDir: '/tmp/ccgui-dev',
  proxyPort: 18921,
  localProxyPort: 18921,
  configPort: 18921
})
assert.strictEqual(debugProfile.home, debugProfile.configPath.replace(/\/app\.json$/, ''))

function inspectDefaultHome(profile, home) {
  const result = spawnSync(process.execPath, ['-e', `
    const paths = require('./electron/runtime-paths')
    console.log(paths.getCcguiHome())
  `], {
    cwd: path.resolve(__dirname, '..'),
    env: {
      ...process.env,
      HOME: home,
      CCGUI_PROFILE: profile,
      CCGUI_HOME: ''
    },
    encoding: 'utf8'
  })
  assert.strictEqual(result.status, 0, result.stderr)
  return result.stdout.trim()
}

const sharedHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-shared-home-'))
try {
  const expectedHome = path.join(sharedHome, '.ccgui')
  assert.strictEqual(inspectDefaultHome('main', sharedHome), expectedHome)
  assert.strictEqual(inspectDefaultHome('debug', sharedHome), expectedHome)
} finally {
  fs.rmSync(sharedHome, { recursive: true, force: true })
}

console.log('runtime-path tests passed')
