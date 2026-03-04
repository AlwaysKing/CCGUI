<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import ChatWindow from './components/ChatWindow.vue'
import ToolUseTest from './views/ToolUseTest.vue'

const isClaudeReady = ref(false)
const claudeInfo = ref(null)
const showTestPage = ref(false)
let initUnsub = null

onMounted(async () => {
  // Get Claude info
  try {
    claudeInfo.value = await window.electronAPI.getClaudeInfo()
    console.log('Claude info:', claudeInfo.value)
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
    <header class="app-header">
      <h1>Claude Code GUI</h1>
      <div class="header-right">
        <button class="test-toggle" @click="showTestPage = !showTestPage">
          {{ showTestPage ? '返回聊天' : '测试样式' }}
        </button>
        <div class="status" :class="{ ready: isClaudeReady }">
          {{ isClaudeReady ? '● 已连接' : '○ 连接中...' }}
        </div>
      </div>
    </header>
    <main class="app-main">
      <!-- 测试页面 -->
      <ToolUseTest v-if="showTestPage" />
      <!-- 正常聊天页面 -->
      <ChatWindow v-else-if="isClaudeReady" />
      <div v-else class="loading">
        <p>正在连接 Claude...</p>
        <p class="loading-sub">请确保已安装 Claude Code CLI</p>
      </div>
    </main>
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

.app-header {
  padding: 16px 24px;
  border-bottom: 1px solid #3F3F46;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.app-header h1 {
  margin: 0;
  font-size: 20px;
  color: #F97316;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 16px;
}

.test-toggle {
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid #3B82F6;
  background: transparent;
  color: #3B82F6;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.test-toggle:hover {
  background: #3B82F6;
  color: white;
}

.status {
  font-size: 14px;
  color: #6B7280;
}

.status.ready {
  color: #10B981;
}

.app-main {
  flex: 1;
  overflow: hidden;
}

.loading {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: #6B7280;
  gap: 8px;
}

.loading-sub {
  font-size: 14px;
  color: #52525B;
}
</style>
