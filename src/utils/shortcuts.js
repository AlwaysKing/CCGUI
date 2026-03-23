const MAC_PLATFORM = /Mac|iPhone|iPad|iPod/i

export const SHORTCUT_ACTIONS = [
  {
    id: 'toggle-sidebar',
    action: 'toggle-sidebar',
    label: '切换侧边栏',
    description: '显示或隐藏左侧会话/文件侧边栏',
    defaultCombo: 'Mod+B',
    allowInEditable: false
  },
  {
    id: 'toggle-project-board',
    action: 'toggle-project-board',
    label: '切换项目看板',
    description: '显示或隐藏侧边栏中的项目看板',
    defaultCombo: 'Mod+Shift+E',
    allowInEditable: false
  },
  {
    id: 'toggle-preview',
    action: 'toggle-preview',
    label: '切换文件预览区',
    description: '显示或隐藏右侧文件预览面板',
    defaultCombo: 'Mod+\\',
    allowInEditable: false
  },
  {
    id: 'toggle-file-panel',
    action: 'toggle-file-panel',
    label: '切换文件列表',
    description: '显示或隐藏文件列表区域',
    defaultCombo: 'Mod+Shift+F',
    allowInEditable: false
  },
  {
    id: 'toggle-terminal',
    action: 'toggle-terminal',
    label: '切换终端',
    description: '显示或隐藏底部终端面板',
    defaultCombo: 'Ctrl+`',
    allowInEditable: false
  },
  {
    id: 'toggle-chat-panel',
    action: 'toggle-chat-panel',
    label: '切换消息区',
    description: '在分栏模式下折叠或展开消息区域',
    defaultCombo: 'Mod+Alt+M',
    allowInEditable: false
  },
  {
    id: 'toggle-all-message-collapse',
    action: 'toggle-all-message-collapse',
    label: '折叠或展开全部问答',
    description: '切换当前会话中所有可折叠问答的展开状态',
    defaultCombo: 'Mod+Alt+[',
    allowInEditable: false
  },
  {
    id: 'open-settings',
    action: 'open-settings',
    label: '打开设置',
    description: '打开应用设置面板',
    defaultCombo: 'Mod+,',
    allowInEditable: true,
    hidden: true
  },
  {
    id: 'create-primary',
    action: 'create-primary',
    label: '新建',
    description: '欢迎页新建项目，工作区新建会话',
    defaultCombo: 'Mod+N',
    allowInEditable: false,
    hidden: true
  }
]

const LEGACY_SHORTCUT_KEY_MAP = {
  toggleSidebar: 'toggle-sidebar',
  toggleProjectBoard: 'toggle-project-board',
  togglePreview: 'toggle-preview',
  toggleFilePanel: 'toggle-file-panel',
  toggleTerminal: 'toggle-terminal',
  toggleChatPanel: 'toggle-chat-panel',
  toggleAllMessageCollapse: 'toggle-all-message-collapse',
  openSettings: 'open-settings',
  createPrimary: 'create-primary'
}

const VALID_MODIFIER_PARTS = new Set(['Mod', 'Ctrl', 'Meta', 'Shift', 'Alt'])

export function getDefaultShortcutBindings() {
  return Object.fromEntries(
    SHORTCUT_ACTIONS.map(item => [item.action, item.defaultCombo])
  )
}

export function normalizeShortcutBindings(bindings = {}) {
  const normalized = {}

  for (const [key, value] of Object.entries(bindings || {})) {
    const mappedKey = LEGACY_SHORTCUT_KEY_MAP[key] || key
    normalized[mappedKey] = value
  }

  return normalized
}

export function getShortcutMetaByAction(action) {
  return SHORTCUT_ACTIONS.find(item => item.action === action) || null
}

export function isMacLikePlatform() {
  if (typeof navigator === 'undefined') {
    return false
  }

  return MAC_PLATFORM.test(navigator.platform || '') || MAC_PLATFORM.test(navigator.userAgent || '')
}

export function formatShortcutLabel(combo = '') {
  if (!combo) return '未设置'

  const isMac = isMacLikePlatform()
  return combo
    .split('+')
    .map(part => {
      if (part === 'Mod') return isMac ? '⌘' : 'Ctrl'
      if (part === 'Ctrl') return isMac ? '⌃' : 'Ctrl'
      if (part === 'Meta') return isMac ? '⌘' : 'Meta'
      if (part === 'Shift') return isMac ? '⇧' : 'Shift'
      if (part === 'Alt') return isMac ? '⌥' : 'Alt'
      if (part === ' ') return 'Space'
      return part.length === 1 ? part.toUpperCase() : part
    })
    .join(isMac ? '' : '+')
}

function normalizeKey(key = '') {
  if (!key) return ''
  if (key === ' ') return 'Space'
  if (key === ',') return ','
  if (key.length === 1) return key.toUpperCase()
  return key
}

export function normalizeShortcutCombo(combo = '') {
  const rawParts = String(combo || '')
    .split('+')
    .map(part => part.trim())
    .filter(Boolean)

  if (!rawParts.length) {
    return ''
  }

  const modifiers = []
  let key = ''

  for (const part of rawParts) {
    const canonical = part[0]?.toUpperCase() + part.slice(1)
    if (VALID_MODIFIER_PARTS.has(canonical)) {
      if (!modifiers.includes(canonical)) {
        modifiers.push(canonical)
      }
      continue
    }
    key = normalizeKey(part)
  }

  return [...modifiers, key].filter(Boolean).join('+')
}

export function eventToShortcutCombo(event) {
  const parts = []

  if (event.metaKey) parts.push('Meta')
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')

  const key = normalizeKey(event.key)
  if (!key || ['Meta', 'Control', 'Alt', 'Shift'].includes(key)) {
    return parts.join('+')
  }

  parts.push(key)
  return normalizeShortcutCombo(parts.join('+'))
}

function parseShortcutCombo(combo = '') {
  const parts = normalizeShortcutCombo(combo).split('+').filter(Boolean)
  return {
    mod: parts.includes('Mod'),
    ctrl: parts.includes('Ctrl'),
    meta: parts.includes('Meta'),
    shift: parts.includes('Shift'),
    alt: parts.includes('Alt'),
    key: parts.find(part => !VALID_MODIFIER_PARTS.has(part)) || ''
  }
}

export function matchesShortcut(event, combo) {
  if (!combo) return false

  const required = parseShortcutCombo(combo)
  const key = normalizeKey(event.key)

  if (required.mod) {
    if (!(event.metaKey || event.ctrlKey)) return false
  } else {
    if (required.ctrl !== Boolean(event.ctrlKey)) return false
    if (required.meta !== Boolean(event.metaKey)) return false
  }
  if (required.shift !== Boolean(event.shiftKey)) return false
  if (required.alt !== Boolean(event.altKey)) return false
  if (required.key !== key) return false

  return true
}

export function buildRuntimeShortcuts(bindings = {}) {
  const normalizedBindings = normalizeShortcutBindings(bindings)
  return SHORTCUT_ACTIONS.map(item => ({
    ...item,
    combo: normalizeShortcutCombo(normalizedBindings[item.action] || item.defaultCombo)
  })).filter(item => item.combo)
}

export function findMatchingShortcut(event, shortcuts = []) {
  return shortcuts.find(shortcut => matchesShortcut(event, shortcut.combo)) || null
}
