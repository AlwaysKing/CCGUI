# StorageManager 快速参考

## 导入

```javascript
const { storageManager } = require('./storage-manager')
```

## 快速开始

```javascript
// 1. 初始化
await storageManager.initialize()

// 2. 创建项目目录
await storageManager.ensureProjectDir('project-name')

// 3. 创建会话目录
await storageManager.ensureSessionDir('project-name', 'session-id')

// 4. 获取文件路径
const messagesPath = storageManager.getMessagesPath('project-name', 'session-id')
```

## 常用路径获取

| 方法 | 返回路径示例 |
|------|-------------|
| `getBasePath()` | `~/.ccgui` |
| `getProjectsPath()` | `~/.ccgui/projects` |
| `getAppConfigPath()` | `~/.ccgui/app.json` |
| `getProjectPath('proj')` | `~/.ccgui/projects/proj` |
| `getProjectConfigPath('proj')` | `~/.ccgui/projects/proj/project.json` |
| `getSessionPath('proj', 'sess')` | `~/.ccgui/projects/proj/sessions/sess` |
| `getMessagesPath('proj', 'sess')` | `~/.ccgui/projects/proj/sessions/sess/history/messages.jsonl` |

## 目录结构

```
~/.ccgui/
├── app.json
└── projects/
    └── {project-name}/
        ├── project.json
        └── sessions/
            └── {session-id}/
                ├── session.json
                └── history/
                    ├── messages.jsonl
                    └── metadata.json
```

## 错误处理

```javascript
try {
  await storageManager.ensureProjectDir('my-project')
} catch (error) {
  console.error('Failed:', error)
  // 错误已记录到 /tmp/ccgui/app.log
}
```

## 在 Electron 中集成

```javascript
// electron/main.cjs
const { storageManager } = require('./storage-manager')
const logger = require('./logger')

app.whenReady().then(async () => {
  logger.initialize()
  await storageManager.initialize()
  createWindow()
})
```

## 检查初始化状态

```javascript
if (storageManager.isInitialized()) {
  // 安全使用
}
```

## 获取统计信息

```javascript
const stats = await storageManager.getStorageStats()
console.log('Projects:', stats.projectCount)
```

## 注意事项

1. 必须先调用 `initialize()` 才能使用其他方法
2. 所有异步方法都返回 Promise
3. 项目名称应使用编码后的名称
4. 所有操作都会记录到日志

## 日志位置

`/tmp/ccgui/app.log`

## API 文档

详细文档见: `electron/STORAGE_MANAGER_API.md`
