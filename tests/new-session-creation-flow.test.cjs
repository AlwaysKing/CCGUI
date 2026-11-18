const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { buildSync } = require('esbuild')

const alerts = []
global.alert = message => {
  alerts.push(message)
}
global.window = {
  electronAPI: {
    ensureLogDir: async () => ({ success: true }),
    writeAppLog: async () => ({ success: true })
  }
}

const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-new-session-flow-test-'))
const entryFile = path.join(outputDir, 'entry.js')
const outputFile = path.join(outputDir, 'workspace-dialogs.cjs')
const projectRoot = path.join(__dirname, '..')

fs.writeFileSync(entryFile, [
  `import { useWorkspaceDialogs } from ${JSON.stringify(path.join(projectRoot, 'src/views/workspace/hooks/useWorkspaceDialogs.js'))}`,
  'export { useWorkspaceDialogs }'
].join('\n'))

buildSync({
  entryPoints: [entryFile],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: outputFile,
  absWorkingDir: projectRoot,
  alias: {
    '@': path.join(projectRoot, 'src')
  },
  nodePaths: [path.join(projectRoot, 'node_modules')],
  logLevel: 'silent'
})

function createHarness(useWorkspaceDialogs, selectSession) {
  const store = {
    currentProject: {
      id: 'new-session-flow-project',
      path: '/tmp/new-session-flow-project'
    },
    selectSession
  }
  return useWorkspaceDialogs({
    store,
    sessionStore: {},
    sessionSidebarRef: { value: null },
    chatRef: { value: null }
  })
}

async function run() {
  const { useWorkspaceDialogs } = require(outputFile)

  let resolveSelection
  let selectedSession = null
  const pendingSelection = new Promise(resolve => {
    resolveSelection = resolve
  })
  const successHarness = createHarness(useWorkspaceDialogs, session => {
    selectedSession = session
    return pendingSelection
  })
  const session = {
    id: 'new-session',
    name: '新会话'
  }

  successHarness.showNewSessionDialog.value = true
  const creationPromise = successHarness.handleNewSessionCreated(session)

  assert.strictEqual(
    successHarness.showNewSessionDialog.value,
    false,
    'dialog must close immediately after the session is created'
  )
  assert.strictEqual(selectedSession, session, 'background selection must receive the created session')

  resolveSelection(session)
  await creationPromise
  assert.deepStrictEqual(alerts, [], 'successful background selection must not show an alert')

  const failureHarness = createHarness(useWorkspaceDialogs, async () => {
    throw new Error('select failed')
  })
  failureHarness.showNewSessionDialog.value = true
  await failureHarness.handleNewSessionCreated({
    id: 'failed-new-session',
    name: '失败会话'
  })

  assert.strictEqual(failureHarness.showNewSessionDialog.value, false)
  assert.strictEqual(alerts.length, 1, 'background selection failure must be reported to the user')
  assert(
    alerts[0].includes('新会话已创建，但打开失败') && alerts[0].includes('select failed'),
    'failure alert must explain that creation succeeded but selection failed'
  )

  console.log('new-session-creation-flow-tests: ok')
}

run()
  .catch(error => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(() => {
    fs.rmSync(outputDir, { recursive: true, force: true })
  })
