<script setup>
/**
 * ChatInput - 聊天输入区域组件
 * 从 ChatWindow.vue 提取的输入组件
 */
import { ref, computed, onMounted, onUnmounted } from 'vue'

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  isProcessing: {
    type: Boolean,
    default: false
  },
  hasPermission: {
    type: Boolean,
    default: false
  },
  permissionMode: {
    type: String,
    default: 'default'
  },
  permissionModes: {
    type: Array,
    default: () => [
      { value: 'default', label: '默认', icon: '💡' },
      { value: 'acceptEdits', label: '允许编辑', icon: '✏️' },
      { value: 'plan', label: '计划模式', icon: '📋' },
      { value: 'bypassPermissions', label: '全部允许', icon: '✅' }
    ]
  },
  inputHistory: {
    type: Array,
    default: () => []
  },
  effort: {
    type: String,
    default: 'default'
  },
  effortOptions: {
    type: Array,
    default: () => [
      { value: 'default', label: '默认', icon: '🧠', description: '自动调整思考深度' },
      { value: 'low', label: '低', icon: '⚡', description: '快速响应，较少思考' },
      { value: 'medium', label: '中', icon: '🎯', description: '平衡思考与速度' },
      { value: 'high', label: '高', icon: '🔬', description: '深度思考，详细分析' }
    ]
  },
  currentModelLabel: {
    type: String,
    default: '系统'
  },
  currentModelKey: {
    type: String,
    default: 'system'
  },
  modelOptions: {
    type: Array,
    default: () => []
  },
  canSwitchModel: {
    type: Boolean,
    default: false
  },
  currentNotificationChannels: {
    type: Array,
    default: () => []
  },
  notificationOptions: {
    type: Array,
    default: () => []
  },
  canConfigureNotifications: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'send', 'interrupt', 'permissionModeChange', 'effortChange', 'addToHistory', 'modelChange', 'notificationToggle'])

// 输入区域 ref
const inputArea = ref(null)
const modelMenuWrapper = ref(null)
const permissionMenuWrapper = ref(null)
const effortMenuWrapper = ref(null)
const notificationMenuWrapper = ref(null)

// 输入框是否聚焦
const isInputFocused = ref(false)

// 是否正在拖拽文件
const isDragOver = ref(false)

// 显示权限菜单
const showPermissionMenu = ref(false)

// 显示思考力度菜单
const showEffortMenu = ref(false)

// 显示模型菜单
const showModelMenu = ref(false)
const showNotificationMenu = ref(false)

// 思考力度选项
const effortOptions = [
  { value: 'low', label: '低', icon: '⚡', description: '快速响应，较少思考' },
  { value: 'medium', label: '中', icon: '🧠', description: '平衡思考深度' },
  { value: 'high', label: '高', icon: '🔬', description: '深度思考，详细分析' }
]

// 当前思考力度 (从 props 获取或默认)
const currentEffort = ref('medium')

// Enter 键模式锁定 (true = Enter 发送, false = Enter 换行)
const enterModeLocked = ref(true)

// 切换 Enter 模式
function toggleEnterMode() {
  enterModeLocked.value = !enterModeLocked.value
}

const enterModeIcon = computed(() => {
  return enterModeLocked.value ? '⏎' : '⏎'
})

const enterModeTitle = computed(() => {
  return enterModeLocked.value ? '已启用回车发送 (点击禁用)' : '已禁用回车发送 (点击启用)'
})

// 显示历史记录选择弹窗
const showHistoryPicker = ref(false)

// 当前历史索引
let historyIndex = -1

// 标记是否正在通过历史导航设置值
let isHistoryNavigation = false

// 本地输入值
const localValue = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

// 当前权限模式的标签
const currentModeLabel = computed(() => {
  const mode = props.permissionModes.find(m => m.value === props.permissionMode)
  return mode ? `${mode.icon} ${mode.label}` : '💡 默认'
})

// 当前权限模式的描述
const currentModeDescription = computed(() => {
  const mode = props.permissionModes.find(m => m.value === props.permissionMode)
  return mode?.description || '每次都询问'
})

