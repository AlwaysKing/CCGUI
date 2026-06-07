<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import { IconButton, MarkdownRenderer } from '@/components/base'
import { toAttachmentUrl } from '@/utils/chatAttachments'
import { useDialogStack } from '../../composables/useDialogStack'
import { useSettingsData } from '@/views/settings/hooks/useSettingsData'
import BaseDialog from '@/components/base/BaseDialog.vue'
import AppSelect from '@/components/base/AppSelect.vue'
import AppMultiSelect from '@/components/base/AppMultiSelect.vue'
import ModelSettings from '@/views/settings/components/ModelSettings.vue'
import DefaultConfigDialog from '@/views/settings/components/dialogs/DefaultConfigDialog.vue'
import CodexConfigDialog from '@/views/settings/components/dialogs/CodexConfigDialog.vue'
import ModelMappingDialog from '@/views/settings/components/dialogs/ModelMappingDialog.vue'
import ModelEditDialog from '@/views/settings/components/dialogs/ModelEditDialog.vue'
import CodexAccountEditDialog from '@/views/settings/components/dialogs/CodexAccountEditDialog.vue'

const props = defineProps({
  provider: {
    type: String,
    default: 'claude'
  },
  projectPath: {
    type: String,
    default: ''
  }
})

const emit = defineEmits(['close', 'saved'])

const activeSection = ref('model')
const hookViewMode = ref('event')
const inspectorLoading = ref(false)
const inspectorLoaded = ref(false)
const inspectorError = ref('')
const pluginBusy = ref(false)
const pluginActionError = ref('')
const pluginActionMessage = ref('')
const hookActionError = ref('')
const hookActionMessage = ref('')
const hookActionBusy = ref(false)
const hookScopeToggleBusy = ref('')
const showMarketplaceDialog = ref(false)
const showPluginInstallDialog = ref(false)
const selectedMarketplace = ref(null)
const installingMarketplacePlugin = ref(null)
const codexMarketplaceInstallFilter = ref(['installed', 'uninstalled'])
const codexMarketplaceSearch = ref('')
const pluginActionScope = ref('all')
const selectedCodexPluginStates = ref(['enabled', 'disabled'])
const showPluginDetail = ref(false)
const selectedPlugin = ref(null)
const pluginDetailTab = ref('skills')
const showPluginSkillDetail = ref(false)
const viewingPluginSkill = ref(null)
const pluginSkillReadme = ref('')
const pluginSkillDetailTab = ref('content')
const pluginSkillLicense = ref(null)
const pluginSkillTree = ref([])
const isLoadingPluginSkillReadme = ref(false)
const showPluginAgentDetail = ref(false)
const viewingPluginAgent = ref(null)
const showHookEditor = ref(false)
const hookEditorMode = ref('create')
const editingHook = ref(null)
const showHookDeleteConfirm = ref(false)
const deletingHook = ref(null)
const showSubagentEditor = ref(false)
const subagentEditorMode = ref('create')
const editingSubagent = ref(null)
const showSubagentDeleteConfirm = ref(false)
const deletingSubagent = ref(null)
const hookForm = ref(createEmptyHookForm())
const marketplaceForm = ref(createEmptyMarketplaceForm())
const pluginInstallForm = ref(createEmptyPluginInstallForm())
const subagentForm = ref(createEmptySubagentForm())
const inspectorData = ref({
  hooks: [],
  subagents: [],
  plugins: [],
  marketplaces: [],
  configPaths: {}
})

const normalizedProvider = computed(() => props.provider === 'codex' ? 'codex' : 'claude')
const providerLabel = computed(() => normalizedProvider.value === 'codex' ? 'Codex' : 'Claude')

function resolvePluginLogoSrc(logoPath = '') {
  return toAttachmentUrl(logoPath)
}

const sections = computed(() => [
  { id: 'model', label: '模型', icon: 'model' },
  { id: 'hooks', label: 'Hooks', icon: 'hooks' },
  { id: 'plugins', label: '插件', icon: 'plugins' },
  ...(normalizedProvider.value === 'claude'
    ? [
        { id: 'subagents', label: 'SubAgent', icon: 'agent' },
        { id: 'marketplace-spacer', spacer: true },
        { id: 'marketplace', label: '插件市场', icon: 'marketplace', bottom: true }
      ]
    : [
        { id: 'marketplace-spacer', spacer: true },
        { id: 'marketplace', label: '插件市场', icon: 'marketplace', bottom: true }
      ])
])

const hookFeatureState = computed(() => ({
  user: inspectorData.value?.hookFeatureState?.user === true,
  project: inspectorData.value?.hookFeatureState?.project === true
}))
const hookLocationOptions = computed(() => normalizedProvider.value === 'codex'
  ? [
      { value: 'user', label: '用户' },
      ...(props.projectPath ? [{ value: 'project', label: '项目' }] : [])
    ]
  : [
      { value: 'user', label: '用户' },
      ...(props.projectPath ? [{ value: 'project', label: '项目' }, { value: 'local', label: '本地' }] : [])
    ])
const hookModeOptions = computed(() => [
  { value: 'config', label: '配置' },
  { value: 'plugin', label: '插件' }
])
const selectedHookLocations = ref(hookLocationOptions.value.map(option => option.value))
const selectedHookModes = ref(hookModeOptions.value.map(option => option.value))
const disableAllHooksState = computed(() => {
  const state = inspectorData.value?.disableAllHooks
  return {
    user: state?.user === true,
    project: state?.project === true,
    local: state?.local === true
  }
})
const hookDisableScopeOptions = computed(() => {
  const options = [{ value: 'user', label: '用户' }]
  if (props.projectPath) {
    options.push({ value: 'project', label: '项目' })
    if (normalizedProvider.value !== 'codex') {
      options.push({ value: 'local', label: '本地' })
    }
  }
  return options
})
const pluginScopeOptions = computed(() => normalizedProvider.value === 'codex'
  ? [
      { value: 'enabled', label: '已启用' },
      { value: 'disabled', label: '已禁用' }
    ]
  : [
      { value: 'all', label: '全部' },
      { value: 'user', label: '用户' },
      ...(props.projectPath ? [{ value: 'project', label: '项目' }] : [])
    ])
const pluginInstallScopeOptions = computed(() => (
  props.projectPath
    ? [
        { value: 'user', label: '用户' },
        { value: 'project', label: '项目' }
      ]
    : [{ value: 'user', label: '用户' }]
))
const subagentSourceOptions = computed(() => [
  { value: 'user', label: '用户' },
  ...(props.projectPath ? [{ value: 'project', label: '项目' }] : []),
  { value: 'plugin', label: '插件' }
])
const selectedSubagentSources = ref(subagentSourceOptions.value.map(option => option.value))
const hooks = computed(() => Array.isArray(inspectorData.value?.hooks) ? inspectorData.value.hooks : [])
const filteredHooks = computed(() => {
  const locations = selectedHookLocations.value
  const modes = selectedHookModes.value
  return hooks.value.filter((hook) => {
    const locationMatch = locations.includes(getHookLocationKey(hook))
    const modeMatch = modes.includes(getHookModeKey(hook))
    return locationMatch && modeMatch
  })
})
const plugins = computed(() => Array.isArray(inspectorData.value?.plugins) ? inspectorData.value.plugins : [])
const filteredPlugins = computed(() => {
  const sourcePlugins = normalizedProvider.value === 'codex'
    ? plugins.value.filter(plugin => ['user', 'project'].includes(plugin.scope || ''))
    : plugins.value
  if (normalizedProvider.value === 'codex') {
    const states = Array.isArray(selectedCodexPluginStates.value) ? selectedCodexPluginStates.value : []
    const allowEnabled = states.length === 0 || states.includes('enabled')
    const allowDisabled = states.length === 0 || states.includes('disabled')
    return sourcePlugins.filter((plugin) => {
      return plugin.enabled === false ? allowDisabled : allowEnabled
    })
  }
  const scope = pluginActionScope.value
  if (!scope || scope === 'all') return sourcePlugins
  return sourcePlugins.filter(plugin => (plugin.scope || '') === scope)
})

function toggleCodexPluginStateFilter(value = '') {
  if (!value) return
  const current = Array.isArray(selectedCodexPluginStates.value) ? selectedCodexPluginStates.value : []
  selectedCodexPluginStates.value = current.includes(value)
    ? current.filter(item => item !== value)
    : [...current, value]
}
const subagents = computed(() => {
  const scoped = Array.isArray(inspectorData.value?.subagents) ? inspectorData.value.subagents : []
  const pluginItems = []
  for (const plugin of plugins.value) {
    const pluginAgents = pluginDetailItems(plugin, 'agents')
    for (const agent of pluginAgents) {
      pluginItems.push({
        ...agent,
        scope: 'plugin',
        source: 'plugin',
        sourceLabel: '插件',
        pluginDisplayName: plugin.displayName || plugin.name || plugin.id || '',
        editable: false
      })
    }
  }
  return [...scoped, ...pluginItems]
})
const filteredSubagents = computed(() => subagents.value.filter(agent => selectedSubagentSources.value.includes(agent.scope || 'user')))
const marketplaces = computed(() => Array.isArray(inspectorData.value?.marketplaces) ? inspectorData.value.marketplaces : [])
const filteredMarketplaces = computed(() => marketplaces.value.filter(marketplace => {
  if (!props.projectPath) {
    return getMarketplaceScope(marketplace) === 'user'
  }
  return ['user', 'project'].includes(getMarketplaceScope(marketplace))
}))
const filteredCodexMarketplacePlugins = computed(() => {
  const plugins = Array.isArray(selectedMarketplace.value?.plugins) ? selectedMarketplace.value.plugins : []
  const installFilter = Array.isArray(codexMarketplaceInstallFilter.value)
    ? codexMarketplaceInstallFilter.value
    : []
  const keyword = String(codexMarketplaceSearch.value || '').trim().toLowerCase()

  return plugins.filter((plugin) => {
    const state = codexMarketplacePluginState(plugin)
    const allowInstalled = installFilter.length === 0 || installFilter.includes('installed')
    const allowUninstalled = installFilter.length === 0 || installFilter.includes('uninstalled')
    const installMatch = state.installed ? allowInstalled : allowUninstalled

    if (!installMatch) return false
    if (!keyword) return true

    const haystack = [
      plugin.displayName,
      plugin.name,
      plugin.description,
      plugin.developerName,
      plugin.category
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()

    return haystack.includes(keyword)
  })
})
const marketplacePluginCount = computed(() => filteredMarketplaces.value.reduce((total, marketplace) => {
  const items = Array.isArray(marketplace?.plugins) ? marketplace.plugins.length : 0
  return total + items
}, 0))

const {
  defaultConfig,
  codexConfig,
  claudeModels,
  codexModels,
  selectedClaudeModelId,
  selectedCodexModelId,
  showModelDialog,
  editingModel,
  editingModelType,
  showDefaultConfigDialog,
  showCodexConfigDialog,
  showCodexAccountDialog,
  showMappingDialog,
  editingCodexAccount,
  pendingModel,
  effortOptions,
  loadSettings,
  handleAddClaudeModel,
  handleEditClaudeModel,
  handleDeleteClaudeModel,
  handleAddCodexModel,
  handleEditCodexModel,
  handleDeleteCodexModel,
  handleSaveModel,
  handleSelectClaudeModel,
  handleSelectCodexModel,
  handleSetClaudeModelDefaultCredential,
  handleSetCodexModelDefaultCredential,
  handleSetClaudeModelDefaultCard,
  handleSetCodexModelDefaultCard,
  handleToggleClaudeModelActive,
  handleToggleCodexModelActive,
  handleApplyClaudeModel,
  handleApplyCodexModel,
  handleMappingConfirm,
  handleEditDefaultConfig,
  handleSaveDefaultConfig,
  handleEditCodexConfig,
  handleSaveCodexConfig,
  handleSaveCodexProxy,
  handleAddCodexAccount,
  handleEditCodexAccount,
  handleSaveCodexAccount,
  handleDeleteCodexAccount,
  handleApplyCodexAccount,
  handleRefreshCodexAccountUsage
} = useSettingsData(emit)

function handleClose() {
  emit('close')
}

useDialogStack(computed(() => true), handleClose)

function normalizeHookScope(scope = '') {
  const map = {
    user: '用户',
    project: '项目',
    local: '本地',
    catalog: '市场',
    plugin: '插件'
  }
  return map[scope] || scope || '未知'
}

function createEmptyHookForm() {
  const isCodexProvider = props.provider === 'codex'
  return {
    scope: isCodexProvider
      ? (props.projectPath ? 'project' : 'user')
      : (props.projectPath ? 'local' : 'user'),
    eventName: 'SessionStart',
    matcherValues: ['startup'],
    type: 'command',
    content: '',
    async: false,
    timeout: ''
  }
}

function createEmptyMarketplaceForm() {
  return {
    source: '',
    scope: props.projectPath ? 'project' : 'user'
  }
}

function createEmptyPluginInstallForm() {
  return {
    scope: props.projectPath ? 'project' : 'user'
  }
}

function createEmptySubagentForm() {
  return {
    scope: props.projectPath ? 'project' : 'user',
    name: '',
    description: '',
    model: '',
    toolsText: '',
    prompt: ''
  }
}

const hookEventOptions = [
  { value: 'SessionStart', label: 'SessionStart' },
  { value: 'SessionEnd', label: 'SessionEnd' },
  { value: 'UserPromptSubmit', label: 'UserPromptSubmit' },
  { value: 'PreToolUse', label: 'PreToolUse' },
  { value: 'PostToolUse', label: 'PostToolUse' },
  { value: 'Stop', label: 'Stop' },
  { value: 'SubagentStop', label: 'SubagentStop' },
  { value: 'Notification', label: 'Notification' },
  { value: 'StopFailure', label: 'StopFailure' },
  { value: 'PreCompact', label: 'PreCompact' }
]

const hookTypeOptions = [
  { value: 'command', label: '命令' },
  { value: 'http', label: 'HTTP' },
  { value: 'prompt', label: 'Prompt' },
  { value: 'agent', label: 'Agent' }
]

const matcherOptionsByEvent = {
  SessionStart: ['startup', 'clear', 'compact'],
  SessionEnd: [],
  UserPromptSubmit: [],
  PreToolUse: ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS', 'Bash', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite', 'NotebookRead', 'NotebookEdit'],
  PostToolUse: ['Read', 'Write', 'Edit', 'MultiEdit', 'Glob', 'Grep', 'LS', 'Bash', 'WebFetch', 'WebSearch', 'Task', 'TodoWrite', 'NotebookRead', 'NotebookEdit'],
  Stop: [],
  SubagentStop: [],
  Notification: [],
  StopFailure: [],
  PreCompact: []
}

function getHookLocationKey(hook = {}) {
  if ((hook?.scope || '') !== 'plugin') return hook?.scope || 'user'
  if (hook?.pluginScope === 'project') return 'project'
  if (hook?.pluginScope === 'local') return 'local'
  return 'user'
}

function getHookModeKey(hook = {}) {
  return hook?.scope === 'plugin' ? 'plugin' : 'config'
}

function toggleHookLocation(value = '') {
  if (!value) return
  const current = selectedHookLocations.value
  if (current.includes(value)) {
    if (current.length === 1) return
    selectedHookLocations.value = current.filter(item => item !== value)
    return
  }
  selectedHookLocations.value = [...current, value]
}

function toggleHookMode(value = '') {
  if (!value) return
  const current = selectedHookModes.value
  if (current.includes(value)) {
    if (current.length === 1) return
    selectedHookModes.value = current.filter(item => item !== value)
    return
  }
  selectedHookModes.value = [...current, value]
}

function getHookScopeLabel(hook = {}) {
  if ((hook?.scope || '') !== 'plugin') return normalizeHookScope(hook?.scope || '')
  if (hook?.pluginScope === 'user') return '用户插件'
  if (hook?.pluginScope === 'project') return '项目插件'
  return '插件'
}

function getHookLocationLabel(hook = {}) {
  return normalizeHookScope(getHookLocationKey(hook))
}

function getHookModeLabel(hook = {}) {
  return getHookModeKey(hook) === 'plugin' ? '插件' : '配置'
}

function isHookEditable(hook = {}) {
  if (normalizedProvider.value === 'codex') {
    return ['user', 'project'].includes(hook?.scope || '')
  }
  return ['user', 'project', 'local'].includes(hook?.scope || '')
}

function isPluginDisabled(plugin = {}) {
  return plugin?.enabled === false
}

function isSubagentEditable(agent = {}) {
  return ['user', 'project'].includes(agent?.scope || '')
}

function toggleSubagentSource(value = '') {
  if (!value) return
  const current = selectedSubagentSources.value
  if (current.includes(value)) {
    if (current.length === 1) return
    selectedSubagentSources.value = current.filter(item => item !== value)
    return
  }
  selectedSubagentSources.value = [...current, value]
}

function isHookDisabled(hook = {}) {
  return hook?.hooksDisabled === true || (hook?.scope === 'plugin' && hook?.pluginEnabled === false)
}

const hookEditableScopeOptions = computed(() => {
  const options = [{ value: 'user', label: '用户' }]
  if (props.projectPath) {
    options.push({ value: 'project', label: '项目' })
    if (normalizedProvider.value !== 'codex') {
      options.push({ value: 'local', label: '本地' })
    }
  }
  return options
})

const currentMatcherOptions = computed(() => {
  const eventName = hookForm.value?.eventName || 'SessionStart'
  const presetValues = matcherOptionsByEvent[eventName] || []
  const existingValues = Array.isArray(hookForm.value?.matcherValues) ? hookForm.value.matcherValues : []
  const merged = Array.from(new Set([...presetValues, ...existingValues].filter(Boolean)))
  return merged.map(value => ({ value, label: value }))
})

