/**
 * useMessageList - 消息列表逻辑 composable
 * 封装消息列表的状态和操作方法
 */
import { ref } from 'vue'

const rewindCollapseStates = ref({})
const questionActiveTabs = ref({})
const openActionMenuIndex = ref(-1)

export function useMessageList() {
  function isSkippableMessageBetweenUserAndAssistant(message) {
    if (!message) return false
    if (message.role === 'system_notification') return true
    if (message.role === 'status') return true
    return false
  }

  function isResponseMessage(message) {
    if (!message) return false
    if (message.role === 'assistant') return true
    if (message.role === 'tool_use' && message.subtype === 'execution-card') return true
    return false
  }

  function findAssistantResponse(messages, userMessageIndex) {
    if (!Array.isArray(messages) || userMessageIndex < 0) return null
    const userMessage = messages[userMessageIndex]
    if (!userMessage || userMessage.role !== 'user') return null

    for (let i = userMessageIndex + 1; i < messages.length; i += 1) {
      const message = messages[i]
      if (!message) continue
      if (isResponseMessage(message)) {
        return { message, index: i }
      }
      if (isSkippableMessageBetweenUserAndAssistant(message)) {
        continue
      }
      break
    }

    if (userMessage?.historyTurn?.hasResponse) {
      return {
        message: {
          id: `history-response-${userMessage.historyTurn.turnId}`,
          role: 'assistant',
          unloaded: !userMessage.historyTurn.loaded
        },
        index: userMessageIndex + 1,
        unloaded: !userMessage.historyTurn.loaded
      }
    }

    return null
  }

  function toggleRewindCollapse(messageId) {
    rewindCollapseStates.value[messageId] = !rewindCollapseStates.value[messageId]
  }

  function isRewindCollapsed(messageId) {
    return rewindCollapseStates.value[messageId] !== false
  }

  function getQuestionActiveTab(messageIndex) {
    return questionActiveTabs.value[messageIndex] ?? 0
  }

  function handleQuestionSwitchTab(messageIndex, tabIndex) {
    questionActiveTabs.value[messageIndex] = tabIndex
  }

  function toggleQuestionCollapse(messages, messageIndex) {
    const message = messages[messageIndex]
    if (message) {
      message.collapsed = !message.collapsed
      message.manuallyExpanded = !message.collapsed
    }
  }

  function isQuestionCollapsed(message) {
    return message?.collapsed ?? true
  }

  function handleToolToggleCollapse(message) {
    if (message) {
      message.collapsed = !message.collapsed
      message.manuallyExpanded = !message.collapsed
    }
  }

  function toggleThinkingCollapse(message) {
    if (message) {
      message.thinkingCollapsed = !message.thinkingCollapsed
    }
  }

  function getResponseCollapseState(messages, messageIndex) {
    if (!Array.isArray(messages) || messageIndex <= 0) {
      return { collapsed: false, byUserIndex: null }
    }
    for (let i = messageIndex - 1; i >= 0; i--) {
      const message = messages[i]
      if (!message) {
        continue
      }
      if (message.role === 'user') {
        if (message.responseCollapsed) {
          return { collapsed: true, byUserIndex: i }
        }
        break
      }
    }
    return { collapsed: false, byUserIndex: null }
  }

  function toggleResponseCollapse(messages, messageIndex) {
    const message = messages[messageIndex]
    if (message && message.role === 'user') {
      message.responseCollapsed = !message.responseCollapsed
    }
  }

  function isLastUserMessage(messages, index) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return i === index
      }
    }
    return false
  }

  function toggleActionMenu(index) {
    openActionMenuIndex.value = openActionMenuIndex.value === index ? -1 : index
  }

  function closeActionMenu() {
    openActionMenuIndex.value = -1
  }

  return {
    findAssistantResponse,
    toggleRewindCollapse,
    isRewindCollapsed,
    getQuestionActiveTab,
    handleQuestionSwitchTab,
    toggleQuestionCollapse,
    isQuestionCollapsed,
    handleToolToggleCollapse,
    toggleThinkingCollapse,
    getResponseCollapseState,
    toggleResponseCollapse,
    isLastUserMessage,
    openActionMenuIndex,
    toggleActionMenu,
    closeActionMenu
  }
}
