<script setup>
/**
 * StatusBadge - 状态徽章组件
 * 显示状态信息，支持多种类型（success, warning, error, info）
 */
const props = defineProps({
  type: {
    type: String,
    default: 'default',
    validator: (value) => ['default', 'success', 'warning', 'error', 'info'].includes(value)
  },
  icon: {
    type: String,
    default: ''
  }
})
</script>

<template>
  <span class="status-badge" :class="type">
    <span v-if="icon" class="badge-icon">{{ icon }}</span>
    <slot />
  </span>
</template>

<style scoped>
.status-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 4px;
  background: #27272A;
  color: #A1A1AA;
}

.badge-icon {
  font-size: 12px;
}

.status-badge.success {
  background: rgba(34, 197, 94, 0.1);
  color: #22C55E;
}

.status-badge.warning {
  background: rgba(245, 158, 11, 0.1);
  color: #F59E0B;
}

.status-badge.error {
  background: rgba(239, 68, 68, 0.1);
  color: #EF4444;
}

.status-badge.info {
  background: rgba(249, 115, 22, 0.1);
  color: #F97316;
}
</style>
