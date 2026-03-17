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
          ↻
        </button>
        <button
          class="refresh-btn"
          :title="previewPanelVisible ? '隐藏预览区' : '显示预览区'"
          @click.stop="emit('toggle-preview-panel')"
        >
          {{ previewPanelVisible ? '◧' : '◨' }}
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
  width: 24px;
  height: 24px;
  border: none;
  border-radius: 5px;
  background: transparent;
  color: #A1A1AA;
  cursor: pointer;
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
