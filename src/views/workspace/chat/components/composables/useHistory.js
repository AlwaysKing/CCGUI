/**
 * useHistory composable
 * 输入历史记录相关的逻辑
 */
import { ref, nextTick } from 'vue'

export function useHistory(inputAreaRef) {
  // 输入历史记录
  const inputHistory = []

  // 当前历史索引，-1 表示不在浏览历史
  let historyIndex = -1

  // 标记是否正在通过历史导航设置值
  let isHistoryNavigation = false

  // 显示历史记录选择弹窗
  const showHistoryPicker = ref(false)

  /**
   * 添加历史记录
   */
  function addToHistory(text) {
    if (!text) return
    // 避免重复
    if (inputHistory.length === 0 || inputHistory[inputHistory.length - 1] !== text) {
      inputHistory.push(text)
      // 限制历史记录数量
      if (inputHistory.length > 100) {
        inputHistory.shift()
      }
    }
    // 重置历史索引
    historyIndex = -1
  }

  /**
   * 处理历史导航按键
   */
  function handleHistoryKey(event, inputMessage, setInputMessage) {
    // 如果输入框有内容且不在历史浏览模式，不触发历史导航
    if (inputMessage.trim() && historyIndex === -1) {
      return
    }

    // 如果没有历史记录，不处理
    if (inputHistory.length === 0) {
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      // 向上：浏览更早的历史（索引增大）
      if (historyIndex < inputHistory.length - 1) {
        historyIndex++
        isHistoryNavigation = true
        setInputMessage(inputHistory[inputHistory.length - 1 - historyIndex])
        isHistoryNavigation = false
      }
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      // 向下：浏览更新的历史（索引减小）
      if (historyIndex > 0) {
        historyIndex--
        isHistoryNavigation = true
        setInputMessage(inputHistory[inputHistory.length - 1 - historyIndex])
        isHistoryNavigation = false
      } else if (historyIndex === 0) {
        // 回到最新状态，清空输入框
        historyIndex = -1
        isHistoryNavigation = true
        setInputMessage('')
        isHistoryNavigation = false
      }
    }
  }

  /**
   * 处理输入变化，退出历史浏览模式
   */
  function handleInputChange(setInputMessage) {
    if (!isHistoryNavigation && historyIndex !== -1) {
      historyIndex = -1
    }
  }

  /**
   * 打开历史记录选择弹窗
   */
  function openHistoryPicker(event) {
    // Escape 关闭弹窗
    if (event.key === 'Escape' && showHistoryPicker.value) {
      event.preventDefault()
      closeHistoryPicker()
      return
    }

    // Cmd+Up (Mac) 或 Ctrl+Up (Windows) 打开弹窗
    if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowUp') {
      event.preventDefault()
      if (inputHistory.length > 0) {
        showHistoryPicker.value = true
      }
    }
  }

  /**
   * 关闭历史记录选择弹窗
   */
  function closeHistoryPicker() {
    showHistoryPicker.value = false
  }

  /**
   * 选择历史记录
   */
  function selectHistory(item, setInputMessage) {
    isHistoryNavigation = true
    setInputMessage(item)
    isHistoryNavigation = false
    historyIndex = -1
    closeHistoryPicker()
    nextTick(() => {
      inputAreaRef?.focus()
    })
  }

  /**
   * 获取历史记录列表（逆序，最新的在前）
   */
  function getHistoryList() {
    return [...inputHistory].reverse()
  }

  return {
    showHistoryPicker,
    addToHistory,
    handleHistoryKey,
    handleInputChange,
    openHistoryPicker,
    closeHistoryPicker,
    selectHistory,
    getHistoryList
  }
}
