<script setup>
/**
 * TaskCompleteMessage - 任务完成消息组件
 * 显示子任务完成后的信息（description + summary + usage）
 */
import { computed, ref } from 'vue'
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

const isCopied = computed(() => props.copiedMessageIndex === props.messageIndex)
const isCollapsed = ref(true)
const isTextStyle = computed(() => (props.chatTheme?.messageSurface || 'bubble') === 'ghost')

// 格式化持续时间
const formattedDuration = computed(() => {
  const duration = props.message.duration
  if (!duration) return null
  if (duration < 1000) return `${duration}ms`
  if (duration < 60000) return `${(duration / 1000).toFixed(1)}s`
  return `${(duration / 60000).toFixed(1)}min`
})

// 简约模式下的简要信息
const textStyleSummary = computed(() => {
  const desc = props.message.description || '子任务完成'
  const parts = [desc]
  if (formattedDuration.value) parts.push(formattedDuration.value)
  return parts.join(' · ')
})

// 简约模式下的 meta 信息
const textStyleMeta = computed(() => {
  const usage = props.message.usage
  if (!usage) return formattedDuration.value || ''
  const parts = []
  if (usage.total_tokens) parts.push(`${(usage.total_tokens / 1000).toFixed(1)}k`)
  if (usage.tool_uses) parts.push(`${usage.tool_uses} tools`)
  return parts.join(' · ')
})

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}

function copyContent() {
  emit('copyContent', props.messageIndex)
}
</script>

<template>
  <div class="task-complete-wrapper">
    <div class="task-complete" :class="{ collapsed: isCollapsed, 'text-style': isTextStyle }">
      <!-- 简约模式头部 -->
      <template v-if="isTextStyle">
        <div class="task-header text-style-header" @click="toggleCollapse">
          <span class="tool-name text-style-label">子任务完成</span>
          <CollapseToggle :collapsed="isCollapsed" @toggle="toggleCollapse" />
          <span v-if="isCollapsed" class="text-style-summary">{{ message.description || '子任务完成' }}</span>
          <span v-if="isCollapsed && textStyleMeta" class="text-style-meta">{{ textStyleMeta }}</span>
          <span class="text-style-status is-success" aria-hidden="true">
            <svg viewBox="0 0 12 12" fill="none">
              <path d="M2.2 6.2L4.7 8.7L9.8 3.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </span>
          <button class="copy-btn" @click.stop="copyContent" :title="isCopied ? '已复制' : '复制'">
            <svg v-if="isCopied" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
        </div>
      </template>

      <!-- 气泡模式头部 - 和 ToolUseMessage 一致 -->
      <template v-else>
        <div class="tool-header" @click="toggleCollapse">
          <div class="tool-info">
            <span class="tool-name">子任务完成</span>
            <span class="text-style-status is-success" aria-hidden="true">
              <svg viewBox="0 0 12 12" fill="none">
                <path d="M2.2 6.2L4.7 8.7L9.8 3.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            </span>
            <span v-if="isCollapsed && message.description" class="header-summary-inline">{{ message.description }}</span>
            <span v-if="isCollapsed && formattedDuration" class="header-summary-meta">{{ formattedDuration }}</span>
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
            <CollapseToggle :collapsed="isCollapsed" @toggle="toggleCollapse" />
          </div>
        </div>
      </template>

      <!-- 展开内容 -->
      <div v-if="!isCollapsed" class="task-details" :class="{ 'text-style-details': isTextStyle }">
        <div :class="{ 'text-style-body-card': isTextStyle }">
        <div v-if="message.description" class="tool-section has-copy">
          <div class="section-label">任务描述</div>
          <div class="section-content-wrapper">
            <button class="section-copy-btn" @click.stop="copyContent" :title="isCopied ? '已复制' : '复制'">
              <svg v-if="isCopied" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
            <div class="section-content description">{{ message.description }}</div>
          </div>
        </div>

        <div v-if="formattedDuration" class="tool-section">
          <div class="section-label">耗时</div>
          <div class="section-content code">{{ formattedDuration }}</div>
        </div>

        <div v-if="message.prompt" class="tool-section has-copy">
          <div class="section-label">Prompt</div>
          <div class="section-content-wrapper">
            <button class="section-copy-btn" @click.stop="copyContent" :title="isCopied ? '已复制' : '复制'">
              <svg v-if="isCopied" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
            <pre class="section-content code">{{ message.prompt }}</pre>
          </div>
        </div>

        <div v-if="message.summary" class="tool-section has-copy">
          <div class="section-label">Summary</div>
          <div class="section-content-wrapper">
            <button class="section-copy-btn" @click.stop="copyContent" :title="isCopied ? '已复制' : '复制'">
              <svg v-if="isCopied" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"></polyline></svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
            <div class="section-content description">{{ message.summary }}</div>
          </div>
        </div>

        <div v-if="message.usage" class="tool-section">
          <div class="section-label">Usage</div>
          <div class="usage-grid">
            <div v-if="message.usage.total_tokens" class="usage-item">
              <span class="usage-key">Tokens:</span>
              <span class="usage-value">{{ message.usage.total_tokens.toLocaleString() }}</span>
            </div>
            <div v-if="message.usage.tool_uses" class="usage-item">
              <span class="usage-key">Tool Uses:</span>
              <span class="usage-value">{{ message.usage.tool_uses }}</span>
            </div>
            <div v-if="message.usage.duration_ms" class="usage-item">
              <span class="usage-key">Duration:</span>
              <span class="usage-value">{{ message.usage.duration_ms }}ms</span>
            </div>
          </div>
        </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.task-complete-wrapper {
  flex: 1;
  max-width: 70%;
}

