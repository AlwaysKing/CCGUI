<script setup>
import { computed, ref } from 'vue'
import MessageItem from './MessageItem.vue'
import ToolUseMessage from './ToolUseMessage.vue'

const props = defineProps({
  card: {
    type: Object,
    required: true
  },
  workingDirectory: {
    type: String,
    default: ''
  },
  currentTime: {
    type: Number,
    default: null
  },
  chatTheme: {
    type: Object,
    default: () => ({})
  }
})

const expanded = ref(false)
const copiedSection = ref('')
const isTextStyle = computed(() => (props.chatTheme?.messageSurface || 'bubble') === 'ghost')

const statusLabel = computed(() => {
  switch (props.card?.status) {
    case 'failed':
      return '失败'
    case 'ended':
      return '已结束'
    case 'deleted':
      return '已删除'
    case 'interrupted':
      return '已中断'
    case 'starting':
      return '启动中'
    default:
      return '运行中'
  }
})

const promptText = computed(() => {
  return String(props.card?.promptText || props.card?.summary || '').trim() || '未提供提示词'
})

const promptPreview = computed(() => {
  const text = promptText.value.replace(/\s+/g, ' ').trim()
  if (text.length <= 72) {
    return text
  }
  return `${text.slice(0, 72)}...`
})

const latestResultLabel = computed(() => {
  const text = String(props.card?.latestResult || '').trim()
  if (text) {
    return text
  }
  if (props.card?.status === 'running' || props.card?.status === 'starting') {
    return '等待最终结果'
  }
  if (props.card?.status === 'interrupted') {
    return '子代理在会话关闭时被中断，恢复历史后不会继续执行。'
  }
  return '暂无运行结果'
})

const toolListSummary = computed(() => {
  const toolCount = Number(props.card?.toolCount || props.card?.timelineItems?.length || 0)
  const completedToolCount = Number(props.card?.completedToolCount || 0)
  const errorToolCount = Number(props.card?.errorToolCount || 0)

  if (!toolCount) {
    return '0 次调用'
  }

  const parts = [`${toolCount} 次调用`]
  if (completedToolCount) {
    parts.push(`${completedToolCount} 完成`)
  }
  if (errorToolCount) {
    parts.push(`${errorToolCount} 失败`)
  }
  return parts.join(' · ')
})

const collapsedStatusLabel = computed(() => {
  if (props.card?.displayTimelineItems?.length) {
    return null
  }
  return (props.card?.status === 'running' || props.card?.status === 'starting')
    ? '思考中'
    : (props.card?.status === 'interrupted'
        ? '已中断'
        : buildCompletedSummary())
})

const showActivePreview = computed(() => {
  return props.card?.status === 'running' || props.card?.status === 'starting'
})

const textStyleStatus = computed(() => {
  if (props.card?.status === 'running' || props.card?.status === 'starting') {
    return 'executing'
  }
  if (props.card?.status === 'failed' || props.card?.status === 'deleted' || props.card?.status === 'interrupted') {
    return 'error'
  }
  return 'success'
})

const statusSummary = computed(() => toolListSummary.value || '')

const nestedTimelineTheme = computed(() => ({
  ...props.chatTheme,
  messageSurface: 'ghost',
  avatarMode: 'small',
  statusStyle: 'hidden',
  messageSpacing: 'small'
}))

const waitingShellMessage = computed(() => ({
  id: `execution-agent-waiting-${props.card?.agentId || 'unknown'}`,
  role: 'tool_use',
  toolName: 'Agent',
  timestamp: props.card?.bucket?.lastTimestamp || props.card?.bucket?.firstTimestamp || Date.now(),
  collapsed: true,
  content: ''
}))

function toggleExpanded() {
  expanded.value = !expanded.value
}

async function copySection(text, key) {
  if (!text) {
    return
  }
  try {
    await navigator.clipboard.writeText(text)
    copiedSection.value = key
    setTimeout(() => {
      if (copiedSection.value === key) {
        copiedSection.value = ''
      }
    }, 1500)
  } catch (error) {
    console.error('复制失败:', error)
  }
}

function buildCompletedSummary() {
  const toolCount = Number(props.card?.toolCount || 0)
  const completedToolCount = Number(props.card?.completedToolCount || 0)
  const errorToolCount = Number(props.card?.errorToolCount || 0)

  if (!toolCount) {
    return '未调用工具'
  }

  const parts = [`调用了 ${toolCount} 个工具`]
  if (completedToolCount) {
    parts.push(`${completedToolCount} 个完成`)
  }
  if (errorToolCount) {
    parts.push(`${errorToolCount} 个失败`)
  }

  return parts.join('，')
}
</script>