function normalizeHookType(type = '') {
  const map = {
    command: '命令',
    http: 'HTTP',
    prompt: '提示词',
    agent: '代理'
  }
  return map[type] || type || '未知'
}

function hookSourceStatus(source = {}) {
  if (!source.exists) return '未发现'
  if (source.hookCount > 0) return `已解析 ${source.hookCount} 条`
  if (source.hasHooksField) return '已解析 0 条'
  return '未发现 Hook 配置'
}

function getHookOwnerLabel(hook = {}) {
  if (hook.pluginName) return hook.pluginName
  return hook.sourceLabel || normalizeHookScope(hook.scope)
}

const hooksByEvent = computed(() => {
  const groups = new Map()
  for (const hook of filteredHooks.value) {
    const eventName = hook?.eventName || 'unknown'
    if (!groups.has(eventName)) {
      groups.set(eventName, {
        id: eventName,
        title: eventName,
        items: []
      })
    }
    groups.get(eventName).items.push({
      ...hook,
      ownerLabel: getHookOwnerLabel(hook)
    })
  }

  return Array.from(groups.values())
    .filter(group => group.items.length > 0)
    .map(group => {
      const ruleGroups = new Map()
      for (const hook of group.items) {
        const ruleId = `${hook.groupIndex ?? 0}:${hook.matcher || ''}:${hook.ownerLabel || ''}:${hook.sourcePath || ''}`
        if (!ruleGroups.has(ruleId)) {
          ruleGroups.set(ruleId, {
            id: ruleId,
            matcher: hook.matcher || '',
            ownerLabel: hook.ownerLabel,
            sourcePath: hook.sourcePath || '',
            scope: hook.scope || '',
            items: []
          })
        }
        ruleGroups.get(ruleId).items.push(hook)
      }

      return {
        ...group,
        ruleGroups: Array.from(ruleGroups.values())
      }
    })
    .sort((a, b) => a.title.localeCompare(b.title))
})

const hooksByOwner = computed(() => {
  const groups = new Map()
  for (const hook of filteredHooks.value) {
    const ownerLabel = getHookOwnerLabel(hook)
    const ownerKey = [
      hook.pluginName ? 'plugin' : (hook.scope || 'scope'),
      ownerLabel,
      hook.sourcePath || ''
    ].join(':')

    if (!groups.has(ownerKey)) {
      groups.set(ownerKey, {
        id: ownerKey,
        title: ownerLabel,
        scope: hook.scope || '',
        sourcePath: hook.sourcePath || '',
        items: []
      })
    }

    groups.get(ownerKey).items.push(hook)
  }

  return Array.from(groups.values())
    .filter(group => group.items.length > 0)
    .map(group => {
      const eventGroups = new Map()
      for (const hook of group.items) {
        const eventKey = `${hook.eventName || 'unknown'}:${hook.groupIndex ?? 0}:${hook.matcher || ''}`
        if (!eventGroups.has(eventKey)) {
          eventGroups.set(eventKey, {
            id: eventKey,
            eventName: hook.eventName || 'unknown',
            matcher: hook.matcher || '',
            items: []
          })
        }
        eventGroups.get(eventKey).items.push(hook)
      }

      return {
        ...group,
        eventGroups: Array.from(eventGroups.values())
      }
    })
    .sort((a, b) => a.title.localeCompare(b.title))
})

function pluginSummary(plugin = {}) {
  const counts = plugin.counts || {}
  const parts = []
  if (counts.skills) parts.push(`skills ${counts.skills}`)
  if (counts.hooks) parts.push(`hooks ${counts.hooks}`)
  if (counts.mcp) parts.push(`mcp ${counts.mcp}`)
  if (counts.apps) parts.push(`apps ${counts.apps}`)
  if (counts.agents) parts.push(`agents ${counts.agents}`)
  if (counts.lsp) parts.push(`lsp ${counts.lsp}`)
  if (counts.monitors) parts.push(`monitors ${counts.monitors}`)
  return parts.length > 0 ? parts.join(' · ') : '暂无可识别能力'
}

function formatMarketplaceSource(marketplace = {}) {
  if (marketplace.repo) return marketplace.repo
  if (marketplace.url) return marketplace.url
  if (marketplace.sourceType) return marketplace.sourceType
  return '未知来源'
}

function getMarketplaceScope(marketplace = {}) {
  const installLocation = String(marketplace?.installLocation || '')
  if (props.projectPath && installLocation.startsWith(props.projectPath)) {
    return 'project'
  }
  return 'user'
}

function getMarketplaceDefaultScope() {
  return props.projectPath ? 'project' : 'user'
}

function normalizeSubagentScope(scope = '') {
  const map = {
    user: '用户',
    project: '项目'
  }
  return map[scope] || scope || '未知'
}

function openMarketplaceDetail(marketplace = {}) {
  selectedMarketplace.value = marketplace
}

function closeMarketplaceDetail() {
  selectedMarketplace.value = null
  codexMarketplaceInstallFilter.value = ['installed', 'uninstalled']
  codexMarketplaceSearch.value = ''
}

function toggleCodexMarketplaceInstallFilter(value = '') {
  if (!value) return
  const current = Array.isArray(codexMarketplaceInstallFilter.value)
    ? [...codexMarketplaceInstallFilter.value]
    : []
  const index = current.indexOf(value)
  if (index >= 0) {
    current.splice(index, 1)
  } else {
    current.push(value)
  }
  codexMarketplaceInstallFilter.value = current
}

function codexMarketplacePluginState(plugin = {}) {
  return {
    installed: plugin?.configured === true || plugin?.installed === true,
    enabled: plugin?.enabled === true,
    scope: plugin?.installedScope || plugin?.scope || ''
  }
}

function openCreateSubagentDialog() {
  pluginActionError.value = ''
  pluginActionMessage.value = ''
  subagentEditorMode.value = 'create'
  editingSubagent.value = null
  subagentForm.value = createEmptySubagentForm()
  showSubagentEditor.value = true
}

function openEditSubagentDialog(agent = {}) {
  pluginActionError.value = ''
  pluginActionMessage.value = ''
  subagentEditorMode.value = 'update'
  editingSubagent.value = agent
  subagentForm.value = {
    scope: agent.scope || (props.projectPath ? 'project' : 'user'),
    name: agent.title || agent.name || '',
    description: agent.description || '',
    model: agent.model || '',
    toolsText: Array.isArray(agent.tools) ? agent.tools.join(', ') : '',
    prompt: agent.content || ''
  }
  showSubagentEditor.value = true
}

function closeSubagentEditor() {
  showSubagentEditor.value = false
  editingSubagent.value = null
  pluginActionError.value = ''
}

function openDeleteSubagentDialog(agent = {}) {
  pluginActionError.value = ''
  pluginActionMessage.value = ''
  deletingSubagent.value = agent
  showSubagentDeleteConfirm.value = true
}

function closeSubagentDeleteDialog() {
  showSubagentDeleteConfirm.value = false
  deletingSubagent.value = null
  pluginActionError.value = ''
}

function formatPluginSource(plugin = {}) {
  const source = plugin.source && typeof plugin.source === 'object' ? plugin.source : {}
  if (source.repo) return source.repo
  if (source.url) return source.url
  if (source.source) return source.source
  return ''
}

function getHookContentLabel(hook = {}) {
  const type = hook?.type || ''
  if (type === 'command') return '命令'
  if (type === 'http') return 'URL'
  if (type === 'prompt') return 'Prompt'
  if (type === 'agent') return 'Agent'
  return '内容'
}

function pluginDetailItems(plugin = {}, key = '') {
  const details = plugin?.details && typeof plugin.details === 'object' ? plugin.details : {}
  const items = Array.isArray(details[key]) ? details[key] : []
  return items
}

function codexPluginIncludedSections(plugin = {}) {
  return [
    {
      key: 'skills',
      label: '技能',
      items: pluginDetailItems(plugin, 'skills')
    },
    {
      key: 'mcp',
      label: 'MCP',
      items: pluginDetailItems(plugin, 'mcp')
    }
  ].filter(section => section.items.length > 0)
}

function codexPluginInfoRows(plugin = {}) {
  return [
    {
      key: 'capabilities',
      label: '功能',
      value: Array.isArray(plugin?.capabilities) ? plugin.capabilities.filter(Boolean).join(', ') : ''
    },
    {
      key: 'category',
      label: '类别',
      value: plugin?.category || ''
    },
    {
      key: 'developer',
      label: '开发者',
      value: plugin?.developerName || ''
    }
  ].filter(row => String(row.value || '').trim())
}

function pluginDetailTabs(plugin = {}) {
  const tabs = [
    { key: 'skills', label: '技能', count: pluginDetailItems(plugin, 'skills').length },
    { key: 'apps', label: '应用', count: pluginDetailItems(plugin, 'apps').length },
    { key: 'hooks', label: 'Hooks', count: pluginDetailItems(plugin, 'hooks').length },
    { key: 'mcp', label: 'MCP', count: pluginDetailItems(plugin, 'mcp').length },
    { key: 'agents', label: 'Agents', count: pluginDetailItems(plugin, 'agents').length }
  ].filter(tab => tab.count > 0)

  return tabs.length > 0 ? tabs : [{ key: 'skills', label: '技能', count: 0 }]
}

function openPluginDetail(plugin = {}) {
  selectedPlugin.value = plugin
  pluginDetailTab.value = pluginDetailTabs(plugin)[0]?.key || 'skills'
  showPluginDetail.value = true
}

function closePluginDetail() {
  showPluginDetail.value = false
  selectedPlugin.value = null
}

function syncSelectedPlugin(data = null) {
  if (!selectedPlugin.value) return

  const selectedId = selectedPlugin.value.id || ''
  const selectedPluginId = selectedPlugin.value.pluginId || selectedPlugin.value.pluginRef || selectedPlugin.value.name || ''

  const providerPlugins = Array.isArray(data?.plugins) ? data.plugins : []
  const marketplacePlugins = Array.isArray(data?.marketplaces)
    ? data.marketplaces.flatMap(item => Array.isArray(item?.plugins) ? item.plugins : [])
    : []

  const matched = [...providerPlugins, ...marketplacePlugins].find((plugin) => {
    const pluginId = plugin?.pluginId || plugin?.pluginRef || plugin?.name || ''
    return (selectedId && plugin?.id === selectedId) || (selectedPluginId && pluginId === selectedPluginId)
  })

  if (matched) {
    selectedPlugin.value = matched
  }
}

async function openPluginSkillDetail(skill = {}) {
  viewingPluginSkill.value = skill
  pluginSkillDetailTab.value = 'content'
  isLoadingPluginSkillReadme.value = true
  pluginSkillReadme.value = ''
  pluginSkillLicense.value = null
  pluginSkillTree.value = []
  showPluginSkillDetail.value = true

  try {
    const [readmeResult, extraResult] = await Promise.all([
      window.electronAPI.readSkillReadme({ skillPath: skill.path }),
      window.electronAPI.readSkillExtra({ skillPath: skill.path })
    ])
    if (readmeResult?.success) {
      pluginSkillReadme.value = String(readmeResult.content || '').replace(/^---\n[\s\S]*?\n---\n?/, '')
    }
    if (extraResult?.success) {
      pluginSkillLicense.value = extraResult.license || null
      pluginSkillTree.value = extraResult.tree || []
    }
  } catch (_) {
    // ignore
  } finally {
    isLoadingPluginSkillReadme.value = false
  }
}

function closePluginSkillDetail() {
  showPluginSkillDetail.value = false
  viewingPluginSkill.value = null
  pluginSkillReadme.value = ''
  pluginSkillLicense.value = null
  pluginSkillTree.value = []
}

function openPluginAgentDetail(agent = {}) {
  viewingPluginAgent.value = agent
  showPluginAgentDetail.value = true
}

function closePluginAgentDetail() {
  showPluginAgentDetail.value = false
  viewingPluginAgent.value = null
}

async function openSubagentInFinder(agent = {}) {
  const targetPath = String(agent?.path || '').trim()
  if (!targetPath) return
  try {
    await window.electronAPI.openPathInFinder({
      targetPath,
      mode: 'reveal'
    })
  } catch (_) {
    // ignore
  }
}

const flattenedPluginSkillTree = computed(() => {
  const result = []
  function walk(items, depth = 0) {
    for (const item of items || []) {
      result.push({ name: item.name, type: item.type, depth })
      if (item.children) walk(item.children, depth + 1)
    }
  }
  walk(pluginSkillTree.value)
  return result
})

async function refreshInspector() {
  inspectorLoading.value = true
  inspectorError.value = ''
  hookActionError.value = ''
  try {
    const result = await window.electronAPI.inspectProviderSetup({
      provider: normalizedProvider.value,
      projectPath: props.projectPath || ''
    })
    if (!result?.success) {
      throw new Error(result?.error || '读取面板数据失败')
    }
    inspectorData.value = result.data || { hooks: [], plugins: [], marketplaces: [], configPaths: {} }
    inspectorLoaded.value = true
  } catch (error) {
    inspectorError.value = error.message || '读取面板数据失败'
  } finally {
    inspectorLoading.value = false
  }
}

// 需要 inspector 数据的 tab 集合
const INSPECTOR_TABS = new Set(['hooks', 'plugins', 'subagents', 'marketplace'])

// 按需加载 inspector 数据：仅在切换到需要它的 tab 且尚未加载过时触发
async function ensureInspectorLoaded() {
  if (inspectorLoaded.value || inspectorLoading.value) return
  await refreshInspector()
}

async function refreshAll() {
  await Promise.allSettled([
    loadSettings(),
    refreshInspector()
  ])
}

async function handleSaveProviderModel(payload) {
  await handleSaveModel(payload)
  await refreshAll()
}

async function handleSaveProviderConfig(payload) {
  if (normalizedProvider.value === 'codex') {
    await handleSaveCodexConfig(payload)
  } else {
    await handleSaveDefaultConfig(payload)
  }
  await refreshAll()
}

async function handleSaveProviderAccount(payload) {
  await handleSaveCodexAccount(payload)
  await refreshAll()
}

async function handleApplyProviderAccount(account) {
  await handleApplyCodexAccount(account)
  await refreshAll()
}

async function handleDeleteProviderAccount(accountId) {
  await handleDeleteCodexAccount(accountId)
  await refreshAll()
}

async function handleClaudePluginAction(action, payload = {}) {
  pluginBusy.value = true
  pluginActionError.value = ''
  pluginActionMessage.value = ''

  try {
    const result = await window.electronAPI.manageClaudePlugin({
      action,
      projectPath: props.projectPath || '',
      scope: payload.scope || getMarketplaceDefaultScope(),
      pluginId: payload.pluginId || '',
      marketplaceName: payload.marketplaceName || '',
      source: payload.source || ''
    })

    if (!result?.success) {
      throw new Error(result?.error || '插件操作失败')
    }

    inspectorData.value = result.data || inspectorData.value
    if (selectedMarketplace.value?.id) {
      const nextMarketplace = (result.data?.marketplaces || inspectorData.value?.marketplaces || [])
        .find(item => item?.id === selectedMarketplace.value.id)
      selectedMarketplace.value = nextMarketplace || null
    }
    syncSelectedPlugin(result.data || inspectorData.value)
    pluginActionMessage.value = payload.successMessage || '操作已完成'

    if (action === 'addMarketplace') {
      marketplaceForm.value = createEmptyMarketplaceForm()
      showMarketplaceDialog.value = false
      activeSection.value = 'marketplace'
    }
  } catch (error) {
    pluginActionError.value = error.message || '插件操作失败'
  } finally {
    pluginBusy.value = false
  }
}

async function handleCodexPluginAction(action, payload = {}) {
  pluginBusy.value = true
  pluginActionError.value = ''
  pluginActionMessage.value = ''

  try {
    const result = await window.electronAPI.manageCodexPlugin({
      action,
      projectPath: props.projectPath || '',
      scope: payload.scope || 'user',
      pluginId: payload.pluginId || '',
      pluginName: payload.pluginName || '',
      marketplacePath: payload.marketplacePath || ''
    })

    if (!result?.success) {
      throw new Error(result?.error || '插件操作失败')
    }

    inspectorData.value = result.data || inspectorData.value
    if (selectedMarketplace.value?.id) {
      const nextMarketplace = (result.data?.marketplaces || inspectorData.value?.marketplaces || [])
        .find(item => item?.id === selectedMarketplace.value.id)
      selectedMarketplace.value = nextMarketplace || null
    }
    syncSelectedPlugin(result.data || inspectorData.value)
    pluginActionMessage.value = payload.successMessage || '操作已完成'
  } catch (error) {
    pluginActionError.value = error.message || '插件操作失败'
  } finally {
    pluginBusy.value = false
  }
}

function openMarketplaceDialog() {
  pluginActionError.value = ''
  pluginActionMessage.value = ''
  marketplaceForm.value = createEmptyMarketplaceForm()
  showMarketplaceDialog.value = true
}

function closeMarketplaceDialog() {
  showMarketplaceDialog.value = false
  marketplaceForm.value = createEmptyMarketplaceForm()
  pluginActionError.value = ''
}

function openPluginInstallDialog(plugin = {}) {
  if (!props.projectPath) {
    if (normalizedProvider.value === 'codex') {
      handleCodexPluginAction('installPlugin', {
        pluginId: plugin.pluginId || plugin.pluginRef || plugin.id,
        pluginName: plugin.pluginName || plugin.name,
        marketplacePath: plugin.marketplacePath || '',
        scope: 'user',
        successMessage: '插件已安装'
      })
    } else {
      handleClaudePluginAction('installPlugin', {
        pluginId: plugin.id,
        scope: 'user',
        successMessage: '插件已安装'
      })
    }
    return
  }

  pluginActionError.value = ''
  pluginActionMessage.value = ''
  installingMarketplacePlugin.value = plugin
  pluginInstallForm.value = createEmptyPluginInstallForm()
  showPluginInstallDialog.value = true
}

