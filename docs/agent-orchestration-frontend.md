# CCGUI Agent Orchestration Frontend Design

这份文档描述 `CCGUI` 在前端如何展示 agent orchestration 统一语义。

它建立在 [agent-orchestration-semantics.md](/Users/alwaysking/AKProject/CCGUI/docs/agent-orchestration-semantics.md) 之上，重点回答：

- 消息如何按 agent 归类
- `execution` 与 `collaborative` 两类 agent 如何分别展示
- `collaborative` agent 的两种查看模式如何组织
- store 和 UI 需要维护哪些视图状态

## 1. 设计目标

前端的目标不是还原 provider 原始协议，而是提供一套稳定的 agent 视图。

核心目标：

- 所有 agent 相关消息都能稳定归属到某个 `agentId`
- `execution` agent 显示为聚合任务卡
- `collaborative` agent 显示为子会话
- `collaborative` agent 支持两种查看模式：
  - 整体切换模式
  - 分屏模式

## 2. 核心原则

### 2.1 主分组键使用 `agentId`

前端消息归类的主键应是：

- `agentId`

不应使用：

- `actorId` 作为主分组键

原因：

- `agentId` 表示“这条消息属于哪个 agent 会话”
- `actorId` 表示“这次动作是谁发起的”

二者在很多场景下相同，但在 team / collaboration 场景中不一定相同。

因此：

- `agentId` 用于归类消息
- `actorId` / `targetId` 用于显示方向关系

### 2.2 `agentKind` 不是每条消息属性

前端不应期望每条消息都重复携带 `agentKind`。

正确方式是：

1. 在 agent registry 中登记 `agentKind`
2. 普通消息只带 `agentId`
3. 前端通过 `agentId -> registry` 查出这个 agent 属于哪一类

### 2.3 生命周期与消息归属分开处理

前端要区分两类数据：

- agent 生命周期
  - `start`
  - `end`
  - `delete`
- agent 普通消息
  - thinking
  - assistant message
  - tool use
  - tool result
  - system fragments

前者用于构建 agent 状态，后者用于构建 agent 内容视图。

## 3. 页面级视图模型

前端建议把 agent orchestration 视图拆成三层：

- `Agent Registry View`
- `Agent Content View`
- `Agent Workspace View State`

## 4. Agent Registry View

这是前端对统一语义中 `Agent Registry` 的材料化结果。

建议结构：

```ts
type AgentRegistryEntry = {
  agentId: string
  agentKind: 'execution' | 'collaborative'
  agentType: string | null
  name: string | null
  title: string | null
  description: string | null
  prompt: string | null
  model: string | null
  teamId: string | null
  parentAgentId: string | null
  status: 'starting' | 'running' | 'ended' | 'deleted'
}
```

说明：

- 这份结构主要来自 `start / end / delete` 生命周期事件
- 后续普通消息不应再重复定义这些属性

## 5. Agent Content View

前端应把消息先按 `agentId` 聚合，再根据 agent 类型派生不同视图。

### 5.1 基础聚合桶

```ts
type AgentMessageBucket = {
  agentId: string
  messages: ChatMessage[]
  orchestrationEvents: AgentOrchestrationEvent[]
}
```

语义：

- 一个 bucket 代表一个 agent 的全部可见内容
- 所有归属于该 `agentId` 的普通消息都进入这里
- 生命周期事件不直接作为普通消息渲染，但会参与派生状态

### 5.2 Execution Agent View

`execution` agent 的目标是显示为“聚合任务卡”。

建议派生结构：

```ts
type ExecutionAgentCardView = {
  agentId: string
  title: string
  subtitle: string | null
  status: 'starting' | 'running' | 'ended' | 'deleted'
  summary: string | null
  itemCount: number
  toolCount: number
  collapsed: boolean
  items: ChatMessage[]
}
```

卡片内容可以包含：

- thinking
- tool use
- tool result
- assistant message
- summary/result

执行型 agent 的前端核心不是“逐条消息平铺”，而是：

- 把同一个 agent 的内容聚合到一个卡片中

### 5.3 Collaborative Agent View

`collaborative` agent 的目标是显示为“子会话”。

建议派生结构：

