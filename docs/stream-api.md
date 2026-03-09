# Claude Code Stream API 协议

**文档版本**: 1.0
**最后更新**: 2026-03-08
**适用版本**: Claude Code 2.1.71+

## 概述

Claude Code 使用基于 stdin/stdout 的 JSON 流式协议进行通信。所有消息都是换行符分隔的 JSON 对象。

## 基础协议

### 消息格式

```
JSON_OBJECT\n
```

每条消息都是一个单行 JSON 对象，以换行符结束。

### 传输层

- **输入**: stdin (父进程 → Claude 进程)
- **输出**: stdout (Claude 进程 → 父进程)
- **编码**: UTF-8
- **分隔符**: `\n` (换行符)

## 消息类型

### 1. 控制消息 (Control Messages)

#### 1.1 control_request (控制请求)

父进程向 Claude 进程发送的请求消息。

**结构**:
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

**字段说明**:
- `type`: 固定为 `"control_request"`
- `request_id`: 唯一请求标识符，格式为 `Math.random().toString(36).substring(2, 15)`
- `request.subtype`: 请求子类型

**请求子类型**:

##### initialize (初始化)
```json
{
  "type": "control_request",
  "request_id": "abc123",
  "request": {
    "subtype": "initialize",
    "hooks": {
      "hookName": [{
        "matcher": "pattern",
        "hookCallbackIds": ["hook_0", "hook_1"],
        "timeout": 5000
      }]
    },
    "sdkMcpServers": ["server1", "server2"],
    "jsonSchema": {},
    "systemPrompt": "string",
    "appendSystemPrompt": "string",
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
- `"bypassPermissions"`: 跳过所有权限检查（仅限沙箱环境）

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

##### set_max_thinking_tokens (设置思考令牌)
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

##### apply_flag_settings (应用标志设置)
```json
{
  "type": "control_request",
  "request_id": "flag123",
  "request": {
    "subtype": "apply_flag_settings",
    "settings": {}
  }
}
```

##### get_settings (获取设置)
```json
{
  "type": "control_request",
  "request_id": "get123",
  "request": {
    "subtype": "get_settings"
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

**说明**:
- `user_message_id`: 要回滚到的用户消息 ID
- `dry_run`: 是否仅预览（不实际执行）

**响应**:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "rewind123",
    "response": {
      "restored_files": [
        "/path/to/file1.js",
        "/path/to/file2.ts"
      ],
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
    "message_id": "msg_123"  // 可选，指定分支点
  }
}
```

**说明**:
- `message_id`: 可选参数，指定从哪个消息创建分支
  - 如果不提供，则复制整个会话
  - 如果提供，则只复制到该消息为止（包含该消息）

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

**工作原理**:
1. 创建新的 session ID
2. 复制原会话的消息到新会话文件
3. 复制相关的文件历史快照（file-history-snapshot）
4. 为新消息分配新的 UUID
5. 保持消息的父子关系

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

**说明**:
- 先执行 `rewind_files` 回滚文件
- 然后执行 `fork_session` 创建分支
- `user_message_id`: 要回滚到的用户消息 ID
- `dry_run`: 是否仅预览

**响应**:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "rewindfork123",
    "response": {
      "restored_files": ["file1.js", "file2.ts"],
      "new_session_id": "new-session-uuid-789",
      "dry_run": false
    }
  }
}
```

##### enable_remote_control (启用远程控制)
```json
{
  "type": "control_request",
  "request_id": "remote123",
  "request": {
    "subtype": "remote_control",
    "enabled": true
  }
}
```

##### set_proactive (设置主动模式)
```json
{
  "type": "control_request",
  "request_id": "pro123",
  "request": {
    "subtype": "set_proactive",
    "enabled": true
  }
}
```

##### stop_task (停止任务)
```json
{
  "type": "control_request",
  "request_id": "stop123",
  "request": {
    "subtype": "stop_task",
    "task_id": "task_456"
  }
}
```

#### 1.2 control_response (控制响应)

Claude 进程对控制请求的响应。

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

**待处理权限请求响应**:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "error",
    "request_id": "abc123",
    "error": "...",
    "pending_permission_requests": [
      {
        "request": {
          "subtype": "can_use_tool",
          "tool_name": "Bash",
          "input": {}
        }
      }
    ]
  }
}
```

### 2. 反向控制消息 (Reverse Control)

#### 2.1 Claude → 父进程的控制请求

当 Claude 需要父进程的权限或执行操作时，会发送控制请求。

##### can_use_tool (工具使用权限请求)
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
      "behavior": "allow",  // "allow" 或 "deny"
      "reason": "用户批准",
      "toolUseID": "tooluse_123",
      "updatedInput": {
        // 更新后的工具输入（可选）
      },
      "updatedPermissions": [
        // 权限规则数组（用于 allow all，可选）
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

##### hook_callback (钩子回调)
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

**父进程响应**:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "hook123",
    "response": {
      // 钩子执行结果
    }
  }
}
```

