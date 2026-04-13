# CCGUI 任务系统设计文档

## 1. 概述

CCGUI 任务系统基于项目目录下的 `task.md` 文件，提供任务的可视化管理和自动化执行能力。通过 MCP 协议建立 CCGUI 与各 Session 之间的通讯通道，实现任务状态汇报、跨 Session 消息传递等功能。

### 核心概念

- **task.md**：项目根目录下的任务定义文件，人类可读、机器可解析
- **MCP Server**：CCGUI 内置的 MCP 服务，作为所有 Session 的通讯枢纽
- **MCP Bridge**：CLI 侧的 MCP 进程，桥接 CLI（stdio）与 CCGUI MCP Server（unix socket）
- **模板**：预定义的 prompt 模板，用于指导 Session 执行特定类型的任务

---

## 2. 整体架构

```
CCGUI (Electron)
  │
  ├── MCP Server（监听 /tmp/ccgui-{pid}.sock）
  │     ├── 管理所有已注册的 Session 身份信息
  │     ├── 处理 MCP tool calls（状态汇报、消息转发）
  │     └── 维护消息路由和队列
  │
  ├── Task Manager
  │     ├── 解析/写回 task.md
  │     └── 管理任务状态（pending / running / completed / error）
  │
  ├── List / Board 视图
  │     ├── 任务列表和看板展示
  │     └── 启动、暂停、查看任务操作
  │
  ├── Session A（Task #1）
  │     └── MCP Bridge
  │           ├── ←stdio→ CLI（标准 MCP stdio）
  │           └── ←unix socket→ CCGUI MCP Server
  │
  └── Session B（Task #2）
        └── MCP Bridge
              ├── ←stdio→ CLI
              └── ←unix socket→ CCGUI MCP Server
```

---

## 3. 通讯模型

### 3.1 通讯通道

| 方向 | 通道 | 说明 |
|------|------|------|
| CLI → CCGUI | MCP tool call | Session 主动调用 MCP 工具，可靠 |
| CCGUI → CLI | 现有 sendMessage（模拟用户消息） | 复用已有 stdin 管道，可靠 |
| Session → Session | MCP → CCGUI → sendMessage 转发 | 两段都可靠 |

### 3.2 CLI → CCGUI（MCP tool calls）

Session 通过 MCP Bridge 调用工具，MCP Bridge 通过 unix socket 转发给 CCGUI MCP Server。

提供的工具：

```
report_task_status(task_id, status, message)
  - status: "completed" | "error" | "needs_info" | "progress"
  - Session 主动汇报任务状态

get_task_info(task_id)
  - 返回任务的描述、依赖、验收标准等

send_to_session(target_session_id, message)
  - 向另一个 Session 发送消息
  - 消息经 CCGUI 路由转发

request_help(reason)
  - 请求用户协助，CCGUI 弹出通知
  
get_team_number(team_id)
  - 返回当前team的成员信息和状态
```

### 3.3 CCGUI → CLI（模拟用户消息）

CCGUI 收到需要传递给 Session 的消息后，直接调用现有的 `sendMessage` 机制注入：

```
CCGUI 收到需要转发的消息
  │
  ├─ 目标 Session 空闲 → 直接 sendMessage
  │
  └─ 目标 Session 忙碌 → 加入待发送队列
                          Session 处理完当前消息后自动发送下一条
```

消息队列复用现有的 `pendingPermissions` 队列模式。

### 3.4 初始化流程

```
1. CCGUI 启动时
   ├── 启动 MCP Server，监听 /tmp/ccgui-{pid}.sock

2. CCGUI 创建 Task Session 时
   ├── 生成 Session 身份信息：
   │     session_id, project_path, team_name, team_role, task_id
   ├── CLI 启动参数中包含：
   │     --mcp-config 或通过环境变量传递 MCP Bridge 的启动配置
   └── MCP Bridge 启动参数包含：
         --socket-path /tmp/ccgui-{pid}.sock
         --session-id <id>
         --task-id <task_id>
         --team-id <team_id>
         --team-name <name>
         --team-role <role>

3. MCP Bridge 启动后
   ├── 通过 unix socket 连接 CCGUI MCP Server
   ├── 注册身份信息
   └── 等待 CLI 的 stdio 通讯

4. CLI 通过 MCP 发现可用工具
   └── Claude 获知 report_task_status 等工具，可在执行中调用
```

---

## 4. task.md 格式定义

### 4.1 格式规范

