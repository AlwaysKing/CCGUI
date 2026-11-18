<script setup>
import { computed, onUnmounted, ref, watch } from 'vue'
import BaseButton from '@/components/base/BaseButton.vue'
import BaseDialog from '@/components/base/BaseDialog.vue'

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  updateInfo: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['update:modelValue', 'open-release'])

const isUpdating = ref(false)
const updateError = ref('')
const updateProgress = ref({
  stage: '',
  progress: null,
  message: ''
})
let removeProgressListener = null

const canAutoUpdate = computed(() => Boolean(props.updateInfo?.canAutoUpdate))
const progressPercent = computed(() => {
  const value = Number(updateProgress.value?.progress)
  return Number.isFinite(value) ? Math.min(100, Math.max(0, value)) : null
})

function resetState() {
  isUpdating.value = false
  updateError.value = ''
  updateProgress.value = {
    stage: '',
    progress: null,
    message: ''
  }
}

function close() {
  if (isUpdating.value) {
    return
  }
  emit('update:modelValue', false)
}

function openReleasePage() {
  emit('open-release')
}

async function startUpdate() {
  if (!canAutoUpdate.value || isUpdating.value) {
    return
  }

  isUpdating.value = true
  updateError.value = ''
  updateProgress.value = {
    stage: 'preparing',
    progress: null,
    message: '正在准备更新...'
  }

  removeProgressListener?.()
  removeProgressListener = window.electronAPI?.onAppUpdateProgress?.(progress => {
    updateProgress.value = progress || updateProgress.value
  }) || null

  try {
    const result = await window.electronAPI?.installAppUpdate?.({
      currentVersion: props.updateInfo?.currentVersion,
      expectedVersion: props.updateInfo?.latestVersion
    })
    if (!result?.success) {
      updateError.value = result?.error || '更新安装失败'
      isUpdating.value = false
      return
    }
    updateProgress.value = {
      stage: 'restarting',
      progress: 100,
      message: '更新完成，正在重新启动...'
    }
  } catch (error) {
    updateError.value = error.message || '更新安装失败'
    isUpdating.value = false
  }
}

function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return ''
  }
  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`
  }
  return `${Math.round(bytes / 1024)} KB`
}

watch(() => props.modelValue, visible => {
  if (visible) {
    resetState()
  }
})

onUnmounted(() => {
  removeProgressListener?.()
})
</script>

<template>
  <BaseDialog
    :model-value="modelValue"
    title="发现新版本"
    width="520px"
    :closable="!isUpdating"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="update-dialog-content">
      <div class="update-hero">
        <div class="update-icon">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 3v12"/>
            <path d="m7 10 5 5 5-5"/>
            <path d="M5 21h14"/>
          </svg>
        </div>
        <div>
          <div class="update-title">CCGUI 有新版本可用</div>
          <div class="update-versions">
            <span>{{ updateInfo?.currentVersion }}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M5 12h14"/>
              <path d="m13 6 6 6-6 6"/>
            </svg>
            <span class="latest-version">{{ updateInfo?.latestVersion }}</span>
          </div>
        </div>
      </div>

      <div v-if="!canAutoUpdate && !isUpdating" class="update-notice">
        当前环境无法自动安装更新，请打开发布页手动下载。
      </div>

      <div v-if="isUpdating" class="update-progress">
        <div class="update-progress-header">
          <span>{{ updateProgress.message || '正在更新...' }}</span>
          <span v-if="updateProgress.downloadedBytes" class="update-progress-size">
            {{ formatBytes(updateProgress.downloadedBytes) }}
            <template v-if="updateProgress.totalBytes"> / {{ formatBytes(updateProgress.totalBytes) }}</template>
          </span>
        </div>
        <div v-if="progressPercent !== null" class="update-progress-track">
          <div class="update-progress-fill" :style="{ width: `${progressPercent}%` }"></div>
        </div>
      </div>

      <div v-if="updateError" class="update-error">
        {{ updateError }}
      </div>
    </div>

    <template #footer>
      <template v-if="!isUpdating">
        <BaseButton variant="ghost" @click="close">稍后</BaseButton>
        <BaseButton variant="secondary" @click="openReleasePage">打开发布页</BaseButton>
        <BaseButton variant="primary" :disabled="!canAutoUpdate" @click="startUpdate">更新</BaseButton>
      </template>
      <BaseButton v-else variant="primary" loading disabled>更新中...</BaseButton>
    </template>
  </BaseDialog>
</template>

<style scoped>
.update-dialog-content {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.update-hero {
  display: flex;
  align-items: center;
  gap: 14px;
}

.update-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 52px;
  height: 52px;
  border-radius: 14px;
  background: rgba(249, 115, 22, 0.12);
  color: #FB923C;
  flex-shrink: 0;
}

.update-title {
  color: var(--text-primary);
  font-size: 15px;
  font-weight: 600;
}

.update-versions {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-top: 7px;
  color: var(--text-muted);
  font-size: 12px;
}

.latest-version {
  color: #FB923C;
  font-weight: 600;
}

.update-notice,
.update-error {
  padding: 10px 12px;
  border-radius: 8px;
  font-size: 12px;
  line-height: 1.55;
}

.update-notice {
  border: 1px solid rgba(249, 115, 22, 0.24);
  background: rgba(249, 115, 22, 0.08);
  color: #FDBA74;
}

.update-error {
  border: 1px solid rgba(239, 68, 68, 0.28);
  background: rgba(239, 68, 68, 0.08);
  color: #FCA5A5;
  word-break: break-word;
}

.update-progress {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 12px;
  border: 1px solid var(--border-default);
  border-radius: 9px;
  background: var(--bg-secondary);
}

.update-progress-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--text-secondary);
  font-size: 12px;
}

.update-progress-size {
  color: var(--text-muted);
  white-space: nowrap;
}

.update-progress-track {
  height: 5px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--bg-tertiary);
}

.update-progress-fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #F97316, #FB923C);
  transition: width 0.2s ease;
}
</style>
