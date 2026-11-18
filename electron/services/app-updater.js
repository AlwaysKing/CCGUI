const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile, spawn } = require('child_process')
const { promisify } = require('util')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
const logger = require('../logger')
const {
  getDownloadInfo,
  getVersionFromTag,
  isNewerVersion,
  requestLatestRelease
} = require('./version-check')

const APPLICATIONS_DIR = '/Applications'
const DOWNLOAD_IDLE_TIMEOUT_MS = 2 * 60 * 1000
const execFileAsync = promisify(execFile)

function getAppBundlePath(executablePath) {
  if (!executablePath) {
    return ''
  }

  const macOsDir = path.dirname(path.resolve(executablePath))
  const appBundlePath = path.resolve(macOsDir, '..', '..')
  return path.extname(appBundlePath).toLowerCase() === '.app' ? appBundlePath : ''
}

function getTargetAppPath(appBundlePath) {
  const appName = path.basename(appBundlePath || '')
  if (!appName || path.extname(appName).toLowerCase() !== '.app') {
    throw new Error('无法识别当前应用目录')
  }
  return path.join(APPLICATIONS_DIR, appName)
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function buildInstallScript({
  pid,
  sourceAppPath,
  targetAppPath,
  workDir
}) {
  const numericPid = Number(pid)
  if (!Number.isSafeInteger(numericPid) || numericPid <= 0) {
    throw new Error('更新进程 PID 无效')
  }

  const backupPath = `${targetAppPath}.backup-${numericPid}`
  return `#!/bin/sh
set -u

if [ "\${1:-}" != "--daemon" ]; then
  /usr/bin/nohup /bin/sh "$0" --daemon >/dev/null 2>&1 &
  exit 0
fi

APP_PID=${numericPid}
SOURCE=${shellQuote(sourceAppPath)}
TARGET=${shellQuote(targetAppPath)}
BACKUP=${shellQuote(backupPath)}
WORK_DIR=${shellQuote(workDir)}

notify_failure() {
  /usr/bin/osascript -e 'display dialog "CCGUI 更新安装失败，已尝试保留或恢复旧版本。" buttons {"确定"} default button "确定" with icon stop' >/dev/null 2>&1 || true
}

WAIT_COUNT=0
while /bin/kill -0 "$APP_PID" >/dev/null 2>&1; do
  /bin/sleep 0.2
  WAIT_COUNT=$((WAIT_COUNT + 1))
  if [ "$WAIT_COUNT" -ge 300 ]; then
    notify_failure
    /bin/rm -rf "$WORK_DIR"
    exit 1
  fi
done

/bin/rm -rf "$BACKUP"
if [ -e "$TARGET" ]; then
  if ! /bin/mv "$TARGET" "$BACKUP"; then
    notify_failure
    /bin/rm -rf "$WORK_DIR"
    exit 1
  fi
fi

if /usr/bin/ditto "$SOURCE" "$TARGET"; then
  /usr/bin/xattr -dr com.apple.quarantine "$TARGET" >/dev/null 2>&1 || true
  if ! /usr/bin/open "$TARGET"; then
    /usr/bin/osascript -e 'display dialog "CCGUI 已更新，但自动打开失败。请手动从“应用程序”中启动。" buttons {"确定"} default button "确定" with icon caution' >/dev/null 2>&1 || true
  fi
  /bin/rm -rf "$BACKUP" "$WORK_DIR"
  exit 0
fi

/bin/rm -rf "$TARGET"
if [ -e "$BACKUP" ]; then
  /bin/mv "$BACKUP" "$TARGET"
fi
notify_failure
/bin/rm -rf "$WORK_DIR"
exit 1
`
}

async function calculateSha256(filePath) {
  const hash = crypto.createHash('sha256')
  await pipeline(fs.createReadStream(filePath), hash)
  return hash.digest('hex')
}

async function runCommand(command, args, options = {}) {
  return execFileAsync(command, args, {
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    ...options
  })
}

async function downloadArchive({
  url,
  zipPath,
  expectedSize = 0,
  onProgress = () => {},
  fetchImpl = globalThis.fetch,
  timeoutMs = DOWNLOAD_IDLE_TIMEOUT_MS
}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('当前运行环境不支持下载')
  }
  const parsedUrl = new URL(url)
  if (parsedUrl.protocol !== 'https:') {
    throw new Error('更新包下载地址不安全')
  }

  const controller = new AbortController()
  let timedOut = false
  let timeoutId = null
  const resetTimeout = () => {
    clearTimeout(timeoutId)
    timeoutId = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)
  }
  resetTimeout()
  try {
    const response = await fetchImpl(url, {
      headers: {
        Accept: 'application/octet-stream',
        'User-Agent': 'CCGUI-app-updater'
      },
      redirect: 'follow',
      signal: controller.signal
    })
    if (!response.ok) {
      throw new Error(`下载更新包失败（HTTP ${response.status}）`)
    }
    if (!response.body) {
      throw new Error('更新包响应为空')
    }

    const totalBytes = expectedSize || Number(response.headers?.get?.('content-length')) || 0
    let downloadedBytes = 0
    let lastPercent = -1
    const source = typeof response.body.getReader === 'function'
      ? Readable.fromWeb(response.body)
      : response.body

    source.on('data', chunk => {
      resetTimeout()
      downloadedBytes += chunk.length
      const percent = totalBytes > 0
        ? Math.min(100, Math.floor((downloadedBytes / totalBytes) * 100))
        : null
      if (percent !== lastPercent) {
        lastPercent = percent
        onProgress({
          stage: 'downloading',
          progress: percent,
          downloadedBytes,
          totalBytes,
          message: totalBytes > 0
            ? `正在下载更新包 ${percent}%`
            : '正在下载更新包...'
        })
      }
    })

    await pipeline(source, fs.createWriteStream(zipPath))
    onProgress({
      stage: 'downloading',
      progress: 100,
      downloadedBytes,
      totalBytes: totalBytes || downloadedBytes,
      message: '更新包下载完成'
    })
  } catch (error) {
    if (timedOut) {
      throw new Error('下载更新包超时')
    }
    throw error
  } finally {
    clearTimeout(timeoutId)
  }
}

