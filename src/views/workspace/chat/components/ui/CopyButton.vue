<script setup>
/**
 * CopyButton - 复制按钮组件
 * 统一的复制按钮，支持已复制状态显示
 */
const props = defineProps({
  isCopied: {
    type: Boolean,
    default: false
  },
  size: {
    type: String,
    default: '14', // 14 or 12
    validator: (value) => ['12', '14', '16'].includes(value)
  },
  title: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['copy'])
</script>

<template>
  <button
    class="copy-btn"
    :class="{ copied: isCopied }"
    :title="title || (isCopied ? '已复制' : '复制内容')"
    @click.stop="emit('copy')"
  >
    <svg v-if="isCopied" xmlns="http://www.w3.org/2000/svg" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="20 6 9 17 4 12"></polyline>
    </svg>
    <svg v-else xmlns="http://www.w3.org/2000/svg" :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>
  </button>
</template>

<style scoped>
.copy-btn {
  background: transparent;
  border: none;
  color: #71717A;
  cursor: pointer;
  padding: 4px;
  border-radius: 4px;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.copy-btn:hover {
  background: #3F3F46;
  color: #A1A1AA;
}

.copy-btn.copied {
  color: #22C55E;
}
</style>
