<script setup>
import { computed, ref } from 'vue'
import CollapseToggle from '../ui/CollapseToggle.vue'
import { useFileBrowserStore } from '../../../../../stores/useFileBrowserStore'

const DIFF_VIEW_MODE_KEY = 'ccgui_diff_view_mode'

const emit = defineEmits(['toggle-collapse'])
const fileBrowserStore = useFileBrowserStore()

const props = defineProps({
  toolName: {
    type: String,
    required: true
  },
  toolInput: {
    type: Object,
    default: () => ({})
  },
  result: {
    type: [String, Array],
    default: ''
  },
  isError: {
    type: Boolean,
    default: false
  },
  isExecuting: {
    type: Boolean,
    default: false
  },
  collapsed: {
    type: Boolean,
    default: false
  },
  workingDirectory: {
    type: String,
    default: ''
  },
  chatTheme: {
    type: Object,
    default: () => ({})
  }
})

function loadDiffViewMode() {
  try {
    const stored = localStorage.getItem(DIFF_VIEW_MODE_KEY)
    return stored === 'patch' ? 'patch' : 'split'
  } catch {
    return 'split'
  }
}

function saveDiffViewMode(mode) {
  try {
    localStorage.setItem(DIFF_VIEW_MODE_KEY, mode)
  } catch {
    // ignore storage failures
  }
}

function formatFilePath(filePath = '') {
  if (!filePath) return ''
  if (props.workingDirectory && filePath.startsWith(props.workingDirectory)) {
    const relativePath = filePath.slice(props.workingDirectory.length)
    const cleanPath = relativePath.startsWith('/') ? relativePath.slice(1) : relativePath
    return `@/${cleanPath}`
  }
  return filePath
}

function parseUnifiedDiff(diffText = '') {
  if (typeof diffText !== 'string' || !diffText.trim()) {
    return []
  }

  const sections = []
  const blocks = diffText.split(/^diff --git /gm).filter(Boolean)
  for (const rawBlock of blocks) {
    const block = `diff --git ${rawBlock}`.trim()
    const lines = block.split('\n')
    const header = lines[0] || ''
    const match = header.match(/^diff --git a\/(.+?) b\/(.+)$/)
    const filePath = match?.[2] || match?.[1] || ''
    const body = lines.slice(1)
    const rows = []
    let oldLineNumber = 1
    let newLineNumber = 1
    let pendingDeletes = []
    let pendingAdds = []

    function flushPendingChanges() {
      const maxLength = Math.max(pendingDeletes.length, pendingAdds.length)
      for (let index = 0; index < maxLength; index += 1) {
        const deleted = pendingDeletes[index] || null
        const added = pendingAdds[index] || null
        rows.push({
          leftType: deleted ? 'delete' : 'empty',
          leftText: deleted?.text || '',
          leftLineNumber: deleted?.lineNumber ?? null,
          rightType: added ? 'add' : 'empty',
          rightText: added?.text || '',
          rightLineNumber: added?.lineNumber ?? null
        })
      }
      pendingDeletes = []
      pendingAdds = []
    }

    for (const line of body) {
      if (line.startsWith('index ') || line.startsWith('--- ') || line.startsWith('+++ ')) {
        continue
      }

      if (line === '\\ No newline at end of file') {
        continue
      }

      if (line.startsWith('@@')) {
        flushPendingChanges()
        const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
        if (hunkMatch) {
          oldLineNumber = Number(hunkMatch[1])
          newLineNumber = Number(hunkMatch[2])
        }
        continue
      }

      if (line.startsWith('-')) {
        pendingDeletes.push({
          text: line.slice(1),
          lineNumber: oldLineNumber
        })
        oldLineNumber += 1
        continue
      }

      if (line.startsWith('+')) {
        pendingAdds.push({
          text: line.slice(1),
          lineNumber: newLineNumber
        })
        newLineNumber += 1
        continue
      }

      flushPendingChanges()
      rows.push({
        leftType: 'context',
        leftText: line.startsWith(' ') ? line.slice(1) : line,
        leftLineNumber: oldLineNumber,
        rightType: 'context',
        rightText: line.startsWith(' ') ? line.slice(1) : line,
        rightLineNumber: newLineNumber
      })
      oldLineNumber += 1
      newLineNumber += 1
    }

    flushPendingChanges()

    sections.push({
      filePath,
      displayPath: formatFilePath(filePath),
      rows
    })
  }

  return sections
}