function closePluginInstallDialog() {
  showPluginInstallDialog.value = false
  installingMarketplacePlugin.value = null
  pluginInstallForm.value = createEmptyPluginInstallForm()
  pluginActionError.value = ''
}

function openCreateHookDialog() {
  hookActionError.value = ''
  hookActionMessage.value = ''
  hookEditorMode.value = 'create'
  editingHook.value = null
  hookForm.value = createEmptyHookForm()
  showHookEditor.value = true
}

function openEditHookDialog(hook = {}) {
  if (!isHookEditable(hook)) return
  hookActionError.value = ''
  hookActionMessage.value = ''
  hookEditorMode.value = 'update'
  editingHook.value = hook
  hookForm.value = {
    scope: hook.scope || (
      normalizedProvider.value === 'codex'
        ? (props.projectPath ? 'project' : 'user')
        : (props.projectPath ? 'local' : 'user')
    ),
    eventName: hook.eventName || 'SessionStart',
    matcherValues: String(hook.matcher || '')
      .split('|')
      .map(item => item.trim())
      .filter(Boolean),
    type: hook.type || 'command',
    content: hook.summary || '',
    async: hook.async === true,
    timeout: hook.timeout ?? ''
  }
  showHookEditor.value = true
}

function openDeleteHookDialog(hook = {}) {
  if (!isHookEditable(hook)) return
  hookActionError.value = ''
  hookActionMessage.value = ''
  deletingHook.value = hook
  showHookDeleteConfirm.value = true
}

function closeHookEditor() {
  showHookEditor.value = false
  editingHook.value = null
  hookActionError.value = ''
  hookActionMessage.value = ''
}

function closeHookDeleteDialog() {
  showHookDeleteConfirm.value = false
  deletingHook.value = null
  hookActionError.value = ''
  hookActionMessage.value = ''
}

async function submitHookForm() {
  hookActionBusy.value = true
  hookActionError.value = ''
  hookActionMessage.value = ''

  try {
    const result = await (normalizedProvider.value === 'codex'
      ? window.electronAPI.manageCodexHook({
          action: hookEditorMode.value === 'create' ? 'create' : 'update',
          projectPath: props.projectPath || '',
          scope: hookForm.value.scope,
          target: editingHook.value
            ? {
                eventName: editingHook.value.eventName,
                groupIndex: editingHook.value.groupIndex,
                hookIndex: editingHook.value.hookIndex
              }
            : undefined,
          payload: {
            eventName: hookForm.value.eventName,
            matcher: Array.isArray(hookForm.value.matcherValues) ? hookForm.value.matcherValues.join('|') : '',
            type: hookForm.value.type,
            content: hookForm.value.content,
            async: hookForm.value.async,
            timeout: hookForm.value.timeout
          }
        })
      : window.electronAPI.manageClaudeHook({
          action: hookEditorMode.value === 'create' ? 'create' : 'update',
          projectPath: props.projectPath || '',
          scope: hookForm.value.scope,
          target: editingHook.value
            ? {
            eventName: editingHook.value.eventName,
            groupIndex: editingHook.value.groupIndex,
            hookIndex: editingHook.value.hookIndex
          }
        : undefined,
      payload: {
        eventName: hookForm.value.eventName,
        matcher: Array.isArray(hookForm.value.matcherValues) ? hookForm.value.matcherValues.join('|') : '',
        type: hookForm.value.type,
        content: hookForm.value.content,
            async: hookForm.value.async,
            timeout: hookForm.value.timeout
          }
        }))

    if (!result?.success) {
      throw new Error(result?.error || '保存 Hook 失败')
    }

    hookActionMessage.value = hookEditorMode.value === 'create' ? 'Hook 已添加' : 'Hook 已更新'
    closeHookEditor()
    await refreshInspector()
  } catch (error) {
    hookActionError.value = error.message || '保存 Hook 失败'
  } finally {
    hookActionBusy.value = false
  }
}

async function confirmDeleteHook() {
  if (!deletingHook.value) return
  hookActionBusy.value = true
  hookActionError.value = ''
  hookActionMessage.value = ''

  try {
    const result = await (normalizedProvider.value === 'codex'
      ? window.electronAPI.manageCodexHook({
          action: 'delete',
          projectPath: props.projectPath || '',
          scope: deletingHook.value.scope,
          target: {
            eventName: deletingHook.value.eventName,
            groupIndex: deletingHook.value.groupIndex,
            hookIndex: deletingHook.value.hookIndex
          }
        })
      : window.electronAPI.manageClaudeHook({
          action: 'delete',
          projectPath: props.projectPath || '',
          scope: deletingHook.value.scope,
          target: {
            eventName: deletingHook.value.eventName,
            groupIndex: deletingHook.value.groupIndex,
            hookIndex: deletingHook.value.hookIndex
          }
        }))

    if (!result?.success) {
      throw new Error(result?.error || '删除 Hook 失败')
    }

    hookActionMessage.value = 'Hook 已删除'
    closeHookDeleteDialog()
    await refreshInspector()
  } catch (error) {
    hookActionError.value = error.message || '删除 Hook 失败'
  } finally {
    hookActionBusy.value = false
  }
}

async function handleToggleDisableAllHooks(scope = '', checked = false) {
  if (!scope) return
  hookScopeToggleBusy.value = scope
  hookActionError.value = ''
  hookActionMessage.value = ''

  try {
    const result = await window.electronAPI.manageClaudeHookSettings({
      projectPath: props.projectPath || '',
      scope,
      disableAllHooks: checked
    })

    if (!result?.success) {
      throw new Error(result?.error || '更新 Hook 开关失败')
    }

    inspectorData.value = result.data || inspectorData.value
  } catch (error) {
    hookActionError.value = error.message || '更新 Hook 开关失败'
  } finally {
    hookScopeToggleBusy.value = ''
  }
}

async function handleToggleCodexHookFeature(scope = '', enabled = false) {
  if (!scope) return
  hookScopeToggleBusy.value = scope
  hookActionError.value = ''
  hookActionMessage.value = ''

  try {
    const result = await window.electronAPI.manageCodexHookSettings({
      projectPath: props.projectPath || '',
      scope,
      enabled
    })

    if (!result?.success) {
      throw new Error(result?.error || '更新 Hook 开关失败')
    }

    inspectorData.value = result.data || inspectorData.value
  } catch (error) {
    hookActionError.value = error.message || '更新 Hook 开关失败'
  } finally {
    hookScopeToggleBusy.value = ''
  }
}

async function handleAddMarketplace() {
  const source = marketplaceForm.value.source.trim()
  if (!source) {
    pluginActionError.value = '请输入插件市场来源'
    pluginActionMessage.value = ''
    return
  }

  await handleClaudePluginAction('addMarketplace', {
    source,
    scope: marketplaceForm.value.scope || getMarketplaceDefaultScope(),
    successMessage: '插件市场已添加'
  })
}

async function confirmInstallMarketplacePlugin() {
  if (!installingMarketplacePlugin.value) return
  if (normalizedProvider.value === 'codex') {
    await handleCodexPluginAction('installPlugin', {
      pluginId: installingMarketplacePlugin.value.pluginId || installingMarketplacePlugin.value.pluginRef || installingMarketplacePlugin.value.id,
      pluginName: installingMarketplacePlugin.value.pluginName || installingMarketplacePlugin.value.name,
      marketplacePath: installingMarketplacePlugin.value.marketplacePath || '',
      scope: pluginInstallForm.value.scope || 'user',
      successMessage: '插件已安装'
    })
  } else {
    await handleClaudePluginAction('installPlugin', {
      pluginId: installingMarketplacePlugin.value.id,
      scope: pluginInstallForm.value.scope || 'user',
      successMessage: '插件已安装'
    })
  }
  closePluginInstallDialog()
}

async function submitSubagentForm() {
  pluginBusy.value = true
  pluginActionError.value = ''
  pluginActionMessage.value = ''

  try {
    const result = await window.electronAPI.manageClaudeSubagent({
      action: subagentEditorMode.value === 'create' ? 'create' : 'update',
      projectPath: props.projectPath || '',
      scope: subagentForm.value.scope,
      target: editingSubagent.value
        ? {
            name: editingSubagent.value.name,
            path: editingSubagent.value.path
          }
        : undefined,
      payload: {
        name: subagentForm.value.name,
        description: subagentForm.value.description,
        model: subagentForm.value.model,
        tools: subagentForm.value.toolsText.split(',').map(item => item.trim()).filter(Boolean),
        prompt: subagentForm.value.prompt
      }
    })

    if (!result?.success) {
      throw new Error(result?.error || '保存 SubAgent 失败')
    }

    inspectorData.value = result.data || inspectorData.value
    closeSubagentEditor()
  } catch (error) {
    pluginActionError.value = error.message || '保存 SubAgent 失败'
  } finally {
    pluginBusy.value = false
  }
}

async function confirmDeleteSubagent() {
  if (!deletingSubagent.value) return
  pluginBusy.value = true
  pluginActionError.value = ''
  pluginActionMessage.value = ''

  try {
    const result = await window.electronAPI.manageClaudeSubagent({
      action: 'delete',
      projectPath: props.projectPath || '',
      scope: deletingSubagent.value.scope,
      target: {
        name: deletingSubagent.value.name,
        path: deletingSubagent.value.path
      }
    })

    if (!result?.success) {
      throw new Error(result?.error || '删除 SubAgent 失败')
    }

    inspectorData.value = result.data || inspectorData.value
    closeSubagentDeleteDialog()
  } catch (error) {
    pluginActionError.value = error.message || '删除 SubAgent 失败'
  } finally {
    pluginBusy.value = false
  }
}

onMounted(() => {
  pluginActionScope.value = 'all'
  selectedCodexPluginStates.value = ['enabled', 'disabled']
  // 只加载当前 tab（模型）所需的数据，inspector 数据按需加载
  loadSettings()
})

watch(() => props.projectPath, () => {
  selectedHookLocations.value = hookLocationOptions.value.map(option => option.value)
  selectedHookModes.value = hookModeOptions.value.map(option => option.value)
  selectedSubagentSources.value = subagentSourceOptions.value.map(option => option.value)
  pluginActionScope.value = 'all'
  selectedCodexPluginStates.value = ['enabled', 'disabled']
  selectedMarketplace.value = null
  // 重置 inspector 加载状态，如果当前在需要 inspector 的 tab 则立即重新加载
  inspectorLoaded.value = false
  if (INSPECTOR_TABS.has(activeSection.value)) {
    refreshInspector()
  }
})

watch(() => normalizedProvider.value, () => {
  selectedHookLocations.value = hookLocationOptions.value.map(option => option.value)
  selectedHookModes.value = hookModeOptions.value.map(option => option.value)
  pluginActionScope.value = 'all'
  selectedCodexPluginStates.value = ['enabled', 'disabled']
})

watch(() => activeSection.value, (section) => {
  if (section !== 'marketplace') {
    selectedMarketplace.value = null
  }
  // 切换到需要 inspector 数据的 tab 时，按需加载
  if (INSPECTOR_TABS.has(section)) {
    ensureInspectorLoaded()
  }
})
</script>