<template>
  <section
    class="execution-agent-card"
    :class="{ 'execution-agent-card--plain': isTextStyle }"
    :data-agent-id="card.agentId"
  >
    <button
      class="execution-agent-card__header"
      :class="{ 'execution-agent-card__header--text-style': isTextStyle }"
      type="button"
      @click="toggleExpanded"
    >
      <div class="execution-agent-card__title-row">
        <div class="execution-agent-card__identity">
          <template v-if="isTextStyle">
            <span class="execution-agent-card__title execution-agent-card__title--text-style">{{ card.title }}</span>
            <span class="execution-agent-card__toggle execution-agent-card__toggle--text-style collapse-toggle">
              {{ expanded ? '▼' : '▶' }}
            </span>
            <span v-if="!expanded" class="execution-agent-card__summary-inline execution-agent-card__summary-inline--text-style">
              {{ promptPreview }}
            </span>
            <span v-if="!expanded" class="execution-agent-card__status-summary execution-agent-card__status-summary--text-style">
              {{ statusSummary }}
            </span>
            <span class="execution-agent-card__status execution-agent-card__status--text-style" :class="`is-${textStyleStatus}`" aria-hidden="true">
              <svg v-if="textStyleStatus === 'success'" viewBox="0 0 12 12" fill="none">
                <path d="M2.2 6.2L4.7 8.7L9.8 3.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
              </svg>
              <svg v-else-if="textStyleStatus === 'error'" viewBox="0 0 12 12" fill="none">
                <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"></path>
              </svg>
              <span v-else class="execution-agent-card__status-spinner"></span>
            </span>
          </template>
          <template v-else>
            <span class="execution-agent-card__title">{{ card.title }}</span>
          </template>
        </div>
        <div v-if="!expanded && !isTextStyle" class="execution-agent-card__summary-inline">{{ promptPreview }}</div>
        <div v-if="!isTextStyle && !expanded" class="execution-agent-card__status-summary">
          {{ statusSummary }}
        </div>
        <span v-if="!isTextStyle" class="execution-agent-card__toggle">{{ expanded ? '▼' : '▶' }}</span>
      </div>
    </button>
    <div class="execution-agent-card__divider"></div>
    <div v-if="!expanded && showActivePreview" class="execution-agent-card__active-list">
      <template v-if="card.displayTimelineItems?.length">
        <div
          v-for="(message, index) in card.displayTimelineItems"
          :key="message.id || `${card.agentId}-${message.toolName}`"
          class="execution-agent-card__active-item"
        >
          <MessageItem
            :message="message"
            :message-index="index"
            :total-messages="card.displayTimelineItems.length"
            :working-directory="workingDirectory"
            :current-time="(message.isStreaming || message.isExecuting || (!message.duration && message.startTime)) ? currentTime : null"
            :all-messages="card.displayTimelineItems"
            :chat-theme="nestedTimelineTheme"
          />
        </div>
      </template>
      <template v-else>
        <div class="execution-agent-card__active-item">
          <MessageItem
            :message="waitingShellMessage"
            :message-index="0"
            :total-messages="1"
            :working-directory="workingDirectory"
            :current-time="showActivePreview ? currentTime : null"
            :all-messages="[waitingShellMessage]"
            :chat-theme="nestedTimelineTheme"
          >
            <ToolUseMessage
              tool-name="Agent"
              :tool-input="{}"
              :result="''"
              :is-error="false"
              :is-executing="card.status === 'running' || card.status === 'starting'"
              :collapsed="true"
              :working-directory="workingDirectory"
              :chat-theme="nestedTimelineTheme"
              text-style-label-override=""
              :text-style-summary-override="collapsedStatusLabel"
              :text-style-status-override="(card.status === 'running' || card.status === 'starting') ? 'executing' : (card.status === 'interrupted' ? 'error' : 'success')"
              :hide-text-style-toggle="true"
              :non-interactive="true"
            />
          </MessageItem>
        </div>
      </template>
    </div>

    <div
      v-if="expanded"
      class="execution-agent-card__body tool-body"
      :class="{ 'execution-agent-card__body--text-style': isTextStyle }"
    >
      <div class="tool-section result-section">
        <div class="section-label">提示词</div>
        <div class="section-content-wrapper">
          <button
            class="section-copy-btn"
            type="button"
            :title="copiedSection === 'prompt' ? '已复制' : '复制'"
            @click.stop="copySection(promptText, 'prompt')"
          >
            <svg v-if="copiedSection === 'prompt'" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <pre class="section-content result execution-agent-card__section-text">{{ promptText }}</pre>
        </div>
      </div>

      <div class="tool-section result-section">
        <div class="section-label">运行结果</div>
        <div class="section-content-wrapper">
          <button
            class="section-copy-btn"
            type="button"
            :title="copiedSection === 'result' ? '已复制' : '复制'"
            @click.stop="copySection(latestResultLabel, 'result')"
          >
            <svg v-if="copiedSection === 'result'" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <pre class="section-content result execution-agent-card__section-text">{{ latestResultLabel }}</pre>
        </div>
      </div>

      <div class="tool-section">
        <div class="section-label execution-agent-card__section-label">
          <span>工具调用列表</span>
          <span class="execution-agent-card__section-meta">{{ toolListSummary }}</span>
        </div>
        <div v-if="card.timelineItems?.length" class="execution-agent-card__tool-list execution-agent-card__tool-list-scroll">
          <div
            v-for="(message, index) in card.timelineItems"
            :key="message.id || `${card.agentId}-${index}`"
            class="execution-agent-card__tool-item"
          >
            <MessageItem
              :message="message"
              :message-index="index"
              :total-messages="card.timelineItems.length"
              :working-directory="workingDirectory"
              :current-time="(message.isStreaming || message.isExecuting || (!message.duration && message.startTime)) ? currentTime : null"
              :all-messages="card.timelineItems"
            :chat-theme="nestedTimelineTheme"
          />
          </div>
        </div>
        <div v-else class="execution-agent-card__empty">暂无工具调用</div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.execution-agent-card {
  width: 100%;
  max-width: 100%;
  min-width: 0;
  box-sizing: border-box;
  margin: 0;
  border: 1px solid #3b82f6;
  border-left: 3px solid #3b82f6;
  border-radius: 8px;
  background: linear-gradient(135deg, #1e1e2e 0%, #18181b 100%);
  overflow: hidden;
}

.execution-agent-card--plain {
  border: none;
  border-radius: 0;
  background: transparent;
  overflow: visible;
}

.execution-agent-card__header {
  width: 100%;
  border: none;
  background: #252526;
  color: inherit;
  padding: 10px 14px;
  cursor: pointer;
  text-align: left;
  appearance: none;
  min-height: 39px;
  box-sizing: border-box;
}

.execution-agent-card__header--text-style {
  all: unset;
  display: block;
  width: 100%;
  padding: 0;
  background: transparent;
  line-height: 1;
  min-height: 0;
  font-size: 12px;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.execution-agent-card__header:hover {
  background: #2d2d30;
}

.execution-agent-card__header--text-style:hover {
  background: transparent;
}

.execution-agent-card__title-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 8px;
  min-width: 0;
  min-height: 19px;
}

.execution-agent-card__header--text-style .execution-agent-card__title-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 0;
  line-height: 1;
}

