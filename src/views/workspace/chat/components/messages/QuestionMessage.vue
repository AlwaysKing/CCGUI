<script setup>
/**
 * QuestionMessage - 问答消息组件
 * 从 ChatWindow.vue 提取
 */
import CopyButton from '../ui/CopyButton.vue'
import StatusBadge from '../ui/StatusBadge.vue'
import CollapseToggle from '../ui/CollapseToggle.vue'

const props = defineProps({
  message: {
    type: Object,
    required: true
  },
  messageIndex: {
    type: Number,
    required: true
  },
  isCollapsed: {
    type: Boolean,
    default: true
  },
  activeTab: {
    type: Number,
    default: 0
  },
  copiedMessageIndex: {
    type: Number,
    default: -1
  }
})

const emit = defineEmits(['toggleCollapse', 'copyContent', 'switchTab'])

// 检查选项是否被选中
function isOptionSelected(question, optionLabel) {
  if (question.multiSelect) {
    const answer = question.selectedAnswer
    if (Array.isArray(answer)) {
      return answer.includes(optionLabel)
    }
    if (typeof answer === 'string') {
      const selectedOptions = answer.split(/,\s*/).map(s => s.trim())
      return selectedOptions.includes(optionLabel)
    }
    return false
  }
  return optionLabel === question.selectedAnswer
}

function toggleCollapse() {
  emit('toggleCollapse', props.messageIndex)
}

function copyContent() {
  emit('copyContent', props.messageIndex)
}

function switchTab(tabIndex) {
  emit('switchTab', { messageIndex: props.messageIndex, tabIndex })
}
</script>

<template>
  <div class="question-message-wrapper">
    <div
      class="question-message"
      :class="{ 'answer-mismatch': message.resultReceived && !message.answersConsistent }"
    >
      <!-- Header with collapse button -->
      <div class="question-message-header" @click="toggleCollapse">
        <div class="question-title">
          <span class="question-icon">❓</span>
          <span class="question-count" v-if="message.questions && message.questions.length > 1">{{ message.questions.length }} 个问题</span>
          <span class="question-count" v-else>问答</span>
          <StatusBadge v-if="message.resultReceived && message.answersConsistent" type="success">答案已确认</StatusBadge>
          <StatusBadge v-else-if="message.resultReceived && !message.answersConsistent" type="warning">答案不一致</StatusBadge>
        </div>
        <div class="header-actions">
          <CopyButton
            :is-copied="copiedMessageIndex === messageIndex"
            size="12"
            title="复制问答内容"
            @copy="copyContent"
          />
          <CollapseToggle :collapsed="isCollapsed" @toggle="toggleCollapse" />
        </div>
      </div>

      <!-- Collapsed view: show only answers -->
      <div v-if="isCollapsed" class="collapsed-answers">
        <div
          v-for="(q, qIdx) in message.questions"
          :key="qIdx"
          class="collapsed-answer-item"
        >
          <span class="collapsed-question-label">{{ q.header }}:</span>
          <span class="collapsed-answer-content">{{ q.selectedAnswer || '未选择' }}</span>
        </div>
      </div>

      <!-- Expanded view: show full content -->
      <template v-else>
        <!-- Tab Headers (only show if multiple questions) -->
        <div v-if="message.questions && message.questions.length > 1" class="question-tab-headers">
          <button
            v-for="(q, qIdx) in message.questions"
            :key="qIdx"
            type="button"
            class="question-tab-button"
            :class="{ active: qIdx === activeTab }"
            @click="switchTab(qIdx)"
          >
            <span class="tab-status">✓</span>
            <span class="tab-label">{{ q.header }}</span>
          </button>
        </div>

        <!-- Question content -->
        <div
          v-for="(q, qIndex) in message.questions"
          :key="qIndex"
          v-show="qIndex === activeTab"
          class="question-content"
        >
          <div class="question-header">
            <span class="question-icon">❓</span>
            <span class="question-label">{{ q.header }}</span>
            <span v-if="q.multiSelect" class="multi-select-hint">(可多选)</span>
          </div>
          <div class="question-text">{{ q.question }}</div>
          <div class="question-options" v-if="q.options && q.options.length > 0">
            <div class="options-label">选项：</div>
            <div class="options-list">
              <div
                v-for="(option, optIndex) in q.options"
                :key="optIndex"
                class="option-item"
                :class="{
                  selected: isOptionSelected(q, option.label)
                }"
              >
                <span class="option-marker">
                  <template v-if="q.multiSelect">
                    {{ isOptionSelected(q, option.label) ? '☑' : '☐' }}
                  </template>
                  <template v-else>
                    {{ option.label === q.selectedAnswer ? '✓' : '○' }}
                  </template>
                </span>
                <div class="option-content">
                  <span class="option-text">{{ option.label }}</span>
                  <span v-if="option.description" class="option-description">{{ option.description }}</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </template>

      <!-- Result status (only show expanded with mismatch) -->
      <div v-if="!isCollapsed && message.resultReceived && !message.answersConsistent" class="answer-result">
        <div class="result-mismatch">
          <div class="mismatch-header">
            <span class="result-icon">⚠️</span>
            <span class="result-text">实际收到的答案：</span>
          </div>
          <div class="mismatch-answers">
            <div
              v-for="(answer, questionText) in message.receivedAnswers"
              :key="questionText"
              class="mismatch-item"
            >
              <span class="mismatch-question">{{ questionText }}</span>
              <span class="mismatch-answer">{{ answer }}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* Question message wrapper */
