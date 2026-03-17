<script setup>
import { computed, nextTick, ref, watch } from 'vue'

const props = defineProps({
  node: {
    type: Object,
    required: true
  },
  depth: {
    type: Number,
    default: 0
  },
  expandedDirs: {
    type: Object,
    required: true
  },
  activeFilePath: {
    type: String,
    default: ''
  },
  selectedNodePath: {
    type: String,
    default: ''
  },
  editingNodePath: {
    type: String,
    default: ''
  }
})

const emit = defineEmits([
  'toggle-directory',
  'preview-file',
  'pin-file',
  'select-node',
  'context-menu',
  'rename-node',
  'stop-rename-node'
])

const renameInputRef = ref(null)
const draftName = ref('')

const isExpanded = computed(() => props.expandedDirs.has(props.node.path))
const isDirectory = computed(() => props.node.type === 'directory')
const isActive = computed(() => props.activeFilePath === props.node.path)
const isSelected = computed(() => props.selectedNodePath === props.node.path)
const isEditing = computed(() => props.editingNodePath === props.node.path)

function getFileIcon() {
  if (isDirectory.value) {
    return isExpanded.value ? '📂' : '📁'
  }

  const extension = props.node.extension
  if (['.js', '.cjs', '.mjs', '.ts', '.tsx', '.jsx'].includes(extension)) return '🟨'
  if (extension === '.vue') return '🟩'
  if (['.json', '.yaml', '.yml', '.toml'].includes(extension)) return '🧩'
  if (['.md'].includes(extension)) return '📝'
  if (['.css', '.scss', '.less'].includes(extension)) return '🎨'
  if (['.html', '.xml'].includes(extension)) return '🌐'
  return '📄'
}

function selectCurrentNode() {
  emit('select-node', props.node)
}

function handleClick() {
  selectCurrentNode()

  if (isDirectory.value) {
    emit('toggle-directory', props.node)
    return
  }

  emit('preview-file', props.node)
}

function handleDoubleClick() {
  selectCurrentNode()
  if (!isDirectory.value) {
    emit('pin-file', props.node)
  }
}

function handleContextMenu(event) {
  event.preventDefault()
  selectCurrentNode()
  emit('context-menu', { event, node: props.node })
}

function submitRename() {
  emit('rename-node', {
    path: props.node.path,
    name: draftName.value
  })
}

function cancelRename() {
  draftName.value = props.node.name
  emit('stop-rename-node')
}

watch(isEditing, async (nextValue) => {
  if (nextValue) {
    draftName.value = props.node.name
    await nextTick()
    renameInputRef.value?.focus()
    renameInputRef.value?.select()
  }
}, { immediate: true })
</script>

<template>
  <div class="file-tree-node">
    <button
      v-if="!isEditing"
      class="file-tree-row"
      :class="{
        directory: isDirectory,
        active: isActive,
        selected: isSelected
      }"
      :style="{ paddingLeft: `${depth * 16 + 8}px` }"
      :title="node.path"
      @click="handleClick"
      @dblclick="handleDoubleClick"
      @contextmenu="handleContextMenu"
    >
      <span class="tree-caret">
        <template v-if="isDirectory">
          {{ isExpanded ? '▾' : '▸' }}
        </template>
      </span>
      <span class="tree-icon">{{ getFileIcon() }}</span>
      <span class="tree-name">{{ node.name }}</span>
      <span v-if="node.loading" class="tree-meta-inline">加载中</span>
    </button>

    <div
      v-else
      class="file-tree-row editing"
      :style="{ paddingLeft: `${depth * 16 + 8}px` }"
    >
      <span class="tree-caret">
        <template v-if="isDirectory">
          {{ isExpanded ? '▾' : '▸' }}
        </template>
      </span>
      <span class="tree-icon">{{ getFileIcon() }}</span>
      <input
        ref="renameInputRef"
        v-model="draftName"
        class="rename-input"
        @click.stop
        @keydown.enter.prevent="submitRename"
        @keydown.esc.prevent="cancelRename"
        @blur="submitRename"
      />
    </div>

    <div v-if="isDirectory && isExpanded" class="file-tree-children">
      <div v-if="node.error" class="tree-error">{{ node.error }}</div>
      <div v-else-if="node.loaded && node.children.length === 0" class="tree-empty">空目录</div>
      <FileTreeNode
        v-for="child in node.children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        :expanded-dirs="expandedDirs"
        :active-file-path="activeFilePath"
        :selected-node-path="selectedNodePath"
        :editing-node-path="editingNodePath"
        @toggle-directory="emit('toggle-directory', $event)"
        @preview-file="emit('preview-file', $event)"
        @pin-file="emit('pin-file', $event)"
        @select-node="emit('select-node', $event)"
        @context-menu="emit('context-menu', $event)"
        @rename-node="emit('rename-node', $event)"
        @stop-rename-node="emit('stop-rename-node')"
      />
    </div>
  </div>
</template>

<style scoped>
.file-tree-row {
  width: 100%;
  height: 30px;
  border: none;
  background: transparent;
  color: #D4D4D8;
  display: flex;
  align-items: center;
  gap: 6px;
  text-align: left;
  cursor: pointer;
  border-radius: 6px;
  padding-right: 8px;
  transition: background 0.15s, color 0.15s;
}

.file-tree-row:hover {
  background: #25262B;
}

.file-tree-row.active {
  background: rgba(249, 115, 22, 0.14);
  color: #FDEAD7;
}

.file-tree-row.selected:not(.active) {
  background: #2A2D33;
}

.file-tree-row.editing {
  cursor: default;
  background: #25262B;
}

.tree-caret {
  width: 12px;
  color: #71717A;
  flex-shrink: 0;
  text-align: center;
}

.tree-icon {
  width: 16px;
  flex-shrink: 0;
  text-align: center;
}

.tree-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.tree-meta,
.tree-empty,
.tree-error {
  font-size: 11px;
  color: #71717A;
  padding: 4px 8px 4px 28px;
}

.tree-meta-inline {
  font-size: 11px;
  color: #71717A;
  flex-shrink: 0;
}

.tree-error {
  color: #FCA5A5;
}

.rename-input {
  flex: 1;
  min-width: 0;
  height: 22px;
  border: 1px solid #F97316;
  border-radius: 4px;
  background: #111216;
  color: #F4F4F5;
  font-size: 12px;
  padding: 0 8px;
  outline: none;
}
</style>
