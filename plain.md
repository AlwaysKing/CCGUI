# Claude Code GUI 开发阶段规划

> 渐进式开发路线，从 MVP 到完整功能

---

## 开发原则

1. **MVP 优先** - 最快实现可用功能
2. **渐进增强** - 每个阶段都是可用的版本
3. **架构预留** - 为 MCP 等高级功能预留接口
4. **持续交付** - 每个阶段都能测试和演示

---

## 阶段概览

| 阶段 | 目标 | 核心功能 | 预计时间 | 优先级 |
|------|------|----------|----------|--------|
| Phase 0 | 项目初始化 | 基础环境搭建 | 30分钟 | 🔴 必须 |
| Phase 1 | MVP 对话 | 基础对话功能 | 2-3小时 | 🔴 必须 |
| Phase 2 | 工具展示 | 工具调用显示 | 1-2小时 | 🟡 重要 |
| Phase 3 | 工具详情 | 工具执行详情 | 1-2小时 | 🟡 重要 |
| Phase 4 | 文件浏览 | 文件浏览器 | 2小时 | 🟢 可选 |
| Phase 5 | 高级功能 | MCP、会话管理等 | 按需 | ⚪ 未来 |

---

## Phase 0: 项目初始化 (30分钟)

### 目标
搭建基础开发环境，确保项目可以运行

### 任务清单

#### 环境准备
- [x] 创建 Electron + Vue3 项目
- [x] 配置开发环境
- [x] 测试项目启动

#### Claude CLI 准备
- [ ] 验证 Claude CLI 可用性
- [ ] 测试基础启动命令
- [ ] 创建版本检测工具函数

#### 项目结构
- [ ] 创建目录结构
- [ ] 配置 ESLint/Prettier（可选）
- [ ] 设置 Git 忽略文件

### 可交付成果
- ✅ 能启动的 Electron 应用
- ✅ 验证 Claude CLI 可用
- ✅ 基础项目结构

### 验收标准
```bash
# 1. 启动应用
npm run dev

# 2. 验证 Claude CLI
~/Library/Developer/Xcode/CodingAssistant/Agents/Versions/*/claude --help

# 3. 显示基础界面
# 显示 "Claude Code GUI" 标题
```

---

## Phase 1: MVP 对话功能 (2-3小时) ⭐ 核心阶段

### 目标
实现最简单的对话功能：发送消息 → 接收回复 → 显示

### 核心功能
1. **基础通信** - Electron 与 Claude CLI 的 stream-json 通信
2. **简单界面** - 只有一个聊天窗口
3. **消息显示** - 用户消息 + Claude 回复

### 架构设计

```
┌─────────────────────────────────────┐
│         Claude GUI 窗口             │
├─────────────────────────────────────┤
│                                     │
│  ┌───────────────────────────────┐ │
│  │                               │ │
│  │      消息显示区域             │ │
│  │    (滚动列表)                 │ │
│  │                               │ │
│  │  User: 帮我创建一个文件       │ │
│  │  Claude: 好的，我来帮你...    │ │
│  │                               │ │
│  └───────────────────────────────┘ │
│                                     │
│  ┌───────────────────────────────┐ │
│  │ [输入框]              [发送]  │ │
│  └───────────────────────────────┘ │
│                                     │
└─────────────────────────────────────┘
```

### 任务清单

#### 后端 (Electron Main)

