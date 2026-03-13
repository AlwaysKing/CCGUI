<script setup>
/**
 * SettingItem - 设置项组件
 * 用于软件配置中的各项设置（主题、语言等）
 * 支持水平和垂直两种布局
 */
defineProps({
  title: {
    type: String,
    required: true
  },
  description: {
    type: String,
    default: ''
  },
  vertical: {
    type: Boolean,
    default: false
  }
})
</script>

<template>
  <div class="setting-item" :class="{ vertical }">
    <!-- 水平布局: 标签在左，控件在右 -->
    <template v-if="!vertical">
      <div class="setting-label">
        <span class="setting-title">{{ title }}</span>
        <span v-if="description" class="setting-description">{{ description }}</span>
      </div>
      <div class="setting-control">
        <slot></slot>
      </div>
    </template>

    <!-- 垂直布局: 标题在上，控件在下 -->
    <template v-else>
      <div class="setting-header-row">
        <span class="setting-title">{{ title }}</span>
        <div v-if="$slots.actions" class="setting-actions">
          <slot name="actions"></slot>
        </div>
      </div>
      <span v-if="description" class="setting-description">{{ description }}</span>
      <div class="setting-control">
        <slot></slot>
      </div>
    </template>
  </div>
</template>

<style scoped>
.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;
  border-bottom: 1px solid #3F3F46;
}

.setting-item:last-child {
  border-bottom: none;
}

.setting-item.vertical {
  flex-direction: column;
  align-items: flex-start;
  gap: 8px;
}

.setting-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.setting-title {
  font-size: 14px;
  font-weight: 500;
  color: #F4F4F5;
}

.setting-description {
  font-size: 12px;
  color: #71717A;
}

.setting-control {
  flex-shrink: 0;
}

.vertical .setting-control {
  width: 100%;
  margin-top: 4px;
}

.setting-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
}

.setting-actions {
  display: flex;
  gap: 8px;
}
</style>
