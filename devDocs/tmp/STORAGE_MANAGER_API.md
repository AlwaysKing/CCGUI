# StorageManager API 参考

## 模块导入

```javascript
const { storageManager, StorageManager, STORAGE_CONFIG } = require('./storage-manager')
```

## 常量

### STORAGE_CONFIG

存储系统配置常量:

```javascript
{
  baseDir: '.ccgui',           // 基础目录名
  projectsDir: 'projects',      // 项目目录名
  appConfigFile: 'app.json'     // 应用配置文件名
}
```

## 类: StorageManager

### 实例属性

- `initialized` (boolean) - 是否已初始化
- `basePath` (string) - 基础存储路径 (~/.ccgui)
- `projectsPath` (string) - 项目存储路径
- `appConfigPath` (string) - 应用配置文件路径

### 方法

#### initialize()

初始化存储系统。必须在使用其他方法前调用。

**返回值:** `Promise<boolean>`

**示例:**
```javascript
await storageManager.initialize()
```

---

#### ensureDirectoryStructure()

确保目录结构存在。通常由 `initialize()` 自动调用。

**返回值:** `Promise<void>`

---

#### ensureDir(dirPath)

确保指定目录存在,不存在则创建。

**参数:**
- `dirPath` (string) - 目录路径

**返回值:** `Promise<void>`

**示例:**
```javascript
await storageManager.ensureDir('/path/to/directory')
```

---

#### initializeAppConfig()

初始化应用配置文件。如果文件不存在,创建默认配置。

**返回值:** `Promise<void>`

---

### 路径获取方法

#### getBasePath()

获取基础存储路径。

**返回值:** `string`

**示例:**
```javascript
const basePath = storageManager.getBasePath()
// 返回: /Users/username/.ccgui
```

---

#### getProjectsPath()

获取项目存储路径。

**返回值:** `string`

**示例:**
```javascript
const projectsPath = storageManager.getProjectsPath()
// 返回: /Users/username/.ccgui/projects
```

---

#### getAppConfigPath()

获取应用配置文件路径。

**返回值:** `string`

**示例:**
```javascript
const appConfigPath = storageManager.getAppConfigPath()
// 返回: /Users/username/.ccgui/app.json
```

---

#### getProjectPath(encodedProjectName)

获取特定项目的路径。

**参数:**
- `encodedProjectName` (string) - 编码后的项目名称

**返回值:** `string`

**示例:**
```javascript
const projectPath = storageManager.getProjectPath('my-project-123')
// 返回: /Users/username/.ccgui/projects/my-project-123
```

---

#### getProjectConfigPath(encodedProjectName)

获取特定项目配置文件路径。

**参数:**
- `encodedProjectName` (string) - 编码后的项目名称

**返回值:** `string`

**示例:**
```javascript
const configPath = storageManager.getProjectConfigPath('my-project-123')
// 返回: /Users/username/.ccgui/projects/my-project-123/project.json
```

---

#### getSessionPath(encodedProjectName, sessionId)

获取特定会话的路径。

**参数:**
- `encodedProjectName` (string) - 编码后的项目名称
- `sessionId` (string) - 会话 ID

**返回值:** `string`

**示例:**
```javascript
const sessionPath = storageManager.getSessionPath('my-project-123', 'session-456')
// 返回: /Users/username/.ccgui/projects/my-project-123/sessions/session-456
```

---

#### getSessionConfigPath(encodedProjectName, sessionId)

获取特定会话配置文件路径。

**参数:**
- `encodedProjectName` (string) - 编码后的项目名称
- `sessionId` (string) - 会话 ID

**返回值:** `string`

**示例:**
```javascript
const configPath = storageManager.getSessionConfigPath('my-project-123', 'session-456')
// 返回: /Users/username/.ccgui/projects/my-project-123/sessions/session-456/session.json
```

---

#### getHistoryPath(encodedProjectName, sessionId)

获取会话历史目录路径。

**参数:**
- `encodedProjectName` (string) - 编码后的项目名称
- `sessionId` (string) - 会话 ID

**返回值:** `string`

**示例:**
```javascript
const historyPath = storageManager.getHistoryPath('my-project-123', 'session-456')
// 返回: /Users/username/.ccgui/projects/my-project-123/sessions/session-456/history
```

---

#### getMessagesPath(encodedProjectName, sessionId)

获取会话消息文件路径。

**参数:**
- `encodedProjectName` (string) - 编码后的项目名称
- `sessionId` (string) - 会话 ID

**返回值:** `string`

**示例:**
```javascript
const messagesPath = storageManager.getMessagesPath('my-project-123', 'session-456')
// 返回: /Users/username/.ccgui/projects/my-project-123/sessions/session-456/history/messages.jsonl
```

---

#### getMetadataPath(encodedProjectName, sessionId)

获取会话元数据文件路径。

**参数:**
- `encodedProjectName` (string) - 编码后的项目名称
- `sessionId` (string) - 会话 ID

