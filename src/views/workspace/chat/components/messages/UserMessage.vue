<script setup>
/**
 * UserMessage - 用户消息组件
 * 显示用户发送的消息内容
 * 操作按钮（展开/折叠、撤销）已移至 MessageItem 组件的右侧列
 */
import { computed, ref } from 'vue'
import { useAppStore } from '../../../../../stores/useAppStore'
import { useFileBrowserStore } from '../../../../../stores/useFileBrowserStore'
import CopyButton from '../ui/CopyButton.vue'
import { formatAttachmentSize, getAttachmentDisplayLabel, getAttachmentIcon, isImageAttachment, toAttachmentUrl } from '../../../../../utils/chatAttachments'

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  messageIndex: {
    type: Number,
    required: true
  },
  copiedMessageIndex: {
    type: Number,
    default: -1
  },
  chatTheme: {
    type: Object,
    default: () => ({})
  }
})

const emit = defineEmits(['copyContent'])
const appStore = useAppStore()
const fileBrowserStore = useFileBrowserStore()

const userMessageStyle = computed(() => {
  const style = {}
  if (props.chatTheme?.userFontSize) {
    style.fontSize = props.chatTheme.userFontSize + 'px'
  }
  if (props.chatTheme?.userFontColor) {
    style.color = props.chatTheme.userFontColor
  }
  return style
})

// 是否已复制
const isCopied = computed(() => props.copiedMessageIndex === props.messageIndex)
const attachments = computed(() => Array.isArray(props.message.attachments) ? props.message.attachments : [])
const imagePreviewUrl = ref('')
const imagePreviewTitle = ref('')

function copyContent() {
  emit('copyContent', props.messageIndex)
}

async function handleAttachmentClick(attachment) {
  if (!attachment?.path) return

  if (isImageAttachment(attachment)) {
    imagePreviewUrl.value = toAttachmentUrl(attachment.path)
    imagePreviewTitle.value = attachment.name || '图片预览'
    return
  }

  const currentProjectPath = String(appStore.currentProject?.path || '').replace(/\\/g, '/')
  const attachmentPath = String(attachment.path || '').replace(/\\/g, '/')
  const projectPrefix = currentProjectPath ? `${currentProjectPath}/` : ''
  const filePath = currentProjectPath && (attachmentPath === currentProjectPath || attachmentPath.startsWith(projectPrefix))
    ? attachmentPath
    : attachment.path

  await fileBrowserStore.previewAttachmentFile(filePath)
}

function closeImagePreview() {
  imagePreviewUrl.value = ''
  imagePreviewTitle.value = ''
}
</script>

<template>
  <div class="message-user-container" :class="[`surface-${chatTheme.messageSurface || 'bubble'}`]">
    <div class="message-content user-content">
      <div class="message-text" :class="[`surface-${chatTheme.messageSurface || 'bubble'}`]" :style="userMessageStyle">
        <CopyButton
          :is-copied="isCopied"
          @copy="copyContent"
        />
        <div v-if="attachments.length" class="user-attachments">
          <div
            v-for="attachment in attachments"
            :key="attachment.id"
            class="user-attachment-chip"
            :class="{ image: isImageAttachment(attachment) }"
            role="button"
            tabindex="0"
            @click="handleAttachmentClick(attachment)"
            @keydown.enter.prevent="handleAttachmentClick(attachment)"
            @keydown.space.prevent="handleAttachmentClick(attachment)"
          >
            <span v-if="isImageAttachment(attachment)" class="user-attachment-thumb">
              <img :src="toAttachmentUrl(attachment.path)" :alt="attachment.name">
            </span>
            <span v-else class="user-attachment-icon">{{ getAttachmentIcon(attachment) }}</span>
            <span class="user-attachment-label">{{ getAttachmentDisplayLabel(attachment) }}</span>
            <span v-if="formatAttachmentSize(attachment.size)" class="user-attachment-size">{{ formatAttachmentSize(attachment.size) }}</span>
          </div>
        </div>
        {{ message.content }}
      </div>
    </div>
  </div>
  <div
    v-if="imagePreviewUrl"
    class="image-preview-overlay"
    @click.self="closeImagePreview"
  >
    <button class="image-preview-close" type="button" @click="closeImagePreview">×</button>
    <div class="image-preview-card">
      <div class="image-preview-title">{{ imagePreviewTitle }}</div>
      <img :src="imagePreviewUrl" :alt="imagePreviewTitle">
    </div>
  </div>
</template>

<style scoped>
.message-user-container {
  display: flex;
  width: 100%;
  flex-direction: column;
  align-items: flex-end;
  max-width: 100%;
}

.message-content.user-content {
  width: var(--ccgui-message-fill-width, fit-content);
  max-width: var(--ccgui-message-fill-width, calc(100% - 100px));
}

.message-text {
  max-width: 100%;
  padding: 12px 16px;
  border-radius: 8px;
  line-height: 1.5;
  position: relative;
  cursor: text;
  white-space: pre-wrap;
  overflow-x: hidden;
  overflow-wrap: anywhere;
  word-break: break-word;
  background: #3F3F46;
  color: #E4E4E7;
}

.message-text.surface-ghost {
  padding: 12px 16px;
  background: transparent;
  color: #E4E4E7;
  border: 1px solid rgba(228, 228, 231, 0.2);
  border-radius: 8px;
}

.user-attachments {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin: 0 28px 8px 0;
}

.user-attachment-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  min-height: 28px;
  padding: 4px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}

.user-attachment-chip:hover,
.user-attachment-chip:focus-visible {
  background: rgba(255, 255, 255, 0.1);
  border-color: rgba(255, 255, 255, 0.2);
  outline: none;
}

.user-attachment-chip.image {
  max-width: 260px;
}

.user-attachment-thumb {
  width: 28px;
  height: 28px;
  border-radius: 6px;
  overflow: hidden;
  flex: 0 0 auto;
}

.user-attachment-thumb img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.user-attachment-icon {
  font-size: 13px;
}

.user-attachment-label,
.user-attachment-size {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.user-attachment-label {
  max-width: 150px;
  font-size: 12px;
}

.user-attachment-size {
  font-size: 11px;
  color: #A1A1AA;
}

/* 复制按钮定位到右上角 */
.message-text :deep(.copy-btn) {
  position: absolute;
  top: 4px;
  right: 4px;
  opacity: 0;
  transition: opacity 0.15s;
}

/* hover 时显示复制按钮 */
.message-text:hover :deep(.copy-btn) {
  opacity: 1;
}

.image-preview-overlay {
  position: fixed;
  inset: 0;
  z-index: 1200;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  background: rgba(5, 8, 12, 0.88);
  backdrop-filter: blur(6px);
}

.image-preview-card {
  max-width: min(90vw, 1200px);
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.image-preview-title {
  font-size: 13px;
  color: #E4E4E7;
  text-align: center;
}

.image-preview-card img {
  max-width: 100%;
  max-height: calc(90vh - 44px);
  object-fit: contain;
  border-radius: 12px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.4);
}

.image-preview-close {
  position: absolute;
  top: 20px;
  right: 20px;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.12);
  color: #F4F4F5;
  font-size: 22px;
  line-height: 1;
  cursor: pointer;
}
</style>
