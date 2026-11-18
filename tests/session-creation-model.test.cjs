const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-session-creation-model-'))
process.env.CCGUI_HOME = tempHome

const {
  appConfigManager,
  projectConfigManager,
  sessionConfigManager
} = require('../electron/storage')
const projectService = require('../electron/services/project-service')

const projectId = '-tmp-ccgui-session-creation-model'
const projectPath = '/tmp/ccgui-session-creation-model'

appConfigManager.saveConfig({
  version: '1.0.0',
  settings: {
    selectedClaudeModelId: 'claude-model',
    selectedCodexModelId: 'codex-model',
    claudeModels: [
      {
        id: 'claude-model',
        friendlyName: 'Claude Pro',
        defaultCardId: 'claude-card',
        credentials: [
          { id: 'claude-credential', name: 'Claude Key', token: 'test-token' }
        ],
        modelCards: [
          { id: 'claude-card', modelName: 'claude-sonnet' }
        ]
      }
    ],
    codexModels: [
      {
        id: 'codex-model',
        friendlyName: 'Codex Pro',
        defaultCardId: 'codex-card',
        credentials: [
          { id: 'codex-credential', name: 'Codex Key', token: 'test-token' }
        ],
        modelCards: [
          { id: 'codex-card', modelName: 'gpt-5' }
        ]
      }
    ]
  }
})

projectConfigManager.createProjectConfig(projectId, projectPath, 'Session Creation Model Test')
const leader = sessionConfigManager.createSession(projectId, {
  name: 'Leader',
  teamId: 'team-a',
  role: 'leader',
  settings: {
    tool: 'claude',
    modelMode: 'custom',
    modelId: 'claude-model',
    modelCardId: 'claude-card',
    credentialId: 'claude-credential',
    targetKind: 'provider',
    effort: 'high',
    thinkingMode: 'custom',
    thinkingEnabled: true,
    maxThinkingTokens: 4096,
    toolBinding: {
      tool: 'claude',
      nativeSessionId: 'leader-native-session'
    }
  }
})

function resolve(options = {}) {
  return projectService.resolveSessionCreationSettings({
    projectId,
    leaderSessionId: leader.id,
    ...options
  })
}

try {
  const inherited = resolve()
  assert.strictEqual(inherited.provider, 'claude')
  assert.strictEqual(inherited.settings.tool, 'claude')
  assert.strictEqual(inherited.settings.modelMode, 'custom')
  assert.strictEqual(inherited.settings.modelId, 'claude-model')
  assert.strictEqual(inherited.settings.modelCardId, 'claude-card')
  assert.strictEqual(inherited.settings.credentialId, 'claude-credential')
  assert.strictEqual(inherited.settings.effort, 'high')
  assert.strictEqual(inherited.settings.thinkingMode, 'custom')
  assert.strictEqual(inherited.settings.thinkingEnabled, true)
  assert.strictEqual(inherited.settings.maxThinkingTokens, 4096)
  assert.strictEqual(inherited.settings.toolBinding, undefined)
  assert.strictEqual(inherited.model, 'claude-sonnet')
  assert.strictEqual(inherited.modelId, 'claude-model')

  const codexDefault = resolve({ provider: 'codex' })
  assert.strictEqual(codexDefault.provider, 'codex')
  assert.strictEqual(codexDefault.settings.tool, 'codex')
  assert.strictEqual(codexDefault.settings.modelMode, 'project')
  assert.strictEqual(codexDefault.settings.modelId, undefined)
  assert.strictEqual(codexDefault.settings.effort, undefined)
  assert.strictEqual(codexDefault.modelId, 'codex-model')
  assert.strictEqual(codexDefault.model, 'gpt-5')

  const inferredProvider = resolve({ model: 'gpt-5' })
  assert.strictEqual(inferredProvider.provider, 'codex')
  assert.strictEqual(inferredProvider.settings.modelMode, 'custom')
  assert.strictEqual(inferredProvider.settings.modelId, 'codex-model')
  assert.strictEqual(inferredProvider.settings.modelCardId, 'codex-card')
  assert.strictEqual(inferredProvider.model, 'gpt-5')

  const fullModelKey = resolve({ provider: 'codex', model: 'codex-model/gpt-5' })
  assert.strictEqual(fullModelKey.provider, 'codex')
  assert.strictEqual(fullModelKey.settings.modelId, 'codex-model')
  assert.strictEqual(fullModelKey.settings.modelCardId, 'codex-card')

  const modelIdSelection = resolve({ provider: 'claude', model: 'claude-model' })
  assert.strictEqual(modelIdSelection.provider, 'claude')
  assert.strictEqual(modelIdSelection.settings.modelId, 'claude-model')
  assert.strictEqual(modelIdSelection.settings.modelCardId, 'claude-card')

  const friendlyProviderName = resolve({ model: 'Codex Pro' })
  assert.strictEqual(friendlyProviderName.provider, 'codex')
  assert.strictEqual(friendlyProviderName.settings.modelId, 'codex-model')
  assert.strictEqual(friendlyProviderName.settings.modelCardId, 'codex-card')

  assert.throws(
    () => resolve({ provider: 'invalid-provider' }),
    error => error.status === 'invalid_provider'
  )
  assert.throws(
    () => resolve({ provider: 'codex', model: 'missing-model' }),
    error => error.status === 'model_not_found'
  )

  console.log('session-creation-model-tests: ok')
} finally {
  fs.rmSync(tempHome, { recursive: true, force: true })
}
