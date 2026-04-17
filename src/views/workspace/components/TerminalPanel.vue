<script setup>
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { Terminal } from 'xterm'
import { FitAddon } from 'xterm-addon-fit'
import 'xterm/css/xterm.css'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  projectPath: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['running-change', 'hide'])

const terminals = ref([])
const activeTerminalId = ref('')
const isCreatingTerminal = ref(false)
const terminalSidebarWidth = ref(88)
const isSidebarResizing = ref(false)
const terminalThemeKey = ref('ccgui-dark')
const terminalFontFamily = ref('Menlo, Monaco, "Courier New", monospace')
const customTerminalThemeText = ref('')
const terminalHosts = new Map()
const terminalInstances = new Map()
let removeTerminalDataListener = null
let removeTerminalExitListener = null
let removeTerminalStatusListener = null
const terminalWheelCleanup = new Map()
const terminalResizeCleanup = new Map()

const activeTerminal = computed(() => terminals.value.find(item => item.id === activeTerminalId.value) || null)
const runningTerminalCount = computed(() => terminals.value.filter(isTerminalRunning).length)
const runningTaskLabels = computed(() => {
  return terminals.value
    .filter(terminal => getTerminalKind(terminal) === TASK_TERMINAL_KIND && isTerminalRunning(terminal))
    .map(terminal => String(terminal.taskLabel || '').trim())
    .filter(Boolean)
})
const terminalSidebarStyle = computed(() => ({
  width: `${terminalSidebarWidth.value}px`,
  flex: `0 0 ${terminalSidebarWidth.value}px`
}))
const terminalSurfaceStyle = computed(() => {
  return {
    '--terminal-theme-background': 'rgba(0, 0, 0, 0)',
    '--terminal-theme-surface': 'transparent',
    '--terminal-theme-sidebar-background': 'rgba(17, 19, 23, 0.32)'
  }
})
const TERMINAL_SIDEBAR_MIN_WIDTH = 72
const TERMINAL_SIDEBAR_MAX_WIDTH = 180
const TASK_TERMINAL_KIND = 'task'
const USER_TERMINAL_KIND = 'user'
const suppressAutoCreateOnce = ref(false)

function getTerminalMeta(terminalId) {
  return terminals.value.find(item => item.id === terminalId) || null
}

function getTerminalLabel(index) {
  return `终端 ${index + 1}`
}

function getTerminalKind(terminal) {
  return terminal?.kind === TASK_TERMINAL_KIND ? TASK_TERMINAL_KIND : USER_TERMINAL_KIND
}

function getTerminalDisplayTitle(terminal, index) {
  if (getTerminalKind(terminal) === TASK_TERMINAL_KIND) {
    return terminal?.taskLabel || `任务终端 ${index + 1}`
  }
  return getTerminalLabel(index)
}

function getTerminalCommandLabel(terminal) {
  return terminal?.currentCommand || terminal?.shellLabel || 'shell'
}

function isTerminalRunning(terminal) {
  if (!terminal || terminal.exited) return false
  const shellLabel = terminal.shellLabel || 'shell'
  const currentCommand = terminal.currentCommand || shellLabel
  return currentCommand !== shellLabel && currentCommand !== 'shell'
}

function isReusableTaskTerminal(terminal) {
  return Boolean(
    terminal &&
    !terminal.exited &&
    getTerminalKind(terminal) === TASK_TERMINAL_KIND &&
    !isTerminalRunning(terminal)
  )
}

