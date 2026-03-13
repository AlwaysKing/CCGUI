<script setup>
/**
 * SettingsSection - 设置大类容器
 * 包含大类标题和内容区域
 */
defineProps({
  title: {
    type: String,
    required: true
  }
})
</script>

<template>
  <div class="settings-section">
    <h3 class="section-title">{{ title }}</h3>
    <div class="section-content">
      <slot></slot>
    </div>
  </div>
</template>

<style scoped>
.settings-section {
  margin-bottom: 32px;
}

.section-title {
  font-size: 18px;
  font-weight: 600;
  color: #F4F4F5;
  margin: 0 0 20px 0;
  padding-bottom: 8px;
  border-bottom: 2px solid #F97316;
}

.section-content {
  /* 内容区域 */
}
</style>
