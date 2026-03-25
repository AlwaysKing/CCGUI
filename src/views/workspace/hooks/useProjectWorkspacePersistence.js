import { nextTick, onUnmounted, ref, watch } from 'vue'

function clamp(value, min, max, fallback) {
  const nextValue = Number(value)
  if (!Number.isFinite(nextValue)) {
    return fallback
  }
  return Math.max(min, Math.min(max, nextValue))
}

function normalizeSidebarPanelLayout(layout = {}) {
  return {
    showConfigPanel: Boolean(layout?.showConfigPanel),
    fileSectionHeight: clamp(layout?.fileSectionHeight, 20, 75, 48)
  }
}

function toSerializable(value) {
  if (value === null || value === undefined) {
    return value
  }

  if (Array.isArray(value)) {
    return value.map(item => toSerializable(item))
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (typeof value === 'object') {
    const result = {}
    for (const [key, nestedValue] of Object.entries(value)) {
      if (typeof nestedValue === 'function') {
        continue
      }
      result[key] = toSerializable(nestedValue)
    }
    return result
  }

  return value
}

export function useProjectWorkspacePersistence({
  store,
  fileBrowserStore,
  sessionSidebarRef,
  sidebarWidth,
  sidebarCollapsed,
  previewWidth,
  isChatCollapsed,
  lastExpandedPreviewWidth,
  terminalPanelVisible,
  terminalPanelHeight,
  terminalMinHeight,
  terminalMaxHeight
}) {
  const sidebarPanelLayout = ref({
    showConfigPanel: false,
    fileSectionHeight: 48
  })
  const latestProjectSettings = ref({})
  const isRestoringProjectWorkspace = ref(false)
  const hasLoadedProjectWorkspace = ref(false)

  let persistProjectWorkspaceTimer = null
  let projectWorkspaceRestoreToken = 0
  let restoreProjectWorkspaceTimer = null

  function normalizeWorkspaceLayout(layout = {}) {
    return {
      sidebarWidth: clamp(layout?.sidebarWidth, 180, 500, 260),
      sidebarCollapsed: Boolean(layout?.sidebarCollapsed),
      previewWidth: clamp(layout?.previewWidth, 24, 65, 42),
      isChatCollapsed: Boolean(layout?.isChatCollapsed),
      lastExpandedPreviewWidth: clamp(layout?.lastExpandedPreviewWidth, 24, 65, 42),
      terminalPanelVisible: Boolean(layout?.terminalPanelVisible),
      terminalPanelHeight: clamp(layout?.terminalPanelHeight, terminalMinHeight, terminalMaxHeight, 220),
      sidebarPanelLayout: normalizeSidebarPanelLayout(layout?.sidebarPanelLayout)
    }
  }

  function buildWorkspaceLayoutSnapshot() {
    return {
      sidebarWidth: clamp(sidebarWidth.value, 180, 500, 260),
      sidebarCollapsed: Boolean(sidebarCollapsed.value),
      previewWidth: clamp(previewWidth.value, 24, 65, 42),
      isChatCollapsed: Boolean(isChatCollapsed.value),
      lastExpandedPreviewWidth: clamp(lastExpandedPreviewWidth.value, 24, 65, 42),
      terminalPanelVisible: Boolean(terminalPanelVisible.value),
      terminalPanelHeight: clamp(terminalPanelHeight.value, terminalMinHeight, terminalMaxHeight, 220),
      sidebarPanelLayout: normalizeSidebarPanelLayout(sidebarPanelLayout.value)
    }
  }

  async function refreshProjectSettingsCache(projectId = store.currentProject?.id) {
    if (!projectId) {
      latestProjectSettings.value = {}
      return {}
    }

    const result = await window.electronAPI.getProjectConfig({ projectId })
    const settings = result?.config?.settings || {}
    latestProjectSettings.value = settings
    return settings
  }

  async function restoreProjectWorkspaceState(project) {
    const projectId = project?.id
    projectWorkspaceRestoreToken += 1
    const restoreToken = projectWorkspaceRestoreToken

    if (persistProjectWorkspaceTimer) {
      clearTimeout(persistProjectWorkspaceTimer)
      persistProjectWorkspaceTimer = null
    }

    hasLoadedProjectWorkspace.value = false
    latestProjectSettings.value = {}

    if (!projectId) {
      return
    }

    const settings = await refreshProjectSettingsCache(projectId)
    if (restoreToken !== projectWorkspaceRestoreToken) {
      return
    }

    const layout = normalizeWorkspaceLayout(settings.workspaceLayout || {})
    const filePreviewState = settings.filePreviewState || {}

    isRestoringProjectWorkspace.value = true
    try {
      sidebarWidth.value = layout.sidebarWidth
      sidebarCollapsed.value = layout.sidebarCollapsed
      previewWidth.value = layout.previewWidth
      isChatCollapsed.value = layout.isChatCollapsed
      lastExpandedPreviewWidth.value = layout.lastExpandedPreviewWidth
      terminalPanelVisible.value = layout.terminalPanelVisible
      terminalPanelHeight.value = layout.terminalPanelHeight
      sidebarPanelLayout.value = layout.sidebarPanelLayout

      await nextTick()
      sessionSidebarRef.value?.applyLayoutState?.(layout.sidebarPanelLayout)
      await fileBrowserStore.restoreWorkspaceState?.(filePreviewState)
    } finally {
      if (restoreToken === projectWorkspaceRestoreToken) {
        isRestoringProjectWorkspace.value = false
      }
    }

    if (restoreToken !== projectWorkspaceRestoreToken) {
      return
    }

    hasLoadedProjectWorkspace.value = true
  }

  async function persistProjectWorkspaceState() {
    if (!store.currentProject?.id || !hasLoadedProjectWorkspace.value || isRestoringProjectWorkspace.value) {
      return
    }

    const nextSettings = toSerializable({
      ...latestProjectSettings.value,
      workspaceLayout: buildWorkspaceLayoutSnapshot(),
      filePreviewState: fileBrowserStore.exportWorkspaceState()
    })

    latestProjectSettings.value = nextSettings
    await window.electronAPI.updateProjectConfig({
      projectId: store.currentProject.id,
      updates: {
        settings: nextSettings
      }
    })
  }

  function schedulePersistProjectWorkspaceState() {
    if (!store.currentProject?.id || !hasLoadedProjectWorkspace.value || isRestoringProjectWorkspace.value) {
      return
    }

    if (persistProjectWorkspaceTimer) {
      clearTimeout(persistProjectWorkspaceTimer)
    }

    persistProjectWorkspaceTimer = setTimeout(() => {
      persistProjectWorkspaceTimer = null
      persistProjectWorkspaceState()
    }, 220)
  }

  function handleSidebarLayoutChange(nextLayout) {
    sidebarPanelLayout.value = normalizeSidebarPanelLayout(nextLayout)
  }

  watch(() => store.currentProject?.id, () => {
    if (restoreProjectWorkspaceTimer) {
      clearTimeout(restoreProjectWorkspaceTimer)
      restoreProjectWorkspaceTimer = null
    }

    const project = store.currentProject
    restoreProjectWorkspaceTimer = setTimeout(() => {
      restoreProjectWorkspaceTimer = null
      void restoreProjectWorkspaceState(project)
    }, 0)
  }, { immediate: true })

  watch([
    sidebarWidth,
    sidebarCollapsed,
    previewWidth,
    isChatCollapsed,
    lastExpandedPreviewWidth,
    terminalPanelVisible,
    terminalPanelHeight,
    () => sidebarPanelLayout.value.showConfigPanel,
    () => sidebarPanelLayout.value.fileSectionHeight
  ], () => {
    schedulePersistProjectWorkspaceState()
  })

  watch(() => JSON.stringify(fileBrowserStore.exportWorkspaceState()), () => {
    schedulePersistProjectWorkspaceState()
  })

  onUnmounted(() => {
    if (restoreProjectWorkspaceTimer) {
      clearTimeout(restoreProjectWorkspaceTimer)
      restoreProjectWorkspaceTimer = null
    }
    if (persistProjectWorkspaceTimer) {
      clearTimeout(persistProjectWorkspaceTimer)
      persistProjectWorkspaceTimer = null
    }
  })

  return {
    refreshProjectSettingsCache,
    handleSidebarLayoutChange
  }
}
