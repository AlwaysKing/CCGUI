# Codex 登录回调与通知链路调查

**文档版本**: 1.0  
**最后更新**: 2026-04-06

本文记录对 Codex Desktop 解包代码、CCGUI 适配层，以及本机 `codex` 可执行文件的本地核查结果，重点回答这些问题：

1. ChatGPT 登录是如何发起的
2. 浏览器登录完成后是回到 `codex://...`，还是回到本地 HTTP 地址
3. 回调是谁监听的，是 Codex server 还是 CCGUI
4. 登录成功后 Codex Desktop 是如何得知状态变化的
5. 这条链路对 CCGUI 后续开发意味着什么

## 1. 结论摘要

- Codex ChatGPT 登录不是走 `codex://connector/oauth_callback`，而是走本地 HTTP 回调
- `account/login/start` 返回的 `authUrl` 中，`redirect_uri` 形如：
  - `http://localhost:<port>/auth/callback`
- 这个本地回调不是由 CCGUI 监听，而是由 Codex app-server / CLI 自己监听
- 浏览器回调到本地 HTTP server 后，Codex 自己完成：
  - `state` 校验
  - OAuth `code` 换 token
  - 本地凭证持久化
- 处理完成后，Codex server 会向前端推送通知：
  - `account/login/completed`
  - `account/updated`
- 因此当前链路里，CCGUI 的职责更像：
  - 发起登录
  - 打开浏览器
  - 等待 Codex server 回登录结果
- 只有在未来不再依赖 Codex app-server 的前提下，才需要 CCGUI 自己监听 OAuth 回调

## 2. CCGUI 当前验证结果

在 CCGUI 中新增调试入口后，直接调用了：

```text
account/login/start { type: "chatgpt" }
```

拿到的实际返回如下：

```json
{
  "type": "chatgpt",
  "loginId": "f5cc143e-d531-4412-b232-4e225c86ad74",
  "authUrl": "https://auth.openai.com/oauth/authorize?response_type=code&client_id=app_EMoamEEZ73f0CkXaXp7hrann&redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback&scope=openid%20profile%20email%20offline_access%20api.connectors.read%20api.connectors.invoke&code_challenge=...&code_challenge_method=S256&id_token_add_organizations=true&codex_cli_simplified_flow=true&state=...&originator=ccgui"
}
```

从这个返回可以直接确认：

- 登录页地址是 `https://auth.openai.com/oauth/authorize`
- `redirect_uri` 是：
  - `http://localhost:1455/auth/callback`
- `originator=ccgui`

这说明：

- 这次登录不是回到 `ccgui://...`
- 也不是回到 `codex://...`
- 而是回到本机 `localhost` 上的一个 HTTP 回调地址

## 3. 前端发起登录的链路

在 Codex Desktop 解包后的 webview 代码中，可以确认登录不是前端自己拼 URL，而是先向宿主请求开始登录，再由宿主返回 `authUrl`。

### 前端登录入口

文件：

- `/Users/alwaysking/Desktop/codex/dest_folder/webview/assets/index-CsW2954H.js`

在登录页逻辑中，点击 ChatGPT 登录后会执行：

```js
let { authUrl, completion } = await appServerManager.loginWithChatGpt(abortController)
if (authUrl) {
  dispatchMessage('open-in-browser', { url: authUrl })
}
let result = await completion
```

说明：

- 前端只负责调用 `loginWithChatGpt`
- 宿主返回 `authUrl`
- 前端再把这个地址交给系统浏览器打开
- 登录是否完成，由 `completion` promise 等待

### `loginWithChatGpt` 的实现

文件：

- `/Users/alwaysking/Desktop/codex/dest_folder/webview/assets/app-server-manager-hooks-CESABIyE.js`

可以确认：

```js
let result = await this.sendRequest('account/login/start', { type: 'chatgpt' })
let { loginId, authUrl } = result
```

并且它会等待：

```js
case 'account/login/completed'
```

说明：

