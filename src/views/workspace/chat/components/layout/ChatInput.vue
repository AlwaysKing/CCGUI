<script setup>
/**
 * ChatInput - 聊天输入区域组件
 * 从 ChatWindow.vue 提取的输入组件
 */
import { ref, computed } from 'vue'

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
  }
})

const emit = defineEmits(['update:modelValue', 'send', 'interrupt', 'permissionModeChange', 'addToHistory'])

// 输入区域 ref
const inputArea = ref(null)

// 输入框是否聚焦
const isInputFocused = ref(false)

// 是否正在拖拽文件
const isDragOver = ref(false)

// 显示权限菜单
const showPermissionMenu = ref(false)

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

  // Shift+Enter 换行，Enter 发送
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

// 点击外部关闭权限菜单
function handleClickOutsidePermissionMenu(event) {
  const wrapper = document.querySelector('.permission-mode-wrapper')
  if (wrapper && !wrapper.contains(event.target)) {
    showPermissionMenu.value = false
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
    if (localValue.value.trim()) {
      localValue.value += ' '
    }
    localValue.value += filePaths.join(' ')
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

// 暴露方法
defineExpose({
  focus: () => inputArea.value?.focus()
})
</script>

<template>
  <div class="input-area">
    <div class="input-container" :class="{ focused: isInputFocused }">
      <!-- 权限模式切换按钮 -->
      <div class="input-toolbar">
        <div class="permission-mode-wrapper">
          <button
            @click="showPermissionMenu = !showPermissionMenu"
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
        :disabled="isProcessing || hasPermission"
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

/* 输入框容器 */
.input-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  transition: border-color 0.2s;
}

.input-container.focused {
  border-color: #F97316;
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
  border-radius: 8px 8px 0 0;
}

/* 权限模式包装器（用于定位菜单） */
.permission-mode-wrapper {
  position: relative;
  display: inline-block;
}

/* 权限模式按钮 */
.permission-mode-btn {
  min-width: 90px;
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

/* 发送按钮 */
.send-button {
  margin-right: -4.5px;
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

.interrupt-button {
  margin-right: -4.5px;
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
