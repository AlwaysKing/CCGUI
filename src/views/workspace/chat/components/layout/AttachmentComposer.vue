<script setup>
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import {
  ATTACHMENT_TOKEN_REGEX,
  createAttachmentChipText,
  createAttachmentToken,
  formatAttachmentSize,
  getAttachmentIcon,
  getAttachmentDisplayLabel,
  isImageAttachment,
  toAttachmentUrl
} from '../../../../../utils/chatAttachments'

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  attachments: {
    type: Array,
    default: () => []
  },
  disabled: {
    type: Boolean,
    default: false
  },
  placeholder: {
    type: String,
    default: '输入消息...'
  },
  enterToSend: {
    type: Boolean,
    default: true
  }
})

const emit = defineEmits([
  'update:modelValue',
  'update:attachments',
  'submit',
  'history-up',
  'history-down',
  'history-picker'
])

const editorRef = ref(null)
const fileInputRef = ref(null)
const imagePreviewUrl = ref('')
const imagePreviewTitle = ref('')
let isApplyingExternalState = false

const attachmentMap = computed(() => new Map((props.attachments || []).map(item => [item.id, item])))
const hasContent = computed(() => {
  const withoutTokens = String(props.modelValue || '').replace(ATTACHMENT_TOKEN_REGEX, '').trim()
  return Boolean(withoutTokens || props.attachments.length > 0)
})

function buildTokenNode(attachment) {
  const token = document.createElement('span')
  token.className = 'attachment-inline-token'
  token.setAttribute('contenteditable', 'false')
  token.dataset.attachmentId = attachment.id
  token.textContent = createAttachmentChipText(attachment)
  return token
}

function appendTextChunk(fragment, chunk) {
  if (!chunk) return
  const parts = chunk.split('\n')
  parts.forEach((part, index) => {
    if (part) {
      fragment.appendChild(document.createTextNode(part))
    }
    if (index < parts.length - 1) {
      fragment.appendChild(document.createElement('br'))
    }
  })
}

function renderEditorFromModel() {
  if (!editorRef.value) return
  const root = editorRef.value
  const fragment = document.createDocumentFragment()
  const source = String(props.modelValue || '')
  let lastIndex = 0
  let match

  ATTACHMENT_TOKEN_REGEX.lastIndex = 0

  while ((match = ATTACHMENT_TOKEN_REGEX.exec(source)) !== null) {
    appendTextChunk(fragment, source.slice(lastIndex, match.index))
    const attachment = attachmentMap.value.get(match[1])
    if (attachment) {
      fragment.appendChild(buildTokenNode(attachment))
    } else {
      appendTextChunk(fragment, `[附件缺失:${match[1]}]`)
    }
    lastIndex = match.index + match[0].length
  }

  appendTextChunk(fragment, source.slice(lastIndex))

  isApplyingExternalState = true
  root.replaceChildren(fragment)
  isApplyingExternalState = false
}

function serializeNode(node) {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.nodeValue || ''
  }

  if (node.nodeType !== Node.ELEMENT_NODE) {
    return ''
  }

  if (node.nodeName === 'BR') {
    return '\n'
  }

  const attachmentId = node.dataset?.attachmentId
  if (attachmentId) {
    return createAttachmentToken(attachmentId)
  }

  if (node.nodeName === 'DIV' || node.nodeName === 'P') {
    return Array.from(node.childNodes).map(serializeNode).join('') + '\n'
  }

  return Array.from(node.childNodes).map(serializeNode).join('')
}

function syncModelFromDom() {
  if (!editorRef.value || isApplyingExternalState) return
  const serialized = getSerializedDomValue()
  const normalized = serialized.replace(/\u00a0/g, ' ').replace(/\n+$/, '')
  emit('update:modelValue', normalized)
}

function getSerializedDomValue() {
  if (!editorRef.value) return ''
  return Array.from(editorRef.value.childNodes).map(serializeNode).join('')
}

function placeCaretAtEnd() {
  if (!editorRef.value) return
  editorRef.value.focus()
  const range = document.createRange()
  range.selectNodeContents(editorRef.value)
  range.collapse(false)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
}

function insertNodeAtSelection(node) {
  const selection = window.getSelection()
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null

  if (!range || !editorRef.value?.contains(range.startContainer)) {
    editorRef.value?.appendChild(node)
    return
  }

  range.deleteContents()
  range.insertNode(node)
  range.setStartAfter(node)
  range.collapse(true)
  selection.removeAllRanges()
  selection.addRange(range)
}

function insertTextAtCursor(text) {
  editorRef.value?.focus()
  const selection = window.getSelection()
  const range = selection?.rangeCount ? selection.getRangeAt(0) : null
  if (!range || !editorRef.value?.contains(range.startContainer)) {
    editorRef.value?.appendChild(document.createTextNode(text))
  } else {
    range.deleteContents()
    const textNode = document.createTextNode(text)
    range.insertNode(textNode)
    range.setStartAfter(textNode)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }
  syncModelFromDom()
}

