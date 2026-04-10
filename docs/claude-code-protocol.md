# Claude Code 通信协议完整文档

**文档版本**: 2.3
**最后更新**: 2026-04-09
**适用版本**: Claude Code 2.1.81+

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
  '--verbose',
  '--print',
  '--permission-prompt-tool', 'stdio',
  '--replay-user-messages',
  '--include-partial-messages'
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
| `-p` | string | 输入提示词（非交互模式） |
| `--output-format` | text/json/stream-json | 输出格式（需配合 `--print`） |
| `--print` | flag | 启用非交互/打印模式 |
| `--verbose` | flag | 详细输出（`--print` + `stream-json` 时必需） |
| `--model` | string | 模型名称或别名（如 sonnet/opus/haiku，或完整名如 claude-sonnet-4-6） |
| `--input-format` | stream-json | 输入格式（双向通信模式必需） |
| `--permission-prompt-tool` | string | MCP 工具名，用于权限提示（隐藏参数，仅 `--print` 模式可用） |
| `--replay-user-messages` | flag | 将 stdin 收到的用户消息重发到 stdout（需 `--input-format` + `--output-format` 均为 stream-json） |

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
| `--dangerously-skip-permissions` | flag | 跳过所有权限检查（仅限沙箱环境） |

#### 预算与限制参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `--max-turns` | number | 最大 agentic 轮次（仅 `--print` 模式） |
| `--max-budget-usd` | number | 最大 API 花费上限（仅 `--print` 模式） |
| `--task-budget` | string | API 侧 token 预算（隐藏参数） |

#### 高级参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `--agent` | string | 指定 agent 类型（覆盖 'agent' 设置） |
| `--agents` | string | JSON 对象定义自定义 agent（如 `'{"reviewer": {"description": "...", "prompt": "..."}}'`） |
| `--fallback-model` | string | 模型不可用时的回退模型（仅 `--print` 模式） |
| `--settings` | string | 额外设置文件路径或 JSON 字符串 |
| `--plugin-dir` | string[] | 插件目录（可重复） |
| `--debug` | string? | 调试模式（可选类别过滤，如 `"api,hooks"` 或 `"!1p,!file"`） |
| `--bare` | flag | 最小模式：跳过 hooks、LSP、插件同步、auto-memory 等 |
| `--include-hook-events` | flag | 流式输出包含 hook 事件 |
| `--include-partial-messages` | flag | 流式输出包含部分消息块 |
| `--chrome` / `--no-chrome` | flag | 启用/禁用 Chrome 集成 |
| `--system-prompt` | string | 替换默认系统提示词 |
| `--append-system-prompt` | string | 在默认系统提示词后追加内容 |
| `--effort` | string | 推理力度级别：low / medium / high / max |
| `--setting-sources` | string | 逗号分隔的设置源列表（user,project,local） |
| `--thinking` | string | 思考模式：`enabled` / `adaptive` / `disabled`（其中 `enabled` 等效于 `adaptive`） |
| `--max-thinking-tokens` | number | 最大思考 token 数（已废弃，建议用 `--thinking`；隐藏参数） |
| `--tools` | string | 指定可用工具列表（"" 禁用所有，"default" 使用所有） |
| `--name` | string | 设置会话显示名（显示在 /resume 和终端标题中） |
| `--ide` | flag | 启动时自动连接 IDE |
| `--disable-slash-commands` | flag | 禁用所有 skill |

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
    "promptSuggestions": true,
    "agentProgressSummaries": true
  }
}
```

**请求字段说明**:

| 字段 | 类型 | 描述 |
|------|------|------|
| `hooks` | object | Hook 配置（事件名 → 回调匹配器数组） |
| `sdkMcpServers` | string[] | SDK 管理的 MCP 服务器名称列表 |
| `jsonSchema` | object? | JSON Schema 定义 |
| `systemPrompt` | string? | 自定义系统提示词（替换默认） |
| `appendSystemPrompt` | string? | 追加系统提示词（在默认之后） |
| `agents` | object? | 自定义 agent 定义（名称 → 定义） |
| `promptSuggestions` | boolean? | 是否启用提示建议 |
| `agentProgressSummaries` | boolean? | 是否启用 agent 进度摘要 |

**响应**:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "abc123",
    "response": {
      "commands": [],
      "agents": [],
      "output_style": "default",
      "available_output_styles": ["default", "streamlined"],
      "models": [],
      "account": {},
      "pid": 12345,
      "fast_mode_state": "off"
    }
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
    "mode": "acceptEdits",
    "ultraplan": false
  }
}
```

