<script setup>
import { computed, ref } from 'vue'

const props = defineProps({
  masterEntry: {
    type: Object,
    default: null
  },
  activeTeamGroups: {
    type: Array,
    default: () => []
  },
  standaloneEntries: {
    type: Array,
    default: () => []
  },
  deletedTeamGroups: {
    type: Array,
    default: () => []
  },
  deletedStandaloneEntries: {
    type: Array,
    default: () => []
  },
  activeSession: {
    type: Object,
    default: null
  },
  viewMode: {
    type: String,
    default: 'single'
  }
})

const emit = defineEmits(['select-agent', 'toggle-view-mode', 'open-agent-menu'])

function selectAgent(agentId) {
  emit('select-agent', agentId)
}

function toggleViewMode(mode) {
  emit('toggle-view-mode', mode)
}

function openAgentMenu(event, agentItem) {
  if (!agentItem?.agentId || agentItem.isMain) {
    return
  }
  emit('open-agent-menu', event, agentItem)
}

function railItemTypeLabel(agentItem) {
  if (!agentItem) return ''
  if (agentItem.isMain) return '主会话'

  const typeMap = {
    team: '团队',
    'team-lead': '组长',
    subagent: '子代理',
    'general-purpose': '通用代理',
    Explore: '探索',
    Plan: '规划'
  }

  return typeMap[agentItem.agentType] || agentItem.agentType || '代理'
}

const visibleGroups = computed(() => props.activeTeamGroups.filter(group => Array.isArray(group.members) && group.members.length > 0))
const deletedAgentCount = computed(() => {
  const groupedCount = props.deletedTeamGroups.reduce((count, group) => count + (group.members?.length || 0), 0)
  return groupedCount + props.deletedStandaloneEntries.length
})
const runningAgentCount = computed(() => {
  const entries = [
    ...props.activeTeamGroups.flatMap(group => group.members || []),
    ...props.standaloneEntries
  ]
  return entries.filter(isAgentRunning).length
})

function isAgentRunning(agentItem) {
  return agentItem?.status === 'running' || agentItem?.status === 'starting'
}

function agentStatusLabel(agentItem) {
  const status = agentItem?.status || 'ended'
  const labels = {
    starting: '启动中',
    running: '运行中',
    ended: '空闲',
    failed: '失败',
    interrupted: '已中断',
    deleted: '已关闭'
  }
  return labels[status] || status
}

const showDeletedAgents = ref(false)
const expandedDeletedTeamId = ref(null)
const hoveredAgentId = ref(null)
const tooltipPosition = ref({ top: 0, left: 0 })

const hoveredAgent = computed(() => {
  if (!hoveredAgentId.value) return null
  if (props.masterEntry?.agentId === hoveredAgentId.value) return props.masterEntry
  for (const group of props.activeTeamGroups) {
    for (const member of group.members) {
      if (member.agentId === hoveredAgentId.value) return member
    }
  }
  for (const entry of props.standaloneEntries) {
    if (entry.agentId === hoveredAgentId.value) return entry
  }
  for (const group of props.deletedTeamGroups) {
    for (const member of (group.members || [])) {
      if (member.agentId === hoveredAgentId.value) return member
    }
  }
  for (const entry of props.deletedStandaloneEntries) {
    if (entry.agentId === hoveredAgentId.value) return entry
  }
  return null
})

function onTabEnter(event) {
  const rect = event.currentTarget.getBoundingClientRect()
  tooltipPosition.value = {
    top: rect.bottom + 6,
    left: rect.left + rect.width / 2
  }
}

function agentDotColor(agentItem) {
  return agentItem?.color || '#60A5FA'
}

function toggleDeletedTeam(teamId) {
  expandedDeletedTeamId.value = expandedDeletedTeamId.value === teamId ? null : teamId
}

function toggleDeletedAgents() {
  showDeletedAgents.value = !showDeletedAgents.value
  if (!showDeletedAgents.value) {
    expandedDeletedTeamId.value = null
    if (props.masterEntry) {
      selectAgent(props.masterEntry.agentId)
    }
  }
}
</script>

