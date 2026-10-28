<script setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'
import appIcon from '../../../resource/AppIcon.png'

const projects = ref([])
const monitorMode = ref('auto')
const stageManagerEnabled = ref(false)
const stageManagerBusy = ref(false)
const projectActionBusyId = ref(null)
const queuedProjectActionCounts = new Map()
let unsubscribeActivity = null

const runningProjectCount = computed(() => projects.value.filter(project => project.runningSessionCount > 0).length)
const completedProjectCount = computed(() => projects.value.filter(project => project.completedCount > 0).length)
const attentionProjectCount = computed(() => projects.value.filter(project => project.attentionCount > 0).length)
const monitorSummary = computed(() => {
  const parts = []
  if (attentionProjectCount.value > 0) {
    parts.push(`${attentionProjectCount.value} 待处理`)
  }
  if (runningProjectCount.value > 0) {
    parts.push(`${runningProjectCount.value} 运行`)
  }
  if (completedProjectCount.value > 0) {
    parts.push(`${completedProjectCount.value} 完成`)
  }
  return parts.length > 0 ? parts.join(' · ') : `${projects.value.length} 工程`
})

function applySnapshot(snapshot) {
  monitorMode.value = snapshot?.mode || 'auto'
  stageManagerEnabled.value = Boolean(snapshot?.stageManagerEnabled)
  projects.value = Array.isArray(snapshot?.projects) ? snapshot.projects : []
}

async function toggleStageManager() {
  if (stageManagerBusy.value) return

  const nextEnabled = !stageManagerEnabled.value
  stageManagerBusy.value = true
  try {
    const result = await window.electronAPI.updateAppConfig({
      updates: {
        settings: {
          projectStageManagerEnabled: nextEnabled
        }
      }
    })
    if (!result?.success) {
      throw new Error(result?.error || '更新调度台状态失败')
    }
    stageManagerEnabled.value = nextEnabled
  } catch (error) {
    console.error('[ProjectMonitor] Failed to toggle stage manager:', error)
  } finally {
    stageManagerBusy.value = false
  }
}

function getSessionStatusText(project) {
  if (project.attentionCount > 0) {
    return `${project.attentionCount} 待处理`
  }
  if (project.completedCount > 0) {
    return `${project.completedCount} 完成`
  }
  if (project.runningSessionCount > 0) {
    return ''
  }
  if (project.errorCount > 0) {
    return '异常'
  }
  return project.runningTaskCount > 0 ? '' : '空闲'
}

function getSessionStatusClass(project) {
  if (project.attentionCount > 0) {
    return 'attention'
  }
  if (project.completedCount > 0) {
    return 'completed'
  }
  if (project.runningSessionCount > 0) {
    return 'running'
  }
  if (project.errorCount > 0) {
    return 'error'
  }
  return 'idle'
}

function getProjectActionTitle(project) {
  const projectLabel = project.projectPath || project.projectName
  if (project.attentionCount > 0 || project.completedCount > 0 || project.errorCount > 0) {
    return `${projectLabel} · 打开待处理 Session`
  }
  if (project.windowVisible) {
    return `${projectLabel} · 窗口显示中，点击收起`
  }
  return `${projectLabel} · 窗口已隐藏，点击显示`
}

async function toggleProjectWindow(project) {
  if (!project?.projectId) {
    return
  }

  if (projectActionBusyId.value) {
    if (projectActionBusyId.value === project.projectId) {
      queuedProjectActionCounts.set(
        project.projectId,
        (queuedProjectActionCounts.get(project.projectId) || 0) + 1
      )
    }
    return
  }

  const projectId = project.projectId
  projectActionBusyId.value = project.projectId
  try {
    const result = await window.electronAPI.toggleProjectWindow({
      projectId
    })
    if (!result?.success) {
      throw new Error(result?.error || '切换工程窗口失败')
    }
  } catch (error) {
    console.error('[ProjectMonitor] Failed to toggle project window:', error)
  } finally {
    projectActionBusyId.value = null
    const queuedCount = queuedProjectActionCounts.get(projectId) || 0
    if (queuedCount > 0) {
      if (queuedCount === 1) {
        queuedProjectActionCounts.delete(projectId)
      } else {
        queuedProjectActionCounts.set(projectId, queuedCount - 1)
      }
      const latestProject = projects.value.find(item => item.projectId === projectId)
      if (latestProject) {
        void toggleProjectWindow(latestProject)
      }
    }
  }
}

onMounted(async () => {
  try {
    applySnapshot(await window.electronAPI.getProjectActivity())
  } catch (error) {
    console.error('[ProjectMonitor] Failed to load project activity:', error)
  }
  unsubscribeActivity = window.electronAPI.onProjectActivityUpdated(applySnapshot)
})

onUnmounted(() => {
  unsubscribeActivity?.()
})
</script>

