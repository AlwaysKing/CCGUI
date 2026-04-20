# Codex 与 Claude 的命令系统调查

**文档版本**: 1.0  
**最后更新**: 2026-04-20

## 调查范围

本次聚焦 `/` 命令系统，分别调查：

1. `Codex` 的命令系统是否存在、如何暴露、是否已确认可扩展
2. `Claude` 的命令系统如何发现、如何调用、MCP 在其中扮演什么角色

专项补充文档：

- [Codex Provider 控制命令与 Skills 协议设计](/Users/alwaysking/AKProject/CCGUI/devDocs/codex-provider-controls-and-skills-design.md)
- [Claude Provider 命令与 Mention 调查](/Users/alwaysking/AKProject/CCGUI/devDocs/claude-provider-commands-and-mentions-investigation.md)

本文严格区分：

- **已确认**
- **未确认**

避免把猜测写成结论。

## 一句话结论

- `Codex` 已确认存在命令菜单和若干命令项，但这轮还没有追到完整的 slash command 注册与执行链
- `Claude` 的命令系统已经查清：包含内置命令、自定义命令，以及由 MCP prompts 自动生成的 slash commands

---

## 1. Codex 的命令系统

### 1.1 已确认

最新版 `Codex.app` 解包源码中，已经能直接确认存在一套命令菜单 / 命令面板。

在 [main-CUDSf52Z.js](/Users/alwaysking/Desktop/codex2/app_unpacked/.vite/build/main-CUDSf52Z.js) 的多语言字符串中，能看到明确的命令项与命令菜单字段，例如：

- `codex.command.newThread`
- `codex.command.settings`
- `codex.command.mcpSettings`
- `codex.command.openSkills`
- `codex.command.forceReloadSkills`
- `codex.commandMenu.title`
- `codex.commandMenu.searchPlaceholder`
- `codex.commandMenu.fileSearchPlaceholder`

这说明：

- `Codex` 不是没有命令系统
- 它至少有一套全局命令菜单能力

### 1.2 已确认存在的命令例子

同一份解包源码中，还能确认至少有 `/fast` 这一类用户可见命令文案：

- `codex.fastModeHomeBanner.title`

这说明：

- `Codex` 至少存在某些带 `/` 语义的用户命令

### 1.3 已确认到的限制

本轮还没有直接追到这些关键实现：

- 主聊天输入框中 `/xxx` 的候选列表生成逻辑
- `/xxx` 提交后的执行分派逻辑
- 插件、skills、apps、MCP 是否能注册 slash commands

所以目前不能下这些结论：

- 不能确认 `Codex` 的 `/` 命令像 `Claude` 一样可扩展
- 不能确认 `Codex` 的 MCP 能自动提供 `/命令`
- 不能确认 `Codex` 的 `/` 只是命令面板 UI，还是同时也进入聊天输入链

### 1.4 当前最稳妥的判断

截至本轮调查，只能把 `Codex` 的命令系统定性为：

- **命令菜单存在**
- **部分 slash-like 用户命令文案存在**
- **完整 slash command 发现 / 执行 / 扩展机制尚未查实**

---

## 2. Claude 的命令系统

### 2.1 官方已确认

Anthropic 官方文档已经明确确认 `Claude Code` 存在完整 slash command 系统。

官方内置命令示例包括：

- `/help`
- `/model`
- `/mcp`
- `/agents`
- `/review`
- `/clear`
- `/status`

来源：

