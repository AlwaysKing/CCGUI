<script setup>
/**
 * TaskFloatingWindow - 任务浮动窗口组件
 * 每个任务是一个独立的悬浮窗
 */
import { ref, computed, onMounted, onUnmounted, watch, nextTick } from 'vue'
import { useSessionStore } from '../../../../stores/useSessionStore'

const sessionStore = useSessionStore()

// Props
const props = defineProps({
  sidebarWidth: {
    type: Number,
    default: 260
  },
  sidebarCollapsed: {
    type: Boolean,
    default: false
  }
})

// 当前活跃的任务列表
const activeTasks = computed(() => {
  const session = sessionStore.currentSession
  if (!session || !session.activeTasks) return []
  return Array.from(session.activeTasks.values())
})

// 每个任务的状态 (位置、折叠状态、粘性状态)
const taskStates = ref(new Map())
const resizeObserver = ref(null)

// 任务类型图标
function getTaskIcon(taskType) {
  if (taskType === 'local_agent') return '🤖'
  if (taskType === 'explore') return '🔍'
  if (taskType === 'plan') return '📋'
  if (taskType === 'todo') return '📝'
  return '⚙️'
}

// 格式化运行时间
function formatRunningTime(startTime) {
  if (!startTime) return ''
  const elapsed = Date.now() - startTime
  if (elapsed < 1000) return `${elapsed}ms`
  if (elapsed < 60000) return `${(elapsed / 1000).toFixed(1)}s`
  return `${(elapsed / 60000).toFixed(1)}min`
}

// 获取任务进度
function getTaskProgress(task) {
  if (task.taskType === 'todo' && task.todos) {
    const completed = task.todos.filter(t => t.status === 'completed').length
    const total = task.todos.length
    return {
      completed,
      total,
      percent: total > 0 ? Math.round((completed / total) * 100) : 0
    }
  }
  return null
}

// 获取任务状态图标
function getTaskStatusIcon(task) {
  if (task.status === 'completed') return '✅'
  if (task.status === 'in_progress') return '🔄'
  return '⏳'
}

// 获取或创建任务状态
function getTaskState(taskId) {
  if (!taskStates.value.has(taskId)) {
    taskStates.value.set(taskId, {
      collapsed: true,
      position: null,
      isStickyToRight: true,
      isStickyToBottom: true
    })
  }
  return taskStates.value.get(taskId)
}

// 切换任务折叠状态
function toggleCollapse(taskId) {
  // 如果刚刚发生了拖拽，不触发折叠
  if (dragState.value.isDragging) {
    return
  }

  const state = getTaskState(taskId)
  state.collapsed = !state.collapsed
  taskStates.value = new Map(taskStates.value)

  // 折叠/展开后调整位置
  nextTick(() => {
    adjustAllPositions()
  })
}

// 获取边界值
function getBounds() {
  const PADDING = 12
  const TOP_BOUND = 40
  const LEFT_BOUND = props.sidebarCollapsed ? 12 : props.sidebarWidth + 12

  const resizeHandle = document.querySelector('.chat-window .resize-handle')
  let bottomBound = 120
  if (resizeHandle) {
    bottomBound = window.innerHeight - resizeHandle.getBoundingClientRect().top + PADDING
  }

  return { PADDING, TOP_BOUND, LEFT_BOUND, bottomBound }
}

// 计算任务的默认位置 (从下往上堆叠)
function getDefaultPosition(taskIndex) {
  const { PADDING, LEFT_BOUND, bottomBound } = getBounds()
  const taskHeight = 60
  const gap = 8

  const x = window.innerWidth - 320 - PADDING
  const y = window.innerHeight - bottomBound - taskHeight - (taskIndex * (taskHeight + gap))

  return {
    x: Math.max(LEFT_BOUND, x),
    y: Math.max(40, y)
  }
}

// 调整所有任务位置 (粘性逻辑)
function adjustAllPositions() {
  const { PADDING, TOP_BOUND, LEFT_BOUND, bottomBound } = getBounds()

  taskStates.value.forEach((state, taskId) => {
    if (!state.position) return

    const taskEl = document.querySelector(`[data-task-id="${taskId}"]`)
    if (!taskEl) return

    const containerRect = taskEl.getBoundingClientRect()
    const maxX = window.innerWidth - containerRect.width - PADDING
    const maxY = window.innerHeight - containerRect.height - bottomBound

    // 粘着右边
    if (state.isStickyToRight) {
      state.position.x = maxX
    } else if (state.position.x > maxX) {
      state.position.x = maxX
    }

    // 粘着底部
    if (state.isStickyToBottom) {
      state.position.y = maxY
    } else if (state.position.y > maxY) {
      state.position.y = maxY
    }

    // 左边界
    if (state.position.x < LEFT_BOUND) {
      state.position.x = LEFT_BOUND
    }

    // 上边界
    if (state.position.y < TOP_BOUND) {
      state.position.y = TOP_BOUND
    }
  })

  taskStates.value = new Map(taskStates.value)
}

