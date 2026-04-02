<script setup>
/**
 * SoftwareSettings - 软件配置区域
 * 包含主题、语言、Bark通知、关于信息
 */
import { ref } from 'vue'
import SettingsSection from './common/SettingsSection.vue'
import SettingItem from './common/SettingItem.vue'
import AppSelect from '@/components/base/AppSelect.vue'

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

const themeOptions = [
  { value: 'dark', label: '深色模式' },
  { value: 'light', label: '浅色模式（开发中）', disabled: true }
]

const languageOptions = [
  { value: 'zh-CN', label: '简体中文' },
  { value: 'en-US', label: 'English (开发中)', disabled: true }
]

// Bark 测试和保存状态
const testingBark = ref(false)
const savingBark = ref(false)
const testingSound = ref(false)
const testingAlertSound = ref(false)

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

async function handleTestAlertSound() {
  const sound = props.settings.alertSound || 'Glass'

  testingAlertSound.value = true
  try {
    const result = await window.electronAPI.playSystemSound({ sound })
    if (!result?.success) {
      alert('播放提示音失败: ' + (result?.error || '未知错误'))
    }
  } finally {
    testingAlertSound.value = false
  }
}
</script>

<template>
  <SettingsSection title="软件配置">
    <!-- 主题设置 -->
    <SettingItem title="主题" description="选择应用的主题外观">
      <AppSelect
        :model-value="settings.theme"
        class="setting-select"
        :options="themeOptions"
        @update:model-value="updateSettings({ ...settings, theme: $event }, true)"
      />
    </SettingItem>

    <!-- 语言设置 -->
    <SettingItem title="语言" description="选择应用的显示语言">
      <AppSelect
        :model-value="settings.language"
        class="setting-select"
        :options="languageOptions"
        @update:model-value="updateSettings({ ...settings, language: $event }, true)"
      />
    </SettingItem>

    <SettingItem title="提示音" description="选择一个 macOS 系统提示音或扩展 UI 音效，用于后续通知提示">
      <div class="sound-setting-control">
        <button class="btn-test" @click="handleTestSound" :disabled="testingSound">
          {{ testingSound ? '试听中...' : '试听' }}
        </button>
        <AppSelect
          :model-value="settings.notificationSound || 'Glass'"
          class="setting-select"
          :groups="systemSoundGroups"
          @update:model-value="updateSettings({ ...settings, notificationSound: $event }, true)"
        />
      </div>
    </SettingItem>

    <SettingItem title="弹窗提示音" description="权限请求和交互问答弹窗出现时播放提示音">
      <div class="sound-setting-control">
        <button class="btn-test" @click="handleTestAlertSound" :disabled="testingAlertSound">
          {{ testingAlertSound ? '试听中...' : '试听' }}
        </button>
        <label class="toggle-switch">
          <input type="checkbox" :checked="settings.alertSoundEnabled !== false" @change="updateSettings({ ...settings, alertSoundEnabled: $event.target.checked }, true)">
          <span class="toggle-slider"></span>
        </label>
        <AppSelect
          :model-value="settings.alertSound || 'Glass'"
          class="setting-select"
          :groups="systemSoundGroups"
          @update:model-value="updateSettings({ ...settings, alertSound: $event }, true)"
        />
      </div>
    </SettingItem>

    <SettingItem title="发送时折叠" description="发送新消息时自动折叠之前的回答">
      <label class="toggle-switch">
        <input type="checkbox" :checked="settings.collapseOnSend !== false" @change="updateSettings({ ...settings, collapseOnSend: $event.target.checked }, true)">
        <span class="toggle-slider"></span>
      </label>
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
  min-width: 150px;
}

.setting-input {
  width: 100%;
  background: var(--app-soft-surface);
  border: 1px solid var(--app-soft-border);
  border-radius: 8px;
  padding: 10px 12px;
  color: #F4F4F5;
  font-size: 13px;
}

.setting-input:focus {
  outline: none;
  border-color: #F97316;
  background: var(--app-soft-surface-hover);
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
  border: 1px solid var(--app-soft-border);
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

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: #3F3F46;
  border-radius: 20px;
  transition: background 0.2s;
}

.toggle-slider::before {
  content: '';
  position: absolute;
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
}

.toggle-switch input:checked + .toggle-slider {
  background: #F97316;
}

.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(16px);
}

.setting-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 0;
  border-bottom: 1px solid var(--app-soft-panel-border);
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
