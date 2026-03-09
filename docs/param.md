# Claude Code 启动参数详解

**文档版本**: 1.0
**最后更新**: 2026-03-08
**适用版本**: Claude Code 2.1.71+

## 概述

Claude Code 支持丰富的命令行参数，用于控制其行为、权限模式、模型选择等。本文档详细说明所有可用的启动参数。

## 完整启动示例

基于 Xcode 集成的真实命令行：

```bash
/Users/alwaysking/Library/Developer/Xcode/CodingAssistant/Agents/Versions/26.4/claude \
  --output-format stream-json \
  --input-format stream-json \
  --verbose \
  --mcp-config /tmp/mcp-config-XXX.json \
  --permission-prompt-tool stdio \
  --settings '{"env":{"CLAUDE_CODE_ENABLE_TELEMETRY":"0","DISABLE_TELEMETRY":"1"},"hasCompletedOnboarding":true}' \
  --allowedTools mcp__xcode-tools__XcodeGlob,mcp__xcode-tools__XcodeGrep,... \
  --include-partial-messages \
  --append-system-prompt "## Xcode\n..." \
  --resume 1533768f-6f61-4106-bb4c-35906550e071
```

## 必需参数

### --output-format

**格式**: `--output-format <format>`

**说明**: 指定 Claude 进程的输出格式。

**可选值**:
- `stream-json`: 流式 JSON 格式（推荐）

**示例**:
```bash
--output-format stream-json
```

**用途**: 必须设置为 `stream-json` 才能使用流式协议通信。

---

### --input-format

**格式**: `--input-format <format>`

**说明**: 指定 Claude 进程的输入格式。

**可选值**:
- `stream-json`: 流式 JSON 格式（推荐）

**示例**:
```bash
--input-format stream-json
```

**用途**: 必须设置为 `stream-json` 才能接收流式协议消息。

---

### --verbose

**格式**: `--verbose`

**说明**: 启用详细输出模式。

**示例**:
```bash
--verbose
```

**用途**: 提供更详细的日志和调试信息。

---

### --print

**格式**: `--print`

**说明**: 启用打印模式，允许 Claude 进程输出到 stdout。

**示例**:
```bash
--print
```

**用途**: 在某些集成场景中需要启用此参数以允许输出。通常与流式协议一起使用。

---

## 通信与配置参数

### --mcp-config

**格式**: `--mcp-config <path>`

**说明**: 指定 MCP (Model Context Protocol) 服务器配置文件路径。

**参数**:
- `path`: JSON 配置文件的绝对路径

**示例**:
```bash
--mcp-config /tmp/mcp-config-XXX.json
```

**配置文件格式**:
```json
{
  "mcpServers": {
    "xcode-tools": {
      "command": "/path/to/xcode-tools-server",
      "args": [],
      "env": {}
    }
  }
}
```

**用途**: 配置外部 MCP 服务器，扩展 Claude 的能力。

---

### --settings

**格式**: `--settings <json>`

**说明**: 直接传递设置对象，而不是通过文件。

**参数**:
- `json`: JSON 格式的设置对象

**示例**:
```bash
--settings '{"env":{"CLAUDE_CODE_ENABLE_TELEMETRY":"0"},"hasCompletedOnboarding":true}'
```

**常见设置字段**:
```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "0",
    "DISABLE_TELEMETRY": "1"
  },
  "hasCompletedOnboarding": true,
  "sandbox": {
    // 沙箱配置
  }
}
```

**用途**: 在启动时直接配置环境变量和行为设置。

---

### --setting-sources

**格式**: `--setting-sources <sources>`

**说明**: 指定设置的来源优先级。

**参数**:
- `sources`: 逗号分隔的来源列表

**可选值**:
- `userSettings`: 用户设置
- `projectSettings`: 项目设置
- `localSettings`: 本地设置
- `flagSettings`: 标志设置
- `policySettings`: 策略设置

**示例**:
```bash
--setting-sources userSettings,projectSettings,localSettings
```

**用途**: 控制哪些设置源被使用及其优先级。

---

## 权限控制参数

### --permission-prompt-tool

**格式**: `--permission-prompt-tool <tool>`

**说明**: 指定权限提示的处理方式。

