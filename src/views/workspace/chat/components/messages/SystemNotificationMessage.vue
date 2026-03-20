<script setup>
/**
 * SystemNotificationMessage - 系统通知消息组件
 * 显示权限模式切换、快速模式切换、上下文压缩等系统通知
 * 居中显示，不同类型使用不同颜色
 */
import { computed } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
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
  if (notificationType === 'runtime-stopped') {
    return 'notification-success'
  }
  return 'notification-warning'
})

// 通知内容
const notificationContent = computed(() => {
  const { notificationType, data } = props.message

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
    return {
      icon: '⏸',
      title: '运行时已停止',
      description: data.message || '会话已手动停止'
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
      <span class="notification-icon">{{ notificationContent.icon }}</span>
      <div class="notification-content">
        <div class="notification-header">
          <div class="notification-title">{{ notificationContent.title }}</div>
          <div v-if="formattedTime" class="notification-time">{{ formattedTime }}</div>
        </div>
        <div class="notification-description">{{ notificationContent.description }}</div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.system-notification-wrapper {
  display: flex;
  justify-content: center;
  width: 100%;
  margin: 8px 0;
}

.system-notification {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px 16px;
  background: linear-gradient(135deg, #422006 0%, #292524 100%);
  border: 1px solid #854D0E;
  border-left: 3px solid #F59E0B;
  border-radius: var(--radius-lg);
  min-width: 280px;
  max-width: 80%;
  font-size: var(--font-size-sm);
}

/* 错误类型通知（红色系） */
.system-notification.notification-error {
  background: linear-gradient(135deg, #450A0A 0%, #292524 100%);
  border-color: #991B1B;
  border-left-color: #EF4444;
}

.system-notification.notification-error .notification-title {
  color: #FCA5A5;
}

.system-notification.notification-error .notification-time {
  color: #991B1B;
}

/* 成功类型通知（绿色系） */
.system-notification.notification-success {
  background: linear-gradient(135deg, #052e16 0%, #292524 100%);
  border-color: #166534;
  border-left-color: #10B981;
}

.system-notification.notification-success .notification-title {
  color: #6EE7B7;
}

.system-notification.notification-success .notification-time {
  color: #166534;
}

.notification-icon {
  font-size: 16px;
  line-height: 1;
  flex-shrink: 0;
}

.notification-content {
  flex: 1;
  min-width: 0;
}

.notification-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 4px;
}

.notification-title {
  font-weight: var(--font-weight-medium);
  color: #FCD34D;
}

.notification-time {
  font-size: var(--font-size-xs);
  color: #854D0E;
  flex-shrink: 0;
}

.notification-description {
  color: #D4D4D4;
  white-space: pre-wrap;
  word-break: break-word;
  line-height: 1.4;
}
</style>
