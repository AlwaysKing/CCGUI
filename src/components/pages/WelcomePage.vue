<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useAppStore } from '../../stores/useAppStore'
import NewProjectDialog from '../dialogs/NewProjectDialog.vue'
import { logger } from '../../utils/logger'

const store = useAppStore()

const searchQuery = ref('')
const showNewProjectDialog = ref(false)
const showOldProjects = ref(false)
const showMissingProjects = ref(false)
const projectExistsMap = ref({})
const showDeleteConfirm = ref(false)
const projectToDelete = ref(null)
const deleteProjectFolder = ref(false)
const isDragging = ref(false)
const showDragConfirm = ref(false)
const draggedPath = ref('')

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
  store.selectProject(project)
}

function openProject(project) {
  store.selectProject(project)
}

function handleDeleteClick(event, project) {
  event.stopPropagation()
  projectToDelete.value = project
  showDeleteConfirm.value = true
}

// 拖拽处理函数
function handleDragEnter(event) {
  event.preventDefault()
  logger.info('DragEnter triggered', {
    type: event.type,
    target: event.target?.className,
    relatedTarget: event.relatedTarget?.className,
    isDraggingBefore: isDragging.value
  })
  isDragging.value = true
  logger.info('DragEnter completed', { isDraggingAfter: isDragging.value })
}

function handleDragOver(event) {
  event.preventDefault()
  logger.debug('DragOver triggered', {
    type: event.type,
    target: event.target?.className,
    isDragging: isDragging.value
  })
  isDragging.value = true
}

function handleDragLeave(event) {
  event.preventDefault()
  logger.info('DragLeave triggered', {
    type: event.type,
    target: event.target?.className,
    relatedTarget: event.relatedTarget?.className,
    relatedTargetNull: !event.relatedTarget,
    isDraggingBefore: isDragging.value
  })

  // 只有当真正离开窗口时才隐藏（relatedTarget 为 null）
  if (!event.relatedTarget) {
    logger.info('DragLeave: relatedTarget is null, hiding overlay')
    isDragging.value = false
  } else {
    logger.info('DragLeave: relatedTarget exists, keeping overlay', {
      relatedTargetClass: event.relatedTarget?.className
    })
  }
  logger.info('DragLeave completed', { isDraggingAfter: isDragging.value })
}

async function handleDrop(event) {
  event.preventDefault()
  event.stopPropagation()

  logger.info('Drop triggered', {
    isDraggingBefore: isDragging.value,
    hasFiles: !!event.dataTransfer?.files,
    filesCount: event.dataTransfer?.files?.length
  })

  // 重置拖拽状态
  isDragging.value = false
  logger.info('Drop: overlay hidden')

  const files = event.dataTransfer?.files
  if (!files || files.length === 0) {
    logger.warn('Drop: no files')
    return
  }

  // 只处理第一个拖拽的项
  const file = files[0]
  logger.info('Drop: file info', {
    name: file.name,
    type: file.type,
    path: file.path
  })

  // 检查是否是文件夹（Electron 环境下，文件夹也有 path 属性）
  const fullPath = file.path
  if (!fullPath) {
    logger.warn('Drop: file has no path property')
    return
  }

  logger.info('Drop: file path found', { path: fullPath })

  // 使用 Electron API 检查是否是目录
  try {
    const result = await window.electronAPI.checkProjectExists({ projectPath: fullPath })
    logger.info('Drop: checkProjectExists result', { result })

    if (!result || !result.exists) {
      // 不是目录或不存在
      logger.warn('Drop: path does not exist', { path: fullPath })
      return
    }

    // 检查项目是否已存在
    const found = store.projects.find(p => p.path === fullPath)

    if (found) {
      // 项目已存在，直接打开
      logger.info('Drop: project exists, opening', { projectId: found.id })
      store.selectProject(found)
    } else {
      // 新项目，显示确认对话框
      logger.info('Drop: new project, showing confirm dialog', { path: fullPath })
      draggedPath.value = fullPath
      showDragConfirm.value = true
    }
  } catch (error) {
    logger.error('Failed to check dropped path:', error)
    // 确保出错时也重置状态
    isDragging.value = false
  }
}

function cancelDragConfirm() {
  showDragConfirm.value = false
  draggedPath.value = ''
}

async function confirmDragProject() {
  try {
    const newProject = await store.addProject(draggedPath.value)
    showDragConfirm.value = false
    draggedPath.value = ''
    // 创建后自动打开项目
    store.selectProject(newProject)
  } catch (error) {
    console.error('Failed to add project:', error)
    alert('添加项目失败: ' + error.message)
  }
}