// 拖拽状态跟踪
const dragState = ref({
  isDragging: false,
  startX: 0,
  startY: 0
})

// 开始拖拽
function startDrag(event, taskId) {
  event.preventDefault()
  const state = getTaskState(taskId)

  const container = event.currentTarget
  const rect = container.getBoundingClientRect()

  // 记录起始位置，用于判断是否是真正的拖拽
  dragState.value = {
    isDragging: false,
    startX: event.clientX,
    startY: event.clientY
  }

  const dragOffset = {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  }

  const onMove = (e) => {
    // 检查是否移动超过阈值（5px），如果是则认为是拖拽
    const dx = Math.abs(e.clientX - dragState.value.startX)
    const dy = Math.abs(e.clientY - dragState.value.startY)
    if (dx > 5 || dy > 5) {
      dragState.value.isDragging = true
    }

    if (!dragState.value.isDragging) return

    const { PADDING, TOP_BOUND, LEFT_BOUND, bottomBound } = getBounds()
    const containerRect = container.getBoundingClientRect()

    let newX = e.clientX - dragOffset.x
    let newY = e.clientY - dragOffset.y

    const maxX = window.innerWidth - containerRect.width - PADDING
    const maxY = window.innerHeight - containerRect.height - bottomBound

    newX = Math.max(LEFT_BOUND, Math.min(newX, maxX))
    newY = Math.max(TOP_BOUND, Math.min(newY, maxY))

    // 判断粘性
    state.isStickyToRight = newX >= maxX - 20
    state.isStickyToBottom = newY >= maxY - 20

    state.position = { x: newX, y: newY }
    taskStates.value = new Map(taskStates.value)
  }

  const onUp = () => {
    document.removeEventListener('mousemove', onMove)
    document.removeEventListener('mouseup', onUp)
  }

  document.addEventListener('mousemove', onMove)
  document.addEventListener('mouseup', onUp)
}

// 获取任务的位置样式
function getTaskStyle(taskId, taskIndex) {
  const state = getTaskState(taskId)
  const position = state.position || getDefaultPosition(taskIndex)
  return {
    left: `${position.x}px`,
    top: `${position.y}px`
  }
}

// 初始化新任务的位置
function initializeTaskPositions() {
  activeTasks.value.forEach((task, index) => {
    const state = getTaskState(task.id)
    if (!state.position) {
      state.position = getDefaultPosition(index)
      state.isStickyToRight = true
      state.isStickyToBottom = true
    }
  })
  taskStates.value = new Map(taskStates.value)
}

// 监听任务变化
watch(activeTasks, () => {
  nextTick(() => {
    initializeTaskPositions()
    adjustAllPositions()
  })
}, { deep: true })

// 监听 sidebar 变化
watch(() => props.sidebarWidth, () => {
  const { LEFT_BOUND } = getBounds()
  taskStates.value.forEach((state) => {
    if (state.position && state.position.x < LEFT_BOUND) {
      state.position.x = LEFT_BOUND
    }
  })
  taskStates.value = new Map(taskStates.value)
})

watch(() => props.sidebarCollapsed, () => {
  const { LEFT_BOUND } = getBounds()
  taskStates.value.forEach((state) => {
    if (state.position && state.position.x < LEFT_BOUND) {
      state.position.x = LEFT_BOUND
    }
  })
  taskStates.value = new Map(taskStates.value)
})

onMounted(() => {
  window.addEventListener('resize', adjustAllPositions)

  // 监听 messages 容器大小变化
  const messagesContainer = document.querySelector('.chat-window .messages')
  if (messagesContainer) {
    resizeObserver.value = new ResizeObserver(() => {
      nextTick(adjustAllPositions)
    })
    resizeObserver.value.observe(messagesContainer)
  }

  // 初始化位置
  initializeTaskPositions()
})

onUnmounted(() => {
  window.removeEventListener('resize', adjustAllPositions)
  if (resizeObserver.value) {
    resizeObserver.value.disconnect()
  }
})
</script>

