<script setup>
import { computed, ref, onMounted } from 'vue'
import { useDialogStack } from '../../composables/useDialogStack'
import { MarkdownRenderer } from '@/components/base'
import { useClawHub } from './composables/useClawHub'

const props = defineProps({
  projectPath: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['close'])

const selectedSkill = ref(null)
const downloadError = ref(null)

// 手动安装状态
const installSource = ref('')
const isInstalling = ref(false)
const installError = ref(null)
const isDragOver = ref(false)
const installedSkills = ref([])

// 已安装技能详情
const viewingInstalledSkill = ref(null)
const skillReadme = ref('')
const isLoadingReadme = ref(false)
const skillToDelete = ref(null)
const skillDetailTab = ref('content') // 'content' | 'license' | 'files'
const skillLicense = ref(null)
const skillTree = ref([])
const isLoadingExtra = ref(false)
const installFilter = ref('all') // 'all' | 'claude' | 'codex' | 'none'

function getSkillSourceLabel(skill) {
  if (skill.system) return '系统内置'
  if (skill.sourceLabel) return skill.sourceLabel
  if (skill.external) return '外部'
  if (skill.source === 'clawhub') return 'ClawHub'
  if (skill.source === 'plugin') return '插件'
  return skill.source || '本地'
}

function isStaticSkill(skill) {
  return Boolean(skill.system || skill.external || skill.plugin)
}

function isPluginDisabled(skill) {
  return Boolean(skill?.plugin && skill?.pluginEnabled === false)
}

const filteredInstalledSkills = computed(() => {
  if (installFilter.value === 'all') return installedSkills.value
  if (installFilter.value === 'none') {
    return installedSkills.value.filter(s => !s.installedTargets?.length)
  }
  return installedSkills.value.filter(s => s.installedTargets?.includes(installFilter.value))
})

const activeMarket = ref('installed')

const markets = computed(() => {
  const items = [
    { id: 'installed', label: '已下载' },
    { id: 'clawhub', label: 'ClawHub' }
  ]
  if (props.projectPath) {
    items.splice(1, 0, { id: 'project', label: '项目配置' })
  }
  return items
})

const {
  skills,
  isLoading,
  error: skillsError,
  hasMore,
  searchQuery,
  isSearching,
  fetchSkills,
  loadMore,
  refresh,
  handleSearch,
  clearSearch,
  formatCount,
  downloadSkill,
  getDownloadStatus,
  activeDownloads,
  downloadedSlugs,
  checkDownloadedSkills
} = useClawHub()

let marketLoaded = false

// 项目级配置状态
const projectInstalledMap = ref(new Map()) // slug -> Set(['claude', 'codex'])
const projectInstallSource = ref('')
const isProjectInstalling = ref(false)
const projectInstallError = ref(null)
const projectToggleError = ref(null)
const projectSkillToDelete = ref(null)
const projectFilter = ref('all') // 'all' | 'claude' | 'codex' | 'none'
const viewingProjectSkill = ref(null)
const projectSkillReadme = ref('')
const isProjectLoadingReadme = ref(false)
const projectSkillDetailTab = ref('content')
const projectSkillLicense = ref(null)
const projectSkillTree = ref([])

const filteredProjectSkills = computed(() => {
  // 基于全局已下载列表，叠加项目级安装状态
  const list = installedSkills.value.map(s => ({
    ...s,
    projectTargets: projectInstalledMap.value.get(s.slug)
      ? [...projectInstalledMap.value.get(s.slug)]
      : []
  }))
  if (projectFilter.value === 'all') return list
  if (projectFilter.value === 'none') {
    return list.filter(s => !s.projectTargets.length)
  }
  return list.filter(s => s.projectTargets.includes(projectFilter.value))
})

async function loadInstalledSkills() {
  try {
    const result = await window.electronAPI.listDownloadedSkills()
    if (result.success) {
      installedSkills.value = result.skills
    }
  } catch (e) { /* ignore */ }
}

async function loadProjectSkills() {
  if (!props.projectPath) return
  try {
    const result = await window.electronAPI.listProjectSkills({ projectPath: props.projectPath })
    if (result.success) {
      const map = new Map()
      for (const s of result.skills) {
        map.set(s.slug, new Set(s.installedTargets || []))
      }
      projectInstalledMap.value = map
    }
  } catch (e) { /* ignore */ }
}

onMounted(() => {
  loadInstalledSkills()
})

function handleMarketChange(marketId) {
  activeMarket.value = marketId
  if (marketId === 'clawhub' && !marketLoaded) {
    marketLoaded = true
    fetchSkills()
    checkDownloadedSkills()
  }
  if (marketId === 'installed') {
    loadInstalledSkills()
  }
  if (marketId === 'project') {
    loadProjectSkills()
  }
}

function handleScroll(event) {
  const el = event.target
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
    loadMore()
  }
}

function openSkillDetail(skill) {
  selectedSkill.value = skill
  downloadError.value = null
}

function closeSkillDetail() {
  selectedSkill.value = null
}

async function handleDownload(slug) {
  downloadError.value = null
  try {
    await downloadSkill(slug)
    await loadInstalledSkills()
  } catch (e) {
    downloadError.value = e.message
  }
}

async function handleInstall() {
  const source = installSource.value.trim()
  if (!source || isInstalling.value) return

  isInstalling.value = true
  installError.value = null

  try {
    const result = await window.electronAPI.installSkill({ source })
    if (result.success) {
      installSource.value = ''
      await loadInstalledSkills()
      await checkDownloadedSkills()
    } else {
      installError.value = result.error
    }
  } catch (e) {
    installError.value = e.message
  } finally {
    isInstalling.value = false
  }
}

async function handleDrop(event) {
  isDragOver.value = false
  const files = event.dataTransfer?.files
  if (!files || files.length === 0) return

  const filePath = files[0].path
  if (!filePath) return

  installSource.value = filePath
  installError.value = null
  isInstalling.value = true

  try {
    const result = await window.electronAPI.installSkill({ source: filePath })
    if (result.success) {
      installSource.value = ''
      await loadInstalledSkills()
      await checkDownloadedSkills()
    } else {
      installError.value = result.error
    }
  } catch (e) {
    installError.value = e.message
  } finally {
    isInstalling.value = false
  }
}

