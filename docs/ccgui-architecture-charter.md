# CCGUI Architecture Charter

这份文档是 CCGUI 的长期架构纲领。

它不描述某一次临时实现，而是描述以后做功能、重构、修补时都必须遵守的分层原则、职责边界和统一语义。

如果代码现状与本纲领冲突，应优先把代码逐步收敛回本纲领，而不是为现状补新的例外规则。

## 1. 总体分层

CCGUI 的主链路定义为：

`UI -> Store -> main.cjs -> appService / projectService -> sessionManager -> sessionInstance -> provider`

其中：

- `UI`
  - 负责界面展示、交互触发、局部视图状态
- `Store`
  - 负责前端统一状态、会话事件消费、前端语义整理
- `main.cjs`
  - 负责 IPC 边界与进程桥接，不承载业务编排
- `appService`
  - 负责应用级配置、应用级 provider 能力查询
- `projectService`
  - 负责项目级配置、session 配置读写、项目与 provider 资源整合
- `sessionManager`
  - 负责多个 `sessionInstance` 的生命周期管理
- `sessionInstance`
  - 负责单个会话的统一行为编排
- `provider`
  - 负责 Claude / Codex 的原始协议翻译与底层能力适配

## 2. 核心原则

### 2.1 Provider 是统一语义翻译层

`provider` 不是上层业务层，它的职责是：

- 启动和停止底层运行时
- 处理 Claude / Codex 原始协议
- 将原始协议翻译为统一的 CCGUI 语义能力和事件
- 对上提供统一的运行时事实，而不是暴露 provider 私有细节

`provider` 不负责：

- UI 文案
- 用户可见的高层会话流程编排
- Store/UI 级别的状态组织
- 跨 provider 的业务决策

### 2.2 SessionInstance 是统一行为编排层

`sessionInstance` 建立在 provider 已统一过的 CCGUI 语义之上。

它的职责是：

- 管理单个会话的数据与状态
- 编排启动、停止、重启、配置应用等会话级行为
- 将 provider 的底层事实整理为统一的会话级行为语义
- 向上发出统一的 `session-event`

从 `sessionInstance` 开始往上：

- 不应再理解 Claude / Codex 原始协议
- 不应再依赖 provider 私有字段和私有流程
- 不应再把“要不要重启”“某 provider 如何切模型”交给前端决定

### 2.3 上层只消费统一语义

`sessionInstance` 之上的层只允许消费统一语义，不允许消费 provider 特有语义。

也就是说：

- `Store` 不应分 Claude/Codex 编排流程
- `UI` 不应分 Claude/Codex 做行为判断
- `main.cjs` 不应因为某个 provider 的协议细节而膨胀

如果上层需要区分，通常说明统一语义没有在 provider / sessionInstance 层收敛完成。

## 3. 每一层的明确职责

### 3.1 UI

UI 负责：

- 展示状态
- 发起用户意图
- 局部交互反馈

UI 不负责：

- 判断 provider 差异
- 判断是否需要重启 session
- 拼装 provider 专用请求
- 解释 provider 原始消息

例：

- UI 可以发起 `setSessionEffort`
- UI 不应该根据 `supportsRuntimeSwitch` 自己决定是否 `stop/start`

### 3.2 Store

Store 负责：

- 维护前端状态树
- 消费统一 `session-event`
- 将状态组织成前端可直接渲染的结构

Store 不负责：

- provider 差异编排
- 运行时协议翻译
- 会话级底层行为 orchestration

### 3.3 main.cjs

`main.cjs` 负责：

- IPC 注册
- 参数透传
- 进程间桥接

`main.cjs` 不负责：

- provider 行为决策
- 会话级编排逻辑
- UI 语义拼装

如果某个 IPC handler 开始出现大量 Claude/Codex 分支，说明职责已经逃逸。

### 3.4 appService

`appService` 负责：

- 应用配置
- 系统级 provider 配置管理
- provider 的应用级能力查询

它可以直接调用 provider 的应用级 API，因为这属于“配置能力”而不是“会话行为”。

### 3.5 projectService

`projectService` 负责：

- 项目配置和 session 配置的读写
- 项目与 provider 资源的整合
- 基于统一语义的项目级能力整理

它可以调用 provider 的配置/查询能力，但不应承担单个运行中 session 的行为编排。

特别注意：

- `projectService` 可以整理“某 session 当前有效配置”
- 但不应替 `sessionInstance` 决定“运行中的这个 session 现在该怎么切换”

### 3.6 sessionManager

`sessionManager` 负责：

- 管理多个 `sessionInstance`
- 提供获取、创建、关闭、停止等统一入口

它是生命周期管理器，不是业务编排器。

### 3.7 sessionInstance

`sessionInstance` 是会话行为核心。

它负责：

- 启动/停止/重启 runtime
- 配置应用 orchestration
- 会话级统一通知与统一行为事件
- 会话消息、envInfo、pending 状态管理

它不应直接理解 provider 原始协议，只应消费 provider 已翻译好的统一语义。

### 3.8 provider

`provider` 负责：

