<script setup>
/**
 * SubsectionHeader - 子章节标题行
 * 包含标题和可选的操作按钮（如添加按钮）
 */
import { IconButton } from '@/components/common'

defineProps({
  title: {
    type: String,
    required: true
  },
  showAddButton: {
    type: Boolean,
    default: false
  },
  addButtonTitle: {
    type: String,
    default: '添加'
  }
})

const emit = defineEmits(['add'])
</script>

<template>
  <div class="subsection-header">
    <h4 class="subsection-title">{{ title }}</h4>
    <slot name="actions">
      <IconButton
        v-if="showAddButton"
        class="no-border"
        @click="emit('add')"
        :title="addButtonTitle"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </IconButton>
    </slot>
  </div>
</template>

<style scoped>
.subsection-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 20px 0 12px;
}

.subsection-header:first-child {
  margin-top: 0;
}

.subsection-title {
  font-size: 15px;
  font-weight: 600;
  color: #D1D5DB;
  margin: 0;
}

.no-border {
  border: none;
  background: transparent;
  padding: 4px;
}

.no-border:hover {
  background: rgba(249, 115, 22, 0.1);
  color: #F97316;
}
</style>