```ts
type CollaborativeAgentSessionView = {
  agentId: string
  title: string
  subtitle: string | null
  status: 'starting' | 'running' | 'ended' | 'deleted'
  canInput: boolean
  messages: ChatMessage[]
}
```

协作型 agent 的前端核心不是任务摘要，而是：

- 它拥有自己的消息上下文
- 它可以被切换、聚焦、输入

## 6. Execution Agent 展示方案

### 6.1 设计目标

`execution` agent 适合显示为统一任务卡，而不是独立聊天 pane。

用户心智应是：

- 主 agent 派出一个执行任务
- 这个任务自己完成若干操作
- 最终回收结果

### 6.2 视觉形态

建议形态：

```text
* agent: xxxxx      状态
--------------------------------
  * tool use 1
  * tool use 2
  * message 1
```

更准确地说，它是一个可折叠的聚合气泡/卡片：

- 头部：
  - agent 名称
  - 状态
  - 摘要
  - 展开/折叠按钮
- 内容区：
  - 内部小时间线

### 6.3 折叠态

默认折叠时建议只显示：

- agent 名称
- 状态
- 一行摘要
- 工具调用数量
- 最近活动时间

### 6.4 展开态

展开后显示该 agent 的完整 mini timeline：

- thinking
- tool use
- tool result
- assistant message
- final summary

### 6.5 与现有组件的关系

这类展示可视为现有 `ToolUseMessage` 的上层聚合容器。

区别在于：

- `ToolUseMessage` 只展示一个工具调用
- `ExecutionAgentCard` 展示同一个 agent 的多条内部消息

## 7. Collaborative Agent 展示方案

### 7.1 设计目标

`collaborative` agent 不是单个任务步骤，而是当前 session 下的“子会话参与者”。

因此它不应被压缩成单个聚合卡，而应拥有完整会话视图。

### 7.2 两种查看模式

协作型 agent 支持两种查看模式：

- `single`
- `split`

#### `single`

整体切换模式。

特点：

- 一次只显示一个 agent 的消息区
- 当前激活哪个 agent，就显示哪个 agent 的完整内容
- 输入框归当前激活 agent

#### `split`

分屏模式。

特点：

- 主 agent 与若干 collaborative agents 同时可见
- 多个 pane 并列展示
- 当前聚焦 pane 决定输入框归属

### 7.3 Single 模式

这是协作型 agent 的基础模式。

布局建议：

- 主消息区域只显示当前 `activeAgentId` 的消息
- 右侧为 agent rail
- 点击右侧 agent 头像或条目，切换当前激活 agent

适用场景：

- 用户想完整阅读某个协作 agent 的上下文
- 用户想把输入明确发给某个协作 agent

### 7.4 Split 模式

这是协作型 agent 的高级模式。

布局目标接近：

```text
--------------------------
|              |agent1 | *|
|              |       | *|
|              |-------| *|
|   main       |agent2 |  |
|              |       |  |
|              |-------|  |
|              |agent3 |  |
|              |       |  |
|              |------ |  |
--------------------------
|                        |
|      input area        |
--------------------------
```

更抽象的解释是：

- 左侧是主 agent pane
- 中间是一个或多个 collaborative pane
- 右侧是紧凑的 agent rail
- 下方是共享输入区

输入归属规则：

- 当前被聚焦的 pane 对应 `inputTargetAgentId`

### 7.5 为什么 collaborative 不做成卡片

因为协作型 agent 的核心不只是“执行了多少工具”，而是：

- 它有自己的会话历史
- 它可能持续发言
- 它可能持续接收输入

因此它更接近“session 内子会话”，而不是“一个复合工具调用”。

## 8. Workspace 视图状态

前端需要维护一个 agent workspace 级别的状态对象。

建议结构：

```ts
type AgentWorkspaceState = {
  activeAgentId: string | null
  collaborativeViewMode: 'single' | 'split'
  splitAgentIds: string[]
  focusedPaneAgentId: string | null
  inputTargetAgentId: string | null
}
```

字段语义：

- `activeAgentId`
  - `single` 模式下当前显示哪个 agent
- `collaborativeViewMode`
  - 协作型 agent 当前查看模式
- `splitAgentIds`
  - `split` 模式下参与分屏的 collaborative agents
