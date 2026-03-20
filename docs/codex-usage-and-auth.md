# Codex 用量接口与认证链路

本文记录对 `codex.app` 解包代码的本地核查结果，重点回答三件事：

1. “5 小时剩余 / 一周剩余”数据从哪里来  
2. 它是否直接请求 OpenAI/ChatGPT 在线后端  
3. token 刷新是如何进行的

## 结论摘要

- 用量数据来自同一个接口：`GET /wham/usage`
- 前端不是拿到“5 小时剩余 / 一周剩余”现成字段，而是根据 `rate_limit` 窗口长度自己映射和计算
- 这个请求不是发给本地 codex runtime，而是通过 Electron 壳层转发到 OpenAI 在线后端
- 生产环境基础地址是 `https://chatgpt.com/backend-api`
- Electron 主进程会统一补充认证头：
  - `Authorization: Bearer <token>`
  - `ChatGPT-Account-Id: <id>`
  - `originator: Codex Desktop`
  - `User-Agent: Codex Desktop/<version> (<platform>; <arch>)`
- 如果请求返回 `401`，主进程会触发一次显式 refresh，再重试同一个请求

## 1. 用量接口来源

`codex-api-CgNFsbUW.js` 中的接口封装直接表明，用量数据来自：

```js
async function Ft(){
  return v.safeGet('/wham/usage')
}
```

同文件还能看到相关账户接口：

```js
safeGet('/wham/accounts/check')
```

已确认文件：

- `/Users/alwaysking/Desktop/codex/app/webview/assets/codex-api-CgNFsbUW.js`

## 2. “5 小时剩余 / 一周剩余”如何计算

前端 query 在 `use-usage-settings-access-RVEMOe2e.js` 中：

- query key: `['rate-limit-status']`
- `queryFn: ee`
- `refetchInterval: ONE_MINUTE`

也就是它会每分钟刷新一次 `/wham/usage`。

### 关键字段

从前端转换逻辑可以确认，接口里至少会被消费这些字段：

- `rate_limit.primary_window`
- `rate_limit.secondary_window`
- `used_percent`
- `limit_window_seconds`
- `reset_at`
- `additional_rate_limits`

前端会把窗口转换成统一结构：

- `usedPercent`
- `windowDurationMins`
- `resetsAt`

对应逻辑：

```js
function de(e){
  return e == null
    ? null
    : {
        usedPercent: e.used_percent ?? 0,
        windowMinutes: e.limit_window_seconds == null ? null : e.limit_window_seconds / 60,
        resetAt: e.reset_at ?? null
      }
}
```

### 为什么会显示成“5 小时”和“一周”

前端不是死板找固定的 `300` 和 `10080`，而是：

- 从所有短窗口里选“最接近 300 分钟”的那个，显示为 `5 hour usage limit`
- 从所有长窗口里选“最接近 7 天”的那个，显示为 `Weekly usage limit`

对应常量：

```js
var Z = 300
var Ce = 7 * 1440
```

对应逻辑：

```js
let i = $(n.filter(e => (e.windowDurationMins ?? 0) < 1440), Z)
let a = $(n.filter(e => e !== i && (e.windowDurationMins ?? 0) >= 1440), Ce)
```

所以 `codex.app` 显示“5 小时剩余 / 一周剩余”的本质是：

1. 请求 `/wham/usage`
2. 读取多个 rate limit window
3. 按窗口时长映射到 5h / weekly
4. 用 `100 - usedPercent` 算出 remaining percent

对应计算：

```js
function M(e){
  return Number.isFinite(e) ? Math.min(Math.max(100 - e, 0), 100) : 100
}
```

UI 最终显示：

```js
defaultMessage: `{remaining}% left`
```

已确认文件：

- `/Users/alwaysking/Desktop/codex/app/webview/assets/use-usage-settings-access-RVEMOe2e.js`
- `/Users/alwaysking/Desktop/codex/app/webview/assets/usage-settings-CUiHSmi9.js`

## 3. 请求是否直接走 OpenAI/ChatGPT 后端

是。

这条链不是去问本地 codex 运行时，也不是本地写死限额，而是 Electron 主进程把前端相对路径补成完整 OpenAI 在线地址后再发出。

主进程里可确认的基础地址：

```js
prodApiBaseUrl = "https://chatgpt.com/backend-api"
devApiBaseUrl = "http://localhost:8000/api"
```

对相对路径的处理：

```js
ensureAbsoluteUrl(e){
  return /^https?:\/\//i.test(e) || e.startsWith("data:")
    ? e
    : `${this.apiBaseUrl}/${e.replace(/^\/+/, "")}`
}
```

这意味着：

```text
/wham/usage
```

在生产环境会变成：

```text
https://chatgpt.com/backend-api/wham/usage
```

已确认文件：

- `/Users/alwaysking/Desktop/codex/app/.vite/build/main-BFYI5W9_.js`

## 4. 认证头是如何注入的

认证头不是前端页面自己手动拼的，而是 Electron 主进程的 fetch wrapper 统一加的。

触发条件是：

- 请求没有显式带 `authorization`
- host 属于：
  - `localhost`
  - `openai.com` / `*.openai.com`
  - `chatgpt.com` / `*.chatgpt.com`（排除 `ab.*`）

对应判断：

```js
shouldAttachAuth(e, t){
  ...
  return !!(
    r === "localhost" ||
    r === "localhost:8000" ||
    r === "openai.com" ||
    r.endsWith(".openai.com") ||
    r === "chatgpt.com" ||
    r.endsWith(".chatgpt.com") && !r.startsWith("ab.")
  )
}
```