// 项目级：从已下载安装到项目
async function toggleProjectTarget(skill, target) {
  projectToggleError.value = null
  const isInstalled = skill.projectTargets?.includes(target)
  try {
    if (isInstalled) {
      await window.electronAPI.deactivateSkillFromProject({ slug: skill.slug, targets: [target], projectPath: props.projectPath })
    } else {
      await window.electronAPI.activateSkillToProject({ slug: skill.slug, source: skill.source, targets: [target], projectPath: props.projectPath })
    }
    await loadProjectSkills()
  } catch (e) {
    projectToggleError.value = e.message || '操作失败'
  }
}

async function handleProjectInstall() {
  const source = projectInstallSource.value.trim()
  if (!source || isProjectInstalling.value || !props.projectPath) return

  isProjectInstalling.value = true
  projectInstallError.value = null

  try {
    const result = await window.electronAPI.installSkillToProject({ source, projectPath: props.projectPath })
    if (result.success) {
      projectInstallSource.value = ''
      await loadProjectSkills()
      await loadInstalledSkills()
    } else {
      projectInstallError.value = result.error
    }
  } catch (e) {
    projectInstallError.value = e.message
  } finally {
    isProjectInstalling.value = false
  }
}

async function handleProjectDrop(event) {
  if (!props.projectPath) return
  isDragOver.value = false
  const files = event.dataTransfer?.files
  if (!files || files.length === 0) return
  const filePath = files[0].path
  if (!filePath) return

  projectInstallSource.value = filePath
  projectInstallError.value = null
  isProjectInstalling.value = true

  try {
    const result = await window.electronAPI.installSkillToProject({ source: filePath, projectPath: props.projectPath })
    if (result.success) {
      projectInstallSource.value = ''
      await loadProjectSkills()
      await loadInstalledSkills()
    } else {
      projectInstallError.value = result.error
    }
  } catch (e) {
    projectInstallError.value = e.message
  } finally {
    isProjectInstalling.value = false
  }
}

function handleDeleteProjectSkill(skill) {
  projectSkillToDelete.value = skill
}

function cancelDeleteProjectSkill() {
  projectSkillToDelete.value = null
}

async function confirmDeleteProjectSkill() {
  const skill = projectSkillToDelete.value
  if (!skill) return
  projectSkillToDelete.value = null
  try {
    const result = await window.electronAPI.deleteProjectSkill({ name: skill.slug, projectPath: props.projectPath })
    if (result.success) {
      await loadProjectSkills()
      await loadInstalledSkills()
    }
  } catch (e) { /* ignore */ }
}

async function openProjectSkillDetail(skill) {
  viewingProjectSkill.value = skill
  projectSkillDetailTab.value = 'content'
  isProjectLoadingReadme.value = true
  projectSkillReadme.value = ''
  projectSkillLicense.value = null
  projectSkillTree.value = []

  try {
    const [readmeResult, extraResult] = await Promise.all([
      window.electronAPI.readSkillReadme({ skillPath: skill.path }),
      window.electronAPI.readSkillExtra({ skillPath: skill.path })
    ])
    if (readmeResult.success) {
      projectSkillReadme.value = readmeResult.content.replace(/^---\n[\s\S]*?\n---\n?/, '')
    }
    if (extraResult.success) {
      projectSkillLicense.value = extraResult.license || null
      projectSkillTree.value = extraResult.tree || []
    }
  } catch (e) { /* ignore */ }
  isProjectLoadingReadme.value = false
}

function closeProjectSkillDetail() {
  viewingProjectSkill.value = null
  projectSkillReadme.value = ''
  projectSkillLicense.value = null
  projectSkillTree.value = []
}

function handleDeleteSkill(skill) {
  skillToDelete.value = skill
}

function cancelDeleteSkill() {
  skillToDelete.value = null
}

async function confirmDeleteSkill() {
  const skill = skillToDelete.value
  if (!skill) return
  skillToDelete.value = null
  try {
    const result = await window.electronAPI.deleteSkill({ name: skill.slug, source: skill.source })
    if (result.success) {
      await loadInstalledSkills()
      await checkDownloadedSkills()
    }
  } catch (e) { /* ignore */ }
}

async function openInstalledDetail(skill) {
  viewingInstalledSkill.value = skill
  skillDetailTab.value = 'content'
  isLoadingReadme.value = true
  skillReadme.value = ''
  skillLicense.value = null
  skillTree.value = []

  try {
    const [readmeResult, extraResult] = await Promise.all([
      window.electronAPI.readSkillReadme({ skillPath: skill.path }),
      window.electronAPI.readSkillExtra({ skillPath: skill.path })
    ])
    if (readmeResult.success) {
      skillReadme.value = readmeResult.content.replace(/^---\n[\s\S]*?\n---\n?/, '')
    }
    if (extraResult.success) {
      skillLicense.value = extraResult.license || null
      skillTree.value = extraResult.tree || []
    }
  } catch (e) { /* ignore */ }
  isLoadingReadme.value = false
}

function closeInstalledDetail() {
  viewingInstalledSkill.value = null
  skillReadme.value = ''
  skillLicense.value = null
  skillTree.value = []
}

const flattenedTree = computed(() => {
  const result = []
  function walk(items, depth = 0) {
    for (const item of items) {
      result.push({ name: item.name, type: item.type, depth })
      if (item.children) walk(item.children, depth + 1)
    }
  }
  walk(skillTree.value)
  return result
})

const flattenedProjectTree = computed(() => {
  const result = []
  function walk(items, depth = 0) {
    for (const item of items) {
      result.push({ name: item.name, type: item.type, depth })
      if (item.children) walk(item.children, depth + 1)
    }
  }
  walk(projectSkillTree.value)
  return result
})

const toggleError = ref(null)

