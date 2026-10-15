<script setup>
/**
 * ModelEditDialog - 模型编辑对话框
 */
import { ref, watch, computed } from 'vue'
import { useDialogStack } from '../../../../composables/useDialogStack'
import ProviderModelListDialog from './ProviderModelListDialog.vue'

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  model: {
    type: Object,
    default: null
  },
  modelType: {
    type: String,
    default: 'claude' // 'claude' 或 'codex'
  }
})

const emit = defineEmits(['update:visible', 'save', 'close'])

// 表单数据
const formData = ref({
  friendlyName: '',
  apiUrl: '',
  credentials: [],
  defaultCredentialId: null,
  defaultCardId: null,
  modelCards: []
})

// 状态
const visibleCredentialIds = ref(new Set())
const hoveredCardId = ref(null)
const loading = ref(false)
const defaultCatalogEntry = ref(null)
const modelListVisible = ref(false)
const modelListLoading = ref(false)
const modelListError = ref('')
const modelListEndpoint = ref('')
const discoveredModels = ref([])
const modelListRequest = ref({ apiUrl: '', token: '' })

function formatCatalogText(catalog) {
  if (!catalog || typeof catalog !== 'object' || Object.keys(catalog).length === 0) {
    return ''
  }

  return JSON.stringify(catalog, null, 2)
}

// 默认模板去掉 slug / display_name，这两项由后端按供应商和模型名生成
function getDefaultCatalogTemplate(entry) {
  const { slug, display_name, ...template } = entry || {}
  return template
}

// 高级配置展示"默认模板 + 卡片覆盖字段"，打开时就能看到完整的元数据文本
function formatCatalogViewText(catalog, entry) {
  if (!entry) {
    return formatCatalogText(catalog)
  }

  const merged = { ...getDefaultCatalogTemplate(entry), ...(catalog || {}) }

  // 卡片只填了 context_window 时，展示文本里的 max 也要跟随它，避免和窗口输入框不一致
  if (catalog && catalog.context_window !== undefined && catalog.max_context_window === undefined) {
    merged.max_context_window = catalog.context_window
  }

  return JSON.stringify(merged, null, 2)
}

function toPositiveInteger(value) {
  const number = Number(value)
  return Number.isInteger(number) && number > 0 ? number : null
}

function parseCatalogText(catalogText) {
  const text = String(catalogText || '').trim()
  if (!text) {
    return { catalog: null }
  }

  try {
    const parsed = JSON.parse(text)
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { error: '高级配置必须是 JSON 对象' }
    }
    return { catalog: parsed }
  } catch (error) {
    return { error: `高级配置不是合法 JSON: ${error.message}` }
  }
}

async function getDefaultCatalogEntry() {
  if (!defaultCatalogEntry.value) {
    try {
      const result = await window.electronAPI.getCodexCatalogDefaultEntry()
      defaultCatalogEntry.value = result?.success ? result.entry : null
    } catch (error) {
      // 取不到模板时保持空值，保存时仍由生成阶段补默认元数据
      defaultCatalogEntry.value = null
    }
  }

  return defaultCatalogEntry.value
}

function formatDefaultCatalogText(entry) {
  return JSON.stringify(getDefaultCatalogTemplate(entry), null, 2)
}

// 卡片上的窗口输入显示当前生效值：高级配置里有就用里面的，没有就用内置默认值
function resolveCardContextWindow(catalog, entry) {
  if (catalog && catalog.context_window !== undefined && catalog.context_window !== null) {
    return String(catalog.context_window)
  }

  return entry && entry.context_window !== undefined && entry.context_window !== null
    ? String(entry.context_window)
    : ''
}

// 重置为默认模板：高级配置文本与窗口输入一起回到内置默认值
async function resetCardCatalog(card) {
  const entry = await getDefaultCatalogEntry()
  if (!entry) {
    alert('获取 Codex 模型元数据模板失败')
    return
  }

  card.catalogText = formatDefaultCatalogText(entry)
  card.contextWindow = resolveCardContextWindow(null, entry)
}

