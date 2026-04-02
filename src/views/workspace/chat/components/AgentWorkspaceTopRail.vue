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
  deletedTeamGroups: {
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

const emit = defineEmits(['select-agent', 'toggle-view-mode'])

function selectAgent(agentId) {
  emit('select-agent', agentId)
}

function toggleViewMode(mode) {
  emit('toggle-view-mode', mode)
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

const visibleGroups = computed(() => props.activeTeamGroups.filter(group => Array.isArray(group.members) && group.members.length > 0))

const hoveredAgentId = ref(null)

function agentDotColor(agentItem) {
  return agentItem?.color || '#60A5FA'
}

function agentTooltipInfo(agentItem) {
  if (!agentItem) return null
  const parts = []
  parts.push(railItemTypeLabel(agentItem))
  if (agentItem.agentType) parts.push(`类型: ${agentItem.agentType}`)
  if (agentItem.status) parts.push(`状态: ${agentItem.status}`)
  if (agentItem.model) parts.push(`模型: ${agentItem.model}`)
  return parts.join('\n')
}
</script>

<template>
  <div class="top-rail">
    <span class="top-rail__label">团队</span>

    <div class="top-rail__tabs">
      <button
        v-if="masterEntry"
        class="top-rail__tab"
        :class="{ active: activeSession?.agentId === masterEntry.agentId }"
        type="button"
        @click="selectAgent(masterEntry.agentId)"
        @mouseenter="hoveredAgentId = masterEntry.agentId"
        @mouseleave="hoveredAgentId = null"
      >
        <span class="top-rail__dot" :style="{ background: agentDotColor(masterEntry) }"></span>
        <span class="top-rail__name">{{ masterEntry.title }}</span>
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
          @mouseenter="hoveredAgentId = agentItem.agentId"
          @mouseleave="hoveredAgentId = null"
        >
          <span class="top-rail__dot" :style="{ background: agentDotColor(agentItem) }"></span>
          <span class="top-rail__name">{{ agentItem.title }}</span>
          <div v-if="hoveredAgentId === agentItem.agentId" class="top-rail__tooltip">
            <span class="top-rail__tooltip-title">{{ agentItem.title }}</span>
            <span class="top-rail__tooltip-line">类型: {{ railItemTypeLabel(agentItem) }}</span>
            <span v-if="agentItem.agentType" class="top-rail__tooltip-line">AgentType: {{ agentItem.agentType }}</span>
            <span v-if="agentItem.status" class="top-rail__tooltip-line">状态: {{ agentItem.status }}</span>
            <span v-if="agentItem.model" class="top-rail__tooltip-line">模型: {{ agentItem.model }}</span>
          </div>
        </button>
      </span>

      <template v-if="deletedTeamGroups.length > 0">
        <span class="top-rail__separator"></span>
        <button
          v-for="group in deletedTeamGroups"
          :key="'deleted-' + group.teamId"
          class="top-rail__tab top-rail__tab--deleted"
          type="button"
          @click="selectAgent(group.members?.[0]?.agentId)"
          @mouseenter="hoveredAgentId = 'deleted-' + group.teamId"
          @mouseleave="hoveredAgentId = null"
        >
          <span class="top-rail__dot top-rail__dot--deleted"></span>
          <span class="top-rail__name">{{ group.title }}</span>
        </button>
      </template>
    </div>
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

.top-rail__separator {
  flex: 0 0 auto;
  width: 1px;
  height: 14px;
  background: rgba(63, 63, 70, 0.7);
  margin: 0 4px;
}

.top-rail__tooltip {
  position: absolute;
  top: calc(100% + 6px);
  left: 50%;
  transform: translateX(-50%);
  min-width: 120px;
  max-width: 220px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  background: rgba(18, 18, 20, 0.98);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 40;
  pointer-events: none;
  white-space: nowrap;
}

.top-rail__tooltip-title {
  font-size: 12px;
  font-weight: 600;
  color: #FAFAFA;
  margin-bottom: 2px;
}

.top-rail__tooltip-line {
  font-size: 11px;
  line-height: 1.4;
  color: #A1A1AA;
}
</style>
