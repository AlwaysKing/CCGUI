/**
 * useScroll composable
 * 滚动相关的逻辑
 */
import { ref, nextTick, watch } from 'vue'

export function useScroll(messagesContainer) {
  // 用户是否主动滚动离开底部
  let userScrolledAway = false

  // 粘性消息索引
  const stickyMessageIndex = ref(-1)

  // 容器高度
  const containerHeight = ref(400)

  /**
   * 滚动到底部
   */
  function scrollToBottom(forceScroll = false) {
    if (!messagesContainer.value) return

    const container = messagesContainer.value

    // 如果不强制滚动，检查当前是否接近底部
    if (!forceScroll) {
      const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100

      // 如果用户已经滚动离开底部，不要自动滚动
      if (userScrolledAway && !isNearBottom) {
        return
      }

      // 如果当前不在底部，也不滚动
      if (!isNearBottom) {
        return
      }
    }

    // 重置用户滚动标记
    userScrolledAway = false

    // 使用 requestAnimationFrame 确保在下一帧渲染后滚动
    const doScroll = () => {
      if (messagesContainer.value) {
        messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
      }
    }

    // 立即滚动一次
    doScroll()

    // 等待 DOM 完全更新后再滚动一次
    nextTick(() => {
      requestAnimationFrame(() => {
        doScroll()

        // 再延迟一点时间，确保所有内容都已渲染完成
        setTimeout(() => {
          doScroll()
        }, 100)
      })
    })
  }

  /**
   * 处理用户滚动事件
   */
  function handleUserScroll() {
    if (!messagesContainer.value) return
    const container = messagesContainer.value
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 100

    // 如果用户滚动离开底部，设置标记
    if (!isNearBottom) {
      userScrolledAway = true
    } else {
      // 如果用户滚动到底部，重置标记
      userScrolledAway = false
    }

    // 计算当前粘性显示的用户消息
    updateStickyMessage()
  }

  /**
   * 更新粘性头部显示的用户消息
   */
  function updateStickyMessage(messages) {
    if (!messagesContainer.value || !messages) return
    const container = messagesContainer.value

    // 获取所有消息元素
    const messageElements = container.querySelectorAll('.message')

    let currentStickyIndex = -1

    // 从上往下遍历，找到最后一个已经滚过顶部的用户消息
    messageElements.forEach((el, idx) => {
      const rect = el.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()

      // 如果消息顶部已经在容器顶部以上（或刚好在顶部）
      if (rect.top <= containerRect.top + 10) {
        // 检查这个消息是否是用户消息，或者它前面的最近用户消息
        const msgIndex = parseInt(el.getAttribute('data-index') || idx)
        const msg = messages[msgIndex]

        if (msg && msg.role === 'user') {
          currentStickyIndex = msgIndex
        }
      }
    })

    // 检查可见区域内是否有用户消息
    let hasVisibleUserMessage = false
    messageElements.forEach((el, idx) => {
      const rect = el.getBoundingClientRect()
      const containerRect = container.getBoundingClientRect()

      // 消息在可见区域内
      if (rect.bottom > containerRect.top && rect.top < containerRect.bottom) {
        const msgIndex = parseInt(el.getAttribute('data-index') || idx)
        const msg = messages[msgIndex]
        if (msg && msg.role === 'user') {
          hasVisibleUserMessage = true
        }
      }
    })

    // 只有当可见区域内没有用户消息时，才显示粘性头部
    if (hasVisibleUserMessage) {
      stickyMessageIndex.value = -1
    } else if (currentStickyIndex >= 0) {
      stickyMessageIndex.value = currentStickyIndex
    } else {
      stickyMessageIndex.value = -1
    }
  }

  /**
   * 滚动到指定消息
   */
  function scrollToMessage(messageId) {
    if (!messagesContainer.value) return

    const messageElement = document.querySelector(`[data-message-id="${messageId}"]`)
    if (messageElement) {
      messageElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
      // 高亮效果
      messageElement.classList.add('highlight-message')
      setTimeout(() => {
        messageElement.classList.remove('highlight-message')
      }, 2000)
    }
  }

  /**
   * 设置 ResizeObserver 监听容器高度变化
   */
  function setupResizeObserver() {
    if (messagesContainer.value) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          containerHeight.value = entry.contentRect.height
        }
      })
      resizeObserver.observe(messagesContainer.value)
      return resizeObserver
    }
    return null
  }

  return {
    stickyMessageIndex,
    containerHeight,
    scrollToBottom,
    handleUserScroll,
    updateStickyMessage,
    scrollToMessage,
    setupResizeObserver
  }
}
