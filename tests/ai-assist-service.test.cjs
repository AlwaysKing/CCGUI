const assert = require('assert')
const {
  AiAssistService,
  buildSummaryPrompt,
  extractCodexResponseText,
  isLikelyConversationalResponse,
  normalizeSummaryText
} = require('../electron/services/ai-assist-service')
const {
  normalizeAiAssistSettings,
  normalizeAiAssistSessionSummaryLimit
} = require('../electron/storage/app-config-manager')

function createConfig(overrides = {}) {
  const aiAssistOverrides = overrides.aiAssist || {}
  const summary = {
    enabled: true,
    userMessageLimit: 20,
    ...(overrides.sessionSummary || aiAssistOverrides.features?.sessionSummary || {})
  }
  return {
    settings: {
      aiAssist: {
        enabled: true,
        provider: 'claude',
        modelId: 'provider-1',
        modelCardId: 'card-1',
        ...aiAssistOverrides,
        features: {
          ...(aiAssistOverrides.features || {}),
          sessionSummary: summary
        }
      },
      claudeModels: [
        {
          id: 'provider-1',
          friendlyName: 'Provider',
          modelCards: [
            { id: 'card-1', modelName: 'claude-test' }
          ]
        }
      ],
      codexModels: []
    }
  }
}

function createSession(projectId = 'project-1', sessionId = 'session-1') {
  return {
    id: sessionId,
    projectId,
    getPayloadAgentId: data => data?.ccgui?.attribution?.agentId || null,
    getMainAgentId: () => 'master'
  }
}

function createUserEvent(content = '检查当前会话摘要', agentId = null) {
  return {
    sessionId: 'session-1',
    eventType: 'message',
    data: {
      id: 'message-1',
      role: 'user',
      content,
      ...(agentId
        ? { ccgui: { attribution: { agentId } } }
        : {})
    }
  }
}

async function testNormalization() {
  assert.strictEqual(normalizeAiAssistSessionSummaryLimit(undefined), 20)
  assert.strictEqual(normalizeAiAssistSessionSummaryLimit(1), 5)
  assert.strictEqual(normalizeAiAssistSessionSummaryLimit(101), 100)
  assert.strictEqual(normalizeAiAssistSessionSummaryLimit('36'), 36)

  const normalized = normalizeAiAssistSettings({
    provider: 'unsupported',
    features: {
      sessionSummary: {
        enabled: true,
        userMessageLimit: 200
      }
    }
  })
  assert.strictEqual(normalized.provider, 'claude')
  assert.strictEqual(normalized.enabled, false)
  assert.strictEqual(normalized.features.sessionSummary.enabled, true)
  assert.strictEqual(normalized.features.sessionSummary.userMessageLimit, 100)

  assert.strictEqual(normalizeSummaryText('摘要：“修复会话列表摘要”'), '修复会话列表摘要')
  assert.strictEqual(
    Array.from(normalizeSummaryText('一二三四五六七八九十一二三四五六七八九十超出部分')).length,
    20
  )
  assert.strictEqual(
    extractCodexResponseText({
      output: [
        {
          content: [
            { type: 'reasoning_text', text: '内部推理' },
            { type: 'output_text', text: '修复会话摘要' }
          ]
        }
      ]
    }),
    '修复会话摘要'
  )

  const prompt = buildSummaryPrompt([
    '你好',
    '现在几点了',
    '帮我检查一下当前磁盘空间占用情况'
  ])
  assert(prompt.includes('你现在要执行的任务是：总结当前会话最近正在处理的事项'))
  assert(prompt.includes('以最后一条提问表达的当前任务为核心'))
  assert(prompt.includes('摘要必须明确写出正在做什么具体事情、处理什么具体对象'))
  assert(prompt.includes('必须从前面的用户提问中找到具体动作和任务对象'))
  assert(prompt.includes('绝对禁止输出“继续完成之前的任务”'))
  assert(prompt.includes('应输出“继续修复登录接口”这类明确摘要'))
  assert(prompt.includes('1. 你好'))
  assert(prompt.includes('3. 帮我检查一下当前磁盘空间占用情况'))

  assert.strictEqual(isLikelyConversationalResponse('你好！下面分别回复你三个问题：'), true)
  assert.strictEqual(isLikelyConversationalResponse('处理本地磁盘占用问题'), false)
}