// 发送按钮是否禁用
const sendDisabled = computed(() => {
  return !localValue.value.trim() || props.isProcessing || props.hasPermission
})

// 权限模式对应的颜色主题
const modeThemeClass = computed(() => {
  const modeColors = {
    'default': '', // 默认保持现状
    'plan': 'mode-plan', // 蓝色
    'bypassPermissions': 'mode-bypass', // 绿色
    'acceptEdits': 'mode-edit', // 白色
    'auto': 'mode-edit' // 白色（auto 如果存在）
  }
  return modeColors[props.permissionMode] || ''
})

// 发送消息
function sendMessage() {
  if (!localValue.value.trim() || props.isProcessing) return

  // 添加到历史记录
  emit('addToHistory', localValue.value)

  emit('send', localValue.value)
  historyIndex = -1 // 重置历史索引
}

// 处理 Enter 键
function handleEnterKey(event) {
  // 如果正在使用输入法组合，不触发发送
  if (event.isComposing) return

  // 如果解锁了（enterModeLocked = false），Enter 换行，Shift+Enter 也换行
  // 如果锁定了（enterModeLocked = true），Shift+Enter 换行，Enter 发送
  if (!enterModeLocked.value) {
    // 解锁状态：Enter 换行（不做任何处理，让默认行为发生）
    return
  }

  // 锁定状态：Shift+Enter 换行，Enter 发送
  if (event.shiftKey) {
    return
  }

  // Enter 发送消息
  event.preventDefault()
  sendMessage()
}

// 处理上下键历史导航
function handleHistoryKey(event) {
  // 如果输入框有内容且不在历史浏览模式，不触发历史导航
  if (localValue.value.trim() && historyIndex === -1) {
    return
  }

  // 如果没有历史记录，不处理
  if (props.inputHistory.length === 0) {
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    // 向上：浏览更早的历史（索引增大）
    if (historyIndex < props.inputHistory.length - 1) {
      historyIndex++
      isHistoryNavigation = true
      localValue.value = props.inputHistory[props.inputHistory.length - 1 - historyIndex]
      isHistoryNavigation = false
    }
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    // 向下：浏览更新的历史（索引减小）
    if (historyIndex > 0) {
      historyIndex--
      isHistoryNavigation = true
      localValue.value = props.inputHistory[props.inputHistory.length - 1 - historyIndex]
      isHistoryNavigation = false
    } else if (historyIndex === 0) {
      // 回到最新状态，清空输入框
      historyIndex = -1
      isHistoryNavigation = true
      localValue.value = ''
      isHistoryNavigation = false
    }
  }
}

// 打开历史记录选择弹窗
function openHistoryPicker(event) {
  // Escape 关闭弹窗
  if (event.key === 'Escape' && showHistoryPicker.value) {
    event.preventDefault()
    closeHistoryPicker()
    return
  }

  // Cmd+Up (Mac) 或 Ctrl+Up (Windows) 打开弹窗
  if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowUp') {
    event.preventDefault()
    if (props.inputHistory.length > 0) {
      showHistoryPicker.value = true
    }
  }
}

// 关闭历史记录选择弹窗
function closeHistoryPicker() {
  showHistoryPicker.value = false
}

// 选择历史记录
function selectHistory(item) {
  isHistoryNavigation = true
  localValue.value = item
  isHistoryNavigation = false
  historyIndex = -1
  closeHistoryPicker()
}

// 处理输入变化
function handleInputChange() {
  if (!isHistoryNavigation && historyIndex !== -1) {
    historyIndex = -1
  }
}

// 处理打断
function handleInterrupt() {
  emit('interrupt')
}

// 选择权限模式
function selectPermissionMode(mode) {
  showPermissionMenu.value = false
  emit('permissionModeChange', mode)
}

// 当前思考力度的标签
const currentEffortLabel = computed(() => {
  const effort = props.effortOptions.find(e => e.value === props.effort)
  return effort ? `${effort.icon} ${effort.label}` : '🧠 中'
})