function buildAlignedRows(oldLines = [], newLines = []) {
  const left = Array.isArray(oldLines) ? oldLines : []
  const right = Array.isArray(newLines) ? newLines : []
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0))

  for (let i = left.length - 1; i >= 0; i -= 1) {
    for (let j = right.length - 1; j >= 0; j -= 1) {
      if (left[i] === right[j]) {
        dp[i][j] = dp[i + 1][j + 1] + 1
      } else {
        dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
  }

  const rows = []
  let i = 0
  let j = 0

  while (i < left.length || j < right.length) {
    if (i < left.length && j < right.length && left[i] === right[j]) {
      rows.push({
        leftType: 'context',
        leftText: left[i] ?? '',
        leftLineNumber: i + 1,
        rightType: 'context',
        rightText: right[j] ?? '',
        rightLineNumber: j + 1
      })
      i += 1
      j += 1
      continue
    }

    if (j >= right.length || (i < left.length && dp[i + 1][j] >= dp[i][j + 1])) {
      rows.push({
        leftType: 'delete',
        leftText: left[i] ?? '',
        leftLineNumber: i + 1,
        rightType: 'empty',
        rightText: '',
        rightLineNumber: null
      })
      i += 1
      continue
    }

    rows.push({
      leftType: 'empty',
      leftText: '',
      leftLineNumber: null,
      rightType: 'add',
      rightText: right[j] ?? '',
      rightLineNumber: j + 1
    })
    j += 1
  }

  return rows
}

const isExpanded = computed(() => !props.collapsed)
const isTextStyle = computed(() => (props.chatTheme?.messageSurface || 'bubble') === 'ghost')
const mergedToolInput = computed(() => props.toolInput || {})
const diffViewMode = ref(loadDiffViewMode())

const editMode = computed(() => props.toolName === 'Edit')
const writeMode = computed(() => props.toolName === 'Write')
const patchMode = computed(() => props.toolName === 'ApplyPatch' || props.toolName === 'Diff')
const useSplitView = computed(() => diffViewMode.value === 'split')
const showViewToggle = computed(() => false)

const isAddOperation = computed(() => {
  if (!editMode.value) return false
  const input = mergedToolInput.value
  return input?.old_string === '' || input?.old_string === null || input?.old_string === undefined
})

const isDeleteOperation = computed(() => {
  if (!editMode.value) return false
  const input = mergedToolInput.value
  return input?.new_string === '' || input?.new_string === null || input?.new_string === undefined
})

const editDiffData = computed(() => {
  if (!editMode.value) return null
  const input = mergedToolInput.value
  const oldStr = input.old_string || ''
  const newStr = input.new_string || ''
  const oldLines = oldStr.split('\n')
  const newLines = newStr.split('\n')
  return {
    filePath: input.file_path || '',
    oldLines,
    newLines,
    rows: buildAlignedRows(oldLines, newLines),
    oldContent: oldStr,
    newContent: newStr,
    operationType: isAddOperation.value ? 'add' : isDeleteOperation.value ? 'delete' : 'replace'
  }
})

const editPatchRows = computed(() => {
  if (!editDiffData.value?.rows) return []
  const rows = []
  for (const row of editDiffData.value.rows) {
    if (row.leftType === 'context' && row.rightType === 'context') {
      rows.push({
        type: 'context',
        text: row.leftText || ' ',
        lineNumber: row.leftLineNumber
      })
      continue
    }
    if (row.leftType === 'delete') {
      rows.push({
        type: 'delete',
        text: row.leftText || ' ',
        lineNumber: row.leftLineNumber
      })
    }
    if (row.rightType === 'add') {
      rows.push({
        type: 'add',
        text: row.rightText || ' ',
        lineNumber: row.rightLineNumber
      })
    }
  }
  return rows
})

const writeContentData = computed(() => {
  if (!writeMode.value) return null
  const input = mergedToolInput.value
  const content = input.content || ''
  const lines = content.split('\n')
  return {
    filePath: input.file_path || '',
    content,
    lines,
    lineCount: lines.length,
    charCount: content.length
  }
})

const writePatchRows = computed(() => {
  if (!writeContentData.value) return []
  return writeContentData.value.lines.map((line, index) => ({
    type: 'add',
    text: line || ' ',
    lineNumber: index + 1
  }))
})

const unifiedDiffData = computed(() => {
  if (!patchMode.value) return null
  const input = mergedToolInput.value
  const rawDiff = input?.diff || input?.patch || props.result || ''
  const sections = parseUnifiedDiff(rawDiff)
  const insertions = (rawDiff.match(/^\+(?!\+\+).*/gm) || []).length
  const deletions = (rawDiff.match(/^-(?!--).*/gm) || []).length
  return {
    diff: rawDiff,
    sections,
    files: sections.map(section => section.filePath).filter(Boolean),
    insertions,
    deletions,
    changeCount: Array.isArray(input?.changes) ? input.changes.length : sections.length
  }
})

const headerTitle = computed(() => {
  return '文件编辑'
})

const previewFilePath = computed(() => {
  if (editMode.value) return editDiffData.value?.filePath || ''
  if (writeMode.value) return writeContentData.value?.filePath || ''
  if (patchMode.value) return unifiedDiffData.value?.files?.[0] || ''
  return ''
})

const previewFileName = computed(() => {
  const filePath = previewFilePath.value
  if (!filePath) return ''
  const normalized = String(filePath).replace(/\\/g, '/')
  return normalized.split('/').pop() || normalized
})

const expandedFilePath = computed(() => {
  if (editMode.value) return formatFilePath(editDiffData.value?.filePath || '')
  if (writeMode.value) return formatFilePath(writeContentData.value?.filePath || '')
  return ''
})

const collapsedSummary = computed(() => {
  if (editMode.value) {
    const input = mergedToolInput.value
    const editPath = formatFilePath(input.file_path || '')
    if (isAddOperation.value) return `${editPath}    添加内容`
    if (isDeleteOperation.value) return `${editPath}    删除内容`
    return `${editPath}    替换 ${(input.old_string || '').length} 字符 → ${(input.new_string || '').length} 字符`
  }

  if (writeMode.value) {
    const data = writeContentData.value
    if (!data) return ''
    return `${formatFilePath(data.filePath)}    ${data.lineCount} 行 · ${data.charCount} 字符`
  }

  const data = unifiedDiffData.value
  if (!data) return ''
  if (data.files.length === 1) {
    return `${formatFilePath(data.files[0])}    (+${data.insertions} -${data.deletions})`
  }
  if (data.files.length > 1) {
    return `${data.files.length} 个文件    (+${data.insertions} -${data.deletions})`
  }
  return `${data.changeCount} 处变更`
})

const textStyleSummary = computed(() => {
  if (previewFileName.value) return previewFileName.value
  if (patchMode.value && unifiedDiffData.value?.files?.length) {
    return `${unifiedDiffData.value.files.length} 个文件`
  }
  return ''
})

const textStyleMeta = computed(() => {
  if (editMode.value) {
    const input = mergedToolInput.value
    if (isAddOperation.value) return `(+${(input.new_string || '').split('\n').length})`
    if (isDeleteOperation.value) return `(-${(input.old_string || '').split('\n').length})`
    return `(+${(input.new_string || '').split('\n').length} -${(input.old_string || '').split('\n').length})`
  }

  if (writeMode.value) {
    return writeContentData.value ? `(+${writeContentData.value.lineCount})` : ''
  }

  if (patchMode.value && unifiedDiffData.value) {
    return `(+${unifiedDiffData.value.insertions} -${unifiedDiffData.value.deletions})`
  }

  return ''
})

const textStyleStatus = computed(() => {
  if (props.isExecuting) return 'executing'
  if (props.isError) return 'error'
  return 'success'
})

const viewModeLabel = computed(() => (useSplitView.value ? '分屏对比' : '补丁视图'))

const copiedType = ref('')

async function copyToClipboard(text, type) {
  try {
    await navigator.clipboard.writeText(text)
    copiedType.value = type
    setTimeout(() => {
      copiedType.value = ''
    }, 2000)
  } catch (error) {
    console.error('复制失败:', error)
  }
}

function toggleExpand() {
  emit('toggle-collapse')
}

function toggleDiffViewMode() {
  diffViewMode.value = useSplitView.value ? 'patch' : 'split'
  saveDiffViewMode(diffViewMode.value)
}

async function copyHeader() {
  const parts = [headerTitle.value]
  if (collapsedSummary.value) {
    parts.push(collapsedSummary.value)
  }
  await copyToClipboard(parts.join('\n'), 'header')
}

async function copyDiffBody() {
  if (editMode.value) {
    const input = mergedToolInput.value
    await copyToClipboard(`${input.old_string || ''}\n---\n${input.new_string || ''}`, 'content')
    return
  }

  if (writeMode.value) {
    await copyToClipboard(writeContentData.value?.content || '', 'content')
    return
  }

  await copyToClipboard(unifiedDiffData.value?.diff || '', 'content')
}

async function handlePreviewFile(event) {
  if (!previewFilePath.value) return
  event?.stopPropagation()
  try {
    await fileBrowserStore.previewFile(previewFilePath.value)
  } catch (error) {
    console.error('预览文件失败:', error)
  }
}
</script>

<template>
  <div class="diff-message-wrapper">
    <div class="diff-card" :class="{ collapsed: !isExpanded, 'text-style': isTextStyle, error: isError }">
      <div class="diff-header" @click="toggleExpand">
        <div class="diff-info">
          <template v-if="isTextStyle">
            <span class="diff-name text-style-label">{{ headerTitle }}</span>
            <CollapseToggle :collapsed="!isExpanded" @toggle="toggleExpand" />
            <button
              v-if="!isExpanded && previewFileName"
              class="text-style-summary text-style-file"
              type="button"
              @click.stop="handlePreviewFile"
            >
              {{ textStyleSummary }}
            </button>
            <span v-else-if="!isExpanded && textStyleSummary" class="text-style-summary">{{ textStyleSummary }}</span>
            <span v-if="!isExpanded && textStyleMeta" class="text-style-meta">{{ textStyleMeta }}</span>
            <span v-if="textStyleStatus" class="text-style-status" :class="`is-${textStyleStatus}`" aria-hidden="true">
              <svg v-if="textStyleStatus === 'success'" viewBox="0 0 12 12" fill="none">
                <path d="M2.2 6.2L4.7 8.7L9.8 3.4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
              <svg v-else-if="textStyleStatus === 'error'" viewBox="0 0 12 12" fill="none">
                <path d="M3 3L9 9M9 3L3 9" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" />
              </svg>
              <span v-else class="status-spinner"></span>
            </span>
          </template>
          <template v-else>
            <span class="diff-name">{{ headerTitle }}</span>
            <span class="status-badge executing" v-if="isExecuting">执行中...</span>
            <span class="status-badge error" v-else-if="isError">失败</span>
            <span class="status-badge success" v-else>完成</span>
          </template>
        </div>
        <div class="header-actions">
          <button
            class="copy-btn"
            @click.stop="copyHeader"
            :title="copiedType === 'header' ? '已复制' : '复制消息头'"
          >
            <svg v-if="copiedType === 'header'" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <CollapseToggle v-if="!isTextStyle" :collapsed="!isExpanded" @toggle="toggleExpand" />
        </div>
      </div>

      <div v-if="!isTextStyle && !isExpanded && collapsedSummary" class="collapsed-summary-line" @click="toggleExpand">
        {{ collapsedSummary }}
      </div>

      <div v-if="isExpanded" class="diff-body">
        <div class="diff-section" v-if="editMode && editDiffData">
          <div class="patch-file-card">
            <div class="patch-file-header">
              <div class="patch-file-header-main">
                <button v-if="expandedFilePath" class="patch-file-link" type="button" @click.stop="handlePreviewFile">
                  {{ expandedFilePath }}
                </button>
                <span v-else class="patch-file-title">文件编辑</span>
              </div>
              <button
                class="view-toggle-btn patch-view-toggle-btn"
                type="button"
                @click.stop="toggleDiffViewMode"
                :title="`切换为${useSplitView ? '补丁视图' : '分屏对比'}`"
              >
                {{ viewModeLabel }}
              </button>
            </div>
            <div v-if="useSplitView" class="diff-panels">
              <div class="diff-panel old-panel">
                <div class="diff-panel-header">
                  <span class="panel-title">原始内容</span>
                  <span class="line-count">{{ editDiffData.rows.filter(row => row.leftLineNumber !== null).length }} 行</span>
                </div>
                <div class="diff-panel-content">
                  <template v-if="editDiffData.rows.length">
                    <div
                      v-for="(row, index) in editDiffData.rows"
                      :key="'old-' + index"
                      class="diff-line"
                      :class="{
                        'old-line': row.leftType === 'delete',
                        'context-line': row.leftType === 'context',
                        'empty-line': row.leftType === 'empty'
                      }"
                    >
                      <span class="line-number">{{ row.leftLineNumber ?? '' }}</span>
                      <span class="line-content">{{ row.leftType === 'empty' ? ' ' : (row.leftText || ' ') }}</span>
                    </div>
                  </template>
                  <div v-else class="empty-content">（空内容）</div>
                </div>
              </div>
              <div class="diff-arrow"><span>⟹</span></div>
              <div class="diff-panel new-panel">
                <div class="diff-panel-header">
                  <span class="panel-title">新内容</span>
                  <span class="line-count">{{ editDiffData.rows.filter(row => row.rightLineNumber !== null).length }} 行</span>
                </div>
                <div class="diff-panel-content">
                  <template v-if="editDiffData.rows.length">
                    <div
                      v-for="(row, index) in editDiffData.rows"
                      :key="'new-' + index"
                      class="diff-line"
                      :class="{
                        'new-line': row.rightType === 'add',
                        'context-line': row.rightType === 'context',
                        'empty-line': row.rightType === 'empty'
                      }"
                    >
                      <span class="line-number">{{ row.rightLineNumber ?? '' }}</span>
                      <span class="line-content">{{ row.rightType === 'empty' ? ' ' : (row.rightText || ' ') }}</span>
                    </div>
                  </template>
                  <div v-else class="empty-content">（删除内容）</div>
                </div>
              </div>
            </div>
            <div v-else class="patch-file-content">
              <div
                v-for="(row, index) in editPatchRows"
                :key="`edit-patch-${index}`"
                class="patch-line"
                :class="{
                  'is-delete': row.type === 'delete',
                  'is-add': row.type === 'add',
                  'is-context': row.type === 'context'
                }"
              >
                <span class="patch-prefix">
                  {{ row.type === 'delete' ? '-' : row.type === 'add' ? '+' : ' ' }}
                </span>
                <span class="patch-text">{{ row.text }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="diff-section" v-else-if="writeMode && writeContentData">
          <div class="patch-file-card">
            <div class="patch-file-header">
              <div class="patch-file-header-main">
                <button v-if="expandedFilePath" class="patch-file-link" type="button" @click.stop="handlePreviewFile">
                  {{ expandedFilePath }}
                </button>
                <span v-else class="patch-file-title">文件编辑</span>
              </div>
              <button
                class="view-toggle-btn patch-view-toggle-btn"
                type="button"
                @click.stop="toggleDiffViewMode"
                :title="`切换为${useSplitView ? '补丁视图' : '分屏对比'}`"
              >
                {{ viewModeLabel }}
              </button>
            </div>
            <div v-if="useSplitView" class="write-preview">
              <div class="write-preview-header">
                <span class="preview-title">文件内容</span>
                <span class="line-count">{{ writeContentData.lineCount }} 行</span>
              </div>
              <div class="write-preview-content">
                <div v-for="(line, index) in writeContentData.lines.slice(0, 100)" :key="'write-' + index" class="write-line">
                  <span class="line-number">{{ index + 1 }}</span>
                  <span class="line-content">{{ line || ' ' }}</span>
                </div>
              </div>
            </div>
            <div v-else class="patch-file-content">
              <div
                v-for="(row, index) in writePatchRows"
                :key="`write-patch-${index}`"
                class="patch-line is-add"
              >
                <span class="patch-prefix">+</span>
                <span class="patch-text">{{ row.text }}</span>
              </div>
            </div>
          </div>
        </div>

        <div class="diff-section" v-else-if="patchMode && unifiedDiffData">
          <div v-for="(section, sectionIndex) in unifiedDiffData.sections" :key="`${section.filePath}-${sectionIndex}`" class="patch-file-card">
            <div class="patch-file-header">
              <div class="patch-file-header-main">
                <button v-if="section.displayPath" class="patch-file-link" type="button" @click.stop="handlePreviewFile">
                  {{ section.displayPath }}
                </button>
                <span v-else class="patch-file-title">文件编辑</span>
              </div>
              <button
                class="view-toggle-btn patch-view-toggle-btn"
                type="button"
                @click.stop="toggleDiffViewMode"
                :title="`切换为${useSplitView ? '补丁视图' : '分屏对比'}`"
              >
                {{ viewModeLabel }}
              </button>
            </div>
            <div v-if="useSplitView" class="diff-panels patch-diff-panels">
              <div class="diff-panel old-panel">
                <div class="diff-panel-header">
                  <span class="panel-title">原始内容</span>
                  <span class="line-count">
                    {{ section.rows.filter(row => row.leftLineNumber !== null).length }} 行
                  </span>
                </div>
                <div class="diff-panel-content">
                  <div
                    v-for="(row, lineIndex) in section.rows"
                    :key="`${sectionIndex}-${lineIndex}-left`"
                    class="diff-line"
                    :class="{
                      'old-line': row.leftType === 'delete',
                      'context-line': row.leftType === 'context',
                      'empty-line': row.leftType === 'empty'
                    }"
                  >
                    <span class="line-number">{{ row.leftLineNumber ?? '' }}</span>
                    <span class="line-content">{{ row.leftType === 'empty' ? ' ' : (row.leftText || ' ') }}</span>
                  </div>
                </div>
              </div>
              <div class="diff-arrow"><span>⟹</span></div>
              <div class="diff-panel new-panel">
                <div class="diff-panel-header">
                  <span class="panel-title">新内容</span>
                  <span class="line-count">
                    {{ section.rows.filter(row => row.rightLineNumber !== null).length }} 行
                  </span>
                </div>
                <div class="diff-panel-content">
                  <div
                    v-for="(row, lineIndex) in section.rows"
                    :key="`${sectionIndex}-${lineIndex}-right`"
                    class="diff-line"
                    :class="{
                      'new-line': row.rightType === 'add',
                      'context-line': row.rightType === 'context',
                      'empty-line': row.rightType === 'empty'
                    }"
                  >
                    <span class="line-number">{{ row.rightLineNumber ?? '' }}</span>
                    <span class="line-content">{{ row.rightType === 'empty' ? ' ' : (row.rightText || ' ') }}</span>
                  </div>
                </div>
              </div>
            </div>
            <div v-else class="patch-file-content">
              <div
                v-for="(row, lineIndex) in section.rows"
                :key="`${sectionIndex}-${lineIndex}-patch`"
                class="patch-line"
                :class="{
                  'is-delete': row.leftType === 'delete',
                  'is-add': row.rightType === 'add',
                  'is-context': row.leftType === 'context' && row.rightType === 'context'
                }"
              >
                <span class="patch-prefix">
                  {{
                    row.leftType === 'delete'
                      ? '-'
                      : row.rightType === 'add'
                        ? '+'
                        : ' '
                  }}
                </span>
                <span class="patch-text">
                  {{
                    row.leftType === 'delete'
                      ? row.leftText || ' '
                      : row.rightType === 'add'
                        ? row.rightText || ' '
                        : row.leftText || row.rightText || ' '
                  }}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div class="result-section">
          <div class="section-label">结果</div>
          <div class="result-wrapper">
            <button class="section-copy-btn" @click.stop="copyDiffBody" :title="copiedType === 'content' ? '已复制' : '复制'">
              <svg v-if="copiedType === 'content'" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
            <pre class="result-content">{{ result || 'The file has been updated successfully.' }}</pre>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.diff-message-wrapper {
  flex: 1;
  max-width: 70%;
}

