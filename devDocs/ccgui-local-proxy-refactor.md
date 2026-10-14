# CCGUI 内置模型代理重构设计

**文档版本**: 0.1
**最后更新**: 2026-09-12
**状态**: 已实施（验收记录见第 15 节）

## 1. 背景

当前 CCGUI 的模型管理是"把供应商配置写进 claude / codex 的原始配置文件"，再靠启动参数做局部覆盖：

- `应用` Claude 模型 → 写 `~/.claude/settings.json` 的 `env`（`ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL` / 各类映射变量），见 [useSettingsData.js](../src/views/settings/hooks/useSettingsData.js:538)
- `应用` Codex 模型 / `syncCodexModelProviders` → 把每个 codex 模型写成 `~/.codex/config.toml` 里的 `[model_providers.ccgui_model_*]` 段落，见 [app-service.js](../electron/services/app-service.js:199)
- 只有"会话级自定义模型"才走启动参数覆盖，见 [client.js](../electron/adapters/claude/client.js:723)、[client.js](../electron/adapters/codex/client.js:1007)

这带来两个问题：

1. CCGUI 的配置会污染 claude / codex 的原始配置，用户在终端里用 claude / codex 时会互相影响
2. 切换模型/供应商必须销毁并重启 CLI 进程（`restart-for-config`），无法热切换

## 2. 目标

把"模型供应商"这件事整体内置到 CCGUI，等价于内置一个 cc-switch：

1. CCGUI 启动时在后台起一个本地代理，只监听 `127.0.0.1`
2. 所有 claude / codex 进程的模型供应商都指向这个代理，只通过启动参数注入，不写任何 claude / codex 的配置文件
3. 传给 CLI 的模型名采用 `<供应商ID>/<模型名>`，代理收到后还原成真实供应商地址、真实凭据、真实模型名，再转发
4. CCGUI 不再读取 claude / codex 的配置来解析模型（自成体系）
5. 模型 + 供应商 + 凭据支持热切换，不重启 CLI 进程

界面仍然按"Claude 供应商列表 / Codex 供应商列表"分别配置，两者**不合并**，各自有各自的默认供应商。

## 3. 目标架构

```
                    ┌──────────────────────────────────────┐
   CCGUI 主进程      │  local-proxy（127.0.0.1:PORT）        │
                    │                                      │
 claude 进程 ──────▶│  /v1/messages?beta=true              │
   ANTHROPIC_BASE_URL│  /v1/messages/count_tokens           │
   =127.0.0.1:PORT   │  /api/hello            ──▶ 供应商 A   │
   ANTHROPIC_MODEL   │  /codex/v1/responses                 │
   =<供应商ID>/<模型>│  /codex/v1/responses/compact ──▶ 供应商 B
                    │                                      │
 codex 进程 ───────▶│  解析：模型名前缀 → 供应商           │
   base_url          │        会话令牌   → 凭据            │
   =.../codex/v1     │                                      │
                    └──────────────────────────────────────┘
```

代理是纯转发（同协议直通），不做协议转换。

## 4. 已实测结论

以下结论均由本地假代理 + 真实 CLI 实测得到（Claude Code 2.1.251 / Codex CLI 0.116.0）：

