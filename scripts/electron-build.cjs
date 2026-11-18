const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
const {
  getBundleVersion,
  resolveBuildVersion
} = require('./build-version.cjs')

const buildVersion = resolveBuildVersion()
const bundleVersion = getBundleVersion(buildVersion)
const env = {
  ...process.env,
  CCGUI_BUILD_VERSION: buildVersion,
  CCGUI_BUNDLE_VERSION: bundleVersion
}
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'
const electronBuilder = path.join(
  __dirname,
  '..',
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'
)
const appIconPath = path.join(__dirname, '..', 'resource', 'icon.icns')

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: path.join(__dirname, '..'),
    env,
    stdio: 'inherit'
  })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1)
  }
}

console.log(`[build] version=${buildVersion} bundleVersion=${bundleVersion}`)
if (!fs.existsSync(appIconPath)) {
  console.error(`[build] Missing app icon: ${appIconPath}`)
  process.exit(1)
}
run(npmCommand, ['run', 'build'])
run(electronBuilder, [
  `--config.extraMetadata.version=${bundleVersion}`,
  `--config.buildVersion=${bundleVersion}`,
  `--config.mac.bundleShortVersion=${bundleVersion}`,
  '--config.mac.artifactName=${productName}-${env.CCGUI_BUILD_VERSION}-${arch}.${ext}',
  ...process.argv.slice(2)
])
