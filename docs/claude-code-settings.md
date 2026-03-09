# Claude Code settings.json 配置指南

## 概述

Claude Code 使用分层的设置系统，在不同层级有多个配置文件。本文档涵盖所有可用的配置选项。

## 配置文件位置

Claude Code 在不同位置存储设置，具有不同的作用域：

| 文件 | 位置 | 作用域 | 用途 |
|------|----------|-------|---------|
| **用户设置** | `~/.claude/settings.json` | 全局 | 用户级偏好设置、MCP 服务器、环境变量 |
| **项目设置** | `<project>/.claude/settings.json` | 项目 | 共享的项目配置（提交到 git） |
| **本地设置** | `<project>/.claude/settings.local.json` | 项目 | 个人项目覆盖配置（gitignore） |
| **凭证** | `~/.claude/.credentials.json` | 全局 | 认证令牌（自动管理） |
| **用户数据** | `~/.claude/.claude.json` | 全局 | 使用统计、历史记录、迁移（自动管理） |

## 配置层级

设置按以下顺序合并（后者覆盖前者）：

1. 默认值
2. 用户设置 (`~/.claude/settings.json`)
3. 项目设置 (`.claude/settings.json`)
4. 本地设置 (`.claude/settings.local.json`)

---

## 完整配置参考

### 1. 环境变量

为 Claude Code 和 MCP 服务器配置环境变量。

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-api-key",
    "ANTHROPIC_BASE_URL": "https://api.anthropic.com",
    "CUSTOM_VAR": "value"
  }
}
```

**键值：**

| 键 | 描述 | 默认值 |
|-----|-------------|---------|
| `ANTHROPIC_AUTH_TOKEN` | API 认证令牌 | - |
| `ANTHROPIC_BASE_URL` | API 端点 URL | `https://api.anthropic.com` |
| `ANTHROPIC_API_KEY` | 替代 API 密钥格式 | - |
| 自定义变量 | 可用于 MCP 服务器和钩子 | - |

---

### 2. 权限

控制工具执行权限和允许的模式。

```json
{
  "permissions": {
    "allow": [
      "Bash(npm *)",
      "Bash(git status)",
      "Read(*)"
    ],
    "deny": [
      "Bash(rm -rf /*)"
    ],
    "defaultMode": "acceptEdits",
    "additionalDirectories": [
      "/path/to/allowed/dir"
    ]
  }
}
```

**键值：**

| 键 | 类型 | 描述 | 默认值 |
|-----|------|-------------|---------|
| `allow` | `string[]` | 自动批准的工具调用模式 | `[]` |
| `deny` | `string[]` | 阻止的工具调用模式 | `[]` |
| `defaultMode` | `string` | 默认权限模式 | `"plan"` |
| `additionalDirectories` | `string[]` | 文件操作的额外目录 | `[]` |

**权限模式：**

| 模式 | 描述 |
|------|-------------|
| `plan` | 始终请求确认（最安全） |
| `acceptEdits` | 自动批准文件编辑，询问 bash 命令 |
| `accept` | 自动批准大多数操作 |

**模式语法：**

```
ToolName(pattern)     - 匹配工具和参数模式
Bash(npm *)          - 以 "npm " 开头的 Bash 命令
Bash(git *)          - 所有 git 命令
Read(*)              - 所有 Read 操作
Read(//path/**)      - 从特定路径模式读取
Edit(file.js)        - 编辑特定文件
```

---

### 3. MCP 服务器

配置模型上下文协议服务器以扩展功能。

```json
{
  "mcpServers": {
    "server-name": {
      "command": "npx",
      "args": ["-y", "package@latest"],
      "env": {
        "API_KEY": "your-key"
      },
      "type": "stdio",
      "disabled": false
    }
  }
}
```

**服务器配置：**

