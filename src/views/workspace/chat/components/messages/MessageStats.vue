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
  if ((props.isStreaming || props.startTime) && props.currentTime && props.startTime) {
    return formatDuration(props.currentTime - props.startTime)
  }
  return null
})

// 是否显示实时耗时
const isDurationStreaming = computed(() => {
  return !props.duration && (props.isStreaming || props.startTime) && props.currentTime && props.startTime
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
  <span v-if="formattedTime" class="header-time">
    <span class="header-icon">🕐</span>
    {{ formattedTime }}
  </span>
  <span v-if="computedDuration" class="header-duration" :class="{ streaming: isDurationStreaming }">
    <span class="header-icon">⏳</span>
    {{ computedDuration }}
  </span>
  <span v-if="numTurns" class="header-turns">
    <span class="header-icon">🔄</span>
    {{ numTurns }} turns
  </span>
  <span v-if="showTokens && formattedTokens" class="header-tokens">
    <span class="header-icon">⚡</span>
    {{ formattedTokens }}
  </span>
</template>

<style scoped>
.header-time,
.header-duration,
.header-turns,
.header-tokens {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: #71717A;
  background: #27272A;
  padding: 2px 6px;
  border-radius: 4px;
}

.header-icon {
  font-size: 12px;
}

.header-duration.streaming {
  color: #A78BFA;
  background: #1E1B4B;
}
</style>
