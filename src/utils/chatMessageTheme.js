export const CHAT_MESSAGE_THEME_FIELDS = [
  'avatarMode',
  'statusStyle',
  'messageSurface',
  'messageSpacing'
]

export const CHAT_MESSAGE_THEME_DEFAULTS = {
  avatarMode: 'large',
  statusStyle: 'compact',
  messageSurface: 'bubble',
  messageSpacing: 'large'
}

export const CHAT_MESSAGE_THEME_PRESETS = {
  classic: {
    ...CHAT_MESSAGE_THEME_DEFAULTS
  },
  codex: {
    avatarMode: 'small',
    statusStyle: 'floating',
    messageSurface: 'ghost',
    messageSpacing: 'small'
  },
  compact: {
    avatarMode: 'small',
    statusStyle: 'compact',
    messageSurface: 'bubble',
    messageSpacing: 'medium'
  }
}

export const CHAT_MESSAGE_THEME_PRESET_OPTIONS = [
  { value: 'classic', label: '聊天模式' },
  { value: 'codex', label: '编程模式' }
]

export function getChatMessageThemePresetLabel(presetKey = 'classic') {
  return CHAT_MESSAGE_THEME_PRESET_OPTIONS.find(option => option.value === presetKey)?.label || '聊天模式'
}

function pickThemeFields(source = {}) {
  return CHAT_MESSAGE_THEME_FIELDS.reduce((acc, key) => {
    if (typeof source?.[key] === 'string' && source[key].trim()) {
      acc[key] = source[key]
    }
    return acc
  }, {})
}

function enforceThemeConstraints(theme = {}) {
  const nextTheme = { ...theme }

  // 简约模式下不允许大头像，避免出现不协调的“纯文本 + 大头像”组合。
  if (nextTheme.messageSurface === 'ghost' && nextTheme.avatarMode === 'large') {
    nextTheme.avatarMode = 'small'
  }

  return nextTheme
}

export function normalizeChatMessageTheme(theme = {}, fallbackPreset = 'classic') {
  const presetKey = CHAT_MESSAGE_THEME_PRESETS[fallbackPreset] ? fallbackPreset : 'classic'
  return enforceThemeConstraints({
    ...CHAT_MESSAGE_THEME_DEFAULTS,
    ...CHAT_MESSAGE_THEME_PRESETS[presetKey],
    ...pickThemeFields(theme)
  })
}

export function buildChatMessageThemeFromPreset(presetKey = 'classic') {
  return normalizeChatMessageTheme({}, presetKey)
}

export function resolveAppChatMessageTheme(appSettings = {}) {
  const presetKey = appSettings?.chatMessageThemePreset || 'classic'
  return {
    presetKey,
    theme: normalizeChatMessageTheme(appSettings?.chatMessageTheme || {}, presetKey)
  }
}

export function resolveProjectChatMessageTheme(appSettings = {}, projectSettings = {}) {
  const appResolved = resolveAppChatMessageTheme(appSettings)
  const mode = projectSettings?.chatMessageThemeMode || 'app'

  if (mode === 'preset') {
    const presetKey = projectSettings?.chatMessageThemePreset || appResolved.presetKey
    return {
      source: 'project',
      mode,
      presetKey,
      theme: buildChatMessageThemeFromPreset(presetKey)
    }
  }

  if (mode === 'custom') {
    const presetKey = projectSettings?.chatMessageThemePreset || appResolved.presetKey
    return {
      source: 'project',
      mode,
      presetKey,
      theme: normalizeChatMessageTheme(projectSettings?.chatMessageTheme || {}, presetKey)
    }
  }

  return {
    source: 'app',
    mode: 'app',
    presetKey: appResolved.presetKey,
    theme: appResolved.theme
  }
}

export function resolveSessionChatMessageTheme(appSettings = {}, projectSettings = {}, sessionSettings = {}) {
  const appResolved = resolveAppChatMessageTheme(appSettings)
  const projectResolved = resolveProjectChatMessageTheme(appSettings, projectSettings)
  const mode = sessionSettings?.chatMessageThemeMode || 'project'

  if (mode === 'app') {
    return {
      source: 'app',
      mode,
      presetKey: appResolved.presetKey,
      theme: appResolved.theme
    }
  }

  if (mode === 'preset') {
    const presetKey = sessionSettings?.chatMessageThemePreset || projectResolved.presetKey || appResolved.presetKey
    return {
      source: 'session',
      mode,
      presetKey,
      theme: buildChatMessageThemeFromPreset(presetKey)
    }
  }

  if (mode === 'custom') {
    const presetKey = sessionSettings?.chatMessageThemePreset || projectResolved.presetKey || appResolved.presetKey
    return {
      source: 'session',
      mode,
      presetKey,
      theme: normalizeChatMessageTheme(sessionSettings?.chatMessageTheme || {}, presetKey)
    }
  }

  return {
    source: projectResolved.source,
    mode: 'project',
    presetKey: projectResolved.presetKey,
    theme: projectResolved.theme
  }
}
