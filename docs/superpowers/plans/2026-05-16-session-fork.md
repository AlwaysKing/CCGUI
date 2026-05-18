# 复制会话（Fork）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将现有"复制会话"从仅复制配置升级为完整 fork（复制配置+历史消息+通过 Claude CLI `--fork-session` 继承上下文），Codex provider 的菜单项置灰。

**Architecture:** 后端 `copySession` 增强为复制 history 消息文件并在 config 中添加 `forkedFrom` 字段；Claude Client 启动时在 `resolveSessionMode() === 'new'` 且存在 `forkedFrom` 的情况下使用 `--session-id <new> --resume <original> --fork-session`；前端根据 provider 能力控制菜单项可用性。

**Tech Stack:** Electron (Node.js), Vue 3, Claude CLI `--fork-session` 参数

**Spec:** `docs/superpowers/specs/2026-05-16-session-fork-design.md`

---

## File Structure

| 文件 | 操作 | 职责 |
|------|------|------|
| `electron/services/project-service.js` | 修改 | 增强 `copySession()`：复制 history 文件 + 传递 forkedFrom |
| `electron/storage/session-config-manager.js` | 修改 | `createSession()` 支持 `forkedFrom` 字段写入 config |
| `electron/session/session-instance.js` | 修改 | 启动时读取 `forkedFrom` 并传递给 ClaudeAdapter |
| `electron/adapters/claude/client.js` | 修改 | `connect()` 中检测 fork 模式，构建正确启动参数 |
| `electron/adapters/claude/adapter.js` | 修改 | 构造函数支持接收 `forkedFromSessionId` 参数 |
| `src/views/workspace/components/SessionSidebar.vue` | 修改 | 菜单项根据 provider 能力 disabled |
| `src/utils/provider-models.js` | 修改 | 新增 `getProviderCapabilities()` 函数 |

---

### Task 1: session-config-manager 支持 forkedFrom 字段

**Files:**
- Modify: `electron/storage/session-config-manager.js:54-87`

当前 `createSession()` 创建 config 时只写入 `id, projectId, name, createdAt, updatedAt, messageCount, settings`。需要支持传入 `forkedFrom` 字段。

- [ ] **Step 1: 修改 createSession 函数**

`electron/storage/session-config-manager.js` — 在 `createSession` 函数中，在 `sessionConfig` 对象构建处，`settings` 之后添加 `forkedFrom` 字段：

```javascript
// 现有代码 (约第67-75行):
    const sessionConfig = {
      id: sessionId,
      projectId: encodedProjectId,
      name: options.name || `Session ${now.split('T')[0]}`,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      settings: options.settings || {}
    }

// 修改为:
    const sessionConfig = {
      id: sessionId,
      projectId: encodedProjectId,
      name: options.name || `Session ${now.split('T')[0]}`,
      createdAt: now,
      updatedAt: now,
      messageCount: 0,
      settings: options.settings || {},
      ...(options.forkedFrom ? { forkedFrom: options.forkedFrom } : {})
    }
```

使用展开运算符确保 `forkedFrom` 不存在时不写入该字段（保持 config 干净）。

- [ ] **Step 2: 验证**

手动检查：确认 `createSession('test-project', { forkedFrom: 'abc-123' })` 生成的 `session.json` 中包含 `"forkedFrom": "abc-123"`；不传时该字段不存在。

---

### Task 2: project-service.copySession 增强 — 复制 history + 传递 forkedFrom

**Files:**
- Modify: `electron/services/project-service.js:1334-1350`

当前 `copySession()` 只复制 settings。需要增强为：复制 history 消息文件 + 传递 `forkedFrom`。

- [ ] **Step 1: 在 copySession 函数顶部引入 history-manager**

`electron/services/project-service.js` — 确认文件顶部已有 history-manager 引用，若无则添加：

```javascript
const historyManager = require('./history-manager')
```

- [ ] **Step 2: 重写 copySession 函数**

`electron/services/project-service.js` — 替换现有 `copySession` 函数（第 1334-1350 行）：