// 卡片初始化：高级配置为空时直接生成默认模板，窗口输入与元数据保持一致
function createCardForm(card = {}) {
  const catalog = card.catalog && typeof card.catalog === 'object' && Object.keys(card.catalog).length > 0
    ? card.catalog
    : null
  const entry = defaultCatalogEntry.value
  const contextWindow = resolveCardContextWindow(catalog, entry)

  return {
    id: card.id || generateCardId(),
    modelName: card.modelName || '',
    pricingCache: card.pricingCache || '',
    pricingInput: card.pricingInput || '',
    pricingOutput: card.pricingOutput || '',
    catalogText: entry ? formatCatalogViewText(catalog, entry) : formatCatalogText(catalog),
    contextWindow,
    showAdvanced: false
  }
}

// 是否编辑模式
const isEditing = computed(() => !!props.model)

// 对话框标题
const dialogTitle = computed(() => {
  const action = isEditing.value ? '编辑' : '添加'
  const type = props.modelType === 'claude' ? 'Claude' : 'Codex'
  return `${action}${type}模型`
})

// 生成卡片 ID
function generateCardId() {
  return Date.now().toString() + Math.random().toString(36).substr(2, 9)
}

function generateCredentialId() {
  return `credential-${Date.now().toString()}${Math.random().toString(36).slice(2, 8)}`
}

// 监听 model 变化，初始化表单
watch(() => props.model, async (model) => {
  if (props.modelType === 'codex') {
    await getDefaultCatalogEntry()
  }

  if (model) {
    // 编辑模式
    let modelCards = []
    if (model.modelCards && model.modelCards.length > 0) {
      modelCards = model.modelCards.map(card => createCardForm(card))
    } else if (model.modelName) {
      modelCards = [createCardForm({
        modelName: model.modelName,
        pricingCache: model.pricingCache || '',
        pricingInput: model.pricingInput || '',
        pricingOutput: model.pricingOutput || '',
        catalog: model.catalog
      })]
    } else {
      modelCards = [createCardForm()]
    }

    formData.value = {
      friendlyName: model.friendlyName || '',
      apiUrl: model.apiUrl || model.baseUrl || '',
      credentials: Array.isArray(model.credentials) && model.credentials.length > 0
        ? model.credentials.map((credential, index) => ({
            id: credential.id || generateCredentialId(),
            name: credential.name || `令牌 ${index + 1}`,
            token: credential.token || credential.authToken || ''
          }))
        : [{
            id: model.defaultCredentialId || 'default',
            name: '默认',
            token: model.authToken || ''
          }],
      defaultCredentialId: model.defaultCredentialId || model.credentials?.[0]?.id || 'default',
      defaultCardId: model.defaultCardId || modelCards[0]?.id || null,
      modelCards
    }
  } else {
    // 添加模式
    const firstCardId = generateCardId()
    const firstCredentialId = generateCredentialId()
    formData.value = {
      friendlyName: '',
      apiUrl: '',
      credentials: [{ id: firstCredentialId, name: '默认', token: '' }],
      defaultCredentialId: firstCredentialId,
      defaultCardId: firstCardId,
      modelCards: [createCardForm({ id: firstCardId })]
    }
  }
  visibleCredentialIds.value = new Set()
}, { immediate: true })

function addCredential() {
  const credentialId = generateCredentialId()
  formData.value.credentials.push({
    id: credentialId,
    name: `令牌 ${formData.value.credentials.length + 1}`,
    token: ''
  })
  if (!formData.value.defaultCredentialId) {
    formData.value.defaultCredentialId = credentialId
  }
}

function removeCredential(credentialId) {
  if (formData.value.credentials.length <= 1) return
  formData.value.credentials = formData.value.credentials.filter(credential => credential.id !== credentialId)
  visibleCredentialIds.value.delete(credentialId)
  if (formData.value.defaultCredentialId === credentialId) {
    formData.value.defaultCredentialId = formData.value.credentials[0]?.id || null
  }
}

