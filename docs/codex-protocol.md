# Codex app-server 协议与 CCGUI 接入方案

**文档版本**: 1.0  
**最后更新**: 2026-03-22

## 1. 协议定位

Codex 的 GUI/扩展接入核心不是交互 TUI，而是 `app-server`。

本机导出的协议证据来自：

- `codex app-server generate-ts --out /tmp/codex-app-protocol`
- `codex app-server generate-json-schema --out /tmp/codex-app-schema`
- `/Users/alwaysking/.vscode/extensions/openai.chatgpt-26.313.41514-darwin-arm64/out/extension.js`

结论：

- 传输层是 `stdio://` 或 `ws://`
- 编码是 UTF-8
- 报文边界是按行分隔的 JSON
- 协议模型是“轻量 JSON-RPC”，不是 Claude 的 `stream-json`
- 会话模型是 `thread -> turn -> item`

## 2. 基础报文格式

协议不是标准 JSON-RPC 2.0 全量形态，因为没有强制 `jsonrpc: "2.0"` 字段。

### Request

```json
{
  "id": "req_1",
  "method": "thread/start",
  "params": {}
}
```

### Notification

```json
{
  "method": "turn/started",
  "params": {}
}
```

### Response

```json
{
  "id": "req_1",
  "result": {}
}
```

### Error

```json
{
  "id": "req_1",
  "error": {
    "code": -32000,
    "message": "..."
  }
}
```

## 3. 握手流程

最小握手链路：

1. client -> `initialize`
2. server -> `InitializeResponse`
3. client -> notification `initialized`
4. client -> `thread/start` 或 `thread/resume`
5. client -> `turn/start`

### `initialize`

请求：

```json
{
  "id": "1",
  "method": "initialize",
  "params": {
    "clientInfo": {
      "name": "ccgui",
      "version": "1.0.0"
    },
    "capabilities": {
      "experimentalApi": true
    }
  }
}
```

响应核心字段：

- `userAgent`
- `platformFamily`
- `platformOs`

## 4. 线程与回合模型

### `thread/start`

创建线程，返回：

- `thread`
- `model`
- `modelProvider`
- `cwd`
- `approvalPolicy`
- `sandbox`
- `reasoningEffort`

### `thread/resume`

用于恢复旧线程。

关键字段：

- `threadId`
- `path`
- `model`
- `modelProvider`
- `cwd`
- `approvalPolicy`
- `sandbox`
- `persistExtendedHistory`

### `turn/start`

真正发起一次对话轮次。

关键字段：

- `threadId`
- `input`
- `approvalPolicy`
- `sandboxPolicy`
- `model`
- `effort`
- `outputSchema`
- `collaborationMode`

### `input`

用户输入不是纯字符串，而是数组，类型包括：

- `text`
- `image`
- `localImage`
- `skill`
- `mention`

文本项形态：

```json
{
  "type": "text",
  "text": "hello",
  "text_elements": []
}
```

### `attachments`

`turn/start` 的文件附件不走 `input`，而是走单独的 `attachments` 字段。

这是当前研究 VS Code Codex 插件后能够确认的关键结论：

- 文本和图片在 `input`
- 普通文件在 `attachments`
- 图片和普通文件不是同一条协议通道

VS Code 插件 webview 发送层的原始源码可确认：

- `input: [{ type: "text", ... }, ...imageAttachments.map(...)]`
- `attachments: uniqWith([...fileAttachments, ...addedFiles], isEqual)`

也就是说：

- `fileAttachments`
- `addedFiles`

会在发送前直接合并、去重，然后原样作为 `attachments` 发给 Codex server。

### 图片输入的最终形态

图片不是 `attachments`，而是 `input` 中的专门输入项，分两种：

1. 内联图片内容

```json
{
  "type": "image",
  "url": "data:image/png;base64,..."
}
```

2. 本地图片引用

```json
{
  "type": "localImage",
  "path": "/absolute/path/to/file.png"
}
```

因此可以得到一条非常重要的接入结论：

- 图片协议类型是 `image` / `localImage`
- 文件协议类型不是 `input` item，而是 `attachments`

### 文件附件对象的已确认字段

从 VS Code 插件命令层和 webview 状态层可以确认，文件附件对象至少包含：

- `label`
- `path`
- `fsPath`
- `startLine`（可选）
- `endLine`（可选）

典型结构：

```json
{
  "label": "foo.ts",
  "path": "/abs/path/foo.ts",
  "fsPath": "/abs/path/foo.ts",
  "startLine": 120,
  "endLine": 180
}
```

这说明 Codex 的“添加文件到线程”本质上更接近：

- 文件引用 / 文件上下文描述

而不是：

- 发送时立刻把整个文件正文塞进 user text
- 或统一转成图片那样的 `input` 项

### 当前对 CCGUI 的直接启示

如果要对齐 Codex 的附件语义，CCGUI 后续应按下面的规则建模：

- 文本输入：`input`
- 图片输入：`input.image` / `input.localImage`
- 文件附件：`attachments`

不要把这三类全部退化成单纯的文本路径拼接。

## 5. 服务端通知

最重要的通知族如下。

### 线程/回合级

- `thread/started`
- `thread/status/changed`
- `turn/started`
- `turn/completed`