**权限模式值**:
- `"default"`: 默认模式，每次工具使用都需要确认
- `"acceptEdits"`: 自动接受编辑操作
- `"plan"`: 计划模式
- `"bypassPermissions"`: 跳过所有权限检查
- `"dontAsk"`: 不询问权限，未预批准则拒绝

> `auto` 不是标准权限模式值，详见权限系统章节。

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
      "canRewind": true,
      "filesChanged": ["/path/to/file1.js", "/path/to/file2.ts"],
      "insertions": 0,
      "deletions": 42,
      "error": null
    }
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
    "decision_reason": "reason",
    "title": "Execute command",
    "display_name": "Bash",
    "description": "Run a shell command"
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
    "mode": "form",
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
      "action": "accept",
      "content": {}
    }
  }
}
```

**action 可选值**: `"accept"` | `"decline"` | `"cancel"`

**mode 可选值**: `"form"` | `"url"`（可选字段）

##### set_max_thinking_tokens (设置思考 token 上限)

```json
{
  "type": "control_request",
  "request_id": "think123",
  "request": {
    "subtype": "set_max_thinking_tokens",
    "max_thinking_tokens": 10000
  }
}
```

**max_thinking_tokens**: 设置为 `null` 则清除限制。

##### get_context_usage (查询上下文用量)

```json
{
  "type": "control_request",
  "request_id": "ctx123",
  "request": {
    "subtype": "get_context_usage"
  }
}
```

**响应**:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "ctx123",
    "response": {
      "totalTokens": 45230,
      "maxTokens": 190000,
      "rawMaxTokens": 200000,
      "percentage": 23.8,
      "model": "claude-sonnet-4-6",
      "categories": [
        { "name": "System Prompt", "tokens": 12000, "color": "#4A90D9" },
        { "name": "Messages", "tokens": 25000, "color": "#7BC67E" },
        { "name": "Tools", "tokens": 8230, "color": "#F5A623" }
      ],
      "gridRows": [],
      "memoryFiles": [
        { "path": "MEMORY.md", "type": "memory", "tokens": 450 }
      ],
      "mcpTools": [
        { "name": "read_file", "serverName": "filesystem", "tokens": 320, "isLoaded": true }
      ],
      "deferredBuiltinTools": [
        { "name": "NotebookEdit", "tokens": 800, "isLoaded": false }
      ],
      "systemTools": [
        { "name": "TodoWrite", "tokens": 300 }
      ],
      "systemPromptSections": [
        { "name": "system-reminder", "tokens": 500 }
      ],
      "agents": [
        { "agentType": "Explore", "source": "builtin", "tokens": 1200 }
      ],
      "slashCommands": {
        "totalCommands": 10,
        "includedCommands": 8,
        "tokens": 2000
      },
      "skills": {
        "totalSkills": 5,
        "includedSkills": 3,
        "tokens": 1500,
        "skillFrontmatter": [
          { "name": "commit", "source": "local", "tokens": 300 }
        ]
      },
      "autoCompactThreshold": 170000,
      "isAutoCompactEnabled": true,
      "messageBreakdown": {
        "toolCallTokens": 8000,
        "toolResultTokens": 12000,
        "attachmentTokens": 0,
        "assistantMessageTokens": 5000,
        "userMessageTokens": 3000,
        "toolCallsByType": [
          { "name": "Read", "callTokens": 200, "resultTokens": 5000 }
        ],
        "attachmentsByType": []
      },
      "apiUsage": {
        "input_tokens": 45230,
        "output_tokens": 1200,
        "cache_creation_input_tokens": 0,
        "cache_read_input_tokens": 15000
      }
    }
  }
}
```

##### mcp_status (查询 MCP 状态)

```json
{
  "type": "control_request",
  "request_id": "mcpstatus123",
  "request": {
    "subtype": "mcp_status"
  }
}
```

**响应**:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "mcpstatus123",
    "response": {
      "mcpServers": [
        { "name": "filesystem", "status": "connected" }
      ]
    }
  }
}
```

##### mcp_set_servers (动态设置 MCP 服务器)

```json
{
  "type": "control_request",
  "request_id": "mcpset123",
  "request": {
    "subtype": "mcp_set_servers",
    "servers": {
      "my-server": {
        "command": "node",
        "args": ["server.js"],
        "type": "stdio",
        "env": {}
      }
    }
  }
}
```

**响应**:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "mcpset123",
    "response": {
      "added": ["my-server"],
      "removed": [],
      "errors": {}
    }
  }
}
```

