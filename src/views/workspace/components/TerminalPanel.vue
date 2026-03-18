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

const terminals = ref([])
const activeTerminalId = ref('')
const isCreatingTerminal = ref(false)
const terminalHosts = new Map()
const terminalInstances = new Map()
let removeTerminalDataListener = null
let removeTerminalExitListener = null
let removeTerminalStatusListener = null
const terminalWheelCleanup = new Map()
const terminalResizeCleanup = new Map()

const activeTerminal = computed(() => terminals.value.find(item => item.id === activeTerminalId.value) || null)

function getTerminalMeta(terminalId) {
  return terminals.value.find(item => item.id === terminalId) || null
}

function getTerminalLabel(index) {
  return `终端 ${index + 1}`
}

function getTerminalCommandLabel(terminal) {
  return terminal?.currentCommand || terminal?.shellLabel || 'shell'
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

async function createTerminal() {
  if (isCreatingTerminal.value) return
  isCreatingTerminal.value = true

  try {
    const { cols, rows } = estimateTerminalSize()
    const result = await window.electronAPI.createTerminal({
      cwd: props.projectPath,
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

function disposeTerminalInstance(terminalId) {
  const instance = terminalInstances.get(terminalId)
  if (!instance) return

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
      instance.fitAddon.fit()
      const dimensions = instance.terminal.cols && instance.terminal.rows
        ? { cols: instance.terminal.cols, rows: instance.terminal.rows }
        : estimateTerminalSize()
      window.electronAPI.resizeTerminal({
        terminalId,
        cols: dimensions.cols,
        rows: dimensions.rows
      })
    } catch (error) {
      console.error('[TerminalPanel] Failed to fit terminal:', error)
    }
  }

  let instance = terminalInstances.get(terminalId)
  if (!instance) {
    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: false,
      cursorBlink: true,
      cursorStyle: 'block',
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 12,
      lineHeight: 1.3,
      scrollback: 5000,
      theme: {
        background: '#111216',
        foreground: '#E4E4E7',
        cursor: '#F97316',
        cursorAccent: '#111216',
        selectionBackground: 'rgba(249, 115, 22, 0.28)',
        black: '#111216',
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
      }
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

    instance = { terminal, fitAddon }
    terminalInstances.set(terminalId, instance)

    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        applyTerminalFit(instance)
      })
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

  requestAnimationFrame(() => {
    applyTerminalFit(instance)
    requestAnimationFrame(() => applyTerminalFit(instance))
    setTimeout(() => applyTerminalFit(instance), 60)
  })

  if (shouldFocus && props.visible) {
    instance.terminal.focus()
  }
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
  if (terminals.value.length === 0) {
    await createTerminal()
    return
  }
  fitActiveTerminal()
})

watch(activeTerminalId, () => {
  fitActiveTerminal()
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

  if (props.visible) {
    createTerminal()
  }
})

onUnmounted(async () => {
  window.removeEventListener('resize', fitActiveTerminal)
  removeTerminalDataListener?.()
  removeTerminalExitListener?.()
  removeTerminalStatusListener?.()

  const terminalIds = terminals.value.map(item => item.id)
  for (const terminalId of terminalIds) {
    await removeTerminal(terminalId, true)
  }
})

defineExpose({
  createTerminal,
  fitActiveTerminal
})
</script>

<template>
  <section v-show="visible" class="terminal-panel">
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

    <aside class="terminal-sidebar">
      <button class="terminal-sidebar-btn terminal-add-btn" title="新建终端" @click="createTerminal">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </button>

      <div class="terminal-sidebar-list">
        <button
          v-for="(terminal, index) in terminals"
          :key="terminal.id"
          class="terminal-sidebar-btn terminal-tab-btn"
          :class="{ active: activeTerminalId === terminal.id }"
          :title="`${getTerminalLabel(index)} · ${getTerminalCommandLabel(terminal)}`"
          @click="handleActivateTerminal(terminal.id)"
        >
          <span class="terminal-tab-index">{{ index + 1 }}</span>
          <span class="terminal-tab-command">{{ getTerminalCommandLabel(terminal) }}</span>
          <span class="terminal-tab-close" title="关闭终端" @click="handleCloseTerminal($event, terminal.id)">×</span>
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
  background: #111216;
  border-top: 1px solid #2F3239;
}

