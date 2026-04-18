const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')
const logger = require('../logger')
const appConfigManager = require('../storage/app-config-manager')

function getCodexExecutablePath() {
  const possiblePaths = [
    '/Applications/Codex.app/Contents/Resources/codex',
    '/opt/homebrew/bin/codex',
    '/usr/local/bin/codex',
    path.join(os.homedir(), '.local', 'bin', 'codex')
  ]

  return possiblePaths.find(candidate => fs.existsSync(candidate)) || null
}

async function withCodexAppServer(run, options = {}) {
  const codexPath = getCodexExecutablePath()
  if (!codexPath) {
    throw new Error('Codex executable not found')
  }

  let child = null
  let rl = null
  const pending = new Map()
  let requestId = 0

  try {
    const appConfig = appConfigManager.loadConfig()
    const proxyUrl = appConfig.settings?.codexProxy || ''
    const codexEnv = {
      ...process.env
    }

    if (proxyUrl) {
      codexEnv.HTTP_PROXY = proxyUrl
      codexEnv.HTTPS_PROXY = proxyUrl
      codexEnv.ALL_PROXY = proxyUrl
    }

    child = spawn(codexPath, ['app-server', '--listen', 'stdio://'], {
      cwd: options.cwd || process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: codexEnv
    })

    const readline = require('readline')
    rl = readline.createInterface({ input: child.stdout })

    const send = (payload) => {
      child.stdin.write(JSON.stringify(payload) + '\n')
    }

    const request = (method, params) => {
      const id = String(++requestId)
      send({ id, method, params })
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject })
        setTimeout(() => {
          if (!pending.has(id)) return
          pending.delete(id)
          reject(new Error(`Codex request timeout: ${method}`))
        }, options.timeoutMs || 15000)
      })
    }

    rl.on('line', (line) => {
      if (!line.trim()) return

      let message = null
      try {
        message = JSON.parse(line)
      } catch {
        return
      }

      if (message.id === undefined) return

      const key = String(message.id)
      const entry = pending.get(key)
      if (!entry) return
      pending.delete(key)

      if (message.error) {
        entry.reject(new Error(message.error.message || 'Codex request failed'))
      } else {
        entry.resolve(message.result)
      }
    })

    await request('initialize', {
      clientInfo: { name: options.clientName || 'ccgui', version: '1.0.0' },
      capabilities: { experimentalApi: true }
    })
    send({ method: 'initialized' })

    return await run({ request, send, child })
  } finally {
    if (rl) {
      rl.close()
    }
    if (child) {
      child.kill('SIGTERM')
    }
  }
}

function getLayerFilePath(layerName = {}) {
  if (!layerName || typeof layerName !== 'object') return null
  if (layerName.type === 'user' || layerName.type === 'system') {
    return layerName.file || null
  }
  if (layerName.type === 'project') {
    const dotCodexFolder = layerName.dotCodexFolder || ''
    return dotCodexFolder ? path.join(dotCodexFolder, 'config.toml') : null
  }
  return null
}

async function readCodexConfigSnapshot(projectPath = '') {
  return withCodexAppServer(async ({ request }) => {
    return request('config/read', {
      includeLayers: true,
      cwd: projectPath || null
    })
  }, {
    clientName: 'ccgui-codex-config',
    cwd: projectPath || process.cwd()
  })
}

async function resolveConfigWriteTarget(scope = 'user', projectPath = '') {
  const snapshot = await readCodexConfigSnapshot(projectPath)
  const layers = Array.isArray(snapshot?.layers) ? snapshot.layers : []
  const targetType = scope === 'project' ? 'project' : 'user'
  const layer = layers.find(item => item?.name?.type === targetType) || null
  if (!layer) {
    throw new Error(scope === 'project' ? '未找到项目配置层' : '未找到用户配置层')
  }

  const filePath = getLayerFilePath(layer.name)
  if (!filePath) {
    throw new Error('无法解析 Codex 配置写入目标')
  }

  return {
    filePath,
    expectedVersion: layer.version || null
  }
}

