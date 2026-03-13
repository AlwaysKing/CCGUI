<script setup>
/**
 * PromptSettings - 提示词配置区域
 * 包含自定义提示词和规范文档
 */
import { ref } from 'vue'
import { SettingsSection, SubsectionHeader } from './common'
import { IconButton } from '@/components/common'

const props = defineProps({
  prompts: {
    type: Array,
    default: () => []
  },
  documents: {
    type: Array,
    default: () => []
  }
})

const emit = defineEmits([
  'add-prompt',
  'edit-prompt',
  'delete-prompt',
  'toggle-prompt-active',
  'add-document',
  'edit-document',
  'delete-document'
])

// 悬停状态
const hoveredPromptId = ref(null)
const hoveredDocumentId = ref(null)
</script>

<template>
  <SettingsSection title="提示词配置">
    <!-- 自定义提示词 -->
    <SubsectionHeader
      title="自定义提示词"
      show-add-button
      add-button-title="添加提示词"
      @add="emit('add-prompt')"
    />

    <div class="prompts-section">
      <div class="prompts-list">
        <div
          v-for="prompt in prompts"
          :key="prompt.id"
          class="prompt-card-item"
          @mouseenter="hoveredPromptId = prompt.id"
          @mouseleave="hoveredPromptId = null"
        >
          <div class="card-header">
            <h4 class="card-name">
              {{ prompt.name || '未命名' }}
              <button
                type="button"
                class="btn-toggle-active"
                :class="{ 'is-active': prompt.isActive }"
                @click.stop="emit('toggle-prompt-active', prompt.id)"
                :title="prompt.isActive ? '点击停用' : '点击激活'"
              >
                {{ prompt.isActive ? '已激活' : '未激活' }}
              </button>
            </h4>
            <div class="card-actions">
              <IconButton @click.stop="emit('edit-prompt', prompt)" title="编辑提示词">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </IconButton>
              <IconButton class="danger" @click.stop="emit('delete-prompt', prompt.id)" title="删除提示词">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </IconButton>
            </div>
          </div>
          <div class="card-description" v-if="prompt.description">
            {{ prompt.description }}
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="prompts.length === 0" class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
          </svg>
          <p class="empty-title">暂无自定义提示词</p>
          <p class="empty-description">点击右侧的"+"按钮开始配置</p>
        </div>
      </div>
    </div>

    <!-- 规范文档 -->
    <SubsectionHeader
      title="规范文档"
      show-add-button
      add-button-title="添加规范文档"
      @add="emit('add-document')"
    />

    <div class="documents-section">
      <div class="documents-list">
        <div
          v-for="document in documents"
          :key="document.id"
          class="document-card-item"
          @mouseenter="hoveredDocumentId = document.id"
          @mouseleave="hoveredDocumentId = null"
        >
          <div class="card-header">
            <h4 class="card-name">
              {{ document.name || '未命名' }}
            </h4>
            <div class="card-actions">
              <IconButton @click.stop="emit('edit-document', document)" title="编辑规范文档">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </IconButton>
              <IconButton class="danger" @click.stop="emit('delete-document', document.id)" title="删除规范文档">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </IconButton>
            </div>
          </div>
          <div class="card-summary" v-if="document.summary">
            {{ document.summary }}
          </div>
        </div>

        <!-- 空状态 -->
        <div v-if="documents.length === 0" class="empty-state">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
            <polyline points="14 2 14 8 20 8"/>
            <line x1="16" y1="13" x2="8" y2="13"/>
            <line x1="16" y1="17" x2="8" y2="17"/>
            <polyline points="10 9 9 9 8 9"/>
          </svg>
          <p class="empty-title">暂无规范文档</p>
          <p class="empty-description">点击右侧的"+"按钮开始配置</p>
        </div>
      </div>
    </div>
  </SettingsSection>
</template>

<style scoped>
.prompts-section,
.documents-section {
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  padding: 16px;
  margin-bottom: 24px;
}

.prompts-list,
.documents-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.prompt-card-item,
.document-card-item {
  background: #1F1F23;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  padding: 16px;
  transition: all 0.2s;
}

.prompt-card-item:hover,
.document-card-item:hover {
  background: #2D2D30;
  border-color: #52525B;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.card-name {
  flex: 1;
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: #F4F4F5;
  display: flex;
  align-items: center;
  gap: 8px;
}

.card-actions {
  display: flex;
  gap: 8px;
}

.card-actions .danger:hover {
  color: #EF4444;
}

.card-description,
.card-summary {
  margin-top: 12px;
  font-size: 13px;
  color: #9CA3AF;
  line-height: 1.5;
}

.btn-toggle-active {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  transition: all 0.2s;
  background: transparent;
  color: #71717A;
}

.btn-toggle-active:hover {
  background: rgba(156, 163, 175, 0.1);
}

.btn-toggle-active.is-active {
  background: rgba(34, 197, 94, 0.1);
  color: #22C55E;
  border: 1px solid rgba(34, 197, 94, 0.3);
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 24px;
  text-align: center;
}

.empty-state svg {
  color: #52525B;
  margin-bottom: 16px;
}

.empty-title {
  font-size: 16px;
  font-weight: 600;
  color: #9CA3AF;
  margin: 0 0 8px;
}

.empty-description {
  font-size: 13px;
  color: #71717A;
  margin: 0;
}
</style>
