# Agent Orchestration Research

这份文档整理目前对以下三类执行模型的研究结论：

- Claude Code `subagent`
- Claude Code `agent team`
- Codex `subagent`

目标不是复述某个 provider 的原始协议，而是回答 CCGUI 设计时最关键的几个问题：

- 原始数据流里能不能区分不同代理的动作
- 工具调用和发言是否能归属到具体代理
- 哪些字段是稳定事实，哪些只是某一轮流里的偶然表现
- CCGUI 应该把哪些信息收敛成统一语义

## 结论摘要

### 统一语义结论

目前 CCGUI 对“子代理归属”的统一语义应保持极简，只暴露：

- `ccgui.subagentId`
- `ccgui.subagentType`
- `ccgui.isSubagent`

不要把 provider 原始关联机制泄露到统一语义里，例如：

- `parent_tool_use_id`
- `threadId`
- `receiverThreadIds`
- `task_id`
- `routing.target`

这些都应该在各自 adapter 内部消化，再得出统一结论。

### 能力结论

- Claude `subagent`:
  - 可以明确区分某条工具调用属于哪个子代理
  - 主要依赖 `parent_tool_use_id`、`task_started`、`agentId`
- Claude `agent team`:
  - 可以明确区分 team、team lead、teammate
  - 可以区分“发给哪个成员”的消息
  - 可以区分成员身份，但不是每条事件都带统一的 `teamMemberId`
- Codex `subagent`:
  - 可以区分某条命令属于哪个子代理
  - 主要依赖 `spawnAgent` 建立的子线程与 `threadId`

### 前端设计结论

- `Claude subagent` 更像“附属执行型代理任务”
- `Claude agent team` 和 `Codex subagent` 更接近“协作型代理任务”
- UI 不应只展示“工具调用归属标签”，而应把它们抽象成 `Agent Task`

## 研究样本

本轮研究主要基于以下原始数据：

- Claude `subagent` 样本：
  - `/private/tmp/ccgui/stream/42435a6c-bf87-4f81-9e03-acb5eea35622.log`
- Claude `agent team` 样本：
  - `/private/tmp/ccgui/stream/42435a6c-bf87-4f81-9e03-acb5eea35622.log`
- Codex `subagent` 样本：
  - `/private/tmp/ccgui/stream/e135f96b-a05d-428a-b9eb-8cff96e55f0c.log`
- Claude VS Code 插件样本：
  - `/Users/alwaysking/.vscode/extensions/anthropic.claude-code-2.1.84-darwin-arm64/extension.js`

说明：

- `42435a6c` 这份流前半段可以观察到传统 `subagent`
- 同一份流后半段在开启 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 后，出现了真正的 `agent team` 原语

## 1. Claude Code Subagent

### 1.1 原始流特征

Claude 普通 `subagent` 的主流表现通常是：

1. 主 assistant 发出 `tool_use name:"Agent"`
2. 系统发 `task_started`
3. 子代理内部消息直接回灌到主 stream
4. 子代理内部 `tool_use` / `tool_result` 带 `parent_tool_use_id`
5. 完成结果里出现 `agentId`

这说明 Claude 的普通子代理并不是独立线程模型，而是“主流内嵌的子任务执行流”。

### 1.2 已确认可用的归属线索

在 Claude `subagent` 样本里，可用于归属的原始信息包括：

- 外层 `Agent` 的 `tool_use_id`
- 子消息上的 `parent_tool_use_id`
- `system.task_started.task_id`
- `tool_use_result.agentId`

这组字段足以在 adapter 内部完成归属判断：

- 哪条工具调用属于哪个子代理
- 哪条 `tool_result` 属于哪个子代理
- 某个 `task_started` 对应哪个外层 Agent tool use

### 1.3 统一语义建议

对于 Claude 普通 `subagent`，adapter 最终只需要产出：

- `ccgui.subagentId`
- `ccgui.subagentType`
- `ccgui.isSubagent = true`

原始字段仅用于 adapter 内部计算，不应继续外露。

## 2. Claude Code Agent Team