<template>
  <div class="dialog-overlay">
    <div class="provider-dialog" @click.stop>
      <div class="dialog-header">
        <h2>{{ providerLabel }} 面板</h2>
        <button class="close-btn" @click="handleClose" title="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <div class="market-nav">
          <div
            v-for="section in sections"
            :key="section.id"
            class="nav-item"
            :class="{ active: activeSection === section.id, bottom: section.bottom, spacer: section.spacer }"
            @click="activeSection = section.id"
          >
            <template v-if="section.spacer"></template>
            <template v-else>
            <svg v-if="section.icon === 'model'" class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
              <circle cx="12" cy="12" r="2.5"/>
              <path d="M18.6 15.1a1.35 1.35 0 0 0 .27 1.48l.05.05a1.65 1.65 0 0 1 0 2.34 1.65 1.65 0 0 1-2.33 0l-.05-.05a1.35 1.35 0 0 0-1.49-.27 1.35 1.35 0 0 0-.81 1.23V20a1.65 1.65 0 0 1-3.3 0v-.07a1.35 1.35 0 0 0-.81-1.23 1.35 1.35 0 0 0-1.49.27l-.05.05a1.65 1.65 0 0 1-2.33 0 1.65 1.65 0 0 1 0-2.34l.05-.05a1.35 1.35 0 0 0 .27-1.48 1.35 1.35 0 0 0-1.23-.82H4a1.65 1.65 0 0 1 0-3.3h.07a1.35 1.35 0 0 0 1.23-.81 1.35 1.35 0 0 0-.27-1.49l-.05-.05a1.65 1.65 0 0 1 0-2.33 1.65 1.65 0 0 1 2.33 0l.05.05a1.35 1.35 0 0 0 1.49.27h.01a1.35 1.35 0 0 0 .8-1.23V4a1.65 1.65 0 0 1 3.3 0v.07a1.35 1.35 0 0 0 .81 1.23 1.35 1.35 0 0 0 1.49-.27l.05-.05a1.65 1.65 0 0 1 2.33 0 1.65 1.65 0 0 1 0 2.33l-.05.05a1.35 1.35 0 0 0-.27 1.49v.01a1.35 1.35 0 0 0 1.23.8H20a1.65 1.65 0 0 1 0 3.3h-.07a1.35 1.35 0 0 0-1.23.81z"/>
            </svg>
            <svg v-else-if="section.icon === 'hooks'" class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
              <path d="M10.5 13.5a4.4 4.4 0 0 0 6.64.48l3.4-3.41a4.4 4.4 0 1 0-6.22-6.22L12.3 6.37"/>
              <path d="M13.5 10.5a4.4 4.4 0 0 0-6.64-.48l-3.4 3.41a4.4 4.4 0 1 0 6.22 6.22l2.02-2.02"/>
            </svg>
            <svg v-else-if="section.icon === 'marketplace'" class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
              <path d="M3 7l2-3h14l2 3"/>
              <path d="M5 10v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9"/>
              <path d="M3 7h18v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
              <path d="M9 12h6"/>
            </svg>
            <svg v-else-if="section.icon === 'agent'" class="nav-icon nav-icon-emphasis" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
              <path d="M12 2v4"/>
              <rect x="5" y="6" width="14" height="12" rx="4"/>
              <circle cx="9" cy="12" r="1"/>
              <circle cx="15" cy="12" r="1"/>
              <path d="M9 16c.8.7 1.8 1 3 1s2.2-.3 3-1"/>
              <path d="M5 10H3"/>
              <path d="M21 10h-2"/>
              <path d="M8 18v2"/>
              <path d="M16 18v2"/>
            </svg>
            <svg v-else class="nav-icon nav-icon-emphasis" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9">
              <path d="M19 13h-1a2 2 0 1 0 0 4h1v3a1 1 0 0 1-1 1h-4v-1a2 2 0 1 0-4 0v1H6a1 1 0 0 1-1-1v-4h1a2 2 0 1 0 0-4H5V9a1 1 0 0 1 1-1h3V7a2 2 0 1 1 4 0v1h4a1 1 0 0 1 1 1z"/>
            </svg>
            <span>{{ section.label }}</span>
            </template>
          </div>
        </div>

        <div class="provider-content">
          <div v-if="activeSection === 'model'" class="tab-panel settings-panel">
            <ModelSettings
              :initial-provider-tab="normalizedProvider"
              :visible-providers="[normalizedProvider]"
              :default-config="defaultConfig"
              :codex-config="codexConfig"
              :claude-models="claudeModels"
              :codex-models="codexModels"
              :selected-claude-model-id="selectedClaudeModelId"
              :selected-codex-model-id="selectedCodexModelId"
              :effort-options="effortOptions"
              @edit-default-config="handleEditDefaultConfig"
              @edit-codex-config="handleEditCodexConfig"
              @save-codex-proxy="handleSaveCodexProxy"
              @add-codex-account="handleAddCodexAccount"
              @edit-codex-account="handleEditCodexAccount"
              @delete-codex-account="handleDeleteProviderAccount"
              @apply-codex-account="handleApplyProviderAccount"
              @refresh-codex-account-usage="handleRefreshCodexAccountUsage"
              @select-claude-model="handleSelectClaudeModel"
              @select-codex-model="handleSelectCodexModel"
              @edit-claude-model="handleEditClaudeModel"
              @edit-codex-model="handleEditCodexModel"
              @delete-claude-model="handleDeleteClaudeModel"
              @delete-codex-model="handleDeleteCodexModel"
              @add-claude-model="handleAddClaudeModel"
              @add-codex-model="handleAddCodexModel"
              @set-claude-model-default-credential="handleSetClaudeModelDefaultCredential"
              @set-codex-model-default-credential="handleSetCodexModelDefaultCredential"
              @set-claude-model-default-card="handleSetClaudeModelDefaultCard"
              @set-codex-model-default-card="handleSetCodexModelDefaultCard"
              @toggle-claude-model-active="handleToggleClaudeModelActive"
              @toggle-codex-model-active="handleToggleCodexModelActive"
              @apply-claude-model="handleApplyClaudeModel"
              @apply-codex-model="handleApplyCodexModel"
            />
          </div>

          <div v-if="activeSection === 'hooks'" class="tab-panel hooks-panel">
            <div class="panel-header hooks-panel-header">
              <div class="hook-header-top-row">
                <div class="panel-header-main">
                  <div class="hook-filter-bar">
                    <span class="hook-filter-label">位置</span>
                    <div class="hook-filter-options">
                      <button
                        v-for="option in hookLocationOptions"
                        :key="option.value"
                        type="button"
                        class="hook-filter-btn"
                        :class="{ active: selectedHookLocations.includes(option.value) }"
                        @click="toggleHookLocation(option.value)"
                      >
                        {{ option.label }}
                      </button>
                    </div>
                  </div>
                  <div class="hook-filter-bar">
                    <span class="hook-filter-label">方式</span>
                    <div class="hook-filter-options">
                      <button
                        v-for="option in hookModeOptions"
                        :key="option.value"
                        type="button"
                        class="hook-filter-btn"
                        :class="{ active: selectedHookModes.includes(option.value) }"
                        @click="toggleHookMode(option.value)"
                      >
                        {{ option.label }}
                      </button>
                    </div>
                  </div>
                </div>
                <div class="panel-header-right hook-header-top">
                  <span class="count-badge">{{ filteredHooks.length }}</span>
                  <IconButton
                    size="sm"
                    title="添加 Hook"
                    :disabled="hookActionBusy"
                    @click="openCreateHookDialog"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <line x1="12" y1="5" x2="12" y2="19"/>
                      <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  </IconButton>
                  <div class="view-toggle">
                    <button
                      type="button"
                      class="view-toggle-btn"
                      :class="{ active: hookViewMode === 'event' }"
                      @click="hookViewMode = 'event'"
                    >
                      按 Hook 点
                    </button>
                    <button
                      type="button"
                      class="view-toggle-btn"
                      :class="{ active: hookViewMode === 'owner' }"
                      @click="hookViewMode = 'owner'"
                    >
                      按主体
                    </button>
                  </div>
                </div>
              </div>
              <div
                class="hook-header-bottom"
                :class="{ codex: normalizedProvider === 'codex' }"
              >
                <div v-if="normalizedProvider === 'claude'" class="hook-disable-bar">
                  <div class="hook-disable-switches">
                    <div
                      v-for="option in hookDisableScopeOptions"
                      :key="option.value"
                      class="hook-disable-switch-item"
                    >
                      <span class="hook-disable-switch-label">{{ option.label }}</span>
                      <label class="toggle-switch compact">
                        <input
                          type="checkbox"
                          :checked="!disableAllHooksState[option.value]"
                          :disabled="hookScopeToggleBusy === option.value"
                          @change="handleToggleDisableAllHooks(option.value, !$event.target.checked)"
                        >
                        <span class="toggle-slider"></span>
                      </label>
                    </div>
                  </div>
                </div>
                <div v-else class="hook-disable-bar codex-feature-bar">
                  <div class="hook-disable-switches">
                    <div class="hook-disable-switch-item">
                      <span class="hook-disable-switch-label">用户</span>
                      <label class="toggle-switch compact">
                        <input
                          type="checkbox"
                          :checked="hookFeatureState.user"
                          :disabled="hookScopeToggleBusy === 'user'"
                          @change="handleToggleCodexHookFeature('user', $event.target.checked)"
                        >
                        <span class="toggle-slider"></span>
                      </label>
                    </div>
                    <div
                      v-if="props.projectPath"
                      class="hook-disable-switch-item"
                    >
                      <span class="hook-disable-switch-label">项目</span>
                      <label class="toggle-switch compact">
                        <input
                          type="checkbox"
                          :checked="hookFeatureState.project"
                          :disabled="hookScopeToggleBusy === 'project'"
                          @change="handleToggleCodexHookFeature('project', $event.target.checked)"
                        >
                        <span class="toggle-slider"></span>
                      </label>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            <p v-if="inspectorError" class="error-msg">{{ inspectorError }}</p>
            <p
              v-else-if="hookActionError && !showHookEditor && !showHookDeleteConfirm"
              class="error-msg"
            >
              {{ hookActionError }}
            </p>
            <p
              v-else-if="hookActionMessage && !showHookEditor && !showHookDeleteConfirm"
              class="success-msg"
            >
              {{ hookActionMessage }}
            </p>

            <div v-if="inspectorLoading" class="loading-state">
              <div class="spinner"></div>
              <p>读取 Hook 配置中...</p>
            </div>

            <template v-else>
              <div v-if="hookViewMode === 'event' && hooksByEvent.length > 0" class="hook-group-list">
                <div
                  v-for="group in hooksByEvent"
                  :key="group.id"
                  class="hook-group-block"
                >
                  <div class="hook-group-header">
                    <div class="hook-group-title-wrap">
                      <h4 class="hook-group-title">{{ group.title }}</h4>
                      <div class="provider-card-badges inline">
                        <span class="count-badge">{{ group.items.length }}</span>
                      </div>
                    </div>
                  </div>
                  <div class="hook-group-card">
                    <div class="hook-entry-list">
                      <div
                        v-for="hook in group.items"
                        :key="hook.id"
                        class="hook-entry-card"
                        :class="{ disabled: isHookDisabled(hook) }"
                      >
                        <div class="hook-entry-meta-row compact left-aligned">
                          <span class="hook-entry-heading">{{ hook.ownerLabel }}</span>
                          <div class="provider-card-badges inline">
                            <span class="source-badge">{{ getHookLocationLabel(hook) }}</span>
                            <span class="source-badge">{{ getHookModeLabel(hook) }}</span>
                            <span v-if="isHookDisabled(hook)" class="source-badge disabled-state-badge">已禁用</span>
                          </div>
                          <div v-if="isHookEditable(hook)" class="hook-entry-actions">
                            <IconButton size="sm" title="编辑 Hook" @click.stop="openEditHookDialog(hook)">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 20h9"/>
                                <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4z"/>
                              </svg>
                            </IconButton>
                            <IconButton size="sm" danger title="删除 Hook" @click.stop="openDeleteHookDialog(hook)">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                              </svg>
                            </IconButton>
                          </div>
                        </div>
                        <div class="hook-inline-row">
                          <span class="hook-field-label">Matcher:</span>
                          <div class="provider-card-badges">
                            <span
                              v-for="token in String(hook.matcher || '默认匹配').split('|').filter(Boolean)"
                              :key="`${hook.id}-matcher-${token}`"
                              class="source-badge"
                            >
                              {{ token }}
                            </span>
                          </div>
                        </div>
                        <div class="hook-inline-row command">
                          <span class="hook-field-label">{{ getHookContentLabel(hook) }}:</span>
                          <div class="provider-card-badges inline hook-command-badges">
                            <span class="source-badge">{{ hook.async ? 'ASYNC' : 'SYNC' }}</span>
                          </div>
                          <div class="hook-command-value">{{ hook.summary || '暂无内容' }}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else-if="hookViewMode === 'owner' && hooksByOwner.length > 0" class="hook-group-list">
                <div
                  v-for="group in hooksByOwner"
                  :key="group.id"
                  class="hook-group-block"
                >
                  <div class="hook-group-header">
                    <div class="hook-group-title-wrap">
                      <h4 class="hook-group-title">{{ group.title }}</h4>
                      <div class="provider-card-badges inline">
                        <span class="source-badge">{{ getHookLocationLabel(group.items[0]) }}</span>
                        <span class="source-badge">{{ getHookModeLabel(group.items[0]) }}</span>
                        <span
                          v-if="isHookDisabled(group.items[0])"
                          class="source-badge disabled-state-badge"
                        >
                          已禁用
                        </span>
                        <span class="count-badge">{{ group.items.length }}</span>
                      </div>
                    </div>
                  </div>
                  <div class="hook-group-card">
                    <div class="hook-entry-list">
                      <div
                        v-for="hook in group.items"
                        :key="hook.id"
                        class="hook-entry-card"
                        :class="{ disabled: isHookDisabled(hook) }"
                      >
                        <div class="hook-entry-meta-row compact left-aligned">
                          <span class="hook-entry-heading">{{ hook.eventName }}</span>
                          <div class="provider-card-badges inline">
                            <span class="source-badge">{{ getHookLocationLabel(hook) }}</span>
                            <span class="source-badge">{{ getHookModeLabel(hook) }}</span>
                            <span v-if="isHookDisabled(hook)" class="source-badge disabled-state-badge">已禁用</span>
                          </div>
                          <div v-if="isHookEditable(hook)" class="hook-entry-actions">
                            <IconButton size="sm" title="编辑 Hook" @click.stop="openEditHookDialog(hook)">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M12 20h9"/>
                                <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4z"/>
                              </svg>
                            </IconButton>
                            <IconButton size="sm" danger title="删除 Hook" @click.stop="openDeleteHookDialog(hook)">
                              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <polyline points="3 6 5 6 21 6"/>
                                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                              </svg>
                            </IconButton>
                          </div>
                        </div>
                        <div class="hook-inline-row">
                          <span class="hook-field-label">Matcher:</span>
                          <div class="provider-card-badges">
                            <span
                              v-for="token in String(hook.matcher || '默认匹配').split('|').filter(Boolean)"
                              :key="`${hook.id}-owner-matcher-${token}`"
                              class="source-badge"
                            >
                              {{ token }}
                            </span>
                          </div>
                        </div>
                        <div class="hook-inline-row command">
                          <span class="hook-field-label">{{ getHookContentLabel(hook) }}:</span>
                          <div class="provider-card-badges inline hook-command-badges">
                            <span class="source-badge">{{ hook.async ? 'ASYNC' : 'SYNC' }}</span>
                          </div>
                          <div class="hook-command-value">{{ hook.summary || '暂无内容' }}</div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else class="empty-state">
                <p>暂未解析到 Hook 条目</p>
                <p class="hint">已经读取配置来源，但当前来源里没有可展示的 Hook 配置</p>
              </div>
            </template>
          </div>

          <BaseDialog
            v-model="showHookEditor"
            :title="hookEditorMode === 'create' ? '添加 Hook' : '编辑 Hook'"
            width="560px"
            @close="closeHookEditor"
          >
            <div class="hook-editor-form">
              <label class="hook-form-field">
                <span>来源</span>
                <AppSelect
                  v-model="hookForm.scope"
                  :options="hookEditableScopeOptions"
                  full-width
                  :disabled="hookEditorMode === 'update' || hookActionBusy"
                />
              </label>

              <label class="hook-form-field">
                <span>Hook 点</span>
                <AppSelect
                  v-model="hookForm.eventName"
                  :options="hookEventOptions"
                  full-width
                  :disabled="hookActionBusy"
                />
              </label>

              <label class="hook-form-field">
                <span>Matcher</span>
                <AppMultiSelect
                  v-model="hookForm.matcherValues"
                  :options="currentMatcherOptions"
                  full-width
                  :disabled="hookActionBusy"
                  placeholder="选择 Matcher"
                />
              </label>

              <div class="hook-form-row">
                <label class="hook-form-field">
                  <span>类型</span>
                  <AppSelect
                    v-model="hookForm.type"
                    :options="hookTypeOptions"
                    full-width
                    :disabled="hookActionBusy"
                  />
                </label>

                <label class="hook-form-field">
                  <span>Timeout</span>
                  <input
                    v-model="hookForm.timeout"
                    type="text"
                    inputmode="numeric"
                    :disabled="hookActionBusy"
                    placeholder="可选"
                  />
                </label>
              </div>

              <label class="hook-form-field">
                <span>{{ hookForm.type === 'command' ? '命令' : hookForm.type === 'http' ? 'URL' : hookForm.type === 'prompt' ? 'Prompt' : 'Agent' }}</span>
                <textarea v-model="hookForm.content" rows="4" :disabled="hookActionBusy" placeholder="请输入内容"></textarea>
              </label>

              <label class="hook-checkbox-field">
                <input v-model="hookForm.async" type="checkbox" :disabled="hookActionBusy" />
                <span>异步执行</span>
              </label>
            </div>

            <template #footer>
              <div class="hook-dialog-footer">
                <p v-if="hookActionError" class="error-msg hook-dialog-footer-error">{{ hookActionError }}</p>
                <div class="hook-dialog-footer-actions">
                  <button class="toolbar-btn" :disabled="hookActionBusy" @click="closeHookEditor">取消</button>
                  <button class="toolbar-btn primary" :disabled="hookActionBusy" @click="submitHookForm">
                    {{ hookActionBusy ? '保存中...' : hookEditorMode === 'create' ? '添加' : '保存' }}
                  </button>
                </div>
              </div>
            </template>
          </BaseDialog>

          <BaseDialog
            v-model="showHookDeleteConfirm"
            title="删除 Hook"
            width="420px"
            @close="closeHookDeleteDialog"
          >
            <div class="hook-delete-copy">
              <p>确认删除这条 Hook 吗？</p>
              <p class="hint">
                {{ deletingHook?.eventName || '' }}
                <span v-if="deletingHook?.summary"> · {{ deletingHook.summary }}</span>
              </p>
            </div>

            <template #footer>
              <div class="hook-dialog-footer">
                <p v-if="hookActionError" class="error-msg hook-dialog-footer-error">{{ hookActionError }}</p>
                <div class="hook-dialog-footer-actions">
                  <button class="toolbar-btn" :disabled="hookActionBusy" @click="closeHookDeleteDialog">取消</button>
                  <button class="action-btn danger" :disabled="hookActionBusy" @click="confirmDeleteHook">
                    {{ hookActionBusy ? '删除中...' : '删除' }}
                  </button>
                </div>
              </div>
            </template>
          </BaseDialog>

          <div v-if="activeSection === 'plugins'" class="tab-panel plugins-panel">
            <div class="panel-header">
              <div class="hook-filter-bar">
                <span v-if="normalizedProvider !== 'codex'" class="hook-filter-label">作用域</span>
                <div class="hook-filter-options">
                  <button
                    v-for="option in pluginScopeOptions"
                    :key="`plugin-scope-${option.value}`"
                    type="button"
                    class="hook-filter-btn"
                    :class="{ active: normalizedProvider === 'codex' ? selectedCodexPluginStates.includes(option.value) : pluginActionScope === option.value }"
                    @click="normalizedProvider === 'codex'
                      ? toggleCodexPluginStateFilter(option.value)
                      : (pluginActionScope = option.value)"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>
              <div class="panel-header-right">
                <span class="count-badge">{{ filteredPlugins.length }}</span>
                <IconButton
                  size="sm"
                  title="刷新插件"
                  :disabled="pluginBusy || inspectorLoading"
                  @click="refreshInspector"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="23 4 23 10 17 10"/>
                    <polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"/>
                    <path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"/>
                  </svg>
                </IconButton>
              </div>
            </div>
            <p v-if="inspectorError" class="error-msg">{{ inspectorError }}</p>
            <p v-else-if="pluginActionError" class="error-msg">{{ pluginActionError }}</p>

            <div v-if="inspectorLoading" class="loading-state">
              <div class="spinner"></div>
              <p>读取插件中...</p>
            </div>

            <template v-else-if="normalizedProvider === 'claude'">
              <div v-if="filteredPlugins.length > 0" class="plugin-list">
                <div
                  v-for="plugin in filteredPlugins"
                  :key="plugin.id"
                  class="plugin-list-card"
                  :class="{ disabled: isPluginDisabled(plugin) }"
                  @click="openPluginDetail(plugin)"
                >
                  <div class="plugin-list-header">
                    <div class="plugin-list-header-main">
                      <span class="provider-card-title">{{ plugin.displayName || plugin.name }}</span>
                      <span v-if="plugin.scope" class="meta-chip plugin-scope-chip">{{ plugin.scope }}</span>
                      <span v-if="isPluginDisabled(plugin)" class="meta-chip disabled-state-badge">已禁用</span>
                    </div>
                    <div v-if="plugin.managedByCli" class="card-actions">
                      <IconButton
                        size="sm"
                        :title="plugin.enabled ? '禁用插件' : '启用插件'"
                        :disabled="pluginBusy"
                        @click.stop="handleClaudePluginAction(plugin.enabled ? 'disablePlugin' : 'enablePlugin', {
                          pluginId: plugin.id,
                          scope: plugin.scope,
                          successMessage: plugin.enabled ? '插件已禁用' : '插件已启用'
                        })"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <template v-if="plugin.enabled">
                            <circle cx="12" cy="12" r="9"/>
                            <path d="M5.64 18.36L18.36 5.64"/>
                          </template>
                          <template v-else>
                            <path d="M12 2v10"/>
                            <path d="M18.36 6.64a9 9 0 1 1-12.72 0"/>
                          </template>
                        </svg>
                      </IconButton>
                      <IconButton
                        size="sm"
                        title="更新插件"
                        :disabled="pluginBusy"
                        @click.stop="handleClaudePluginAction('updatePlugin', {
                          pluginId: plugin.id,
                          scope: plugin.scope,
                          successMessage: '插件已更新'
                        })"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="23 4 23 10 17 10"/>
                          <polyline points="1 20 1 14 7 14"/>
                          <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"/>
                          <path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"/>
                        </svg>
                      </IconButton>
                      <IconButton
                        size="sm"
                        danger
                        title="卸载插件"
                        :disabled="pluginBusy"
                        @click.stop="handleClaudePluginAction('uninstallPlugin', {
                          pluginId: plugin.id,
                          scope: plugin.scope,
                          successMessage: '插件已卸载'
                        })"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </IconButton>
                    </div>
                  </div>

                  <div class="plugin-list-meta">
                    <span v-if="plugin.version" class="meta-chip">版本: v{{ plugin.version }}</span>
                    <span class="meta-chip">
                      来源:
                      {{
                        plugin.marketplaceName
                          ? plugin.marketplaceName
                          : (plugin.managedByCli ? 'Claude CLI' : '项目目录')
                      }}
                    </span>
                    <span class="meta-chip">{{ pluginSummary(plugin) }}</span>
                  </div>

                  <p class="provider-card-desc plugin-list-desc">{{ plugin.description || '暂无描述' }}</p>

                  <p v-if="!plugin.managedByCli" class="hint inline-hint">该插件来自项目目录，仅做识别展示，不走 Claude CLI 安装链路。</p>
                </div>
              </div>

              <div v-else class="empty-state">
                <p>暂无已安装插件</p>
                <p class="hint">可以在下方的“插件市场”面板查看并安装可用插件</p>
              </div>
            </template>

            <div v-else-if="filteredPlugins.length > 0" class="plugin-list">
              <div
                v-for="plugin in filteredPlugins"
                :key="plugin.id"
                class="plugin-list-card codex-plugin-list-card"
                :class="{ disabled: isPluginDisabled(plugin) }"
                @click="openPluginDetail(plugin)"
                >
                  <div class="marketplace-plugin-top">
                    <img
                      v-if="plugin.logoPath"
                      :src="resolvePluginLogoSrc(plugin.logoPath)"
                      alt=""
                      class="plugin-avatar marketplace-plugin-avatar"
                    >
                    <div v-else class="plugin-avatar plugin-avatar-placeholder marketplace-plugin-avatar">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 4h6v6"/>
                        <path d="M10 20H4v-6"/>
                        <path d="M20 10V4h-6"/>
                        <path d="M4 14v6h6"/>
                        <path d="M9 9h6v6H9z"/>
                      </svg>
                    </div>
                    <div class="marketplace-plugin-main">
                      <div class="marketplace-plugin-title-row">
                        <span class="provider-card-title marketplace-plugin-title">{{ plugin.displayName || plugin.name }}</span>
                      </div>
                      <div class="provider-card-badges marketplace-plugin-badges">
                        <span v-if="plugin.version" class="meta-chip">v{{ plugin.version }}</span>
                        <span v-if="plugin.developerName" class="meta-chip">作者: {{ plugin.developerName }}</span>
                        <span v-if="isPluginDisabled(plugin)" class="meta-chip disabled-state-badge">已禁用</span>
                        <span class="meta-chip">{{ pluginSummary(plugin) }}</span>
                      </div>
                    </div>
                    <div v-if="['user', 'project'].includes(plugin.scope || '')" class="card-actions marketplace-plugin-actions codex-scope-actions">
                      <IconButton
                        size="sm"
                        :title="plugin.enabled ? '禁用插件' : '启用插件'"
                        :disabled="pluginBusy"
                        @click.stop="handleCodexPluginAction(plugin.enabled ? 'disablePlugin' : 'enablePlugin', {
                          pluginId: plugin.pluginId || plugin.pluginRef || plugin.name,
                          scope: 'user',
                          successMessage: plugin.enabled ? '插件已禁用' : '插件已启用'
                        })"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <template v-if="plugin.enabled">
                            <circle cx="12" cy="12" r="9"/>
                            <path d="M5.64 18.36L18.36 5.64"/>
                          </template>
                          <template v-else>
                            <path d="M12 2v10"/>
                            <path d="M18.36 6.64a9 9 0 1 1-12.72 0"/>
                          </template>
                        </svg>
                      </IconButton>
                      <IconButton
                        size="sm"
                        danger
                        title="卸载插件"
                        :disabled="pluginBusy"
                        @click.stop="handleCodexPluginAction('uninstallPlugin', {
                          pluginId: plugin.pluginId || plugin.pluginRef || plugin.name,
                          scope: 'user',
                          successMessage: '插件已卸载'
                        })"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </IconButton>
                    </div>
                  </div>
                  <p class="provider-card-desc marketplace-plugin-desc">{{ plugin.description || '暂无描述' }}</p>
              </div>
            </div>

            <div v-else class="empty-state">
              <p>暂无插件</p>
              <p class="hint">当前未解析到可展示的插件</p>
            </div>
          </div>

          <div v-if="activeSection === 'subagents' && normalizedProvider === 'claude'" class="tab-panel plugins-panel">
            <div class="panel-header">
              <div class="hook-filter-bar">
                <span class="hook-filter-label">来源</span>
                <div class="hook-filter-options">
                  <button
                    v-for="option in subagentSourceOptions"
                    :key="`subagent-source-${option.value}`"
                    type="button"
                    class="hook-filter-btn"
                    :class="{ active: selectedSubagentSources.includes(option.value) }"
                    @click="toggleSubagentSource(option.value)"
                  >
                    {{ option.label }}
                  </button>
                </div>
              </div>
              <div class="panel-header-right">
                <span class="count-badge">{{ filteredSubagents.length }}</span>
                <IconButton
                  size="sm"
                  title="添加 SubAgent"
                  :disabled="pluginBusy"
                  @click="openCreateSubagentDialog"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                </IconButton>
              </div>
            </div>
            <p v-if="inspectorError" class="error-msg">{{ inspectorError }}</p>
            <p v-else-if="pluginActionError && !showSubagentEditor && !showSubagentDeleteConfirm" class="error-msg">{{ pluginActionError }}</p>

            <div v-if="inspectorLoading" class="loading-state">
              <div class="spinner"></div>
              <p>读取 SubAgent 中...</p>
            </div>

            <template v-else-if="filteredSubagents.length > 0">
              <div class="plugin-list">
                <div
                  v-for="agent in filteredSubagents"
                  :key="agent.id"
                  class="plugin-list-card"
                  @click="openPluginAgentDetail(agent)"
                >
                  <div class="plugin-list-header">
                    <div class="plugin-list-header-main">
                      <span class="provider-card-title">{{ agent.title || agent.name }}</span>
                      <span class="meta-chip">{{ agent.scope === 'plugin' ? '插件' : normalizeSubagentScope(agent.scope) }}</span>
                      <span v-if="agent.pluginDisplayName" class="meta-chip">{{ agent.pluginDisplayName }}</span>
                    </div>
                    <div v-if="isSubagentEditable(agent)" class="card-actions">
                      <IconButton
                        v-if="agent.path"
                        size="sm"
                        title="在 Finder 中显示"
                        @click.stop="openSubagentInFinder(agent)"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M3 7l2-3h6l2 3h8v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
                          <path d="M3 10h18"/>
                        </svg>
                      </IconButton>
                      <IconButton size="sm" title="编辑 SubAgent" @click.stop="openEditSubagentDialog(agent)">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <path d="M12 20h9"/>
                          <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4z"/>
                        </svg>
                      </IconButton>
                      <IconButton size="sm" danger title="删除 SubAgent" @click.stop="openDeleteSubagentDialog(agent)">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <polyline points="3 6 5 6 21 6"/>
                          <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                        </svg>
                      </IconButton>
                    </div>
                  </div>
                  <div class="subagent-item-body">
                    <p class="provider-card-desc plugin-list-desc subagent-desc">
                      <span class="subagent-field-label">description:</span>
                      {{ agent.description || '暂无描述' }}
                    </p>
                    <p v-if="agent.tools?.length" class="provider-card-desc plugin-list-desc subagent-meta-line">
                      <span class="subagent-field-label">tools:</span>
                      {{ agent.tools.join(', ') }}
                    </p>
                    <p v-if="agent.model" class="provider-card-desc plugin-list-desc subagent-meta-line">
                      <span class="subagent-field-label">model:</span>
                      {{ agent.model }}
                    </p>
                    <p v-if="agent.permissionMode" class="provider-card-desc plugin-list-desc subagent-meta-line">
                      <span class="subagent-field-label">permissionMode:</span>
                      {{ agent.permissionMode }}
                    </p>
                    <p v-if="agent.skills?.length" class="provider-card-desc plugin-list-desc subagent-meta-line">
                      <span class="subagent-field-label">skills:</span>
                      {{ agent.skills.join(', ') }}
                    </p>
                  </div>
                </div>
              </div>
            </template>

            <div v-else class="empty-state">
              <p>暂无 SubAgent</p>
              <p class="hint">当前未从 Claude 插件中解析到可展示的 SubAgent</p>
            </div>
          </div>

          <div v-if="activeSection === 'marketplace' && normalizedProvider === 'claude'" class="tab-panel marketplace-panel">
            <div class="panel-header">
              <div class="marketplace-header-left">
                <IconButton
                  v-if="selectedMarketplace"
                  size="sm"
                  title="返回市场列表"
                  @click="closeMarketplaceDetail"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>
                </IconButton>
                <span v-if="selectedMarketplace" class="provider-card-title marketplace-header-title">
                  {{ selectedMarketplace.name }}
                </span>
              </div>
              <div class="panel-header-right">
                <span class="count-badge">{{ selectedMarketplace ? selectedMarketplace.pluginCount : marketplacePluginCount }}</span>
                <IconButton
                  size="sm"
                  title="添加市场"
                  :disabled="pluginBusy"
                  @click="openMarketplaceDialog"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="12" y1="5" x2="12" y2="19"/>
                    <line x1="5" y1="12" x2="19" y2="12"/>
                  </svg>
                </IconButton>
                <IconButton
                  size="sm"
                  title="更新市场"
                  :disabled="pluginBusy"
                  @click="handleClaudePluginAction('updateMarketplace', { successMessage: '插件市场已更新' })"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="23 4 23 10 17 10"/>
                    <polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"/>
                    <path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"/>
                  </svg>
                </IconButton>
              </div>
            </div>
            <p v-if="inspectorError" class="error-msg">{{ inspectorError }}</p>

            <div v-if="inspectorLoading" class="loading-state">
              <div class="spinner"></div>
              <p>读取插件市场中...</p>
            </div>

            <template v-else>
              <div v-if="!selectedMarketplace && filteredMarketplaces.length > 0" class="marketplace-list">
                <div
                  v-for="marketplace in filteredMarketplaces"
                  :key="marketplace.id"
                  class="marketplace-card"
                  @click="openMarketplaceDetail(marketplace)"
                >
                  <div class="marketplace-header">
                    <div class="marketplace-main">
                      <div class="plugin-list-header">
                        <div class="plugin-list-header-main">
                          <span class="provider-card-title">{{ marketplace.name }}</span>
                          <span v-if="marketplace.version" class="meta-chip">v{{ marketplace.version }}</span>
                          <span class="meta-chip">{{ marketplace.pluginCount }} 个插件</span>
                        </div>
                        <div class="card-actions">
                          <IconButton
                            size="sm"
                            title="更新市场"
                            :disabled="pluginBusy"
                            @click="handleClaudePluginAction('updateMarketplace', {
                              marketplaceName: marketplace.name,
                              successMessage: '市场已更新'
                            })"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <polyline points="23 4 23 10 17 10"/>
                              <polyline points="1 20 1 14 7 14"/>
                              <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"/>
                              <path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"/>
                            </svg>
                          </IconButton>
                          <IconButton
                            size="sm"
                            danger
                            title="移除市场"
                            :disabled="pluginBusy"
                            @click="handleClaudePluginAction('removeMarketplace', {
                              marketplaceName: marketplace.name,
                              successMessage: '市场已移除'
                            })"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                          </IconButton>
                        </div>
                      </div>
                      <div class="plugin-list-meta">
                        <span class="meta-chip">来源: {{ formatMarketplaceSource(marketplace) }}</span>
                        <span v-if="marketplace.ownerName" class="meta-chip">维护者: {{ marketplace.ownerName }}</span>
                      </div>
                      <p class="provider-card-desc">{{ marketplace.description || '暂无描述' }}</p>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else-if="selectedMarketplace" class="marketplace-plugin-list">
                <div
                  v-for="plugin in selectedMarketplace.plugins"
                  :key="plugin.id"
                  class="marketplace-plugin-row"
                >
                  <div class="claude-marketplace-plugin-top">
                    <div class="marketplace-plugin-main">
                      <div class="claude-marketplace-plugin-header">
                        <div class="claude-marketplace-plugin-header-main">
                          <span class="provider-card-title marketplace-plugin-title">{{ plugin.displayName || plugin.name }}</span>
                          <span v-if="plugin.version" class="meta-chip">v{{ plugin.version }}</span>
                          <span v-if="plugin.installed" class="meta-chip active">已安装</span>
                          <span v-if="plugin.source?.repo" class="meta-chip">{{ plugin.source.repo }}</span>
                        </div>
                      </div>
                      <p class="provider-card-desc claude-marketplace-plugin-desc">{{ plugin.description || '暂无描述' }}</p>
                    </div>

                    <div class="card-actions marketplace-plugin-actions">
                      <IconButton
                        v-if="!plugin.installed"
                        size="sm"
                        title="安装插件"
                        :disabled="pluginBusy"
                        @click="openPluginInstallDialog(plugin)"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                          <line x1="12" y1="5" x2="12" y2="19"/>
                          <line x1="5" y1="12" x2="19" y2="12"/>
                        </svg>
                      </IconButton>
                      <template v-else>
                        <IconButton
                          size="sm"
                          :title="plugin.enabled ? '禁用插件' : '启用插件'"
                          :disabled="pluginBusy"
                          @click="handleClaudePluginAction(plugin.enabled ? 'disablePlugin' : 'enablePlugin', {
                            pluginId: plugin.installedPluginId || plugin.id,
                            scope: plugin.installedScope || getMarketplaceDefaultScope(),
                            successMessage: plugin.enabled ? '插件已禁用' : '插件已启用'
                          })"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <template v-if="plugin.enabled">
                              <circle cx="12" cy="12" r="9"/>
                              <path d="M5.64 18.36L18.36 5.64"/>
                            </template>
                            <template v-else>
                              <path d="M12 2v10"/>
                              <path d="M18.36 6.64a9 9 0 1 1-12.72 0"/>
                            </template>
                          </svg>
                        </IconButton>
                        <IconButton
                          size="sm"
                          title="更新插件"
                          :disabled="pluginBusy"
                          @click="handleClaudePluginAction('updatePlugin', {
                            pluginId: plugin.installedPluginId || plugin.id,
                            scope: plugin.installedScope || getMarketplaceDefaultScope(),
                            successMessage: '插件已更新'
                          })"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="23 4 23 10 17 10"/>
                            <polyline points="1 20 1 14 7 14"/>
                            <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"/>
                            <path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"/>
                          </svg>
                        </IconButton>
                        <IconButton
                          size="sm"
                          danger
                          title="卸载插件"
                          :disabled="pluginBusy"
                          @click="handleClaudePluginAction('uninstallPlugin', {
                            pluginId: plugin.installedPluginId || plugin.id,
                            scope: plugin.installedScope || getMarketplaceDefaultScope(),
                            successMessage: '插件已卸载'
                          })"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="3 6 5 6 21 6"/>
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                          </svg>
                        </IconButton>
                      </template>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else class="empty-state">
                <p>{{ selectedMarketplace ? '当前市场暂无插件' : '暂无插件市场' }}</p>
                <p class="hint">{{ selectedMarketplace ? '这个市场还没有可展示的插件' : '可以添加 Claude 插件市场并直接在这里安装插件' }}</p>
              </div>
            </template>
          </div>

          <div v-if="activeSection === 'marketplace' && normalizedProvider === 'codex'" class="tab-panel marketplace-panel">
            <div class="panel-header">
              <div class="marketplace-header-left">
                <IconButton
                  v-if="selectedMarketplace"
                  size="sm"
                  title="返回市场列表"
                  @click="closeMarketplaceDetail"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="15 18 9 12 15 6"/>
                  </svg>
                </IconButton>
                <span v-if="selectedMarketplace" class="provider-card-title marketplace-header-title">
                  {{ selectedMarketplace.name }}
                </span>
              </div>
              <div class="panel-header-right">
                <template v-if="selectedMarketplace">
                  <div class="marketplace-controls inline">
                    <div class="hook-filter-bar">
                      <div class="hook-filter-options">
                        <button
                          type="button"
                          class="hook-filter-btn"
                          :class="{ active: codexMarketplaceInstallFilter.includes('installed') }"
                          @click="toggleCodexMarketplaceInstallFilter('installed')"
                        >
                          已安装
                        </button>
                        <button
                          type="button"
                          class="hook-filter-btn"
                          :class="{ active: codexMarketplaceInstallFilter.includes('uninstalled') }"
                          @click="toggleCodexMarketplaceInstallFilter('uninstalled')"
                        >
                          未安装
                        </button>
                      </div>
                    </div>
                    <div class="marketplace-search">
                      <input
                        v-model="codexMarketplaceSearch"
                        type="text"
                        class="marketplace-search-input"
                        placeholder="搜索插件名称、描述、开发者..."
                      >
                    </div>
                  </div>
                </template>
                <span class="count-badge">{{ selectedMarketplace ? selectedMarketplace.pluginCount : filteredMarketplaces.length }}</span>
                <IconButton
                  size="sm"
                  title="刷新市场"
                  :disabled="pluginBusy || inspectorLoading"
                  @click="refreshInspector"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="23 4 23 10 17 10"/>
                    <polyline points="1 20 1 14 7 14"/>
                    <path d="M3.51 9a9 9 0 0 1 14.13-3.36L23 10"/>
                    <path d="M20.49 15a9 9 0 0 1-14.13 3.36L1 14"/>
                  </svg>
                </IconButton>
              </div>
            </div>

            <p v-if="inspectorError" class="error-msg">{{ inspectorError }}</p>
            <p v-else-if="pluginActionError" class="error-msg">{{ pluginActionError }}</p>

            <div v-if="inspectorLoading" class="loading-state">
              <div class="spinner"></div>
              <p>读取插件市场中...</p>
            </div>

            <template v-else>
              <div v-if="!selectedMarketplace && filteredMarketplaces.length > 0" class="marketplace-list">
                <div
                  v-for="marketplace in filteredMarketplaces"
                  :key="marketplace.id"
                  class="marketplace-card"
                  @click="openMarketplaceDetail(marketplace)"
                >
                  <div class="marketplace-header">
                    <div class="marketplace-main">
                      <div class="plugin-list-header-main">
                        <div class="plugin-avatar plugin-avatar-placeholder">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 3H5a2 2 0 0 0-2 2v4"/>
                            <path d="M15 3h4a2 2 0 0 1 2 2v4"/>
                            <path d="M21 15v4a2 2 0 0 1-2 2h-4"/>
                            <path d="M3 15v4a2 2 0 0 0 2 2h4"/>
                            <path d="M9 9h6v6H9z"/>
                          </svg>
                        </div>
                        <span class="provider-card-title">{{ marketplace.name }}</span>
                        <span class="meta-chip">{{ marketplace.pluginCount }} 个插件</span>
                      </div>
                      <div class="plugin-list-meta">
                        <span class="meta-chip">来源: {{ marketplace.sourceType || 'catalog' }}</span>
                      </div>
                      <p class="provider-card-desc">{{ marketplace.description || '来自 Codex 本地 catalog / cache 的可浏览插件集合' }}</p>
                    </div>
                  </div>
                </div>
              </div>

              <template v-else-if="selectedMarketplace">
                <div class="marketplace-plugin-list">
                <div
                  v-for="plugin in filteredCodexMarketplacePlugins"
                  :key="plugin.id"
                  class="marketplace-plugin-row"
                  @click="openPluginDetail(plugin)"
                >
                  <div class="marketplace-plugin-top">
                    <img
                      v-if="plugin.logoPath"
                      :src="resolvePluginLogoSrc(plugin.logoPath)"
                      alt=""
                      class="plugin-avatar marketplace-plugin-avatar"
                    >
                    <div v-else class="plugin-avatar plugin-avatar-placeholder marketplace-plugin-avatar">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M14 4h6v6"/>
                        <path d="M10 20H4v-6"/>
                        <path d="M20 10V4h-6"/>
                        <path d="M4 14v6h6"/>
                        <path d="M9 9h6v6H9z"/>
                      </svg>
                    </div>
                    <div class="marketplace-plugin-main">
                      <div class="marketplace-plugin-title-row">
                        <span class="provider-card-title marketplace-plugin-title">{{ plugin.displayName || plugin.name }}</span>
                        <span v-if="codexMarketplacePluginState(plugin).installed" class="meta-chip active">已安装</span>
                      </div>
                      <div class="provider-card-badges marketplace-plugin-badges">
                        <span v-if="plugin.version" class="meta-chip">v{{ plugin.version }}</span>
                        <span v-if="plugin.developerName" class="meta-chip">作者: {{ plugin.developerName }}</span>
                        <span v-if="codexMarketplacePluginState(plugin).installed && !codexMarketplacePluginState(plugin).enabled" class="meta-chip disabled-state-badge">已禁用</span>
                        <span class="meta-chip">{{ pluginSummary(plugin) }}</span>
                      </div>
                    </div>
                    <div class="card-actions marketplace-plugin-actions">
                        <IconButton
                          v-if="!codexMarketplacePluginState(plugin).installed"
                          size="sm"
                          title="安装插件"
                          :disabled="pluginBusy"
                          @click.stop="openPluginInstallDialog(plugin)"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="12" y1="5" x2="12" y2="19"/>
                            <line x1="5" y1="12" x2="19" y2="12"/>
                          </svg>
                        </IconButton>
                        <template v-else>
                          <IconButton
                            size="sm"
                            :title="codexMarketplacePluginState(plugin).enabled ? '禁用插件' : '启用插件'"
                            :disabled="pluginBusy"
                            @click.stop="handleCodexPluginAction(codexMarketplacePluginState(plugin).enabled ? 'disablePlugin' : 'enablePlugin', {
                              pluginId: plugin.pluginId || plugin.pluginRef || plugin.id,
                              scope: 'user',
                              successMessage: codexMarketplacePluginState(plugin).enabled ? '插件已禁用' : '插件已启用'
                            })"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <template v-if="codexMarketplacePluginState(plugin).enabled">
                                <circle cx="12" cy="12" r="9"/>
                                <path d="M5.64 18.36L18.36 5.64"/>
                              </template>
                              <template v-else>
                                <path d="M12 2v10"/>
                                <path d="M18.36 6.64a9 9 0 1 1-12.72 0"/>
                              </template>
                            </svg>
                          </IconButton>
                          <IconButton
                            size="sm"
                            danger
                            title="卸载插件"
                            :disabled="pluginBusy"
                            @click.stop="handleCodexPluginAction('uninstallPlugin', {
                              pluginId: plugin.pluginId || plugin.pluginRef || plugin.id,
                              scope: codexMarketplacePluginState(plugin).scope || pluginInstallForm.scope || 'user',
                              successMessage: '插件已卸载'
                            })"
                          >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                              <polyline points="3 6 5 6 21 6"/>
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                            </svg>
                          </IconButton>
                        </template>
                    </div>
                  </div>
                  <p class="provider-card-desc marketplace-plugin-desc">{{ plugin.description || '暂无描述' }}</p>
                </div>
                </div>
                <div v-if="filteredCodexMarketplacePlugins.length === 0" class="empty-state compact">
                  <p>没有符合条件的插件</p>
                </div>
              </template>

              <div v-else class="empty-state">
                <p>暂无可展示的插件市场</p>
                <p class="hint">当前没有从 Codex 本地 catalog / cache 解析到市场数据</p>
              </div>
            </template>
          </div>

          <BaseDialog
            v-model="showSubagentEditor"
            :title="subagentEditorMode === 'create' ? '添加 SubAgent' : '编辑 SubAgent'"
            width="620px"
            @close="closeSubagentEditor"
          >
            <div class="hook-editor-form">
              <div class="hook-form-row">
                <div class="hook-form-field">
                  <span>作用域</span>
                  <AppSelect
                    :model-value="subagentForm.scope"
                    :options="hookEditableScopeOptions"
                    @update:model-value="subagentForm.scope = $event"
                  />
                </div>
                <div class="hook-form-field">
                  <span>名称</span>
                  <input v-model="subagentForm.name" type="text" placeholder="例如：reviewer">
                </div>
              </div>
              <div class="hook-form-field">
                <span>描述</span>
                <input v-model="subagentForm.description" type="text" placeholder="简单描述这个 SubAgent 的职责">
              </div>
              <div class="hook-form-row">
                <div class="hook-form-field">
                  <span>模型</span>
                  <input v-model="subagentForm.model" type="text" placeholder="可选">
                </div>
                <div class="hook-form-field">
                  <span>Tools</span>
                  <input v-model="subagentForm.toolsText" type="text" placeholder="逗号分隔，如 Read, Edit, Bash">
                </div>
              </div>
              <div class="hook-form-field">
                <span>Prompt</span>
                <textarea v-model="subagentForm.prompt" placeholder="输入 SubAgent 的系统提示词"></textarea>
              </div>
            </div>
            <template #footer>
              <div class="hook-dialog-footer">
                <p v-if="pluginActionError" class="error-msg hook-dialog-footer-error">{{ pluginActionError }}</p>
                <div class="hook-dialog-footer-actions">
                  <button class="toolbar-btn" :disabled="pluginBusy" @click="closeSubagentEditor">取消</button>
                  <button class="action-btn primary" :disabled="pluginBusy" @click="submitSubagentForm">
                    {{ pluginBusy ? '保存中...' : '保存' }}
                  </button>
                </div>
              </div>
            </template>
          </BaseDialog>

          <BaseDialog
            v-model="showSubagentDeleteConfirm"
            title="删除 SubAgent"
            width="420px"
            @close="closeSubagentDeleteDialog"
          >
            <div class="hook-delete-copy">
              <p>确认删除这个 SubAgent 吗？</p>
              <p class="hint">{{ deletingSubagent?.title || deletingSubagent?.name || '' }}</p>
            </div>
            <template #footer>
              <div class="hook-dialog-footer">
                <p v-if="pluginActionError" class="error-msg hook-dialog-footer-error">{{ pluginActionError }}</p>
                <div class="hook-dialog-footer-actions">
                  <button class="toolbar-btn" :disabled="pluginBusy" @click="closeSubagentDeleteDialog">取消</button>
                  <button class="action-btn danger" :disabled="pluginBusy" @click="confirmDeleteSubagent">
                    {{ pluginBusy ? '删除中...' : '删除' }}
                  </button>
                </div>
              </div>
            </template>
          </BaseDialog>

          <BaseDialog
            v-model="showMarketplaceDialog"
            title="添加插件市场"
            width="520px"
            @close="closeMarketplaceDialog"
          >
            <div class="hook-editor-form">
              <div v-if="props.projectPath" class="hook-form-field">
                <span>添加到</span>
                <AppSelect
                  :model-value="marketplaceForm.scope"
                  :options="hookEditableScopeOptions"
                  @update:model-value="marketplaceForm.scope = $event"
                />
              </div>
              <div class="hook-form-field">
                <span>市场来源</span>
                <input
                  v-model="marketplaceForm.source"
                  type="text"
                  placeholder="GitHub 仓库、URL 或本地路径"
                  :disabled="pluginBusy"
                >
              </div>
            </div>

            <template #footer>
              <div class="hook-dialog-footer">
                <p v-if="pluginActionError" class="error-msg hook-dialog-footer-error">{{ pluginActionError }}</p>
                <div class="hook-dialog-footer-actions">
                  <button class="toolbar-btn" :disabled="pluginBusy" @click="closeMarketplaceDialog">取消</button>
                  <button class="action-btn primary" :disabled="pluginBusy" @click="handleAddMarketplace">
                    {{ pluginBusy ? '添加中...' : '添加' }}
                  </button>
                </div>
              </div>
            </template>
          </BaseDialog>

          <BaseDialog
            v-model="showPluginInstallDialog"
            title="安装插件"
            width="420px"
            @close="closePluginInstallDialog"
          >
            <div class="hook-editor-form">
              <div class="hook-form-field">
                <span>插件</span>
                <input :value="installingMarketplacePlugin?.displayName || installingMarketplacePlugin?.name || ''" type="text" disabled>
              </div>
              <div class="hook-form-field">
                <span>安装到</span>
                <AppSelect
                  :model-value="pluginInstallForm.scope"
                  :options="pluginInstallScopeOptions"
                  @update:model-value="pluginInstallForm.scope = $event"
                />
              </div>
            </div>

            <template #footer>
              <div class="hook-dialog-footer">
                <p v-if="pluginActionError" class="error-msg hook-dialog-footer-error">{{ pluginActionError }}</p>
                <div class="hook-dialog-footer-actions">
                  <button class="toolbar-btn" :disabled="pluginBusy" @click="closePluginInstallDialog">取消</button>
                  <button class="action-btn primary" :disabled="pluginBusy" @click="confirmInstallMarketplacePlugin">
                    {{ pluginBusy ? '安装中...' : '安装' }}
                  </button>
                </div>
              </div>
            </template>
          </BaseDialog>

          <BaseDialog
            v-model="showPluginDetail"
            :title="selectedPlugin ? (selectedPlugin.displayName || selectedPlugin.name || '插件详情') : '插件详情'"
            width="760px"
            @close="closePluginDetail"
          >
            <template v-if="selectedPlugin" #header>
              <div class="plugin-detail-dialog-title">
                <img
                  v-if="selectedPlugin.logoPath"
                  :src="resolvePluginLogoSrc(selectedPlugin.logoPath)"
                  alt=""
                  class="plugin-detail-dialog-avatar"
                >
                <div v-else class="plugin-avatar plugin-avatar-placeholder plugin-detail-dialog-avatar">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M14 4h6v6"/>
                    <path d="M10 20H4v-6"/>
                    <path d="M20 10V4h-6"/>
                    <path d="M4 14v6h6"/>
                    <path d="M9 9h6v6H9z"/>
                  </svg>
                </div>
                <span class="plugin-detail-dialog-title-text">
                  {{ selectedPlugin.displayName || selectedPlugin.name || '插件详情' }}
                </span>
                <span v-if="selectedPlugin.version" class="meta-chip plugin-detail-title-chip">v{{ selectedPlugin.version }}</span>
              </div>
            </template>
            <div v-if="selectedPlugin" class="plugin-detail">
              <div class="plugin-detail-meta">
                <span v-if="isPluginDisabled(selectedPlugin)" class="meta-chip disabled-state-badge">已禁用</span>
              </div>

              <p
                v-if="(normalizedProvider === 'codex' ? (selectedPlugin.longDescription || selectedPlugin.description) : selectedPlugin.description)"
                class="provider-card-desc plugin-detail-desc"
              >
                {{ normalizedProvider === 'codex' ? (selectedPlugin.longDescription || selectedPlugin.description) : selectedPlugin.description }}
              </p>

              <template v-if="normalizedProvider === 'codex'">
                <div class="plugin-detail-body">
                <div class="plugin-detail-section">
                  <div class="plugin-detail-section-title">内容</div>
                  <div class="detail-tabs">
                    <button
                      v-for="tab in pluginDetailTabs(selectedPlugin)"
                      :key="`plugin-detail-${tab.key}`"
                      type="button"
                      class="detail-tab"
                      :class="{ active: pluginDetailTab === tab.key }"
                      @click="pluginDetailTab = tab.key"
                    >
                      {{ tab.label }}
                      <span class="count-badge small">{{ tab.count }}</span>
                    </button>
                  </div>

                  <div v-if="pluginDetailTab === 'skills'" class="plugin-detail-list">
                    <div v-if="pluginDetailItems(selectedPlugin, 'skills').length > 0">
                      <div
                        v-for="skill in pluginDetailItems(selectedPlugin, 'skills')"
                        :key="skill.id"
                        class="plugin-detail-item"
                        @click="openPluginSkillDetail(skill)"
                      >
                        <div class="plugin-detail-item-title">{{ skill.name }}</div>
                        <p class="plugin-detail-item-desc">{{ skill.description || '暂无描述' }}</p>
                      </div>
                    </div>
                    <div v-else class="empty-state compact">
                      <p>暂无技能内容</p>
                    </div>
                  </div>

                  <div v-else-if="pluginDetailTab === 'apps'" class="plugin-detail-list">
                    <div v-if="pluginDetailItems(selectedPlugin, 'apps').length > 0">
                      <div
                        v-for="app in pluginDetailItems(selectedPlugin, 'apps')"
                        :key="app.id"
                        class="plugin-detail-item"
                      >
                        <div class="plugin-detail-item-title-row plugin-agent-title-row">
                          <div class="plugin-list-header-main">
                            <div class="plugin-detail-item-title">{{ app.name }}</div>
                            <span v-if="app.needsAuth" class="meta-chip">需要授权</span>
                          </div>
                        </div>
                        <div class="subagent-item-body plugin-agent-item-body">
                          <p class="plugin-detail-item-desc">
                            <span class="subagent-field-label">description:</span>
                            {{ app.description || '暂无描述' }}
                          </p>
                          <p v-if="app.installUrl" class="plugin-detail-item-desc">
                            <span class="subagent-field-label">installUrl:</span>
                            {{ app.installUrl }}
                          </p>
                        </div>
                      </div>
                    </div>
                    <div v-else class="empty-state compact">
                      <p>暂无应用内容</p>
                    </div>
                  </div>

                  <div v-else-if="pluginDetailTab === 'mcp'" class="plugin-detail-list">
                    <div v-if="pluginDetailItems(selectedPlugin, 'mcp').length > 0">
                      <div
                        v-for="mcp in pluginDetailItems(selectedPlugin, 'mcp')"
                        :key="mcp.id"
                        class="plugin-detail-mcp-card"
                        :class="{ disabled: mcp.pluginEnabled === false }"
                      >
                        <div class="plugin-detail-mcp-header">
                          <div class="plugin-list-header-main">
                            <span class="plugin-detail-mcp-name">{{ mcp.title || mcp.name }}</span>
                            <span v-if="mcp.transport" class="meta-chip plugin-detail-inline-chip">{{ mcp.transport }}</span>
                          </div>
                          <div class="plugin-detail-mcp-badges">
                            <span v-if="mcp.pluginEnabled === false" class="plugin-detail-source-badge disabled-state-badge">已禁用</span>
                            <span v-if="mcp.version" class="version-badge">v{{ mcp.version }}</span>
                          </div>
                        </div>
                        <p class="plugin-detail-mcp-desc">{{ mcp.description || '暂无描述' }}</p>
                      </div>
                    </div>
                    <div v-else class="empty-state compact">
                      <p>暂无 MCP 内容</p>
                    </div>
                  </div>
                </div>

                <div v-if="codexPluginInfoRows(selectedPlugin).length > 0" class="plugin-detail-section">
                  <div class="plugin-detail-section-title">信息</div>
                  <div class="plugin-detail-info-table">
                    <div
                      v-for="row in codexPluginInfoRows(selectedPlugin)"
                      :key="`codex-info-${row.key}`"
                      class="plugin-detail-info-row"
                    >
                      <div class="plugin-detail-info-label">{{ row.label }}</div>
                      <div class="plugin-detail-info-value">{{ row.value }}</div>
                    </div>
                  </div>
                </div>
                </div>
              </template>

              <template v-else>
                <div class="plugin-detail-body">
                <div class="plugin-detail-section">
                  <div class="plugin-detail-section-title">内容</div>
                <div class="detail-tabs">
                  <button
                    v-for="tab in pluginDetailTabs(selectedPlugin)"
                    :key="`plugin-detail-${tab.key}`"
                    type="button"
                    class="detail-tab"
                    :class="{ active: pluginDetailTab === tab.key }"
                    @click="pluginDetailTab = tab.key"
                  >
                    {{ tab.label }}
                    <span class="count-badge small">{{ tab.count }}</span>
                  </button>
                </div>

                <div v-if="pluginDetailTab === 'skills'" class="plugin-detail-list">
                  <div v-if="pluginDetailItems(selectedPlugin, 'skills').length > 0">
                    <div
                      v-for="skill in pluginDetailItems(selectedPlugin, 'skills')"
                      :key="skill.id"
                      class="plugin-detail-item"
                      @click="openPluginSkillDetail(skill)"
                    >
                      <div class="plugin-detail-item-title">{{ skill.name }}</div>
                      <p class="plugin-detail-item-desc">{{ skill.description || '暂无描述' }}</p>
                    </div>
                  </div>
                  <div v-else class="empty-state compact">
                    <p>暂无技能内容</p>
                  </div>
                </div>

                <div v-else-if="pluginDetailTab === 'apps'" class="plugin-detail-list">
                  <div v-if="pluginDetailItems(selectedPlugin, 'apps').length > 0">
                    <div
                      v-for="app in pluginDetailItems(selectedPlugin, 'apps')"
                      :key="app.id"
                      class="plugin-detail-item"
                    >
                      <div class="plugin-detail-item-title-row plugin-agent-title-row">
                        <div class="plugin-list-header-main">
                          <div class="plugin-detail-item-title">{{ app.name }}</div>
                          <span v-if="app.needsAuth" class="meta-chip">需要授权</span>
                        </div>
                      </div>
                      <div class="subagent-item-body plugin-agent-item-body">
                        <p class="plugin-detail-item-desc">
                          <span class="subagent-field-label">description:</span>
                          {{ app.description || '暂无描述' }}
                        </p>
                        <p v-if="app.installUrl" class="plugin-detail-item-desc">
                          <span class="subagent-field-label">installUrl:</span>
                          {{ app.installUrl }}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div v-else class="empty-state compact">
                    <p>暂无应用内容</p>
                  </div>
                </div>

                <div v-else-if="pluginDetailTab === 'hooks'" class="plugin-detail-list">
                  <div v-if="pluginDetailItems(selectedPlugin, 'hooks').length > 0">
                    <div
                      v-for="hook in pluginDetailItems(selectedPlugin, 'hooks')"
                      :key="hook.id"
                      class="hook-entry-card"
                    >
                      <div class="hook-entry-meta-row compact left-aligned">
                        <span class="hook-entry-heading">{{ hook.pluginName || hook.eventName }}</span>
                      </div>
                      <div class="hook-inline-row">
                        <span class="hook-field-label">Matcher:</span>
                        <div class="provider-card-badges">
                          <span
                            v-for="token in String(hook.matcher || '默认匹配').split('|').filter(Boolean)"
                            :key="`${hook.id}-detail-matcher-${token}`"
                            class="source-badge"
                          >
                            {{ token }}
                          </span>
                        </div>
                      </div>
                      <div class="hook-inline-row command">
                        <span class="hook-field-label">{{ getHookContentLabel(hook) }}:</span>
                        <div class="provider-card-badges inline hook-command-badges">
                          <span class="source-badge">{{ hook.async ? 'ASYNC' : 'SYNC' }}</span>
                        </div>
                        <div class="hook-command-value">{{ hook.summary || '暂无内容' }}</div>
                      </div>
                    </div>
                  </div>
                  <div v-else class="empty-state compact">
                    <p>暂无 Hook 内容</p>
                  </div>
                </div>

                <div v-else-if="pluginDetailTab === 'mcp'" class="plugin-detail-list">
                  <div v-if="pluginDetailItems(selectedPlugin, 'mcp').length > 0">
                    <div
                      v-for="mcp in pluginDetailItems(selectedPlugin, 'mcp')"
                      :key="mcp.id"
                      class="plugin-detail-mcp-card"
                      :class="{ disabled: mcp.pluginEnabled === false }"
                    >
                      <div class="plugin-detail-mcp-header">
                        <div class="plugin-list-header-main">
                          <span class="plugin-detail-mcp-name">{{ mcp.title || mcp.name }}</span>
                          <span v-if="mcp.transport" class="meta-chip plugin-detail-inline-chip">{{ mcp.transport }}</span>
                        </div>
                        <div class="plugin-detail-mcp-badges">
                          <span v-if="mcp.pluginEnabled === false" class="plugin-detail-source-badge disabled-state-badge">已禁用</span>
                          <span v-if="mcp.version" class="version-badge">v{{ mcp.version }}</span>
                        </div>
                      </div>
                      <p class="plugin-detail-mcp-desc">{{ mcp.description || '暂无描述' }}</p>
                    </div>
                  </div>
                  <div v-else class="empty-state compact">
                    <p>暂无 MCP 内容</p>
                  </div>
                </div>

                <div v-else-if="pluginDetailTab === 'agents'" class="plugin-detail-list">
                  <div v-if="pluginDetailItems(selectedPlugin, 'agents').length > 0">
                    <div
                      v-for="agent in pluginDetailItems(selectedPlugin, 'agents')"
                      :key="agent.id"
                      class="plugin-detail-item"
                      @click="openPluginAgentDetail(agent)"
                      >
                      <div class="plugin-detail-item-title-row plugin-agent-title-row">
                        <div class="plugin-list-header-main">
                          <div class="plugin-detail-item-title">{{ agent.title || agent.name }}</div>
                        </div>
                      </div>
                      <div class="subagent-item-body plugin-agent-item-body">
                        <p class="plugin-detail-item-desc">
                          <span class="subagent-field-label">description:</span>
                          {{ agent.description || '暂无描述' }}
                        </p>
                        <p v-if="agent.tools?.length" class="plugin-detail-item-desc">
                          <span class="subagent-field-label">tools:</span>
                          {{ agent.tools.join(', ') }}
                        </p>
                        <p v-if="agent.model" class="plugin-detail-item-desc">
                          <span class="subagent-field-label">model:</span>
                          {{ agent.model }}
                        </p>
                        <p v-if="agent.permissionMode" class="plugin-detail-item-desc">
                          <span class="subagent-field-label">permissionMode:</span>
                          {{ agent.permissionMode }}
                        </p>
                        <p v-if="agent.skills?.length" class="plugin-detail-item-desc">
                          <span class="subagent-field-label">skills:</span>
                          {{ agent.skills.join(', ') }}
                        </p>
                      </div>
                    </div>
                  </div>
                  <div v-else class="empty-state compact">
                    <p>暂无 Agent 内容</p>
                  </div>
                </div>
                </div>
                </div>
              </template>
            </div>
          </BaseDialog>

          <BaseDialog
            v-model="showPluginSkillDetail"
            :title="viewingPluginSkill ? viewingPluginSkill.name : '技能详情'"
            width="760px"
            @close="closePluginSkillDetail"
          >
            <div v-if="viewingPluginSkill" class="plugin-skill-detail">
              <div class="detail-tabs">
                <button
                  type="button"
                  class="detail-tab"
                  :class="{ active: pluginSkillDetailTab === 'content' }"
                  @click="pluginSkillDetailTab = 'content'"
                >
                  内容
                </button>
                <button
                  v-if="pluginSkillLicense"
                  type="button"
                  class="detail-tab"
                  :class="{ active: pluginSkillDetailTab === 'license' }"
                  @click="pluginSkillDetailTab = 'license'"
                >
                  许可
                </button>
                <button
                  type="button"
                  class="detail-tab"
                  :class="{ active: pluginSkillDetailTab === 'files' }"
                  @click="pluginSkillDetailTab = 'files'"
                >
                  文件
                </button>
              </div>

              <div class="plugin-skill-detail-body">
                <div v-if="isLoadingPluginSkillReadme" class="loading-state plugin-skill-loading">
                  <div class="spinner"></div>
                </div>
                <template v-else>
                  <div v-if="pluginSkillDetailTab === 'content'">
                    <MarkdownRenderer v-if="pluginSkillReadme" :content="pluginSkillReadme" />
                    <div v-else class="empty-state compact">
                      <p>无法读取 SKILL.md</p>
                    </div>
                  </div>
                  <div v-else-if="pluginSkillDetailTab === 'license'" class="license-content">
                    <pre>{{ pluginSkillLicense }}</pre>
                  </div>
                  <div v-else-if="pluginSkillDetailTab === 'files'" class="file-tree">
                    <div
                      v-for="(item, index) in flattenedPluginSkillTree"
                      :key="`${viewingPluginSkill.id}-tree-${index}`"
                      class="tree-item"
                      :style="{ paddingLeft: `${item.depth * 16 + 4}px` }"
                    >
                      <span class="tree-icon">{{ item.type === 'dir' ? '📁' : '📄' }}</span>
                      <span class="tree-name">{{ item.name }}</span>
                    </div>
                    <div v-if="flattenedPluginSkillTree.length === 0" class="empty-state compact">
                      <p>空目录</p>
                    </div>
                  </div>
                </template>
              </div>
            </div>
          </BaseDialog>

          <BaseDialog
            v-model="showPluginAgentDetail"
            :title="viewingPluginAgent ? (viewingPluginAgent.title || viewingPluginAgent.name) : 'Agent 详情'"
            width="760px"
            @close="closePluginAgentDetail"
          >
            <div v-if="viewingPluginAgent" class="plugin-agent-detail">
              <MarkdownRenderer
                v-if="viewingPluginAgent.content"
                :content="viewingPluginAgent.content"
              />
              <div v-else class="empty-state compact">
                <p>当前 Agent 没有可展示的 Markdown 内容</p>
              </div>
            </div>
          </BaseDialog>
        </div>
      </div>
    </div>

    <DefaultConfigDialog
      v-if="showDefaultConfigDialog"
      :visible="showDefaultConfigDialog"
      :config="defaultConfig"
      :effort-options="effortOptions"
      @close="showDefaultConfigDialog = false"
      @save="handleSaveProviderConfig"
    />

    <CodexConfigDialog
      v-if="showCodexConfigDialog"
      :visible="showCodexConfigDialog"
      :config="codexConfig"
      @close="showCodexConfigDialog = false"
      @save="handleSaveProviderConfig"
    />

    <ModelMappingDialog
      v-if="showMappingDialog"
      :visible="showMappingDialog"
      :model="pendingModel?.model || null"
      @close="showMappingDialog = false"
      @confirm="handleMappingConfirm"
    />

    <ModelEditDialog
      v-if="showModelDialog"
      :visible="showModelDialog"
      :model="editingModel"
      :model-type="editingModelType"
      @close="showModelDialog = false"
      @save="handleSaveProviderModel"
    />

    <CodexAccountEditDialog
      v-if="showCodexAccountDialog"
      :visible="showCodexAccountDialog"
      :account="editingCodexAccount"
      @close="showCodexAccountDialog = false"
      @save="handleSaveProviderAccount"
    />
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}

