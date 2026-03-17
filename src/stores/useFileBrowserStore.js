import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useAppStore } from './useAppStore'
import { logger } from '../utils/logger'

function normalizePath(value = '') {
  return String(value || '').replace(/\\/g, '/')
}

function createNode(entry) {
  return {
    name: entry.name,
    path: normalizePath(entry.path),
    type: entry.type,
    extension: entry.extension || '',
    hasChildren: !!entry.hasChildren,
    children: [],
    loaded: false,
    loading: false,
    error: null
  }
}

function getParentPath(targetPath = '') {
  const normalizedPath = normalizePath(targetPath)
  if (!normalizedPath) return ''
  const segments = normalizedPath.split('/').filter(Boolean)
  segments.pop()
  return segments.join('/')
}

function getBaseName(targetPath = '') {
  const normalizedPath = normalizePath(targetPath)
  return normalizedPath.split('/').pop() || normalizedPath
}

function createTabBase(filePath, options = {}) {
  const normalizedPath = normalizePath(filePath)
  const name = normalizedPath.split('/').pop() || normalizedPath

  return {
    id: normalizedPath,
    path: normalizedPath,
    name,
    language: options.language || 'plaintext',
    content: options.content || '',
    savedContent: options.savedContent || '',
    isDirty: !!options.isDirty,
    pinned: !!options.pinned,
    isPreview: !!options.isPreview,
    loaded: !!options.loaded,
    loading: !!options.loading,
    error: options.error || null,
    updatedAt: options.updatedAt || null,
    size: options.size || 0
  }
}

