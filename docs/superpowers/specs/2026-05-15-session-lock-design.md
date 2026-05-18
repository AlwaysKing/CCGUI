# 会话锁定功能设计

## 概述

新增会话锁定功能。锁定的会话无法被删除（包括单个删除和批量删除未激活会话），在侧边栏显示锁图标作为视觉反馈。

## 数据层

在 session config 中新增 `locked` 布尔字段，默认 `false`。

- 持久化位置：`electron/storage/session-config-manager.js` 中 session config JSON 文件
- 新建会话无需额外处理，默认未锁定
- 新增 `toggleLock(encodedProjectId, sessionId)` 方法切换锁定状态

## 前端 Store 层

- `useAppStore` 新增 `toggleSessionLock(sessionId)` action
- 该 action 通过 IPC 调用 `session-config-manager.toggleLock()` 并刷新 sessions 列表

## UI — 右键上下文菜单

文件：`SessionSidebar.vue`

在右键菜单的删除按钮上方添加"锁定/解锁"切换项：
- 未锁定时显示「锁定会话」（带锁定图标）
- 已锁定时显示「解锁会话」（带解锁图标）
- 已锁定时，"删除会话"按钮设为 `disabled`，样式置灰不可点击

## UI — 删除未激活会话

文件：`Workspace.vue` 中 `handleDeleteInactiveSessions()`

- 过滤时排除 `locked === true` 的会话
- 确认对话框提示文字反映实际将删除的数量（已排除锁定会话）

## UI — 锁图标视觉反馈

文件：`SessionSidebar.vue`

在侧边栏会话名称旁显示锁图标，仅在 `locked === true` 时可见。
