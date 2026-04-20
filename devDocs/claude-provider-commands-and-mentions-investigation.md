# Claude Provider 命令与 Mention 调查

**文档版本**: 1.1  
**最后更新**: 2026-04-20

## 目标

这份文档聚焦 `CCGUI` 后续接入 `Claude` 时最相关的两块：

1. `/` 命令系统
2. `@` mention，尤其是 MCP resources

本文只写已经查实的事实，并明确标出还没有抓到 raw 协议包的地方。

---

## 一句话结论

- `Claude` 的 slash command 系统是完整存在的，来源分为：
  - 内置命令
  - 本地 skill / command 发现
  - MCP prompts 动态发现
- `MCP prompts` 会自动成为：
  - `/mcp__<server-name>__<prompt-name>`
- `MCP resources` 可以通过 `@server:protocol://resource/path` 引用，但在 `Claude CLI --print --input-format stream-json --output-format stream-json` 的实测里，直接用户输入的 `@resource` 并不会在发起首轮 query 前被预抓成附件；实际表现是模型随后调用 `ReadMcpResourceTool` 去读取资源。
- 从 `Claude` 源码已经可以直接确认：
  - slash commands 是命令对象，不是单纯 prompt 文本
  - 分为 `prompt`、`local`、`local-jsx` 三类
  - `print/stream-json` 模式下仍然支持 slash commands
  - `local-jsx` 命令不会透传到远端，`prompt` 命令会继续转换成消息+attachment 后进入 query
- 这次已经补上了两条关键运行时样本：
  - MCP prompt slash command：`/mcp__probe__ping`
  - MCP resource mention：`@probe:probe://hello`

---

## 1. 调查来源

本次结论来自四类来源：

### 1.1 官方文档

