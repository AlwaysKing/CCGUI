<script setup>
/**
 * SystemNotificationMessage - 系统通知消息组件
 * 显示权限模式切换、快速模式切换、上下文压缩等系统通知
 * 居中显示，不同类型使用不同颜色
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  }
})

const now = ref(Date.now())
let timer = null

onMounted(() => {
  timer = setInterval(() => {
    now.value = Date.now()
  }, 200)
})

onUnmounted(() => {
  if (timer) {
    clearInterval(timer)
    timer = null
  }
})

// 格式化时间
const formattedTime = computed(() => {
  if (!props.message.timestamp) return ''
  const date = new Date(props.message.timestamp)
  return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
})

// 根据通知类型返回样式类
const notificationTypeClass = computed(() => {
  const { notificationType } = props.message
  if (
    notificationType === 'runtime-exit' ||
    notificationType === 'turn-error' ||
    notificationType === 'mcp-server-error' ||
    (notificationType === 'account-login-completed' && props.message.data?.success === false) ||
    (notificationType === 'hook-event' && props.message.data?.errorMessage)
  ) {
    return 'notification-error'
  }
  if (
    notificationType === 'runtime-stopped' ||
    notificationType === 'session-runtime-ready' ||
    notificationType === 'session-config-applied' ||
    notificationType === 'session-effort-changed' ||
    (notificationType === 'account-login-completed' && props.message.data?.success === true)
  ) {
    return 'notification-success'
  }
  if (
    notificationType === 'mcp-server-starting' ||
    notificationType === 'mcp-server-ready'
  ) {
    return 'notification-mcp'
  }
  return 'notification-warning'
})

// 通知内容
const notificationContent = computed(() => {
  const { notificationType, data } = props.message
  const providerLabel = data?.provider === 'codex' ? 'Codex' : 'Claude'
  const effortLabelMap = {
    low: '低',
    medium: '中',
    high: '高',
    xhigh: '超高'
  }
  const changeTypeLabelMap = {
    model: '模型供应商',
    submodel: '模型',
    effort: '思考力度'
  }
  const elapsedMs = Number.isFinite(data?.durationMs)
    ? data.durationMs
    : (data?.startedAt ? Math.max(0, now.value - data.startedAt) : null)
  const elapsedText = elapsedMs !== null
    ? `${(elapsedMs / 1000).toFixed(elapsedMs >= 10000 ? 0 : 1)} 秒`
    : ''

  if (notificationType === 'permission-mode-change') {
    const modeNames = {
      'default': '默认模式',
      'acceptEdits': '自动接受编辑',
      'bypassPermissions': '绕过权限确认',
      'plan': '计划模式'
    }
    const source = data.source || 'auto' // 'manual' 或 'auto'
    const pending = data.pending // 是否待生效

    const sourceLabel = source === 'manual' ? '手动切换' : '自动切换'

    let description = `已切换到: ${modeNames[data.permissionMode] || data.permissionMode}`
    if (pending) {
        description += ' (将在运行时启动时生效)'
    }

    return {
      icon: '🔐',
      title: `权限模式切换 [${sourceLabel}]`,
      description: description
    }
  }

  if (notificationType === 'fast-mode-change') {
    const stateNames = {
      'off': '关闭',
      'auto': '自动',
      'on': '开启'
    }
    return {
      icon: '⚡',
      title: '快速模式',
      description: `快速模式: ${stateNames[data.fastModeState] || data.fastModeState}`
    }
  }

  if (notificationType === 'compact-boundary') {
    const metadata = data.compactMetadata || {}
    const summary = data.compactSummary || {}
    const preTokens = metadata.pre_tokens || metadata.preTokens
    const trigger = metadata.trigger || 'auto'

    let description = '上下文已压缩'
    if (preTokens) {
      description += ` (压缩前: ${(preTokens / 1000).toFixed(1)}k tokens)`
    }
    if (summary.value) {
      description += `\n${summary.value}`
    }

    return {
      icon: '📦',
      title: '上下文压缩',
      description: description
    }
  }

  if (notificationType === 'context_compacted') {
    const summary = data.summary || data.metadata?.summary || data.metadata?.compactSummary || ''
    return {
      icon: '📦',
      title: '上下文已压缩',
      description: summary || '已完成上下文压缩'
    }
  }

  if (notificationType === 'model-rerouted') {
    const from = data.requestedModel || '原始模型'
    const to = data.reroutedModel || '实际模型'
    return {
      icon: '🔀',
      title: '模型已切换',
      description: `${from} -> ${to}`
    }
  }

  if (notificationType === 'thread-event') {
    const event = data.event || 'updated'
    const name = data.threadName ? `“${data.threadName}”` : '当前线程'
    const descriptions = {
      'name-updated': `${name}名称已更新`,
      'archived': `${name}已归档`,
      'unarchived': `${name}已恢复`,
      'rolled-back': '线程已回滚到较早状态',
      'undo-completed': '最近一次撤销已完成'
    }

    return {
      icon: '🧵',
      title: '会话线程更新',
      description: descriptions[event] || `线程事件: ${event}`
    }
  }

  if (notificationType === 'turn-plan-updated') {
    const steps = Array.isArray(data.plan) ? data.plan : []
    const completed = steps.filter(step => step?.status === 'completed').length
    const total = steps.length
    const explanation = typeof data.explanation === 'string' ? data.explanation.trim() : ''
    let description = total > 0
      ? `计划已更新: ${completed}/${total} 步完成`
      : '计划已更新'
    if (explanation) {
      description += `\n${explanation}`
    }

    return {
      icon: '🗂',
      title: '执行计划已更新',
      description
    }
  }

  if (notificationType === 'provider-config-warning') {
    const title = data.title || '配置警告'
    const path = data.path ? `\n位置: ${data.path}` : ''
    return {
      icon: '⚙️',
      title,
      description: `${data.message || '检测到配置问题'}${path}`
    }
  }

  if (notificationType === 'provider-deprecation') {
    return {
      icon: '🕰️',
      title: data.title || '配置项已弃用',
      description: data.message || '当前配置项即将不再支持'
    }
  }

  if (notificationType === 'account-login-completed') {
    if (data.success) {
      return {
        icon: '🔓',
        title: `${providerLabel} 登录完成`,
        description: '账号状态已更新'
      }
    }

    const errorText = data.error?.message || data.error || '登录失败'
    return {
      icon: '🔒',
      title: `${providerLabel} 登录失败`,
      description: String(errorText)
    }
  }

  if (notificationType === 'hook-event') {
    const hookName = data.hookName || 'Hook'
    if (data.event === 'started') {
      return {
        icon: '🪝',
        title: `${hookName} 已启动`,
        description: '后台钩子正在运行'
      }
    }

    if (data.errorMessage) {
      return {
        icon: '🪝',
        title: `${hookName} 执行失败`,
        description: data.errorMessage
      }
    }

    return {
      icon: '🪝',
      title: `${hookName} 已完成`,
      description: data.status || '后台钩子已完成'
    }
  }

  if (notificationType === 'turn-interrupted') {
    return {
      icon: '✋',
      title: '主动中断响应',
      description: '已中断当前响应'
    }
  }

  if (notificationType === 'provider-message' || notificationType === 'provider-system-message') {
    const label = data.subtype || data.messageType || 'unknown'
    return {
      icon: '🔔',
      title: `${providerLabel} 兼容消息`,
      description: `收到尚未单独建模的 provider 事件: ${label}`
    }
  }

  if (notificationType === 'runtime-exit') {
    const exitInfo = data.message || `退出码: ${data.code}`
    return {
      icon: '⏹',
      title: '运行时进程已结束',
      description: exitInfo
    }
  }

  if (notificationType === 'runtime-stopped') {
    if (data.reason === 'restart-for-config') {
      return {
        icon: '🔄',
        title: `${providerLabel} 正在重新启动`,
        description: `${providerLabel} 正在重新启动以应用新配置`
      }
    }

    return {
      icon: '⏸',
      title: `${providerLabel} 已停止运行`,
      description: data.message || `${providerLabel} 已停止运行`
    }
  }

  if (notificationType === 'session-runtime-starting') {
    return {
      icon: '🚀',
      title: `${providerLabel} 正在启动`,
      description: elapsedText ? `正在启动中，已用时 ${elapsedText}` : '正在启动中'
    }
  }

  if (notificationType === 'session-runtime-restarting') {
    return {
      icon: '🔄',
      title: `${providerLabel} 正在重启`,
      description: elapsedText ? `正在重启以应用新配置，已用时 ${elapsedText}` : '正在重启以应用新配置'
    }
  }

  if (notificationType === 'session-runtime-ready') {
    const modelText = data.model || '系统'
    const subModelText = data.subModel || '默认'
    const effortText = effortLabelMap[data.effort] || data.effort || '默认'
    return {
      icon: '✅',
      title: `${providerLabel} 启动完成`,
      description: `模型供应商: ${modelText} 模型: ${subModelText} 思考力度: ${effortText}${elapsedText ? ` 耗时: ${elapsedText}` : ''}`
    }
  }

  if (notificationType === 'mcp-server-starting') {
    const serverName = data.name || 'MCP Server'
    return {
      icon: '🧩',
      title: `${serverName} 启动中`,
      description: elapsedText ? `MCP 服务正在启动，已用时 ${elapsedText}` : 'MCP 服务正在启动'
    }
  }

  if (notificationType === 'mcp-server-ready') {
    const serverName = data.name || 'MCP Server'
    return {
      icon: '🧩',
      title: `${serverName} 启动完成`,
      description: elapsedText ? `MCP 服务已就绪，耗时 ${elapsedText}` : 'MCP 服务已就绪'
    }
  }

  if (notificationType === 'mcp-server-error') {
    const serverName = data.name || 'MCP Server'
    const errorText = data.error?.message || data.error || 'MCP 服务启动失败'
    return {
      icon: '🧩',
      title: `${serverName} 启动失败`,
      description: String(errorText)
    }
  }

  if (notificationType === 'session-config-applied' || notificationType === 'session-effort-changed') {
    const changeType = data.changeType || 'effort'
    const modelText = data.model || '系统'
    const subModelText = data.subModel || '默认'
    const effortValue = typeof data.effort === 'string' ? data.effort : ''
    const effortText = effortLabelMap[effortValue] || effortValue || '默认'
    const iconMap = {
      model: '✨',
      submodel: '🧩',
      effort: '🧠'
    }
    const title = changeType === 'effort'
      ? '思考力度已切换'
      : `${changeTypeLabelMap[changeType] || '配置'}已应用`
    return {
      icon: iconMap[changeType] || '🧠',
      title,
      description: `模型供应商: ${modelText} 模型: ${subModelText} 思考力度: ${effortText}${elapsedText ? ` 耗时: ${elapsedText}` : ''}`
    }
  }

  if (notificationType === 'turn-error') {
    const errorType = data.errorType || 'unknown'
    const errorMessage = data.message || '请求失败'

    // 特殊处理 usageLimitExceeded 错误
    if (errorType === 'usageLimitExceeded') {
      return {
        icon: '🚫',
        title: '使用额度已达上限',
        description: errorMessage
      }
    }

    if (errorType === 'contextWindowLimit') {
      return {
        icon: '📦',
        title: '上下文窗口已满',
        description: errorMessage
      }
    }

    // 其他 turn 错误
    return {
      icon: '⚠️',
      title: '请求失败',
      description: `[${errorType}] ${errorMessage}`
    }
  }

  if (notificationType === 'api-retry') {
    const attempt = Number.isFinite(data.attempt) ? data.attempt : null
    const maxRetries = Number.isFinite(data.maxRetries) ? data.maxRetries : null
    const retryDelayMs = Number.isFinite(data.retryDelayMs) ? data.retryDelayMs : null
    const errorStatus = Number.isFinite(data.errorStatus) ? data.errorStatus : null
    const errorText = data.error || 'unknown'
    const delayText = retryDelayMs != null ? `${Math.max(retryDelayMs / 1000, 0.1).toFixed(1)} 秒后重试` : '即将重试'
    const attemptText = attempt != null && maxRetries != null
      ? `第 ${attempt}/${maxRetries} 次重试`
      : '正在重试请求'
    const statusText = errorStatus != null ? `HTTP ${errorStatus}` : '请求受限'

    return {
      icon: '⏳',
      title: '请求触发重试',
      description: `${statusText} ${errorText}，${attemptText}，${delayText}`
    }
  }

  // 未知通知类型
  return {
    icon: '🔔',
    title: '系统通知',
    description: JSON.stringify(data, null, 2)
  }
})
</script>

<template>
  <div class="system-notification-wrapper">
    <div class="system-notification" :class="notificationTypeClass">
      <span class="notification-line" aria-hidden="true"></span>
      <div class="notification-content">
        <div class="notification-header">
          <div class="notification-title">
            <span class="notification-icon">{{ notificationContent.icon }}</span>
            <span>{{ notificationContent.title }}</span>
            <span v-if="formattedTime" class="notification-time">· {{ formattedTime }}</span>
          </div>
        </div>
        <div class="notification-description">
          {{ notificationContent.description }}
        </div>
      </div>
      <span class="notification-line" aria-hidden="true"></span>
    </div>
  </div>
</template>

<style scoped>
.system-notification-wrapper {
  display: flex;
  justify-content: center;
  width: 100%;
  margin: 10px 0;
}

.system-notification {
  display: flex;
  align-items: center;
  gap: 12px;
  width: min(100%, 820px);
  color: #a1a1aa;
  font-size: 12px;
}

.notification-line {
  flex: 1;
  min-width: 28px;
  border-top: 1px dashed rgba(113, 113, 122, 0.42);
}

.notification-icon {
  font-size: 12px;
  line-height: 1;
  opacity: 0.8;
}

.notification-content {
  flex-shrink: 0;
  max-width: min(70%, 720px);
  min-width: 0;
  text-align: center;
}

.notification-header {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 2px;
}

.notification-title {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: #d4d4d8;
  opacity: 0.72;
}

.notification-time {
  color: #71717a;
  opacity: 0.62;
}

.notification-description {
  color: #f4f4f5;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.5;
  opacity: 0.76;
}

.system-notification.notification-error .notification-title {
  color: #fca5a5;
}

.system-notification.notification-error .notification-description {
  color: #f4f4f5;
}

.system-notification.notification-success .notification-title {
  color: #86efac;
}

.system-notification.notification-success .notification-description {
  color: #f4f4f5;
}

.system-notification.notification-mcp .notification-title {
  color: #fbbf24;
}

.system-notification.notification-mcp .notification-description {
  color: #fde68a;
}
</style>
