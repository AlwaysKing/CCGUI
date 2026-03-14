<script setup>
/**
 * TaskFloatingWindow - 任务浮动窗口组件
 * 显示正在运行的子任务进度
 * 可拖拽、可折叠、多个任务叠加显示
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useSessionStore } from '../../../../stores/useSessionStore'

const sessionStore = useSessionStore()

// 当前活跃的任务列表
const activeTasks = computed(() => {
  const session = sessionStore.currentSession
  if (!session || !session.activeTasks) return []
  return Array.from(session.activeTasks.values())
})

// 拖拽状态
const isDragging = ref(false)
const dragOffset = ref({ x: 0, y: 0 })
const windowPosition = ref({ x: 0, y: 0 })

// 每个任务的折叠状态
const collapsedTasks = ref(new Set())

// 是否有活跃任务
const hasActiveTasks = computed(() => activeTasks.value.length > 0)

// 任务类型图标
function getTaskIcon(taskType) {
  if (taskType === 'local_agent') return '🤖'
  if (taskType === 'explore') return '🔍'
  if (taskType === 'plan') return '📋'
  if (taskType === 'todo') return '📝'
  return '⚙️'
}

// Todo 状态图标和样式
function getTodoStatusInfo(status) {
  if (status === 'completed') return { icon: '✅', class: 'completed' }
  if (status === 'in_progress') return { icon: '🔄', class: 'in-progress' }
  return { icon: '⏳', class: 'pending' }
}

// 计算 Todo 进度
function getTodoProgress(task) {
  if (!task.todos) return null
  const completed = task.todos.filter(t => t.status === 'completed').length
  const total = task.todos.length
  return { completed, total, percent: total > 0 ? Math.round((completed / total) * 100) : 0 }
}

// 格式化运行时间
function formatRunningTime(startTime) {
  const elapsed = Date.now() - startTime
  if (elapsed < 1000) return `${elapsed}ms`
  if (elapsed < 60000) return `${(elapsed / 1000).toFixed(1)}s`
  return `${(elapsed / 60000).toFixed(1)}min`
}

// 切换任务折叠状态
function toggleTaskCollapse(taskId) {
  if (collapsedTasks.value.has(taskId)) {
    collapsedTasks.value.delete(taskId)
  } else {
    collapsedTasks.value.add(taskId)
  }
}

// 开始拖拽
function startDrag(event) {
  if (event.target.closest('.task-header') || event.target.closest('.collapse-btn')) {
    return
  }
  isDragging.value = true
  const rect = event.currentTarget.getBoundingClientRect()
  dragOffset.value = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  }
}

// 拖拽中
function onDrag(event) {
  if (!isDragging.value) return
  windowPosition.value = {
    x: event.clientX - dragOffset.value.x,
    y: event.clientY - dragOffset.value.y
  }
}

// 结束拖拽
function endDrag() {
  isDragging.value = false
}

// 实时更新运行时间
const updateTimeRef = ref(null)
onMounted(() => {
  updateTimeRef.value = setInterval(() => {
    // 触发响应式更新
  }, 1000)

  document.addEventListener('mousemove', onDrag)
  document.addEventListener('mouseup', endDrag)
})

onUnmounted(() => {
  if (updateTimeRef.value) {
    clearInterval(updateTimeRef.value)
  }
  document.removeEventListener('mousemove', onDrag)
  document.removeEventListener('mouseup', endDrag)
})
</script>

<template>
  <div
    v-if="hasActiveTasks"
    class="task-floating-container"
    :style="{
      left: windowPosition.x ? `${windowPosition.x}px` : undefined,
      top: windowPosition.y ? `${windowPosition.y}px` : undefined
    }"
    @mousedown="startDrag"
  >
    <div class="task-floating-header">
      <span class="header-icon">⚡</span>
      <span class="header-title">活跃任务 ({{ activeTasks.length }})</span>
    </div>

    <div class="task-list">
      <div
        v-for="task in activeTasks"
        :key="task.id"
        class="task-item"
        :class="{ collapsed: collapsedTasks.has(task.id) }"
      >
        <div class="task-header" @click="toggleTaskCollapse(task.id)">
          <span class="task-icon">{{ getTaskIcon(task.taskType) }}</span>
          <div class="task-info">
            <div class="task-title">{{ task.description || '子任务运行中...' }}</div>
            <div class="task-meta">
              <!-- Todo 类型：显示进度 -->
              <template v-if="task.taskType === 'todo' && getTodoProgress(task)">
                <span class="todo-progress">{{ getTodoProgress(task).completed }}/{{ getTodoProgress(task).total }}</span>
                <span class="status-badge" :class="getTodoStatusInfo(task.status).class">
                  {{ getTodoStatusInfo(task.status).icon }}
                </span>
              </template>
              <!-- 其他类型：显示运行时间 -->
              <template v-else>
                <span class="running-time">{{ formatRunningTime(task.startTime) }}</span>
                <span class="status-badge running">运行中</span>
              </template>
            </div>
          </div>
          <span class="collapse-btn">{{ collapsedTasks.has(task.id) ? '▶' : '▼' }}</span>
        </div>

        <div v-if="!collapsedTasks.has(task.id)" class="task-details">
          <!-- Todo 类型：显示任务列表 -->
          <template v-if="task.taskType === 'todo' && task.todos">
            <div class="todo-list">
              <div
                v-for="(todo, idx) in task.todos"
                :key="idx"
                class="todo-item"
                :class="getTodoStatusInfo(todo.status).class"
              >
                <span class="todo-status-icon">{{ getTodoStatusInfo(todo.status).icon }}</span>
                <span class="todo-content">{{ todo.content }}</span>
              </div>
            </div>
          </template>

          <!-- 其他类型：显示 Prompt 信息 -->
          <template v-else>
            <div v-if="task.prompt" class="detail-section">
              <div class="detail-label">Prompt:</div>
              <pre class="detail-content">{{ task.prompt }}</pre>
            </div>

            <!-- 进度信息 -->
            <div v-if="task.summary" class="detail-section">
              <div class="detail-label">Progress:</div>
              <div class="detail-content">{{ task.summary }}</div>
            </div>

            <!-- Usage 信息 -->
            <div v-if="task.usage" class="detail-section">
              <div class="usage-info">
                <span v-if="task.usage.total_tokens">
                  {{ (task.usage.total_tokens / 1000).toFixed(1) }}k tokens
                </span>
                <span v-if="task.usage.tool_uses">
                  · {{ task.usage.tool_uses }} tools
                </span>
              </div>
            </div>
          </template>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.task-floating-container {
  position: fixed;
  bottom: 120px;
  right: 20px;
  width: 380px;
  max-height: 400px;
  background: #1E1E1E;
  border: 1px solid #3F3F46;
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  z-index: 1000;
  cursor: move;
}

.task-floating-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  background: #27272A;
  border-bottom: 1px solid #3F3F46;
  font-size: var(--font-size-sm);
  font-weight: var(--font-weight-medium);
  color: #A1A1AA;
}

.header-icon {
  font-size: 14px;
}

.header-title {
  flex: 1;
}

.task-list {
  max-height: 340px;
  overflow-y: auto;
}

.task-item {
  border-bottom: 1px solid #27272A;
}

.task-item:last-child {
  border-bottom: none;
}

.task-header {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.15s;
}

.task-header:hover {
  background: #27272A;
}

.task-icon {
  font-size: 18px;
  line-height: 1;
  flex-shrink: 0;
}

.task-info {
  flex: 1;
  min-width: 0;
}

.task-title {
  font-size: var(--font-size-sm);
  color: #E4E4E7;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.task-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 4px;
  font-size: var(--font-size-xs);
}

.running-time {
  color: #71717A;
}

.status-badge {
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 10px;
  font-weight: var(--font-weight-medium);
  text-transform: uppercase;
}

.status-badge.running {
  background: rgba(34, 197, 94, 0.2);
  color: #4ADE80;
}

.collapse-btn {
  font-size: 10px;
  color: #71717A;
}

.task-details {
  padding: 0 14px 12px 14px;
  border-top: 1px solid #27272A;
  background: #18181B;
}

.detail-section {
  margin-top: 10px;
}

.detail-label {
  font-size: var(--font-size-xs);
  font-weight: var(--font-weight-medium);
  color: #71717A;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.detail-content {
  font-size: var(--font-size-xs);
  color: #A1A1AA;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
  background: #0A0A0A;
  padding: 8px 10px;
  border-radius: var(--radius-sm);
  max-height: 100px;
  overflow: auto;
}

.usage-info {
  font-size: var(--font-size-xs);
  color: #71717A;
}

/* Todo 进度样式 */
.todo-progress {
  color: #A78BFA;
  font-weight: var(--font-weight-medium);
}

.status-badge.completed {
  background: rgba(34, 197, 94, 0.2);
  color: #4ADE80;
}

.status-badge.in-progress {
  background: rgba(251, 191, 36, 0.2);
  color: #FBBF24;
}

.status-badge.pending {
  background: rgba(113, 113, 122, 0.2);
  color: #71717A;
}

/* Todo 列表样式 */
.todo-list {
  margin-top: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: var(--font-size-xs);
  color: #A1A1AA;
  padding: 6px 8px;
  background: #0A0A0A;
  border-radius: var(--radius-sm);
  border-left: 2px solid transparent;
}

.todo-item.completed {
  color: #71717A;
  text-decoration: line-through;
  border-left-color: #22C55E;
}

.todo-item.in-progress {
  color: #FBBF24;
  border-left-color: #FBBF24;
}

.todo-item.pending {
  border-left-color: #3F3F46;
}

.todo-status-icon {
  font-size: 12px;
  flex-shrink: 0;
}

.todo-content {
  flex: 1;
  line-height: 1.4;
  word-break: break-word;
}
</style>