```javascript
function copySession(projectId, sessionId) {
  const existingSessions = sessionConfigManager.getProjectSessions(projectId) || []
  let maxNum = 0
  for (const session of existingSessions) {
    const match = session.name?.match(/^会话(\d+)$/)
    if (match) {
      maxNum = Math.max(maxNum, parseInt(match[1], 10))
    }
  }

  const sourceConfig = sessionConfigManager.getSession(projectId, sessionId)
  const hasSettings = sourceConfig?.settings && Object.keys(sourceConfig.settings).length > 0

  // 创建新 session，带 forkedFrom 标记
  const newSession = sessionConfigManager.createSession(projectId, {
    name: `会话${maxNum + 1}`,
    settings: hasSettings ? { ...sourceConfig.settings } : {},
    forkedFrom: sessionId
  })

  // 复制 history 消息文件
  const sourceHistoryDir = historyManager.getSessionHistoryDir(projectId, sessionId)
  const newHistoryDir = historyManager.getSessionHistoryDir(projectId, newSession.id)
  const fs = require('fs')
  const path = require('path')

  if (fs.existsSync(sourceHistoryDir)) {
    // ensureDir for new history dir is already done by createSession
    // Copy all files and subdirectories recursively
    copyDirRecursive(sourceHistoryDir, newHistoryDir)
  }

  return newSession
}

/**
 * Recursively copy a directory
 */
function copyDirRecursive(source, target) {
  const fs = require('fs')
  const path = require('path')

  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true })
  }

  const entries = fs.readdirSync(source, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(source, entry.name)
    const targetPath = path.join(target, entry.name)

    if (entry.isDirectory()) {
      copyDirRecursive(sourcePath, targetPath)
    } else {
      fs.copyFileSync(sourcePath, targetPath)
    }
  }
}
```

注意：`copyDirRecursive` 放在 `copySession` 函数之后作为辅助函数。`fs` 和 `path` 模块应在文件顶部检查是否已引入，若已引入则不需要在函数内再次 require。

- [ ] **Step 3: 验证**

手动检查：
1. `copySession` 返回的 session config 包含 `forkedFrom: originalSessionId`
2. 新 session 的 `history/` 目录与源 session 的 `history/` 内容一致
3. 新 session 的 `session.json` 中 `id` 是新 ID，不是旧的

---

### Task 3: provider 能力声明 — getProviderCapabilities

**Files:**
- Modify: `src/utils/provider-models.js`

- [ ] **Step 1: 新增 getProviderCapabilities 函数**

`src/utils/provider-models.js` — 在文件末尾（`export` 之前或现有函数之后）添加：

```javascript
/**
 * Get provider capabilities
 * @param {string} provider - Provider name ('claude' | 'codex')
 * @returns {object} Capabilities object
 */
export function getProviderCapabilities(provider) {
  const normalizedProvider = normalizeProvider(provider)
  if (normalizedProvider === 'codex') {
    return {
      fork: false
    }
  }
  // claude (default)
  return {
    fork: true
  }
}
```

- [ ] **Step 2: 验证**

确认 `getProviderCapabilities('claude').fork === true` 且 `getProviderCapabilities('codex').fork === false`。

---

### Task 4: 前端右键菜单 — 根据 provider 能力 disabled

**Files:**
- Modify: `src/views/workspace/components/SessionSidebar.vue`

需要让"复制会话"按钮在 provider 为 codex 时 disabled。

- [ ] **Step 1: 在 SessionSidebar.vue 中引入 getProviderCapabilities**

文件顶部的 import 区域，已有 `import { findProviderModel } from '../../../utils/provider-models'`，修改为：

```javascript
import { findProviderModel, getProviderCapabilities } from '../../../utils/provider-models'
```

- [ ] **Step 2: 添加 computed 判断当前 session 的 fork 能力**

在 `SessionSidebar.vue` 的 `<script setup>` 区域中，找到已有的 computed 属性区域，添加：

```javascript
// 判断右键菜单中的 session 是否支持 fork
const isSessionForkCapable = computed(() => {
  const session = contextMenu.value.session
  if (!session) return true
  const tool = session?.settings?.tool || session?.settings?.provider || 'claude'
  const provider = tool === 'codex' ? 'codex' : 'claude'
  return getProviderCapabilities(provider).fork
})
```

- [ ] **Step 3: 在"复制会话"按钮上添加 disabled 条件**

找到模板中的"复制会话"按钮（约第 1754 行）：

```html
<!-- Copy Session -->
<button class="menu-item" @click="handleCopySession">
```

修改为：

```html
<!-- Copy Session -->
<button class="menu-item" :disabled="!isSessionForkCapable" @click="handleCopySession">
```