function updateAttachments(nextAttachments) {
  emit('update:attachments', nextAttachments)
}

function createAttachmentFromFile(file, source = 'picker') {
  const fileName = String(file.name || file.path || '')
  const isImageFile = Boolean(
    file.type?.startsWith('image/') ||
    /\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(fileName)
  )

  return {
    id: crypto.randomUUID(),
    kind: isImageFile ? 'image' : 'file',
    name: file.name,
    path: file.path,
    size: Number.isFinite(file.size) ? file.size : null,
    mimeType: file.type || null,
    source
  }
}

async function saveClipboardImage(file) {
  const buffer = await file.arrayBuffer()
  const result = await window.electronAPI.saveTempAttachment({
    bufferBase64: arrayBufferToBase64(buffer),
    mimeType: file.type || 'image/png',
    suggestedName: file.name || ''
  })

  if (!result?.success) {
    throw new Error(result?.error || '保存临时图片失败')
  }

  return {
    id: crypto.randomUUID(),
    kind: 'image',
    name: result.data.name,
    path: result.data.path,
    size: result.data.size,
    mimeType: result.data.mimeType,
    source: 'clipboard'
  }
}

async function addAttachments(newAttachments) {
  if (!newAttachments.length) return

  const nextAttachments = [...props.attachments]
  for (const attachment of newAttachments) {
    nextAttachments.push(attachment)
    insertNodeAtSelection(buildTokenNode(attachment))
    insertTextAtCursor(' ')
  }

  syncModelFromDom()
  updateAttachments(nextAttachments)
  await nextTick()
}

async function handleDroppedFiles(fileList, source = 'drag-drop') {
  const attachments = []

  for (const file of Array.from(fileList || [])) {
    if (file.path) {
      attachments.push(createAttachmentFromFile(file, source))
    }
  }

  await addAttachments(attachments)
}

async function handlePaste(event) {
  if (props.disabled) return

  const items = Array.from(event.clipboardData?.items || [])
  const imageItems = items.filter(item => item.type?.startsWith('image/'))

  if (!imageItems.length) {
    return
  }

  event.preventDefault()

  const attachments = []
  for (const item of imageItems) {
    const file = item.getAsFile()
    if (!file) continue
    attachments.push(await saveClipboardImage(file))
  }

  await addAttachments(attachments)
}

async function handleFileInputChange(event) {
  await handleDroppedFiles(event.target.files, 'picker')
  event.target.value = ''
}

async function removeAttachment(attachment) {
  const nextText = String(props.modelValue || '').replaceAll(createAttachmentToken(attachment.id), '').replace(/\s{2,}/g, ' ').trim()
  const nextAttachments = props.attachments.filter(item => item.id !== attachment.id)

  emit('update:modelValue', nextText)
  updateAttachments(nextAttachments)

  if (attachment.source === 'clipboard') {
    window.electronAPI.deleteTempAttachment({ path: attachment.path }).catch(() => {})
  }

  await nextTick()
  renderEditorFromModel()
  placeCaretAtEnd()
}

function handleKeydown(event) {
  if (props.disabled) return

  if ((event.metaKey || event.ctrlKey) && event.key === 'ArrowUp') {
    emit('history-picker', event)
    return
  }

  if (event.key === 'ArrowUp' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !hasContent.value) {
    emit('history-up', event)
    return
  }

  if (event.key === 'ArrowDown' && !event.shiftKey && !event.metaKey && !event.ctrlKey && !hasContent.value) {
    emit('history-down', event)
    return
  }

  if (event.key !== 'Enter') return

  if (!props.enterToSend || event.shiftKey) {
    return
  }

  if (!hasContent.value) {
    return
  }

  event.preventDefault()
  emit('submit')
}

function openFilePicker() {
  fileInputRef.value?.click()
}

function openImagePreview(attachment) {
  if (!isImageAttachment(attachment)) return
  imagePreviewUrl.value = attachment.path
  imagePreviewTitle.value = attachment.name
}

function closeImagePreview() {
  imagePreviewUrl.value = ''
  imagePreviewTitle.value = ''
}

function appendText(text) {
  insertTextAtCursor(String(text || ''))
}

