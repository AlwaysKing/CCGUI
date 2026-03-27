# CCGUI Agent Orchestration Semantics

这份文档定义 `CCGUI` 中与 `agent` 相关的统一语义。

它只处理 `agent` 的身份、生命周期和消息归属，不重写通用的 provider 消息语义。  
通用消息语义仍以 [ccgui-provider-semantics.md](/Users/alwaysking/AKProject/CCGUI/docs/ccgui-provider-semantics.md) 为准。

## 目标

- 覆盖 Claude Code `subagent`
- 覆盖 Claude Code `agent team`
- 覆盖 Codex `subagent`
- 让 `ClaudeAdapter` / `CodexAdapter` 在内部消化各自原始协议差异
- 让后续 store / UI 只消费统一的 agent 语义

## 语义范围

这份规范只定义三类内容：

1. `Agent Registry`
2. `Orchestration Event`
3. `Message Attribution`

它们不是三份独立规范，而是同一份正式规范中的三个部分。

## 核心概念

### `agentId`

统一的代理身份标识。

要求：

- 同一个代理在其生命周期内保持稳定
- 后续所有消息、工具调用、状态变化都应能通过 `agentId` 归属
- 不暴露 provider 原始关联键

### `agentKind`

统一的代理工作模式分类。

当前仅定义两类：

- `execution`
- `collaborative`

语义要求：

- 这是统一层高阶分类
- 只需要在代理创建或 `start` 时声明一次
- 后续普通消息不需要重复携带

### `agentType`

更细粒度的代理角色或实现类型。

它用于描述“这个代理具体是什么角色/模板/形态”，例如：

- Claude subagent 的具体角色
- Claude team member 的具体角色
- Codex 侧的具体代理模板

语义要求：

- `agentType` 可以是 provider 侧的细分类型
- 它不承担 `execution / collaborative` 这种高阶分类职责
- 它只描述“具体类型”，不描述统一工作模式

## 1. Agent Registry

`Agent Registry` 是代理实体表。

它回答的是：

- 系统里有哪些代理对象
- 每个代理对象有哪些稳定或半稳定属性
- 这个代理如何被后续事件和消息引用

### 1.1 代理实体字段

建议的统一字段如下：

- `agentId`
- `agentKind`
- `agentType`
- `name`
- `prompt`
- `model`
- `teamId`
- `parentAgentId`
- `status`

### 1.2 字段语义

#### `agentId`

代理的统一身份 ID。

#### `agentKind`

统一工作模式分类，当前仅允许：

- `execution`
- `collaborative`

#### `agentType`

具体代理角色或实现类型。

#### `name`

代理显示名或角色名。

#### `prompt`

代理初始化时使用的说明、指令或角色提示词。

#### `model`

代理运行所用模型。

#### `teamId`

如果代理属于某个 team，则记录 team 标识。

#### `parentAgentId`

如果该代理由另一个代理创建或派生，则记录父代理 ID。

#### `status`

代理当前状态，属于当前实体的材料化状态，不是原始协议真值。

建议值例如：

- `starting`
- `running`
- `stopping`
- `ended`
- `deleted`

语义要求：

- `status` 由 `Orchestration Event` 归纳得到
- `start / end / delete` 是状态变化的事件源
- 如果当前状态无法确定，`status` 可以省略，而不是强行猜测

### 1.3 Registry 约束

- `agentKind` 是实体元数据，不应在每条消息上重复携带
- `agentType` 也属于实体元数据，默认只在注册时声明
- 普通消息只要能通过 `agentId` 归属即可
- 如果某个字段只对少数 provider 稳定成立，不要把它强行变成必填字段

## 2. Orchestration Event

`Orchestration Event` 是代理生命周期事件。

它回答的是：

- 这个代理什么时候开始
- 什么时候结束
- 什么时候被删除
- 谁触发了这个动作

### 2.1 生命周期事件

当前只保留三种生命周期语义：

- `start`
- `end`
- `delete`

### 2.2 `start`

`start` 表示代理被创建并进入工作态。

这是代理语义中最重要的事件，因为它通常承载完整的初始化元数据。

#### 必要字段

- `eventType: "start"`
- `agentId`
- `agentKind`
- `timestamp`

#### 推荐字段

- `agentType`
- `name`
- `prompt`
- `model`
- `teamId`
- `parentAgentId`
- `source`

#### 可选字段

- `description`
- `role`
- `color`
- `initialState`
- `capabilities`
- `interactionMode`

#### `source`

代理初始化来源的归一化分类。

建议值例如：

- `subagent_spawn`
- `team_create`
- `team_member_spawn`
- `spawned_thread`

语义要求：

- `source` 只描述“这个代理是通过哪类归一化动作被创建出来的”
- 不直接暴露 provider 原始字段名
- 如果 adapter 无法稳定判断，可省略

#### 语义要求

- `start` 不只是“开始”，也是代理实体初始化的主要入口
- Claude 和 Codex 可能带不同的原始字段，但统一语义必须收敛到同一组槽位
- 初始化信息要尽量完整，不要做成“每个 provider 一套属性”

