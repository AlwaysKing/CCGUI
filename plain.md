# CCGUI 多会话管理功能开发计划

## 功能概述

实现多项目、多会话管理功能，支持：
- 项目管理：切换、新建、删除项目
- 会话管理：创建、删除、切换会话
- 多会话并行：每个会话独立运行 Claude 实例
- 历史加载：从 jsonl 文件恢复会话历史
- 后台运行：会话可在后台持续运行

## 架构设计

### 界面布局

```
┌─────────────────────────────────────────────────────────────┐
│  Header (项目名称 + 全局操作)                                │
├──────────┬──────────┬────────────────────────────────────────┤
│          │          │                                        │
│  项目    │  会话    │           聊天区域                      │
│  导航    │  列表    │                                        │
│          │          │                                        │
│  [+]新建 │  [+]新建  │    消息列表 / 历史记录                  │
│  项目    │  会话    │                                        │
│          │          │                                        │
│  项目1 ● │  会话1 ● │    ───────────────────                 │
│  项目2   │  会话2   │                                        │
│  项目3   │  会话3   │    输入框                              │
│          │          │                                        │
├──────────┴──────────┴────────────────────────────────────────┤
│  StatusBar (当前状态)                                        │
└─────────────────────────────────────────────────────────────┘

图例: ● = 运行中的会话
```

### 后端架构

```
electron/
├── main.cjs                    # 主进程入口 (修改)
├── preload.js                  # 预加载脚本 (修改)
├── claude-manager.js           # 单个 Claude 实例管理 (修改)
├── session-manager.js          # 会话管理器 (新建)
├── project-manager.js          # 项目管理器 (新建)
└── store.js                    # 状态存储 (新建)
```

### 前端架构

```
src/
├── App.vue                     # 根组件 (修改)
├── components/
│   ├── layout/
│   │   ├── AppLayout.vue       # 三栏布局 (新建)
│   │   ├── ProjectSidebar.vue  # 项目导航 (新建)
│   │   ├── SessionSidebar.vue  # 会话列表 (新建)
│   │   └── Header.vue          # 顶部栏 (新建)
│   ├── chat/
│   │   ├── ChatWindow.vue      # 聊天窗口 (修改)
│   │   ├── MessageList.vue     # 消息列表 (新建)
│   │   └── InputBox.vue        # 输入框 (新建)
│   └── dialogs/
│       ├── NewProjectDialog.vue    # 新建项目对话框 (新建)
│       ├── NewSessionDialog.vue    # 新建会话对话框 (新建)
│       └── ConfirmDialog.vue       # 确认对话框 (新建)
└── stores/
    └── useAppStore.js          # Pinia 状态管理 (新建)
```

## 开发阶段

### 阶段 1: 后端基础设施 (Day 1)

#### 1.1 创建 store.js - 持久化存储
- [ ] 项目列表存储
- [ ] 当前项目/会话状态
- [ ] 窗口布局配置

#### 1.2 创建 project-manager.js - 项目管理
- [ ] 扫描 ~/.claude/projects/ 获取项目列表
- [ ] 从项目路径提取项目名称
- [ ] 新建项目（选择目录）
- [ ] 删除项目（仅从列表移除，不删除数据）

#### 1.3 创建 session-manager.js - 会话管理
- [ ] 获取项目下的所有会话
- [ ] 解析 jsonl 文件提取会话元数据
- [ ] 解析 jsonl 加载历史消息
- [ ] 创建新会话（生成 UUID）
- [ ] 删除会话（删除 jsonl 文件）

#### 1.4 修改 claude-manager.js
- [ ] 支持 --resume 参数启动
- [ ] 支持指定会话 ID
- [ ] 添加实例 ID 标识
- [ ] 添加运行状态

### 阶段 2: 多实例管理 (Day 2)

#### 2.1 创建会话实例池
- [ ] 管理多个 ClaudeManager 实例
- [ ] 按需启动/停止实例
- [ ] 实例状态追踪（idle/running/error）

#### 2.2 IPC 接口扩展
- [ ] `get-projects` - 获取项目列表
- [ ] `get-sessions` - 获取会话列表
- [ ] `create-session` - 创建新会话
- [ ] `delete-session` - 删除会话
- [ ] `switch-session` - 切换会话
- [ ] `get-session-history` - 获取历史消息
- [ ] `get-session-status` - 获取会话状态

#### 2.3 消息路由
- [ ] 按会话 ID 路由消息到正确的前端
- [ ] 广播状态更新到所有渲染进程

### 阶段 3: 前端布局重构 (Day 3)

#### 3.1 三栏布局
- [ ] AppLayout.vue - 响应式三栏布局
- [ ] 左侧项目导航栏 (可折叠)
- [ ] 中间会话列表栏 (可折叠)
- [ ] 右侧聊天区域

#### 3.2 项目导航组件
- [ ] 项目列表展示
- [ ] 当前项目高亮
- [ ] 新建项目按钮
- [ ] 项目右键菜单（删除/重命名）

#### 3.3 会话列表组件
- [ ] 会话列表展示
- [ ] 运行状态标识 (绿色圆点)
- [ ] 会话预览（第一条消息）
- [ ] 最后活跃时间
- [ ] 新建会话按钮
- [ ] 会话右键菜单（删除/重命名）

### 阶段 4: 聊天功能适配 (Day 4)

#### 4.1 消息历史加载
- [ ] 从 jsonl 解析历史消息
- [ ] 渲染历史消息到界面
- [ ] 滚动到最新位置

