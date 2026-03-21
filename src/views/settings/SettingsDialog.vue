<script setup>
import { computed, onMounted, onUnmounted } from 'vue'
import ModelSettings from './components/ModelSettings.vue'
import PromptSettings from './components/PromptSettings.vue'
import ChatThemeSettings from './components/ChatThemeSettings.vue'
import TerminalSettings from './components/TerminalSettings.vue'
import SoftwareSettings from './components/SoftwareSettings.vue'
import ModelEditDialog from './components/dialogs/ModelEditDialog.vue'
import CodexAccountEditDialog from './components/dialogs/CodexAccountEditDialog.vue'
import DefaultConfigDialog from './components/dialogs/DefaultConfigDialog.vue'
import CodexConfigDialog from './components/dialogs/CodexConfigDialog.vue'
import PromptEditDialog from './components/dialogs/PromptEditDialog.vue'
import DocumentEditDialog from './components/dialogs/DocumentEditDialog.vue'
import ModelMappingDialog from './components/dialogs/ModelMappingDialog.vue'
import { useSettingsNavigation } from './hooks/useSettingsNavigation'
import { useSettingsData } from './hooks/useSettingsData'
import { useDialogStack } from '../../composables/useDialogStack'

const emit = defineEmits(['close', 'saved'])
const {
  activeSection,
  contentRef,
  modelSectionRef,
  promptSectionRef,
  chatThemeSectionRef,
  terminalSectionRef,
  softwareSectionRef,
  navItems,
  scrollToSection,
  bindScrollListener,
  unbindScrollListener
} = useSettingsNavigation()

const {
  settings,
  defaultConfig,
  codexConfig,
  claudeModels,
  codexModels,
  selectedClaudeModelId,
  selectedCodexModelId,
  prompts,
  documents,
  showModelDialog,
  editingModel,
  editingModelType,
  showDefaultConfigDialog,
  showCodexConfigDialog,
  showCodexAccountDialog,
  editingCodexAccount,
  showPromptDialog,
  editingPrompt,
  showDocumentDialog,
  editingDocument,
  showMappingDialog,
  pendingModel,
  effortOptions,
  loadSettings,
  saveSoftwareSettings,
  handleAddClaudeModel,
  handleEditClaudeModel,
  handleDeleteClaudeModel,
  handleAddCodexModel,
  handleEditCodexModel,
  handleDeleteCodexModel,
  handleSaveModel,
  handleSelectClaudeModel,
  handleSelectCodexModel,
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
  handleAddPrompt,
  handleEditPrompt,
  handleDeletePrompt,
  handleTogglePromptActive,
  handleSavePrompt,
  handleAddDocument,
  handleEditDocument,
  handleDeleteDocument,
  handleToggleDocumentActive,
  handleSaveDocument,
  testBarkUrl,
  saveBarkUrl
} = useSettingsData(emit)

// ========== 生命周期 ==========
onMounted(() => {
  bindScrollListener()
  loadSettings()
})

onUnmounted(() => {
  unbindScrollListener()
})

function handleClose() {
  emit('close')
}

useDialogStack(computed(() => true), handleClose)
</script>