.provider-dialog {
  --app-soft-surface: rgba(255, 255, 255, 0.024);
  --app-soft-surface-hover: rgba(255, 255, 255, 0.05);
  --app-soft-panel: rgba(255, 255, 255, 0.018);
  --app-soft-border: rgba(255, 255, 255, 0.13);
  --app-soft-border-hover: rgba(255, 255, 255, 0.18);
  --app-soft-panel-border: rgba(255, 255, 255, 0.08);
  background: #1F1F23;
  border-radius: 16px;
  width: min(960px, calc(100vw - 72px));
  height: min(700px, calc(100vh - 72px));
  display: flex;
  flex-direction: column;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background:
    radial-gradient(circle at top right, rgba(249, 115, 22, 0.06), transparent 26%),
    linear-gradient(180deg, #1B1E23 0%, #17191D 100%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 24px 64px rgba(0, 0, 0, 0.46);
  overflow: hidden;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid #3F3F46;
}

.dialog-header h2 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  color: #F4F4F5;
}

.close-btn {
  background: transparent;
  border: none;
  color: #9CA3AF;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.close-btn:hover {
  color: #F4F4F5;
  background: #3F3F46;
}

.dialog-body {
  flex: 1;
  display: flex;
  min-height: 0;
  background: transparent;
}