#### 4.2 ChatWindow 适配
- [ ] 接收会话 ID 作为 prop
- [ ] 订阅对应会话的消息事件
- [ ] 发送消息时指定会话 ID

#### 4.3 多标签/多窗口支持
- [ ] 同时显示多个会话（标签页或分屏）
- [ ] 后台会话消息通知
- [ ] 切换会话保持状态

### 阶段 5: 状态管理与优化 (Day 5)

#### 5.1 Pinia 状态管理
- [ ] 项目列表状态
- [ ] 会话列表状态
- [ ] 当前活跃会话
- [ ] 运行中会话集合

#### 5.2 状态持久化
- [ ] 保存窗口布局
- [ ] 保存最后打开的会话
- [ ] 启动时恢复状态

#### 5.3 用户体验优化
- [ ] 加载状态指示
- [ ] 错误处理与提示
- [ ] 快捷键支持
- [ ] 拖拽调整栏宽

## 数据结构定义

### 项目 (Project)

```javascript
{
  id: string,           // 项目 ID (路径 hash)
  name: string,         // 项目名称
  path: string,         // 项目路径
  claudePath: string,   // ~/.claude/projects/ 下的目录名
  sessionCount: number, // 会话数量
  lastActiveAt: Date    // 最后活跃时间
}
```

### 会话 (Session)

```javascript
{
  id: string,           // 会话 ID (UUID)
  projectId: string,    // 所属项目 ID
  name: string,         // 会话名称 (可编辑)
  preview: string,      // 预览文本 (第一条消息)
  createdAt: Date,      // 创建时间
  updatedAt: Date,      // 更新时间
  messageCount: number, // 消息数量
  status: 'idle' | 'running' | 'error'  // 运行状态
}
```

### 会话实例 (SessionInstance)

```javascript
{
  sessionId: string,
  manager: ClaudeManager,  // Claude 实例
  status: 'idle' | 'running' | 'error',
  lastActivity: Date,
  error: string | null
}
```

## IPC 接口规范

### 渲染进程 -> 主进程

| 通道 | 参数 | 返回值 | 说明 |
|------|------|--------|------|
| `get-projects` | - | `Project[]` | 获取项目列表 |
| `add-project` | `{ path: string }` | `Project` | 添加项目 |
| `remove-project` | `{ projectId: string }` | `{ success: boolean }` | 移除项目 |
| `get-sessions` | `{ projectId: string }` | `Session[]` | 获取会话列表 |
| `create-session` | `{ projectId: string, name?: string }` | `Session` | 创建会话 |
| `delete-session` | `{ sessionId: string }` | `{ success: boolean }` | 删除会话 |
| `open-session` | `{ sessionId: string }` | `Session` | 打开/切换会话 |
| `close-session` | `{ sessionId: string }` | `{ success: boolean }` | 关闭会话 |
| `get-session-history` | `{ sessionId: string }` | `Message[]` | 获取历史 |
| `send-message` | `{ sessionId: string, content: string }` | `{ success: boolean }` | 发送消息 |

### 主进程 -> 渲染进程

| 通道 | 数据 | 说明 |
|------|------|------|
| `session-status-changed` | `{ sessionId, status }` | 会话状态变化 |
| `session-message` | `{ sessionId, message }` | 会话消息 |
| `session-result` | `{ sessionId, result }` | 会话结果 |
| `session-stream-event` | `{ sessionId, event }` | 流式事件 |
| `session-control-request` | `{ sessionId, request }` | 权限请求 |
| `sessions-updated` | `Session[]` | 会话列表更新 |

## 实施顺序

1. **阶段 1.3 + 1.4**: session-manager.js + claude-manager.js 修改
2. **阶段 1.1 + 1.2**: store.js + project-manager.js
3. **阶段 2**: 多实例管理与 IPC 扩展
4. **阶段 3**: 前端布局重构
5. **阶段 4**: 聊天功能适配
6. **阶段 5**: 状态管理与优化

---

## 当前任务

### ✅ 后端核心功能已完成

- session-manager.js - 会话管理器
- project-manager.js - 项目管理器
- store.js - 持久化存储
- main.cjs - 主进程（集成多会话支持）
- preload.js - 新 IPC 接口

- claude-manager.js - 支持 --resume 参数

### ✅ 塑前端已完成
- useAppStore.js - Pinia 状态管理
- AppLayout.vue - 三栏布局
- ProjectSidebar.vue - 项目导航
- SessionSidebar.vue - 会话列表
- Header.vue - 顶部栏
- NewProjectDialog.vue - 新建项目对话框
- NewSessionDialog.vue - 新建会话对话框
- ConfirmDialog.vue - 确认对话框
- RenameDialog.vue - 重命名对话框
- ChatWindow.vue - 适配多会话（保持兼容)
- App.vue - 支持多会话/单会话模式切换
- main.js - 集成 Pinia

- 全局样式优化
- 键盘快捷键支持 (Cmd+N 新建会话, Cmd+Shift+N 新建项目, Cmd+B 切换侧边栏, Cmd+1 切换项目侧边栏, Cmd+2 切换会话侧边栏)
    - 侧边栏状态持久化 (localStorage)
    - 加载状态指示
    - 错误处理
    - 右键菜单（重命名/删除)
    - 拖拽调整栏宽

    - 侧边栏折叠/展开按钮

### ✅ 下一步

1. 后端 IPC 接口完善：`rename-project`, `rename-session`, `select-directory`
2. 运行应用测试多会会功能
