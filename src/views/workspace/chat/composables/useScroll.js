/**
 * useScroll composable
 */
export function useScroll(messagesContainer) {
  function scrollToBottom(behavior = 'auto') {
    const container = messagesContainer?.value
    if (!container) return
    container.scrollTo({
      top: container.scrollHeight,
      behavior
    })
  }

  function isNearBottom(threshold = 24) {
    const container = messagesContainer?.value
    if (!container) return true
    return container.scrollHeight - container.scrollTop - container.clientHeight <= threshold
  }

  return {
    scrollToBottom,
    isNearBottom
  }
}
