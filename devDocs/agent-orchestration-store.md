# CCGUI Agent Orchestration Store Design

这份文档定义 `CCGUI` 前端 store 如何承接 agent orchestration 统一语义。

它建立在以下文档之上：

- [agent-orchestration-semantics.md](/Users/alwaysking/AKProject/CCGUI/docs/agent-orchestration-semantics.md)
- [agent-orchestration-frontend.md](/Users/alwaysking/AKProject/CCGUI/docs/agent-orchestration-frontend.md)
- [ccgui-provider-semantics.md](/Users/alwaysking/AKProject/CCGUI/docs/ccgui-provider-semantics.md)

这份文档只回答 store 层问题：

- 原始消息如何保留
- agent 数据如何派生
- 前端视图状态如何组织
- 哪些数据属于 store，哪些属于 UI

## 1. 设计目标

store 层的目标不是重新解释 provider 原始协议，而是：

- 接住 adapter 已归一的 agent 语义
- 维护 agent registry
- 维护 agent 归属桶
- 维护 workspace 级 UI 状态
- 为前端组件输出稳定的派生数据

## 2. 分层原则

store 应分成四层数据：

1. 原始消息层
2. Agent Registry 派生层
3. Agent Bucket 派生层
4. Workspace State

原则：

- 原始消息层不为 orchestration 改结构
- orchestration 相关都放到新增派生层
- UI 不应直接消费 provider 原始字段

## 3. 原始消息层

原始消息层保持现有结构，不做语义重定义。

当前 `SessionData` 中已有的数据继续保留：

- `messages`
- `rawMessages`
- `activeTasks`
- `pendingPermissions`
- `pendingControlRequests`
- `envInfo`

这层职责：

- 保持完整聊天时间线
- 保持调试与回放能力
- 作为 agent 派生层的数据源

## 4. Agent Registry 派生层

### 4.1 目标

`Agent Registry` 是 store 中的 agent 实体索引。

它回答：

- 当前 session 里有哪些 agent
- 每个 agent 的稳定元数据是什么
- 每个 agent 当前状态是什么