async function toggleTarget(skill, target) {
  toggleError.value = null
  const isInstalled = skill.installedTargets?.includes(target)
  try {
    if (isInstalled) {
      await window.electronAPI.deactivateSkill({ slug: skill.slug, targets: [target] })
    } else {
      await window.electronAPI.activateSkill({ slug: skill.slug, source: skill.source, targets: [target] })
    }
    await loadInstalledSkills()
  } catch (e) {
    toggleError.value = e.message || '操作失败'
  }
}

function handleClose() {
  emit('close')
}

useDialogStack(computed(() => true), handleClose)
</script>

<template>
  <div class="dialog-overlay" @dragenter.stop.prevent @dragover.stop.prevent @dragleave.stop @drop.stop>
    <div class="skills-dialog" @click.stop>
      <div class="dialog-header">
        <h2>技能管理</h2>
        <button class="close-btn" @click="handleClose" title="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <!-- 左侧市场导航 -->
        <div class="market-nav">
          <div
            v-for="market in markets"
            :key="market.id"
            class="nav-item"
            :class="{ active: activeMarket === market.id }"
            @click="handleMarketChange(market.id)"
          >
            <svg v-if="market.id === 'clawhub'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 2L3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <path d="M16 10a4 4 0 0 1-8 0"/>
            </svg>
            <svg v-else-if="market.id === 'project'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
              <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
            <span>{{ market.label }}</span>
          </div>
        </div>

        <!-- 右侧内容 -->
        <div class="skills-content" @scroll="handleScroll">
          <!-- 已安装 -->
          <div
            v-if="activeMarket === 'installed'"
            class="tab-panel"
            @dragover.prevent="isDragOver = true"
            @dragleave.prevent="isDragOver = false"
            @drop.prevent="handleDrop"
            :class="{ 'drag-over-panel': isDragOver }"
          >
            <div class="panel-header">
              <h3>已下载的技能</h3>
              <div class="header-actions">
                <div class="filter-group">
                  <button class="filter-btn" :class="{ active: installFilter === 'all' }" @click="installFilter = 'all'">全部</button>
                  <button class="filter-btn" :class="{ active: installFilter === 'claude' }" @click="installFilter = 'claude'">Claude</button>
                  <button class="filter-btn" :class="{ active: installFilter === 'codex' }" @click="installFilter = 'codex'">Codex</button>
                  <button class="filter-btn" :class="{ active: installFilter === 'none' }" @click="installFilter = 'none'">未安装</button>
                </div>
                <div class="install-inline">
                <input
                  v-model="installSource"
                  type="text"
                  placeholder="本地路径或 URL"
                  class="install-input"
                  @keydown.enter="handleInstall"
                  :disabled="isInstalling"
                />
                <button
                  class="action-btn small install-btn"
                  @click="handleInstall"
                  :disabled="isInstalling || !installSource.trim()"
                >
                  <template v-if="isInstalling">
                    <div class="btn-spinner"></div>
                  </template>
                  <template v-else>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                      <line x1="12" y1="5" x2="12" y2="19"/>
                      <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  </template>
                </button>
              </div>
              </div>
            </div>
            <p v-if="installError" class="install-error">{{ installError }}</p>
            <p v-if="toggleError" class="install-error">{{ toggleError }}</p>

            <!-- 已安装列表 -->
            <div v-if="filteredInstalledSkills.length > 0" class="skills-grid">
              <div
                v-for="skill in filteredInstalledSkills"
                :key="skill.slug + '-' + skill.source"
                class="skill-card"
                :class="{ disabled: isPluginDisabled(skill) }"
                @click="openInstalledDetail(skill)"
              >
                <div class="skill-header">
                  <span class="skill-name">{{ skill.name }}</span>
                  <div class="skill-header-badges">
                    <span v-if="skill.source !== 'local' || skill.system || skill.external || skill.plugin || skill.sourceLabel" class="installed-source" :class="[skill.source, { external: skill.external, system: skill.system, plugin: skill.plugin }]">
                      {{ getSkillSourceLabel(skill) }}
                    </span>
                    <span v-if="isPluginDisabled(skill)" class="installed-source disabled-state-badge">已禁用</span>
                  </div>
                </div>
                <p class="skill-desc">{{ skill.description || '暂无描述' }}</p>
                <div class="skill-meta">
                  <div class="target-toggles">
                    <button
                      v-if="!isStaticSkill(skill) || skill.installedTargets?.includes('claude')"
                      class="target-toggle"
                      :class="{ active: skill.installedTargets?.includes('claude'), static: isStaticSkill(skill) }"
                      @click.stop="!isStaticSkill(skill) && toggleTarget(skill, 'claude')"
                    >Claude</button>
                    <button
                      v-if="!isStaticSkill(skill) || skill.installedTargets?.includes('codex')"
                      class="target-toggle"
                      :class="{ active: skill.installedTargets?.includes('codex'), static: isStaticSkill(skill) }"
                      @click.stop="!isStaticSkill(skill) && toggleTarget(skill, 'codex')"
                    >Codex</button>
                  </div>
                  <button v-if="!isStaticSkill(skill)" class="delete-btn" @click.stop="handleDeleteSkill(skill)" title="删除">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <!-- 空状态 -->
            <div v-else-if="installedSkills.length === 0" class="empty-state">
              <svg class="empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                <line x1="12" y1="22.08" x2="12" y2="12"/>
              </svg>
              <p>暂无已下载的技能</p>
              <p class="hint">从技能市场浏览并下载，或手动安装</p>
              <button class="action-btn" @click="handleMarketChange('clawhub')">
                浏览技能市场
              </button>
            </div>
            <div v-else class="empty-state">
              <p>当前过滤条件下没有技能</p>
            </div>
          </div>

          <!-- ClawHub 市场 -->
          <div v-if="activeMarket === 'clawhub'" class="tab-panel">
            <div class="panel-header">
              <h3>ClawHub 技能市场</h3>
              <div class="search-bar">
                <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.35-4.35"/>
                </svg>
                <input
                  v-model="searchQuery"
                  type="text"
                  placeholder="搜索技能... (回车搜索)"
                  class="search-input"
                  @keydown.enter="handleSearch"
                />
                <button v-if="searchQuery" class="clear-search-btn" @click="clearSearch" title="清除搜索">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/>
                    <line x1="6" y1="6" x2="18" y2="18"/>
                  </svg>
                </button>
              </div>
            </div>

            <!-- 加载中 -->
            <div v-if="isLoading && skills.length === 0" class="loading-state">
              <div class="spinner"></div>
              <p>加载技能列表...</p>
            </div>

            <!-- 错误 -->
            <div v-else-if="skillsError" class="error-state">
              <svg class="error-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <p>加载失败: {{ skillsError }}</p>
              <button class="action-btn small" @click="refresh">重试</button>
            </div>

            <!-- 搜索无结果 -->
            <div v-else-if="isSearching && skills.length === 0 && !isLoading" class="empty-state">
              <svg class="empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.35-4.35"/>
              </svg>
              <p>未找到匹配的技能</p>
              <p class="hint">试试其他关键词</p>
            </div>

            <!-- 技能列表 -->
            <div v-else class="skills-grid-wrapper">
              <div v-if="isLoading" class="search-overlay">
                <div class="spinner small"></div>
                <span>搜索中...</span>
              </div>
              <div class="skills-grid">
              <div
                v-for="skill in skills"
                :key="skill.slug"
                class="skill-card"
                @click="openSkillDetail(skill)"
              >
                <div class="skill-header">
                  <span class="skill-name">{{ skill.displayName || skill.slug }}</span>
                  <div class="skill-header-badges">
                    <span v-if="getDownloadStatus(skill.slug) === 'downloading'" class="skill-status downloading" title="下载中"></span>
                    <span v-else-if="getDownloadStatus(skill.slug) === 'downloaded'" class="skill-status downloaded" title="已下载">
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                        <polyline points="20 6 9 17 4 12"/>
                      </svg>
                    </span>
                    <span v-if="skill.version" class="skill-version">v{{ skill.version }}</span>
                  </div>
                </div>
                <p class="skill-desc">{{ skill.summary || '暂无描述' }}</p>
                <div class="skill-meta">
                  <span v-if="skill.owner" class="skill-author">
                    <img v-if="skill.owner.image" :src="skill.owner.image" class="author-avatar" alt="" />
                    <svg v-else width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
                      <circle cx="12" cy="7" r="4"/>
                    </svg>
                    {{ skill.owner.handle || skill.owner.displayName }}
                  </span>
                  <span v-if="skill.stats" class="skill-stats">
                    <span v-if="skill.stats.stars" class="stat-item" title="星级">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                      </svg>
                      {{ formatCount(skill.stats.stars) }}
                    </span>
                    <span v-if="skill.stats.downloads" class="stat-item" title="下载量">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                      </svg>
                      {{ formatCount(skill.stats.downloads) }}
                    </span>
                  </span>
                </div>
              </div>
              </div>
            </div>

            <!-- 加载更多 -->
            <div v-if="isLoading && skills.length > 0 && !isSearching" class="loading-more">
              <div class="spinner small"></div>
              <span>加载更多...</span>
            </div>

            <!-- 没有更多 -->
            <div v-if="!hasMore && skills.length > 0 && !isLoading" class="no-more">
              已显示全部技能
            </div>
          </div>

          <!-- 项目配置 -->
          <div
            v-if="activeMarket === 'project'"
            class="tab-panel"
            @dragover.prevent="isDragOver = true"
            @dragleave.prevent="isDragOver = false"
            @drop.prevent="handleProjectDrop"
            :class="{ 'drag-over-panel': isDragOver }"
          >
            <div class="panel-header">
              <h3>项目级技能</h3>
              <div class="header-actions">
                <div class="filter-group">
                  <button class="filter-btn" :class="{ active: projectFilter === 'all' }" @click="projectFilter = 'all'">全部</button>
                  <button class="filter-btn" :class="{ active: projectFilter === 'claude' }" @click="projectFilter = 'claude'">Claude</button>
                  <button class="filter-btn" :class="{ active: projectFilter === 'codex' }" @click="projectFilter = 'codex'">Codex</button>
                  <button class="filter-btn" :class="{ active: projectFilter === 'none' }" @click="projectFilter = 'none'">未安装</button>
                </div>
                <div class="install-inline">
                  <input
                    v-model="projectInstallSource"
                    type="text"
                    placeholder="本地路径或 URL（安装到项目）"
                    class="install-input"
                    @keydown.enter="handleProjectInstall"
                    :disabled="isProjectInstalling"
                  />
                  <button
                    class="action-btn small install-btn"
                    @click="handleProjectInstall"
                    :disabled="isProjectInstalling || !projectInstallSource.trim()"
                  >
                    <template v-if="isProjectInstalling">
                      <div class="btn-spinner"></div>
                    </template>
                    <template v-else>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <line x1="12" y1="5" x2="12" y2="19"/>
                        <line x1="5" y1="12" x2="19" y2="12"/>
                      </svg>
                    </template>
                  </button>
                </div>
              </div>
            </div>
            <p class="project-path-hint">{{ projectPath }}/.claude/skills</p>
            <p v-if="projectInstallError" class="install-error">{{ projectInstallError }}</p>
            <p v-if="projectToggleError" class="install-error">{{ projectToggleError }}</p>

            <!-- 项目级技能列表 -->
            <div v-if="filteredProjectSkills.length > 0" class="skills-grid">
              <div
                v-for="skill in filteredProjectSkills"
                :key="'project-' + skill.slug"
                class="skill-card"
                :class="{ disabled: isPluginDisabled(skill) }"
                @click="openInstalledDetail(skill)"
              >
                <div class="skill-header">
                  <span class="skill-name">{{ skill.name }}</span>
                  <div class="skill-header-badges">
                    <span v-if="skill.source !== 'local' || skill.system || skill.external || skill.plugin || skill.sourceLabel" class="installed-source" :class="[skill.source, { external: skill.external, system: skill.system, plugin: skill.plugin }]">
                      {{ getSkillSourceLabel(skill) }}
                    </span>
                    <span v-if="isPluginDisabled(skill)" class="installed-source disabled-state-badge">已禁用</span>
                  </div>
                </div>
                <p class="skill-desc">{{ skill.description || '暂无描述' }}</p>
                <div class="skill-meta">
                  <div class="target-toggles">
                    <button
                      v-if="!isStaticSkill(skill) || skill.projectTargets?.includes('claude')"
                      class="target-toggle"
                      :class="{ active: skill.projectTargets?.includes('claude'), static: isStaticSkill(skill) }"
                      @click.stop="!isStaticSkill(skill) && toggleProjectTarget(skill, 'claude')"
                    >Claude</button>
                    <button
                      v-if="!isStaticSkill(skill) || skill.projectTargets?.includes('codex')"
                      class="target-toggle"
                      :class="{ active: skill.projectTargets?.includes('codex'), static: isStaticSkill(skill) }"
                      @click.stop="!isStaticSkill(skill) && toggleProjectTarget(skill, 'codex')"
                    >Codex</button>
                  </div>
                  <button v-if="skill.projectTargets?.length" class="delete-btn" @click.stop="handleDeleteProjectSkill(skill)" title="从项目移除">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <!-- 空状态 -->
            <div v-else class="empty-state">
              <svg class="empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
              </svg>
              <p>暂无项目级技能</p>
              <p class="hint">从已下载的技能中安装到项目，或手动安装</p>
              <button class="action-btn" @click="handleMarketChange('installed')">
                查看已下载技能
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部下载状态栏 -->
      <div v-if="activeDownloads.length > 0" class="download-bar">
        <div class="btn-spinner"></div>
        <span>正在下载 {{ activeDownloads.length }} 个技能: {{ activeDownloads.join(', ') }}</span>
      </div>
    </div>

    <!-- 技能详情弹窗 -->
    <div v-if="selectedSkill" class="detail-overlay" @click.self="closeSkillDetail">
      <div class="detail-dialog" @click.stop>
        <div class="detail-header">
          <h3>{{ selectedSkill.displayName }}</h3>
          <button class="close-btn" @click="closeSkillDetail" title="关闭">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="detail-body">
          <div class="detail-meta-row">
            <span v-if="selectedSkill.version" class="detail-badge">v{{ selectedSkill.version }}</span>
            <span v-if="selectedSkill.highlighted" class="detail-badge accent">Staff Pick</span>
          </div>

          <div class="detail-author-row">
            <img v-if="selectedSkill.owner?.image" :src="selectedSkill.owner.image" class="detail-avatar" alt="" />
            <div class="detail-author-info">
              <span class="detail-author-name">@{{ selectedSkill.owner?.handle }}</span>
              <span class="detail-slug">{{ selectedSkill.slug }}</span>
            </div>
          </div>

          <div class="detail-stats-row">
            <div class="detail-stat">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
              </svg>
              {{ formatCount(selectedSkill.stats?.stars || 0) }} 星
            </div>
            <div class="detail-stat">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              {{ formatCount(selectedSkill.stats?.downloads || 0) }} 下载
            </div>
            <div class="detail-stat">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="4 17 10 11 4 5"/>
                <line x1="12" y1="19" x2="20" y2="19"/>
              </svg>
              {{ selectedSkill.stats?.versions || 0 }} 版本
            </div>
          </div>

          <div class="detail-section">
            <h4>描述</h4>
            <p>{{ selectedSkill.summary || '暂无描述' }}</p>
          </div>

          <div v-if="selectedSkill.changelog" class="detail-section">
            <h4>更新日志</h4>
            <p>{{ selectedSkill.changelog }}</p>
          </div>

          <div v-if="selectedSkill.capabilityTags?.length" class="detail-section">
            <h4>能力标签</h4>
            <div class="detail-tags">
              <span v-for="tag in selectedSkill.capabilityTags" :key="tag" class="detail-tag">{{ tag }}</span>
            </div>
          </div>

          <div class="detail-actions">
            <button
              v-if="getDownloadStatus(selectedSkill.slug) === 'downloaded'"
              class="action-btn downloaded"
              disabled
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              已下载
            </button>
            <button
              v-else-if="getDownloadStatus(selectedSkill.slug) === 'downloading'"
              class="action-btn" disabled
            >
              <div class="btn-spinner"></div>
              下载中...
            </button>
            <button
              v-else
              class="action-btn"
              @click="handleDownload(selectedSkill.slug)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              下载技能
            </button>

            <p v-if="downloadError" class="download-error">{{ downloadError }}</p>

            <a :href="`https://clawhub.ai/${selectedSkill.owner?.handle}/${selectedSkill.slug}`" target="_blank" class="action-btn secondary">
              在 ClawHub 查看
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                <polyline points="15 3 21 3 21 9"/>
                <line x1="10" y1="14" x2="21" y2="3"/>
              </svg>
            </a>
          </div>
        </div>
      </div>
    </div>

    <!-- 已安装技能详情弹窗 -->
    <div v-if="viewingInstalledSkill" class="detail-overlay" @click.self="closeInstalledDetail">
      <div class="detail-dialog readme-dialog" @click.stop>
        <div class="detail-header">
          <h3>{{ viewingInstalledSkill.name }}</h3>
          <button class="close-btn" @click="closeInstalledDetail" title="关闭">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="detail-tabs">
          <button class="detail-tab" :class="{ active: skillDetailTab === 'content' }" @click="skillDetailTab = 'content'">内容</button>
          <button v-if="skillLicense" class="detail-tab" :class="{ active: skillDetailTab === 'license' }" @click="skillDetailTab = 'license'">许可</button>
          <button class="detail-tab" :class="{ active: skillDetailTab === 'files' }" @click="skillDetailTab = 'files'">文件</button>
        </div>
        <div class="detail-body readme-body">
          <div v-if="isLoadingReadme" class="loading-state" style="padding: 32px 0">
            <div class="spinner"></div>
          </div>
          <template v-else>
            <!-- 内容 tab -->
            <div v-if="skillDetailTab === 'content'">
              <MarkdownRenderer v-if="skillReadme" :content="skillReadme" />
              <div v-else class="empty-state" style="padding: 32px 0">
                <p>无法读取 SKILL.md</p>
              </div>
            </div>
            <!-- 许可 tab -->
            <div v-else-if="skillDetailTab === 'license'" class="license-content">
              <pre>{{ skillLicense }}</pre>
            </div>
            <!-- 文件 tab -->
            <div v-else-if="skillDetailTab === 'files'" class="file-tree">
              <div v-for="(item, i) in flattenedTree" :key="i" class="tree-item" :style="{ paddingLeft: (item.depth * 16 + 4) + 'px' }">
                <span class="tree-icon">{{ item.type === 'dir' ? '📁' : '📄' }}</span>
                <span class="tree-name">{{ item.name }}</span>
              </div>
              <div v-if="flattenedTree.length === 0" class="empty-state" style="padding: 32px 0">
                <p>空目录</p>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- 删除确认框 -->
    <div v-if="skillToDelete" class="detail-overlay" @click.self="cancelDeleteSkill">
      <div class="confirm-box" @click.stop>
        <p class="confirm-text">确认删除技能「{{ skillToDelete.name }}」？</p>
        <p class="confirm-hint">此操作无法恢复</p>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" @click="cancelDeleteSkill">取消</button>
          <button class="confirm-btn danger" @click="confirmDeleteSkill">删除</button>
        </div>
      </div>
    </div>

    <!-- 项目级技能详情弹窗 -->
    <div v-if="viewingProjectSkill" class="detail-overlay" @click.self="closeProjectSkillDetail">
      <div class="detail-dialog readme-dialog" @click.stop>
        <div class="detail-header">
          <h3>{{ viewingProjectSkill.name }}</h3>
          <button class="close-btn" @click="closeProjectSkillDetail" title="关闭">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="detail-tabs">
          <button class="detail-tab" :class="{ active: projectSkillDetailTab === 'content' }" @click="projectSkillDetailTab = 'content'">内容</button>
          <button v-if="projectSkillLicense" class="detail-tab" :class="{ active: projectSkillDetailTab === 'license' }" @click="projectSkillDetailTab = 'license'">许可</button>
          <button class="detail-tab" :class="{ active: projectSkillDetailTab === 'files' }" @click="projectSkillDetailTab = 'files'">文件</button>
        </div>
        <div class="detail-body readme-body">
          <div v-if="isProjectLoadingReadme" class="loading-state" style="padding: 32px 0">
            <div class="spinner"></div>
          </div>
          <template v-else>
            <div v-if="projectSkillDetailTab === 'content'">
              <MarkdownRenderer v-if="projectSkillReadme" :content="projectSkillReadme" />
              <div v-else class="empty-state" style="padding: 32px 0">
                <p>无法读取 SKILL.md</p>
              </div>
            </div>
            <div v-else-if="projectSkillDetailTab === 'license'" class="license-content">
              <pre>{{ projectSkillLicense }}</pre>
            </div>
            <div v-else-if="projectSkillDetailTab === 'files'" class="file-tree">
              <div v-for="(item, i) in flattenedProjectTree" :key="i" class="tree-item" :style="{ paddingLeft: (item.depth * 16 + 4) + 'px' }">
                <span class="tree-icon">{{ item.type === 'dir' ? '📁' : '📄' }}</span>
                <span class="tree-name">{{ item.name }}</span>
              </div>
              <div v-if="flattenedProjectTree.length === 0" class="empty-state" style="padding: 32px 0">
                <p>空目录</p>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- 项目级删除确认框 -->
    <div v-if="projectSkillToDelete" class="detail-overlay" @click.self="cancelDeleteProjectSkill">
      <div class="confirm-box" @click.stop>
        <p class="confirm-text">确认从项目中删除技能「{{ projectSkillToDelete.name }}」？</p>
        <p class="confirm-hint">仅从当前项目移除，不影响全局下载</p>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" @click="cancelDeleteProjectSkill">取消</button>
          <button class="confirm-btn danger" @click="confirmDeleteProjectSkill">删除</button>
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
  background:
    radial-gradient(circle at top, rgba(249, 115, 22, 0.06), transparent 24%),
    rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.skills-dialog {
  --app-soft-surface: rgba(255, 255, 255, 0.024);
  --app-soft-surface-hover: rgba(255, 255, 255, 0.05);
  --app-soft-border: rgba(255, 255, 255, 0.13);
  --app-soft-border-hover: rgba(255, 255, 255, 0.18);
  background:
    radial-gradient(circle at top right, rgba(249, 115, 22, 0.06), transparent 26%),
    linear-gradient(180deg, #1B1E23 0%, #17191D 100%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  width: 90vw;
  max-width: 900px;
  height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 24px 64px rgba(0, 0, 0, 0.46);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.dialog-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #F4F4F5;
}

.close-btn {
  background: transparent;
  border: none;
  color: #9CA3AF;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.close-btn:hover {
  color: #F4F4F5;
  background: #3F3F46;
}

.dialog-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

/* 左侧市场导航 */
.market-nav {
  width: 200px;
  background: linear-gradient(180deg, rgba(20, 22, 27, 0.98) 0%, rgba(17, 18, 22, 1) 100%);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  padding: 16px 8px;
  flex-shrink: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  color: #9CA3AF;
  transition: all 0.2s;
  margin-bottom: 4px;
}

.nav-item:hover {
  background: var(--app-soft-surface);
  color: #F4F4F5;
}

.nav-item.active {
  background: rgba(249, 115, 22, 0.1);
  color: #F97316;
}

.nav-item span {
  font-size: 14px;
}

/* 右侧内容 */
.skills-content {
  flex: 1;
  overflow-y: auto;
  background: linear-gradient(180deg, rgba(26, 28, 33, 0.94), rgba(23, 25, 29, 0.98));
}

.tab-panel {
  display: flex;
  flex-direction: column;
  min-height: 100%;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px 16px;
  flex-shrink: 0;
  position: sticky;
  top: 0;
  background: linear-gradient(180deg, rgba(26, 28, 33, 1) 80%, rgba(26, 28, 33, 0));
  z-index: 2;
}

.panel-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #F4F4F5;
}

