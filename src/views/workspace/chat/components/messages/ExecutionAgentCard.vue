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

const statusLabel = computed(() => {
  switch (props.card?.status) {
    case 'ended':
      return '已结束'
    case 'deleted':
      return '已删除'
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
  return props.card?.status === 'running' ? '等待最终结果' : '暂无运行结果'
})

const collapsedStatusLabel = computed(() => {
  if (props.card?.displayTimelineItems?.length) {
    return null
  }
  return props.card?.status === 'running'
    ? '思考中'
    : buildCompletedSummary()
})

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
  <section class="execution-agent-card" :data-agent-id="card.agentId">
    <button class="execution-agent-card__header" type="button" @click="toggleExpanded">
      <div class="execution-agent-card__title-row">
        <div class="execution-agent-card__identity">
          <span class="execution-agent-card__icon">🤖</span>
          <span class="execution-agent-card__title">{{ card.title }}</span>
        </div>
        <div v-if="!expanded" class="execution-agent-card__summary-inline">{{ promptPreview }}</div>
        <span class="execution-agent-card__toggle">{{ expanded ? '▼' : '▶' }}</span>
      </div>
    </button>
    <div class="execution-agent-card__divider"></div>
    <div v-if="!expanded" class="execution-agent-card__active-list">
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
            :current-time="currentTime"
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
            :current-time="currentTime"
            :all-messages="[waitingShellMessage]"
            :chat-theme="nestedTimelineTheme"
          >
            <ToolUseMessage
              tool-name="Agent"
              :tool-input="{}"
              :result="''"
              :is-error="false"
              :is-executing="card.status === 'running'"
              :collapsed="true"
              :working-directory="workingDirectory"
              :chat-theme="nestedTimelineTheme"
              text-style-label-override=""
              :text-style-summary-override="collapsedStatusLabel"
              :text-style-status-override="card.status === 'running' ? 'executing' : 'success'"
              :hide-text-style-toggle="true"
              :non-interactive="true"
            />
          </MessageItem>
        </div>
      </template>
    </div>

    <div v-if="expanded" class="execution-agent-card__body tool-body">
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
        <div class="section-label">工具调用列表</div>
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
              :current-time="currentTime"
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

.execution-agent-card__header {
  width: 100%;
  border: none;
  background: #252526;
  color: inherit;
  padding: 10px 14px;
  cursor: pointer;
  text-align: left;
}

.execution-agent-card__header:hover {
  background: #2d2d30;
}

.execution-agent-card__title-row {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: center;
  gap: 10px;
}

.execution-agent-card__identity {
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.execution-agent-card__icon {
  font-size: 13px;
  line-height: 1;
}

.execution-agent-card__title {
  color: #e4e4e7;
  font-size: 13px;
  font-weight: 600;
}

.execution-agent-card__toggle {
  grid-column: 3;
  justify-self: end;
  color: #c4c7cf;
  font-size: 12px;
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

.execution-agent-card__body {
  padding: 0 14px 14px;
}

.execution-agent-card__active-list {
  padding: 10px 14px 0 22px;
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
