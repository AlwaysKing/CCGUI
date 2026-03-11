/**
 * useMessageList - 消息列表逻辑 composable
 * 封装消息列表的状态和操作方法
 */
import { ref, computed } from 'vue'

// Rewind 消息折叠状态
const rewindCollapseStates = ref({})

// 问答消息的 active tab
const questionActiveTabs = ref({})

// 操作菜单状态
const openActionMenuIndex = ref(-1)

export function useMessageList() {
  // ============ Rewind 消息折叠 ============

  function toggleRewindCollapse(messageId) {
    rewindCollapseStates.value[messageId] = !rewindCollapseStates.value[messageId]
  }

  function isRewindCollapsed(messageId) {
    return rewindCollapseStates.value[messageId] !== false // 默认折叠
  }

  // ============ 问答消息 ============

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

  // ============ 工具消息折叠 ============

  function handleToolToggleCollapse(message) {
    if (message) {
      message.collapsed = !message.collapsed
      message.manuallyExpanded = !message.collapsed
    }
  }

  // ============ 思考过程折叠 ============

  function toggleThinkingCollapse(message) {
    if (message) {
      message.thinkingCollapsed = !message.thinkingCollapsed
    }
  }

  // ============ 用户消息回答折叠 ============

  function getResponseCollapseState(messages, messageIndex) {
    // 向前查找最近的用户消息
    for (let i = messageIndex - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        if (messages[i].responseCollapsed) {
          return { collapsed: true, byUserIndex: i }
        }
        break // 找到最近的用户消息就停止
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

  // ============ 用户消息判断 ============

  function isLastUserMessage(messages, index) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'user') {
        return i === index
      }
    }
    return false
  }

  // ============ 操作菜单 ============

  function toggleActionMenu(index) {
    openActionMenuIndex.value = openActionMenuIndex.value === index ? -1 : index
  }

  function closeActionMenu() {
    openActionMenuIndex.value = -1
  }

  // ============ 暴露 ============

  return {
    // Rewind
    toggleRewindCollapse,
    isRewindCollapsed,

    // Question
    getQuestionActiveTab,
    handleQuestionSwitchTab,
    toggleQuestionCollapse,
    isQuestionCollapsed,

    // Tool
    handleToolToggleCollapse,

    // Thinking
    toggleThinkingCollapse,

    // Response collapse
    getResponseCollapseState,
    toggleResponseCollapse,

    // User message
    isLastUserMessage,

    // Action menu
    openActionMenuIndex,
    toggleActionMenu,
    closeActionMenu
  }
}
