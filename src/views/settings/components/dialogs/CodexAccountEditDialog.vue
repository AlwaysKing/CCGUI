<script setup>
import { computed, ref, watch } from 'vue'

function generateAccountId() {
  return Date.now().toString() + Math.random().toString(36).slice(2, 9)
}

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  account: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['update:visible', 'save', 'close'])

const formData = ref({
  id: '',
  name: '',
  email: '',
  accountId: '',
  idToken: '',
  accessToken: '',
  refreshToken: '',
  lastRefresh: '',
  usage: null
})

function formatUsagePercent(value) {
  return Number.isFinite(value) ? `${Math.round(value)}%` : '未知'
}

const isEditing = computed(() => !!props.account)
const dialogTitle = computed(() => `${isEditing.value ? '编辑' : '添加'}Codex账号`)

function syncFormData() {
  if (props.account) {
    formData.value = {
      id: props.account.id || generateAccountId(),
      name: props.account.name || '',
      email: props.account.email || props.account.usage?.email || '',
      accountId: props.account.accountId || '',
      idToken: props.account.idToken || '',
      accessToken: props.account.accessToken || '',
      refreshToken: props.account.refreshToken || '',
      lastRefresh: props.account.lastRefresh || '',
      usage: props.account.usage || null
    }
    return
  }

  formData.value = {
    id: generateAccountId(),
    name: '',
    email: '',
    accountId: '',
    idToken: '',
    accessToken: '',
    refreshToken: '',
    lastRefresh: '',
    usage: null
  }
}

watch(() => props.visible, (visible) => {
  if (visible) {
    syncFormData()
  }
})

watch(() => props.account, syncFormData, { immediate: true, deep: true })

function handleClose() {
  emit('update:visible', false)
  emit('close')
}

function handleSave() {
  emit('save', { ...formData.value })
  handleClose()
}

async function handleAutoLoad() {
  try {
    const [tokenResult, usageResult] = await Promise.all([
      window.electronAPI.loadCodexAuthTokens(),
      window.electronAPI.getCodexUsageStatus()
    ])

    if (!tokenResult?.success) {
      alert('自动载入失败: ' + (tokenResult?.error || '未知错误'))
      return
    }

    formData.value = {
      ...formData.value,
      name: formData.value.name || (usageResult?.success ? (usageResult.usage?.email || '') : ''),
      email: usageResult?.success ? (usageResult.usage?.email || '') : formData.value.email,
      accountId: tokenResult.tokens?.accountId || '',
      idToken: tokenResult.tokens?.idToken || '',
      accessToken: tokenResult.tokens?.accessToken || '',
      refreshToken: tokenResult.tokens?.refreshToken || '',
      lastRefresh: tokenResult.tokens?.lastRefresh || '',
      usage: usageResult?.success ? (usageResult.usage || null) : null
    }
  } catch (error) {
    alert('自动载入失败: ' + error.message)
  }
}
</script>

<template>
  <div v-if="visible" class="dialog-overlay" @click="handleClose">
    <div class="account-dialog" @click.stop>
      <div class="dialog-header">
        <h2>{{ dialogTitle }}</h2>
        <button class="close-btn" @click="handleClose" title="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <div class="form-item">
          <label class="form-label">账号名称</label>
          <input v-model="formData.name" type="text" class="form-input" placeholder="例如: OpenAI 主账号">
        </div>

        <div class="form-item">
          <label class="form-label">账号 ID</label>
          <input v-model="formData.accountId" type="text" class="form-input" placeholder="account_id">
        </div>

        <div class="form-item">
          <label class="form-label">ID 令牌</label>
          <input v-model="formData.idToken" type="text" class="form-input" placeholder="id_token">
        </div>

        <div class="form-item">
          <label class="form-label">访问令牌</label>
          <input v-model="formData.accessToken" type="text" class="form-input" placeholder="access_token">
        </div>

        <div class="form-item">
          <label class="form-label">刷新令牌</label>
          <input v-model="formData.refreshToken" type="text" class="form-input" placeholder="refresh_token">
        </div>

        <div class="form-item">
          <label class="form-label">上次刷新时间</label>
          <input v-model="formData.lastRefresh" type="text" class="form-input" placeholder="last_refresh">
        </div>

        <div v-if="formData.usage" class="usage-panel">
          <div class="usage-panel-title">当前用量</div>
          <div class="usage-grid">
            <div class="usage-item">
              <span class="usage-label">邮箱</span>
              <span class="usage-value">{{ formData.email || formData.usage.email || '未知' }}</span>
            </div>
            <div class="usage-item">
              <span class="usage-label">套餐</span>
              <span class="usage-value">{{ formData.usage.planType || '未知' }}</span>
            </div>
            <div class="usage-item">
              <span class="usage-label">5小时已使用</span>
              <span class="usage-value">{{ formatUsagePercent(formData.usage.primaryWindow?.usedPercent) }}</span>
            </div>
            <div class="usage-item">
              <span class="usage-label">一周已使用</span>
              <span class="usage-value">{{ formatUsagePercent(formData.usage.secondaryWindow?.usedPercent) }}</span>
            </div>
            <div class="usage-item usage-item-full">
              <span class="usage-label">更新时间</span>
              <span class="usage-value">{{ formData.usage.updatedAt || '未知' }}</span>
            </div>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <button class="btn btn-secondary" @click="handleAutoLoad">自动载入</button>
        <div class="dialog-footer-actions">
          <button class="btn btn-secondary" @click="handleClose">取消</button>
          <button class="btn btn-primary" @click="handleSave">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}

.account-dialog {
  width: 680px;
  max-width: calc(100vw - 32px);
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background: #1F1F23;
  border-radius: 12px;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid #3F3F46;
}

.dialog-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #F4F4F5;
}

.close-btn {
  background: transparent;
  border: none;
  color: #9CA3AF;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.close-btn:hover {
  color: #F4F4F5;
  background: #3F3F46;
}

.dialog-body {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

.form-item {
  margin-bottom: 18px;
}

.form-label {
  display: block;
  margin-bottom: 8px;
  color: #F4F4F5;
  font-size: 14px;
  font-weight: 500;
}

.form-input {
  width: 100%;
  box-sizing: border-box;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  color: #F4F4F5;
  font-size: 14px;
  padding: 10px 12px;
}

.form-input:focus {
  outline: none;
  border-color: #F59E0B;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 24px;
  border-top: 1px solid #3F3F46;
}

.dialog-footer-actions {
  display: flex;
  align-items: center;
  gap: 12px;
}

.btn {
  padding: 10px 20px;
  border: none;
  border-radius: 8px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-secondary {
  background: #3F3F46;
  color: #F4F4F5;
}

.btn-secondary:hover {
  background: #52525B;
}

.btn-primary {
  background: #F97316;
  color: white;
}

.btn-primary:hover {
  background: #EA580C;
}

.usage-panel {
  margin-top: 8px;
  padding: 14px 16px;
  background: #232329;
  border: 1px solid #3F3F46;
  border-radius: 10px;
}

.usage-panel-title {
  margin-bottom: 10px;
  color: #F4F4F5;
  font-size: 13px;
  font-weight: 600;
}

.usage-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px 16px;
}

.usage-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.usage-item-full {
  grid-column: 1 / -1;
}

.usage-label {
  color: #A1A1AA;
  font-size: 12px;
}

.usage-value {
  color: #F4F4F5;
  font-size: 13px;
  word-break: break-all;
}
</style>
