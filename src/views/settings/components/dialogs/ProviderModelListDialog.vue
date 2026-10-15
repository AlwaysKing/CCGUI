<script setup>
/**
 * ProviderModelListDialog - 展示从供应商上游拉取到的模型列表
 * 勾选后回传给模型编辑对话框，由那边追加成模型卡片
 */
import { ref, watch, computed } from 'vue'
import { useDialogStack } from '../../../../composables/useDialogStack'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  loading: {
    type: Boolean,
    default: false
  },
  error: {
    type: String,
    default: ''
  },
  endpoint: {
    type: String,
    default: ''
  },
  models: {
    type: Array,
    default: () => []
  },
  existingNames: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update:visible', 'close', 'retry', 'confirm'])

const selectedIds = ref(new Set())

const existingNameSet = computed(() => new Set(props.existingNames))
const selectedModels = computed(() => props.models.filter(model => selectedIds.value.has(model.id)))

watch(() => props.visible, (visible) => {
  if (visible) {
    // 默认一个都不选，由用户自己挑
    selectedIds.value = new Set()
  }
})

function isExisting(model) {
  return existingNameSet.value.has(model.id)
}

function toggleModel(model) {
  if (isExisting(model)) {
    return
  }

  const next = new Set(selectedIds.value)
  if (next.has(model.id)) {
    next.delete(model.id)
  } else {
    next.add(model.id)
  }
  selectedIds.value = next
}

function buildModelMeta(model) {
  const parts = []

  if (model.ownedBy) {
    parts.push(model.ownedBy)
  }

  if (model.contextWindow) {
    parts.push(`窗口 ${Number(model.contextWindow).toLocaleString()}`)
  }

  if (model.pricing) {
    const prices = []
    if (model.pricing.input) prices.push(`入 $${model.pricing.input}/M`)
    if (model.pricing.output) prices.push(`出 $${model.pricing.output}/M`)
    if (model.pricing.cache) prices.push(`缓存 $${model.pricing.cache}/M`)
    if (prices.length > 0) {
      parts.push(prices.join(' / '))
    }
  }

  return parts.join(' · ')
}

function handleClose() {
  emit('update:visible', false)
  emit('close')
}

function handleConfirm() {
  if (selectedModels.value.length === 0) {
    return
  }

  emit('confirm', selectedModels.value)
  handleClose()
}

useDialogStack(computed(() => props.visible), handleClose)
</script>

<template>
  <div v-if="visible" class="dialog-overlay">
    <div class="model-list-dialog" @click.stop>
      <div class="dialog-header">
        <h2>从供应商拉取模型</h2>
        <button class="close-btn" @click="handleClose" title="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <p v-if="loading" class="dialog-state">正在拉取模型列表…</p>

        <template v-else-if="error">
          <p class="dialog-state is-error">{{ error }}</p>
          <p v-if="endpoint" class="dialog-endpoint">请求地址：{{ endpoint }}</p>
          <button type="button" class="btn btn-secondary" @click="emit('retry')">重试</button>
        </template>

        <template v-else>
          <p class="dialog-tip">
            共拉取到 {{ models.length }} 个模型<span v-if="endpoint">（{{ endpoint }}）</span>，勾选要添加的模型。
          </p>

          <div class="model-list">
            <label
              v-for="model in models"
              :key="model.id"
              class="model-item"
              :class="{ 'is-existing': isExisting(model) }"
            >
              <span class="model-name">{{ model.displayName || model.id }}</span>
              <span class="model-meta">{{ buildModelMeta(model) || model.id }}</span>
              <span v-if="isExisting(model)" class="model-badge">已存在</span>
              <input
                type="checkbox"
                :checked="selectedIds.has(model.id)"
                :disabled="isExisting(model)"
                @change="toggleModel(model)"
              >
            </label>
          </div>
        </template>
      </div>

      <div class="dialog-footer">
        <button class="btn btn-secondary" @click="handleClose">取消</button>
        <button
          class="btn btn-primary"
          :disabled="loading || !!error || selectedModels.length === 0"
          @click="handleConfirm"
        >
          添加{{ selectedModels.length > 0 ? `（${selectedModels.length}）` : '' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.5);
  z-index: 2100;
}

.model-list-dialog {
  width: 560px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 12px;
  overflow: hidden;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 24px;
  border-bottom: 1px solid #3F3F46;
}

.dialog-header h2 {
  font-size: 15px;
  font-weight: 600;
  color: #F4F4F5;
}

.close-btn {
  background: transparent;
  border: none;
  color: #A1A1AA;
  cursor: pointer;
  padding: 4px;
}

.dialog-body {
  padding: 16px 24px;
  overflow-y: auto;
}

.dialog-tip {
  font-size: 12px;
  line-height: 1.6;
  color: #A1A1AA;
  margin-bottom: 12px;
  word-break: break-all;
}

.dialog-state {
  font-size: 13px;
  color: #A1A1AA;
  margin-bottom: 12px;
}

.dialog-state.is-error {
  color: #EF4444;
}

.dialog-endpoint {
  font-size: 12px;
  color: #71717A;
  margin-bottom: 12px;
  word-break: break-all;
}

.model-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.model-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  cursor: pointer;
}

.model-item:hover {
  border-color: #F97316;
}

.model-item.is-existing {
  cursor: default;
  opacity: 0.6;
}

.model-item.is-existing:hover {
  border-color: #3F3F46;
}

.model-name {
  font-size: 13px;
  color: #F4F4F5;
}

.model-meta {
  flex: 1;
  font-size: 12px;
  color: #71717A;
  word-break: break-all;
}

.model-badge {
  font-size: 11px;
  color: #71717A;
  border: 1px solid #3F3F46;
  border-radius: 4px;
  padding: 1px 6px;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid #3F3F46;
}

.btn {
  border: none;
  border-radius: 6px;
  cursor: pointer;
  font-size: 13px;
  padding: 8px 16px;
}

.btn-secondary {
  background: #3F3F46;
  color: #F4F4F5;
}

.btn-primary {
  background: #F97316;
  color: white;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
