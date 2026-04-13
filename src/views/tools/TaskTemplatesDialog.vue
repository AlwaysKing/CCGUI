<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useDialogStack } from '../../composables/useDialogStack'
import {
  createEmptyTaskTemplateCollection,
  createTaskTemplateDraft,
  emitTaskTemplatesUpdated,
  loadTaskTemplates,
  saveTaskTemplates
} from '@/utils/taskTemplates'

const props = defineProps({
  projectId: {
    type: String,
    default: ''
  },
  projectPath: {
    type: String,
    default: ''
  },
  initialSection: {
    type: String,
    default: 'routine'
  }
})

const emit = defineEmits(['close'])

const activeSection = ref(props.initialSection === 'run' ? 'run' : 'routine')
const editingTemplate = ref(null)
const editingScope = ref('app')
const isCreatingTemplate = ref(false)
const contentTextareaRef = ref(null)
const loadingState = ref('idle')
const errorMessage = ref('')
const appTemplateCollection = ref(createEmptyTaskTemplateCollection())
const projectTemplateCollection = ref(createEmptyTaskTemplateCollection())

const sections = [
  {
    id: 'routine',
    label: '常规任务',
    icon: 'routine'
  },
  {
    id: 'run',
    label: '运行模板',
    icon: 'run'
  }
]

const appTemplates = computed(() => {
  return (appTemplateCollection.value?.[activeSection.value] || []).map(item => ({
    ...item,
    summary: item.content,
    tag: 'App'
  }))
})

const projectTemplates = computed(() => {
  if (!props.projectPath) {
    return []
  }

  return (projectTemplateCollection.value?.[activeSection.value] || []).map(item => ({
    ...item,
    summary: item.content,
    tag: 'Project'
  }))
})

const appSectionTitle = computed(() => activeSection.value === 'routine' ? 'App 常规任务' : 'App 运行模板')
const projectSectionTitle = computed(() => activeSection.value === 'routine' ? '项目常规任务' : '项目运行模板')
const editingDialogTitle = computed(() => {
  const sectionLabel = activeSection.value === 'routine' ? '常规任务' : '运行模板'
  return isCreatingTemplate.value ? `新建${sectionLabel}` : `编辑${sectionLabel}`
})
const canSubmitEditingTemplate = computed(() => {
  const title = String(editingTemplate.value?.title || '').trim()
  const content = String(editingTemplate.value?.content || '').trim()
  return Boolean(title && content)
})

function getCollectionByScope(scope) {
  return scope === 'project' ? projectTemplateCollection.value : appTemplateCollection.value
}

function setCollectionByScope(scope, collection) {
  if (scope === 'project') {
    projectTemplateCollection.value = collection
    return
  }

  appTemplateCollection.value = collection
}

async function loadTemplateCollections() {
  loadingState.value = 'loading'
  errorMessage.value = ''

  try {
    const result = await loadTaskTemplates({ projectId: props.projectId })
    appTemplateCollection.value = result.app
    projectTemplateCollection.value = result.project
    loadingState.value = 'ready'
  } catch (error) {
    loadingState.value = 'error'
    errorMessage.value = error.message || '读取任务模板失败'
  }
}

function createTemplateDraft(scope) {
  return {
    ...createTaskTemplateDraft(),
    tag: scope === 'project' ? 'Project' : 'App'
  }
}

function openCreateDialog(scope) {
  editingScope.value = scope
  isCreatingTemplate.value = true
  editingTemplate.value = createTemplateDraft(scope)
}

function openEditDialog(scope, item) {
  editingScope.value = scope
  isCreatingTemplate.value = false
  editingTemplate.value = {
    id: item.id,
    title: item.title,
    content: item.summary,
    tag: item.tag,
    builtIn: Boolean(item.builtIn),
    locked: Boolean(item.locked)
  }
}

function closeEditDialog() {
  editingTemplate.value = null
}

