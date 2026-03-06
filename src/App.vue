<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAppStore } from './stores/useAppStore'
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

  console.log('App mounted:', { isDev, forceMultiSession, hasAPI: !!window.electronAPI?.getProjects })

  // Get Claude info
  try {
    const info = await window.electronAPI.getClaudeInfo()
    console.log('Claude info:', info)
  } catch (error) {
    console.error('Failed to get Claude info:', error)
  }

  // Wait for Claude initialization
  initUnsub = window.electronAPI.onClaudeInit((message) => {
    console.log('Claude initialized:', message)
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
