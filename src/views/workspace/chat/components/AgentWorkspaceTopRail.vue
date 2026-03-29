<script setup>
import { computed } from 'vue'

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

function railItemStyle(agentItem) {
  if (!agentItem?.color) {
    return null
  }

  return {
    '--agent-color': agentItem.color,
    borderColor: agentItem.color
  }
}

const visibleGroups = computed(() => props.activeTeamGroups.filter(group => Array.isArray(group.members) && group.members.length > 0))
</script>

<template>
  <div class="agent-workspace-top-rail">
    <div class="agent-workspace-top-rail__label" aria-hidden="true">
      <span>团</span>
      <span>队</span>
    </div>

    <div class="agent-workspace-top-rail__center">
      <div class="agent-workspace-top-rail__segment">
        <button
          class="provider-tab"
          :class="{ active: viewMode === 'single' }"
          type="button"
          title="单视图"
          aria-label="单视图"
          @click="toggleViewMode('single')"
        >
          <svg class="agent-workspace-top-rail__mode-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2.5" y="3" width="11" height="10" rx="2" stroke="currentColor" stroke-width="1.4" />
            <path d="M5 6H11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
            <path d="M5 8.5H11" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" />
          </svg>
        </button>
        <button
          class="provider-tab"
          :class="{ active: viewMode === 'split' }"
          type="button"
          title="分屏"
          aria-label="分屏"
          @click="toggleViewMode('split')"
        >
          <svg class="agent-workspace-top-rail__mode-icon" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="2.5" y="3" width="11" height="10" rx="2" stroke="currentColor" stroke-width="1.4" />
            <path d="M8 3.8V12.2" stroke="currentColor" stroke-width="1.2" />
          </svg>
        </button>
      </div>

      <button
        v-if="masterEntry"
        class="agent-workspace-top-rail__chip"
        :style="railItemStyle(masterEntry)"
        :class="{ active: activeSession?.agentId === masterEntry.agentId }"
        type="button"
        @click="selectAgent(masterEntry.agentId)"
      >
        <span class="agent-workspace-top-rail__chip-title">{{ masterEntry.title }}</span>
        <span class="agent-workspace-top-rail__chip-subtitle">主会话</span>
      </button>

      <section
        v-for="group in visibleGroups"
        :key="group.teamId"
        class="agent-workspace-top-rail__group"
      >
        <div class="agent-workspace-top-rail__group-label" :title="group.title">
          <span class="agent-workspace-top-rail__group-text">{{ group.title }}</span>
        </div>

        <div class="agent-workspace-top-rail__group-members">
          <button
            v-for="agentItem in group.members"
            :key="agentItem.agentId"
            class="agent-workspace-top-rail__member"
            :style="railItemStyle(agentItem)"
            :class="{ active: activeSession?.agentId === agentItem.agentId }"
            type="button"
            @click="selectAgent(agentItem.agentId)"
          >
            <span class="agent-workspace-top-rail__member-name">{{ agentItem.title }}</span>
            <span class="agent-workspace-top-rail__member-type">{{ railItemTypeLabel(agentItem) }}</span>
          </button>
        </div>
      </section>
    </div>

    <button
      class="agent-workspace-top-rail__closed"
      :class="{ 'is-disabled': deletedTeamGroups.length === 0 }"
      type="button"
      :title="deletedTeamGroups.length > 0 ? `已关闭 ${deletedTeamGroups.length}` : '已关闭 0'"
    >
      <span>已</span>
      <span>关</span>
      <span>闭</span>
    </button>
  </div>
</template>

<style scoped>
.agent-workspace-top-rail {
  display: grid;
  grid-template-columns: 18px minmax(0, 1fr) 18px;
  align-items: stretch;
  gap: 8px;
  width: 100%;
  border-bottom: 1px solid rgba(63, 63, 70, 0.75);
}

.agent-workspace-top-rail__label,
.agent-workspace-top-rail__closed {
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  padding: 4px 0;
  color: #a1a1aa;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  background: transparent;
  border: none;
}

.agent-workspace-top-rail__closed {
  width: 18px;
  min-width: 18px;
  height: 60px;
  min-height: 60px;
  padding: 0;
  color: #e4e4e7;
  border-left: 1px solid rgba(63, 63, 70, 0.7);
  cursor: pointer;
}

