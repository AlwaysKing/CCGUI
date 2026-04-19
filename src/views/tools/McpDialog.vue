<script setup>
import { computed, ref, onMounted } from 'vue'
import { useDialogStack } from '../../composables/useDialogStack'
import { useMCPRegistry } from './composables/useMCPRegistry'

const props = defineProps({
  projectPath: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['close'])

const activeMarket = ref('installed')

const markets = computed(() => {
  const items = [
    { id: 'installed', label: '已下载' },
    { id: 'registry', label: 'MCP Registry' }
  ]
  if (props.projectPath) {
    items.splice(1, 0, { id: 'project', label: '项目配置' })
  }
  return items
})

const downloadedMcps = ref([])
const installFilter = ref('all') // 'all' | 'claude' | 'codex' | 'none'
const toggleError = ref(null)
const downloadError = ref(null)
const mcpToDelete = ref(null)

// 项目级 MCP 状态
const projectInstalledMap = ref(new Map()) // slug -> Set(['claude', 'codex'])
const projectToggleError = ref(null)
const projectMcpToDelete = ref(null)
const projectFilter = ref('all')

function getMcpSourceLabel(mcp) {
  if (mcp.sourceLabel) return mcp.sourceLabel
  if (mcp.external) return '外部'
  if (mcp.source === 'registry') return 'Registry'
  if (mcp.source === 'plugin') return '插件'
  return mcp.source || '本地'
}

function isStaticMcp(mcp) {
  return Boolean(mcp.external || mcp.plugin)
}

function isPluginDisabled(mcp) {
  return Boolean(mcp?.plugin && mcp?.pluginEnabled === false)
}

// Registry 详情弹窗
const selectedServer = ref(null)

// 环境变量弹窗
const envDialogMcp = ref(null) // { mcp, target }
const envValues = ref({})

const filteredDownloadedMcps = computed(() => {
  if (installFilter.value === 'all') return downloadedMcps.value
  if (installFilter.value === 'none') {
    return downloadedMcps.value.filter(m => !m.installedTargets?.length)
  }
  return downloadedMcps.value.filter(m => m.installedTargets?.includes(installFilter.value))
})

const filteredProjectMcps = computed(() => {
  const list = downloadedMcps.value.map(m => ({
    ...m,
    projectTargets: projectInstalledMap.value.get(m.slug)
      ? [...projectInstalledMap.value.get(m.slug)]
      : []
  }))
  if (projectFilter.value === 'all') return list
  if (projectFilter.value === 'none') {
    return list.filter(m => !m.projectTargets.length)
  }
  return list.filter(m => m.projectTargets.includes(projectFilter.value))
})

const {
  servers,
  isLoading,
  error: registryError,
  hasMore,
  searchQuery,
  isSearching,
  fetchServers,
  loadMore,
  refresh,
  handleSearch,
  clearSearch,
  checkDownloadedMcps,
  getDownloadStatus,
  downloadMcp,
  activeDownloads,
  downloadedSlugs
} = useMCPRegistry()

let registryLoaded = false

async function loadDownloadedMcps() {
  try {
    const result = await window.electronAPI.listDownloadedMcps()
    if (result.success) {
      downloadedMcps.value = result.mcps
    }
  } catch (e) { /* ignore */ }
}

async function loadProjectMcps() {
  if (!props.projectPath) return
  try {
    const result = await window.electronAPI.listProjectMcps({ projectPath: props.projectPath })
    if (result.success) {
      const map = new Map()
      for (const m of result.mcps) {
        map.set(m.slug, new Set(m.installedTargets || []))
      }
      projectInstalledMap.value = map
    }
  } catch (e) { /* ignore */ }
}

onMounted(() => {
  loadDownloadedMcps()
})

function handleMarketChange(marketId) {
  activeMarket.value = marketId
  if (marketId === 'registry' && !registryLoaded) {
    registryLoaded = true
    fetchServers()
    checkDownloadedMcps()
  }
  if (marketId === 'installed') {
    loadDownloadedMcps()
  }
  if (marketId === 'project') {
    loadProjectMcps()
  }
}

function handleScroll(event) {
  const el = event.target
  if (el.scrollTop + el.clientHeight >= el.scrollHeight - 100) {
    loadMore()
  }
}

// Registry 详情弹窗
function openServerDetail(server) {
  selectedServer.value = server
  downloadError.value = null
}

function closeServerDetail() {
  selectedServer.value = null
}

// 下载 MCP 元数据
async function handleDownloadMcp(server) {
  downloadError.value = null
  try {
    await downloadMcp(server)
    await loadDownloadedMcps()
  } catch (e) {
    downloadError.value = e.message
  }
}

// 安装/卸载 toggle
async function toggleTarget(mcp, target) {
  toggleError.value = null
  const isInstalled = mcp.installedTargets?.includes(target)

  if (isInstalled) {
    // 卸载
    try {
      await window.electronAPI.uninstallMcp({ slug: mcp.slug, target })
      await loadDownloadedMcps()
    } catch (e) {
      toggleError.value = e.message || '卸载失败'
    }
    return
  }

  // 安装前检查是否需要环境变量
  if (mcp.environmentVariables?.length > 0 && !mcp.external) {
    envDialogMcp.value = { mcp, target }
    envValues.value = {}
    for (const ev of mcp.environmentVariables) {
      envValues.value[ev.name] = ''
    }
    return
  }

  // 直接安装
  await doInstall(mcp.slug, target)
}

async function doInstall(slug, target, envs) {
  try {
    const result = await window.electronAPI.installMcp({
      slug,
      target,
      envValues: envs || {}
    })
    if (result.success) {
      await loadDownloadedMcps()
    } else {
      toggleError.value = result.error
    }
  } catch (e) {
    toggleError.value = e.message || '安装失败'
  }
}

function confirmEnvInstall() {
  const { mcp, target, isProject } = envDialogMcp.value
  const envs = { ...envValues.value }
  envDialogMcp.value = null
  if (isProject) {
    doProjectInstall(mcp.slug, target, envs)
  } else {
    doInstall(mcp.slug, target, envs)
  }
}

function cancelEnvDialog() {
  envDialogMcp.value = null
  envValues.value = {}
}

// 删除
function handleDeleteMcp(mcp) {
  mcpToDelete.value = mcp
}

function cancelDeleteMcp() {
  mcpToDelete.value = null
}

async function confirmDeleteMcp() {
  const mcp = mcpToDelete.value
  if (!mcp) return
  mcpToDelete.value = null
  try {
    const result = await window.electronAPI.deleteMcp({ slug: mcp.slug })
    if (result.success) {
      await loadDownloadedMcps()
      await checkDownloadedMcps()
    }
  } catch (e) { /* ignore */ }
}

// 项目级 MCP toggle
async function toggleProjectTarget(mcp, target) {
  projectToggleError.value = null
  const isInstalled = mcp.projectTargets?.includes(target)

  if (isInstalled) {
    try {
      await window.electronAPI.uninstallMcpFromProject({ slug: mcp.slug, target, projectPath: props.projectPath })
      await loadProjectMcps()
    } catch (e) {
      projectToggleError.value = e.message || '卸载失败'
    }
    return
  }

  // 安装前检查环境变量
  const globalMcp = downloadedMcps.value.find(m => m.slug === mcp.slug)
  if (globalMcp?.environmentVariables?.length > 0) {
    envDialogMcp.value = { mcp: globalMcp, target, isProject: true }
    envValues.value = {}
    for (const ev of globalMcp.environmentVariables) {
      envValues.value[ev.name] = ''
    }
    return
  }

  await doProjectInstall(mcp.slug, target)
}

async function doProjectInstall(slug, target, envs) {
  try {
    const result = await window.electronAPI.installMcpToProject({
      slug,
      target,
      envValues: envs || {},
      projectPath: props.projectPath
    })
    if (result.success) {
      await loadProjectMcps()
    } else {
      projectToggleError.value = result.error
    }
  } catch (e) {
    projectToggleError.value = e.message || '安装失败'
  }
}

function handleDeleteProjectMcp(mcp) {
  projectMcpToDelete.value = mcp
}

function cancelDeleteProjectMcp() {
  projectMcpToDelete.value = null
}

async function confirmDeleteProjectMcp() {
  const mcp = projectMcpToDelete.value
  if (!mcp) return
  projectMcpToDelete.value = null
  try {
    const result = await window.electronAPI.deleteProjectMcp({ slug: mcp.slug, projectPath: props.projectPath })
    if (result.success) {
      await loadProjectMcps()
      await loadDownloadedMcps()
    }
  } catch (e) { /* ignore */ }
}

function getTransportLabel(type) {
  const map = {
    'streamable-http': 'HTTP',
    'sse': 'SSE',
    'npm': 'npm',
    'pypi': 'PyPI',
    'oci': 'Docker'
  }
  return map[type] || type
}

function handleClose() {
  emit('close')
}

useDialogStack(computed(() => true), handleClose)
</script>

<template>
  <div class="dialog-overlay" @dragenter.stop.prevent @dragover.stop.prevent @dragleave.stop @drop.stop>
    <div class="mcp-dialog" @click.stop>
      <div class="dialog-header">
        <h2>MCP 服务</h2>
        <button class="close-btn" @click="handleClose" title="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <!-- 左侧导航 -->
        <div class="market-nav">
          <div
            v-for="market in markets"
            :key="market.id"
            class="nav-item"
            :class="{ active: activeMarket === market.id }"
            @click="handleMarketChange(market.id)"
          >
            <svg v-if="market.id === 'registry'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
            <svg v-else-if="market.id === 'project'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>
            </svg>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
              <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
              <line x1="6" y1="6" x2="6.01" y2="6"/>
              <line x1="6" y1="18" x2="6.01" y2="18"/>
            </svg>
            <span>{{ market.label }}</span>
          </div>
        </div>

        <!-- 右侧内容 -->
        <div class="mcp-content" @scroll="handleScroll">
          <!-- 已下载 -->
          <div v-if="activeMarket === 'installed'" class="tab-panel">
            <div class="panel-header">
              <h3>已下载的 MCP 服务</h3>
              <div class="filter-group">
                <button class="filter-btn" :class="{ active: installFilter === 'all' }" @click="installFilter = 'all'">全部</button>
                <button class="filter-btn" :class="{ active: installFilter === 'claude' }" @click="installFilter = 'claude'">Claude</button>
                <button class="filter-btn" :class="{ active: installFilter === 'codex' }" @click="installFilter = 'codex'">Codex</button>
                <button class="filter-btn" :class="{ active: installFilter === 'none' }" @click="installFilter = 'none'">未安装</button>
              </div>
            </div>
            <p v-if="toggleError" class="error-msg">{{ toggleError }}</p>

            <div v-if="filteredDownloadedMcps.length > 0" class="mcp-grid">
              <div
                v-for="mcp in filteredDownloadedMcps"
                :key="mcp.slug + '-' + mcp.source"
                class="mcp-card"
                :class="{ disabled: isPluginDisabled(mcp) }"
              >
                <div class="mcp-header">
                  <span class="mcp-name">{{ mcp.title || mcp.name }}</span>
                  <div class="mcp-badges">
                    <span
                      v-if="mcp.external || mcp.source === 'registry' || mcp.plugin || mcp.sourceLabel"
                      class="source-badge"
                      :class="{ external: mcp.external, registry: mcp.source === 'registry', plugin: mcp.plugin }"
                    >
                      {{ getMcpSourceLabel(mcp) }}
                    </span>
                    <span v-if="isPluginDisabled(mcp)" class="source-badge disabled-state-badge">已禁用</span>
                    <span v-if="mcp.version" class="version-badge">v{{ mcp.version }}</span>
                  </div>
                </div>
                <p class="mcp-desc">{{ mcp.description || '暂无描述' }}</p>
                <div class="mcp-meta">
                  <div class="target-toggles">
                    <button
                      v-if="!isStaticMcp(mcp) || mcp.installedTargets?.includes('claude')"
                      class="target-toggle"
                      :class="{ active: mcp.installedTargets?.includes('claude'), static: isStaticMcp(mcp) }"
                      @click.stop="!isStaticMcp(mcp) && toggleTarget(mcp, 'claude')"
                    >Claude</button>
                    <button
                      v-if="!isStaticMcp(mcp) || mcp.installedTargets?.includes('codex')"
                      class="target-toggle"
                      :class="{ active: mcp.installedTargets?.includes('codex'), static: isStaticMcp(mcp) }"
                      @click.stop="!isStaticMcp(mcp) && toggleTarget(mcp, 'codex')"
                    >Codex</button>
                  </div>
                  <button v-if="!isStaticMcp(mcp)" class="delete-btn" @click.stop="handleDeleteMcp(mcp)" title="删除">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="3 6 5 6 21 6"/>
                      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <!-- 空状态 -->
            <div v-else-if="downloadedMcps.length === 0" class="empty-state">
              <svg class="empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
                <line x1="6" y1="6" x2="6.01" y2="6"/>
                <line x1="6" y1="18" x2="6.01" y2="18"/>
              </svg>
              <p>暂无已下载的 MCP 服务</p>
              <p class="hint">从 MCP Registry 浏览并下载</p>
              <button class="action-btn" @click="handleMarketChange('registry')">
                浏览 MCP Registry
              </button>
            </div>
            <div v-else class="empty-state">
              <p>当前过滤条件下没有 MCP 服务</p>
            </div>
          </div>

          <!-- MCP Registry -->
          <div v-if="activeMarket === 'registry'" class="tab-panel">
            <div class="panel-header">
              <h3>MCP Registry</h3>
              <div class="search-bar">
                <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <circle cx="11" cy="11" r="8"/>
                  <path d="m21 21-4.35-4.35"/>
                </svg>
                <input
                  v-model="searchQuery"
                  type="text"
                  placeholder="搜索 MCP 服务... (回车搜索)"
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
            <div v-if="isLoading && servers.length === 0" class="loading-state">
              <div class="spinner"></div>
              <p>加载 MCP 服务列表...</p>
            </div>

            <!-- 错误 -->
            <div v-else-if="registryError" class="error-state">
              <svg class="error-icon" width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
              </svg>
              <p>加载失败: {{ registryError }}</p>
              <button class="action-btn small" @click="refresh">重试</button>
            </div>

            <!-- 搜索无结果 -->
            <div v-else-if="isSearching && servers.length === 0 && !isLoading" class="empty-state">
              <svg class="empty-icon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1">
                <circle cx="11" cy="11" r="8"/>
                <path d="m21 21-4.35-4.35"/>
              </svg>
              <p>未找到匹配的 MCP 服务</p>
              <p class="hint">试试其他关键词</p>
            </div>

            <!-- 服务器列表 -->
            <div v-else class="servers-grid-wrapper">
              <div v-if="isLoading" class="search-overlay">
                <div class="spinner small"></div>
                <span>搜索中...</span>
              </div>
              <div class="mcp-grid">
                <div
                  v-for="server in servers"
                  :key="server.fullName"
                  class="mcp-card clickable"
                  @click="openServerDetail(server)"
                >
                  <div class="mcp-header">
                    <span class="mcp-name">{{ server.title }}</span>
                    <div class="mcp-badges">
                      <span v-if="getDownloadStatus(server.slug) === 'downloading'" class="downloaded-badge downloading" title="下载中"></span>
                      <span v-else-if="getDownloadStatus(server.slug) === 'downloaded'" class="downloaded-badge" title="已下载">
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3">
                          <polyline points="20 6 9 17 4 12"/>
                        </svg>
                      </span>
                      <span v-if="server.version" class="version-badge">v{{ server.version }}</span>
                    </div>
                  </div>
                  <p class="mcp-desc">{{ server.description || '暂无描述' }}</p>
                  <div class="mcp-meta">
                    <div class="transport-badges">
                      <span v-for="t in server.transportTypes" :key="t" class="transport-badge">{{ getTransportLabel(t) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <p v-if="downloadError" class="error-msg">{{ downloadError }}</p>

            <!-- 加载更多 -->
            <div v-if="isLoading && servers.length > 0 && !isSearching" class="loading-more">
              <div class="spinner small"></div>
              <span>加载更多...</span>
            </div>

            <!-- 没有更多 -->
            <div v-if="!hasMore && servers.length > 0 && !isLoading" class="no-more">
              已显示全部 MCP 服务
            </div>
          </div>

          <!-- 项目配置 -->
          <div v-if="activeMarket === 'project'" class="tab-panel">
            <div class="panel-header">
              <h3>项目级 MCP 服务</h3>
              <div class="filter-group">
                <button class="filter-btn" :class="{ active: projectFilter === 'all' }" @click="projectFilter = 'all'">全部</button>
                <button class="filter-btn" :class="{ active: projectFilter === 'claude' }" @click="projectFilter = 'claude'">Claude</button>
                <button class="filter-btn" :class="{ active: projectFilter === 'codex' }" @click="projectFilter = 'codex'">Codex</button>
                <button class="filter-btn" :class="{ active: projectFilter === 'none' }" @click="projectFilter = 'none'">未安装</button>
              </div>
            </div>
            <p class="project-path-hint">{{ projectPath }}</p>
            <p v-if="projectToggleError" class="error-msg">{{ projectToggleError }}</p>

            <div v-if="filteredProjectMcps.length > 0" class="mcp-grid">
              <div
                v-for="mcp in filteredProjectMcps"
                :key="'project-' + mcp.slug"
                class="mcp-card"
                :class="{ disabled: isPluginDisabled(mcp) }"
              >
                <div class="mcp-header">
                  <span class="mcp-name">{{ mcp.title || mcp.name }}</span>
                  <div class="mcp-badges">
                    <span
                      v-if="mcp.external || mcp.source === 'registry' || mcp.plugin || mcp.sourceLabel"
                      class="source-badge"
                      :class="{ external: mcp.external, registry: mcp.source === 'registry', plugin: mcp.plugin }"
                    >
                      {{ getMcpSourceLabel(mcp) }}
                    </span>
                    <span v-if="isPluginDisabled(mcp)" class="source-badge disabled-state-badge">已禁用</span>
                    <span v-if="mcp.version" class="version-badge">v{{ mcp.version }}</span>
                  </div>
                </div>
                <p class="mcp-desc">{{ mcp.description || '暂无描述' }}</p>
                <div class="mcp-meta">
                  <div class="target-toggles">
                    <button
                      v-if="!isStaticMcp(mcp) || mcp.projectTargets?.includes('claude')"
                      class="target-toggle"
                      :class="{ active: mcp.projectTargets?.includes('claude'), static: isStaticMcp(mcp) }"
                      @click.stop="!isStaticMcp(mcp) && toggleProjectTarget(mcp, 'claude')"
                    >Claude</button>
                    <button
                      v-if="!isStaticMcp(mcp) || mcp.projectTargets?.includes('codex')"
                      class="target-toggle"
                      :class="{ active: mcp.projectTargets?.includes('codex'), static: isStaticMcp(mcp) }"
                      @click.stop="!isStaticMcp(mcp) && toggleProjectTarget(mcp, 'codex')"
                    >Codex</button>
                  </div>
                  <button v-if="mcp.projectTargets?.length" class="delete-btn" @click.stop="handleDeleteProjectMcp(mcp)" title="从项目移除">
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
                <rect x="2" y="2" width="20" height="8" rx="2" ry="2"/>
                <rect x="2" y="14" width="20" height="8" rx="2" ry="2"/>
                <line x1="6" y1="6" x2="6.01" y2="6"/>
                <line x1="6" y1="18" x2="6.01" y2="18"/>
              </svg>
              <p>暂无项目级 MCP 服务</p>
              <p class="hint">从已下载的 MCP 中安装到项目</p>
              <button class="action-btn" @click="handleMarketChange('installed')">
                查看已下载 MCP
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 底部下载状态栏 -->
      <div v-if="activeDownloads.length > 0" class="download-bar">
        <div class="btn-spinner"></div>
        <span>正在下载 {{ activeDownloads.length }} 个 MCP: {{ activeDownloads.join(', ') }}</span>
      </div>
    </div>
    <!-- Registry 详情弹窗 -->
    <div v-if="selectedServer" class="detail-overlay" @click.self="closeServerDetail">
      <div class="detail-dialog" @click.stop>
        <div class="detail-header">
          <h3>{{ selectedServer.title }}</h3>
          <button class="close-btn" @click="closeServerDetail" title="关闭">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="detail-body">
          <div class="detail-meta-row">
            <span v-if="selectedServer.version" class="detail-badge">v{{ selectedServer.version }}</span>
            <span v-for="t in selectedServer.transportTypes" :key="t" class="detail-badge transport">{{ getTransportLabel(t) }}</span>
          </div>

          <div class="detail-slug-row">
            <span class="detail-slug">{{ selectedServer.fullName }}</span>
          </div>

          <div class="detail-section">
            <h4>描述</h4>
            <p>{{ selectedServer.description || '暂无描述' }}</p>
          </div>

          <div v-if="selectedServer.remotes?.length" class="detail-section">
            <h4>远程连接</h4>
            <div v-for="r in selectedServer.remotes" :key="r.url" class="detail-endpoint">
              <span class="endpoint-type">{{ r.type }}</span>
              <code class="endpoint-url">{{ r.url }}</code>
            </div>
          </div>

          <div v-if="selectedServer.packages?.length" class="detail-section">
            <h4>安装包</h4>
            <div v-for="p in selectedServer.packages" :key="p.identifier" class="detail-endpoint">
              <span class="endpoint-type">{{ p.registryType }}</span>
              <code class="endpoint-url">{{ p.identifier }}</code>
            </div>
          </div>

          <div v-if="selectedServer.environmentVariables?.length" class="detail-section">
            <h4>需要配置</h4>
            <div class="detail-tags">
              <span v-for="ev in selectedServer.environmentVariables" :key="ev.name" class="detail-tag">
                {{ ev.name }}
                <span v-if="ev.isSecret" class="env-secret-tag">密钥</span>
              </span>
            </div>
          </div>

          <div class="detail-actions">
            <button
              v-if="getDownloadStatus(selectedServer.slug) === 'downloaded'"
              class="action-btn downloaded"
              disabled
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              已下载
            </button>
            <button
              v-else-if="getDownloadStatus(selectedServer.slug) === 'downloading'"
              class="action-btn" disabled
            >
              <div class="btn-spinner"></div>
              下载中...
            </button>
            <button
              v-else
              class="action-btn"
              @click="handleDownloadMcp(selectedServer)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              下载
            </button>

            <p v-if="downloadError" class="download-error">{{ downloadError }}</p>

            <a v-if="selectedServer.repository" :href="selectedServer.repository" target="_blank" class="action-btn secondary">
              查看源码
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

    <div v-if="envDialogMcp" class="detail-overlay" @click.self="cancelEnvDialog">
      <div class="env-dialog" @click.stop>
        <div class="detail-header">
          <h3>配置 {{ envDialogMcp.mcp.title || envDialogMcp.mcp.name }}</h3>
          <button class="close-btn" @click="cancelEnvDialog" title="关闭">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>
        <div class="detail-body">
          <p class="env-hint">此 MCP 服务需要以下配置才能正常使用：</p>
          <div class="env-fields">
            <div v-for="ev in envDialogMcp.mcp.environmentVariables" :key="ev.name" class="env-field">
              <label class="env-label">
                {{ ev.name }}
                <span v-if="ev.isSecret" class="env-secret">(密钥)</span>
              </label>
              <p v-if="ev.description" class="env-desc">{{ ev.description }}</p>
              <input
                v-model="envValues[ev.name]"
                :type="ev.isSecret ? 'password' : 'text'"
                class="env-input"
                :placeholder="ev.description || ev.name"
              />
            </div>
          </div>
          <div class="env-actions">
            <button class="confirm-btn cancel" @click="cancelEnvDialog">取消</button>
            <button class="action-btn small" @click="confirmEnvInstall">确认安装</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 删除确认框 -->
    <div v-if="mcpToDelete" class="detail-overlay" @click.self="cancelDeleteMcp">
      <div class="confirm-box" @click.stop>
        <p class="confirm-text">确认删除 MCP 服务「{{ mcpToDelete.title || mcpToDelete.name }}」？</p>
        <p class="confirm-hint">将同时从所有目标中卸载并删除配置文件</p>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" @click="cancelDeleteMcp">取消</button>
          <button class="confirm-btn danger" @click="confirmDeleteMcp">删除</button>
        </div>
      </div>
    </div>

    <!-- 项目级删除确认框 -->
    <div v-if="projectMcpToDelete" class="detail-overlay" @click.self="cancelDeleteProjectMcp">
      <div class="confirm-box" @click.stop>
        <p class="confirm-text">确认从项目中删除 MCP「{{ projectMcpToDelete.title || projectMcpToDelete.name }}」？</p>
        <p class="confirm-hint">仅从当前项目移除，不影响全局配置</p>
        <div class="confirm-actions">
          <button class="confirm-btn cancel" @click="cancelDeleteProjectMcp">取消</button>
          <button class="confirm-btn danger" @click="confirmDeleteProjectMcp">删除</button>
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

.mcp-dialog {
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

/* 左侧导航 */
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
.mcp-content {
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

/* 过滤 */
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

/* 搜索 */
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

/* MCP 卡片网格 */
.servers-grid-wrapper {
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

.mcp-grid {
  display: grid;
  grid-template-columns: 1fr;
  gap: 12px;
  padding: 0 24px 24px;
}

.mcp-card {
  background: var(--app-soft-surface);
  border: 1px solid var(--app-soft-border);
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition: border-color 0.2s, background 0.2s;
}

.mcp-card.disabled {
  border-color: rgba(249, 115, 22, 0.3);
}

.mcp-card:hover {
  border-color: rgba(249, 115, 22, 0.3);
  background: var(--app-soft-surface-hover);
}

.mcp-card.clickable {
  cursor: pointer;
}

.mcp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.mcp-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.mcp-name {
  font-size: 14px;
  font-weight: 600;
  color: #F4F4F5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mcp-card.disabled .mcp-name {
  color: rgba(244, 244, 245, 0.8);
}

.mcp-card.disabled .mcp-meta,
.mcp-card.disabled .mcp-desc {
  opacity: 0.5;
}


.version-badge {
  font-size: 11px;
  color: #71717A;
  background: rgba(255, 255, 255, 0.06);
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.downloaded-badge {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: rgba(34, 197, 94, 0.15);
  color: #22C55E;
  flex-shrink: 0;
}

.downloaded-badge.downloading {
  background: rgba(249, 115, 22, 0.15);
  animation: pulse 1.2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 0.4; }
  50% { opacity: 1; }
}

.source-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}

.source-badge.registry {
  background: rgba(59, 130, 246, 0.12);
  color: #60A5FA;
}

.source-badge.external {
  background: rgba(161, 161, 170, 0.1);
  color: #A1A1AA;
}

.source-badge.plugin {
  background: rgba(245, 158, 11, 0.14);
  color: #FBBF24;
}

.disabled-state-badge {
  color: rgba(248, 250, 252, 0.82) !important;
  background: rgba(249, 115, 22, 0.12) !important;
  border: 1px solid rgba(249, 115, 22, 0.22);
}


.mcp-desc {
  font-size: 12px;
  color: #9CA3AF;
  line-height: 1.5;
  margin: 0;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.mcp-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
}

/* 传输类型 */
.transport-badges {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
}

.transport-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  color: #71717A;
}

/* 目标安装切换 */
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

.target-toggle.codex.active {
  border-color: rgba(249, 115, 22, 0.3);
  background: rgba(249, 115, 22, 0.1);
  color: #F97316;
}

.target-toggle.static {
  cursor: default;
  opacity: 0.7;
}

/* 按钮 */
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

/* 删除按钮 */
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

.mcp-card:hover .delete-btn {
  opacity: 1;
}

.delete-btn:hover {
  color: #EF4444;
  background: rgba(239, 68, 68, 0.08);
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

.error-msg {
  margin: 0 24px 8px;
  font-size: 12px;
  color: #FCA5A5;
  background: rgba(239, 68, 68, 0.08);
  padding: 6px 10px;
  border-radius: 4px;
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

/* 详情弹窗/遮罩 */
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

/* 环境变量弹窗 */
.env-dialog {
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

.env-hint {
  margin: 0;
  font-size: 13px;
  color: #9CA3AF;
}

.env-fields {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.env-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.env-label {
  font-size: 13px;
  font-weight: 500;
  color: #E5E5E5;
}

.env-secret {
  font-size: 11px;
  color: #F97316;
}

.env-desc {
  margin: 0;
  font-size: 11px;
  color: #71717A;
}

.env-input {
  padding: 8px 12px;
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid var(--app-soft-border);
  border-radius: 6px;
  color: #F4F4F5;
  font-size: 13px;
  transition: border-color 0.2s;
}

.env-input:focus {
  outline: none;
  border-color: #F97316;
}

.env-input::placeholder {
  color: #52525B;
}

.env-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

/* 确认框 */
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

/* 详情弹窗 */
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

.detail-badge.transport {
  background: rgba(249, 115, 22, 0.08);
  color: #F97316;
}

.detail-slug-row {
  display: flex;
  align-items: center;
}

.detail-slug {
  font-size: 11px;
  color: #71717A;
  font-family: monospace;
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

.detail-endpoint {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: var(--app-soft-surface);
  border: 1px solid var(--app-soft-border);
  border-radius: 6px;
  margin-bottom: 6px;
}

.endpoint-type {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  background: rgba(249, 115, 22, 0.08);
  color: #F97316;
  flex-shrink: 0;
  font-weight: 500;
}

.endpoint-url {
  font-size: 12px;
  color: #D4D4D8;
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.env-secret-tag {
  font-size: 9px;
  color: #F97316;
  background: rgba(249, 115, 22, 0.1);
  padding: 1px 4px;
  border-radius: 2px;
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
