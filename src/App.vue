<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAppStore } from './stores/useAppStore'
import { logger } from './utils/logger'
import WelcomePage from './components/pages/WelcomePage.vue'
import WorkspaceLayout from './components/layout/WorkspaceLayout.vue'

const store = useAppStore()

const isClaudeReady = ref(false)
let initUnsub = null

// 当前视图: 'welcome' | 'workspace'
const currentView = computed(() => {
  return store.currentProject ? 'workspace' : 'welcome'
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

  // Get Claude info
  try {
    const info = await window.electronAPI.getClaudeInfo()
    logger.info('Claude info retrieved', info)
  } catch (error) {
    logger.error('Failed to get Claude info', { error: error.message })
  }

  // Wait for Claude initialization
  initUnsub = window.electronAPI.onClaudeInit((message) => {
    logger.info('Claude initialized', message)
    isClaudeReady.value = true
  })
})

onUnmounted(() => {
  if (initUnsub) {
    initUnsub()
  }
})
</script>

<template>
  <div class="app-container">
    <!-- Welcome Page - 显示项目列表 -->
    <WelcomePage v-if="currentView === 'welcome'" />

    <!-- Workspace - 两栏布局（会话 + 聊天） -->
    <WorkspaceLayout v-else />
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
