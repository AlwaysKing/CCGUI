# CCGUI Provider Semantics

这份文档描述的是 `ClaudeAdapter` / `CodexAdapter` 在翻译原始协议时必须收敛到的 `CCGUI` 统一语义。

补充说明（2026-04-20）：

- `Claude` 的 `get_context_usage` 不应在 session 初始化后自动调用。
- 已验证该自动查询会在部分接入路径下触发大量 `count_tokens` 请求，显著拖慢启动。
- 当前策略调整为：`Claude` 上下文用量只在用户点击 `EnvInfoBar` 的详细用量入口时手动触发查询。
- `Codex` 的用量展示保持现有逻辑，不受这次调整影响。

专项补充文档：

- [Codex Provider 控制命令与 Skills 语义设计](/Users/alwaysking/AKProject/CCGUI/devDocs/codex-provider-controls-and-skills-design.md)

## 目标

- `session-instance.js` 之后不再理解 provider 原始协议。
- Store / UI 只消费统一的 `CCGUI` 事件和字段含义。
- 当 provider 协议变化时，无法识别的消息必须进入 `unknown_message`，而不是被静默吞掉。

## 统一事件

- `message-start`
- `message-delta`
- `message-update`
- `message-complete`
- `result`
- `control-request`
- `control-response`
- `env-info`
- `cli-status`
- `silent-message`
- `system-notification`
- `unknown_message`
- `exit`

## 统一字段语义

### `message-start`

用于创建一条新的 CCGUI 消息。

常见角色：

- `assistant`
- `tool_use`

关键字段：

- `id`
- `role`
- `timestamp`
- `startTime`

对于 `assistant` 片段，推荐初始字段：

- `content: ''`
- `thinking: ''`
- `hasThinking: false`
- `isStreaming: true`

### `message-delta`

用于给既有消息追加增量内容。

关键字段：

- `messageId`
- `field`
- `delta`

`field` 约束：

- `content`
- `thinking`
- `result`

### `message-update`

用于给既有消息做结构化更新，不追加正文文本。

常见更新字段：

- `usage`
- `stopReason`
- `toolInput`
- `isExecuting`
- `isError`
- `duration`
- `thinkingCollapsed`
- `showTurnSeparator`
- `turnNumber`

### `message-complete`

用于结束一个消息片段。

常见更新字段：

- `isStreaming: false`
- `duration`
- `thinkingCollapsed`

### `result`

表示“一次用户请求”的最终结算，而不是某个原始 provider step 的结束。

关键字段：

- `duration_ms`
- `num_turns`
- `usage`

语义要求：

- `duration_ms` 表示整次用户请求耗时
- `num_turns` 表示 CCGUI 语义下的 assistant 片段轮次数
- `usage` 表示整次用户请求累计 usage

### `control-request`

必须统一出以下核心字段：

- `request_id`
- `tool_name`
- `tool_input`

兼容字段允许保留：

- `toolName`
- `toolInput`
- `input`

### `control-response`

表示一次控制请求已经得到响应。

语义要求：

- 如果 provider 原始协议没有显式响应，adapter 必须主动补齐
- 上层只认“是否已经响应”，不区分这是 provider 原生返回还是 adapter 合成

### `env-info`

表示会话级环境信息的增量快照。

常见字段：

- `provider`
- `providerPid`
- `session_id`
- `cwd`
- `model`
- `status`
- `session_usage`
- `rate_limits`

### `silent-message`

用于不进入主聊天时间线的静默事件，例如：

- server request resolved
- raw response item completed

### `system-notification`

用于高层可见但不属于普通 assistant/tool 消息的系统提示。

已知类型：

- `permission-mode-change`
- `fast-mode-change`
- `compact-boundary`
- `context_compacted`
- `model-rerouted`

### `unknown_message`

用于 adapter 暂未识别的原始 provider 消息。

要求：

- 保留原始消息
- 明确上抛
- 不能吞掉

## Provider 翻译要点

### Claude -> CCGUI

Claude 原始流更接近消息流：

- `stream_event.message_start` -> `message-start`
- `stream_event.content_block_delta` -> `message-delta`
- `stream_event.message_delta` -> `message-update`
- `stream_event.message_stop` -> `message-complete`
- `result` -> `result`
- `system` -> `env-info` / `system-notification` / `task-event` / `unknown_message`

适配重点：

- Claude 原始 usage 可能挂在消息和 result 上
- adapter 负责把片段 usage 和整次请求 usage 分开表达

### Codex -> CCGUI

Codex 原始流更接近 item/thread 通知流：

- `turn/started` -> 初始化 turn 聚合状态
- `item/agentMessage/*` -> `assistant` 片段
- `item/reasoning/*` -> `thinking` 增量
- `item/*Tool*` / `commandExecution` / `fileChange` -> `tool_use` 片段
- `thread/tokenUsage/updated` -> `message-update(usage)` + `env-info(session_usage)` + turn usage 聚合
- `turn/completed` -> `result`

适配重点：

- 原始 usage 是分散的，必须在 adapter 内聚合
- `num_turns` 不以 provider 原始 turn 数为准，而以 assistant 片段数为准

## 统一设计原则

- 不要求 CCGUI 语义长得像 Claude 或 Codex 任意一边
- 哪种抽象更利于两个 adapter 实现，就采用哪种
- `session-instance.js` 只消费统一语义，不再理解 provider 原始协议
