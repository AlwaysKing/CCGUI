<script setup>
import { computed, onMounted, ref } from 'vue'
import { useDialogStack } from '../../composables/useDialogStack'
import { useSettingsData } from '@/views/settings/hooks/useSettingsData'
import PromptSettings from '@/views/settings/components/PromptSettings.vue'
import PromptEditDialog from '@/views/settings/components/dialogs/PromptEditDialog.vue'
import DocumentEditDialog from '@/views/settings/components/dialogs/DocumentEditDialog.vue'

const emit = defineEmits(['close', 'saved'])
const activeSection = ref('prompts')

const {
  prompts,
  documents,
  showPromptDialog,
  editingPrompt,
  showDocumentDialog,
  editingDocument,
  loadSettings,
  handleAddPrompt,
  handleEditPrompt,
  handleDeletePrompt,
  handleTogglePromptActive,
  handleSavePrompt,
  handleAddDocument,
  handleEditDocument,
  handleDeleteDocument,
  handleToggleDocumentActive,
  handleSaveDocument
} = useSettingsData(emit)

function handleClose() {
  emit('close')
}

useDialogStack(computed(() => true), handleClose)

onMounted(() => {
  loadSettings()
})
</script>

<template>
  <div class="dialog-overlay">
    <div class="prompt-dialog" @click.stop>
      <div class="dialog-header">
        <h2>提示词面板</h2>
        <button class="close-btn" @click="handleClose" title="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <div class="prompt-nav">
          <div
            class="nav-item"
            :class="{ active: activeSection === 'prompts' }"
            @click="activeSection = 'prompts'"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span>自定义提示词</span>
          </div>
          <div
            class="nav-item"
            :class="{ active: activeSection === 'documents' }"
            @click="activeSection = 'documents'"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
              <polyline points="14 2 14 8 20 8"/>
              <line x1="16" y1="13" x2="8" y2="13"/>
              <line x1="16" y1="17" x2="8" y2="17"/>
            </svg>
            <span>规范文档</span>
          </div>
        </div>

        <div class="prompt-content settings-panel">
          <PromptSettings
            :section="activeSection"
            :hide-title="true"
            :prompts="prompts"
            :documents="documents"
            @add-prompt="handleAddPrompt"
            @edit-prompt="handleEditPrompt"
            @delete-prompt="handleDeletePrompt"
            @toggle-prompt-active="handleTogglePromptActive"
            @add-document="handleAddDocument"
            @edit-document="handleEditDocument"
            @delete-document="handleDeleteDocument"
            @toggle-document-active="handleToggleDocumentActive"
          />
        </div>
      </div>
    </div>

    <PromptEditDialog
      v-if="showPromptDialog"
      :visible="showPromptDialog"
      :prompt="editingPrompt"
      @close="showPromptDialog = false"
      @save="handleSavePrompt"
    />

    <DocumentEditDialog
      v-if="showDocumentDialog"
      :visible="showDocumentDialog"
      :document="editingDocument"
      @close="showDocumentDialog = false"
      @save="handleSaveDocument"
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

.prompt-dialog {
  --app-soft-surface: rgba(255, 255, 255, 0.024);
  --app-soft-surface-hover: rgba(255, 255, 255, 0.05);
  --app-soft-panel: rgba(255, 255, 255, 0.018);
  --app-soft-border: rgba(255, 255, 255, 0.13);
  --app-soft-border-hover: rgba(255, 255, 255, 0.18);
  --app-soft-panel-border: rgba(255, 255, 255, 0.08);
  width: min(980px, calc(100vw - 72px));
  height: min(760px, calc(100vh - 72px));
  display: flex;
  flex-direction: column;
  border-radius: 16px;
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
  min-height: 0;
  display: flex;
  background: transparent;
}

.prompt-nav {
  width: 188px;
  border-right: 1px solid #3F3F46;
  padding: 14px 0;
  overflow-y: auto;
  flex-shrink: 0;
  background: #18181C;
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

.nav-item:hover {
  background: rgba(255, 255, 255, 0.04);
  color: #F4F4F5;
}

.nav-item.active {
  background: rgba(249, 115, 22, 0.12);
  color: #FB923C;
  border-left-color: #F97316;
}

.prompt-content {
  flex: 1;
  min-width: 0;
  overflow-y: auto;
  padding: 18px;
}

.settings-panel :deep(.settings-section) {
  background: transparent;
  box-shadow: none;
  padding: 0;
  margin-bottom: 0;
}

.settings-panel :deep(.section-title) {
  display: none;
}

@media (max-width: 960px) {
  .prompt-dialog {
    width: calc(100vw - 24px);
    height: calc(100vh - 24px);
  }

  .dialog-body {
    flex-direction: column;
  }

  .prompt-nav {
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

  .prompt-content {
    padding: 14px;
  }
}
</style>