.market-nav {
  width: 168px;
  border-right: 1px solid #3F3F46;
  padding: 14px 0;
  overflow-y: auto;
  flex-shrink: 0;
  background: #18181C;
  display: flex;
  flex-direction: column;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 18px;
  color: #A1A1AA;
  cursor: pointer;
  transition: all 0.2s ease;
  border-left: 3px solid transparent;
  font-size: 14px;
}

.nav-icon {
  width: 18px;
  height: 18px;
  flex: 0 0 18px;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.nav-icon-emphasis {
  width: 19px;
  height: 19px;
  flex-basis: 19px;
}

.nav-item.spacer {
  height: 18px;
  padding: 0;
  cursor: default;
  pointer-events: none;
  background: transparent;
}

.nav-item.bottom {
  margin-top: auto;
}

.nav-item:hover {
  background: rgba(255, 255, 255, 0.04);
  color: #F4F4F5;
}

.nav-item.active {
  background: rgba(249, 115, 22, 0.12);
  color: #FB923C;
  border-left-color: #F97316;
}

.provider-content {
  flex: 1;
  overflow: hidden;
  padding: 18px;
  min-width: 0;
  background: transparent;
}

.tab-panel {
  min-height: 100%;
  background: rgba(255, 255, 255, 0.018);
  border: 1px solid #34343A;
  border-radius: 14px;
  padding: 18px;
  box-sizing: border-box;
}

.settings-panel {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  height: 100%;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
}

.hooks-panel {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
}

.plugins-panel {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
}

.marketplace-panel {
  background: transparent;
  border: none;
  border-radius: 0;
  padding: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.settings-panel :deep(.settings-section) {
  background: transparent;
  box-shadow: none;
  padding: 0;
  margin-bottom: 0;
}

.settings-panel :deep(.provider-tabs) {
  margin-top: 0;
  padding-top: 0;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  gap: 12px;
}

.panel-header-main {
  display: flex;
  flex-direction: row;
  align-items: flex-start;
  gap: 10px;
  min-width: 0;
  flex: 1;
  flex-wrap: wrap;
}

.hooks-panel-header {
  flex-direction: column;
  align-items: stretch;
}

.hook-header-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  min-width: 0;
  flex-wrap: wrap;
}

.hook-header-top {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
}

.hook-header-bottom {
  display: flex;
  justify-content: flex-end;
  width: 100%;
}

.panel-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #F4F4F5;
}

