const assert = require('assert')
const {
  checkForNewVersion,
  getDownloadInfo,
  getVersionFromTag,
  isNewerVersion
} = require('../electron/services/version-check')

assert.strictEqual(isNewerVersion('v2026.11.18.83', '2026.11.18.82'), true)
assert.strictEqual(isNewerVersion('2026.11.19.0', '2026.11.18.999'), true)
assert.strictEqual(isNewerVersion('2026.11.18.82', '2026.11.18.82'), false)
assert.strictEqual(isNewerVersion('2026.11.18.81', '2026.11.18.82'), false)
assert.strictEqual(isNewerVersion('invalid', '2026.11.18.82'), false)
assert.strictEqual(getVersionFromTag('v2026.11.18.82'), '2026.11.18.82')
assert.strictEqual(getVersionFromTag('release-2026.11.18.82'), '')

async function run() {
  let requestedUrl = ''
  const result = await checkForNewVersion({
    currentVersion: '2026.11.18.82',
    fetchImpl: async (url) => {
      requestedUrl = url
      return {
        ok: true,
        status: 200,
        json: async () => ({
          tag_name: 'v2026.11.18.83',
          html_url: 'https://github.com/AlwaysKing/CCGUI/releases/tag/v2026.11.18.83',
          assets: [
            {
              name: 'CCGUI-2026.11.18.83-arm64.zip',
              size: 1024,
              digest: 'sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
              url: 'https://api.github.com/repos/AlwaysKing/CCGUI/releases/assets/123',
              browser_download_url: 'https://github.com/AlwaysKing/CCGUI/releases/download/v2026.11.18.83/CCGUI-2026.11.18.83-arm64.zip'
            }
          ]
        })
      }
    }
  })

  assert.strictEqual(requestedUrl, 'https://api.github.com/repos/AlwaysKing/CCGUI/releases/latest')
  assert.strictEqual(result.success, true)
  assert.strictEqual(result.hasNewVersion, true)
  assert.strictEqual(result.latestVersion, '2026.11.18.83')
  assert.strictEqual(result.download.fileName, 'CCGUI-2026.11.18.83-arm64.zip')
  assert.strictEqual(result.download.size, 1024)
  assert.strictEqual(result.download.sha256, 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
  assert.strictEqual(result.download.url, 'https://api.github.com/repos/AlwaysKing/CCGUI/releases/assets/123')

  const downloadInfo = getDownloadInfo({
    assets: [
      { name: 'CCGUI-test-x64.zip', browser_download_url: 'x64' },
      { name: 'CCGUI-test-arm64.zip', browser_download_url: 'arm64' }
    ]
  }, 'arm64')
  assert.strictEqual(downloadInfo.url, 'arm64')
  assert.strictEqual(getDownloadInfo({ assets: [] }, 'arm64'), null)

  const failed = await checkForNewVersion({
    currentVersion: '2026.11.18.82',
    fetchImpl: async () => {
      throw new Error('network unavailable')
    }
  })
  assert.strictEqual(failed.success, false)
  assert.strictEqual(failed.error, 'network unavailable')

  console.log('version-check tests passed')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