function setDefaultCredential(credentialId) {
  formData.value.defaultCredentialId = credentialId
}

function toggleCredentialVisibility(credentialId) {
  const next = new Set(visibleCredentialIds.value)
  if (next.has(credentialId)) {
    next.delete(credentialId)
  } else {
    next.add(credentialId)
  }
  visibleCredentialIds.value = next
}

// 添加模型卡片
function addCard() {
  formData.value.modelCards.push(createCardForm({ id: generateCardId() }))
}

// 删除模型卡片
function removeCard(cardId) {
  if (formData.value.modelCards.length <= 1) return
  formData.value.modelCards = formData.value.modelCards.filter(c => c.id !== cardId)
  if (formData.value.defaultCardId === cardId) {
    formData.value.defaultCardId = formData.value.modelCards[0]?.id || null
  }
}

// 设置默认卡片
function setDefaultCard(cardId) {
  formData.value.defaultCardId = cardId
}

// 卡片上已填的模型名，用于标记拉取结果里哪些已经存在
const existingModelNames = computed(() => formData.value.modelCards
  .map(card => String(card.modelName || '').trim())
  .filter(Boolean))

function resolveRequestCredential() {
  const validCredentials = formData.value.credentials.filter(credential =>
    (credential.name || '').trim() && (credential.token || '').trim()
  )

  return validCredentials.find(credential => credential.id === formData.value.defaultCredentialId) || validCredentials[0] || null
}

// 按卡片上方填写的上游地址与默认令牌拉取模型列表
async function pullProviderModels() {
  const apiUrl = String(formData.value.apiUrl || '').trim()
  if (!/^https?:\/\//i.test(apiUrl)) {
    alert('请先填写以 http:// 或 https:// 开头的API地址')
    return
  }

  const credential = resolveRequestCredential()
  if (!credential) {
    alert('请先填写至少一个认证令牌')
    return
  }

  modelListRequest.value = { apiUrl, token: credential.token }
  modelListVisible.value = true
  await loadProviderModels()
}

async function loadProviderModels() {
  const { apiUrl, token } = modelListRequest.value
  if (!apiUrl || !token) {
    return
  }

  modelListLoading.value = true
  modelListError.value = ''
  modelListEndpoint.value = ''
  discoveredModels.value = []

  try {
    const result = await window.electronAPI.discoverProviderModels({
      tool: props.modelType,
      apiUrl,
      token
    })

    if (!result?.success) {
      modelListError.value = result?.error || '拉取模型列表失败'
      modelListEndpoint.value = result?.endpoint || ''
      return
    }

    discoveredModels.value = Array.isArray(result.models) ? result.models : []
    modelListEndpoint.value = result.endpoint || ''

    if (discoveredModels.value.length === 0) {
      modelListError.value = '上游没有返回任何模型'
    }
  } catch (error) {
    modelListError.value = error.message || '拉取模型列表失败'
  } finally {
    modelListLoading.value = false
  }
}

// 拉取结果 → 追加成模型卡片：同名卡片跳过，默认卡片保持不变
function addDiscoveredModels(models) {
  const existingNames = new Set(existingModelNames.value)

  for (const model of models) {
    const modelName = String(model?.id || '').trim()
    if (!modelName || existingNames.has(modelName)) {
      continue
    }

    const card = createCardForm({ id: generateCardId(), modelName })

    if (props.modelType === 'codex') {
      applyCodexModelMetadata(card, model)
    } else {
      applyClaudeModelMetadata(card, model)
    }

    formData.value.modelCards.push(card)
    existingNames.add(modelName)
  }

  modelListVisible.value = false
}

