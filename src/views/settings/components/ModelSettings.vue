<script setup>
/**
 * ModelSettings - 模型配置区域
 * 包含 Claude 和 Codex 独立的配置和模型供应商列表
 */
import { ref, computed, watch } from 'vue'
import SettingsSection from './common/SettingsSection.vue'
import SubsectionHeader from './common/SubsectionHeader.vue'
import DetailRow from './common/DetailRow.vue'
import SettingItem from './common/SettingItem.vue'
import { IconButton } from '@/components/base'

const props = defineProps({
  defaultConfig: {
    type: Object,
    required: true
  },
  codexConfig: {
    type: Object,
    default: () => ({})
  },
  claudeModels: {
    type: Array,
    default: () => []
  },
  codexModels: {
    type: Array,
    default: () => []
  },
  selectedClaudeModelId: {
    type: String,
    default: null
  },
  selectedCodexModelId: {
    type: String,
    default: null
  },
  effortOptions: {
    type: Array,
    default: () => [
      { value: 'default', label: '默认' },
      { value: 'low', label: '低' },
      { value: 'medium', label: '中' },
      { value: 'high', label: '高' }
    ]
  }
})

const emit = defineEmits([
  'edit-default-config',
  'edit-codex-config',
  'save-codex-proxy',
  'add-codex-account',
  'edit-codex-account',
  'delete-codex-account',
  'apply-codex-account',
  'select-claude-model',
  'select-codex-model',
  'edit-claude-model',
  'edit-codex-model',
  'delete-claude-model',
  'delete-codex-model',
  'add-claude-model',
  'add-codex-model',
  'set-claude-model-default-card',
  'set-codex-model-default-card',
  'toggle-claude-model-active',
  'toggle-codex-model-active',
  'apply-claude-model',
  'apply-codex-model'
])

// 令牌可见性
const activeProviderTab = ref('claude')
const showClaudeToken = ref(false)
const showCodexToken = ref(false)
const visibleClaudeModelTokens = ref(new Set())
const visibleCodexModelTokens = ref(new Set())
const visibleCodexAccountSecrets = ref(new Set())
const claudeModelsCollapsed = ref(true)
const codexAccountsCollapsed = ref(true)
const codexModelsCollapsed = ref(true)
const codexProxyDraft = ref('')

// 复制成功状态
const copiedKeys = ref(new Set())

// 检查是否有任何模型映射（不包括通用模型）
const hasAnyModelMapping = computed(() => {
  const config = props.defaultConfig
  return (
    (config.anthropicDefaultSonnetModel && config.anthropicDefaultSonnetModel !== '') ||
    (config.anthropicDefaultOpusModel && config.anthropicDefaultOpusModel !== '') ||
    (config.anthropicDefaultHaikuModel && config.anthropicDefaultHaikuModel !== '') ||
    (config.anthropicSmallFastModel && config.anthropicSmallFastModel !== '')
  )
})

const activeCodexAccount = computed(() => {
  const accounts = Array.isArray(props.codexConfig?.accounts) ? props.codexConfig.accounts : []
  const selectedId = props.codexConfig?.selectedAccountId || null
  return accounts.find(account => account.id === selectedId) || null
})

const activeCodexAccountLabel = computed(() => {
  if (activeCodexAccount.value?.name) {
    return activeCodexAccount.value.name
  }
  if (activeCodexAccount.value?.accountId) {
    return activeCodexAccount.value.accountId
  }
  return ''
})

function sortSelectedFirst(items, selectedId) {
  return [...items].sort((a, b) => {
    const aSelected = a?.id === selectedId ? 1 : 0
    const bSelected = b?.id === selectedId ? 1 : 0
    return bSelected - aSelected
  })
}

function sortModels(items, selectedId) {
  return [...items].sort((a, b) => {
    const aEnabled = a?.isActive !== false ? 1 : 0
    const bEnabled = b?.isActive !== false ? 1 : 0

    if (aEnabled !== bEnabled) {
      return bEnabled - aEnabled
    }

    const aSelected = a?.id === selectedId ? 1 : 0
    const bSelected = b?.id === selectedId ? 1 : 0
    return bSelected - aSelected
  })
}

const sortedClaudeModels = computed(() => {
  const models = Array.isArray(props.claudeModels) ? props.claudeModels : []
  return sortModels(models, props.selectedClaudeModelId)
})

const sortedCodexModels = computed(() => {
  const models = Array.isArray(props.codexModels) ? props.codexModels : []
  return sortModels(models, props.selectedCodexModelId)
})