.search-bar {
  position: relative;
  width: 240px;
}

.search-icon {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  color: #71717A;
  pointer-events: none;
}

.search-input {
  width: 100%;
  padding: 8px 12px 8px 34px;
  background: var(--app-soft-surface);
  border: 1px solid var(--app-soft-border);
  border-radius: 6px;
  color: #F4F4F5;
  font-size: 13px;
  transition: border-color 0.2s, box-shadow 0.2s;
}

.search-input:focus {
  outline: none;
  border-color: #F97316;
  box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.1);
}

.search-input::placeholder {
  color: #52525B;
}

.clear-search-btn {
  position: absolute;
  right: 6px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  color: #71717A;
  cursor: pointer;
  padding: 2px;
  display: flex;
  align-items: center;
  border-radius: 3px;
}

.clear-search-btn:hover {
  color: #F4F4F5;
  background: rgba(255, 255, 255, 0.08);
}

/* 技能网格 */
.skills-grid-wrapper {
  position: relative;
  flex: 1;
}

.search-overlay {
  position: absolute;
  inset: 0;
  background: rgba(23, 25, 29, 0.6);
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  z-index: 5;
  color: #9CA3AF;
  font-size: 13px;
}

.skills-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  padding: 0 24px 24px;
}

.skill-card {
  background: var(--app-soft-surface);
  border: 1px solid var(--app-soft-border);
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.2s, background 0.2s;
  cursor: pointer;
}

