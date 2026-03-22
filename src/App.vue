<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAppStore } from './stores/useAppStore'
import { logger } from './utils/logger'
import { buildRuntimeShortcuts, findMatchingShortcut, getDefaultShortcutBindings, normalizeShortcutBindings } from './utils/shortcuts'
import Welcome from './views/welcome/Welcome.vue'
import Workspace from './views/workspace/Workspace.vue'

const store = useAppStore()
const shortcutBindings = ref(getDefaultShortcutBindings())
const runtimeShortcuts = computed(() => buildRuntimeShortcuts(shortcutBindings.value))

function isEditableTarget(target) {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.isContentEditable) {
    return true
  }

  const tagName = target.tagName?.toLowerCase()
  if (tagName === 'textarea') {
    return true
  }

  if (tagName === 'input') {
    const inputType = (target.getAttribute('type') || 'text').toLowerCase()
    return !['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'].includes(inputType)
  }

  if (target.closest('.monaco-editor textarea, .monaco-editor .inputarea')) {
    return true
  }

  return false
}

function handleGlobalSelectAll(event) {
  if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'a') {
    return
  }

  if (isEditableTarget(event.target)) {
    return
  }

  event.preventDefault()
}

function handleGlobalShortcut(event) {
  const shortcut = findMatchingShortcut(event, runtimeShortcuts.value)
  if (!shortcut) {
    return
  }

  if (!shortcut.allowInEditable && isEditableTarget(event.target)) {
    return
  }

  event.preventDefault()
  window.dispatchEvent(new CustomEvent('ccgui-shortcut', {
    detail: {
      action: shortcut.action,
      combo: shortcut.combo,
      id: shortcut.id
    }
  }))
}

async function loadShortcutBindings() {
  try {
    const result = await window.electronAPI.getAppConfig()
    if (result?.success) {
      shortcutBindings.value = {
        ...getDefaultShortcutBindings(),
        ...normalizeShortcutBindings(result.config?.settings?.shortcutBindings || {})
      }
    }
  } catch (error) {
    logger.warn('Failed to load shortcut bindings', { error: error.message })
  }
}

function handleAppConfigUpdated(event) {
  const nextSettings = event?.detail?.settings
  if (!nextSettings) return

  shortcutBindings.value = {
    ...getDefaultShortcutBindings(),
    ...normalizeShortcutBindings(nextSettings.shortcutBindings || {})
  }
}

// 当前视图: 'welcome' | 'workspace'
const currentView = computed(() => {
  return store.currentProject ? 'workspace' : 'welcome'
})

// 更新窗口标题
async function updateWindowTitle() {
  try {
    const title = currentView.value === 'welcome'
      ? '首页'
      : store.currentProject?.name || '未知项目'

    await window.electronAPI?.updateWindowTitle({ title })
    logger.info('Window title updated', { title, view: currentView.value })
  } catch (error) {
    logger.error('Failed to update window title', { error: error.message })
  }
}

// 监听视图变化更新标题
watch(currentView, () => {
  updateWindowTitle()
})

onMounted(async () => {
  // 检查多会话 API 是否可用（开发模式自动启用）
  const isDev = import.meta.env.DEV
  const forceMultiSession = localStorage.getItem('ccgui_force_multi_session') === 'true'

  logger.info('App mounted', { isDev, forceMultiSession, hasAPI: !!window.electronAPI?.getProjects })

  // Check URL params for projectId (for new window)
  const searchString = window.location.search
  logger.info('Checking URL params', { search: searchString, href: window.location.href })

  const urlParams = new URLSearchParams(searchString)
  const projectId = urlParams.get('projectId')

  if (projectId) {
    logger.info('Opening project from URL param', { projectId })
    try {
      // Fetch projects first
      await store.fetchProjects()
      logger.info('Projects loaded', { count: store.projects.length })

      // Find and select the project
      const project = store.projects.find(p => p.id === projectId)
      if (project) {
        store.selectProject(project)
        logger.info('Project selected successfully', { projectName: project.name, projectId })
      } else {
        logger.error('Project not found', { projectId, availableProjects: store.projects.map(p => ({ id: p.id, name: p.name })) })
      }
    } catch (error) {
      logger.error('Failed to load project', { projectId, error: error.message })
    }
  }

  // Update window title on mount
  updateWindowTitle()
  await loadShortcutBindings()

  document.addEventListener('keydown', handleGlobalSelectAll, true)
  document.addEventListener('keydown', handleGlobalShortcut, true)
  window.addEventListener('ccgui-app-config-updated', handleAppConfigUpdated)

  // Get runtime info
  try {
    const info = await window.electronAPI.getRuntimeInfo()
    logger.info('Runtime info retrieved', info)
  } catch (error) {
    logger.error('Failed to get runtime info', { error: error.message })
  }

})

onUnmounted(() => {
  document.removeEventListener('keydown', handleGlobalSelectAll, true)
  document.removeEventListener('keydown', handleGlobalShortcut, true)
  window.removeEventListener('ccgui-app-config-updated', handleAppConfigUpdated)
})
</script>

<template>
  <div class="app-container">
    <!-- Welcome Page - 显示项目列表 -->
    <Welcome v-if="currentView === 'welcome'" />

    <!-- Workspace - 两栏布局（会话 + 聊天） -->
    <Workspace v-else />
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

body {
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

#app {
  height: 100vh;
}
</style>

<style scoped>
.app-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: #1E1E1E;
  color: #E4E4E7;
}
</style>
