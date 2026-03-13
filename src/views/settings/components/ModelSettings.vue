<script setup>
/**
 * ModelSettings - 模型配置区域
 * 包含 Claude 默认配置和自定义模型列表
 */
import { ref, computed } from 'vue'
import { SettingsSection, SubsectionHeader, DetailRow } from './common'
import { IconButton } from '@/components/common'

const props = defineProps({
  defaultConfig: {
    type: Object,
    required: true
  },
  models: {
    type: Array,
    default: () => []
  },
  selectedModelId: {
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
  'select-model',
  'edit-model',
  'delete-model',
  'add-model',
  'set-model-default-card'
])

// 令牌可见性
const showClaudeToken = ref(false)
const visibleModelTokens = ref(new Set())

// 悬停状态
const hoveredModelId = ref(null)

// 检查是否有任何模型映射
const hasAnyModelMapping = computed(() => {
  const config = props.defaultConfig
  return (
    (config.anthropicModel && config.anthropicModel !== '') ||
    (config.anthropicDefaultSonnetModel && config.anthropicDefaultSonnetModel !== '') ||
    (config.anthropicDefaultOpusModel && config.anthropicDefaultOpusModel !== '') ||
    (config.anthropicDefaultHaikuModel && config.anthropicDefaultHaikuModel !== '') ||
    (config.anthropicSmallFastModel && config.anthropicSmallFastModel !== '')
  )
})

// 切换模型令牌可见性
function toggleModelToken(modelId) {
  if (visibleModelTokens.value.has(modelId)) {
    visibleModelTokens.value.delete(modelId)
  } else {
    visibleModelTokens.value.add(modelId)
  }
}

// 检查模型是否有多个卡片
function hasMultipleCards(model) {
  return model.modelCards && model.modelCards.length > 1
}

// 获取默认卡片
function getDefaultCard(model) {
  if (!model.modelCards || model.modelCards.length === 0) return null
  return model.modelCards.find(card => card.id === model.defaultCardId) || model.modelCards[0]
}
</script>

<template>
  <SettingsSection title="模型配置">
    <!-- Claude 默认配置 -->
    <h4 class="subsection-title">Claude</h4>
    <div class="default-config-card">
      <IconButton class="edit-btn-absolute" @click="emit('edit-default-config')" title="编辑">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </IconButton>
      <div class="default-config-details">
        <DetailRow label="API地址">{{ defaultConfig.apiUrl || '未配置' }}</DetailRow>
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
            <span class="token-text">
              {{ showClaudeToken && defaultConfig.authToken ? defaultConfig.authToken : (defaultConfig.authToken ? '••••••••' : '未配置') }}
            </span>
          </div>
        </DetailRow>
        <DetailRow label="模型" :code="true">
          {{ defaultConfig.anthropicModel || defaultConfig.model || '系统默认' }}
        </DetailRow>
        <DetailRow v-if="defaultConfig.effort && defaultConfig.effort !== 'default'" label="思考力度">
          {{ effortOptions.find(o => o.value === defaultConfig.effort)?.label || defaultConfig.effort }}
        </DetailRow>
        <DetailRow label="模型映射">
          <div class="model-metadata-badges">
            <span v-if="defaultConfig.anthropicModel" class="model-metadata-badge">
              通用:{{ defaultConfig.anthropicModel }}
            </span>
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
            <span v-if="!hasAnyModelMapping" class="no-mapping">未配置</span>
          </div>
        </DetailRow>
      </div>
    </div>

    <!-- 模型列表 -->
    <SubsectionHeader title="模型列表" show-add-button add-button-title="添加模型" @add="emit('add-model')" />

    <div class="model-list-container">
      <div v-if="models.length === 0" class="empty-state">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        <p class="empty-title">还未配置大模型</p>
        <p class="empty-description">点击右侧的"+"按钮开始配置</p>
      </div>

      <div v-else class="model-list">
        <div
          v-for="model in models"
          :key="model.id"
          class="model-card"
          :class="{ selected: selectedModelId === model.id }"
          @click="emit('select-model', model.id)"
          @mouseenter="hoveredModelId = model.id"
          @mouseleave="hoveredModelId = null"
        >
          <div class="model-header">
            <h4 class="model-name">
              {{ model.friendlyName || '未命名模型' }}
              <span v-if="model.isDefault" class="model-default-badge">默认</span>
              <button
                v-else-if="hoveredModelId === model.id"
                type="button"
                class="model-btn-set-default"
                @click.stop="emit('set-model-default', model.id)"
              >
                设为默认
              </button>
            </h4>
            <div class="model-actions">
              <IconButton @click.stop="emit('edit-model', model)" title="编辑">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </IconButton>
              <IconButton class="danger" @click.stop="emit('delete-model', model.id)" title="删除">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </IconButton>
            </div>
          </div>

          <!-- 模型详情 -->
          <div class="model-details">
            <!-- 新格式：有 modelCards -->
            <template v-if="model.modelCards && model.modelCards.length > 0">
              <DetailRow label="API地址">{{ model.apiUrl }}</DetailRow>
              <DetailRow label="认证令牌">
                <div class="token-value">
                  <button
                    v-if="model.authToken"
                    type="button"
                    class="token-toggle-btn"
                    @click.stop="toggleModelToken(model.id)"
                    :title="visibleModelTokens.has(model.id) ? '隐藏' : '显示'"
                  >
                    <svg v-if="visibleModelTokens.has(model.id)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </button>
                  <span class="token-text">
                    {{ visibleModelTokens.has(model.id) && model.authToken ? model.authToken : (model.authToken ? '••••••••' : '未配置') }}
                  </span>
                </div>
              </DetailRow>

              <!-- 多卡片时显示卡片列表 -->
              <div v-if="hasMultipleCards(model)" class="model-cards-section">
                <div
                  v-for="card in model.modelCards"
                  :key="card.id"
                  class="model-card-tag"
                  :class="{ 'is-default': card.id === model.defaultCardId }"
                  @click.stop="emit('set-model-default-card', { modelId: model.id, cardId: card.id })"
                >
                  <span class="card-name">{{ card.modelName || '未命名' }}</span>
                  <span v-if="card.id === model.defaultCardId" class="default-indicator">默认</span>
                </div>
              </div>

              <!-- 单卡片时直接显示 -->
              <template v-else-if="getDefaultCard(model)">
                <DetailRow label="模型名称" :code="true">{{ getDefaultCard(model).modelName }}</DetailRow>
                <DetailRow v-if="getDefaultCard(model).pricingCache || getDefaultCard(model).pricingInput || getDefaultCard(model).pricingOutput" label="计费标准">
                  <span v-if="getDefaultCard(model).pricingCache">Cache: ${{ getDefaultCard(model).pricingCache }}/M</span>
                  <span v-if="getDefaultCard(model).pricingInput"> | Input: ${{ getDefaultCard(model).pricingInput }}/M</span>
                  <span v-if="getDefaultCard(model).pricingOutput"> | Output: ${{ getDefaultCard(model).pricingOutput }}/M</span>
                </DetailRow>
              </template>
            </template>

            <!-- 兼容旧格式 -->
            <template v-else-if="model.modelName">
              <DetailRow label="模型名称" :code="true">{{ model.modelName }}</DetailRow>
              <DetailRow v-if="model.pricingCache || model.pricingInput || model.pricingOutput" label="计费标准">
                <span v-if="model.pricingCache">Cache: ${{ model.pricingCache }}/M</span>
                <span v-if="model.pricingInput"> | Input: ${{ model.pricingInput }}/M</span>
                <span v-if="model.pricingOutput"> | Output: ${{ model.pricingOutput }}/M</span>
              </DetailRow>
            </template>
          </div>
        </div>
      </div>
    </div>
  </SettingsSection>
</template>

<style scoped>
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
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
  position: relative;
}

