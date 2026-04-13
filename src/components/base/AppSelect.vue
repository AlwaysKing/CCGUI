<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

const props = defineProps({
  modelValue: {
    type: [String, Number, Boolean, Object, null],
    default: null
  },
  options: {
    type: Array,
    default: () => []
  },
  groups: {
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
  },
  selectedLabel: {
    type: String,
    default: ''
  },
  menuMinWidth: {
    type: [String, Number],
    default: ''
  }
})

const emit = defineEmits(['update:modelValue', 'change'])

const rootRef = ref(null)
const triggerRef = ref(null)
const isOpen = ref(false)
const menuStyle = ref({})
let positionFrame = 0
let resizeObserver = null

const flatOptions = computed(() => {
  if (props.groups.length > 0) {
    return props.groups.flatMap(group => Array.isArray(group.options) ? group.options : [])
  }
  return props.options
})

const selectedOption = computed(() => {
  return flatOptions.value.find(option => option?.value === props.modelValue) || null
})

const triggerLabel = computed(() => {
  if (props.selectedLabel) return props.selectedLabel
  return selectedOption.value?.label || props.placeholder
})

function updatePosition() {
  if (!triggerRef.value) return
  const rect = triggerRef.value.getBoundingClientRect()
  const normalizedMenuMinWidth = Number.isFinite(Number(props.menuMinWidth))
    ? `${Number(props.menuMinWidth)}px`
    : String(props.menuMinWidth || '').trim()

  menuStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 6}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    minWidth: normalizedMenuMinWidth || `${rect.width}px`,
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

function toggle() {
  if (props.disabled) return
  isOpen.value = !isOpen.value
  if (isOpen.value) {
    updatePosition()
    nextTick(() => scheduleUpdatePosition())
  }
}

function selectOption(option) {
  if (!option || option.disabled) return
  emit('update:modelValue', option.value)
  emit('change', option)
  close()
}

function handlePointerDown(event) {
  if (!rootRef.value) return
  if (rootRef.value.contains(event.target)) return
  const menu = document.querySelector('.app-select-menu[teleported]')
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
    class="app-select"
    :class="{ open: isOpen, disabled, 'full-width': fullWidth }"
  >
    <button
      ref="triggerRef"
      type="button"
      class="app-select-trigger"
      :class="{ 'is-placeholder': !selectedOption && !selectedLabel }"
      :disabled="disabled"
      @click="toggle"
    >
      <span class="app-select-label">{{ triggerLabel }}</span>
      <span class="app-select-caret" aria-hidden="true">▾</span>
    </button>

    <Teleport to="body">
      <div v-if="isOpen" class="app-select-menu" teleported="" :style="menuStyle">
        <template v-if="groups.length > 0">
          <div
            v-for="group in groups"
            :key="group.key || group.label"
            class="app-select-group"
          >
            <div class="app-select-group-label">{{ group.label }}</div>
            <button
              v-for="option in group.options"
              :key="option.id || option.value"
              type="button"
              class="app-select-option"
              :class="{ active: option.value === modelValue, disabled: option.disabled }"
              :disabled="option.disabled"
              @click="selectOption(option)"
            >
              <span class="app-select-option-label">{{ option.menuLabel || option.label }}</span>
              <span v-if="option.description" class="app-select-option-desc">{{ option.description }}</span>
            </button>
          </div>
        </template>

        <template v-else>
          <button
            v-for="option in options"
            :key="option.id || option.value"
            type="button"
            class="app-select-option"
            :class="{ active: option.value === modelValue, disabled: option.disabled }"
            :disabled="option.disabled"
            @click="selectOption(option)"
          >
            <span class="app-select-option-label">{{ option.menuLabel || option.label }}</span>
            <span v-if="option.description" class="app-select-option-desc">{{ option.description }}</span>
          </button>
        </template>
      </div>
    </Teleport>
  </div>
</template>

<style>
.app-select {
  position: relative;
  display: inline-block;
  min-width: 160px;
}

.app-select.full-width {
  display: block;
  width: 100%;
}

.app-select-trigger {
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

.app-select-trigger:hover {
  background: var(--app-soft-surface-hover, #2f2f35);
}

.app-select.open .app-select-trigger,
.app-select-trigger:focus-visible {
  outline: none;
  border-color: #f97316;
  background: var(--app-soft-surface-hover, #2f2f35);
}

.app-select.disabled .app-select-trigger {
  opacity: 0.6;
  cursor: not-allowed;
}

.app-select-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  text-align: left;
}

.app-select-trigger.is-placeholder .app-select-label {
  color: #a1a1aa;
}

.app-select-caret {
  flex: 0 0 auto;
  color: #a1a1aa;
  font-size: 11px;
  transition: transform 0.15s ease;
}

.app-select.open .app-select-caret {
  transform: rotate(180deg);
}

.app-select-menu {
  max-height: 280px;
  overflow-y: auto;
  padding: 6px;
  background: #1f1f23;
  border: 1px solid #3f3f46;
  border-radius: 10px;
  box-shadow: 0 14px 30px rgba(0, 0, 0, 0.35);
}

.app-select-group + .app-select-group {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.app-select-group-label {
  padding: 4px 8px 6px;
  color: #a1a1aa;
  font-size: 11px;
  font-weight: 600;
}

.app-select-option {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 9px 10px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #e4e4e7;
  cursor: pointer;
  text-align: left;
}

.app-select-option:hover {
  background: rgba(255, 255, 255, 0.06);
}

.app-select-option.active {
  background: rgba(249, 115, 22, 0.14);
  color: #fdba74;
}

.app-select-option.disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.app-select-option-label {
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.app-select-option-desc {
  flex: 0 0 auto;
  color: #71717a;
  font-size: 11px;
}

.select-input {
  width: 100%;
}

.select-input .app-select-trigger {
  min-height: 40px;
}

.setting-select .app-select-trigger,
.theme-select .app-select-trigger,
.mapping-select .app-select-trigger,
.form-select .app-select-trigger {
  min-width: 150px;
}
</style>
