# Claude Code SDK - Stream-JSON 通讯协议完整文档

本文档详细描述了 Claude Code CLI 在使用 `--output-format stream-json` 时的输入输出通讯协议。适用于构建与 Claude Code 交互的 SDK、客户端或服务。

**版本**: 基于 claude-code-go 和 hexdocs.pm/claude_code (v0.4.0)

---

## 目录

1. [概述](#概述)
2. [输出格式](#输出格式)
3. [CLI 参数](#cli-参数)
4. [流式消息协议](#流式消息协议)
5. [消息类型详解](#消息类型详解)
6. [内容块类型](#内容块类型)
7. [错误处理](#错误处理)
8. [MCP 配置](#mcp-配置)
9. [权限系统](#权限系统)
10. [子代理配置](#子代理配置)
11. [完整示例](#完整示例)

---

## 概述

Claude Code CLI 支持三种输出格式，适用于不同的使用场景：

| 格式 | 描述 | 使用场景 |
|------|------|----------|
| `text` | 纯文本响应 | 简单命令行输出 |
| `json` | 结构化 JSON 响应 | 程序化处理完整结果 |
| `stream-json` | NDJSON 流式响应 | 实时处理、进度展示 |

### 流式输出特点

- 使用 **NDJSON (Newline Delimited JSON)** 格式
- 每行是一个独立的 JSON 对象
- 支持实时消息处理
- 必须与 `--verbose` 和 `--print` 一起使用

---

## 输出格式

### 输出格式类型

```go
type OutputFormat string

const (
    TextOutput       OutputFormat = "text"        // 纯文本
    JSONOutput       OutputFormat = "json"        // 结构化 JSON
    StreamJSONOutput OutputFormat = "stream-json" // NDJSON 流式
)
```

---

## CLI 参数

### 核心参数

```bash
claude -p "your prompt" [options]
```

| 参数 | 类型 | 描述 |
|------|------|------|
| `-p` | string | 输入提示词 |
| `--output-format` | text/json/stream-json | 输出格式 |
| `--print` | flag | 启用打印模式（stream-json 必需） |
| `--verbose` | flag | 详细输出（stream-json 必需） |
| `--model` | string | 模型名称或别名 (sonnet/opus/haiku) |
| `--system-prompt` | string | 自定义系统提示 |
| `--append-system-prompt` | string | 追加到默认系统提示 |
| `--max-turns` | int | 最大代理轮次 |
| `--session-id` | string | 会话 UUID |
| `--resume` | string | 恢复指定会话 ID |
| `--continue` | flag | 继续最近的对话 |
| `--fork-session` | flag | 恢复时创建新会话 ID |
| `--no-session-persistence` | flag | 禁用会话持久化 |

### MCP 相关参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `--mcp-config` | string[] | MCP 配置文件路径或 JSON 字符串 |
| `--strict-mcp-config` | flag | 仅使用指定的 MCP 配置 |
| `--add-dir` | string[] | 添加额外目录到上下文 |

### 权限相关参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `--permission-mode` | string | 权限模式 |
| `--allowedTools` | string | 允许的工具列表（逗号分隔） |
| `--disallowedTools` | string | 禁用的工具列表（逗号分隔） |
| `--permission-prompt-tool` | string | 权限提示的 MCP 工具 |

### 其他参数

| 参数 | 类型 | 描述 |
|------|------|------|
| `--json-schema` | string | 结构化输出的 JSON Schema |
| `--fallback-model` | string | 主模型过载时的备用模型 |
| `--debug` | string | 调试模式（可选类别过滤） |
| `--config` | string | 配置文件路径 |
| `--theme` | string | UI 主题 |
| `--disable-autoupdate` | flag | 禁用自动更新 |

---

## 流式消息协议

### 消息流格式

```
<system/init message>
<assistant message 1>
[<assistant message 2>]
[...]
[<user message>]
<result message>
```

### 消息处理流程

```
┌─────────────────┐
│  System (init)  │  ← 会话初始化，包含工具和 MCP 服务器信息
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   Assistant     │  ← Claude 的响应（可能有多个增量消息）
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│   User (可选)   │  ← 用户消息回显（工具结果）
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│     Result      │  ← 最终结果，包含成本、时长、turn 数
└─────────────────┘
```

### 基础消息结构

```go
type Message struct {
    Type      string          `json:"type"`                  // 消息类型
    Subtype   string          `json:"subtype,omitempty"`     // 子类型
    Message   json.RawMessage `json:"message,omitempty"`     // 原始消息内容
    SessionID string          `json:"session_id"`            // 会话 ID

    // 以下字段根据消息类型可选
    CostUSD       float64  `json:"total_cost_usd,omitempty"`
    DurationMS    int64    `json:"duration_ms,omitempty"`
    DurationAPIMS int64    `json:"duration_api_ms,omitempty"`
    IsError       bool     `json:"is_error,omitempty"`
    NumTurns      int      `json:"num_turns,omitempty"`
    Result        string   `json:"result,omitempty"`
    Tools         []string `json:"tools,omitempty"`
    MCPServers    []struct {
        Name   string `json:"name"`
        Status string `json:"status"`
    } `json:"mcp_servers,omitempty"`
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
  "permissionMode": "default"
}
```

#### 字段说明

| 字段 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `type` | string | ✅ | 固定值 "system" |
| `subtype` | string | ✅ | 固定值 "init" |
| `session_id` | string | ✅ | 会话唯一标识符 (UUID) |
| `apiKeySource` | string | | API 密钥来源 |
| `cwd` | string | | 当前工作目录 |
| `tools` | string[] | | 可用工具列表 |
| `mcp_servers` | object[] | | MCP 服务器状态列表 |
| `model` | string | | 使用的模型 |
| `permissionMode` | string | | 权限模式 |

#### 权限模式值

| 值 | 描述 |
|------|------|
| `default` | 标准权限检查 |
| `acceptEdits` | 自动批准文件编辑操作 |
| `bypassPermissions` | 跳过所有权限检查（谨慎使用） |
| `plan` | 计划模式（只读，不修改） |
| `dontAsk` | 不询问权限，自动进行 |

---

### 2. Assistant 消息 (type: "assistant")

Claude 的响应内容，可能包含多个增量消息。

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

#### 字段说明

| 字段 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `type` | string | ✅ | 固定值 "assistant" |
| `message` | object | ✅ | Anthropic SDK Message 对象 |
| `session_id` | string | ✅ | 会话 ID |
| `result` | string | | 提取的文本结果（便捷字段） |

#### message 对象结构

| 字段 | 类型 | 描述 |
|------|------|------|
| `id` | string | 消息 ID |
| `type` | string | 固定值 "message" |
| `role` | string | 固定值 "assistant" |
| `content` | ContentBlock[] | 内容块数组 |
| `model` | string | 使用的模型 |
| `stop_reason` | string | 停止原因 |
| `usage` | object | Token 使用统计 |

---

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

#### 字段说明

| 字段 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `type` | string | ✅ | 固定值 "user" |
| `message` | object | ✅ | Anthropic SDK MessageParam 对象 |
| `session_id` | string | ✅ | 会话 ID |

---

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
  "num_turns": 1
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

#### 字段说明

| 字段 | 类型 | 必需 | 描述 |
|------|------|------|------|
| `type` | string | ✅ | 固定值 "result" |
| `subtype` | string | ✅ | 结果子类型 |
| `session_id` | string | ✅ | 会话 ID |
| `result` | string | | 最终响应文本（成功时） |
| `total_cost_usd` | float | ✅ | 总成本（美元） |
| `duration_ms` | int | ✅ | 总耗时（毫秒） |
| `duration_api_ms` | int | ✅ | API 耗时（毫秒） |
| `is_error` | bool | ✅ | 是否为错误 |
| `num_turns` | int | ✅ | 代理轮次数量 |

#### 子类型值

| 值 | 描述 |
|------|------|
| `success` | 成功完成 |
| `error_max_turns` | 超过最大轮次限制 |
| `error_during_execution` | 执行期间发生错误 |

---

## 内容块类型

### 1. Text Block

文本内容块。

```json
{
  "type": "text",
  "text": "This is the text content"
}
```

### 2. Tool Use Block

工具调用请求块。

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

### 3. Tool Result Block

工具调用结果块。

```json
{
  "type": "tool_result",
  "tool_use_id": "toolu_01ABC123",
  "content": "On branch main\nYour branch is up to date.",
  "is_error": false
}
```

---

## 错误处理

### 错误类型

```go
type ErrorType int

const (
    ErrorUnknown       ErrorType = iota  // 未知错误
    ErrorAuthentication                   // 认证错误
    ErrorRateLimit                        // 速率限制
    ErrorPermission                       // 权限错误
    ErrorCommand                          // 命令错误
    ErrorNetwork                          // 网络错误
    ErrorMCP                              // MCP 服务器错误
    ErrorValidation                       // 验证错误
    ErrorTimeout                          // 超时错误
    ErrorSession                          // 会话错误
)
```

### 错误结构

```go
type ClaudeError struct {
    Type     ErrorType              `json:"type"`
    Message  string                 `json:"message"`
    Code     int                    `json:"code,omitempty"`
    Details  map[string]interface{} `json:"details,omitempty"`
    Original error                  `json:"-"`
}
```

### 错误识别关键词

| 错误类型 | 识别关键词 |
|---------|-----------|
| Authentication | "authentication", "api key", "unauthorized", "401", "403" |
| RateLimit | "rate limit", "too many requests", "429", "quota exceeded" |
| Permission | "permission denied", "not allowed", "tool not permitted" |
| Network | "network", "connection", "timeout", "dns", "unreachable" |
| MCP | "mcp", "model context protocol", "mcp server", "mcp tool" |
| Timeout | "timeout", "timed out", "deadline exceeded" |
| Session | "session", "session not found", "invalid session" |
| Validation | "invalid", "validation", "malformed", "bad request", "400" |

### 可重试错误

以下错误类型通常是可重试的：

- `ErrorRateLimit`
- `ErrorNetwork`
- `ErrorTimeout`
- `ErrorMCP`（连接问题）

---

## MCP 配置

### MCP 服务器类型

```go
type MCPServerType string

const (
    MCPServerTypeHTTP  MCPServerType = "http"   // HTTP 服务器
    MCPServerTypeSSE   MCPServerType = "sse"    // Server-Sent Events
    MCPServerTypeStdio MCPServerType = "stdio"  // 标准输入输出
)
```

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
    },
    "custom": {
      "url": "http://localhost:3000/mcp",
      "type": "http"
    }
  }
}
```

### 服务器配置字段

| 字段 | 类型 | 描述 |
|------|------|------|
| `command` | string | stdio 服务器的命令 |
| `args` | string[] | 命令参数 |
| `env` | object | 环境变量 |
| `url` | string | http/sse 服务器的 URL |
| `type` | string | 服务器类型 (http/sse/stdio) |

### MCP 工具命名规范

MCP 工具名称遵循模式：`mcp__<serverName>__<toolName>`

示例：
- `mcp__filesystem__read_file`
- `mcp__github__create_issue`

---

## 权限系统

### 权限行为

```go
type PermissionBehavior string

const (
    PermissionAllow PermissionBehavior = "allow"  // 允许
    PermissionDeny  PermissionBehavior = "deny"   // 拒绝
    PermissionAsk   PermissionBehavior = "ask"    // 询问用户
)
```

### 权限结果结构

```go
type PermissionResult struct {
    Behavior PermissionBehavior `json:"behavior"`
    Message  string             `json:"message,omitempty"`
}
```

### 工具输入结构

```go
type ToolInput struct {
    Command   string                 `json:"command,omitempty"`    // Bash 命令
    FilePath  string                 `json:"file_path,omitempty"`  // 文件路径
    Pattern   string                 `json:"pattern,omitempty"`    // 搜索模式
    Content   string                 `json:"content,omitempty"`    // 写入内容
    OldString string                 `json:"old_string,omitempty"` // 替换前文本
    NewString string                 `json:"new_string,omitempty"` // 替换后文本
    Raw       map[string]interface{} `json:"raw,omitempty"`        // 原始输入
}
```

### 工具权限格式

支持两种格式：

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

### 工具权限结构

```go
type ToolPermission struct {
    Tool     string // 工具名称
    Command  string // 命令约束（可选）
    Pattern  string // 路径模式（可选）
    Original string // 原始权限字符串
}
```

---

## 子代理配置

### 子代理配置结构

```go
type SubagentConfig struct {
    Description     string   `json:"description"`       // 描述（用于选择代理）
    Prompt          string   `json:"prompt"`            // 系统提示
    Tools           []string `json:"tools,omitempty"`   // 允许的工具
    Model           string   `json:"model,omitempty"`   // 模型别名
    MaxTurns        int      `json:"max_turns,omitempty"`  // 最大轮次
    WorkingDirectory string  `json:"working_directory,omitempty"` // 工作目录
}
```

### 子代理配置示例

```json
{
  "code-reviewer": {
    "description": "Expert code reviewer. Use proactively after code changes.",
    "prompt": "You are a senior code reviewer. Focus on quality and best practices.",
    "tools": ["Read", "Grep", "Glob"],
    "model": "sonnet"
  },
  "security-auditor": {
    "description": "Security expert for vulnerability analysis.",
    "prompt": "You are a security expert specializing in application security.",
    "tools": ["Read", "Grep", "Glob"],
    "model": "sonnet"
  }
}
```

---

## 完整示例

### CLI 调用示例

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
{"type":"system","subtype":"init","session_id":"550e8400-e29b-41d4-a716-446655440000","tools":["Bash","Edit","Read","Write","Glob","Grep"],"mcp_servers":[],"model":"claude-sonnet-4-6","permissionMode":"default"}
{"type":"assistant","message":{"id":"msg_01","type":"message","role":"assistant","content":[{"type":"text","text":"I'll help you with that."}]},"session_id":"550e8400-e29b-41d4-a716-446655440000","result":"I'll help you with that."}
{"type":"result","subtype":"success","total_cost_usd":0.002,"duration_ms":2000,"duration_api_ms":1800,"is_error":false,"num_turns":1,"result":"I'll help you with that.","session_id":"550e8400-e29b-41d4-a716-446655440000"}
```

### Go SDK 使用示例

```go
package main

import (
    "context"
    "fmt"
    "time"

    "github.com/anthropics/claude-code-go/pkg/claude"
)

func main() {
    // 创建客户端
    client := claude.NewClient("claude")

    // 流式调用
    ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    opts := &claude.RunOptions{
        Format:   claude.StreamJSONOutput,
        Verbose:  true,
        PrintMode: true,
    }

    msgCh, errCh := client.StreamPrompt(ctx, "Explain Go interfaces", opts)

    for {
        select {
        case msg, ok := <-msgCh:
            if !ok {
                return
            }
            switch msg.Type {
            case "system":
                fmt.Printf("Session: %s\n", msg.SessionID)
            case "assistant":
                fmt.Print(msg.Result)
            case "result":
                fmt.Printf("\nCost: $%.4f\n", msg.CostUSD)
            }
        case err := <-errCh:
            if err != nil {
                fmt.Printf("Error: %v\n", err)
            }
            return
        case <-ctx.Done():
            fmt.Println("Timeout")
            return
        }
    }
}
```

### JSON 输出解析示例

```go
func parseJSONResponse(data []byte) (*ClaudeResult, error) {
    // 尝试解析为数组格式
    var messages []Message
    if err := json.Unmarshal(data, &messages); err != nil {
        // 尝试解析为单个对象（向后兼容）
        var res ClaudeResult
        if err2 := json.Unmarshal(data, &res); err2 != nil {
            return nil, fmt.Errorf("failed to parse JSON response: %v", err)
        }
        return &res, nil
    }

    // 在数组中查找 result 消息
    for _, msg := range messages {
        if msg.Type == "result" {
            return &ClaudeResult{
                Type:          msg.Type,
                Subtype:       msg.Subtype,
                Result:        msg.Result,
                CostUSD:       msg.CostUSD,
                DurationMS:    msg.DurationMS,
                DurationAPIMS: msg.DurationAPIMS,
                IsError:       msg.IsError,
                NumTurns:      msg.NumTurns,
                SessionID:     msg.SessionID,
            }, nil
        }
    }

    return nil, fmt.Errorf("no result message found in JSON response")
}
```

---

## 参考资源

- [Claude Code CLI](https://claude.ai/code)
- [Claude Code Go SDK](https://github.com/anthropics/claude-code-go)
- [Claude Code Elixir SDK](https://hexdocs.pm/claude_code/)
- [Anthropic API Documentation](https://docs.anthropic.com/)

---

## 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.0 | 2026-03-11 | 初始版本，基于 claude-code-go 和 Elixir SDK v0.4.0 |

---

*本文档由 Claude 自动生成并整理，如有问题请参考官方文档。*
