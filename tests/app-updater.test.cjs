const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawn } = require('child_process')
const {
  buildInstallScript,
  calculateSha256,
  getAppBundlePath,
  getTargetAppPath,
  installUpdate
} = require('../electron/services/app-updater')

assert.strictEqual(
  getAppBundlePath('/Applications/CCGUI.app/Contents/MacOS/CCGUI'),
  '/Applications/CCGUI.app'
)
assert.strictEqual(
  getAppBundlePath('/Users/test/Code/Electron.app/Contents/MacOS/Electron'),
  '/Users/test/Code/Electron.app'
)
assert.strictEqual(getAppBundlePath('/Applications/CCGUI'), '')
assert.strictEqual(getTargetAppPath('/Applications/CCGUI.app'), '/Applications/CCGUI.app')

const script = buildInstallScript({
  pid: 4321,
  sourceAppPath: "/tmp/ccgui update/CCGUI's.app",
  targetAppPath: '/Applications/CCGUI.app',
  workDir: '/tmp/ccgui-update-test'
})

assert.match(script, /APP_PID=4321/)
assert.match(script, /while \/bin\/kill -0 "\$APP_PID"/)
assert.match(script, /\/usr\/bin\/ditto "\$SOURCE" "\$TARGET"/)
assert.match(script, /\/usr\/bin\/open "\$TARGET"/)
assert.match(script, /CCGUI'\\''s\.app/)
assert.match(script, /\/Applications\/CCGUI\.app\.backup-4321/)
assert.doesNotMatch(script, /CCGUI_UPDATE_DAEMON/)
assert.match(script, /\/usr\/bin\/nohup \/bin\/sh "\$0" --daemon/)

async function run() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-app-updater-test-'))
  try {
    const filePath = path.join(tempDir, 'archive.zip')
    fs.writeFileSync(filePath, 'ccgui updater test')
    const expectedHash = crypto.createHash('sha256').update('ccgui updater test').digest('hex')
    assert.strictEqual(await calculateSha256(filePath), expectedHash)

    const scriptPath = path.join(tempDir, 'install-update.sh')
    fs.writeFileSync(scriptPath, script)
    execFileSync('/bin/sh', ['-n', scriptPath])

    const applicationsDir = path.join(tempDir, 'Applications')
    const workDir = path.join(tempDir, 'update-work')
    const sourceAppPath = path.join(workDir, 'CCGUI.app')
    const targetAppPath = path.join(applicationsDir, 'CCGUI.app')
    fs.mkdirSync(sourceAppPath, { recursive: true })
    fs.mkdirSync(targetAppPath, { recursive: true })
    fs.writeFileSync(path.join(sourceAppPath, 'version.txt'), 'new-version')
    fs.writeFileSync(path.join(targetAppPath, 'version.txt'), 'old-version')

    const waitProcess = spawn('/bin/sleep', ['1'], { stdio: 'ignore' })
    const waitExitPromise = new Promise((resolve, reject) => {
      waitProcess.once('exit', resolve)
      waitProcess.once('error', reject)
    })
    const replaceScriptPath = path.join(workDir, 'install-update.sh')
    const replaceScript = buildInstallScript({
      pid: waitProcess.pid,
      sourceAppPath,
      targetAppPath,
      workDir
    })
      .replaceAll('/usr/bin/open', '/usr/bin/true')
      .replaceAll('/usr/bin/osascript', '/usr/bin/true')
    fs.writeFileSync(replaceScriptPath, replaceScript, { mode: 0o755 })

    await new Promise(resolve => setTimeout(resolve, 100))
    const helperProcess = spawn('/bin/sh', [replaceScriptPath], {
      stdio: 'ignore',
      env: { ...process.env, CCGUI_UPDATE_DAEMON: '1' }
    })
    const helperExitCode = await new Promise((resolve, reject) => {
      helperProcess.once('error', reject)
      helperProcess.once('exit', resolve)
    })
    await waitExitPromise
    const updateDeadline = Date.now() + 5000
    let targetUpdated = false
    while (!targetUpdated && Date.now() < updateDeadline) {
      try {
        targetUpdated = fs.readFileSync(path.join(targetAppPath, 'version.txt'), 'utf8') === 'new-version'
      } catch {}
      if (targetUpdated) {
        break
      }
      await new Promise(resolve => setTimeout(resolve, 50))
    }
    const cleanupDeadline = Date.now() + 5000
    while (
      (fs.existsSync(`${targetAppPath}.backup-${waitProcess.pid}`) || fs.existsSync(workDir)) &&
      Date.now() < cleanupDeadline
    ) {
      await new Promise(resolve => setTimeout(resolve, 50))
    }

    assert.strictEqual(helperExitCode, 0)
    assert.strictEqual(targetUpdated, true)
    assert.strictEqual(fs.existsSync(`${targetAppPath}.backup-${waitProcess.pid}`), false)
    assert.strictEqual(fs.existsSync(workDir), false)

    const failedWorkDir = path.join(tempDir, 'failed-update-work')
    const failedTargetAppPath = path.join(applicationsDir, 'Failed.app')
    fs.mkdirSync(failedWorkDir, { recursive: true })
    fs.mkdirSync(failedTargetAppPath, { recursive: true })
    fs.writeFileSync(path.join(failedTargetAppPath, 'version.txt'), 'old-version')
    const failedWaitProcess = spawn('/bin/sleep', ['1'], { stdio: 'ignore' })
    const failedWaitExitPromise = new Promise((resolve, reject) => {
      failedWaitProcess.once('exit', resolve)
      failedWaitProcess.once('error', reject)
    })
    const failedScriptPath = path.join(failedWorkDir, 'install-update.sh')
    const failedScript = buildInstallScript({
      pid: failedWaitProcess.pid,
      sourceAppPath: path.join(failedWorkDir, 'missing.app'),
      targetAppPath: failedTargetAppPath,
      workDir: failedWorkDir
    })
      .replaceAll('/usr/bin/open', '/usr/bin/true')
      .replaceAll('/usr/bin/osascript', '/usr/bin/true')
    fs.writeFileSync(failedScriptPath, failedScript, { mode: 0o755 })
    const failedHelperProcess = spawn('/bin/sh', [failedScriptPath, '--daemon'], {
      stdio: 'ignore',
      env: { ...process.env, CCGUI_UPDATE_DAEMON: '1' }
    })
    const failedHelperExitCode = await new Promise((resolve, reject) => {
      failedHelperProcess.once('error', reject)
      failedHelperProcess.once('exit', resolve)
    })
    await failedWaitExitPromise

    assert.strictEqual(failedHelperExitCode, 1)
    assert.strictEqual(
      fs.readFileSync(path.join(failedTargetAppPath, 'version.txt'), 'utf8'),
      'old-version'
    )
    assert.strictEqual(fs.existsSync(`${failedTargetAppPath}.backup-${failedWaitProcess.pid}`), false)
    assert.strictEqual(fs.existsSync(failedWorkDir), false)

    const devResult = await installUpdate({
      currentVersion: '1.0.0',
      expectedVersion: '1.0.1',
      appBundlePath: '/Applications/CCGUI.app',
      isPackaged: false,
      platform: 'darwin'
    })
    assert.strictEqual(devResult.success, false)
    assert.strictEqual(devResult.error, '开发模式不能自动安装更新')
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }

  console.log('app-updater tests passed')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