function insertTemplatePlaceholder(placeholder) {
  if (!editingTemplate.value) return

  const textarea = contentTextareaRef.value
  if (!textarea) {
    editingTemplate.value.content = `${editingTemplate.value.content || ''}${placeholder}`
    return
  }

  const start = textarea.selectionStart ?? editingTemplate.value.content.length
  const end = textarea.selectionEnd ?? editingTemplate.value.content.length
  const current = editingTemplate.value.content || ''
  editingTemplate.value.content = `${current.slice(0, start)}${placeholder}${current.slice(end)}`

  nextTick(() => {
    const nextPosition = start + placeholder.length
    textarea.focus()
    textarea.setSelectionRange(nextPosition, nextPosition)
  })
}

async function persistScopeCollection(scope, collection) {
  const normalized = await saveTaskTemplates({
    scope,
    projectId: props.projectId,
    collection
  })
  setCollectionByScope(scope, normalized)
  emitTaskTemplatesUpdated({
    scope,
    kind: activeSection.value,
    projectId: props.projectId
  })
}

async function submitEditingTemplate() {
  if (!editingTemplate.value || !canSubmitEditingTemplate.value) {
    return
  }

  try {
    errorMessage.value = ''
    const scope = editingScope.value
    const collection = getCollectionByScope(scope)
    const list = Array.isArray(collection?.[activeSection.value]) ? collection[activeSection.value] : []
    const now = new Date().toISOString()
    const nextTemplate = {
      id: editingTemplate.value.id || undefined,
      title: editingTemplate.value.title,
      content: editingTemplate.value.content,
      createdAt: editingTemplate.value.createdAt || now,
      updatedAt: now
    }
    const nextList = isCreatingTemplate.value
      ? [...list, nextTemplate]
      : list.map(item => item.id === editingTemplate.value.id ? { ...item, ...nextTemplate } : item)

    await persistScopeCollection(scope, {
      ...collection,
      [activeSection.value]: nextList
    })
    closeEditDialog()
  } catch (error) {
    errorMessage.value = error.message || '保存任务模板失败'
  }
}

async function removeTemplate(scope, templateId) {
  try {
    errorMessage.value = ''
    const collection = getCollectionByScope(scope)
    const list = Array.isArray(collection?.[activeSection.value]) ? collection[activeSection.value] : []
    const targetTemplate = list.find(item => item.id === templateId)
    if (targetTemplate?.locked) {
      return
    }
    const nextList = list.filter(item => item.id !== templateId)

    await persistScopeCollection(scope, {
      ...collection,
      [activeSection.value]: nextList
    })

    if (editingTemplate.value?.id === templateId && editingScope.value === scope) {
      closeEditDialog()
    }
  } catch (error) {
    errorMessage.value = error.message || '删除任务模板失败'
  }
}

function handleClose() {
  emit('close')
}

useDialogStack(computed(() => true), handleClose)

watch(() => props.projectId, () => {
  loadTemplateCollections()
}, { immediate: true })

watch(() => props.initialSection, (nextSection) => {
  activeSection.value = nextSection === 'run' ? 'run' : 'routine'
}, { immediate: true })

onMounted(() => {
  window.addEventListener('ccgui-task-templates-updated', loadTemplateCollections)
})

onBeforeUnmount(() => {
  window.removeEventListener('ccgui-task-templates-updated', loadTemplateCollections)
})

watch(() => editingTemplate.value?.id, () => {
  nextTick(() => {
    if (editingTemplate.value) {
      contentTextareaRef.value?.focus?.()
    }
  })
})
</script>