- 真正生成登录 URL 的不是前端页面
- 而是 app-server / 宿主在处理 `account/login/start` 时生成并返回

## 4. 回调不是 deep link，而是 localhost

一开始曾怀疑这条登录会和 `codex://connector/oauth_callback` 一样走自定义协议，但实际调查表明，当前 ChatGPT 登录链路不是这样。

### Deep link 仍然存在

在 Electron 主进程 bundle 中仍然可以看到：

- `app.setAsDefaultProtocolClient('codex')`
- `app.on('open-url', ...)`
- `codex://connector/oauth_callback?...`

文件：

- `/Users/alwaysking/Desktop/codex/dest_folder/.vite/build/main-Bw7nouYH.js`

这说明 Codex Desktop 支持 `codex://` deep link。

### 但 ChatGPT 登录用的是 localhost 回调

这次实际抓到的 `authUrl` 明确写的是：

```text
redirect_uri=http://localhost:1455/auth/callback
```

因此至少对于这条 `account/login/start { type: "chatgpt" }` 登录链路来说：

- 最终回调不是 `codex://...`
- 而是 `http://localhost:<port>/auth/callback`

## 5. 谁在监听 `localhost:<port>/auth/callback`

结论：**不是 CCGUI，不是解包后的 webview 前端，而是 Codex 原生 app-server / CLI 本体。**

### 证据 1：解包后的 JS 只看到了开始登录和完成通知

在解包后的 Electron 和 webview JS 里，可以看到：

- `account/login/start`
- `account/login/completed`

但没有看到：

- `localhost:1455`
- `/auth/callback`
- 本地 HTTP server 的创建逻辑

这说明监听逻辑不在这些 JS bundle 中。

### 证据 2：本机 `codex` 可执行文件中存在本地登录服务和 token exchange 相关字符串

本机 `codex` 入口是：

- `/Users/alwaysking/.nvm/versions/node/v25.2.1/bin/codex`

它最终跳到平台原生可执行文件：

- `/Users/alwaysking/.nvm/versions/node/v25.2.1/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex`

对这个原生文件执行 `strings` 后，直接命中了以下关键字：

- `Starting local login server on http://localhost:`
- `/auth/callback`
- `/oauth/authorize?`
- `/oauth/token`
- `authorization_code`
- `code_verifier`
- `starting oauth token exchange`
- `oauth token exchange succeeded`
- `{ "method": "account/login/completed", "params": ... }`

还可以看到与回调处理相关的错误文案：

- `received login callback`
- `login callback state mismatch`
- `missing_authorization_code`
- `login callback token exchange failed`
- `persist_failed`
- `redirect_failed`

这套证据可以直接推导出：

1. Codex 自己启动本地 login server
2. 浏览器回调到 `/auth/callback`
3. Codex 自己校验 `state`
4. Codex 自己拿 `authorization_code` + `code_verifier` 去 `/oauth/token` 换 token
5. Codex 自己持久化凭证
6. 完成后再发 `account/login/completed`

## 6. 登录完成后，Codex Desktop 如何知道成功了

Codex Desktop 前端不是去轮询浏览器结果，而是依赖 server 主动推送通知。

### 关键通知

在解包后的前端逻辑中，可以确认至少有两个关键通知：

- `account/login/completed`
- `account/updated`

其中：

- `account/login/completed`
  - 用于表示这次登录流程已经结束
  - 携带 `loginId`、`success`、`error`
- `account/updated`
  - 用于刷新当前账号状态
  - 例如 `authMode`、`account` 等

### 前端如何消费

文件：

- `/Users/alwaysking/Desktop/codex/dest_folder/webview/assets/app-server-manager-hooks-CESABIyE.js`

前端会在 `loginWithChatGpt()` 中等待 `completion` promise，而这个 promise 正是由：

```text
account/login/completed
```

来 resolve / reject。

因此完整闭环是：