- [Slash commands](https://code.claude.com/docs/en/slash-commands)
- [MCP](https://code.claude.com/docs/en/mcp)

### 1.2 本机 `Claude Code` changelog

- [changelog.md](/Users/alwaysking/.claude/cache/changelog.md)

### 1.3 本机会话/历史记录

- [history.jsonl](/Users/alwaysking/.claude/history.jsonl)
- `~/.claude/projects/**/*.jsonl`

### 1.4 `CCGUI` 当前 Claude 接入实现

- [client.js](/Users/alwaysking/AKProject/CCGUI/electron/adapters/claude/client.js)
- [adapter.js](/Users/alwaysking/AKProject/CCGUI/electron/adapters/claude/adapter.js)

### 1.5 `Claude` 源码

- [main.tsx](/Users/alwaysking/AKProject/claude-code/src/main.tsx)
- [print.ts](/Users/alwaysking/AKProject/claude-code/src/cli/print.ts)
- [commands.ts](/Users/alwaysking/AKProject/claude-code/src/commands.ts)
- [command.ts](/Users/alwaysking/AKProject/claude-code/src/types/command.ts)
- [processSlashCommand.tsx](/Users/alwaysking/AKProject/claude-code/src/utils/processUserInput/processSlashCommand.tsx)
- [processUserInput.ts](/Users/alwaysking/AKProject/claude-code/src/utils/processUserInput/processUserInput.ts)
- [slashCommandParsing.ts](/Users/alwaysking/AKProject/claude-code/src/utils/slashCommandParsing.ts)
- [client.ts](/Users/alwaysking/AKProject/claude-code/src/services/mcp/client.ts)
- [attachments.ts](/Users/alwaysking/AKProject/claude-code/src/utils/attachments.ts)
- [messages.ts](/Users/alwaysking/AKProject/claude-code/src/utils/messages.ts)
- [directConnectManager.ts](/Users/alwaysking/AKProject/claude-code/src/server/directConnectManager.ts)

---

## 2. 已查实事实

## 2.1 `CCGUI` 现在接的是 `Claude CLI --print --stream-json`

`CCGUI` 当前不是在模拟 Claude 的 TUI，而是直接启动 `Claude CLI`：

```js
const args = [
  '--print',
  '--verbose',
  '--output-format', 'stream-json',
  '--input-format', 'stream-json',
  '--permission-prompt-tool', 'stdio',
  '--include-partial-messages',
  '--replay-user-messages'
]
```

证据：

- [client.js](/Users/alwaysking/AKProject/CCGUI/electron/adapters/claude/client.js:326)

这意味着：

- `CCGUI` 侧接入 `Claude` 时，真正要关心的是 `Claude CLI` 的 stream-json 行为
- 不需要复刻 TUI 菜单本身

## 2.1.1 `stream-json` 下的 user message 形状

源码里已经能直接看到 SDK / stream-json user message 形状：

```js
{
  type: 'user',
  message: {
    role: 'user',
    content
  },
  parent_tool_use_id: null,
  session_id: ''
}
```

证据：

- [directConnectManager.ts](/Users/alwaysking/AKProject/claude-code/src/server/directConnectManager.ts:130)

这说明：

- `stream-json` 下发送给 Claude 的仍然是标准 user message
- slash/mention 是否被解释，是 CLI 内部后续处理逻辑决定的

## 2.1.2 最小 `stream-json` 复现实测结果

这轮已经直接用本机 CLI 做了最小复现，启动参数与 `CCGUI` 一致：

```bash
claude \
  --print \
  --verbose \
  --bare \
  --output-format stream-json \
  --input-format stream-json \
  --replay-user-messages
```

然后通过 stdin 发送：

```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": "/compact"
  },
  "parent_tool_use_id": null,
  "session_id": ""
}
```

实测结果：

1. 所有输入都会先收到一条 `system/init`
   - 里面直接包含：
     - `slash_commands`
     - `skills`
     - `plugins`
   - 这说明 `stream-json` 模式下，CLI 会主动把当前可用命令表暴露出来

2. `/compact`
   - 没有进入 API retry
   - 直接返回：
     - 一条 `assistant` 消息，内容是 `Error: No messages to compact`
     - 一条 `result success`
   - 说明它是本地处理的 slash command

3. `/help`、`/model`
   - 在这次 `--bare` 复现里，直接返回：
     - `result: "Unknown skill: help"`
     - `result: "Unknown skill: model"`
   - 这也说明它们没有被当作普通文本发给模型，而是先进入了本地 slash 解析链；只是当前 `bare` 命令表里没有这两个命令

4. 普通文本 `hello`
   - 会进入正常 query 路径
   - 实测输出出现连续的：
     - `system/api_retry`
   - 说明普通文本与 slash command 走的是不同链路

这组最小复现非常关键，因为它把前面基于源码的结论进一步变成了运行时实测：

- slash commands 在 `stream-json` 下确实被本地处理
- 普通文本会进入正常模型请求链

## 2.1.3 MCP prompt / MCP resource 运行时实测

这轮额外起了一个最小本地 stdio MCP probe server，验证 `Claude CLI --print --stream-json` 下与 MCP 的真实交互。

### 启动方式

使用的 `Claude CLI` 启动参数：

```bash
claude \
  --print \
  --verbose \
  --output-format stream-json \
  --input-format stream-json \
  --permission-prompt-tool stdio \
  --include-partial-messages \
  --replay-user-messages \
  --setting-sources user,project,local \
  --strict-mcp-config \
  --mcp-config '{ "mcpServers": { ... } }'
```

这次验证到两个重要事实：

1. `stdio` MCP 传输在当前 `Claude Code 2.1.92` 实测下使用的是**换行分隔 JSON**，不是 `Content-Length` framing。
2. `system/init` 会在 MCP 连接成功后直接暴露：
   - `mcp_servers: [{ name: "probe", status: "connected" }]`
   - `slash_commands` 里新增 `mcp__probe__ping`
   - `tools` 里包含 `ListMcpResourcesTool` 和 `ReadMcpResourceTool`

### A. `/mcp__probe__ping` 的真实路径

probe server 日志里，`Claude` 的实际 MCP 交互序列是：

1. `initialize`
2. `notifications/initialized`
3. `prompts/list`
4. `resources/list`
5. `prompts/get { name: "ping" }`

这说明：

- `MCP prompt` 会在连接成功后通过 `prompts/list` 发现
- 然后注册成 slash command
- 选择 slash command 后，再通过 `prompts/get` 取具体 prompt 内容

对应的 `stream-json` 输出里还能看到：

- `system/init.slash_commands` 包含 `mcp__probe__ping`
- replayed user message 不是普通原始文本，而是：

```text
<command-message>mcp__probe__ping</command-message>
<command-name>/mcp__probe__ping</command-name>
```

同时模型在 thinking 中已经能看到 prompt 内容 `"MCP prompt ping response"`，最终正常回答。

结论：

- `/mcp__server__prompt` 在 `stream-json` 下**确实是本地 slash command**
- 它不是把 `/mcp__...` 原样发给模型
- 它会先走本地命令解析，再通过 `prompts/get` 取 prompt，再把命令和 prompt 内容转换成消息上下文

### B. `@probe:probe://hello` 的真实路径

对直接用户输入：

```text
Please summarize @probe:probe://hello in one sentence.
```

probe server 日志里，`Claude` 的实际 MCP 交互序列是：

1. `initialize`
2. `notifications/initialized`
3. `prompts/list`
4. `resources/list`
5. `resources/read { uri: "probe://hello" }`

对应的 `stream-json` 输出里可以明确看到：

- replayed user message 仍然是原始文本：

```text
Please summarize @probe:probe://hello in one sentence.
```

- 首轮 assistant 先发起一个工具调用：

```json
{
  "type": "tool_use",
  "name": "ReadMcpResourceTool",
  "input": {
    "server": "probe",
    "uri": "probe://hello"
  }
}
```

- 然后 tool result 返回：

```json
{
  "contents": [
    {
      "uri": "probe://hello",
      "mimeType": "text/plain",
      "text": "Hello from MCP resource"
    }
  ]
}
```

结论：

- 在 `stream-json` / print 模式下，**直接用户输入里的 `@mcp-resource` 没有在首轮 query 前被自动预抓成 attachment**
- 实际表现是模型随后调用 `ReadMcpResourceTool`
- 因此如果 `CCGUI` 是以 CLI `stream-json` 方式接入 `Claude`，就不能把“所有 `@mcp-resource` 都会在发送前自动变附件”当成确定事实
- 最稳的说法应该是：
  - 源码和文档都支持 MCP resource mention 语义
  - 但在当前 `stream-json` 实测里，直接用户消息这条链体现为**工具调用读取**，而不是**发送前注入附件**

## 2.2 `Claude` 的 slash command 系统是完整存在的

官方文档明确列出了内置 slash commands，例如：

- `/compact`
- `/memory`
- `/model`
- `/permissions`
- `/mcp`
- `/agents`
- `/clear`

证据：

- [Slash commands 文档](https://code.claude.com/docs/en/slash-commands)

说明：

- 这部分不是推测
- 是官方明确公开能力

## 2.2.1 slash commands 在源码里是正式命令对象

源码中 `Command` 被明确定义成三类：

- `prompt`
- `local`
- `local-jsx`

其中：

- `prompt` 命令会产出 prompt 内容并继续进入模型 query
- `local` / `local-jsx` 是本地执行命令

证据：

- [command.ts](/Users/alwaysking/AKProject/claude-code/src/types/command.ts)

这意味着：

- `Claude` 的 slash commands 不是简单字符串开关
- 是一套结构化命令系统

## 2.3 自定义 commands 已经并入 skills

官方文档明确写到：

- 自定义 commands 已经并入 skills
- `.claude/commands/deploy.md` 和 `.claude/skills/deploy/SKILL.md` 都会产生 `/deploy`
- 旧的 `.claude/commands/` 目录仍然兼容

官方原文证据：

- [Slash commands 文档，第 87 行附近](https://code.claude.com/docs/en/slash-commands)

本机 changelog 也能对应到这条演化路径：

- `Custom slash commands: Markdown files in .claude/commands/ directories now appear as custom slash commands to insert prompts into your conversation`
- `Merged slash commands and skills, simplifying the mental model with no change in behavior`

证据：

- [changelog.md:2918](/Users/alwaysking/.claude/cache/changelog.md:2918)
- [changelog.md:1603](/Users/alwaysking/.claude/cache/changelog.md:1603)

结论：

- 在 `Claude` 里，slash command 和 skill 已经是同一条发现/调用心智模型

## 2.4 skills 可以直接形成 `/skill-name`

官方文档明确说明：

- `SKILL.md` frontmatter 里的 `name` 会成为 `/slash-command`
- skill 可自动触发，也可手动通过 `/skill-name` 调用

证据：

- [Slash commands 文档，第 115-139 行附近](https://code.claude.com/docs/en/slash-commands)

这意味着：

- 对 `Claude` 来说，skill 不是 `Codex` 那种独立结构化 `UserInput::Skill`
- 而是会直接进入 slash command 体系

## 2.5 MCP prompts 会自动变成 slash commands

官方文档已明确确认：

- MCP servers 暴露的 prompts 会自动变成 slash commands
- 格式为：

```text
/mcp__<server-name>__<prompt-name> [arguments]
```

- 动态发现条件：
  - MCP server 已连接且可用
  - server 通过 MCP 协议暴露 prompts
  - prompts 成功在连接时被取回

证据：

- [Slash commands 文档](https://code.claude.com/docs/en/slash-commands)

结论：

- `Claude` 的 MCP prompts 不是普通工具调用列表
- 它们会直接进入 slash command 层

## 2.5.1 MCP prompts 在源码里如何生成命令

`fetchCommandsForClient()` 里会直接请求 MCP：

```ts
{ method: 'prompts/list' }
```

然后把返回的 prompt 转成 `Command`：

- `type: 'prompt'`
- `name: 'mcp__' + normalizeNameForMCP(client.name) + '__' + prompt.name`
- `isMcp: true`
- `source: 'mcp'`
- `getPromptForCommand(args)` 内部再调 `client.getPrompt(...)`

证据：

- [client.ts](/Users/alwaysking/AKProject/claude-code/src/services/mcp/client.ts:2033)

这条已经是源码级实锤：

- MCP prompt 命令不是“文档说有”
- 而是源码里明确通过 `prompts/list -> getPrompt` 构建成 slash command

## 2.6 MCP resources 可以通过 `@` 引用，并自动变成 attachments

官方文档明确说明：

- MCP resources 可以通过 `@server:protocol://resource/path` 引用
- 当被引用时：
  - resources 会被自动抓取
  - 并作为 attachments 注入上下文

官方原文证据：

- [MCP 文档，第 820-823 行附近](https://code.claude.com/docs/en/mcp)

这点很关键，因为它说明：

- `Claude` 的某些 mention 语义最终确实会落成 attachment-like 上下文注入
- 至少 MCP resources 这一类是这样

## 2.6.1 MCP resources 在源码里如何被提取和注入

源码里有明确的 mention 提取函数：

```ts
extractMcpResourceMentions(content: string)
```

它按：

```text
@server:uri
```

这种格式提取资源 mention。

证据：

- [attachments.ts](/Users/alwaysking/AKProject/claude-code/src/utils/attachments.ts:2793)

更关键的是，`processSlashCommand()` 在执行 prompt 命令后，会从命令文本结果里继续调用：

```ts
getAttachmentMessages(...)
```

注释里直接写了：

- `@-mentions`
- `MCP resources`
- `agent mentions in SKILL.md`

都会在这一步被转成 attachment messages。

证据：

- [processSlashCommand.tsx](/Users/alwaysking/AKProject/claude-code/src/utils/processUserInput/processSlashCommand.tsx:892)

最后，`messages.ts` 对 `mcp_resource` attachment 的渲染/注入也有明确实现：

- 会把资源内容转成 `createUserMessage({ content: transformedBlocks, isMeta: true })`
- 也就是模型可见、对用户隐藏的 meta user message

证据：

- [messages.ts](/Users/alwaysking/AKProject/claude-code/src/utils/messages.ts:3878)

所以这条现在可以定成源码级结论：

- `@mcp-resource` 最终就是 attachment message
- 再进一步变成 meta user message 注入上下文

## 2.7 slash commands 正常路径不是“作为普通文本发给模型”

这条没有官方单独写成“协议说明”，但本机 changelog 给了非常强的反证。

本机 changelog 明确出现过两个修复项：

1. `Fixed slash commands being sent to the model as text when submitted while a message is processing`
2. `Fixed local slash command output like /cost appearing as user-sent messages instead of system messages in the UI`

证据：

- [changelog.md:448](/Users/alwaysking/.claude/cache/changelog.md:448)
- [changelog.md:989](/Users/alwaysking/.claude/cache/changelog.md:989)

这两条的含义非常直接：

- 正常路径下，slash commands 不应该被当成普通用户文本发给模型
- 本地 slash commands 的输出也不应该被当成普通 user message

所以这轮可以把下面这条定性为“已高度查实”：

- `Claude` 的 slash commands 是 CLI 本地处理逻辑，不是简单 prompt 文本

## 2.7.1 这条现在已经被源码进一步坐实

源码里 `processUserInput()` 对以 `/` 开头的输入会优先走：

```ts
parseSlashCommand(...)
processSlashCommand(...)
```

证据：

- [processUserInput.ts](/Users/alwaysking/AKProject/claude-code/src/utils/processUserInput/processUserInput.ts:430)
- [slashCommandParsing.ts](/Users/alwaysking/AKProject/claude-code/src/utils/slashCommandParsing.ts)

同时 `main.tsx` 里还有一条很关键的注释：

- `initialPrompt goes first so its slash command (if any) is processed`

证据：

- [main.tsx](/Users/alwaysking/AKProject/claude-code/src/main.tsx:2091)

这说明：

- slash command 不仅在交互 TUI 下会处理
- 在 `print / stream-json` 路径的初始输入里，同样会被处理

## 2.8 本机 history 能看到 slash command 作为用户输入入口

本机 `history.jsonl` 里有真实记录：

- [history.jsonl:62](/Users/alwaysking/.claude/history.jsonl:62)

其中能看到：

- `"/model"`

这说明：

- slash commands 的用户输入入口确实就是字面上的 `/command`

但它不等于“最终原样作为消息发给模型”，这一点要和上一节区分开。

## 2.9 `SlashCommand tool` 存在

本机 changelog 还能确认：

- 存在一个 `SlashCommand tool`
- 说明 Claude 自己也能调用 slash commands

证据：

- [changelog.md:2252](/Users/alwaysking/.claude/cache/changelog.md:2252)

这说明 slash commands 在 `Claude` 内部已经不是单纯 UI 菜单项，而是被建模成可调用能力。

## 2.10 `CCGUI` 当前 Claude 适配层已经把 slashCommands 当成单独上下文统计项

当前 `CCGUI` 的 Claude 适配层里，可以看到运行时 payload 中有：

```js
slashCommands: payload.slashCommands || {
  totalCommands: 0,
  includedCommands: 0,
  tokens: 0
}
```

证据：

- [adapter.js](/Users/alwaysking/AKProject/CCGUI/electron/adapters/claude/adapter.js:1257)

这说明：

- slash commands 对 `Claude` 来说是被单独统计和建模的上下文来源
- 不只是“用户说了一串 `/xxx` 文本”

## 2.11 headless / stream-json 下并不是所有命令都可用

`main.tsx` 里对非交互模式会构造：

```ts
const commandsHeadless = commands.filter(
  command =>
    command.type === 'prompt' && !command.disableNonInteractive ||
    command.type === 'local' && command.supportsNonInteractive
)
```

证据：

- [main.tsx](/Users/alwaysking/AKProject/claude-code/src/main.tsx:2621)

这意味着：

- `prompt` 命令一般可用于 headless
- `local-jsx` 命令默认不适合 headless
- `local` 只有声明 `supportsNonInteractive` 才能走

这是 `CCGUI` 后面接入 Claude slash 时很重要的边界。

## 2.12 远程/bridge 模式也会区分 local-jsx 与 prompt 命令

`REPL.tsx` 里对 remote mode 有明确逻辑：

- `local-jsx` slash commands 继续在本地执行
- `prompt commands` 和普通文本发到远端

证据：

- [REPL.tsx](/Users/alwaysking/AKProject/claude-code/src/screens/REPL.tsx:3408)

这进一步证明：

- `Claude` 的 slash commands 不是统一“发给模型”
- 而是按命令类型分流执行

---

## 3. 目前最稳的 Claude 侧结论

基于目前已查实事实，可以把 `Claude` 这边归纳成：

### 3.1 命令如何发现

- 内置命令：Claude 自带
- 自定义命令：`.claude/commands/`，但已并入 skills 体系
- skills：`~/.claude/skills/`、`.claude/skills/`、plugin skills
- MCP prompts：连接 MCP server 后动态发现

### 3.2 命令如何命名

- 内置命令：`/compact`、`/memory`、`/model` 等
- skills：`/skill-name`
- MCP prompt：`/mcp__server__prompt`

### 3.3 命令如何使用

- 用户入口仍然是输入 `/command [args]`
- 但正常路径由 `Claude CLI` 本地解释处理
- 不应视为“普通文本 prompt”

### 3.4 mentions 如何使用

- MCP resources：`@server:protocol://resource/path`
- 这类 mention 会自动抓取并作为 attachments 注入上下文

---

## 4. 还没有 100% 钉死的点

下面这些我不想写成已经抓包实锤：

1. `MCP prompt` 命令在真实连接到 MCP server 的 `stream-json` 运行时里，stdout 的最小消息序列是什么。  
   现在源码已经明确它会变成命令，但这轮没有真实 MCP prompt 可测。

2. `@server:uri` 的 MCP resource mention 在真实连接到 MCP server 的 `stream-json` 运行时里，stdout 如何具体表示 attachment 注入。  
   现在源码已经明确这条链存在，但这轮没有可用 MCP resource server 做运行时样本。

3. `SlashCommand tool` 在 CLI / SDK 路径中的具体调用 payload。  
   目前只有 changelog 证据，还没有打开对应官方工具协议页或 raw trace。

---

## 5. 对 CCGUI 后续实现最有价值的结论

## 5.1 不要拿 `Codex` 的控制请求语义去套 `Claude`

`Codex` 的：

- `compact`
- `memories`

是结构化 provider control request。

但 `Claude` 这边目前已经查到的是：

- slash command 体系是 Claude CLI 自己的本地命令系统
- 不是我们已经掌握了某个单独的“`compact_context` 对应底层 request 名”这种协议

所以：

- 不能直接假设 `Claude` 也有和 `Codex` 对等的 control request API

## 5.2 对 `Claude`，短期最可信的接入方向是“复用 CLI 已有 slash/mention 语义”

基于当前证据，最稳的方向是：

- slash command：沿用 `/command` 文本入口
- MCP prompt：沿用 `/mcp__server__prompt`
- MCP resource mention：沿用 `@server:protocol://resource/path`

但这一条在真正落实现前，最好再补一轮最小抓包验证：

- 启一个最小 `Claude` session
- 送入 `/compact` 或 `/model`
- 看 stream-json 输出到底长什么样

## 5.3 `Claude` 的 skill 体系不该照搬 `Codex UserInput::Skill`

`Codex` 已有独立：

- `UserInput::Skill`
- `UserInput::Mention`

但 `Claude` 这边当前查到的是：

- skills 已并入 slash command 体系
- 通过 `/skill-name` 触发

所以：

- `Claude` provider 后续大概率不需要像 `Codex` 那样引入独立 `inputItems -> skill`
- 而更可能是保留 slash/skill 文本入口

这条现在已经有源码支撑：

- skills / commands 统一进 `Command` 体系
- `prompt` 类型命令通过 `processSlashCommand()` 转成消息+attachments 再 query

所以这已经不是纯文档推断。

---

## 6. 下一步最值得继续查什么

如果要把 `Claude` 这边也查到和 `Codex` 一样“可以直接按协议写代码”的粒度，下一步最值得做的是：

1. 抓一次最小 `stream-json` 会话
   - 输入 `/compact`
   - 输入 `/model`
   - 输入 `/mcp__server__prompt`
   - 看原始 stdout message 形状

2. 抓一次 MCP resource mention
   - 输入 `@server:protocol://resource/path`
   - 确认它在 `stream-json` 输出里如何表现为 attachment/context

3. 如果 `SlashCommand tool` 有官方独立文档，再补一轮 primary-source 调查

做到这三步后，`Claude` 这边就能从“行为已清楚”升级到“transport 也完全钉死”。
