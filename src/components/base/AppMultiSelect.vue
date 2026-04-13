<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  modelValue: {
    type: Array,
    default: () => []
  },
  options: {
    type: Array,
    default: () => []
  },
  placeholder: {
    type: String,
    default: '请选择'
  },
  disabled: {
    type: Boolean,
    default: false
  },
  fullWidth: {
    type: Boolean,
    default: false
  }
})

const emit = defineEmits(['update:modelValue', 'change'])

const rootRef = ref(null)
const triggerRef = ref(null)
const isOpen = ref(false)
const menuStyle = ref({})
let positionFrame = 0
let resizeObserver = null

const selectedValues = computed(() => Array.isArray(props.modelValue) ? props.modelValue : [])

const selectedOptions = computed(() => {
  const selectedSet = new Set(selectedValues.value)
  return props.options.filter(option => selectedSet.has(option?.value))
})

const availableOptions = computed(() => {
  const selectedSet = new Set(selectedValues.value)
  return props.options.filter(option => !selectedSet.has(option?.value))
})

function updatePosition() {
  if (!triggerRef.value) return
  const rect = triggerRef.value.getBoundingClientRect()
  menuStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 6}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    zIndex: 9999
  }
}

function cancelScheduledPosition() {
  if (positionFrame) {
    window.cancelAnimationFrame(positionFrame)
    positionFrame = 0
  }
}

function scheduleUpdatePosition() {
  cancelScheduledPosition()
  positionFrame = window.requestAnimationFrame(() => {
    positionFrame = window.requestAnimationFrame(() => {
      positionFrame = 0
      updatePosition()
    })
  })
}

function close() {
  isOpen.value = false
  menuStyle.value = {}
  cancelScheduledPosition()
}

function toggleMenu() {
  if (props.disabled) return
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    updatePosition()
    nextTick(() => scheduleUpdatePosition())
  }
}

function toggleOption(option) {
  if (!option || option.disabled) return
  const currentValues = [...selectedValues.value, option.value]
  emit('update:modelValue', currentValues)
  emit('change', currentValues)
  close()
}

function removeValue(value) {
  const nextValues = selectedValues.value.filter(entry => entry !== value)
  emit('update:modelValue', nextValues)
  emit('change', nextValues)
}

function handlePointerDown(event) {
  if (!rootRef.value) return
  if (rootRef.value.contains(event.target)) return
  const menu = document.querySelector('.app-multi-select-menu[teleported]')
  if (menu && menu.contains(event.target)) return
  close()
}

function handleEscape(event) {
  if (event.key === 'Escape') {
    close()
  }
}

function handleScroll() {
  if (isOpen.value) updatePosition()
}

onMounted(() => {
  document.addEventListener('mousedown', handlePointerDown)
  document.addEventListener('keydown', handleEscape)
  window.addEventListener('scroll', handleScroll, true)
  window.addEventListener('resize', handleScroll)
  if (typeof ResizeObserver !== 'undefined' && triggerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      if (isOpen.value) {
        scheduleUpdatePosition()
      }
    })
    resizeObserver.observe(triggerRef.value)
  }
})

onBeforeUnmount(() => {
  cancelScheduledPosition()
  resizeObserver?.disconnect()
  document.removeEventListener('mousedown', handlePointerDown)
  document.removeEventListener('keydown', handleEscape)
  window.removeEventListener('scroll', handleScroll, true)
  window.removeEventListener('resize', handleScroll)
})
</script>