.panel-header-right {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.hook-filter-bar {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.hook-filter-label {
  color: #A1A1AA;
  font-size: 12px;
  line-height: 1;
  flex-shrink: 0;
}

.hook-filter-options {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.hook-disable-bar {
  display: flex;
  align-items: center;
}

.hook-disable-switches {
  display: flex;
  align-items: center;
  gap: 0;
  flex-wrap: nowrap;
  padding: 0;
}

.hook-disable-switch-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 2px 6px 2px 8px;
  min-height: 24px;
}

.hook-disable-switch-item + .hook-disable-switch-item {
  border-left: 1px solid rgba(255, 255, 255, 0.08);
}

.hook-disable-switch-label {
  color: #D4D4D8;
  font-size: 11px;
  line-height: 1;
}

.hook-filter-btn {
  border: 1px solid #3F3F46;
  background: #27272A;
  color: #D4D4D8;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
  transition: all 0.18s ease;
}

.hook-filter-btn:hover {
  color: #F4F4F5;
  border-color: #52525B;
}

.hook-filter-btn.active {
  background: rgba(249, 115, 22, 0.14);
  color: #FB923C;
  border-color: rgba(249, 115, 22, 0.35);
}

.status-pill,
.count-badge,
.source-badge,
.meta-chip {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 2px 6px;
  border-radius: 4px;
  font-size: 11px;
  line-height: 1;
}

.status-pill,
.count-badge,
.source-badge,
.meta-chip {
  background: #27272A;
  color: #D4D4D8;
  border: 1px solid #3F3F46;
}

.status-pill.active,
.source-badge.active,
.meta-chip.active {
  background: rgba(249, 115, 22, 0.14);
  color: #FB923C;
  border-color: rgba(249, 115, 22, 0.35);
}

.status-pill:not(.active):empty {
  display: none;
}

.source-badge.type,
.source-badge.version {
  color: #C4B5FD;
}

.config-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-bottom: 18px;
}

.view-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px;
  border: 1px solid #3F3F46;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.view-toggle-btn {
  border: none;
  background: transparent;
  color: #A1A1AA;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.view-toggle-btn:hover {
  color: #F4F4F5;
  background: rgba(255, 255, 255, 0.05);
}

.view-toggle-btn.active {
  color: #FB923C;
  background: rgba(249, 115, 22, 0.12);
}

.hook-group-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hook-rule-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.hook-group-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hook-group-card {
  background: #232329;
  border: 1px solid #3F3F46;
  border-radius: 12px;
  padding: 16px;
}

.hook-group-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.hook-group-title-wrap {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.hook-group-title {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
  color: #F4F4F5;
  line-height: 1.2;
}

.hook-group-header .provider-card-badges.inline {
  gap: 6px;
}

.hook-group-header .source-badge,
.hook-group-header .count-badge {
  padding: 2px 7px;
  font-size: 10px;
}

.hook-group-header .count-badge {
  min-width: 18px;
}

.hook-rule-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.hook-rule-main {
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 0;
}

.hook-rule-label {
  color: #A1A1AA;
  font-size: 12px;
}

.hook-rule-value {
  color: #F4F4F5;
  font-size: 14px;
  font-weight: 600;
  word-break: break-all;
}

.hook-entry-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.hook-entry-card {
  padding: 12px 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.hook-entry-card.disabled {
  border-color: rgba(249, 115, 22, 0.3);
}

.hook-entry-meta-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 12px;
}

.hook-entry-meta-row.compact {
  margin-bottom: 8px;
}

.hook-entry-meta-row.left-aligned {
  justify-content: flex-start;
  align-items: center;
  gap: 10px;
}

.hook-entry-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.hook-inline-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 6px;
}

