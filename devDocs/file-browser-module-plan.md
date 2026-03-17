# 文件浏览与预览模块设计方案

## 背景

当前工作区布局为：

- 左侧 `SessionSidebar`
- 右侧 `Chat`

目标是在不破坏现有会话体验的前提下，补充一个接近编辑器的文件浏览能力，形成如下结构：

```text
SessionSidebar(含文件树 + Session 列表) | File Preview Tabs/Editor | Chat
```

## 现状调研

### 前端结构

- `src/views/workspace/Workspace.vue`
  - 控制左侧 sidebar 与右侧主区域布局
  - 当前主区域只有 `Chat`
- `src/views/workspace/components/SessionSidebar.vue`
  - 已有三段 header + session 列表
  - 适合扩展为“文件树 + session 列表”的复合侧栏
- `src/views/workspace/chat/Chat.vue`
  - 当前占据右侧全部区域
  - 适合放入新的三栏布局右侧，保持消息区逻辑不变

### 技术栈

- Electron + Vue 3 + Pinia
- 已有 `highlight.js`，可用于代码高亮
- 当前没有 Monaco/CodeMirror 等编辑器依赖
- 网络安装依赖不应作为本次实现前提，因此优先采用现有依赖完成第一版

### 后端能力

- `electron/main.cjs` 中集中注册 `ipcMain.handle(...)`
- `electron/preload.js` 统一暴露 `window.electronAPI`
- 当前缺少项目文件树扫描、文件读取、文件写入 IPC

## 功能目标

### 1. 左侧侧栏增强

- 在 session 新建按钮前增加“文件面板开关”按钮
- 侧栏主体拆成上下两部分：
  - 上方：文件树
  - 下方：session 列表
- 文件树支持：
  - 基于当前项目根目录扫描
  - 层级展开/折叠
  - 文件夹 / 文件类型图标
  - 单击切换预览
  - 双击固定打开为 tab

### 2. 中间文件预览区

- 在 `SessionSidebar` 和 `Chat` 之间插入 `FilePreviewPanel`
- 支持：
  - 多 tab
  - 激活 / 关闭
  - 显示未保存状态
  - 空状态提示

### 3. 文件内容能力

- 支持常见文本文件读取、编辑、保存
- 重点照顾：
  - `js`, `ts`, `vue`, `json`, `toml`, `yaml`, `yml`, `md`, `css`, `html`, `cjs`
- 基础渲染策略：
  - 文本编辑区
  - 行号
  - 基于 `highlight.js` 的只读高亮层
  - 编辑时保持可输入；保存后内容继续高亮展示
- 非文本或过大文件：
  - 不强行渲染
  - 给出“暂不支持预览”的降级提示

## 设计原则

### 1. 不引入高风险重依赖

第一版不依赖 Monaco/CodeMirror，避免：

- 安装和打包风险
- Electron 集成复杂度上升
- 大幅增加首屏体积

后续如果第一版验证通过，可独立升级到专业编辑器。

### 2. 明确“单击预览、双击固定”

行为参考 VS Code，但做一版适合本项目的简化规则：

- 单击文件：
  - 若已有预览 tab，则复用该 tab
  - 若已有固定 tab 且当前文件已打开，则只切换激活
- 双击文件：
  - 将当前文件以固定 tab 打开
  - 若当前是预览 tab，则转为固定

### 3. 文件树性能保守优化

第一版优先保证稳定：

- 初始仅加载项目根目录
- 目录展开时按需递归读取子目录
- 默认过滤常见大目录：
  - `.git`
  - `node_modules`
  - `.DS_Store`
  - `.idea`
  - `.vscode`
  - `dist`
  - `build`
  - `output`

## 数据结构设计

## 前端状态

新增独立 store：`useFileBrowserStore`

核心状态建议：

```js
projectPath
isFilePanelVisible
tree
expandedDirs
loadingDirs
activeFilePath
tabs
previewTabId
```