.diff-card {
  background: linear-gradient(135deg, #1E1E2E 0%, #18181B 100%);
  border: 1px solid #3B82F6;
  border-left: 3px solid #3B82F6;
  border-radius: 8px;
  overflow: hidden;
  margin: 0;
  max-width: 100%;
}

.diff-card.text-style {
  background: transparent;
  border: none;
  border-radius: 0;
}

.diff-card.error {
  border-color: #EF4444;
  border-left-color: #EF4444;
}

.diff-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #252526;
  cursor: pointer;
}

.diff-card.text-style .diff-header {
  padding: 0;
  background: transparent;
  justify-content: flex-start;
  gap: 6px;
}

.diff-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.header-actions {
  display: inline-flex;
  align-items: center;
  justify-content: flex-end;
  gap: 6px;
  flex-shrink: 0;
}

.diff-card.text-style .diff-info {
  flex: 0 1 auto;
}

.diff-card.text-style .header-actions {
  justify-content: flex-start;
}

.diff-name {
  font-size: 13px;
  font-weight: 600;
  color: #E4E4E7;
  flex-shrink: 0;
}

.diff-card.text-style .diff-name {
  font-size: 12px;
  font-weight: 500;
  color: #C4C7CF;
}

.text-style-summary {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #8B93A7;
  font-size: 12px;
}

