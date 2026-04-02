<script setup>
import { computed, ref } from 'vue'
import MessageItem from './messages/MessageItem.vue'
import ExecutionAgentCard from './messages/ExecutionAgentCard.vue'
import ThinkingSection from './messages/ThinkingSection.vue'
import StickyHeader from './layout/StickyHeader.vue'
import AgentWorkspaceTopRail from './AgentWorkspaceTopRail.vue'
import { useMessage } from '../composables/useMessage'

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
  sessionId: {
    type: String,
    default: ''
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
  stickyMessage: {
    type: Object,
    default: null
  },
  showStickyHeader: {
    type: Boolean,
    default: false
  },
  stickyIsProcessing: {
    type: Boolean,
    default: false
  },
  stickyCopied: {
    type: Boolean,
    default: false
  },
  containerHeight: {
    type: Number,
    default: 400
  },
  chatTheme: {
    type: Object,
    default: () => ({})
  },
  railVisible: {
    type: Boolean,
    default: true
  },
  railPlacement: {
    type: String,
    default: 'side'
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
  'copyQuestionContent',
  'copySticky',
  'scrollToSticky',
  'contentScroll'
])

const { copiedMessageIndex: copiedThinkingIndex, copyToClipboard } = useMessage()

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

function handleContentScroll(event) {
  emit('contentScroll', event)
}

function toggleDeletedTeam(teamId) {
  expandedDeletedTeamId.value = expandedDeletedTeamId.value === teamId ? null : teamId
}

function selectTeamGroup(group) {
  const firstMember = group?.members?.[0]
  if (firstMember?.agentId) {
    selectAgent(firstMember.agentId)
  }
}

function railItemStyle(agentItem) {
  if (!agentItem?.color) {
    return null
  }

  return {
    '--agent-color': agentItem.color,
    borderColor: agentItem.color
  }
}

function railItemTypeLabel(agentItem) {
  if (!agentItem) return ''
  if (agentItem.isMain) return '主会话'

  const typeMap = {
    team: '团队',
    'team-lead': '组长',
    'general-purpose': '通用代理',
    Explore: '探索',
    Plan: '规划'
  }

  return typeMap[agentItem.agentType] || agentItem.agentType || '代理'
}

const timelineBlocksWithShell = computed(() => {
  return props.timelineBlocks.map((block, index) => {
    const displayIndex = index

    if (block.type !== 'execution-card') {
      return {
        ...block,
        displayIndex
      }
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
      shellMessage,
      displayIndex
    }
  })
})

const mainStageDisplayMessages = computed(() => {
  return timelineBlocksWithShell.value.map(block => {
    if (block.type === 'execution-card') {
      return block.shellMessage
    }
    return block.message
  }).filter(Boolean)
})

function getBlockMessage(block) {
  if (!block) return null
  if (block.type === 'execution-card') return block.shellMessage || null
  return block.message || null
}

function isAssistantAnswerBlock(block) {
  const message = getBlockMessage(block)
  return message?.role === 'assistant' && message?.subtype !== 'thinking'
}

function isFoldableActivityBlock(block) {
  const message = getBlockMessage(block)
  if (!message) return false
  if (message.role === 'user' || message.role === 'assistant') return false
  if (message.role === 'system' || message.role === 'task_complete') return false
  if (message.role === 'system_notification' && message.scope === 'session') return false
  return true
}

function hasExternalThinking(block) {
  const message = getBlockMessage(block)
  return Boolean(message?.role === 'assistant' && message?.thinking)
}

function getFoldableActivityCount(activityBlocks, assistantBlock = null) {
  return activityBlocks.length + (hasExternalThinking(assistantBlock) ? 1 : 0)
}

function getActivityGroupToolCallCount(group) {
  if (!group) return 0
  return (group.foldableBlocks || []).reduce((count, block) => {
    const message = getBlockMessage(block)
    if (!message) return count
    if (message.role === 'tool_use' || message.role === 'diff') {
      return count + 1
    }
    return count
  }, 0)
}