.skill-card.disabled {
  border-color: rgba(249, 115, 22, 0.3);
}

.skill-card:hover {
  border-color: rgba(249, 115, 22, 0.3);
  background: var(--app-soft-surface-hover);
}

.skill-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.skill-header-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.skill-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
}

.skill-status.downloaded {
  background: rgba(34, 197, 94, 0.15);
  color: #22C55E;
}

.skill-status.downloading {
  background: rgba(249, 115, 22, 0.15);
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

.skill-name {
  font-size: 14px;
  font-weight: 600;
  color: #F4F4F5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.skill-card.disabled .skill-name {
  color: rgba(244, 244, 245, 0.8);
}

.skill-card.disabled .skill-meta,
.skill-card.disabled .skill-desc {
  opacity: 0.5;
}


.skill-version {
  font-size: 11px;
  color: #71717A;
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.skill-desc {
  font-size: 12px;
  color: #9CA3AF;
  line-height: 1.5;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.skill-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
}

.skill-author {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #71717A;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.author-avatar {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  flex-shrink: 0;
  object-fit: cover;
}

.skill-stats {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}

.stat-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11px;
  color: #71717A;
}

/* 加载状态 */
.loading-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 48px 24px;
}

.loading-state p {
  margin: 0;
  font-size: 14px;
  color: #71717A;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid #3F3F46;
  border-top-color: #F97316;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

.spinner.small {
  width: 16px;
  height: 16px;
  border-width: 2px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.loading-more {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: 16px 24px 24px;
  color: #71717A;
  font-size: 13px;
}

.no-more {
  text-align: center;
  padding: 16px 24px 24px;
  color: #52525B;
  font-size: 12px;
}

/* 错误状态 */
.error-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 48px 24px;
}

.error-icon {
  color: #EF4444;
}

.error-state p {
  margin: 0;
  font-size: 14px;
  color: #FCA5A5;
}

/* 空状态 */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  gap: 12px;
}