.text-style-meta {
  flex-shrink: 0;
  color: #6B7280;
  font-size: 11px;
}

.text-style-file,
.patch-file-link {
  appearance: none;
  border: none;
  background: transparent;
  padding: 0;
  color: #60A5FA;
  cursor: pointer;
  font: inherit;
  text-decoration: none;
}

.text-style-file:hover,
.patch-file-link:hover {
  color: #93C5FD;
  text-decoration: underline;
}

.text-style-status {
  width: 14px;
  height: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.text-style-status.is-success {
  color: #8B93A7;
}

.text-style-status.is-error {
  color: #F87171;
}

.status-spinner {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  border: 1.35px solid rgba(148, 163, 184, 0.28);
  border-top-color: currentColor;
  animation: diff-status-spin 0.9s linear infinite;
}

@keyframes diff-status-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.status-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
}

.status-badge.executing {
  background: #1E3A5F;
  color: #93C5FD;
}

.status-badge.error {
  background: #3F3F46;
  color: #F87171;
}

.status-badge.success {
  background: #065F46;
  color: #6EE7B7;
}

.copy-btn,
.section-copy-btn {
  font-size: 12px;
  color: #71717A;
  background: rgba(39, 39, 42, 0.9);
  border: none;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
}

.view-toggle-btn {
  appearance: none;
  border: 1px solid rgba(96, 165, 250, 0.25);
  background: rgba(37, 99, 235, 0.08);
  color: #93C5FD;
  padding: 4px 8px;
  border-radius: 999px;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
  transition: background 0.15s ease, border-color 0.15s ease, color 0.15s ease;
}