.question-message-wrapper {
  flex: 1;
  max-width: 70%;
}

/* Question message - 绿色主题 */
.question-message {
  background: linear-gradient(135deg, #1E2A1E 0%, #18181B 100%);
  border: 1px solid #10B981;
  border-left: 3px solid #10B981;
  border-radius: 8px;
  overflow: hidden;
}

.question-message.answer-mismatch {
  background: linear-gradient(135deg, #2E1E1E 0%, #18181B 100%);
  border-color: #EF4444;
  border-left-color: #EF4444;
}

/* Question message header */
.question-message-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 12px;
  border-bottom: 1px solid #3F3F46;
  cursor: pointer;
}

.question-message-header:hover {
  background: rgba(16, 185, 129, 0.05);
}

.question-title {
  display: flex;
  align-items: center;
  gap: 8px;
}

.question-icon {
  font-size: 16px;
}

.question-count {
  font-size: 13px;
  font-weight: 600;
  color: #6EE7B7;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

/* Collapsed answers - 横向排列 */
.collapsed-answers {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  flex-wrap: wrap;
}

.collapsed-answer-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px;
  background: rgba(59, 130, 246, 0.06);
  border-radius: 4px;
  border: 1px solid rgba(59, 130, 246, 0.12);
}

.collapsed-question-label {
  font-size: 11px;
  color: #6EE7B7;
  font-weight: 600;
}

.collapsed-answer-content {
  font-size: 12px;
  color: #F1F5F9;
  font-family: 'SF Mono', 'Monaco', 'Menlo', 'Consolas', monospace;
  font-weight: 500;
}

/* Question tab headers */
.question-tab-headers {
  display: flex;
  gap: 4px;
  padding: 0 12px;
  border-bottom: 1px solid #3F3F46;
}

.question-tab-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  background: transparent;
  border: none;
  color: #71717A;
  cursor: pointer;
  font-size: 13px;
  transition: all 0.15s ease;
}

.question-tab-button:hover {
  background: #27272A;
  color: #A1A1AA;
}

.question-tab-button.active {
  color: #6EE7B7;
  border-bottom: 2px solid #6EE7B7;
}

.tab-status {
  font-size: 10px;
}

.tab-label {
  font-weight: 500;
}

/* Question content - expanded view */
.question-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 12px;
}

.question-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
}

.question-icon {
  font-size: 14px;
}

.question-label {
  font-size: 12px;
  font-weight: 600;
  color: #6EE7B7;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.multi-select-hint {
  font-size: 11px;
  color: #FB923C;
  font-weight: normal;
  text-transform: none;
}

.question-text {
  font-size: 13px;
  color: #E4E4E7;
  line-height: 1.6;
  margin-bottom: 12px;
  padding: 10px 12px;
  background: #18181B;
  border-radius: 6px;
  cursor: text;
}

.question-options {
  margin-bottom: 12px;
}

.options-label {
  font-size: 11px;
  color: #71717A;
  margin-bottom: 6px;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.options-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.option-item {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 12px;
  background: #18181B;
  border-radius: 6px;
  border: 1px solid #27272A;
  transition: all 0.15s ease;
}

.option-item:hover {
  background: #27272A;
}

.option-item.selected {
  background: #065F46;
  border-color: #10B981;
}

.option-marker {
  font-size: 12px;
  color: #71717A;
  flex-shrink: 0;
}

.option-item.selected .option-marker {
  color: #6EE7B7;
}

.option-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
}

.option-text {
  font-size: 13px;
  color: #A1A1AA;
  flex-shrink: 0;
  font-weight: 500;
  line-height: 1.5;
  cursor: text;
}

.option-item.selected .option-text {
  color: #E4E4E7;
}

.option-description {
  font-size: 12px;
  color: #71717A;
  line-height: 1.4;
}

.option-item.selected .option-description {
  color: #A1A1AA;
}

/* Answer result section */
.answer-result {
  padding: 12px;
  border-top: 1px solid #3F3F46;
}

.result-mismatch {
  background: #78350F;
  padding: 10px;
  border-radius: 6px;
}

.mismatch-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.result-icon {
  font-size: 14px;
}

.result-text {
  font-size: 12px;
  color: #FCD34D;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.mismatch-answers {
  font-size: 13px;
}

.mismatch-item {
  display: flex;
  gap: 8px;
  padding: 4px 0;
}

.mismatch-question {
  color: #A1A1AA;
  min-width: 100px;
}

.mismatch-answer {
  color: #E4E4E7;
}
</style>
