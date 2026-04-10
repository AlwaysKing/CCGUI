# Claude Provider 实现检查报告

**检查日期**: 2026-04-09
**对照源码**: `/Users/alwaysking/AKProject/claude-code`
**检查文件**:
- `electron/adapters/claude/client.js`
- `electron/adapters/claude/adapter.js`

---

## 一、代码错误（会导致功能失败）

### 1. `rewind_and_fork` 子类型不存在

**位置**: `adapter.js:1145`

```javascript
} else if (normalizedRequest?.subtype === 'reset_files_and_fork') {
  normalizedRequest.subtype = 'rewind_and_fork'  // ← 不存在于 Claude Code
  normalizedRequest.dry_run = false
}
```

**问题**: Claude Code 源码只定义了 `rewind_files` 这一个回滚子类型（`SDKControlRewindFilesRequestSchema`），没有 `rewind_and_fork`。发送这个子类型会被 Claude Code 忽略或报错。

**影响**: `adapter.js:39` 声明了 `forkReset: true`（表示支持 fork 模式回滚），但底层发送的是不存在的子类型，所以 fork 回滚实际上不会生效。

**修复方向**: 改为 `rewind_files`（与普通 reset 相同），或者确认 fork 回滚是否还需要其他机制实现。如果 Claude Code 不支持 fork 语义，应将 `forkReset` 设为 `false`。

---

### 2. `--max-thinking-tokens` 已废弃

**位置**: `client.js:334`

```javascript
'--max-thinking-tokens', '31999',
```

**问题**: Claude Code 源码中这个参数标记为 `[DEPRECATED. Use --thinking instead for newer models]` 且 `.hideHelp()`。虽然目前仍可工作，但未来版本可能移除。

**修复方向**: 改为 `'--thinking', 'enabled'` 或 `'--thinking', 'adaptive'`。

---

## 二、未实现的 control_request 子类型

以下是 Claude Code 协议支持但项目未实现的 control_request，按实用性排序：

| 子类型 | 实用性 | 说明 |
|--------|--------|------|
| `get_context_usage` | **高** | 获取上下文 token 使用量，前端可显示进度条 |
| `elicitation` | **高** | MCP 服务器需要用户填写表单/确认 URL |
| `mcp_set_servers` | 中 | 动态添加/移除 MCP 服务器 |
| `mcp_status` | 中 | 查询 MCP 服务器连接状态 |
| `stop_task` | 中 | 停止指定任务（目前只有 interrupt 全局中断） |
| `get_settings` | 中 | 获取当前生效的配置 |
| `cancel_async_message` | 低 | 取消异步消息 |
| `mcp_reconnect` | 低 | 重连指定 MCP 服务器 |
| `mcp_toggle` | 低 | 启用/禁用 MCP 服务器 |
| `reload_plugins` | 低 | 重新加载插件 |
| `apply_flag_settings` | 低 | 应用 flag 设置 |
| `seed_read_state` | 低 | 预填充文件状态 |
| `set_max_thinking_tokens` | 低 | 已有 CLI 参数覆盖 |

---

## 三、未处理的 system 消息子类型

`adapter.js` 的 `handleSystemMessage` 已处理 7 种子类型：
- `api_retry` ✓
- `init` ✓
- `status` ✓
- `compact_boundary` ✓
- `task_started` ✓
- `task_progress` ✓
- `task_notification` ✓

以下 8 种落入默认的 `provider-system-message` 通知：

| 未处理的子类型 | 潜在用途 |
|---------------|---------|
| `post_turn_summary` | 后台回合摘要，可用于消息折叠显示 |
| `hook_started` | Hook 执行开始，可用于进度显示 |
| `hook_progress` | Hook 执行进度 |
| `hook_response` | Hook 执行响应 |
| `files_persisted` | 文件持久化事件，可用于文件树刷新 |
| `session_state_changed` | 会话状态变更 |
| `elicitation_complete` | Elicitation 完成 |
| `prompt_suggestion` | 提示建议（可用于自动补全） |

这些不是错误，会被当作通用通知转发到前端，但显式处理能提供更好的用户体验。

---

## 四、initialize 请求缺少可选字段

**位置**: `client.js:490-498`

```javascript
const initRequest = {
  subtype: 'initialize',
  hooks: {},
  sdkMcpServers: [],
  jsonSchema: null,
  systemPrompt: null
}
```

Claude Code 源码还支持这些可选字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `appendSystemPrompt` | string | 追加系统提示词（目前通过 `--append-system-prompt` CLI 参数传递） |
| `agents` | Record<string, AgentDefinitionSchema> | 自定义 agent 定义 |
| `promptSuggestions` | boolean | 启用提示建议 |
| `agentProgressSummaries` | boolean | 启用 agent 进度摘要 |

不影响功能，但 `agentProgressSummaries` 如果开启可能会让 agent 协作体验更好。

---

## 五、其他注意事项

### 1. 未使用 `--fork-session` 参数

`client.js:349-361` 恢复会话时只用 `--resume`，没有 `--fork-session`。如果需要在恢复会话时创建分支（而不是在原会话上继续），需要加这个参数。

### 2. `update_environment_variables` 消息类型未实现

Claude Code 源码支持通过 `type: "update_environment_variables"` 消息动态更新环境变量。项目未实现，但对 GUI 场景不太需要。

---

## 修复优先级

| 优先级 | 问题 | 位置 |
|--------|------|------|
| P0 | `rewind_and_fork` 子类型不存在，fork 回滚不生效 | adapter.js:1145 |
| P1 | `--max-thinking-tokens` 已废弃，应迁移到 `--thinking` | client.js:334 |
| P2 | 实现 `get_context_usage` 显示上下文用量 | 新增 |
| P2 | 实现 `elicitation` 处理 MCP 表单交互 | 新增 |
| P3 | 处理 `post_turn_summary` 等系统消息子类型 | adapter.js handleSystemMessage |
| P3 | initialize 请求加入 `agentProgressSummaries` | client.js:490 |
