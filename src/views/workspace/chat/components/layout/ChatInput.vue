<script setup>
/**
 * ChatInput - 聊天输入区域组件
 * 从 ChatWindow.vue 提取的输入组件
 */
import { ref, computed, onMounted, onUnmounted, nextTick, watch } from 'vue'
import AttachmentComposer from './AttachmentComposer.vue'
import { ATTACHMENT_TOKEN_REGEX, stripAttachmentTokens } from '../../../../../utils/chatAttachments'

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  attachments: {
    type: Array,
    default: () => []
  },
  isProcessing: {
    type: Boolean,
    default: false
  },
  toolbarLocked: {
    type: Boolean,
    default: false
  },
  sessionControlsSwitching: {
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
    default: 'medium'
  },
  effortKey: {
    type: String,
    default: 'medium'
  },
  effortOptions: {
    type: Array,
    default: () => [
      { value: 'low', label: '低', icon: '⚡', description: '更快返回结果，思考更少' },
      { value: 'medium', label: '中', icon: '🧠', description: '平衡思考力度与响应速度' },
      { value: 'high', label: '高', icon: '🔬', description: '深度思考，详细分析' }
    ]
  },
  canSwitchEffort: {
    type: Boolean,
    default: false
  },
  effortLoading: {
    type: Boolean,
    default: false
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
  currentSubModelLabel: {
    type: String,
    default: '默认'
  },
  currentSubModelKey: {
    type: String,
    default: 'default'
  },
  subModelOptions: {
    type: Array,
    default: () => []
  },
  canSwitchSubModel: {
    type: Boolean,
    default: false
  },
  subModelLoading: {
    type: Boolean,
    default: false
  },
  currentNotificationChannels: {
    type: Array,
    default: () => []
  },
  queueCount: {
    type: Number,
    default: 0
  },
  queueVisible: {
    type: Boolean,
    default: true
  },
  notificationOptions: {
    type: Array,
    default: () => []
  },
  canConfigureNotifications: {
    type: Boolean,
    default: false
  },
  inputTargetLabel: {
    type: String,
    default: ''
  },
  inputTargetAgentId: {
    type: String,
    default: ''
  },
  inputTargetOptions: {
    type: Array,
    default: () => []
  },
  inputTargetSubtitle: {
    type: String,
    default: ''
  },
  inputTargetReadOnly: {
    type: Boolean,
    default: false
  },
  querySlashCommands: {
    type: Function,
    default: null
  },
})

const emit = defineEmits(['update:modelValue', 'update:attachments', 'send', 'interrupt', 'permissionModeChange', 'effortChange', 'modelChange', 'subModelChange', 'notificationToggle', 'toggleQueueVisibility', 'inputTargetChange', 'runSlashCommand'])

// 输入区域 ref
const inputArea = ref(null)
const attachmentComposerRef = ref(null)
const modelMenuWrapper = ref(null)
const subModelMenuWrapper = ref(null)
const permissionMenuWrapper = ref(null)
const effortMenuWrapper = ref(null)
const notificationMenuWrapper = ref(null)
const inputTargetMenuWrapper = ref(null)
const slashMenuWrapper = ref(null)

// 输入框是否聚焦
const isInputFocused = ref(false)

// 显示权限菜单
const showPermissionMenu = ref(false)

// 显示思考力度菜单
const showEffortMenu = ref(false)

// 显示模型菜单
const showModelMenu = ref(false)
const showSubModelMenu = ref(false)
const showNotificationMenu = ref(false)
const showInputTargetMenu = ref(false)
const showSlashMenu = ref(false)
const slashMenuLoading = ref(false)
const slashSearchQuery = ref('')
const slashMenuError = ref('')
const slashCommandGroups = ref([])
const activeSlashGroupId = ref('')

// Enter 键模式锁定 (true = Enter 发送, false = Enter 换行)
const enterModeLocked = ref(true)

// 切换 Enter 模式
function toggleEnterMode() {
  enterModeLocked.value = !enterModeLocked.value
}

function toggleQueueVisibility() {
  emit('toggleQueueVisibility')
}