- Claude / Codex 原始 transport
- 原始协议到统一 CCGUI 语义的翻译
- 底层能力适配

它可以知道：

- Claude 是否需要 `--resume`
- Codex 是否需要 `thread/resume`
- 某能力是否支持 live apply

但它不应决定：

- 用户最终看到什么文案
- 会话重启时机的高层业务表达
- UI 是否需要倒计时/计时

## 4. 统一语义边界

### 4.1 Provider 输出的是统一 CCGUI 语义

provider 对 `sessionInstance` 输出的应该是：

- 统一事件
- 统一 envInfo
- 统一能力
- 统一控制入口

而不是：

- Claude 专有 message subtype
- Codex 专有 thread/item 私有结构直接上抛

### 4.2 SessionInstance 编排的是统一行为语义

`sessionInstance` 基于 provider 的统一语义，进一步输出统一行为语义，例如：

- session 启动中
- session 已启动
- session 正在为配置重启
- 配置已应用
- 运行时已停止

这里的重点是：

- provider 提供事实
- sessionInstance 提供编排后的行为语义

## 5. 会话配置变更的统一原则

对于模型、子模型、思考力度等“会话运行参数”：

- UI 只表达用户意图
- sessionInstance 负责完整应用流程
- provider 只提供底层能力实现

正确链路是：

1. UI 发起 `setSessionModel` / `setSessionSubmodel` / `setSessionEffort`
2. 上层不自行决定是否 stop/start
3. `sessionInstance` 判断并编排：
   - 直接生效
   - 或重启后生效
4. provider 执行底层能力
5. sessionInstance 向上发统一通知

禁止的做法：

- UI 根据 provider 能力字段自己编排 restart
- Store 判断 Claude/Codex 后走不同流程
- `main.cjs` 承担复杂配置切换 orchestration

## 6. 生命周期通知原则

底层 provider 事件和对上统一通知不是一回事。

原则如下：

- provider 可以产生底层 runtime 事实
- sessionInstance 负责将它们整理为统一会话通知

典型例子：

- provider 报告进程退出
- sessionInstance 判断这是：
  - 用户手动停止
  - 为配置变更而重启
  - 异常退出

然后再决定向上发什么统一通知。

因此：

- 不允许 UI 直接拿 provider 原始退出事件决定最终文案
- 不允许把“为重启而停止”和“用户手动停止”混成一个语义

## 7. 允许的直连与例外

### 7.1 UI 可绕过 Store 的情况

以下情况允许 UI 不经过 Store：

- 应用配置面板
- 项目配置面板
- 纯配置查询类能力

这是因为它们属于配置链路，而不是会话运行链路。

### 7.2 AppService / ProjectService 可直接调用 Provider 的情况

以下情况允许直接调用 provider：

- 配置查询
- 模型列表查询
- provider 配置读写
- account/auth/usage 查询

但“运行中的 session 行为”仍应回到 `sessionInstance`。

## 8. 明确禁止的逃逸

以下情况视为架构逃逸，应尽量避免：

### 8.1 UI / Store 直接判断 provider 差异

例如：

- `if provider === 'claude' ...`
- `if provider === 'codex' ...`

如果必须这样写，优先考虑是不是应该下沉到 provider 或 sessionInstance。

### 8.2 前端自己编排 runtime 行为

例如：

- 前端根据能力字段决定 stop/start
- 前端自己串联“改配置 -> 停止 -> 启动”

这些都应属于 `sessionInstance`。

### 8.3 main.cjs 承担会话业务规则

`main.cjs` 只能桥接，不应成为“巨型业务编排层”。

### 8.4 projectService 直接承担运行态会话行为

`projectService` 负责配置与查询，不负责运行中 session 的行为 orchestration。

### 8.5 provider 输出高层 UI 文案

provider 可以输出统一事件类型，但不应直接承担最终用户文案规则。

## 9. 代码改动时的决策顺序

以后遇到新需求或修 bug，按以下顺序判断应该放哪一层：

1. 这是 UI 展示问题，还是运行时行为问题？
2. 如果是运行时行为问题，它是 provider 原始协议差异，还是统一会话行为问题？
3. 原始协议差异放 provider。
4. 统一会话行为放 sessionInstance。
5. 配置查询与配置读写放 appService / projectService。
6. 只有前端状态组织才放 Store。
7. UI 只负责展示与触发。

## 10. 未来维护原则

以后新增 provider 或新增 session 能力时，必须遵守：

1. 新 provider 的原始协议翻译必须收敛在 provider 层。
2. `sessionInstance` 之后不允许再理解 provider 原始协议。
3. 配置切换、重启编排等统一行为必须收敛在 `sessionInstance`。
4. UI 不能因为 provider 增多而越来越多分支判断。
5. 如果某个新需求需要上层知道“这是 Claude 还是 Codex”，先检查是否统一语义设计还不完整。

## 11. 本文档的地位

本文档高于零散实现细节说明。

相关文档：

- `docs/ccgui-runtime-architecture.md`
- `docs/ccgui-provider-semantics.md`

这两份文档描述“当前实现”和“provider 语义”；
而本文档描述的是长期有效的架构边界与设计纲领。