// Codex：把拉取到的窗口、模态等信息并进元数据，其余字段保持默认模板
function applyCodexModelMetadata(card, model) {
  const catalog = parseCatalogText(card.catalogText).catalog || {}

  const contextWindow = Number(model.contextWindow)
  if (Number.isFinite(contextWindow) && contextWindow > 0) {
    const maxContextWindow = Number(model.maxContextWindow)
    catalog.context_window = contextWindow
    catalog.max_context_window = Number.isFinite(maxContextWindow) && maxContextWindow > 0
      ? maxContextWindow
      : contextWindow
    card.contextWindow = String(contextWindow)
  }

  if (Array.isArray(model.inputModalities) && model.inputModalities.length > 0) {
    catalog.input_modalities = model.inputModalities
  }

  if (model.description) {
    catalog.description = model.description
  }

  card.catalogText = JSON.stringify(catalog, null, 2)
}

// Claude：拉取到的价格按每百万 token 填进计费三个格子
function applyClaudeModelMetadata(card, model) {
  if (!model.pricing) {
    return
  }

  if (model.pricing.cache) card.pricingCache = model.pricing.cache
  if (model.pricing.input) card.pricingInput = model.pricing.input
  if (model.pricing.output) card.pricingOutput = model.pricing.output
}

// 关闭对话框
function handleClose() {
  emit('update:visible', false)
  emit('close')
}

useDialogStack(computed(() => props.visible), handleClose)

// 保存
function handleSave() {
  const validCredentials = formData.value.credentials.filter(credential =>
    (credential.name || '').trim() && (credential.token || '').trim()
  )
  const defaultCredential = validCredentials.find(credential => credential.id === formData.value.defaultCredentialId) || validCredentials[0] || null

  if (!formData.value.friendlyName || !formData.value.apiUrl || !defaultCredential) {
    alert('请填写必填项：友好名称、API地址和至少一个认证令牌')
    return
  }

  const modelCards = []
  for (const card of formData.value.modelCards) {
    const nextCard = {
      id: card.id,
      modelName: card.modelName,
      pricingCache: card.pricingCache,
      pricingInput: card.pricingInput,
      pricingOutput: card.pricingOutput
    }

    if (props.modelType === 'codex') {
      const parsed = parseCatalogText(card.catalogText)
      if (parsed.error) {
        alert(`模型「${card.modelName || '未命名'}」的${parsed.error}`)
        return
      }

      // 数据不空：以默认模板为基底，卡片里填过的字段覆盖模板，没填的仍是完整默认值
      const catalog = {
        ...getDefaultCatalogTemplate(defaultCatalogEntry.value),
        ...(parsed.catalog || {})
      }

      // 窗口只认输入框：输入框改了以输入框为准，没改则它显示的就是当前值；清空回落默认值
      const windowValue = String(card.contextWindow ?? '').trim()
      const inputWindow = toPositiveInteger(windowValue)

      if (windowValue && !inputWindow) {
        alert(`模型「${card.modelName || '未命名'}」的上下文窗口必须是正整数`)
        return
      }

      const targetWindow = inputWindow
        || toPositiveInteger(defaultCatalogEntry.value?.context_window)
        || toPositiveInteger(catalog.context_window)

      if (!targetWindow) {
        alert(`模型「${card.modelName || '未命名'}」的上下文窗口必须是正整数`)
        return
      }

      catalog.context_window = targetWindow
      catalog.max_context_window = targetWindow
      nextCard.catalog = catalog
    }

    modelCards.push(nextCard)
  }

  emit('save', {
    ...formData.value,
    modelCards,
    credentials: validCredentials,
    defaultCredentialId: defaultCredential.id,
    authToken: defaultCredential.token,
    id: props.model?.id || Date.now().toString()
  })
  handleClose()
}
</script>