- [Anthropic slash commands 文档](https://docs.anthropic.com/en/docs/claude-code/slash-commands)

### 2.2 自定义命令如何发现

官方文档明确写了：

- 项目级命令目录：`.claude/commands/`
- 用户级命令目录：`~/.claude/commands/`
- 这些目录里的 Markdown 文件会被发现并注册为 slash commands

这说明：

- `Claude` 的自定义命令系统本质是“目录发现 + Markdown frontmatter/内容驱动”

### 2.3 MCP 命令如何进入系统

这部分本轮已经调查清楚。

官方文档明确说明：

- MCP server 暴露的 prompts 会自动转换成 slash commands
- 命令格式为：

```text
/mcp__<server-name>__<prompt-name>
```

- 这些命令在 MCP 连接后被动态发现
- 执行结果会被插入当前会话

来源：

- [Anthropic slash commands 文档](https://docs.anthropic.com/en/docs/claude-code/slash-commands)
- [Anthropic MCP 文档](https://docs.anthropic.com/en/docs/claude-code/mcp)

这意味着：

- `Claude` 的 MCP 不只是工具层
- 它还可以通过 prompt 直接进入 slash command 层

### 2.4 本机运行时已确认

本机运行时记录也能对上这一点。

在 `~/.claude/history.jsonl` 中，已经有真实的 slash command 输入记录，例如：

- `/plugin`
- `/plugin install superpowers@claude-plugins-official`
- `/skills`

证据：

- [history.jsonl](/Users/alwaysking/.claude/history.jsonl:121)
- [history.jsonl](/Users/alwaysking/.claude/history.jsonl:123)
- [history.jsonl](/Users/alwaysking/.claude/history.jsonl:131)

### 2.5 本机适配层已确认

在 CCGUI 当前的 Claude 适配层里，也已经能看到 Claude 运行时会把 slash commands 当成单独的上下文统计项返回：

- [adapter.js](/Users/alwaysking/AKProject/CCGUI/electron/adapters/claude/adapter.js:1257)

返回结构里有：

- `slashCommands.totalCommands`
- `slashCommands.includedCommands`
- `slashCommands.tokens`

这说明：

- slash commands 对 Claude 来说不是 UI 装饰
- 它们是被运行时单独建模和统计的上下文来源

### 2.6 本机更新记录进一步确认的事实

本机 `Claude Code` changelog 还能进一步确认：

- skills 与 slash commands 已被统一心智模型
- skills 可默认出现在 slash command 菜单
- plugin-provided commands 存在
- 支持 `--disable-slash-commands`
- slash commands 支持参数、补全、命名空间

证据：

- [changelog.md](/Users/alwaysking/.claude/cache/changelog.md:1603)
- [changelog.md](/Users/alwaysking/.claude/cache/changelog.md:1734)
- [changelog.md](/Users/alwaysking/.claude/cache/changelog.md:220)
- [changelog.md](/Users/alwaysking/.claude/cache/changelog.md:1898)
- [changelog.md](/Users/alwaysking/.claude/cache/changelog.md:2551)
- [changelog.md](/Users/alwaysking/.claude/cache/changelog.md:2920)

---

## 3. Claude 的命令系统可以如何归纳

基于本轮已确认事实，`Claude` 的 `/` 系统可以分成三层：

### 3.1 内置命令

由官方运行时提供，例如：

- `/help`
- `/model`
- `/mcp`
- `/agents`

### 3.2 自定义命令

由本地目录发现：

- `.claude/commands/`
- `~/.claude/commands/`

Markdown 文件直接成为 slash commands。

### 3.3 MCP prompt 命令

由 MCP server 提供 prompts，运行时自动映射为：

- `/mcp__server__prompt`

---

## 4. 当前对实现最有价值的结论

### 4.1 对 Codex

如果后续要对齐 `Codex` 的命令体验，现在只能基于这些已确认事实推进：

- 存在命令菜单
- 存在命令项
- 至少存在 `/fast` 这类 slash-like 命令

但还不能直接照搬成“Claude 那样的 slash command 可扩展体系”。

### 4.2 对 Claude

`Claude` 这一边已经足够清晰，可以作为稳定参照：

- 获取命令：
  - 内置注册
  - 目录发现
  - MCP prompts 动态发现
- 调用命令：
  - 通过 `/command ...args`
  - 其中 MCP prompt 会直接把 prompt 结果注入对话

---

## 5. 尚待继续追踪的问题

后续如果继续深挖，最关键的是两点：

1. `Codex` 的主聊天输入框 `/` 候选与提交执行链
2. `Codex` 是否存在类似 `Claude MCP prompt -> slash command` 的扩展机制
