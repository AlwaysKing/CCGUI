<script setup>
import { computed, defineAsyncComponent, onMounted, onUnmounted, ref, watch } from 'vue'
import { useAppStore } from './stores/useAppStore'
import { useSessionStore } from './stores/useSessionStore'
import { logger } from './utils/logger'
import { buildRuntimeShortcuts, findMatchingShortcut, getDefaultShortcutBindings, normalizeShortcutBindings } from './utils/shortcuts'

const Welcome = defineAsyncComponent(() => import('./views/welcome/Welcome.vue'))
const Workspace = defineAsyncComponent(() => import('./views/workspace/Workspace.vue'))

const store = useAppStore()
const sessionStore = useSessionStore()
const shortcutBindings = ref(getDefaultShortcutBindings())
const runtimeShortcuts = computed(() => buildRuntimeShortcuts(shortcutBindings.value))

// 窗口关闭确认弹窗
const showCloseConfirm = ref(false)
const closeConfirmBusy = ref(false)

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

// 关闭所有 session 后再允许窗口关闭
async function closeAllSessionsBeforeClose() {
  for (const session of store.sessions) {
    await sessionStore.closeSession(session.id)
  }
}

// 窗口关闭请求处理
async function handleWindowCloseRequest() {
  // 先刷新 session 状态，确保拿到最新数据
  await store.fetchRunningSessions()
  const hasActive = store.hasRunningSessions || store.hasRunningTerminals
  if (hasActive) {
    showCloseConfirm.value = true
    return
  }
  // 没有运行中的任务，关闭所有 session 后再关闭窗口
  await closeAllSessionsBeforeClose()
  await window.electronAPI?.windowCloseResponse({ canClose: true })
}

async function confirmCloseWindow() {
  closeConfirmBusy.value = true
  try {
    await closeAllSessionsBeforeClose()
    await window.electronAPI?.windowCloseResponse({ canClose: true })
  } finally {
    closeConfirmBusy.value = false
    showCloseConfirm.value = false
  }
}

function cancelCloseWindow() {
  showCloseConfirm.value = false
  // 不回复 canClose: true，窗口保持打开
}

// 当前视图: 'welcome' | 'workspace'
const currentView = computed(() => {
  return store.currentProject ? 'workspace' : 'welcome'
})

// Dock 拖拽文件夹路径（用于 Welcome 页面自动弹出新建项目对话框）
const dockDropPath = ref(null)

// 更新窗口标题
async function updateWindowTitle() {
  try {
    const title = currentView.value === 'welcome'
      ? '首页'
      : store.currentProject?.name || '未知项目'

    const projectId = currentView.value === 'welcome' ? null : store.currentProject?.id
    await window.electronAPI?.updateWindowTitle({ title, projectId })
    logger.info('Window title updated', { title, view: currentView.value, projectId })
  } catch (error) {
    logger.error('Failed to update window title', { error: error.message })
  }
}

// 监听视图变化更新标题
watch(currentView, () => {
  updateWindowTitle()
})

onMounted(async () => {
  const appMountedAt = performance.now()
  logger.info('App mounted', { phase: 'start', sinceMountedMs: 0 })

  // 检查多会话 API 是否可用（开发模式自动启用）
  const isDev = import.meta.env.DEV
  const forceMultiSession = localStorage.getItem('ccgui_force_multi_session') === 'true'

  logger.info('App mounted', { isDev, forceMultiSession, hasAPI: !!window.electronAPI?.getProjects })

  // Check URL params for projectId (for new window)
  const searchString = window.location.search
  logger.info('Checking URL params', { search: searchString, href: window.location.href })

  const urlParams = new URLSearchParams(searchString)
  const projectId = urlParams.get('projectId')
  const dropPath = urlParams.get('dockDropPath')

  // 读取 Dock 拖拽的文件夹路径
  if (dropPath) {
    dockDropPath.value = dropPath
    logger.info('Dock drop path detected from URL', { dockDropPath: dropPath })
  }

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
  logger.info('App mounted', {
    phase: 'after-shortcuts',
    sinceMountedMs: Math.round(performance.now() - appMountedAt)
  })

  document.addEventListener('keydown', handleGlobalSelectAll, true)
  document.addEventListener('keydown', handleGlobalShortcut, true)
  window.addEventListener('ccgui-app-config-updated', handleAppConfigUpdated)

  // 注册窗口关闭请求回调
  window.electronAPI?.onWindowCloseRequest(handleWindowCloseRequest)

  // Get runtime info
  try {
    const info = await window.electronAPI.getRuntimeInfo()
    logger.info('Runtime info retrieved', info)
  } catch (error) {
    logger.error('Failed to get runtime info', { error: error.message })
  }

  logger.info('App mounted', {
    phase: 'complete',
    sinceMountedMs: Math.round(performance.now() - appMountedAt)
  })

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
    <Welcome v-if="currentView === 'welcome'" :dock-drop-path="dockDropPath" @dock-drop-consumed="dockDropPath = null" />

    <!-- Workspace - 两栏布局（会话 + 聊天） -->
    <Workspace v-else />

    <!-- 窗口关闭确认弹窗 -->
    <div v-if="showCloseConfirm" class="close-confirm-overlay">
      <div class="close-confirm-dialog">
        <div class="close-confirm-content">
          <div class="close-confirm-icon">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#F97316" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 8v4"/>
              <path d="M12 16h.01"/>
            </svg>
          </div>
          <div class="close-confirm-text">
            <h3>确认关闭窗口？</h3>
            <p>当前有正在运行的会话或终端任务，关闭窗口将中断这些操作。</p>
          </div>
        </div>
        <div class="close-confirm-actions">
          <button class="close-confirm-btn cancel" @click="cancelCloseWindow">
            取消
          </button>
          <button class="close-confirm-btn confirm" :disabled="closeConfirmBusy" @click="confirmCloseWindow">
            {{ closeConfirmBusy ? '关闭中...' : '确认关闭' }}
          </button>
        </div>
      </div>
    </div>
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

.close-confirm-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
}

.close-confirm-dialog {
  background: #2D2D2D;
  border: 1px solid #3F3F46;
  border-radius: 12px;
  width: 90%;
  max-width: 420px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.close-confirm-content {
  padding: 28px 24px;
  display: flex;
  gap: 16px;
  align-items: flex-start;
}

.close-confirm-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.close-confirm-text h3 {
  margin: 0 0 8px;
  font-size: 16px;
  font-weight: 600;
  color: #E5E7EB;
}

.close-confirm-text p {
  margin: 0;
  font-size: 13px;
  color: #9CA3AF;
  line-height: 1.5;
}

.close-confirm-actions {
  padding: 14px 24px;
  border-top: 1px solid #3F3F46;
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.close-confirm-btn {
  padding: 7px 18px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.close-confirm-btn.cancel {
  background: transparent;
  border: 1px solid #4B5563;
  color: #9CA3AF;
}

.close-confirm-btn.cancel:hover {
  background: #2A2A2E;
  border-color: #3F3F46;
}

.close-confirm-btn.confirm {
  background: #F97316;
  border: 1px solid #F97316;
  color: white;
}

.close-confirm-btn.confirm:hover:not(:disabled) {
  background: #EA580C;
}

.close-confirm-btn.confirm:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
