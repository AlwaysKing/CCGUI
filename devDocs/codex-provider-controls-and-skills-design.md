# Codex Provider 控制命令与 Mention/Skills 协议设计

**文档版本**: 1.2  
**最后更新**: 2026-04-20

## 目标

这份文档只处理 `CCGUI` 在 `Codex` provider 侧真正需要接入、并且已经查实到可直接复刻程度的能力：

1. 控制类命令
   - `compact`
   - `memories`
2. 普通消息中的 mention / skills / apps / plugins
   - 不是“执行 slash 命令”
   - 也不是在普通提交路径里拆成独立 `UserInput::skill / UserInput::mention`
   - 而是先在 composer 中插入富文本 mention 节点，提交时再序列化回单个 `text` input

本文刻意排除：

- `Codex.app` 自身 UI 命令
- 仅用于本地面板切换的 slash 命令
- `MCP` 状态查看命令
- `Claude` 风格的 `MCP prompt -> slash command`

---

## 一句话结论

- `compact` 和 `memories` 在 `Codex` 中都不是普通文本命令，而是结构化控制动作。
- `Codex` 的动态 skills slash 命令不是“立即执行技能”，而是把 skill / app / plugin mention 节点插入 composer。
- `Codex` 协议虽然明文支持 `UserInput.type = "skill" | "mention"`，但当前桌面端普通 composer 提交路径并不使用这两个独立输入项。
- 当前官方桌面端普通提交路径会把 mention 节点重新序列化成一段带标记的文本，再放进单个 `text` input 提交。
- `CCGUI` 要复刻当前 `Codex.app` 行为，就不该在普通消息里拆分 `input[]`；而应复刻它的文本编码语义。

---

## 1. 调查来源与证据级别

本次结论按证据强度排序，主要来自两类来源：

### 1.1 最强证据：`codex app-server generate-ts`

直接运行：

```bash
/Applications/Codex.app/Contents/Resources/codex app-server generate-ts --out /tmp/codex-app-protocol-latest
```

生成的协议绑定文件位于：

- `/tmp/codex-app-protocol-latest`

### 1.2 次强证据：最新版 `Codex.app` 解包前端

主要用于补齐“前端 slash 命令最终调用了什么 action / request”以及“composer 节点如何序列化成 prompt 文本”：

- `/Users/alwaysking/Desktop/codex2/app_unpacked/webview/assets/index-n7COQvZQ.js`
- `/Users/alwaysking/Desktop/codex2/app_unpacked/webview/assets/app-server-manager-signals-c8uaRIK1.js`
- `/Users/alwaysking/Desktop/codex2/app_unpacked/webview/assets/use-model-settings-DEaRTAXy.js`

---

## 2. 已查实事实

### 2.1 `compact` 不是 slash 文本，而是结构化请求

`Codex.app` 中的 `/compact` 不是发送 `/compact` 文本。

已确认链路：

1. slash 命令选择 `/compact`
2. 前端调用 `compactThread(conversationId)`
3. owner 模式最终发：
   - `thread/compact/start`
4. follower 模式最终发：
   - `thread-follower-compact-thread`

证据：

- 页面执行链：
  [index-n7COQvZQ.js](/Users/alwaysking/Desktop/codex2/app_unpacked/webview/assets/index-n7COQvZQ.js)
- app-server 请求定义：
  [ClientRequest.ts](/tmp/codex-app-protocol-latest/ClientRequest.ts)
- 参数类型：
  [ThreadCompactStartParams.ts](/tmp/codex-app-protocol-latest/v2/ThreadCompactStartParams.ts)

明确协议：

```ts
type ThreadCompactStartParams = {
  threadId: string
}
```

结论：

- `compact` 是 provider 控制动作
- 不是普通消息
- 不是 slash 文本

### 2.2 `memories` 不是 slash 文本，而是结构化请求

`Codex.app` 中的 `/memories` 不是发送 `/memories` 文本。

已确认链路：

1. slash 命令选择 `/memories`
2. 打开本地 memories 配置 UI
3. 前端 action：
   - `set-thread-memory-mode-for-host`
4. action 最终发：
   - `thread/memoryMode/set`