.terminal-main {
  flex: 1;
  min-width: 0;
  min-height: 0;
  display: flex;
  flex-direction: column;
  background: #111216;
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
}

.terminal-instance {
  position: absolute;
  inset: 0;
  overflow: hidden;
}

.terminal-host {
  display: flex;
  width: 100%;
  height: 100%;
  padding: 8px 4px 8px 8px;
  box-sizing: border-box;
  overflow: hidden;
}

.terminal-shell {
  flex: 1;
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.terminal-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(17, 18, 22, 0.72);
  color: #A1A1AA;
  font-size: 12px;
  pointer-events: none;
}

.terminal-sidebar {
  width: 88px;
  flex: 0 0 88px;
  border-left: 1px solid #2F3239;
  background: #17191E;
  display: flex;
  flex-direction: column;
  align-items: stretch;
  min-height: 0;
}

.terminal-sidebar-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: #52525B #18181B;
}

.terminal-sidebar-list::-webkit-scrollbar {
  width: 8px;
}

.terminal-sidebar-list::-webkit-scrollbar-track {
  background: #18181B;
  border-radius: 4px;
}

.terminal-sidebar-list::-webkit-scrollbar-thumb {
  background: #52525B;
  border-radius: 4px;
  border: 2px solid #18181B;
}

.terminal-sidebar-list::-webkit-scrollbar-thumb:hover {
  background: #71717A;
}

.terminal-sidebar-btn {
  width: 100%;
  min-height: 52px;
  padding: 8px 10px;
  border: none;
  border-bottom: 1px solid #2F3239;
  background: transparent;
  color: #A1A1AA;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 3px;
  cursor: pointer;
  position: relative;
  box-sizing: border-box;
  text-align: left;
}

.terminal-sidebar-btn:hover,
.terminal-sidebar-btn.active {
  background: #23262D;
  color: #F4F4F5;
}

.terminal-add-btn {
  min-height: 44px;
  padding: 0;
  align-items: center;
  justify-content: center;
}

.terminal-tab-index {
  font-size: 11px;
  font-weight: 600;
  color: #A1A1AA;
}

.terminal-tab-command {
  width: 100%;
  font-size: 12px;
  line-height: 1.2;
  font-weight: 600;
  color: inherit;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.terminal-tab-close {
  position: absolute;
  top: 6px;
  right: 8px;
  font-size: 11px;
  color: #71717A;
  opacity: 0;
  transition: opacity 0.15s ease;
}

.terminal-tab-btn:hover .terminal-tab-close,
.terminal-tab-btn.active .terminal-tab-close {
  opacity: 1;
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
  background: #181A20;
  color: #E4E4E7;
  cursor: pointer;
}

.terminal-empty-btn:hover {
  background: #23262D;
}

.terminal-host :deep(.xterm) {
  height: 100%;
  width: 100%;
  box-sizing: border-box;
}

.terminal-host :deep(.xterm-viewport) {
  overflow-y: scroll !important;
  overflow-x: hidden !important;
  overscroll-behavior: contain;
  scrollbar-gutter: stable;
  scrollbar-width: thin;
  scrollbar-color: #52525B #18181B;
  box-sizing: border-box;
}

.terminal-host :deep(.xterm-viewport)::-webkit-scrollbar {
  width: 8px;
}

.terminal-host :deep(.xterm-viewport)::-webkit-scrollbar-track {
  background: #18181B;
  border-radius: 4px;
}

.terminal-host :deep(.xterm-viewport)::-webkit-scrollbar-thumb {
  background: #52525B;
  border-radius: 4px;
  border: 2px solid #18181B;
}

.terminal-host :deep(.xterm-viewport)::-webkit-scrollbar-thumb:hover {
  background: #71717A;
}
</style>