##### mcp_message (MCP 消息)
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

**父进程响应**:
```json
{
  "type": "control_response",
  "response": {
    "subtype": "success",
    "request_id": "mcp123",
    "response": {
      "mcp_response": {
        "jsonrpc": "2.0",
        "result": {},
        "id": 1
      }
    }
  }
}
```

##### elicitation (诱导请求)
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
      "action": "accept"  // "accept" | "decline" | "cancel"
    }
  }
}
```

#### 2.2 control_cancel_request (取消控制请求)

```json
{
  "type": "control_cancel_request",
  "request_id": "abc123"
}
```

### 3. 流式消息 (Streaming Messages)

单向消息，从 Claude 进程流向父进程。

#### 3.1 stream_event (流式事件)

流式事件是 Claude 主动发送给父进程的消息，用于实时更新消息内容、思考过程和工具使用。

##### message_start (消息开始)
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

##### content_block_start (内容块开始)
```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_start",
    "index": 0,
    "content_block": {
      "type": "thinking",  // 或 "text"
      "thinking": "",
      "signature": "b05a8310cdce4efe9d7e84f7"
    }
  },
  "session_id": "session-uuid",
  "parent_tool_use_id": null,
  "uuid": "block-uuid"
}
```

##### content_block_delta (内容块增量)
```json
{
  "type": "stream_event",
  "event": {
    "type": "content_block_delta",
    "index": 0,
    "delta": {
      "type": "thinking_delta",  // 或 "text_delta"
      "thinking": "用户要求"  // 或 "text": "回复文本"
    }
  },
  "session_id": "session-uuid",
  "parent_tool_use_id": null,
  "uuid": "delta-uuid"
}
```

**delta 类型**:
- `thinking_delta`: 思考过程的增量更新
  ```json
  {
    "type": "thinking_delta",
    "thinking": "思考内容片段"
  }
  ```
- `text_delta`: 文本内容的增量更新
  ```json
  {
    "type": "text_delta",
    "text": "回复文本片段"
  }
  ```
- `input_json_delta`: 工具输入的 JSON 增量
  ```json
  {
    "type": "input_json_delta",
    "partial_json": "{\"command\": \"ls"
  }
  ```

##### content_block_stop (内容块结束)
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

##### message_stop (消息结束)
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

#### 3.2 assistant (助手完整消息)

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

#### 3.3 result (结果消息)

查询的最终结果，包含详细的统计信息。

```json
{
  "type": "result",
  "subtype": "success",  // 或 "error"
  "is_error": false,
  "duration_ms": 11638,
  "duration_api_ms": 11609,
  "num_turns": 1,
  "result": "最终回复文本内容",
  "stop_reason": "end_turn",
  "session_id": "session-uuid",
  "total_cost_usd": 0.060107,
  "usage": {
    "input_tokens": 9352,
    "cache_creation_input_tokens": 0,
    "cache_read_input_tokens": 13696,
    "output_tokens": 260,
    "server_tool_use": {
      "web_search_requests": 0,
      "web_fetch_requests": 0
    },
    "service_tier": "standard",
    "cache_creation": {
      "ephemeral_1h_input_tokens": 0,
      "ephemeral_5m_input_tokens": 0
    },
    "inference_geo": "",
    "iterations": [],
    "speed": "standard"
  },
  "modelUsage": {
    "claude-sonnet-4-6": {
      "inputTokens": 9352,
      "outputTokens": 260,
      "cacheReadInputTokens": 13696,
      "cacheCreationInputTokens": 0,
      "webSearchRequests": 0,
      "costUSD": 0.060107,
      "contextWindow": 200000,
      "maxOutputTokens": 32000
    }
  },
  "permission_denials": [],
  "fast_mode_state": "off",
  "uuid": "result-uuid"
}
```

**字段说明**:
- `subtype`: 结果子类型
  - `"success"`: 成功
  - `"error"`: 错误
- `is_error`: 是否为错误结果
- `duration_ms`: 总持续时间（毫秒）
- `duration_api_ms`: API 调用时间（毫秒）
- `num_turns`: 对话轮次
- `result`: 最终回复文本
- `stop_reason`: 停止原因
  - `"end_turn"`: 正常结束
  - `"max_tokens"`: 达到最大令牌数
  - `"stop_sequence"`: 遇到停止序列
  - `"tool_use"`: 使用工具
- `total_cost_usd`: 总成本（美元）
- `usage`: 使用统计
  - `input_tokens`: 输入令牌数
  - `cache_read_input_tokens`: 从缓存读取的令牌数
  - `cache_creation_input_tokens`: 创建缓存的令牌数
  - `output_tokens`: 输出令牌数
- `modelUsage`: 按模型的使用统计
- `permission_denials`: 权限拒绝列表
- `fast_mode_state`: 快速模式状态（"on" 或 "off"）

#### 3.4 error (错误消息)

```json
{
  "type": "error",
  "error": "错误描述",
  "details": {}
}
```

#### 3.5 keep_alive (保活消息)

```json
{
  "type": "keep_alive"
}
```

定期发送以保持连接活跃。

#### 3.6 summary (会话摘要)

```json
{
  "type": "summary",
  "summary": "会话摘要内容"
}
```

#### 3.7 custom-title (自定义标题)

```json
{
  "type": "custom-title",
  "title": "会话标题"
}
```

#### 3.8 teleported-from (远程传送)

```json
{
  "type": "teleported-from",
  "session_id": "session_123"
}
```

#### 3.9 system (系统消息)

系统消息用于传递会话初始化信息和环境状态。

##### system init (系统初始化)

在 Claude 进程启动后立即发送，包含完整的环境信息。

```json
{
  "type": "system",
  "subtype": "init",
  "cwd": "/Users/username/project",
  "session_id": "session-uuid",
  "tools": [
    "Bash", "Read", "Write", "Edit", "Glob", "Grep",
    "Task", "TaskOutput", "ExitPlanMode", "EnterPlanMode",
    "TodoWrite", "Skill", "EnterWorktree",
    "mcp__mcpServers__click", "mcp__mcpServers__take_screenshot", ...
  ],
  "mcp_servers": [
    {"name": "mcp-obsidian", "status": "disabled"},
    {"name": "mcpServers", "status": "connected"},
    {"name": "apifox", "status": "connected"}
  ],
  "model": "claude-sonnet-4-6",
  "permissionMode": "default",
  "slash_commands": [
    "debug", "simplify", "batch", "claude-api",
    "compact", "context", "cost", "init", "pr-comments",
    "release-notes", "review", "security-review", "insights"
  ],
  "apiKeySource": "none",
  "claude_code_version": "2.1.70",
  "output_style": "default",
  "agents": [
    "general-purpose", "statusline-setup", "Explore", "Plan"
  ],
  "skills": ["debug", "simplify", "batch", "claude-api"],
  "plugins": [],
  "uuid": "init-uuid",
  "fast_mode_state": "off"
}
```

**字段说明**:
- `cwd`: 当前工作目录
- `session_id`: 会话 ID
- `tools`: 可用工具列表（包含内置工具和 MCP 工具）
- `mcp_servers`: MCP 服务器列表及其状态
  - `name`: 服务器名称
  - `status`: 连接状态（"connected", "disabled", "error"）
- `model`: 当前使用的模型
- `permissionMode`: 当前权限模式
- `slash_commands`: 可用的斜杠命令
- `apiKeySource`: API 密钥来源
- `claude_code_version`: Claude Code 版本
- `output_style`: 输出风格
- `agents`: 可用的代理类型
- `skills`: 可用的技能
- `plugins`: 已加载的插件
- `uuid`: 消息 UUID
- `fast_mode_state`: 快速模式状态

**注意**: 第一次启动时，`session_id` 可能为 `null`，在后续的 system init 消息中才会包含实际的 session ID。

## 通信流程

### 1. 初始化流程

```
父进程                         Claude 进程
  |                               |
  |--- control_request ---------->|  (initialize)
  |                               |
  |<-- control_response ----------|  (success)
  |                               |