function getTerminalTheme(themeKey) {
  const themes = {
    'ccgui-dark': {
      background: '#1E1E1E',
      foreground: '#E4E4E7',
      cursor: '#F97316',
      cursorAccent: '#1E1E1E',
      selectionBackground: 'rgba(228, 228, 231, 0.18)',
      black: '#1E1E1E',
      red: '#F87171',
      green: '#4ADE80',
      yellow: '#FBBF24',
      blue: '#60A5FA',
      magenta: '#C084FC',
      cyan: '#22D3EE',
      white: '#E4E4E7',
      brightBlack: '#52525B',
      brightRed: '#FCA5A5',
      brightGreen: '#86EFAC',
      brightYellow: '#FCD34D',
      brightBlue: '#93C5FD',
      brightMagenta: '#D8B4FE',
      brightCyan: '#67E8F9',
      brightWhite: '#FAFAFA'
    },
    'macos-terminal': {
      background: '#1e1e1e',
      foreground: '#bfbfbf',
      cursor: '#c7c7c7',
      cursorAccent: '#1e1e1e',
      selectionBackground: 'rgba(255,255,255,0.22)',
      black: '#000000',
      red: '#990000',
      green: '#00a600',
      yellow: '#999900',
      blue: '#0000b2',
      magenta: '#b200b2',
      cyan: '#00a6b2',
      white: '#bfbfbf',
      brightBlack: '#666666',
      brightRed: '#e50000',
      brightGreen: '#00d900',
      brightYellow: '#e5e500',
      brightBlue: '#0000ff',
      brightMagenta: '#e500e5',
      brightCyan: '#00e5e5',
      brightWhite: '#e5e5e5'
    },
    'iterm2-dark': {
      background: '#101421',
      foreground: '#fffbf6',
      cursor: '#fffbf6',
      cursorAccent: '#101421',
      selectionBackground: 'rgba(255,255,255,0.18)',
      black: '#2e2e2e',
      red: '#eb4129',
      green: '#abe047',
      yellow: '#f6c744',
      blue: '#47a0f3',
      magenta: '#7b5cb0',
      cyan: '#64dbed',
      white: '#e5e9f0',
      brightBlack: '#565656',
      brightRed: '#ec5357',
      brightGreen: '#c0e17d',
      brightYellow: '#f9da6a',
      brightBlue: '#49a4f8',
      brightMagenta: '#a47de9',
      brightCyan: '#99faf2',
      brightWhite: '#ffffff'
    },
    'vscode-dark': {
      background: '#1e1e1e',
      foreground: '#d4d4d4',
      cursor: '#aeafad',
      cursorAccent: '#1e1e1e',
      selectionBackground: 'rgba(38,79,120,0.6)',
      black: '#000000',
      red: '#cd3131',
      green: '#0dbc79',
      yellow: '#e5e510',
      blue: '#2472c8',
      magenta: '#bc3fbc',
      cyan: '#11a8cd',
      white: '#e5e5e5',
      brightBlack: '#666666',
      brightRed: '#f14c4c',
      brightGreen: '#23d18b',
      brightYellow: '#f5f543',
      brightBlue: '#3b8eea',
      brightMagenta: '#d670d6',
      brightCyan: '#29b8db',
      brightWhite: '#ffffff'
    }
  }

  if (themeKey === 'custom') {
    try {
      const parsedTheme = JSON.parse(customTerminalThemeText.value || '{}')
      return {
        ...themes['ccgui-dark'],
        ...parsedTheme
      }
    } catch (error) {
      return themes['ccgui-dark']
    }
  }

  return themes[themeKey] || themes['ccgui-dark']
}

async function loadTerminalAppearance() {
  try {
    const result = await window.electronAPI.getAppConfig()
    const configuredFont = result?.config?.settings?.terminalFontFamily
    const configuredTheme = result?.config?.settings?.terminalTheme
    const configuredCustomThemeText = result?.config?.settings?.customTerminalThemeText
    terminalThemeKey.value = configuredTheme || 'ccgui-dark'
    terminalFontFamily.value = configuredFont || 'Menlo, Monaco, "Courier New", monospace'
    customTerminalThemeText.value = configuredCustomThemeText || ''
  } catch (error) {
    terminalThemeKey.value = 'ccgui-dark'
    terminalFontFamily.value = 'Menlo, Monaco, "Courier New", monospace'
    customTerminalThemeText.value = ''
  }
}