| # | 结论 | 证据 |
| --- | --- | --- |
| 1 | Claude Code 原样透传模型名 | 请求体 `"model":"CNSINDA/deepseek-flash"`，仅打印 `[claude-code:unrecognized_model]` 警告，不影响对话 |
| 2 | Claude Code 有额外探活请求 | 启动时发 `HEAD /api/hello`，代理必须实现 |
| 3 | Claude Code 支持运行中热切换模型 | 同一进程发送 `set_model` 两次，请求体 model 依次为 `1773405753656/deepseek-flash`、`1778655741296/mimo-v2.5-pro`，控制响应均为 `success` |
| 4 | **settings.json 的 env 会盖掉进程环境变量** | 项目级 `.claude/settings.json` 的 env 生效时，模型名与 baseUrl 都取自 settings（`model: settings-model`），进程 env 被忽略 → 必须用 `--settings` 注入 |
| 5 | Codex 请求路径 = `{base_url}/responses`，模型名原样透传 | `POST /v1/responses`，`"model":"1773405753656/deepseek-flash"` |
| 6 | Codex 的 catalog 用 `slug` 精确匹配模型串 | catalog 内放 `slug = 1773405753656/deepseek-flash` 后，`Model metadata not found` 警告消失 |
| 7 | Codex catalog 有必填字段 | 缺 `base_instructions`、`support_verbosity` 直接启动失败 |
| 8 | Codex 的 `supported_reasoning_levels.effort` 只认 `none/minimal/low/medium/high/xhigh` | 写成 `max` 会导致 `codex exec` 无法启动（`~/.codex/models.json` 当前就是这个状态，`Desktop/code.sh` 生成的目录在本机 codex 0.116 上不可用） |
| 9 | **Codex 要求模型目录至少包含一个模型** | 传空目录文件（`{"models":[]}`）直接报 `model_catalog_json path ... must contain at least one model`，codex 无法启动；一条元数据都不配置时必须写隐藏占位条目 |
| 10 | `visibility` 只认 `list` / `hide` / `none` | 写 `hidden` 会报 `unknown variant hidden`，因此生成前统一归一化（`hidden` → `hide`，非法值丢弃） |
| 11 | 供应商地址与 CLI 路径的版本段会重复 | codex 侧拼出过 `/v1/v1/responses`，代理转发时会去掉重复的版本段（`/v1` + `/v1/responses` → `/v1/responses`） |

## 5. 代理模块设计

新增目录 `electron/services/local-proxy/`：

| 文件 | 职责 |
| --- | --- |
| `index.js` | 生命周期：启动 / 停止 / 状态查询；端口选择 |
| `server.js` | HTTP 服务与路由分发 |
| `router.js` | 模型名解析 + 会话令牌解析 → 目标供应商、凭据、上游地址、真实模型名 |
| `upstream.js` | 转发：请求头过滤、流式 pipe、超时、错误映射 |
| `session-registry.js` | 会话令牌注册 / 注销 / 查询 |
| `model-catalog.js` | 生成与维护 CCGUI 自己的 codex `models.json`，以及从用户目录导入元数据 |

### 5.1 端口与生命周期

- 默认 `127.0.0.1:18921`（避开 cc-switch 的 15721），**端口固定不自动顺延**，可在"软件配置"里修改（`app.json > settings.proxyPort`），修改并保存后自动重启代理
- 被占用时启动失败并明确提示"端口 xxxx 已被占用，请在软件配置中更换代理端口"，不做静默降级
- Electron `app.whenReady` 后启动，`before-quit` 时关闭
- 启动失败：记录错误并阻止会话启动（架构上所有模型调用都依赖代理）
- 修改端口不会影响已经启动的 claude / codex 进程，这些会话需要重启才能走新端口

### 5.2 路由表

| 入口路径 | 归属 | 上游拼接 |
| --- | --- | --- |
| `HEAD /api/hello` | claude | 本地直接 200 |
| `POST /v1/messages`（含 `?beta=true`） | claude | `供应商.apiUrl` + `/v1/messages`（原样带 query） |
| `POST /v1/messages/count_tokens` | claude | `供应商.apiUrl` + `/v1/messages/count_tokens` |
| `GET /v1/models` | claude | 转发（上游不支持时返回空列表） |
| `POST /codex/v1/responses` | codex | `供应商.apiUrl` + `/responses` |
| `POST /codex/v1/responses/compact` | codex | `供应商.apiUrl` + `/responses/compact` |
| `POST /codex/v1/chat/completions` | codex | `供应商.apiUrl` + `/chat/completions`（wire_api=chat 的供应商） |

`apiUrl` 的语义与现状保持一致：claude 列表里填的是 base（如 `https://open.bigmodel.cn/api/anthropic`），codex 列表里填的是带版本前缀的 base（如 `http://192.168.60.2:9005/v1`）。

### 5.3 转发细节

