<script setup>
import { computed, ref, watch } from 'vue'
import { Toggle } from '@/components/base'
import AppSelect from '@/components/base/AppSelect.vue'
import SettingsSection from './common/SettingsSection.vue'
import SettingItem from './common/SettingItem.vue'

const DEFAULT_USER_MESSAGE_LIMIT = 20
const MIN_USER_MESSAGE_LIMIT = 5
const MAX_USER_MESSAGE_LIMIT = 100

const props = defineProps({
  settings: {
    type: Object,
    required: true
  },
  claudeModels: {
    type: Array,
    default: () => []
  },
  codexModels: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update:settings', 'save-settings'])

const aiAssist = computed(() => {
  const value = props.settings?.aiAssist
  return value && typeof value === 'object' ? value : {}
})

const summaryFeature = computed(() => {
  const value = aiAssist.value?.features?.sessionSummary
  return value && typeof value === 'object' ? value : {}
})

const masterEnabled = computed(() => aiAssist.value.enabled === true)

const protocolOptions = [
  { value: 'claude', label: 'Claude' },
  { value: 'codex', label: 'Codex / OpenAI' }
]

const activeProtocol = computed(() => aiAssist.value.provider === 'codex' ? 'codex' : 'claude')

const providerModels = computed(() => {
  const source = activeProtocol.value === 'codex' ? props.codexModels : props.claudeModels
  return Array.isArray(source)
    ? source.filter(model => model?.id && model?.isActive !== false)
    : []
})

const providerOptions = computed(() => {
  return providerModels.value.map(model => ({
    value: model.id,
    label: model.friendlyName || model.id
  }))
})

const selectedProvider = computed(() => {
  return providerModels.value.find(model => model.id === aiAssist.value.modelId) || null
})

const selectedProviderValue = computed(() => selectedProvider.value?.id || '')

const modelOptions = computed(() => {
  const cards = Array.isArray(selectedProvider.value?.modelCards)
    ? selectedProvider.value.modelCards
    : []
  return cards
    .filter(card => card?.id && card?.modelName)
    .map(card => ({
      value: card.id,
      label: card.modelName,
      description: card.modelName
    }))
})

const selectedModelValue = computed(() => {
  if (!selectedProvider.value) {
    return ''
  }
  const cards = providerModels.value
    .find(model => model.id === selectedProvider.value.id)
    ?.modelCards || []
  const card = cards.find(item => item.id === aiAssist.value.modelCardId)
    || cards.find(item => item.id === selectedProvider.value.defaultCardId)
    || cards[0]
  return card?.id || ''
})

const summaryEnabled = computed(() => summaryFeature.value.enabled === true)
const userMessageLimit = computed(() => {
  const parsed = Number.parseInt(summaryFeature.value.userMessageLimit, 10)
  return Number.isFinite(parsed) ? parsed : DEFAULT_USER_MESSAGE_LIMIT
})
const messageLimitDraft = ref(String(userMessageLimit.value))

watch(userMessageLimit, value => {
  messageLimitDraft.value = String(value)
}, { immediate: true })

function buildNextSettings(nextAiAssist, nextSummaryFeature = {}) {
  const currentAiAssist = aiAssist.value
  const currentFeatures = currentAiAssist.features && typeof currentAiAssist.features === 'object'
    ? currentAiAssist.features
    : {}
  const currentSummary = summaryFeature.value

  return {
    ...props.settings,
    aiAssist: {
      ...currentAiAssist,
      ...nextAiAssist,
      features: {
        ...currentFeatures,
        ...(nextAiAssist.features || {}),
        sessionSummary: {
          ...currentSummary,
          ...nextSummaryFeature
        }
      }
    }
  }
}

function updateSettings(nextSettings, autoSave = false) {
  emit('update:settings', nextSettings)
  if (autoSave) {
    emit('save-settings')
  }
}

function updateAiAssist(patch, autoSave = false) {
  updateSettings(buildNextSettings(patch), autoSave)
}

function updateSummaryFeature(patch, autoSave = false) {
  updateSettings(buildNextSettings({}, patch), autoSave)
}

function handleToggleAssist(enabled) {
  updateAiAssist({ enabled }, true)
}

function handleProtocolChange(protocol) {
  const models = protocol === 'codex' ? props.codexModels : props.claudeModels
  const firstModel = Array.isArray(models)
    ? models.find(model => model?.id && model?.isActive !== false) || null
    : null
  const cards = Array.isArray(firstModel?.modelCards) ? firstModel.modelCards : []
  const defaultCard = cards.find(card => card.id === firstModel?.defaultCardId) || cards[0] || null

  updateAiAssist({
    provider: protocol,
    modelId: firstModel?.id || null,
    modelCardId: defaultCard?.id || null
  }, true)
}

function handleProviderChange(modelId) {
  const model = providerModels.value.find(item => item.id === modelId)
  if (!model) {
    return
  }
  const cards = Array.isArray(model.modelCards) ? model.modelCards : []
  const defaultCard = cards.find(card => card.id === model.defaultCardId) || cards[0] || null

  updateAiAssist({
    modelId: model.id,
    modelCardId: defaultCard?.id || null
  }, true)
}

function handleModelChange(modelCardId) {
  if (!modelCardId) {
    return
  }
  updateAiAssist({ modelCardId }, true)
}

function handleToggleSummary(enabled) {
  updateSummaryFeature({ enabled }, true)
}

function clampMessageLimit(value) {
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed)) {
    return DEFAULT_USER_MESSAGE_LIMIT
  }
  return Math.min(MAX_USER_MESSAGE_LIMIT, Math.max(MIN_USER_MESSAGE_LIMIT, parsed))
}