真正注入的 header：

```js
applyDesktopAuthHeaders(e, t){
  this.setHeader(e, "Authorization", `Bearer ${t}`)
  const i = this.extractChatGptAccountId(t)
  i && !this.hasHeader(e, "ChatGPT-Account-Id") && this.setHeader(e, "ChatGPT-Account-Id", i)
  this.hasHeader(e, "originator") || this.setHeader(e, "originator", this.options.desktopOriginator)
  this.hasHeader(e, "User-Agent") || this.setHeader(e, "User-Agent", this.buildDesktopUserAgent())
}
```

因此最接近真实请求的 header 集合是：

- `Authorization: Bearer <access token>`
- `ChatGPT-Account-Id: <account id>`
- `originator: Codex Desktop`
- `User-Agent: Codex Desktop/<version> (<platform>; <arch>)`

## 5. ChatGPT-Account-Id 如何得到

`ChatGPT-Account-Id` 不是单独查一遍接口拿的，而是可以直接从 Bearer token 的 JWT payload 里解出来。

主进程逻辑：

```js
extractChatGptAccountId(e){
  const t = e.split(".")
  ...
  const payload = JSON.parse(Buffer.from(t[1], "base64url").toString("utf8"))
  const auth = payload["https://api.openai.com/auth"]
  const id = auth.chatgpt_account_id
  return typeof id === "string" ? id : null
}
```

所以 `ChatGPT-Account-Id` 的来源是 token 自身的 claim。

## 6. token 刷新流程

这是这次最重要的确认点。

### 6.1 正常请求

Electron fetch wrapper 发需要认证的请求前，会先拿 token：

```js
p = await this.getAppServerConnection(t.hostId).getAuthToken({ refreshToken: false })
```

然后带着这个 token 发请求。

### 6.2 401 后刷新并重试

如果请求返回 `401`，并且这次请求属于“需要附加认证头”的目标域名，主进程会：

1. 再调用一次 `getAuthToken({ refreshToken: true })`
2. 重新附 header
3. 重试原请求一次

对应逻辑：

```js
let m = await d(p)
if (l && m.status === 401) {
  p = await this.getAppServerConnection(t.hostId).getAuthToken({ refreshToken: true })
  m = await d(p)
}
```

所以 refresh 触发点是：

- 先发真实 API 请求
- 收到 `401`
- 再执行 refresh

而不是每次请求前都主动 refresh。

### 6.3 refresh 并不是 webview 自己完成

`getAuthToken` 继续往下看，实际会走 app-server 连接层：

```js
async getAuthToken({ refreshToken: e }){
  if (cached && !e) return cached
  return await this.fetchAuthToken(e)
}
```

而 `fetchAuthToken(e)` 最终调用的是：

```js
requestAuthStatus(e, true)
```

请求方法名是：

```js
method: "getAuthStatus"
params: {
  includeToken: true,
  refreshToken: e
}
```

这说明：

- refresh 不在前端页面里做
- 也不是直接在 fetch wrapper 里自己拿 refresh token 换 access token
- 而是委托给 app-server / 内部认证子系统，通过 `getAuthStatus(refreshToken: true)` 完成

## 7. auth.json 的角色

此前本地调查已确认，Codex 桌面端会把认证状态持久化在：

```text
~/.codex/auth.json
```

其中至少包括：

- `auth_mode`
- `last_refresh`
- `tokens.id_token`
- `tokens.access_token`
- `tokens.refresh_token`
- `tokens.account_id`

这份文件是本地登录态的持久化来源；运行时还可能有内存缓存，但不是根源。

说明：

- 本文对 `auth.json` 的字段结构采用的是此前本机调查结果
- 本次复核重点放在“请求链路”和“401 刷新逻辑”

## 8. 可复刻的 curl 形态

如果只看请求结构，`/wham/usage` 最接近的 curl 形式是：

```bash
curl 'https://chatgpt.com/backend-api/wham/usage' \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "ChatGPT-Account-Id: YOUR_ACCOUNT_ID" \
  -H "originator: Codex Desktop" \
  -H "User-Agent: Codex Desktop/1.0.0 (darwin; arm64)" \
  -H "Accept: application/json"
```

更贴近本机持久化登录态的形式是从 `~/.codex/auth.json` 取值。

注意：

- 真正必需的核心通常是 `Authorization`
- `ChatGPT-Account-Id` 在 Codex Desktop 中会被主动附带
- `User-Agent` 的具体版本号可能不是强校验点，但桌面端确实会加

## 9. 已确认与待补证

### 已确认

- `/wham/usage` 是用量接口
- 前端每分钟轮询一次
- 5h / weekly 是前端按窗口长度归类
- remaining 是 `100 - usedPercent`
- 生产环境基地址是 `https://chatgpt.com/backend-api`
- Electron 主进程会自动注入认证头
- 收到 `401` 后会通过 `getAuthToken({ refreshToken: true })` 刷新并重试
- `ChatGPT-Account-Id` 可从 token claim 中提取

### 待进一步补证

- `~/.codex/auth.json` 的完整读写代码路径
- `getAuthStatus(refreshToken: true)` 在 app-server 内部到底如何使用 `refresh_token`
- `/wham/usage` 返回 JSON 的完整字段样例

如果后续要在 CCGUI 中复刻这套能力，建议放在 `app-service` 层统一做在线账户请求与 token 管理，而不是散落到 UI 或 provider runtime 中。