function cancelDelete() {
  showDeleteConfirm.value = false
  projectToDelete.value = null
  deleteProjectFolder.value = false
}

async function confirmDeleteProject() {
  if (!projectToDelete.value) return

  try {
    await store.removeProject(projectToDelete.value.id, deleteProjectFolder.value)
    showDeleteConfirm.value = false
    projectToDelete.value = null
    deleteProjectFolder.value = false
  } catch (error) {
    console.error('Failed to delete project:', error)
    alert('删除项目失败: ' + error.message)
  }
}

// 检查所有项目是否存在

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

  // 不需要在 window 级别添加监听器，welcome-page 元素的 dragleave 已经足够
})

onUnmounted(() => {
  // 清理工作（如果需要的话）
})
</script>

<template>
  <div
    class="welcome-page"
    :class="{ 'drag-over': isDragging }"
    @dragenter="handleDragEnter"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
  >
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
      <svg class="search-icon" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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

    <div class="projects-container">
      <!-- 近期项目 -->
      <div class="project-section">
        <div class="section-header">
          <h4 class="section-title">近期项目</h4>
          <span class="section-count">{{ categoryCounts.recent }}</span>
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

          <!-- Recent Project Cards -->
          <div
            v-for="project in categorizedProjects.recent"
            :key="project.id"
            class="project-card"
            @click="selectProject(project)"
          >
            <button class="delete-btn" @click="handleDeleteClick($event, project)" title="删除项目">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
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
            @click="selectProject(project)"
          >
            <button class="delete-btn" @click="handleDeleteClick($event, project)" title="删除项目">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
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
            @click="selectProject(project)"
          >
            <button class="delete-btn" @click="handleDeleteClick($event, project)" title="删除项目">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3 6 5 6 21 6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
            <div class="project-icon missing-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
                <line x1="2" y1="2" x2="22" y2="22" stroke-width="2.5"/>
              </svg>
            </div>
            <div class="project-info">
              <h3 class="project-name">
                {{ project.name }}
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
        <p class="hint">点击上方"新建项目"添加一个项目</p>
      </div>
    </div>

    <!-- New Project Dialog -->
    <NewProjectDialog
      v-if="showNewProjectDialog"
      @close="showNewProjectDialog = false"
      @created="showNewProjectDialog = false"
    />

    <!-- Delete Project Confirmation Dialog -->
    <div v-if="showDeleteConfirm" class="confirm-dialog-overlay" @click="cancelDelete">
      <div class="confirm-dialog" @click.stop>
        <div class="confirm-dialog-content">
          <div class="confirm-dialog-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <path d="M12 2L12 12"/>
              <path d="M12 22L7 10"/>
              <line x1="12" y1="12" x2="22" y2="12"/>
            </svg>
          </div>
          <div class="confirm-dialog-text">
            <h3>确认删除项目？</h3>
            <p>此操作将删除项目的所有会话和相关数据，无法恢复。</p>
            <p><strong>{{ projectToDelete?.path }}</strong></p>
            <label class="checkbox-label">
              <input type="checkbox" v-model="deleteProjectFolder" />
              <span>同时删除实际项目文件夹</span>
            </label>
            <p v-if="deleteProjectFolder" class="warning-text">
              ⚠️ 警告：项目文件夹将被永久删除，无法恢复！
            </p>
          </div>
        </div>
        <div class="confirm-dialog-actions">
          <button class="confirm-dialog-btn cancel" @click="cancelDelete">
            取消
          </button>
          <button class="confirm-dialog-btn confirm" @click="confirmDeleteProject">
            删除
          </button>
        </div>
      </div>
    </div>

    <!-- Drag & Drop Confirmation Dialog -->
    <div v-if="showDragConfirm" class="confirm-dialog-overlay" @click="cancelDragConfirm">
      <div class="confirm-dialog" @click.stop>
        <div class="confirm-dialog-content">
          <div class="confirm-dialog-icon info">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#60A5FA" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div class="confirm-dialog-text">
            <h3>添加新项目？</h3>
            <p>这是一个未打开过的文件夹，是否要将其添加为项目？</p>
            <p><strong>{{ draggedPath }}</strong></p>
          </div>
        </div>
        <div class="confirm-dialog-actions">
          <button class="confirm-dialog-btn cancel" @click="cancelDragConfirm">
            取消
          </button>
          <button class="confirm-dialog-btn confirm primary" @click="confirmDragProject">
            添加
          </button>
        </div>
      </div>
    </div>

    <!-- Drag Overlay (always in DOM, controlled by opacity) -->
    <div class="drag-overlay" :class="{ 'drag-active': isDragging }">
      <div class="drag-content">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
        </svg>
        <p>拖放文件夹到此处</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.welcome-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 48px 0 0;
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
  flex-shrink: 0;
  padding: 0 32px;
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
  flex-shrink: 0;
  padding: 0 32px;
}

