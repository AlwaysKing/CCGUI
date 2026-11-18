const fs = require('fs')
const path = require('path')
const appConfigManager = require('../../storage/app-config-manager')
const { getCcguiPath } = require('../../runtime-paths')

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
    '4. 透明化：在执行复杂任务前，请先用简短文字说明你匹配到了哪些“附加要求”或“规范文档”。',
    '5. 多代理协作：等待子代理前先查状态（list_agents），目标已经 completed 就直接读它的结论，不要再 wait；wait 必须带不超过 60 秒的超时，超时后重新查状态，不要换成更长的超时再等一次。'
  ].join('\n')
}

function isCCAgentProjectPath(projectPath) {
  if (!projectPath || typeof projectPath !== 'string') return false
  return path.resolve(projectPath) === path.resolve(getCcguiPath('ccagent'))
}

function buildDeveloperInstructions(projectSettings = null, options = {}) {
  const agentIdentity = options?.agentIdentity && typeof options.agentIdentity === 'object'
    ? options.agentIdentity
    : null
  const agentCommunicationEnabled = options?.agentCommunicationEnabled === undefined
    ? Boolean(agentIdentity)
    : options.agentCommunicationEnabled === true

  if ((!projectSettings || typeof projectSettings !== 'object') && !agentIdentity) {
    return null
  }

  const appConfig = appConfigManager.loadConfig()
  const provider = typeof options?.provider === 'string' ? options.provider : ''

  const promptIds = Array.isArray(projectSettings?.promptIds)
    ? projectSettings.promptIds
    : []
  const promptSections = []

  // 项目说明：作为附加要求的第一项
  const projectPrompt = typeof projectSettings?.projectPrompt === 'string' && projectSettings.projectPrompt.trim()
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

  const documentIds = Array.isArray(projectSettings?.documentIds)
    ? projectSettings.documentIds
    : []
  const docPaths = []

  if (documentIds.length > 0) {
    const docsDir = getCcguiPath('docs')

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

  if (agentIdentity) {
    const identityLines = [
      '# CCGUI Agent 通讯身份',
      '',
      `- session_id: \`${agentIdentity.sessionId || ''}\``,
      `- project_id: \`${agentIdentity.projectId || ''}\``,
      `- name: ${agentIdentity.name || agentIdentity.sessionId || 'Agent'}`
    ]

    if (agentCommunicationEnabled) {
      identityLines.push(
        '',
        '你的当前 team_id 和 role 可能动态变化，请通过 `info` 获取实时身份。',
        '',
        '你可以使用 `ccgui_internal` MCP：',
        '- `info`：获取当前 session_id / project_id / team_id / role。',
        '- `list_sessions`：查看当前允许访问的在线 Session 及其 `is_processing` 状态。',
        '- `send_message`：只用于派发任务或提醒目标查看收件箱；不要用它发送完整回复。',
        '- `send_inbox_message`：向目标 `session_id` 发送非打断式收件箱消息。',
        '- `list_inbox_messages`：查看自己的未读收件箱消息。',
        '- `ack_inbox_messages`：标记收件箱消息为已读。',
        '- 回复 leader 或其他 Session 时，默认把完整回复写入收件箱；先通过 `list_sessions` 查看目标是否 `is_processing`，若目标空闲，再发送一条简短的直接提醒。',
        '- `interrupt_session`：仅当 role 为 `leader` 且目标属于同一个非空 team 时可用。',
        '- `create_team`：仅当当前没有 team 时可创建 team，创建后当前 Session 成为 leader。',
        '- `join_team`：仅当当前没有 team 时可加入已有 team，并以 member 身份加入。',
        '- `create_session`：仅 leader 可用，创建的新 Session 自动加入当前 leader team，角色为 member。',
        '',
        '通讯权限：',
        '- 只能与同项目的 Agent Session 通讯。',
        '- 有 team_id 时只能与相同 team_id 的 Session 通讯。',
        '- 没有 team_id 时只能与同项目中同样没有 team_id 的 Session 通讯。',
        '- 发送方身份由 CCGUI 自动附加，不要尝试伪造 project_id、team_id、role 或 sender。'
      )
    } else {
      identityLines.push('', '当前 Session 的内部通讯 MCP 不可用。')
    }

    sections.push(identityLines.join('\n'))
  }

  return sections.join('\n\n')
}

module.exports = {
  buildDeveloperInstructions
}