.agent-workspace-top-rail__closed.is-disabled {
  color: #71717a;
  border-left-color: rgba(63, 63, 70, 0.35);
  cursor: default;
}

.agent-workspace-top-rail__center {
  min-width: 0;
  display: flex;
  align-items: stretch;
  gap: 6px;
  overflow-x: auto;
  scrollbar-width: none;
}

.agent-workspace-top-rail__segment {
  flex: 0 0 auto;
  display: inline-flex;
  flex-direction: column;
  align-items: stretch;
  gap: 2px;
  padding: 2px;
  background: #1F1F23;
  border: 1px solid #34343A;
  border-radius: 10px;
  overflow: hidden;
}

.agent-workspace-top-rail__segment .provider-tab {
  border: none;
  background: transparent;
  color: #A1A1AA;
  font-size: 12px;
  font-weight: 600;
  line-height: 1;
  width: 28px;
  height: 22px;
  padding: 0;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.2s ease, color 0.2s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.agent-workspace-top-rail__segment .provider-tab:hover {
  color: #F4F4F5;
  background: rgba(255, 255, 255, 0.05);
}

.agent-workspace-top-rail__segment .provider-tab.active {
  color: #18181B;
  background: #F59E0B;
}

.agent-workspace-top-rail__mode-icon {
  width: 12px;
  height: 12px;
  flex-shrink: 0;
}

.agent-workspace-top-rail__center::-webkit-scrollbar {
  display: none;
}

.agent-workspace-top-rail__chip {
  flex: 0 0 auto;
  width: 60px;
  min-width: 60px;
  height: 60px;
  min-height: 60px;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 3px;
  padding: 8px 10px;
  border: 1px solid rgba(63, 63, 70, 0.9);
  border-radius: 14px;
  background: rgba(39, 39, 42, 0.88);
  color: #f4f4f5;
  text-align: left;
}

.agent-workspace-top-rail__chip.active {
  border-color: var(--agent-color, rgba(96, 165, 250, 0.62));
  background: var(--agent-color, #3b82f6);
}

.agent-workspace-top-rail__chip-title {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
}

.agent-workspace-top-rail__chip-subtitle {
  color: #d4d4d8;
  font-size: 9px;
  line-height: 1.1;
}

.agent-workspace-top-rail__group {
  flex: 0 0 auto;
  display: flex;
  align-items: stretch;
  gap: 6px;
  padding: 0 0 0 6px;
  border: 1px solid rgba(63, 63, 70, 0.7);
  border-radius: 12px;
  background: rgba(17, 24, 39, 0.18);
}

.agent-workspace-top-rail__group-label {
  flex: 0 0 auto;
  width: 42px;
  min-width: 42px;
  height: 60px;
  min-height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #a1a1aa;
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
}

.agent-workspace-top-rail__group-text {
  display: block;
  max-width: 42px;
  overflow: hidden;
  white-space: normal;
  word-break: break-word;
  overflow-wrap: anywhere;
  line-height: 1.2;
  text-align: center;
}

.agent-workspace-top-rail__group-members {
  flex: 0 0 auto;
  display: flex;
  align-items: stretch;
  gap: 6px;
}

.agent-workspace-top-rail__member {
  flex: 0 0 auto;
  width: 60px;
  min-width: 60px;
  height: 60px;
  min-height: 60px;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 3px;
  padding: 8px 6px;
  border: 1px solid rgba(63, 63, 70, 0.9);
  border-radius: 12px;
  background: rgba(39, 39, 42, 0.88);
  color: inherit;
  cursor: pointer;
  text-align: left;
  transition: border-color 0.15s ease, background 0.15s ease;
}

.agent-workspace-top-rail__member:hover {
  border-color: rgba(96, 165, 250, 0.45);
}

.agent-workspace-top-rail__member.active {
  border-color: var(--agent-color, rgba(96, 165, 250, 0.62));
  background: var(--agent-color, #3b82f6);
}

.agent-workspace-top-rail__member-name {
  color: #f4f4f5;
  font-size: 11px;
  font-weight: 600;
  width: 100%;
  overflow: hidden;
  line-height: 1.2;
  white-space: normal;
  word-break: break-word;
}

.agent-workspace-top-rail__member-type {
  color: #a1a1aa;
  font-size: 9px;
  line-height: 1.15;
  width: 100%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
</style>