前端源码里已经能看到这个 action 的最终 request 形状：

```js
"set-thread-memory-mode-for-host": s9((e, { hostId: t, ...n }) =>
  e.sendRequest("thread/memoryMode/set", n)
)
```

调用方实际构造的是：

```js
{ hostId, threadId, mode: enabled ? "enabled" : "disabled" }
```

证据：

- slash 触发与调用链：
  [index-n7COQvZQ.js](/Users/alwaysking/Desktop/codex2/app_unpacked/webview/assets/index-n7COQvZQ.js)
- action 到 request 的映射：
  [use-model-settings-DEaRTAXy.js](/Users/alwaysking/Desktop/codex2/app_unpacked/webview/assets/use-model-settings-DEaRTAXy.js)
- mode 枚举：
  [ThreadMemoryMode.ts](/tmp/codex-app-protocol-latest/ThreadMemoryMode.ts)

已查实参数语义：

```ts
type ThreadMemoryMode = "enabled" | "disabled"
```

已查实请求形状：

```ts
{
  method: "thread/memoryMode/set",
  params: {
    threadId: string,
    mode: "enabled" | "disabled"
  }
}
```

结论：

- `memories` 也是 provider 控制动作
- `mode` 应直接沿用 `enabled / disabled`

### 2.3 `MCP` 不是当前 Codex 里要复刻的 service 命令系统

这次调查没有查到 `Codex` 把 `MCP prompt` 或 `MCP command` 自动挂成 slash 命令。

已确认：

- `/mcp` 只用于“查看 MCP server status”
- 没有查到它控制某个 MCP 被当前会话使用
- 没有查到 `Claude` 风格的 `/mcp__server__prompt`

结论：

- 当前 `CCGUI` 不需要为 `Codex` 复刻“MCP slash 命令系统”

### 2.4 动态 skills 命令不是“执行命令”，而是“插入 composer mention 节点”

`Codex.app` 中的动态 skills slash 命令不是“执行技能命令”。

已确认：

- slash 菜单会动态出现 skills
- 这些项来源于当前已加载的 skills 集合
- 选中后不会发独立 `run skill` 请求
- 它的作用是把 skill 作为 composer mention 节点插入当前输入框

结论：

- 这本质上是“composer 富文本插入能力”
- 不是控制请求
- 也不是附件上传

### 2.5 `skill / mention` 既是协议一级概念，也是当前前端里的富文本节点

`Codex` 协议明文支持以下 `UserInput` 变体：

```ts
type UserInput =
  | { type: "text", text: string, text_elements: Array<TextElement> }
  | { type: "image", url: string }
  | { type: "localImage", path: string }
  | { type: "skill", name: string, path: string }
  | { type: "mention", name: string, path: string }
```

证据：

- [UserInput.ts](/tmp/codex-app-protocol-latest/v2/UserInput.ts)

同时，当前桌面端前端的 composer 里还存在一套富文本节点模型：

- `atMention`
- `agentMention`
- `skillMention`
- `appMention`
- `pluginMention`

证据：

- [use-model-settings-DEaRTAXy.js](/Users/alwaysking/Desktop/codex2/app_unpacked/webview/assets/use-model-settings-DEaRTAXy.js)

结论：

- 协议层支持独立 `UserInput`
- 编辑器层实际先用 mention 节点建模
- 普通提交时再把这些节点序列化回文本

### 2.6 `turn/start` 和 `turn/steer` 都直接吃 `Array<UserInput>`

`turn/start` 的协议形状已查实：

```ts
type TurnStartParams = {
  threadId: string
  input: Array<UserInput>
  cwd?: string | null
  approvalPolicy?: AskForApproval | null
  approvalsReviewer?: ApprovalsReviewer | null
  sandboxPolicy?: SandboxPolicy | null
  model?: string | null
  serviceTier?: ServiceTier | null
  effort?: ReasoningEffort | null
  summary?: ReasoningSummary | null
  personality?: Personality | null
  outputSchema?: JsonValue | null
  collaborationMode?: CollaborationMode | null
}
```

证据：

- [TurnStartParams.ts](/tmp/codex-app-protocol-latest/v2/TurnStartParams.ts)