// 当前思考力度的描述
const currentEffortDescription = computed(() => {
  const effort = props.effortOptions.find(e => e.value === props.effort)
  return effort?.description || '平衡思考与速度'
})

// 选择思考力度
function selectEffort(effort) {
  showEffortMenu.value = false
  emit('effortChange', effort)
}

function selectModel(option) {
  showModelMenu.value = false
  emit('modelChange', option)
}

const hasEnabledNotifications = computed(() => props.currentNotificationChannels.length > 0)

const notificationButtonTitle = computed(() => {
  if (!props.currentNotificationChannels.length) {
    return '通知: 不通知'
  }

  const labels = props.notificationOptions
    .filter(option => props.currentNotificationChannels.includes(option.value))
    .map(option => option.label)

  return `通知: ${labels.join('、') || '已开启'}`
})

function toggleNotificationMenu() {
  const nextState = !showNotificationMenu.value
  closeAllMenus()
  showNotificationMenu.value = nextState
}

function toggleNotification(option) {
  emit('notificationToggle', option)
}

function closeAllMenus() {
  showModelMenu.value = false
  showPermissionMenu.value = false
  showEffortMenu.value = false
  showNotificationMenu.value = false
}

function toggleModelMenu() {
  const nextState = !showModelMenu.value
  closeAllMenus()
  showModelMenu.value = nextState
}

function togglePermissionMenu() {
  const nextState = !showPermissionMenu.value
  closeAllMenus()
  showPermissionMenu.value = nextState
}

function toggleEffortMenu() {
  const nextState = !showEffortMenu.value
  closeAllMenus()
  showEffortMenu.value = nextState
}

function handleGlobalClick(event) {
  const target = event.target
  if (
    modelMenuWrapper.value?.contains(target) ||
    permissionMenuWrapper.value?.contains(target) ||
    effortMenuWrapper.value?.contains(target) ||
    notificationMenuWrapper.value?.contains(target)
  ) {
    return
  }

  closeAllMenus()
}

function handleGlobalKeydown(event) {
  if (event.key === 'Escape') {
    closeAllMenus()
  }
}

// 处理文件拖放
function handleFileDrop(event) {
  event.preventDefault()
  isDragOver.value = false

  const files = event.dataTransfer?.files
  if (!files || files.length === 0) return

  const filePaths = []
  for (const file of files) {
    if (file.path) {
      filePaths.push(file.path)
    }
  }

  if (filePaths.length > 0) {
    appendText(filePaths.join(' '))
  }
}

function handleDragEnter(event) {
  event.preventDefault()
  isDragOver.value = true
}

function handleDragLeave(event) {
  event.preventDefault()
  isDragOver.value = false
}

// 获取历史记录列表（逆序，最新的在前）
function getHistoryList() {
  return [...props.inputHistory].reverse()
}

onMounted(() => {
  document.addEventListener('click', handleGlobalClick)
  document.addEventListener('keydown', handleGlobalKeydown)
})

onUnmounted(() => {
  document.removeEventListener('click', handleGlobalClick)
  document.removeEventListener('keydown', handleGlobalKeydown)
})

function appendText(text) {
  const nextText = String(text || '').trim()
  if (!nextText) return

  localValue.value = localValue.value.trim()
    ? `${localValue.value} ${nextText}`
    : nextText

  requestAnimationFrame(() => {
    inputArea.value?.focus()
    const cursorPosition = localValue.value.length
    inputArea.value?.setSelectionRange?.(cursorPosition, cursorPosition)
  })
}

// 暴露方法
defineExpose({
  focus: () => inputArea.value?.focus(),
  appendText
})
</script>

