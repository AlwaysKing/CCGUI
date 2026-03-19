# Codex 启动参数研判

**文档版本**: 1.0  
**最后更新**: 2026-03-18  
**研判对象**:
- `/Applications/Codex.app/Contents/Resources/codex`
- `/Users/alwaysking/.vscode/extensions/openai.chatgpt-26.313.41514-darwin-arm64`

## 结论

Codex 不适合按 Claude 的 `stream-json` 双向 stdin/stdout 协议接入。

可行的接入入口有两类：

1. `codex` 交互式 CLI
2. `codex app-server --listen stdio://`

对 CCGUI 来说，真正应该接的是第二种，也就是 `app-server`。

## 顶层 CLI

2026-03-18 在本机执行：

```bash
/Applications/Codex.app/Contents/Resources/codex --help
```

可确认的核心子命令包括：

- `exec`
- `review`
- `mcp`
- `mcp-server`
- `app-server`
- `resume`
- `fork`
- `cloud`

常见全局参数：

- `-m, --model <MODEL>`
- `-C, --cd <DIR>`
- `-s, --sandbox <SANDBOX_MODE>`
- `-a, --ask-for-approval <APPROVAL_POLICY>`
- `--full-auto`
- `--dangerously-bypass-approvals-and-sandbox`
- `-c, --config <key=value>`
- `--enable <FEATURE>`
- `--disable <FEATURE>`
- `--search`
- `--add-dir <DIR>`

## app-server 参数

2026-03-18 在本机执行：

```bash
/Applications/Codex.app/Contents/Resources/codex app-server --help
```

确认到 `app-server` 的关键参数：

- `--listen <URL>`
  - 支持 `stdio://`，默认值
  - 支持 `ws://IP:PORT`
- `-c, --config <key=value>`
- `--enable <FEATURE>`
- `--disable <FEATURE>`
- `--analytics-default-enabled`

推荐给 CCGUI 的启动方式：

```bash
codex app-server --listen stdio://
```

理由：

- 不需要自己处理终端 TUI
- 协议稳定度明显高于反向解析交互终端输出
- VS Code 扩展与桌面端都显式依赖 app-server 协议族

## 线程/回合启动参数

通过 `codex app-server generate-ts --out ...` 导出的类型，可以确定真正的会话启动配置不再靠 CLI prompt 参数，而是靠 JSON-RPC 请求参数。

### `thread/start`

关键字段：

- `cwd`
- `approvalPolicy`
- `approvalsReviewer`
- `sandbox`
- `model`
- `modelProvider`
- `serviceTier`
- `baseInstructions`
- `developerInstructions`
- `personality`
- `ephemeral`
- `experimentalRawEvents`
- `persistExtendedHistory`

### `turn/start`

关键字段：

- `threadId`
- `input`
- `cwd`
- `approvalPolicy`
- `approvalsReviewer`
- `sandboxPolicy`
- `model`
- `serviceTier`
- `effort`
- `summary`
- `personality`
- `outputSchema`
- `collaborationMode`

## 权限与沙箱参数

从导出协议和 `--help` 可确认：

### approval policy

CLI 层可用值：

- `untrusted`
- `on-failure`
- `on-request`
- `never`

协议层额外支持更细粒度对象：

- `{ granular: { sandbox_approval, rules, skill_approval, request_permissions, mcp_elicitations } }`

### sandbox

CLI 简写：

- `read-only`
- `workspace-write`
- `danger-full-access`

协议层完整对象在 `SandboxPolicy` 中，支持：

- `dangerFullAccess`
- `readOnly`
- `externalSandbox`
- `workspaceWrite`

其中 `workspaceWrite` 还可带：

- `writableRoots`
- `readOnlyAccess`
- `networkAccess`
- `excludeTmpdirEnvVar`
- `excludeSlashTmp`

## 实测启动结果

2026-03-18 我直接对 `app-server` 做了握手测试：

1. `initialize`
2. `initialized`
3. `thread/start`
4. `turn/start`

实测返回：

- app-server 可正常在 `stdio://` 上用 NDJSON 通信
- `thread/start` 成功返回线程对象
- `turn/start` 成功返回 `inProgress` 的 turn
- 本机当前 Codex 版本为 `0.115.0-alpha.27`
- 默认返回的模型是 `gpt-5.4`

同时也观察到一类重要现象：

- 在当前受限沙箱里，Codex 会尝试写 `~/.codex` 下的 sqlite / shell snapshot
- 如果运行环境无该目录写权限，会出现只读数据库或快照写入失败警告

这意味着：

- CCGUI 内部接入协议本身是可行的
- 但运行时需要保证 Codex 对 `~/.codex` 有正常写权限，或者后续继续研究是否能通过 `-c` /环境变量重定向状态目录

## 对 CCGUI 的建议

不要复用 Claude 的 CLI 参数思路去适配 Codex。

正确方向是：

1. CCGUI 启动 `codex app-server --listen stdio://`
2. 通过 JSON-RPC 完成 `initialize -> thread/start|thread/resume -> turn/start`
3. 将 `item/*` 与 `turn/*` 通知归一化成内部消息流
4. 用统一 provider 抽象屏蔽 Claude / Codex 的协议差异
