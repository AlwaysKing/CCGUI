<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAppStore } from '../../stores/useAppStore'

const props = defineProps({
  currentProjectId: String
})

const emit = defineEmits(['close', 'select', 'goHome'])

const store = useAppStore()
const searchQuery = ref('')
const showOldProjects = ref(false)
const showMissingProjects = ref(false)
const projectExistsMap = ref({})

// 10天的毫秒数
const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000

// 检查项目是否在10天内活跃
function isRecent(project) {
  if (!project.lastActiveAt) return false
  const lastActive = new Date(project.lastActiveAt).getTime()
  const now = Date.now()
  return (now - lastActive) < TEN_DAYS_MS
}

// 分类项目
const categorizedProjects = computed(() => {
  const filtered = searchQuery.value
    ? store.projects.filter(p =>
        p.name.toLowerCase().includes(searchQuery.value.toLowerCase())
      )
    : store.projects

  const recent = []
  const old = []
  const missing = []

  filtered.forEach(project => {
    const exists = projectExistsMap.value[project.id] !== false // 默认存在，除非明确检查为 false

    if (!exists) {
      missing.push(project)
    } else if (isRecent(project)) {
      recent.push(project)
    } else {
      old.push(project)
    }
  })

  return {
    recent,
    old,
    missing
  }
})

// 应用搜索过滤后的项目列表（用于显示）
const filteredProjects = computed(() => {
  const { recent, old, missing } = categorizedProjects.value
  const result = [...recent]

  if (showOldProjects.value) {
    result.push(...old)
  }

  if (showMissingProjects.value) {
    result.push(...missing)
  }

  return result
})