- 请求体只改 `model` 字段，其余原样透传（`messages` / `system` / `tools` / `thinking` / `reasoning` / `store` / `include` 等都不动）
- 鉴权头替换为供应商真实凭据：claude 用 `Authorization: Bearer <真实 token>`，codex 同样
- 透传 `anthropic-beta` / `anthropic-version` / query，响应头除 hop-by-hop（`connection` / `transfer-encoding` / `content-length`）外原样回传
- SSE 流式响应一边收到一边写回，不缓冲
- 超时：流式首字节 60s、流式空闲 120s、非流式 600s（对齐 cc-switch 的取值）
- 不做重试与故障转移，上游错误原样返回，避免掩盖问题
- 日志脱敏：token 只记录存在性与前缀，不落全量

### 5.4 模型名解析

```
<供应商ID>/<模型名>
   │              └─ 先按 modelCards[].modelName 精确匹配
   │                 匹配不到再按 modelCards[].id 匹配
   │                 都匹配不到 → 原样透传（兼容别名场景）
   └─ 在"该工具自己的供应商列表"里按 id 精确匹配
      claude 请求只在 claudeModels 里找，codex 请求只在 codexModels 里找
      找不到 → 使用该会话的默认供应商
```

两种兜底情况——不带前缀的模型名（子 agent 传 `sonnet` / `haiku` 这类别名时会出现），以及前缀不属于本工具供应商列表（例如 claude 请求里出现了 codex 的供应商 ID）——都用**会话当前锁定的供应商**解析：先按 `modelCards[].modelName` 匹配，再按卡片 id 匹配，都匹配不到就用会话/供应商的默认卡片兜底。

之所以不做"匹配不到就原样透传给上游"，是因为那样会把 `claude-3-5-haiku-20241022` 这类别名直接丢给第三方供应商，触发模型不存在的报错；兜底到默认卡片能保证请求始终落到一个真实存在的 CCGUI 供应商上。代价是选择供应商自带模型列表里的模型时，实际执行的是 CCGUI 卡片里的模型（CCGUI 是唯一配置源）。

### 5.5 会话令牌

模型名无法表达"用哪个凭据"，所以每次启动 CLI 生成一个会话令牌，通过 `ANTHROPIC_AUTH_TOKEN`（claude）/ `experimental_bearer_token`（codex）传给 CLI：

```js
proxyRegistry.register(token, {
  tool: 'claude',
  sessionId,
  // 每次请求都实时解析，保证切换模型 / 凭据后立即生效
  resolveSettings: () => ({ modelId, modelCardId, credentialId })
})
```

- 代理收到请求时用令牌反查会话，按会话**当前**的模型与凭据选择解析，因此切换不需要重启进程
- 令牌无效时使用模型名前缀解析 + 供应商默认凭据兜底（便于手工调试）

## 6. Claude 接入改造

启动参数保持现状，模型与代理配置改为**恒定注入**（不再区分 system / project / custom）：

```js
args.push('--settings', JSON.stringify({
  env: {
    ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
    ANTHROPIC_AUTH_TOKEN: sessionToken,
    ANTHROPIC_MODEL: `${providerId}/${modelName}`,
    ANTHROPIC_DEFAULT_SONNET_MODEL: mapping.sonnet || defaultModel,
    ANTHROPIC_DEFAULT_OPUS_MODEL: mapping.opus || defaultModel,
    ANTHROPIC_DEFAULT_HAIKU_MODEL: mapping.haiku || defaultModel,
    ANTHROPIC_SMALL_FAST_MODEL: mapping.smallFast || defaultModel
  }
}))
```

要点：

- **必须走 `--settings`**，不能只靠进程 env（实测结论 4）
- 进程 env 仍保留同样的值作为第二层保险
- `getModelEnvVars()` 从"读模型配置"改为"生成代理路由参数"，不再读 `settings.json`
- 启动时注册会话令牌，进程退出时注销

## 7. Codex 接入改造