<template>
  <div class="dialog-overlay">
    <div class="settings-dialog" @click.stop>
      <div class="dialog-header">
        <h2>应用设置</h2>
        <button class="close-btn" @click="handleClose" title="关闭">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <!-- 左侧导航栏 -->
        <div class="settings-nav">
          <div
            v-for="item in navItems"
            :key="item.id"
            class="nav-item"
            :class="{ active: activeSection === item.id }"
            @click="scrollToSection(item.id)"
          >
            <svg v-if="item.icon === 'model'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="3"/>
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
            </svg>
            <svg v-else-if="item.icon === 'prompt'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <svg v-else-if="item.icon === 'software'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
              <line x1="8" y1="21" x2="16" y2="21"/>
              <line x1="12" y1="17" x2="12" y2="21"/>
            </svg>
            <svg v-else-if="item.icon === 'chat-theme'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20"/>
              <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>
              <path d="M8 7h8"/>
              <path d="M8 11h8"/>
              <path d="M8 15h5"/>
            </svg>
            <svg v-else-if="item.icon === 'terminal'" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="4 17 10 11 4 5"/>
              <line x1="12" y1="19" x2="20" y2="19"/>
            </svg>
            <span>{{ item.label }}</span>
          </div>
        </div>

        <!-- 右侧配置内容 -->
        <div class="settings-content" ref="contentRef">
          <div ref="modelSectionRef">
            <ModelSettings
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
              @delete-codex-account="handleDeleteCodexAccount"
              @apply-codex-account="handleApplyCodexAccount"
              @select-claude-model="handleSelectClaudeModel"
              @select-codex-model="handleSelectCodexModel"
              @edit-claude-model="handleEditClaudeModel"
              @edit-codex-model="handleEditCodexModel"
              @delete-claude-model="handleDeleteClaudeModel"
              @delete-codex-model="handleDeleteCodexModel"
              @add-claude-model="handleAddClaudeModel"
              @add-codex-model="handleAddCodexModel"
              @set-claude-model-default-card="handleSetClaudeModelDefaultCard"
              @set-codex-model-default-card="handleSetCodexModelDefaultCard"
              @toggle-claude-model-active="handleToggleClaudeModelActive"
              @toggle-codex-model-active="handleToggleCodexModelActive"
              @apply-claude-model="handleApplyClaudeModel"
              @apply-codex-model="handleApplyCodexModel"
            />
          </div>

          <div ref="promptSectionRef">
            <PromptSettings
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

          <div ref="chatThemeSectionRef">
            <ChatThemeSettings
              :settings="settings"
              @update:settings="settings = $event"
              @save-settings="saveSoftwareSettings"
            />
          </div>

          <div ref="terminalSectionRef">
            <TerminalSettings
              :settings="settings"
              @update:settings="settings = $event"
              @save-settings="saveSoftwareSettings"
            />
          </div>

          <div ref="softwareSectionRef">
            <SoftwareSettings
              :settings="settings"
              @update:settings="settings = $event"
              @save-settings="saveSoftwareSettings"
              @test-bark="testBarkUrl"
              @save-bark="saveBarkUrl"
            />
          </div>
        </div>
      </div>
    </div>

    <!-- 模型编辑对话框 -->
    <ModelEditDialog
      v-model:visible="showModelDialog"
      :model="editingModel"
      :model-type="editingModelType"
      @save="handleSaveModel"
      @close="showModelDialog = false"
    />

    <!-- 默认配置编辑对话框 -->
    <DefaultConfigDialog
      v-model:visible="showDefaultConfigDialog"
      :config="defaultConfig"
      @save="handleSaveDefaultConfig"
      @close="showDefaultConfigDialog = false"
    />

    <CodexConfigDialog
      v-model:visible="showCodexConfigDialog"
      :config="codexConfig"
      :effort-options="effortOptions"
      @save="handleSaveCodexConfig"
      @close="showCodexConfigDialog = false"
    />

    <CodexAccountEditDialog
      v-model:visible="showCodexAccountDialog"
      :account="editingCodexAccount"
      @save="handleSaveCodexAccount"
      @close="showCodexAccountDialog = false"
    />

    <!-- 提示词编辑对话框 -->
    <PromptEditDialog
      v-model:visible="showPromptDialog"
      :prompt="editingPrompt"
      @save="handleSavePrompt"
      @close="showPromptDialog = false"
    />

    <!-- 规范文档编辑对话框 -->
    <DocumentEditDialog
      v-model:visible="showDocumentDialog"
      :document="editingDocument"
      @save="handleSaveDocument"
      @close="showDocumentDialog = false"
    />

    <!-- 模型映射确认对话框 -->
    <ModelMappingDialog
      v-model:visible="showMappingDialog"
      :model="pendingModel"
      @confirm="handleMappingConfirm"
      @close="showMappingDialog = false"
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
  z-index: 1000;
}

.settings-dialog {
  background: #1F1F23;
  border-radius: 12px;
  width: 90vw;
  max-width: 900px;
  height: 85vh;
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
  display: flex;
  overflow: hidden;
}

.settings-nav {
  width: 200px;
  background: #18181B;
  border-right: 1px solid #3F3F46;
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
  color: #9CA3AF;
  transition: all 0.2s;
  margin-bottom: 4px;
}

.nav-item:hover {
  background: #27272A;
  color: #F4F4F5;
}

.nav-item.active {
  background: rgba(249, 115, 22, 0.1);
  color: #F97316;
}

.nav-item span {
  font-size: 14px;
}

.settings-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}
</style>