function applyTerminalAppearance() {
  for (const instance of terminalInstances.values()) {
    instance.terminal.options.fontFamily = terminalFontFamily.value
    instance.terminal.options.theme = {
      ...getTerminalTheme(terminalThemeKey.value),
      background: '#00000000'
    }
    if (instance.terminal.rows > 0) {
      instance.terminal.refresh(0, instance.terminal.rows - 1)
    }
  }
  fitActiveTerminal()
}

function estimateTerminalSize() {
  const container = terminalHosts.get(activeTerminalId.value)
  if (!container) {
    return { cols: 120, rows: 24 }
  }

  const width = container.clientWidth || 960
  const height = container.clientHeight || 240
  return {
    cols: Math.max(60, Math.floor(width / 9)),
    rows: Math.max(12, Math.floor(height / 18))
  }
}

async function createTerminal(terminalOptions = {}) {
  if (isCreatingTerminal.value) return
  isCreatingTerminal.value = true

  try {
    const { cols, rows } = estimateTerminalSize()
    const result = await window.electronAPI.createTerminal({
      cwd: terminalOptions.cwd || props.projectPath,
      cols,
      rows
    })

    if (!result?.success || !result.terminal) {
      throw new Error(result?.error || '创建终端失败')
    }

    terminals.value = [
      ...terminals.value,
      {
        id: result.terminal.id,
        name: result.terminal.name,
        cwd: result.terminal.cwd,
        shell: result.terminal.shell,
        shellLabel: result.terminal.shell?.split('/').pop() || 'shell',
        currentCommand: result.terminal.command || result.terminal.shell?.split('/').pop() || 'shell',
        kind: terminalOptions.kind || USER_TERMINAL_KIND,
        taskLabel: terminalOptions.taskLabel || '',
        exited: false,
        buffer: ''
      }
    ]
    activeTerminalId.value = result.terminal.id

    await nextTick()
    mountTerminal(result.terminal.id, true)
  } catch (error) {
    console.error('[TerminalPanel] Failed to create terminal:', error)
  } finally {
    isCreatingTerminal.value = false
  }
}

async function runTaskInTerminal(task) {
  if (!task?.commandLine) {
    throw new Error('缺少可执行的任务命令')
  }

  let terminalMeta = terminals.value.find(isReusableTaskTerminal) || null
  if (!terminalMeta) {
    await createTerminal({
      cwd: task.cwd || props.projectPath,
      kind: TASK_TERMINAL_KIND,
      taskLabel: task.label || ''
    })
    terminalMeta = getTerminalMeta(activeTerminalId.value)
  } else {
    terminalMeta.cwd = task.cwd || terminalMeta.cwd || props.projectPath
    terminalMeta.taskLabel = task.label || terminalMeta.taskLabel || ''
    terminalMeta.kind = TASK_TERMINAL_KIND
    activeTerminalId.value = terminalMeta.id
  }

  if (!terminalMeta?.id) {
    throw new Error('任务终端创建失败')
  }

  terminalMeta.exited = false
  activeTerminalId.value = terminalMeta.id
  await nextTick()
  mountTerminal(terminalMeta.id, false)

  if (task.cwd && task.cwd !== terminalMeta.cwd) {
    terminalMeta.cwd = task.cwd
  }

  const commands = []
  if (task.cwd) {
    commands.push(`cd ${JSON.stringify(task.cwd)}`)
  }
  commands.push(task.commandLine)
  await window.electronAPI.writeTerminal({
    terminalId: terminalMeta.id,
    data: `${commands.join('\r')}\r`
  })

  return terminalMeta.id
}

