<script setup>
import { ref, computed, onMounted } from 'vue'
import { logger } from '../../../../../utils/logger'

const props = defineProps({
  request: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['answer', 'dismiss'])

const questions = ref([])
const answers = ref({})        // 存储选中的 label（含 "Other"）
const otherTexts = ref({})     // 存储 "Other" 的自定义文本
const currentTabIndex = ref(0)
const otherInputRefs = ref({}) // "Other" 输入框的 ref

onMounted(() => {
  let toolInput = props.request.input || props.request.tool_input || props.request.toolInput

  if (typeof toolInput === 'string') {
    try {
      toolInput = JSON.parse(toolInput)
    } catch (e) {
      // Ignore invalid JSON string input and fall back to raw value.
    }
  }

  if (toolInput && toolInput.questions) {
    questions.value = toolInput.questions
  } else if (props.request.questions) {
    questions.value = props.request.questions
  }

  // Initialize answers based on multiSelect
  questions.value.forEach((q, index) => {
    if (q.multiSelect) {
      answers.value[index] = []
    } else {
      answers.value[index] = null
    }
  })
})

const currentQuestion = computed(() => {
  return questions.value[currentTabIndex.value] || null
})

function handleSelect(questionIndex, optionLabel) {
  const question = questions.value[questionIndex]

  if (question.multiSelect) {
    const currentAnswers = answers.value[questionIndex]
    const idx = currentAnswers.indexOf(optionLabel)
    if (idx > -1) {
      currentAnswers.splice(idx, 1)
      if (optionLabel === 'Other') {
        otherTexts.value[questionIndex] = ''
      }
    } else {
      currentAnswers.push(optionLabel)
      if (optionLabel === 'Other') {
        setTimeout(() => {
          otherInputRefs.value[questionIndex]?.focus()
        }, 0)
      }
    }
  } else {
    answers.value[questionIndex] = optionLabel
    if (optionLabel === 'Other') {
      setTimeout(() => {
        otherInputRefs.value[questionIndex]?.focus()
      }, 0)
    } else {
      const nextUnansweredIndex = questions.value.findIndex((q, idx) => !isQuestionAnswered(idx))
      if (nextUnansweredIndex !== -1 && nextUnansweredIndex !== questionIndex) {
        currentTabIndex.value = nextUnansweredIndex
      }
    }
  }
}

function updateOtherText(questionIndex, text) {
  otherTexts.value[questionIndex] = text
}

function isQuestionAnswered(index) {
  const answer = answers.value[index]
  if (Array.isArray(answer)) {
    if (answer.length === 0) return false
    if (answer.includes('Other') && !otherTexts.value[index]?.trim()) return false
    return true
  }
  if (answer === null) return false
  if (answer === 'Other' && !otherTexts.value[index]?.trim()) return false
  return true
}

function handleSubmit() {
  const allAnswered = questions.value.every((q, index) => isQuestionAnswered(index))

  if (!allAnswered) {
    const unanswered = questions.value
      .map((q, index) => !isQuestionAnswered(index) ? (q.header || `问题 ${index + 1}`) : null)
      .filter(Boolean)
    console.warn('请回答所有问题后再提交。未回答的问题:', unanswered.join(', '))
    return
  }

  // 选中 "Other" 时，用自定义文本替换 "Other" 标签
  // 多选题答案用 ", " 分隔（与 VSCode 一致）
  const answersMap = {}
  questions.value.forEach((q, index) => {
    let answer = answers.value[index]
    if (Array.isArray(answer)) {
      const parts = answer.map(a => a === 'Other' ? (otherTexts.value[index]?.trim() || 'Other') : a)
      answersMap[q.question] = parts.join(', ')
    } else {
      answersMap[q.question] = answer === 'Other' ? (otherTexts.value[index]?.trim() || 'Other') : answer
    }
  })

  const requestId = props.request.request_id ?? props.request.tool_use_id
  logger.info('[AskUserQuestionDialog] Submitting answers', {
    requestId,
    answers: answersMap
  })

  emit('answer', requestId, answersMap)
}

function handleDismiss() {
  emit('dismiss')
}

function switchTab(index) {
  currentTabIndex.value = index
}

function isOptionSelected(questionIndex, optionLabel) {
  const answer = answers.value[questionIndex]
  if (Array.isArray(answer)) {
    return answer.includes(optionLabel)
  }
  return answer === optionLabel
}

const isAllAnswered = computed(() => {
  return questions.value.every((q, index) => isQuestionAnswered(index))
})
</script>

<template>
  <div class="question-dialog-overlay" v-if="questions.length > 0" data-question-dialog>
    <div class="question-bar" data-question-dialog-inner>
      <!-- Tab Headers -->
      <div class="tab-headers">
        <button
          v-for="(question, index) in questions"
          :key="index"
          type="button"
          @click.stop="switchTab(index)"
          class="tab-button"
          :class="{ active: currentTabIndex === index, answered: isQuestionAnswered(index) }"
        >
          <span class="tab-status">{{ isQuestionAnswered(index) ? '✓' : '○' }}</span>
          <span class="tab-label">{{ question.header || `问题 ${index + 1}` }}</span>
          <span v-if="question.multiSelect" class="multi-badge">多选</span>
        </button>
        <div class="tab-spacer"></div>
        <button class="close-button" @click="handleDismiss" title="关闭">✕</button>
      </div>

      <!-- Current Question Content -->
      <div class="question-content" v-if="currentQuestion">
        <div class="question-header">
          <span class="icon">❓</span>
          <span class="header-text">{{ currentQuestion.header }}</span>
          <span v-if="currentQuestion.multiSelect" class="multi-hint">(可多选)</span>
        </div>

        <div class="question-text-short">{{ currentQuestion.question }}</div>

        <div class="options-list">
          <!-- 预定义选项 -->
          <button
            v-for="(option, optionIndex) in currentQuestion.options"
            :key="optionIndex"
            @click="handleSelect(currentTabIndex, option.label)"
            class="option-item"
            :class="{ selected: isOptionSelected(currentTabIndex, option.label) }"
          >
            <span class="option-marker">
              <template v-if="currentQuestion.multiSelect">
                {{ isOptionSelected(currentTabIndex, option.label) ? '☑' : '☐' }}
              </template>
              <template v-else>
                {{ isOptionSelected(currentTabIndex, option.label) ? '✓' : '○' }}
              </template>
            </span>
            <div class="option-content">
              <span class="option-text">{{ option.label }}</span>
              <span v-if="option.description" class="option-description">{{ option.description }}</span>
            </div>
          </button>

          <!-- Other 自定义选项（始终显示） -->
          <button
            @click="handleSelect(currentTabIndex, 'Other')"
            class="option-item"
            :class="{ selected: isOptionSelected(currentTabIndex, 'Other') }"
          >
            <span class="option-marker">
              <template v-if="currentQuestion.multiSelect">
                {{ isOptionSelected(currentTabIndex, 'Other') ? '☑' : '☐' }}
              </template>
              <template v-else>
                {{ isOptionSelected(currentTabIndex, 'Other') ? '✓' : '○' }}
              </template>
            </span>
            <div class="option-content">
              <span class="option-text">Other</span>
              <div
                v-if="isOptionSelected(currentTabIndex, 'Other')"
                class="other-input-wrapper"
                @click.stop
              >
                <input
                  :ref="el => { if (el) otherInputRefs[currentTabIndex] = el }"
                  type="text"
                  class="other-input"
                  placeholder="输入你的回答…"
                  :value="otherTexts[currentTabIndex] || ''"
                  @input="updateOtherText(currentTabIndex, $event.target.value)"
                  @keydown.enter.stop
                  @keydown.stop
                  @keyup.stop
                />
              </div>
            </div>
          </button>
        </div>
      </div>

      <!-- Submit Button -->
      <div class="submit-section">
        <button
          @click="handleSubmit"
          class="submit-button"
          :class="{ enabled: isAllAnswered }"
          :disabled="!isAllAnswered"
        >
          <span class="submit-text">{{ isAllAnswered ? '确定提交' : '请回答所有问题' }}</span>
          <span class="submit-count">{{ questions.filter((q, i) => isQuestionAnswered(i)).length }} / {{ questions.length }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.question-dialog-overlay {
  position: absolute;
  bottom: 80px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 99999;
  pointer-events: none;
  width: 90%;
  max-width: 900px;
}

.question-bar {
  pointer-events: auto;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* Tab Headers */
.tab-headers {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  align-items: center;
  border-bottom: 1px solid #3F3F46;
  padding-bottom: 10px;
  pointer-events: auto;
  position: relative;
  z-index: 10;
}

.tab-spacer {
  flex: 1;
}

.close-button {
  background: transparent;
  border: none;
  color: #71717A;
  font-size: 14px;
  cursor: pointer;
  padding: 4px 8px;
  border-radius: 4px;
  transition: all 0.15s ease;
  line-height: 1;
}

.close-button:hover {
  color: #E4E4E7;
  background: #3F3F46;
}

.tab-button {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 14px;
  background: transparent;
  border: 1px solid transparent;
  border-radius: 8px;
  color: #A1A1AA;
  font-size: 12px;
  cursor: pointer;
  pointer-events: auto;
  position: relative;
  z-index: 10;
  transition: all 0.2s ease;
}

.tab-button:hover {
  background: #3F3F46;
  color: #E4E4E7;
}

.tab-button.active {
  background: #F97316;
  color: white;
  border-color: #F97316;
}

.tab-button.answered:not(.active) {
  color: #10B981;
}

.tab-status {
  font-size: 11px;
  line-height: 1;
}

.tab-label {
  font-weight: 500;
}

.multi-badge {
  font-size: 10px;
  padding: 1px 5px;
  background: rgba(249, 115, 22, 0.2);
  color: #FB923C;
  border-radius: 3px;
  margin-left: 4px;
}

/* Question Content */
.question-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.question-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.icon {
  font-size: 16px;
  line-height: 1;
}

.header-text {
  font-size: 13px;
  font-weight: 600;
  color: #F97316;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.multi-hint {
  font-size: 11px;
  color: #FB923C;
  font-weight: normal;
  text-transform: none;
}

.question-text-short {
  font-size: 13px;
  color: #E4E4E7;
  line-height: 1.5;
  background: #18181B;
  border-radius: 8px;
  padding: 10px 12px;
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
  padding: 10px 12px;
  background: #18181B;
  border: 1px solid #27272A;
  border-radius: 8px;
  font-size: 13px;
  color: #E4E4E7;
  cursor: pointer;
  transition: all 0.15s ease;
  text-align: left;
  width: 100%;
}

.option-item:hover {
  border-color: #F97316;
  background: #1E1E1E;
}

.option-item.selected {
  border-color: #10B981;
  background: #064E3B;
}

.option-item:active:not(:focus-within) {
  transform: scale(0.98);
}

.option-marker {
  font-size: 12px;
  color: #71717A;
  flex-shrink: 0;
  line-height: 1.5;
  margin-top: 1px;
}

.option-item:hover .option-marker {
  color: #F97316;
}

.option-item.selected .option-marker {
  color: #10B981;
}

.option-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}

.option-text {
  flex-shrink: 0;
  font-weight: 500;
  line-height: 1.5;
}

.option-description {
  font-size: 12px;
  color: #71717A;
  line-height: 1.4;
}

.option-item:hover .option-description {
  color: #A1A1AA;
}

.option-item.selected .option-description {
  color: #6EE7B7;
}

/* Other 自定义输入框 */
.other-input-wrapper {
  margin-top: 4px;
  width: 100%;
}

.other-input {
  width: 100%;
  padding: 8px 10px;
  background: #09090B;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  color: #E4E4E7;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s ease;
}

.other-input::placeholder {
  color: #52525B;
}

.other-input:focus {
  border-color: #F97316;
}

/* Submit Section */
.submit-section {
  border-top: 1px solid #3F3F46;
  padding-top: 10px;
}

.submit-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  padding: 12px 20px;
  background: #18181B;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  color: #71717A;
  font-size: 14px;
  font-weight: 500;
  cursor: not-allowed;
  transition: all 0.2s ease;
}

.submit-button.enabled {
  background: #F97316;
  border-color: #F97316;
  color: white;
  cursor: pointer;
}

.submit-button.enabled:hover {
  background: #EA580C;
  border-color: #EA580C;
}

.submit-button:active {
  transform: scale(0.98);
}

.submit-text {
  flex: 1;
  text-align: center;
}

.submit-count {
  font-size: 12px;
  padding: 2px 8px;
  background: rgba(0, 0, 0, 0.2);
  border-radius: 4px;
}
</style>