### item 生命周期

- `item/started`
- `item/completed`

### 增量流

- `item/agentMessage/delta`
- `item/reasoning/textDelta`
- `item/reasoning/summaryTextDelta`
- `item/plan/delta`
- `item/commandExecution/outputDelta`
- `item/fileChange/outputDelta`

### 其他

- `rawResponseItem/completed`
- `serverRequest/resolved`
- `thread/tokenUsage/updated`
- `thread/compacted`
- `model/rerouted`

## 6. item 类型

从 `ThreadItem` 类型导出可以确认，Codex 不把所有东西都视作“assistant text”。

核心 item 类型包括：

- `userMessage`
- `agentMessage`
- `reasoning`
- `plan`
- `commandExecution`
- `fileChange`
- `mcpToolCall`
- `dynamicToolCall`
- `collabAgentToolCall`
- `webSearch`
- `imageView`
- `imageGeneration`
- `contextCompaction`

这也是 Codex 和 Claude 最大的结构差异之一：

- Claude 更接近“单条 assistant message + 内嵌 tool_use block”
- Codex 更接近“一个 turn 下挂多种 item”

## 7. 审批与用户交互

Codex 的审批不是 Claude 的 `control_request/control_response`，而是服务器主动发 request 给客户端。

### 服务端请求方法

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/permissions/requestApproval`
- `item/tool/requestUserInput`
- `item/tool/call`
- `mcpServer/elicitation/request`
- `applyPatchApproval`
- `execCommandApproval`

### 对应回包

- `CommandExecutionRequestApprovalResponse`
- `FileChangeRequestApprovalResponse`
- `PermissionsRequestApprovalResponse`
- `ToolRequestUserInputResponse`
- `ApplyPatchApprovalResponse`
- `ExecCommandApprovalResponse`

### 决策值

命令审批常见值：

- `accept`
- `acceptForSession`
- `decline`
- `cancel`

补丁审批旧形态常见值：

- `approved`
- `approved_for_session`
- `denied`
- `abort`

### request_user_input

`ToolRequestUserInputParams` 里每个问题包含：

- `id`
- `header`
- `question`
- `isOther`
- `isSecret`
- `options`

返回时要按 `question.id` 映射：

```json
{
  "answers": {
    "question_id": {
      "answers": ["value"]
    }
  }
}
```

## 8. 与 Claude 协议的关键差异

| 维度 | Claude | Codex |
|---|---|---|
| 传输语义 | 自定义 stream-json | 行分隔 JSON-RPC |
| 会话模型 | 单会话流式消息 | thread / turn / item |
| 工具调用 | 内容块里的 `tool_use` | 独立 item 与 server request |
| 权限回包 | `control_response` | 对 server request 返回 typed result |
| 历史恢复 | `session-id/resume` | `thread/start/resume/fork/read` |

## 9. CCGUI 当前改造方向

你前面提出的抽象方向是对的，建议架构明确成：

```text
Renderer
  <- SessionStore / internal event model
  <- SessionInstance
  <- ProviderRuntime(ClaudeProvider / CodexProvider / ...)
  <- 外部 CLI / app-server
```

这次研判后，建议 provider 层至少定义这些能力：

- `start()`
- `stop()`
- `isReady()`
- `getPid()`
- `sendMessage()`
- `sendInterrupt()`
- `sendControlResponse()`
- `sendControlRequest()` 可选
- `on(eventType, handler)`

内部统一事件建议保留：

- `message-start`
- `message-delta`
- `message-update`
- `message-complete`
- `result`
- `control-request`
- `env-info`
- `cli-status`
- `unknown-message`
- `exit`

## 10. 接入分阶段计划

### Phase 1: 协议抽象

- 把 `SessionInstance -> ClaudeManager` 的硬绑定改成可插拔 provider
- 保持前端消息模型不变
- Claude 路径不回归

### Phase 2: Codex 最小可用

- `initialize`
- `thread/start`
- `turn/start`
- `turn/interrupt`
- `item/agentMessage/*`
- `item/reasoning/*`
- `item/commandExecution/*`
- `item/fileChange/*`
- 基础审批回包

### Phase 3: 持久化与恢复

- 将 `codexThreadId` 持久化到 session config
- 启动时优先 `thread/resume`
- 支持 `thread/read` 回填 richer history

### Phase 4: 深度能力

- `mcpToolCall`
- `dynamicToolCall`
- `request_user_input`
- `thread/tokenUsage/updated`
- `rawResponseItem/completed`
- 实验性 realtime / audio 流

## 11. 当前可行性判断

可行，而且值得继续。

原因：

1. 协议不是黑盒，Codex 自带了可导出的 schema 与 TS 类型。
2. VS Code 扩展也明确围绕 app-server 工作，而不是直接操纵 TUI。
3. CCGUI 现有前端已经有“统一 session-event 通道”，只要把 provider 层抽出来，就能同时容纳 Claude 与 Codex。

当前最大风险不在协议理解，而在这三点：

1. Codex 运行期对 `~/.codex` 的本地状态写入依赖
2. 审批流细节仍比 Claude 更分裂，存在旧版 `execCommandApproval/applyPatchApproval`
3. 历史恢复和完整 item 回放需要继续吃透 `thread/read` / `thread/resume`