同时添加对应样式（如果现有 CSS 中没有 disabled 样式的话），在 `<style scoped>` 区域中找到 `.menu-item` 相关样式，添加：

```css
.menu-item:disabled {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}
```

注意：先检查 `.menu-item:disabled` 或 `.menu-item.danger:disabled` 样式是否已经存在（因为"删除会话"按钮已有 `:disabled`），如果存在则无需重复添加。

- [ ] **Step 4: 验证**

启动应用，右键一个 Codex provider 的 session → "复制会话"按钮应为灰色不可点击。右键一个 Claude provider 的 session → 按钮正常可用。

---

### Task 5: session-instance 传递 forkedFrom 给 ClaudeAdapter

**Files:**
- Modify: `electron/session/session-instance.js:1372-1384`

当创建 ClaudeAdapter 时，需要将 `forkedFromSessionId` 传入 options，以便 ClaudeClient 在 `connect()` 时使用。

- [ ] **Step 1: 从 session config 中读取 forkedFrom 并传递给 adapter**

`electron/session/session-instance.js` — 找到创建 ClaudeAdapter 的代码块（约第 1372-1384 行）：

```javascript
    } else {
      const nativeClaudeSessionId = this.resolveClaudeRuntimeSessionId()
      this.runtimeManager = new ClaudeAdapter(
        this.projectPath,
        nativeClaudeSessionId,
        isNewSession,
        this.permissionMode,
        settings,
        {
          debug: this.sessionSettings.debug === true
        }
      )
    }
```

修改为：

```javascript
    } else {
      const nativeClaudeSessionId = this.resolveClaudeRuntimeSessionId()
      this.runtimeManager = new ClaudeAdapter(
        this.projectPath,
        nativeClaudeSessionId,
        isNewSession,
        this.permissionMode,
        settings,
        {
          debug: this.sessionSettings.debug === true,
          forkedFromSessionId: isNewSession ? (this.sessionConfig?.forkedFrom || null) : null
        }
      )
    }
```

关键点：只在 `isNewSession === true` 时传递 `forkedFrom`，否则传 `null`。这确保了"只第一次启动时走 fork 路径"的逻辑。

注意：确认 `this.sessionConfig` 在此位置是否可用。根据代码上下文，`this.sessionConfig` 应该在 `init()` 方法中已经被设置。如果变量名不同，需要调整为实际的 config 引用（可能是 `this.config` 或从 `sessionConfigManager.getSession()` 获取）。实现时需检查确认。

- [ ] **Step 2: 验证**

添加临时日志：`logger.info('[SessionInstance] Fork options', { isNewSession, forkedFrom: this.sessionConfig?.forkedFrom })`，确认 forked session 首次启动时日志正确，非 fork session 时为 null。

---

### Task 6: ClaudeClient.connect() 支持 fork 模式启动参数

**Files:**
- Modify: `electron/adapters/claude/client.js:44-53,685-698`

需要：
1. 构造函数接收并存储 `forkedFromSessionId`
2. `connect()` 中在 `mode === 'new'` 且有 `forkedFromSessionId` 时使用 fork 参数

- [ ] **Step 1: 构造函数存储 forkedFromSessionId**

`electron/adapters/claude/client.js` — 在构造函数中（约第 44-69 行），找到现有 options 解构区域，添加 `forkedFromSessionId`：

```javascript
// 现有代码中已有:
this.shouldLinkSanitizedSessionArtifacts = false
this.commandInventory = { commands: [], mcpServers: [] }
// ...

// 在 options 解构之后添加:
this.forkedFromSessionId = options.forkedFromSessionId || null
```

- [ ] **Step 2: 修改 connect() 中的 session 模式判断**

`electron/adapters/claude/client.js` — 找到 `connect()` 方法中构建启动参数的部分（约第 685-698 行）：

```javascript
    const sessionMode = this.resolveSessionMode()

    // Add session-id to resume or create session
    if (this.sessionId) {
      if (sessionMode === 'new') {
        // New session: use --session-id to create a new session with specific ID
        args.push('--session-id', this.sessionId)
        logger.info(`[ClaudeClient] Creating new session with ID: ${this.sessionId}`)
      } else {
        // Existing session: use --resume to resume the session
        args.push('--resume', this.sessionId)
        logger.info(`[ClaudeClient] Resuming session with ID: ${this.sessionId}`)
      }
    }
```

修改为：