const sortedCodexAccounts = computed(() => {
  const accounts = Array.isArray(props.codexConfig?.accounts) ? props.codexConfig.accounts : []
  return sortSelectedFirst(accounts, props.codexConfig?.selectedAccountId || null)
})

watch(
  () => props.codexConfig?.proxyUrl,
  (value) => {
    codexProxyDraft.value = value || ''
  },
  { immediate: true }
)

// 切换模型令牌可见性
function toggleClaudeModelToken(modelId) {
  if (visibleClaudeModelTokens.value.has(modelId)) {
    visibleClaudeModelTokens.value.delete(modelId)
  } else {
    visibleClaudeModelTokens.value.add(modelId)
  }
}

function toggleCodexModelToken(modelId) {
  if (visibleCodexModelTokens.value.has(modelId)) {
    visibleCodexModelTokens.value.delete(modelId)
  } else {
    visibleCodexModelTokens.value.add(modelId)
  }
}

function toggleCodexAccountSecret(key) {
  if (visibleCodexAccountSecrets.value.has(key)) {
    visibleCodexAccountSecrets.value.delete(key)
  } else {
    visibleCodexAccountSecrets.value.add(key)
  }
}

function getMaskedValue(value, visible) {
  if (!value) {
    return '未填写'
  }
  return visible ? value : '****'
}

function formatUsagePercent(value) {
  if (!Number.isFinite(value)) {
    return null
  }
  return `${Math.round(value)}%`
}

function getCodexAccountUsageBadges(account) {
  const badges = []
  const usage = account?.usage || null
  const primary = formatUsagePercent(usage?.primaryWindow?.usedPercent)
  const secondary = formatUsagePercent(usage?.secondaryWindow?.usedPercent)

  if (primary) {
    badges.push(`5h ${primary}`)
  }
  if (secondary) {
    badges.push(`7d ${secondary}`)
  }

  return badges
}

// 复制到剪贴板
async function copyToClipboard(text, key) {
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copiedKeys.value.add(key)
    setTimeout(() => {
      copiedKeys.value.delete(key)
    }, 1500)
  } catch (err) {
    console.error('复制失败:', err)
  }
}

function toggleSectionCollapse(section) {
  if (section === 'claude-models') {
    claudeModelsCollapsed.value = !claudeModelsCollapsed.value
    return
  }

  if (section === 'codex-accounts') {
    codexAccountsCollapsed.value = !codexAccountsCollapsed.value
    return
  }

  if (section === 'codex-models') {
    codexModelsCollapsed.value = !codexModelsCollapsed.value
  }
}
</script>