##### mcp_reconnect (重连 MCP 服务器)

```json
{
  "type": "control_request",
  "request_id": "mcprecon123",
  "request": {
    "subtype": "mcp_reconnect",
    "serverName": "filesystem"
  }
}
```

##### mcp_toggle (开关 MCP 服务器)

```json
{
  "type": "control_request",
  "request_id": "mcptoggle123",
  "request": {
    "subtype": "mcp_toggle",
    "serverName": "filesystem",
    "enabled": false
  }
}
```

##### reload_plugins (重新加载插件)

```json
{
  "type": "control_request",
  "request_id": "reload123",
  "request": {
    "subtype": "reload_plugins"
  }
}
```

**响应**:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "reload123",
    "response": {
      "commands": [],
      "agents": [],
      "plugins": [
        { "name": "my-plugin", "path": "/path/to/plugin", "source": "local" }
      ],
      "mcpServers": [],
      "error_count": 0
    }
  }
}
```

##### stop_task (停止任务)

```json
{
  "type": "control_request",
  "request_id": "stoptask123",
  "request": {
    "subtype": "stop_task",
    "task_id": "task_abc123"
  }
}
```

##### cancel_async_message (取消异步消息)

```json
{
  "type": "control_request",
  "request_id": "cancel123",
  "request": {
    "subtype": "cancel_async_message",
    "message_uuid": "msg-uuid-123"
  }
}
```

**响应**:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "cancel123",
    "response": {
      "cancelled": true
    }
  }
}
```

##### seed_read_state (种子读取状态)

```json
{
  "type": "control_request",
  "request_id": "seed123",
  "request": {
    "subtype": "seed_read_state",
    "path": "/path/to/file.ts",
    "mtime": 1710000000
  }
}
```

用于在 Edit 校验时绕过 Read 检查（例如 compact 后 Read 被裁剪但客户端已观测过）。

##### apply_flag_settings (应用标志设置)

```json
{
  "type": "control_request",
  "request_id": "flags123",
  "request": {
    "subtype": "apply_flag_settings",
    "settings": {
      "verbose": true
    }
  }
}
```

##### get_settings (获取设置)

```json
{
  "type": "control_request",
  "request_id": "settings123",
  "request": {
    "subtype": "get_settings"
  }
}
```

**响应**:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "settings123",
    "response": {
      "effective": { "verbose": true, "model": "claude-sonnet-4-6" },
      "sources": [
        { "source": "userSettings", "settings": {} },
        { "source": "projectSettings", "settings": {} },
        { "source": "localSettings", "settings": {} },
        { "source": "flagSettings", "settings": {} },
        { "source": "policySettings", "settings": {} }
      ],
      "applied": {
        "model": "claude-sonnet-4-6",
        "effort": "medium"
      }
    }
  }
}
```

### 取消控制请求 (control_cancel_request)

取消一个当前正在等待响应的反向控制请求（如 can_use_tool）。

```json
{
  "type": "control_cancel_request",
  "request_id": "tool123"
}
```

### 更新环境变量 (update_environment_variables)

运行时更新 Claude 进程的环境变量。

```json
{
  "type": "update_environment_variables",
  "variables": {
    "ANTHROPIC_BASE_URL": "https://new-endpoint.example.com"
  }
}
```

### 用户消息输入 (stdin)

在双向通信模式下，用户提示通过 stdin 以 `type: "user"` 消息发送，**不是** control_request。

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": "帮我重构这个项目"
  },
  "uuid": "optional-msg-uuid",
  "session_id": "optional-session-id",
  "parent_tool_use_id": null,
  "priority": "now"
}
```

**字段说明**:

| 字段 | 类型 | 描述 |
|------|------|------|
| `type` | string | 固定为 `"user"` |
| `message` | object | Anthropic API 格式的用户消息 |
| `uuid` | string? | 消息唯一标识（用于 cancel_async_message） |
| `session_id` | string? | 会话 ID |
| `parent_tool_use_id` | string? | 父工具调用 ID（嵌套 agent 中使用） |
| `priority` | string? | 消息优先级：`"now"` / `"next"` / `"later"` |
| `isSynthetic` | boolean? | 是否为合成消息（非用户直接输入） |
| `timestamp` | string? | ISO 格式时间戳 |

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

#### summary (回合摘要)

实际上是 `type: "system"` 消息的一种 subtype：

```json
{
  "type": "system",
  "subtype": "post_turn_summary",
  "content": "回合摘要内容",
  "session_id": "session-uuid"
}
```