.empty-icon {
  color: #3F3F46;
  margin-bottom: 8px;
}

.empty-state p {
  margin: 0;
  font-size: 15px;
  color: #71717A;
}

.empty-state .hint {
  font-size: 13px;
  color: #52525B;
}

.action-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: #F97316;
  border: none;
  border-radius: 6px;
  color: white;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
  margin-top: 8px;
}

.action-btn:hover {
  background: #EA580C;
}

.action-btn.small {
  padding: 6px 12px;
  font-size: 12px;
  margin-top: 0;
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn.secondary {
  background: transparent;
  border: 1px solid var(--app-soft-border);
  color: #9CA3AF;
  text-decoration: none;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.action-btn.secondary:hover {
  border-color: var(--app-soft-border-hover);
  color: #F4F4F5;
  background: var(--app-soft-surface);
}

/* 详情弹窗 */
.detail-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}

.detail-dialog {
  background:
    radial-gradient(circle at top right, rgba(249, 115, 22, 0.06), transparent 26%),
    linear-gradient(180deg, #1B1E23 0%, #17191D 100%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  width: 460px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.46);
}

.detail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  flex-shrink: 0;
}

.detail-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #F4F4F5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-body {
  padding: 20px;
  display: flex;
  flex-direction: column;
  gap: 16px;
  overflow-y: auto;
}

