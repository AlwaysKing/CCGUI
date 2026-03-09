# CCGUI - Claude Code GUI

> **Claude Code CLI 的原生桌面 GUI 包装器**

一个现代化的图形界面，让你更直观地使用 Claude Code CLI。

![Made with Claude Code](https://img.shields.io/badge/Made%20with-100%25%20Claude%20Code-blue)
![Electron](https://img.shields.io/badge/Electron-26.6.10-blue)
![Vue](https://img.shields.io/badge/Vue-3.4.0-green)

---

## 🎯 项目特点

- **🎨 原生 GUI 包装器** - 为 Claude Code CLI 提供直观的图形界面
- **🤖 100% Claude Code 编写** - 本项目完全由 Claude Code 自主开发
- **⚡ 实时流式对话** - 实时显示 Claude 的思考和回复过程
- **🔧 工具可视化** - 直观展示 Bash、Read、Write、Edit 等工具调用
- **🔐 权限管理** - 敏感操作前的可视化权限确认
- **📂 项目管理** - 支持多项目切换和会话管理
- **🌙 现代化 UI** - 精心设计的深色主题界面

---

## ⚠️ 重要说明

### 前置要求

**CCGUI 不是独立应用，它是一个 GUI 包装器！**

在使用 CCGUI 之前，你必须：

1. ✅ **安装 Claude Code CLI**
   ```bash
   npm install -g @anthropic-ai/claude-code
   ```

2. ✅ **登录 Claude Code**
   ```bash
   claude-code login
   ```

3. ✅ **验证安装**
   ```bash
   claude-code --version
   ```

**CCGUI 会调用你本地安装的 Claude Code CLI**，所有功能都依赖于 CLI 的正常工作。

---

## 🚀 快速开始

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

## ✨ 功能特性

### 💬 实时对话

- 流式显示 Claude 的回复
- Markdown 渲染，支持代码高亮
- 自动滚动到最新消息

### 🔧 工具调用可视化

直观展示 Claude 执行的各种操作：

| 工具 | 说明 |
|------|------|
| **Bash** | 执行 shell 命令 |
| **Read** | 读取文件内容 |
| **Write** | 写入新文件 |
| **Edit** | 编辑现有文件 |
| **Glob** | 搜索文件模式 |
| **Grep** | 搜索文件内容 |
| **Agent** | 启动子代理 |

### 🔐 智能权限管理

- 敏感操作前弹出确认对话框
- 支持永久允许/拒绝
- 显示详细的操作信息

### 📂 项目管理

- 多项目支持
- 项目快速切换
- 会话状态保存
- Dock 图标拖拽打开项目

---

## 📖 使用指南

### 首次使用

1. 确保 Claude Code CLI 已安装并登录
2. 启动 CCGUI
3. 选择或创建一个项目目录
4. 开始与 Claude 对话

### 日常使用

```bash
# 启动应用
npm run debug

# 或打开已构建的应用
open dist/mac-arm64/CCGUI.app
```

### 快捷操作

- **拖拽文件夹** - 拖拽项目文件夹到 Dock 图标快速打开
- **Cmd+Option+I** - 打开开发者工具
- **Cmd+R** - 刷新界面

---

## 🛠️ 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| [Electron](https://www.electronjs.org/) | 26.6.10 | 桌面应用框架 |
| [Vue 3](https://vuejs.org/) | 3.4.0 | 前端框架 |
| [Vite](https://vitejs.dev/) | 5.0.0 | 构建工具 |
| [Pinia](https://pinia.vuejs.org/) | 3.0.4 | 状态管理 |
| [marked](https://marked.js.org/) | 17.0.3 | Markdown 解析 |
| [highlight.js](https://highlightjs.org/) | 11.11.1 | 代码高亮 |

---

## 📁 项目结构

```
CCGUI/
├── electron/                    # Electron 主进程
│   ├── main.cjs                # 主进程入口
│   ├── preload.js              # 预加载脚本（IPC 桥接）
│   └── claude-manager.js       # Claude CLI 进程管理
├── src/                        # Vue3 前端源码
│   ├── components/             # Vue 组件
│   │   ├── ChatWindow.vue      # 主聊天窗口
│   │   ├── MarkdownRenderer.vue# Markdown 渲染
│   │   ├── ToolUseMessage.vue  # 工具调用展示
│   │   └── PermissionDialog.vue# 权限确认
│   ├── stores/                 # Pinia 状态管理
│   ├── views/                  # 页面视图
│   └── styles/                 # 样式文件
├── scripts/                    # 开发脚本
│   ├── rebuild.sh             # 重新编译打包
│   └── debug.sh               # 启动调试模式
└── docs/                       # 文档
```

---

## 🔧 开发脚本

我们提供了便捷的开发脚本：

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

详见：[开发脚本文档](docs/SCRIPTS.md)

---

## 🎨 界面预览

### 主界面

- 左侧：会话列表和项目切换
- 中间：对话窗口
- 右侧：工具调用详情

### 消息类型

- **用户消息** - 你的输入
- **助手消息** - Claude 的回复（Markdown 渲染）
- **工具调用** - 显示工具名称、参数、状态、结果
- **系统消息** - 系统通知和状态

---

## 🤝 贡献

欢迎贡献代码、报告问题或提出建议！

### 开发流程

1. Fork 本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建 Pull Request

---

## 🐛 故障排除

### 问题：应用无法启动

**解决方案**：
```bash
# 检查 Claude Code CLI 是否安装
claude-code --version

# 重新安装依赖
rm -rf node_modules
npm install
```

### 问题：修改代码后没有更新

**解决方案**：
```bash
# 清理缓存并重新启动
rm -rf node_modules/.vite
npm run debug
```

### 问题：打包后的应用名称不正确

**解决方案**：
```bash
# 运行完整的重新编译
npm run rebuild
```

---

## 📄 许可证

本项目采用 MIT 许可证 - 详见 [LICENSE](LICENSE) 文件

---

## 🙏 致谢

- **Anthropic** - 开发 Claude 和 Claude Code CLI
- **Claude Code** - 本项目 100% 由 Claude Code 自主编写

---

## 📝 更新日志

### v1.0.0 (2026-03)

- ✨ 初始发布
- 🎨 完整的 GUI 界面
- 🔧 工具调用可视化
- 🔐 权限管理系统
- 📂 多项目支持
- 🌙 深色主题

---

<div align="center">

**Made with ❤️ by Claude Code**

[报告问题](https://github.com/yourusername/CCGUI/issues) · [功能建议](https://github.com/yourusername/CCGUI/issues) · [文档](docs/)

</div>