.execution-agent-card__identity {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  line-height: 1;
}

.execution-agent-card__header--text-style .execution-agent-card__identity {
  gap: 6px;
  flex: 0 1 auto;
  line-height: 1;
}

.execution-agent-card__title {
  color: #e4e4e7;
  font-size: 13px;
  font-weight: 600;
}

.execution-agent-card__title--text-style {
  font-size: 12px;
  font-weight: 500;
  color: #8B8B95;
  flex-shrink: 0;
  line-height: 1.5;
}

.execution-agent-card__toggle {
  grid-column: 4;
  justify-self: end;
  color: #c4c7cf;
  width: 14px;
  min-width: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  line-height: 1;
  flex-shrink: 0;
}

.execution-agent-card__header--text-style .execution-agent-card__toggle {
  color: #8b93a7;
}

.execution-agent-card__toggle--text-style {
  width: auto;
  min-width: 0;
  font-size: 10px;
  line-height: 1;
  color: #71717A;
}

.collapse-toggle {
  cursor: pointer;
  transition: transform 0.15s;
  user-select: none;
}

.collapse-toggle:hover {
  color: #A1A1AA;
}

.execution-agent-card__summary-inline {
  grid-column: 2;
  color: #aeb6c8;
  font-size: 12px;
  line-height: 1.55;
  min-width: 0;
}