```

### 2. 查询执行流程

```
父进程                         Claude 进程
  |                               |
  |--- control_request ---------->|  (query)
  |                               |
  |<-- streamlined_text ---------|  (多次)
  |<-- streamlined_text ---------|
  |<-- streamlined_text ---------|
  |                               |
  |<-- streamlined_tool_use -----|
  |                               |
  |<-- result --------------------|
  |                               |
```

### 3. 权限处理流程

```
父进程                         Claude 进程
  |                               |
  |<-- control_request ----------|  (can_use_tool)
  |                               |
  |--- control_response --------->|  (allow/deny)
  |                               |
```

### 4. Hook 回调流程

```
父进程                         Claude 进程
  |                               |
  |<-- control_request ----------|  (hook_callback)
  |                               |
  |--- control_response --------->|  (result)
  |                               |
```

### 5. MCP 消息流程

```
父进程                         Claude 进程
  |                               |
  |<-- control_request ----------|  (mcp_message)
  |                               |
  |  [与 MCP 服务器通信]            |
  |                               |
  |--- control_response --------->|  (mcp_response)
  |                               |
```

## 实现示例

### Node.js 客户端

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
const rl = readline.createInterface({
  input: claude.stdout
});

rl.on('line', (line) => {
  const message = JSON.parse(line);

  switch (message.type) {
    case 'control_request':
      handleControlRequest(message);
      break;
    case 'control_response':
      handleControlResponse(message);
      break;
    case 'streamlined_text':
      console.log('Text:', message.content);
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
    // 显示权限请求给用户
    const decision = askUser(request);

    // 发送响应
    const response = {
      type: 'control_response',
      response: {
        subtype: 'success',
        request_id,
        response: {
          decision: decision ? 'allow' : 'deny',
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

### Python 客户端

```python
import subprocess
import json
import threading