**返回值:** `string`

**示例:**
```javascript
const metadataPath = storageManager.getMetadataPath('my-project-123', 'session-456')
// 返回: /Users/username/.ccgui/projects/my-project-123/sessions/session-456/history/metadata.json
```

---

### 目录管理方法

#### ensureProjectDir(encodedProjectName)

确保项目目录及其子目录存在。

**参数:**
- `encodedProjectName` (string) - 编码后的项目名称

**返回值:** `Promise<void>`

**示例:**
```javascript
await storageManager.ensureProjectDir('my-project-123')
```

**创建的目录:**
- `{basePath}/projects/{encodedProjectName}`
- `{basePath}/projects/{encodedProjectName}/sessions`

---

#### ensureSessionDir(encodedProjectName, sessionId)

确保会话目录及其子目录存在。

**参数:**
- `encodedProjectName` (string) - 编码后的项目名称
- `sessionId` (string) - 会话 ID

**返回值:** `Promise<void>`

**示例:**
```javascript
await storageManager.ensureSessionDir('my-project-123', 'session-456')
```

**创建的目录:**
- `{basePath}/projects/{encodedProjectName}/sessions/{sessionId}`
- `{basePath}/projects/{encodedProjectName}/sessions/{sessionId}/history`

---

### 状态查询方法

#### isInitialized()

检查存储系统是否已初始化。

**返回值:** `boolean`

**示例:**
```javascript
if (storageManager.isInitialized()) {
  // 可以安全使用
}
```

---

#### getStorageStats()

获取存储统计信息。

**返回值:** `Promise<Object>`

**返回对象结构:**
```javascript
{
  basePath: string,           // 基础路径
  projectsPath: string,       // 项目路径
  appConfigPath: string,      // 应用配置路径
  initialized: boolean,       // 是否已初始化
  projectCount: number,       // 项目总数
  projects: Array<{           // 项目列表
    name: string,             // 项目名称
    sessionCount: number      // 会话数量
  }>
}
```

**示例:**
```javascript
const stats = await storageManager.getStorageStats()
console.log(`Total projects: ${stats.projectCount}`)
```

---

## 错误处理

所有方法在发生错误时会抛出异常,建议使用 try-catch 捕获:

```javascript
try {
  await storageManager.ensureProjectDir('my-project')
} catch (error) {
  console.error('Failed to create project directory:', error)
  // 错误已通过 logger 记录到 /tmp/ccgui/app.log
}
```

**常见错误:**

1. **未初始化错误**
   ```javascript
   // 错误: Error: StorageManager not initialized
   // 解决: 先调用 await storageManager.initialize()
   ```

2. **权限错误**
   ```javascript
   // 错误: EACCES: permission denied
   // 解决: 检查用户对主目录的写权限
   ```

3. **磁盘空间不足**
   ```javascript
   // 错误: ENOSPC: no space left on device
   // 解决: 清理磁盘空间
   ```

---

## 使用示例

### 完整初始化流程

```javascript
const { storageManager } = require('./storage-manager')

async function setupStorage() {
  try {
    // 初始化存储系统
    await storageManager.initialize()

    // 创建项目目录
    await storageManager.ensureProjectDir('my-project')

    // 创建会话目录
    await storageManager.ensureSessionDir('my-project', 'session-123')

    // 获取路径
    const messagesPath = storageManager.getMessagesPath('my-project', 'session-123')

    console.log('Storage setup complete!')
    console.log('Messages will be stored at:', messagesPath)
  } catch (error) {
    console.error('Storage setup failed:', error)
    process.exit(1)
  }
}

setupStorage()
```

### 在 Electron 主进程中集成

```javascript
// electron/main.cjs
const { app } = require('electron')
const { storageManager } = require('./storage-manager')
const logger = require('./logger')

let mainWindow

async function initializeApp() {
  try {
    // 初始化日志系统
    logger.initialize()

    // 初始化存储系统
    await storageManager.initialize()

    logger.info('Application storage initialized')

    // 创建窗口
    createWindow()
  } catch (error) {
    logger.error('Failed to initialize app:', error)
    app.quit()
  }
}

app.whenReady().then(initializeApp)
```

---

## 最佳实践

1. **单例使用**: 使用导出的 `storageManager` 单例,不要创建新实例
2. **早期初始化**: 在应用启动时立即初始化
3. **错误处理**: 所有异步操作都应使用 try-catch
4. **路径编码**: 项目名称应预先编码,避免路径问题
5. **日志监控**: 定期检查 `/tmp/ccgui/app.log` 了解系统运行状态

---

## 后续开发

StorageManager 是基础模块,后续将扩展以下子模块:

- **AppConfigManager** - 应用配置管理
- **ProjectConfigManager** - 项目配置管理
- **SessionConfigManager** - 会话配置管理
- **HistoryManager** - 历史记录管理
- **SyncManager** - 同步管理

这些子模块将通过 StorageManager 的实例属性访问。
