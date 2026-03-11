<script setup>
/**
 * CollapseToggle - 折叠/展开切换按钮组件
 * 统一的折叠状态切换图标
 */
const props = defineProps({
  collapsed: {
    type: Boolean,
    default: true
  },
  expandedIcon: {
    type: String,
    default: '▼'
  },
  collapsedIcon: {
    type: String,
    default: '▶'
  },
  size: {
    type: String,
    default: '10px'
  }
})

const emit = defineEmits(['toggle'])

function toggle() {
  emit('toggle')
}
</script>

<template>
  <span
    class="collapse-toggle"
    :style="{ fontSize: size }"
    @click.stop="toggle"
  >
    {{ collapsed ? collapsedIcon : expandedIcon }}
  </span>
</template>

<style scoped>
.collapse-toggle {
  font-size: 10px;
  color: #71717A;
  cursor: pointer;
  transition: transform 0.15s;
  user-select: none;
}

.collapse-toggle:hover {
  color: #A1A1AA;
}
</style>