.view-toggle-btn:hover {
  background: rgba(37, 99, 235, 0.16);
  border-color: rgba(96, 165, 250, 0.4);
  color: #BFDBFE;
}

.diff-card.text-style .view-toggle-btn {
  background: transparent;
  border-color: rgba(148, 163, 184, 0.25);
  color: #94A3B8;
}

.diff-header:hover .copy-btn,
.result-wrapper:hover .section-copy-btn {
  opacity: 0.6;
}

.copy-btn:hover,
.section-copy-btn:hover {
  opacity: 1 !important;
  background: #27272A;
  color: #A1A1AA;
}

.collapsed-summary-line {
  padding: 8px 14px;
  font-size: 12px;
  color: #94A3B8;
  border-top: 1px solid rgba(59, 130, 246, 0.15);
  cursor: pointer;
  background: rgba(59, 130, 246, 0.03);
}

.diff-card.text-style .collapsed-summary-line {
  padding: 0 0 8px 24px;
  border-top: none;
  background: transparent;
  color: #8B93A7;
}

.diff-body {
  padding: 12px 14px 14px;
  background: #18181B;
}

.section-label {
  font-size: 12px;
  font-weight: 600;
  color: #A1A1AA;
  margin-bottom: 8px;
}

.section-description {
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  color: #D4D4D8;
  margin-bottom: 10px;
}