async function stopTaskTerminal(task) {
  const taskLabel = String(task?.label || '').trim()
  if (!taskLabel) {
    return false
  }

  const terminalMeta = terminals.value.find(terminal => {
    return (
      getTerminalKind(terminal) === TASK_TERMINAL_KIND &&
      String(terminal.taskLabel || '').trim() === taskLabel &&
      !terminal.exited
    )
  })

  if (!terminalMeta?.id) {
    return false
  }

  await window.electronAPI.writeTerminal({
    terminalId: terminalMeta.id,
    data: '\u0003'
  })
  return true
}

function disposeTerminalInstance(terminalId) {
  const instance = terminalInstances.get(terminalId)
  if (!instance) return

  if (instance.fitFrame) {
    cancelAnimationFrame(instance.fitFrame)
    instance.fitFrame = null
  }
  if (instance.fitTimer) {
    clearTimeout(instance.fitTimer)
    instance.fitTimer = null
  }

  instance.terminal.dispose()
  terminalInstances.delete(terminalId)

  const cleanup = terminalWheelCleanup.get(terminalId)
  if (cleanup) {
    cleanup()
    terminalWheelCleanup.delete(terminalId)
  }

  const resizeCleanup = terminalResizeCleanup.get(terminalId)
  if (resizeCleanup) {
    resizeCleanup()
    terminalResizeCleanup.delete(terminalId)
  }
}

async function removeTerminal(terminalId, closeRemote = true) {
  if (!terminalId) return

  if (closeRemote) {
    try {
      await window.electronAPI.closeTerminal({ terminalId })
    } catch (error) {
      console.error('[TerminalPanel] Failed to close terminal:', error)
    }
  }

  disposeTerminalInstance(terminalId)
  terminals.value = terminals.value.filter(item => item.id !== terminalId)

  if (activeTerminalId.value === terminalId) {
    activeTerminalId.value = terminals.value[terminals.value.length - 1]?.id || ''
  }

  await nextTick()
  if (activeTerminalId.value) {
    mountTerminal(activeTerminalId.value, true)
  }
}

function setTerminalHost(terminalId, element) {
  if (!element) {
    terminalHosts.delete(terminalId)
    return
  }

  terminalHosts.set(terminalId, element)
  mountTerminal(terminalId, terminalId === activeTerminalId.value)
}

function mountTerminal(terminalId, shouldFocus = false) {
  const host = terminalHosts.get(terminalId)
  const terminalMeta = getTerminalMeta(terminalId)
  if (!host || !terminalMeta) return

  const applyTerminalFit = instance => {
    try {
      if (!props.visible || terminalId !== activeTerminalId.value) {
        return
      }

      if (!host.isConnected || host.clientWidth <= 0 || host.clientHeight <= 0) {
        return
      }

      instance.fitAddon.fit()
      const dimensions = instance.terminal.cols && instance.terminal.rows
        ? { cols: instance.terminal.cols, rows: instance.terminal.rows }
        : estimateTerminalSize()

      if (
        instance.lastDimensions &&
        instance.lastDimensions.cols === dimensions.cols &&
        instance.lastDimensions.rows === dimensions.rows
      ) {
        return
      }

      instance.lastDimensions = dimensions
      window.electronAPI.resizeTerminal({
        terminalId,
        cols: dimensions.cols,
        rows: dimensions.rows
      })
    } catch (error) {
      console.error('[TerminalPanel] Failed to fit terminal:', error)
    }
  }

  const scheduleTerminalFit = instance => {
    if (instance.fitFrame) {
      cancelAnimationFrame(instance.fitFrame)
      instance.fitFrame = null
    }
    if (instance.fitTimer) {
      clearTimeout(instance.fitTimer)
      instance.fitTimer = null
    }

    instance.fitFrame = requestAnimationFrame(() => {
      instance.fitFrame = null
      instance.fitTimer = setTimeout(() => {
        instance.fitTimer = null
        applyTerminalFit(instance)
      }, 40)
    })
  }

  let instance = terminalInstances.get(terminalId)
  if (!instance) {
    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: terminalFontFamily.value,
      fontSize: 12,
      fontWeight: 'normal',
      fontWeightBold: '600',
      lineHeight: 1,
      letterSpacing: 0,
      scrollback: 5000,
      theme: getTerminalTheme(terminalThemeKey.value)
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(host)
    terminal.onData(data => {
      window.electronAPI.writeTerminal({ terminalId, data })
    })

    const viewport = host.querySelector('.xterm-viewport')
    const handleWheel = event => {
      event.stopPropagation()
    }
    viewport?.addEventListener('wheel', handleWheel, { passive: true })
    terminalWheelCleanup.set(terminalId, () => {
      viewport?.removeEventListener('wheel', handleWheel)
    })

    instance = {
      terminal,
      fitAddon,
      lastDimensions: null,
      fitFrame: null,
      fitTimer: null
    }
    terminalInstances.set(terminalId, instance)

    const resizeObserver = new ResizeObserver(() => {
      scheduleTerminalFit(instance)
    })
    resizeObserver.observe(host)
    terminalResizeCleanup.set(terminalId, () => {
      resizeObserver.disconnect()
    })

    if (terminalMeta.buffer) {
      const bufferedContent = terminalMeta.buffer
      terminalMeta.buffer = ''
      terminal.write(bufferedContent, () => {
        terminal.scrollToBottom()
      })
    }
  } else if (host.childElementCount === 0) {
    instance.terminal.open(host)
  }

  scheduleTerminalFit(instance)

  // 不再自动获取焦点，用户必须手动点击终端才能获得焦点
  // 这样可以避免终端状态变化时抢夺聊天输入框的焦点
}

