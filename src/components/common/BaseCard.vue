<script setup>
/**
 * BaseCard - 统一卡片组件
 */
defineProps({
  hoverable: {
    type: Boolean,
    default: false
  },
  selected: {
    type: Boolean,
    default: false
  },
  padding: {
    type: String,
    default: 'md',
    validator: (v) => ['none', 'sm', 'md', 'lg'].includes(v)
  }
})

defineEmits(['click'])
</script>

<template>
  <div
    class="base-card"
    :class="[
      `card-padding-${padding}`,
      { 'card-hoverable': hoverable, 'card-selected': selected }
    ]"
    @click="$emit('click', $event)"
  >
    <slot></slot>
  </div>
</template>

<style scoped>
.base-card {
  background-color: var(--bg-tertiary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-lg);
  transition: all var(--transition-fast);
}

/* 内边距 */
.card-padding-none {
  padding: 0;
}

.card-padding-sm {
  padding: var(--spacing-sm);
}

.card-padding-md {
  padding: var(--spacing-md);
}

.card-padding-lg {
  padding: var(--spacing-lg);
}

/* 可悬停 */
.card-hoverable {
  cursor: pointer;
}

.card-hoverable:hover {
  border-color: var(--border-hover);
}

/* 选中状态 */
.card-selected {
  border-color: var(--accent-primary);
  background-color: var(--accent-light);
}
</style>
