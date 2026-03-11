<script setup>
/**
 * EnvInfoBar - 环境信息栏组件
 * 从 ChatWindow.vue 提取的环境信息显示组件
 */
import { ref, computed } from 'vue'
import { useMessage } from '../composables/useMessage'

const props = defineProps({
  envInfo: {
    type: Object,
    default: () => ({})
  },
  projectPath: {
    type: String,
    default: ''
  },
  sidebarCollapsed: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['toggleSidebar', 'pidClick'])

// 使用 useMessage composable
const { formatMcpServers, formatSkills } = useMessage()

// 是否显示详情
const showEnvDetail = ref(false)

// 检查工作目录是否与项目路径一致
const isDifferentFromProject = computed(() => {
  const cwd = props.envInfo?.cwd
  const projectPath = props.projectPath
  if (!cwd || !projectPath) return false
  return cwd !== projectPath
})

// 统计 MCP 服务器状态
const mcpStatusSummary = computed(() => {
  const servers = props.envInfo?.mcp_servers
  if (!servers || !Array.isArray(servers) || servers.length === 0) {
    return null
  }

  const connected = servers.filter(s => s.status?.toLowerCase() === 'connected').length
  const failed = servers.filter(s => ['failed', 'error'].includes(s.status?.toLowerCase())).length
  const other = servers.length - connected - failed

  return {
    total: servers.length,
    connected,
    failed,
    other
  }
})

// 处理 PID 点击
function handlePidClick() {
  emit('pidClick')
}
</script>

<template>
  <div v-if="envInfo || sidebarCollapsed" class="top-bar" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
    <!-- 展开按钮 (当侧边栏折叠时) -->
    <button
      v-if="sidebarCollapsed"
      class="expand-btn-top"
      @click="emit('toggleSidebar')"
      title="展开侧边栏"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>

    <!-- 环境信息栏 -->
    <div v-if="envInfo" class="env-bar" :class="{ 'with-expand-btn': sidebarCollapsed }">
      <div class="env-main">
        <span class="env-item env-item-clickable" @click="handlePidClick" :title="envInfo.claudePid ? '点击关闭 Claude' : '点击启动 Claude'">
          <span class="env-icon">⚙️</span>
          <span class="env-label">{{ envInfo.claudePid || '未启动' }}</span>
        </span>
        <span v-if="isDifferentFromProject" class="env-item env-item-highlight">
          <span class="env-icon">📁</span>
          <span class="env-label">{{ envInfo.cwd?.split('/').pop() || envInfo.cwd }}</span>
        </span>
        <span v-if="envInfo.model" class="env-item">
          <span class="env-icon">🤖</span>
          <span class="env-label">{{ envInfo.model }}</span>
        </span>
        <span v-if="envInfo.session_id" class="env-item">
          <span class="env-icon">🔗</span>
          <span class="env-label">{{ envInfo.session_id?.substring(0, 8) }}</span>
        </span>
        <span v-if="envInfo.tools?.length" class="env-item">
          <span class="env-icon">🔧</span>
          <span class="env-label">{{ envInfo.tools.length }} 工具</span>
        </span>
        <span v-if="envInfo.skills?.length" class="env-item">
          <span class="env-icon">⚡</span>
          <span class="env-label">{{ envInfo.skills.length }} 技能</span>
        </span>
        <span v-if="envInfo.mcp_servers?.length" class="env-item">
          <span class="env-icon">🔌</span>
          <span class="env-label">
            {{ envInfo.mcp_servers.length }} MCP
            <span v-if="mcpStatusSummary" class="mcp-status-summary">
              <span v-if="mcpStatusSummary.connected > 0" class="mcp-status-ok">{{ mcpStatusSummary.connected }}✓</span>
              <span v-if="mcpStatusSummary.failed > 0" class="mcp-status-fail">{{ mcpStatusSummary.failed }}✗</span>
            </span>
          </span>
        </span>
        <button class="env-detail-btn" @click="showEnvDetail = !showEnvDetail">
          {{ showEnvDetail ? '收起' : '详情' }}
        </button>
      </div>

      <!-- 浮动详情面板 -->
      <div v-if="showEnvDetail" class="env-detail-dropdown">
        <div class="env-detail-row">
          <span class="env-detail-label">工作目录</span>
          <span class="env-detail-value" :class="{ 'highlight-value': isDifferentFromProject }">{{ envInfo.cwd }}</span>
        </div>
        <div v-if="envInfo.model" class="env-detail-row">
          <span class="env-detail-label">模型</span>
          <span class="env-detail-value">{{ envInfo.model }}</span>
        </div>
        <div v-if="envInfo.session_id" class="env-detail-row">
          <span class="env-detail-label">会话 ID</span>
          <span class="env-detail-value">{{ envInfo.session_id }}</span>
        </div>
        <div v-if="envInfo.plugins?.length" class="env-detail-row">
          <span class="env-detail-label">插件</span>
          <span class="env-detail-value tools-list">{{ envInfo.plugins.join(', ') }}</span>
        </div>
        <div v-if="envInfo.mcp_servers?.length" class="env-detail-row">
          <span class="env-detail-label">MCP</span>
          <span class="env-detail-value tools-list">{{ formatMcpServers(envInfo.mcp_servers) }}</span>
        </div>
        <div v-if="envInfo.skills?.length" class="env-detail-row">
          <span class="env-detail-label">技能</span>
          <span class="env-detail-value tools-list">{{ formatSkills(envInfo.skills) }}</span>
        </div>
        <div v-if="envInfo.tools?.length" class="env-detail-row env-tools">
          <span class="env-detail-label">工具</span>
          <span class="env-detail-value tools-list">{{ envInfo.tools.join(', ') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.top-bar {
  display: flex;
  align-items: stretch;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--bg-tertiary);
  -webkit-app-region: drag;
}

.top-bar.sidebar-collapsed {
  padding-left: 80px;
}

.expand-btn-top {
  padding: 4px;
  background: transparent;
  border: none;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  align-self: center;
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid var(--bg-tertiary);
  cursor: pointer;
  transition: all var(--transition-fast);
  -webkit-app-region: no-drag;
  flex-shrink: 0;
}

.expand-btn-top:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.env-bar {
  flex: 1;
  position: relative;
  background: transparent;
  padding: 9.25px 16px;
  font-size: var(--font-size-sm);
  cursor: move;
}

.env-bar.with-expand-btn {
  padding-left: 8px;
}

.env-main {
  display: flex;
  align-items: center;
  gap: 16px;
}

.env-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
}

.env-icon {
  font-size: var(--font-size-sm);
}

.env-label {
  color: var(--text-secondary);
  font-family: var(--font-family-mono);
}

.env-item-highlight {
  background: rgba(251, 191, 36, 0.15);
  border: 1px solid rgba(251, 191, 36, 0.4);
  border-radius: var(--radius-sm);
  padding: 2px 8px;
  margin: -2px -8px;
}

.env-item-highlight .env-label {
  color: #FCD34D;
  font-weight: var(--font-weight-medium);
}

.env-item-clickable {
  cursor: pointer;
  transition: all var(--transition-fast);
  border-radius: var(--radius-sm);
  padding: 2px 8px;
  margin: -2px -8px;
  -webkit-app-region: no-drag;
}

.env-item-clickable:hover {
  background: rgba(255, 255, 255, 0.1);
}

.env-item-clickable:active {
  background: rgba(255, 255, 255, 0.15);
}

.mcp-status-summary {
  margin-left: 6px;
  font-size: var(--font-size-xs);
}

.mcp-status-ok {
  color: var(--color-success);
  margin-right: 4px;
}

.mcp-status-fail {
  color: var(--color-error);
  margin-right: 4px;
}

.env-detail-btn {
  margin-left: auto;
  background: var(--bg-tertiary);
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 4px 12px;
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
  transition: all var(--transition-fast);
  -webkit-app-region: no-drag;
}

.env-detail-btn:hover {
  background: var(--bg-hover);
  color: var(--text-secondary);
}

.env-detail-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--bg-tertiary);
  padding: var(--spacing-md) var(--spacing-lg);
  z-index: var(--z-dropdown);
  -webkit-app-region: no-drag;
  cursor: default;
}

.env-detail-row {
  display: flex;
  gap: var(--spacing-md);
  margin-bottom: 6px;
}

.env-detail-row:last-child {
  margin-bottom: 0;
}

.env-detail-label {
  color: var(--border-light);
  min-width: 60px;
  flex-shrink: 0;
}

.env-detail-value {
  color: var(--text-secondary);
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  word-break: break-all;
  cursor: text;
}

.env-detail-value.tools-list {
  line-height: 1.6;
}

.env-detail-value.highlight-value {
  color: #FCD34D;
  background: rgba(251, 191, 36, 0.1);
  padding: 2px 6px;
  border-radius: 3px;
}
</style>