| 键 | 类型 | 必需 | 描述 |
|-----|------|----------|-------------|
| `command` | `string` | 是 | 可执行命令 |
| `args` | `string[]` | 否 | 命令参数 |
| `env` | `object` | 否 | 环境变量 |
| `type` | `string` | 否 | 连接类型：`"stdio"` 或 `"sse"` |
| `disabled` | `boolean` | 否 | 禁用服务器而不删除配置 |
| `cwd` | `string` | 否 | 工作目录 |
| `url` | `string` | SSE | SSE 连接的服务器 URL |
| `instructions` | `string` | 否 | 自定义服务器指令 |

**OAuth 配置（用于 SSE 服务器）：**

```json
{
  "mcpServers": {
    "remote-server": {
      "type": "sse",
      "url": "https://api.example.com/mcp",
      "oauth": {
        "authServerMetadataUrl": "https://auth.example.com/.well-known/oauth-authorization-server"
      }
    }
  }
}
```

---

### 4. 沙箱设置

配置安全沙箱以进行隔离执行。

```json
{
  "sandbox": {
    "enableWeakerNetworkIsolation": true
  }
}
```

| 键 | 类型 | 描述 | 平台 |
|-----|------|-------------|----------|
| `enableWeakerNetworkIsolation` | `boolean` | 允许 Go 程序使用 MITM 代理验证 TLS | 仅 macOS |

---

### 5. 模型选择

配置默认模型和模型行为。

```json
{
  "model": "claude-sonnet-4-6",
  "effort": "medium"
}
```

| 键 | 类型 | 描述 | 选项 |
|-----|------|-------------|---------|
| `model` | `string` | 默认模型标识符 | 见下方模型 |
| `effort` | `string` | 思考努力级别 | `"low"`, `"medium"`, `"high"` |

**可用模型：**

| 模型 ID | 名称 |
|----------|------|
| `claude-sonnet-4-6` | Claude Sonnet 4.6（默认） |
| `claude-opus-4-6` | Claude Opus 4.6 |
| `claude-haiku-4-5-20251001` | Claude Haiku 4.5 |
| `claude-sonnet-4-20250514` | Claude Sonnet 4 |
| `claude-opus-4-20250514` | Claude Opus 4 |

#### 模型配置优先级

模型选择可以通过多种方式配置，优先级从高到低：

| 优先级 | 配置方式 | 说明 |
|--------|----------|------|
| 1 (最高) | `--model` CLI 参数 | 命令行指定，立即生效 |
| 2 | `ANTHROPIC_MODEL` 环境变量 | 强制覆盖配置文件设置 |
| 3 | `settings.json` 的 `model` | 默认偏好设置 |
| 4 (最低) | `ANTHROPIC_DEFAULT_*_MODEL` | Fallback 默认值 |

**环境变量说明：**

| 变量 | 用途 |
|------|------|
| `ANTHROPIC_MODEL` | 通用覆盖变量，设置后忽略 settings.json 中的 model |
| `ANTHROPIC_DEFAULT_SONNET_MODEL` | 当需要 Sonnet 但未指定具体版本时的默认值 |
| `ANTHROPIC_DEFAULT_OPUS_MODEL` | 当需要 Opus 但未指定具体版本时的默认值 |
| `ANTHROPIC_DEFAULT_HAIKU_MODEL` | 当需要 Haiku 但未指定具体版本时的默认值 |
| `ANTHROPIC_SMALL_FAST_MODEL` | 后台任务使用的快速模型（通常是 Haiku） |

**使用场景示例：**

```bash
# 临时切换到 Opus 模型（不修改配置文件）
export ANTHROPIC_MODEL=claude-opus-4-6

# 设置特定版本的 Sonnet 作为默认
export ANTHROPIC_DEFAULT_SONNET_MODEL=claude-sonnet-4-20250514

# 设置后台任务使用的快速模型
export ANTHROPIC_SMALL_FAST_MODEL=claude-haiku-4-5-20251001
```

**配置关系总结：**

