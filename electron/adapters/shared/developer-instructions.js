const fs = require('fs')
const os = require('os')
const path = require('path')
const appConfigManager = require('../../storage/app-config-manager')

function getProviderDisplayName(provider = '') {
  switch (String(provider || '').trim().toLowerCase()) {
    case 'claude':
      return 'Claude'
    case 'codex':
      return 'Codex'
    default:
      return '当前会话'
  }
}

function demoteMarkdownHeadings(content = '') {
  return String(content || '').replace(/^(#{1,6})(\s+)/gm, (_, hashes, spacing) => {
    const nextLevel = hashes.length >= 6 ? '######' : `${hashes}#`
    return `${nextLevel}${spacing}`
  })
}

function buildOverviewSection(provider = '') {
  const providerName = getProviderDisplayName(provider)
  return [
    '# 概述',
    '',
    `你当前运行在 CCGUI 中，通过 ${providerName} 与模型交互。`,
    '',
    '核心指令逻辑：',
    '1. 优先级：当指令冲突时，遵循“局部优于全局、具体优于抽象”的原则。',
    '2. 附加要求：这是你执行任务时的实时行动指南，必须优先满足。',
    '3. 规范文档：这里会给出相关的 .md 或配置路径。在执行任何文件修改、方案设计或架构调整前，必须先检索并参考这些路径下的文档内容。',
    '4. 透明化：在执行复杂任务前，请先用简短文字说明你匹配到了哪些“附加要求”或“规范文档”。'
  ].join('\n')
}

function isCCAgentProjectPath(projectPath) {
  if (!projectPath || typeof projectPath !== 'string') return false
  const normalized = projectPath.replace(/\\/g, '/')
  return normalized.endsWith('/.ccgui/ccagent')
}

function buildDeveloperInstructions(projectSettings = null, options = {}) {
  if (!projectSettings || typeof projectSettings !== 'object') {
    return null
  }

  const appConfig = appConfigManager.loadConfig()
  const provider = typeof options?.provider === 'string' ? options.provider : ''

  const promptIds = Array.isArray(projectSettings.promptIds)
    ? projectSettings.promptIds
    : []
  const promptSections = []

  // 项目说明：作为附加要求的第一项
  const projectPrompt = typeof projectSettings.projectPrompt === 'string' && projectSettings.projectPrompt.trim()
    ? projectSettings.projectPrompt.trim()
    : null
  if (projectPrompt) {
    promptSections.push(`## 项目说明\n\n${demoteMarkdownHeadings(projectPrompt)}`)
  }

  if (promptIds.length > 0) {
    const prompts = appConfig.settings?.prompts || []
    for (const promptId of promptIds) {
      const prompt = prompts.find(item => item.id === promptId)
      if (prompt?.content) {
        const name = typeof prompt.name === 'string' && prompt.name.trim()
          ? prompt.name.trim()
          : promptId
        promptSections.push(`## ${name}\n\n${demoteMarkdownHeadings(prompt.content)}`)
      }
    }
  }

  const documentIds = Array.isArray(projectSettings.documentIds)
    ? projectSettings.documentIds
    : []
  const docPaths = []

  if (documentIds.length > 0) {
    const docsDir = path.join(os.homedir(), '.ccgui', 'docs')

    for (const docId of documentIds) {
      const filePath = path.join(docsDir, `${docId}.md`)
      if (fs.existsSync(filePath)) {
        docPaths.push(filePath)
      }
    }
  }

  const sections = [buildOverviewSection(provider)]

  if (promptSections.length > 0) {
    sections.push(['# 附加要求', ...promptSections].join('\n\n'))
  }

  if (docPaths.length > 0) {
    sections.push(['# 规范文档', '', ...docPaths.map(filePath => `- ${filePath}`)].join('\n'))
  }

  // CCAgent 项目专属注入：无论项目配置如何，都追加设定和记忆文件指引
  const projectPath = typeof options?.projectPath === 'string' ? options.projectPath : ''
  if (isCCAgentProjectPath(projectPath)) {
    const ccagentMdAbs = path.join(projectPath, '.ccagent.md')
    const ccagentMemoryAbs = path.join(projectPath, '.ccagentmemory.md')
    sections.push([
      '# CCAgent 专属指令',
      '',
      `你的设定文件是 \`${ccagentMdAbs}\`，你的全局记忆文件是 \`${ccagentMemoryAbs}\`。`,
      '在每次对话开始时，请先读取设定文件了解你的设定，并在需要时读取记忆文件获取历史记忆。',
      '当用户要求更新设定或记忆时，请将内容写入对应的文件。'
    ].join('\n'))
  }

  return sections.join('\n\n')
}

module.exports = {
  buildDeveloperInstructions
}