**可选值**:
- `stdio`: 通过 stdin/stdout 处理权限请求
- `<tool_name>`: 使用指定的 MCP 工具处理

**示例**:
```bash
--permission-prompt-tool stdio
```

**用途**:
- `stdio`: Claude 通过 `can_use_tool` 控制请求向父进程请求权限
- 自定义工具: 使用 MCP 服务器提供的工具处理权限

---

### --permission-mode

**格式**: `--permission-mode <mode>`

**说明**: 设置初始权限模式。

**可选值**:
- `default`: 默认模式，每次操作都需要确认
- `acceptEdits`: 自动接受编辑操作
- `plan`: 计划模式
- `bypassPermissions`: 跳过所有权限检查

**示例**:
```bash
--permission-mode acceptEdits
```

**用途**: 控制工具执行的自动批准级别。

**安全警告**:
- `bypassPermissions` 仅应在完全隔离的沙箱环境中使用
- 生产环境中应使用 `default` 或 `acceptEdits`

---

### --allow-dangerously-skip-permissions

**格式**: `--allow-dangerously-skip-permissions`

**说明**: 允许跳过权限检查（危险操作）。

**示例**:
```bash
--allow-dangerously-skip-permissions
```

**用途**: 在无网络访问的沙箱环境中完全禁用权限检查。

**安全警告**: 仅在可信环境中使用！

---

### --allowedTools

**格式**: `--allowedTools <tools>`

**说明**: 指定允许使用的工具列表。

**参数**:
- `tools`: 逗号分隔的工具名称列表

**示例**:
```bash
--allowedTools Bash,Read,Write,Edit
```

**MCP 工具格式**:
```bash
--allowedTools mcp__xcode-tools__XcodeGlob,mcp__xcode-tools__XcodeGrep
```

**内置工具列表**:
- `Bash`: 执行 shell 命令
- `Read`: 读取文件
- `Write`: 写入文件
- `Edit`: 编辑文件
- `Glob`: 文件模式匹配
- `Grep`: 内容搜索
- `Agent`: 启动子代理
- `TaskOutput`: 获取任务输出
- `ExitPlanMode`: 退出计划模式
- `TodoWrite`: 写入待办事项
- `EnterPlanMode`: 进入计划模式

**用途**: 限制 Claude 可以使用的工具集。

---

### --disallowedTools

**格式**: `--disallowedTools <tools>`

**说明**: 指定禁止使用的工具列表。

**参数**:
- `tools`: 逗号分隔的工具名称列表

**示例**:
```bash
--disallowedTools Bash,WebSearch
```

**用途**: 明确禁止某些工具的使用。

---

## 模型配置参数

### --model

**格式**: `--model <model>`

**说明**: 指定使用的 Claude 模型。

**参数**:
- `model`: 模型标识符

**可选值**:
- `claude-opus-4-6`: Opus 4.6（最强大）
- `claude-sonnet-4-6`: Sonnet 4.6（推荐）
- `claude-haiku-4-5`: Haiku 4.5（最快）
- `default`: 使用默认模型

**示例**:
```bash
--model claude-sonnet-4-6
```

**用途**: 选择适合任务的模型。

---

### --fallback-model

**格式**: `--fallback-model <model>`

**说明**: 指定备用模型。

**参数**:
- `model`: 模型标识符

**示例**:
```bash
--fallback-model claude-haiku-4-5
```

**用途**: 当主模型不可用时自动切换到备用模型。

**注意**: 备用模型必须与主模型不同。

---

### --thinking

**格式**: `--thinking <mode>`

**说明**: 控制思考模式。

**可选值**:
- `adaptive`: 自适应思考（推荐）
- `disabled`: 禁用思考
- `enabled`: 启用思考

**示例**:
```bash
--thinking adaptive
```

**用途**: 控制 Claude 是否在响应前进行内部思考。

---

### --max-thinking-tokens

**格式**: `--max-thinking-tokens <tokens>`

**说明**: 设置思考令牌的最大数量。

**参数**:
- `tokens`: 令牌数量（整数）

**示例**:
```bash
--max-thinking-tokens 10000
```

**用途**: 限制用于思考的令牌数量。

---

### --effort

**格式**: `--effort <level>`

**说明**: 设置努力级别（思考深度）。