<template>
  <div class="input-area">
    <div class="input-container" :class="{ focused: isInputFocused, [modeThemeClass]: modeThemeClass }">
      <!-- 工具栏 -->
      <div class="input-toolbar">
        <!-- 左侧按钮组 -->
        <div class="toolbar-left">
          <div ref="modelMenuWrapper" class="model-mode-wrapper">
            <button
              @click="toggleModelMenu"
              class="model-mode-btn"
              title="快速切换模型"
              :disabled="!canSwitchModel"
            >
              <span class="model-mode-icon" aria-hidden="true">✨</span>
              <span class="model-mode-text">{{ currentModelLabel }}</span>
            </button>

            <div v-if="showModelMenu && canSwitchModel" class="model-menu">
              <button
                v-for="option in modelOptions"
                :key="option.key"
                class="model-menu-item"
                :class="{ active: currentModelKey === option.key }"
                @click="selectModel(option)"
              >
                <span class="model-menu-label">{{ option.label }}</span>
                <span v-if="currentModelKey === option.key" class="model-menu-check">✓</span>
              </button>
            </div>
          </div>

          <div ref="permissionMenuWrapper" class="permission-mode-wrapper">
            <button
              @click="togglePermissionMenu"
              class="permission-mode-btn"
              :title="`权限模式: ${currentModeDescription}`"
              :disabled="isProcessing"
            >
              {{ currentModeLabel }}
            </button>

            <!-- 权限模式菜单 -->
            <div v-if="showPermissionMenu" class="permission-menu">
              <button
                v-for="mode in permissionModes"
                :key="mode.value"
                class="permission-menu-item"
                :class="{ active: permissionMode === mode.value }"
                @click="selectPermissionMode(mode.value)"
              >
                <span class="permission-menu-icon">{{ mode.icon }}</span>
                <span class="permission-menu-label">{{ mode.label }}</span>
                <span v-if="permissionMode === mode.value" class="permission-menu-check">✓</span>
              </button>
            </div>
          </div>

          <!-- 思考力度切换按钮 -->
          <div ref="effortMenuWrapper" class="effort-mode-wrapper">
            <button
              @click="toggleEffortMenu"
              class="effort-mode-btn"
              :title="`思考力度: ${currentEffortDescription}`"
              :disabled="isProcessing"
            >
              {{ currentEffortLabel }}
            </button>

            <!-- 思考力度菜单 -->
            <div v-if="showEffortMenu" class="effort-menu">
              <button
                v-for="option in effortOptions"
                :key="option.value"
                class="effort-menu-item"
                :class="{ active: effort === option.value }"
                @click="selectEffort(option.value)"
              >
                <span class="effort-menu-icon">{{ option.icon }}</span>
                <span class="effort-menu-label">{{ option.label }}</span>
                <span class="effort-menu-desc">{{ option.description }}</span>
                <span v-if="effort === option.value" class="effort-menu-check">✓</span>
              </button>
            </div>
          </div>
        </div>

        <!-- 右侧按钮组 -->
        <div class="toolbar-right">
          <div ref="notificationMenuWrapper" class="notification-mode-wrapper">
            <button
              @click="toggleNotificationMenu"
              class="notification-mode-btn"
              :class="{ active: hasEnabledNotifications }"
              :title="notificationButtonTitle"
              :disabled="!canConfigureNotifications"
            >
              {{ hasEnabledNotifications ? '🔔' : '🔕' }}
            </button>
            <span v-if="currentNotificationChannels.length > 0" class="notification-count">
              {{ currentNotificationChannels.length }}
            </span>

            <div v-if="showNotificationMenu && canConfigureNotifications" class="notification-menu">
              <button
                class="notification-menu-item"
                :class="{ active: currentNotificationChannels.length === 0 }"
                @click="toggleNotification({ value: 'none' })"
              >
                <span class="notification-menu-label">不通知</span>
                <span v-if="currentNotificationChannels.length === 0" class="notification-menu-check">✓</span>
              </button>
              <button
                v-for="option in notificationOptions"
                :key="option.value"
                class="notification-menu-item"
                :class="{ active: currentNotificationChannels.includes(option.value), disabled: option.disabled }"
                :disabled="option.disabled"
                @click="toggleNotification(option)"
              >
                <span class="notification-menu-label">{{ option.label }}</span>
                <span v-if="currentNotificationChannels.includes(option.value)" class="notification-menu-check">✓</span>
              </button>
            </div>
          </div>

          <!-- Enter 模式切换按钮 -->
          <button
            @click="toggleEnterMode"
            class="enter-mode-btn"
            :class="{ locked: enterModeLocked }"
            :title="enterModeTitle"
            :disabled="isProcessing"
          >
            <span class="enter-keycap" :class="{ locked: enterModeLocked }">
              <span class="enter-keycap-icon">{{ enterModeIcon }}</span>
              <span v-if="!enterModeLocked" class="enter-keycap-overlay">🚫</span>
            </span>
          </button>

          <!-- 发送/打断按钮 -->
          <button
            v-if="!isProcessing"
            @click="sendMessage"
            :disabled="sendDisabled"
            class="send-button"
          >
            发送
          </button>
          <button
            v-else
            @click="handleInterrupt"
            class="interrupt-button"
            title="打断"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
              <rect x="6" y="6" width="12" height="12" rx="2"></rect>
            </svg>
          </button>
        </div>
      </div>

      <!-- 历史记录选择弹窗 -->
      <div v-if="showHistoryPicker" class="history-picker">
        <div class="history-picker-header">
          <span>历史记录</span>
          <button class="history-picker-close" @click="closeHistoryPicker">×</button>
        </div>
        <div class="history-picker-list">
          <div
            v-for="(item, idx) in getHistoryList()"
            :key="idx"
            class="history-picker-item"
            @click="selectHistory(item)"
          >
            {{ item }}
          </div>
        </div>
      </div>

      <!-- 文本输入框 -->
      <textarea
        ref="inputArea"
        v-model="localValue"
        @keydown.enter="handleEnterKey"
        @keydown.up="handleHistoryKey"
        @keydown.down="handleHistoryKey"
        @keydown="openHistoryPicker"
        @input="handleInputChange"
        @focus="isInputFocused = true"
        @blur="isInputFocused = false"
        @dragover.prevent
        @dragenter="handleDragEnter"
        @dragleave="handleDragLeave"
        @drop="handleFileDrop"
        :class="{ 'drag-over': isDragOver }"
        placeholder="输入消息... (Enter 发送, Shift+Enter 换行，可拖拽文件)"
        rows="3"
        :disabled="hasPermission"
      />
    </div>
  </div>