<template>
  <div v-if="visible" class="dialog-overlay">
    <div class="model-dialog" @click.stop>
      <div class="dialog-header">
        <h2>{{ dialogTitle }}</h2>
        <button class="close-btn" @click="handleClose" title="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <!-- 友好名称 -->
        <div class="form-item">
          <label class="form-label">
            友好名称 <span class="required">*</span>
            <span class="label-hint">显示名称，方便识别</span>
          </label>
          <input
            type="text"
            v-model="formData.friendlyName"
            class="form-input"
            placeholder="例如: Claude Sonnet 4.6"
          >
        </div>

        <!-- API 地址 -->
        <div class="form-item">
          <label class="form-label">
            API地址 <span class="required">*</span>
            <span class="label-hint">API 完整地址</span>
          </label>
          <input
            type="text"
            v-model="formData.apiUrl"
            class="form-input"
            :placeholder="modelType === 'claude' ? '例如: https://api.anthropic.com/v1/messages' : '例如: https://api.openai.com/v1'"
          >
        </div>

        <!-- 认证令牌 -->
        <div class="form-item">
          <div class="section-header-inline">
            <label class="form-label">
              认证令牌 <span class="required">*</span>
              <span class="label-hint">一个供应商可配置多个具名令牌</span>
            </label>
            <button type="button" class="btn-add-card-small" @click="addCredential" title="添加令牌">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
            </button>
          </div>

          <div class="credential-list">
            <div v-for="(credential, index) in formData.credentials" :key="credential.id" class="credential-item">
              <div class="credential-item-header">
                <button
                  type="button"
                  class="btn-set-default"
                  :class="{ active: formData.defaultCredentialId === credential.id }"
                  @click="setDefaultCredential(credential.id)"
                >
                  {{ formData.defaultCredentialId === credential.id ? '默认' : '设为默认' }}
                </button>
                <button
                  v-if="formData.credentials.length > 1"
                  type="button"
                  class="btn-remove-card"
                  @click="removeCredential(credential.id)"
                >
                  删除
                </button>
              </div>

              <div class="credential-fields">
                <input
                  type="text"
                  v-model="credential.name"
                  class="form-input"
                  :placeholder="`令牌名称 ${index + 1}`"
                >
                <div class="input-with-action">
                  <input
                    :type="visibleCredentialIds.has(credential.id) ? 'text' : 'password'"
                    v-model="credential.token"
                    class="form-input"
                    placeholder="例如: sk-ant-..."
                  >
                  <button
                    type="button"
                    class="input-action-btn"
                    @click="toggleCredentialVisibility(credential.id)"
                    :title="visibleCredentialIds.has(credential.id) ? '隐藏' : '显示'"
                  >
                    <svg v-if="visibleCredentialIds.has(credential.id)" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                    <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- 模型卡片列表 -->
        <div class="model-cards-section">
          <div class="section-header-inline">
            <label class="form-label">模型名称与计费</label>
            <div class="section-header-actions">
              <button
                type="button"
                class="btn-add-card-small"
                @click="pullProviderModels"
                :disabled="modelListLoading"
                title="按上方填写的API地址和令牌拉取模型列表"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
              </button>
              <button type="button" class="btn-add-card-small" @click="addCard" title="添加模型">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <line x1="12" y1="5" x2="12" y2="19"/>
                  <line x1="5" y1="12" x2="19" y2="12"/>
                </svg>
              </button>
            </div>
          </div>

          <div class="model-cards-list">
            <div
              v-for="(card, index) in formData.modelCards"
              :key="card.id"
              class="model-card-item"
              :class="{ 'is-default': formData.defaultCardId === card.id }"
              @mouseenter="hoveredCardId = card.id"
              @mouseleave="hoveredCardId = null"
            >
              <div class="card-header">
                <div class="card-title-area">
                  <span class="card-index">模型 {{ index + 1 }}</span>
                  <span v-if="formData.defaultCardId === card.id" class="default-badge">默认</span>
                  <button
                    v-else-if="hoveredCardId === card.id"
                    type="button"
                    class="btn-set-default"
                    @click="setDefaultCard(card.id)"
                  >
                    设为默认
                  </button>
                </div>

                <button
                  v-if="formData.modelCards.length > 1"
                  type="button"
                  class="btn-remove-card"
                  @click="removeCard(card.id)"
                  title="删除此模型"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
              </div>

              <div class="card-content">
                <div class="card-field">
                  <input
                    type="text"
                    v-model="card.modelName"
                    class="form-input"
                    placeholder="模型名称，如 claude-sonnet-4-6"
                  >
                </div>

                <div class="card-pricing">
                  <div class="pricing-field">
                    <span class="pricing-label">Cache</span>
                    <input
                      type="number"
                      step="0.01"
                      v-model="card.pricingCache"
                      class="form-input"
                      placeholder="0.00"
                    >
                  </div>
                  <div class="pricing-field">
                    <span class="pricing-label">Input</span>
                    <input
                      type="number"
                      step="0.01"
                      v-model="card.pricingInput"
                      class="form-input"
                      placeholder="0.00"
                    >
                  </div>
                  <div class="pricing-field">
                    <span class="pricing-label">Output</span>
                    <input
                      type="number"
                      step="0.01"
                      v-model="card.pricingOutput"
                      class="form-input"
                      placeholder="0.00"
                    >
                  </div>
                </div>

                <div v-if="modelType === 'codex'" class="card-window">
                  <div class="window-field">
                    <span class="pricing-label">
                      上下文窗口
                      <span class="window-hint">同步 context_window / max_context_window</span>
                    </span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      v-model="card.contextWindow"
                      class="form-input"
                      :placeholder="`默认 ${defaultCatalogEntry?.context_window || 200000}`"
                    >
                  </div>
                  <button
                    type="button"
                    class="btn-catalog-action"
                    @click="card.showAdvanced = !card.showAdvanced"
                  >
                    {{ card.showAdvanced ? '收起高级' : '显示高级' }}
                  </button>
                </div>

                <div v-if="modelType === 'codex' && card.showAdvanced" class="card-catalog">
                  <div class="card-catalog-header">
                    <span class="card-catalog-title">高级配置（Codex 模型元数据）</span>
                    <div class="card-catalog-actions">
                      <button type="button" class="btn-catalog-action" @click="resetCardCatalog(card)">重置为默认模板</button>
                    </div>
                  </div>
                  <textarea
                    v-model="card.catalogText"
                    class="form-textarea catalog-textarea"
                    placeholder="留空则使用默认元数据模板，上下文窗口以上方输入框为准"
                  ></textarea>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <button class="btn btn-secondary" @click="handleClose">取消</button>
        <button class="btn btn-primary" @click="handleSave" :disabled="loading">
          {{ loading ? '保存中...' : '保存' }}
        </button>
      </div>
    </div>

    <ProviderModelListDialog
      v-if="modelListVisible"
      :visible="modelListVisible"
      :loading="modelListLoading"
      :error="modelListError"
      :endpoint="modelListEndpoint"
      :models="discoveredModels"
      :existing-names="existingModelNames"
      @close="modelListVisible = false"
      @retry="loadProviderModels"
      @confirm="addDiscoveredModels"
    />
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}

