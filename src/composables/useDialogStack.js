import { onMounted, onUnmounted, watch } from 'vue'

const dialogStack = []
const dialogMap = new Map()
let listenerAttached = false

function attachListener() {
  if (listenerAttached || typeof document === 'undefined') {
    return
  }

  document.addEventListener('keydown', handleDocumentKeydown)
  listenerAttached = true
}

function detachListener() {
  if (!listenerAttached || typeof document === 'undefined' || dialogMap.size > 0) {
    return
  }

  document.removeEventListener('keydown', handleDocumentKeydown)
  listenerAttached = false
}

function handleDocumentKeydown(event) {
  if (event.key !== 'Escape') {
    return
  }

  for (let index = dialogStack.length - 1; index >= 0; index -= 1) {
    const entry = dialogStack[index]
    if (!entry || !entry.isOpen() || entry.closable() === false) {
      continue
    }

    event.preventDefault()
    event.stopPropagation()
    entry.onClose()
    return
  }
}

function activateDialog(id) {
  const existingIndex = dialogStack.findIndex(entry => entry.id === id)
  if (existingIndex !== -1) {
    const [entry] = dialogStack.splice(existingIndex, 1)
    dialogStack.push(entry)
    return
  }

  const entry = dialogMap.get(id)
  if (entry) {
    dialogStack.push(entry)
  }
}

function deactivateDialog(id) {
  const existingIndex = dialogStack.findIndex(entry => entry.id === id)
  if (existingIndex !== -1) {
    dialogStack.splice(existingIndex, 1)
  }
}

export function useDialogStack(isOpenRef, onClose, options = {}) {
  const id = Symbol('dialog-stack-entry')
  const entry = {
    id,
    isOpen: () => Boolean(isOpenRef.value),
    onClose,
    closable: () => options.closable?.value ?? options.closable ?? true
  }

  dialogMap.set(id, entry)

  watch(isOpenRef, (isOpen) => {
    if (isOpen) {
      activateDialog(id)
      attachListener()
      return
    }

    deactivateDialog(id)
    detachListener()
  }, { immediate: true })

  onMounted(() => {
    if (entry.isOpen()) {
      activateDialog(id)
      attachListener()
    }
  })

  onUnmounted(() => {
    deactivateDialog(id)
    dialogMap.delete(id)
    detachListener()
  })
}
