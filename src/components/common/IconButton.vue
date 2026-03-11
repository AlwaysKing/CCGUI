<script setup>
/**
 * IconButton - 图标按钮组件
 */
defineProps({
  title: {
    type: String,
    default: ''
  },
  disabled: {
    type: Boolean,
    default: false
  },
  danger: {
    type: Boolean,
    default: false
  },
  noBorder: {
    type: Boolean,
    default: false
  },
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg'].includes(v)
  }
})

defineEmits(['click'])
</script>

<template>
  <button
    class="icon-button"
    :class="[`btn-${size}`, { 'btn-danger': danger, 'btn-no-border': noBorder }]"
    :title="title"
    :disabled="disabled"
    @click="$emit('click', $event)"
  >
    <slot></slot>
  </button>
</template>

<style scoped>
.icon-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background-color: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
  cursor: pointer;
  border: 1px solid transparent;
}

.icon-button:hover:not(:disabled) {
  background-color: var(--bg-hover);
  color: var(--text-primary);
}

.icon-button:active:not(:disabled) {
  background-color: var(--bg-active);
}

.icon-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* 尺寸 */
.btn-sm {
  padding: 4px;
  font-size: var(--font-size-sm);
}

.btn-md {
  padding: 6px;
  font-size: var(--font-size-base);
}

.btn-lg {
  padding: 8px;
  font-size: var(--font-size-md);
}

/* 危险按钮 */
.btn-danger:hover:not(:disabled) {
  background-color: var(--color-error-bg);
  color: var(--color-error);
}

/* 无边框 */
.btn-no-border {
  border: none;
}
</style>