function fitActiveTerminal() {
  if (!props.visible || !activeTerminalId.value) return
  nextTick(() => {
    mountTerminal(activeTerminalId.value, false)
  })
}

function handleTerminalData(payload) {
  const terminalMeta = getTerminalMeta(payload?.terminalId)
  if (!terminalMeta) return

  const instance = terminalInstances.get(payload?.terminalId)
  if (!instance) {
    terminalMeta.buffer += payload.data || ''
    return
  }
  instance.terminal.write(payload.data || '', () => {
    instance.terminal.scrollToBottom()
  })
}

function handleTerminalExit(payload) {
  const terminalMeta = getTerminalMeta(payload?.terminalId)
  if (!terminalMeta) return
  terminalMeta.exited = true
  terminalMeta.currentCommand = terminalMeta.shellLabel || 'shell'
}

function handleTerminalStatus(payload) {
  const terminalMeta = getTerminalMeta(payload?.terminalId)
  if (!terminalMeta) return
  terminalMeta.currentCommand = payload?.command || terminalMeta.shellLabel || 'shell'
}

function handleActivateTerminal(terminalId) {
  activeTerminalId.value = terminalId
}

function handleCloseTerminal(event, terminalId) {
  event.stopPropagation()
  removeTerminal(terminalId, true)
}

function startSidebarResize(event) {
  isSidebarResizing.value = true
  event.preventDefault()
}

function handleSidebarResize(event) {
  if (!isSidebarResizing.value) return

  const terminalPanel = document.querySelector('.terminal-panel')
  if (!terminalPanel) return

  const panelRect = terminalPanel.getBoundingClientRect()
  const nextWidth = panelRect.right - event.clientX
  terminalSidebarWidth.value = Math.max(
    TERMINAL_SIDEBAR_MIN_WIDTH,
    Math.min(TERMINAL_SIDEBAR_MAX_WIDTH, nextWidth)
  )
  fitActiveTerminal()
}

function stopSidebarResize() {
  isSidebarResizing.value = false
}

async function resetTerminals() {
  const terminalIds = terminals.value.map(item => item.id)
  for (const terminalId of terminalIds) {
    await removeTerminal(terminalId, true)
  }
  terminals.value = []
  activeTerminalId.value = ''
}