function getActivityGroupCollapsedLabel(group) {
  const toolCalls = getActivityGroupToolCallCount(group)
  if (toolCalls > 0) {
    return `已折叠 ${toolCalls} 次工具调用`
  }
  return '已折叠活动内容'
}

function getActivityGroupKey(activityBlocks, assistantBlock = null) {
  const firstBlock = activityBlocks?.[0] || assistantBlock || null
  const firstMessage = getBlockMessage(firstBlock)
  return `activity-group-${firstMessage?.id || firstBlock?.displayIndex || 'unknown'}`
}

function isMessageHiddenByResponseCollapse(messages, messageIndex) {
  if (!Array.isArray(messages) || messageIndex <= 0) return false

  for (let i = messageIndex - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (!message) continue

    if (message.role === 'user') {
      return Boolean(message.responseCollapsed)
    }
  }

  return false
}

function buildRenderableTimeline(blocks) {
  const renderBlocks = []
  let pendingActivities = []

  const flushPendingActivities = () => {
    if (pendingActivities.length === 0) return
    if (getFoldableActivityCount(pendingActivities, null) >= 2) {
      renderBlocks.push({
        type: 'activity-group',
        key: getActivityGroupKey(pendingActivities, null),
        foldableBlocks: [...pendingActivities],
        assistantBlock: null
      })
    } else {
      pendingActivities.forEach(block => {
        renderBlocks.push({
          type: 'block',
          key: block.key || `block-${block.displayIndex}`,
          block
        })
      })
    }
    pendingActivities = []
  }

  blocks.forEach(block => {
    if (isFoldableActivityBlock(block)) {
      pendingActivities.push(block)
      return
    }

    if (isAssistantAnswerBlock(block)) {
      if (getFoldableActivityCount(pendingActivities, block) >= 2) {
        renderBlocks.push({
          type: 'activity-group',
          key: getActivityGroupKey(pendingActivities, block),
          foldableBlocks: [...pendingActivities],
          assistantBlock: block
        })
        pendingActivities = []
        return
      }
    }

    flushPendingActivities()
    renderBlocks.push({
      type: 'block',
      key: block.key || `block-${block.displayIndex}`,
      block
    })
  })

  flushPendingActivities()
  return renderBlocks
}

const collapsedActivityGroups = ref({})

const renderableMainTimelineBlocks = computed(() => buildRenderableTimeline(timelineBlocksWithShell.value))

function isActivityGroupCollapsed(groupKey) {
  return Boolean(collapsedActivityGroups.value[groupKey])
}

function resolveActivityGroupCollapsed(group) {
  const stored = collapsedActivityGroups.value[group.key]
  if (typeof stored === 'boolean') {
    return stored
  }
  return Boolean(group?.assistantBlock)
}

function toggleActivityGroup(groupKey) {
  collapsedActivityGroups.value[groupKey] = !collapsedActivityGroups.value[groupKey]
}

async function copyGroupedThinking(message, index) {
  if (!message?.thinking) return
  await copyToClipboard(message.thinking, index)
}

const railMasterEntry = computed(() => {
  return props.agentEntries.find(entry => entry.isMain) || null
})

const showDeletedTeams = ref(false)
const expandedDeletedTeamId = ref(null)

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

const shouldShowRail = computed(() => {
  if (!props.railVisible) {
    return false
  }

  return (
    railActiveTeamGroups.value.length > 0 ||
    railDeletedTeamGroups.value.length > 0 ||
    railStandaloneEntries.value.length > 0
  )
})
</script>