function commitMessageLimit() {
  const nextLimit = clampMessageLimit(messageLimitDraft.value)
  messageLimitDraft.value = String(nextLimit)
  if (nextLimit === userMessageLimit.value) {
    return
  }
  updateSummaryFeature({ userMessageLimit: nextLimit }, true)
}
</script>

<template>
  <SettingsSection title="AI 辅助">
    <SettingItem
      title="启用 AI 辅助功能"
      description="总开关关闭时不会发起任何 AI 辅助请求"
    >
      <Toggle
        :model-value="masterEnabled"
        @update:model-value="handleToggleAssist"
      />
    </SettingItem>

    <SettingItem
      title="AI 辅助功能模型"
      description="直接调用所选供应商的原始模型 API，不启动 Claude Code 或 Codex 会话"
      vertical
    >
      <div class="model-picker">
        <span class="field-label">协议</span>
        <AppSelect
          :model-value="activeProtocol"
          class="protocol-select"
          :options="protocolOptions"
          :disabled="!masterEnabled"
          @update:model-value="handleProtocolChange"
        />
        <span class="field-label">供应商</span>
        <AppSelect
          :model-value="selectedProviderValue"
          class="provider-select"
          :options="providerOptions"
          :disabled="!masterEnabled || providerOptions.length === 0"
          :placeholder="providerOptions.length === 0 ? '请先配置模型供应商' : '选择供应商'"
          @update:model-value="handleProviderChange"
        />
        <span class="field-label">模型</span>
        <AppSelect
          :model-value="selectedModelValue"
          class="model-select"
          :options="modelOptions"
          :disabled="!masterEnabled || !selectedProviderValue || modelOptions.length === 0"
          :placeholder="selectedProviderValue ? '选择模型' : '请先选择供应商'"
          @update:model-value="handleModelChange"
        />
      </div>
    </SettingItem>

    <SettingItem
      title="会话摘要"
      :description="selectedModelValue
        ? '每次发送用户消息后，后台生成约 20 字的当前任务摘要'
        : '请先选择可用 AI 模型'"
    >
      <Toggle
        :model-value="summaryEnabled"
        :disabled="!masterEnabled || !selectedModelValue"
        @update:model-value="handleToggleSummary"
      />
    </SettingItem>

    <SettingItem
      title="参与会话摘要数量"
      description="只发送用户消息，不包含 Agent 回复、工具结果或系统消息"
    >
      <div class="limit-control">
        <input
          v-model="messageLimitDraft"
          class="limit-input"
          type="number"
          inputmode="numeric"
          :min="MIN_USER_MESSAGE_LIMIT"
          :max="MAX_USER_MESSAGE_LIMIT"
          step="1"
          :disabled="!masterEnabled"
          @blur="commitMessageLimit"
          @keydown.enter.prevent="$event.target.blur()"
        >
        <span class="limit-suffix">条</span>
      </div>
    </SettingItem>

  </SettingsSection>
</template>

<style scoped>
.model-picker {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  width: 100%;
}

.field-label {
  flex-shrink: 0;
  color: #A1A1AA;
  font-size: 13px;
}

.protocol-select {
  flex: 0.8;
  min-width: 150px;
}

.provider-select {
  flex: 1;
  min-width: 160px;
}

.model-select {
  flex: 1;
  min-width: 160px;
}

.limit-control {
  display: flex;
  align-items: center;
  gap: 8px;
}

.limit-input {
  width: 84px;
  background: var(--app-soft-surface);
  border: 1px solid var(--app-soft-border);
  border-radius: 8px;
  padding: 8px 10px;
  color: #F4F4F5;
  font-size: 13px;
  text-align: right;
}

.limit-input:focus {
  outline: none;
  border-color: #F97316;
  background: var(--app-soft-surface-hover);
}

.limit-input:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.limit-suffix {
  color: #A1A1AA;
  font-size: 13px;
}

</style>
