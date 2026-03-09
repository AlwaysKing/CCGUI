# SyncManager 快速参考

## 核心概念

SyncManager 负责在 `~/.claude/projects` 和 `~/.ccgui` 之间同步数据。

## 快速使用

### 1. 导入模块

```javascript
const syncManager = require('./storage/sync-manager')
```

### 2. 执行同步

```javascript
// 同步所有项目和会话
const result = syncManager.performSync()

console.log('Added:', result.projectsAdded)
console.log('Deleted:', result.projectsDeleted)
```

### 3. 加载会话历史(带懒加载)

```javascript
// 优先从 CCGUI 加载,如果没有则从 Claude 导入
const messages = syncManager.loadSessionHistoryWithFallback(projectId, sessionId)
```

## 主要 API

### performSync()
执行完整同步,返回同步结果。

```javascript
{
  projectsAdded: 2,      // 新导入的项目数
  projectsDeleted: 1,    // 删除的过期项目数
  timestamp: "2026-03-09T..."
}
```

### scanClaudeProjects()
扫描 Claude 项目目录。

```javascript
const projects = syncManager.scanClaudeProjects()
// [{ id, path, name, sessionCount, lastActiveAt }, ...]
```

### loadSessionHistoryWithFallback(projectId, sessionId)
加载会话历史,优先 CCGUI,否则从 Claude 导入。

```javascript
const messages = syncManager.loadSessionHistoryWithFallback(
  '-Users-alwaysking-Desktop-myapp',
  'session-uuid'
)
```

## 集成到 Electron

### main.cjs

```javascript
const syncManager = require('./storage/sync-manager')

app.whenReady().then(async () => {
  // 启动时同步
  const result = syncManager.performSync()
  logger.info('[App] Sync completed', result)

  createWindow()
})

// IPC handler
ipcMain.handle('sync-with-claude', () => {
  return syncManager.performSync()
})
```

### preload.js

```javascript
syncWithClaude: () => ipcRenderer.invoke('sync-with-claude')
```

### Vue Component

```javascript
async function sync() {
  const result = await window.electronAPI.syncWithClaude()
  console.log('Synced:', result)
}
```

## 同步策略

1. **删除**: CCGUI 中存在但 Claude 中不存在的数据
2. **保留**: 两边都存在的数据
3. **导入**: Claude 中存在但 CCGUI 中不存在的新数据

## 目录结构

```
~/.claude/projects/           ~/.ccgui/projects/
└── -project-id/             └── -project-id/
    ├── session1.jsonl   →       ├── project.json
    └── session2.jsonl           └── sessions/
                                    ├── session1/
                                    │   ├── session.json
                                    │   └── history/
                                    │       └── messages.jsonl
                                    └── session2/
```

## 日志

所有操作记录到 `/tmp/ccgui/app.log`:

```bash
tail -f /tmp/ccgui/app.log | grep SyncManager
```

## 测试

```javascript
// 测试扫描
const projects = syncManager.scanClaudeProjects()
console.log('Found', projects.length, 'projects')

// 测试同步
const result = syncManager.performSync()
console.log('Result:', result)
```

## 故障排查

### 问题: 项目没有同步
- 检查 `~/.claude/projects` 目录是否存在
- 查看日志: `tail -f /tmp/ccgui/app.log`
- 手动触发同步: `syncManager.performSync()`

### 问题: 历史消息未加载
- 使用 `loadSessionHistoryWithFallback()` 而不是直接读取
- 检查 `.jsonl` 文件是否存在
- 查看日志中的错误信息

## 相关文件

- 实现: `electron/storage/sync-manager.js`
- 示例: `electron/storage/sync-manager-usage.js`
- 集成: `electron/storage/integration-example.js`
- 文档: `electron/storage/SYNC_IMPLEMENTATION.md`
- 设计: `docs/storage-system-design.md`