.detail-meta-row {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.detail-badge {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  background: rgba(255, 255, 255, 0.06);
  color: #9CA3AF;
}

.detail-badge.accent {
  background: rgba(249, 115, 22, 0.12);
  color: #F97316;
}

.detail-author-row {
  display: flex;
  align-items: center;
  gap: 12px;
}

.detail-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  object-fit: cover;
}

.detail-author-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.detail-author-name {
  font-size: 13px;
  color: #E5E5E5;
  font-weight: 500;
}

.detail-slug {
  font-size: 11px;
  color: #71717A;
  font-family: monospace;
}

.detail-stats-row {
  display: flex;
  gap: 16px;
  padding: 12px;
  background: var(--app-soft-surface);
  border: 1px solid var(--app-soft-border);
  border-radius: 8px;
}

.detail-stat {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  color: #9CA3AF;
}

.detail-stat svg {
  color: #71717A;
}

.detail-section h4 {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  color: #71717A;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.detail-section p {
  margin: 0;
  font-size: 13px;
  color: #D4D4D8;
  line-height: 1.6;
}

.detail-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.detail-tag {
  padding: 3px 8px;
  border-radius: 4px;
  font-size: 11px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid var(--app-soft-border);
  color: #9CA3AF;
}

.detail-actions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 8px;
}

.action-btn.downloaded {
  background: rgba(34, 197, 94, 0.12);
  color: #22C55E;
  cursor: default;
}

.action-btn.downloaded:hover {
  background: rgba(34, 197, 94, 0.12);
}