### 2.1 与普通 Subagent 的本质区别

在开启 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` 后，Claude 不再只是“多个普通 Agent”。

原始流里已经出现了独立的 team 原语：

- `TeamCreate`
- `TeamDelete`
- `SendMessage`
- `lead_agent_id`
- `team_name`
- `teammate_id`
- `task_type: "in_process_teammate"`

因此 `agent team` 在协议层是独立概念，不应简单等同于普通 `subagent`。

### 2.2 创建团队时的原始信息

团队创建后会返回：

- `team_name`
- `team_file_path`
- `lead_agent_id`

这意味着流里可以明确识别：

- 团队实体
- 团队名称
- 团队主持者身份

### 2.3 创建成员时的原始信息

每个 team 成员通过 `Agent` 加 `team_name` 启动，但完成结果已经明显不同于普通子代理。

已确认出现的字段包括：

- `status: "teammate_spawned"`
- `teammate_id`
- `agent_id`
- `name`
- `team_name`
- `color`
- `task_type: "in_process_teammate"`

这说明成员身份是明确存在的，而且成员并不只是“匿名子任务”。

### 2.4 成员通信的原始信息

当 team lead 向成员发消息时，`SendMessage` 的结果里可以看到：

- `routing.sender`
- `routing.target`
- `routing.summary`
- `routing.content`
- 部分场景还有 `recipients`

已确认存在的目标形态包括：

- `@team`
- `@philosopher`
- `@proponent`
- `@opponent`

因此：

- “消息发给了谁”是可明确判断的
- “发送者是谁”也可从 `routing.sender` 判断

### 2.5 成员身份是否能稳定区分

结论是：能区分，但不是靠一个统一字段。

目前看到的成员身份线索分散在不同事件里：

- 创建成员时的 `teammate_id`
- 创建成员时的 `agent_id`
- 创建成员时的 `name`
- 发送消息结果里的 `routing.target`
- 团队配置文件里的 `members[].agentId`

因此不能假设每条 team 相关事件都稳定带一个统一的 `teamMemberId`。

更安全的实现策略是：

- adapter 内部维护 team 状态
- 根据不同事件形态推导成员身份
- 对外只输出 CCGUI 统一语义

### 2.6 当前最可靠的团队级业务概念

就目前样本看，Claude `agent team` 至少有以下稳定业务概念：

- `team`
- `team lead`
- `teammate`
- `team inbox routing`
- `team cleanup`

这意味着前端设计时不应把 `agent team` 继续视作“普通 subagent 的视觉别名”。

## 3. Codex Subagent

### 3.1 原始流特征

Codex 的 `subagent` 更接近独立线程模型，而不是 Claude 这种主流内嵌子链。

当前样本里可以观察到的链路是：

1. 主线程发起 `spawnAgent`
2. 该调用返回 `receiverThreadIds`
3. 子代理在自己的 `threadId` 上运行
4. 子线程里的 `commandExecution` 落在对应 `threadId`

所以 Codex 的关键归属维度不是 `parent_tool_use_id`，而是“哪个子线程”。

### 3.2 已确认可用的归属线索

Codex 样本里，可用于判断归属的原始信息包括：

- `collabAgentToolCall`
- `spawnAgent`
- `receiverThreadIds`
- 子代理事件上的 `threadId`
- 子代理事件上的 `turnId`

归属逻辑是：

- 先从 `spawnAgent` 得到“创建了哪些子线程”
- 再用 `threadId` 把命令、发言、状态更新归到对应子代理

### 3.3 与 Claude 的差异

Claude 普通 `subagent`:

- 更像嵌入主 stream 的任务
- 主要靠父 `tool_use` 关系归属

Codex `subagent`:

- 更像独立线程中的协作者
- 主要靠子线程归属

这也是为什么原始协议层不能直接做字段一一对齐。

### 3.4 统一语义建议

尽管 Codex 的底层机制不同，最终仍应由 adapter 收敛成：

- `ccgui.subagentId`
- `ccgui.subagentType`
- `ccgui.isSubagent`

不要把 `threadId` 暴露为 CCGUI 统一语义。

## 4. VS Code Claude Code 插件观察

### 4.1 插件是否知道 team 存在

知道。

在解包后的 VS Code Claude Code 插件里，可以确认 `teamName` 已经进入 JS 层逻辑。

目前看到的一个重要现象是：

- 带 `teamName` 的消息会像 `isSidechain` 一样，被某些 transcript/session 视图过滤掉

这说明插件运行时至少知道：

- sidechain 消息
- team 消息

是两类特殊消息。

### 4.2 插件是否已经做了完整 team UI

目前没有看到充分证据。

在现有解包 JS 中，还没有找到清晰的：

- `teamMemberId` 统一模型
- team 专用消息面板
- `TeamDelete` 的显式 UI 分支
- 成员会话树

因此更可能的情况是：

- 插件内核已经理解 team 相关原始事件
- 但 UI 层不一定已经把它做成完整的显式团队界面

### 4.3 设计启发

这给 CCGUI 一个很重要的提示：

- 不要被某个现有插件的“是否已经渲染出来”限制住
- 原始协议里已经存在足够强的 team 语义
- CCGUI 可以在统一语义和 UI 抽象上先走得更干净

## 5. 统一语义与适配边界

### 5.1 不应暴露到统一语义的字段

这些字段可能对 adapter 有用，但不应成为 CCGUI 对外语义：

- Claude:
  - `parent_tool_use_id`
  - `task_id`
  - `agentId`
- Claude agent team:
  - `routing.target`
  - `routing.sender`
  - `teammate_id`
  - `lead_agent_id`
- Codex:
  - `threadId`
  - `receiverThreadIds`
  - `turnId`

### 5.2 应暴露到统一语义的字段

当前最小可行统一语义：

- `ccgui.subagentId`
- `ccgui.subagentType`
- `ccgui.isSubagent`

如果未来需要支持 team 独立展示，再考虑新增一层更高阶业务语义，例如：

- `ccgui.agentTaskId`
- `ccgui.agentTaskKind`
- `ccgui.teamId`
- `ccgui.teamMemberId`

但在没有跨 provider 稳定定义前，不建议现在就把这些字段写死进统一语义。

## 6. 对前端设计的启发

### 6.1 不要只做“命令归属标签”

如果前端只在工具卡片上加一个 “来自 subagent” 标签，会丢掉大量结构信息。

更好的抽象是：

- 把相关消息聚合成 `Agent Task`

### 6.2 建议区分两类展示形态

#### 附属执行型

更接近 Claude 普通 `subagent`：

- 重点是任务状态
- 重点是工具调用
- 重点是最终结果

#### 协作会话型

更接近 Claude `agent team` 与 Codex `subagent`：

- 重点是会话上下文
- 重点是消息往来
- 重点是代理身份
- 工具调用只是内部过程的一部分

### 6.3 当前设计方向

前端更适合先统一成：

- `Agent Task` 组件

再根据 provider 语义和实际形态选择不同的展开模板，而不是直接把不同 provider 的原始结构暴露给 UI。

## 7. 待继续验证的问题

以下问题目前仍建议保持开放，不应过早写死：

- Claude `agent team` 是否会在所有成员发言事件上稳定带同一种成员身份字段
- Claude `agent team` 是否支持真正的“用户直接对某个成员发消息”交互流，并且该流在原始协议里如何表示
- Codex `subagent` 是否会进一步出现 team-like 协作模型，而不只是 `spawnAgent` 子线程
- VS Code Claude Code 插件中是否有 team 相关逻辑藏在原生二进制而不是解包 JS 中

## 8. 当前推荐策略

短期策略：

1. adapter 内部完成 provider 级归属推导
2. 统一语义保持极简
3. store 只负责组织展示态，不再理解 provider 原始协议
4. UI 先抽象为 `Agent Task`

中期策略：

1. 在更多 team / Codex 样本上继续验证成员身份字段稳定性
2. 如果 team/member 语义足够稳定，再升级统一语义
3. 在 UI 中区分“执行型代理任务”和“协作型代理任务”
