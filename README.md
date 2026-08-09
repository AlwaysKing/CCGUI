# CCGUI

> Claude Code 与 Codex 的桌面工作台

CCGUI 是一个基于 Electron + Vue 3 的本地桌面应用，用来统一承载 Claude Code 和 Codex 的日常编码工作流。它不只是单一 CLI 的外壳，而是围绕多项目、多会话、任务面板、终端、文件浏览、权限确认和 MCP 管理组织起来的一套完整工作区。

![Built with Claude Code and Codex](https://img.shields.io/badge/Built%20with-Claude%20Code%20%2B%20Codex-111827)
![Electron](https://img.shields.io/badge/Electron-26.6.10-blue)
![Vue](https://img.shields.io/badge/Vue-3.4.0-green)

## 当前定位

- 同时支持 `Claude Code` 和 `Codex` 两套运行时
- 提供统一的桌面工作区，而不是只包装单一 CLI
- 面向真实项目开发，强调会话管理、任务编排、文件操作和工具调用可视化
- 项目由 Claude Code 和 Codex 协作持续演进

## 核心能力

### 双运行时工作区

- 在同一个应用里管理 Claude 与 Codex 会话
- 支持项目级切换、Provider 过滤、会话复制、锁定和回收站
- 支持项目提示词、会话配置、模型切换和权限模式切换

### 面向编码的主工作区

- 流式对话与 Markdown 渲染
- 工具调用可视化，包含命令、读写文件、diff、权限请求等
- 文件树、文件预览、Monaco 编辑器联动
- 内置终端面板与快捷任务栏
- Task Templates 与 VS Code `tasks.json` 集成

### 扩展与集成

- MCP 服务管理与工具检查
- `@` 引用系统：agents / skills / MCP tools
- `/` 命令与上下文附件
- Computer Use、子 agent、权限确认等运行时能力展示

## 这不是独立运行时

CCGUI 本身不提供 Claude Code 或 Codex 的模型运行能力。它依赖你本机已经安装并可正常使用的 provider。

你至少需要准备下面两者之一：

### 方案 A：Claude Code

1. 安装 Claude Code CLI

```bash
npm install -g @anthropic-ai/claude-code
```

2. 登录并完成可用性验证

```bash
claude-code login
claude-code --version
```

### 方案 B：Codex

CCGUI 会优先在这些位置查找 Codex 可执行文件：

- `/Applications/Codex.app/Contents/Resources/codex`
- `/opt/homebrew/bin/codex`
- `/usr/local/bin/codex`
- `~/.local/bin/codex`

如果你使用命令行安装的 Codex，至少应保证下面的验证可通过：

```bash
codex --version
```

如果你希望同时使用两套运行时，可以两边都安装。

## 快速开始

### 安装依赖

```bash
git clone <your-repo-url>
cd CCGUI
npm install
```

### 开发模式

```bash
# 标准开发模式
npm run electron:dev

# 调试脚本
npm run debug

# 调试脚本 + 开发者工具
npm run debug:tools
```

### 构建

```bash
# 完整重建
npm run rebuild

# 快速重建
npm run rebuild:fast

# 只构建前端
npm run rebuild:only
```

构建产物默认输出到 `output/`。

## 功能概览

### 项目与会话

- 多项目管理与快速切换
- Claude / Codex 项目来源识别
- 会话 Fork、锁定、软删除、回收站
- Per-Agent 队列与协作消息流

### 聊天与工具可视化

- 用户消息、助手消息、系统消息统一展示
- 工具调用状态、参数、结果和 diff 面板
- 权限请求与执行反馈可视化
- Context usage、MCP、环境状态展示

### 文件与终端

- 项目文件树导航
- 文件预览面板
- Monaco 代码编辑器
- 内置 xterm 终端
- 任务快捷启动、停止与历史持久化

### 配置与扩展

- 模型配置与 Provider 管理
- 提示词管理
- 快捷键设置
- 终端主题与字体设置
- MCP 服务与工具检查

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| [Electron](https://www.electronjs.org/) | 26.6.10 | 桌面应用框架 |
| [Vue 3](https://vuejs.org/) | 3.4.0 | 前端框架 |
| [Vite](https://vitejs.dev/) | 5.0.0 | 构建工具 |
| [Pinia](https://pinia.vuejs.org/) | 3.0.4 | 状态管理 |
| [Monaco Editor](https://microsoft.github.io/monaco-editor/) | 0.55.1 | 代码编辑器 |
| [xterm.js](https://xtermjs.org/) | 5.3.0 | 终端模拟 |
| [node-pty](https://github.com/microsoft/node-pty) | 1.0.0 | 伪终端支持 |
| [marked](https://marked.js.org/) | 17.0.3 | Markdown 解析 |
| [highlight.js](https://highlightjs.org/) | 11.11.1 | 代码高亮 |

## 项目结构

```text
CCGUI/
├── electron/                    # Electron 主进程与 provider 适配层
│   ├── adapters/                # Claude / Codex runtime adapters
│   ├── services/                # 项目、MCP、文件、Codex app server 等服务
│   ├── session/                 # 会话运行时与消息编排
│   └── storage/                 # 应用配置、历史与项目配置
├── src/                         # Vue 前端
│   ├── views/welcome/           # 欢迎页与项目入口
│   ├── views/workspace/         # 主工作区
│   ├── views/settings/          # 设置面板
│   ├── views/tools/             # MCP / Skills / Provider 等工具弹窗
│   └── stores/                  # Pinia 状态管理
├── docs/                        # 协议、架构与说明文档
├── scripts/                     # 调试、构建、安装脚本
└── output/                      # 打包输出目录
```

## 常用脚本

```bash
# 前端开发服务器
npm run dev

# Electron 开发模式
npm run electron:dev

# 本地运行 Electron
npm run electron

# 标准调试
npm run debug

# 构建
npm run rebuild
```

## 故障排除

### Claude Code 不可用

```bash
claude-code --version
claude-code login
```

### Codex 不可用

```bash
codex --version
which codex
```

如果你依赖的是 macOS 的 `Codex.app`，也可以检查：

```bash
ls /Applications/Codex.app/Contents/Resources/codex
```

### 修改代码后界面没有更新

```bash
rm -rf node_modules/.vite
npm run debug
```

## 贡献

欢迎提交 issue、讨论产品方向或直接发起 PR。

## 致谢

- **Anthropic** 提供 Claude 与 Claude Code
- **OpenAI** 提供 Codex
- **Claude Code 与 Codex** 持续参与本项目的开发与迭代