.model-dialog {
  background: #1F1F23;
  border-radius: 12px;
  width: 600px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
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
  font-size: 18px;
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
  overflow-y: auto;
  padding: 24px;
}

.form-item {
  margin-bottom: 20px;
}

.form-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 14px;
  font-weight: 500;
  color: #F4F4F5;
  margin-bottom: 8px;
}

.required {
  color: #EF4444;
}

.label-hint {
  font-weight: 400;
  color: #71717A;
  font-size: 12px;
}

.form-input {
  width: 100%;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  padding: 10px 12px;
  color: #F4F4F5;
  font-size: 14px;
}

.form-input:focus {
  outline: none;
  border-color: #F97316;
}

.input-with-action {
  display: flex;
  align-items: center;
  position: relative;
}

.input-with-action .form-input {
  padding-right: 44px;
}

.input-action-btn {
  position: absolute;
  right: 8px;
  background: transparent;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: #71717A;
}

.input-action-btn:hover {
  color: #9CA3AF;
}

.model-cards-section {
  margin-top: 24px;
}

.section-header-inline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.section-header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.btn-add-card-small {
  background: transparent;
  border: 1px solid #3F3F46;
  border-radius: 4px;
  padding: 6px;
  cursor: pointer;
  color: #9CA3AF;
  display: flex;
  align-items: center;
  justify-content: center;
}

