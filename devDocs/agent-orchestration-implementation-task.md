# Agent Orchestration Frontend Implementation Task

这份文档是给后续实现线程使用的任务说明。

目标：

- 基于现有统一语义与前端设计文档
- 在 `CCGUI` 中实现 agent orchestration 前端第一轮完整落地

相关设计文档：

- [agent-orchestration-semantics.md](/Users/alwaysking/AKProject/CCGUI/docs/agent-orchestration-semantics.md)
- [agent-orchestration-frontend.md](/Users/alwaysking/AKProject/CCGUI/docs/agent-orchestration-frontend.md)
- [agent-orchestration-store.md](/Users/alwaysking/AKProject/CCGUI/docs/agent-orchestration-store.md)
- [ccgui-provider-semantics.md](/Users/alwaysking/AKProject/CCGUI/docs/ccgui-provider-semantics.md)

## 1. 实现目标

本轮实现目标不是做全部最终形态，而是完成一条从统一语义到前端可见 UI 的完整链路。

需要完成：

1. Store 层支持按 `agentId` 的 orchestration 派生
2. `execution` agent 显示为聚合任务卡
3. `collaborative` agent 显示为子会话
4. `collaborative` 先实现 `single` 模式
5. 为后续 `split` 模式预留状态和结构

本轮可以不完成：

- `collaborative split` 的完整 UI
- 最终视觉 polish
- 所有边角 provider 异常场景

## 2. 必须遵守的语义约束

实现时必须遵守：

- 消息主分组键是 `agentId`
- 不能用 `actorId` 作为主分组键
- `agentKind` 只依赖 registry，不要求每条消息重复携带
- 生命周期只认：
  - `start`
  - `end`
  - `delete`
- 主 agent 也必须进入 agent registry
- UI 不得直接理解 provider 原始字段

## 3. Store 任务

目标文件：

- [useSessionStore.js](/Users/alwaysking/AKProject/CCGUI/src/stores/useSessionStore.js)

需要新增 session 级数据：

- `agentRegistry`
- `agentBuckets`
- `agentWorkspaceState`

建议结构：

```ts
agentRegistry: Map<agentId, AgentRegistryEntry>
agentBuckets: Map<agentId, AgentMessageBucket>
agentWorkspaceState: {
  activeAgentId: string | null
  collaborativeViewMode: 'single' | 'split'
  splitAgentIds: string[]
  focusedPaneAgentId: string | null
  inputTargetAgentId: string | null
}
```

需要新增的派生 computed：

- `executionAgentCards`
- `collaborativeAgentSessions`
- `activeCollaborativeSession`

Store 逻辑要求：

- 接住 adapter 提供的统一 agent 语义
- lifecycle event 更新 registry
- 普通消息按 `agentId` 进入 bucket
- 缺少 `agentId` 的消息默认归主 agent

## 4. UI 任务

### 4.1 Execution Agent

需要新增或改造一个 execution agent 聚合卡组件。

建议组件名：

- `ExecutionAgentCard.vue`

目标：

- 将同一个 `execution agent` 的多条内部消息聚合到一张卡里
- 支持折叠/展开
- 默认显示摘要、状态、工具数量
- 展开后显示内部 mini timeline

卡片内容可复用现有消息渲染组件。

### 4.2 Collaborative Agent

需要新增一个 collaborative agent 工作区组件。

建议组件名：

- `AgentWorkspace.vue`
- `CollaborativeAgentSession.vue`
- `AgentRail.vue`

本轮只要求完成：

- `single` 模式

功能要求：

- 右侧显示 collaborative agent 列表
- 点击 agent 后切换当前激活 agent
- 主消息区域显示当前激活 collaborative agent 的完整消息
- 输入框归当前激活 agent

### 4.3 后续预留

虽然本轮不必完成 `split` 模式，但需要预留：

- `collaborativeViewMode`
- `splitAgentIds`
- `focusedPaneAgentId`

## 5. 页面集成要求

目标区域：

- 当前 workspace/chat 相关视图

实现原则：

- execution agent 保持在主时间线语境里显示
- collaborative agent 作为当前 session 内的子会话区域显示
- 不要把 collaborative agent 压成普通消息卡片

## 6. 推荐实现顺序

### 第一步

先完成 store 派生层：

- registry
- buckets
- workspaceState

### 第二步

完成 execution agent 聚合卡：

- 先跑通 execution 数据链路
- 在当前消息视图中插入 execution card

### 第三步

完成 collaborative `single` 模式：

- agent rail
- active agent 切换
- 当前 collaborative session message list

### 第四步

把输入归属接到 `inputTargetAgentId`

要求：

- 当前激活 agent 改变时，输入目标同步改变

## 7. 验收标准

完成后至少要满足：

1. 同一个 execution agent 的多条消息不再散落显示，而是聚合为一张卡
2. 至少一个 collaborative agent 能以独立会话形式查看
3. 可以在主 agent 和某个 collaborative agent 之间切换查看
4. 输入目标能随当前激活 agent 改变
5. 前端不直接依赖 provider 原始字段

## 8. 风险提示

实现时要特别注意：

- 不要在 UI 层重新解析 provider 原始数据
- 不要让 execution 和 collaborative 共用同一种平铺渲染逻辑
- 不要把 `agentKind` 再重复写回每条 message
- 不要把主 agent 当成特殊分支排除在 registry 之外

## 9. 完成后的建议输出

实现线程完成后，建议输出：

1. 改动摘要
2. 新增的数据结构
3. 新增组件
4. 当前未完成的 `split` 模式预留点
5. 已验证的场景

## 10. 给实现线程的一句话任务描述

基于现有 agent orchestration 语义与前端设计文档，在 `CCGUI` 中实现第一轮 agent orchestration 前端：按 `agentId` 对消息归类，把 `execution` agent 渲染为聚合任务卡，把 `collaborative` agent 渲染为可切换的子会话，并完成 store 层 registry/bucket/workspace state 的派生支持，为后续 split 模式预留结构。
