<script setup>
import { computed } from 'vue'
import MessageItem from './messages/MessageItem.vue'
import ExecutionAgentCard from './messages/ExecutionAgentCard.vue'

const props = defineProps({
  timelineBlocks: {
    type: Array,
    default: () => []
  },
  agentEntries: {
    type: Array,
    default: () => []
  },
  hasCollaborativeChildren: {
    type: Boolean,
    default: false
  },
  collaborativeSessions: {
    type: Array,
    default: () => []
  },
  activeSession: {
    type: Object,
    default: null
  },
  splitSessions: {
    type: Array,
    default: () => []
  },
  viewMode: {
    type: String,
    default: 'single'
  },
  focusedPaneAgentId: {
    type: String,
    default: null
  },
  inputTargetAgentId: {
    type: String,
    default: null
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

const emit = defineEmits([
  'selectAgent',
  'focusAgent',
  'toggleViewMode',
  'messageClick',
  'rewind',
  'fork',
  'rewindAndFork',
  'jumpToMessage',
  'copyContent',
  'copyQuestionContent'
])

function selectAgent(agentId) {
  emit('selectAgent', agentId)
}

function focusAgent(agentId) {
  emit('focusAgent', agentId)
}

function toggleViewMode(mode) {
  emit('toggleViewMode', mode)
}

function forward(eventName, payload) {
  emit(eventName, payload)
}

const timelineBlocksWithShell = computed(() => {
  return props.timelineBlocks.map((block, index) => {
    if (block.type !== 'execution-card') {
      return block
    }

    const timestamp = block.card?.bucket?.firstTimestamp || block.card?.registry?.startTime || new Date().toISOString()
    const startTimeValue = Date.parse(block.card?.registry?.startTime || timestamp)
    const shellMessage = {
      id: `execution-card-shell-${block.card.agentId}-${index}`,
      role: 'tool_use',
      subtype: 'execution-card',
      toolName: 'Agent',
      timestamp,
      startTime: Number.isFinite(startTimeValue) ? startTimeValue : null,
      duration: block.card?.duration ?? null,
      usage: block.card?.usage ?? null,
      isExecuting: block.card?.status === 'running' || block.card?.status === 'starting',
      collapsed: true,
      content: '',
      ccgui: {
        attribution: {
          agentId: 'master'
        }
      }
    }

    return {
      ...block,
      shellMessage
    }
  })
})
</script>

<template>
  <div
    class="agent-workspace"
    :class="{
      'agent-workspace--plain': props.agentEntries.length === 0,
      'agent-workspace--split': hasCollaborativeChildren && viewMode === 'split'
    }"
  >
    <div class="agent-workspace__content">
      <div v-if="hasCollaborativeChildren" class="agent-workspace__toolbar">
        <div class="agent-workspace__toolbar-copy">
          <span class="agent-workspace__toolbar-title">代理工作区</span>
          <span class="agent-workspace__toolbar-subtitle">主代理消息流内嵌执行型卡片，协作型代理支持切换与分屏</span>
        </div>
        <div class="agent-workspace__toolbar-modes">
          <button
            class="agent-workspace__mode-btn"
            :class="{ active: viewMode === 'single' }"
            type="button"
            @click="toggleViewMode('single')"
          >
            单视图
          </button>
          <button
            class="agent-workspace__mode-btn"
            :class="{ active: viewMode === 'split' }"
            type="button"
            @click="toggleViewMode('split')"
          >
            分屏
          </button>
        </div>
      </div>

      <div class="agent-workspace__main-stage">
        <template v-if="activeSession?.isMain">
          <template v-for="(block, index) in timelineBlocksWithShell" :key="block.key || `${block.type}-${index}`">
            <MessageItem
              v-if="block.type === 'message'"
              :message="block.message"
              :message-index="block.messageIndex"
              :total-messages="block.totalMessages"
              :working-directory="workingDirectory"
              :current-time="currentTime"
              :all-messages="block.allMessages"
              :chat-theme="chatTheme"
              @message-click="forward('messageClick', $event)"
              @rewind="forward('rewind', $event)"
              @fork="forward('fork', $event)"
              @rewind-and-fork="forward('rewindAndFork', $event)"
              @jump-to-message="forward('jumpToMessage', $event)"
              @copy-content="forward('copyContent', $event)"
              @copy-question-content="forward('copyQuestionContent', $event)"
            />
            <MessageItem
              v-else-if="block.type === 'execution-card'"
              :message="block.shellMessage"
              :message-index="0"
              :total-messages="1"
              :working-directory="workingDirectory"
              :current-time="currentTime"
              :all-messages="[block.shellMessage]"
              :chat-theme="chatTheme"
              @message-click="forward('messageClick', $event)"
              @rewind="forward('rewind', $event)"
              @fork="forward('fork', $event)"
              @rewind-and-fork="forward('rewindAndFork', $event)"
              @jump-to-message="forward('jumpToMessage', $event)"
              @copy-content="forward('copyContent', $event)"
              @copy-question-content="forward('copyQuestionContent', $event)"
            >
              <ExecutionAgentCard
                :card="block.card"
                :working-directory="workingDirectory"
                :current-time="currentTime"
                :chat-theme="chatTheme"
              />
            </MessageItem>
          </template>
        </template>

        <template v-else-if="activeSession">
          <div class="agent-workspace__session-header">
            <div>
              <div class="agent-workspace__session-title">{{ activeSession.title }}</div>
              <div class="agent-workspace__session-subtitle">
                {{ activeSession.subtitle || '协作子会话' }}
              </div>
            </div>
            <div class="agent-workspace__session-flags">
              <span class="agent-workspace__session-status">{{ activeSession.status }}</span>
              <span v-if="inputTargetAgentId === activeSession.agentId" class="agent-workspace__session-target">输入目标</span>
            </div>
          </div>

          <MessageItem
            v-for="(message, index) in activeSession.messages"
            :key="message.id || `${activeSession.agentId}-${index}`"
            :message="message"
            :message-index="index"
          :total-messages="activeSession.messages.length"
          :working-directory="workingDirectory"
          :current-time="currentTime"
          :all-messages="activeSession.messages"
          :chat-theme="chatTheme"
          @message-click="forward('messageClick', $event)"
          @rewind="forward('rewind', $event)"
          @fork="forward('fork', $event)"
          @rewind-and-fork="forward('rewindAndFork', $event)"
          @jump-to-message="forward('jumpToMessage', $event)"
          @copy-content="forward('copyContent', $event)"
          @copy-question-content="forward('copyQuestionContent', $event)"
        />
        </template>
      </div>

      <aside
        v-if="hasCollaborativeChildren && viewMode === 'split' && splitSessions.length > 0"
        class="agent-workspace__split-side"
      >
        <section
          v-for="sessionItem in splitSessions"
          :key="sessionItem.agentId"
          class="agent-workspace__split-pane"
          :class="{ focused: focusedPaneAgentId === sessionItem.agentId }"
          @click="focusAgent(sessionItem.agentId)"
        >
          <div class="agent-workspace__session-header agent-workspace__session-header--compact">
            <div>
              <div class="agent-workspace__session-title">{{ sessionItem.title }}</div>
              <div class="agent-workspace__session-subtitle">
                {{ sessionItem.subtitle || (sessionItem.isMain ? '主会话' : '协作子会话') }}
              </div>
            </div>
            <div class="agent-workspace__session-flags">
              <span class="agent-workspace__session-status">{{ sessionItem.status }}</span>
              <span v-if="inputTargetAgentId === sessionItem.agentId" class="agent-workspace__session-target">输入目标</span>
            </div>
          </div>

          <MessageItem
            v-for="(message, index) in sessionItem.messages"
            :key="message.id || `${sessionItem.agentId}-${index}`"
            :message="message"
            :message-index="index"
            :total-messages="sessionItem.messages.length"
            :working-directory="workingDirectory"
            :current-time="currentTime"
            :all-messages="sessionItem.messages"
            :chat-theme="chatTheme"
            @message-click="forward('messageClick', $event)"
            @rewind="forward('rewind', $event)"
            @fork="forward('fork', $event)"
            @rewind-and-fork="forward('rewindAndFork', $event)"
            @jump-to-message="forward('jumpToMessage', $event)"
            @copy-content="forward('copyContent', $event)"
            @copy-question-content="forward('copyQuestionContent', $event)"
          />
        </section>
      </aside>
    </div>

    <aside v-if="props.agentEntries.length > 0" class="agent-workspace__rail">
      <div class="agent-workspace__rail-header">
        <span>代理列表</span>
        <span class="agent-workspace__rail-mode">{{ viewMode }}</span>
      </div>
      <button
        v-for="agentItem in agentEntries"
        :key="agentItem.agentId"
        class="agent-workspace__rail-item"
        :class="{
          active: activeSession?.agentId === agentItem.agentId,
          focused: focusedPaneAgentId === agentItem.agentId,
          disabled: agentItem.canActivate === false
        }"
        type="button"
        :disabled="agentItem.canActivate === false"
        @click="selectAgent(agentItem.agentId)"
      >
        <div class="agent-workspace__rail-item-top">
          <span class="agent-workspace__rail-title">{{ agentItem.title }}</span>
          <span class="agent-workspace__rail-status">{{ agentItem.status }}</span>
        </div>
        <div class="agent-workspace__rail-subtitle">
          {{ agentItem.subtitle }}
        </div>
        <div class="agent-workspace__rail-flags">
          <span>{{ agentItem.agentId }}</span>
          <span v-if="focusedPaneAgentId === agentItem.agentId">焦点</span>
          <span v-if="inputTargetAgentId === agentItem.agentId">输入</span>
          <span v-if="agentItem.canActivate === false">卡片</span>
        </div>
      </button>
    </aside>
  </div>
</template>

<style scoped>
.agent-workspace {
  min-height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 224px;
  gap: 16px;
}

.agent-workspace--plain {
  display: block;
}

.agent-workspace--split {
  grid-template-columns: minmax(0, 1fr) 224px;
}

.agent-workspace__content {
  min-width: 0;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
}

.agent-workspace--split .agent-workspace__content {
  grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
  align-items: start;
}

.agent-workspace__main-stage {
  min-width: 0;
}

.agent-workspace__toolbar {
  grid-column: 1 / -1;
  margin: 4px 0 14px;
  padding: 12px 14px;
  border: 1px solid rgba(63, 63, 70, 0.9);
  border-radius: 16px;
  background: rgba(24, 24, 27, 0.9);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.agent-workspace__toolbar-title {
  display: block;
  color: #f4f4f5;
  font-size: 13px;
  font-weight: 600;
}

.agent-workspace__toolbar-subtitle {
  display: block;
  margin-top: 4px;
  color: #a1a1aa;
  font-size: 11px;
}

.agent-workspace__toolbar-modes {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.agent-workspace__mode-btn {
  padding: 6px 12px;
  border: 1px solid rgba(63, 63, 70, 0.9);
  border-radius: 999px;
  background: rgba(39, 39, 42, 0.88);
  color: #a1a1aa;
  font-size: 11px;
  cursor: pointer;
}

.agent-workspace__mode-btn.active {
  border-color: rgba(96, 165, 250, 0.6);
  color: #eff6ff;
  background: rgba(30, 41, 59, 0.92);
}

.agent-workspace__split-side {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

.agent-workspace__split-pane {
  min-width: 0;
  padding: 0 10px 12px;
  border: 1px solid rgba(63, 63, 70, 0.88);
  border-radius: 16px;
  background: rgba(17, 24, 39, 0.26);
}

.agent-workspace__session-header--compact {
  margin: 8px 0 12px;
  padding: 12px 14px;
}

.agent-workspace__split-pane.focused {
  border-color: rgba(96, 165, 250, 0.62);
  box-shadow: inset 0 0 0 1px rgba(96, 165, 250, 0.16);
}

.agent-workspace__session-header {
  margin: 8px 0 16px;
  padding: 14px 16px;
  border: 1px solid rgba(59, 130, 246, 0.22);
  border-radius: 14px;
  background: rgba(23, 37, 84, 0.18);
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.agent-workspace__session-title {
  color: #f4f4f5;
  font-size: 14px;
  font-weight: 600;
}

.agent-workspace__session-subtitle {
  margin-top: 4px;
  color: #a1a1aa;
  font-size: 12px;
}

.agent-workspace__session-flags {
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-workspace__session-status {
  color: #93c5fd;
  font-size: 12px;
}

.agent-workspace__session-target {
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(96, 165, 250, 0.18);
  color: #bfdbfe;
  font-size: 11px;
}

.agent-workspace__rail {
  position: sticky;
  top: 0;
  align-self: start;
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 10px;
  border: 1px solid rgba(63, 63, 70, 0.9);
  border-radius: 16px;
  background: rgba(24, 24, 27, 0.9);
}

.agent-workspace__rail-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  color: #e4e4e7;
  font-size: 12px;
  font-weight: 600;
}

.agent-workspace__rail-mode {
  color: #71717a;
  text-transform: uppercase;
  font-size: 10px;
}

.agent-workspace__rail-item {
  padding: 10px 12px;
  border: 1px solid rgba(63, 63, 70, 0.9);
  border-radius: 12px;
  background: rgba(39, 39, 42, 0.88);
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease, transform 0.15s ease;
}

.agent-workspace__rail-item:hover {
  border-color: rgba(96, 165, 250, 0.45);
  transform: translateY(-1px);
}

.agent-workspace__rail-item.active,
.agent-workspace__rail-item.focused {
  border-color: rgba(96, 165, 250, 0.62);
  background: rgba(30, 41, 59, 0.92);
}

.agent-workspace__rail-item.disabled {
  cursor: default;
  opacity: 0.8;
}

.agent-workspace__rail-item.disabled:hover {
  transform: none;
  border-color: rgba(63, 63, 70, 0.9);
}

.agent-workspace__rail-item-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.agent-workspace__rail-title {
  color: #f4f4f5;
  font-size: 13px;
  font-weight: 600;
}

.agent-workspace__rail-status {
  color: #93c5fd;
  font-size: 11px;
}

.agent-workspace__rail-subtitle {
  margin-top: 6px;
  color: #a1a1aa;
  font-size: 11px;
  line-height: 1.4;
}

.agent-workspace__rail-flags {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  color: #bfdbfe;
  font-size: 10px;
}

@media (max-width: 1320px) {
  .agent-workspace__content {
    grid-template-columns: minmax(0, 1fr);
  }
}

@media (max-width: 1100px) {
  .agent-workspace {
    grid-template-columns: minmax(0, 1fr);
  }

  .agent-workspace__rail {
    position: static;
    order: -1;
  }
}
</style>
