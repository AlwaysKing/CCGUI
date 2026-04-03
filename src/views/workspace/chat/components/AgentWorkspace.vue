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
const hoveredRailAgentId = ref(null)
const railTooltipPosition = ref({ top: 0, left: 0 })

const hoveredRailAgent = computed(() => {
  if (!hoveredRailAgentId.value) return null
  if (railMasterEntry.value?.agentId === hoveredRailAgentId.value) return railMasterEntry.value
  for (const group of railActiveTeamGroups.value) {
    for (const member of group.members) {
      if (member.agentId === hoveredRailAgentId.value) return member
    }
  }
  for (const entry of railStandaloneEntries.value) {
    if (entry.agentId === hoveredRailAgentId.value) return entry
  }
  return null
})

function onRailTabEnter(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  railTooltipPosition.value = {
    top: rect.top + rect.height / 2,
    left: rect.left - 6
  }
}

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
        class="agent-workspace__rail-tab"
        :class="{
          active: activeSession?.agentId === railMasterEntry.agentId,
          focused: focusedPaneAgentId === railMasterEntry.agentId
        }"
        type="button"
        @click="selectAgent(railMasterEntry.agentId)"
        @mouseenter="hoveredRailAgentId = railMasterEntry.agentId; onRailTabEnter($event)"
        @mouseleave="hoveredRailAgentId = null"
      >
        <span class="agent-workspace__rail-dot" :style="{ background: railMasterEntry.color || '#60A5FA' }"></span>
        <span class="agent-workspace__rail-tab-name">{{ railMasterEntry.title }}</span>
      </button>

      <div
        v-for="group in railActiveTeamGroups"
        :key="group.teamId"
        class="agent-workspace__rail-group"
      >
        <div class="agent-workspace__rail-group-title">{{ group.title }}</div>
        <button
          v-for="agentItem in group.members"
          :key="agentItem.agentId"
          class="agent-workspace__rail-tab"
          :class="{
            active: activeSession?.agentId === agentItem.agentId,
            focused: focusedPaneAgentId === agentItem.agentId
          }"
          type="button"
          :disabled="agentItem.canActivate === false"
          @click="selectAgent(agentItem.agentId)"
          @mouseenter="hoveredRailAgentId = agentItem.agentId; onRailTabEnter($event)"
          @mouseleave="hoveredRailAgentId = null"
        >
          <span class="agent-workspace__rail-dot" :style="{ background: agentItem.color || '#60A5FA' }"></span>
          <span class="agent-workspace__rail-tab-name">{{ agentItem.title }}</span>
        </button>
      </div>

      <button
        v-for="agentItem in railStandaloneEntries"
        :key="agentItem.agentId"
        class="agent-workspace__rail-tab"
        :class="{
          active: activeSession?.agentId === agentItem.agentId,
          focused: focusedPaneAgentId === agentItem.agentId
        }"
        type="button"
        :disabled="agentItem.canActivate === false"
        @click="selectAgent(agentItem.agentId)"
        @mouseenter="hoveredRailAgentId = agentItem.agentId; onRailTabEnter($event)"
        @mouseleave="hoveredRailAgentId = null"
      >
        <span class="agent-workspace__rail-dot" :style="{ background: agentItem.color || '#60A5FA' }"></span>
        <span class="agent-workspace__rail-tab-name">{{ agentItem.title }}</span>
      </button>

      <Teleport to="body">
        <div
          v-if="hoveredRailAgent"
          class="rail-tooltip"
          :style="{
            position: 'fixed',
            top: railTooltipPosition.top + 'px',
            left: railTooltipPosition.left + 'px',
            transform: 'translate(-100%, -50%)'
          }"
        >
          <span class="rail-tooltip__title">{{ hoveredRailAgent.title }}</span>
          <span class="rail-tooltip__line">类型: {{ railItemTypeLabel(hoveredRailAgent) }}</span>
          <span v-if="hoveredRailAgent.status" class="rail-tooltip__line">状态: {{ hoveredRailAgent.status }}</span>
          <span v-if="hoveredRailAgent.model" class="rail-tooltip__line">模型: {{ hoveredRailAgent.model }}</span>
        </div>
      </Teleport>

      <div v-if="railDeletedTeamGroups.length > 0" class="agent-workspace__rail-deleted">
        <button
          class="agent-workspace__rail-tab agent-workspace__rail-tab--deleted"
          type="button"
          @click="showDeletedTeams = !showDeletedTeams; if (!showDeletedTeams) { expandedDeletedTeamId = null; selectAgent(railMasterEntry.agentId) }"
        >
          <span class="agent-workspace__rail-tab-name">{{ showDeletedTeams ? '收起' : `已关闭 ${railDeletedTeamGroups.length}` }}</span>
        </button>

        <template v-if="showDeletedTeams">
          <div
            v-for="group in railDeletedTeamGroups"
            :key="`deleted-${group.teamId}`"
            class="agent-workspace__rail-deleted-group"
          >
            <button
              class="agent-workspace__rail-tab agent-workspace__rail-tab--deleted"
              :class="{ active: expandedDeletedTeamId === group.teamId }"
              type="button"
              @click="toggleDeletedTeam(group.teamId)"
            >
              <span class="agent-workspace__rail-dot agent-workspace__rail-dot--deleted"></span>
              <span class="agent-workspace__rail-tab-name">{{ group.title }}</span>
            </button>
            <template v-if="expandedDeletedTeamId === group.teamId">
              <button
                v-for="agentItem in group.members"
                :key="agentItem.agentId"
                class="agent-workspace__rail-tab agent-workspace__rail-tab--deleted"
                :class="{ active: activeSession?.agentId === agentItem.agentId }"
                type="button"
                :disabled="agentItem.canActivate === false"
                @click="selectAgent(agentItem.agentId)"
              >
                <span class="agent-workspace__rail-dot agent-workspace__rail-dot--deleted"></span>
                <span class="agent-workspace__rail-tab-name">{{ agentItem.title }}</span>
              </button>
            </template>
          </div>
        </template>
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
  gap: 4px;
  padding: 4px 0;
  border-left: 1px solid rgba(63, 63, 70, 0.75);
  background: transparent;
}

