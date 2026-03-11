/**
 * useMessage composable
 * 消息相关的格式化和处理逻辑
 */
import { ref } from 'vue'

export function useMessage() {
  // 复制状态
  const copiedMessageIndex = ref(-1)

  /**
   * 格式化消耗时间
   */
  function formatDuration(ms) {
    if (!ms) return ''
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
  }

  /**
   * 格式化 token 消耗
   */
  function formatTokens(usage) {
    if (!usage) return ''
    const cache = usage.cache_read_input_tokens || 0
    const input = usage.input_tokens || 0
    const output = usage.output_tokens || 0
    if (cache === 0 && input === 0 && output === 0) return ''

    const parts = []
    if (cache > 0) parts.push(`缓存:${cache}`)
    if (input > 0) parts.push(`输入:${input}`)
    if (output > 0) parts.push(`输出:${output}`)
    return parts.join(' ')
  }

  /**
   * 格式化 MCP 服务器列表
   */
  function formatMcpServers(servers) {
    if (!servers || !Array.isArray(servers)) return ''
    return servers.map(server => {
      if (typeof server === 'string') return server

      if (typeof server === 'object' && server !== null) {
        const name = server.name || server.server_name || server.id || server.host || server.url

        let statusIcon = ''
        if (server.status) {
          switch (server.status.toLowerCase()) {
            case 'connected':
              statusIcon = ' ✓'
              break
            case 'failed':
            case 'error':
              statusIcon = ' ✗'
              break
            case 'connecting':
            case 'loading':
              statusIcon = ' ⏳'
              break
            case 'disconnected':
              statusIcon = ' ○'
              break
            default:
              statusIcon = ` [${server.status}]`
          }
        }

        if (name) return String(name) + statusIcon

        const values = Object.values(server).filter(v => typeof v === 'string' || typeof v === 'number')
        if (values.length > 0) return values.slice(0, 2).join(' - ') + statusIcon

        try {
          const json = JSON.stringify(server)
          return (json.length > 30 ? json.substring(0, 30) + '...' : json) + statusIcon
        } catch (e) {
          return 'MCP Server' + statusIcon
        }
      }

      return String(server)
    }).join(', ')
  }

  /**
   * 格式化技能列表
   */
  function formatSkills(skills) {
    if (!skills || !Array.isArray(skills)) return ''
    return skills.map(skill => {
      if (typeof skill === 'string') return skill

      if (typeof skill === 'object' && skill !== null) {
        const name = skill.name || skill.skill_name || skill.id
        if (name) return String(name)

        const values = Object.values(skill).filter(v => typeof v === 'string' || typeof v === 'number')
        if (values.length > 0) return values.slice(0, 2).join(' - ')

        try {
          const json = JSON.stringify(skill)
          return json.length > 30 ? json.substring(0, 30) + '...' : json
        } catch (e) {
          return 'Skill'
        }
      }

      return String(skill)
    }).join(', ')
  }

  /**
   * 复制文本到剪贴板
   */
  async function copyToClipboard(content, index) {
    if (!content) return

    try {
      await navigator.clipboard.writeText(content)
      copiedMessageIndex.value = index
      setTimeout(() => {
        copiedMessageIndex.value = -1
      }, 2000)
    } catch (err) {
      console.error('复制失败:', err)
    }
  }

  /**
   * 复制消息内容
   */
  async function copyMessageContent(messages, index) {
    const message = messages[index]
    if (!message) return

    let content = ''
    if (message.role === 'user' || message.role === 'assistant') {
      content = typeof message.content === 'string' ? message.content : message.content
    } else {
      content = typeof message.content === 'string' ? message.content : JSON.stringify(message.content)
    }

    await copyToClipboard(content, index)
  }

  /**
   * 复制问答内容
   */
  async function copyQuestionContent(messages, index) {
    const message = messages[index]
    if (!message || !message.questions) return

    let content = '问答记录:\n\n'
    message.questions.forEach((q, idx) => {
      content += `【${q.header}】\n`
      if (q.question) content += `问题: ${q.question}\n`
      content += `答案: ${q.selectedAnswer || '未选择'}\n`
      if (idx < message.questions.length - 1) content += '\n'
    })

    try {
      await navigator.clipboard.writeText(content)
      copiedMessageIndex.value = index
      setTimeout(() => {
        copiedMessageIndex.value = -1
      }, 2000)
    } catch (err) {
      console.error('复制失败:', err)
    }
  }

  /**
   * 检查选项是否被选中
   */
  function isOptionSelected(question, optionLabel) {
    if (question.multiSelect) {
      const answer = question.selectedAnswer
      if (Array.isArray(answer)) {
        return answer.includes(optionLabel)
      }
      if (typeof answer === 'string') {
        const selectedOptions = answer.split(/,\s*/).map(s => s.trim())
        return selectedOptions.includes(optionLabel)
      }
      return false
    }
    return optionLabel === question.selectedAnswer
  }

  /**
   * 比较两个答案对象是否一致
   */
  function compareAnswers(userAnswers, receivedAnswers) {
    const userKeys = Object.keys(userAnswers)
    const receivedKeys = Object.keys(receivedAnswers)

    if (userKeys.length !== receivedKeys.length) {
      return false
    }

    for (const key of userKeys) {
      if (!receivedAnswers.hasOwnProperty(key)) {
        return false
      }
      const userAnswer = String(userAnswers[key]).trim()
      const receivedAnswer = String(receivedAnswers[key]).trim()
      if (userAnswer !== receivedAnswer) {
        return false
      }
    }

    return true
  }

  return {
    copiedMessageIndex,
    formatDuration,
    formatTokens,
    formatMcpServers,
    formatSkills,
    copyToClipboard,
    copyMessageContent,
    copyQuestionContent,
    isOptionSelected,
    compareAnswers
  }
}