### 2.7 当前 `Codex.app` 普通 composer 提交路径实际发送的是单个 `text` input

普通聊天提交时，前端构造的是：

```js
input: [
  {
    type: "text",
    text: Kn(context),
    text_elements: []
  },
  ...imageInputs
]
```

关键点：

- `input[]` 第一项固定是单个 `text`
- `text_elements` 在这条真实路径里是空数组
- mention / skill 没有在这里拆成独立并列 `UserInput`

证据：

- [index-n7COQvZQ.js](/Users/alwaysking/Desktop/codex2/app_unpacked/webview/assets/index-n7COQvZQ.js)
- [use-navigate-to-local-conversation-DL1VFrRB.js](/Users/alwaysking/Desktop/codex2/app_unpacked/webview/assets/use-navigate-to-local-conversation-DL1VFrRB.js)

### 2.8 `Kn(context)` 最终会把 composer 内容序列化成普通文本

提交链里的 `Kn(...)` 实际来自：

- `index-n7COQvZQ.js` 中导入的 `Yn as Kn`
- 对应到 [app-server-manager-signals-c8uaRIK1.js](/Users/alwaysking/Desktop/codex2/app_unpacked/webview/assets/app-server-manager-signals-c8uaRIK1.js) 里的 `Ki(...)`

`Ki(e)` 的真实逻辑是：

```js
function Ki(e) {
  let t = Ji(e)
  return `${t ? `${t}\n${G}\n` : ``}${e.prompt}\n`
}
```

其中：

- `G = "## My request for Codex:"`
- `e.prompt` 就是 composer 导出的文本

结论：

- 最终提交给 `turn/start.input[0].text` 的核心正文就是 `prompt`
- 所以要复刻当前桌面端，关键不是拼结构化 `UserInput[]`
- 而是生成和它一致的 `prompt` 文本编码

### 2.9 `prompt` 的真实编码格式已经查实

当前富文本 composer 的“节点 -> 文本”序列化函数是：

- `yN(doc)`

证据：

- [use-model-settings-DEaRTAXy.js](/Users/alwaysking/Desktop/codex2/app_unpacked/webview/assets/use-model-settings-DEaRTAXy.js)

已查实的序列化规则：

#### 2.9.1 文件 mention

`atMention` 会被序列化成：

```md
[label](path)
```

不是 `@[label](path)`。

#### 2.9.2 agent / subagent mention

`agentMention` 会被序列化成：

```md
[@DisplayName](agent://...)
[@RoleName](subagent://...)
```

#### 2.9.3 skill / app / plugin mention

`skillMention` / `appMention` / `pluginMention` 会被序列化成：

```md
[$skillName](/abs/path/to/SKILL.md)
[$appName](app://app-id)
[@pluginName](plugin://plugin-id)
```

其中最关键的事实是：

- `skill` 和 `app` 走 `$`
- `plugin` 走 `@`

这不是猜测，而是 `yN(...)` 里的明文逻辑：

```js
let prefix = node.type.name === "pluginMention" ? "@" : "$"
```

### 2.10 触发入口也已经查实：`@` 和 `$` 是两套不同 UI

前端编辑器明确注册了三套触发器：

- `@` -> `mention-ui`
- `$` -> `skill-mention-ui`
- `/` -> `slash-command-ui`

证据：

- `Koe(...)` -> `trigger: '@'`
- `xle(...)` -> `trigger: '$'`
- `Sle(...)` -> `trigger: '/'`
- 文件位置同上：[use-model-settings-DEaRTAXy.js](/Users/alwaysking/Desktop/codex2/app_unpacked/webview/assets/use-model-settings-DEaRTAXy.js)

当前桌面端的真实入口语义是：

- `@`：文件、agent，以及 plugin
- `$`：skill、app，以及 skill-like app entries

### 2.11 反向解析也已经查实

`promptTextToDoc` 对应函数：

- `SN({ schema, text })`

内部使用：

- `_le(schema, lineText)`

它会把以下文本重新解析回 mention 节点：

```md
[$skill](...)
[$app](app://...)
[@plugin](plugin://...)
[@agent](agent://...)
[pathLabel](/abs/path/file)
```