```markdown
# 项目任务

## TASK-001: 实现用户登录页面

- **status**: pending
- **priority**: high
- **assignee**: -
- **template**: feature-dev
- **design-doc**: plain/TASK-001-登录页设计.md
- **session**: null
- **created**: 2026-04-13
- **updated**: 2026-04-13

### 描述

实现一个包含邮箱密码登录的页面，支持表单验证和错误提示。

### 设计文档

- [登录页交互与视觉设计](plain/TASK-001-登录页设计.md)

### 验收标准

- [ ] 邮箱格式验证
- [ ] 密码强度提示
- [ ] 登录失败错误提示
- [ ] Loading 状态

### 依赖

- TASK-000（项目初始化）

---

## TASK-002: 实现用户注册 API

- **status**: pending
- **priority**: medium
- **template**: api-dev
- **design-doc**: -
- **session**: null
- **created**: 2026-04-13
- **updated**: 2026-04-13

### 描述

实现注册接口，包含参数校验和密码加密。
```

### 4.2 状态定义

| 状态 | 含义 |
|------|------|
| `pending` | 未开始 |
| `running` | 进行中，已关联 Session |
| `completed` | 已完成 |
| `error` | 异常，需要人工介入 |

### 4.3 设计文档引用约定

- 使用元数据字段 `- **design-doc**: <path>` 表示任务绑定的设计文档路径
- 路径默认相对于项目根目录，推荐引用 `plain/` 目录下的 Markdown 文档
- 无设计文档时使用 `-` 或省略该字段
- 如果需要同时保留可读链接，可在任务正文增加 `### 设计文档` 段落
- `design-doc` 是机器读取的主字段，`### 设计文档` 是面向人类阅读的补充展示

### 4.4 解析规则

- 每个任务以 `## TASK-{NNN}: {标题}` 开头
- 元数据为 `- **key**: value` 格式的列表
- `### 描述`、`### 验收标准`、`### 依赖` 为固定子段落
- `### 设计文档` 为可选子段落，用于展示链接或补充说明
- 解析器优先读取 `design-doc` 元数据作为结构化字段
- 若存在 `### 设计文档` 段落，可将其原文保留在任务详情中，但不作为主数据源
- 任务之间以 `---` 分隔
- 解析时保留原文格式，写回时不能丢失自定义内容

---

## 5. MCP Server 设计

### 5.1 传输方式

- **Unix Socket**：`/tmp/ccgui-{pid}.sock`
- **协议**：JSON-RPC 2.0 over socket
- **连接管理**：每个 MCP Bridge 建立一个持久连接

### 5.2 内部数据结构

```javascript
// MCP Server 维护的状态
{
  // 已注册的 Session
  sessions: Map<session_id, {
    socket: Socket,
    identity: {
      session_id: string,
      project_path: string,
      task_id: string | null,
      team_name: string | null,
      team_role: string | null,
    },
    connected_at: Date,
  }>,

  // 待发送消息队列
  messageQueue: Map<session_id, Message[]>,

  // 任务状态缓存
  taskStatus: Map<task_id, {
    status: string,
    message: string,
    updated_at: Date,
  }>

  // 任务结构化信息缓存
  taskMeta: Map<task_id, {
    design_doc: string | null,
  }>
}
```

### 5.3 MCP Bridge 设计

MCP Bridge 是一个轻量的 Node.js 进程，职责：

1. 作为 CLI 的 MCP Server（stdio 传输）
2. 作为 CCGUI MCP Server 的 Client（unix socket 传输）
3. 双向转发 JSON-RPC 消息
4. 处理身份注入（启动参数 → register 调用）

```
CLI ←──stdio──→ MCP Bridge ←──unix socket──→ CCGUI MCP Server
     (MCP stdio)       (协议转换)           (JSON-RPC over socket)
```

---

## 6. UI 设计

### 6.1 任务列表视图（List View）

```
┌─────────────────────────────────────────────────────┐
│  任务管理                              [列表] [看板]  │
├─────────────────────────────────────────────────────┤
│  筛选: [全部 ▾]  优先级: [全部 ▾]  搜索: [______]    │
├──────┬──────────────────┬────────┬──────┬───────────┤
│ 编号 │ 任务名称          │ 优先级  │ 状态 │ 操作       │
├──────┼──────────────────┼────────┼──────┼───────────┤
│ 001  │ 实现用户登录页面   │ 高     │ ● 未  │ 设计│[▶ 启动]│
│ 002  │ 实现注册 API       │ 中     │ ● 未  │    │[▶ 启动]│
│ 003  │ 编写单元测试       │ 低     │ ● 进  │ 设计│[📋 查看]│
│ 004  │ 部署配置          │ 中     │ ● 完  │    │[📋 查看]│
│ 005  │ 性能优化          │ 高     │ ● 异  │ 设计│[↻ 重试]│
└──────┴──────────────────┴────────┴──────┴───────────┘
```