// 获取分类数量
const categoryCounts = computed(() => {
  const { recent, old, missing } = categorizedProjects.value
  return {
    recent: recent.length,
    old: old.length,
    missing: missing.length
  }
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
  emit('select', project)
}

function handleGoHome() {
  emit('goHome', store.hasProcessingSessions)
}

// 检查所有项目是否存在
async function checkProjectsExistence() {
  for (const project of store.projects) {
    try {
      const result = await window.electronAPI.checkProjectExists({ projectPath: project.path })
      projectExistsMap.value[project.id] = result.exists
    } catch (error) {
      console.error(`Failed to check project ${project.id}:`, error)
      projectExistsMap.value[project.id] = true // 出错时假设存在
    }
  }
}

onMounted(async () => {
  await store.fetchProjects()
  await checkProjectsExistence()
})
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog">
      <div class="dialog-header">
        <div class="header-left">
          <h3>切换项目</h3>
          <button class="go-home-btn" @click="handleGoHome">
            返回首页
          </button>
        </div>
        <button class="close-btn" @click="emit('close')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
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

        <!-- 近期项目 -->
        <div class="project-section">
          <div class="section-header">
            <h4 class="section-title">近期项目</h4>
            <span class="section-count">{{ categoryCounts.recent }}</span>
          </div>
          <div class="projects-grid">
            <div
              v-for="project in categorizedProjects.recent"
              :key="project.id"
              class="project-card"
              :class="{ current: project.id === currentProjectId }"
              @click="selectProject(project)"
            >
              <div class="project-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <div class="project-info">
                <h3 class="project-name">
                  {{ project.name }}
                  <span v-if="project.id === currentProjectId" class="current-badge">当前</span>
                </h3>
                <p class="project-path">{{ project.path }}</p>
                <div class="project-meta">
                  <span>{{ project.sessionCount || 0 }} 个会话</span>
                  <span class="dot">·</span>
                  <span>{{ formatLastActive(project.lastActiveAt) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 旧项目（10天外） -->
        <div v-if="categoryCounts.old > 0" class="project-section">
          <button class="section-toggle" @click="showOldProjects = !showOldProjects">
            <svg
              class="toggle-icon"
              :class="{ rotated: showOldProjects }"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            <h4 class="section-title">旧项目</h4>
            <span class="section-count">{{ categoryCounts.old }}</span>
            <span class="section-hint">（超过10天未使用）</span>
          </button>
          <div v-if="showOldProjects" class="projects-grid">
            <div
              v-for="project in categorizedProjects.old"
              :key="project.id"
              class="project-card old"
              :class="{ current: project.id === currentProjectId }"
              @click="selectProject(project)"
            >
              <div class="project-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                </svg>
              </div>
              <div class="project-info">
                <h3 class="project-name">
                  {{ project.name }}
                  <span v-if="project.id === currentProjectId" class="current-badge">当前</span>
                </h3>
                <p class="project-path">{{ project.path }}</p>
                <div class="project-meta">
                  <span>{{ project.sessionCount || 0 }} 个会话</span>
                  <span class="dot">·</span>
                  <span>{{ formatLastActive(project.lastActiveAt) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 不存在的项目 -->
        <div v-if="categoryCounts.missing > 0" class="project-section">
          <button class="section-toggle" @click="showMissingProjects = !showMissingProjects">
            <svg
              class="toggle-icon"
              :class="{ rotated: showMissingProjects }"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <polyline points="9 18 15 12 9 6"/>
            </svg>
            <h4 class="section-title missing-title">不存在的项目</h4>
            <span class="section-count">{{ categoryCounts.missing }}</span>
            <span class="section-hint">（文件夹已删除）</span>
          </button>
          <div v-if="showMissingProjects" class="projects-grid">
            <div
              v-for="project in categorizedProjects.missing"
              :key="project.id"
              class="project-card missing"
              :class="{ current: project.id === currentProjectId }"
              @click="selectProject(project)"
            >
              <div class="project-icon missing-icon">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                  <line x1="2" y1="2" x2="22" y2="22" stroke-width="2.5"/>
                </svg>
              </div>
              <div class="project-info">
                <h3 class="project-name">
                  {{ project.name }}
                  <span v-if="project.id === currentProjectId" class="current-badge">当前</span>
                  <span class="missing-badge">不存在</span>
                </h3>
                <p class="project-path">{{ project.path }}</p>
                <div class="project-meta">
                  <span>{{ project.sessionCount || 0 }} 个会话</span>
                  <span class="dot">·</span>
                  <span>{{ formatLastActive(project.lastActiveAt) }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div v-if="store.projects.length === 0 && !store.isLoading" class="empty-state">
          <p>还没有任何项目</p>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.dialog {
  background: #2D2D2D;
  border: 1px solid #3F3F46;
  border-radius: 12px;
  width: 90%;
  max-width: 900px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.dialog-header {
  padding: 16px 20px;
  border-bottom: 1px solid #3F3F46;
  display: flex;
  justify-content: space-between;
  align-items: center;
  flex-shrink: 0;
}

.header-left {
  display: flex;
  align-items: center;
  gap: 16px;
}

.dialog-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #E5E7EB;
}

.go-home-btn {
  padding: 4px 12px;
  background: transparent;
  border: none;
  color: #F97316;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.2s;
}

.go-home-btn:hover {
  background: rgba(249, 115, 22, 0.1);
  color: #FB923C;
}

.close-btn {
  padding: 4px;
  background: transparent;
  border: none;
  color: #6B7280;
  cursor: pointer;
  border-radius: 4px;
}

.close-btn:hover {
  background: #374151;
  color: #D1D5DB;
}

.dialog-body {
  padding: 20px;
  overflow-y: auto;
  flex: 1;
}

.search-bar {
  position: relative;
  width: 100%;
  margin-bottom: 20px;
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
  background: #1E1E1E;
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

.project-section {
  margin-bottom: 24px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid #3F3F46;
}

.section-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 0;
  background: transparent;
  border: none;
  border-bottom: 1px solid #3F3F46;
  cursor: pointer;
  transition: all 0.2s;
  margin-bottom: 12px;
}

.section-toggle:hover {
  background: rgba(255, 255, 255, 0.02);
}

.toggle-icon {
  color: #71717A;
  transition: transform 0.2s;
}

.toggle-icon.rotated {
  transform: rotate(90deg);
}

.section-title {
  font-size: 13px;
  font-weight: 600;
  color: #A1A1AA;
  margin: 0;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.missing-title {
  color: #EF4444;
}

.section-count {
  font-size: 12px;
  color: #71717A;
  background: #27272A;
  padding: 2px 8px;
  border-radius: 12px;
  font-weight: 500;
}

.section-hint {
  font-size: 11px;
  color: #52525B;
  margin-left: auto;
}

.projects-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 12px;
  width: 100%;
}

.project-card {
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s;
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.project-card:hover {
  background: #2D2D30;
  border-color: #52525B;
  transform: translateY(-2px);
}

.project-card.current {
  border-color: #F97316;
  background: rgba(249, 115, 22, 0.1);
}

.project-card.old {
  opacity: 0.7;
}

.project-card.old:hover {
  opacity: 1;
}

.project-card.missing {
  opacity: 0.5;
  border-color: #DC2626;
  background: rgba(239, 68, 68, 0.05);
}

.project-card.missing:hover {
  opacity: 0.8;
  background: rgba(239, 68, 68, 0.1);
}

.project-icon {
  color: #F97316;
  flex-shrink: 0;
}

.project-icon.missing-icon {
  color: #EF4444;
  position: relative;
}

.project-info {
  flex: 1;
  min-width: 0;
}

.project-name {
  font-size: 15px;
  font-weight: 600;
  color: #F4F4F5;
  margin: 0 0 4px;
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.current-badge {
  font-size: 11px;
  font-weight: 500;
  color: #F97316;
  background: rgba(249, 115, 22, 0.2);
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.missing-badge {
  font-size: 11px;
  font-weight: 500;
  color: #EF4444;
  background: rgba(239, 68, 68, 0.2);
  padding: 2px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.project-path {
  font-size: 11px;
  color: #71717A;
  margin: 0 0 6px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.project-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 11px;
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
</style>