.diff-section,
.result-section {
  margin-bottom: 14px;
}

.result-section:last-child {
  margin-bottom: 0;
}

.result-wrapper {
  position: relative;
}

.section-copy-btn {
  position: absolute;
  top: 8px;
  right: 8px;
  z-index: 2;
}

.result-content {
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  background: #18181B;
  padding: 10px 12px;
  border-radius: 6px;
  white-space: pre-wrap;
  word-break: break-word;
  color: #A1A1AA;
  border: 1px solid #27272A;
}

.diff-container,
.patch-file-card {
  border-radius: 8px;
  overflow: hidden;
  background: #0D1117;
  border: 1px solid #30363D;
}

.write-preview {
  background: #0D1117;
}

.write-preview-header,
.patch-file-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  font-size: 12px;
  font-weight: 600;
  border-bottom: 1px solid #30363D;
  background: #21262D;
}

.diff-panels {
  display: flex;
  min-height: 120px;
  max-height: 400px;
}

.diff-panel {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.old-panel {
  border-right: 1px solid #30363D;
}

.diff-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  font-size: 11px;
  font-weight: 600;
  border-bottom: 1px solid #30363D;
}

.old-panel .diff-panel-header {
  background: linear-gradient(90deg, rgba(248, 81, 73, 0.1) 0%, transparent 100%);
  color: #F85149;
}