**1.1 Claude CLI 管理器**
```javascript
// electron/claude-manager.js
class ClaudeManager {
  constructor() {
    this.process = null
    this.messageHandlers = new Map()
  }

  // 启动 Claude CLI
  async start() {
    const claudePath = detectClaudePath()
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--input-format', 'stream-json',
      '--verbose',
      '--settings', JSON.stringify({
        env: {
          CLAUDE_CODE_ENABLE_TELEMETRY: '0',
          DISABLE_TELEMETRY: '1'
        },
        hasCompletedOnboarding: true
      }),
      '--allowedTools', 'Bash,Read,Edit,Write,Glob,Grep'
    ]

    this.process = spawn(claudePath, args, {
      cwd: process.cwd()
    })

    this.setupStdioHandlers()
  }

  // 设置 stdio 处理
  setupStdioHandlers() {
    let buffer = ''

    this.process.stdout.on('data', (data) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() // 保留不完整的行

      lines.forEach(line => {
        if (line.trim()) {
          try {
            const message = JSON.parse(line)
            this.handleMessage(message)
          } catch (error) {
            console.error('JSON parse error:', error)
          }
        }
      })
    })

    this.process.stderr.on('data', (data) => {
      console.error('Claude CLI error:', data.toString())
    })

    this.process.on('exit', (code) => {
      console.log('Claude CLI exited:', code)
    })
  }

  // 处理消息
  handleMessage(message) {
    const handlers = this.messageHandlers.get(message.type) || []
    handlers.forEach(handler => handler(message))
  }

  // 发送消息
  sendMessage(message) {
    if (this.process && this.process.stdin.writable) {
      this.process.stdin.write(JSON.stringify(message) + '\n')
    }
  }

  // 注册消息处理器
  on(messageType, handler) {
    if (!this.messageHandlers.has(messageType)) {
      this.messageHandlers.set(messageType, [])
    }
    this.messageHandlers.get(messageType).push(handler)
  }
}

module.exports = { ClaudeManager }
```

**1.2 IPC 通信设置**
```javascript
// electron/main.cjs
const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const { ClaudeManager } = require('./claude-manager')

let mainWindow
let claudeManager

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })

  mainWindow.loadFile('index.html')

  // 初始化 Claude Manager
  claudeManager = new ClaudeManager()
  claudeManager.start()

  // 注册消息处理器
  claudeManager.on('assistant', (message) => {
    mainWindow.webContents.send('claude-message', message)
  })

  claudeManager.on('result', (message) => {
    mainWindow.webContents.send('claude-result', message)
  })

  claudeManager.on('system', (message) => {
    if (message.subtype === 'init') {
      mainWindow.webContents.send('claude-init', message)
    }
  })
}

// IPC 处理器
ipcMain.handle('send-message', async (event, userMessage) => {
  claudeManager.sendMessage(userMessage)
})

ipcMain.handle('get-claude-info', async () => {
  return {
    version: '1.0.0',
    tools: ['Bash', 'Read', 'Edit', 'Write', 'Glob', 'Grep']
  }
})

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})
```

**1.3 Preload 脚本**
```javascript
// electron/preload.js
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  sendMessage: (message) => ipcRenderer.invoke('send-message', message),
  onClaudeMessage: (callback) => {
    ipcRenderer.on('claude-message', (event, message) => callback(message))
  },
  onClaudeResult: (callback) => {
    ipcRenderer.on('claude-result', (event, message) => callback(message))
  },
  onClaudeInit: (callback) => {
    ipcRenderer.on('claude-init', (event, message) => callback(message))
  },
  getClaudeInfo: () => ipcRenderer.invoke('get-claude-info')
})
```

#### 前端 (Vue3)

**1.4 主界面组件**
```vue
<!-- src/App.vue -->
<script setup>
import { ref, onMounted, nextTick } from 'vue'
import ChatWindow from './components/ChatWindow.vue'

const isClaudeReady = ref(false)

onMounted(async () => {
  // 等待 Claude 初始化
  window.electronAPI.onClaudeInit((message) => {
    isClaudeReady.value = true
    console.log('Claude initialized:', message)
  })
})
</script>

<template>
  <div class="app-container">
    <header class="app-header">
      <h1>Claude Code GUI</h1>
      <div class="status" :class="{ ready: isClaudeReady }">
        {{ isClaudeReady ? '● 已连接' : '○ 连接中...' }}
      </div>
    </header>
    <main class="app-main">
      <ChatWindow v-if="isClaudeReady" />
      <div v-else class="loading">
        <p>正在连接 Claude...</p>
      </div>
    </main>
  </div>
</template>

<style scoped>
.app-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #1E1E1E;
  color: #E4E4E7;
}

.app-header {
  padding: 16px 24px;
  border-bottom: 1px solid #3F3F46;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.app-header h1 {
  margin: 0;
  font-size: 20px;
  color: #F97316;
}

.status {
  font-size: 14px;
  color: #6B7280;
}

.status.ready {
  color: #10B981;
}

.app-main {
  flex: 1;
  overflow: hidden;
}

.loading {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6B7280;
}
</style>
```