.agent-workspace__rail-header {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2px 0 2px;
  color: #71717a;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  line-height: 1;
  user-select: none;
}

.agent-workspace__rail-header span {
  display: inline;
}

.agent-workspace__rail-tab {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 4px;

  width: 100%;
  padding: 4px 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #a1a1aa;
  font-size: 10px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  overflow: hidden;
  transition: background 0.12s ease, color 0.12s ease;
}

.agent-workspace__rail-tab:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #d4d4d8;
}

.agent-workspace__rail-tab.active {
  background: rgba(255, 255, 255, 0.1);
  color: #f4f4f5;
}

.agent-workspace__rail-tab--deleted {
  opacity: 0.55;
}

.agent-workspace__rail-tab--deleted:hover {
  opacity: 0.85;
}

.agent-workspace__rail-dot {
  flex-shrink: 0;
  width: 5px;
  height: 5px;
  margin-top: 4px;
  border-radius: 50%;
  background: #60A5FA;
}

.agent-workspace__rail-dot--deleted {
  background: #71717a;
}

.agent-workspace__rail-tab-name {
  flex: 1;
  min-width: 0;
  text-align: left;
  overflow: hidden;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  word-break: break-all;
  line-height: 1.3;
}

.agent-workspace__rail-group {
  display: flex;
  flex-direction: column;
  gap: 1px;
  padding: 2px 4px;
  border: 1px solid rgba(182, 182, 196, 0.55);
  border-radius: 4px;
  background: rgba(39, 39, 42, 0.28);
}

.agent-workspace__rail-group-title {
  color: #71717a;
  font-size: 9px;
  font-weight: 600;
  text-align: left;
  padding: 2px 4px 1px;
  border-bottom: 1px solid rgba(63, 63, 70, 0.35);
  margin-bottom: 1px;
}

.agent-workspace__rail-deleted {
  margin-top: auto;
  display: flex;
  flex-direction: column;
  gap: 0;
  padding-top: 4px;
}

.agent-workspace__rail-deleted > .agent-workspace__rail-tab .agent-workspace__rail-tab-name {
  text-align: center;
}

.agent-workspace__rail-deleted-group {
  display: flex;
  flex-direction: column;
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
    align-items: center;
    gap: 4px;
    padding: 0 0 4px;
    border-left: none;
    border-bottom: 1px solid rgba(63, 63, 70, 0.75);
  }

  .agent-workspace__rail-header {
    width: auto;
    justify-content: flex-start;
    padding: 0 6px 0 0;
  }

  .agent-workspace__rail-tab {
    width: auto;
    padding: 2px 8px;
  }

  .agent-workspace__rail-group {
    flex: 0 0 auto;
    flex-direction: row;
    align-items: center;
    gap: 1px;
    padding: 0 6px 0 0;
  }

  .agent-workspace__rail-group-title {
    padding: 0 4px 0 2px;
    border-bottom: none;
    margin-bottom: 0;
    white-space: nowrap;
  }

  .agent-workspace__rail-deleted {
    margin-top: 0;
    margin-left: auto;
    max-height: none;
    overflow: visible;
    flex: 0 0 auto;
    flex-direction: row;
    flex-wrap: wrap;
    gap: 2px;
    padding-top: 0;
  }

  .agent-workspace__rail-deleted-group {
    flex-direction: row;
    align-items: center;
    gap: 2px;
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

<style>
.rail-tooltip {
  min-width: 120px;
  max-width: 260px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 12px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(18, 18, 20, 0.98);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 9999;
  pointer-events: none;
  white-space: nowrap;
}

.rail-tooltip__title {
  font-size: 12px;
  font-weight: 600;
  color: #FAFAFA;
  margin-bottom: 2px;
}

.rail-tooltip__line {
  font-size: 11px;
  line-height: 1.4;
  color: #A1A1AA;
}
</style>
