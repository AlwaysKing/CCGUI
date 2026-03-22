/**
 * useHistory composable
 */
export function useHistory(inputAreaRef) {
  let historyIndex = -1
  let isHistoryNavigation = false

  function navigateHistory(direction, inputHistory, currentValue, setValue) {
    if (!inputHistory?.length) return

    if (direction === 'up') {
      if (historyIndex < inputHistory.length - 1) {
        historyIndex += 1
      }
    } else if (direction === 'down') {
      if (historyIndex >= 0) {
        historyIndex -= 1
      }
    }

    isHistoryNavigation = true
    if (historyIndex >= 0) {
      setValue(inputHistory[inputHistory.length - 1 - historyIndex] || '')
    } else {
      setValue(currentValue || '')
    }

    requestAnimationFrame(() => {
      const input = inputAreaRef?.value
      if (input) {
        input.selectionStart = input.value.length
        input.selectionEnd = input.value.length
      }
    })
  }

  function resetHistory() {
    historyIndex = -1
    isHistoryNavigation = false
  }

  return {
    navigateHistory,
    resetHistory,
    get isHistoryNavigation() {
      return isHistoryNavigation
    }
  }
}
