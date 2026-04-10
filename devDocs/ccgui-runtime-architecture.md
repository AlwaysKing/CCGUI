# CCGUI Runtime Architecture

这份文档描述当前 CCGUI 已落地的运行时架构，只描述现在真实生效的设计。

## 分层

### 1. Provider Client

文件：

- `electron/adapters/claude/client.js`
- `electron/adapters/codex/client.js`
- `electron/adapters/shared/usage.js`

职责：

- 启动外部运行时进程
- 处理 stdin/stdout/stderr
- 处理原始协议请求与响应
- 不直接向上暴露原始 provider 语义

说明：

- `client` 只是 adapter 的底层 transport 实现
- 它不是额外的语义层
- `shared/usage.js` 只放运行时代码 helper，不承载语义文档

### 2. Provider Adapter

文件：

- `electron/adapters/claude/adapter.js`
- `electron/adapters/codex/adapter.js`

职责：

- 将 Claude / Codex 原始协议翻译成统一的 CCGUI 语义
- 输出统一事件：
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

额外职责：

- 聚合 usage
- 统一 numTurns
- 补齐 control-response
- 保留 unknown_message 作为协议变化告警出口

### 3. Session Runtime

文件：

- `electron/session/session-instance.js`

职责：

- 表示一个会话实例
- 持有消息列表、envInfo、pending control 状态、history 状态
- 只消费 adapter 产出的统一 CCGUI 事件
- 不再解析 Claude/Codex 原始协议

关键点：

- `session-instance.js` 不再持有 provider-specific 事件接线
- 只有一套 `setupRuntimeHandlers()`
- 只在“选择实例化哪个 adapter”时区分 provider

### 4. Session Manager

文件：

- `electron/session/session-manager.js`

职责：

- 管理多个 `SessionInstance`
- 提供创建、获取、关闭、停止运行时等能力

### 5. Store / UI

文件：

- `src/stores/useSessionStore.js`
- `src/views/workspace/chat/...`

职责：

- 只消费 `session-event` 通道里的统一 CCGUI 事件
- 不再处理 provider 原始事件

## 当前统一原则

### usage

- 用户消息上的 `usage` 表示一次用户请求的累计 usage
- assistant/tool 片段上的 `usage` 表示片段自身 usage
- Claude 和 Codex 都在 adapter 内部完成翻译

### numTurns

- `numTurns` 表示 CCGUI 展示语义中的 assistant 片段轮次数
- 不直接等同 provider 原始 turn/step

### envInfo

当前统一字段以 `providerPid` 为准，不再使用 `claudePid`。

常见字段：

- `provider`
- `providerPid`
- `session_id`
- `cwd`
- `model`
- `status`
- `session_usage`
- `rate_limits`

### unknown_message

- 所有 adapter 无法识别的原始消息都必须进入 `unknown_message`
- 不允许静默吞掉

## 当前公开接口命名

IPC / preload 对外命名已统一为 runtime 中性语义，例如：

- `getRuntimeInfo`
- `isRuntimeReady`
- `stopSessionRuntime`
- `sendRuntimeToolResult`
- `getRuntimeInitInfo`

## 不再存在的旧结构

以下结构已经移除，不应重新引入：

- `claude-manager.js`
- `codex-manager.js`
- `provider-normalizers.js`
- `claudePid`
- `stream-event` / `tool-use` / `tool-result` 上层兼容入口

## 修改原则

以后如果接入新的 provider，必须遵守：

1. 原始协议翻译必须在 adapter 内完成
2. `session-instance.js` 之后不允许再理解 provider 原始语义
3. 新协议无法映射的部分必须进入 `unknown_message`
4. 如果出现同名不同义，优先调整 CCGUI 语义设计，再更新 adapter，不要把补丁堆到 store/UI