**可选值**:
- `low`: 低努力（快速）
- `medium`: 中等努力
- `high`: 高努力（详细）

**示例**:
```bash
--effort high
```

**用途**: 控制 Claude 在任务上投入的努力程度。

---

### --betas

**格式**: `--betas <features>`

**说明**: 启用测试版功能。

**参数**:
- `features`: 逗号分隔的功能名称列表

**示例**:
```bash
--betas feature1,feature2
```

**用途**: 访问实验性功能。

---

## 会话管理参数

### --continue

**格式**: `--continue`

**说明**: 继续上一次会话。

**示例**:
```bash
--continue
```

**用途**: 恢复之前的对话上下文。

---

### --resume

**格式**: `--resume <session-id>`

**说明**: 恢复指定的会话。

**参数**:
- `session-id`: 会话标识符（UUID 格式）

**示例**:
```bash
--resume 1533768f-6f61-4106-bb4c-35906550e071
```

**用途**: 恢复特定的历史会话。

---

### --session-id

**格式**: `--session-id <id>`

**说明**: 设置新会话的 ID。

**参数**:
- `id`: 会话标识符（UUID 格式）

**示例**:
```bash
--session-id $(uuidgen)
```

**用途**: 为新会话指定自定义 ID。

---

### --no-session-persistence

**格式**: `--no-session-persistence`

**说明**: 禁用会话持久化。

**示例**:
```bash
--no-session-persistence
```

**用途**: 会话不会被保存到磁盘。

---

### --fork-session

**格式**: `--fork-session`

**说明**: 从当前会话创建分支。

**示例**:
```bash
--fork-session
```

**用途**: 创建会话的分支副本。

---

### --resume-session-at

**格式**: `--resume-session-at <timestamp>`

**说明**: 在指定时间点恢复会话。

**参数**:
- `timestamp`: 时间戳或消息 ID

**示例**:
```bash
--resume-session-at msg_123456
```

**用途**: 恢复到会话的特定历史点。

---

## 工具与能力参数

### --tools

**格式**: `--tools <tools>`

**说明**: 指定可用工具集。

**参数**:
- `tools`: 逗号分隔的工具列表，或 `default`

**示例**:
```bash
--tools Bash,Read,Write
--tools default
--tools ""  # 禁用所有工具
```

**用途**: 控制哪些工具可用。

---

### --strict-mcp-config

**格式**: `--strict-mcp-config`

**说明**: 严格验证 MCP 配置。

**示例**:
```bash
--strict-mcp-config
```

**用途**: 在启动时严格检查 MCP 配置的有效性。

---

## 系统提示参数

### --append-system-prompt

**格式**: `--append-system-prompt <prompt>`

**说明**: 追加额外的系统提示。

**参数**:
- `prompt`: 要追加的系统提示文本

**示例**:
```bash
--append-system-prompt "## Xcode\n\nYou are currently being called from inside Xcode..."
```

**用途**: 添加特定于环境的指令和上下文。

**Xcode 示例**:
```
## Xcode

You are currently being called from inside Xcode, the IDE for Apple programming languages and platforms. As a result, you should prefer to use tools from the "xcode-tools" MCP server whenever possible.

## Apple Developer Documentation

Use the `DocumentationSearch` MCP command from "xcode-tools" to search for the latest Apple developer documentation...

## Build Commands

Use the `BuildProject` MCP command from "xcode-tools" to build the project.

## Code Style Guidelines

- **Naming**: PascalCase for types, camelCase for properties/methods
- **Properties**: Use `@State private var` for SwiftUI state, `let` for constants
...
```

---

### --agent

**格式**: `--agent <agent-type>`

**说明**: 指定代理类型。

**参数**:
- `agent-type`: 代理类型标识符

**示例**:
```bash
--agent general-purpose
```

**用途**: 使用预配置的代理配置。

---

## 流式与输出参数

### --include-partial-messages

**格式**: `--include-partial-messages`

**说明**: 包含部分消息（流式更新）。

**示例**:
```bash
--include-partial-messages
```

**用途**: 启用细粒度的流式消息更新。

---

### --json-schema

**格式**: `--json-schema <schema>`

**说明**: 指定响应的 JSON Schema。

**参数**:
- `schema`: JSON Schema 对象（字符串格式）