### 4.2 建议结构

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
  startTime: string | null
  endTime: string | null
  deleteTime: string | null
}
```

推荐在 session 里存为：

```ts
agentRegistry: Map<string, AgentRegistryEntry>
```

### 4.3 数据来源

`Agent Registry` 主要来自：

- `start`
- `end`
- `delete`

其中：

- `start` 建立或刷新实体记录
- `end` 更新状态和结束时间
- `delete` 更新状态和删除时间

### 4.4 关键规则

- 主 agent 也应该进入 registry
- `agentKind` 只要求在 `start` 时明确
- 普通消息不需要重复带 `agentKind`
- 如果后续消息补充了更完整元数据，可以合并进 registry

## 5. Agent Bucket 派生层

### 5.1 目标

`Agent Bucket` 是消息归属桶。

它回答：

- 某条消息属于哪个 agent
- 某个 agent 的全部消息内容是什么

### 5.2 建议结构

```ts
type AgentMessageBucket = {
  agentId: string
  messages: ChatMessage[]
  orchestrationEvents: AgentOrchestrationEvent[]
}
```

推荐在 session 里存为：

```ts
agentBuckets: Map<string, AgentMessageBucket>
```

### 5.3 分桶规则

处理每条消息时：

1. 读取统一语义中的 `agentId`
2. 如果存在，则放入对应 bucket
3. 如果不存在，则归到主 agent bucket

说明：

- `agentId` 是主分组键
- `actorId` 和 `targetId` 只用于方向关系显示
- 不用于主分桶

### 5.4 生命周期事件进入 bucket 的方式

生命周期事件不一定直接显示在普通消息列表里，但建议仍进入对应 bucket 的 `orchestrationEvents`。

这样做的好处：

- 便于 execution 卡片派生状态
- 便于 collaborative 会话显示系统状态
- 便于做时间线调试

## 6. Workspace State

### 6.1 目标

`Workspace State` 是 orchestration UI 状态。

它回答：

- 当前正在看哪个 agent
- 协作型是单视图还是分屏
- 当前输入要发给谁

### 6.2 建议结构

```ts
type AgentWorkspaceState = {
  activeAgentId: string | null
  collaborativeViewMode: 'single' | 'split'
  splitAgentIds: string[]
  focusedPaneAgentId: string | null
  inputTargetAgentId: string | null
}
```

推荐在 session 里存为：

```ts
agentWorkspaceState: AgentWorkspaceState
```

### 6.3 默认规则

- `activeAgentId` 默认是主 agent
- `collaborativeViewMode` 默认是 `single`
- `splitAgentIds` 默认空数组
- `focusedPaneAgentId` 默认等于 `activeAgentId`
- `inputTargetAgentId` 默认等于当前聚焦 agent

## 7. 前端派生视图

store 不应让组件直接消费 registry 和 bucket 的低级结构。

建议进一步派生出两类视图：

- `executionAgentCards`
- `collaborativeAgentSessions`

### 7.1 Execution Agent Card

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

### 7.2 Collaborative Agent Session

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

## 8. 更新流程

建议 store 在处理 adapter 输出时遵循以下顺序：

### 8.1 处理生命周期事件

如果收到统一的 orchestration event：

1. 根据 `agentId` 更新 `agentRegistry`
2. 根据 `agentId` 更新 `agentBuckets.orchestrationEvents`
3. 如果当前 `workspaceState` 还没有默认 agent，可用主 agent 或首个 collaborative agent 初始化

### 8.2 处理普通消息

如果收到普通消息：

1. 先进入原始 `messages`
2. 再读取其 `agentId`
3. 插入对应 `agentBuckets.messages`

### 8.3 派生视图刷新

每次 registry 或 bucket 变化后，重新派生：

- `executionAgentCards`
- `collaborativeAgentSessions`

## 9. 状态派生规则

### 9.1 Registry 状态

建议状态派生规则如下：

- 收到 `start`：
  - `status = running`
- 收到 `end`：
  - `status = ended`
- 收到 `delete`：
  - `status = deleted`

如果 adapter 显式提供更细的运行态，也可以在 store 内映射成更友好的过渡显示，但不要改变统一语义事件类型。

### 9.2 主 agent 的特殊性

主 agent 在 store 中也应进入 registry，并拥有稳定 `agentId`。

好处：

- `single` 模式切换不会出现主 agent 特判
- `split` 模式左侧主 pane 不需要单独分支
- 输入归属规则可以统一

## 10. 与现有 SessionStore 的关系

现有 [useSessionStore.js](/Users/alwaysking/AKProject/CCGUI/src/stores/useSessionStore.js) 已经维护了会话原始状态。

推荐做法不是替换现有结构，而是新增这些 session 级字段：

- `agentRegistry`
- `agentBuckets`
- `agentWorkspaceState`

并新增对应 computed：

- `executionAgentCards`
- `collaborativeAgentSessions`
- `activeCollaborativeSession`
- `splitCollaborativeSessions`

## 11. UI 与 Store 的边界

Store 负责：

- 数据归类
- 状态派生
- 默认值维护

UI 负责：

- 展示 execution 卡片
- 展示 collaborative 单视图或分屏
- 响应用户切换 active agent
- 响应用户切换 split 模式

UI 不应：

- 自己按原始消息重新分组
- 自己推断 `agentKind`
- 自己维护第二套 agent registry

## 12. 推荐落地顺序

### 阶段 1

- session 中新增 `agentRegistry`
- session 中新增 `agentBuckets`
- 建立按 `agentId` 分桶的派生逻辑

### 阶段 2

- 增加 `executionAgentCards` computed
- 跑通 execution 卡片数据链路

### 阶段 3

- 增加 `agentWorkspaceState`
- 增加 `collaborativeAgentSessions` computed
- 跑通 `single` 模式

### 阶段 4

- 增加 `split` 模式所需状态
- 跑通多 pane 协作视图

## 13. 当前结论

Store 层的核心职责可以正式总结为：

- 不改原始消息层
- 新增 agent registry
- 新增 agent buckets
- 新增 workspace state
- 基于这些派生 execution 与 collaborative 两类前端视图
