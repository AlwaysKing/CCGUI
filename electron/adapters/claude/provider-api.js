const { ClaudeClient } = require('./client')
const fs = require('fs')
const os = require('os')
const path = require('path')

const DEFAULT_CLAUDE_EFFORT_LEVELS = ['low', 'medium', 'high']

async function withClaudeProviderClient(task, options = {}) {
  const client = new ClaudeClient(
    options.workingDirectory || process.cwd(),
    null,
    true,
    'default',
    options.projectSettings || null,
    { debug: options.debug === true }
  )

  try {
    await client.start()
    return await task(client)
  } finally {
    client.stop()
  }
}

function normalizeClaudeModelEntry(entry = null) {
  if (!entry || typeof entry !== 'object') {
    return null
  }

  const value = typeof entry.value === 'string' ? entry.value.trim() : ''
  if (!value) {
    return null
  }

  return {
    value,
    displayName: typeof entry.displayName === 'string' ? entry.displayName : value,
    description: typeof entry.description === 'string' ? entry.description : '',
    supportsEffort: entry.supportsEffort === true,
    supportedEffortLevels: Array.isArray(entry.supportedEffortLevels)
      ? entry.supportedEffortLevels.filter(level => typeof level === 'string' && level)
      : [],
    supportsAdaptiveThinking: entry.supportsAdaptiveThinking === true,
    supportsFastMode: entry.supportsFastMode === true,
    supportsAutoMode: entry.supportsAutoMode === true,
    raw: entry
  }
}

async function listClaudeModels(options = {}) {
  const models = await withClaudeProviderClient(
    client => {
      const customEnvVars = client.getModelEnvVars()
      if (Object.keys(customEnvVars).length > 0) {
        return []
      }
      return client.getSupportedModels()
    },
    options
  )

  return {
    data: Array.isArray(models)
      ? models.map(normalizeClaudeModelEntry).filter(Boolean)
      : [],
    raw: Array.isArray(models) ? models : []
  }
}

function readClaudeDefaultEffort() {
  try {
    const settingsPath = path.join(os.homedir(), '.claude', 'settings.json')
    if (!fs.existsSync(settingsPath)) {
      return ''
    }

    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'))
    const value = typeof settings.effortLevel === 'string'
      ? settings.effortLevel.trim()
      : (typeof settings.effort === 'string' ? settings.effort.trim() : '')

    return value && value !== 'default' ? value : ''
  } catch (error) {
    return ''
  }
}

async function listClaudeReasoningCapabilities(options = {}) {
  const modelId = typeof options.model === 'string' ? options.model.trim() : ''
  const result = await listClaudeModels(options)
  const entries = Array.isArray(result.data) ? result.data : []
  const matched = entries.find(entry => entry.value === modelId) || null
  const levels = matched?.supportsEffort
    ? matched.supportedEffortLevels
    : DEFAULT_CLAUDE_EFFORT_LEVELS

  return {
    provider: 'claude',
    model: modelId || matched?.value || '',
    supportsRuntimeSwitch: false,
    defaultValue: readClaudeDefaultEffort(),
    options: levels.map(level => ({
      value: level,
      label: level,
      description: ''
    })),
    raw: matched?.raw || null
  }
}

module.exports = {
  listClaudeModels,
  listClaudeReasoningCapabilities
}
