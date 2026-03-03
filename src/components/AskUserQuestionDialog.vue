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

      <div class="options-list">
        <button
          v-for="(option, index) in currentQuestion.options"
          :key="index"
          @click="handleSelect(index)"
          class="option-item"
        >
          <span class="option-marker">○</span>
          <div class="option-content">
            <span class="option-text">{{ option.label }}</span>
            <span v-if="option.description" class="option-description">{{ option.description }}</span>
          </div>
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
  width: 90%;
  max-width: 800px;
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
  margin-top: 4px;
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

.option-item:active {
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

.option-content {
  display: flex;
  flex-direction: column;
  gap: 2px;
  flex: 1;
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
</style>
