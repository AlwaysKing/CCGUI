# Claude Code GUI

基于 Electron + Vue3 构建的 Claude Code 桌面图形界面应用。

## 功能特性

- **实时对话**: 与 Claude Code CLI 进行实时交互对话
- **Markdown 渲染**: 支持代码高亮的 Markdown 消息渲染
- **工具调用可视化**: 直观展示 Claude 执行的工具操作（Bash、Read、Write、Edit 等）
- **权限管理**: 工具执行前的权限确认对话框
- **消息详情**: 查看消息的完整 JSON 数据
- **拖拽文件**: 支持拖拽文件到输入框
- **环境信息显示**: 显示当前工作目录、模型版本等信息
- **深色主题**: 现代化的深色 UI 设计

## 系统要求

- Node.js 18+
- Claude Code CLI（已安装并配置）

## 安装与运行

### 安装依赖

```bash
# 使用默认源
npm install

# 或使用国内镜像
npm install --registry=https://registry.npmmirror.com
```

### 开发模式

```bash
# 快速启动（推荐）
./dev.sh

# 或手动启动
npm run electron:dev
```

### 构建

```bash
# 构建应用
npm run electron:build
```

## 项目结构

```
CCGUI/
├── electron/                    # Electron 主进程
│   ├── main.cjs                # 主进程入口
│   ├── preload.js              # 预加载脚本
│   └── claude-manager.js       # Claude CLI 管理器
├── src/                        # Vue3 源代码
│   ├── App.vue                 # 根组件
│   ├── main.js                 # Vue 入口
│   ├── components/             # Vue 组件
│   │   ├── ChatWindow.vue      # 聊天窗口（主组件）
│   │   ├── MarkdownRenderer.vue# Markdown 渲染器
│   │   ├── ToolUseMessage.vue  # 工具调用消息
│   │   ├── PermissionDialog.vue# 权限确认对话框
│   │   ├── AskUserQuestionDialog.vue # 用户问题对话框
│   │   └── MessageDetailDialog.vue   # 消息详情对话框
│   ├── views/
│   │   └── ToolUseTest.vue     # 样式测试页面
│   └── styles/
│       └── global.css          # 全局样式
├── index.html                  # HTML 模板
├── vite.config.js              # Vite 配置
├── package.json                # 项目配置
└── dev.sh                      # 开发启动脚本
```

## 技术栈

| 技术 | 版本 | 用途 |
|------|------|------|
| Electron | ^26.6.10 | 桌面应用框架 |
| Vue3 | ^3.4.0 | 前端框架 |
| Vite | ^5.0.0 | 构建工具 |
| marked | ^17.0.3 | Markdown 解析 |
| highlight.js | ^11.11.1 | 代码高亮 |

## IPC 通信接口

### 渲染进程 -> 主进程

| 通道 | 说明 | 参数 |
|------|------|------|
| `send-message` | 发送消息给 Claude | `{ content: string }` |
| `send-tool-result` | 发送工具执行结果 | `(toolUseId, content, isError)` |
| `send-control-response` | 发送权限响应 | `(requestId, approved, options)` |
| `get-claude-info` | 获取 Claude 信息 | - |
| `is-claude-ready` | 检查 Claude 是否就绪 | - |
| `get-init-info` | 获取初始化信息 | - |

### 主进程 -> 渲染进程

| 通道 | 说明 |
|------|------|
| `claude-init` | Claude 初始化完成 |
| `claude-message` | Claude 助手消息 |
| `claude-result` | Claude 结果消息 |
| `system-message` | 系统消息 |
| `tool-use` | 工具调用事件 |
| `tool-result` | 工具结果事件 |
| `tool-use-request` | 工具调用请求（需要权限） |
| `control-request` | 控制请求（权限确认） |
| `cli-status` | CLI 状态消息 |
| `stream-event` | 流式事件 |
| `unknown-message` | 未知消息类型 |

## 组件说明

### ChatWindow

主聊天窗口组件，负责：
- 消息列表的渲染和管理
- 用户输入处理
- 与 Electron IPC 通信
- 自动滚动到最新消息
- 粘性头部显示当前问题

### MarkdownRenderer

Markdown 渲染组件，特性：
- 支持代码块语法高亮
- 自动识别语言并高亮
- 支持 GFM（GitHub Flavored Markdown）

### ToolUseMessage

工具调用消息组件，展示：
- 工具名称和参数
- 执行状态（进行中/完成/错误）
- 执行结果
- 支持折叠展开

### PermissionDialog

权限确认对话框，用于：
- 显示工具调用详情
- 用户确认/拒绝操作
- 支持永久允许选项

## 开发说明

### 调试

开发模式下会自动打开 DevTools，可查看：
- Console 日志
- 网络请求
- Vue 组件状态

### 样式测试

点击右上角「测试样式」按钮可进入样式测试页面，查看各组件的视觉效果。

## 注意事项

1. 确保 Claude Code CLI 已正确安装并登录
2. 首次运行时会自动启动 Claude CLI
3. 某些工具操作需要用户确认权限
4. 关闭窗口会终止 Claude CLI 进程

## License

MIT
