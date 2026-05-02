<script setup>
/**
 * EnvInfoBar - 环境信息栏组件
 * 从 ChatWindow.vue 提取的环境信息显示组件
 */
import { ref, computed } from 'vue'
import { useMessage } from '../../composables/useMessage'
import CopyButton from '../ui/CopyButton.vue'
import BaseDialog from '@/components/base/BaseDialog.vue'
import ContextUsageDetail from './ContextUsageDetail.vue'

const props = defineProps({
  envInfo: {
    type: Object,
    default: () => ({})
  },
  silentMessages: {
    type: Array,
    default: () => []
  },
  projectPath: {
    type: String,
    default: ''
  },
  permissionMode: {
    type: String,
    default: 'default'
  },
  showSidebarToggle: {
    type: Boolean,
    default: false
  },
  showCollapseToggle: {
    type: Boolean,
    default: false
  },
  isChatCollapsed: {
    type: Boolean,
    default: false
  },
  showAgentRailToggle: {
    type: Boolean,
    default: false
  },
  isAgentRailVisible: {
    type: Boolean,
    default: true
  },
  viewMode: {
    type: String,
    default: 'single'
  },
  codexUsageRefreshing: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['toggleSidebar', 'toggleCollapse', 'pidClick', 'toggleAgentRail', 'toggleViewMode', 'refreshCodexUsage'])

// 使用 useMessage composable
const { formatMcpServers, formatSkills, copiedMessageIndex, copyToClipboard } = useMessage()

// 是否显示详情
const showEnvDetail = ref(false)
const showSilentPanel = ref(false)
const showContextDetailDialog = ref(false)
const activeUsageTooltip = ref('')

// 项目名称（侧边栏折叠时显示）
const projectName = computed(() => {
  return props.projectPath?.split('/').pop() || ''
})

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

// 权限模式显示配置
const permissionModeConfig = computed(() => {
  const configs = {
    'default': { icon: '🔒', label: '默认', class: 'mode-default' },
    'acceptEdits': { icon: '✏️', label: '编辑', class: 'mode-edit' },
    'bypassPermissions': { icon: '✅', label: '全部允许', class: 'mode-bypass' },
    'plan': { icon: '📋', label: '计划', class: 'mode-plan' },
    'auto': { icon: '🔄', label: '自动', class: 'mode-auto' }
  }
  return configs[props.permissionMode] || configs['default']
})

// 处理 PID 点击
function handlePidClick() {
  emit('pidClick')
}

function handleUsageClick() {
  showContextDetailDialog.value = true
}

const providerLabel = computed(() => {
  if (props.envInfo?.provider === 'codex') return 'Codex'
  if (props.envInfo?.provider === 'claude') return 'Claude'
  return 'Runtime'
})

const runtimePid = computed(() => {
  return props.envInfo?.providerPid || null
})

const codexUsageError = computed(() => {
  const error = props.envInfo?.codex_usage_error
  if (!error || typeof error !== 'object') {
    return null
  }

  const code = typeof error.code === 'string' ? error.code.trim() : ''
  const message = typeof error.message === 'string' ? error.message.trim() : ''
  const status = Number(error.status || 0) || null

  if (!code && !message && !status) {
    return null
  }

  const label = code === 'token_expired'
    ? `token过期 ${code}`
    : `用量刷新失败 ${code || status || ''}`.trim()

  return {
    code: code || null,
    message: message || null,
    status,
    label
  }
})

const silentMessageCount = computed(() => props.silentMessages?.length || 0)

function formatCompactNumber(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num <= 0) {
    return null
  }

  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(num >= 10000000 ? 0 : 1)}m`
  }

  if (num >= 1000) {
    return `${(num / 1000).toFixed(num >= 100000 ? 0 : 1)}k`
  }

  return String(Math.round(num))
}

function formatRateLimitValue(value) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  if (typeof value === 'number') {
    return formatCompactNumber(value) || String(value)
  }

  if (typeof value === 'string') {
    return value
  }

  if (typeof value === 'object') {
    return (
      value.remaining ??
      value.remainingCount ??
      value.remainingRequests ??
      value.left ??
      value.available ??
      value.value ??
      null
    )
  }

  return null
}

function formatRateLimitReset(limit) {
  if (!limit || typeof limit !== 'object') {
    return null
  }

  const resetValue =
    limit.resetIn ??
    limit.resetsIn ??
    limit.resetAfter ??
    limit.retryAfter ??
    null

  if (typeof resetValue === 'number' && Number.isFinite(resetValue)) {
    if (resetValue >= 3600) {
      return `${Math.round(resetValue / 3600)}h`
    }
    if (resetValue >= 60) {
      return `${Math.round(resetValue / 60)}m`
    }
    return `${Math.round(resetValue)}s`
  }

  if (typeof resetValue === 'string' && resetValue.trim()) {
    return resetValue
  }

  return null
}

function formatRateLimitLabel(limit, fallback) {
  if (!limit || typeof limit !== 'object') {
    return fallback
  }

  return (
    limit.label ||
    limit.name ||
    limit.window ||
    limit.windowName ||
    limit.period ||
    fallback
  )
}

const sessionUsageSummary = computed(() => {
  const usage = props.envInfo?.session_usage
  if (!usage) {
    return null
  }

  const used = Number(usage.total_tokens || 0)
  const limit = Number(usage.model_context_window || 0)
  const usedText = formatCompactNumber(used)
  const limitText = formatCompactNumber(limit)

  if (!usedText && !limitText && !usage.compacted) {
    return null
  }

  return {
    used,
    limit,
    usedText,
    limitText,
    progress: limit > 0 ? Math.max(0, Math.min(100, Math.round((used / limit) * 100))) : null,
    compacted: !!usage.compacted,
    compactSummary: usage.compact_summary || ''
  }
})

const sessionUsageTitle = computed(() => {
  const summary = sessionUsageSummary.value
  if (!summary) {
    return ''
  }

  const parts = []
  if (summary.usedText || summary.limitText) {
    parts.push(
      `已用 ${summary.usedText || '0'}${summary.limitText ? ` / ${summary.limitText}` : ''}`
    )
  }
  if (summary.progress !== null) {
    parts.push(`占用 ${summary.progress}%`)
  }
  if (summary.compacted) {
    parts.push('已压缩')
  }
  if (summary.compactSummary) {
    parts.push(summary.compactSummary)
  }

  return parts.join('\n')
})

const rateLimitSummary = computed(() => {
  const rateLimits = props.envInfo?.rate_limits
  if (!rateLimits) {
    return null
  }

  const primaryValue = formatRateLimitValue(rateLimits.primary?.used)
  const secondaryValue = formatRateLimitValue(rateLimits.secondary?.used)
  const creditsValue = formatRateLimitValue(rateLimits.credits)

  const items = []

  if (primaryValue !== null) {
    const reset = formatRateLimitReset(rateLimits.primary)
    items.push({
      key: 'primary',
        label: formatRateLimitLabel(rateLimits.primary, '5小时'),
        value: primaryValue,
        reset
    })
  }

  if (secondaryValue !== null) {
    const reset = formatRateLimitReset(rateLimits.secondary)
    items.push({
      key: 'secondary',
        label: formatRateLimitLabel(rateLimits.secondary, '1周'),
        value: secondaryValue,
        reset
    })
  }

  if (creditsValue !== null) {
    items.push({
      key: 'credits',
      label: '额度',
      value: creditsValue,
      reset: null
    })
  }

  if (items.length === 0) {
    return null
  }

  return {
    planType: rateLimits.planType || null,
    limitName: rateLimits.limitName || null,
    items
  }
})

function formatResetAt(timestamp) {
  if (!timestamp || typeof timestamp !== 'number') return null
  const date = new Date(timestamp * 1000)
  if (isNaN(date.getTime())) return null
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  const time = date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  return `${month}-${day} ${time}`
}

const codexUsageSummary = computed(() => {
  const rateLimits = props.envInfo?.rate_limits
  if (!rateLimits) {
    return null
  }

  const primaryUsed = Number(rateLimits.primary?.used)
  const secondaryUsed = Number(rateLimits.secondary?.used)
  const candidates = [
    Number.isFinite(primaryUsed)
      ? { key: 'primary', label: '5小时', used: primaryUsed, resetAt: formatResetAt(rateLimits.primary?.resetAt) }
      : null,
    Number.isFinite(secondaryUsed)
      ? { key: 'secondary', label: '1周', used: secondaryUsed, resetAt: formatResetAt(rateLimits.secondary?.resetAt) }
      : null
  ].filter(Boolean)

  if (candidates.length === 0) {
    return null
  }

  const dominant = candidates.sort((a, b) => b.used - a.used)[0]
  return {
    dominant,
    items: candidates,
    planType: rateLimits.planType || null,
    limitName: rateLimits.limitName || null
  }
})

const codexUsageTitle = computed(() => {
  const summary = codexUsageSummary.value
  if (!summary && !codexUsageError.value) {
    return ''
  }

  const parts = []

  if (codexUsageError.value) {
    parts.push('刷新失败')
  }

  if (summary) {
    if (summary.limitName) {
      parts.push(summary.limitName)
    }
    if (summary.planType) {
      parts.push(`套餐 ${summary.planType}`)
    }
    parts.push(...summary.items
    .map(item => {
      const lineParts = [`${item.label} 已使用 ${Math.round(item.used)}%`]
      if (item.resetAt) lineParts.push(item.resetAt)
      return lineParts.join(' · ')
    }))
  }

  return parts.join('\n')
})

function showUsageTooltip(type) {
  activeUsageTooltip.value = type
}

function hideUsageTooltip(type) {
  if (activeUsageTooltip.value === type) {
    activeUsageTooltip.value = ''
  }
}

function handleRefreshCodexUsage() {
  emit('refreshCodexUsage')
}

function resolveUsageStrokeColor(percent, palette = 'default') {
  const value = Number(percent)
  if (!Number.isFinite(value)) {
    return palette === 'codex' ? 'rgba(148, 163, 184, 0.72)' : 'rgba(255, 255, 255, 0.72)'
  }

  if (value >= 90) {
    return '#EF4444'
  }

  if (value >= 80) {
    return '#F59E0B'
  }

  return palette === 'codex' ? 'rgba(148, 163, 184, 0.72)' : 'rgba(255, 255, 255, 0.72)'
}

function toggleSilentPanel() {
  showSilentPanel.value = !showSilentPanel.value
}

function getSilentMessageContent(message) {
  return JSON.stringify(message?.params ?? message, null, 2)
}

async function copySilentMessage(message, reverseIndex) {
  await copyToClipboard(getSilentMessageContent(message), reverseIndex)
}
</script>

<template>
  <div v-if="envInfo || showCollapseToggle || showSidebarToggle" class="top-bar">
    <div v-if="showSidebarToggle" class="sidebar-safe-spacer">
      <span v-if="projectName" class="sidebar-project-name" :title="projectPath">{{ projectName }}</span>
      <button class="sidebar-safe-btn" title="展开侧边栏" @click="emit('toggleSidebar')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10 6l6 6-6 6"></path>
          <path d="M4 5v14"></path>
        </svg>
      </button>
    </div>

    <button
      v-if="showCollapseToggle"
      class="collapse-chat-btn"
      :title="isChatCollapsed ? '展开聊天区' : '隐藏聊天区'"
      @click="emit('toggleCollapse')"
    >
      <svg v-if="!isChatCollapsed" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M10 6l6 6-6 6"></path>
        <path d="M4 5v14"></path>
      </svg>
      <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M14 6l-6 6 6 6"></path>
        <path d="M20 5v14"></path>
      </svg>
    </button>

    <!-- 环境信息栏 -->
    <div v-if="envInfo" class="env-bar" :class="{ 'with-collapse-btn': showCollapseToggle }">
      <div class="env-main">
        <div class="env-left">
          <span class="env-item env-item-clickable" @click="handlePidClick" :title="runtimePid ? `点击关闭 ${providerLabel}` : `点击启动 ${providerLabel}`">
            <span class="env-icon">⚙️</span>
            <span class="env-label">{{ runtimePid || '未启动' }}</span>
          </span>
          <span v-if="envInfo.provider" class="env-item">
            <span class="env-icon">🧠</span>
            <span class="env-label">{{ providerLabel }}</span>
          </span>
          <span v-if="envInfo.session_id" class="env-item">
            <span class="env-icon">🔗</span>
            <span class="env-label">{{ envInfo.session_id?.substring(0, 8) }}</span>
          </span>
          <span v-if="isDifferentFromProject" class="env-item env-item-highlight">
            <span class="env-icon">📁</span>
            <span class="env-label">{{ envInfo.cwd?.split('/').pop() || envInfo.cwd }}</span>
          </span>
          <span v-if="envInfo.model" class="env-item">
            <span class="env-icon">🤖</span>
            <span class="env-label">{{ envInfo.model }}</span>
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
          <button v-if="silentMessageCount > 0" class="env-item env-silent-btn" @click="toggleSilentPanel" :title="`查看 ${silentMessageCount} 条沉没消息`">
            <span class="env-icon">🫥</span>
            <span class="env-label">{{ silentMessageCount }}</span>
          </button>
        </div>

        <div class="env-right">
          <span
            v-if="sessionUsageSummary"
            class="env-item env-item-usage env-item-usage-clickable"
            @click="handleUsageClick"
            @mouseenter="showUsageTooltip('session')"
            @mouseleave="hideUsageTooltip('session')"
          >
            <span class="env-progress-ring" aria-hidden="true">
              <svg viewBox="0 0 20 20">
                <circle class="env-progress-track" cx="10" cy="10" r="7"></circle>
                <circle
                  class="env-progress-value"
                  cx="10"
                  cy="10"
                  r="7"
                  :style="{ stroke: resolveUsageStrokeColor(sessionUsageSummary.progress, 'default') }"
                  :stroke-dasharray="2 * Math.PI * 7"
                  :stroke-dashoffset="2 * Math.PI * 7 * (1 - (sessionUsageSummary.progress || 0) / 100)"
                ></circle>
              </svg>
            </span>
            <span v-if="activeUsageTooltip === 'session'" class="env-usage-tooltip">
              <span class="env-usage-tooltip-title">上下文用量</span>
              <span v-if="sessionUsageSummary.usedText || sessionUsageSummary.limitText" class="env-usage-tooltip-line">
                已用 {{ sessionUsageSummary.usedText || '0' }}
                <template v-if="sessionUsageSummary.limitText">
                  / {{ sessionUsageSummary.limitText }}
                </template>
              </span>
              <span v-if="sessionUsageSummary.progress !== null" class="env-usage-tooltip-line">
                占用 {{ sessionUsageSummary.progress }}%
              </span>
              <span v-if="sessionUsageSummary.compacted" class="env-usage-tooltip-line env-usage-tooltip-warn">
                已压缩
              </span>
              <span v-if="sessionUsageSummary.compactSummary" class="env-usage-tooltip-line env-usage-tooltip-summary">
                {{ sessionUsageSummary.compactSummary }}
              </span>
            </span>
          </span>
          <button
            v-if="codexUsageSummary || codexUsageError"
            type="button"
            class="env-item env-item-usage env-item-codex-usage env-item-codex-usage-button"
            :class="{ refreshing: codexUsageRefreshing }"
            :disabled="codexUsageRefreshing"
            :title="codexUsageRefreshing ? '正在刷新 Codex 账号用量' : '点击刷新 Codex 账号用量'"
            @click="handleRefreshCodexUsage"
            @mouseenter="showUsageTooltip('codex')"
            @mouseleave="hideUsageTooltip('codex')"
          >
            <span class="env-progress-ring env-progress-ring-codex" aria-hidden="true">
              <svg viewBox="0 0 20 20">
                <circle class="env-progress-track" cx="10" cy="10" r="7"></circle>
                <circle
                  class="env-progress-value env-progress-value-codex"
                  cx="10"
                  cy="10"
                  r="7"
                  :style="{ stroke: resolveUsageStrokeColor(codexUsageSummary?.dominant?.used, 'codex') }"
                  :stroke-dasharray="2 * Math.PI * 7"
                  :stroke-dashoffset="2 * Math.PI * 7 * (1 - ((codexUsageSummary?.dominant?.used || 0) / 100))"
                ></circle>
              </svg>
            </span>
            <span v-if="codexUsageError" class="env-usage-error-dot" aria-hidden="true">!</span>
            <span v-if="activeUsageTooltip === 'codex'" class="env-usage-tooltip">
              <span class="env-usage-tooltip-title">Codex 账号用量</span>
              <span v-if="codexUsageRefreshing" class="env-usage-tooltip-line env-usage-tooltip-summary">
                正在刷新...
              </span>
              <span v-if="codexUsageError" class="env-usage-tooltip-line env-usage-tooltip-warn">
                刷新失败
              </span>
              <span v-if="codexUsageSummary?.limitName" class="env-usage-tooltip-line">
                {{ codexUsageSummary.limitName }}
              </span>
              <span v-if="codexUsageSummary?.planType" class="env-usage-tooltip-line">
                套餐 {{ codexUsageSummary.planType }}
              </span>
              <span
                v-if="codexUsageSummary"
                v-for="item in codexUsageSummary.items"
                :key="item.key"
                class="env-usage-tooltip-line env-usage-tooltip-line-multiline"
              >
                <span>{{ item.label }} 已使用 {{ Math.round(item.used) }}%</span>
                <span v-if="item.resetAt" class="env-usage-tooltip-summary env-usage-tooltip-reset">{{ item.resetAt }}</span>
              </span>
            </span>
          </button>
          <button class="env-detail-btn" @click="showEnvDetail = !showEnvDetail">
            {{ showEnvDetail ? '收起' : '详情' }}
          </button>
          <div v-if="showAgentRailToggle" class="env-view-mode-toggle">
            <button
              class="env-view-mode-btn"
              :class="{ active: viewMode === 'single' }"
              type="button"
              title="单视图"
              aria-label="单视图"
              @click="emit('toggleViewMode', 'single')"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="2.5" y="3" width="11" height="10" rx="2" stroke="currentColor" stroke-width="1.4" />
                <path d="M5 6H11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
                <path d="M5 8.5H11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
              </svg>
            </button>
            <button
              class="env-view-mode-btn"
              :class="{ active: viewMode === 'split' }"
              type="button"
              title="分屏"
              aria-label="分屏"
              @click="emit('toggleViewMode', 'split')"
            >
              <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                <rect x="2.5" y="3" width="11" height="10" rx="2" stroke="currentColor" stroke-width="1.4" />
                <path d="M8 3.8V12.2" stroke="currentColor" stroke-width="1.2" />
              </svg>
            </button>
          </div>
          <button
            v-if="showAgentRailToggle"
            class="env-detail-btn env-detail-btn--icon"
            @click="emit('toggleAgentRail')"
            :title="isAgentRailVisible ? '隐藏团队' : '显示团队'"
          >
            <svg
              class="env-detail-btn__icon"
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              aria-hidden="true"
            >
              <rect
                x="1.5"
                y="2"
                width="9"
                height="8"
                rx="2"
                stroke="currentColor"
                stroke-width="1.2"
              />
              <path
                v-if="isAgentRailVisible"
                d="M8 2V10"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>
      </div>

      <div v-if="showSilentPanel" class="silent-detail-dropdown">
        <div class="silent-panel-header">
          <span>沉没消息</span>
          <span class="silent-count">{{ silentMessageCount }}</span>
        </div>
        <div v-if="!silentMessages.length" class="silent-empty">暂无沉没消息</div>
        <div v-else class="silent-list">
          <div v-for="(message, reverseIndex) in silentMessages.slice().reverse()" :key="message.id" class="silent-item">
            <div class="silent-item-header">
              <span class="silent-type">{{ message.messageType }}</span>
              <span class="silent-time">{{ new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) }}</span>
            </div>
            <div class="silent-content-wrap">
              <CopyButton
                :is-copied="copiedMessageIndex === reverseIndex"
                title="复制消息体"
                @copy="copySilentMessage(message, reverseIndex)"
              />
              <pre class="silent-content">{{ getSilentMessageContent(message) }}</pre>
            </div>
          </div>
        </div>
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
        <div v-if="codexUsageError" class="env-detail-row">
          <span class="env-detail-label">账号状态</span>
          <span class="env-detail-value env-detail-value-error">
            刷新失败
            <span v-if="codexUsageError.message"> · {{ codexUsageError.message }}</span>
          </span>
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

    <BaseDialog
      v-model="showContextDetailDialog"
      title="上下文用量"
      width="640px"
    >
      <ContextUsageDetail :usage="envInfo?.session_usage" />
    </BaseDialog>
  </div>
</template>

<style scoped>
.top-bar {
  display: flex;
  align-items: stretch;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--bg-tertiary);
  -webkit-app-region: drag;
  position: relative;
  z-index: 120;
}

.sidebar-safe-spacer {
  width: 200px;
  flex: 0 0 200px;
  display: flex;
  align-items: stretch;
  justify-content: flex-end;
  background: #17191E;
  border-right: 1px solid var(--bg-tertiary);
  -webkit-app-region: drag;
}

.sidebar-project-name {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  padding: 0 4px 0 76px;
  font-size: 18px;
  font-weight: 600;
  color: rgba(228, 228, 231, 0.5);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  -webkit-app-region: drag;
}

.sidebar-safe-btn {
  width: 43px;
  height: 41.5px;
  padding: 0;
  border: none;
  background: #17191E;
  color: #E4E4E7;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background var(--transition-fast);
  -webkit-app-region: no-drag;
}

.sidebar-safe-btn:hover {
  background: #23262D;
}

.collapse-chat-btn {
  width: 42px;
  height: 41.5px;
  padding: 0;
  border: none;
  background: #17191E;
  color: #E4E4E7;
  display: flex;
  align-items: center;
  justify-content: center;
  border-right: 1px solid var(--bg-tertiary);
  cursor: pointer;
  transition: background var(--transition-fast);
  -webkit-app-region: no-drag;
  flex-shrink: 0;
}

.collapse-chat-btn:hover {
  background: #23262D;
}

.env-bar {
  flex: 1;
  position: relative;
  background: transparent;
  padding: 9.25px 16px;
  font-size: var(--font-size-sm);
  cursor: move;
  z-index: 121;
}

.env-bar.with-collapse-btn {
  padding-left: 8px;
}

.env-main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.env-left,
.env-right {
  display: flex;
  align-items: center;
  gap: 16px;
  min-width: 0;
}

.env-left {
  flex: 1;
  overflow: hidden;
}

.env-right {
  flex-shrink: 0;
}

.env-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: var(--text-muted);
}

.env-item-usage,
.env-item-rate {
  padding: 2px 10px;
  border-radius: 999px;
  background: rgba(244, 114, 54, 0.1);
}

.env-item-rate {
  background: rgba(59, 130, 246, 0.1);
}

.env-item-usage {
  position: relative;
  padding: 4px;
  background: transparent;
  -webkit-app-region: no-drag;
  cursor: default;
}

.env-item-usage-clickable {
  cursor: pointer;
  border-radius: 4px;
}

.env-item-usage-clickable:hover {
  background: rgba(255, 255, 255, 0.06);
}

.env-item-codex-usage {
  margin-left: 2px;
}

.env-item-codex-usage-button {
  border: none;
  font: inherit;
  position: relative;
}

.env-item-codex-usage-button.refreshing {
  opacity: 0.72;
  cursor: wait;
}

.env-usage-error-dot {
  position: absolute;
  top: -1px;
  right: -1px;
  width: 10px;
  height: 10px;
  border-radius: 999px;
  background: #ef4444;
  color: #fff;
  font-size: 8px;
  font-weight: 700;
  line-height: 10px;
  text-align: center;
  box-shadow: 0 0 0 2px rgba(18, 18, 20, 0.98);
}

.env-silent-btn {
  border: none;
  border-radius: 999px;
  padding: 2px 10px;
  background: rgba(244, 114, 182, 0.12);
  color: #F9A8D4;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.env-silent-btn:hover {
  background: rgba(244, 114, 182, 0.2);
}

.env-icon {
  font-size: var(--font-size-sm);
}

.env-label {
  color: var(--text-secondary);
  font-family: var(--font-family-mono);
  white-space: nowrap;
}

.env-usage-flag {
  margin-left: 8px;
  color: #F59E0B;
}

.env-progress-ring {
  width: 16px;
  height: 16px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: default;
  pointer-events: none;
}

.env-progress-ring svg {
  width: 16px;
  height: 16px;
  transform: rotate(-90deg);
  cursor: default;
  pointer-events: none;
}

.env-progress-track,
.env-progress-value {
  fill: none;
  stroke-width: 2;
}

.env-progress-track {
  stroke: rgba(255, 255, 255, 0.22);
}

.env-progress-value {
  stroke: rgba(255, 255, 255, 0.96);
  stroke-linecap: round;
  transition: stroke-dashoffset 160ms ease;
}

.env-progress-ring-codex .env-progress-track {
  stroke: rgba(148, 163, 184, 0.2);
}

.env-progress-value-codex {
  stroke: #94A3B8;
}

.env-usage-tooltip {
  position: absolute;
  top: calc(100% + 10px);
  right: 0;
  min-width: 160px;
  max-width: 260px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  padding: 10px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(18, 18, 20, 0.98);
  box-shadow: 0 16px 32px rgba(0, 0, 0, 0.35);
  color: #F4F4F5;
  z-index: 40;
  white-space: normal;
  text-align: left;
  -webkit-app-region: no-drag;
  pointer-events: none;
}

.env-usage-tooltip-title {
  font-size: 12px;
  font-weight: 600;
  color: #FAFAFA;
}

.env-usage-tooltip-line {
  font-size: 12px;
  line-height: 1.45;
  color: #D4D4D8;
}

.env-usage-tooltip-line-multiline {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.env-usage-tooltip-warn {
  color: #FBBF24;
}

.env-usage-tooltip-summary {
  color: #A1A1AA;
}

.env-usage-tooltip-reset {
  padding-left: 0;
}

.env-rate-part + .env-rate-part {
  margin-left: 10px;
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

.env-item-error {
  background: rgba(239, 68, 68, 0.14);
  border-color: rgba(248, 113, 113, 0.4);
}

.env-item-error .env-label {
  color: #FCA5A5;
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

.silent-detail-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 12px;
  width: min(560px, calc(100vw - 32px));
  max-height: 420px;
  overflow: hidden;
  background: #18181B;
  border: 1px solid #3F3F46;
  border-radius: 12px;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.45);
  z-index: 140;
  -webkit-app-region: no-drag;
}

.silent-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  border-bottom: 1px solid #27272A;
  font-size: 13px;
  font-weight: 600;
  color: #F4F4F5;
}

.silent-count {
  color: #F9A8D4;
}

.silent-empty {
  padding: 16px 14px;
  color: #A1A1AA;
  font-size: 13px;
}

.silent-list {
  max-height: 360px;
  overflow: auto;
  padding: 10px;
}

.silent-item {
  border: 1px solid #27272A;
  border-radius: 10px;
  background: #111113;
  padding: 10px;
}

.silent-item + .silent-item {
  margin-top: 10px;
}

.silent-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 8px;
}

.silent-type {
  font-size: 12px;
  color: #F9A8D4;
  font-weight: 600;
}

.silent-time {
  font-size: 11px;
  color: #71717A;
}

.silent-content {
  margin: 0;
  white-space: pre-wrap;
  word-break: break-word;
  font-size: 11px;
  line-height: 1.5;
  color: #D4D4D8;
  font-family: var(--font-family-mono);
}

.silent-content-wrap {
  position: relative;
}

.silent-content-wrap :deep(.copy-btn) {
  position: absolute;
  top: 6px;
  right: 6px;
  opacity: 0;
  transition: opacity 0.15s;
}

.silent-content-wrap:hover :deep(.copy-btn) {
  opacity: 1;
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

/* 权限模式样式 */
.mode-bypass {
  background: rgba(34, 197, 94, 0.15);
  border: 1px solid rgba(34, 197, 94, 0.4);
  border-radius: var(--radius-sm);
  padding: 2px 8px;
  margin: -2px -8px;
}

.mode-bypass .env-label {
  color: #22c55e;
  font-weight: var(--font-weight-medium);
}

.mode-plan {
  background: rgba(59, 130, 246, 0.15);
  border: 1px solid rgba(59, 130, 246, 0.4);
  border-radius: var(--radius-sm);
  padding: 2px 8px;
  margin: -2px -8px;
}

.mode-plan .env-label {
  color: #3b82f6;
  font-weight: var(--font-weight-medium);
}

.mode-auto {
  background: rgba(168, 85, 247, 0.15);
  border: 1px solid rgba(168, 85, 247, 0.4);
  border-radius: var(--radius-sm);
  padding: 2px 8px;
  margin: -2px -8px;
}

.mode-auto .env-label {
  color: #a855f7;
  font-weight: var(--font-weight-medium);
}

.env-detail-btn {
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

.env-view-mode-toggle {
  display: inline-flex;
  align-items: center;
  gap: 1px;
  padding: 2px;
  background: rgba(39, 39, 42, 0.6);
  border: 1px solid rgba(63, 63, 70, 0.6);
  border-radius: 6px;
  -webkit-app-region: no-drag;
}

.env-view-mode-btn {
  width: 22px;
  height: 20px;
  padding: 0;
  border: none;
  background: transparent;
  color: #71717a;
  border-radius: 4px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
}

.env-view-mode-btn:hover {
  color: #d4d4d8;
  background: rgba(255, 255, 255, 0.06);
}

.env-view-mode-btn.active {
  color: #18181b;
  background: #f59e0b;
}

.env-detail-btn--icon {
  width: 24px;
  height: 24px;
  padding: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.env-detail-btn__icon {
  display: block;
  flex-shrink: 0;
}

.env-detail-dropdown {
  position: absolute;
  top: 100%;
  left: 0;
  right: 0;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--bg-tertiary);
  padding: var(--spacing-md) var(--spacing-lg);
  z-index: 140;
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

.env-detail-value-error {
  color: #FCA5A5;
}
</style>
