<script setup>
import { computed, ref } from 'vue'
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

function railItemStyle(agentItem) {
  if (!agentItem?.color) {
    return null
  }

  return {
    '--agent-color': agentItem.color,
    borderLeftColor: agentItem.color,
    backgroundImage: `linear-gradient(90deg, ${agentItem.color} 0 3px, transparent 3px 100%)`
  }
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

const railMasterEntry = computed(() => {
  return props.agentEntries.find(entry => entry.isMain) || null
})

const showDeletedTeams = ref(false)

const railTeamGroups = computed(() => {
  const teamEntriesById = new Map(
    props.agentEntries
      .filter(entry => entry.agentType === 'team')
      .map(entry => [entry.agentId, entry])
  )

  const members = props.agentEntries.filter(entry => {
    return entry.agentType !== 'team' && entry.agentType !== 'team-lead' && !entry.isMain
  })

  const groups = new Map()
  for (const member of members) {
    if (!member.teamId) {
      continue
    }

    if (!groups.has(member.teamId)) {
      const teamEntry = teamEntriesById.get(member.teamId)
      const fallbackTitle = String(member.teamId)
        .replace(/^claude-team:/, '')
        .replace(/^team:/, '')
      groups.set(member.teamId, {
        teamId: member.teamId,
        title: teamEntry?.title || teamEntry?.name || fallbackTitle,
        status: teamEntry?.status || (member.status === 'deleted' ? 'deleted' : 'running'),
        members: []
      })
    }

    groups.get(member.teamId).members.push(member)
  }

  return Array.from(groups.values()).map(group => ({
    ...group,
    status: group.status === 'deleted' || group.members.every(member => member.status === 'deleted')
      ? 'deleted'
      : 'running'
  }))
})

const railActiveTeamGroups = computed(() => {
  return railTeamGroups.value.filter(group => group.status !== 'deleted')
})

const railDeletedTeamGroups = computed(() => {
  return railTeamGroups.value.filter(group => group.status === 'deleted')
})

const railStandaloneEntries = computed(() => {
  const groupedMemberIds = new Set(railTeamGroups.value.flatMap(group => group.members.map(member => member.agentId)))
  return props.agentEntries.filter(entry => {
    if (entry.isMain) return false
    if (entry.agentType === 'team' || entry.agentType === 'team-lead') return false
    return !groupedMemberIds.has(entry.agentId)
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
      <div v-if="hasCollaborativeChildren" class="agent-workspace__rail-segment">
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
      <button
        v-if="railMasterEntry"
        class="agent-workspace__rail-item agent-workspace__rail-item--simple"
        :class="{
          active: activeSession?.agentId === railMasterEntry.agentId,
          focused: focusedPaneAgentId === railMasterEntry.agentId,
          readonly: railMasterEntry.canWrite === false
        }"
        :style="railItemStyle(railMasterEntry)"
        type="button"
        @click="selectAgent(railMasterEntry.agentId)"
      >
        <span class="agent-workspace__rail-simple-name">{{ railMasterEntry.title }}</span>
      </button>

      <section
        v-for="group in railActiveTeamGroups"
        :key="group.teamId"
        class="agent-workspace__rail-group"
      >
        <div class="agent-workspace__rail-group-title">{{ group.title }}</div>
        <button
          v-for="agentItem in group.members"
          :key="agentItem.agentId"
          class="agent-workspace__rail-item agent-workspace__rail-item--simple"
          :class="{
            active: activeSession?.agentId === agentItem.agentId,
            focused: focusedPaneAgentId === agentItem.agentId,
            readonly: agentItem.canWrite === false
          }"
          :style="railItemStyle(agentItem)"
          type="button"
          :disabled="agentItem.canActivate === false"
          @click="selectAgent(agentItem.agentId)"
        >
          <span class="agent-workspace__rail-simple-name">{{ agentItem.title }}</span>
        </button>
      </section>

      <button
        v-for="agentItem in railStandaloneEntries"
        :key="agentItem.agentId"
        class="agent-workspace__rail-item agent-workspace__rail-item--simple"
        :class="{
          active: activeSession?.agentId === agentItem.agentId,
          focused: focusedPaneAgentId === agentItem.agentId,
          readonly: agentItem.canWrite === false
        }"
        :style="railItemStyle(agentItem)"
        type="button"
        :disabled="agentItem.canActivate === false"
        @click="selectAgent(agentItem.agentId)"
      >
        <span class="agent-workspace__rail-simple-name">{{ agentItem.title }}</span>
      </button>

      <div v-if="railDeletedTeamGroups.length > 0" class="agent-workspace__rail-deleted">
        <button
          class="agent-workspace__rail-deleted-toggle"
          type="button"
          @click="showDeletedTeams = !showDeletedTeams"
        >
          {{ showDeletedTeams ? '隐藏已关闭' : `已关闭 ${railDeletedTeamGroups.length}` }}
        </button>

        <section
          v-for="group in showDeletedTeams ? railDeletedTeamGroups : []"
          :key="`deleted-${group.teamId}`"
          class="agent-workspace__rail-group agent-workspace__rail-group--deleted"
        >
          <div class="agent-workspace__rail-group-title">{{ group.title }}</div>
          <button
            v-for="agentItem in group.members"
            :key="agentItem.agentId"
            class="agent-workspace__rail-item agent-workspace__rail-item--simple"
            :class="{
              active: activeSession?.agentId === agentItem.agentId,
              focused: focusedPaneAgentId === agentItem.agentId,
              readonly: agentItem.canWrite === false
            }"
            :style="railItemStyle(agentItem)"
            type="button"
            :disabled="agentItem.canActivate === false"
            @click="selectAgent(agentItem.agentId)"
          >
            <span class="agent-workspace__rail-simple-name">{{ agentItem.title }}</span>
          </button>
        </section>
      </div>
    </aside>
  </div>
</template>

<style scoped>
.agent-workspace {
  min-height: 100%;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr) 72px;
  gap: 0;
  align-items: start;
}

