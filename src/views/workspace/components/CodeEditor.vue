<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as monaco from 'monaco-editor'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import 'monaco-editor/min/vs/editor/editor.main.css'

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  originalValue: {
    type: String,
    default: ''
  },
  language: {
    type: String,
    default: 'plaintext'
  },
  diffMode: {
    type: Boolean,
    default: false
  },
  readOnly: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'save'])

const containerRef = ref(null)
let editor = null
let diffEditor = null
let model = null
let originalModel = null
let isApplyingExternalValue = false

if (!globalThis.MonacoEnvironment) {
  globalThis.MonacoEnvironment = {
    getWorker(_, label) {
      if (label === 'json') return new jsonWorker()
      if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
      if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
      if (label === 'typescript' || label === 'javascript') return new tsWorker()
      return new editorWorker()
    }
  }
}

function normalizeLanguage(language) {
  const map = {
    javascript: 'javascript',
    typescript: 'typescript',
    json: 'json',
    css: 'css',
    scss: 'scss',
    less: 'less',
    html: 'html',
    xml: 'html',
    markdown: 'markdown',
    yaml: 'yaml',
    ini: 'ini',
    plaintext: 'plaintext',
    bash: 'shell',
    python: 'python',
    rust: 'rust',
    go: 'go',
    java: 'java'
  }

  return map[language] || 'plaintext'
}

function initEditor() {
  if (!containerRef.value) return

  disposeEditor()
  model = monaco.editor.createModel(props.modelValue || '', normalizeLanguage(props.language))

  const baseOptions = {
    theme: 'vs-dark',
    automaticLayout: true,
    minimap: { enabled: false },
    scrollBeyondLastLine: false,
    fontSize: 12,
    lineHeight: 19,
    fontFamily: "'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace",
    wordWrap: 'off',
    folding: true,
    foldingHighlight: true,
    foldingStrategy: 'auto',
    showFoldingControls: 'always',
    glyphMargin: false,
    renderLineHighlight: 'line',
    lineNumbersMinChars: 3,
    lineDecorationsWidth: 20,
    selectOnLineNumbers: false,
    tabSize: 2,
    insertSpaces: true,
    bracketPairColorization: { enabled: true },
    guides: {
      indentation: true,
      bracketPairs: true,
      folding: true
    },
    overviewRulerBorder: false,
    scrollbar: {
      verticalScrollbarSize: 6,
      horizontalScrollbarSize: 6
    }
  }

  if (props.diffMode) {
    originalModel = monaco.editor.createModel(props.originalValue || '', normalizeLanguage(props.language))
    diffEditor = monaco.editor.createDiffEditor(containerRef.value, {
      ...baseOptions,
      readOnly: props.readOnly,
      originalEditable: false,
      enableSplitViewResizing: true,
      renderSideBySide: true
    })
    diffEditor.setModel({
      original: originalModel,
      modified: model
    })
    editor = diffEditor.getModifiedEditor()
  } else {
    editor = monaco.editor.create(containerRef.value, {
      ...baseOptions,
      model,
      readOnly: props.readOnly
    })
  }

  model.onDidChangeContent(() => {
    if (isApplyingExternalValue) return
    emit('update:modelValue', model.getValue())
  })

  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
    emit('save')
  })
}

function disposeEditor() {
  if (diffEditor) {
    diffEditor.dispose()
    diffEditor = null
    editor = null
  }
  if (editor) {
    editor.dispose()
    editor = null
  }
  if (originalModel) {
    originalModel.dispose()
    originalModel = null
  }
  if (model) {
    model.dispose()
    model = null
  }
}

onMounted(() => {
  initEditor()
})

onBeforeUnmount(() => {
  disposeEditor()
})

watch(() => props.modelValue, (nextValue) => {
  if (!editor || !model) return
  if (nextValue === model.getValue()) return

  isApplyingExternalValue = true
  model.pushEditOperations(
    [],
    [
      {
        range: model.getFullModelRange(),
        text: nextValue || ''
      }
    ],
    () => null
  )
  isApplyingExternalValue = false
})

watch(() => props.language, (nextLanguage) => {
  if (!model) return
  monaco.editor.setModelLanguage(model, normalizeLanguage(nextLanguage))
  if (originalModel) {
    monaco.editor.setModelLanguage(originalModel, normalizeLanguage(nextLanguage))
  }
})

watch(() => props.originalValue, (nextValue) => {
  if (!originalModel) return
  if (nextValue === originalModel.getValue()) return

  originalModel.pushEditOperations(
    [],
    [
      {
        range: originalModel.getFullModelRange(),
        text: nextValue || ''
      }
    ],
    () => null
  )
})

watch(() => props.readOnly, (nextReadOnly) => {
  if (diffEditor) {
    diffEditor.updateOptions({ readOnly: nextReadOnly })
  } else if (editor) {
    editor.updateOptions({ readOnly: nextReadOnly })
  }
})

watch(() => props.diffMode, () => {
  initEditor()
})
</script>

<template>
  <div ref="containerRef" class="code-editor"></div>
</template>

<style scoped>
.code-editor {
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #1E1E1E;
}

.code-editor :deep(.monaco-editor),
.code-editor :deep(.monaco-editor-background),
.code-editor :deep(.margin) {
  background: #1E1E1E !important;
}

.code-editor :deep(.monaco-editor .scroll-decoration) {
  box-shadow: none !important;
}

.code-editor :deep(.monaco-editor .scrollbar.vertical) {
  width: 6px !important;
}

.code-editor :deep(.monaco-editor .scrollbar.horizontal) {
  height: 6px !important;
}

.code-editor :deep(.monaco-editor .scrollbar .slider) {
  border-radius: 3px !important;
  background: #52525B !important;
  border: 1px solid #1E1E1E !important;
}

.code-editor :deep(.monaco-editor .scrollbar .slider:hover) {
  background: #71717A !important;
}

.code-editor :deep(.monaco-editor .scrollbar .slider.active) {
  background: #A1A1AA !important;
}

.code-editor :deep(.monaco-editor .scrollbar .scrollbar-shadow) {
  box-shadow: none !important;
}

.code-editor :deep(.monaco-editor .decorationsOverviewRuler) {
  opacity: 0.85;
}

.code-editor :deep(.monaco-editor .margin),
.code-editor :deep(.monaco-editor .margin-view-overlays),
.code-editor :deep(.monaco-editor .line-numbers),
.code-editor :deep(.monaco-editor .glyph-margin),
.code-editor :deep(.monaco-editor .margin-view-overlays *) {
  user-select: none !important;
  -webkit-user-select: none !important;
}
</style>