<template>
  <SettingsSection title="模型配置">
    <div class="provider-tabs" role="tablist" aria-label="模型提供商">
      <button
        type="button"
        class="provider-tab"
        :class="{ active: activeProviderTab === 'claude' }"
        @click="activeProviderTab = 'claude'"
      >
        Claude
      </button>
      <button
        type="button"
        class="provider-tab"
        :class="{ active: activeProviderTab === 'codex' }"
        @click="activeProviderTab = 'codex'"
      >
        Codex
      </button>
    </div>

    <div v-show="activeProviderTab === 'claude'" class="provider-panel">
      <h4 class="subsection-title">Claude</h4>
      <div class="default-config-card">
      <IconButton class="edit-btn-absolute" @click="emit('edit-default-config')" title="编辑">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </IconButton>
      <div class="default-config-details">
        <DetailRow label="API地址">
          <div class="value-with-copy">
            <span>{{ defaultConfig.apiUrl || '未配置' }}</span>
            <button
              v-if="defaultConfig.apiUrl"
              type="button"
              class="copy-btn"
              :class="{ copied: copiedKeys.has('claude-api') }"
              @click.stop="copyToClipboard(defaultConfig.apiUrl, 'claude-api')"
              :title="copiedKeys.has('claude-api') ? '已复制' : '复制'"
            >
              <svg v-if="copiedKeys.has('claude-api')" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
        </DetailRow>
        <DetailRow label="认证令牌">
          <div class="token-value">
            <button
              v-if="defaultConfig.authToken"
              type="button"
              class="token-toggle-btn"
              @click.stop="showClaudeToken = !showClaudeToken"
              :title="showClaudeToken ? '隐藏' : '显示'"
            >
              <svg v-if="showClaudeToken" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
            <span class="token-text" :class="{ 'has-toggle': defaultConfig.authToken }">
              {{ showClaudeToken && defaultConfig.authToken ? defaultConfig.authToken : (defaultConfig.authToken ? '••••••••' : '未配置') }}
            </span>
            <button
              v-if="defaultConfig.authToken"
              type="button"
              class="copy-btn"
              :class="{ copied: copiedKeys.has('claude-token') }"
              @click.stop="copyToClipboard(defaultConfig.authToken, 'claude-token')"
              :title="copiedKeys.has('claude-token') ? '已复制' : '复制'"
            >
              <svg v-if="copiedKeys.has('claude-token')" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
        </DetailRow>
        <DetailRow label="模型" :code="true">
          {{ defaultConfig.anthropicModel || defaultConfig.model || '系统默认' }}
        </DetailRow>
        <DetailRow v-if="defaultConfig.effort && defaultConfig.effort !== 'default'" label="思考力度">
          {{ effortOptions.find(o => o.value === defaultConfig.effort)?.label || defaultConfig.effort }}
        </DetailRow>
        <DetailRow v-if="hasAnyModelMapping" label="模型映射">
          <div class="model-metadata-badges">
            <span v-if="defaultConfig.anthropicDefaultSonnetModel" class="model-metadata-badge">
              SONNET:{{ defaultConfig.anthropicDefaultSonnetModel }}
            </span>
            <span v-if="defaultConfig.anthropicDefaultOpusModel" class="model-metadata-badge">
              OPUS:{{ defaultConfig.anthropicDefaultOpusModel }}
            </span>
            <span v-if="defaultConfig.anthropicDefaultHaikuModel" class="model-metadata-badge">
              HAIKU:{{ defaultConfig.anthropicDefaultHaikuModel }}
            </span>
            <span v-if="defaultConfig.anthropicSmallFastModel" class="model-metadata-badge">
              SMALL_FAST:{{ defaultConfig.anthropicSmallFastModel }}
            </span>
          </div>
        </DetailRow>
      </div>
      </div>

      <SubsectionHeader title="Claude 模型供应商列表" show-add-button add-button-title="添加 Claude 模型供应商" @add="emit('add-claude-model')">
        <template #actions>
          <IconButton
            class="no-border"
            @click="toggleSectionCollapse('claude-models')"
            :title="claudeModelsCollapsed ? '展开' : '折叠'"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="collapse-icon">
              <template v-if="claudeModelsCollapsed">
                <polyline points="9 18 3 12 9 6"/>
                <polyline points="15 18 21 12 15 6"/>
              </template>
              <template v-else>
                <polyline points="3 18 9 12 3 6"/>
                <polyline points="21 18 15 12 21 6"/>
              </template>
            </svg>
          </IconButton>
          <IconButton class="no-border" @click="emit('add-claude-model')" title="添加 Claude 模型供应商">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </IconButton>
        </template>
      </SubsectionHeader>

      <div class="model-list-container">
        <div v-if="claudeModels.length === 0" class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        <p class="empty-title">还未配置 Claude 模型供应商</p>
        <p class="empty-description">点击右侧的"+"按钮开始配置</p>
        </div>

        <div v-else class="model-list">
        <div
          v-for="model in sortedClaudeModels"
          :key="model.id"
          class="model-card"
          :class="{ selected: selectedClaudeModelId === model.id, inactive: model.isActive === false, collapsed: claudeModelsCollapsed }"
          @click="emit('select-claude-model', model.id)"
        >
          <div class="model-header">
            <h4 class="model-name">
              {{ model.friendlyName || '未命名模型' }}
              <button
                type="button"
                class="model-btn-activate"
                :class="{ active: model.isActive !== false }"
                @click.stop="emit('toggle-claude-model-active', { modelId: model.id, active: model.isActive === false })"
              >
                {{ model.isActive !== false ? '启用' : '停用' }}
              </button>
            </h4>
            <div class="model-actions">
              <IconButton @click.stop="emit('apply-claude-model', model)" title="应用">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </IconButton>
              <IconButton @click.stop="emit('edit-claude-model', model)" title="编辑">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </IconButton>
              <IconButton class="danger" @click.stop="emit('delete-claude-model', model.id)" title="删除">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </IconButton>
            </div>
          </div>

          <div v-if="!claudeModelsCollapsed" class="model-details">
            <DetailRow label="API地址">
              <div class="value-with-copy">
                <span>{{ model.apiUrl }}</span>
                <button
                  v-if="model.apiUrl"
                  type="button"
                  class="copy-btn"
                  :class="{ copied: copiedKeys.has('claude-api-' + model.id) }"
                  @click.stop="copyToClipboard(model.apiUrl, 'claude-api-' + model.id)"
                  :title="copiedKeys.has('claude-api-' + model.id) ? '已复制' : '复制'"
                >
                  <svg v-if="copiedKeys.has('claude-api-' + model.id)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </button>
              </div>
            </DetailRow>

            <DetailRow label="认证令牌">
              <div class="token-value">
                <button
                  v-if="model.authToken"
                  type="button"
                  class="token-toggle-btn"
                  @click.stop="toggleClaudeModelToken(model.id)"
                  :title="visibleClaudeModelTokens.has(model.id) ? '隐藏' : '显示'"
                >
                  <svg v-if="visibleClaudeModelTokens.has(model.id)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                  <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </button>
                <span class="token-text" :class="{ 'has-toggle': model.authToken }">
                  {{ visibleClaudeModelTokens.has(model.id) && model.authToken ? model.authToken : (model.authToken ? '••••••••' : '未配置') }}
                </span>
                <button
                  v-if="model.authToken"
                  type="button"
                  class="copy-btn"
                  :class="{ copied: copiedKeys.has('claude-token-' + model.id) }"
                  @click.stop="copyToClipboard(model.authToken, 'claude-token-' + model.id)"
                  :title="copiedKeys.has('claude-token-' + model.id) ? '已复制' : '复制'"
                >
                  <svg v-if="copiedKeys.has('claude-token-' + model.id)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </button>
              </div>
            </DetailRow>

            <DetailRow v-if="model.modelCards && model.modelCards.length > 0" label="模型列表">
              <span
                v-for="card in model.modelCards"
                :key="card.id"
                class="card-chip"
                :class="{ 'is-default': card.id === model.defaultCardId }"
                @click.stop="emit('set-claude-model-default-card', { modelId: model.id, cardId: card.id })"
              >{{ card.modelName || '未命名' }}</span>
            </DetailRow>
          </div>
        </div>
        </div>
      </div>
    </div>

    <div v-show="activeProviderTab === 'codex'" class="provider-panel">
      <h4 class="subsection-title">Codex 代理</h4>
      <div class="proxy-setting-panel">
        <SettingItem
          title="代理"
          description="为 Codex 在线请求配置 HTTP 或 SOCKS 代理，不填则直连。"
          vertical
        >
          <template #actions>
            <button class="btn-save" @click="emit('save-codex-proxy', codexProxyDraft)">
              保存
            </button>
          </template>
          <input
            v-model="codexProxyDraft"
            type="text"
            class="setting-input"
            placeholder="例如: http://127.0.0.1:7890"
          >
        </SettingItem>
      </div>

      <h4 class="subsection-title">Codex</h4>
      <div class="default-config-card">
      <IconButton class="edit-btn-absolute" @click="emit('edit-codex-config')" title="编辑">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </IconButton>
      <div class="default-config-details">
        <DetailRow label="API地址">
          <div class="value-with-copy">
            <span>{{ codexConfig.apiUrl || '未配置' }}</span>
            <button
              v-if="codexConfig.apiUrl"
              type="button"
              class="copy-btn"
              :class="{ copied: copiedKeys.has('codex-api') }"
              @click.stop="copyToClipboard(codexConfig.apiUrl, 'codex-api')"
              :title="copiedKeys.has('codex-api') ? '已复制' : '复制'"
            >
              <svg v-if="copiedKeys.has('codex-api')" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
        </DetailRow>
        <DetailRow label="认证令牌">
          <div class="token-value">
            <button
              v-if="codexConfig.authToken"
              type="button"
              class="token-toggle-btn"
              @click.stop="showCodexToken = !showCodexToken"
              :title="showCodexToken ? '隐藏' : '显示'"
            >
              <svg v-if="showCodexToken" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                <line x1="1" y1="1" x2="23" y2="23"/>
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                <circle cx="12" cy="12" r="3"/>
              </svg>
            </button>
            <span class="token-text" :class="{ 'has-toggle': codexConfig.authToken }">
              {{ showCodexToken && codexConfig.authToken ? codexConfig.authToken : (codexConfig.authToken ? '••••••••' : '未配置') }}
            </span>
            <button
              v-if="codexConfig.authToken"
              type="button"
              class="copy-btn"
              :class="{ copied: copiedKeys.has('codex-token') }"
              @click.stop="copyToClipboard(codexConfig.authToken, 'codex-token')"
              :title="copiedKeys.has('codex-token') ? '已复制' : '复制'"
            >
              <svg v-if="copiedKeys.has('codex-token')" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
              <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
        </DetailRow>
        <DetailRow v-if="activeCodexAccountLabel" label="账号">
          {{ activeCodexAccountLabel }}
        </DetailRow>
        <DetailRow label="模型" :code="true">
          {{ codexConfig.model || '系统默认' }}
        </DetailRow>
        <DetailRow label="思考力度">
          {{ effortOptions.find(o => o.value === codexConfig.modelReasoningEffort)?.label || codexConfig.modelReasoningEffort || '默认' }}
        </DetailRow>
      </div>
      </div>

      <SubsectionHeader title="Codex 账号列表" show-add-button add-button-title="添加 Codex 账号" @add="emit('add-codex-account')">
        <template #actions>
          <IconButton
            class="no-border"
            @click="toggleSectionCollapse('codex-accounts')"
            :title="codexAccountsCollapsed ? '展开' : '折叠'"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="collapse-icon">
              <template v-if="codexAccountsCollapsed">
                <polyline points="9 18 3 12 9 6"/>
                <polyline points="15 18 21 12 15 6"/>
              </template>
              <template v-else>
                <polyline points="3 18 9 12 3 6"/>
                <polyline points="21 18 15 12 21 6"/>
              </template>
            </svg>
          </IconButton>
          <IconButton class="no-border" @click="emit('add-codex-account')" title="添加 Codex 账号">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </IconButton>
        </template>
      </SubsectionHeader>

      <div class="model-list-container">
        <div v-if="(codexConfig.accounts || []).length === 0" class="empty-state compact">
          <p class="empty-title">还没有 Codex 账号</p>
          <p class="empty-description">点击右侧的“+”添加常用账号</p>
        </div>

        <div v-else class="model-list">
          <div
            v-for="account in sortedCodexAccounts"
            :key="account.id"
            class="model-card"
            :class="{ selected: codexConfig.selectedAccountId === account.id, collapsed: codexAccountsCollapsed }"
          >
            <div class="model-header">
              <h4 class="model-name">
                {{ account.name || '未命名账号' }}
                <span v-if="codexConfig.selectedAccountId === account.id" class="account-active-badge">激活</span>
                <span
                  v-for="badge in getCodexAccountUsageBadges(account)"
                  :key="`${account.id}-${badge}`"
                  class="account-usage-badge"
                >
                  {{ badge }}
                </span>
              </h4>
              <div class="model-actions">
                <IconButton @click.stop="emit('apply-codex-account', account)" title="设为当前账号">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                </IconButton>
                <IconButton @click.stop="emit('edit-codex-account', account)" title="编辑">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </IconButton>
                <IconButton class="danger" @click.stop="emit('delete-codex-account', account.id)" title="删除">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </IconButton>
              </div>
            </div>

            <div v-if="!codexAccountsCollapsed" class="model-details">
              <DetailRow label="账号名称">
                <span>{{ account.name || '未命名账号' }}</span>
              </DetailRow>
              <DetailRow v-if="account.usage?.planType" label="套餐">
                <span>{{ account.usage.planType }}</span>
              </DetailRow>
              <DetailRow label="账号 ID">
                <div class="token-value">
                  <button
                    v-if="account.accountId"
                    type="button"
                    class="token-toggle-btn"
                    @click.stop="toggleCodexAccountSecret(`${account.id}-account-id`)"
                    :title="visibleCodexAccountSecrets.has(`${account.id}-account-id`) ? '隐藏' : '显示'"
                  >
                    <svg v-if="visibleCodexAccountSecrets.has(`${account.id}-account-id`)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </button>
                  <span class="token-text" :class="{ 'has-toggle': account.accountId }">
                    {{ getMaskedValue(account.accountId, visibleCodexAccountSecrets.has(`${account.id}-account-id`)) }}
                  </span>
                  <button
                    v-if="account.accountId"
                    type="button"
                    class="copy-btn"
                    :class="{ copied: copiedKeys.has(`codex-account-id-${account.id}`) }"
                    @click.stop="copyToClipboard(account.accountId, `codex-account-id-${account.id}`)"
                    :title="copiedKeys.has(`codex-account-id-${account.id}`) ? '已复制' : '复制'"
                  >
                    <svg v-if="copiedKeys.has(`codex-account-id-${account.id}`)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </button>
                </div>
              </DetailRow>
              <DetailRow label="ID 令牌">
                <div class="token-value">
                  <button
                    v-if="account.idToken"
                    type="button"
                    class="token-toggle-btn"
                    @click.stop="toggleCodexAccountSecret(`${account.id}-id-token`)"
                    :title="visibleCodexAccountSecrets.has(`${account.id}-id-token`) ? '隐藏' : '显示'"
                  >
                    <svg v-if="visibleCodexAccountSecrets.has(`${account.id}-id-token`)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </button>
                  <span class="token-text" :class="{ 'has-toggle': account.idToken }">
                    {{ getMaskedValue(account.idToken, visibleCodexAccountSecrets.has(`${account.id}-id-token`)) }}
                  </span>
                  <button
                    v-if="account.idToken"
                    type="button"
                    class="copy-btn"
                    :class="{ copied: copiedKeys.has(`codex-id-token-${account.id}`) }"
                    @click.stop="copyToClipboard(account.idToken, `codex-id-token-${account.id}`)"
                    :title="copiedKeys.has(`codex-id-token-${account.id}`) ? '已复制' : '复制'"
                  >
                    <svg v-if="copiedKeys.has(`codex-id-token-${account.id}`)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </button>
                </div>
              </DetailRow>
              <DetailRow label="访问令牌">
                <div class="token-value">
                  <button
                    v-if="account.accessToken"
                    type="button"
                    class="token-toggle-btn"
                    @click.stop="toggleCodexAccountSecret(`${account.id}-access-token`)"
                    :title="visibleCodexAccountSecrets.has(`${account.id}-access-token`) ? '隐藏' : '显示'"
                  >
                    <svg v-if="visibleCodexAccountSecrets.has(`${account.id}-access-token`)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </button>
                  <span class="token-text" :class="{ 'has-toggle': account.accessToken }">
                    {{ getMaskedValue(account.accessToken, visibleCodexAccountSecrets.has(`${account.id}-access-token`)) }}
                  </span>
                  <button
                    v-if="account.accessToken"
                    type="button"
                    class="copy-btn"
                    :class="{ copied: copiedKeys.has(`codex-access-token-${account.id}`) }"
                    @click.stop="copyToClipboard(account.accessToken, `codex-access-token-${account.id}`)"
                    :title="copiedKeys.has(`codex-access-token-${account.id}`) ? '已复制' : '复制'"
                  >
                    <svg v-if="copiedKeys.has(`codex-access-token-${account.id}`)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </button>
                </div>
              </DetailRow>
              <DetailRow label="刷新令牌">
                <div class="token-value">
                  <button
                    v-if="account.refreshToken"
                    type="button"
                    class="token-toggle-btn"
                    @click.stop="toggleCodexAccountSecret(`${account.id}-refresh-token`)"
                    :title="visibleCodexAccountSecrets.has(`${account.id}-refresh-token`) ? '隐藏' : '显示'"
                  >
                    <svg v-if="visibleCodexAccountSecrets.has(`${account.id}-refresh-token`)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </button>
                  <span class="token-text" :class="{ 'has-toggle': account.refreshToken }">
                    {{ getMaskedValue(account.refreshToken, visibleCodexAccountSecrets.has(`${account.id}-refresh-token`)) }}
                  </span>
                  <button
                    v-if="account.refreshToken"
                    type="button"
                    class="copy-btn"
                    :class="{ copied: copiedKeys.has(`codex-refresh-token-${account.id}`) }"
                    @click.stop="copyToClipboard(account.refreshToken, `codex-refresh-token-${account.id}`)"
                    :title="copiedKeys.has(`codex-refresh-token-${account.id}`) ? '已复制' : '复制'"
                  >
                    <svg v-if="copiedKeys.has(`codex-refresh-token-${account.id}`)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </button>
                </div>
              </DetailRow>
              <DetailRow v-if="account.lastRefresh" label="令牌刷新时间">
                <span>{{ account.lastRefresh }}</span>
              </DetailRow>
              <DetailRow v-if="account.usage?.updatedAt" label="用量刷新时间">
                <span>{{ account.usage.updatedAt }}</span>
              </DetailRow>
            </div>
          </div>
        </div>
      </div>

      <SubsectionHeader title="Codex 模型供应商列表" show-add-button add-button-title="添加 Codex 模型供应商" @add="emit('add-codex-model')">
        <template #actions>
          <IconButton
            class="no-border"
            @click="toggleSectionCollapse('codex-models')"
            :title="codexModelsCollapsed ? '展开' : '折叠'"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="collapse-icon">
              <template v-if="codexModelsCollapsed">
                <polyline points="9 18 3 12 9 6"/>
                <polyline points="15 18 21 12 15 6"/>
              </template>
              <template v-else>
                <polyline points="3 18 9 12 3 6"/>
                <polyline points="21 18 15 12 21 6"/>
              </template>
            </svg>
          </IconButton>
          <IconButton class="no-border" @click="emit('add-codex-model')" title="添加 Codex 模型供应商">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="12" y1="5" x2="12" y2="19"/>
              <line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </IconButton>
        </template>
      </SubsectionHeader>

      <div class="model-list-container">
        <div v-if="codexModels.length === 0" class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        <p class="empty-title">还未配置 Codex 模型供应商</p>
        <p class="empty-description">点击右侧的"+"按钮开始配置</p>
        </div>

        <div v-else class="model-list">
        <div
          v-for="model in sortedCodexModels"
          :key="model.id"
          class="model-card"
          :class="{ selected: selectedCodexModelId === model.id, inactive: model.isActive === false, collapsed: codexModelsCollapsed }"
          @click="emit('select-codex-model', model.id)"
        >
          <div class="model-header">
            <h4 class="model-name">
              {{ model.friendlyName || '未命名模型' }}
              <button
                type="button"
                class="model-btn-activate"
                :class="{ active: model.isActive !== false }"
                @click.stop="emit('toggle-codex-model-active', { modelId: model.id, active: model.isActive === false })"
              >
                {{ model.isActive !== false ? '启用' : '停用' }}
              </button>
            </h4>
            <div class="model-actions">
              <IconButton @click.stop="emit('apply-codex-model', model)" title="应用">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </IconButton>
              <IconButton @click.stop="emit('edit-codex-model', model)" title="编辑">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </IconButton>
              <IconButton class="danger" @click.stop="emit('delete-codex-model', model.id)" title="删除">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </IconButton>
            </div>
          </div>

          <div v-if="!codexModelsCollapsed" class="model-details">
            <DetailRow label="API地址">
              <div class="value-with-copy">
                <span>{{ model.apiUrl }}</span>
                <button
                  v-if="model.apiUrl"
                  type="button"
                  class="copy-btn"
                  :class="{ copied: copiedKeys.has('codex-api-' + model.id) }"
                  @click.stop="copyToClipboard(model.apiUrl, 'codex-api-' + model.id)"
                  :title="copiedKeys.has('codex-api-' + model.id) ? '已复制' : '复制'"
                >
                  <svg v-if="copiedKeys.has('codex-api-' + model.id)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </button>
              </div>
            </DetailRow>

            <DetailRow label="认证令牌">
              <div class="token-value">
                <button
                  v-if="model.authToken"
                  type="button"
                  class="token-toggle-btn"
                  @click.stop="toggleCodexModelToken(model.id)"
                  :title="visibleCodexModelTokens.has(model.id) ? '隐藏' : '显示'"
                >
                  <svg v-if="visibleCodexModelTokens.has(model.id)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                  <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                </button>
                <span class="token-text" :class="{ 'has-toggle': model.authToken }">
                  {{ visibleCodexModelTokens.has(model.id) && model.authToken ? model.authToken : (model.authToken ? '••••••••' : '未配置') }}
                </span>
                <button
                  v-if="model.authToken"
                  type="button"
                  class="copy-btn"
                  :class="{ copied: copiedKeys.has('codex-token-' + model.id) }"
                  @click.stop="copyToClipboard(model.authToken, 'codex-token-' + model.id)"
                  :title="copiedKeys.has('codex-token-' + model.id) ? '已复制' : '复制'"
                >
                  <svg v-if="copiedKeys.has('codex-token-' + model.id)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                  <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                  </svg>
                </button>
              </div>
            </DetailRow>

            <DetailRow v-if="model.modelCards && model.modelCards.length > 0" label="模型列表">
              <span
                v-for="card in model.modelCards"
                :key="card.id"
                class="card-chip"
                :class="{ 'is-default': card.id === model.defaultCardId }"
                @click.stop="emit('set-codex-model-default-card', { modelId: model.id, cardId: card.id })"
              >{{ card.modelName || '未命名' }}</span>
            </DetailRow>
          </div>
        </div>
        </div>
      </div>
    </div>
  </SettingsSection>
