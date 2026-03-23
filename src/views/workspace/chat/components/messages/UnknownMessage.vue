<script setup>
/**
 * UnknownMessage - 未知消息类型组件
 * 显示暂未支持的消息类型，可折叠
 */
import { ref, computed } from 'vue'
import CollapseToggle from '../ui/CollapseToggle.vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  messageIndex: {
    type: Number,
    required: true
  },
  copiedMessageIndex: {
    type: Number,
    default: -1
  },
  chatTheme: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['copyContent'])

// 折叠状态（默认折叠）
const isExpanded = ref(false)
const isTextStyle = computed(() => (props.chatTheme?.messageSurface || 'bubble') === 'ghost')

// 是否已复制
const isCopied = computed(() => props.copiedMessageIndex === props.messageIndex)
const previewText = computed(() => {
  const content = String(props.message?.content || '').replace(/\s+/g, ' ').trim()
  if (content) {
    return content.length > 80 ? `${content.slice(0, 80)}...` : content
  }
  const messageType = String(props.message?.messageType || '').trim()
  return messageType || '点击展开查看详情'
})

// 切换折叠
function toggleExpand() {
  isExpanded.value = !isExpanded.value
}

// 复制内容
function copyContent(event) {
  event.stopPropagation()
  emit('copyContent', props.messageIndex)
}
</script>

<template>
  <div class="unknown-message-wrapper">
    <div class="unknown-card" :class="{ collapsed: !isExpanded, 'surface-ghost': isTextStyle }">
      <div class="unknown-header" @click="toggleExpand">
        <div class="header-info">
          <span class="header-title">未知类型消息</span>
          <template v-if="isTextStyle">
            <CollapseToggle :collapsed="!isExpanded" @toggle="toggleExpand" />
            <span v-if="!isExpanded" class="unknown-preview">{{ previewText }}</span>
          </template>
          <template v-else>
            <span class="header-icon">⚠️</span>
            <span class="message-type">{{ message.messageType }}</span>
          </template>
        </div>
        <div class="header-actions">
          <button class="copy-btn" @click.stop="copyContent" :title="isCopied ? '已复制' : '复制'">
            <svg v-if="isCopied" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <CollapseToggle v-if="!isTextStyle" :collapsed="!isExpanded" @toggle="toggleExpand" />
        </div>
      </div>

      <!-- 折叠时显示简短摘要 -->
      <div v-if="!isExpanded && !isTextStyle" class="collapsed-summary" @click="toggleExpand">
        点击展开查看详情
      </div>

      <!-- 展开时显示详细内容 -->
      <div v-if="isExpanded" class="unknown-body">
        <div class="detail-section">
          <button class="section-copy-btn" @click.stop="copyContent" :title="isCopied ? '已复制' : '复制'">
            <svg v-if="isCopied" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <pre class="section-content">{{ message.content }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.unknown-message-wrapper {
  max-width: 70%;
}

.unknown-card {
  background: linear-gradient(135deg, #2D1F1F 0%, #1F1F1F 100%);
  border: 1px solid #EF4444;
  border-left: 3px solid #EF4444;
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.unknown-card.surface-ghost {
  background: transparent;
  border: none;
  border-radius: 0;
  margin: 0;
}

.unknown-card.collapsed {
  background: linear-gradient(135deg, #2D1F1F 0%, #1F1F1F 100%);
}

.unknown-card.surface-ghost.collapsed {
  background: transparent;
}

.unknown-card.collapsed:hover {
  border-color: #F87171;
}

.unknown-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.15s;
}

.unknown-header:hover {
  background: rgba(239, 68, 68, 0.1);
}

.unknown-card.surface-ghost .unknown-header:hover {
  background: transparent;
}

.unknown-card.surface-ghost .unknown-header {
  padding: 0;
}

.header-info {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.header-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.header-title {
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: #FCA5A5;
  flex-shrink: 0;
}

.message-type {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: #FCA5A5;
  background: rgba(239, 68, 68, 0.3);
  padding: 2px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid rgba(239, 68, 68, 0.5);
}

.unknown-preview {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  color: #71717A;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}

.unknown-card.surface-ghost .unknown-header {
  justify-content: flex-start;
  gap: 6px;
}

.unknown-card.surface-ghost .header-info {
  flex: 0 1 auto;
  min-width: 0;
}

.unknown-card.surface-ghost .header-actions {
  justify-content: flex-start;
}

.copy-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: #71717A;
  cursor: pointer;
  transition: all 0.15s;
  opacity: 0;
}

.copy-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #E4E4E7;
}

.unknown-card.surface-ghost .copy-btn {
  width: 20px;
  height: 20px;
}

.unknown-card.surface-ghost .copy-btn:hover {
  background: transparent;
  color: #A1A1AA;
}

.unknown-header:hover .copy-btn,
.detail-section:hover .section-copy-btn {
  opacity: 1;
}

.collapsed-summary {
  padding: 0 14px 10px 14px;
  font-size: var(--font-size-xs);
  color: #71717A;
  cursor: pointer;
}

.collapsed-summary:hover {
  color: #A1A1AA;
}

.unknown-body {
  padding: 0 14px 12px 14px;
  border-top: 1px solid rgba(239, 68, 68, 0.2);
}

.unknown-card.surface-ghost .unknown-body {
  border-top: none;
  padding: 4px 0 0 0;
}

.detail-section {
  position: relative;
  margin-top: 10px;
}

.unknown-card.surface-ghost .detail-section {
  margin-top: 0;
}

.section-copy-btn {
  position: absolute;
  top: 0;
  right: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #71717A;
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s;
}

.section-copy-btn:hover {
  background: rgba(255, 255, 255, 0.08);
  color: #A1A1AA;
}

.section-label {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: #F87171;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.section-content {
  font-size: var(--font-size-xs);
  color: #D4D4D4;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  font-family: var(--font-family-mono);
  background: rgba(0, 0, 0, 0.3);
  padding: 10px 12px;
  border-radius: var(--radius-sm);
  margin: 0;
  max-height: 300px;
  overflow: auto;
  cursor: text;
  user-select: text;
  -webkit-user-select: text;
}

.unknown-card.surface-ghost .section-content {
  background: transparent;
  padding: 0;
  border-radius: 0;
}
</style>