async function testSummaryGeneration() {
  let config = createConfig({
    sessionSummary: { userMessageLimit: 5 }
  })
  const requestedMessages = []
  const savedSummaries = []
  const previews = []
  const service = new AiAssistService({
    configManager: {
      loadConfig: () => config
    },
    history: {
      listRecentUserMessages: (projectId, sessionId, limit) => {
        assert.strictEqual(projectId, 'project-1')
        assert.strictEqual(sessionId, 'session-1')
        assert.strictEqual(limit, 5)
        return ['先排查会话摘要', '继续', '再调整终端字体']
      },
      updateSessionAiSummary: (projectId, sessionId, summary) => {
        savedSummaries.push({ projectId, sessionId, summary })
        return summary
      }
    },
    requestSummary: async request => {
      requestedMessages.push(...request.userMessages)
      return '摘要：修复会话摘要并调整终端字体'
    },
    onPreviewUpdated: payload => previews.push(payload)
  })

  const session = createSession()
  assert.strictEqual(service.handleSessionEvent(createUserEvent(), session), true)
  await service.waitForIdle('project-1', 'session-1')

  assert.deepStrictEqual(requestedMessages, ['先排查会话摘要', '继续', '再调整终端字体'])
  assert.strictEqual(savedSummaries.length, 1)
  assert.strictEqual(savedSummaries[0].summary.text, '修复会话摘要并调整终端字体')
  assert.strictEqual(savedSummaries[0].summary.userMessageCount, 3)
  assert.strictEqual(previews.length, 1)
  assert.strictEqual(previews[0].preview, '修复会话摘要并调整终端字体')

  config = createConfig({
    aiAssist: {
      features: {
        sessionSummary: { enabled: false }
      }
    }
  })
  assert.strictEqual(service.handleSessionEvent(createUserEvent('继续'), session), false)

  config = createConfig({
    aiAssist: {
      enabled: false
    }
  })
  assert.strictEqual(service.handleSessionEvent(createUserEvent('继续'), session), false)
}

async function testEventFiltering() {
  const service = new AiAssistService({
    configManager: { loadConfig: () => createConfig() },
    history: { listRecentUserMessages: () => [] },
    requestSummary: async () => '不应调用'
  })

  const session = createSession()
  assert.strictEqual(
    service.handleSessionEvent({
      eventType: 'message',
      data: { role: 'assistant', content: '回答' }
    }, session),
    false
  )
  assert.strictEqual(
    service.handleSessionEvent({
      eventType: 'message',
      data: {
        role: 'user',
        content: '内部消息',
        ccgui: { internalMessage: { senderSessionId: 'other' } }
      }
    }, session),
    false
  )
  assert.strictEqual(
    service.handleSessionEvent(createUserEvent('子代理消息', 'planner'), session),
    false
  )
}

async function testRawProviderRequestUsesUserMessagesOnly() {
  let capturedRequest = null
  const service = new AiAssistService({
    proxy: {
      getBaseUrl: () => 'http://127.0.0.1:12345',
      start: async () => ({ status: 'running' }),
      getClaudeBaseUrl: () => 'http://127.0.0.1:12345',
      getCodexBaseUrl: () => 'http://127.0.0.1:12345/codex'
    },
    fetchImpl: async (url, options) => {
      capturedRequest = { url, options, body: JSON.parse(options.body) }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          content: [{ type: 'text', text: '摘要：排查会话摘要' }]
        })
      }
    }
  })

  const summary = await service.requestSummaryFromProvider(
    { provider: 'claude', model: 'provider-1/claude-test' },
    ['为什么会话摘要不更新？', '继续']
  )

  assert.strictEqual(summary, '摘要：排查会话摘要')
  assert.strictEqual(capturedRequest.url, 'http://127.0.0.1:12345/v1/messages')
  assert.strictEqual(capturedRequest.body.model, 'provider-1/claude-test')
  assert(capturedRequest.body.messages[0].content.includes('你现在要执行的任务是：总结当前会话最近正在处理的事项'))
  assert(capturedRequest.body.messages[0].content.includes('为什么会话摘要不更新？'))
  assert(capturedRequest.body.messages[0].content.includes('继续'))
  assert(!capturedRequest.body.messages[0].content.includes('Agent 回复'))
}

async function testConversationalResponseIsRejected() {
  const savedSummaries = []
  const service = new AiAssistService({
    configManager: { loadConfig: () => createConfig() },
    history: {
      listRecentUserMessages: () => ['你好', '现在几点了', '帮我检查磁盘占用'],
      updateSessionAiSummary: (projectId, sessionId, summary) => {
        savedSummaries.push(summary)
        return summary
      }
    },
    requestSummary: async () => '你好！下面分别回复你三个问题：'
  })

  service.handleSessionEvent(createUserEvent(), createSession())
  await service.waitForIdle('project-1', 'session-1')
  assert.strictEqual(savedSummaries.length, 0)

}

async function run() {
  await testNormalization()
  await testSummaryGeneration()
  await testEventFiltering()
  await testRawProviderRequestUsesUserMessagesOnly()
  await testConversationalResponseIsRejected()
  console.log('ai-assist-service-tests: ok')
}

run().catch(error => {
  console.error(error)
  process.exitCode = 1
})