.edit-btn-absolute {
  position: absolute;
  top: 12px;
  right: 12px;
}

.model-list-container {
  background: #27272A;
  border: 1px solid #3F3F46;
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
  background: #1F1F23;
  border: 2px solid #3F3F46;
  border-radius: 8px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s;
}

.model-card:hover {
  background: #2D2D30;
  border-color: #52525B;
}

.model-card.selected {
  background: #2D2D30;
  border-color: #F97316;
}

.model-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
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

.model-default-badge {
  font-size: 11px;
  color: #F97316;
  background: rgba(249, 115, 22, 0.1);
  border: 1px solid rgba(249, 115, 22, 0.3);
  border-radius: 4px;
  padding: 1px 6px;
  font-weight: 500;
}

.model-btn-set-default {
  font-size: 11px;
  color: #6B7280;
  background: transparent;
  border: none;
  padding: 0 4px;
  cursor: pointer;
}

.model-btn-set-default:hover {
  color: #9CA3AF;
}

.model-actions {
  display: flex;
  gap: 8px;
}

.model-actions .danger:hover {
  color: #EF4444;
}

.token-value {
  display: flex;
  align-items: center;
  gap: 8px;
}

.token-toggle-btn {
  background: transparent;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: #71717A;
}

.token-toggle-btn:hover {
  color: #9CA3AF;
}

.token-text {
  font-family: 'SF Mono', 'Monaco', 'Menlo', monospace;
  font-size: 12px;
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

.no-mapping {
  color: #71717A;
  font-size: 12px;
}

.model-cards-section {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding-top: 8px;
  border-top: 1px solid #3F3F46;
  margin-top: 8px;
}

.model-card-tag {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.2s;
}

.model-card-tag:hover {
  border-color: #52525B;
}

.model-card-tag.is-default {
  border-color: #F97316;
  background: rgba(249, 115, 22, 0.1);
}

.card-name {
  font-size: 12px;
  color: #D1D5DB;
}

.default-indicator {
  font-size: 10px;
  color: #F97316;
}
</style>