function arrayBufferToBase64(buffer) {
  let binary = ''
  const bytes = new Uint8Array(buffer)
  const chunkSize = 0x8000
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function focus() {
  editorRef.value?.focus()
}

defineExpose({
  focus,
  appendText,
  openFilePicker
})

watch(() => props.modelValue, async () => {
  if (props.modelValue === getSerializedDomValue()) {
    return
  }
  await nextTick()
  renderEditorFromModel()
}, { immediate: true })

watch(() => props.attachments, async () => {
  const currentIds = Array.from(editorRef.value?.querySelectorAll?.('[data-attachment-id]') || []).map(node => node.dataset.attachmentId)
  const nextIds = props.attachments.map(item => item.id)
  if (currentIds.join(',') === nextIds.join(',') && props.modelValue === getSerializedDomValue()) {
    return
  }
  await nextTick()
  renderEditorFromModel()
}, { deep: true })

onMounted(() => {
  renderEditorFromModel()
})
</script>

<template>
  <div class="attachment-composer">
    <div v-if="attachments.length" class="attachment-strip">
      <button
        v-for="attachment in attachments"
        :key="attachment.id"
        class="attachment-chip"
        :class="{ image: isImageAttachment(attachment) }"
        :title="attachment.path"
        type="button"
        @click="isImageAttachment(attachment) ? openImagePreview(attachment) : null"
      >
        <span v-if="isImageAttachment(attachment)" class="attachment-thumb">
          <img :src="toAttachmentUrl(attachment.path)" :alt="attachment.name">
        </span>
        <span v-else class="attachment-icon">{{ getAttachmentIcon(attachment) }}</span>
        <span class="attachment-meta">
          <span class="attachment-name">{{ getAttachmentDisplayLabel(attachment) }}</span>
          <span v-if="formatAttachmentSize(attachment.size)" class="attachment-size">{{ formatAttachmentSize(attachment.size) }}</span>
        </span>
        <span
          class="attachment-remove"
          title="删除附件"
          @click.stop="removeAttachment(attachment)"
        >×</span>
      </button>
    </div>

    <div class="composer-shell">
      <div
        ref="editorRef"
        class="composer-editor"
        :class="{ disabled }"
        contenteditable="true"
        :data-placeholder="placeholder"
        @input="syncModelFromDom"
        @keydown="handleKeydown"
        @paste="handlePaste"
        @drop.prevent="handleDroppedFiles($event.dataTransfer?.files)"
        @dragover.prevent
      />
    </div>

    <input
      ref="fileInputRef"
      class="hidden-file-input"
      type="file"
      multiple
      @change="handleFileInputChange"
    >

    <div v-if="imagePreviewUrl" class="image-preview-mask" @click="closeImagePreview">
      <div class="image-preview-card" @click.stop>
        <div class="image-preview-header">
          <span>{{ imagePreviewTitle }}</span>
          <button type="button" class="image-preview-close" @click="closeImagePreview">×</button>
        </div>
        <img :src="toAttachmentUrl(imagePreviewUrl)" :alt="imagePreviewTitle" class="image-preview-image">
      </div>
    </div>
  </div>
</template>

<style scoped>
.attachment-composer {
  display: flex;
  flex-direction: column;
  min-height: 0;
  flex: 1;
}

.attachment-strip {
  display: flex;
  gap: 8px;
  padding: 10px 10px 6px;
  overflow-x: auto;
}

.attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  max-width: 240px;
  padding: 6px 8px;
  border-radius: 8px;
  border: 1px solid rgba(255, 255, 255, 0.13);
  background: rgba(255, 255, 255, 0.024);
  color: #E4E4E7;
  cursor: default;
}

.attachment-chip.image {
  cursor: pointer;
}

.attachment-thumb {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  overflow: hidden;
  flex: 0 0 auto;
  background: rgba(255, 255, 255, 0.06);
}

.attachment-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.attachment-icon {
  flex: 0 0 auto;
  font-size: 15px;
}

.attachment-meta {
  display: flex;
  flex-direction: column;
  min-width: 0;
  align-items: flex-start;
}

.attachment-name,
.attachment-size {
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.attachment-name {
  font-size: 12px;
}

.attachment-size {
  font-size: 11px;
  color: #A1A1AA;
}

.attachment-remove {
  flex: 0 0 auto;
  color: #A1A1AA;
  cursor: pointer;
  font-size: 16px;
  line-height: 1;
}

.composer-shell {
  flex: 1;
  min-height: 0;
  padding: 8px 12px 12px;
}

.composer-editor {
  width: 100%;
  min-height: 84px;
  outline: none;
  color: #F4F4F5;
  font-size: 14px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.composer-editor:empty::before {
  content: attr(data-placeholder);
  color: #71717A;
}

.composer-editor.disabled {
  opacity: 0.6;
  pointer-events: none;
}

.composer-editor :deep(.attachment-inline-token) {
  display: inline-flex;
  align-items: center;
  max-width: 260px;
  margin: 0 2px;
  padding: 1px 7px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.16);
  color: #E4E4E7;
  font-size: 12px;
  line-height: 1.4;
  vertical-align: middle;
}

.hidden-file-input {
  display: none;
}

.image-preview-mask {
  position: fixed;
  inset: 0;
  z-index: 4000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.66);
  backdrop-filter: blur(6px);
}

.image-preview-card {
  width: min(80vw, 960px);
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  border-radius: 14px;
  background: rgba(24, 24, 27, 0.94);
  border: 1px solid rgba(255, 255, 255, 0.12);
}

.image-preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 14px;
  color: #F4F4F5;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.image-preview-close {
  border: none;
  background: transparent;
  color: #D4D4D8;
  font-size: 20px;
  cursor: pointer;
}

.image-preview-image {
  width: 100%;
  height: auto;
  max-height: calc(80vh - 56px);
  object-fit: contain;
  background: #09090B;
}
</style>
