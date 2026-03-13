<script setup>
/**
 * SoftwareSettings - 软件配置区域
 * 包含主题、语言、Bark通知、关于信息
 */
import { ref, defineProps, defineEmits } from 'vue'
import { SettingsSection, SettingItem } from './common'

const props = defineProps({
  settings: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['update:settings', 'test-bark', 'save-bark'])

// Bark 测试和保存状态
const testingBark = ref(false)
const savingBark = ref(false)

// 测试 Bark 通知
async function handleTestBark() {
  testingBark.value = true
  try {
    await emit('test-bark', props.settings.barkUrl)
  } finally {
    testingBark.value = false
  }
}

// 保存 Bark URL
async function handleSaveBark() {
  savingBark.value = true
  try {
    await emit('save-bark', props.settings.barkUrl)
  } finally {
    savingBark.value = false
  }
}
</script>

<template>
  <SettingsSection title="软件配置">
    <!-- 主题设置 -->
    <SettingItem title="主题" description="选择应用的主题外观">
      <select :value="settings.theme" @change="emit('update:settings', { ...settings, theme: $event.target.value })" class="setting-select">
        <option value="dark">深色模式</option>
        <option value="light" disabled>浅色模式（开发中）</option>
      </select>
    </SettingItem>

    <!-- 语言设置 -->
    <SettingItem title="语言" description="选择应用的显示语言">
      <select :value="settings.language" @change="emit('update:settings', { ...settings, language: $event.target.value })" class="setting-select">
        <option value="zh-CN">简体中文</option>
        <option value="en-US" disabled>English (开发中)</option>
      </select>
    </SettingItem>

    <!-- Bark 通知设置 -->
    <SettingItem
      title="Bark 通知链接"
      description="配置 Bark 推送通知的 API 地址（选填）, 例子: https://example.com/key/"
      vertical
    >
      <template #actions>
        <button class="btn-test" @click="handleTestBark" :disabled="testingBark">
          {{ testingBark ? '测试中...' : '测试' }}
        </button>
        <button class="btn-save" @click="handleSaveBark" :disabled="savingBark">
          {{ savingBark ? '保存中...' : '保存' }}
        </button>
      </template>
      <input
        type="text"
        :value="settings.barkUrl"
        @input="emit('update:settings', { ...settings, barkUrl: $event.target.value })"
        class="setting-input"
        placeholder="例如: https://example.com/key/"
      >
    </SettingItem>

    <!-- 关于信息 -->
    <div class="setting-item about-section">
      <div class="setting-label">
        <span>关于</span>
        <span class="setting-description">应用版本信息</span>
      </div>
      <div class="about-info">
        <p><strong>CCGUI</strong></p>
        <p class="version">版本 1.0.0</p>
        <p class="description">Claude Code 的图形化界面客户端</p>
      </div>
    </div>
  </SettingsSection>
</template>

<style scoped>
.setting-select {
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  padding: 8px 12px;
  color: #F4F4F5;
  font-size: 13px;
  cursor: pointer;
  min-width: 150px;
}

.setting-select:focus {
  outline: none;
  border-color: #F97316;
}

.setting-input {
  width: 100%;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  padding: 10px 12px;
  color: #F4F4F5;
  font-size: 13px;
}

.setting-input:focus {
  outline: none;
  border-color: #F97316;
}

.btn-test,
.btn-save {
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-test {
  background: transparent;
  border: 1px solid #52525B;
  color: #9CA3AF;
}

.btn-test:hover:not(:disabled) {
  border-color: #F97316;
  color: #F97316;
}

.btn-save {
  background: #F97316;
  border: 1px solid #F97316;
  color: white;
}

.btn-save:hover:not(:disabled) {
  background: #EA580C;
}

.btn-test:disabled,
.btn-save:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

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

.setting-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.setting-label span:first-child {
  font-size: 14px;
  font-weight: 500;
  color: #F4F4F5;
}

.setting-description {
  font-size: 12px;
  color: #71717A;
}

.about-section {
  align-items: flex-start;
}

.about-info {
  text-align: right;
}

.about-info p {
  margin: 0;
  font-size: 13px;
  color: #9CA3AF;
}

.about-info strong {
  color: #F4F4F5;
}

.about-info .version {
  color: #71717A;
  font-size: 12px;
  margin-top: 4px;
}

.about-info .description {
  color: #6B7280;
  font-size: 12px;
  margin-top: 4px;
}
</style>
