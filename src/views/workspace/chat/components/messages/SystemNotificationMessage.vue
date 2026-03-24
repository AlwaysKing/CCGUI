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
  if (notificationType === 'runtime-exit' || notificationType === 'turn-error') {
    return 'notification-error'
  }
  if (
    notificationType === 'runtime-stopped' ||
    notificationType === 'session-runtime-ready' ||
    notificationType === 'session-config-applied' ||
    notificationType === 'session-effort-changed'
  ) {
    return 'notification-success'
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

    // 其他 turn 错误
    return {
      icon: '⚠️',
      title: '请求失败',
      description: `[${errorType}] ${errorMessage}`
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
</style>