<template>
  <div class="dialog-overlay">
    <div class="task-templates-dialog" @click.stop>
      <div class="dialog-header">
        <h2>任务模板</h2>
        <button class="close-btn" @click="handleClose" title="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <div class="template-nav">
          <div
            v-for="section in sections"
            :key="section.id"
            class="nav-item"
            :class="{ active: activeSection === section.id }"
            @click="activeSection = section.id"
          >
            <svg v-if="section.icon === 'routine'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M3 5a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v2H3V5z"/>
              <path d="M3 9h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9z"/>
            </svg>
            <svg v-else width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M8 6h13"/>
              <path d="M8 12h13"/>
              <path d="M8 18h13"/>
              <path d="M3 6h.01"/>
              <path d="M3 12h.01"/>
              <path d="M3 18h.01"/>
            </svg>
            <span>{{ section.label }}</span>
          </div>
        </div>

        <div class="templates-content" :class="{ 'app-only': !projectPath }">
          <div v-if="loadingState === 'loading'" class="template-state-banner">正在读取任务模板…</div>
          <div v-else-if="loadingState === 'error'" class="template-state-banner is-error">{{ errorMessage }}</div>
          <section class="template-panel app-panel">
            <div class="panel-header">
              <div>
                <h3>{{ appSectionTitle }}</h3>
                <p>全局模板库，适用于所有项目。</p>
              </div>
            </div>

            <div class="template-grid">
              <article class="template-card template-card-add" role="button" tabindex="0" @click="openCreateDialog('app')">
                <div class="template-card-add-row">
                  <div class="template-card-add-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                      <line x1="12" y1="5" x2="12" y2="19"/>
                      <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  </div>
                  <h4>添加模板</h4>
                </div>
                <p>创建一个新的 App 级模板。</p>
              </article>
              <article
                v-for="item in appTemplates"
                :key="item.id"
                class="template-card"
                role="button"
                tabindex="0"
                @click="openEditDialog('app', item)"
              >
                <div class="template-card-header">
                  <h4>{{ item.title }}</h4>
                  <span class="template-tag" :class="{ locked: item.locked }">{{ item.locked ? '默认' : item.tag }}</span>
                </div>
                <p>{{ item.summary }}</p>
                <button v-if="!item.locked" class="card-delete-btn" type="button" title="删除" @click.stop="removeTemplate('app', item.id)">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
              </article>
            </div>
          </section>

          <section v-if="projectPath" class="template-panel project-panel">
            <div class="panel-header">
              <div>
                <h3>{{ projectSectionTitle }}</h3>
                <p>{{ projectPath }}</p>
              </div>
            </div>

            <div class="template-grid">
              <article class="template-card template-card-add" role="button" tabindex="0" @click="openCreateDialog('project')">
                <div class="template-card-add-row">
                  <div class="template-card-add-icon">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                      <line x1="12" y1="5" x2="12" y2="19"/>
                      <line x1="5" y1="12" x2="19" y2="12"/>
                    </svg>
                  </div>
                  <h4>添加模板</h4>
                </div>
                <p>创建一个新的项目级模板。</p>
              </article>
              <article
                v-for="item in projectTemplates"
                :key="item.id"
                class="template-card"
                role="button"
                tabindex="0"
                @click="openEditDialog('project', item)"
              >
                <div class="template-card-header">
                  <h4>{{ item.title }}</h4>
                  <span class="template-tag project" :class="{ locked: item.locked }">{{ item.locked ? '默认' : item.tag }}</span>
                </div>
                <p>{{ item.summary }}</p>
                <button v-if="!item.locked" class="card-delete-btn" type="button" title="删除" @click.stop="removeTemplate('project', item.id)">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                  </svg>
                </button>
              </article>
            </div>
          </section>
        </div>
      </div>
    </div>

  </div>

  <Teleport to="body">
    <div v-if="editingTemplate" class="detail-overlay" @click.self="closeEditDialog">
      <div class="edit-dialog" @click.stop>
        <div class="edit-dialog-header">
          <h3>{{ editingDialogTitle }}</h3>
          <button class="close-btn" @click="closeEditDialog" title="关闭">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="edit-form">
          <label class="edit-field">
            <span>名称</span>
            <input v-model="editingTemplate.title" type="text" class="edit-input" placeholder="输入模板名称">
          </label>

          <label class="edit-field">
            <div class="edit-field-header">
              <span>任务内容</span>
              <div v-if="activeSection === 'run'" class="placeholder-actions">
                <button type="button" class="placeholder-btn" @click="insertTemplatePlaceholder('{{task_id}}')">任务ID</button>
                <button type="button" class="placeholder-btn" @click="insertTemplatePlaceholder('{{task_document}}')">任务文档</button>
              </div>
            </div>
            <textarea
              ref="contentTextareaRef"
              v-model="editingTemplate.content"
              class="edit-textarea"
              placeholder="输入任务内容"
            ></textarea>
          </label>
        </div>

        <div class="edit-actions">
          <button class="secondary-btn" type="button" @click="closeEditDialog">取消</button>
          <button class="primary-btn" type="button" :disabled="!canSubmitEditingTemplate" @click="submitEditingTemplate">{{ isCreatingTemplate ? '创建' : '保存' }}</button>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  background:
    radial-gradient(circle at top, rgba(249, 115, 22, 0.06), transparent 24%),
    rgba(0, 0, 0, 0.72);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
}