- `focusedPaneAgentId`
  - 当前焦点所在 pane
- `inputTargetAgentId`
  - 输入框消息将发送给谁

### 8.1 推荐默认规则

- 默认 `collaborativeViewMode = "single"`
- 默认 `activeAgentId = 主 agent`
- 切换到 `split` 后：
  - 默认第一个 pane 仍为主 agent
  - 当前用户点击的 pane 成为 `focusedPaneAgentId`
  - `inputTargetAgentId = focusedPaneAgentId`

## 9. 归类与派生规则

### 9.1 基础归类

所有消息处理顺序建议如下：

1. 读取统一语义中的 `agentId`
2. 若缺失，则归到主 agent
3. 将消息插入对应 `AgentMessageBucket`

### 9.2 根据 Registry 派生类型

对每个 bucket：

1. 通过 `agentId` 查询 registry
2. 判断 `agentKind`
3. 若为 `execution`，派生成 `ExecutionAgentCardView`
4. 若为 `collaborative`，派生成 `CollaborativeAgentSessionView`

### 9.3 生命周期驱动状态

agent 的最终显示状态由 `start / end / delete` 派生：

- `start` -> `starting` / `running`
- `end` -> `ended`
- `delete` -> `deleted`

是否展示为“运行中”可以结合：

- 最近事件
- 最近消息时间
- provider 当前执行态

## 10. 组件拆分建议

建议组件层次如下：

- `AgentWorkspace`
  - orchestration 总入口
- `AgentRail`
  - 右侧 agent 头像栏/列表
- `ExecutionAgentCard`
  - 执行型 agent 聚合卡
- `CollaborativeAgentSession`
  - 协作型 agent 的单个会话 pane
- `CollaborativeSplitWorkspace`
  - 协作型分屏容器
- `AgentMessageList`
  - 某个 agent 的消息列表
- `AgentPaneHeader`
  - pane 头部，显示名称、状态、模型等

### 10.1 与现有组件的关系

已有组件可作为基础：

- [TaskFloatingWindow.vue](/Users/alwaysking/AKProject/CCGUI/src/views/workspace/chat/components/TaskFloatingWindow.vue)
  - 当前更像任务态展示原型
- [ToolUseMessage.vue](/Users/alwaysking/AKProject/CCGUI/src/views/workspace/chat/components/messages/ToolUseMessage.vue)
  - 当前是单条工具消息卡

后续 agent orchestration 前端更可能是：

- 重用现有 message 渲染组件作为内部子项
- 在其上增加 agent 级聚合与 pane 容器

## 11. Store 派生数据建议

现有 `useSessionStore` 中已经有：

- `messages`
- `rawMessages`
- `activeTasks`

为支持前端 agent orchestration，建议新增派生结构，而不是污染原始消息数组：

- `agentRegistry: Map<agentId, AgentRegistryEntry>`
- `agentBuckets: Map<agentId, AgentMessageBucket>`
- `executionAgentCards: ExecutionAgentCardView[]`
- `collaborativeAgentSessions: CollaborativeAgentSessionView[]`
- `agentWorkspaceState`

原则：

- 原始消息保持原状
- orchestration 视图是派生层

## 12. 推荐落地顺序

为了降低风险，推荐分阶段实现：

### 阶段 1

- 建立 `agentId` 分组
- 建立 `Agent Registry` 派生视图
- 实现 `ExecutionAgentCard`

目标：

- 先把 `execution` agent 跑通

### 阶段 2

- 建立 `CollaborativeAgentSessionView`
- 实现 `single` 模式
- 加入 `AgentRail`

目标：

- 先把协作型子会话切换跑通

### 阶段 3

- 实现 `split` 模式
- 实现 `focusedPaneAgentId`
- 实现 `inputTargetAgentId` 切换

目标：

- 完成多 agent 并行观察与输入归属

## 13. 当前结论

当前前端设计可以正式收敛为：

- 所有 agent 相关消息按 `agentId` 归类
- `execution` agent 显示为聚合任务卡
- `collaborative` agent 显示为子会话
- `collaborative` agent 支持：
  - `single`
  - `split`

这套设计与统一语义兼容，也能自然覆盖：

- Claude Code `subagent`
- Claude Code `agent team`
- Codex `subagent`