watch(() => props.visible, async visible => {
  if (!visible) return
  if (suppressAutoCreateOnce.value) {
    suppressAutoCreateOnce.value = false
    fitActiveTerminal()
    return
  }
  if (terminals.value.length === 0) {
    await createTerminal()
    return
  }
  fitActiveTerminal()
})

watch(activeTerminalId, () => {
  fitActiveTerminal()
})

watch(runningTerminalCount, count => {
  emit('running-change', {
    hasRunning: count > 0,
    count,
    taskLabels: runningTaskLabels.value
  })
}, { immediate: true })

watch(runningTaskLabels, labels => {
  emit('running-change', {
    hasRunning: runningTerminalCount.value > 0,
    count: runningTerminalCount.value,
    taskLabels: labels
  })
})

watch(() => props.projectPath, async (nextPath, previousPath) => {
  if (!previousPath || nextPath === previousPath) return
  await resetTerminals()
  if (props.visible) {
    await createTerminal()
  }
})

onMounted(() => {
  removeTerminalDataListener = window.electronEvents.onTerminalData(handleTerminalData)
  removeTerminalExitListener = window.electronEvents.onTerminalExit(handleTerminalExit)
  removeTerminalStatusListener = window.electronEvents.onTerminalStatus(handleTerminalStatus)
  window.addEventListener('resize', fitActiveTerminal)
  window.addEventListener('mousemove', handleSidebarResize)
  window.addEventListener('mouseup', stopSidebarResize)

  loadTerminalAppearance().then(() => {
    applyTerminalAppearance()
    if (props.visible) {
      createTerminal()
    }
  })
})

onUnmounted(async () => {
  window.removeEventListener('resize', fitActiveTerminal)
  window.removeEventListener('mousemove', handleSidebarResize)
  window.removeEventListener('mouseup', stopSidebarResize)
  removeTerminalDataListener?.()
  removeTerminalExitListener?.()
  removeTerminalStatusListener?.()

  const terminalIds = terminals.value.map(item => item.id)
  for (const terminalId of terminalIds) {
    await removeTerminal(terminalId, true)
  }
})

defineExpose({
  prepareTaskLaunch() {
    suppressAutoCreateOnce.value = true
  },
  createTerminal,
  fitActiveTerminal,
  async runTaskTerminal(task) {
    return runTaskInTerminal(task)
  },
  async stopTaskTerminal(task) {
    return stopTaskTerminal(task)
  },
  async refreshAppearance() {
    await loadTerminalAppearance()
    applyTerminalAppearance()
  }
})
</script>