| 配置 | 含义 |
|------|------|
| `--model` | "我现在就要用这个"（最高优先级） |
| `ANTHROPIC_MODEL` | "这次会话都用这个，忽略配置文件" |
| `settings.json` 的 model | "这是我的默认偏好" |
| `DEFAULT_*` 变量 | "如果都没指定，用这个兜底" |

---

### 6. 语音模式

配置语音输入设置。

```json
{
  "voiceEnabled": true,
  "voiceLanguage": "en-US"
}
```

| 键 | 类型 | 描述 |
|-----|------|-------------|
| `voiceEnabled` | `boolean` | 启用语音输入 |
| `voiceLanguage` | `string` | STT 语言代码 |

**支持的语言（共 20 种）：**
- 英语 (en-US)、中文 (zh-CN)、日语 (ja)、韩语 (ko)
- 德语 (de-DE)、法语 (fr-FR)、西班牙语 (es-ES)、意大利语 (it-IT)
- 葡萄牙语 (pt-BR)、俄语、波兰语、土耳其语、荷兰语
- 乌克兰语、希腊语、捷克语、丹麦语、瑞典语、挪威语

---

### 7. 钩子

配置生命周期钩子以执行自定义操作。

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "command": "/path/to/script.sh",
        "timeout": 5000
      }
    ],
    "PostToolUse": [
      {
        "command": "notify-send 'Tool completed'"
      }
    ],
    "Notification": [
      {
        "command": "echo 'Notification received'"
      }
    ]
  }
}
```

**钩子事件：**

| 事件 | 描述 |
|-------|-------------|
| `PreToolUse` | 工具执行前 |
| `PostToolUse` | 工具执行后 |
| `Notification` | Claude 发送通知时 |
| `Status` | 状态行更新 |
| `InstructionsLoaded` | CLAUDE.md 文件加载时 |

**钩子配置：**

| 键 | 类型 | 描述 | 默认值 |
|-----|------|-------------|---------|
| `command` | `string` | 要执行的命令 | 必需 |
| `timeout` | `number` | 超时时间（毫秒） | 5000 |

---

### 8. Git 指令

控制内置 git 工作流指令。

```json
{
  "includeGitInstructions": false
}
```

| 键 | 类型 | 描述 | 默认值 |
|-----|------|-------------|---------|
| `includeGitInstructions` | `boolean` | 在系统提示中包含 git 工作流指令 | `true` |

**环境变量替代：**
```bash
CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS=1
```

---

### 9. 自动更新

控制自动更新行为。

```json
{
  "autoUpdates": false
}
```

| 键 | 类型 | 描述 | 默认值 |
|-----|------|-------------|---------|
| `autoUpdates` | `boolean` | 启用自动更新 | `true` |

---

### 10. 快捷键

自定义键盘快捷键。

位置：`~/.claude/keybindings.json`

```json
{
  "voice:pushToTalk": "space",
  "submit": "enter",
  "newLine": "shift+enter"
}
```

---

### 11. 插件设置

插件信任和市场设置。

```json
{
  "pluginTrustMessage": "Custom trust warning message",
  "strictKnownMarketplaces": [
    {
      "hostPattern": "github\\.com/your-org/.*"
    },
    {
      "pathPattern": "/allowed/path/.*"
    }
  ]
}
```

| 键 | 类型 | 描述 |
|-----|------|-------------|
| `pluginTrustMessage` | `string` | 信任对话框中的自定义消息 |
| `strictKnownMarketplaces` | `array` | 允许的插件来源 |

---

### 12. 项目特定设置

存储在 `.claude.json` 备份中的每个项目配置。

```json
{
  "projects": {
    "/path/to/project": {
      "allowedTools": [],
      "disabledMcpjsonServers": [],
      "enabledMcpjsonServers": [],
      "mcpServers": {},
      "mcpContextUris": [],
      "exampleFiles": ["file1.js", "file2.go"],
      "hasTrustDialogAccepted": true
    }
  }
}
```

---

## 示例配置

### 最小用户设置

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-api-key"
  },
  "permissions": {
    "defaultMode": "acceptEdits"
  }
}
```

