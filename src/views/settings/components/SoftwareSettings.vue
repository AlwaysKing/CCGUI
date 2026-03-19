<script setup>
/**
 * SoftwareSettings - 软件配置区域
 * 包含主题、语言、Bark通知、关于信息
 */
import { ref } from 'vue'
import SettingsSection from './common/SettingsSection.vue'
import SettingItem from './common/SettingItem.vue'

const systemSoundGroups = [
  {
    label: '系统提示音',
    options: [
      { value: 'Basso', label: 'Basso' },
      { value: 'Blow', label: 'Blow' },
      { value: 'Bottle', label: 'Bottle' },
      { value: 'Frog', label: 'Frog' },
      { value: 'Funk', label: 'Funk' },
      { value: 'Glass', label: 'Glass' },
      { value: 'Hero', label: 'Hero' },
      { value: 'Morse', label: 'Morse' },
      { value: 'Ping', label: 'Ping' },
      { value: 'Pop', label: 'Pop' },
      { value: 'Purr', label: 'Purr' },
      { value: 'Sosumi', label: 'Sosumi' },
      { value: 'Submarine', label: 'Submarine' },
      { value: 'Tink', label: 'Tink' }
    ]
  },
  {
    label: '扩展 UI 音效',
    options: [
      { value: 'ui-alert', label: 'Alert' },
      { value: 'ui-error', label: 'Error' },
      { value: 'ui-focus', label: 'Focus' },
      { value: 'ui-focus-2', label: 'Focus 2' },
      { value: 'ui-guide-success', label: 'Guide Success' },
      { value: 'ui-menu-down', label: 'Menu Down' },
      { value: 'ui-popup-appeared', label: 'Popup Appeared' },
      { value: 'ui-window-activated', label: 'Window Activated' }
    ]
  }
]

const props = defineProps({
  settings: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['update:settings', 'save-settings', 'test-bark', 'save-bark'])

// Bark 测试和保存状态
const testingBark = ref(false)
const savingBark = ref(false)
const testingSound = ref(false)

function updateSettings(nextSettings, autoSave = false) {
  emit('update:settings', nextSettings)
  if (autoSave) {
    emit('save-settings')
  }
}

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

async function handleTestSound() {
  if (!props.settings.notificationSound) return

  testingSound.value = true
  try {
    const result = await window.electronAPI.playSystemSound({
      sound: props.settings.notificationSound
    })
    if (!result?.success) {
      alert('播放提示音失败: ' + (result?.error || '未知错误'))
    }
  } finally {
    testingSound.value = false
  }
}
</script>

<template>
  <SettingsSection title="软件配置">
    <!-- 主题设置 -->
    <SettingItem title="主题" description="选择应用的主题外观">
      <select :value="settings.theme" @change="updateSettings({ ...settings, theme: $event.target.value }, true)" class="setting-select">
        <option value="dark">深色模式</option>
        <option value="light" disabled>浅色模式（开发中）</option>
      </select>
    </SettingItem>

    <!-- 语言设置 -->
    <SettingItem title="语言" description="选择应用的显示语言">
      <select :value="settings.language" @change="updateSettings({ ...settings, language: $event.target.value }, true)" class="setting-select">
        <option value="zh-CN">简体中文</option>
        <option value="en-US" disabled>English (开发中)</option>
      </select>
    </SettingItem>

    <SettingItem title="提示音" description="选择一个 macOS 系统提示音或扩展 UI 音效，用于后续通知提示">
      <div class="sound-setting-control">
        <button class="btn-test" @click="handleTestSound" :disabled="testingSound">
          {{ testingSound ? '试听中...' : '试听' }}
        </button>
        <select
          :value="settings.notificationSound || 'Glass'"
          @change="updateSettings({ ...settings, notificationSound: $event.target.value }, true)"
          class="setting-select"
        >
          <optgroup v-for="group in systemSoundGroups" :key="group.label" :label="group.label">
            <option v-for="option in group.options" :key="option.value" :value="option.value">
              {{ option.label }}
            </option>
          </optgroup>
        </select>
      </div>
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
        @input="updateSettings({ ...settings, barkUrl: $event.target.value })"
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

.sound-setting-control {
  display: flex;
  align-items: center;
  gap: 8px;
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
