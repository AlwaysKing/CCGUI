<script setup>
/**
 * CodexModelCatalogImportDialog - 启动时提示导入 Codex 模型元数据
 * 数据来源是用户自己的 ~/.codex/models.json，导入后写入 CCGUI 内部配置
 */
import { ref, watch, computed } from 'vue'
import { useDialogStack } from '../../../../composables/useDialogStack'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  candidates: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits(['update:visible', 'confirm', 'skip'])

const selectedKeys = ref(new Set())
const importing = ref(false)

function buildKey(candidate) {
  return `${candidate.providerId}:${candidate.cardId}`
}

const selectedCount = computed(() => selectedKeys.value.size)

watch(() => props.visible, (visible) => {
  if (visible) {
    selectedKeys.value = new Set(props.candidates.map(buildKey))
  }
})

function toggleCandidate(candidate) {
  const key = buildKey(candidate)
  const next = new Set(selectedKeys.value)
  if (next.has(key)) {
    next.delete(key)
  } else {
    next.add(key)
  }
  selectedKeys.value = next
}

function handleClose() {
  emit('update:visible', false)
}

function handleSkip() {
  emit('skip')
  handleClose()
}

async function handleConfirm() {
  const items = props.candidates.filter(candidate => selectedKeys.value.has(buildKey(candidate)))
  if (items.length === 0) {
    handleSkip()
    return
  }

  importing.value = true
  try {
    emit('confirm', items)
  } finally {
    importing.value = false
    handleClose()
  }
}

useDialogStack(computed(() => props.visible), handleClose)
</script>

<template>
  <div v-if="visible" class="dialog-overlay">
    <div class="catalog-import-dialog" @click.stop>
      <div class="dialog-header">
        <h2>发现可导入的 Codex 模型元数据</h2>
        <button class="close-btn" @click="handleClose" title="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <p class="dialog-tip">
          在 <code>~/.codex/models.json</code> 中找到以下模型的元数据，CCGUI 里还没有配置。
          导入后会保存到 CCGUI 自己的模型目录，启动 Codex 时自动带上，不再依赖 Codex 的配置文件。
        </p>

        <div class="candidate-list">
          <label
            v-for="candidate in candidates"
            :key="`${candidate.providerId}:${candidate.cardId}`"
            class="candidate-item"
          >
            <input
              type="checkbox"
              :checked="selectedKeys.has(`${candidate.providerId}:${candidate.cardId}`)"
              @change="toggleCandidate(candidate)"
            >
            <span class="candidate-name">{{ candidate.modelName }}</span>
            <span class="candidate-provider">{{ candidate.providerName }}</span>
          </label>
        </div>
      </div>

      <div class="dialog-footer">
        <button class="btn btn-secondary" @click="handleSkip">暂不导入</button>
        <button class="btn btn-primary" :disabled="importing" @click="handleConfirm">
          {{ importing ? '导入中...' : `导入选中（${selectedCount}）` }}
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
  z-index: 2000;
}

.catalog-import-dialog {
  width: 520px;
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
}

.dialog-tip code {
  color: #F97316;
}

.candidate-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.candidate-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  cursor: pointer;
}

.candidate-item:hover {
  border-color: #F97316;
}

.candidate-name {
  font-size: 13px;
  color: #F4F4F5;
}

.candidate-provider {
  font-size: 12px;
  color: #71717A;
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
