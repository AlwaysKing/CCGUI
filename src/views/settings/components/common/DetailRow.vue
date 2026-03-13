<script setup>
/**
 * DetailRow - 键值对显示行
 * 用于显示配置详情（如 API地址: xxx）
 */
defineProps({
  label: {
    type: String,
    required: true
  },
  labelWidth: {
    type: String,
    default: '100px'
  },
  code: {
    type: Boolean,
    default: false
  }
})
</script>

<template>
  <div class="detail-row">
    <span class="detail-label" :style="{ minWidth: labelWidth }">{{ label }}:</span>
    <span class="detail-value" :class="{ code }">
      <slot></slot>
    </span>
  </div>
</template>

<style scoped>
.detail-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px solid #3F3F46;
}

.detail-row:last-child {
  border-bottom: none;
}

.detail-label {
  color: #9CA3AF;
  font-size: 13px;
  flex-shrink: 0;
}

.detail-value {
  color: #F4F4F5;
  font-size: 13px;
  word-break: break-all;
}

.detail-value.code {
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  color: #FB923C;
  background: rgba(251, 146, 60, 0.1);
  padding: 2px 6px;
  border-radius: 4px;
}
</style>
