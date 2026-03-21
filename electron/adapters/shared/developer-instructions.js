const fs = require('fs')
const os = require('os')
const path = require('path')
const appConfigManager = require('../../storage/app-config-manager')

function buildDeveloperInstructions(projectSettings = null) {
  if (!projectSettings || typeof projectSettings !== 'object') {
    return null
  }

  const parts = []
  const appConfig = appConfigManager.loadConfig()

  const promptIds = Array.isArray(projectSettings.promptIds)
    ? projectSettings.promptIds
    : []

  if (promptIds.length > 0) {
    const prompts = appConfig.settings?.prompts || []
    for (const promptId of promptIds) {
      const prompt = prompts.find(item => item.id === promptId)
      if (prompt?.content) {
        parts.push(prompt.content)
      }
    }
  }

  const documentIds = Array.isArray(projectSettings.documentIds)
    ? projectSettings.documentIds
    : []

  if (documentIds.length > 0) {
    const docsDir = path.join(os.homedir(), '.ccgui', 'docs')
    const docPaths = []

    for (const docId of documentIds) {
      const filePath = path.join(docsDir, `${docId}.md`)
      if (fs.existsSync(filePath)) {
        docPaths.push(filePath)
      }
    }

    if (docPaths.length > 0) {
      parts.push(`请始终遵循如下文档的规范要求: ${docPaths.join(', ')}`)
    }
  }

  if (parts.length === 0) {
    return null
  }

  return parts.join('\n\n')
}

module.exports = {
  buildDeveloperInstructions
}