.btn-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid rgba(255, 255, 255, 0.2);
  border-top-color: white;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
  flex-shrink: 0;
}

.download-error {
  margin: 0;
  font-size: 12px;
  color: #FCA5A5;
  background: rgba(239, 68, 68, 0.08);
  padding: 6px 10px;
  border-radius: 4px;
}

/* 底部下载状态栏 */
.download-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 24px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  background: rgba(249, 115, 22, 0.04);
  color: #9CA3AF;
  font-size: 12px;
  flex-shrink: 0;
}

/* 手动安装（标题右侧内联） */
.header-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.filter-group {
  display: flex;
  gap: 2px;
  background: rgba(255, 255, 255, 0.04);
  border-radius: 6px;
  padding: 2px;
}

.filter-btn {
  padding: 4px 10px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #71717A;
  font-size: 11px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
}

.filter-btn:hover {
  color: #A1A1AA;
}

.filter-btn.active {
  background: rgba(255, 255, 255, 0.08);
  color: #F4F4F5;
}

.install-inline {
  display: flex;
  gap: 6px;
  width: 280px;
}

.install-input {
  flex: 1;
  padding: 5px 10px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--app-soft-border);
  border-radius: 5px;
  color: #F4F4F5;
  font-size: 12px;
  transition: border-color 0.2s;
}

.install-input:focus {
  outline: none;
  border-color: #F97316;
}

.install-input::placeholder {
  color: #52525B;
}

.install-input:disabled {
  opacity: 0.5;
}

.install-btn {
  margin-top: 0;
  min-width: 32px;
  padding: 5px 8px;
  justify-content: center;
}

.drag-over-panel {
  position: relative;
}

.drag-over-panel::after {
  content: '';
  position: absolute;
  inset: 0;
  border: 2px dashed #F97316;
  border-radius: 0;
  background: rgba(249, 115, 22, 0.04);
  pointer-events: none;
  z-index: 10;
}

.install-error {
  margin: 0 24px 8px;
  font-size: 12px;
  color: #FCA5A5;
  background: rgba(239, 68, 68, 0.08);
  padding: 6px 10px;
  border-radius: 4px;
}

/* 已安装卡片（复用 skills-grid） */
.installed-source {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  flex-shrink: 0;
  background: rgba(161, 161, 170, 0.1);
  color: #A1A1AA;
}

.installed-source.clawhub {
  background: rgba(59, 130, 246, 0.12);
  color: #60A5FA;
}

.installed-source.external {
  background: rgba(161, 161, 170, 0.1);
  color: #A1A1AA;
}

.installed-source.system {
  background: rgba(249, 115, 22, 0.12);
  color: #F97316;
}

.installed-source.plugin {
  background: rgba(245, 158, 11, 0.14);
  color: #FBBF24;
}

.disabled-state-badge {
  color: rgba(248, 250, 252, 0.82) !important;
  background: rgba(249, 115, 22, 0.12) !important;
  border: 1px solid rgba(249, 115, 22, 0.22);
}


.delete-btn {
  background: transparent;
  border: none;
  color: #71717A;
  cursor: pointer;
  padding: 3px;
  display: flex;
  align-items: center;
  border-radius: 3px;
  flex-shrink: 0;
  opacity: 0;
  transition: opacity 0.15s, color 0.15s;
}

.skill-card:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  color: #EF4444;
  background: rgba(239, 68, 68, 0.08);
}

/* 目标安装切换按钮 */
.target-toggles {
  display: flex;
  gap: 4px;
}

.target-toggle {
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: #52525B;
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.target-toggle:hover {
  border-color: rgba(255, 255, 255, 0.15);
  color: #9CA3AF;
}

.target-toggle.active {
  border-color: rgba(249, 115, 22, 0.3);
  background: rgba(249, 115, 22, 0.1);
  color: #F97316;
}

.target-toggle.static {
  cursor: default;
  opacity: 0.7;
}

/* 已安装技能详情弹窗 */
.readme-dialog {
  width: 600px;
  height: 85vh;
}

.readme-body {
  padding: 20px 24px;
  flex: 1;
  overflow-y: auto;
}

/* 详情 tabs */
.detail-tabs {
  display: flex;
  gap: 2px;
  padding: 0 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.detail-tab {
  padding: 8px 16px;
  border: none;
  border-bottom: 2px solid transparent;
  background: transparent;
  color: #71717A;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}

.detail-tab:hover {
  color: #A1A1AA;
}

.detail-tab.active {
  color: #F97316;
  border-bottom-color: #F97316;
}

/* 许可内容 */
.license-content pre {
  margin: 0;
  padding: 16px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 8px;
  color: #D4D4D8;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
}

/* 文件树 */
.file-tree {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.tree-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 4px;
  border-radius: 4px;
  font-size: 13px;
  color: #D4D4D8;
}

.tree-item:hover {
  background: rgba(255, 255, 255, 0.03);
}

.tree-icon {
  font-size: 12px;
  flex-shrink: 0;
  width: 16px;
  text-align: center;
}

.tree-name {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}

/* 删除确认框 */
.confirm-box {
  background: linear-gradient(180deg, #1B1E23 0%, #17191D 100%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 24px;
  width: 320px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.5);
}

.confirm-text {
  margin: 0 0 4px;
  font-size: 15px;
  font-weight: 500;
  color: #F4F4F5;
}

.confirm-hint {
  margin: 0 0 20px;
  font-size: 12px;
  color: #71717A;
}

.confirm-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.confirm-btn {
  padding: 6px 16px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.15s;
}

.confirm-btn.cancel {
  background: rgba(255, 255, 255, 0.06);
  color: #A1A1AA;
}

.confirm-btn.cancel:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #F4F4F5;
}

.confirm-btn.danger {
  background: rgba(239, 68, 68, 0.15);
  color: #FCA5A5;
}

.confirm-btn.danger:hover {
  background: #EF4444;
  color: white;
}

/* 项目路径提示 */
.project-path-hint {
  margin: 0 24px;
  font-size: 11px;
  color: #52525B;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  padding: 4px 0 8px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.04);
}
</style>
