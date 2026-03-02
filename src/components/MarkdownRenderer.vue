<script setup>
import { computed } from 'vue'
import { marked } from 'marked'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'

// Configure marked with highlight.js
marked.setOptions({
  highlight: function(code, lang) {
    if (lang && hljs.getLanguage(lang)) {
      try {
        return hljs.highlight(code, { language: lang }).value
      } catch (err) {
        console.error('Highlight error:', err)
      }
    }
    return hljs.highlightAuto(code).value
  },
  breaks: true,
  gfm: true
})

const props = defineProps({
  content: {
    type: String,
    default: ''
  }
})

const renderedHtml = computed(() => {
  if (!props.content) return ''
  try {
    return marked.parse(props.content)
  } catch (error) {
    console.error('Markdown parse error:', error)
    return props.content
  }
})
</script>

<template>
  <div class="markdown-content" v-html="renderedHtml"></div>
</template>

<style scoped>
.markdown-content {
  line-height: 1.6;
  word-wrap: break-word;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  font-weight: 600;
}

.markdown-content :deep(h1) {
  font-size: 1.5em;
  border-bottom: 1px solid #3F3F46;
  padding-bottom: 0.3em;
}

.markdown-content :deep(h2) {
  font-size: 1.3em;
  border-bottom: 1px solid #3F3F46;
  padding-bottom: 0.3em;
}

.markdown-content :deep(h3) {
  font-size: 1.2em;
}

.markdown-content :deep(p) {
  margin: 0.5em 0;
}

.markdown-content :deep(code) {
  background: #18181B;
  padding: 0.2em 0.4em;
  border-radius: 4px;
  font-family: 'SF Mono', 'Monaco', 'Inconsolata', 'Fira Code', monospace;
  font-size: 0.9em;
  color: #E4E4E7;
}

.markdown-content :deep(pre) {
  background: #18181B;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  padding: 16px;
  overflow-x: auto;
  margin: 1em 0;
}

.markdown-content :deep(pre code) {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: 0.875em;
  line-height: 1.5;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin: 0.5em 0;
  padding-left: 2em;
}

.markdown-content :deep(li) {
  margin: 0.25em 0;
}

.markdown-content :deep(blockquote) {
  border-left: 4px solid #F97316;
  padding-left: 1em;
  margin: 1em 0;
  color: #A1A1AA;
  font-style: italic;
}

.markdown-content :deep(table) {
  border-collapse: collapse;
  width: 100%;
  margin: 1em 0;
}

.markdown-content :deep(th),
.markdown-content :deep(td) {
  border: 1px solid #3F3F46;
  padding: 8px 12px;
  text-align: left;
}

.markdown-content :deep(th) {
  background: #27272A;
  font-weight: 600;
}

.markdown-content :deep(tr:hover) {
  background: #27272A;
}

.markdown-content :deep(a) {
  color: #F97316;
  text-decoration: none;
}

.markdown-content :deep(a:hover) {
  text-decoration: underline;
}

.markdown-content :deep(img) {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  margin: 1em 0;
}

.markdown-content :deep(hr) {
  border: none;
  border-top: 1px solid #3F3F46;
  margin: 2em 0;
}

/* Code block language label */
.markdown-content :deep(pre)::before {
  content: attr(data-language);
  display: block;
  font-size: 0.75em;
  color: #6B7280;
  margin-bottom: 8px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}
</style>