<template>
  <div
    class="agent-workspace"
    :class="{
      'agent-workspace--plain': props.agentEntries.length === 0,
      'agent-workspace--split': hasCollaborativeChildren && viewMode === 'split',
      'agent-workspace--no-rail': !shouldShowRail,
      'agent-workspace--rail-top': shouldShowRail && props.railPlacement === 'top'
    }"
  >
    <AgentWorkspaceTopRail
      v-if="shouldShowRail && props.railPlacement === 'top'"
      :master-entry="railMasterEntry"
      :active-team-groups="railActiveTeamGroups"
      :deleted-team-groups="railDeletedTeamGroups"
      :active-session="activeSession"
      :view-mode="viewMode"
      @select-agent="selectAgent"
      @toggle-view-mode="toggleViewMode"
    />

    <div class="agent-workspace__content" @scroll="handleContentScroll">
      <StickyHeader
        v-if="showStickyHeader && stickyMessage"
        :message="stickyMessage"
        :is-processing="stickyIsProcessing"
        :current-time="currentTime"
        :container-height="containerHeight"
        :right-inset="0"
        :content-width="0"
        :is-copied="stickyCopied"
        @copy="forward('copySticky')"
        @scroll-to-user="forward('scrollToSticky')"
      />
      <div class="agent-workspace__main-stage">
        <template v-if="activeSession?.isMain">
          <template v-for="renderBlock in renderableMainTimelineBlocks" :key="renderBlock.key">
            <template v-if="renderBlock.type === 'activity-group'">
              <template v-if="!renderBlock.assistantBlock || !isMessageHiddenByResponseCollapse(mainStageDisplayMessages, renderBlock.assistantBlock.displayIndex)">
              <div class="activity-group" :class="{ collapsed: resolveActivityGroupCollapsed(renderBlock) }">
                <div class="activity-group__foldable">
                  <button
                    class="activity-group__rail-toggle"
                    type="button"
                    :title="resolveActivityGroupCollapsed(renderBlock) ? '展开活动段' : '折叠活动段'"
                    @click="toggleActivityGroup(renderBlock.key)"
                  ><span class="activity-group__rail"></span></button>
                  <div v-if="!resolveActivityGroupCollapsed(renderBlock)" class="activity-group__content">
                    <ThinkingSection
                      v-if="hasExternalThinking(renderBlock.assistantBlock)"
                      :thinking="renderBlock.assistantBlock.message.thinking"
                      :is-collapsed="false"
                      :message-index="renderBlock.assistantBlock.displayIndex"
                      :copied-message-index="copiedThinkingIndex"
                      :chat-theme="chatTheme"
                      @copy-content="() => copyGroupedThinking(renderBlock.assistantBlock.message, renderBlock.assistantBlock.displayIndex)"
                    />
                    <template v-for="nestedBlock in renderBlock.foldableBlocks" :key="nestedBlock.key || `nested-${nestedBlock.displayIndex}`">
                      <MessageItem
                        v-if="nestedBlock.type === 'message'"
                        :message="nestedBlock.message"
                        :message-index="nestedBlock.displayIndex"
                        :total-messages="mainStageDisplayMessages.length"
                        :session-id="sessionId"
                        :working-directory="workingDirectory"
                        :current-time="currentTime"
                        :all-messages="mainStageDisplayMessages"
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
                        v-else
                        :message="nestedBlock.shellMessage"
                        :message-index="nestedBlock.displayIndex"
                        :total-messages="mainStageDisplayMessages.length"
                        :session-id="sessionId"
                        :working-directory="workingDirectory"
                        :current-time="currentTime"
                        :all-messages="mainStageDisplayMessages"
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
                          :card="nestedBlock.card"
                          :working-directory="workingDirectory"
                          :current-time="currentTime"
                          :chat-theme="chatTheme"
                        />
                      </MessageItem>
                    </template>
                  </div>
                  <button
                    v-else
                    class="activity-group__summary"
                    type="button"
                    @click="toggleActivityGroup(renderBlock.key)"
                  >
                    {{ getActivityGroupCollapsedLabel(renderBlock) }}
                  </button>
                </div>

                <MessageItem
                  v-if="renderBlock.assistantBlock"
                  :message="renderBlock.assistantBlock.message"
                  :message-index="renderBlock.assistantBlock.displayIndex"
                  :total-messages="mainStageDisplayMessages.length"
                  :session-id="sessionId"
                  :working-directory="workingDirectory"
                  :current-time="currentTime"
                  :all-messages="mainStageDisplayMessages"
                  :chat-theme="chatTheme"
                  :externalize-thinking="hasExternalThinking(renderBlock.assistantBlock)"
                  @message-click="forward('messageClick', $event)"
                  @rewind="forward('rewind', $event)"
                  @fork="forward('fork', $event)"
                  @rewind-and-fork="forward('rewindAndFork', $event)"
                  @jump-to-message="forward('jumpToMessage', $event)"
                  @copy-content="forward('copyContent', $event)"
                  @copy-question-content="forward('copyQuestionContent', $event)"
                />
              </div>
              </template>
            </template>

            <MessageItem
              v-else-if="renderBlock.type === 'block' && renderBlock.block.type === 'message'"
              :message="renderBlock.block.message"
              :message-index="renderBlock.block.displayIndex"
              :total-messages="mainStageDisplayMessages.length"
              :session-id="sessionId"
              :working-directory="workingDirectory"
              :current-time="currentTime"
              :all-messages="mainStageDisplayMessages"
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
              v-else-if="renderBlock.type === 'block'"
              :message="renderBlock.block.shellMessage"
              :message-index="renderBlock.block.displayIndex"
              :total-messages="mainStageDisplayMessages.length"
              :session-id="sessionId"
              :working-directory="workingDirectory"
              :current-time="currentTime"
              :all-messages="mainStageDisplayMessages"
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
                :card="renderBlock.block.card"
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
            :session-id="sessionId"
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
            :session-id="sessionId"
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

    <aside v-if="shouldShowRail && props.railPlacement !== 'top'" class="agent-workspace__rail">
      <div class="agent-workspace__rail-header">
        <span>团队</span>
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
        <span class="agent-workspace__rail-simple-type">{{ railItemTypeLabel(railMasterEntry) }}</span>
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
          <span class="agent-workspace__rail-simple-type">{{ railItemTypeLabel(agentItem) }}</span>
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
        <span class="agent-workspace__rail-simple-type">{{ railItemTypeLabel(agentItem) }}</span>
      </button>

      <div v-if="railDeletedTeamGroups.length > 0" class="agent-workspace__rail-deleted">
        <button
          class="agent-workspace__rail-deleted-toggle"
          type="button"
          @click="showDeletedTeams = !showDeletedTeams; if (!showDeletedTeams) expandedDeletedTeamId = null"
        >
          {{ showDeletedTeams ? '隐藏已关闭' : `已关闭 ${railDeletedTeamGroups.length}` }}
        </button>

        <div v-if="showDeletedTeams">
          <div
            v-for="group in railDeletedTeamGroups"
            :key="`deleted-${group.teamId}`"
            class="agent-workspace__rail-deleted-section"
          >
            <button
              class="agent-workspace__rail-deleted-team"
              type="button"
              :class="{ active: expandedDeletedTeamId === group.teamId }"
              @click="toggleDeletedTeam(group.teamId)"
            >
              <span class="agent-workspace__rail-deleted-team-name">{{ group.title }}</span>
            </button>

            <div v-if="expandedDeletedTeamId === group.teamId" class="agent-workspace__rail-deleted-members">
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
                <span class="agent-workspace__rail-simple-type">{{ railItemTypeLabel(agentItem) }}</span>
              </button>
            </div>
          </div>
        </div>
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