.search-icon {
  position: absolute;
  left: 48px;
  top: 50%;
  transform: translateY(-50%);
  color: #71717A;
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 12px 12px 12px 48px;
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

.projects-container {
  flex: 1;
  overflow-y: auto;
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 0 0 32px 0;
}

.project-section {
  width: 100%;
  max-width: 1200px;
  margin-bottom: 32px;
  padding: 0 32px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 16px;
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
  margin-bottom: 16px;
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
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 16px;
  width: 100%;
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
  position: relative;
}

.project-card:hover {
  background: #2D2D30;
  border-color: #52525B;
  transform: translateY(-2px);
}

.delete-btn {
  position: absolute;
  top: 12px;
  right: 12px;
  padding: 6px;
  background: transparent;
  border: none;
  color: #6B7280;
  cursor: pointer;
  border-radius: 4px;
  opacity: 0;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.delete-btn:hover {
  background: rgba(239, 68, 68, 0.1);
  color: #EF4444;
}

.project-card:hover .delete-btn {
  opacity: 1;
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
  font-size: 16px;
  font-weight: 600;
  color: #F4F4F5;
  margin: 0 0 4px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  display: flex;
  align-items: center;
  gap: 8px;
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

/* Confirmation Dialog */
.confirm-dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2100;
}

.confirm-dialog {
  background: #2D2D2D;
  border: 1px solid #3F3F46;
  border-radius: 12px;
  width: 90%;
  max-width: 480px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.confirm-dialog-content {
  padding: 32px 24px;
  display: flex;
  gap: 20px;
  align-items: flex-start;
}

.confirm-dialog-icon {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}

.confirm-dialog-text {
  flex: 1;
}

.confirm-dialog-text h3 {
  margin: 0 0 12px;
  font-size: 18px;
  font-weight: 600;
  color: #E5E7EB;
}

.confirm-dialog-text p {
  margin: 0 0 8px;
  font-size: 14px;
  color: #9CA3AF;
  line-height: 1.5;
}

.confirm-dialog-text p:last-child {
  margin: 0;
}

.confirm-dialog-text strong {
  color: #F4F4F5;
  font-family: 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 12px;
  word-break: break-all;
}

.confirm-dialog-actions {
  padding: 16px 24px;
  border-top: 1px solid #3F3F46;
  display: flex;
  gap: 12px;
  justify-content: flex-end;
}

.confirm-dialog-btn {
  padding: 8px 20px;
  border: none;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.confirm-dialog-btn.cancel {
  background: #374151;
  color: #D1D5DB;
}

.confirm-dialog-btn.cancel:hover {
  background: #4B5563;
}

.confirm-dialog-btn.confirm {
  background: #EF4444;
  color: white;
}

.confirm-dialog-btn.confirm:hover {
  background: #DC2626;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 16px;
  padding: 12px;
  background: rgba(239, 68, 68, 0.05);
  border: 1px solid rgba(239, 68, 68, 0.2);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.checkbox-label:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
}

.checkbox-label input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
  accent-color: #EF4444;
}

.checkbox-label span {
  font-size: 14px;
  color: #E5E7EB;
  user-select: none;
}

.warning-text {
  margin-top: 12px !important;
  padding: 8px 12px;
  background: rgba(239, 68, 68, 0.1);
  border-left: 3px solid #EF4444;
  border-radius: 4px;
  font-size: 13px !important;
  color: #FCA5A5 !important;
}

/* Drag & Drop Styles */
.welcome-page.drag-over {
  /* 不要设置 pointer-events: none，否则会阻止 drop 事件 */
}

.welcome-page.drag-over::after {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(96, 165, 250, 0.1);
  border: 3px dashed #60A5FA;
  border-radius: 8px;
  z-index: 1000;
  pointer-events: none;
}

.drag-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(96, 165, 250, 0.2);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.15s ease-in-out;
}

.drag-overlay.drag-active {
  opacity: 1;
}

.drag-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  color: white;
}

.drag-content svg {
  opacity: 0.9;
}

.drag-content p {
  font-size: 24px;
  font-weight: 600;
  margin: 0;
}

.confirm-dialog-icon.info {
  color: #60A5FA;
}

.confirm-dialog-btn.primary {
  background: #F97316;
  color: white;
}

.confirm-dialog-btn.primary:hover {
  background: #EA580C;
}
</style>