.task-templates-dialog {
  --app-soft-surface: rgba(255, 255, 255, 0.024);
  --app-soft-surface-hover: rgba(255, 255, 255, 0.05);
  --app-soft-border: rgba(255, 255, 255, 0.13);
  background:
    radial-gradient(circle at top right, rgba(249, 115, 22, 0.06), transparent 26%),
    linear-gradient(180deg, #1b1e23 0%, #17191d 100%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  width: 90vw;
  max-width: 980px;
  height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.04),
    0 24px 64px rgba(0, 0, 0, 0.46);
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.dialog-header h2 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #f4f4f5;
}

.close-btn {
  background: transparent;
  border: none;
  color: #9ca3af;
  cursor: pointer;
  padding: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 4px;
}

.close-btn:hover {
  color: #f4f4f5;
  background: #3f3f46;
}

.dialog-body {
  flex: 1;
  display: flex;
  overflow: hidden;
}

.template-nav {
  width: 200px;
  background: linear-gradient(180deg, rgba(20, 22, 27, 0.98) 0%, rgba(17, 18, 22, 1) 100%);
  border-right: 1px solid rgba(255, 255, 255, 0.06);
  padding: 16px 8px;
  flex-shrink: 0;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 12px;
  border-radius: 6px;
  cursor: pointer;
  color: #9ca3af;
  transition: all 0.2s;
  margin-bottom: 4px;
}

.nav-item:hover {
  background: var(--app-soft-surface);
  color: #f4f4f5;
}

.nav-item.active {
  background: rgba(249, 115, 22, 0.1);
  color: #f97316;
}

.nav-item span {
  font-size: 14px;
}

.templates-content {
  flex: 1;
  display: grid;
  grid-template-rows: minmax(0, 1fr) minmax(0, 1fr);
  overflow: hidden;
  background: linear-gradient(180deg, rgba(26, 28, 33, 0.94), rgba(23, 25, 29, 0.98));
  position: relative;
}

.templates-content.app-only {
  grid-template-rows: minmax(0, 1fr);
}

.template-panel {
  min-height: 0;
  overflow: auto;
}

.template-state-banner {
  position: absolute;
  top: 12px;
  right: 16px;
  z-index: 3;
  border-radius: 999px;
  padding: 6px 10px;
  background: rgba(255, 255, 255, 0.06);
  color: #d4d4d8;
  font-size: 12px;
}

.template-state-banner.is-error {
  background: rgba(239, 68, 68, 0.12);
  color: #fca5a5;
}

.project-panel {
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.panel-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  padding: 20px 24px 16px;
  position: sticky;
  top: 0;
  z-index: 2;
  background: linear-gradient(180deg, rgba(26, 28, 33, 1) 80%, rgba(26, 28, 33, 0));
}

.panel-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #f4f4f5;
}

.panel-header p {
  margin: 6px 0 0;
  color: #9ca3af;
  font-size: 13px;
  line-height: 1.5;
  word-break: break-all;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
  padding: 0 24px 24px;
}

.template-card {
  position: relative;
  background: var(--app-soft-surface);
  border: 1px solid var(--app-soft-border);
  border-radius: 8px;
  padding: 14px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  cursor: pointer;
  transition: border-color 0.2s ease, background 0.2s ease;
}

.template-card:hover {
  background: var(--app-soft-surface-hover);
  border-color: rgba(249, 115, 22, 0.24);
}

.template-card:focus-visible {
  outline: none;
  border-color: rgba(249, 115, 22, 0.4);
  box-shadow: 0 0 0 2px rgba(249, 115, 22, 0.12);
}

.template-card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.template-card-header h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #f4f4f5;
}