### 开发导向设置

```json
{
  "env": {
    "ANTHROPIC_AUTH_TOKEN": "your-key"
  },
  "permissions": {
    "allow": [
      "Bash(npm *)",
      "Bash(npx *)",
      "Bash(node *)",
      "Bash(bun *)",
      "Bash(git *)",
      "Bash(ls *)",
      "Bash(cat *)",
      "Bash(mkdir *)",
      "Read(*)",
      "Write(*)",
      "Edit(*)",
      "Glob(*)",
      "Grep(*)"
    ],
    "additionalDirectories": [
      "~/projects/shared-lib"
    ]
  },
  "mcpServers": {
    "filesystem": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-filesystem", "/path/to/project"]
    }
  }
}
```

### 企业/安全设置

```json
{
  "env": {
    "ANTHROPIC_BASE_URL": "https://your-proxy.company.com"
  },
  "permissions": {
    "defaultMode": "plan",
    "deny": [
      "Bash(rm -rf /*)",
      "Bash(curl * | *)",
      "Bash(wget * | bash)"
    ],
    "allow": [
      "Read(//company-projects/**)",
      "Bash(git status)",
      "Bash(git diff *)"
    ]
  },
  "includeGitInstructions": true,
  "autoUpdates": false,
  "strictKnownMarketplaces": [
    {
      "hostPattern": "github\\.com/company/.*"
    }
  ]
}
```

### 配合 MCP 服务器

```json
{
  "mcpServers": {
    "obsidian": {
      "command": "uvx",
      "args": ["mcp-obsidian"],
      "env": {
        "OBSIDIAN_API_KEY": "your-key"
      }
    },
    "github": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-github"],
      "env": {
        "GITHUB_TOKEN": "ghp_xxx"
      }
    },
    "postgres": {
      "command": "npx",
      "args": ["-y", "@anthropic/mcp-server-postgres"],
      "env": {
        "DATABASE_URL": "postgresql://..."
      }
    }
  }
}
```

### 配合钩子

```json
{
  "hooks": {
    "PostToolUse": [
      {
        "command": "osascript -e 'display notification \"Tool completed\" with title \"Claude Code\"'"
      }
    ],
    "Notification": [
      {
        "command": "terminal-notifier -title 'Claude Code' -message '$CLAUDE_NOTIFICATION'"
      }
    ]
  }
}
```

---

## 环境变量

设置也可以通过环境变量配置：

| 变量 | 等效设置 |
|----------|-------------------|
| `ANTHROPIC_API_KEY` | `env.ANTHROPIC_API_KEY` |
| `ANTHROPIC_AUTH_TOKEN` | `env.ANTHROPIC_AUTH_TOKEN` |
| `ANTHROPIC_BASE_URL` | `env.ANTHROPIC_BASE_URL` |
| `CLAUDE_CODE_DISABLE_GIT_INSTRUCTIONS` | `includeGitInstructions: false` |

---

## 相关文件

| 文件 | 用途 |
|------|---------|
| `.claude.json` | 自动管理的用户数据（统计、历史） |
| `.credentials.json` | OAuth 令牌和认证 |
| `MEMORY.md` | 项目记忆，用于上下文持久化 |
| `CLAUDE.md` | 项目指令和文档 |
| `keybindings.json` | 键盘快捷键自定义 |
| `.mcp.json` | 项目级 MCP 服务器配置 |

---

## 调试

查看当前设置：
```bash
claude config list
```

在编辑器中打开设置：
```bash
claude config edit
```

启用调试日志：
```bash
claude --debug
# 或在会话中使用 /debug 命令
```

---

**文档版本**: 基于 Claude Code 2.1.71
**最后更新**: 2026-03-09

如需最新更新，请使用 `/changelog` 查看更新日志或访问官方文档：https://code.claude.com/docs