<template>
  <section class="monitor-panel" :class="{ 'is-always-mode': monitorMode === 'always' }">
    <header class="monitor-header">
      <img class="monitor-brand-icon" :src="appIcon" alt="" draggable="false" />
      <span class="monitor-title">浮窗</span>
      <button
        type="button"
        class="stage-manager-toggle"
        :class="{ active: stageManagerEnabled }"
        :disabled="stageManagerBusy"
        :aria-pressed="stageManagerEnabled"
        :title="stageManagerEnabled ? '关闭调度台（不再限制单窗口显示）' : '开启调度台（同一时间只显示一个项目窗口）'"
        @click="toggleStageManager"
      >
        <span class="stage-manager-label">调度台</span>
        <span class="stage-manager-switch" aria-hidden="true" />
      </button>
      <span class="monitor-summary" :class="{ 'has-attention': attentionProjectCount > 0 }">
        {{ monitorSummary }}
      </span>
    </header>

    <div v-if="projects.length > 0" class="monitor-list">
      <button
        v-for="project in projects"
        :key="project.projectId"
        type="button"
        class="project-item"
        :class="{
          'is-alerting': project.completedCount > 0 && project.attentionCount === 0,
          'is-attention-alerting': project.attentionCount > 0,
          'is-window-visible': project.windowVisible,
          'is-action-pending': projectActionBusyId === project.projectId,
          [`session-${getSessionStatusClass(project)}`]: true
        }"
        :aria-busy="projectActionBusyId === project.projectId"
        :title="getProjectActionTitle(project)"
        @click="toggleProjectWindow(project)"
      >
        <span class="project-status-dot" />
        <span class="project-title-group">
          <span class="project-name">{{ project.projectName }}</span>
          <span
            v-if="project.windowVisible"
            class="project-window-indicator"
            role="img"
            aria-label="窗口显示中"
            title="窗口显示中"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
              <path d="M3.5 8.5h17" />
              <path d="M7 6.5h.01M10 6.5h.01" stroke-linecap="round" />
            </svg>
          </span>
        </span>
        <span class="project-status-group">
          <span
            v-if="project.runningTaskCount > 0"
            class="project-task-indicator"
            role="img"
            :aria-label="`${project.runningTaskCount} 个 Task 运行中`"
            :title="`${project.runningTaskCount} 个 Task 运行中`"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <path d="M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2z" />
              <path d="M7 9l3 3-3 3" />
              <path d="M12 15h5" />
            </svg>
          </span>
          <span v-if="getSessionStatusText(project)" class="project-status-text">
            {{ getSessionStatusText(project) }}
          </span>
        </span>
      </button>
    </div>

    <div v-else class="monitor-empty">
      暂无活动工程
    </div>
  </section>
</template>

<style scoped>
:global(body.ccgui-project-monitor-window),
:global(body.ccgui-project-monitor-window #app) {
  background: transparent !important;
}

:global(body.ccgui-project-monitor-window) {
  overflow: hidden;
}

.monitor-panel {
  width: calc(100% - 12px);
  max-height: calc(100vh - 12px);
  margin: 6px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: 11px;
  background: rgba(29, 29, 33, 0.96);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
  backdrop-filter: blur(24px);
}

.monitor-header {
  height: 36px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  -webkit-app-region: drag;
}

.monitor-brand-icon {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  display: block;
  object-fit: contain;
  border-radius: 4px;
  box-shadow:
    0 0 0 0.5px rgba(255, 255, 255, 0.12),
    0 1px 2px rgba(0, 0, 0, 0.3);
  user-select: none;
}

.monitor-title {
  margin-left: 6px;
  color: #e4e4e9;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.02em;
}

.stage-manager-toggle {
  height: 20px;
  margin-left: 8px;
  padding: 0 5px 0 6px;
  display: flex;
  align-items: center;
  gap: 5px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.035);
  color: #777780;
  font: inherit;
  font-size: 8.5px;
  cursor: pointer;
  -webkit-app-region: no-drag;
}

.stage-manager-toggle:hover {
  color: #b8b8bf;
  background: rgba(255, 255, 255, 0.06);
}

.stage-manager-toggle.active {
  border-color: rgba(249, 115, 22, 0.28);
  background: rgba(249, 115, 22, 0.1);
  color: var(--accent-hover);
}

.stage-manager-toggle:disabled {
  opacity: 0.6;
  cursor: default;
}

.stage-manager-switch {
  position: relative;
  width: 18px;
  height: 10px;
  flex: 0 0 auto;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
  transition: background 0.16s ease;
}

.stage-manager-switch::after {
  content: '';
  position: absolute;
  top: 2px;
  left: 2px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #d4d4da;
  transition: transform 0.16s ease, background 0.16s ease;
}

.stage-manager-toggle.active .stage-manager-switch {
  background: rgba(249, 115, 22, 0.72);
}

.stage-manager-toggle.active .stage-manager-switch::after {
  background: #fff;
  transform: translateX(8px);
}

.monitor-summary {
  margin-left: auto;
  color: #777780;
  font-size: 9px;
}

.monitor-summary.has-attention {
  color: #67d88d;
  animation: monitor-attention-text 1.35s ease-in-out infinite;
}