.execution-agent-card__summary-inline {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.execution-agent-card__header--text-style .execution-agent-card__summary-inline {
  color: #6B7280;
  font-size: 12px;
  line-height: 1;
}

.execution-agent-card__summary-inline--text-style {
  grid-column: auto;
  flex: 1 1 auto;
  min-width: 0;
  line-height: 1;
}

.execution-agent-card__status-summary {
  color: #8b93a7;
  font-size: 11px;
  line-height: 1;
  white-space: nowrap;
  flex-shrink: 0;
  grid-column: 3;
}

.execution-agent-card__status-summary--text-style {
  font-size: 11px;
}

.execution-agent-card__status {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  line-height: 1;
}

.execution-agent-card__status svg {
  width: 12px;
  height: 12px;
}

.execution-agent-card__status--text-style.is-success {
  color: #6EE7B7;
}

.execution-agent-card__status--text-style.is-error {
  color: #F87171;
}

.execution-agent-card__status--text-style.is-executing {
  color: #94A3B8;
}

.execution-agent-card__status-spinner {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.35px solid rgba(148, 163, 184, 0.28);
  border-top-color: currentColor;
  animation: execution-agent-spin 0.9s linear infinite;
}

.execution-agent-card__body {
  padding: 0 14px 14px;
}

.execution-agent-card__body--text-style {
  margin-left: 24px;
  max-width: calc(100% - 24px);
  margin-top: 8px;
  padding: 12px 14px;
  border-top: none;
  background: linear-gradient(135deg, #1E1E2E 0%, #18181B 100%);
  border: 1px solid #3B82F6;
  border-left: 3px solid #3B82F6;
  border-radius: 8px;
  overflow: hidden;
}

.execution-agent-card__active-list {
  padding: 10px 14px 0 22px;
}

.execution-agent-card--text-style .execution-agent-card__active-list {
  padding: 8px 0 0 24px;
}

.execution-agent-card__active-item + .execution-agent-card__active-item {
  margin-top: 10px;
}

.execution-agent-card__spinner {
  width: 10px;
  height: 10px;
  border-radius: 999px;
  border: 1.35px solid rgba(148, 163, 184, 0.28);
  border-top-color: currentColor;
  animation: execution-agent-spin 0.9s linear infinite;
}

.execution-agent-card__divider {
  border-top: 1px solid rgba(255, 255, 255, 0.04);
}

.execution-agent-card--plain .execution-agent-card__divider {
  display: none;
}

.execution-agent-card__tool-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.execution-agent-card__tool-list-scroll {
  max-height: 260px;
  overflow: auto;
  padding: 10px 12px;
  padding-right: 16px;
  border-radius: 6px;
  background: #18181b;
}

.execution-agent-card__tool-list-scroll :deep(.message) {
  width: 100%;
  align-items: stretch;
}

.execution-agent-card__tool-list-scroll :deep(.message-body) {
  width: 100%;
  max-width: 100%;
}

.execution-agent-card__tool-list-scroll :deep(.tool-use-message-wrapper) {
  width: 100%;
  max-width: 100%;
}

.execution-agent-card__tool-item {
  padding: 0;
}

.execution-agent-card__empty {
  color: #aeb6c8;
  font-size: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.tool-body {
  padding-top: 12px;
}

.tool-section {
  margin-bottom: 14px;
}

.tool-section:last-child {
  margin-bottom: 0;
}

.section-label {
  font-size: 11px;
  color: #71717a;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.execution-agent-card__section-label {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.execution-agent-card__section-meta {
  color: #8b93a7;
  font-size: 10px;
  letter-spacing: 0.02em;
  text-transform: none;
}

.section-content {
  font-size: 12px;
  color: #d4d4d4;
  line-height: 1.5;
  position: relative;
}

.section-content-wrapper {
  position: relative;
}

.section-copy-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: 12px;
  color: #71717a;
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
  background: #27272a;
  color: #a1a1aa;
}

.section-content.result {
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  background: #18181b;
  padding: 10px 12px;
  border-radius: 6px;
  max-height: 220px;
  overflow: auto;
  white-space: pre-wrap;
  word-break: break-word;
  color: #a1a1aa;
}

.execution-agent-card__section-text {
  padding-right: 36px;
}

.section-content.result::-webkit-scrollbar,
.execution-agent-card__tool-list-scroll::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.section-content.result::-webkit-scrollbar-thumb,
.execution-agent-card__tool-list-scroll::-webkit-scrollbar-thumb {
  background: rgba(113, 113, 122, 0.65);
  border-radius: 999px;
}

.section-content.result::-webkit-scrollbar-track,
.execution-agent-card__tool-list-scroll::-webkit-scrollbar-track {
  background: rgba(24, 24, 27, 0.4);
}

@keyframes execution-agent-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}
</style>