<template>
  <!-- 每个任务是一个独立的悬浮窗 -->
  <div
    v-for="(task, index) in activeTasks"
    :key="task.id"
    :data-task-id="task.id"
    class="task-floating-window"
    :class="{ collapsed: getTaskState(task.id).collapsed }"
    :style="getTaskStyle(task.id, index)"
    @mousedown="startDrag($event, task.id)"
  >
    <!-- 折叠状态: 描述 + 进度 -->
    <div class="task-summary" @click.stop="toggleCollapse(task.id)">
      <span class="task-icon">{{ getTaskIcon(task.taskType) }}</span>
      <div class="task-info">
        <div class="task-description">{{ task.description || '任务运行中...' }}</div>
        <div class="task-meta">
          <!-- 进度 -->
          <template v-if="getTaskProgress(task)">
            <span class="progress-text">{{ getTaskProgress(task).completed }}/{{ getTaskProgress(task).total }}</span>
            <div class="progress-bar-mini">
              <div class="progress-fill-mini" :style="{ width: getTaskProgress(task).percent + '%' }"></div>
            </div>
          </template>
          <!-- 运行时间 -->
          <span class="running-time">{{ formatRunningTime(task.startTime) }}</span>
          <!-- 状态图标 -->
          <span class="status-icon">{{ getTaskStatusIcon(task) }}</span>
        </div>
      </div>
      <span class="expand-btn">{{ getTaskState(task.id).collapsed ? '▶' : '▼' }}</span>
    </div>

    <!-- 展开状态: 详细信息 -->
    <div v-if="!getTaskState(task.id).collapsed" class="task-details">
      <!-- TodoWrite: 显示 todos 列表 -->
      <template v-if="task.taskType === 'todo' && task.todos">
        <div class="todo-list">
          <div
            v-for="(todo, idx) in task.todos"
            :key="idx"
            class="todo-item"
            :class="todo.status"
          >
            <span class="todo-status-icon">
              {{ todo.status === 'completed' ? '✅' : todo.status === 'in_progress' ? '🔄' : '⏳' }}
            </span>
            <span class="todo-content">{{ todo.content }}</span>
          </div>
        </div>
      </template>

      <!-- Agent Task: 显示 prompt/summary/usage -->
      <template v-else>
        <div v-if="task.prompt" class="detail-section">
          <div class="detail-label">Prompt:</div>
          <pre class="detail-content">{{ task.prompt }}</pre>
        </div>

        <div v-if="task.summary" class="detail-section">
          <div class="detail-label">Progress:</div>
          <div class="detail-content">{{ task.summary }}</div>
        </div>

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
</template>

<style scoped>
.task-floating-window {
  position: fixed;
  width: 320px;
  background: #1E1E1E;
  border: 1px solid #3F3F46;
  border-radius: var(--radius-lg);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  overflow: hidden;
  z-index: 1000;
  cursor: move;
  user-select: none;
}

.task-summary {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  cursor: pointer;
  transition: background 0.15s;
}

.task-summary:hover {
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

.task-description {
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

.progress-text {
  color: #A78BFA;
  font-weight: var(--font-weight-medium);
  min-width: 32px;
}

.progress-bar-mini {
  flex: 1;
  max-width: 60px;
  height: 4px;
  background: #27272A;
  border-radius: 2px;
  overflow: hidden;
}

.progress-fill-mini {
  height: 100%;
  background: linear-gradient(90deg, #A78BFA, #8B5CF6);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.running-time {
  color: #71717A;
}

.status-icon {
  font-size: 12px;
}

.expand-btn {
  font-size: 10px;
  color: #71717A;
  flex-shrink: 0;
}

/* 展开详情 */
.task-details {
  padding: 0 14px 12px;
  border-top: 1px solid #27272A;
  background: #18181B;
  cursor: default;
}

/* Todo 列表 */
.todo-list {
  margin-top: 10px;
}

.todo-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 0;
  font-size: var(--font-size-xs);
  line-height: 1.4;
}

.todo-item.completed {
  color: #71717A;
}

.todo-item.completed .todo-content {
  text-decoration: line-through;
}

.todo-item.in_progress {
  color: #E4E4E7;
}

.todo-item.pending {
  color: #A1A1AA;
}

.todo-status-icon {
  flex-shrink: 0;
  width: 14px;
  text-align: center;
}

.todo-item.completed .todo-status-icon {
  color: #4ADE80;
}

.todo-item.in_progress .todo-status-icon {
  color: #FCD34D;
}

.todo-item.pending .todo-status-icon {
  color: #52525B;
}

.todo-content {
  flex: 1;
  word-break: break-word;
}

/* 详情区块 */
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
  margin: 0;
}

.usage-info {
  font-size: var(--font-size-xs);
  color: #71717A;
}
</style>
