# Session 回收站功能设计

## 目标

Session 删除时先软删除（标记），不直接从文件系统移除。用户可通过回收站查看、还原或永久删除已标记的 session。

## 数据模型

在 `session.json` 中新增两个可选字段：

```json
{
  "id": "uuid",
  "deleted": true,
  "deletedAt": "2026-05-15T10:00:00.000Z",
  ...原有字段不变
}
```

## 后端改动

### session-config-manager.js

- 新增 `softDeleteSession(projectId, sessionId)` — 调用 `updateSession` 写入 `{ deleted: true, deletedAt: now }`
- 新增 `restoreSession(projectId, sessionId)` — 调用 `updateSession` 写入 `{ deleted: false, deletedAt: null }`
- 保留现有 `deleteSession()` 不变（永久删除，回收站中使用）

### project-service.js

- 新增 `softDeleteSession(projectId, sessionId)` — 调用 `sessionConfigManager.softDeleteSession`，同时关闭运行中的 session 实例
- 新增 `restoreSession(projectId, sessionId)` — 调用 `sessionConfigManager.restoreSession`，返回更新后的 session

### main.cjs

- 新增 IPC handler `soft-delete-session` → 调用 `projectService.softDeleteSession`
- 新增 IPC handler `restore-session` → 调用 `projectService.restoreSession`

### preload.js

- 在 `electronAPI` 中暴露 `softDeleteSession` 和 `restoreSession` 方法

## 前端改动

### useAppStore.js

- 新增 `showRecycleBin` ref（boolean，默认 false）
- 修改 `currentProjectSessions` computed：根据 `showRecycleBin` 过滤
  - `false` → 过滤掉 `session.deleted === true`
  - `true` → 只显示 `session.deleted === true`
- 新增 `softDeleteSession(sessionId)` — 调用 IPC `softDeleteSession`，更新 sessions 数组中对应项的 `deleted` 和 `deletedAt` 字段；如果删除的是当前 session，设置 `currentSession = null`；同时关闭运行中的 session
- 新增 `restoreSession(sessionId)` — 调用 IPC `restoreSession`，更新 sessions 数组中对应项
- 现有 `deleteSession(sessionId)` 不变，用于回收站中的永久删除

### SessionSidebar.vue

- 新增 prop `showRecycleBin`（Boolean）
- 新增 emit `softDelete`、`restore`、`permanentDelete`
- 在 "+" 按钮和 "..." 按钮之间添加回收站切换按钮（垃圾桶图标）
  - 点击切换 `showRecycleBin` 状态，emit `toggleRecycleBin`
  - 激活状态时按钮高亮
- 根据 `showRecycleBin` 调整上下文菜单：
  - **正常模式**：删除操作改为调用 softDelete
  - **回收站模式**：显示"还原"和"永久删除"选项，隐藏启动/关闭/配置/复制/重命名等不相关选项
- 空状态文案：回收站模式下显示"回收站为空"
- 会话列表标题：回收站模式下显示"回收站"而非"会话列表"

### Workspace.vue

- 新增 `showRecycleBin` ref，传递给 SessionSidebar
- 监听 SessionSidebar 的 `softDelete`、`restore`、`permanentDelete` 事件
- 永久删除弹出确认对话框

## 交互流程

```
正常模式:
  右键 → "删除" → 确认 → softDeleteSession → session 标记 deleted → 列表中消失

回收站模式:
  点击回收站按钮 → 列表切换为显示 deleted 的 session
  右键 → "还原" → restoreSession → 去除 deleted 标记 → 从回收站消失
  右键 → "永久删除" → 确认 → deleteSession（永久删除） → 彻底移除
  再次点击回收站按钮 → 回到正常模式
```

## 不做的事

- 不做数量角标
- 不做自动清理（过期自动删除）
- 不做批量操作
