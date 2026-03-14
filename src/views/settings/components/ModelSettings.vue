<script setup>
/**
 * ModelSettings - 模型配置区域
 * 包含 Claude 默认配置和自定义模型列表
 */
import { ref, computed } from 'vue'
import SettingsSection from './common/SettingsSection.vue'
import SubsectionHeader from './common/SubsectionHeader.vue'
import DetailRow from './common/DetailRow.vue'
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
  'set-model-default-card',
  'toggle-model-active',
  'apply-model'
])

// 令牌可见性
const showClaudeToken = ref(false)
const visibleModelTokens = ref(new Set())

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

// 切换模型令牌可见性
function toggleModelToken(modelId) {
  if (visibleModelTokens.value.has(modelId)) {
    visibleModelTokens.value.delete(modelId)
  } else {
    visibleModelTokens.value.add(modelId)
  }
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
          :class="{ selected: selectedModelId === model.id, inactive: model.isActive === false }"
          @click="emit('select-model', model.id)"
        >
          <div class="model-header">
            <h4 class="model-name">
              {{ model.friendlyName || '未命名模型' }}
              <button
                type="button"
                class="model-btn-activate"
                :class="{ active: model.isActive !== false }"
                @click.stop="emit('toggle-model-active', { modelId: model.id, active: model.isActive === false })"
              >
                {{ model.isActive !== false ? '激活' : '未激活' }}
              </button>
            </h4>
            <div class="model-actions">
              <IconButton @click.stop="emit('apply-model', model)" title="应用">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </IconButton>
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
              <DetailRow label="API地址">
                <div class="value-with-copy">
                  <span>{{ model.apiUrl }}</span>
                  <button
                    v-if="model.apiUrl"
                    type="button"
                    class="copy-btn"
                    :class="{ copied: copiedKeys.has('api-' + model.id) }"
                    @click.stop="copyToClipboard(model.apiUrl, 'api-' + model.id)"
                    :title="copiedKeys.has('api-' + model.id) ? '已复制' : '复制'"
                  >
                    <svg v-if="copiedKeys.has('api-' + model.id)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
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
                  <span class="token-text" :class="{ 'has-toggle': model.authToken }">
                    {{ visibleModelTokens.has(model.id) && model.authToken ? model.authToken : (model.authToken ? '••••••••' : '未配置') }}
                  </span>
                  <button
                    v-if="model.authToken"
                    type="button"
                    class="copy-btn"
                    :class="{ copied: copiedKeys.has('token-' + model.id) }"
                    @click.stop="copyToClipboard(model.authToken, 'token-' + model.id)"
                    :title="copiedKeys.has('token-' + model.id) ? '已复制' : '复制'"
                  >
                    <svg v-if="copiedKeys.has('token-' + model.id)" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <polyline points="20 6 9 17 4 12"/>
                    </svg>
                    <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                    </svg>
                  </button>
                </div>
              </DetailRow>

              <!-- 模型卡片列表（单卡片和多卡片统一格式） -->
              <DetailRow v-if="model.modelCards && model.modelCards.length > 0" label="模型列表">
                <span
                  v-for="card in model.modelCards"
                  :key="card.id"
                  class="card-chip"
                  :class="{ 'is-default': card.id === model.defaultCardId }"
                  @click.stop="emit('set-model-default-card', { modelId: model.id, cardId: card.id })"
                >{{ card.modelName || '未命名' }}</span>
              </DetailRow>

              <!-- 兼容旧格式 -->
              <DetailRow v-else-if="model.modelName" label="模型列表">
                <span class="card-chip is-default">{{ model.modelName }}</span>
              </DetailRow>
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
  border: 1px solid #3F3F46;
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
}

.model-card.inactive {
  opacity: 0.5;
}

.model-card.inactive:hover {
  opacity: 0.7;
}

.model-card.inactive .card-chip {
  color: #9CA3AF;
  background: rgba(156, 163, 175, 0.1);
  border-color: rgba(156, 163, 175, 0.2);
}

.model-card.inactive .card-chip.is-default {
  background: #52525B;
  color: #9CA3AF;
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

.no-mapping {
  color: #71717A;
  font-size: 12px;
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
