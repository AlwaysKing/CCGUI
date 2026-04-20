# Codex 与 Claude 的 `@` 机制调查

**文档版本**: 1.1  
**最后更新**: 2026-04-20

## 一句话结论

- `Codex` 的普通聊天输入里，`@` / `$` 不是直接变成独立 `UserInput::mention`，而是先插入富文本 mention 节点，提交时再序列化成带标记的文本。
- 当前 `Codex.app` 里：
  - `@` 用于文件、agent、plugin
  - `$` 用于 skill、app
- `Claude` 的 `@` 已确认支持文件、agent/subagent、MCP resource；其中 MCP resource 官方明确会作为上下文资源加入会话。

---

## 1. Codex

### 1.1 已确认的触发入口

最新版桌面端前端里，composer 注册了三套触发器：

- `@` -> `mention-ui`
- `$` -> `skill-mention-ui`
- `/` -> `slash-command-ui`

证据：

- [use-model-settings-DEaRTAXy.js](/Users/alwaysking/Desktop/codex2/app_unpacked/webview/assets/use-model-settings-DEaRTAXy.js)

对应明文逻辑：

```js
Koe(...) -> trigger: '@'
xle(...) -> trigger: '$'
Sle(...) -> trigger: '/'
```

### 1.2 已确认的编辑器节点类型

当前 `Codex.app` 的富文本 composer 里存在这些 inline 节点：

- `atMention`
- `agentMention`
- `skillMention`
- `appMention`
- `pluginMention`

### 1.3 已确认的文本序列化格式

当前桌面端把 composer 内容导出成文本时，走的是 `yN(doc)`。

已查实：

- 文件 mention：
  ```md
  [label](path)
  ```
- agent / subagent mention：
  ```md
  [@Name](agent://...)
  [@Name](subagent://...)
  ```
- skill mention：
  ```md
  [$skill](.../SKILL.md)
  ```
- app mention：
  ```md
  [$app](app://app-id)
  ```
- plugin mention：
  ```md
  [@plugin](plugin://plugin-id)
  ```

最关键的结论：

- `app` 不是 `@app`，而是 `$app`
- `plugin` 才是 `@plugin`

### 1.4 已确认的提交形态

普通聊天提交时，当前桌面端不是把 mention 拆成独立 `UserInput[]` 项，而是发：

```js
input: [
  {
    type: "text",
    text: serializedPrompt,
    text_elements: []
  }
]
```

所以当前 `Codex.app` 的真实主链是：

1. 用户通过 `@` / `$` 触发菜单
2. 编辑器插入 mention 节点
3. 提交前把节点序列化成带标记文本
4. 作为单个 `text` input 发送

### 1.5 已确认的反向解析

当前桌面端还存在 `promptTextToDoc`：

- `SN({ schema, text })`
- 内部使用 `_le(schema, lineText)`

会把以下文本重新解析回 mention 节点：

```md
[$skill](...)
[$app](app://...)
[@plugin](plugin://...)
[@agent](agent://...)
[pathLabel](/abs/path/file)
```

这说明这些文本格式不是展示语法，而是正式持久化格式。

### 1.6 协议层补充

虽然当前普通聊天主链不用它们，但协议层仍然支持：

- `UserInput.type = "skill"`
- `UserInput.type = "mention"`

所以最准确的说法是：

- 协议支持独立结构化输入
- 当前桌面端普通 composer 主链实际走“mention 节点 -> 文本”这条路

---

## 2. Claude

### 2.1 已确认

`Claude` 的 `@` 已确认支持：

- 文件
- custom agents / subagents
- MCP resources

### 2.2 官方文档已确认的事实

Anthropic 官方文档明确说明：

- MCP resources 可以直接通过 `@` 引用
- 格式为 `@server:protocol://resource/path`
- 被引用后会自动获取，并作为会话上下文加入

参考：

- [Anthropic MCP 文档](https://docs.anthropic.com/en/docs/claude-code/mcp)

### 2.3 本机运行时与更新记录确认的事实

本机 `Claude Code` 更新记录还能确认：

- 支持 named subagents 出现在 `@` 候选中
- 支持 `@README.md#installation` 这类带 anchor 的文件 mention
- 支持在 slash command 参数中继续使用 `@`
- MCP resources 可以被 `@`

证据：

- [changelog.md](/Users/alwaysking/.claude/cache/changelog.md:260)
- [changelog.md](/Users/alwaysking/.claude/cache/changelog.md:1261)
- [changelog.md](/Users/alwaysking/.claude/cache/changelog.md:2417)
- [changelog.md](/Users/alwaysking/.claude/cache/changelog.md:2644)

### 2.4 仍未直接钉死的点

这轮没有直接拿到 Claude 文件 / agent mention 的底层 wire format。

所以目前只把以下说成已确认：

- `Claude` 的 `@` 能引用这些目标
- MCP resource mention 会作为上下文资源进入会话

---

## 3. 当前可直接指导实现的结论

- `Codex` 不能按“所有东西都用 @”理解，当前桌面端明确分成 `@` 和 `$` 两套入口。
- `Codex` 普通聊天输入要复刻的是“mention 节点对应的文本编码”，不是独立结构化 `input[]`。
- `Claude` 至少要区分：
  - 文件
  - agent/subagent
  - MCP resource