<template>
  <div class="top-rail">
    <span class="top-rail__label">代理</span>
    <span v-if="runningAgentCount > 0" class="top-rail__running-count">
      {{ runningAgentCount }} 运行中
    </span>

    <div class="top-rail__tabs">
      <button
        v-if="masterEntry"
        class="top-rail__tab"
        :class="{ active: activeSession?.agentId === masterEntry.agentId }"
        type="button"
        @click="selectAgent(masterEntry.agentId)"
        @mouseenter="hoveredAgentId = masterEntry.agentId; onTabEnter($event)"
        @mouseleave="hoveredAgentId = null"
      >
        <span
          class="top-rail__dot"
          :class="{ 'top-rail__dot--idle': !isAgentRunning(masterEntry) }"
          :style="{ background: agentDotColor(masterEntry) }"
        ></span>
        <span class="top-rail__name">{{ masterEntry.title }}</span>
        <span v-if="isAgentRunning(masterEntry)" class="top-rail__spinner" aria-label="运行中"></span>
      </button>

      <span v-for="group in visibleGroups" :key="group.teamId" class="top-rail__group">
        <span class="top-rail__group-name">{{ group.title }}</span>
        <button
          v-for="agentItem in group.members"
          :key="agentItem.agentId"
          class="top-rail__tab"
          :class="{ active: activeSession?.agentId === agentItem.agentId }"
          type="button"
          @click="selectAgent(agentItem.agentId)"
          @contextmenu.prevent.stop="openAgentMenu($event, agentItem)"
          @mouseenter="hoveredAgentId = agentItem.agentId; onTabEnter($event)"
          @mouseleave="hoveredAgentId = null"
        >
          <span
            class="top-rail__dot"
            :class="{ 'top-rail__dot--idle': !isAgentRunning(agentItem) }"
            :style="{ background: agentDotColor(agentItem) }"
          ></span>
          <span class="top-rail__name">{{ agentItem.title }}</span>
          <span v-if="isAgentRunning(agentItem)" class="top-rail__spinner" aria-label="运行中"></span>
        </button>
      </span>

      <button
        v-for="agentItem in standaloneEntries"
        :key="agentItem.agentId"
        class="top-rail__tab"
        :class="{ active: activeSession?.agentId === agentItem.agentId }"
        type="button"
        @click="selectAgent(agentItem.agentId)"
        @contextmenu.prevent.stop="openAgentMenu($event, agentItem)"
        @mouseenter="hoveredAgentId = agentItem.agentId; onTabEnter($event)"
        @mouseleave="hoveredAgentId = null"
      >
        <span
          class="top-rail__dot"
          :class="{ 'top-rail__dot--idle': !isAgentRunning(agentItem) }"
          :style="{ background: agentDotColor(agentItem) }"
        ></span>
        <span class="top-rail__name">{{ agentItem.title }}</span>
        <span v-if="isAgentRunning(agentItem)" class="top-rail__spinner" aria-label="运行中"></span>
      </button>

      <template v-if="deletedAgentCount > 0">
        <span class="top-rail__spacer"></span>
        <button
          class="top-rail__tab top-rail__tab--deleted"
          type="button"
          @click="toggleDeletedAgents"
          @mouseenter="hoveredAgentId = null"
        >
          <span class="top-rail__name">{{ showDeletedAgents ? '收起' : `已关闭 ${deletedAgentCount}` }}</span>
        </button>

        <template v-if="showDeletedAgents">
          <span
            v-for="group in deletedTeamGroups"
            :key="'deleted-' + group.teamId"
            class="top-rail__group top-rail__group--deleted"
          >
            <button
              class="top-rail__group-name top-rail__group-name--toggle"
              :class="{ active: expandedDeletedTeamId === group.teamId }"
              type="button"
              @click="toggleDeletedTeam(group.teamId)"
              @mouseenter="hoveredAgentId = null"
            >
              <span class="top-rail__dot top-rail__dot--deleted"></span>
              {{ group.title }}
            </button>
            <template v-if="expandedDeletedTeamId === group.teamId">
              <button
                v-for="agentItem in group.members"
                :key="agentItem.agentId"
                class="top-rail__tab top-rail__tab--deleted"
                :class="{ active: activeSession?.agentId === agentItem.agentId }"
                type="button"
                @click="selectAgent(agentItem.agentId)"
                @mouseenter="hoveredAgentId = agentItem.agentId; onTabEnter($event)"
                @mouseleave="hoveredAgentId = null"
              >
                <span class="top-rail__dot top-rail__dot--deleted"></span>
                <span class="top-rail__name">{{ agentItem.title }}</span>
              </button>
            </template>
          </span>

          <button
            v-for="agentItem in deletedStandaloneEntries"
            :key="agentItem.agentId"
            class="top-rail__tab top-rail__tab--deleted"
            :class="{ active: activeSession?.agentId === agentItem.agentId }"
            type="button"
            @click="selectAgent(agentItem.agentId)"
            @mouseenter="hoveredAgentId = agentItem.agentId; onTabEnter($event)"
            @mouseleave="hoveredAgentId = null"
          >
            <span class="top-rail__dot top-rail__dot--deleted"></span>
            <span class="top-rail__name">{{ agentItem.title }}</span>
          </button>
        </template>
      </template>
    </div>

    <Teleport to="body">
      <div
        v-if="hoveredAgent"
        class="top-rail-tooltip"
        :style="{
          position: 'fixed',
          top: tooltipPosition.top + 'px',
          left: tooltipPosition.left + 'px',
          transform: 'translateX(-50%)'
        }"
      >
        <span class="top-rail-tooltip__title">{{ hoveredAgent.title }}</span>
        <span class="top-rail-tooltip__line">类型: {{ railItemTypeLabel(hoveredAgent) }}</span>
        <span v-if="hoveredAgent.status" class="top-rail-tooltip__line">状态: {{ agentStatusLabel(hoveredAgent) }}</span>
        <span v-if="hoveredAgent.model" class="top-rail-tooltip__line">模型: {{ hoveredAgent.model }}</span>
      </div>
    </Teleport>
  </div>