</template>

<style scoped>
.input-area {
  position: relative;
  padding: 20px;
  border-top: 1px solid #3F3F46;
  display: flex;
  flex: 0 0 auto;
  min-height: 165px;
}

.input-area.resizable-expanded {
  flex: 1 1 auto;
  min-height: 165px;
}

/* 输入框容器 */
.input-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  transition: border-color 0.2s;
}

.input-container.focused {
  border-color: #F97316;
}

/* 权限模式颜色主题 */
.input-container.mode-plan.focused {
  border-color: #3B82F6;
}

.input-container.mode-bypass.focused {
  border-color: #22C55E;
}

.input-container.mode-edit.focused {
  border-color: #E4E4E7;
}

/* 工具栏（包含权限模式按钮） */
.input-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 4px 8px;
  background: transparent;
  border-bottom: 1px solid #3F3F46;
}

/* 左侧按钮组 */
.toolbar-left {
  display: flex;
  align-items: center;
  gap: 4px;
}

.model-mode-wrapper {
  position: relative;
  display: inline-block;
}

.model-mode-btn {
  max-width: 220px;
  padding: 2px 8px;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: #A1A1AA;
  font-size: 12px;
  font-weight: 400;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  text-align: left;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.model-mode-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: #E4E4E7;
}

.model-mode-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.model-menu {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 4px;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.3);
  min-width: 220px;
  max-width: 300px;
  max-height: 240px;
  overflow-y: auto;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
}

.model-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #A1A1AA;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
}

.model-menu-item:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #E4E4E7;
}

.model-menu-item.active {
  color: #F97316;
}

.model-menu-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-menu-check {
  color: #F97316;
}