```js
args.push(
  '-c', 'model_provider="ccgui"',
  '-c', 'model_providers.ccgui.name="CCGUI"',
  '-c', `model_providers.ccgui.base_url="http://127.0.0.1:${port}/codex/v1"`,
  '-c', 'model_providers.ccgui.wire_api="responses"',
  '-c', `model_providers.ccgui.experimental_bearer_token="${sessionToken}"`,
  '-c', `model="${providerId}/${modelName}"`,
  '-c', `model_catalog_json="${catalogPath}"`
)
```

要点：

- `model_provider` 永远是 `ccgui`，供应商差异全部在代理内部
- `model_catalog_json` 恒定指向 CCGUI 自己的目录文件（即使一条 entry 都没有也要指过去，否则会回落到用户那份坏掉的 `~/.codex/models.json`）
- 删除 `syncCodexModelProviders()` 及其调用链，`writeCodexConfigFile()` 不再写模型/供应商相关内容（`auth.json` 的登录逻辑保持不动）
- 历史上已写入 `~/.codex/config.toml` 的 `[model_providers.ccgui_model_*]` 段落不做自动清理（按用户要求"历史不用理会"）

## 8. models.json 与"高级配置"

### 8.1 定位

`models.json` 就是 `model_catalog_json` 指向的模型元数据目录：Codex 用它获取模型的上下文窗口、推理等级、工具能力、指令模板等。模型名不在目录中时，Codex 会退化成兜底参数并告警。

CCGUI 自己在 `~/.ccgui/` 下维护这份文件（如 `~/.ccgui/models.json`），不碰 `~/.codex/`。

### 8.2 高级配置承载方式

- 在 codex 的模型卡片上新增 `catalog` 字段（`modelCards[].catalog`），保存该模型的全部元数据字段
- **配置了才有**：卡片没有配置时，不生成 catalog entry，Codex 走兜底元数据（功能可用，仅告警）
- 配置了任意字段后，必需字段缺失时用内置默认模板补齐，避免 Codex 启动失败
- catalog 在启动 codex 前按当前配置生成/刷新，`slug = <供应商ID>/<模型名>`

### 8.3 字段清单（一次性全部支持）

| 分组 | 字段 |
| --- | --- |
| 标识 | `slug`（自动生成，不可编辑）、`display_name`、`description` |
| 上下文 | `context_window`、`max_context_window`、`effective_context_window_percent`、`auto_compact_token_limit`、`truncation_policy` |
| 推理 | `supported_reasoning_levels`、`default_reasoning_level`、`default_reasoning_summary`、`reasoning_summary_format`、`comp_hash` |
| 能力 | `supports_parallel_tool_calls`、`supports_reasoning_summaries`、`supports_search_tool`、`supports_image_detail_original`、`input_modalities`、`experimental_supported_tools`、`tool_mode`、`apply_patch_tool_type`、`web_search_tool_type`、`shell_type` |
| 输出与版本 | `support_verbosity`、`default_verbosity`、`visibility`、`priority`、`supported_in_api`、`minimal_client_version`、`supported_in_api`、`upgrade`、`availability_nux`、`service_tiers`、`additional_speed_tiers`、`default_service_tier` |
| 扩展 | `model_messages`（含 `instructions_template`）、`base_instructions`、`experimental_supported_tools`、`include_skills_usage_instructions`、`multi_agent_version`、`use_responses_lite`、`prefer_websockets`、`auto_review_model_override` |

必填兜底：`base_instructions`、`support_verbosity`、`display_name`、`context_window`、`max_context_window`、`supported_reasoning_levels`。
`supported_reasoning_levels.effort` 的取值约束在 UI 与生成阶段双重校验（`none/minimal/low/medium/high/xhigh`），发现 `max` 自动转为 `xhigh` 并提示。

### 8.4 启动导入提示

每次启动 CCGUI 时检查 `~/.codex/models.json`：

- 按"模型名"（忽略供应商前缀）与本机已配置的 codex 模型卡片比对
- 用户目录里有、本机卡片没有元数据 → 弹一次提示，询问是否导入
- 导入时补齐缺失字段、合法化 `effort` 取值，并写入卡片 `catalog`
- 用户选择忽略则不重复打扰（记录已忽略的模型名，可在设置里重开）

