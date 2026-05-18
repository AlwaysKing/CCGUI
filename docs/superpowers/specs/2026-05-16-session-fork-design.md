# 复制会话（Fork）功能设计

## 概述

将现有的"复制会话"从残缺实现（仅复制配置）升级为完整的 fork 功能（复制配置 + 历史消息 + 通过 Claude CLI 原生 `--fork-session` 参数继承上下文）。仅 Claude provider 支持，Codex provider 的"复制会话"菜单项置灰不可用。

## 现状问题

当前 `copySession()`（`project-service.js`）只复制 session settings 配置：
- 不复制历史消息
- 不复制 Claude 会话文件
- 不记录来源关系
- 不通过 Claude CLI 的 fork 机制传递上下文

导致"复制会话"创建的是空会话，用户期望的完整复制无法实现。

## 改动概览

### 1. Provider 能力声明

在 provider 相关能力查询中新增 `fork` 字段：

- **Claude provider**：返回 `fork: true`
- **Codex provider**：返回 `fork: false`

具体实现位置待确认，可能在 `provider-models.js` 或各 adapter 的能力声明中。

### 2. 后端 `copySession` 增强

文件：`electron/services/project-service.js` 的 `copySession()` 函数

增强行为：

1. **生成新 session ID**（`crypto.randomUUID()`）
2. **复制 CCGUI history 消息文件**：从源 session 的 `history/` 目录复制全部消息文件到新 session 的 `history/` 目录
3. **复制 settings 配置**：与现有逻辑一致
4. **创建新 session config**，字段如下：
   - `id`: 新 session ID（不是旧的）
   - `name`: `会话{maxNum + 1}`（与现有命名规则一致）
   - `settings`: 复制的源 settings
   - `forkedFrom`: 源 session ID（新增字段，记录来源关系）
5. **不复制 Claude jsonl 文件**（`~/.claude/projects/{projectId}/{sessionId}.jsonl`），由 Claude CLI 通过 `--fork-session` 参数自行处理

### 3. Claude Client 启动参数

文件：`electron/adapters/claude/client.js` 的 `connect()` 方法

在现有的 `resolveSessionMode()` 判断流程内叠加 fork 逻辑：

```
resolveSessionMode()
  → mode = 'new'（jsonl 文件不存在）
    → 检查 session config 是否有 forkedFrom
      → 有 forkedFrom:
          --session-id <current_session_id>
          --resume <forkedFrom_session_id>
          --fork-session
      → 无 forkedFrom:
          --session-id <current_session_id>（普通新 session，现有逻辑不变）
  → mode = 'resume'（jsonl 文件已存在）
    → --resume <current_session_id>（正常恢复，完全忽略 forkedFrom）
```

关键约束：
- `forkedFrom` 只在第一次启动（mode = 'new'）时生效
- 一旦 session 运行过，有了自己的 jsonl，就完全作为独立 session 对待
- 判断 forkedFrom 需要从 session config 中读取，client.js 可能需要额外接收此参数

### 4. 前端右键菜单

文件：`src/views/workspace/components/SessionSidebar.vue`

"复制会话"菜单项行为调整：

- Provider 返回 `fork: true` → 按钮正常可用（点击执行完整 fork）
- Provider 返回 `fork: false` → 按钮 `disabled`，样式置灰不可点击

Provider 的判断方式：根据当前项目配置的 provider 类型决定。具体获取方式待实现时确认（可能从 session/project config 中读取）。

### 5. 不改动的部分

- **菜单名称**：保持"复制会话"，不改为"fork"
- **IPC 通道**：继续使用现有的 `copy-session` 通道
- **前端调用流程**：`handleCopySession()` → `window.electronAPI.copySession()` 不变
- **Codex adapter**：不需要任何修改，仅需通过能力声明让前端知道不支持

## 数据流

```
用户右键 → 点击"复制会话"
  ↓
前端 handleCopySession()
  → window.electronAPI.copySession({ projectId, sessionId })
  ↓
后端 copySession(projectId, sessionId)
  → 生成新 session ID
  → 复制 history/ 消息文件到新 session 目录
  → 复制 settings
  → 创建新 config: { id: newId, forkedFrom: originalId, settings: ... }
  → 返回新 session 信息
  ↓
前端刷新 session 列表
  ↓
用户点击启动新 session
  ↓
SessionInstance 判断 isNewSession
  → ClaudeAdapter / ClaudeClient.connect()
    → resolveSessionMode() → 'new'（没有 jsonl）
    → 检测 config.forkedFrom 存在
    → 启动参数: --session-id <newId> --resume <forkedFrom> --fork-session
  ↓
Claude CLI 内部：
  → 加载源 session 的 transcript
  → 复制到新 session
  → 新 session 拥有完整历史上下文
  ↓
后续启动：
  → resolveSessionMode() → 'resume'（已有自己的 jsonl）
  → 正常 --resume <newId>，忽略 forkedFrom
```

## 涉及文件

| 文件 | 改动 |
|------|------|
| `electron/services/project-service.js` | 增强 `copySession()` |
| `electron/adapters/claude/client.js` | `connect()` 中 fork 启动参数逻辑 |
| `electron/adapters/claude/adapter.js` | 可能需要传递 forkedFrom 参数 |
| `electron/session/session-instance.js` | 启动时传递 forkedFrom 给 adapter |
| `src/views/workspace/components/SessionSidebar.vue` | 菜单项 disabled 逻辑 |
| `src/views/workspace/hooks/useWorkspaceDialogs.js` | 无需改动（调用链不变） |
| `electron/storage/session-config-manager.js` | session config 支持 forkedFrom 字段 |
| Provider 能力声明相关文件 | 新增 fork 能力 |