```javascript
    const sessionMode = this.resolveSessionMode()

    // Add session-id to resume or create session
    if (this.sessionId) {
      if (sessionMode === 'new') {
        if (this.forkedFromSessionId) {
          // Fork mode: new session ID + resume from source + fork-session flag
          args.push('--session-id', this.sessionId)
          args.push('--resume', this.forkedFromSessionId)
          args.push('--fork-session')
          logger.info(`[ClaudeClient] Forking session: new=${this.sessionId}, from=${this.forkedFromSessionId}`)
        } else {
          // New session: use --session-id to create a new session with specific ID
          args.push('--session-id', this.sessionId)
          logger.info(`[ClaudeClient] Creating new session with ID: ${this.sessionId}`)
        }
      } else {
        // Existing session: use --resume to resume the session
        args.push('--resume', this.sessionId)
        logger.info(`[ClaudeClient] Resuming session with ID: ${this.sessionId}`)
      }
    }
```

- [ ] **Step 3: 验证**

添加临时日志确认参数构建正确。Fork session 首次启动时应看到：
```
[ClaudeClient] Forking session: new=<newId>, from=<originalId>
```
参数列表中应包含 `--session-id <newId> --resume <originalId> --fork-session`。

后续启动（mode = 'resume'）时应看到正常的 resume 日志，不涉及 fork。

---

### Task 7: ClaudeAdapter 传递 forkedFromSessionId

**Files:**
- Modify: `electron/adapters/claude/adapter.js:22-70`

ClaudeAdapter 继承自 ClaudeClient，构造函数需要把 `forkedFromSessionId` 传递到父类。

- [ ] **Step 1: 确认 adapter 构造函数的透传**

ClaudeAdapter 的构造函数：

```javascript
class ClaudeAdapter extends ClaudeClient {
  constructor(...args) {
    super(...args)
```

使用 `...args` 透传，所以 ClaudeAdapter 的 `options` 对象中的 `forkedFromSessionId` 会自动传到 `ClaudeClient` 构造函数。**无需额外修改**，因为透传机制已经保证。

但需要确认：`SessionInstance` 传给 `ClaudeAdapter` 的参数顺序是否与 `ClaudeClient` 构造函数匹配。

ClaudeClient 构造函数签名：
```javascript
constructor(workingDirectory, sessionId, isNewSession, permissionMode, projectSettings, options)
```

SessionInstance 调用：
```javascript
new ClaudeAdapter(projectPath, nativeClaudeSessionId, isNewSession, permissionMode, settings, { debug, forkedFromSessionId })
```

参数顺序完全匹配。options 对象中的 `forkedFromSessionId` 会通过 `...args` 透传到 ClaudeClient。✅

- [ ] **Step 2: 记录确认**

此任务无需代码改动，仅为验证透传机制正确。可以在 adapter 构造函数中添加一行临时日志验证：

```javascript
constructor(...args) {
    super(...args)
    logger.info(`[ClaudeAdapter] forkedFromSessionId: ${this.forkedFromSessionId}`)
```

验证后移除临时日志。

---

### Task 8: 端到端验证

- [ ] **Step 1: 验证 Claude session fork 完整流程**

1. 创建一个 Claude provider 的 session
2. 发送几条消息，确保有历史记录
3. 右键 → "复制会话"
4. 检查新 session 出现在列表中
5. 检查 `~/.ccgui/projects/{projectId}/sessions/{newSessionId}/history/` 目录有消息文件
6. 检查 `session.json` 包含 `forkedFrom` 字段且 `id` 是新 ID
7. 启动新 session → 检查 ClaudeClient 日志显示 fork 参数
8. 确认新 session 继承了原始 session 的对话上下文
9. 关闭新 session，再次启动 → 检查使用普通 resume 模式（不走 fork）

- [ ] **Step 2: 验证 Codex session disabled**

1. 创建或切换到 Codex provider 的项目
2. 右键 Codex session → "复制会话"按钮应为灰色 disabled
3. 确认无法点击

- [ ] **Step 3: 清理临时日志**

移除所有验证过程中添加的临时日志。

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: 升级复制会话为完整 fork 功能

- 复制会话现在复制历史消息+配置，不再只是空配置
- 支持 forkedFrom 字段记录来源关系
- Claude CLI 使用 --fork-session 参数继承上下文
- Codex provider 的复制会话菜单项置灰不可用"
```