**1.5 聊天窗口组件**
```vue
<!-- src/components/ChatWindow.vue -->
<script setup>
import { ref, onMounted } from 'vue'

const messages = ref([])
const inputMessage = ref('')
const isProcessing = ref(false)
const messagesContainer = ref(null)

onMounted(() => {
  // 监听 Claude 消息
  window.electronAPI.onClaudeMessage((message) => {
    if (message.message && message.message.content) {
      const textContent = message.message.content.find(c => c.type === 'text')
      if (textContent) {
        messages.value.push({
          role: 'assistant',
          content: textContent.text,
          timestamp: new Date()
        })
      }
    }
  })

  // 监听最终结果
  window.electronAPI.onClaudeResult((message) => {
    isProcessing.value = false
    scrollToBottom()
  })
})

async function sendMessage() {
  if (!inputMessage.value.trim() || isProcessing.value) return

  const userText = inputMessage.value
  messages.value.push({
    role: 'user',
    content: userText,
    timestamp: new Date()
  })

  inputMessage.value = ''
  isProcessing.value = true
  scrollToBottom()

  // 发送到 Claude
  await window.electronAPI.sendMessage({
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: userText }]
    }
  })
}

function scrollToBottom() {
  setTimeout(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  }, 100)
}
</script>

<template>
  <div class="chat-window">
    <div class="messages" ref="messagesContainer">
      <div
        v-for="(message, index) in messages"
        :key="index"
        class="message"
        :class="message.role"
      >
        <div class="message-avatar">
          {{ message.role === 'user' ? 'U' : 'C' }}
        </div>
        <div class="message-content">
          <div class="message-text">{{ message.content }}</div>
          <div class="message-time">
            {{ new Date(message.timestamp).toLocaleTimeString() }}
          </div>
        </div>
      </div>
      <div v-if="isProcessing" class="message assistant typing">
        <div class="message-avatar">C</div>
        <div class="message-content">
          <div class="typing-indicator">正在思考...</div>
        </div>
      </div>
    </div>
    <div class="input-area">
      <textarea
        v-model="inputMessage"
        @keydown.enter.prevent="sendMessage"
        placeholder="输入消息... (Enter 发送)"
        rows="3"
        :disabled="isProcessing"
      />
      <button
        @click="sendMessage"
        :disabled="!inputMessage.trim() || isProcessing"
        class="send-button"
      >
        发送
      </button>
    </div>
  </div>
</template>

<style scoped>
.chat-window {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.messages {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.message {
  display: flex;
  margin-bottom: 16px;
  gap: 12px;
}

.message.user {
  flex-direction: row-reverse;
}

.message-avatar {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  flex-shrink: 0;
}

.message.user .message-avatar {
  background: #3F3F46;
}

.message.assistant .message-avatar {
  background: #F97316;
}

.message-content {
  max-width: 70%;
}

.message-text {
  padding: 12px 16px;
  border-radius: 12px;
  line-height: 1.5;
  white-space: pre-wrap;
}

.message.user .message-text {
  background: #3F3F46;
}

.message.assistant .message-text {
  background: #27272A;
  border: 1px solid #3F3F46;
}

.message-time {
  font-size: 12px;
  color: #6B7280;
  margin-top: 4px;
}

.message.user .message-time {
  text-align: right;
}

.typing-indicator {
  color: #6B7280;
  font-style: italic;
}

.input-area {
  padding: 20px;
  border-top: 1px solid #3F3F46;
  display: flex;
  gap: 12px;
}

.input-area textarea {
  flex: 1;
  background: #27272A;
  border: 1px solid #3F3F46;
  border-radius: 8px;
  padding: 12px;
  color: #E4E4E7;
  font-size: 14px;
  resize: none;
  font-family: inherit;
}

.input-area textarea:focus {
  outline: none;
  border-color: #F97316;
}

.input-area textarea:disabled {
  opacity: 0.5;
}

.send-button {
  padding: 12px 24px;
  background: #F97316;
  border: none;
  border-radius: 8px;
  color: white;
  font-weight: bold;
  cursor: pointer;
  align-self: flex-end;
}

.send-button:hover:not(:disabled) {
  background: #EA580C;
}

.send-button:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
```