.agent-workspace--no-rail {
  grid-template-columns: minmax(0, 1fr);
}

.agent-workspace--rail-top {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
}

.agent-workspace--split {
  grid-template-columns: minmax(0, 1fr) 72px;
}

.agent-workspace--split.agent-workspace--no-rail {
  grid-template-columns: minmax(0, 1fr);
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

.activity-group {
  min-width: 0;
}

.activity-group__foldable {
  position: relative;
  min-width: 0;
}

.activity-group__rail-toggle {
  position: absolute;
  left: -18px;
  top: 0;
  bottom: 10px;
  z-index: 2;
  width: 12px;
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  transition: opacity 0.15s ease;
}

.activity-group__rail-toggle:hover .activity-group__rail {
  box-shadow: 0 0 0 1px rgba(161, 161, 170, 0.42);
}

.activity-group__rail-toggle:hover::before,
.activity-group__rail-toggle:hover::after {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
  color: rgba(212, 212, 216, 0.9);
  font-size: 8px;
  line-height: 1;
  pointer-events: none;
}

.activity-group__rail-toggle:hover::before {
  top: -2px;
  content: '⌄';
}

.activity-group__rail-toggle:hover::after {
  bottom: 8px;
  content: '⌃';
}

.activity-group__rail {
  position: absolute;
  left: 3px;
  top: 0;
  bottom: 10px;
  width: 6px;
  border-radius: 999px;
  background: linear-gradient(180deg, rgba(161, 161, 170, 0.2), rgba(161, 161, 170, 0.12));
}

.activity-group.collapsed .activity-group__rail-toggle {
  bottom: auto;
  top: 0;
  height: 24px;
}

.activity-group.collapsed .activity-group__rail-toggle:hover::before {
  top: 1px;
  content: '⌃';
}

.activity-group.collapsed .activity-group__rail-toggle:hover::after {
  bottom: 1px;
  content: '⌄';
}

.activity-group.collapsed .activity-group__rail {
  top: 0;
  bottom: auto;
  height: 24px;
}

.activity-group__content {
  display: flow-root;
  min-width: 0;
}

.activity-group__summary {
  display: inline-flex;
  align-items: center;
  min-height: 24px;
  padding: 0 0 10px;
  border: none;
  background: transparent;
  color: #71717A;
  font-size: 12px;
  line-height: 1.5;
  cursor: pointer;
  text-align: left;
}

.activity-group__summary:hover {
  color: #A1A1AA;
}

.activity-group__content > :first-child {
  margin-top: 0;
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
  padding: 0;
  border-left: 1px solid rgba(63, 63, 70, 0.75);
  background: transparent;
}

.agent-workspace__rail-header {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px 0 6px;
  color: #a1a1aa;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1;
}

.agent-workspace__rail-header span {
  display: inline;
}

.agent-workspace__rail-toplist {
  display: flex;
  align-items: stretch;
  gap: 4px;
  min-width: 0;
  overflow-x: auto;
  overflow-y: hidden;
  scrollbar-width: none;
}

.agent-workspace__rail-toplist::-webkit-scrollbar {
  display: none;
}

.agent-workspace__rail-top-chip {
  flex: 0 0 auto;
  min-width: 44px;
  padding: 6px 8px;
  border: 1px solid rgba(63, 63, 70, 0.9);
  border-radius: 14px;
  background: rgba(39, 39, 42, 0.88);
  color: #f4f4f5;
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.agent-workspace__rail-top-chip:hover {
  border-color: rgba(96, 165, 250, 0.45);
}

.agent-workspace__rail-top-chip.active {
  border-color: var(--agent-color, rgba(96, 165, 250, 0.62));
  background: var(--agent-color, #3b82f6);
  color: #ffffff;
}

.agent-workspace__rail-segment {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  background: #1F1F23;
  border: 1px solid #34343A;
  border-radius: 12px;
  overflow: hidden;
}

.agent-workspace__rail-segment .provider-tab {
  flex: 1;
  border: none;
  background: transparent;
  color: #A1A1AA;
  font-size: 13px;
  font-weight: 600;
  line-height: 1;
  padding: 7px 0;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.agent-workspace__rail-segment .provider-tab:hover {
  color: #F4F4F5;
  background: rgba(255, 255, 255, 0.05);
}

.agent-workspace__rail-segment .provider-tab.active {
  color: #18181B;
  background: #F59E0B;
}

.agent-workspace__mode-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
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
  text-align: left;
  padding: 0 6px;
}

.agent-workspace__rail-item {
  padding: 8px 6px;
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
  border-color: var(--agent-color, rgba(96, 165, 250, 0.62));
  background: var(--agent-color, #3b82f6);
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
  align-items: flex-start;
  gap: 3px;
  min-height: 58px;
  padding: 8px 6px;
  text-align: left;
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

.agent-workspace__rail-simple-type {
  color: #a1a1aa;
  font-size: 9px;
  line-height: 1.15;
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.agent-workspace__rail-deleted {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-top: 8px;
  max-height: 220px;
  overflow-y: auto;
  scrollbar-width: thin;
}

.agent-workspace__rail-deleted-toggle {
  width: 100%;
  padding: 6px 0 4px;
  border: 1px solid rgba(63, 63, 70, 0.7);
  border-radius: 0;
  background: rgba(39, 39, 42, 0.52);
  color: #a1a1aa;
  font-size: 10px;
  cursor: pointer;
}

.agent-workspace__rail-deleted-toggle--top {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  width: 18px;
  min-height: 52px;
  padding: 0;
  line-height: 1;
}

.agent-workspace__rail-deleted-toggle:hover {
  color: #e4e4e7;
  border-color: rgba(96, 165, 250, 0.35);
  background: rgba(255, 255, 255, 0.04);
}

.agent-workspace__rail-deleted-section {
  display: flex;
  flex-direction: column;
}

.agent-workspace__rail-deleted-team {
  width: 100%;
  padding: 6px 0 4px;
  border: none;
  border-top: 1px solid rgba(63, 63, 70, 0.45);
  background: transparent;
  color: #a1a1aa;
  font-size: 10px;
  cursor: pointer;
  transition: color 0.15s ease, background 0.15s ease;
}

.agent-workspace__rail-deleted-team:hover {
  color: #e4e4e7;
  background: rgba(255, 255, 255, 0.04);
}

.agent-workspace__rail-deleted-team.active {
  color: #f4f4f5;
  background: rgba(59, 130, 246, 0.12);
}

.agent-workspace__rail-deleted-team-name {
  display: block;
  width: 100%;
}

.agent-workspace__rail-deleted-members {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px 0 6px;
  border-top: 1px solid rgba(63, 63, 70, 0.3);
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
    min-height: 0;
    flex-direction: row;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 8px;
    padding: 0 0 8px;
    border-left: none;
    border-bottom: 1px solid rgba(63, 63, 70, 0.75);
  }

  .agent-workspace__rail-header {
    width: 100%;
    justify-content: flex-start;
    padding: 0 0 2px;
  }

  .agent-workspace__rail-segment {
    flex: 0 0 auto;
    align-self: center;
  }

  .agent-workspace__rail-group {
    flex: 0 0 auto;
    flex-direction: row;
    align-items: stretch;
    gap: 6px;
    padding: 0;
    border: none;
    background: transparent;
  }

  .agent-workspace__rail-group-title {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0 6px 0 2px;
    text-align: left;
    white-space: nowrap;
  }

  .agent-workspace__rail-item--simple {
    min-height: 0;
    min-width: 108px;
    padding: 6px 8px;
    gap: 2px;
  }

  .agent-workspace__rail-simple-name {
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .agent-workspace__rail-deleted {
    margin-top: 0;
    margin-left: auto;
    max-height: none;
    overflow: visible;
    flex: 0 0 auto;
    min-width: 120px;
    padding-top: 0;
  }

  .agent-workspace__rail-deleted-members {
    flex-direction: row;
    flex-wrap: wrap;
    gap: 6px;
    padding: 6px 0 0;
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
