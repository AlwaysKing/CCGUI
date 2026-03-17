import { ref } from 'vue'

export function useWorkspaceLayout() {
  const sessionSidebarRef = ref(null)
  const chatRef = ref(null)
  const sidebarWidth = ref(260)
  const isResizing = ref(false)
  const sidebarCollapsed = ref(false)

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  function startResize(event) {
    isResizing.value = true
    event.preventDefault()
  }

  function handleResize(event) {
    if (!isResizing.value) return

    const newWidth = event.clientX
    if (newWidth >= 180 && newWidth <= 500) {
      sidebarWidth.value = newWidth
    }
  }

  function stopResize() {
    isResizing.value = false
  }

  return {
    sessionSidebarRef,
    chatRef,
    sidebarWidth,
    sidebarCollapsed,
    toggleSidebar,
    startResize,
    handleResize,
    stopResize
  }
}
