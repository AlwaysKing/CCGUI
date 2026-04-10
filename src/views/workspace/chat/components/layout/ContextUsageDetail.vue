<script setup>
/**
 * ContextUsageDetail - 上下文用量详情展示组件
 * 用于 BaseDialog 中展示 session_usage 的详细信息
 */
import { computed } from 'vue'

const props = defineProps({
  usage: {
    type: Object,
    default: () => ({})
  }
})

const detail = computed(() => props.usage?.provider_detail || null)
const categories = computed(() => detail.value?.categories || [])
const totalTokens = computed(() => Number(props.usage?.total_tokens || 0))
const maxTokens = computed(() => Number(props.usage?.model_context_window || 0))

// 分类中文映射 + 默认颜色
const categoryMeta = {
  'System prompt':  { label: '系统提示',   color: '#3B82F6' },
  'System tools':   { label: '系统工具',   color: '#8B5CF6' },
  'MCP tools':      { label: 'MCP 工具',   color: '#F97316' },
  'Skills':         { label: '技能',       color: '#EC4899' },
  'Memory':         { label: '记忆文件',   color: '#14B8A6' },
  'Messages':       { label: '对话消息',   color: '#22C55E' },
  'Autocompact buffer': { label: '自动压缩缓冲', color: '#A1A1AA' },
  'Free space':     { label: '剩余空间',   color: '#3F3F46' },
  'Agents':         { label: 'Agent',      color: '#6366F1' },
  'Slash commands': { label: 'Slash 命令', color: '#F59E0B' }
}

function resolveCategoryLabel(name) {
  return categoryMeta[name]?.label || name
}

function resolveCategoryColor(name) {
  return categoryMeta[name]?.color || '#F97316'
}

// 条形图：所有分类加起来 = 上下文窗口总大小
const categoryBars = computed(() => {
  if (maxTokens.value <= 0) return []
  return categories.value.map(cat => ({
    ...cat,
    label: resolveCategoryLabel(cat.name),
    color: resolveCategoryColor(cat.name),
    width: Math.max(2, (cat.tokens / maxTokens.value) * 100)
  }))
})

const percentage = computed(() => {
  if (detail.value?.percentage) return detail.value.percentage
  if (maxTokens.value > 0 && totalTokens.value > 0) {
    return Math.round((totalTokens.value / maxTokens.value) * 1000) / 10
  }
  return null
})

const compacted = computed(() => !!props.usage?.compacted)
const compactSummary = computed(() => props.usage?.compact_summary || '')

const memoryFiles = computed(() => detail.value?.memoryFiles || [])
const mcpTools = computed(() => detail.value?.mcpTools || [])
const systemTools = computed(() => detail.value?.systemTools || [])
const deferredBuiltinTools = computed(() => detail.value?.deferredBuiltinTools || [])
const systemPromptSections = computed(() => detail.value?.systemPromptSections || [])
const agents = computed(() => detail.value?.agents || [])
const slashCommands = computed(() => detail.value?.slashCommands || null)
const skills = computed(() => detail.value?.skills || null)

// 子项列表
const subSections = computed(() => {
  const sections = []
  if (memoryFiles.value.length > 0) {
    sections.push({ key: 'memory', label: 'Memory 文件', icon: '📝', items: memoryFiles.value, count: memoryFiles.value.length })
  }
  if (mcpTools.value.length > 0) {
    sections.push({ key: 'mcp', label: 'MCP 工具', icon: '🔌', items: mcpTools.value, count: mcpTools.value.length })
  }
  if (systemTools.value.length > 0) {
    sections.push({ key: 'sysTools', label: '系统工具', icon: '🔧', items: systemTools.value, count: systemTools.value.length })
  }
  if (deferredBuiltinTools.value.length > 0) {
    sections.push({ key: 'deferred', label: '延迟加载工具', icon: '⏳', items: deferredBuiltinTools.value, count: deferredBuiltinTools.value.length })
  }
  if (systemPromptSections.value.length > 0) {
    sections.push({ key: 'prompt', label: '系统提示段落', icon: '📄', items: systemPromptSections.value, count: systemPromptSections.value.length })
  }
  if (agents.value.length > 0) {
    sections.push({ key: 'agents', label: 'Agent', icon: '🤖', items: agents.value, count: agents.value.length })
  }
  return sections
})