.hook-inline-row.command {
  align-items: baseline;
}

.hook-entry-main {
  min-width: 0;
}

.hook-entry-heading {
  color: #F4F4F5;
  font-size: 18px;
  font-weight: 600;
  line-height: 1.2;
}

.hook-entry-card.disabled .hook-entry-heading {
  color: rgba(244, 244, 245, 0.8);
}

.hook-entry-card.disabled .hook-inline-row,
.hook-entry-card.disabled .hook-command-value,
.hook-entry-card.disabled .hook-entry-actions {
  opacity: 0.5;
}

.hook-entry-title-row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.hook-entry-title {
  color: #F4F4F5;
  font-size: 14px;
  font-weight: 600;
}

.hook-entry-desc {
  margin: 8px 0 0;
  color: #A1A1AA;
  font-size: 13px;
  line-height: 1.5;
}

.hook-command-value {
  color: #F4F4F5;
  font-size: 11px;
  line-height: 1.35;
  word-break: break-all;
  flex: 1;
  min-width: 0;
}

.provider-card-badges.inline {
  flex-wrap: nowrap;
}

.hook-entry-meta-row.left-aligned .provider-card-badges.inline .source-badge {
  padding: 2px 8px;
  font-size: 11px;
}

.hook-inline-row.command .hook-command-badges .source-badge {
  padding: 2px 7px;
  font-size: 10px;
}

.hook-inline-row .provider-card-badges .source-badge {
  padding: 2px 8px;
  font-size: 11px;
}

.hook-field-label {
  color: #A1A1AA;
  font-size: 12px;
  line-height: 1.8;
  flex-shrink: 0;
}

.hook-inline-row.command .hook-field-label {
  line-height: 1.35;
}

.hook-editor-form {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.hook-dialog-footer {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.hook-dialog-footer-error {
  margin: 0;
  flex: 1;
  min-width: 0;
}

.hook-dialog-footer-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-left: auto;
}

.hook-form-row {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  align-items: start;
}

.hook-form-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}

.hook-form-field span,
.hook-checkbox-field span {
  color: #A1A1AA;
  font-size: 12px;
  display: block;
  line-height: 1.2;
}

.hook-form-field input,
.hook-form-field textarea {
  width: 100%;
  padding: 8px 12px;
  height: 40px;
  min-height: 40px;
  border-radius: 8px;
  border: 1px solid #3F3F46;
  background: #232329;
  color: #F4F4F5;
  outline: none;
  box-sizing: border-box;
  font-size: 13px;
  line-height: 1.2;
}

.hook-form-field textarea {
  resize: vertical;
  height: auto;
  min-height: 92px;
}

.hook-form-field :deep(.app-select),
.hook-form-field :deep(.app-multi-select) {
  width: 100%;
  min-width: 0;
}

.hook-form-field :deep(.app-select-trigger),
.hook-form-field :deep(.app-multi-select-trigger) {
  min-height: 40px;
  height: 40px;
  border-radius: 8px;
  background: #232329;
  border-color: #3F3F46;
}

.hook-checkbox-field {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.toggle-switch {
  position: relative;
  display: inline-block;
  width: 36px;
  height: 20px;
  flex-shrink: 0;
}

.toggle-switch.compact {
  width: 28px;
  height: 16px;
}

.toggle-switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.toggle-slider {
  position: absolute;
  cursor: pointer;
  inset: 0;
  background: #3F3F46;
  border-radius: 20px;
  transition: background 0.2s;
}

.toggle-slider::before {
  content: '';
  position: absolute;
  height: 16px;
  width: 16px;
  left: 2px;
  bottom: 2px;
  background: #fff;
  border-radius: 50%;
  transition: transform 0.2s;
}

.toggle-switch.compact .toggle-slider::before {
  width: 12px;
  height: 12px;
}

.toggle-switch input:checked + .toggle-slider {
  background: #F97316;
}

.toggle-switch input:checked + .toggle-slider::before {
  transform: translateX(16px);
}

.toggle-switch.compact input:checked + .toggle-slider::before {
  transform: translateX(12px);
}

.toggle-switch input:disabled + .toggle-slider {
  cursor: not-allowed;
  opacity: 0.6;
}

.hook-delete-copy p {
  margin: 0;
}

.hook-delete-copy {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.config-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 12px 14px;
  border: 1px solid #3F3F46;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
}

.config-key {
  color: #A1A1AA;
  font-size: 12px;
  text-transform: uppercase;
}

.config-value,
.provider-path {
  color: #E4E4E7;
  font-size: 13px;
  word-break: break-all;
}

.provider-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: 14px;
}

.plugin-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.plugin-list-card {
  background: #232329;
  border: 1px solid #3F3F46;
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
}

.codex-plugin-list-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
}

.plugin-list-card.disabled {
  border-color: rgba(249, 115, 22, 0.3);
  background: #232329;
}

.plugin-list-card.disabled .provider-card-title,
.plugin-list-card.disabled .provider-card-desc {
  color: #A1A1AA;
}

.plugin-list-card.disabled .meta-chip:not(.disabled-state-badge) {
  color: #A1A1AA;
  background: rgba(63, 63, 70, 0.38);
}

.plugin-list-card.disabled .provider-card-title {
  color: rgba(244, 244, 245, 0.8);
}

.plugin-list-card.disabled .plugin-list-meta,
.plugin-list-card.disabled .card-actions,
.plugin-list-card.disabled .inline-hint {
  opacity: 0.5;
}

.plugin-list-card.disabled .plugin-list-desc {
  opacity: 0.58;
}

.plugin-list-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.plugin-list-header-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.plugin-avatar {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid #3F3F46;
  background: #232329;
}

.plugin-avatar-placeholder {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #A1A1AA;
}

.plugin-list-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  margin-top: 10px;
}

.plugin-list-desc {
  margin-bottom: 0;
}

.plugin-list-card .provider-card-title {
  font-size: 17px;
  line-height: 1.2;
}

.codex-plugin-list-card .meta-chip {
  padding: 2px 8px;
  font-size: 11px;
}

.plugin-detail {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 560px;
  min-height: 560px;
}

.plugin-detail-dialog-title {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
}

.plugin-detail-dialog-avatar {
  width: 24px;
  height: 24px;
  border-radius: 6px;
  flex-shrink: 0;
}

.plugin-detail-dialog-title-text {
  min-width: 0;
}

.plugin-detail-title-chip {
  padding: 2px 8px;
  font-size: 11px;
}

.plugin-detail-meta {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.plugin-detail-desc {
  margin: 0;
}

.plugin-detail-body {
  display: flex;
  flex-direction: column;
  gap: 20px;
  flex: 1;
  min-height: 0;
}

.plugin-detail-section {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.plugin-detail-section + .plugin-detail-section {
  margin-top: 20px;
}

.plugin-detail-section-title {
  color: #F4F4F5;
  font-size: 13px;
  font-weight: 600;
}

.plugin-detail-included {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.plugin-detail-included-group {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.plugin-detail-included-title {
  color: #A1A1AA;
  font-size: 12px;
  font-weight: 600;
}

.plugin-detail-info-table {
  border: 1px solid #3F3F46;
  border-radius: 12px;
  overflow: hidden;
  background: #232329;
}

.plugin-detail-info-row {
  display: grid;
  grid-template-columns: 120px minmax(0, 1fr);
  gap: 16px;
  align-items: start;
  padding: 14px 16px;
}

.plugin-detail-info-row + .plugin-detail-info-row {
  border-top: 1px solid #3F3F46;
}

.plugin-detail-info-label {
  color: #A1A1AA;
  font-size: 12px;
  font-weight: 600;
}

.plugin-detail-info-value {
  color: #F4F4F5;
  font-size: 13px;
  line-height: 1.6;
  word-break: break-word;
}

.detail-tabs {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.detail-tab {
  padding: 8px 16px;
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  color: #71717A;
  cursor: pointer;
  transition: all 0.2s;
  font-size: 13px;
}

.detail-tab:hover {
  color: #F4F4F5;
}

.detail-tab.active {
  color: #F97316;
  border-bottom-color: #F97316;
}

.plugin-detail-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
  padding-bottom: 12px;
}

.plugin-detail-item {
  border: 1px solid #3F3F46;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.02);
  padding: 12px 14px;
}

.plugin-detail-list .plugin-detail-item {
  cursor: pointer;
}

.plugin-detail-list .plugin-detail-item + .plugin-detail-item {
  margin-top: 2px;
}

.plugin-detail-item-title-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.plugin-detail-item-title {
  color: #F4F4F5;
  font-size: 14px;
  font-weight: 600;
  line-height: 1.3;
}

.plugin-detail-item-desc {
  margin: 8px 0 0;
  color: #A1A1AA;
  font-size: 12px;
  line-height: 1.6;
}

.plugin-detail-item-desc.monospace {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace;
  word-break: break-all;
}

.plugin-detail-mcp-card {
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid #3F3F46;
  border-radius: 10px;
  padding: 12px 14px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.plugin-detail-mcp-card.disabled {
  border-color: rgba(249, 115, 22, 0.3);
}

.plugin-detail-mcp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.plugin-detail-mcp-badges {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  flex-wrap: wrap;
}

.plugin-detail-mcp-name {
  font-size: 14px;
  font-weight: 600;
  color: #F4F4F5;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.plugin-detail-mcp-card.disabled .plugin-detail-mcp-name {
  color: rgba(244, 244, 245, 0.8);
}

.plugin-detail-mcp-desc {
  font-size: 12px;
  color: #9CA3AF;
  line-height: 1.5;
  margin: 0;
}

.plugin-detail-mcp-card.disabled .plugin-detail-mcp-desc,
.plugin-detail-mcp-card.disabled .plugin-detail-mcp-meta {
  opacity: 0.5;
}

.plugin-detail-source-badge {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 3px;
  flex-shrink: 0;
}

.plugin-detail-source-badge.plugin {
  background: rgba(245, 158, 11, 0.14);
  color: #FBBF24;
}

.plugin-detail-inline-chip {
  padding: 2px 7px;
  font-size: 10px;
}

.plugin-skill-detail {
  display: flex;
  flex-direction: column;
  gap: 14px;
  height: 560px;
  min-height: 560px;
}

.plugin-skill-detail-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-right: 4px;
}

.plugin-skill-loading {
  padding: 32px 0;
}

.plugin-agent-detail {
  height: 560px;
  min-height: 560px;
  overflow: auto;
  padding-right: 4px;
}

.count-badge.small {
  font-size: 10px;
  padding: 1px 6px;
  margin-left: 6px;
}

.provider-card {
  background: #232329;
  border: 1px solid #3F3F46;
  border-radius: 12px;
  padding: 16px;
}

.provider-card-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
}

.provider-card-title {
  color: #F4F4F5;
  font-size: 15px;
  font-weight: 600;
}

.provider-card-badges,
.provider-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.disabled-state-badge {
  color: rgba(248, 250, 252, 0.82) !important;
  background: rgba(249, 115, 22, 0.12) !important;
  border: 1px solid rgba(249, 115, 22, 0.22);
}

.provider-card-desc {
  margin: 10px 0 12px;
  color: #A1A1AA;
  font-size: 13px;
  line-height: 1.5;
}

.provider-meta {
  margin-bottom: 10px;
}

.plugin-toolbar,
.marketplace-add-actions,
.toolbar-actions,
.card-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.codex-scope-actions {
  flex-wrap: wrap;
  justify-content: flex-end;
}

.plugin-toolbar {
  justify-content: space-between;
  margin-bottom: 14px;
  gap: 12px;
  flex-wrap: wrap;
}

.inline-select,
.marketplace-add-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.inline-select span,
.marketplace-add-field label {
  color: #A1A1AA;
  font-size: 12px;
}

.inline-select select,
.marketplace-input {
  min-width: 180px;
  padding: 8px 10px;
  border-radius: 10px;
  border: 1px solid #3F3F46;
  background: #232329;
  color: #F4F4F5;
  outline: none;
}

.marketplace-input {
  width: min(420px, 100%);
}

.toolbar-btn,
.action-btn {
  border: 1px solid #3F3F46;
  background: #232329;
  color: #E4E4E7;
  border-radius: 10px;
  padding: 8px 12px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.18s ease;
}

.toolbar-btn:hover,
.action-btn:hover {
  border-color: #52525B;
  background: #2A2A31;
}

.toolbar-btn:disabled,
.action-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.toolbar-btn.primary,
.action-btn.primary {
  color: #FB923C;
  border-color: rgba(249, 115, 22, 0.35);
  background: rgba(249, 115, 22, 0.12);
}

.action-btn.danger {
  color: #FCA5A5;
}

.marketplace-card,
.marketplace-plugin-row {
  background: #232329;
  border: 1px solid #3F3F46;
  border-radius: 12px;
}

.marketplace-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.marketplace-card {
  padding: 16px;
  cursor: pointer;
}

.marketplace-header {
  display: block;
}

.marketplace-main {
  min-width: 0;
  flex: 1;
}

.marketplace-plugin-list {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 14px;
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding-right: 4px;
}

.marketplace-controls {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-top: 14px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}

.marketplace-controls.inline {
  margin: 0;
  align-items: center;
  justify-content: flex-end;
  flex-wrap: nowrap;
  flex-shrink: 0;
}

.marketplace-controls.inline .hook-filter-options {
  flex-wrap: nowrap;
}

.marketplace-controls.inline .hook-filter-btn {
  white-space: nowrap;
}

.marketplace-controls.inline .hook-filter-bar {
  flex-shrink: 0;
}

.marketplace-search {
  min-width: 180px;
  flex: 1;
  max-width: 260px;
}

.marketplace-controls.inline .marketplace-search {
  flex: 0 0 200px;
  min-width: 200px;
  max-width: 200px;
}

.marketplace-search-input {
  width: 100%;
  padding: 8px 12px;
  border-radius: 10px;
  border: 1px solid #3F3F46;
  background: #232329;
  color: #F4F4F5;
  outline: none;
  font-size: 12px;
}

.marketplace-search-input::placeholder {
  color: #71717A;
}

.marketplace-plugin-row {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 14px;
  cursor: pointer;
}

.claude-marketplace-plugin-top {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}

.claude-marketplace-plugin-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.claude-marketplace-plugin-header-main {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex-wrap: wrap;
}

.claude-marketplace-plugin-desc {
  margin-top: 0;
  margin-bottom: 0;
}

.marketplace-plugin-top {
  display: grid;
  grid-template-columns: 40px minmax(0, 1fr) auto;
  gap: 12px;
  align-items: start;
}

.marketplace-plugin-avatar {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  flex-shrink: 0;
  margin-top: 2px;
}

.marketplace-plugin-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.marketplace-plugin-title-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.marketplace-plugin-title {
  font-size: 15px;
}

.marketplace-plugin-actions {
  flex-shrink: 0;
  align-self: flex-start;
}

.marketplace-plugin-badges {
  gap: 6px;
  align-items: center;
}

.marketplace-plugin-desc {
  margin-top: 0;
  margin-bottom: 0;
  padding-left: 0;
}

.subagent-item-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.subagent-desc,
.subagent-meta-line {
  margin: 0;
}

.subagent-field-label {
  color: #D4D4D8;
  font-weight: 600;
  margin-right: 6px;
}

.plugin-agent-title-row {
  margin-bottom: 6px;
}

.plugin-agent-item-body {
  gap: 2px;
}

.plugin-agent-item-body .plugin-detail-item-desc {
  margin: 0;
}

.marketplace-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
  min-height: 28px;
  min-width: 0;
}

.marketplace-header-title {
  min-width: 0;
}

.marketplace-card .meta-chip,
.marketplace-plugin-row .meta-chip {
  padding: 2px 8px;
  font-size: 11px;
}

.card-actions {
  flex-wrap: wrap;
}

.card-actions-vertical {
  align-items: flex-end;
  justify-content: flex-start;
}

.success-msg {
  color: #86EFAC;
  margin-bottom: 14px;
  font-size: 13px;
}

.loading-state,
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  color: #A1A1AA;
  text-align: center;
  min-height: 280px;
}

.hint {
  margin-top: 6px;
  font-size: 13px;
}

.inline-hint {
  margin-top: 10px;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid rgba(249, 115, 22, 0.2);
  border-top-color: #F97316;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 12px;
}

.error-msg {
  color: #FCA5A5;
  margin-bottom: 14px;
  font-size: 13px;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

@media (max-width: 960px) {
  .provider-dialog {
    width: calc(100vw - 24px);
    height: calc(100vh - 24px);
  }

  .dialog-body {
    flex-direction: column;
  }

  .market-nav {
    width: 100%;
    border-right: none;
    border-bottom: 1px solid #3F3F46;
    display: flex;
    overflow-x: auto;
    padding: 10px 8px;
  }

  .nav-item {
    border-left: none;
    border-bottom: 3px solid transparent;
    white-space: nowrap;
  }

  .nav-item.active {
    border-left-color: transparent;
    border-bottom-color: #F97316;
  }

  .provider-grid {
    grid-template-columns: 1fr;
  }

  .tab-panel {
    padding: 14px;
  }

  .marketplace-add-card,
  .marketplace-header,
  .marketplace-plugin-row {
    flex-direction: column;
  }

  .card-actions-vertical {
    align-items: stretch;
  }
}
</style>