1. 前端发 `account/login/start`
2. Codex server 启本地 HTTP login server
3. 浏览器登录完成回调到 localhost
4. Codex server 自己完成 token exchange
5. Codex server 发 `account/login/completed`
6. 前端收到通知，更新 UI 为登录成功或失败

## 7. 刷新 token 与浏览器登录不是同一条链路

这次调查还确认了一点：**token refresh 和浏览器登录是两条不同的路径。**

### 刷新 token

在 CCGUI 适配层中：

- `refreshCodexAuthToken()`

底层调用的是：

```text
getAuthStatus { refreshToken: true, includeToken: true }
```

对应文件：

- `/Users/alwaysking/AKProject/CCGUI/electron/adapters/codex/client.js`

这条链路的语义是：

- 请求当前认证状态
- 同时要求 Codex 尝试 refresh token

它**不是**浏览器登录，也不会返回 `authUrl`。

### 浏览器登录

浏览器登录对应的是：

```text
account/login/start { type: "chatgpt" }
```

这条才会返回：

- `loginId`
- `authUrl`

所以后续开发时不要把：

- 登录开始
- token refresh

混成一条接口。

## 8. 对 CCGUI 的开发结论

### 8.1 当前如果继续依赖 Codex app-server

那么推荐职责划分如下：

- CCGUI：
  - 调 `account/login/start`
  - 拿到 `authUrl`
  - 打开浏览器
  - 等待 `account/login/completed`
  - 收到 `account/updated` 后同步 UI

- Codex app-server：
  - 起本地 login server
  - 接收 localhost 回调
  - 做 token exchange
  - 持久化 token
  - 发登录完成通知

在这个模式下：

- **不需要 CCGUI 自己监听 OAuth callback**

### 8.2 只有在完全自管 OAuth 时，才需要 CCGUI 自己监听

如果未来不再依赖 Codex app-server 的登录实现，而是希望 CCGUI 自己接管 OAuth，那么才需要：

- CCGUI 自己注册回调地址
- CCGUI 自己监听 localhost 或自定义 scheme
- CCGUI 自己做 code exchange
- CCGUI 自己存 token

这已经不是“接入 Codex 登录”，而是“重做一套自己的 OAuth 宿主链路”。

## 9. 当前仍未完全确认的点

虽然主链路已经比较明确，但下面这些点仍然没有直接源码级确认：

- 本地登录 server 端口是否总是 `1455`
  - 当前更像是运行时选择端口，而不是固定硬编码
- token 最终写入哪些具体文件、字段
  - 目前只知道 CCGUI 侧常用的是 `~/.codex/auth.json`
- 登录完成后是否还有额外的 redirect / 页面跳转细节

这些都属于“可以继续深挖，但不影响当前接入判断”的范围。

## 10. 本次调查涉及的关键文件

### CCGUI 仓库

- `/Users/alwaysking/AKProject/CCGUI/electron/adapters/codex/client.js`
- `/Users/alwaysking/AKProject/CCGUI/electron/adapters/codex/provider-api.js`
- `/Users/alwaysking/AKProject/CCGUI/electron/services/app-service.js`
- `/Users/alwaysking/AKProject/CCGUI/electron/main.cjs`
- `/Users/alwaysking/AKProject/CCGUI/electron/preload.js`
- `/Users/alwaysking/AKProject/CCGUI/src/views/settings/components/ModelSettings.vue`

### Codex Desktop 解包代码

- `/Users/alwaysking/Desktop/codex/dest_folder/webview/assets/index-CsW2954H.js`
- `/Users/alwaysking/Desktop/codex/dest_folder/webview/assets/app-server-manager-hooks-CESABIyE.js`
- `/Users/alwaysking/Desktop/codex/dest_folder/.vite/build/main-Bw7nouYH.js`

### 本机 Codex 可执行文件

- `/Users/alwaysking/.nvm/versions/node/v25.2.1/lib/node_modules/@openai/codex/bin/codex.js`
- `/Users/alwaysking/.nvm/versions/node/v25.2.1/lib/node_modules/@openai/codex/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex`
