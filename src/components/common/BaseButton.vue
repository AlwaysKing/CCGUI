<script setup>
/**
 * BaseButton - 统一按钮组件
 * 支持多种变体：primary, secondary, danger, ghost
 */
defineProps({
  variant: {
    type: String,
    default: 'primary',
    validator: (v) => ['primary', 'secondary', 'danger', 'ghost'].includes(v)
  },
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg'].includes(v)
  },
  disabled: {
    type: Boolean,
    default: false
  },
  loading: {
    type: Boolean,
    default: false
  },
  block: {
    type: Boolean,
    default: false
  }
})

defineEmits(['click'])
</script>

<template>
  <button
    class="base-button"
    :class="[`btn-${variant}`, `btn-${size}`, { 'btn-block': block, 'btn-loading': loading }]"
    :disabled="disabled || loading"
    @click="$emit('click', $event)"
  >
    <span v-if="loading" class="btn-spinner"></span>
    <slot></slot>
  </button>
</template>

<style scoped>
.base-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: var(--spacing-sm);
  font-weight: var(--font-weight-medium);
  border-radius: var(--radius-md);
  transition: all var(--transition-fast);
  cursor: pointer;
  border: 1px solid transparent;
  white-space: nowrap;
}

.base-button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

/* 尺寸 */
.btn-sm {
  padding: 4px 10px;
  font-size: var(--font-size-sm);
}

.btn-md {
  padding: 8px 16px;
  font-size: var(--font-size-base);
}

.btn-lg {
  padding: 12px 24px;
  font-size: var(--font-size-md);
}

/* 变体 */
.btn-primary {
  background-color: var(--accent-primary);
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background-color: var(--accent-hover);
}

.btn-primary:active:not(:disabled) {
  background-color: var(--accent-active);
}

.btn-secondary {
  background-color: var(--bg-tertiary);
  color: var(--text-primary);
  border-color: var(--border-default);
}

.btn-secondary:hover:not(:disabled) {
  background-color: var(--bg-hover);
  border-color: var(--border-hover);
}

.btn-danger {
  background-color: var(--color-error);
  color: white;
}

.btn-danger:hover:not(:disabled) {
  background-color: var(--color-error-hover);
}

.btn-ghost {
  background-color: transparent;
  color: var(--text-secondary);
}

.btn-ghost:hover:not(:disabled) {
  background-color: var(--bg-hover);
  color: var(--text-primary);
}

/* 块级按钮 */
.btn-block {
  width: 100%;
}

/* 加载状态 */
.btn-loading {
  position: relative;
}

.btn-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: spin 0.6s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