## 9. 配置存储与语义变化

| 项目 | 现状 | 重构后 |
| --- | --- | --- |
| Claude 供应商列表 | `app.json` | 不变 |
| Codex 供应商列表 | `app.json` | 不变（与 claude **不合并**） |
| 默认供应商 | 写 `~/.claude/settings.json` / `~/.codex/config.toml` | 只写 `app.json`（`selectedClaudeModelId` / `selectedCodexModelId` + 凭据） |
| "默认配置 / Codex 配置"对话框 | 读写 claude / codex 原始配置 | 读写 CCGUI 内部配置（界面保留） |
| Claude 模型映射（sonnet/opus/haiku） | 写 `~/.claude/settings.json` | 写入 CCGUI 配置，启动时注入 `--settings` |
| Codex 模型元数据 | 无（`code.sh` 写用户目录） | CCGUI 自己的 `~/.ccgui/models.json` |
| 本地代理端口 | 无 | `app.json > settings.proxyPort`（默认 18921，软件配置里可改） |

模型模式语义：

- `custom`：会话/项目指定的供应商 + 模型
- `project` / `system`：各自的默认供应商（claude 用 Claude 默认，codex 用 Codex 默认）
- **未配置默认供应商时，不允许启动 `system` / `project` 模式的会话**，直接提示先配置模型

## 10. 热切换

| 切换对象 | 是否需要重启 CLI | 机制 |
| --- | --- | --- |
| 模型 + 供应商（claude） | 否 | `control_request: set_model`，实测通过 |
| 模型 + 供应商（codex） | 否 | `thread/resume` 带 `model`（现有 `applyThreadModelSelection`） |
| 凭据 | 否 | 代理在每次请求时按会话当前选择解析 |
| 系统提示词、max thinking tokens、`--setting-sources` | 是 | 进程级参数，仍需 `restart-for-config` |

因此 [session-instance.js](../electron/session/session-instance.js:3321) 里的"任何配置变更都重启"要拆成两类：模型/供应商/凭据走热切换，进程级参数才重启。

## 11. 改动清单

新增：

- `electron/services/local-proxy/{index,server,router,upstream,session-registry,model-catalog}.js`
- `src/views/settings/components/dialogs/CodexModelCatalogImportDialog.vue`

修改：

- [model-config.js](../electron/adapters/shared/model-config.js:127)：新增 `resolveProviderModelCard` / `buildProxyModelString`
- [claude/client.js](../electron/adapters/claude/client.js:578)：代理 env 生成、`--settings` 恒定注入、令牌注册与注销、未配置默认模型时拒绝启动
- [codex/client.js](../electron/adapters/codex/client.js:986)：`model_provider=ccgui` / `model_catalog_json` 常量注入、令牌注册与注销
- [app-service.js](../electron/services/app-service.js:143)：移除 `syncCodexModelProviders` 与其调用链
- [main.cjs](../electron/main.cjs:3532)：代理启停、catalog 导入 IPC、移除 `sync-codex-model-providers` IPC
- [preload.js](../electron/preload.js:250)：新增代理状态与 catalog 导入 IPC 暴露，移除旧同步 IPC
- [useSettingsData.js](../src/views/settings/hooks/useSettingsData.js:148)：默认配置 / 应用模型只读写 CCGUI 内部配置
- [app-config-manager.js](../electron/storage/app-config-manager.js:65)：新增默认值 `proxyPort`
- [SoftwareSettings.vue](../src/views/settings/components/SoftwareSettings.vue:250)：新增"本地模型代理端口"配置项（保存后自动重启代理）
- [App.vue](../src/App.vue:18)：主窗口启动时检查 catalog 导入候选
- [ModelEditDialog.vue](../src/views/settings/components/dialogs/ModelEditDialog.vue:240)：codex 模型卡片新增"高级配置（Codex 模型元数据）"
- [session-instance.js](../electron/session/session-instance.js:3476)：模型 / 供应商 / 凭据热切换与重启分流
- [provider-api.js](../electron/adapters/claude/provider-api.js:73)：模型枚举跳过代理路由校验