</template>

<style scoped>
.provider-tabs {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px;
  background: #1F1F23;
  border: 1px solid #34343A;
  border-radius: 12px;
  margin-bottom: 18px;
}

.provider-tab {
  border: none;
  background: transparent;
  color: #A1A1AA;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  padding: 10px 16px;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
}

.provider-tab:hover {
  color: #F4F4F5;
  background: rgba(255, 255, 255, 0.05);
}

.provider-tab.active {
  color: #18181B;
  background: #F59E0B;
}

.provider-panel {
  min-width: 0;
}

.empty-state.compact {
  padding: 28px 20px;
}

.subsection-title {
  font-size: 15px;
  font-weight: 600;
  color: #D1D5DB;
  margin: 20px 0 12px;
}

.subsection-title:first-of-type {
  margin-top: 0;
}

.default-config-card {
  background: var(--app-soft-panel);
  border: 1px solid var(--app-soft-panel-border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
  position: relative;
}

.proxy-setting-panel {
  background: var(--app-soft-panel);
  border: 1px solid var(--app-soft-panel-border);
  border-radius: 8px;
  padding: 0 16px;
  margin-bottom: 24px;
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

.btn-save {
  padding: 6px 12px;
  font-size: 12px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  background: #F97316;
  border: 1px solid #F97316;
  color: white;
}

.btn-save:hover {
  background: #EA580C;
  border-color: #EA580C;
}

.edit-btn-absolute {
  position: absolute;
  top: 12px;
  right: 12px;
}

.model-list-container {
  background: var(--app-soft-panel);
  border: 1px solid var(--app-soft-panel-border);
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
}

.empty-state svg {
  color: #52525B;
  margin-bottom: 16px;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: #9CA3AF;
  margin: 0 0 8px;
}

.empty-description {
  font-size: 13px;
  color: #71717A;
  margin: 0;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.model-card {
  background: var(--app-soft-surface);
  border: 1px solid var(--app-soft-border);
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.model-card:hover {
  background: var(--app-soft-surface-hover);
  border-color: var(--app-soft-border-hover);
}

.model-card.selected {
  background: var(--app-soft-surface-hover);
}

.model-card.inactive {
  opacity: 0.5;
}

.model-card.inactive:hover {
  opacity: 0.7;
}

.model-card.collapsed {
  padding: 14px 16px;
}

.account-active-badge {
  display: inline-flex;
  align-items: center;
  margin-left: 8px;
  padding: 1px 8px;
  border-radius: 4px;
  border: 1px solid #F97316;
  background: #F97316;
  color: #fff;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  vertical-align: middle;
}

.account-usage-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 8px;
  border-radius: 999px;
  border: 1px solid #3F3F46;
  background: #27272A;
  color: #E4E4E7;
  font-size: 11px;
  font-weight: 600;
  line-height: 1.2;
  vertical-align: middle;
}

.model-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.model-card.collapsed .model-header {
  margin-bottom: 0;
}

.model-name {
  flex: 1;
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #F4F4F5;
  display: flex;
  align-items: center;
  gap: 8px;
}

.model-btn-activate {
  font-size: 11px;
  color: #6B7280;
  background: transparent;
  border: 1px solid #52525B;
  border-radius: 4px;
  padding: 1px 8px;
  cursor: pointer;
  transition: all 0.2s;
}

.model-btn-activate:hover {
  color: #9CA3AF;
  border-color: #71717A;
}

.model-btn-activate.active {
  color: #fff;
  background: #F97316;
  border-color: #F97316;
}

.model-btn-activate.active:hover {
  background: #EA580C;
}

.model-actions {
  display: flex;
  gap: 8px;
}

.model-actions .danger:hover {
  color: #EF4444;
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

.collapse-icon {
  transform: rotate(90deg);
}

.token-value {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.value-with-copy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: text;
}

.copy-btn {
  background: transparent;
  border: none;
  padding: 2px;
  cursor: pointer;
  color: #71717A;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
  opacity: 0;
}

.value-with-copy:hover .copy-btn,
.token-value:hover .copy-btn {
  opacity: 1;
}

.copy-btn:hover {
  color: #F97316;
}

.copy-btn.copied {
  color: #22C55E;
  opacity: 1;
}

.token-toggle-btn {
  position: absolute;
  left: -22px;
  top: 50%;
  transform: translateY(-50%);
  background: transparent;
  border: none;
  padding: 2px;
  cursor: pointer;
  color: #71717A;
  opacity: 0;
  transition: all 0.2s;
}

.token-value:hover .token-toggle-btn {
  opacity: 1;
}

.token-toggle-btn:hover {
  color: #9CA3AF;
}

.token-text {
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  font-size: 12px;
  cursor: text;
}

.token-text.has-toggle {
  padding-left: 0;
}

.model-metadata-badges {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.model-metadata-badge {
  font-size: 11px;
  color: #9CA3AF;
  background: rgba(156, 163, 175, 0.1);
  border: 1px solid rgba(156, 163, 175, 0.2);
  border-radius: 4px;
  padding: 2px 8px;
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
}

.card-chip {
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  font-size: 12px;
  color: #FB923C;
  background: rgba(251, 146, 60, 0.1);
  padding: 2px 8px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
  margin-right: 6px;
}

.card-chip:last-child {
  margin-right: 0;
}

.card-chip:hover {
  background: rgba(251, 146, 60, 0.2);
}

.card-chip.is-default {
  background: #F97316;
  color: #fff;
}
</style>
