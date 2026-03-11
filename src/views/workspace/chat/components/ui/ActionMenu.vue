<script setup>
/**
 * ActionMenu - 操作菜单组件
 * 用户消息的操作菜单：还原、创建分支、还原并创建分支
 */
const props = defineProps({
  isOpen: {
    type: Boolean,
    default: false
  },
  messageId: {
    type: String,
    default: ''
  },
  messageIndex: {
    type: Number,
    default: -1
  }
})

const emit = defineEmits(['toggle', 'rewind', 'fork', 'rewindAndFork'])

function toggleMenu() {
  emit('toggle', props.messageIndex)
}

function handleRewind() {
  emit('rewind', props.messageId, props.messageIndex)
}

function handleFork() {
  emit('fork', props.messageId, props.messageIndex)
}

function handleRewindAndFork() {
  emit('rewindAndFork', props.messageId, props.messageIndex)
}
</script>

<template>
  <div class="action-menu-container" @click.stop>
    <button
      class="action-menu-btn"
      @click="toggleMenu"
      :class="{ active: isOpen }"
      title="更多操作"
    >
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
      </svg>
      操作
    </button>
    <!-- 下拉菜单 -->
    <div v-if="isOpen" class="action-dropdown-menu">
      <button class="menu-item rewind-item" @click="handleRewind">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
          <path d="M3 3v5h5"></path>
        </svg>
        还原
        <span class="menu-hint">撤销后续修改</span>
      </button>
      <button class="menu-item fork-item" @click="handleFork">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="6" y1="3" x2="6" y2="15"></line>
          <circle cx="18" cy="6" r="3"></circle>
          <circle cx="6" cy="18" r="3"></circle>
          <path d="M18 9a9 9 0 0 1-9 9"></path>
        </svg>
        创建分支
        <span class="menu-hint">保留当前状态</span>
      </button>
      <button class="menu-item rewind-fork-item" @click="handleRewindAndFork">
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"></path>
          <path d="M3 3v5h5"></path>
          <line x1="6" y1="8" x2="6" y2="16"></line>
          <circle cx="16" cy="10" r="3"></circle>
          <circle cx="6" cy="18" r="3"></circle>
          <path d="M16 13a6 6 0 0 1-6 5"></path>
        </svg>
        还原并创建分支
        <span class="menu-hint">保存并回滚</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.action-menu-container {
  position: relative;
}

.action-menu-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  background: transparent;
  border: 1px solid #3F3F46;
  border-radius: 4px;
  color: #71717A;
  font-size: 11px;
  cursor: pointer;
  transition: all 0.15s;
}

.action-menu-btn:hover,
.action-menu-btn.active {
  background: #3F3F46;
  color: #A1A1AA;
  border-color: #52525B;
}

.action-dropdown-menu {
  position: absolute;
  top: 100%;
  right: 0;
  margin-top: 4px;
  background: #1E1E1E;
  border: 1px solid #3F3F46;
  border-radius: 6px;
  box-shadow: 0 10px 15px rgba(0, 0, 0, 0.5);
  min-width: 180px;
  z-index: 100;
  overflow: hidden;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 10px 12px;
  background: transparent;
  border: none;
  color: #A1A1AA;
  font-size: 12px;
  cursor: pointer;
  text-align: left;
  transition: all 0.15s;
}

.menu-item:hover {
  background: #3F3F46;
  color: #E4E4E7;
}

.menu-hint {
  margin-left: auto;
  font-size: 11px;
  color: #71717A;
}

.rewind-item {
  color: #F59E0B;
}

.rewind-item:hover {
  background: rgba(245, 158, 11, 0.1);
}

.fork-item {
  color: #3B82F6;
}

.fork-item:hover {
  background: rgba(59, 130, 246, 0.1);
}

.rewind-fork-item {
  color: #8B5CF6;
}

.rewind-fork-item:hover {
  background: rgba(139, 92, 246, 0.1);
}
</style>
