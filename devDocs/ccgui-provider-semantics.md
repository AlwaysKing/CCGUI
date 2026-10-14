# CCGUI Provider Semantics

这份文档描述的是 `ClaudeAdapter` / `CodexAdapter` 在翻译原始协议时必须收敛到的 `CCGUI` 统一语义。

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
- `turn/completed` -> `result`（仅会话主线程；子代理线程跑在自己的 threadId 上，它的 `turn/completed` 只代表该子代理结束）

适配重点：

- 原始 usage 是分散的，必须在 adapter 内聚合
- `num_turns` 不以 provider 原始 turn 数为准，而以 assistant 片段数为准
- 一个用户回合可能横跨主线程和多个子代理线程：只有主线程的 `turn/completed` 才能收尾用户这一轮（`result` / 回合统计 / 文件变更汇总）

## 统一设计原则

- 不要求 CCGUI 语义长得像 Claude 或 Codex 任意一边
- 哪种抽象更利于两个 adapter 实现，就采用哪种
- `session-instance.js` 只消费统一语义，不再理解 provider 原始协议

## 模型路由名与展示名（CCGUI 原语）

接入本地代理后，模型标识分成两个概念，**任何一层都不允许混用**：

| 名称 | 形式 | 出现位置 |
| --- | --- | --- |
| 路由名 | `<供应商ID>/<模型名>`（如 `1778420523330/deepseek-flash`） | provider 进程启动参数、代理内部路由、`session-instance` 与 adapter 之间 |
| 展示名 | 真实模型名（如 `deepseek-flash`） | `env-info.model`、系统通知、会话列表、所有 UI |

约束：

- 路由名只用于"让代理知道该转发给哪个供应商的哪张卡片"，不进入 UI
- adapter 在写 `env-info` / 通知前必须用 `stripProxyProviderPrefix()` 还原展示名
- 构造路由名统一用 `buildRuntimeModelName()`（`adapters/shared/model-config.js`），不要在业务层手写字符串拼接
- 代理解析不到卡片时：别名（`sonnet`/`opus`/`haiku`/`claude-*`）用当前会话卡片；明确点名但不属于当前供应商的模型**原样透传**，不静默替换

## 思考等级（effort）的语义

- effort 取值是**不透明字符串**：由 provider 返回（codex 为 `none/low/high/xhigh` 等，claude 为 `low/medium/high`），CCGUI 只透传、不解释、不映射
- 取值来源：
  - codex：`model/list`（provider API）
  - claude：CLI 的模型能力（provider API）
- 切换时传给 provider 的字段名由 adapter 决定（codex 的 `thread/settings/update` 用 `effort`）
- provider 诊断面板（provider-inspector）展示的模型 / 供应商 / 代理状态同样来自 CCGUI 自身配置，不再从 claude / codex 原始配置文件推断（那些文件只用于 hooks / 插件诊断）

## 运行时选择统一入口

模型 / 供应商 / 思考等级的切换统一走适配器方法：

```js
runtimeManager.applyRuntimeSelection({
  changeType: 'model' | 'submodel' | 'effort',
  settings,        // 已解析的运行时设置（modelId / modelCardId / credentialId / effort）
  modelOverride,   // 可选：界面显式指定的模型卡片名
  effort,          // 可选：思考等级
  silent           // 可选：是否静默（不弹系统通知）
})
```

返回：

```js
{ appliedLive: true, model, modelString, reasoningEffort, applyMode }   // 已热切换
{ appliedLive: false, reason: 'effort-requires-restart' | ... }         // 需要上层重启
```

各 provider 的实现：

| provider | 模型切换 | 思考等级 |
| --- | --- | --- |
| claude | `set_model` 控制请求（CCGUI 侧原语 `set_session_submodel`） | CLI 的 `/effort <level>` 斜杠命令（静默执行，仅当前会话生效），可热切 |
| codex | `thread/settings/update`（老版本回退 `thread/resume`） | `thread/settings/update` 的 `effort` 字段，可热切 |

约束：

- `session-instance.js` 只调这**一个**入口，不判断 provider 能力（谁能热切由 adapter 回答）
- adapter 负责构造路由名、调用 provider 协议、并把 provider 回传的设置刷新回 `env-info`
- claude 没有切换思考等级的控制请求（实测 `set_effort` / `set_effort_level` 均返回 Unsupported），只能用 `/effort`：adapter 以「静默命令」发送，命令期间产生的 assistant / stream / result 都不进入对话时间线
- `appliedLive: false` 表示该 provider 无法热切换（或运行时未就绪），由上层重启应用