function fmt(n) {
  if (!Number.isFinite(n) || n <= 0) return '0'
  if (n >= 1000000) return `${(n / 1000000).toFixed(n >= 10000000 ? 0 : 1)}m`
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k`
  return String(Math.round(n))
}

function getItemName(item) {
  return item.path || item.name || item.agentType || '(unknown)'
}

function getItemMeta(item) {
  const parts = []
  if (item.serverName) parts.push(item.serverName)
  if (item.source) parts.push(item.source)
  return parts.join(' · ')
}

// 进度条颜色
function pctColor(pct) {
  if (pct >= 90) return '#EF4444'
  if (pct >= 80) return '#F59E0B'
  return '#F97316'
}
</script>

<template>
  <div class="ctx-detail">
    <!-- 总览区域 -->
    <div class="ctx-summary-card">
      <div class="ctx-summary-row">
        <div class="ctx-summary-main">
          <span class="ctx-summary-value">{{ fmt(totalTokens) }}<template v-if="maxTokens"> <span class="ctx-summary-sep">/</span> {{ fmt(maxTokens) }}</template></span>
          <span v-if="percentage !== null" class="ctx-summary-pct" :style="{ color: pctColor(percentage) }">{{ percentage }}%</span>
        </div>
        <span v-if="compacted" class="ctx-badge ctx-badge--warn">已压缩</span>
      </div>
      <!-- 进度条 -->
      <div v-if="maxTokens > 0 && totalTokens > 0" class="ctx-progress-track">
        <div class="ctx-progress-fill" :style="{ width: Math.min(100, (totalTokens / maxTokens) * 100) + '%', background: pctColor(percentage || 0) }"></div>
      </div>
      <!-- 压缩摘要 -->
      <div v-if="compacted && compactSummary" class="ctx-compact-note">
        {{ compactSummary }}
      </div>
    </div>

    <!-- 无详细信息 -->
    <div v-if="!detail" class="ctx-empty">
      <span>当前 provider 暂无详细用量明细</span>
    </div>

    <template v-if="detail">
      <!-- Categories 堆叠条形图 -->
      <div v-if="categories.length > 0" class="ctx-section">
        <div class="ctx-section-header">
          <span class="ctx-section-title">上下文构成</span>
        </div>
        <!-- 堆叠条 -->
        <div class="ctx-stacked-bar">
          <div
            v-for="(cat, i) in categoryBars"
            :key="i"
            class="ctx-stacked-segment"
            :style="{ width: cat.width + '%', backgroundColor: cat.color }"
          ></div>
        </div>
        <!-- 图例 -->
        <div class="ctx-bar-legend">
          <div v-for="(cat, i) in categoryBars" :key="i" class="ctx-legend-item">
            <span class="ctx-legend-dot" :style="{ backgroundColor: cat.color }"></span>
            <span class="ctx-legend-name">{{ cat.label }}</span>
            <span class="ctx-legend-tokens">{{ fmt(cat.tokens) }}</span>
          </div>
        </div>
      </div>

      <!-- 子项分组列表 -->
      <div v-for="section in subSections" :key="section.key" class="ctx-section">
        <div class="ctx-section-header">
          <span class="ctx-section-icon">{{ section.icon }}</span>
          <span class="ctx-section-title">{{ section.label }}</span>
          <span class="ctx-section-count">{{ section.count }}</span>
        </div>
        <div class="ctx-item-list ctx-item-list--scrollable">
          <div v-for="(item, i) in section.items" :key="i" class="ctx-list-item">
            <span class="ctx-item-name">{{ getItemName(item) }}</span>
            <span v-if="getItemMeta(item)" class="ctx-item-meta">{{ getItemMeta(item) }}</span>
            <span class="ctx-item-tokens">{{ fmt(item.tokens) }}</span>
            <span v-if="item.isLoaded === false" class="ctx-badge ctx-badge--dim">未加载</span>
          </div>
        </div>
      </div>

      <!-- Slash 命令 / 技能摘要 -->
      <div v-if="slashCommands || skills" class="ctx-section">
        <div class="ctx-section-header">
          <span class="ctx-section-title">命令与技能</span>
        </div>
        <div class="ctx-item-list">
          <div v-if="slashCommands" class="ctx-list-item">
            <span class="ctx-item-name">Slash 命令</span>
            <span class="ctx-item-meta">{{ slashCommands.includedCommands }}/{{ slashCommands.totalCommands }}</span>
            <span class="ctx-item-tokens">{{ fmt(slashCommands.tokens) }}</span>
          </div>
          <div v-if="skills" class="ctx-list-item">
            <span class="ctx-item-name">技能</span>
            <span class="ctx-item-meta">{{ skills.includedSkills }}/{{ skills.totalSkills }}</span>
            <span class="ctx-item-tokens">{{ fmt(skills.tokens) }}</span>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.ctx-detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ── 总览卡片 ── */
.ctx-summary-card {
  background: #18181B;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  padding: 14px 16px;
}

.ctx-summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ctx-summary-main {
  display: flex;
  align-items: baseline;
  gap: 8px;
}

.ctx-summary-value {
  font-size: 18px;
  font-weight: 600;
  color: #F4F4F5;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  letter-spacing: -0.02em;
}

.ctx-summary-sep {
  color: #71717A;
  font-weight: 400;
}

.ctx-summary-pct {
  font-size: 14px;
  font-weight: 600;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
}

.ctx-progress-track {
  height: 6px;
  border-radius: 3px;
  background: #27272A;
  margin-top: 12px;
  overflow: hidden;
}

.ctx-progress-fill {
  height: 100%;
  border-radius: 3px;
  transition: width 0.3s ease, background 0.3s ease;
}

.ctx-compact-note {
  margin-top: 10px;
  font-size: 12px;
  line-height: 1.5;
  color: #A1A1AA;
  padding: 8px 10px;
  background: rgba(245, 158, 11, 0.06);
  border: 1px solid rgba(245, 158, 11, 0.15);
  border-radius: 6px;
}

/* ── 徽章 ── */
.ctx-badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  font-weight: 500;
  flex-shrink: 0;
}

.ctx-badge--warn {
  background: rgba(245, 158, 11, 0.15);
  color: #FBBF24;
}

.ctx-badge--dim {
  background: rgba(113, 113, 122, 0.15);
  color: #A1A1AA;
}

/* ── 空状态 ── */
.ctx-empty {
  padding: 28px 0;
  text-align: center;
  font-size: 13px;
  color: #71717A;
}

/* ── 区块 ── */
.ctx-section {
  background: #18181B;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  overflow: hidden;
}

.ctx-section-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: #1F1F23;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.ctx-section-icon {
  font-size: 12px;
}

.ctx-section-title {
  font-size: 12px;
  font-weight: 600;
  color: #9CA3AF;
}

.ctx-section-count {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  background: rgba(249, 115, 22, 0.15);
  color: #FB923C;
  margin-left: auto;
}

/* ── 堆叠条形图 ── */
.ctx-stacked-bar {
  height: 10px;
  display: flex;
  overflow: hidden;
  margin: 12px 14px 0;
  border-radius: 5px;
  background: #27272A;
}

.ctx-stacked-segment {
  height: 100%;
  min-width: 3px;
  transition: width 0.3s ease;
}

.ctx-bar-legend {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
  padding: 10px 14px 12px;
}

.ctx-legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
}

.ctx-legend-dot {
  width: 8px;
  height: 8px;
  border-radius: 2px;
  flex-shrink: 0;
}

.ctx-legend-name {
  font-size: 12px;
  color: #D1D5DB;
}

.ctx-legend-tokens {
  font-size: 11px;
  color: #71717A;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
}

/* ── 列表 ── */
.ctx-item-list {
  padding: 4px 0;
}

.ctx-item-list--scrollable {
  max-height: 200px;
  overflow-y: auto;
}

.ctx-item-list--scrollable::-webkit-scrollbar {
  width: 5px;
}

.ctx-item-list--scrollable::-webkit-scrollbar-track {
  background: transparent;
}

.ctx-item-list--scrollable::-webkit-scrollbar-thumb {
  background: #3F3F46;
  border-radius: 3px;
}

.ctx-item-list--scrollable::-webkit-scrollbar-thumb:hover {
  background: #52525B;
}

.ctx-list-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 14px;
  transition: background 0.1s ease;
}

.ctx-list-item:hover {
  background: rgba(255, 255, 255, 0.03);
}

.ctx-item-name {
  font-size: 12px;
  color: #D1D5DB;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.ctx-item-meta {
  font-size: 11px;
  color: #71717A;
  flex-shrink: 0;
}

.ctx-item-tokens {
  font-size: 11px;
  color: #9CA3AF;
  font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
  flex-shrink: 0;
  min-width: 36px;
  text-align: right;
}
</style>
