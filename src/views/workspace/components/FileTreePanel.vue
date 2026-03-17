<script setup>
import FileTreeNode from './FileTreeNode.vue'

defineProps({
  tree: {
    type: Array,
    default: () => []
  },
  isLoading: {
    type: Boolean,
    default: false
  },
  error: {
    type: String,
    default: ''
  },
  expandedDirs: {
    type: Object,
    required: true
  },
  activeFilePath: {
    type: String,
    default: ''
  },
  hasOpenFiles: {
    type: Boolean,
    default: false
  },
  previewPanelVisible: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['refresh', 'toggle-preview-panel', 'toggle-directory', 'preview-file', 'pin-file'])
</script>

<template>
  <section class="file-tree-panel">
    <div class="file-tree-header">
      <div class="header-text">
        <div class="panel-title">文件</div>
        <div class="panel-subtitle">当前项目目录</div>
      </div>
      <div class="header-actions">
        <button class="refresh-btn" title="刷新文件树" @click.stop="emit('refresh')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 2v6h-6"></path>
            <path d="M3 11a9 9 0 0 1 15.55-5.36L21 8"></path>
            <path d="M3 22v-6h6"></path>
            <path d="M21 13a9 9 0 0 1-15.55 5.36L3 16"></path>
          </svg>
        </button>
        <button
          class="refresh-btn"
          :title="previewPanelVisible ? '隐藏预览区' : '显示预览区'"
          @click.stop="emit('toggle-preview-panel')"
        >
          <svg v-if="previewPanelVisible" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="16" rx="2"></rect>
            <path d="M9 4v16"></path>
          </svg>
          <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="4" width="18" height="16" rx="2"></rect>
            <path d="M15 4v16"></path>
          </svg>
        </button>
      </div>
    </div>

    <div class="file-tree-body">
      <div v-if="isLoading" class="tree-placeholder">正在加载文件列表...</div>
      <div v-else-if="error" class="tree-placeholder error">{{ error }}</div>
      <div v-else-if="tree.length === 0" class="tree-placeholder">当前目录暂无可展示文件</div>
      <FileTreeNode
        v-for="node in tree"
        :key="node.path"
        :node="node"
        :depth="0"
        :expanded-dirs="expandedDirs"
        :active-file-path="activeFilePath"
        @toggle-directory="emit('toggle-directory', $event)"
        @preview-file="emit('preview-file', $event)"
        @pin-file="emit('pin-file', $event)"
      />
    </div>
  </section>
</template>

<style scoped>
.file-tree-panel {
  display: flex;
  flex-direction: column;
  min-height: 0;
  border-bottom: 1px solid #3F3F46;
}

.file-tree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px 8px;
  border-bottom: 1px solid #2C2C31;
  background: #1A1B1F;
  gap: 8px;
}

.header-text {
  min-width: 0;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
}

.panel-title {
  font-size: 12px;
  font-weight: 600;
  color: #E4E4E7;
}

.panel-subtitle {
  font-size: 10px;
  color: #71717A;
  margin-top: 2px;
}

.refresh-btn {
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: #A1A1AA;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background 0.15s, color 0.15s;
}

.refresh-btn:hover {
  background: #2A2D33;
  color: #E4E4E7;
}

.file-tree-body {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 8px;
}

.tree-placeholder {
  font-size: 12px;
  color: #71717A;
  padding: 12px 8px;
}

.tree-placeholder.error {
  color: #FCA5A5;
}
</style>
