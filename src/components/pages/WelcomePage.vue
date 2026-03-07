<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAppStore } from '../../stores/useAppStore'
import NewProjectDialog from '../dialogs/NewProjectDialog.vue'

const store = useAppStore()

const searchQuery = ref('')
const showNewProjectDialog = ref(false)

const filteredProjects = computed(() => {
  if (!searchQuery.value) return store.projects
  return store.projects.filter(p =>
    p.name.toLowerCase().includes(searchQuery.value.toLowerCase())
  )
})

function formatLastActive(dateStr) {
  if (!dateStr) return '未知'
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now - date

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`
  return date.toLocaleDateString('zh-CN')
}

function selectProject(project) {
  store.selectProject(project)
}

function openProject(project) {
  store.selectProject(project)
}

onMounted(() => {
  store.fetchProjects()
})
</script>

<template>
  <div class="welcome-page">
    <div class="welcome-header">
      <div class="logo">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M12 2L2 7l10 5 10-5 10 5z"/>
          <path d="M2 17l10 5 10-5"/>
          <path d="M2 12l10 5 10-5"/>
        </svg>
      </div>
      <h1>Claude Code GUI</h1>
      <p class="subtitle">选择一个项目开始工作</p>
    </div>

    <div class="search-bar">
      <svg class="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8"/>
        <path d="m21 21-4.35-4.35"/>
      </svg>
      <input
        v-model="searchQuery"
        type="text"
        placeholder="搜索项目..."
        class="search-input"
      />
    </div>

    <div class="projects-grid">
      <!-- New Project Card -->
      <div class="project-card new-project" @click="showNewProjectDialog = true">
        <div class="new-project-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </div>
        <span>新建项目</span>
      </div>

      <!-- Project Cards -->
      <div
        v-for="project in filteredProjects"
        :key="project.id"
        class="project-card"
        @click="selectProject(project)"
      >
        <div class="project-icon">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
          </svg>
        </div>
        <div class="project-info">
          <h3 class="project-name">{{ project.name }}</h3>
          <p class="project-path">{{ project.path }}</p>
          <div class="project-meta">
            <span>{{ project.sessionCount || 0 }} 个会话</span>
            <span class="dot">·</span>
            <span>{{ formatLastActive(project.lastActiveAt) }}</span>
          </div>
        </div>
      </div>
    </div>

    <div v-if="store.projects.length === 0 && !store.isLoading" class="empty-state">
      <p>还没有任何项目</p>
      <p class="hint">点击上方"新建项目"添加一个项目</p>
    </div>

    <!-- New Project Dialog -->
    <NewProjectDialog
      v-if="showNewProjectDialog"
      @close="showNewProjectDialog = false"
      @created="showNewProjectDialog = false"
    />
  </div>
</template>

<style scoped>
.welcome-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 32px;
  overflow-y: auto;
  position: relative;
}

.welcome-page::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 32px;
  -webkit-app-region: drag;
  z-index: 999;
}

.welcome-header {
  text-align: center;
  margin-bottom: 48px;
}

.logo {
  color: #F97316;
  margin-bottom: 16px;
}

.welcome-header h1 {
  font-size: 32px;
  font-weight: 700;
  color: #F4F4F5;
  margin: 0 0 8px;
}

.subtitle {
  font-size: 16px;
  color: #71717A;
  margin: 0;
}

.search-bar {
  position: relative;
  width: 100%;
  max-width: 600px;
  margin-bottom: 32px;
}

.search-icon {
  position: absolute;
  left: 12px;
  top: 50%;
  transform: translateY(-50%);
  color: #71717A;
}

.search-input {
  width: 100%;
  padding: 12px 12px 12px 40px;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  color: #F4F4F5;
  font-size: 14px;
  transition: all 0.2s;
}

.search-input:focus {
  outline: none;
  border-color: #F97316;
}

.search-input::placeholder {
  color: #71717A;
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  width: 100%;
  max-width: 1200px;
}

.project-card {
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 12px;
  padding: 20px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: flex-start;
  gap: 16px;
}

.project-card:hover {
  background: #2D2D30;
  border-color: #52525B;
  transform: translateY(-2px);
}

.project-card.new-project {
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 120px;
  border-style: dashed;
}

.project-card.new-project:hover {
  border-color: #F97316;
}

.new-project-icon {
  color: #71717A;
  margin-bottom: 8px;
}

.project-card.new-project:hover .new-project-icon {
  color: #F97316;
}

.project-card.new-project span {
  color: #A1A1AA;
  font-size: 14px;
}

.project-icon {
  color: #F97316;
  flex-shrink: 0;
}

.project-info {
  flex: 1;
  min-width: 0;
}

.project-name {
  font-size: 16px;
  font-weight: 600;
  color: #F4F4F5;
  margin: 0 0 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.project-path {
  font-size: 12px;
  color: #71717A;
  margin: 0 0 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.project-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: #52525B;
}

.dot {
  color: #3F3F46;
}

.empty-state {
  text-align: center;
  color: #71717A;
  padding: 48px;
}

.empty-state p {
  margin: 0;
  font-size: 16px;
}

.empty-state .hint {
  margin-top: 8px;
  font-size: 14px;
  color: #52525B;
}
</style>
