# CCGUI Agent Orchestration Adapter Guide

这份文档是 [agent-orchestration-semantics.md](/Users/alwaysking/AKProject/CCGUI/docs/agent-orchestration-semantics.md) 的实现指南。

它只回答一个问题：`ClaudeAdapter` / `CodexAdapter` 应该如何把原始流收敛成 CCGUI 统一的 agent 语义。

## 目的

- 不在 adapter 里泄露 provider 原始关联字段
- 不在不同 provider 上各自发明一套消息属性
- 把 `agentId`、`agentKind`、`agentType`、`start / end / delete`、`actorId / targetId` 落成统一结果
- 让 store 和 UI 只消费统一语义，不再理解原始协议细节

## 输入输出边界

### 输入

adapter 只接收 provider 原始流，例如：

- Claude `stream_event`
- Claude `system` 事件
- Claude `tool_use_result`
- Codex `turn/*`
- Codex `item/*`
- Codex `thread/*`

### 输出

adapter 只输出 CCGUI 统一语义：

- `Agent Registry` 条目
- `Orchestration Event`
- `Message Attribution`

## 1. Agent Registry 落地规则

### 1.1 什么时候创建 registry 条目

当 adapter 能确认一个代理实体已经存在时，就应写入 registry。

典型触发点：

- Claude subagent 的 `Agent` 启动成功
- Claude agent team 的 `TeamCreate` / teammate spawn 成功
- Codex 子线程/子代理被 `spawnAgent` 建立成功

### 1.2 registry 条目应包含什么

建议最少包含：

- `agentId`
- `agentKind`
- `agentType`
- `name`
- `prompt`
- `model`
- `teamId`
- `parentAgentId`
- `status`

如果原始流里没有某个字段，允许留空，不要硬造。

### 1.3 `agentKind` 如何填

#### `execution`

用于一次性、任务驱动、偏执行型的代理。

典型来源：

- Claude 普通 subagent

#### `collaborative`

用于持续协作、可收发消息、可视作协作成员的代理。

典型来源：

- Claude agent team member
- Codex subagent

### 1.4 `agentType` 如何填

`agentType` 是具体角色/模板名，不是工作模式。

建议映射：

- Claude team lead -> `team-lead`
- Claude member role -> 原始 `name` 或 provider 角色名
- Claude subagent -> 原始 `subagent_type` / 角色名 / 适配后模板名
- Codex child agent -> provider 侧具体模板名

如果 provider 没有稳定细分类型，就用可解释的归一化名称，不要留空泛占位。

## 2. Orchestration Event 落地规则

### 2.1 `start`

`start` 是代理实体被确认创建并开始工作的时刻。

#### 必须写入的字段

- `eventType: "start"`
- `agentId`
- `agentKind`
- `timestamp`

#### 尽量写入的字段

- `agentType`
- `name`
- `prompt`
- `model`
- `teamId`
- `parentAgentId`
- `source`

#### 适配 Claude subagent

典型做法：

- 监听外层 `Agent` tool use
- 等待 `task_started`
- 以 `tool_use_result.agentId` 或等效字段建立 `agentId`
- 将外层 tool use 的 prompt、description、name 等信息收进 `start`

#### 适配 Claude agent team

典型做法：

- `TeamCreate` 形成 team 实体
- teammate spawn 形成成员实体
- `start` 要带成员的 `name`、`prompt`、`model`、`teamId`
- 如果 team lead 与 member 分离，lead 也应有自己的 registry / start 事件

#### 适配 Codex subagent

典型做法：

- 在 `spawnAgent` 或等价事件处创建 registry
- 用 child `threadId` 作为后续归属依据
- `start` 里保留 `name`、`prompt`、`model`、`parentAgentId`

### 2.2 `end`

`end` 表示当前工作生命周期结束。

#### 必须写入的字段

- `eventType: "end"`
- `agentId`
- `timestamp`

#### 建议写入的字段

- `reason`
- `result`
- `status`

#### 适配建议

- Claude subagent 的结果完成后发 `end`
- Claude team member 完成当前轮任务后发 `end`
- Codex child thread 完成当前 turn 后发 `end`

### 2.3 `delete`

`delete` 表示对象被显式清理。

#### 必须写入的字段

- `eventType: "delete"`
- `agentId`
- `timestamp`

#### 建议写入的字段

- `reason`
- `targetKind`
- `status`

#### 适配建议

- team cleanup / TeamDelete 归入 `delete`
- 代理退出、显式销毁、成员清理归入 `delete`

## 3. Message Attribution 落地规则

### 3.1 基本原则

- 普通消息只需要 `agentId`
- 不要在每条消息上重复写 `agentKind`
- 如果是方向性动作，再写 `actorId` 和 `targetId`

### 3.2 统一填法

#### 代理自身发言或工具调用

- `agentId = actorId = 自己`
- `targetId` 省略

#### team lead 向成员发消息

- `agentId = actorId = team lead`
- `targetId = 成员 agentId`

#### team lead 广播给 team

- `agentId = actorId = team lead`
- `targetId = teamId`

#### 创建动作

- `agentId = 被创建代理的 ID`
- `actorId = 创建者 ID`
- `targetId` 可省略

#### 删除动作

- `agentId = 被删除实体的 ID`
- `actorId = 触发删除的实体 ID`
- `targetId = 被删除实体的 ID`

### 3.3 适配 Claude team 的特殊点

Claude team 的 `SendMessage` 结果里通常能直接拿到：

- `routing.sender`
- `routing.target`
- `recipients`

adapter 应把这些字段归一成：

- `actorId`
- `targetId`

不要把 `routing.*` 向上透传成统一语义主字段。

### 3.4 适配 Codex 的特殊点

Codex 的子代理归属通常依赖：

- `spawnAgent`
- `receiverThreadIds`
- `threadId`

adapter 应在内部完成线程归属，再输出统一 `agentId`。

## 4. 事件到字段映射表

### 4.1 Claude subagent

| 原始事件 | 统一输出 |
|---|---|
| `Agent` tool use | 候选 `start` / registry |
| `task_started` | `start` |
| 子消息 `tool_use` | `agentId` 归属 |
| 子消息 `tool_result` | `agentId` 归属 |
| 完成结果 | `end` |

### 4.2 Claude agent team

| 原始事件 | 统一输出 |
|---|---|
| `TeamCreate` | team registry / `start` |
| teammate spawn success | member registry / `start` |
| `SendMessage` | `actorId` / `targetId` |
| 成员消息 / 工具使用 | `agentId` 归属 |
| `TeamDelete` | `delete` |

### 4.3 Codex subagent

| 原始事件 | 统一输出 |
|---|---|
| `spawnAgent` | registry / `start` |
| `turn/started` | `start` |
| `item/agentMessage/*` | `agentId` 归属 |
| `commandExecution` | `agentId` 归属 |
| `turn/completed` | `end` |

## 5. 不能做的事

- 不要把 `parent_tool_use_id`、`threadId`、`receiverThreadIds`、`routing.target` 直接暴露到统一语义主层
- 不要让不同 provider 的原始字段名字成为 UI 依赖
- 不要把 `agentKind` 复制到每条消息上
- 不要把 `status` 当成原始真值，它只是 registry 的材料化状态

## 6. 最终验收标准

如果 adapter 产出的数据满足以下条件，就算符合本规范：

- 任意一条代理消息都能通过 `agentId` 找到对应实体
- 任意一个代理实体都能在 `start` 时拿到完整初始化元数据
- 任意一个代理的结束和删除都能通过 `end / delete` 收口
- Claude 和 Codex 的原始关联差异不再外泄到上层

