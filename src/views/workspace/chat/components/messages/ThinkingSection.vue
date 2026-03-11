<script setup>
/**
 * ThinkingSection - 思考过程展示组件
 * 显示 AI 的思考过程，支持折叠/展开
 */
import { computed } from 'vue'
import CollapseToggle from '../ui/CollapseToggle.vue'
import CopyButton from '../ui/CopyButton.vue'

const props = defineProps({
  thinking: {
    type: String,
    default: ''
  },
  isCollapsed: {
    type: Boolean,
    default: true
  },
  messageIndex: {
    type: Number,
    default: -1
  },
  copiedMessageIndex: {
    type: Number,
    default: -1
  }
})

const emit = defineEmits(['toggleCollapse', 'copyContent'])

const previewText = computed(() => {
  if (!props.thinking) return ''
  return props.thinking.substring(0, 50) + (props.thinking.length > 50 ? '...' : '')
})

const isCopied = computed(() => props.copiedMessageIndex === props.messageIndex)

function toggleCollapse() {
  emit('toggleCollapse')
}

function copyContent() {
  emit('copyContent', props.messageIndex)
}
</script>

<template>
  <div class="thinking-section" :class="{ 'thinking-collapsed': isCollapsed }">
    <div class="thinking-header-inline" @click="toggleCollapse">
      <span class="thinking-icon">💭</span>
      <span class="thinking-label">思考过程</span>
      <span v-if="isCollapsed" class="thinking-preview">{{ previewText }}</span>
      <span class="thinking-spacer"></span>
      <CollapseToggle :collapsed="isCollapsed" @toggle="toggleCollapse" />
    </div>
    <div v-if="!isCollapsed" class="thinking-content-wrapper">
      <CopyButton
        :is-copied="isCopied"
        @copy="copyContent"
      />
      <div class="thinking-content-inline">{{ thinking }}</div>
    </div>
  </div>
</template>

<style scoped>
/* Thinking section - 单独的气泡样式，宽度由父容器控制 */
.thinking-section {
  width: 100%;
  background: #18181B;
  border: 1px solid #27272A;
  border-left: 3px solid #6366F1;
  border-radius: 6px;
  padding: 0;
  margin-bottom: 8px;
}

.thinking-section:hover {
  background: #1F1F23;
  border-color: #3F3F46;
  border-left-color: #818CF8;
}

.thinking-section.thinking-collapsed {
  background: transparent;
  border: 1px dashed #3F3F46;
  border-left: 3px solid #6366F1;
}

.thinking-header-inline {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  user-select: none;
  font-size: 11px;
  color: #71717A;
  transition: all 0.15s;
}

.thinking-header-inline:hover {
  color: #A1A1AA;
}

.thinking-icon {
  font-size: 14px;
}

.thinking-label {
  font-weight: 500;
  color: #A1A1AA;
}

.thinking-preview {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #71717A;
  font-style: italic;
}

.thinking-spacer {
  flex: 1;
}

.thinking-content-wrapper {
  position: relative;
  padding: 0 12px 10px;
}

.thinking-content-inline {
  font-size: 11px;
  line-height: 1.6;
  color: #71717A;
  white-space: pre-wrap;
}

/* 复制按钮定位到右上角 */
.thinking-content-wrapper :deep(.copy-btn) {
  position: absolute;
  top: 0;
  right: 8px;
  opacity: 0;
  transition: opacity 0.15s;
}

.thinking-content-wrapper:hover :deep(.copy-btn) {
  opacity: 1;
}
</style>