.btn-add-card-small:hover {
  border-color: #F97316;
  color: #F97316;
}

.btn-add-card-small:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-add-card-small:disabled:hover {
  border-color: #3F3F46;
  color: #9CA3AF;
}

.credential-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.credential-item {
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  padding: 12px;
}

.credential-item-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.credential-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.btn-set-default.active {
  color: #F97316;
}

.model-cards-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.model-card-item {
  background: #27272A;
  border: 2px solid #3F3F46;
  border-radius: 8px;
  padding: 16px;
}

.model-card-item.is-default {
  border-color: rgba(249, 115, 22, 0.3);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.card-title-area {
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-index {
  font-size: 14px;
  font-weight: 500;
  color: #D1D5DB;
}

.default-badge {
  font-size: 11px;
  color: #F97316;
  background: rgba(249, 115, 22, 0.1);
  border: 1px solid rgba(249, 115, 22, 0.3);
  border-radius: 4px;
  padding: 1px 6px;
}

.btn-set-default {
  font-size: 11px;
  color: #6B7280;
  background: transparent;
  border: none;
  padding: 0 4px;
  cursor: pointer;
}

.btn-set-default:hover {
  color: #9CA3AF;
}

.btn-remove-card {
  background: transparent;
  border: none;
  padding: 4px;
  cursor: pointer;
  color: #71717A;
}

.btn-remove-card:hover {
  color: #EF4444;
}

.card-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card-pricing {
  display: flex;
  gap: 12px;
}

.pricing-field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.pricing-label {
  font-size: 11px;
  color: #71717A;
}

.card-pricing .form-input {
  font-size: 13px;
  padding: 8px 10px;
}

.card-window {
  display: flex;
  align-items: flex-end;
  gap: 12px;
}

.window-field {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.window-hint {
  margin-left: 4px;
  font-weight: 400;
  color: #71717A;
}

.card-window .form-input {
  font-size: 13px;
  padding: 8px 10px;
}

.card-window .btn-catalog-action {
  height: 34px;
}

.card-catalog {
  display: flex;
  flex-direction: column;
  gap: 8px;
  border-top: 1px dashed #3F3F46;
  padding-top: 12px;
}

.card-catalog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.card-catalog-title {
  font-size: 12px;
  color: #A1A1AA;
}

.card-catalog-actions {
  display: flex;
  gap: 8px;
}

.btn-catalog-action {
  background: transparent;
  border: 1px solid #3F3F46;
  border-radius: 4px;
  color: #A1A1AA;
  font-size: 12px;
  padding: 4px 8px;
  cursor: pointer;
}

.btn-catalog-action:hover {
  border-color: #F97316;
  color: #F97316;
}

.catalog-textarea {
  width: 100%;
  min-height: 160px;
  background: #18181B;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  color: #F4F4F5;
  font-family: Menlo, Monaco, 'Courier New', monospace;
  font-size: 12px;
  line-height: 1.5;
  padding: 10px;
  resize: vertical;
}

.catalog-textarea:focus {
  outline: none;
  border-color: #F97316;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 16px 24px;
  border-top: 1px solid #3F3F46;
}

.btn {
  padding: 10px 20px;
  border-radius: 6px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: #3F3F46;
  color: #F4F4F5;
}

.btn-secondary:hover:not(:disabled) {
  background: #52525B;
}

.btn-primary {
  background: #F97316;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #EA580C;
}
</style>