async function batchWriteConfig(scope = 'user', projectPath = '', edits = []) {
  const target = await resolveConfigWriteTarget(scope, projectPath)
  return withCodexAppServer(async ({ request }) => {
    return request('config/batchWrite', {
      edits,
      filePath: target.filePath,
      expectedVersion: target.expectedVersion
    })
  }, {
    clientName: 'ccgui-codex-config-write',
    cwd: projectPath || process.cwd()
  })
}

async function listPluginsWithDetails(projectPath = '') {
  return withCodexAppServer(async ({ request }) => {
    const result = await request('plugin/list', {})
    const marketplaces = Array.isArray(result?.marketplaces) ? result.marketplaces : []
    const detailEntries = await Promise.all(
      marketplaces.flatMap((marketplace) => {
        const marketplacePath = marketplace?.path || ''
        const plugins = Array.isArray(marketplace?.plugins) ? marketplace.plugins : []
        return plugins.map(async (plugin) => {
          try {
            const detail = await request('plugin/read', {
              marketplacePath,
              pluginName: plugin?.name || ''
            })
            return [`${marketplacePath}::${plugin?.name || ''}`, detail?.plugin || null]
          } catch (error) {
            logger.warn('[CodexAppServer] Failed to read plugin detail', {
              marketplacePath,
              pluginName: plugin?.name || '',
              error: error.message
            })
            return [`${marketplacePath}::${plugin?.name || ''}`, null]
          }
        })
      })
    )

    return {
      marketplaces,
      detailMap: Object.fromEntries(detailEntries)
    }
  }, {
    clientName: 'ccgui-codex-plugins',
    cwd: projectPath || process.cwd(),
    timeoutMs: 30000
  })
}

async function readPluginDetail(projectPath = '', marketplacePath = '', pluginName = '') {
  return withCodexAppServer(async ({ request }) => {
    return request('plugin/read', {
      marketplacePath,
      pluginName
    })
  }, {
    clientName: 'ccgui-codex-plugin-detail',
    cwd: projectPath || process.cwd()
  })
}

async function installPlugin(scope = 'user', projectPath = '', plugin = {}) {
  if (scope === 'project') {
    const pluginId = plugin.pluginId || ''
    if (!pluginId) {
      throw new Error('缺少插件 ID')
    }
    return batchWriteConfig('project', projectPath, [{
      keyPath: `plugins.${pluginId}.enabled`,
      value: true,
      mergeStrategy: 'upsert'
    }])
  }

  return withCodexAppServer(async ({ request }) => {
    return request('plugin/install', {
      marketplacePath: plugin.marketplacePath || '',
      pluginName: plugin.pluginName || ''
    })
  }, {
    clientName: 'ccgui-codex-plugin-install',
    cwd: projectPath || process.cwd(),
    timeoutMs: 30000
  })
}

async function uninstallPlugin(scope = 'user', projectPath = '', plugin = {}) {
  if (scope === 'project') {
    const pluginId = plugin.pluginId || ''
    if (!pluginId) {
      throw new Error('缺少插件 ID')
    }
    return batchWriteConfig('project', projectPath, [{
      keyPath: `plugins.${pluginId}`,
      value: null,
      mergeStrategy: 'replace'
    }])
  }

  return withCodexAppServer(async ({ request }) => {
    return request('plugin/uninstall', {
      pluginId: plugin.pluginId || ''
    })
  }, {
    clientName: 'ccgui-codex-plugin-uninstall',
    cwd: projectPath || process.cwd(),
    timeoutMs: 30000
  })
}

async function setPluginEnabled(scope = 'user', projectPath = '', pluginId = '', enabled = true) {
  if (!pluginId) {
    throw new Error('缺少插件 ID')
  }

  return batchWriteConfig(scope, projectPath, [{
    keyPath: `plugins.${pluginId}.enabled`,
    value: enabled,
    mergeStrategy: 'upsert'
  }])
}

module.exports = {
  withCodexAppServer,
  readCodexConfigSnapshot,
  listPluginsWithDetails,
  readPluginDetail,
  installPlugin,
  uninstallPlugin,
  setPluginEnabled
}
