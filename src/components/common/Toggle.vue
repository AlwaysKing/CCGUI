<script setup>
/**
 * Toggle - 开关组件
 */
const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false
  },
  disabled: {
    type: Boolean,
    default: false
  },
  size: {
    type: String,
    default: 'md',
    validator: (v) => ['sm', 'md', 'lg'].includes(v)
  }
})

const emit = defineEmits(['update:modelValue', 'change'])

function toggle() {
  if (props.disabled) return
  const newValue = !props.modelValue
  emit('update:modelValue', newValue)
  emit('change', newValue)
}
</script>

<template>
  <button
    type="button"
    class="toggle"
    :class="[`toggle-${size}`, { 'toggle-active': modelValue, 'toggle-disabled': disabled }]"
    :disabled="disabled"
    @click="toggle"
  >
    <span class="toggle-thumb"></span>
  </button>
</template>

<style scoped>
.toggle {
  position: relative;
  display: inline-flex;
  align-items: center;
  background-color: var(--bg-active);
  border: none;
  border-radius: var(--radius-full);
  cursor: pointer;
  transition: background-color var(--transition-fast);
}

.toggle:hover:not(.toggle-disabled) {
  background-color: var(--border-hover);
}

.toggle-active {
  background-color: var(--accent-primary);
}

.toggle-active:hover:not(.toggle-disabled) {
  background-color: var(--accent-hover);
}

.toggle-disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.toggle-thumb {
  position: absolute;
  background-color: white;
  border-radius: 50%;
  transition: transform var(--transition-fast);
  box-shadow: var(--shadow-sm);
}

/* 尺寸 */
.toggle-sm {
  width: 28px;
  height: 16px;
}

.toggle-sm .toggle-thumb {
  width: 12px;
  height: 12px;
  left: 2px;
}

.toggle-sm.toggle-active .toggle-thumb {
  transform: translateX(12px);
}

.toggle-md {
  width: 36px;
  height: 20px;
}

.toggle-md .toggle-thumb {
  width: 16px;
  height: 16px;
  left: 2px;
}

.toggle-md.toggle-active .toggle-thumb {
  transform: translateX(16px);
}

.toggle-lg {
  width: 44px;
  height: 24px;
}

.toggle-lg .toggle-thumb {
  width: 20px;
  height: 20px;
  left: 2px;
}

.toggle-lg.toggle-active .toggle-thumb {
  transform: translateX(20px);
}
</style>