.agent-workspace--plain {
  display: block;
}

.agent-workspace--split {
  grid-template-columns: minmax(0, 1fr) 72px;
}

.agent-workspace__content {
  min-width: 0;
  min-height: 0;
  height: 100%;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 16px;
  overflow-y: auto;
  overflow-x: hidden;
  padding: 20px 6px 20px 20px;
  scrollbar-width: thin;
  scrollbar-color: #52525B transparent;
}

.agent-workspace--split .agent-workspace__content {
  grid-template-columns: minmax(0, 1fr) minmax(280px, 360px);
  align-items: start;
}

.agent-workspace__main-stage {
  min-width: 0;
}

.agent-workspace__mode-btn {
  flex: 1;
  padding: 6px 10px;
  border: 1px solid rgba(63, 63, 70, 0.9);
  border-radius: 10px;
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
  align-self: stretch;
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 0;
  border-left: 1px solid rgba(63, 63, 70, 0.75);
  background: transparent;
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

.agent-workspace__rail-segment {
  display: flex;
  align-items: center;
  gap: 8px;
}

.agent-workspace__rail-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 4px;
  border: 1px solid rgba(63, 63, 70, 0.7);
  border-radius: 12px;
  background: rgba(17, 24, 39, 0.18);
}

.agent-workspace__rail-group--deleted {
  opacity: 0.75;
}

.agent-workspace__rail-group-title {
  color: #a1a1aa;
  font-size: 10px;
  font-weight: 600;
  text-align: center;
}

.agent-workspace__rail-item {
  padding: 8px 6px;
  border: 1px solid rgba(63, 63, 70, 0.9);
  border-left: 3px solid transparent;
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

.agent-workspace__rail-item--simple {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 4px;
  min-height: 58px;
  padding: 8px 3px;
  text-align: center;
}

.agent-workspace__rail-item--simple .agent-workspace__rail-title,
.agent-workspace__rail-item--simple .agent-workspace__rail-subtitle,
.agent-workspace__rail-item--simple .agent-workspace__rail-flags,
.agent-workspace__rail-item--simple .agent-workspace__rail-status,
.agent-workspace__rail-item--simple .agent-workspace__rail-item-top {
  display: none;
}

.agent-workspace__rail-simple-name {
  color: #f4f4f5;
  font-size: 11px;
  font-weight: 600;
  width: 100%;
  overflow: hidden;
  line-height: 1.2;
  white-space: normal;
  word-break: break-word;
}

.agent-workspace__rail-deleted {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding-top: 8px;
}

.agent-workspace__rail-deleted-toggle {
  width: 100%;
  padding: 6px 4px;
  border: 1px solid rgba(63, 63, 70, 0.7);
  border-radius: 10px;
  background: rgba(39, 39, 42, 0.52);
  color: #a1a1aa;
  font-size: 10px;
  cursor: pointer;
}

.agent-workspace__rail-deleted-toggle:hover {
  color: #e4e4e7;
  border-color: rgba(96, 165, 250, 0.35);
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

.agent-workspace__content::-webkit-scrollbar {
  width: 4px;
  height: 4px;
}

.agent-workspace__content::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 999px;
}

.agent-workspace__content::-webkit-scrollbar-thumb {
  background: #52525B;
  border-radius: 999px;
  border: none;
}

.agent-workspace__content::-webkit-scrollbar-thumb:hover {
  background: #71717A;
}

.agent-workspace__content::-webkit-scrollbar-thumb:active {
  background: #A1A1AA;
}
</style>