> **注意**：不存在独立的 `type: "summary"` 消息类型。

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
  "plugins": [
    {"name": "my-plugin", "path": "/path/to/plugin", "source": "local"}
  ],
  "output_style": "default",
  "betas": ["interleaved-thinking-2025-05-14"],
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
| `plugins` | object[] | 已加载插件列表 |
| `output_style` | string | 输出风格 |
| `betas` | string[] | Beta 标志列表 |

#### System 消息的其他 subtype

| subtype | 描述 | 关键字段 |
|---------|------|---------|
| `api_retry` | API 重试通知 | `attempt`, `max_retries`, `retry_delay_ms` |
| `status` | 状态变更 | `status`, `permissionMode?`, `fast_mode_state?` |
| `compact_boundary` | 上下文压缩边界 | `compact_metadata.trigger` (manual/auto), `pre_tokens`, `post_tokens` |
| `post_turn_summary` | 回合摘要（后台生成） | `content` |
| `local_command_output` | 本地命令输出 | 输出内容 |
| `hook_started` | Hook 开始执行 | Hook 元数据 |
| `hook_progress` | Hook 执行进度 | 进度信息 |
| `hook_response` | Hook 执行响应 | 响应内容 |
| `files_persisted` | 文件持久化事件 | 文件列表 |
| `task_notification` | 任务通知 | 通知内容 |
| `task_started` | 任务开始 | 任务 ID |
| `task_progress` | 任务进度 | 进度信息 |
| `session_state_changed` | 会话状态变更 | 状态信息 |
| `elicitation_complete` | Elicitation 完成 | 结果信息 |
| `prompt_suggestion` | 提示建议 | 建议内容 |

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
  },
  "permission_denials": [],
  "structured_output": null,
  "fast_mode_state": "off"
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
  "num_turns": 10,
  "stop_reason": null,
  "usage": {
    "input_tokens": 10000,
    "output_tokens": 500
  },
  "modelUsage": {},
  "permission_denials": [],
  "errors": ["Maximum turns exceeded"]
}
```

**子类型值**:

| 值 | 描述 |
|------|------|
| `success` | 成功完成 |
| `error_max_turns` | 超过最大轮次限制 |
| `error_during_execution` | 执行期间发生错误 |
| `error_max_budget_usd` | 超过 API 花费上限 |
| `error_max_structured_output_retries` | 结构化输出重试次数超限 |

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

### 5. Image Block

Claude Code VS Code 插件在发送图片附件时，不会只传本地路径，而是先把图片读成 Data URL，再转成 Anthropic 图片内容块。

```json
{
  "type": "image",
  "source": {
    "type": "base64",
    "media_type": "image/png",
    "data": "<base64>"
  }
}
```

### 6. Document Block

普通文件和 PDF 也不会作为独立 `attachments` 字段发送，而是直接变成 `message.content[]` 中的文档块。

文本文件：

```json
{
  "type": "document",
  "source": {
    "type": "text",
    "media_type": "text/plain",
    "data": "文件全文内容"
  },
  "title": "README.md"
}
```

PDF：

```json
{
  "type": "document",
  "source": {
    "type": "base64",
    "media_type": "application/pdf",
    "data": "<base64>"
  },
  "title": "spec.pdf"
}
```

### 附件处理链路（VS Code Claude Code 插件）

基于本地扩展 `anthropic.claude-code-2.1.81-darwin-arm64` 的 WebView 代码，可以确认 Claude Code 插件对附件的处理链路如下：

1. 用户通过 `attach-file` 或拖拽添加文件
2. 前端先筛选支持的类型：`image/*`、`application/pdf`、文本类文件
3. 所有支持的文件都会先经 `FileReader.readAsDataURL()` 读入内存
4. 发送前再转成 Anthropic `message.content[]` 块
5. 最终作为一条 `user` 消息发送：

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": [
      { "type": "image", "source": { "...": "..." } },
      { "type": "document", "source": { "...": "..." }, "title": "..." },
      { "type": "text", "text": "用户输入文本" }
    ]
  }
}
```

这意味着 Claude Code 和 Codex 的关键区别是：

- Claude Code：图片和文件都直接嵌入 `message.content[]`
- Codex：图片进 `input`，普通文件进独立 `attachments`

### 大文件行为说明

从当前插件代码看，前端能确认的行为是：

- 图片会先转成 base64
- PDF 会先转成 base64
- 文本文件会直接把全文放进 `document.source.data`

目前没有在前端代码里找到清晰的“附件大小上限”或“超限前置拦截”逻辑。因此更合理的判断是：

- Claude Code 前端会先尝试读取整个文件
- 大文件会直接放大请求体体积和内存占用
- 真正的失败点更可能出现在：
  - WebView / 浏览器内存压力
  - 后端请求体限制
  - 模型上下文长度限制
  - 服务端超时或拒绝

进一步补查后，可以再确认两点：

- 目前没有在附件发送链路附近找到明确的前端错误文案或门槛判断，例如：
  - `file too large`
  - `attachment too large`
  - `body too large`
  - `input_too_large`
  - `message too long`
- 搜到的 `too large` / `maxFileSize` 绝大部分来自 Monaco 编辑器自身逻辑，不属于 Claude 附件上传链路

因此，在当前可见代码范围内，更合理的结论仍然是：

- Claude Code 前端不会先按大小优雅拦截附件
- 而是先读取，再尝试发送
- 超限失败更可能发生在后端或模型侧

### 本地会话落盘中的 attachment 记录

在 VS Code 扩展的会话存储层，可以看到它在读取本地 `.jsonl` 会话时，显式兼容了 `attachment` 记录类型：

```js
if (
  O.type === "user" ||
  O.type === "assistant" ||
  O.type === "attachment" ||
  O.type === "system"
) {
  K.set(O.uuid, O)
}
```

这说明 Claude Code 的本地会话格式理论上允许存在：

```json
{ "type": "attachment", ... }
```

但当前进一步检查发现：

- 扩展当前常规 `saveSession(...)` 逻辑里，没有看到显式写出 `attachment` 行的实现
- 本机 `~/.claude/projects/**/*.jsonl` 中，也没有搜到真实的 `type: "attachment"` 样本

因此目前最保守的判断是：

- 存储层兼容 `attachment` 记录
- 但常规发送链路不一定会把附件单独落成一条 `attachment` 记录
- 也可能只在某些特殊同步/桥接场景下出现

工程含义是：

- Claude Code 的文件附件更接近“直接把文件内容发给模型”
- 它不适合无保护地附加超大文本、超大图片、超大 PDF
- 如果 CCGUI 后续要兼容 Claude 附件模式，建议在前端主动增加大小门槛和类型分流策略

---

## 权限系统

### 权限模式

| 值 | 描述 |
|------|------|
| `default` | 标准权限检查 |
| `acceptEdits` | 自动批准文件编辑操作 |
| `bypassPermissions` | 跳过所有权限检查（需 `--allow-dangerously-skip-permissions` 或 `--dangerously-skip-permissions`） |
| `plan` | 计划模式（只读，不修改） |
| `dontAsk` | 不询问权限，未预批准则拒绝 |

> **注意**：`auto` 模式不在标准 `PermissionModeSchema` 枚举中。它是 `[ANT-ONLY]` 的功能，通过 `--delegate-permissions` 或 `--dangerously-skip-permissions-with-classifiers`（均已废弃）触发，且需要 `TRANSCRIPT_CLASSIFIER` feature flag 启用。

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

用户提示通过 stdin 以 `type: "user"` 消息发送，**不是** control_request。

```
父进程                         Claude 进程
  |                               |
  |--- user message ------------->|  (type: "user", message: {...})
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
| 2.3 | 2026-04-09 | 对照 Claude Code 源码全面校验：修正 summary 为 system.post_turn_summary（非独立类型）；删除不存在的 custom-title 消息类型；修正 auto 不在标准权限枚举中；补充 error_max_budget_usd/error_max_structured_output_retries 两个 result subtype；补充 system 消息 15 个缺失 subtype；补充 CLI 参数（permission-prompt-tool、replay-user-messages、append-system-prompt、effort、setting-sources 等）；补充 can_use_tool 缺失字段（title/display_name/description）；补充 set_permission_mode 的 ultraplan 字段；修正 elicitation.mode 值为 form/url；补充 get_context_usage 响应缺失字段；补充 system init 缺失字段（plugins/output_style/betas） |
| 2.2 | 2026-04-09 | 对照源码查漏补缺：修正 rewind_files 响应字段；修正流程图中 query 的发送方式；补充 12 个 control_request 子类型；补充 control_cancel_request、update_environment_variables、用户消息输入格式；补充 initialize 响应 schema；补充 CLI 参数（max-turns、max-budget-usd 等） |
| 2.0 | 2026-03-13 | 合并 sdk.md 和 stream-api.md |
| 1.0 | 2026-03-08 | 初始版本 |

---

*本文档由 Claude 自动生成并整理，如有问题请参考官方文档。*