## 12. 实施顺序

1. **P1 代理核心 + Claude 接入**：代理路由、转发、令牌、`--settings` 注入；跑通真实 Claude 对话
2. **P2 Codex 接入 + catalog 生成**：provider 常量注入、catalog 生成、warning 消失
3. **P3 停止写入原始配置**：移除写入逻辑，应用模型只落 `app.json`，未配置时禁用 `system`/`project`
4. **P4 UI**：codex 卡片高级配置（全部字段）+ 启动导入提示对话框
5. **P5 热切换**：模型/供应商/凭据热切换，进程级参数才重启
6. **P6 验收与清理**：回归测试、真实供应商验证、日志脱敏检查

## 13. 验收方式

- **假上游断言**：用本地假上游校验请求体 `model`、鉴权头、上游路径、SSE 透传
- **真实对话**：claude 与 codex 各跑一次真实供应商对话，覆盖流式、工具调用、图片输入、子 agent
- **热切换**：同一进程内先后切到两个不同供应商的模型，确认两次请求分别命中对应上游
- **无写入验证**：跑完一轮后 `~/.claude/settings.json` 与 `~/.codex/config.toml` 的 mtime 与内容不变
- **未配置场景**：未应用任何模型时，`system` / `project` 模式会话被拒绝并给出提示
- **Codex 元数据**：配置了高级配置的模型不再出现 `Model metadata not found`

## 14. 风险与取舍

- **Claude 侧的模型元数据无法配置**：Claude Code 没有 catalog 机制，未知模型按默认 200k 上下文计算，自动压缩会偏保守（cc-switch 同样如此）。实测 Claude Code 提供了两个逃生口：`CLAUDE_CODE_MAX_CONTEXT_TOKENS` 环境变量、或模型名后加 `[1m]` 后缀。如果后续需要，可以把 claude 卡片的上下文窗口也接上这个环境变量（本期未做，界面上"高级配置"目前只对 codex 卡片开放）
- **`[claude-code:unrecognized_model]` 警告会持续存在**：非致命，属于预期行为
- **不再做跨协议转换**：claude 只对 anthropic 协议的供应商生效，codex 只对 OpenAI 协议生效；配置错了会在代理层直接返回上游错误
- **多实例**：端口固定（默认 18921，可在软件配置中修改），第二个实例若端口被占用会启动失败并提示更换端口
- **占位条目的代价**：未配置任何 Codex 元数据时，CCGUI 的目录文件里会有一条 `visibility = "hide"` 的 `__ccgui_placeholder__` 条目，只为满足 Codex 的"目录非空"要求，不会出现在模型列表里
- **高级配置是自由 JSON**：字段写错会导致 codex 解析目录失败，目前只对已知易错项（`effort`、`visibility`）做归一化

## 15. 验收记录

测试脚本放在 `/tmp/ccgui-proxy-test/`（临时目录，不进仓库）：

| 脚本 | 覆盖范围 | 结果 |
| --- | --- | --- |
| `proxy.test.js` | 假上游 + 真代理：端口配置、`/api/hello`、claude 路径/模型/凭据/字段透传、SSE 不缓冲、裸模型名回退、codex 前缀剥离、compact、count_tokens、未知供应商 400、跨列表回退、端口占用报错 | 11/11 通过 |
| `catalog.test.js` | catalog 生成与导入候选：只给配置了高级配置的卡片生成条目、`max` → `xhigh`、必填字段补齐、slug 自动生成、空 catalog、占位条目、`visibility` 归一化、导入候选筛选 | 11/11 通过 |
| `codex-catalog.acceptance.js` | 真实 codex CLI 0.116：命中条目、空目录被拒、占位目录可启动、目录里只有别的模型、`max` 复现解析失败 | 5/5 通过 |
| `claude-e2e.test.js` | 真实 claude CLI → CCGUI 代理 → 假上游：`--settings` 覆盖 `~/.claude/settings.json` 的敌对配置、`?beta=true` 路径、模型改写、令牌替换、SSE 回传、CLI 正常退出 | 通过 |