</template>

<style scoped>
.top-rail {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  height: 28px;
  min-height: 28px;
  padding: 0 8px;
  border-bottom: 1px solid rgba(63, 63, 70, 0.75);
  background: rgba(24, 24, 27, 0.6);
}

.top-rail__label {
  flex: 0 0 auto;
  color: #71717a;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.04em;
  user-select: none;
}

.top-rail__running-count {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  height: 18px;
  padding: 0 7px;
  border: 1px solid rgba(34, 197, 94, 0.3);
  border-radius: 999px;
  background: rgba(34, 197, 94, 0.1);
  color: #86EFAC;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
}

.top-rail__tabs {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 2px;
  overflow-x: auto;
  scrollbar-width: none;
}

.top-rail__tabs::-webkit-scrollbar {
  display: none;
}

.top-rail__tab {
  position: relative;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #a1a1aa;
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.12s ease, color 0.12s ease;
}

.top-rail__tab:hover {
  background: rgba(255, 255, 255, 0.06);
  color: #d4d4d8;
}

.top-rail__tab.active {
  background: rgba(255, 255, 255, 0.1);
  color: #f4f4f5;
}

.top-rail__tab--deleted {
  opacity: 0.55;
}

.top-rail__tab--deleted:hover {
  opacity: 0.85;
}

.top-rail__dot {
  flex-shrink: 0;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #60A5FA;
}

.top-rail__dot--deleted {
  background: #71717a;
}

.top-rail__dot--idle {
  opacity: 0.45;
}

.top-rail__spinner {
  flex-shrink: 0;
  width: 8px;
  height: 8px;
  border: 1.5px solid rgba(134, 239, 172, 0.28);
  border-top-color: #86EFAC;
  border-radius: 50%;
  animation: top-rail-spin 0.8s linear infinite;
}

.top-rail__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.top-rail__group {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 1px;
  border: 1px solid rgba(182, 182, 196, 0.55);
  border-radius: 6px;
  background: rgba(39, 39, 42, 0.28);
}

.top-rail__group-name {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  height: 22px;
  padding: 0 6px;
  color: #71717a;
  font-size: 10px;
  font-weight: 600;
  white-space: nowrap;
  user-select: none;
}

.top-rail__group--deleted {
  opacity: 0.55;
  border-color: rgba(113, 113, 122, 0.35);
}

.top-rail__group--deleted:hover {
  opacity: 0.85;
}

.top-rail__group-name--toggle {
  border: none;
  background: transparent;
  cursor: pointer;
  gap: 4px;
  padding: 0 6px;
  transition: opacity 0.12s ease;
}

.top-rail__group-name--toggle.active {
  color: #a1a1aa;
}

.top-rail__separator {
  flex: 0 0 auto;
  width: 1px;
  height: 14px;
  background: rgba(63, 63, 70, 0.7);
  margin: 0 4px;
}

.top-rail__spacer {
  flex: 1 1 auto;
  min-width: 8px;
}

@keyframes top-rail-spin {
  to {
    transform: rotate(360deg);
  }
}
</style>

<style>
.top-rail-tooltip {
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

.top-rail-tooltip__title {
  font-size: 12px;
  font-weight: 600;
  color: #FAFAFA;
  margin-bottom: 2px;
}

.top-rail-tooltip__line {
  font-size: 11px;
  line-height: 1.4;
  color: #A1A1AA;
}
</style>