.monitor-list {
  max-height: calc(100vh - 48px);
  overflow-y: auto;
  overflow-x: hidden;
  -webkit-app-region: no-drag;
}

.project-item {
  width: 100%;
  height: 38px;
  padding: 0 10px;
  display: flex;
  align-items: center;
  gap: 9px;
  border: 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.055);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: default;
  -webkit-app-region: no-drag;
}

.project-item:last-child {
  border-bottom: 0;
}

.project-item.is-window-visible {
  background: rgba(255, 255, 255, 0.018);
}

.project-item:hover {
  background: rgba(255, 255, 255, 0.045);
}

.project-item:active {
  background: rgba(255, 255, 255, 0.07);
}

.project-item.is-action-pending {
  opacity: 0.65;
  cursor: progress;
}

.project-status-dot {
  width: 5px;
  height: 5px;
  flex: 0 0 auto;
  border-radius: 50%;
  background: #4b4b53;
}

.project-item.session-running .project-status-dot {
  background: #22c55e;
  box-shadow: 0 0 7px rgba(34, 197, 94, 0.7);
  animation: monitor-breathe 1.8s ease-in-out infinite;
}

.project-item.session-attention .project-status-dot {
  background: #22c55e;
  box-shadow: 0 0 7px rgba(34, 197, 94, 0.7);
}

.project-item.session-completed .project-status-dot {
  background: #f59e0b;
  box-shadow: 0 0 7px rgba(245, 158, 11, 0.65);
}

.project-item.session-error .project-status-dot {
  background: #ef4444;
  box-shadow: 0 0 7px rgba(239, 68, 68, 0.6);
}

.project-title-group {
  min-width: 0;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 6px;
  overflow: hidden;
}

.project-name {
  min-width: 0;
  flex: 0 1 auto;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #e5e5e9;
  font-size: 10.5px;
  font-weight: 550;
}

.project-status-group {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  gap: 9px;
}

.project-task-indicator,
.project-window-indicator {
  width: 12px;
  height: 12px;
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.project-task-indicator {
  color: #67d88d;
}

.project-task-indicator svg {
  display: block;
}

.project-window-indicator {
  color: #a7a7b0;
}

.project-window-indicator svg {
  display: block;
}

.project-status-text {
  flex: 0 0 auto;
  color: #777780;
  font-size: 8.5px;
}

.project-item.session-attention .project-status-text {
  color: #67d88d;
  animation: monitor-attention-text 1.35s ease-in-out infinite;
}

.project-item.session-completed .project-status-text {
  color: var(--accent-hover);
}

.project-item.session-error .project-status-text {
  color: #f87171;
}

.project-item.is-alerting {
  animation: monitor-alert-row 1.45s ease-in-out infinite;
}

.project-item.is-attention-alerting {
  animation: monitor-attention-row 1.25s ease-in-out infinite;
}

.monitor-empty {
  height: 38px;
  padding: 0 12px;
  display: flex;
  align-items: center;
  color: #696972;
  font-size: 9px;
}

.monitor-list::-webkit-scrollbar {
  width: 5px;
}

.monitor-list::-webkit-scrollbar-track {
  background: transparent;
}

.monitor-list::-webkit-scrollbar-thumb {
  border: 0;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.16);
}

@keyframes monitor-breathe {
  0%, 100% {
    opacity: 0.68;
    transform: scale(0.9);
  }
  50% {
    opacity: 1;
    transform: scale(1.1);
  }
}

@keyframes monitor-alert-row {
  0%, 100% {
    background: rgba(249, 115, 22, 0.035);
    box-shadow: inset 0 0 0 1px rgba(249, 115, 22, 0.04);
  }
  50% {
    background: rgba(249, 115, 22, 0.16);
    box-shadow:
      inset 0 0 0 1px rgba(249, 115, 22, 0.34),
      0 0 12px rgba(249, 115, 22, 0.1);
  }
}

@keyframes monitor-attention-row {
  0%, 100% {
    background: rgba(34, 197, 94, 0.025);
    box-shadow: inset 2px 0 0 rgba(34, 197, 94, 0.22);
  }
  50% {
    background: rgba(34, 197, 94, 0.14);
    box-shadow:
      inset 2px 0 0 rgba(34, 197, 94, 0.82),
      0 0 12px rgba(34, 197, 94, 0.08);
  }
}

@keyframes monitor-attention-text {
  0%, 100% {
    opacity: 0.62;
  }
  50% {
    opacity: 1;
  }
}

@media (prefers-reduced-motion: reduce) {
  .project-item.session-running .project-status-dot,
  .project-item.session-attention .project-status-text,
  .monitor-summary.has-attention,
  .project-item.is-alerting,
  .project-item.is-attention-alerting {
    animation: none;
  }

  .project-item.is-alerting {
    background: rgba(249, 115, 22, 0.13);
    box-shadow: inset 0 0 0 1px rgba(249, 115, 22, 0.3);
  }

  .project-item.is-attention-alerting {
    background: rgba(34, 197, 94, 0.13);
    box-shadow: inset 2px 0 0 rgba(34, 197, 94, 0.72);
  }
}
</style>