这说明这些文本标记不是临时展示字符串，而是当前桌面端 composer 的正式持久化格式。

---

## 3. CCGUI provider 统一语义设计

### 3.1 控制类命令

`CCGUI` 可以收敛出统一 provider control 语义：

```ts
type ProviderControlRequest =
  | { kind: "compact_context", threadId: string }
  | { kind: "set_memory_mode", threadId: string, mode: "enabled" | "disabled" }
```

在 `Codex` provider 中的映射：

- `compact_context` -> `thread/compact/start`
- `set_memory_mode` -> `thread/memoryMode/set`

### 3.2 普通消息输入

如果目标是**复刻当前 `Codex.app` 行为**，`CCGUI` 在 `Codex` provider 中应采用：

```ts
type CodexPromptPart =
  | { type: "text"; text: string }
  | { type: "file_mention"; label: string; path: string }
  | { type: "agent_mention"; displayName: string; path: string }
  | { type: "skill_mention"; name: string; path: string }
  | { type: "app_mention"; name: string; path: string }
  | { type: "plugin_mention"; name: string; path: string }
```

然后先序列化成 `prompt` 文本，再发送：

```ts
input: [
  { type: "text", text: serializedPrompt, text_elements: [] },
  ...imageInputs
]
```

而不是把这些 mention 直接拆成并列 `UserInput[]`。

### 3.3 `CodexClient.sendMessage()` 的直接落点

最自然的实现位置仍然是：

- [client.js](/Users/alwaysking/AKProject/CCGUI/electron/adapters/codex/client.js)

建议实现：

1. provider 层先把统一语义 mention 转成 `prompt` 文本
2. `sendMessage()` 仍发单个 `text` input
3. 仅图片继续拆成独立 `image / localImage`

映射规则建议：

- 文本与 mention 先合成为 `serializedPrompt`
- `serializedPrompt` -> `{ type: "text", text: serializedPrompt, text_elements: [] }`
- 远程图片 -> `{ type: "image", url }`
- 本地图片 -> `{ type: "localImage", path }`

### 3.4 文本编码规则

建议 `CCGUI` 直接对齐当前 `Codex.app` 的文本格式：

- 文件 mention -> `[label](path)`
- agent mention -> `[@name](agent://...)`
- subagent mention -> `[@name](subagent://...)`
- skill mention -> `[$name](/abs/path/SKILL.md)`
- app mention -> `[$name](app://id)`
- plugin mention -> `[@name](plugin://id)`

---

## 4. 当前已足够支撑实现的结论

- `CCGUI` 对 `Codex` 的 skills / app / plugin / file / agent 支持，应该先编码进 `prompt` 文本
- `CodexClient.sendMessage()` 在普通消息路径下仍应发单个 `text` input
- `compact` 和 `memories` 应作为独立 provider control request
- `@` 与 `$` 必须分开建模，因为当前桌面端入口和编码语义不同

## 4.1 实施语义补充

为了避免在 `CCGUI` 内部把 command 与 user message 混淆，Codex 侧的实现应进一步满足：

- `命令型 /` 不进入普通 input 文本
- UI 点击命令后走独立 `runCommands`
- `session-instance` 先产生 `role = "command"` 的独立消息事件，供前端渲染命令气泡
- 然后再调用 provider 执行
- `Codex` provider 不应把 `/compact`、`/memories` 退化成普通 user text
- 而应映射到专门 request，例如：
  - `/compact` -> `thread/compact/start`
  - `/memories <mode>` -> `thread/memoryMode/set`

这样 `CCGUI` 层保持统一：

- user message 是 user message
- command 是 command
- reference 是 reference

provider 再负责把 command 编译到各自真正的后端语义。

---

## 5. 尚未继续深挖的边界

这一轮后，和“可直接复刻”相关的主链已经基本查实。

剩余未继续深挖的边界只有：

- `turn/steer` 在包含 mention 时是否完全复用同一套 `prompt` 序列化函数
- 非普通 composer 场景是否存在直接使用 `UserInput::skill / UserInput::mention` 的旁路

但就 `CCGUI` 需要复刻的日常聊天输入路径来说，当前证据已经足够直接实现。