### 2.3 `end`

`end` 表示代理当前工作生命周期结束。

它可以对应：

- 正常完成
- 主动停止
- 被系统收束

#### 必要字段

- `eventType: "end"`
- `agentId`
- `timestamp`

#### 推荐字段

- `reason`
- `result`
- `status`

### 2.4 `delete`

`delete` 表示代理实体或 team 实体被显式清理。

它强调的是“对象被销毁”，不只是“任务结束”。

#### 必要字段

- `eventType: "delete"`
- `agentId`
- `timestamp`

#### 推荐字段

- `reason`
- `targetKind`
- `status`

#### `targetKind`

被删除对象的统一类别。

建议值例如：

- `agent`
- `team`

语义要求：

- `targetKind` 只用于辅助解释删除的是哪类实体
- 不作为主键，不替代 `agentId`
- 如果删除目标已经能从 `agentId` 明确推导，可省略

### 2.5 生命周期约束

- `start / end / delete` 是唯一需要统一定义的生命周期语义
- 不需要再额外拆成更细的生命周期枚举，除非后续出现跨 provider 稳定必要性
- `start` 负责初始化，`end` 负责收口，`delete` 负责销毁

## 3. Message Attribution

`Message Attribution` 是把普通消息、工具调用和发言归属到正确代理的语义。

它回答的是：

- 这条消息是谁的
- 这次工具调用是谁执行的
- 这条动作发给了谁

### 3.1 基本规则

- 后续普通消息只要带 `agentId` 即可
- 不要求每条消息重复携带 `agentKind`
- `agentKind` 通过 `agentId` 去 `Agent Registry` 查询

### 3.2 归属字段

建议最小归属字段：

- `agentId`

如果是方向性动作，再补充：

- `actorId`
- `targetId`

### 3.3 语义说明

#### `agentId`

这条消息、工具调用或状态变化归属于哪个代理。

#### `actorId`

谁发起了这个动作。

#### `targetId`

这个动作作用于谁，或者发给谁。

### 3.4 适用范围

以下内容都应支持归属：

- 普通发言
- 工具调用
- tool result
- team 内消息投递
- 代理状态变化

### 3.5 事件映射

以下是推荐的归属规则：

- 代理自身发言或自身工具调用
  - `agentId = actorId = 该代理自身`
  - `targetId` 省略
- team lead 向成员发送消息
  - `agentId = actorId = team lead`
  - `targetId = 目标成员的 agentId`
- team lead 广播给整个 team
  - `agentId = actorId = team lead`
  - `targetId = teamId`
- 代理被创建或启动
  - `agentId = 该代理的统一 ID`
  - `actorId = 触发创建的上游实体`
  - `targetId` 省略或等于 `agentId`，由 adapter 统一约定
- 代理被删除
  - `agentId = 被删除的代理 ID`
  - `actorId = 触发删除的上游实体`
  - `targetId = 被删除实体的 ID`

### 3.6 归属约束

- 归属信息不要分散成 provider 专属字段向外泄露
- 归属判断应尽量在 adapter 内完成
- 对外只保留统一归属结果

## 4. Provider 映射原则

### 4.1 Claude Code Subagent

Claude 普通 `subagent` 的统一映射原则：

- 通过 `parent_tool_use_id`、`task_started`、`tool_use_result.agentId` 等信息在 adapter 内完成归属推导
- 统一输出 `agentId`
- `agentKind = execution`
- `start` 时带上初始化元数据

### 4.2 Claude Code Agent Team

Claude `agent team` 的统一映射原则：

- team、lead、teammate 都是可识别实体
- 成员的发言和工具使用要能归属到具体 `agentId`
- `SendMessage` 一类动作要能表达 `actorId` 和 `targetId`
- `agentKind = collaborative`
- `start` 时保留成员名、角色、prompt、model、teamId 等初始化元数据

### 4.3 Codex Subagent

Codex `subagent` 的统一映射原则：

- 通过 `spawnAgent`、`receiverThreadIds`、`threadId` 等信息在 adapter 内完成归属推导
- 统一输出 `agentId`
- `agentKind = collaborative`
- `start` 时保留初始化元数据和线程映射结果

## 5. 正式不变量

以下约束应视为正式不变量：

- `agentId` 是统一身份主键
- `agentKind` 只在代理创建或 `start` 时声明一次
- 普通消息不重复携带 `agentKind`
- `start` 必须承载尽可能完整的初始化元数据
- `end` 只表示结束，不引入额外生命周期细分
- `delete` 只表示对象被销毁或清理
- `status` 是 registry 的材料化状态，不是事件主来源
- provider 原始关联键不得进入统一语义主层

## 6. 推荐文档结构

后续正式版建议按以下结构组织：

1. `Scope`
2. `Terminology`
3. `Agent Registry`
4. `Orchestration Event`
5. `Message Attribution`
6. `Provider Mapping`
7. `Invariants`
8. `Open Questions`

## 7. 当前状态

这是一份正式规范草案，目的是把当前已达成的设计口径固定下来，供 provider adapter 实现和后续前端设计引用。