.template-card p {
  margin: 0;
  color: #a1a1aa;
  font-size: 13px;
  line-height: 1.6;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.template-tag {
  flex-shrink: 0;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(249, 115, 22, 0.12);
  color: #fdba74;
  font-size: 11px;
  font-weight: 600;
}

.template-tag.project {
  background: rgba(56, 189, 248, 0.12);
  color: #7dd3fc;
}

.template-tag.locked {
  background: rgba(250, 204, 21, 0.12);
  color: #fde68a;
}

.template-card-add {
  align-items: flex-start;
  justify-content: center;
  border-style: dashed;
  color: #d4d4d8;
}

.template-card-add:hover {
  border-color: rgba(249, 115, 22, 0.32);
  background: rgba(249, 115, 22, 0.05);
}

.template-card-add h4 {
  margin: 0;
  font-size: 14px;
  font-weight: 600;
  color: #f4f4f5;
}

.template-card-add p {
  color: #8b8b95;
}

.template-card-add-row {
  display: flex;
  align-items: center;
  gap: 10px;
}

.template-card-add-icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: rgba(249, 115, 22, 0.1);
  color: #fb923c;
}

.card-delete-btn {
  position: absolute;
  right: 10px;
  bottom: 10px;
  width: auto;
  height: auto;
  background: transparent;
  border: none;
  border-radius: 3px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #71717a;
  cursor: pointer;
  padding: 3px;
  flex-shrink: 0;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s, color 0.15s, background 0.15s;
}

.template-card:hover .card-delete-btn,
.template-card:focus-within .card-delete-btn {
  opacity: 1;
  pointer-events: auto;
}

.card-delete-btn:hover {
  color: #ef4444;
  background: rgba(239, 68, 68, 0.08);
}

.detail-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.36);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1100;
}

.edit-dialog {
  width: min(560px, calc(100vw - 32px));
  background: linear-gradient(180deg, #1b1e23 0%, #17191d 100%);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  box-shadow: 0 24px 64px rgba(0, 0, 0, 0.46);
  overflow: hidden;
}

.edit-dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 20px 24px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.edit-dialog-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #f4f4f5;
}

.edit-form {
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  gap: 14px;
}

.edit-field {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.edit-field-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.edit-field span {
  color: #d4d4d8;
  font-size: 13px;
}

.placeholder-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.placeholder-btn {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 999px;
  padding: 4px 8px;
  background: rgba(255, 255, 255, 0.04);
  color: #d4d4d8;
  font-size: 12px;
  cursor: pointer;
}

.placeholder-btn:hover {
  border-color: rgba(249, 115, 22, 0.3);
  color: #fdba74;
  background: rgba(249, 115, 22, 0.08);
}

.edit-input,
.edit-textarea {
  width: 100%;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  color: #f4f4f5;
  padding: 10px 12px;
  outline: none;
  font: inherit;
}

.edit-textarea {
  min-height: 120px;
  resize: vertical;
}

.edit-actions {
  padding: 0 24px 20px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}

.primary-btn,
.secondary-btn {
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 8px;
  padding: 8px 12px;
  font-size: 13px;
  cursor: pointer;
}

.primary-btn {
  background: #f97316;
  border-color: #f97316;
  color: #fff7ed;
}

.primary-btn:disabled,
.secondary-btn:disabled,
.placeholder-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.secondary-btn {
  background: rgba(255, 255, 255, 0.04);
  color: #f4f4f5;
}

.empty-state {
  min-height: calc(100% - 76px);
  padding: 0 24px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #9ca3af;
  text-align: center;
}

.empty-icon {
  color: #52525b;
}

@media (max-width: 900px) {
  .task-templates-dialog {
    width: 94vw;
    height: 88vh;
  }

  .template-nav {
    width: 168px;
  }
}

@media (max-width: 760px) {
  .dialog-overlay {
    padding: 12px;
  }

  .task-templates-dialog {
    width: 100%;
    height: 92vh;
  }

  .dialog-body {
    flex-direction: column;
  }

  .template-nav {
    width: auto;
    border-right: none;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    display: flex;
    gap: 6px;
    overflow-x: auto;
  }

  .nav-item {
    flex: 0 0 auto;
    margin-bottom: 0;
  }

  .templates-content,
  .templates-content.app-only {
    grid-template-rows: auto;
  }

  .project-panel {
    border-top: 1px solid rgba(255, 255, 255, 0.06);
  }
}
</style>
