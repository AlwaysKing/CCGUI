<script setup>
import { useAppStore } from '../../stores/useAppStore'

const store = useAppStore()

defineProps({
  projectName: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['new-project', 'new-session'])
</script>

<template>
  <header class="app-header">
    <div class="header-left">
      <h1 class="app-title">Claude Code GUI</h1>
      <span v-if="projectName" class="project-name">{{ projectName }}</span>
    </div>

    <div class="header-right">
      <button class="header-btn" @click="emit('new-project')" title="新建项目">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          <line x1="12" y1="11" x2="12" y2="17"/>
          <line x1="9" y1="14" x2="15" y2="14"/>
        </svg>
        <span>新建项目</span>
      </button>

      <button
        class="header-btn primary"
        @click="emit('new-session')"
        :disabled="!projectName"
        title="新建会话"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        <span>新建会话</span>
      </button>

      <div class="status-indicator" :class="{ active: store.currentSession }">
        {{ store.currentSession ? '● 运行中' : '○ 就绪' }}
      </div>
    </div>
  </header>
</template>

<style scoped>
.app-header {
  height: 48px;
  padding: 0 16px;
  border-bottom: 1px solid #3F3F46;
  display: flex;
  justify-content: space-between;
  align-items: center;
  background: #252526;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.app-title {
  font-size: 16px;
  font-weight: 600;
  color: #F97316;
  margin: 0;
}

.project-name {
  font-size: 14px;
  color: #9CA3AF;
  padding: 4px 12px;
  background: #374151;
  border-radius: 4px;
}

.header-right {
  display: flex;
  align-items: center;
  gap: 8px;
}

.header-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 6px;
  border: 1px solid #4B5563;
  background: transparent;
  color: #D1D5DB;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.2s;
}

.header-btn:hover:not(:disabled) {
  background: #374151;
  border-color: #6B7280;
}

.header-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.header-btn.primary {
  background: #F97316;
  border-color: #F97316;
  color: white;
}

.header-btn.primary:hover:not(:disabled) {
  background: #EA580C;
  border-color: #EA580C;
}

.status-indicator {
  font-size: 12px;
  color: #6B7280;
  padding: 4px 8px;
}

.status-indicator.active {
  color: #10B981;
}
</style>