function findExtractedApp(extractDir, expectedAppName) {
  const expectedPath = path.join(extractDir, expectedAppName)
  if (fs.existsSync(expectedPath) && fs.statSync(expectedPath).isDirectory()) {
    return expectedPath
  }

  const candidate = fs.readdirSync(extractDir, { withFileTypes: true })
    .find(entry => entry.isDirectory() && entry.name.toLowerCase().endsWith('.app'))
  return candidate ? path.join(extractDir, candidate.name) : ''
}

function formatUpdateError(error) {
  const stderr = String(error?.stderr || '').trim()
  return (stderr || error?.message || '更新安装失败').slice(0, 600)
}

async function installUpdate({
  currentVersion,
  expectedVersion,
  appBundlePath,
  isPackaged,
  platform = process.platform,
  arch = process.arch,
  pid = process.pid,
  progress = () => {},
  fetchImpl = globalThis.fetch,
  downloadImpl = downloadArchive,
  runCommandImpl = runCommand,
  spawnImpl = spawn
} = {}) {
  let workDir = ''
  try {
    if (platform !== 'darwin') {
      throw new Error('自动更新仅支持 macOS')
    }
    if (!isPackaged) {
      throw new Error('开发模式不能自动安装更新')
    }
    if (!appBundlePath) {
      throw new Error('无法识别当前应用目录')
    }

    const targetAppPath = getTargetAppPath(appBundlePath)
    try {
      fs.accessSync(APPLICATIONS_DIR, fs.constants.W_OK)
    } catch {
      throw new Error('当前用户没有 /Applications 写入权限')
    }

    const release = await requestLatestRelease({ fetchImpl })
    const latestVersion = getVersionFromTag(release?.tag_name)
    const normalizedExpectedVersion = String(expectedVersion || '').trim().replace(/^v/i, '')
    if (!latestVersion || latestVersion !== normalizedExpectedVersion) {
      throw new Error('最新版本已发生变化，请重新打开更新窗口')
    }
    if (!isNewerVersion(latestVersion, currentVersion)) {
      throw new Error('当前已是最新版本')
    }

    const download = getDownloadInfo(release, arch)
    if (!download) {
      throw new Error(`最新版本没有可用的 ${arch} ZIP 安装包`)
    }
    const archiveFileName = path.basename(download.fileName || '')
    if (path.extname(archiveFileName).toLowerCase() !== '.zip') {
      throw new Error('更新包文件名无效')
    }

    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-update-'))
    const zipPath = path.join(workDir, archiveFileName)
    const extractDir = path.join(workDir, 'extracted')
    fs.mkdirSync(extractDir, { recursive: true })

    progress({
      stage: 'downloading',
      progress: 0,
      downloadedBytes: 0,
      totalBytes: download.size,
      message: '正在下载更新包...'
    })
    await downloadImpl({
      url: download.url,
      zipPath,
      expectedSize: download.size,
      onProgress: progress,
      fetchImpl
    })

    const zipStat = fs.statSync(zipPath)
    if (download.size > 0 && zipStat.size !== download.size) {
      throw new Error('更新包大小校验失败')
    }
    if (download.sha256) {
      progress({ stage: 'verifying', progress: 100, message: '正在校验更新包...' })
      const actualSha256 = await calculateSha256(zipPath)
      if (actualSha256.toLowerCase() !== download.sha256.toLowerCase()) {
        throw new Error('更新包 SHA256 校验失败')
      }
    }

    progress({ stage: 'extracting', message: '正在解压应用...' })
    await runCommandImpl('/usr/bin/ditto', ['-x', '-k', zipPath, extractDir], {
      timeout: 2 * 60 * 1000
    })

    const extractedAppPath = findExtractedApp(extractDir, path.basename(targetAppPath))
    if (!extractedAppPath) {
      throw new Error('更新包中未找到应用')
    }

    progress({ stage: 'signing', message: '正在重新签名应用...' })
    await runCommandImpl('/usr/bin/codesign', ['-f', '-s', '-', extractedAppPath], {
      timeout: 2 * 60 * 1000
    })
    progress({ stage: 'verifying', message: '正在验证应用签名...' })
    await runCommandImpl('/usr/bin/codesign', ['--verify', '--deep', '--strict', extractedAppPath], {
      timeout: 2 * 60 * 1000
    })

    const scriptPath = path.join(workDir, 'install-update.sh')
    const installScript = buildInstallScript({
      pid,
      sourceAppPath: extractedAppPath,
      targetAppPath,
      workDir
    })
    fs.writeFileSync(scriptPath, installScript, { encoding: 'utf8', mode: 0o755 })

    progress({ stage: 'installing', message: '正在准备替换应用...' })
    const child = spawnImpl('/bin/sh', [scriptPath], {
      detached: true,
      stdio: 'ignore'
    })
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', code => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error('更新脚本启动失败'))
        }
      })
    })
    child.unref()

    progress({ stage: 'restarting', message: '更新已准备完成，正在重新启动...' })
    logger.info('[AppUpdater] Update prepared', {
      currentVersion,
      latestVersion,
      targetAppPath,
      workDir
    })
    return {
      success: true,
      restarting: true,
      latestVersion
    }
  } catch (error) {
    if (workDir) {
      fs.rmSync(workDir, { recursive: true, force: true })
    }
    const message = formatUpdateError(error)
    logger.warn('[AppUpdater] Update failed', { error: message })
    return { success: false, error: message }
  }
}

module.exports = {
  APPLICATIONS_DIR,
  buildInstallScript,
  calculateSha256,
  downloadArchive,
  getAppBundlePath,
  getTargetAppPath,
  installUpdate
}
