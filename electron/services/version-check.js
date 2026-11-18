const logger = require('../logger')

const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/AlwaysKing/CCGUI/releases/latest'
const LATEST_RELEASE_PAGE_URL = 'https://github.com/AlwaysKing/CCGUI/releases/latest'
const REQUEST_TIMEOUT_MS = 10000

function getDownloadInfo(release, arch = process.arch) {
  const assets = Array.isArray(release?.assets) ? release.assets : []
  const suffix = `-${String(arch || '').toLowerCase()}.zip`
  const asset = assets.find(item => {
    const name = String(item?.name || '').toLowerCase()
    return name.endsWith(suffix) && (item?.url || item?.browser_download_url)
  })
  if (!asset) {
    return null
  }

  const digest = String(asset.digest || '').trim()
  return {
    fileName: asset.name,
    url: asset.url || asset.browser_download_url,
    size: Number(asset.size) || 0,
    sha256: digest.toLowerCase().startsWith('sha256:')
      ? digest.slice('sha256:'.length)
      : (/^[a-f0-9]{64}$/i.test(digest) ? digest : '')
  }
}

function parseVersion(version) {
  const normalized = String(version || '').trim().replace(/^v/i, '')
  if (!/^\d+(?:\.\d+)*$/.test(normalized)) {
    return null
  }
  return normalized.split('.').map(Number)
}

function isNewerVersion(latestVersion, currentVersion) {
  const latestParts = parseVersion(latestVersion)
  const currentParts = parseVersion(currentVersion)
  if (!latestParts || !currentParts) {
    return false
  }

  const length = Math.max(latestParts.length, currentParts.length)
  for (let index = 0; index < length; index += 1) {
    const latest = latestParts[index] || 0
    const current = currentParts[index] || 0
    if (latest !== current) {
      return latest > current
    }
  }
  return false
}

function getVersionFromTag(tagName) {
  const normalized = String(tagName || '').trim().replace(/^v/i, '')
  return parseVersion(normalized) ? normalized : ''
}

async function requestLatestRelease({
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new Error('当前运行环境不支持网络请求')
  }

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(LATEST_RELEASE_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'CCGUI-release-check',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      signal: controller.signal
    })
    if (!response.ok) {
      throw new Error(`GitHub Releases 请求失败（HTTP ${response.status}）`)
    }
    return await response.json()
  } finally {
    clearTimeout(timeoutId)
  }
}

async function checkForNewVersion({
  currentVersion,
  arch = process.arch,
  fetchImpl = globalThis.fetch,
  timeoutMs = REQUEST_TIMEOUT_MS
} = {}) {
  try {
    const normalizedCurrentVersion = String(currentVersion || '').trim().replace(/^v/i, '')
    if (!parseVersion(normalizedCurrentVersion)) {
      return { success: false, error: '当前版本号格式无效' }
    }

    const release = await requestLatestRelease({ fetchImpl, timeoutMs })
    const latestVersion = getVersionFromTag(release?.tag_name)
    if (!latestVersion) {
      return { success: false, error: 'GitHub Release 版本号格式无效' }
    }

    return {
      success: true,
      hasNewVersion: isNewerVersion(latestVersion, normalizedCurrentVersion),
      currentVersion: normalizedCurrentVersion,
      latestVersion,
      releaseUrl: release?.html_url || LATEST_RELEASE_PAGE_URL,
      download: getDownloadInfo(release, arch)
    }
  } catch (error) {
    logger.warn('[VersionCheck] 检查新版本失败', { error: error.message })
    return { success: false, error: error.message || '检查新版本失败' }
  }
}

module.exports = {
  LATEST_RELEASE_API_URL,
  LATEST_RELEASE_PAGE_URL,
  REQUEST_TIMEOUT_MS,
  checkForNewVersion,
  getDownloadInfo,
  getVersionFromTag,
  isNewerVersion,
  parseVersion,
  requestLatestRelease
}
