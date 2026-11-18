const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccgui-project-path-test-'))
process.env.CCGUI_HOME = tempHome

const { encodeProjectPath, decodeProjectPath } = require('../electron/project-paths')
const { projectConfigManager } = require('../electron/storage')
const projectService = require('../electron/services/project-service')

const projectPath = path.join(tempHome, 'workspace.with.dots', '.ccgui', 'agent')
const projectId = encodeProjectPath(projectPath)
projectConfigManager.createProjectConfig(projectId, projectPath, 'Dotted Path Project')

try {
  assert.notStrictEqual(
    decodeProjectPath(projectId),
    projectPath,
    'encoded project IDs intentionally lose dot information'
  )
  assert.strictEqual(
    projectService.getProjectPath(projectId),
    projectPath,
    'project path resolution must use project.json instead of lossy decoding'
  )
  console.log('project-path-resolution-tests: ok')
} finally {
  fs.rmSync(tempHome, { recursive: true, force: true })
}