其中 `tabs` 结构：

```js
{
  id,
  path,
  name,
  language,
  content,
  savedContent,
  isDirty,
  pinned,
  loading,
  error
}
```

## IPC 设计

新增 API：

- `list-project-files({ projectPath, relativePath })`
  - 列出指定目录下的直接子项
- `read-project-file({ projectPath, filePath })`
  - 读取文本文件
- `write-project-file({ projectPath, filePath, content })`
  - 保存文本文件

约束：

- 所有文件操作都必须校验目标路径位于项目根目录内
- 仅允许文本文件读写
- 超过体积阈值的文件拒绝预览

## 组件拆分

### 1. Sidebar 内新增

- `src/views/workspace/components/FileTreePanel.vue`
- `src/views/workspace/components/FileTreeNode.vue`

职责：

- 文件树展示
- 展开/折叠
- 单击 / 双击交互

### 2. 主区域新增

- `src/views/workspace/components/FilePreviewPanel.vue`
- `src/views/workspace/components/FileEditorTab.vue`
- `src/views/workspace/components/CodeEditor.vue`

职责：

- Tab 管理 UI
- 文本编辑与高亮渲染
- 保存快捷操作

## 布局改造方案

### Workspace

保持最外层：

```text
SessionSidebar | resize-handle | main-content
```

其中 `main-content` 改成：

```text
FilePreviewPanel(可隐藏) | Chat
```

收益：

- 不破坏原侧栏 resize 逻辑
- 中间预览区可以独立控制宽度或固定宽度
- 聊天区内部逻辑改动更小

### Sidebar

侧栏原本以 session 为主，改为：

- Header row2 增加文件开关按钮
- 主体拆为：
  - `file-tree-section`
  - `session-list-section`

## 编辑器实现策略

由于当前未引入专业编辑器，第一版采取“轻量编辑器”：

- 左侧行号列
- 主体使用 `textarea`
- 背景层使用高亮后的 `pre > code`
- 二者同步滚动

这样可以同时满足：

- 可编辑
- 可保存
- 有基础代码渲染效果

已知限制：

- 语义编辑体验不如 Monaco
- 大文件性能有限
- 不做复杂快捷键和多光标

这些限制对于第一版是可接受的。

## 实施步骤

### 阶段 1. 基础能力

- 新增文件浏览 store
- 新增 Electron 文件树 / 文件读写 IPC
- 增加项目路径安全校验

### 阶段 2. 左侧文件树

- 侧栏拆分为文件树 + session 列表
- 增加文件面板开关
- 实现图标、展开、单击、双击

### 阶段 3. 中间预览区

- 插入 `FilePreviewPanel`
- 实现 tab、关闭、切换、预览 tab 复用

### 阶段 4. 编辑保存

- 实现轻量代码编辑器
- 支持保存、脏状态提示
- 支持 `Cmd/Ctrl + S`

### 阶段 5. 联调与样式收尾

- 验证 session 切换不影响文件 tab
- 验证项目切换时刷新文件树并关闭旧 tab
- 验证空状态、错误态、超大文件降级提示

## 风险与处理

### 1. 文件树过大

处理：

- 按需展开加载
- 默认过滤常见大目录

### 2. 非文本文件误读

处理：

- 后端检测二进制特征
- 返回不可预览状态

### 3. 编辑器体验一般

处理：

- 第一版先保障稳定、可用、可保存
- 后续如需要再升级 Monaco/CodeMirror

## 交付范围

本次直接实现第一版可用能力：

- 文件树
- 双态打开逻辑（预览 / 固定）
- 中间预览区
- 多 tab
- 基础代码高亮
- 文本编辑与保存
- 常见文件类型图标
- 超大/二进制文件降级处理

不纳入本次：

- 全文搜索
- 文件重命名 / 新建 / 删除
- 拖拽排序
- 专业 IDE 级编辑能力
