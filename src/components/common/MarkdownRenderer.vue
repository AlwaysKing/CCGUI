<script setup>
import { computed, ref, onMounted, watch, nextTick } from 'vue'
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

const containerRef = ref(null)
const copiedIndex = ref(-1)

const renderedHtml = computed(() => {
  if (!props.content) return ''
  try {
    return marked.parse(props.content)
  } catch (error) {
    console.error('Markdown parse error:', error)
    return props.content
  }
})

// 为代码块添加复制按钮
function addCopyButtons() {
  if (!containerRef.value) return

  const preElements = containerRef.value.querySelectorAll('pre')

  preElements.forEach((pre, index) => {
    // 检查是否已经添加过复制按钮
    if (pre.querySelector('.code-copy-btn')) return

    // 创建复制按钮
    const copyBtn = document.createElement('button')
    copyBtn.className = 'code-copy-btn'
    copyBtn.title = '复制代码'

    // 使用 SVG 图标
    copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
    </svg>`

    copyBtn.onclick = async () => {
      const code = pre.querySelector('code')?.textContent || pre.textContent
      try {
        await navigator.clipboard.writeText(code)
        // 显示成功图标
        copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>`
        copiedIndex.value = index
        setTimeout(() => {
          // 恢复原图标
          copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>`
          copiedIndex.value = -1
        }, 2000)
      } catch (err) {
        console.error('复制失败:', err)
        // 显示失败图标
        copyBtn.innerHTML = `✗`
        setTimeout(() => {
          // 恢复原图标
          copyBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
          </svg>`
        }, 2000)
      }
    }

    // 设置 pre 为相对定位
    pre.style.position = 'relative'
    pre.appendChild(copyBtn)
  })
}

onMounted(() => {
  nextTick(() => {
    addCopyButtons()
  })
})

watch(() => props.content, () => {
  nextTick(() => {
    addCopyButtons()
  })
})
</script>

<template>
  <div class="markdown-content" ref="containerRef" v-html="renderedHtml"></div>
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
  position: relative;
}

.markdown-content :deep(pre code) {
  background: transparent;
  padding: 0;
  border-radius: 0;
  font-size: 0.875em;
  line-height: 1.5;
}

/* 代码块复制按钮 */
.markdown-content :deep(.code-copy-btn) {
  position: absolute;
  top: 8px;
  right: 8px;
  color: #71717A;
  background: rgba(39, 39, 42, 0.9);
  border: none;
  border-radius: 4px;
  padding: 4px;
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.markdown-content :deep(.code-copy-btn svg) {
  display: block;
}

.markdown-content :deep(pre:hover .code-copy-btn) {
  opacity: 0.6;
}

.markdown-content :deep(.code-copy-btn:hover) {
  opacity: 1 !important;
  background: #27272A;
  color: #A1A1AA;
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
</style>