<template>
  <section v-show="visible" class="terminal-panel" :style="terminalSurfaceStyle">
    <div class="terminal-main">
      <div v-if="terminals.length === 0" class="terminal-empty">
        <div class="terminal-empty-title">终端面板</div>
        <button class="terminal-empty-btn" @click="createTerminal">新建终端</button>
      </div>

      <div v-else class="terminal-stage">
        <div
          v-for="terminal in terminals"
          :key="terminal.id"
          class="terminal-instance"
          :class="{ active: activeTerminalId === terminal.id }"
          v-show="activeTerminalId === terminal.id"
        >
          <div class="terminal-host">
            <div :ref="element => setTerminalHost(terminal.id, element)" class="terminal-shell"></div>
          </div>
          <div v-if="terminal.exited" class="terminal-overlay">终端已退出</div>
        </div>
      </div>
    </div>

    <div
      class="terminal-sidebar-resize"
      :class="{ dragging: isSidebarResizing }"
      @mousedown="startSidebarResize"
    ></div>

    <aside class="terminal-sidebar" :style="terminalSidebarStyle">
      <div class="terminal-sidebar-top">
        <button class="terminal-top-btn terminal-hide-btn" title="隐藏终端" @click="emit('hide')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        <button class="terminal-top-btn terminal-add-btn" title="新建终端" @click="createTerminal">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="12" y1="5" x2="12" y2="19"/>
            <line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>

      <div class="terminal-sidebar-list">
        <button
          v-for="(terminal, index) in terminals"
          :key="terminal.id"
          class="terminal-sidebar-btn terminal-tab-btn"
          :class="{ active: activeTerminalId === terminal.id }"
          :title="`${getTerminalDisplayTitle(terminal, index)} · ${getTerminalCommandLabel(terminal)}`"
          @click="handleActivateTerminal(terminal.id)"
        >
          <span class="terminal-tab-main">
            <span
              class="terminal-tab-index"
              :class="{ task: getTerminalKind(terminal) === TASK_TERMINAL_KIND }"
            >
              {{ getTerminalKind(terminal) === TASK_TERMINAL_KIND ? 'T' : index + 1 }}
            </span>
            <span class="terminal-tab-command">{{ getTerminalCommandLabel(terminal) }}</span>
          </span>
          <span
            v-if="getTerminalKind(terminal) === TASK_TERMINAL_KIND"
            class="terminal-task-badge"
            :title="terminal.taskLabel || '任务终端'"
          >
            任务
          </span>
          <span class="terminal-tab-close" title="关闭终端" @click="handleCloseTerminal($event, terminal.id)">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M3 6h18"/>
              <path d="M8 6V4h8v2"/>
              <path d="M19 6l-1 14H6L5 6"/>
              <path d="M10 11v6"/>
              <path d="M14 11v6"/>
            </svg>
          </span>
        </button>
      </div>
    </aside>
  </section>
</template>

<style scoped>
.terminal-panel {
  height: 100%;
  display: flex;
  min-height: 0;
  background: var(--terminal-theme-surface, transparent);
  border-top: 1px solid rgba(255, 255, 255, 0.05);
}

.terminal-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: transparent;
}

.terminal-stage,
.terminal-instance,
.terminal-host,
.terminal-shell {
  flex: 1;
  min-width: 0;
  min-height: 0;
}

.terminal-stage {
  position: relative;
  overflow: hidden;
  background: transparent;
}

.terminal-instance {
  position: absolute;
  inset: 0;
  overflow: hidden;
  background: transparent;
}

.terminal-host {
  display: flex;
  width: 100%;
  height: 100%;
  padding: 8px 0 8px 8px;
  box-sizing: border-box;
  overflow: hidden;
  background: transparent;
}

.terminal-shell {
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
  background: transparent;
}

.terminal-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(24, 24, 27, 0.72);
  color: #A1A1AA;
  font-size: 12px;
  pointer-events: none;
}

