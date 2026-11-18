const assert = require('assert')
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-codex-smoke-'))
process.env.HOME = tempHome
process.env.CODEX_HOME = path.join(tempHome, '.codex')
fs.mkdirSync(process.env.CODEX_HOME, { recursive: true })

const { AgentCommunicationService } = require('../electron/agent-communication/agent-communication-service')
const { CodexAdapter } = require('../electron/adapters/codex/adapter')

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function waitFor(predicate, timeoutMs = 20000) {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return true
    await delay(100)
  }
  return false
}

async function main() {
  if (process.env.CCGUI_RUN_PROVIDER_SMOKE !== '1') {
    console.log('codex provider smoke skipped')
    return
  }

  const sessionId = crypto.randomUUID()
  const projectId = 'codex-provider-smoke-project'
  const session = {
    id: sessionId,
    projectId,
    isProcessing: false,
    async sendMessage() {}
  }
  const manager = {
    getSession(id) {
      return id === sessionId ? session : null
    },
    async sendInterrupt() {}
  }
  const service = new AgentCommunicationService({
    sessionManager: manager,
    socketPath: path.join(os.tmpdir(), `ccgui-agent-codex-smoke-${process.pid}.sock`),
    getSessionConfig: () => ({
      id: sessionId,
      projectId,
      name: 'Codex Smoke',
      teamId: 'smoke-team',
      role: 'leader'
    })
  })
  let adapter = null

  try {
    await service.start()
    const prepared = await service.prepareSession({ session, provider: 'codex' })
    adapter = new CodexAdapter(
      process.cwd(),
      sessionId,
      true,
      'default',
      null,
      {
        skipModelRouteValidation: true,
        agentIdentity: prepared.identity,
        agentMcpConfig: prepared.mcpConfig,
        agentCommunicationEnabled: true
      }
    )
    await adapter.start()
    const connected = await waitFor(() => service.connections.has(sessionId))
    assert(connected, 'Codex did not connect the CCGUI internal MCP bridge')
    console.log('Codex provider MCP injection smoke passed')
  } finally {
    try {
      adapter?.stop()
    } catch {}
    await service.stop()
    await delay(250)
    try {
      fs.rmSync(tempHome, { recursive: true, force: true })
    } catch {}
  }
  setTimeout(() => process.exit(0), 0)
}

main().catch(error => {
  console.error(error)
  process.exitCode = 1
})