- 列表中增加“设计”标记列，存在 `design-doc` 时展示 `设计`
- 点击“设计”标记或详情中的文档路径，可直接打开对应 Markdown 文档

### 6.2 任务看板视图（Board View）

```
┌──────────────┬──────────────┬──────────────┬──────────────┐
│   未开始 (3)  │  进行中 (1)  │  已完成 (1)  │   异常 (1)   │
├──────────────┼──────────────┼──────────────┼──────────────┤
│ ┌──────────┐ │ ┌──────────┐ │ ┌──────────┐ │ ┌──────────┐ │
│ │ TASK-001 │ │ │ TASK-003 │ │ │ TASK-004 │ │ │ TASK-005 │ │
│ │ 登录页面  │ │ │ 单元测试  │ │ │ 部署配置  │ │ │ 性能优化  │ │
│ │ 优先级:高 │ │ │ 优先级:低 │ │ │ 优先级:中 │ │ │ 优先级:高 │ │
│ │ [▶ 启动] │ │ │ [📋 查看]│ │ │ [📋 查看]│ │ │ [↻ 重试] │ │
│ └──────────┘ │ └──────────┘ │ └──────────┘ │ └──────────┘ │
│ ┌──────────┐ │              │              │              │
│ │ TASK-002 │ │              │              │              │
│ │ 注册 API │ │              │              │              │
│ │ 优先级:中 │ │              │              │              │
│ │ [▶ 启动] │ │              │              │              │
│ └──────────┘ │              │              │              │
└──────────────┴──────────────┴──────────────┴──────────────┘
```

### 6.3 任务启动流程

```
用户点击 [▶ 启动]
  │
  ├─ 1. 弹出模板选择对话框
  │     ┌─────────────────────────────┐
  │     │  选择启动模板                │
  │     │                             │
  │     │  ○ feature-dev  功能开发     │
  │     │  ○ api-dev      接口开发     │
  │     │  ○ bugfix       缺陷修复     │
  │     │  ○ refactor     代码重构     │
  │     │  ○ 自定义 prompt            │
  │     │                             │
  │     │  权限模式: [默认 ▾]          │
  │     │                             │
  │     │        [取消]   [启动]       │
  │     └─────────────────────────────┘
  │
  ├─ 2. 创建 Session，注入身份信息和 MCP 配置
  │
  ├─ 3. 更新 task.md：status → running，session → session_id
  │
  └─ 4. 自动发送模板消息给 Session
        "你正在执行 TASK-001：实现用户登录页面
         关联设计文档：plain/TASK-001-登录页设计.md
         [模板内容]
         完成后请使用 report_task_status 工具报告结果。"
```

### 6.4 任务详情面板

点击任务卡片/行时展开或弹窗：

```
┌─────────────────────────────────────┐
│  TASK-001: 实现用户登录页面           │
│  状态: 进行中    优先级: 高           │
│  Session: session-abc123            │
│  设计文档: plain/TASK-001-登录页设计.md│
│  创建: 2026-04-13                   │
│  更新: 2026-04-13 14:30             │
├─────────────────────────────────────┤
│  描述                               │
│  实现一个包含邮箱密码登录的页面...      │
│                                     │
│  设计文档                           │
│  [登录页交互与视觉设计]              │
│                                     │
│  验收标准                           │
│  ☐ 邮箱格式验证                     │
│  ☐ 密码强度提示                     │
│  ☐ 登录失败错误提示                  │
├─────────────────────────────────────┤
│  Session 日志                       │
│  14:30 启动任务                      │
│  14:35 正在实现表单组件...            │
│  14:40 report_task_status: progress │
├─────────────────────────────────────┤
│  [📋 跳转Session] [⏸ 暂停] [⏹ 终止] │
└─────────────────────────────────────┘
```

---

## 7. 模板系统

### 7.1 模板定义

模板存储在 CCGUI 配置目录下：`~/.ccgui/templates/{template-name}.md`

### 7.2 模板格式

