<script setup>
/**
 * MessageStats - 消息统计信息条组件
 * 显示时间、耗时、turns、tokens等统计信息
 */
import { computed } from 'vue'

const props = defineProps({
  timestamp: {
    type: [Number, Date, String],
    default: null
  },
  duration: {
    type: Number,
    default: null
  },
  startTime: {
    type: Number,
    default: null
  },
  currentTime: {
    type: Number,
    default: null
  },
  isStreaming: {
    type: Boolean,
    default: false
  },
  numTurns: {
    type: Number,
    default: null
  },
  usage: {
    type: Object,
    default: null
  },
  showTokens: {
    type: Boolean,
    default: true
  },
  variant: {
    type: String,
    default: 'full'
  }
})

const emit = defineEmits(['formatDuration', 'formatTokens'])

// 格式化时间
const formattedTime = computed(() => {
  if (!props.timestamp) return ''
  const date = typeof props.timestamp === 'object' ? props.timestamp : new Date(props.timestamp)
  return date.toLocaleTimeString()
})

// 格式化耗时
function formatDuration(ms) {
  if (!ms && ms !== 0) return ''
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

// 计算实时耗时
const computedDuration = computed(() => {
  if (props.duration) {
    return formatDuration(props.duration)
  }
  if (props.isStreaming && props.currentTime && props.startTime) {
    return formatDuration(props.currentTime - props.startTime)
  }
  return null
})

// 是否显示实时耗时
const isDurationStreaming = computed(() => {
  return !props.duration && !!props.isStreaming && !!props.currentTime && !!props.startTime
})

// 格式化 tokens
function formatTokens(usage) {
  if (!usage) return ''
  const cache = usage.cache_read_input_tokens || 0
  const input = usage.input_tokens || 0
  const output = usage.output_tokens || 0
  if (cache === 0 && input === 0 && output === 0) return ''

  const parts = []
  if (cache) parts.push(`缓存: ${cache.toLocaleString()}`)
  if (input) parts.push(`输入: ${input.toLocaleString()}`)
  if (output) parts.push(`输出: ${output.toLocaleString()}`)

  return parts.join(' ')
}

// 计算格式化后的 tokens
const formattedTokens = computed(() => {
  if (!props.usage) return ''
  return formatTokens(props.usage)
})
</script>

<template>
  <span v-if="isStreaming" class="header-streaming" :class="variant" aria-hidden="true">
    <span class="header-spinner"></span>
  </span>
  <span v-if="formattedTime" class="header-time" :class="variant">
    <span class="header-icon">🕐</span>
    {{ formattedTime }}
  </span>
  <span v-if="computedDuration" class="header-duration" :class="[variant, { streaming: isDurationStreaming }]">
    <span class="header-icon">⏳</span>
    {{ computedDuration }}
  </span>
  <span v-if="numTurns" class="header-turns" :class="variant">
    <span class="header-icon">🔄</span>
    {{ numTurns }} turns
  </span>
  <span v-if="showTokens && formattedTokens" class="header-tokens" :class="variant">
    <span class="header-icon">⚡</span>
    {{ formattedTokens }}
  </span>
</template>

<style scoped>
.header-time,
.header-duration,
.header-turns,
.header-tokens,
.header-streaming {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #71717A;
  background: #27272A;
  padding: 2px 6px;
  border-radius: 4px;
}

.header-time.compact,
.header-duration.compact,
.header-turns.compact,
.header-tokens.compact,
.header-streaming.compact {
  background: transparent;
  padding: 0;
  color: #6B7280;
}

.header-time.floating,
.header-duration.floating,
.header-turns.floating,
.header-tokens.floating,
.header-streaming.floating {
  background: rgba(24, 24, 27, 0.94);
  border: 1px solid rgba(63, 63, 70, 0.78);
  color: #A1A1AA;
  backdrop-filter: blur(8px);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.22);
}

.header-icon {
  font-size: 12px;
}

.header-time.compact .header-icon,
.header-duration.compact .header-icon,
.header-turns.compact .header-icon,
.header-tokens.compact .header-icon {
  font-size: 10px;
}

.header-time.floating .header-icon,
.header-duration.floating .header-icon,
.header-turns.floating .header-icon,
.header-tokens.floating .header-icon {
  font-size: 10px;
  opacity: 0.78;
}

.header-streaming {
  color: #94A3B8;
}

.header-streaming.compact {
  color: #7C8AA0;
}

.header-streaming.floating {
  color: #CBD5E1;
}

.header-spinner {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.35px solid rgba(148, 163, 184, 0.28);
  border-top-color: currentColor;
  animation: message-stats-spin 0.9s linear infinite;
}

@keyframes message-stats-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.header-duration.streaming {
  color: #A78BFA;
  background: #1E1B4B;
}

.header-duration.streaming.compact {
  background: transparent;
}
</style>