.model-mode-icon {
  flex-shrink: 0;
  font-size: 12px;
  line-height: 1;
}

.model-mode-text {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 权限模式包装器（用于定位菜单） */
.permission-mode-wrapper {
  position: relative;
  display: inline-block;
}

/* 权限模式按钮 */
.permission-mode-btn {
  min-width: 0;
  max-width: 140px;
  padding: 2px 8px;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: #A1A1AA;
  font-size: 12px;
  font-weight: 400;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
}

.permission-mode-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: #E4E4E7;
}

.permission-mode-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 权限模式菜单 */
.permission-menu {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 4px;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.3);
  min-width: 120px;
  z-index: 1000;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
}

/* 权限菜单项 */
.permission-menu-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #A1A1AA;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  text-align: left;
}

.permission-menu-item:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #E4E4E7;
}

.permission-menu-item.active {
  color: #F97316;
}

.permission-menu-icon {
  font-size: 12px;
}

.permission-menu-label {
  flex: 1;
}

.permission-menu-check {
  color: #F97316;
}

/* 思考力度包装器 */
.effort-mode-wrapper {
  position: relative;
  display: inline-block;
}

/* 思考力度按钮 */
.effort-mode-btn {
  min-width: 0;
  max-width: 110px;
  padding: 2px 8px;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: #A1A1AA;
  font-size: 12px;
  font-weight: 400;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  text-align: left;
  overflow: hidden;
  text-overflow: ellipsis;
}

.effort-mode-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: #E4E4E7;
}

.effort-mode-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 思考力度菜单 */
.effort-menu {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 4px;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.3);
  min-width: 180px;
  z-index: 1000;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
}

/* 思考力度菜单项 */
.effort-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #A1A1AA;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  white-space: nowrap;
  text-align: left;
}

.effort-menu-item:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #E4E4E7;
}

.effort-menu-item.active {
  color: #A78BFA;
}

.effort-menu-icon {
  font-size: 14px;
  width: 20px;
  text-align: center;
}

.effort-menu-label {
  min-width: 30px;
}

.effort-menu-desc {
  flex: 1;
  font-size: 11px;
  color: #71717A;
  text-align: right;
}

.effort-menu-check {
  color: #A78BFA;
}

/* 右侧按钮组 */
.toolbar-right {
  display: flex;
  align-items: center;
  gap: 4px;
  margin-right: -4.5px;
}

.notification-mode-wrapper {
  position: relative;
  display: inline-block;
}

.notification-mode-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #A1A1AA;
  font-size: 13px;
  cursor: pointer;
  transition: all 0.15s;
}

.notification-mode-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: #E4E4E7;
}

.notification-mode-btn.active {
  color: #FBBF24;
}

.notification-mode-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.notification-menu {
  position: absolute;
  bottom: 100%;
  right: 0;
  margin-bottom: 4px;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.3);
  min-width: 140px;
  z-index: 1000;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
}

.notification-count {
  position: absolute;
  top: -3px;
  right: -5px;
  min-width: 14px;
  height: 14px;
  padding: 0 4px;
  background: #F97316;
  border-radius: 999px;
  color: white;
  font-size: 10px;
  font-weight: 600;
  line-height: 14px;
  text-align: center;
  pointer-events: none;
}

.notification-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 10px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #A1A1AA;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
}

.notification-menu-item:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: #E4E4E7;
}

.notification-menu-item.active {
  color: #F97316;
}

.notification-menu-item.disabled {
  opacity: 0.45;
}

.notification-menu-label {
  flex: 1;
}

.notification-menu-check {
  color: #F97316;
}

/* Enter 模式切换按钮 */
.enter-mode-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 24px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s;
}

.enter-mode-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
}

.enter-mode-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.enter-keycap {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  position: relative;
  width: 20px;
  height: 20px;
  padding: 0;
  border-radius: 4px;
  background: transparent;
  border: 1px solid rgba(255, 255, 255, 0.16);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05);
  transition: all 0.15s;
}

