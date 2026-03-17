import { ref } from 'vue'

export function useProjectDrop(store, logger) {
  const isDragging = ref(false)
  const initialProjectPath = ref('')
  const showNewProjectDialog = ref(false)

  function handleDragEnter(event) {
    event.preventDefault()
    logger.info('DragEnter triggered', {
      type: event.type,
      target: event.target?.className,
      relatedTarget: event.relatedTarget?.className,
      isDraggingBefore: isDragging.value
    })
    isDragging.value = true
    logger.info('DragEnter completed', { isDraggingAfter: isDragging.value })
  }

  function handleDragOver(event) {
    event.preventDefault()
    logger.debug('DragOver triggered', {
      type: event.type,
      target: event.target?.className,
      isDragging: isDragging.value
    })
    isDragging.value = true
  }

  function handleDragLeave(event) {
    event.preventDefault()
    logger.info('DragLeave triggered', {
      type: event.type,
      target: event.target?.className,
      relatedTarget: event.relatedTarget?.className,
      relatedTargetNull: !event.relatedTarget,
      isDraggingBefore: isDragging.value
    })

    if (!event.relatedTarget) {
      logger.info('DragLeave: relatedTarget is null, hiding overlay')
      isDragging.value = false
    } else {
      logger.info('DragLeave: relatedTarget exists, keeping overlay', {
        relatedTargetClass: event.relatedTarget?.className
      })
    }
    logger.info('DragLeave completed', { isDraggingAfter: isDragging.value })
  }

  async function handleDrop(event) {
    event.preventDefault()
    event.stopPropagation()

    logger.info('Drop triggered', {
      isDraggingBefore: isDragging.value,
      hasFiles: !!event.dataTransfer?.files,
      filesCount: event.dataTransfer?.files?.length
    })

    isDragging.value = false
    logger.info('Drop: overlay hidden')

    const files = event.dataTransfer?.files
    if (!files?.length) {
      logger.warn('Drop: no files')
      return
    }

    const file = files[0]
    const fullPath = file.path

    logger.info('Drop: file info', {
      name: file.name,
      type: file.type,
      path: fullPath
    })

    if (!fullPath) {
      logger.warn('Drop: file has no path property')
      return
    }

    try {
      const result = await window.electronAPI.checkProjectExists({ projectPath: fullPath })
      logger.info('Drop: checkProjectExists result', { result })

      if (!result?.exists) {
        logger.warn('Drop: path does not exist', { path: fullPath })
        return
      }

      const found = store.projects.find(project => project.path === fullPath)
      if (found) {
        logger.info('Drop: project exists, opening', { projectId: found.id })
        store.selectProject(found)
        return
      }

      logger.info('Drop: new project, opening new project dialog', { path: fullPath })
      initialProjectPath.value = fullPath
      showNewProjectDialog.value = true
    } catch (error) {
      logger.error('Failed to check dropped path:', error)
      isDragging.value = false
    }
  }

  function resetNewProjectDialog() {
    showNewProjectDialog.value = false
    initialProjectPath.value = ''
  }

  return {
    isDragging,
    initialProjectPath,
    showNewProjectDialog,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    resetNewProjectDialog
  }
}
