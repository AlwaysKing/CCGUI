<script setup>
/**
 * PermissionResultMessage - 权限结果消息组件
 * 显示权限允许/拒绝的结果，与 ToolUseMessage 保持完全相同的格式
 */
import { computed, ref } from 'vue'
import CollapseToggle from '../ui/CollapseToggle.vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  }
})

// 折叠状态 - 默认折叠
const isCollapsed = ref(true)

// 复制状态
const copiedType = ref('')

// 切换折叠
function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
}

// 复制命令
async function copyCommand(text) {
  try {
    await navigator.clipboard.writeText(text)
    copiedType.value = 'command'
    setTimeout(() => {
      copiedType.value = ''
    }, 2000)
  } catch (e) {
    console.error('复制失败:', e)
  }
}

// 复制说明
async function copyDescription(text) {
  try {
    await navigator.clipboard.writeText(text)
    copiedType.value = 'description'
    setTimeout(() => {
      copiedType.value = ''
    }, 2000)
  } catch (e) {
    console.error('复制失败:', e)
  }
}

// 复制全部内容
async function copyAll() {
  try {
    await navigator.clipboard.writeText(props.message.content || '')
    copiedType.value = 'header'
    setTimeout(() => {
      copiedType.value = ''
    }, 2000)
  } catch (e) {
    console.error('复制失败:', e)
  }
}

// 解析消息内容
const parsedContent = computed(() => {
  const content = props.message.content || ''

  // 判断是允许还是拒绝
  const isApproved = content.startsWith('✅')
  const isDenied = content.startsWith('❌')
  const isApprovedAll = content.includes('(所有)')

  // 提取各行内容
  const lines = content.split('\n').filter(line => line.trim())

  // 第一行是标题行，提取工具名称
  const titleLine = lines[0] || ''
  // 去掉 emoji 前缀
  const cleanTitle = titleLine.replace(/^[✅❌]\s*/, '')
  const toolNameMatch = cleanTitle.match(/(?:已允许|已拒绝)(?:\s*\(所有\))?:\s*(.+)/)
  const toolName = toolNameMatch ? toolNameMatch[1].trim() : cleanTitle

  // 剩余行是详细内容
  const detailLines = lines.slice(1)

  // 解析详细内容为键值对
  const details = detailLines.map(line => {
    const colonIndex = line.indexOf(':')
    if (colonIndex > 0) {
      return {
        label: line.substring(0, colonIndex).trim(),
        value: line.substring(colonIndex + 1).trim()
      }
    }
    return { label: '', value: line.trim() }
  }).filter(d => d.value)

  // 提取命令和说明
  const commandDetail = details.find(d => d.label === '命令')
  const descriptionDetail = details.find(d => d.label === '说明')

  // 折叠时的摘要 - 优先显示命令
  const summary = commandDetail
    ? commandDetail.value
    : (details.length > 0 ? `${details[0].label}: ${details[0].value}` : '没有详细信息')

  return {
    isApproved,
    isApprovedAll,
    isDenied,
    toolName,
    details,
    summary,
    hasDetails: details.length > 0,
    command: commandDetail?.value || null,
    description: descriptionDetail?.value || null,
    statusText: isDenied ? '已拒绝' : (isApprovedAll ? '已允许 (所有)' : '已允许')
  }
})
</script>