.task-complete {
  background: linear-gradient(135deg, #1E1E2E 0%, #18181B 100%);
  border: 1px solid #3B82F6;
  border-left: 3px solid #3B82F6;
  border-radius: 8px;
  overflow: hidden;
  max-width: 100%;
}

.task-complete.text-style {
  background: transparent;
  border: none;
  border-radius: 0;
  max-width: 100%;
}

/* 气泡模式头部 - 和 ToolUseMessage 一致 */
.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #252526;
  cursor: pointer;
  user-select: none;
  min-width: 0;
  position: relative;
}

.tool-header:hover {
  background: #2D2D30;
}

.tool-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.tool-icon {
  font-size: 14px;
  flex-shrink: 0;
}

.tool-name {
  font-size: 13px;
  font-weight: 600;
  color: #E4E4E7;
  flex-shrink: 0;
}

.header-summary-inline {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  color: #A1A1AA;
  font-size: 12px;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  flex-shrink: 1;
}

.header-summary-meta {
  flex-shrink: 0;
  color: #8B93A7;
  font-size: 11px;
  letter-spacing: 0.01em;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 0;
  flex: 0 0 auto;
  margin-left: 10px;
}

.copy-btn {
  font-size: 12px;
  color: #71717A;
  background: transparent;
  border: none;
  padding: 2px;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
  opacity: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
  width: 16px;
  height: 16px;
  pointer-events: none;
}

.copy-btn svg {
  display: block;
}

.tool-header:hover .copy-btn {
  opacity: 0.6;
  pointer-events: auto;
}

.copy-btn:hover {
  background: #27272A;
  color: #A1A1AA;
  opacity: 1 !important;
}

/* 简约模式文本样式 - 和 ToolUseMessage 一致 */
.tool-name {
  font-size: 13px;
  font-weight: 600;
  color: #E4E4E7;
  flex-shrink: 0;
}

.text-style-label {
  font-size: 12px;
  font-weight: 500;
  color: #C4C7CF;
  flex-shrink: 0;
}

.text-style-summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #8B93A7;
  font-size: 12px;
}

.text-style-meta {
  flex-shrink: 0;
  color: #6B7280;
  font-size: 11px;
  letter-spacing: 0.01em;
}

.text-style-status {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.text-style-status svg {
  width: 12px;
  height: 12px;
}

.text-style-status.is-success {
  color: #6EE7B7;
}

/* 简约模式头部 */
.text-style-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0;
  background: transparent;
  cursor: pointer;
  user-select: none;
  min-width: 0;
}

.text-style-header:hover {
  background: transparent;
}

.task-complete.text-style .copy-btn {
  position: static;
  transform: none;
}

.task-complete.text-style .tool-header:hover .copy-btn,
.text-style-header:hover .copy-btn {
  opacity: 0.6;
  pointer-events: auto;
}

/* 展开内容 */
.task-details {
  padding: 12px 14px 12px 14px;
  border-top: 1px solid rgba(59, 130, 246, 0.2);
}

.task-details.text-style-details {
  padding: 8px 0 10px 24px;
  border-top: none;
}

.text-style-body-card {
  background: linear-gradient(135deg, #1E1E2E 0%, #18181B 100%);
  border: 1px solid #3B82F6;
  border-left: 3px solid #3B82F6;
  border-radius: 8px;
  overflow: hidden;
  padding: 12px 14px;
}

/* 展开内容 section 样式 - 和 ToolUseMessage 一致 */
.tool-section {
  margin-bottom: 10px;
}

.tool-section:last-child {
  margin-bottom: 0;
}

.section-label {
  font-size: 11px;
  color: #71717A;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.section-content-wrapper {
  position: relative;
}

.section-copy-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: 12px;
  color: #71717A;
  background: rgba(39, 39, 42, 0.9);
  border: none;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.section-copy-btn svg {
  display: block;
}

.section-content-wrapper:hover .section-copy-btn {
  opacity: 0.6;
}

.section-copy-btn:hover {
  opacity: 1 !important;
  background: #27272A;
  color: #A1A1AA;
}

.section-content {
  font-size: 12px;
  color: #D4D4D4;
  line-height: 1.5;
}

.section-content.description {
  color: #A1A1AA;
  white-space: pre-wrap;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  background: #18181B;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.6;
}

.section-content.code {
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  background: #18181B;
  padding: 8px 12px;
  border-radius: 6px;
  color: #A1A1AA;
  word-break: break-all;
  white-space: pre-wrap;
}

.usage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 6px;
}

.usage-item {
  display: flex;
  justify-content: space-between;
  padding: 4px 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: var(--radius-sm);
  font-size: var(--font-size-xs);
}

.usage-key {
  color: #71717A;
}

.usage-value {
  color: #D4D4D4;
  font-family: var(--font-family-mono);
}
</style>
