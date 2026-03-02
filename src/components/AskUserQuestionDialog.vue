<script setup>
import { ref, computed, onMounted } from 'vue'

const props = defineProps({
  request: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['answer'])

const questions = ref([])
const answers = ref({})

onMounted(() => {
  // Parse the questions from tool input
  if (props.request.tool_input && props.request.tool_input.questions) {
    questions.value = props.request.tool_input.questions
  }
})

const currentQuestion = computed(() => {
  return questions.value[0] || null
})

function handleSelect(optionIndex) {
  const question = currentQuestion.value
  const selectedOption = question.options[optionIndex]
  emit('answer', props.request.request_id, selectedOption.label)
}
</script>

<template>
  <div class="question-dialog-overlay" v-if="currentQuestion" data-question-dialog>
    <div class="question-bar" data-question-dialog-inner>
      <div class="question-header">
        <span class="icon">❓</span>
        <span class="header-text">{{ currentQuestion.header }}</span>
      </div>

      <div class="question-text-short">{{ currentQuestion.question }}</div>

      <div class="options-row">
        <button
          v-for="(option, index) in currentQuestion.options"
          :key="index"
          @click="handleSelect(index)"
          class="option-pill"
        >
          {{ option.label }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.question-dialog-overlay {
  position: fixed;
  bottom: 120px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 99999;
  pointer-events: none;
}

.question-bar {
  pointer-events: auto;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 12px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  max-width: 600px;
  width: 90%;
  padding: 12px 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
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

.question-text-short {
  font-size: 13px;
  color: #E4E4E7;
  line-height: 1.4;
}

.options-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.option-pill {
  background: #18181B;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
  color: #E4E4E7;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.option-pill:hover {
  border-color: #F97316;
  background: #27272A;
  color: #F97316;
}

.option-pill:active {
  transform: scale(0.96);
}
</style>