.enter-keycap.locked {
  background: transparent;
  border-color: rgba(161, 161, 170, 0.36);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.05),
    0 0 0 1px rgba(161, 161, 170, 0.04);
}

.enter-keycap-icon {
  font-size: 12px;
  line-height: 1;
  color: #D4D4D8;
  transform: translateY(0);
}

.enter-keycap-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  line-height: 1;
  background: transparent;
  opacity: 0.72;
}

.enter-mode-btn.locked .enter-keycap {
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.06),
    0 1px 2px rgba(0, 0, 0, 0.12);
}

.enter-mode-btn.locked .enter-keycap-icon {
  color: #C4C4CC;
}

.enter-mode-btn:not(.locked) .enter-keycap {
  box-shadow: none;
}

/* 发送按钮 */
.send-button {
  padding: 4px 16px;
  background: #F97316;
  border: none;
  border-radius: 4px;
  color: white;
  font-weight: 500;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.2s;
  height: 24px;
  line-height: 1;
}

.send-button:hover:not(:disabled) {
  background: #EA580C;
}

.send-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

/* 权限模式对应的发送按钮颜色 */
.input-container.mode-plan .send-button {
  background: #3B82F6;
}

.input-container.mode-plan .send-button:hover:not(:disabled) {
  background: #2563EB;
}

.input-container.mode-bypass .send-button {
  background: #22C55E;
}

.input-container.mode-bypass .send-button:hover:not(:disabled) {
  background: #16A34A;
}

.input-container.mode-edit .send-button {
  background: #A1A1AA;
  color: #18181B;
}

.input-container.mode-edit .send-button:hover:not(:disabled) {
  background: #D4D4D8;
}

.interrupt-button {
  padding: 4px 12px;
  background: #EF4444;
  border: none;
  border-radius: 4px;
  color: white;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s;
  height: 24px;
}

.interrupt-button:hover {
  background: #DC2626;
}

/* 历史记录选择器 */
.history-picker {
  position: absolute;
  bottom: 100%;
  left: 0;
  right: 0;
  margin-bottom: 4px;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.3);
  max-height: 200px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  z-index: 1000;
}

.history-picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  border-bottom: 1px solid #3F3F46;
  font-size: 12px;
  color: #71717A;
}

.history-picker-close {
  background: transparent;
  border: none;
  color: #71717A;
  font-size: 18px;
  cursor: pointer;
  padding: 0 4px;
}

.history-picker-close:hover {
  color: #E4E4E7;
}

.history-picker-list {
  flex: 1;
  overflow-y: auto;
}

.history-picker-item {
  padding: 8px 12px;
  font-size: 13px;
  color: #E4E4E7;
  cursor: pointer;
  border-bottom: 1px solid #3F3F46;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.history-picker-item:last-child {
  border-bottom: none;
}

.history-picker-item:hover {
  background: #3F3F46;
}

/* 文本输入框 */
.input-container textarea {
  flex: 1;
  background: transparent;
  border: none;
  padding: 12px;
  color: #E4E4E7;
  font-size: 14px;
  resize: none;
  font-family: inherit;
  min-height: 60px;
  max-height: 400px;
  border-radius: 0 0 8px 8px;
  line-height: 1.5;
}

.input-area.resizable-expanded .input-container textarea {
  max-height: none;
}

.input-container textarea:focus {
  outline: none;
}

.input-container textarea::placeholder {
  color: #71717A;
}

.input-container textarea:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-container textarea.drag-over {
  background: rgba(249, 115, 22, 0.1);
}

/* Textarea scrollbar */
.input-container textarea::-webkit-scrollbar {
  width: 6px;
}

.input-container textarea::-webkit-scrollbar-track {
  background: transparent;
}

.input-container textarea::-webkit-scrollbar-thumb {
  background: #52525B;
  border-radius: 3px;
}

.input-container textarea::-webkit-scrollbar-thumb:hover {
  background: #71717A;
}

.input-container textarea::-webkit-scrollbar-corner {
  background: transparent;
}
</style>