class ClaudeClient:
    def __init__(self):
        self.process = subprocess.Popen(
            ['claude', '--output-format', 'stream-json',
             '--input-format', 'stream-json', '--verbose'],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        # 启动读取线程
        self.reader_thread = threading.Thread(target=self._read_messages)
        self.reader_thread.daemon = True
        self.reader_thread.start()

    def send_request(self, subtype, **kwargs):
        request_id = ''.join(random.choices(
            string.ascii_lowercase + string.digits, k=13
        ))

        request = {
            'type': 'control_request',
            'request_id': request_id,
            'request': {
                'subtype': subtype,
                **kwargs
            }
        }

        self.process.stdin.write(json.dumps(request) + '\n')
        self.process.stdin.flush()

        return request_id

    def _read_messages(self):
        for line in self.process.stdout:
            message = json.loads(line)
            self._handle_message(message)

    def _handle_message(self, message):
        msg_type = message.get('type')

        if msg_type == 'control_request':
            self._handle_control_request(message)
        elif msg_type == 'streamlined_text':
            print(f"Text: {message['content']}")
        elif msg_type == 'result':
            print(f"Result: {message['result']}")

    def _handle_control_request(self, message):
        request = message['request']
        request_id = message['request_id']

        if request['subtype'] == 'can_use_tool':
            decision = self._ask_permission(request)

            response = {
                'type': 'control_response',
                'response': {
                    'subtype': 'success',
                    'request_id': request_id,
                    'response': {
                        'decision': 'allow' if decision else 'deny',
                        'toolUseID': request['tool_use_id']
                    }
                }
            }

            self.process.stdin.write(json.dumps(response) + '\n')
            self.process.stdin.flush()

    def _ask_permission(self, request):
        # 实现权限请求逻辑
        return True

# 使用
client = ClaudeClient()
client.send_request('initialize', hooks={}, jsonSchema=None)
```

## 错误处理

### 1. 进程错误

```javascript
claude.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error('Claude 可执行文件未找到');
  } else {
    console.error('进程启动失败:', err.message);
  }
});
```

### 2. 消息解析错误

```javascript
rl.on('line', (line) => {
  try {
    const message = JSON.parse(line);
    // 处理消息
  } catch (err) {
    console.error('JSON 解析错误:', err.message);
    console.error('原始数据:', line);
  }
});
```

### 3. 超时处理

```javascript
const pendingRequests = new Map();