**示例**:
```bash
--json-schema '{"type":"object","properties":{"name":{"type":"string"}}}'
```

**用途**: 强制响应符合特定的 JSON 结构。

---

## 限制与控制参数

### --max-turns

**格式**: `--max-turns <count>`

**说明**: 设置最大对话轮次。

**参数**:
- `count`: 轮次数量（整数）

**示例**:
```bash
--max-turns 10
```

**用途**: 限制对话的长度。

---

### --max-budget-usd

**格式**: `--max-budget-usd <amount>`

**说明**: 设置最大预算（美元）。

**参数**:
- `amount`: 金额（浮点数）

**示例**:
```bash
--max-budget-usd 5.00
```

**用途**: 限制 API 调用成本。

---

## 特殊模式参数

### --proactive

**格式**: `--proactive`

**说明**: 启用主动模式。

**示例**:
```bash
--proactive
```

**用途**: 允许 Claude 主动提供建议。

---

### --assistant

**格式**: `--assistant`

**说明**: 启用助手模式。

**示例**:
```bash
--assistant
```

**用途**: 在助手模式下运行。

---

## 调试参数

### --debug

**格式**: `--debug`

**说明**: 启用调试模式。

**示例**:
```bash
--debug
```

**用途**: 输出详细的调试信息。

---

### --debug-file

**格式**: `--debug-file <path>`

**说明**: 将调试信息写入文件。

**参数**:
- `path`: 调试日志文件路径

**示例**:
```bash
--debug-file /tmp/claude-debug.log
```

**用途**: 将调试输出保存到指定文件。

---

### --debug-to-stderr

**格式**: `--debug-to-stderr`

**说明**: 将调试信息输出到 stderr。

**示例**:
```bash
--debug-to-stderr
```

**用途**: 在控制台中查看调试信息。

---

## 目录与路径参数

### --add-dir

**格式**: `--add-dir <path>`

**说明**: 添加额外的工作目录。

**参数**:
- `path`: 目录路径

**示例**:
```bash
--add-dir /path/to/extra/dir
```

**用途**: 添加额外的搜索和访问目录。

**可多次使用**:
```bash
--add-dir /dir1 --add-dir /dir2 --add-dir /dir3
```

---

## 插件参数

### --plugin-dir

**格式**: `--plugin-dir <path>`

**说明**: 添加插件目录。

**参数**:
- `path`: 插件目录路径

**示例**:
```bash
--plugin-dir /path/to/plugin
```

**用途**: 加载本地插件。

**可多次使用**:
```bash
--plugin-dir /plugin1 --plugin-dir /plugin2
```

---

## 使用场景

### 1. VSCode 集成

```bash
claude \
  --output-format stream-json \
  --input-format stream-json \
  --verbose \
  --permission-prompt-tool stdio \
  --allowedTools Bash,Read,Write,Edit,Glob,Grep \
  --model claude-sonnet-4-6
```

### 2. Xcode 集成

```bash
claude \
  --output-format stream-json \
  --input-format stream-json \
  --verbose \
  --mcp-config /tmp/mcp-config.json \
  --permission-prompt-tool stdio \
  --settings '{"env":{"CLAUDE_CODE_ENABLE_TELEMETRY":"0"}}' \
  --allowedTools mcp__xcode-tools__XcodeGlob,mcp__xcode-tools__XcodeGrep,mcp__xcode-tools__XcodeWrite \
  --include-partial-messages \
  --append-system-prompt "## Xcode\n\nYou are in Xcode..."
```

### 3. 自动化脚本（无交互）

```bash
claude \
  --output-format stream-json \
  --input-format stream-json \
  --verbose \
  --permission-mode acceptEdits \
  --allowedTools Bash,Read,Write \
  --max-turns 5 \
  --no-session-persistence
```

### 4. 调试模式

```bash
claude \
  --output-format stream-json \
  --input-format stream-json \
  --verbose \
  --debug \
  --debug-file /tmp/claude-debug.log \
  --permission-prompt-tool stdio
```

### 5. 继续会话

```bash
claude \
  --output-format stream-json \
  --input-format stream-json \
  --verbose \
  --resume 1533768f-6f61-4106-bb4c-35906550e071
```

### 6. 沙箱环境（无限制）

