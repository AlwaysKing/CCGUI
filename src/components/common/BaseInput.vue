<script setup>
/**
 * BaseInput - 统一输入框组件
 */
import { computed } from 'vue'

const props = defineProps({
  modelValue: {
    type: [String, Number],
    default: ''
  },
  type: {
    type: String,
    default: 'text'
  },
  placeholder: {
    type: String,
    default: ''
  },
  disabled: {
    type: Boolean,
    default: false
  },
  error: {
    type: Boolean,
    default: false
  },
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg'].includes(v)
  }
})

const emit = defineEmits(['update:modelValue', 'focus', 'blur', 'enter'])

const inputClass = computed(() => [
  `input-${props.size}`,
  { 'input-error': props.error, 'input-disabled': props.disabled }
])

function handleInput(event) {
  emit('update:modelValue', event.target.value)
}
</script>

<template>
  <div class="base-input-wrapper">
    <div v-if="$slots.prefix" class="input-prefix">
      <slot name="prefix"></slot>
    </div>
    <input
      class="base-input"
      :class="inputClass"
      :type="type"
      :value="modelValue"
      :placeholder="placeholder"
      :disabled="disabled"
      @input="handleInput"
      @focus="$emit('focus', $event)"
      @blur="$emit('blur', $event)"
      @keyup.enter="$emit('enter', $event)"
    />
    <div v-if="$slots.suffix" class="input-suffix">
      <slot name="suffix"></slot>
    </div>
  </div>
</template>

<style scoped>
.base-input-wrapper {
  display: flex;
  align-items: center;
  background-color: var(--bg-secondary);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-md);
  transition: border-color var(--transition-fast);
}

.base-input-wrapper:focus-within {
  border-color: var(--accent-primary);
}

.input-prefix,
.input-suffix {
  display: flex;
  align-items: center;
  padding: 0 var(--spacing-sm);
  color: var(--text-muted);
}

.base-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--text-primary);
  width: 100%;
}

.base-input::placeholder {
  color: var(--text-muted);
}

/* 尺寸 */
.input-sm {
  padding: 6px 10px;
  font-size: var(--font-size-sm);
}

.input-md {
  padding: 8px 12px;
  font-size: var(--font-size-base);
}

.input-lg {
  padding: 12px 16px;
  font-size: var(--font-size-md);
}

/* 状态 */
.input-error {
  border-color: var(--color-error);
}

.input-error:focus-within {
  border-color: var(--color-error);
}

.input-disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.input-disabled .base-input {
  cursor: not-allowed;
}
</style>