```markdown
---
name: feature-dev
description: 功能开发模板
version: 1.0
---

# 功能开发任务

你正在执行一个功能开发任务。

## 任务信息

- 任务编号: {{task_id}}
- 任务标题: {{task_title}}
- 任务描述: {{task_description}}
- 关联设计文档: {{task_design_doc}}

## 设计约束

{{task_design_doc_content}}

## 验收标准

{{task_criteria}}

## 执行指引

1. 先阅读相关的现有代码，了解上下文
2. 制定实现方案，说明你的计划
3. 按计划逐步实现
4. 确保所有验收标准都满足

## 状态汇报

- 开始执行时，调用 report_task_status("progress", "开始执行")
- 关键里程碑时，调用 report_task_status("progress", "里程碑描述")
- 完成时，调用 report_task_status("completed", "完成摘要")
- 遇到无法解决的问题时，调用 report_task_status("error", "错误描述")
```

### 7.3 模板变量

| 变量 | 来源 |
|------|------|
| `{{task_id}}` | task.md 中的任务编号 |
| `{{task_title}}` | task.md 中的任务标题 |
| `{{task_description}}` | task.md 中的描述段落 |
| `{{task_design_doc}}` | `design-doc` 元数据中的文档路径，没有则为 `-` |
| `{{task_design_doc_content}}` | 设计文档摘要或原文引用，没有则为空 |
| `{{task_criteria}}` | task.md 中的验收标准段落 |
| `{{task_dependencies}}` | task.md 中的依赖段落 |

---

## 8. 实施计划

### Phase 1：基础能力

**目标**：task.md 解析 + MCP 通讯基础

- [ ] task.md 格式定义和解析器（Parser）
- [ ] task.md 写回逻辑（Writer，保留自定义内容）
- [ ] MCP Server（CCGUI 侧）
  - [ ] Unix socket 监听
  - [ ] Session 注册和身份管理
  - [ ] `report_task_status` 工具实现
  - [ ] `get_task_info` 工具实现
- [ ] MCP Bridge（CLI 侧）
  - [ ] stdio ↔ unix socket 双向转发
  - [ ] 身份注入（启动参数 → 注册）
  - [ ] CLI 启动参数集成

### Phase 2：UI 和任务管理

**目标**：可视化任务管理

- [ ] Task Store（Pinia）
  - [ ] 任务列表状态管理
  - [ ] task.md 文件监听（watch）
  - [ ] 任务 CRUD 操作
- [ ] List 视图
  - [ ] 任务列表展示
  - [ ] 筛选、搜索、排序
- [ ] Board 视图
  - [ ] 四列看板
  - [ ] 任务卡片
  - [ ] 状态流转
- [ ] 任务详情面板
  - [ ] 任务信息展示
  - [ ] Session 日志

### Phase 3：任务执行

**目标**：一键启动任务

- [ ] 模板系统
  - [ ] 模板存储和管理
  - [ ] 模板变量替换
  - [ ] 模板选择 UI
- [ ] 任务启动流程
  - [ ] 创建 Task Session（注入身份和 MCP 配置）
  - [ ] 更新 task.md 状态
  - [ ] 自动发送模板消息
- [ ] 状态反馈
  - [ ] 监听 MCP `report_task_status` 调用
  - [ ] 自动更新任务状态
  - [ ] 任务完成/异常通知

### Phase 4：跨 Session 通讯

**目标**：三方通讯

- [ ] `send_to_session` 工具实现
- [ ] 消息路由（CCGUI 中转）
- [ ] 消息队列（忙碌 Session 排队）
- [ ] `request_help` 工具和通知
- [ ] 任务依赖自动触发（前置任务完成 → 自动启动后续任务）

---

## 9. 技术细节备忘

### 9.1 MCP Bridge 作为 CLI 的 MCP Server

CLI 通过 stdio 与 MCP Bridge 通讯，MCP Bridge 需要完整实现 MCP Server 协议：

```
CLI 发送 tools/list → MCP Bridge 返回工具列表
CLI 发送 tools/call → MCP Bridge 转发到 CCGUI → 返回结果
```

### 9.2 Unix Socket 协议

CCGUI MCP Server 与 MCP Bridge 之间使用简化协议：

```json
// 请求
{ "type": "tool_call", "tool": "report_task_status", "arguments": {...}, "request_id": "xxx" }

// 响应
{ "type": "tool_response", "request_id": "xxx", "result": {...} }

// 注册
{ "type": "register", "identity": { "session_id": "...", "task_id": "...", ... } }
```

### 9.3 文件监听

- 使用 `chokidar` 或 `fs.watch` 监听 task.md 变化
- 外部编辑时自动重新解析
- CCGUI 写入时跳过触发（通过标志位）

### 9.4 错误处理

- Session 进程意外退出 → 任务标记为 error
- MCP Bridge 连接断开 → 清理注册信息，任务标记为 error
- task.md 格式错误 → 忽略错误任务，展示可解析的部分
- 模板变量缺失 → 使用空字符串替代