<template>
  <div class="permission-result-wrapper">
    <div class="tool-use-card" :class="{ denied: parsedContent.isDenied }">
      <!-- 标题栏 - 与 ToolUseMessage 的 tool-header 完全一致 -->
      <div class="tool-header" @click="toggleCollapse">
        <div class="tool-info">
          <span class="tool-icon">{{ parsedContent.isApproved ? '✓' : '✗' }}</span>
          <span class="tool-name">{{ parsedContent.toolName }}</span>
          <span class="status-badge" :class="parsedContent.isDenied ? 'error' : 'success'">
            {{ parsedContent.statusText }}
          </span>
        </div>
        <div class="header-actions">
          <button class="copy-btn" @click.stop="copyAll" :title="copiedType === 'header' ? '已复制' : '复制'">
            <svg v-if="copiedType === 'header'" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
            <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
          </button>
          <CollapseToggle :collapsed="isCollapsed" @toggle="toggleCollapse" />
        </div>
      </div>

      <!-- 折叠时显示摘要 - 与 ToolUseMessage 完全一致 -->
      <div v-if="isCollapsed" class="collapsed-summary-line" @click="toggleCollapse">
        {{ parsedContent.summary }}
      </div>

      <!-- 展开时显示详细内容 - 与 ToolUseMessage 的 tool-body 完全一致 -->
      <div v-if="!isCollapsed" class="tool-body">
        <!-- 说明部分 - 与 ToolUseMessage 完全一致 -->
        <div v-if="parsedContent.description" class="tool-section">
          <div class="section-label">说明</div>
          <div class="section-content description">
            <button class="section-copy-btn" @click.stop="copyDescription(parsedContent.description)" :title="copiedType === 'description' ? '已复制' : '复制'">
              <svg v-if="copiedType === 'description'" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
            {{ parsedContent.description }}
          </div>
        </div>

        <!-- Bash 命令部分 - 与 ToolUseMessage 的 bash-container 完全一致 -->
        <div v-if="parsedContent.command" class="tool-section">
          <div class="section-label">命令</div>
          <div class="bash-container">
            <div class="bash-command">
              <button class="section-copy-btn" @click.stop="copyCommand(parsedContent.command)" :title="copiedType === 'command' ? '已复制' : '复制命令'">
                <svg v-if="copiedType === 'command'" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                <svg v-else xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
              <div class="bash-command-header">
                <span class="bash-prompt">$</span>
                <span class="bash-cmd-text">{{ parsedContent.command }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- 其他详细信息 -->
        <template v-if="parsedContent.hasDetails">
          <div
            v-for="(detail, index) in parsedContent.details"
            :key="index"
            class="tool-section"
          >
            <!-- 跳过已处理的说明和命令 -->
            <template v-if="detail.label !== '说明' && detail.label !== '命令'">
              <div class="section-label">{{ detail.label }}</div>
              <div class="section-content code">{{ detail.value }}</div>
            </template>
          </div>
        </template>

        <!-- 没有详细信息 -->
        <div v-if="!parsedContent.hasDetails" class="tool-section">
          <div class="section-label">详情</div>
          <div class="section-content empty">
            没有详细信息
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ========== 与 ToolUseMessage 完全一致的样式 ========== */

.permission-result-wrapper {
  flex: 1;
  max-width: 70%;
}

/* 卡片容器 - 与 ToolUseMessage 的 tool-use-card 完全一致，只改变边框颜色 */
.tool-use-card {
  background: linear-gradient(135deg, #1E1E2E 0%, #18181B 100%);
  border: 1px solid #22C55E;
  border-left: 3px solid #22C55E;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
  margin: 8px 0;
  max-width: 100%;
}

.tool-use-card.denied {
  border-color: #EF4444;
  border-left-color: #EF4444;
}

/* 标题栏 - 与 ToolUseMessage 完全一致 */
.tool-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 14px;
  background: #252526;
  cursor: pointer;
  user-select: none;
  min-width: 0;
}

.tool-header:hover {
  background: #2D2D30;
}

.tool-info {
  display: flex;
  align-items: center;
  gap: 10px;
  flex: 1;
  min-width: 0;
}

.tool-icon {
  font-size: 14px;
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 11px;
  font-weight: bold;
  background: #22C55E;
  color: white;
}

.tool-use-card.denied .tool-icon {
  background: #EF4444;
}

.tool-name {
  font-size: 13px;
  font-weight: 600;
  color: #F97316;
  flex-shrink: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.status-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  font-weight: 500;
  flex-shrink: 0;
}

.status-badge.success {
  background: #065F46;
  color: #6EE7B7;
}

.status-badge.error {
  background: #3F3F46;
  color: #F87171;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  margin-left: 8px;
}

.copy-btn {
  font-size: 12px;
  color: #71717A;
  background: transparent;
  border: none;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.copy-btn svg {
  display: block;
}

.tool-header:hover .copy-btn {
  opacity: 0.6;
}

.copy-btn:hover {
  background: #27272A;
  color: #A1A1AA;
  opacity: 1 !important;
}

/* 折叠时的摘要 - 与 ToolUseMessage 完全一致 */
.collapsed-summary-line {
  padding: 8px 14px;
  font-size: 12px;
  color: #A1A1AA;
  background: rgba(0, 0, 0, 0.15);
  cursor: pointer;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  border-top: 1px solid rgba(59, 130, 246, 0.15);
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
}

.collapsed-summary-line:hover {
  background: rgba(0, 0, 0, 0.2);
}

/* 详细内容 - 与 ToolUseMessage 完全一致 */
.tool-body {
  padding: 12px 14px;
  border-top: 1px solid #333;
}

.tool-section {
  margin-bottom: 10px;
}

.tool-section:last-child {
  margin-bottom: 0;
}

.section-label {
  font-size: 11px;
  color: #71717A;
  margin-bottom: 4px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.section-content {
  font-size: 12px;
  color: #D4D4D4;
  line-height: 1.5;
  position: relative;
}

.section-content.empty {
  color: #71717A;
  font-style: italic;
}

/* 复制按钮 - 与 ToolUseMessage 完全一致 */
.section-copy-btn {
  position: absolute;
  top: 4px;
  right: 4px;
  font-size: 12px;
  color: #71717A;
  background: rgba(39, 39, 42, 0.9);
  border: none;
  padding: 4px;
  border-radius: 4px;
  cursor: pointer;
  opacity: 0;
  transition: all 0.15s;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.section-copy-btn svg {
  display: block;
}

.section-content:hover .section-copy-btn,
.bash-command:hover .section-copy-btn {
  opacity: 0.6;
}

.section-copy-btn:hover {
  opacity: 1 !important;
  background: #27272A;
  color: #A1A1AA;
}

/* 说明样式 - 与 ToolUseMessage 完全一致 */
.section-content.description {
  color: #A1A1AA;
  white-space: pre-wrap;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  background: #18181B;
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 11px;
  line-height: 1.6;
}

/* 代码样式 - 与 ToolUseMessage 完全一致 */
.section-content.code {
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  background: #18181B;
  padding: 8px 12px;
  border-radius: 6px;
  color: #93C5FD;
  word-break: break-all;
  white-space: pre-wrap;
}

/* Bash 命令样式 - 与 ToolUseMessage 完全一致 */
.bash-container {
  margin-top: 8px;
  border-radius: 8px;
  overflow: hidden;
  background: #0D1117;
  border: 1px solid #30363D;
}

.bash-command {
  padding: 12px;
  position: relative;
}

.bash-command-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 13px;
  line-height: 1.5;
}

.bash-prompt {
  color: #3FB950;
  font-weight: 600;
  flex-shrink: 0;
}

.bash-cmd-text {
  color: #F8F8F2;
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