<template>
  <div
    ref="rootRef"
    class="app-multi-select"
    :class="{ open: isOpen, disabled, 'full-width': fullWidth }"
  >
    <button
      ref="triggerRef"
      type="button"
      class="app-multi-select-trigger"
      :class="{ 'is-placeholder': true }"
      :disabled="disabled"
      @click="toggleMenu"
    >
      <span class="app-multi-select-label">{{ placeholder }}</span>
      <span class="app-multi-select-caret" aria-hidden="true">▾</span>
    </button>

    <div v-if="selectedOptions.length" class="app-multi-select-tags" @click.stop>
      <span
        v-for="option in selectedOptions"
        :key="option.value"
        class="app-multi-select-tag"
        @click.stop
      >
        <span class="app-multi-select-tag-label">{{ option.shortLabel || option.label }}</span>
        <button
          type="button"
          class="app-multi-select-tag-remove"
          :disabled="disabled"
          @click.stop="removeValue(option.value)"
        >
          ×
        </button>
      </span>
    </div>

    <Teleport to="body">
      <div v-if="isOpen" class="app-multi-select-menu" teleported="" :style="menuStyle">
        <div v-if="!availableOptions.length" class="app-multi-select-empty">没有可添加的任务</div>
        <button
          v-for="option in availableOptions"
          :key="option.id || option.value"
          type="button"
          class="app-multi-select-option"
          :class="{ disabled: option.disabled }"
          :disabled="option.disabled"
          @click="toggleOption(option)"
        >
          <span class="app-multi-select-option-check">+</span>
          <span class="app-multi-select-option-body">
            <span class="app-multi-select-option-label">{{ option.menuLabel || option.label }}</span>
            <span v-if="option.description" class="app-multi-select-option-desc">{{ option.description }}</span>
          </span>
        </button>
      </div>
    </Teleport>
  </div>
</template>

<style>
.app-multi-select {
  position: relative;
  display: inline-flex;
  flex-direction: column;
  gap: 8px;
  min-width: 160px;
}

.app-multi-select.full-width {
  display: flex;
  width: 100%;
}

.app-multi-select-trigger {
  width: 100%;
  display: inline-flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  background: var(--app-soft-surface, #27272a);
  border: 1px solid var(--app-soft-border, #3f3f46);
  border-radius: 8px;
  padding: 8px 12px;
  color: #f4f4f5;
  font-size: 13px;
  line-height: 1.2;
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, color 0.15s ease;
}

.app-multi-select-trigger:hover {
  background: var(--app-soft-surface-hover, #2f2f35);
}

.app-multi-select.open .app-multi-select-trigger,
.app-multi-select-trigger:focus-visible {
  outline: none;
  border-color: #f97316;
  background: var(--app-soft-surface-hover, #2f2f35);
}

.app-multi-select.disabled .app-multi-select-trigger {
  opacity: 0.6;
  cursor: not-allowed;
}

.app-multi-select-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.app-multi-select-trigger.is-placeholder .app-multi-select-label {
  color: #a1a1aa;
}

.app-multi-select-caret {
  flex: 0 0 auto;
  color: #a1a1aa;
  font-size: 11px;
  transition: transform 0.15s ease;
}

.app-multi-select.open .app-multi-select-caret {
  transform: rotate(180deg);
}

.app-multi-select-tags {
  order: -1;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.app-multi-select-tag {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 4px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: #d4d4d8;
  font-size: 12px;
}

.app-multi-select-tag-label {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-multi-select-tag-remove {
  margin-left: auto;
  border: none;
  background: transparent;
  color: #a1a1aa;
  cursor: pointer;
  padding: 0;
  line-height: 1;
}

.app-multi-select-menu {
  max-height: 320px;
  overflow-y: auto;
  padding: 6px;
  background: #1f1f23;
  border: 1px solid #3f3f46;
  border-radius: 10px;
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.35);
}

.app-multi-select-empty {
  padding: 10px 12px;
  color: #8b8b95;
  font-size: 12px;
}

.app-multi-select-option {
  width: 100%;
  border: none;
  background: transparent;
  color: #f4f4f5;
  border-radius: 8px;
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 9px 10px;
  text-align: left;
  cursor: pointer;
}

.app-multi-select-option:hover {
  background: rgba(255, 255, 255, 0.06);
}

.app-multi-select-option.disabled {
  opacity: 0.45;
  cursor: not-allowed;
}

.app-multi-select-option-check {
  width: 16px;
  flex: 0 0 16px;
  color: #fb923c;
  font-size: 14px;
  line-height: 1.4;
}

.app-multi-select-option-body {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.app-multi-select-option-label {
  font-size: 13px;
  line-height: 1.35;
}

.app-multi-select-option-desc {
  color: #a1a1aa;
  font-size: 11px;
  line-height: 1.4;
}
</style>