.new-panel .diff-panel-header {
  background: linear-gradient(90deg, rgba(63, 185, 80, 0.1) 0%, transparent 100%);
  color: #3FB950;
}

.line-count {
  font-size: 10px;
  padding: 2px 6px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.1);
  color: #8B949E;
}

.diff-panel-content,
.write-preview-content,
.patch-file-content {
  overflow: auto;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 12px;
  line-height: 1.5;
}

.diff-line,
.write-line,
.patch-line {
  display: flex;
  min-height: 22px;
  line-height: 22px;
}

.line-number,
.patch-prefix {
  flex-shrink: 0;
  width: 40px;
  padding: 0 8px;
  text-align: right;
  color: #6E7681;
  background: rgba(0, 0, 0, 0.2);
  user-select: none;
  font-size: 10px;
  border-right: 1px solid #30363D;
}

.line-content,
.patch-text {
  flex: 1;
  padding: 0 10px;
  white-space: pre;
}

.old-line {
  background: rgba(248, 81, 73, 0.08);
}

.old-line .line-content {
  color: #FFA198;
}

.new-line {
  background: rgba(63, 185, 80, 0.08);
}

.new-line .line-content {
  color: #7EE787;
}

.diff-arrow {
  width: 80px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #58A6FF;
  border-left: 1px solid #30363D;
  border-right: 1px solid #30363D;
}

.patch-file-card + .patch-file-card {
  margin-top: 10px;
}

.patch-file-header {
  gap: 12px;
}

.patch-file-header-main {
  min-width: 0;
  flex: 1;
}

.patch-view-toggle-btn {
  flex-shrink: 0;
}

.patch-line.is-add {
  background: rgba(63, 185, 80, 0.08);
  color: #7EE787;
}

.patch-line.is-delete {
  background: rgba(248, 81, 73, 0.08);
  color: #FFA198;
}

.patch-line.is-hunk {
  background: rgba(88, 166, 255, 0.08);
  color: #79C0FF;
}

.patch-line.is-context {
  color: #C9D1D9;
}

.empty-content {
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 80px;
  color: #6E7681;
  font-size: 12px;
}
</style>
