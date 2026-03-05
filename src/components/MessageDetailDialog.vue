<script setup>
import { computed } from 'vue'

const props = defineProps({
  message: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['close'])

// 格式化 JSON 显示
const formattedMessages = computed(() => {
  if (!props.message?.rawMessages) return []
  return props.message.rawMessages.map(msg => ({
    type: msg.type || 'unknown',
    subtype: msg.subtype || msg.event?.type || '',
    timestamp: msg.timestamp || '',
    json: JSON.stringify(msg, null, 2)
  }))
})

// 获取消息标题
const dialogTitle = computed(() => {
  if (!props.message) return '消息详情'
  const role = props.message.role
  const roleNames = {
    user: '用户消息',
    assistant: '助手消息',
    tool_use: `工具调用: ${props.message.toolName || 'unknown'}`,
    question: '问答消息',
    thinking: '思考过程',
    status: '状态消息'
  }
  return roleNames[role] || '消息详情'
})

function close() {
  emit('close')
}

function stopPropagation(e) {
  e.stopPropagation()
}

// 复制到剪贴板
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text)
    // 可以添加 toast 提示
  } catch (err) {
    console.error('Failed to copy:', err)
  }
}
</script>

<template>
  <div class="dialog-overlay" @click="close">
    <div class="dialog-container" @click="stopPropagation">
      <div class="dialog-header">
        <h3 class="dialog-title">{{ dialogTitle }}</h3>
        <button class="close-button" @click="close">×</button>
      </div>

      <div class="dialog-body">
        <div v-if="message" class="message-summary">
          <div class="summary-item">
            <span class="summary-label">类型:</span>
            <span class="summary-value">{{ message.role }}</span>
          </div>
          <div class="summary-item" v-if="message.timestamp">
            <span class="summary-label">时间:</span>
            <span class="summary-value">{{ new Date(message.timestamp).toLocaleString() }}</span>
          </div>
          <div class="summary-item" v-if="message.toolName">
            <span class="summary-label">工具:</span>
            <span class="summary-value">{{ message.toolName }}</span>
          </div>
        </div>

        <div class="raw-messages">
          <div class="section-header">
            <span>原始消息数据</span>
            <span class="message-count">{{ formattedMessages.length }} 条</span>
          </div>

          <div v-if="formattedMessages.length === 0" class="empty-state">
            暂无原始消息数据
          </div>

          <div v-else class="messages-list">
            <div
              v-for="(msg, index) in formattedMessages"
              :key="index"
              class="message-item"
            >
              <div class="message-item-header">
                <span class="msg-type">{{ msg.type }}</span>
                <span class="msg-subtype" v-if="msg.subtype">{{ msg.subtype }}</span>
                <button
                  class="copy-button"
                  @click="copyToClipboard(msg.json)"
                  title="复制"
                >
                  📋
                </button>
              </div>
              <pre class="message-json">{{ msg.json }}</pre>
            </div>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <span class="hint">按 Esc 或点击外部关闭</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  backdrop-filter: blur(4px);
}

.dialog-container {
  background: #1E1E2E;
  border-radius: 12px;
  border: 1px solid #3B82F6;
  width: 90%;
  max-width: 800px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.dialog-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  border-bottom: 1px solid #333;
  background: linear-gradient(90deg, rgba(59, 130, 246, 0.1) 0%, transparent 100%);
}

.dialog-title {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #F8FAFC;
}

.close-button {
  width: 32px;
  height: 32px;
  border-radius: 6px;
  border: 1px solid #3F3F46;
  background: #27272A;
  color: #A1A1AA;
  font-size: 20px;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.2s;
}

.close-button:hover {
  background: #3F3F46;
  color: #F8FAFC;
}

.dialog-body {
  flex: 1;
  overflow: auto;
  padding: 16px 20px;
}

.message-summary {
  display: flex;
  gap: 20px;
  padding: 12px 16px;
  background: #161B22;
  border-radius: 8px;
  margin-bottom: 16px;
  flex-wrap: wrap;
}

.summary-item {
  display: flex;
  align-items: center;
  gap: 8px;
}

.summary-label {
  font-size: 12px;
  color: #6E7681;
}

.summary-value {
  font-size: 13px;
  color: #94A3B8;
  font-weight: 500;
}

.raw-messages {
  background: #0D1117;
  border-radius: 8px;
  border: 1px solid #30363D;
  overflow: hidden;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  background: #161B22;
  border-bottom: 1px solid #30363D;
  font-size: 13px;
  font-weight: 600;
  color: #8B949E;
}

.message-count {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 10px;
  background: rgba(59, 130, 246, 0.2);
  color: #58A6FF;
}

.empty-state {
  padding: 40px 20px;
  text-align: center;
  color: #6E7681;
  font-size: 14px;
}

.messages-list {
  max-height: 400px;
  overflow-y: auto;
}

.message-item {
  border-bottom: 1px solid #21262D;
}

.message-item:last-child {
  border-bottom: none;
}

.message-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  background: rgba(0, 0, 0, 0.2);
  position: sticky;
  top: 0;
}

.msg-type {
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 4px;
  background: rgba(59, 130, 246, 0.2);
  color: #58A6FF;
}

.msg-subtype {
  font-size: 11px;
  color: #8B949E;
}

.copy-button {
  margin-left: auto;
  padding: 4px 8px;
  border-radius: 4px;
  border: 1px solid #30363D;
  background: #21262D;
  cursor: pointer;
  font-size: 12px;
  transition: all 0.2s;
}

.copy-button:hover {
  background: #30363D;
}

.message-json {
  margin: 0;
  padding: 12px 16px;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  font-size: 11px;
  line-height: 1.5;
  color: #94A3B8;
  white-space: pre-wrap;
  word-break: break-all;
  max-height: 200px;
  overflow: auto;
  background: transparent;
}

.dialog-footer {
  padding: 12px 20px;
  border-top: 1px solid #333;
  background: #161B22;
}

.hint {
  font-size: 12px;
  color: #6E7681;
}

/* 滚动条样式 */
.messages-list::-webkit-scrollbar,
.message-json::-webkit-scrollbar,
.dialog-body::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.messages-list::-webkit-scrollbar-track,
.message-json::-webkit-scrollbar-track,
.dialog-body::-webkit-scrollbar-track {
  background: #0D1117;
}

.messages-list::-webkit-scrollbar-thumb,
.message-json::-webkit-scrollbar-thumb,
.dialog-body::-webkit-scrollbar-thumb {
  background: #30363D;
  border-radius: 3px;
}
</style>