.terminal-sidebar {
  border-left: 1px solid rgba(255, 255, 255, 0.05);
  background: var(--terminal-theme-sidebar-background, #1E1E1E);
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-height: 0;
}

.terminal-sidebar-resize {
  width: 5px;
  flex: 0 0 5px;
  margin-left: -2px;
  margin-right: -3px;
  cursor: col-resize;
  background: transparent;
  transition: background 0.15s ease;
  position: relative;
  z-index: 2;
}

.terminal-sidebar-resize:hover,
.terminal-sidebar-resize.dragging {
  background: #F97316;
}

.terminal-sidebar-list {
  flex: 1;
  min-height: 0;
  background: var(--terminal-theme-sidebar-background, #1E1E1E);
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: #52525B transparent;
}

.terminal-sidebar-list::-webkit-scrollbar {
  width: 8px;
}

.terminal-sidebar-list::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 4px;
}

.terminal-sidebar-list::-webkit-scrollbar-thumb {
  background: #52525B;
  border-radius: 4px;
  border: 2px solid transparent;
}

.terminal-sidebar-list::-webkit-scrollbar-thumb:hover {
  background: #71717A;
}

.terminal-sidebar-btn {
  width: 100%;
  min-height: 30px;
  padding: 0;
  border: none;
  border-bottom: 1px solid #27272A;
  background: transparent;
  color: #A1A1AA;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0;
  cursor: pointer;
  position: relative;
  box-sizing: border-box;
  text-align: left;
}

.terminal-sidebar-btn:hover,
.terminal-sidebar-btn.active {
  background: rgba(255, 255, 255, 0.055);
  color: #F4F4F5;
}

.terminal-add-btn {
  min-height: 24px;
  height: 24px;
  padding: 0;
  align-items: center;
  justify-content: center;
  background: transparent;
}

.terminal-sidebar-top {
  display: flex;
  border-bottom: 1px solid #27272A;
}

.terminal-top-btn {
  height: 26px;
  border: none;
  background: transparent;
  color: #A1A1AA;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.terminal-hide-btn {
  width: 26px;
  flex-shrink: 0;
  border-right: 1px solid #27272A;
}

.terminal-sidebar-top .terminal-add-btn {
  flex: 1;
}

.terminal-top-btn:hover {
  background: rgba(255, 255, 255, 0.055);
  color: #F4F4F5;
}

.terminal-tab-main {
  min-width: 0;
  display: flex;
  align-items: baseline;
  gap: 4px;
  flex: 1;
  padding: 0;
  margin-left: 4px;
}

.terminal-tab-index {
  font-size: 11px;
  font-weight: 600;
  color: #A1A1AA;
  flex: 0 0 auto;
}

.terminal-tab-index.task {
  color: #F97316;
}

.terminal-tab-command {
  flex: 1;
  font-size: 11px;
  line-height: 1;
  font-weight: 600;
  color: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.terminal-task-badge {
  flex: 0 0 auto;
  margin-right: 2px;
  padding: 1px 5px;
  border: 1px solid rgba(249, 115, 22, 0.35);
  border-radius: 999px;
  color: #FDBA74;
  font-size: 9px;
  font-weight: 700;
  line-height: 1.2;
}

.terminal-tab-close {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  margin-right: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
  color: #71717A;
  opacity: 0;
  transition: opacity 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.terminal-tab-btn:hover .terminal-tab-close {
  opacity: 1;
}

.terminal-tab-close:hover {
  background: rgba(244, 244, 245, 0.08);
  color: #F4F4F5;
}

.terminal-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  color: #71717A;
}

.terminal-empty-title {
  font-size: 14px;
  color: #D4D4D8;
}

.terminal-empty-btn {
  padding: 8px 12px;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  background: #27272A;
  color: #E4E4E7;
  cursor: pointer;
}

.terminal-empty-btn:hover {
  background: #3F3F46;
}

.terminal-host :deep(.xterm) {
  height: 100%;
  width: 100%;
  box-sizing: border-box;
  background: transparent !important;
}

.terminal-host :deep(.xterm-screen),
.terminal-host :deep(.xterm-rows) {
  background: transparent !important;
}

.terminal-host :deep(.xterm-screen canvas),
.terminal-host :deep(.xterm-text-layer),
.terminal-host :deep(.xterm-selection-layer),
.terminal-host :deep(.xterm-link-layer),
.terminal-host :deep(.xterm-cursor-layer) {
  background: transparent !important;
}

.terminal-host :deep(.xterm-viewport) {
  overflow-y: scroll !important;
  overflow-x: hidden !important;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: #52525B transparent;
  box-sizing: border-box;
  background: transparent !important;
}

.terminal-host :deep(.xterm-viewport)::-webkit-scrollbar {
  width: 8px;
}

.terminal-host :deep(.xterm-viewport)::-webkit-scrollbar-track {
  background: transparent;
  border-radius: 4px;
}

.terminal-host :deep(.xterm-viewport)::-webkit-scrollbar-thumb {
  background: #52525B;
  border-radius: 4px;
  border: 2px solid transparent;
}

.terminal-host :deep(.xterm-viewport)::-webkit-scrollbar-thumb:hover {
  background: #71717A;
}
</style>