async function toggleSlashMenu() {
  if (props.toolbarLocked || typeof props.querySlashCommands !== 'function') {
    return
  }

  const nextState = !showSlashMenu.value
  showSlashMenu.value = nextState
  if (!nextState) {
    return
  }

  showModelMenu.value = false
  showSubModelMenu.value = false
  showNotificationMenu.value = false
  showInputTargetMenu.value = false
  showPermissionMenu.value = false
  showEffortMenu.value = false

  slashMenuLoading.value = true
  slashMenuError.value = ''
  try {
    const result = await props.querySlashCommands()
    const groups = Array.isArray(result?.groups) ? result.groups : []
    slashCommandGroups.value = groups
    activeSlashGroupId.value = groups[0]?.id || ''
    slashSearchQuery.value = ''
  } catch (error) {
    slashCommandGroups.value = []
    activeSlashGroupId.value = ''
    slashSearchQuery.value = ''
    slashMenuError.value = error?.message || '加载命令失败'
  } finally {
    slashMenuLoading.value = false
  }
}

function selectSlashGroup(groupId) {
  activeSlashGroupId.value = groupId
}

async function executeSlashCommand(command, event = null) {
  if (!command) {
    return
  }

  const commandValue = typeof command.value === 'string' ? command.value.trim() : ''
  if (!commandValue) {
    return
  }

  slashMenuLoading.value = true
  slashMenuError.value = ''
  try {
    emit('runSlashCommand', {
      ...command,
      value: commandValue
    })
    showSlashMenu.value = false
  } catch (error) {
    slashMenuError.value = error?.message || '执行命令失败'
  } finally {
    slashMenuLoading.value = false
  }
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
const historyIndex = ref(-1)

// 标记是否正在通过历史导航设置值
let isHistoryNavigation = false

// 本地输入值
const localValue = computed({
  get: () => props.modelValue,
  set: (val) => emit('update:modelValue', val)
})

const localAttachments = computed({
  get: () => props.attachments,
  set: (val) => emit('update:attachments', val)
})

const slashMenuGroups = computed(() => Array.isArray(slashCommandGroups.value) ? slashCommandGroups.value : [])
const slashSearchKeyword = computed(() => String(slashSearchQuery.value || '').trim().toLowerCase())
const filteredSlashGroups = computed(() => {
  const keyword = slashSearchKeyword.value
  const groups = slashMenuGroups.value
  if (!keyword) return groups

  return groups
    .map(group => ({
      ...group,
      children: Array.isArray(group.children)
        ? group.children.filter(item => {
            const haystacks = [item?.label, item?.argumentHint, item?.description, item?.value]
              .map(value => String(value || '').toLowerCase())
            return haystacks.some(text => text.includes(keyword))
          })
        : []
    }))
    .filter(group => Array.isArray(group.children) && group.children.length > 0)
})
const activeSlashGroup = computed(() => {
  const groups = filteredSlashGroups.value
  if (!groups.length) return null
  return groups.find(group => group.id === activeSlashGroupId.value) || groups[0]
})
const slashLeafCommands = computed(() => Array.isArray(activeSlashGroup.value?.children) ? activeSlashGroup.value.children : [])

watch(filteredSlashGroups, (groups) => {
  if (!groups.length) {
    activeSlashGroupId.value = ''
    return
  }

  if (!groups.some(group => group.id === activeSlashGroupId.value)) {
    activeSlashGroupId.value = groups[0]?.id || ''
  }
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
  const textWithoutTokens = String(localValue.value || '').replace(ATTACHMENT_TOKEN_REGEX, '').trim()
  const hasContent = Boolean(textWithoutTokens || props.attachments.length > 0)
  return !hasContent || props.hasPermission || props.inputTargetReadOnly
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

const disablePrimarySessionControls = computed(() => {
  return props.toolbarLocked || props.isProcessing || props.sessionControlsSwitching
})

const disablePermissionModeControl = computed(() => {
  return props.toolbarLocked
})

const disableAttachmentControl = computed(() => {
  return props.toolbarLocked || props.inputTargetReadOnly
})

const disableNotificationControl = computed(() => {
  return props.toolbarLocked
})

const disableQueueControl = computed(() => {
  return props.toolbarLocked
})

const disableEnterModeControl = computed(() => {
  return props.toolbarLocked
})

const disableSendControl = computed(() => {
  return props.toolbarLocked || sendDisabled.value
})

// 发送消息
function sendMessage() {
  if (sendDisabled.value) return

  if (props.attachments.length > 0) {
    emit('send', {
      text: localValue.value,
      attachments: props.attachments
    })
  } else {
    emit('send', localValue.value)
  }
  historyIndex.value = -1 // 重置历史索引
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
  if (stripAttachmentTokens(localValue.value, props.attachments).trim() && historyIndex.value === -1) {
    return
  }

  // 如果没有历史记录，不处理
  if (props.inputHistory.length === 0) {
    return
  }

  if (event.key === 'ArrowUp') {
    event.preventDefault()
    // 向上：浏览更早的历史（索引增大）
    if (historyIndex.value < props.inputHistory.length - 1) {
      historyIndex.value++
      isHistoryNavigation = true
      localValue.value = props.inputHistory[props.inputHistory.length - 1 - historyIndex.value]
      isHistoryNavigation = false
      nextTick(() => attachmentComposerRef.value?.focusAndPlaceCaretAtEnd?.())
    }
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    // 向下：浏览更新的历史（索引减小）
    if (historyIndex.value > 0) {
      historyIndex.value--
      isHistoryNavigation = true
      localValue.value = props.inputHistory[props.inputHistory.length - 1 - historyIndex.value]
      isHistoryNavigation = false
      nextTick(() => attachmentComposerRef.value?.focusAndPlaceCaretAtEnd?.())
    } else if (historyIndex.value === 0) {
      // 回到最新状态，清空输入框
      historyIndex.value = -1
      isHistoryNavigation = true
      localValue.value = ''
      isHistoryNavigation = false
      nextTick(() => attachmentComposerRef.value?.focusAndPlaceCaretAtEnd?.())
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
  localAttachments.value = []
  isHistoryNavigation = false
  historyIndex.value = -1
  closeHistoryPicker()
  nextTick(() => attachmentComposerRef.value?.focusAndPlaceCaretAtEnd?.())
}

// 处理输入变化
function handleInputChange() {
  if (!isHistoryNavigation && historyIndex.value !== -1) {
    historyIndex.value = -1
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
  return effort?.description || '平衡思考力度与响应速度'
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

function selectSubModel(option) {
  showSubModelMenu.value = false
  emit('subModelChange', option)
}

const hasEnabledNotifications = computed(() => props.currentNotificationChannels.length > 0)
const currentInputTargetOption = computed(() => {
  return props.inputTargetOptions.find(option => option.agentId === props.inputTargetAgentId)
    || (props.inputTargetLabel
      ? {
          agentId: props.inputTargetAgentId,
          label: props.inputTargetLabel,
          color: null,
          subtitle: props.inputTargetSubtitle,
          readOnly: props.inputTargetReadOnly
        }
      : null)
})

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

function toggleInputTargetMenu() {
  const nextState = !showInputTargetMenu.value
  closeAllMenus()
  showInputTargetMenu.value = nextState
}

function selectInputTarget(agentId) {
  showInputTargetMenu.value = false
  emit('inputTargetChange', agentId)
}

function closeAllMenus() {
  showModelMenu.value = false
  showSubModelMenu.value = false
  showPermissionMenu.value = false
  showEffortMenu.value = false
  showNotificationMenu.value = false
  showInputTargetMenu.value = false
  showSlashMenu.value = false
}

function toggleModelMenu() {
  const nextState = !showModelMenu.value
  closeAllMenus()
  showModelMenu.value = nextState
}

function toggleSubModelMenu() {
  const nextState = !showSubModelMenu.value
  closeAllMenus()
  showSubModelMenu.value = nextState
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
    subModelMenuWrapper.value?.contains(target) ||
    permissionMenuWrapper.value?.contains(target) ||
    effortMenuWrapper.value?.contains(target) ||
    notificationMenuWrapper.value?.contains(target) ||
    inputTargetMenuWrapper.value?.contains(target) ||
    slashMenuWrapper.value?.contains(target)
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
  attachmentComposerRef.value?.appendText(text)
}

function openAttachmentPicker() {
  attachmentComposerRef.value?.openFilePicker()
}

// 暴露方法
defineExpose({
  focus: () => attachmentComposerRef.value?.focus(),
  appendText,
  openAttachmentPicker
})
</script>

<template>
  <div class="input-area">
    <div
      class="input-container"
      :class="{ focused: isInputFocused, [modeThemeClass]: modeThemeClass }"
      @focusin="isInputFocused = true"
      @focusout="isInputFocused = false"
    >
      <!-- 工具栏 -->
      <div class="input-toolbar">
        <!-- 左侧按钮组 -->
        <div class="toolbar-left">
          <div ref="modelMenuWrapper" class="model-mode-wrapper">
            <button
              @click="toggleModelMenu"
              class="model-mode-btn"
              title="快速切换模型供应商"
              :disabled="disablePrimarySessionControls || !canSwitchModel"
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
                :disabled="option.selectable === false"
                :title="option.reasonDisabled || option.label"
                @click="selectModel(option)"
              >
                <span class="model-menu-label">{{ option.label }}</span>
                <span v-if="currentModelKey === option.key" class="model-menu-check">✓</span>
              </button>
            </div>
          </div>

          <div ref="subModelMenuWrapper" class="submodel-mode-wrapper">
            <button
              @click="toggleSubModelMenu"
              class="submodel-mode-btn"
              title="切换模型"
              :disabled="disablePrimarySessionControls || !canSwitchSubModel || subModelLoading"
            >
              <span class="submodel-mode-icon" aria-hidden="true">◌</span>
              <span class="submodel-mode-text">{{ subModelLoading ? '加载中' : currentSubModelLabel }}</span>
            </button>

            <div v-if="showSubModelMenu && canSwitchSubModel" class="submodel-menu">
              <button
                v-for="option in subModelOptions"
                :key="option.key"
                class="submodel-menu-item"
                :class="{ active: currentSubModelKey === option.key }"
                :title="option.description || option.label"
                @click="selectSubModel(option)"
              >
                <span class="submodel-menu-label">{{ option.label }}</span>
                <span v-if="currentSubModelKey === option.key" class="submodel-menu-check">✓</span>
              </button>
            </div>
          </div>

          <!-- 思考力度切换按钮 -->
          <div ref="effortMenuWrapper" class="effort-mode-wrapper">
            <button
              @click="toggleEffortMenu"
              class="effort-mode-btn"
              :title="`思考力度: ${currentEffortDescription}`"
              :disabled="disablePrimarySessionControls || !canSwitchEffort || effortLoading"
            >
              {{ effortLoading ? '🧠 加载中' : currentEffortLabel }}
            </button>

            <!-- 思考力度菜单 -->
            <div v-if="showEffortMenu && canSwitchEffort" class="effort-menu">
              <button
                v-for="option in effortOptions"
                :key="option.value"
                class="effort-menu-item"
                :class="{ active: effortKey === option.value }"
                @click="selectEffort(option.value)"
              >
                <span class="effort-menu-icon">{{ option.icon }}</span>
                <span class="effort-menu-label">{{ option.label }}</span>
                <span class="effort-menu-desc">{{ option.description }}</span>
                <span v-if="effortKey === option.value" class="effort-menu-check">✓</span>
              </button>
            </div>
          </div>

          <div ref="permissionMenuWrapper" class="permission-mode-wrapper">
            <button
              @click="togglePermissionMenu"
              class="permission-mode-btn"
              :title="`权限模式: ${currentModeDescription}`"
              :disabled="disablePermissionModeControl"
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
        </div>

        <!-- 右侧按钮组 -->
        <div class="toolbar-right">
          <div ref="slashMenuWrapper" class="slash-menu-wrapper">
            <button
              @click="toggleSlashMenu"
              class="slash-menu-btn"
              title="命令菜单"
              :disabled="props.toolbarLocked"
            >
              /
            </button>

            <div v-if="showSlashMenu" class="slash-menu-popover">
              <div v-if="slashMenuLoading" class="slash-menu-state">加载中...</div>
              <div v-else-if="slashMenuError" class="slash-menu-state slash-menu-error">{{ slashMenuError }}</div>
              <div v-else-if="!filteredSlashGroups.length" class="slash-menu-state">暂无匹配命令</div>
              <template v-else>
                <div class="slash-menu-search slash-menu-search--top">
                  <input
                    v-model="slashSearchQuery"
                    class="slash-menu-search-input"
                    type="text"
                    placeholder="搜索命令 / 描述 / 参数"
                  />
                </div>
                <div class="slash-menu-groups">
                  <button
                    v-for="group in filteredSlashGroups"
                    :key="group.id"
                    class="slash-menu-group"
                    :class="{ active: activeSlashGroup?.id === group.id }"
                    @click="selectSlashGroup(group.id)"
                  >
                    <span class="slash-menu-group-label">{{ group.label }}</span>
                    <span class="slash-menu-group-arrow">›</span>
                  </button>
                </div>
                <div class="slash-menu-items">
                  <button
                    v-for="item in slashLeafCommands"
                    :key="item.id"
                    class="slash-menu-item"
                    @click="executeSlashCommand(item, $event)"
                  >
                    <span class="slash-menu-item-main">
                      <span class="slash-menu-item-label">{{ item.label }}</span>
                      <span v-if="item.argumentHint" class="slash-menu-item-arg-wrap"><span class="slash-menu-item-arg">{{ item.argumentHint }}</span></span>
                    </span>
                    <span v-if="item.description" class="slash-menu-item-desc">{{ item.description }}</span>
                  </button>
                </div>
              </template>
            </div>
          </div>

          <button
            @click="openAttachmentPicker"
            class="attach-button"
            title="添加附件"
            :disabled="disableAttachmentControl"
          >
            📎
          </button>

          <div ref="notificationMenuWrapper" class="notification-mode-wrapper">
            <button
              @click="toggleNotificationMenu"
              class="notification-mode-btn"
              :class="{ active: hasEnabledNotifications }"
              :title="notificationButtonTitle"
              :disabled="disableNotificationControl"
            >
              {{ hasEnabledNotifications ? '🔔' : '🔕' }}
            </button>

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

          <button
            v-if="queueCount > 0"
            @click="toggleQueueVisibility"
            class="queue-count-btn"
            :class="{ active: queueVisible }"
            :title="queueVisible ? `隐藏排队消息 (${queueCount})` : `显示排队消息 (${queueCount})`"
            type="button"
            :disabled="disableQueueControl"
          >
            {{ queueCount }}
          </button>

          <!-- Enter 模式切换按钮 -->
          <button
            @click="toggleEnterMode"
            class="enter-mode-btn"
            :class="{ locked: enterModeLocked }"
            :title="enterModeTitle"
            :disabled="disableEnterModeControl"
          >
            <span class="enter-keycap" :class="{ locked: enterModeLocked }">
              <span class="enter-keycap-icon">{{ enterModeIcon }}</span>
              <span v-if="!enterModeLocked" class="enter-keycap-overlay">🚫</span>
            </span>
          </button>

          <div v-if="inputTargetLabel" ref="inputTargetMenuWrapper" class="input-target-menu-wrapper">
            <button
              class="input-target-menu-btn"
              :class="{ readonly: inputTargetReadOnly }"
              :style="currentInputTargetOption?.color ? { color: currentInputTargetOption.color } : null"
              type="button"
              :title="inputTargetSubtitle || inputTargetLabel"
              @click="toggleInputTargetMenu"
            >
              <span class="input-target-menu-btn__prefix">@</span>
              <span class="input-target-menu-btn__label">{{ currentInputTargetOption?.label || inputTargetLabel }}</span>
            </button>

            <div v-if="showInputTargetMenu && inputTargetOptions.length" class="input-target-menu">
              <button
                v-for="option in inputTargetOptions"
                :key="option.agentId"
                class="input-target-menu-item"
                :class="{ active: option.agentId === inputTargetAgentId }"
                :style="option.color ? { color: option.color } : null"
                type="button"
                @click="selectInputTarget(option.agentId)"
              >
                <span class="input-target-menu-item__main">
                  <span class="input-target-menu-item__prefix">@</span>
                  <span class="input-target-menu-item__label">{{ option.label }}</span>
                </span>
                <span v-if="option.subtitle" class="input-target-menu-item__meta">{{ option.subtitle }}</span>
              </button>
            </div>
          </div>

          <!-- 发送/打断按钮 -->
          <button
            v-if="!isProcessing"
            @click="sendMessage"
            :disabled="disableSendControl"
            class="send-button"
          >
            发送
          </button>
          <button
            v-else
            @click="handleInterrupt"
            class="interrupt-button"
            title="打断"
            :disabled="props.toolbarLocked"
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

      <AttachmentComposer
        ref="attachmentComposerRef"
        v-model="localValue"
        v-model:attachments="localAttachments"
        placeholder="输入消息... (Enter 发送, Shift+Enter 换行，可拖拽文件或粘贴图片)"
        :enter-to-send="enterModeLocked"
        :history-navigation-active="historyIndex !== -1"
        :disabled="hasPermission || inputTargetReadOnly"
        @submit="sendMessage"
        @history-up="handleHistoryKey"
        @history-down="handleHistoryKey"
        @history-picker="openHistoryPicker"
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
  height: 184px;
  min-height: 136px;
}

.input-area.resizable-expanded {
  flex: 1 1 auto;
  height: 184px;
  min-height: 136px;
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

.slash-menu-wrapper {
  position: relative;
  display: inline-block;
}

.slash-menu-btn {
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
  line-height: 1;
  cursor: pointer;
  transition: all 0.15s;
}

.slash-menu-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: #E4E4E7;
}

.slash-menu-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.slash-menu-popover {
  position: absolute;
  right: 0;
  bottom: 100%;
  margin-bottom: 6px;
  width: 420px;
  height: 320px;
  display: grid;
  grid-template-columns: 160px 1fr;
  grid-template-rows: auto minmax(0, 1fr);
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  box-shadow: 0 -6px 16px rgba(0, 0, 0, 0.32);
  overflow: hidden;
  z-index: 1200;
}

.slash-menu-state {
  grid-column: 1 / -1;
  padding: 16px;
  color: #A1A1AA;
  font-size: 12px;
}

.slash-menu-error {
  color: #FCA5A5;
}

.slash-menu-groups {
  grid-row: 2;
  grid-column: 1;
  display: flex;
  flex-direction: column;
  border-right: 1px solid #3F3F46;
  padding: 6px;
  gap: 4px;
  min-height: 0;
  overflow-y: auto;
}

.slash-menu-group,
.slash-menu-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: #D4D4D8;
  cursor: pointer;
  text-align: left;
}

.slash-menu-group {
  flex-direction: row;
  align-items: center;
  justify-content: space-between;
}

.slash-menu-group:hover,
.slash-menu-item:hover,
.slash-menu-group.active {
  background: rgba(255, 255, 255, 0.08);
}

.slash-menu-group-label {
  font-size: 12px;
  color: #E4E4E7;
}

.slash-menu-item-main {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  width: 100%;
  min-width: 0;
}

.slash-menu-item-label {
  font-size: 15px;
  line-height: 1.25;
  color: #F4F4F5;
  font-weight: 500;
  flex-shrink: 0;
}

.slash-menu-item-arg-wrap {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: flex-end;
}

.slash-menu-item-arg {
  display: inline-block;
  min-width: 0;
  max-width: 100%;
  font-size: 11px;
  line-height: 1.2;
  color: #71717A;
  vertical-align: middle;
  opacity: 0.95;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  transform: translateX(0);
  will-change: transform;
}

.slash-menu-item:hover .slash-menu-item-arg {
  overflow: visible;
  text-overflow: clip;
  animation: slash-menu-arg-marquee 5.2s ease-in-out infinite alternate;
}

.slash-menu-group-arrow {
  color: #71717A;
}

.slash-menu-items {
  grid-row: 2;
  grid-column: 2;
  display: flex;
  flex-direction: column;
  padding: 6px;
  gap: 4px;
  min-height: 0;
  overflow-y: auto;
}

.slash-menu-search {
  position: sticky;
  top: 0;
  z-index: 1;
  background: #27272A;
}

.slash-menu-search--top {
  grid-column: 1 / -1;
  padding: 6px;
  border-bottom: 1px solid #3F3F46;
}

.slash-menu-search-input {
  width: 100%;
  padding: 8px 10px;
  background: #18181B;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  color: #E4E4E7;
  font-size: 12px;
  outline: none;
}

.slash-menu-search-input::placeholder {
  color: #71717A;
}

.slash-menu-search-input:focus {
  border-color: #52525B;
  box-shadow: 0 0 0 1px rgba(82, 82, 91, 0.35);
}

.slash-menu-item-desc {
  font-size: 10px;
  line-height: 1.35;
  color: #71717A;
  opacity: 0.78;
}

@keyframes slash-menu-arg-marquee {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-45%);
  }
}

.model-mode-wrapper {
  position: relative;
  display: inline-block;
}

.submodel-mode-wrapper {
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

.submodel-mode-btn {
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

.submodel-mode-btn:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: #E4E4E7;
}

.submodel-mode-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.submodel-menu {
  position: absolute;
  bottom: 100%;
  left: 0;
  margin-bottom: 4px;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.3);
  min-width: 220px;
  max-width: 320px;
  max-height: 260px;
  overflow-y: auto;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
}

.submodel-menu-item {
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

.submodel-menu-item:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #E4E4E7;
}

.submodel-menu-item.active {
  color: #38BDF8;
}

.submodel-menu-label {
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.submodel-menu-check {
  color: #38BDF8;
}

.submodel-mode-icon {
  flex-shrink: 0;
  font-size: 12px;
  line-height: 1;
}

.submodel-mode-text {
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

.input-target-menu-wrapper {
  position: relative;
  display: inline-block;
}

.input-target-menu-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  background: transparent;
  border: none;
  border-radius: 3px;
  color: #A1A1AA;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
}

.input-target-menu-btn:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #E4E4E7;
}

.input-target-menu-btn.readonly {
  color: #60A5FA;
}

.input-target-menu-btn__prefix {
  color: #71717A;
}

.input-target-menu-btn__label {
  max-width: 110px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.input-target-menu {
  position: absolute;
  right: 0;
  bottom: 100%;
  margin-bottom: 4px;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  box-shadow: 0 -4px 12px rgba(0, 0, 0, 0.3);
  min-width: 180px;
  max-width: 240px;
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
}

.input-target-menu-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 8px;
  background: transparent;
  border: none;
  border-radius: 4px;
  color: #A1A1AA;
  cursor: pointer;
  text-align: left;
}

.input-target-menu-item:hover {
  background: rgba(255, 255, 255, 0.1);
  color: #E4E4E7;
}

.input-target-menu-item.active {
  color: #F97316;
}

.input-target-menu-item__main {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.input-target-menu-item__prefix {
  color: #71717A;
}

.input-target-menu-item__label {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.input-target-menu-item__meta {
  flex-shrink: 0;
  color: #71717A;
  font-size: 11px;
}

.attach-button {
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

.attach-button:hover:not(:disabled) {
  background: rgba(255, 255, 255, 0.1);
  color: #E4E4E7;
}

.attach-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.queue-count-btn {
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid rgba(249, 115, 22, 0.22);
  border-radius: 6px;
  background: rgba(249, 115, 22, 0.06);
  color: #F97316;
  font-size: 11px;
  line-height: 1;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.queue-count-btn:hover {
  background: rgba(249, 115, 22, 0.12);
  border-color: rgba(249, 115, 22, 0.35);
}

.queue-count-btn.active {
  background: rgba(249, 115, 22, 0.16);
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
  min-height: 76px;
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
