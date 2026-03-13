# Claude Code 通信协议完整文档

**文档版本**: 2.0
**最后更新**: 2026-03-13
**适用版本**: Claude Code 2.1.71+

---

## 目录

1. [概述](#概述)
2. [集成模式](#集成模式)
3. [CLI 输出模式](#cli-输出模式)
4. [双向通信模式](#双向通信模式)
5. [消息类型详解](#消息类型详解)
6. [内容块类型](#内容块类型)
7. [权限系统](#权限系统)
8. [MCP 配置](#mcp-配置)
9. [错误处理](#错误处理)
10. [实现示例](#实现示例)

---

## 概述

Claude Code 支持两种集成方式，适用于不同的使用场景：

| 模式 | 通信方向 | 使用场景 | 复杂度 |
|------|----------|----------|--------|
| CLI 输出模式 | 单向（Claude → 调用方） | 简单命令执行、脚本集成 | 低 |
| 双向通信模式 | 双向（stdin/stdout） | GUI 应用、实时交互、权限控制 | 高 |

### 传输层

- **编码**: UTF-8
- **格式**: NDJSON (Newline Delimited JSON)
- **分隔符**: `\n` (换行符)

---

## 集成模式

### CLI 输出模式

使用 CLI 参数直接调用，获取流式或结构化输出：

```bash
claude -p "your prompt" --output-format stream-json --verbose --print
```

### 双向通信模式

作为子进程启动，通过 stdin/stdout 进行双向通信：

```javascript
const claude = spawn('claude', [
  '--output-format', 'stream-json',
  '--input-format', 'stream-json',
  '--verbose'
], {
  stdio: ['pipe', 'pipe', 'inherit']
});
```

---

## CLI 输出模式

### CLI 参数

#### 核心参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `-p` | string | 输入提示词 |
| `--output-format` | text/json/stream-json | 输出格式 |
| `--print` | flag | 启用打印模式（stream-json 必需） |
| `--verbose` | flag | 详细输出（stream-json 必需） |
| `--model` | string | 模型名称或别名 (sonnet/opus/haiku) |

#### 会话相关参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `--session-id` | string | 会话 UUID |
| `--resume` | string | 恢复指定会话 ID |
| `--continue` | flag | 继续最近的对话 |
| `--fork-session` | flag | 恢复时创建新会话 ID |
| `--no-session-persistence` | flag | 禁用会话持久化 |

#### MCP 相关参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `--mcp-config` | string[] | MCP 配置文件路径或 JSON 字符串 |
| `--strict-mcp-config` | flag | 仅使用指定的 MCP 配置 |
| `--add-dir` | string[] | 添加额外目录到上下文 |

#### 权限相关参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `--permission-mode` | string | 权限模式 |
| `--allowedTools` | string | 允许的工具列表（逗号分隔） |
| `--disallowedTools` | string | 禁用的工具列表（逗号分隔） |

### 消息流格式

```
<system/init message>
<assistant message 1>
[<assistant message 2>]
[...]
[<user message>]
<result message>
```

### 基础消息结构

```typescript
interface Message {
  type: string              // 消息类型
  subtype?: string          // 子类型
  message?: object          // 原始消息内容
  session_id: string        // 会话 ID

  // Result 消息特有字段
  total_cost_usd?: number
  duration_ms?: number
  duration_api_ms?: number
  is_error?: boolean
  num_turns?: number
  result?: string
  tools?: string[]
  mcp_servers?: MCPServer[]
}
```

---

## 双向通信模式

### 控制消息 (Control Messages)

#### control_request (控制请求)

父进程向 Claude 进程发送的请求消息。

```json
{
  "type": "control_request",
  "request_id": "abc123xyz",
  "request": {
    "subtype": "subtype_name",
    // 子类型特定字段
  }
}
```

**request_id 格式**: `Math.random().toString(36).substring(2, 15)`

#### 请求子类型

##### initialize (初始化)

```json
{
  "type": "control_request",
  "request_id": "abc123",
  "request": {
    "subtype": "initialize",
    "hooks": {},
    "sdkMcpServers": [],
    "jsonSchema": null,
    "systemPrompt": null,
    "appendSystemPrompt": null,
    "agents": {},
    "promptSuggestions": {}
  }
}
```

##### set_model (设置模型)

```json
{
  "type": "control_request",
  "request_id": "xyz789",
  "request": {
    "subtype": "set_model",
    "model": "claude-sonnet-4-6"
  }
}
```

##### set_permission_mode (设置权限模式)

```json
{
  "type": "control_request",
  "request_id": "perm123",
  "request": {
    "subtype": "set_permission_mode",
    "mode": "acceptEdits"
  }
}
```

**权限模式值**:
- `"default"`: 默认模式，每次工具使用都需要确认
- `"acceptEdits"`: 自动接受编辑操作
- `"plan"`: 计划模式
- `"bypassPermissions"`: 跳过所有权限检查

##### interrupt (中断)

```json
{
  "type": "control_request",
  "request_id": "int123",
  "request": {
    "subtype": "interrupt"
  }
}
```

##### rewind_files (回滚文件)

```json
{
  "type": "control_request",
  "request_id": "rewind123",
  "request": {
    "subtype": "rewind_files",
    "user_message_id": "msg_123",
    "dry_run": false
  }
}
```

**响应**:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "rewind123",
    "response": {
      "restored_files": ["/path/to/file1.js", "/path/to/file2.ts"],
      "dry_run": false
    }
  }
}
```

##### fork_session (创建会话分支)

```json
{
  "type": "control_request",
  "request_id": "fork123",
  "request": {
    "subtype": "fork_session",
    "message_id": "msg_123"
  }
}
```

**响应**:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "fork123",
    "response": {
      "session_id": "new-session-uuid-456",
      "message": "会话分支创建成功"
    }
  }
}
```

##### rewind_and_fork (回滚并创建分支)

```json
{
  "type": "control_request",
  "request_id": "rewindfork123",
  "request": {
    "subtype": "rewind_and_fork",
    "user_message_id": "msg_123",
    "dry_run": false
  }
}
```

#### control_response (控制响应)

**成功响应**:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "abc123",
    "response": {
      // 响应数据
    }
  }
}
```

**错误响应**:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "error",
    "request_id": "abc123",
    "error": "错误消息"
  }
}
```

### 反向控制消息 (Reverse Control)

Claude 进程向父进程发送的请求，用于权限处理和回调。

#### can_use_tool (工具使用权限请求)

```json
{
  "type": "control_request",
  "request_id": "tool123",
  "request": {
    "subtype": "can_use_tool",
    "tool_name": "Bash",
    "input": {
      "command": "ls -la"
    },
    "tool_use_id": "tooluse_123",
    "agent_id": "agent_456",
    "permission_suggestions": ["suggestion1"],
    "blocked_path": "/path/to/blocked",
    "decision_reason": "reason"
  }
}
```

**父进程响应**:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "tool123",
    "response": {
      "behavior": "allow",
      "reason": "用户批准",
      "toolUseID": "tooluse_123",
      "updatedInput": {},
      "updatedPermissions": [
        {
          "type": "addRules",
          "rules": [
            {
              "toolName": "Read",
              "ruleContent": "//path/to/file/**"
            }
          ],
          "behavior": "allow",
          "destination": "session"
        }
      ]
    }
  }
}
```

#### hook_callback (钩子回调)

```json
{
  "type": "control_request",
  "request_id": "hook123",
  "request": {
    "subtype": "hook_callback",
    "callback_id": "hook_0",
    "input": {},
    "tool_use_id": "tooluse_123"
  }
}
```

#### mcp_message (MCP 消息)

```json
{
  "type": "control_request",
  "request_id": "mcp123",
  "request": {
    "subtype": "mcp_message",
    "server_name": "xcode-tools",
    "message": {
      "jsonrpc": "2.0",
      "method": "tools/call",
      "params": {},
      "id": 1
    }
  }
}
```

#### elicitation (诱导请求)

```json
{
  "type": "control_request",
  "request_id": "elic123",
  "request": {
    "subtype": "elicitation",
    "mcp_server_name": "server_name",
    "message": "消息内容",
    "mode": "mode",
    "url": "https://example.com",
    "elicitation_id": "elic_123",
    "requested_schema": {}
  }
}
```

**父进程响应**:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "elic123",
    "response": {
      "action": "accept"
    }
  }
}
```

### 流式事件 (Stream Events)

单向消息，从 Claude 进程流向父进程。

#### message_start (消息开始)

```json
{
  "type": "stream_event",
  "event": {
    "type": "message_start",
    "message": {
      "id": "msg_20260308130013b0334363c7af46f2",
      "type": "message",
      "role": "assistant",
      "model": "claude-sonnet-4-6",
      "content": [],
      "stop_reason": null,
      "stop_sequence": null,
      "usage": {
        "input_tokens": 0,
        "output_tokens": 0
      }
    }
  },
  "session_id": "session-uuid",
  "parent_tool_use_id": null,
  "uuid": "message-uuid"
}
```

#### content_block_start (内容块开始)

```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_start",
    "index": 0,
    "content_block": {
      "type": "thinking",
      "thinking": "",
      "signature": "b05a8310cdce4efe9d7e84f7"
    }
  },
  "session_id": "session-uuid",
  "parent_tool_use_id": null,
  "uuid": "block-uuid"
}
```

#### content_block_delta (内容块增量)

```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_delta",
    "index": 0,
    "delta": {
      "type": "thinking_delta",
      "thinking": "用户要求"
    }
  },
  "session_id": "session-uuid",
  "parent_tool_use_id": null,
  "uuid": "delta-uuid"
}
```

**delta 类型**:
- `thinking_delta`: 思考过程的增量更新
- `text_delta`: 文本内容的增量更新
- `input_json_delta`: 工具输入的 JSON 增量

#### content_block_stop (内容块结束)

```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_stop",
    "index": 0
  },
  "session_id": "session-uuid",
  "parent_tool_use_id": null,
  "uuid": "stop-uuid"
}
```

#### message_stop (消息结束)

```json
{
  "type": "stream_event",
  "event": {
    "type": "message_stop",
    "message": {
      "id": "msg_20260308130013b0334363c7af46f2",
      "type": "message",
      "role": "assistant",
      "model": "claude-sonnet-4-6",
      "content": [
        {
          "type": "thinking",
          "thinking": "完整的思考内容...",
          "signature": "..."
        },
        {
          "type": "text",
          "text": "完整的回复文本..."
        }
      ],
      "stop_reason": "end_turn",
      "stop_sequence": null,
      "usage": {
        "input_tokens": 9352,
        "output_tokens": 260
      }
    }
  },
  "session_id": "session-uuid",
  "parent_tool_use_id": null,
  "uuid": "stop-uuid"
}
```

### 其他流式消息

#### assistant (助手完整消息)

非流式情况下的完整助手消息。

```json
{
  "type": "assistant",
  "message": {
    "id": "msg_20260308130013b0334363c7af46f2",
    "type": "message",
    "role": "assistant",
    "model": "claude-sonnet-4-6",
    "content": [
      {
        "type": "thinking",
        "thinking": "思考内容...",
        "signature": "..."
      },
      {
        "type": "text",
        "text": "回复文本..."
      }
    ],
    "stop_reason": "end_turn",
    "stop_sequence": null,
    "usage": {
      "input_tokens": 9352,
      "output_tokens": 260
    }
  },
  "parent_tool_use_id": null,
  "session_id": "session-uuid",
  "uuid": "message-uuid"
}
```

#### keep_alive (保活消息)

```json
{
  "type": "keep_alive"
}
```

#### summary (会话摘要)

```json
{
  "type": "summary",
  "summary": "会话摘要内容"
}
```

#### custom-title (自定义标题)

```json
{
  "type": "custom-title",
  "title": "会话标题"
}
```

---

## 消息类型详解

### 1. System 消息 (type: "system")

会话初始化时发送，提供会话配置信息。

```json
{
  "type": "system",
  "subtype": "init",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "apiKeySource": "anthropic_api_key",
  "cwd": "/Users/example/project",
  "tools": ["Bash", "Edit", "Read", "Write", "Glob", "Grep"],
  "mcp_servers": [
    {"name": "filesystem", "status": "connected"},
    {"name": "github", "status": "connected"}
  ],
  "model": "claude-sonnet-4-6",
  "permissionMode": "default",
  "slash_commands": ["debug", "simplify", "batch"],
  "agents": ["general-purpose", "Explore", "Plan"],
  "skills": ["debug", "simplify"],
  "claude_code_version": "2.1.70",
  "fast_mode_state": "off"
}
```

**字段说明**:

| 字段 | 类型 | 描述 |
|------|------|------|
| `cwd` | string | 当前工作目录 |
| `session_id` | string | 会话 ID |
| `tools` | string[] | 可用工具列表 |
| `mcp_servers` | object[] | MCP 服务器状态 |
| `model` | string | 使用的模型 |
| `permissionMode` | string | 权限模式 |
| `slash_commands` | string[] | 可用斜杠命令 |
| `agents` | string[] | 可用代理类型 |
| `skills` | string[] | 可用技能 |

### 2. Assistant 消息 (type: "assistant")

Claude 的响应内容。

```json
{
  "type": "assistant",
  "message": {
    "id": "msg_01ABC123",
    "type": "message",
    "role": "assistant",
    "content": [
      {
        "type": "text",
        "text": "Hello! I can help you with coding tasks."
      },
      {
        "type": "tool_use",
        "id": "toolu_01XYZ",
        "name": "Read",
        "input": {
          "file_path": "/src/main.go"
        }
      }
    ],
    "model": "claude-sonnet-4-6",
    "stop_reason": "end_turn",
    "usage": {
      "input_tokens": 100,
      "output_tokens": 50
    }
  },
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "result": "Hello! I can help you with coding tasks."
}
```

### 3. User 消息 (type: "user")

用户消息回显，通常包含工具调用结果。

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      {
        "type": "tool_result",
        "tool_use_id": "toolu_01XYZ",
        "content": "package main\n\nfunc main() {...}"
      }
    ]
  },
  "session_id": "550e8400-e29b-41d4-a716-446655440000"
}
```

### 4. Result 消息 (type: "result")

最终结果消息，包含完整的响应和统计信息。

#### 成功结果

```json
{
  "type": "result",
  "subtype": "success",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "result": "Complete response text here...",
  "total_cost_usd": 0.002,
  "duration_ms": 2000,
  "duration_api_ms": 1800,
  "is_error": false,
  "num_turns": 1,
  "stop_reason": "end_turn",
  "usage": {
    "input_tokens": 9352,
    "cache_read_input_tokens": 13696,
    "cache_creation_input_tokens": 0,
    "output_tokens": 260
  },
  "modelUsage": {
    "claude-sonnet-4-6": {
      "inputTokens": 9352,
      "outputTokens": 260,
      "cacheReadInputTokens": 13696,
      "costUSD": 0.060107
    }
  }
}
```

#### 错误结果

```json
{
  "type": "result",
  "subtype": "error_max_turns",
  "session_id": "550e8400-e29b-41d4-a716-446655440000",
  "total_cost_usd": 0.005,
  "duration_ms": 5000,
  "duration_api_ms": 4500,
  "is_error": true,
  "num_turns": 10
}
```

**子类型值**:

| 值 | 描述 |
|------|------|
| `success` | 成功完成 |
| `error_max_turns` | 超过最大轮次限制 |
| `error_during_execution` | 执行期间发生错误 |

---

## 内容块类型

### 1. Text Block

```json
{
  "type": "text",
  "text": "This is the text content"
}
```

### 2. Thinking Block

```json
{
  "type": "thinking",
  "thinking": "Thinking content...",
  "signature": "b05a8310cdce4efe9d7e84f7"
}
```

### 3. Tool Use Block

```json
{
  "type": "tool_use",
  "id": "toolu_01ABC123",
  "name": "Bash",
  "input": {
    "command": "git status"
  }
}
```

### 4. Tool Result Block

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_01ABC123",
  "content": "On branch main\nYour branch is up to date.",
  "is_error": false
}
```

---

## 权限系统

### 权限模式

| 值 | 描述 |
|------|------|
| `default` | 标准权限检查 |
| `acceptEdits` | 自动批准文件编辑操作 |
| `bypassPermissions` | 跳过所有权限检查（谨慎使用） |
| `plan` | 计划模式（只读，不修改） |
| `dontAsk` | 不询问权限，自动进行 |

### 权限行为

```typescript
type PermissionBehavior = "allow" | "deny" | "ask"
```

### 工具权限格式

**简单格式**：
```
Bash
Write
mcp__filesystem__read_file
```

**增强格式**（带约束）：
```
Bash(git log)
Bash(git log:*)
Write(src/**)
Bash(npm install:package.json)
```

---

## MCP 配置

### MCP 服务器类型

| 类型 | 描述 |
|------|------|
| `stdio` | 标准输入输出 |
| `http` | HTTP 服务器 |
| `sse` | Server-Sent Events |

### MCP 配置结构

```json
{
  "mcpServers": {
    "filesystem": {
      "command": "mcp-filesystem",
      "args": ["--root", "/project"],
      "type": "stdio",
      "env": {
        "DEBUG": "1"
      }
    },
    "github": {
      "url": "https://mcp.github.com/sse",
      "type": "sse"
    }
  }
}
```

### MCP 工具命名规范

MCP 工具名称遵循模式：`mcp__<serverName>__<toolName>`

示例：
- `mcp__filesystem__read_file`
- `mcp__github__create_issue`

---

## 错误处理

### 错误类型

| 错误类型 | 识别关键词 |
|---------|-----------|
| Authentication | "authentication", "api key", "unauthorized", "401", "403" |
| RateLimit | "rate limit", "too many requests", "429", "quota exceeded" |
| Permission | "permission denied", "not allowed", "tool not permitted" |
| Network | "network", "connection", "timeout", "dns", "unreachable" |
| MCP | "mcp", "model context protocol", "mcp server" |
| Timeout | "timeout", "timed out", "deadline exceeded" |
| Session | "session", "session not found", "invalid session" |
| Validation | "invalid", "validation", "malformed", "bad request", "400" |

### 可重试错误

以下错误类型通常是可重试的：
- RateLimit
- Network
- Timeout
- MCP（连接问题）

---

## 实现示例

### Node.js 双向通信客户端

```javascript
const { spawn } = require('child_process');
const readline = require('readline');

// 启动 Claude 进程
const claude = spawn('claude', [
  '--output-format', 'stream-json',
  '--input-format', 'stream-json',
  '--verbose'
], {
  stdio: ['pipe', 'pipe', 'inherit']
});

// 发送控制请求
function sendRequest(subtype, data) {
  const requestId = Math.random().toString(36).substring(2, 15);
  const request = {
    type: 'control_request',
    request_id: requestId,
    request: { subtype, ...data }
  };
  claude.stdin.write(JSON.stringify(request) + '\n');
  return requestId;
}

// 处理响应
const rl = readline.createInterface({ input: claude.stdout });

rl.on('line', (line) => {
  const message = JSON.parse(line);

  switch (message.type) {
    case 'control_request':
      handleControlRequest(message);
      break;
    case 'stream_event':
      handleStreamEvent(message);
      break;
    case 'result':
      console.log('Result:', message.result);
      break;
  }
});

// 处理反向控制请求
function handleControlRequest(message) {
  const { request, request_id } = message;

  if (request.subtype === 'can_use_tool') {
    const decision = askUser(request);

    const response = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id,
        response: {
          behavior: decision ? 'allow' : 'deny',
          toolUseID: request.tool_use_id
        }
      }
    };

    claude.stdin.write(JSON.stringify(response) + '\n');
  }
}

// 初始化
sendRequest('initialize', {
  hooks: {},
  jsonSchema: null,
  systemPrompt: null
});
```

### CLI 输出模式示例

```bash
# 基本流式输出
claude -p "Explain Go interfaces" \
  --output-format stream-json \
  --verbose \
  --print

# 带会话恢复
claude -p "Continue from previous" \
  --output-format stream-json \
  --verbose \
  --print \
  --resume 550e8400-e29b-41d4-a716-446655440000

# 带 MCP 配置
claude -p "List files" \
  --output-format stream-json \
  --verbose \
  --print \
  --mcp-config mcp-config.json \
  --allowedTools "Read,mcp__filesystem__*"
```

### NDJSON 响应示例

```jsonl
{"type":"system","subtype":"init","session_id":"550e8400-e29b-41d4-a716-446655440000","tools":["Bash","Edit","Read","Write"],"model":"claude-sonnet-4-6"}
{"type":"assistant","message":{"id":"msg_01","type":"message","role":"assistant","content":[{"type":"text","text":"I'll help you with that."}]},"session_id":"550e8400-e29b-41d4-a716-446655440000","result":"I'll help you with that."}
{"type":"result","subtype":"success","total_cost_usd":0.002,"duration_ms":2000,"is_error":false,"num_turns":1,"result":"I'll help you with that.","session_id":"550e8400-e29b-41d4-a716-446655440000"}
```

---

## 通信流程

### 初始化流程

```
父进程                         Claude 进程
  |                               |
  |--- control_request ---------->|  (initialize)
  |                               |
  |<-- control_response ----------|  (success)
  |                               |
  |<-- system (init) -------------|
  |                               |
```

### 查询执行流程

```
父进程                         Claude 进程
  |                               |
  |--- control_request ---------->|  (query)
  |                               |
  |<-- stream_event --------------|  (message_start)
  |<-- stream_event --------------|  (content_block_start)
  |<-- stream_event --------------|  (content_block_delta) x N
  |<-- stream_event --------------|  (content_block_stop)
  |<-- stream_event --------------|  (message_stop)
  |                               |
  |<-- result --------------------|
  |                               |
```

### 权限处理流程

```
父进程                         Claude 进程
  |                               |
  |<-- control_request ----------|  (can_use_tool)
  |                               |
  |--- control_response --------->|  (allow/deny)
  |                               |
```

---

## 调试

### 启用调试日志

```bash
claude --output-format stream-json --input-format stream-json --verbose --debug
```

### 环境变量

```bash
export DEBUG_CLAUDE_AGENT_SDK=1
export CLAUDE_CODE_DEBUG_LOG_LEVEL=debug
export CLAUDE_CODE_DEBUG_LOGS_DIR=/path/to/logs
```

---

## 参考资料

- [Claude Code CLI](https://claude.ai/code)
- [Claude Code Go SDK](https://github.com/anthropics/claude-code-go)
- [Claude Code Elixir SDK](https://hexdocs.pm/claude_code/)
- [Anthropic API Documentation](https://docs.anthropic.com/)
- [MCP 协议规范](https://modelcontextprotocol.io)

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 2.0 | 2026-03-13 | 合并 sdk.md 和 stream-api.md |
| 1.0 | 2026-03-08 | 初始版本 |

---

*本文档由 Claude 自动生成并整理，如有问题请参考官方文档。*