补充说明：

- 启动参数、模型名透传、`set_model` 热切换、settings 覆盖优先级等结论，来自设计阶段用假代理 + 真实 CLI 的实测（第 4 节）
- 尚未覆盖：真实供应商的完整对话回归（需要真实额度）、Electron 应用内的点击链路验证

## 15. 实施记录（2026-09-12）

### 15.1 Codex 会话列表按 provider 过滤（实测）

`codex app-server` 的 `thread/list` 会按**当前 `model_provider` 过滤**，实测：

| 参数 | thread/list 结果 |
| --- | --- |
| 不给 provider 覆盖（配置无效 → 回退默认） | 10 条（全部 provider=openai） |
| `-c model_provider="openai"` | 10 条 |
| `-c model_provider="ccgui"` | 0 条（没有 provider=ccgui 的会话） |

本机 `~/.codex/sessions` 里的历史会话 provider 分布：`ccgui_model_*` 185 条、`openai` 20 条、`cch` 7 条、`ccgui` 3 条（测试产生）。

因此所有 codex 进程统一声明 `model_provider=ccgui` 之后，会话扫描只会列出 provider=ccgui 的会话；CCGUI 自己记录的会话仍照常显示（元数据在 `~/.ccgui`），但"外部会话发现与绑定"看不到其它 provider 的历史会话。需要时可按 provider 多次枚举合并，或改为直接读 rollout 文件。

### 15.2 所有 claude / codex 启动点的处理

| 启动点 | 是否声明 CCGUI 供应商 |
| --- | --- |
| claude 会话运行时（ClaudeClient） | 是，`--settings` 注入 |
| codex 会话运行时（CodexClient） | 是，`-c model_provider=ccgui` + provider 定义 + catalog |
| codex 会话扫描（codex/session-source.js） | 是，统一走 `localProxy.buildCodexProviderArgs()` |
| codex 技能 / 插件 / 配置检查（services/codex-app-server.js） | 是，同上 |
| claude 插件管理（`claude plugin ...`） | 不注入（不涉及模型调用） |
| claude 模型清单枚举（claude/provider-api.js） | 不注入（目的就是读取用户自己的 claude 配置来列模型） |
| 用户在终端里直接运行的 claude / codex | 不受影响（使用其原始配置） |

已按本设计完成实现，与设计稿的差异如下：

| 项 | 设计稿 | 实际实现 |
| --- | --- | --- |
| 代理端口 | 默认 18921，被占用顺延 | 固定端口，可在「软件配置 → 本地模型代理端口」修改；被占用则启动失败并提示，会话启动会被阻止 |
| Codex 高级配置 UI | 结构化表单 | 每个 codex 模型卡片内提供 JSON 编辑区（覆盖全部 30+ 字段）+「填充默认模板」，留空即不生成 entry |
| 历史残留清理 | 可选清理 `model_providers.ccgui_model_*` | 按用户要求不清理，仅停止后续写入 |
| Codex ChatGPT 账号模式 | 待定 | 保持原样（不接管），该模式下不走代理 |
| 热切换范围 | 模型/供应商/凭据 | 已实现；`setSessionModel` 与 `setSessionTarget` 的 claude 分支改走 `set_model` 控制请求，codex 分支走 `thread/resume` |

验证结果：

- 代理集成测试（临时脚本，跑完已清理）：代理路由、模型名还原、凭据替换、SSE 透传、无前缀回落、未知供应商报错 全部通过
- 真实 CLI 端到端测试（临时脚本，跑完已清理）：真实 claude / codex 进程经代理到达假上游，模型名与凭据替换正确；claude 的 `--settings` 成功压过 `~/.claude/settings.json`
- Codex 模型目录验证：真实 codex CLI 接受 CCGUI 生成的目录；`{"models":[]}` 会被 codex 拒绝（`must contain at least one model`），因此目录为空时写入一条隐藏占位条目
- `npm run build`：前端构建通过
