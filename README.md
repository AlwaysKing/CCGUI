# CCGUI - Claude Code GUI

> **Claude Code CLI 的原生桌面 GUI 包装器**

一个现代化的图形界面，让你更直观地使用 Claude Code CLI 和 Codex。

![Made with Claude Code](https://img.shields.io/badge/Made%20with-100%25%20Claude%20Code-blue)
![Electron](https://img.shields.io/badge/Electron-26.6.10-blue)
![Vue](https://img.shields.io/badge/Vue-3.4.0-green)

---

## 项目特点

- **原生 GUI 包装器** - 为 Claude Code CLI 和 Codex 提供直观的图形界面
- **100% Claude Code 编写** - 本项目完全由 Claude Code 自主开发
- **双 Provider 支持** - 同时支持 Claude CLI 和 Codex 适配器
- **实时流式对话** - 实时显示 AI 的思考和回复过程
- **工具可视化** - 直观展示 Bash、Read、Write、Edit 等工具调用
- **权限管理** - 敏感操作前的可视化权限确认
- **多项目管理** - 支持多项目切换和会话管理
- **终端集成** - 内置 xterm 终端面板
- **现代化 UI** - 精心设计的深色主题界面

---

## 前置要求

**CCGUI 不是独立应用，它是一个 GUI 包装器！**

在使用 CCGUI 之前，你必须：

1. **安装 Claude Code CLI**
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

2. **登录 Claude Code**
   ```bash
   claude-code login
   ```

3. **验证安装**
   ```bash
   claude-code --version
   ```

**CCGUI 会调用你本地安装的 Claude Code CLI**，所有功能都依赖于 CLI 的正常工作。

---

## 快速开始

### 安装

```bash
# 克隆仓库
git clone https://github.com/yourusername/CCGUI.git
cd CCGUI

# 安装依赖
npm install
```

### 开发模式

```bash
# 方式 1: 使用调试脚本（推荐）
npm run debug

# 方式 2: 标准开发模式
npm run electron:dev
```

### 构建应用

```bash
# 完整重新编译打包
npm run rebuild

# 快速构建（跳过清理）
npm run rebuild:fast

# 只构建前端
npm run rebuild:only
```

构建完成后，应用位于 `dist/mac-arm64/CCGUI.app`

---

## 功能特性

### 实时对话

- 流式显示 AI 的回复
- Markdown 渲染，支持代码高亮
- 自动滚动到最新消息
- 上下文用量（Token）显示
- @ 引用系统（agents / skills / MCP tools）
- / 命令快速执行
- 附件管理（图片、文件、文件范围）

### 会话管理

| 功能 | 说明 |
|------|------|
| **Session Fork** | 复制会话，保留历史消息继续对话 |
| **Session 锁定** | 锁定重要会话，防止误删 |
| **软删除 & 回收站** | 会话可恢复删除 |
| **Per-Agent 队列** | 高级消息队列管理 |
| **会话配置** | 每个会话独立的设置 |

### 工具调用可视化

直观展示 AI 执行的各种操作：

| 工具 | 说明 |
|------|------|
| **Bash** | 执行 shell 命令 |
| **Read** | 读取文件内容 |
| **Write** | 写入新文件 |
| **Edit** | 编辑现有文件 |
| **Glob** | 搜索文件模式 |
| **Grep** | 搜索文件内容 |
| **Agent** | 启动子代理 |
| **Computer Use** | Codex 计算机使用 |

### 智能权限管理

- 敏感操作前弹出确认对话框
- 支持永久允许/拒绝
- AutoApprove 独立开关
- 显示详细的操作信息

### 项目管理

- 多项目支持，快速切换
- Dock 图标拖拽打开项目
- 项目配置（独立设置）
- 项目级别提示词（项目说明）
- 文件浏览器（项目文件树导航）
- Git 状态集成
- 文件预览面板
- 代码编辑器（Monaco Editor）

### MCP 管理

- MCP 服务器工具管理
- 连接 Toggle / Reconnect
- 工具描述自动获取
- MCP Tool Inspector

### 任务系统

- 快捷任务栏（Task Dock）
- Task Templates 任务模板
- VS Code Tasks 集成
- 任务历史持久化

### 终端集成

- 内置 xterm 终端面板
- Shell 环境增强
- 环境变量管理

### 设置系统

| 设置项 | 说明 |
|--------|------|
| 模型设置 | 模型选择与配置 |
| 快捷键设置 | 自定义键盘快捷键 |
| 终端设置 | 终端配置 |
| 提示词设置 | 系统提示词管理 |
| 聊天主题 | 消息显示主题自定义 |
| 软件设置 | 应用全局设置 |

---

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| [Electron](https://www.electronjs.org/) | 26.6.10 | 桌面应用框架 |
| [Vue 3](https://vuejs.org/) | 3.4.0 | 前端框架 |
| [Vite](https://vitejs.dev/) | 5.0.0 | 构建工具 |
| [Pinia](https://pinia.vuejs.org/) | 3.0.4 | 状态管理 |
| [marked](https://marked.js.org/) | 17.0.3 | Markdown 解析 |
| [highlight.js](https://highlightjs.org/) | 11.11.1 | 代码高亮 |
| [Monaco Editor](https://microsoft.github.io/monaco-editor/) | 0.55.1 | 代码编辑器 |
| [xterm.js](https://xtermjs.org/) | 5.3.0 | 终端模拟 |
| [node-pty](https://github.com/microsoft/node-pty) | 1.0.0 | 伪终端支持 |

---

## 项目结构

```
CCGUI/
├── electron/                    # Electron 主进程
│   ├── main.cjs                # 主进程入口
│   ├── preload.js              # 预加载脚本（IPC 桥接）
│   ├── adapters/               # Provider 适配器层
│   │   ├── claude/             #   Claude CLI 适配器
│   │   ├── codex/              #   Codex 适配器
│   │   └── shared/             #   共享组件
│   ├── services/               # 服务层
│   │   ├── project-service.js  #   项目管理
│   │   ├── attachment-service.js#  附件服务
│   │   └── ...                 #   其他服务
│   ├── session/                # 会话管理
│   │   ├── session-manager.js  #   会话管理器
│   │   └── session-instance.js #   会话实例
│   └── storage/                # 存储系统
│       ├── app-config-manager.js    # 应用配置
│       ├── session-config-manager.js# 会话配置
│       ├── history-manager.js       # 历史消息
│       └── ...
├── src/                        # Vue3 前端源码
│   ├── stores/                 # Pinia 状态管理
│   │   ├── useAppStore.js      #   应用状态
│   │   ├── useSessionStore.js  #   会话状态
│   │   ├── useFileBrowserStore.js# 文件浏览器
│   │   └── AgentQueue.js       #   Agent 队列
│   ├── components/             # 基础组件
│   │   ├── base/               #   基础 UI 组件
│   │   └── chat/               #   聊天相关组件
│   ├── views/                  # 页面视图
│   │   ├── welcome/            #   欢迎页
│   │   ├── workspace/          #   工作区（主界面）
│   │   ├── settings/           #   设置页面
│   │   └── tools/              #   工具对话框
│   ├── utils/                  # 工具函数
│   ├── styles/                 # 样式文件
│   └── composables/            # 组合式函数
├── scripts/                    # 开发脚本
│   ├── debug.sh                #   调试启动
│   ├── rebuild.sh              #   重新编译打包
│   └── install.sh              #   安装脚本
├── docs/                       # 文档
│   ├── ccgui-architecture-charter.md  # 架构设计
│   ├── claude-code-protocol.md        # Claude 协议
│   ├── codex-protocol.md              # Codex 协议
│   └── ...
└── package.json
```

---

## 开发脚本

### 重新编译打包

```bash
# 完整重新编译
npm run rebuild

# 快速模式（跳过清理）
npm run rebuild:fast

# 只构建前端
npm run rebuild:only
```

### 启动调试

```bash
# 标准调试模式
npm run debug

# 自动打开开发者工具
npm run debug:tools

# 安静模式（不显示日志）
npm run debug:quiet
```

---

## 界面预览

### 主界面

- 左侧：会话列表、项目切换、文件浏览器
- 中间：对话窗口（流式消息、工具调用可视化）
- 右侧：可切换面板（文件预览 / 终端）

### 消息类型

- **用户消息** - 文本输入、附件、@ 引用
- **助手消息** - AI 回复（Markdown 渲染）
- **工具调用** - 显示工具名称、参数、状态、结果
- **系统消息** - 系统通知和状态
- **权限请求** - 操作确认对话框

---

## 故障排除

### 应用无法启动

```bash
# 检查 Claude Code CLI 是否安装
claude-code --version

# 重新安装依赖
rm -rf node_modules
npm install
```

### 修改代码后没有更新

```bash
# 清理缓存并重新启动
rm -rf node_modules/.vite
npm run debug
```

### 打包后的应用名称不正确

```bash
# 运行完整的重新编译
npm run rebuild
```

---

## 贡献

欢迎贡献代码、报告问题或提出建议！

### 开发流程

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

---

## 致谢

- **Anthropic** - 开发 Claude 和 Claude Code CLI
- **Claude Code** - 本项目 100% 由 Claude Code 自主编写

---

## 更新日志

### v1.0.0 (2026-03)

- 初始发布
- 完整的 GUI 界面
- 工具调用可视化
- 权限管理系统
- 多项目支持
- 深色主题

### v1.x (2026-04 ~ 2026-05)

- 双 Provider 支持（Claude CLI + Codex）
- Session Fork / 锁定 / 回收站
- Per-Agent 队列系统
- MCP 工具管理
- 内置终端面板
- 任务系统（Task Dock / Templates）
- Monaco 代码编辑器
- 文件浏览器 & 预览
- @ 引用 & / 命令系统
- 聊天主题自定义
- 项目级别提示词

---

<div align="center">

**Made with Claude Code**

</div>
