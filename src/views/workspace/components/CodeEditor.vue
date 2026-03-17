<script setup>
import { computed, ref, watch } from 'vue'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'

const props = defineProps({
  modelValue: {
    type: String,
    default: ''
  },
  language: {
    type: String,
    default: 'plaintext'
  },
  readOnly: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'save'])

const textareaRef = ref(null)
const lineNumbersRef = ref(null)
const highlightRef = ref(null)
const highlightContentRef = ref(null)

const lineNumbers = computed(() => {
  const lines = (props.modelValue || '').split('\n').length
  return Array.from({ length: Math.max(lines, 1) }, (_, index) => index + 1)
})

const highlightedHtml = computed(() => {
  const value = props.modelValue || ''
  const safeLanguage = props.language && hljs.getLanguage(props.language) ? props.language : null
  try {
    if (safeLanguage) {
      return hljs.highlight(value, { language: safeLanguage }).value
    }
    return hljs.highlightAuto(value).value
  } catch {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  }
})

function syncScroll() {
  if (!textareaRef.value) return
  const top = textareaRef.value.scrollTop
  const left = textareaRef.value.scrollLeft

  if (lineNumbersRef.value) {
    lineNumbersRef.value.scrollTop = top
  }
  if (highlightContentRef.value) {
    highlightContentRef.value.style.transform = `translate(${-left}px, ${-top}px)`
  }
}

function handleInput(event) {
  emit('update:modelValue', event.target.value)
}

function handleKeydown(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    emit('save')
  }
}

watch(() => props.modelValue, () => {
  requestAnimationFrame(() => {
    syncScroll()
  })
})
</script>

<template>
  <div class="code-editor">
    <div ref="lineNumbersRef" class="line-numbers" aria-hidden="true">
      <span v-for="line in lineNumbers" :key="line">{{ line }}</span>
    </div>

    <div class="editor-main">
      <pre ref="highlightRef" class="highlight-layer"><code ref="highlightContentRef" class="hljs highlight-content" v-html="highlightedHtml"></code></pre>
      <textarea
        ref="textareaRef"
        class="editor-input"
        spellcheck="false"
        :readonly="readOnly"
        :value="modelValue"
        @input="handleInput"
        @scroll="syncScroll"
        @keydown="handleKeydown"
      />
    </div>
  </div>
</template>

<style scoped>
.code-editor {
  display: flex;
  flex: 1;
  min-height: 0;
  min-width: 0;
  background: #111216;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  overflow: hidden;
}

.line-numbers {
  width: 52px;
  flex-shrink: 0;
  overflow: hidden;
  border-right: 1px solid #2E3138;
  background: #15171C;
  color: #5F6672;
  text-align: right;
  padding: 12px 8px 12px 0;
  line-height: 1.6;
  font-size: 12px;
}

.line-numbers span {
  display: block;
  height: 19.2px;
}

.editor-main {
  position: relative;
  flex: 1;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.highlight-layer,
.editor-input {
  position: absolute;
  inset: 0;
  margin: 0;
  padding: 12px 16px;
  line-height: 1.6;
  font-size: 12px;
  white-space: pre;
  tab-size: 2;
}

.highlight-layer {
  pointer-events: none;
  color: #D4D4D8;
  overflow: hidden;
}

.highlight-layer code {
  display: block;
  min-height: 100%;
  background: transparent;
  padding: 0;
  min-width: 100%;
  width: max-content;
}

.highlight-content {
  will-change: transform;
}

.editor-input {
  width: 100%;
  height: 100%;
  max-width: 100%;
  border: none;
  resize: none;
  background: transparent;
  color: transparent;
  caret-color: #F8FAFC;
  outline: none;
  overflow: auto;
}

.editor-input::selection {
  background: rgba(249, 115, 22, 0.28);
}

</style>
