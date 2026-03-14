<script setup>
/**
 * ModelMappingDialog - 模型映射确认对话框
 * 用于选择各模型变量对应的具体模型卡片
 */
import { ref, watch, computed } from 'vue'
import IconButton from '@/components/common/IconButton.vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  model: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['update:visible', 'confirm', 'close'])

// 映射类型选项
const mappingTypes = [
  { key: 'ANTHROPIC_MODEL', label: '通用模型', description: '默认使用的模型' },
  { key: 'ANTHROPIC_DEFAULT_SONNET_MODEL', label: 'Sonnet', description: 'Sonnet 系列模型' },
  { key: 'ANTHROPIC_DEFAULT_OPUS_MODEL', label: 'Opus', description: 'Opus 系列模型' },
  { key: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', label: 'Haiku', description: 'Haiku 系列模型' },
  { key: 'ANTHROPIC_SMALL_FAST_MODEL', label: '快速模型', description: '轻量快速模型' }
]

// 当前映射选择
const mappings = ref({})

// 可用的模型卡片
const availableCards = computed(() => {
  return props.model?.modelCards || []
})

// 同步数据
function syncData() {
  if (props.model && props.model.modelCards) {
    // 初始化映射：根据卡片名称自动推测
    const newMappings = {}
    const cards = props.model.modelCards

    mappingTypes.forEach(type => {
      // 尝试根据名称匹配
      const key = type.key.replace('ANTHROPIC_', '').replace('_MODEL', '').toLowerCase()
      const matchedCard = cards.find(card =>
        card.modelName?.toLowerCase().includes(key) ||
        card.modelName?.toLowerCase().includes(type.label.toLowerCase())
      )
      if (matchedCard) {
        newMappings[type.key] = matchedCard.id
      }
    })

    // 通用模型必须选择一个，默认选择第一个卡片
    if (!newMappings['ANTHROPIC_MODEL'] && cards.length > 0) {
      newMappings['ANTHROPIC_MODEL'] = cards[0].id
    }

    mappings.value = newMappings
  }
}

watch(() => props.visible, (visible) => {
  if (visible) {
    syncData()
  }
})

watch(() => props.model, syncData, { immediate: true, deep: true })

// 获取卡片名称
function getCardName(cardId) {
  const card = availableCards.value.find(c => c.id === cardId)
  return card?.modelName || '未命名'
}

// 关闭对话框
function handleClose() {
  emit('update:visible', false)
  emit('close')
}

// 确认映射
function handleConfirm() {
  // 构建映射结果
  const result = {}
  Object.entries(mappings.value).forEach(([key, cardId]) => {
    if (cardId) {
      const card = availableCards.value.find(c => c.id === cardId)
      if (card && card.modelName) {
        result[key] = card.modelName
      }
    }
  })

  emit('confirm', result)
  handleClose()
}

// 全部默认：通用模型选默认卡片，其他选默认
function setAllDefault() {
  if (availableCards.value.length > 0) {
    // 通用模型选择默认卡片（或第一个）
    const defaultCardId = props.model?.defaultCardId || availableCards.value[0].id
    mappings.value['ANTHROPIC_MODEL'] = defaultCardId
    // 其他模型设为默认（null）
    mappingTypes.forEach(type => {
      if (type.key !== 'ANTHROPIC_MODEL') {
        mappings.value[type.key] = null
      }
    })
  }
}

// 清除所有映射
function clearAll() {
  // 通用模型必须选择一个，保留默认
  const defaultCardId = props.model?.defaultCardId || availableCards.value[0]?.id
  mappings.value = {
    'ANTHROPIC_MODEL': defaultCardId
  }
}
</script>

<template>
  <div v-if="visible" class="dialog-overlay" @click="handleClose">
    <div class="mapping-dialog" @click.stop>
      <div class="dialog-header">
        <h2>模型映射配置</h2>
        <button class="close-btn" @click="handleClose" title="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <p class="dialog-description">
          请为每个 Claude 模型变量选择对应的模型卡片：
        </p>

        <div class="mapping-list">
          <div v-for="(type, index) in mappingTypes" :key="type.key" class="mapping-item" :class="{ 'full-width': index === 0 }">
            <div class="mapping-label">{{ type.label }}</div>
            <div class="mapping-desc">{{ type.description }}</div>
            <select v-model="mappings[type.key]" class="mapping-select">
              <option v-if="index > 0" :value="null">默认</option>
              <option v-for="card in availableCards" :key="card.id" :value="card.id">
                {{ card.modelName || '未命名' }}
              </option>
            </select>
          </div>
        </div>

        <div class="quick-actions">
          <button type="button" class="quick-btn" @click="setAllDefault">全部默认</button>
          <button type="button" class="quick-btn" @click="clearAll">清除全部</button>
        </div>
      </div>

      <div class="dialog-footer">
        <button type="button" class="btn-cancel" @click="handleClose">取消</button>
        <button type="button" class="btn-confirm" @click="handleConfirm">确认应用</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.mapping-dialog {
  background: #1F1F23;
  border-radius: 12px;
  width: 480px;
  max-width: 90vw;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
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
  padding: 20px 24px;
}

.dialog-description {
  margin: 0 0 20px;
  font-size: 14px;
  color: #9CA3AF;
}

.mapping-list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.mapping-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px 12px;
  background: #27272A;
  border-radius: 8px;
  border: 1px solid #3F3F46;
}

.mapping-item.full-width {
  grid-column: 1 / -1;
}

.mapping-label {
  font-size: 13px;
  font-weight: 500;
  color: #F4F4F5;
}

.mapping-desc {
  font-size: 11px;
  color: #71717A;
}

.mapping-select {
  margin-top: 4px;
  padding: 5px 10px;
  font-size: 12px;
  background: #18181B;
  border: 1px solid #52525B;
  border-radius: 6px;
  color: #F4F4F5;
  cursor: pointer;
}

.mapping-select:focus {
  outline: none;
  border-color: #F97316;
}

.quick-actions {
  display: flex;
  gap: 12px;
  margin-top: 16px;
  padding-top: 16px;
  border-top: 1px solid #3F3F46;
}

.quick-btn {
  padding: 8px 16px;
  font-size: 13px;
  background: #27272A;
  border: 1px solid #52525B;
  border-radius: 6px;
  color: #9CA3AF;
  cursor: pointer;
  transition: all 0.2s;
}

.quick-btn:hover {
  background: #3F3F46;
  color: #F4F4F5;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid #3F3F46;
}

.btn-cancel {
  padding: 10px 20px;
  font-size: 14px;
  background: transparent;
  border: 1px solid #52525B;
  border-radius: 6px;
  color: #9CA3AF;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-cancel:hover {
  background: #27272A;
  color: #F4F4F5;
}

.btn-confirm {
  padding: 10px 20px;
  font-size: 14px;
  background: #F97316;
  border: none;
  border-radius: 6px;
  color: #fff;
  cursor: pointer;
  transition: all 0.2s;
}

.btn-confirm:hover {
  background: #EA580C;
}
</style>