export const useFileBrowserStore = defineStore('file-browser', () => {
  const appStore = useAppStore()

  const isFilePanelVisible = ref(false)
  const isPreviewPanelVisible = ref(false)
  const tree = ref([])
  const expandedDirs = ref(new Set())
  const loadingDirs = ref(new Set())
  const activeFilePath = ref('')
  const selectedNodePath = ref('')
  const editingNodePath = ref('')
  const tabs = ref([])
  const previewTabId = ref('')
  const isTreeLoading = ref(false)
  const treeError = ref('')

  const projectPath = computed(() => appStore.currentProject?.path || '')

  const activeTab = computed(() => tabs.value.find(tab => tab.path === activeFilePath.value) || null)
  const hasOpenFiles = computed(() => tabs.value.length > 0 || !!activeFilePath.value)
  const shouldShowPreviewPanel = computed(() => isPreviewPanelVisible.value)

  function resetState() {
    tree.value = []
    expandedDirs.value = new Set()
    loadingDirs.value = new Set()
    activeFilePath.value = ''
    selectedNodePath.value = ''
    editingNodePath.value = ''
    tabs.value = []
    previewTabId.value = ''
    isTreeLoading.value = false
    treeError.value = ''
    isPreviewPanelVisible.value = false
  }

  function setNodeChildren(nodes, targetPath, children) {
    return nodes.map(node => {
      if (node.path === targetPath) {
        return {
          ...node,
          children,
          loaded: true,
          loading: false,
          error: null,
          hasChildren: children.length > 0
        }
      }

      if (node.children?.length) {
        return {
          ...node,
          children: setNodeChildren(node.children, targetPath, children)
        }
      }

      return node
    })
  }

  function findNodeByPath(nodes, targetPath) {
    for (const node of nodes) {
      if (node.path === targetPath) {
        return node
      }
      if (node.children?.length) {
        const found = findNodeByPath(node.children, targetPath)
        if (found) return found
      }
    }
    return null
  }

  function setNodeState(nodes, targetPath, patch) {
    return nodes.map(node => {
      if (node.path === targetPath) {
        return {
          ...node,
          ...patch
        }
      }
      if (node.children?.length) {
        return {
          ...node,
          children: setNodeState(node.children, targetPath, patch)
        }
      }
      return node
    })
  }

  async function loadDirectory(relativePath = '') {
    if (!projectPath.value) return []

    const normalizedPath = normalizePath(relativePath)

    if (!normalizedPath) {
      isTreeLoading.value = true
      treeError.value = ''
    } else {
      loadingDirs.value = new Set([...loadingDirs.value, normalizedPath])
      tree.value = setNodeState(tree.value, normalizedPath, { loading: true, error: null })
    }

    try {
      const result = await window.electronAPI.listProjectFiles({
        projectPath: projectPath.value,
        relativePath: normalizedPath
      })

      if (!result?.success) {
        throw new Error(result?.error || '加载目录失败')
      }

      const children = (result.entries || []).map(entry => createNode(entry))

      if (!normalizedPath) {
        tree.value = children
      } else {
        tree.value = setNodeChildren(tree.value, normalizedPath, children)
      }

      return children
    } catch (error) {
      const message = error.message || '加载目录失败'
      if (!normalizedPath) {
        treeError.value = message
        tree.value = []
      } else {
        tree.value = setNodeState(tree.value, normalizedPath, {
          loading: false,
          error: message,
          loaded: true
        })
      }
      logger.error('[FileBrowser] Failed to load directory', { relativePath: normalizedPath, error: message })
      return []
    } finally {
      if (!normalizedPath) {
        isTreeLoading.value = false
      } else {
        const nextLoading = new Set(loadingDirs.value)
        nextLoading.delete(normalizedPath)
        loadingDirs.value = nextLoading
      }
    }
  }

  async function refreshTree() {
    if (!projectPath.value) {
      resetState()
      return
    }

    await loadDirectory('')

    const expandedPaths = [...expandedDirs.value].sort((left, right) => {
      return left.split('/').length - right.split('/').length
    })
    for (const directoryPath of expandedPaths) {
      await loadDirectory(directoryPath)
    }
  }

  async function toggleDirectory(node) {
    const normalizedPath = normalizePath(node.path)
    selectedNodePath.value = normalizedPath
    const nextExpanded = new Set(expandedDirs.value)

    if (nextExpanded.has(normalizedPath)) {
      nextExpanded.delete(normalizedPath)
      expandedDirs.value = nextExpanded
      return
    }

    nextExpanded.add(normalizedPath)
    expandedDirs.value = nextExpanded

    if (!node.loaded) {
      await loadDirectory(normalizedPath)
    }
  }

  async function ensureFileLoaded(filePath) {
    const normalizedPath = normalizePath(filePath)
    const currentTab = tabs.value.find(tab => tab.path === normalizedPath)
    if (!currentTab) return null
    if (currentTab.loaded || currentTab.error) return currentTab

    currentTab.loading = true
    currentTab.error = null

    try {
      const result = await window.electronAPI.readProjectFile({
        projectPath: projectPath.value,
        filePath: normalizedPath
      })

      if (!result?.success) {
        throw new Error(result?.error || '读取文件失败')
      }

      currentTab.content = result.file.content || ''
      currentTab.savedContent = result.file.content || ''
      currentTab.language = result.file.language || currentTab.language
      currentTab.updatedAt = result.file.updatedAt || null
      currentTab.size = result.file.size || 0
      currentTab.isDirty = false
      currentTab.loaded = true
      return currentTab
    } catch (error) {
      currentTab.error = error.message || '读取文件失败'
      return currentTab
    } finally {
      currentTab.loading = false
    }
  }

  function setActiveTab(tabPath) {
    activeFilePath.value = normalizePath(tabPath)
  }

  function setSelectedNode(nodePath) {
    selectedNodePath.value = normalizePath(nodePath)
  }

  function startRenaming(nodePath) {
    editingNodePath.value = normalizePath(nodePath)
    selectedNodePath.value = normalizePath(nodePath)
  }

  function stopRenaming() {
    editingNodePath.value = ''
  }

  async function openFile(filePath, { pinned = false, preview = false } = {}) {
    if (!projectPath.value) return null

    const normalizedPath = normalizePath(filePath)
    let targetTab = tabs.value.find(tab => tab.path === normalizedPath)

    if (!targetTab) {
      if (preview && previewTabId.value) {
        const previewIndex = tabs.value.findIndex(tab => tab.id === previewTabId.value && !tab.pinned)
        if (previewIndex >= 0) {
          if (tabs.value[previewIndex].isDirty) {
            tabs.value[previewIndex].pinned = true
            tabs.value[previewIndex].isPreview = false
          } else {
            tabs.value.splice(previewIndex, 1)
          }
        }
      }

      targetTab = createTabBase(normalizedPath, {
        pinned,
        isPreview: preview && !pinned,
        loaded: false,
        loading: false
      })
      tabs.value.push(targetTab)
    } else if (pinned) {
      targetTab.pinned = true
      targetTab.isPreview = false
    } else if (preview && !targetTab.pinned) {
      targetTab.isPreview = true
    }

    if (preview && !targetTab.pinned) {
      previewTabId.value = targetTab.id
    } else if (targetTab.id === previewTabId.value) {
      previewTabId.value = ''
    }

    activeFilePath.value = normalizedPath
    selectedNodePath.value = normalizedPath
    isPreviewPanelVisible.value = true
    await ensureFileLoaded(normalizedPath)
    return targetTab
  }

  async function previewFile(filePath) {
    return openFile(filePath, { preview: true, pinned: false })
  }

  async function pinFile(filePath) {
    return openFile(filePath, { preview: false, pinned: true })
  }

  function generateUniqueName(parentNodePath, baseName, type) {
    const parentNode = parentNodePath ? findNodeByPath(tree.value, parentNodePath) : null
    const siblings = parentNode ? (parentNode.children || []) : tree.value
    const siblingNames = new Set((siblings || []).map(node => node.name))

    if (!siblingNames.has(baseName)) {
      return baseName
    }

    const extension = type === 'file' ? (baseName.includes('.') ? `.${baseName.split('.').slice(1).join('.')}` : '') : ''
    const stem = type === 'file' && extension ? baseName.slice(0, -extension.length) : baseName
    let counter = 1
    let candidate = `${stem}-${counter}${extension}`

    while (siblingNames.has(candidate)) {
      counter += 1
      candidate = `${stem}-${counter}${extension}`
    }

    return candidate
  }

  async function createEntry(parentNodePath = '', type = 'file') {
    if (!projectPath.value) return { success: false, error: '项目不存在' }

    let normalizedParentPath = normalizePath(parentNodePath)
    const parentNode = normalizedParentPath ? findNodeByPath(tree.value, normalizedParentPath) : null
    if (parentNode && parentNode.type !== 'directory') {
      normalizedParentPath = getParentPath(normalizedParentPath)
    } else if (!parentNode && normalizedParentPath) {
      normalizedParentPath = getParentPath(normalizedParentPath)
    }

    const suggestedName = type === 'directory'
      ? generateUniqueName(normalizedParentPath, '新建文件夹', 'directory')
      : generateUniqueName(normalizedParentPath, '新建文件.txt', 'file')

    try {
      const result = await window.electronAPI.createProjectEntry({
        projectPath: projectPath.value,
        parentPath: normalizedParentPath,
        entryType: type,
        name: suggestedName
      })

      if (!result?.success) {
        throw new Error(result?.error || '创建失败')
      }

      const createdParentNode = normalizedParentPath ? findNodeByPath(tree.value, normalizedParentPath) : null
      if (normalizedParentPath && createdParentNode && !expandedDirs.value.has(normalizedParentPath)) {
        expandedDirs.value = new Set([...expandedDirs.value, normalizedParentPath])
      }

      await refreshTree()

      const createdPath = normalizePath(
        result.entry?.path || [normalizedParentPath, suggestedName].filter(Boolean).join('/')
      )
      selectedNodePath.value = createdPath
      editingNodePath.value = createdPath

      if (type === 'file') {
        await previewFile(createdPath)
      }

      return { success: true, path: createdPath }
    } catch (error) {
      return { success: false, error: error.message || '创建失败' }
    }
  }

  async function renameEntry(targetPath, nextName) {
    if (!projectPath.value) return { success: false, error: '项目不存在' }

    const normalizedTargetPath = normalizePath(targetPath)
    const trimmedName = String(nextName || '').trim()
    const currentName = getBaseName(normalizedTargetPath)

    if (!trimmedName) {
      return { success: false, error: '名称不能为空' }
    }

    if (trimmedName === currentName) {
      editingNodePath.value = ''
      return { success: true, path: normalizedTargetPath }
    }

    try {
      const result = await window.electronAPI.renameProjectEntry({
        projectPath: projectPath.value,
        targetPath: normalizedTargetPath,
        newName: trimmedName
      })

      if (!result?.success) {
        throw new Error(result?.error || '重命名失败')
      }

      const oldPath = normalizePath(result.entry?.oldPath || normalizedTargetPath)
      const newPath = normalizePath(result.entry?.path || normalizedTargetPath)

      expandedDirs.value = new Set(
        [...expandedDirs.value].map(item => (
          item === oldPath || item.startsWith(`${oldPath}/`)
            ? item.replace(oldPath, newPath)
            : item
        ))
      )

      tabs.value.forEach(tab => {
        if (tab.path === oldPath || tab.path.startsWith(`${oldPath}/`)) {
          tab.path = tab.path.replace(oldPath, newPath)
          tab.id = tab.path
          tab.name = getBaseName(tab.path)
        }
      })

      if (activeFilePath.value === oldPath || activeFilePath.value.startsWith(`${oldPath}/`)) {
        activeFilePath.value = activeFilePath.value.replace(oldPath, newPath)
      }
      if (previewTabId.value === oldPath || previewTabId.value.startsWith(`${oldPath}/`)) {
        previewTabId.value = previewTabId.value.replace(oldPath, newPath)
      }

      selectedNodePath.value = newPath
      editingNodePath.value = ''
      await refreshTree()
      return { success: true, path: newPath }
    } catch (error) {
      return { success: false, error: error.message || '重命名失败' }
    }
  }

  async function deleteEntry(targetPath) {
    if (!projectPath.value) return { success: false, error: '项目不存在' }

    const normalizedTargetPath = normalizePath(targetPath)

    try {
      const result = await window.electronAPI.deleteProjectEntry({
        projectPath: projectPath.value,
        targetPath: normalizedTargetPath
      })

      if (!result?.success) {
        throw new Error(result?.error || '删除失败')
      }

      tabs.value = tabs.value.filter(tab => tab.path !== normalizedTargetPath && !tab.path.startsWith(`${normalizedTargetPath}/`))
      if (activeFilePath.value === normalizedTargetPath || activeFilePath.value.startsWith(`${normalizedTargetPath}/`)) {
        activeFilePath.value = tabs.value[0]?.path || ''
      }
      if (previewTabId.value === normalizedTargetPath || previewTabId.value.startsWith(`${normalizedTargetPath}/`)) {
        previewTabId.value = ''
      }
      expandedDirs.value = new Set(
        [...expandedDirs.value].filter(item => item !== normalizedTargetPath && !item.startsWith(`${normalizedTargetPath}/`))
      )
      if (selectedNodePath.value === normalizedTargetPath || selectedNodePath.value.startsWith(`${normalizedTargetPath}/`)) {
        selectedNodePath.value = ''
      }
      if (editingNodePath.value === normalizedTargetPath || editingNodePath.value.startsWith(`${normalizedTargetPath}/`)) {
        editingNodePath.value = ''
      }

      await refreshTree()
      return { success: true }
    } catch (error) {
      return { success: false, error: error.message || '删除失败' }
    }
  }

  function updateTabContent(filePath, content) {
    const normalizedPath = normalizePath(filePath)
    const tab = tabs.value.find(item => item.path === normalizedPath)
    if (!tab) return

    tab.content = content
    tab.isDirty = tab.content !== tab.savedContent
    tab.error = null
  }

  async function saveFile(filePath) {
    const normalizedPath = normalizePath(filePath)
    const tab = tabs.value.find(item => item.path === normalizedPath)
    if (!tab) return { success: false, error: '文件未打开' }

    try {
      const result = await window.electronAPI.writeProjectFile({
        projectPath: projectPath.value,
        filePath: normalizedPath,
        content: tab.content
      })

      if (!result?.success) {
        throw new Error(result?.error || '保存失败')
      }

      tab.savedContent = tab.content
      tab.isDirty = false
      tab.loaded = true
      tab.updatedAt = result.file?.updatedAt || null
      tab.size = result.file?.size || tab.size
      tab.error = null

      return { success: true }
    } catch (error) {
      tab.error = error.message || '保存失败'
      return { success: false, error: tab.error }
    }
  }

  function closeTab(filePath) {
    const normalizedPath = normalizePath(filePath)
    const index = tabs.value.findIndex(tab => tab.path === normalizedPath)
    if (index === -1) return

    const [removedTab] = tabs.value.splice(index, 1)
    if (removedTab?.id === previewTabId.value) {
      previewTabId.value = ''
    }

    if (activeFilePath.value === normalizedPath) {
      const nextTab = tabs.value[index] || tabs.value[index - 1] || null
      activeFilePath.value = nextTab?.path || ''
    }
  }

  function hidePreviewPanel() {
    isPreviewPanelVisible.value = false
  }

  function togglePreviewPanel() {
    isPreviewPanelVisible.value = !isPreviewPanelVisible.value
  }

  function closeOtherTabs(filePath) {
    const normalizedPath = normalizePath(filePath)
    tabs.value = tabs.value.filter(tab => tab.path === normalizedPath)
    previewTabId.value = tabs.value[0]?.pinned ? '' : tabs.value[0]?.id || ''
    activeFilePath.value = tabs.value[0]?.path || ''
  }

  function toggleFilePanel() {
    isFilePanelVisible.value = !isFilePanelVisible.value
  }

  watch(projectPath, async (nextProjectPath, previousProjectPath) => {
    if (nextProjectPath === previousProjectPath) return
    resetState()
    if (nextProjectPath) {
      await refreshTree()
    }
  }, { immediate: true })

  return {
    isFilePanelVisible,
    tree,
    expandedDirs,
    loadingDirs,
    activeFilePath,
    selectedNodePath,
    editingNodePath,
    activeTab,
    hasOpenFiles,
    shouldShowPreviewPanel,
    tabs,
    previewTabId,
    isTreeLoading,
    treeError,
    projectPath,
    toggleFilePanel,
    refreshTree,
    toggleDirectory,
    setSelectedNode,
    startRenaming,
    stopRenaming,
    previewFile,
    pinFile,
    createEntry,
    renameEntry,
    deleteEntry,
    setActiveTab,
    updateTabContent,
    saveFile,
    closeTab,
    closeOtherTabs,
    hidePreviewPanel,
    togglePreviewPanel,
    ensureFileLoaded
  }
})
