<script setup>
/**
 * ToolResultDisplay - 工具结果显示组件
 */
import { computed } from 'vue'

const props = defineProps({
  result: {
    type: [String, Array],
    default: ''
  },
  isError: {
    type: Boolean,
    default: false
  }
})

// 是否有结果
const hasResult = computed(() => {
  if (!props.result) return false
  if (typeof props.result === 'string') return props.result.trim().length > 0
  if (Array.isArray(props.result)) return props.result.length > 0
  return true
})

// 格式化结果
const formattedResult = computed(() => {
  if (!hasResult.value) return ''

  if (typeof props.result === 'string') {
    return props.result
  }

  if (Array.isArray(props.result)) {
    return props.result.map(item => {
      if (typeof item === 'string') return item
      if (typeof item === 'object') {
        try {
          return JSON.stringify(item, null, 2)
        } catch (e) {
          return String(item)
        }
      }
      return String(item)
    }).join('\n')
  }

  try {
    return JSON.stringify(props.result, null, 2)
  } catch (e) {
    return String(props.result)
  }
})

// 结果行数
const resultLines = computed(() => {
  return formattedResult.value.split('\n').length
})

// 是否需要折叠（超过 20 行）
const shouldCollapse = computed(() => resultLines.value > 20)

// 截断后的结果（前 20 行）
const truncatedResult = computed(() => {
  if (!shouldCollapse.value) return formattedResult.value
  const lines = formattedResult.value.split('\n')
  return lines.slice(0, 20).join('\n') + `\n... (${resultLines.value - 20} 行已省略)`
})
</script>

<template>
  <div v-if="hasResult" class="tool-result" :class="{ 'is-error': isError }">
    <div class="result-header">
      <span class="result-label">{{ isError ? '错误' : '结果' }}</span>
      <span v-if="shouldCollapse" class="result-lines">{{ resultLines }} 行</span>
    </div>
    <pre class="result-content"><code>{{ truncatedResult }}</code></pre>
  </div>
</template>

<style scoped>
.tool-result {
  margin-top: var(--spacing-sm);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.tool-result.is-error {
  border: 1px solid var(--color-error);
}

.result-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-xs) var(--spacing-sm);
  background: var(--bg-tertiary);
}

.result-label {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: var(--text-secondary);
}

.tool-result.is-error .result-label {
  color: var(--color-error);
}

.result-lines {
  font-size: var(--font-size-xs);
  color: var(--text-muted);
}

.result-content {
  margin: 0;
  padding: var(--spacing-sm);
  background: var(--code-bg);
  border-top: 1px solid var(--code-border);
  max-height: 300px;
  overflow: auto;
}

.result-content code {
  font-family: var(--font-family-mono);
  font-size: var(--font-size-xs);
  color: var(--text-primary);
  white-space: pre-wrap;
  word-break: break-word;
}

.tool-result.is-error .result-content {
  border-top-color: var(--color-error);
}

.tool-result.is-error .result-content code {
  color: var(--color-error);
}
</style>