### 可交付成果
- ✅ 能启动 Claude CLI
- ✅ 能发送消息
- ✅ 能接收文本回复
- ✅ 基础聊天界面

### 验收标准
```bash
# 1. 启动应用
npm run dev

# 2. 测试对话
输入: "你好"
输出: "你好！有什么可以帮助你的吗？"

# 3. 测试工具调用
输入: "列出当前目录的文件"
输出: 显示文件列表（作为文本）
```

### 保留扩展点
```javascript
// 1. 消息结构支持扩展
{
  role: 'assistant',
  content: [
    { type: 'text', text: '...' },
    // 预留：工具调用
    // { type: 'tool_use', ... }
  ]
}

// 2. ClaudeManager 支持 MCP 配置
class ClaudeManager {
  constructor(mcpConfig = null) {
    this.mcpConfig = mcpConfig // 预留
  }

  // 预留：添加 MCP 工具
  addMCPTools(tools) { ... }
}

// 3. IPC 预留高级功能
ipcMain.handle('configure-mcp', ...)
ipcMain.handle('manage-session', ...)
```

---

## Phase 2: 工具调用展示 (1-2小时)

### 目标
识别并显示 Claude 的工具调用，即使不展示详细信息

### 核心功能
1. **工具识别** - 解析 tool_use 类型的内容
2. **简化展示** - 显示工具名称和状态
3. **状态跟踪** - 运行中/成功/失败

### 界面改进

```
┌─────────────────────────────────────┐
│  User: 帮我创建一个 test.txt 文件   │
│                                     │
│  Claude: 好的，我来帮你创建文件      │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ 🔧 Bash - 运行中...          │   │  ← 新增
│  └─────────────────────────────┘   │
│                                     │
│  ┌─────────────────────────────┐   │
│  │ ✅ Bash - 完成               │   │
│  └─────────────────────────────┘   │
│                                     │
│  Claude: 文件创建成功！            │
└─────────────────────────────────────┘
```

### 任务清单

- [ ] 修改消息解析逻辑，识别 tool_use 类型
- [ ] 创建 ToolUseIndicator 组件
- [ ] 添加工具状态跟踪（running/success/error）
- [ ] 匹配 tool_use 和 tool_result

### 可交付成果
- ✅ 显示工具调用状态
- ✅ 区分文本回复和工具调用
- ✅ 基础的状态指示器

---

## Phase 3: 工具执行详情 (1-2小时)

### 目标
展示工具调用的详细信息

### 核心功能
1. **工具输入** - 显示命令或参数
2. **工具输出** - 显示执行结果
3. **可展开** - 点击查看详情

### 界面改进

```
┌─────────────────────────────────────┐
│  ✅ Bash                            │
│  ─────────────────────────────────  │
│  💻 命令:                           │
│  echo "Hello World" > test.txt      │
│                                     │
│  📤 输出:                           │
│  (命令执行成功，无输出)             │
│                                     │
│  [收起]                             │
└─────────────────────────────────────┘
```

### 任务清单

- [ ] 创建 ToolUseCard 组件
- [ ] 显示工具输入参数
- [ ] 显示工具执行结果
- [ ] 添加展开/收起动画
- [ ] 美化代码显示

### 可交付成果
- ✅ 完整的工具调用卡片
- ✅ 可查看命令和输出
- ✅ 支持代码复制

---

## Phase 4: 文件浏览器 (2小时)

### 目标
添加项目文件浏览功能

### 核心功能
1. **文件树** - 显示项目结构
2. **文件查看** - 点击查看文件内容
3. **与工具联动** - Read/Edit 工具结果显示

### 界面布局

