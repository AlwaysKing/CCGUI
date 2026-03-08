<script setup>
defineProps({
  projectName: String,
  hasRunningSessions: Boolean
})

const emit = defineEmits(['close', 'replace', 'newWindow'])
</script>

<template>
  <div class="dialog-overlay" @click.self="emit('close')">
    <div class="dialog">
      <div class="dialog-header">
        <h3>切换项目</h3>
        <button class="close-btn" @click="emit('close')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="dialog-body">
        <p class="question">如何打开项目 <strong>{{ projectName }}</strong>？</p>

        <div v-if="hasRunningSessions" class="warning-box">
          <svg class="warning-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
          <div class="warning-content">
            <p class="warning-title">当前项目有正在运行的会话</p>
            <p class="warning-text">切换项目将会中断这些会话</p>
          </div>
        </div>
      </div>

      <div class="dialog-footer">
        <button class="btn btn-cancel" @click="emit('close')">
          取消
        </button>
        <button class="btn btn-secondary" @click="emit('newWindow')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/>
            <line x1="12" y1="8" x2="12" y2="16"/>
            <line x1="8" y1="12" x2="16" y2="12"/>
          </svg>
          在新窗口中打开
        </button>
        <button
          class="btn btn-primary"
          :class="{ danger: hasRunningSessions }"
          @click="emit('replace')"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="17 1 21 5 17 9"/>
            <path d="M3 11V9a4 4 0 0 1 4-4h14"/>
            <polyline points="7 23 3 19 7 15"/>
            <path d="M21 13v2a4 4 0 0 1-4 4H3"/>
          </svg>
          {{ hasRunningSessions ? '强制切换' : '替换当前项目' }}
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2100;
}

.dialog {
  background: #2D2D2D;
  border: 1px solid #3F3F46;
  border-radius: 12px;
  min-width: 480px;
  max-width: 520px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
}

.dialog-header {
  padding: 16px 20px;
  border-bottom: 1px solid #3F3F46;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.dialog-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  color: #E5E7EB;
}

.close-btn {
  padding: 4px;
  background: transparent;
  border: none;
  color: #6B7280;
  cursor: pointer;
  border-radius: 4px;
}

.close-btn:hover {
  background: #374151;
  color: #D1D5DB;
}

.dialog-body {
  padding: 20px;
}

.question {
  margin: 0 0 16px;
  font-size: 14px;
  color: #D1D5DB;
  line-height: 1.6;
}

.question strong {
  color: #F4F4F5;
  font-weight: 600;
}

.warning-box {
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  padding: 12px;
  display: flex;
  gap: 12px;
  align-items: flex-start;
}

.warning-icon {
  color: #EF4444;
  flex-shrink: 0;
  margin-top: 2px;
}

.warning-content {
  flex: 1;
}

.warning-title {
  margin: 0 0 4px;
  font-size: 14px;
  font-weight: 600;
  color: #FCA5A5;
}

.warning-text {
  margin: 0;
  font-size: 13px;
  color: #F87171;
}

.dialog-footer {
  padding: 16px 20px;
  border-top: 1px solid #3F3F46;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}

.btn {
  padding: 10px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all 0.2s;
  display: flex;
  align-items: center;
  gap: 6px;
}

.btn-cancel {
  background: transparent;
  border: 1px solid #4B5563;
  color: #9CA3AF;
}

.btn-cancel:hover {
  background: #374151;
  border-color: #6B7280;
}

.btn-secondary {
  background: #374151;
  border: 1px solid #4B5563;
  color: #D1D5DB;
}

.btn-secondary:hover {
  background: #4B5563;
  border-color: #6B7280;
}

.btn-primary {
  background: #F97316;
  color: white;
  border: 1px solid #F97316;
}

.btn-primary:hover:not(:disabled) {
  background: #EA580C;
  border-color: #EA580C;
}

.btn-primary.danger {
  background: #DC2626;
  border-color: #DC2626;
}

.btn-primary.danger:hover {
  background: #B91C1C;
  border-color: #B91C1C;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
