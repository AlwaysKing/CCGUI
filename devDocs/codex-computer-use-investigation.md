# Codex Computer Use 宿主桥调查

**文档版本**: 1.0  
**最后更新**: 2026-04-27

## 一句话结论

- `Computer Use` 在 `Codex.app` 中不是普通 MCP 插件。
- `codex-service` 只负责通过 `SkyComputerUseClient mcp` 暴露工具。
- 真正让权限窗、线程状态联动、会话结束清理生效的，是 `Codex.app` 提供的专用宿主桥。
- `CCGUI` 目前无法被 `SkyComputerUseService` 识别为受支持宿主，因此不要继续模拟这套特殊支持。

## 最终结论

### 1. 分层结构

当前链路可以收敛为：

1. `codex-service` 按插件的 `.mcp.json` 启动 `SkyComputerUseClient mcp`
2. `SkyComputerUseClient` 再与本地 `SkyComputerUseService` 协作
3. `SkyComputerUseService` 不是独立完成权限与状态管理，而是依赖 `Codex.app` 提供的宿主桥

也就是说，`Computer Use` 表面上是一个 MCP 插件，但运行时实际上还依赖桌面宿主。

### 2. Codex.app 额外做了什么

调查后可以确认，`Codex.app` 至少额外提供了以下能力：

- 提供 app-server control socket 作为本地 IPC 宿主入口
- 提供线程状态事件，供 `SkyComputerUseService` 跟踪 `conversationID` / `turnID`
- 提供 turn-ended 通知链路
- 提供宿主身份与运行上下文
- 提供与 Codex 账号/认证缓存相关的上下文

因此它不是“只启动一个 app”，而是“启动 app + 充当专用宿主”。

### 3. 为什么 CCGUI 无法复刻

本轮调查已经确认，`SkyComputerUseService` / `SkyComputerUseClient` 内部存在以下明确组件或字符串：

- `CodexAppServerThreadEventObserver`
- `CodexAppServerJSONRPCConnection`
- `CodexAppServerAuthCache`
- `CodexComputerUseSessionTracker`
- `com.openai.codex`
- `com.openai.codex.alpha`
- `com.openai.codex.beta`
- `com.openai.codex.nightly`

这说明它不仅依赖 socket 路径，还会识别：

- 运行中的 Codex 宿主应用
- 受支持的 bundle id
- 与 Codex 相关的认证/会话上下文

`CCGUI` 不是这些 bundle id，也没有这套 Codex 宿主身份，因此即使：

- plugin 已正常出现在 `@`
- `mcpServer/elicitation/request` 审批能正常到达
- `SkyComputerUseService` 能被拉起

`SkyComputerUseService` 仍然不会主动连上我们伪造的宿主桥。

### 4. 日志层面的最终确认

在 CCGUI 中触发 `@Computer Use` 时，已经确认：

- `mcpServer/elicitation/request` 能正常到达
- 用户允许后，审批回复也能正常发回
- `Codex Computer Use.app` 确实被拉起

但关键日志始终是：

- `connectionCount: 0`
- `connected: false`
- `timedOut: true`

同时最终工具调用仍然落到：

- `Apple event error -1743`

这说明真正失败点不是 mention 翻译，也不是审批回复，而是：

- `SkyComputerUseService` 根本没有建立到 CCGUI 宿主桥的连接

### 5. 当前产品决策

基于以上结论，CCGUI 当前应采用保守策略：

- 保留 `computer-use` 作为普通 Codex plugin 的可见性
- 不再尝试模拟 `Codex.app` 的专用宿主桥
- 不再注入额外的 `Computer Use` 特殊权限/线程状态/turn-ended 支持

原因很简单：

- 继续硬接只会形成“半接入”
- 运行时会误导成“看起来支持，实际必失败”
- 当前缺口不是普通协议字段，而是 Codex 桌面宿主身份

## 实施结论

自 `2026-04-27` 起：

- CCGUI 已暂时屏蔽 `Computer Use` 的特殊宿主支持代码
- `Computer Use` 在 CCGUI 中仅按普通 plugin/MCP 能力对待

后续只有在确认能合法、稳定地复刻 `Codex.app` 宿主身份与上下文之后，才考虑重新打开这条支持链。