```bash
claude \
  --output-format stream-json \
  --input-format stream-json \
  --verbose \
  --allow-dangerously-skip-permissions \
  --permission-mode bypassPermissions
```

### 7. 特定模型与预算

```bash
claude \
  --output-format stream-json \
  --input-format stream-json \
  --verbose \
  --model claude-opus-4-6 \
  --fallback-model claude-sonnet-4-6 \
  --max-budget-usd 10.00
```

## 环境变量

除了命令行参数，还可以通过环境变量配置：

### CLAUDE_CODE_ENABLE_TELEMETRY

**说明**: 启用遥测。

**值**: `"0"` 或 `"1"`

```bash
export CLAUDE_CODE_ENABLE_TELEMETRY=0
```

### DISABLE_TELEMETRY

**说明**: 禁用遥测。

**值**: `"0"` 或 `"1"`

```bash
export DISABLE_TELEMETRY=1
```

### DEBUG_CLAUDE_AGENT_SDK

**说明**: 启用 SDK 调试。

**值**: 任意值

```bash
export DEBUG_CLAUDE_AGENT_SDK=1
```

### CLAUDE_CODE_DEBUG_LOG_LEVEL

**说明**: 设置调试日志级别。

**值**: `verbose`, `debug`, `info`, `warn`, `error`

```bash
export CLAUDE_CODE_DEBUG_LOG_LEVEL=debug
```

### CLAUDE_CODE_DEBUG_LOGS_DIR

**说明**: 设置调试日志目录。

**值**: 目录路径

```bash
export CLAUDE_CODE_DEBUG_LOGS_DIR=/tmp/claude-logs
```

### CLAUDE_CODE_SLOW_OPERATION_THRESHOLD_MS

**说明**: 慢操作阈值（毫秒）。

**值**: 毫秒数

```bash
export CLAUDE_CODE_SLOW_OPERATION_THRESHOLD_MS=5000
```

## 参数组合最佳实践

### 1. 最小权限原则

```bash
# 好的做法
--permission-prompt-tool stdio --allowedTools Read,Write

# 避免（除非必要）
--allow-dangerously-skip-permissions
```

### 2. 生产环境配置

```bash
--output-format stream-json \
--input-format stream-json \
--verbose \
--permission-prompt-tool stdio \
--permission-mode default \
--model claude-sonnet-4-6
```

### 3. 开发环境配置

```bash
--output-format stream-json \
--input-format stream-json \
--verbose \
--debug \
--permission-mode acceptEdits \
--model claude-sonnet-4-6
```

### 4. CI/CD 环境

```bash
--output-format stream-json \
--input-format stream-json \
--verbose \
--permission-mode bypassPermissions \
--no-session-persistence \
--max-turns 10 \
--max-budget-usd 5.00
```

## 参数优先级

当同一设置通过多个途径配置时，优先级为：

1. **命令行参数** (最高)
2. **环境变量**
3. **Flag 设置** (`--settings`)
4. **项目设置** (`.claude/settings.json`)
5. **用户设置** (`~/.claude/settings.json`)
6. **默认值** (最低)

## 故障排除

### 1. 参数未生效

**问题**: 设置的参数没有生效

**解决方案**:
- 检查参数拼写
- 确认参数格式正确
- 使用 `--debug` 查看实际配置

### 2. 权限被拒绝

**问题**: 工具执行被拒绝

**解决方案**:
- 确认 `--allowedTools` 包含所需工具
- 检查 `--permission-mode` 设置
- 确认 `--permission-prompt-tool` 配置正确

### 3. MCP 服务器连接失败

**问题**: MCP 服务器无法连接

**解决方案**:
- 检查 `--mcp-config` 文件路径
- 验证 JSON 格式正确
- 使用 `--strict-mcp-config` 验证配置

### 4. 模型不可用

**问题**: 指定的模型不可用

**解决方案**:
- 检查 `--model` 参数值
- 确认有访问该模型的权限
- 设置 `--fallback-model` 作为备用

## 参考资料

- Claude Code 官方文档: https://code.claude.com/docs
- VSCode 扩展源码: `/Users/alwaysking/.vscode/extensions/anthropic.claude-code-2.1.71-darwin-arm64/`
- Stream API 文档: [stream-api.md](./stream-api.md)