function sendRequestWithTimeout(subtype, data, timeout = 30000) {
  const requestId = sendRequest(subtype, data);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('请求超时'));
    }, timeout);

    pendingRequests.set(requestId, { resolve, reject, timer });
  });
}
```

## 最佳实践

### 1. 消息队列

使用消息队列确保消息按顺序处理：

```javascript
class MessageQueue {
  constructor() {
    this.queue = [];
    this.processing = false;
  }

  async enqueue(message) {
    this.queue.push(message);
    if (!this.processing) {
      await this.processQueue();
    }
  }

  async processQueue() {
    this.processing = true;
    while (this.queue.length > 0) {
      const message = this.queue.shift();
      await this.handleMessage(message);
    }
    this.processing = false;
  }
}
```

### 2. 缓冲写入

使用缓冲写入提高性能：

```javascript
class BufferedWriter {
  constructor(stream, flushInterval = 1000, maxBufferSize = 100) {
    this.stream = stream;
    this.buffer = [];
    this.flushInterval = flushInterval;
    this.maxBufferSize = maxBufferSize;
    this.timer = null;
  }

  write(data) {
    this.buffer.push(data);

    if (this.buffer.length >= this.maxBufferSize) {
      this.flush();
    } else if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushInterval);
    }
  }

  flush() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }

    if (this.buffer.length > 0) {
      this.stream.write(this.buffer.join(''));
      this.buffer = [];
    }
  }
}
```

### 3. 优雅关闭

```javascript
async function gracefulShutdown() {
  // 1. 停止发送新消息
  // 2. 等待待处理请求完成
  // 3. 关闭 stdin
  claude.stdin.end();

  // 4. 等待进程退出
  await new Promise((resolve) => {
    claude.on('exit', resolve);
  });
}
```

## 调试

### 1. 启用调试日志

```bash
claude --output-format stream-json --input-format stream-json --verbose --debug
```

### 2. 调试到文件

```bash
claude --output-format stream-json --input-format stream-json --verbose --debug-file /path/to/debug.log
```

### 3. 调试到 stderr

```bash
claude --output-format stream-json --input-format stream-json --verbose --debug-to-stderr
```

### 4. 环境变量

```bash
export DEBUG_CLAUDE_AGENT_SDK=1
export CLAUDE_CODE_DEBUG_LOG_LEVEL=debug
export CLAUDE_CODE_DEBUG_LOGS_DIR=/path/to/logs
```

## 安全考虑

### 1. 权限控制

- 始终使用 `--permission-prompt-tool stdio` 进行权限控制
- 不要在不可信环境中使用 `--allow-dangerously-skip-permissions`
- 对敏感操作实现二次确认

### 2. 输入验证

- 验证所有从 Claude 接收的消息格式
- 对 JSON 解析错误进行处理
- 限制消息大小以防止内存溢出

### 3. 资源限制

```javascript
// 限制消息大小
const MAX_MESSAGE_SIZE = 10 * 1024 * 1024; // 10MB

rl.on('line', (line) => {
  if (line.length > MAX_MESSAGE_SIZE) {
    console.error('消息过大，丢弃');
    return;
  }

  // 处理消息
});
```

## 参考资料

- VSCode 扩展源码: `/Users/alwaysking/.vscode/extensions/anthropic.claude-code-2.1.71-darwin-arm64/extension.js`
- Claude Code 官方文档: https://code.claude.com/docs
- MCP 协议规范: https://modelcontextprotocol.io
