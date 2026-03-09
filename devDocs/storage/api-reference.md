# Storage Modules

存储系统核心模块，负责管理 CCGUI 的所有持久化数据。

## 模块说明

### app-config-manager.js

应用配置管理器，负责管理全局应用配置文件 `~/.ccgui/app.json`。

#### 功能

- 读取和保存应用配置
- 获取和设置配置项（支持点号分隔的路径）
- 更新部分配置
- 重置为默认配置

#### API

```javascript
const appConfigManager = require('./app-config-manager')

// 加载配置
const config = appConfigManager.loadConfig()

// 保存配置
appConfigManager.saveConfig(config)

// 获取配置项
const theme = appConfigManager.getConfigValue('settings.theme')

// 设置配置项
appConfigManager.setConfigValue('settings.theme', 'dark')

// 更新部分配置
appConfigManager.updateConfig({
  lastOpenedProjects: ['project-id-1']
})

// 重置配置
appConfigManager.resetConfig()
```

#### 配置结构

```json
{
  "version": "1.0.0",
  "lastOpenedProjects": [],
  "windowStates": {},
  "settings": {
    "theme": "light",
    "language": "zh-CN"
  }
}
```

### project-config-manager.js

项目配置管理器，负责管理项目配置文件 `~/.ccgui/projects/{projectId}/project.json`。

#### 功能

- 创建、读取、更新、删除项目配置
- 获取所有项目列表
- 根据路径查找项目
- 重命名项目

#### API

```javascript
const projectConfigManager = require('./project-config-manager')

// 创建项目
const project = projectConfigManager.createProject('/path/to/project', 'Project Name')

// 加载项目配置
const config = projectConfigManager.loadProjectConfig(projectId)

// 更新项目配置
projectConfigManager.updateProjectConfig(projectId, {
  settings: { customSetting: 'value' }
})

// 删除项目
projectConfigManager.deleteProject(projectId)

// 获取所有项目
const projects = projectConfigManager.getAllProjects()

// 根据路径查找项目
const project = projectConfigManager.findProjectByPath('/path/to/project')

// 重命名项目
projectConfigManager.renameProject(projectId, 'New Name')

// 检查项目是否存在
const exists = projectConfigManager.projectExists(projectId)
```

#### 项目配置结构

```json
{
  "id": "project-id-hash",
  "name": "项目名称",
  "path": "/path/to/project",
  "createdAt": "2026-03-09T00:00:00.000Z",
  "updatedAt": "2026-03-09T00:00:00.000Z",
  "settings": {}
}
```

#### 项目 ID 生成

项目 ID 使用项目路径的 MD5 哈希值生成，确保同一路径的项目始终具有相同的 ID。

```javascript
const projectId = projectConfigManager.generateProjectId('/path/to/project')
```

## 设计原则

1. **错误处理**: 所有操作都有完善的错误处理，失败时返回 null 或 false
2. **日志记录**: 使用 logger 模块记录所有重要操作
3. **文件不存在处理**: 配置文件不存在时返回默认配置
4. **数据格式验证**: 保存前验证数据格式
5. **自动创建目录**: 自动创建所需的目录结构

## 使用示例

```javascript
const appConfigManager = require('./app-config-manager')
const projectConfigManager = require('./project-config-manager')

// 初始化应用配置
const appConfig = appConfigManager.loadConfig()
console.log('当前主题:', appConfig.settings.theme)

// 创建新项目
const newProject = projectConfigManager.createProject(
  '/Users/alwaysking/projects/my-app',
  'My Application'
)

if (newProject) {
  console.log('创建项目成功:', newProject.name)

  // 更新应用配置，添加到最近打开的项目
  appConfigManager.updateConfig({
    lastOpenedProjects: [
      newProject.id,
      ...appConfig.lastOpenedProjects
    ]
  })
}
```

## 测试

运行测试脚本：

```bash
node electron/storage/test-config-managers.js
```

## 同步管理器

### sync-manager.js

同步管理器负责在 `~/.ccgui` 和 `~/.claude/projects` 之间同步数据。

#### 功能

- 启动时执行完整同步
- 从 `.claude` 导入新项目和会话
- 删除 `.claude` 中不存在的过期数据
- 提供详细的同步结果报告
- 支持手动触发同步

#### API

```javascript
const SyncManager = require('./sync-manager')
const syncManager = new SyncManager()

// 初始化
syncManager.initialize()

// 执行完整同步
const report = await syncManager.performFullSync()

// 获取同步状态
const status = syncManager.getSyncStatus()
```

#### 同步报告结构

```javascript
{
  timestamp: "2026-03-09T00:00:00.000Z",
  projects: {
    deleted: ["project-id-1"],
    imported: ["project-id-2"],
    preserved: ["project-id-3"]
  },
  sessions: {
    deleted: [{ projectId, sessionId }],
    imported: [{ projectId, sessionId }],
    preserved: [{ projectId, sessionId }]
  },
  errors: []
}
```

详细使用说明请参考: [sync-manager-usage.js](./sync-manager-usage.js)

## 相关文档

详细设计文档请参考: [docs/storage-system-design.md](../../docs/storage-system-design.md)