```
┌──────────────┬──────────────────────┐
│              │                      │
│  文件树      │    聊天区域          │
│              │                      │
│ 📁 src/      │  User: 读取文件      │
│   📄 a.js    │                      │
│   📄 b.js    │  ✅ Read             │
│ 📁 dist/     │  📄 文件内容...      │
│ 📄 pkg.json  │                      │
│              │                      │
└──────────────┴──────────────────────┘
```

### 任务清单

- [ ] 创建 FileBrowser 组件
- [ ] 实现文件树数据结构
- [ ] 添加文件展开/折叠
- [ ] 集成 Read 工具结果
- [ ] 优化布局

---

## Phase 5: 高级功能 (按需开发)

### 5.1 MCP 支持
- MCP 配置界面
- 自定义工具注册
- MCP 服务器管理

### 5.2 会话管理
- 会话历史保存
- 会话搜索
- 导出/导入

### 5.3 设置配置
- Claude 路径配置
- 工具白名单配置
- 界面主题设置

### 5.4 高级功能
- 多会话支持
- 文件编辑集成
- 代码预览增强

---

## 文件结构规划

```
CCGUI/
├── electron/
│   ├── main.cjs                 # 主进程入口
│   ├── preload.js               # Preload 脚本
│   ├── claude-manager.js        # Claude CLI 管理器 ⭐
│   └── mcp-manager.js           # MCP 管理器 (预留)
│
├── src/
│   ├── App.vue                  # 根组件
│   ├── main.js                  # Vue 入口
│   │
│   ├── components/
│   │   ├── ChatWindow.vue       # 聊天窗口 ⭐ Phase 1
│   │   ├── MessageItem.vue      # 消息项 ⭐ Phase 1
│   │   ├── ToolUseIndicator.vue # 工具指示器 Phase 2
│   │   ├── ToolUseCard.vue      # 工具卡片 Phase 3
│   │   ├── FileBrowser.vue      # 文件浏览器 Phase 4
│   │   └── SettingsPanel.vue    # 设置面板 Phase 5
│   │
│   ├── composables/
│   │   ├── useClaude.js         # Claude 通信逻辑 ⭐
│   │   ├── useMessages.js       # 消息状态管理
│   │   └── useFileSystem.js     # 文件系统操作
│   │
│   └── styles/
│       └── main.css             # 全局样式
│
├── package.json
├── vite.config.js
└── README.md
```

**⭐ = Phase 1 必须创建**

---

## 开发建议

### Phase 1 重点关注

1. **先通信后界面**
   - 先确保 Electron 能启动 Claude CLI
   - 确保 stream-json 解析正确
   - 再做前端界面

2. **简化消息处理**
   - Phase 1 只处理 text 类型
   - tool_use 先转换成简单文本显示
   - Phase 2 再完善

3. **错误处理**
   - Claude CLI 启动失败的处理
   - 消息解析失败的处理
   - 网络错误的提示

### 代码复用建议

```javascript
// 创建可复用的工具函数
// src/utils/claude-helpers.js

export function detectClaudePath() {
  // 版本检测逻辑
}

export function parseStreamMessage(line) {
  // 消息解析逻辑
}

export function formatMessage(message) {
  // 消息格式化逻辑
}
```

### 调试技巧

```javascript
// 在 ClaudeManager 中添加日志
class ClaudeManager {
  handleMessage(message) {
    console.log('📨 Claude message:', message.type, message)
    // ...
  }
}

// 在 Vue DevTools 中查看状态
const messages = ref([])
window.__MESSAGES__ = messages // 用于调试
```

---

## 下一步行动

### 立即开始 Phase 0 + Phase 1

```bash
# 1. 创建 claude-manager.js
touch electron/claude-manager.js

# 2. 更新 main.cjs
# 添加 IPC 处理器

# 3. 创建 ChatWindow.vue
touch src/components/ChatWindow.vue

# 4. 测试启动
npm run dev
```

### 关键文件创建顺序

1. `electron/claude-manager.js` - Claude 通信核心
2. `electron/main.cjs` - 更新 IPC 逻辑
3. `electron/preload.js` - 暴露 API
4. `src/components/ChatWindow.vue` - 聊天界面
5. `src/App.vue` - 更新主界面

---

*准备开始 Phase 1 了吗？我可以帮你创建这些文件！*
