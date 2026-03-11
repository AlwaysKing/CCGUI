# CCGUI 重构计划

## 概述

本次重构的主要目标是：
1. 建立统一的主题/样式规范系统
2. 对大型组件文件进行模块化拆分
3. 封装通用组件，减少代码重复

## 一、样式系统重构

### 1.1 创建 CSS 变量文件

**文件**: `src/styles/variables.css`

将所有硬编码的颜色值、间距、圆角等提取为 CSS 变量，便于：
- 统一管理
- 方便修改
- 支持未来主题切换

### 1.2 更新全局样式

**文件**: `src/styles/global.css`

引入变量文件，并更新全局样式使用新的变量。

### 1.3 创建通用样式类

**文件**: `src/styles/utilities.css`

提供常用的工具类：
- 文字颜色类
- 背景色类
- 间距类
- 布局类

---

## 二、通用组件封装

### 2.1 基础 UI 组件

创建 `src/components/common/` 目录，包含以下组件：

| 组件名 | 文件 | 说明 |
|--------|------|------|
| BaseButton | `BaseButton.vue` | 统一按钮组件，支持多种变体 |
| BaseInput | `BaseInput.vue` | 统一输入框组件 |
| BaseDialog | `BaseDialog.vue` | 统一对话框基础组件 |
| BaseCard | `BaseCard.vue` | 统一卡片组件 |
| IconButton | `IconButton.vue` | 图标按钮组件 |
| Badge | `Badge.vue` | 徽章/标签组件 |
| EmptyState | `EmptyState.vue` | 空状态提示组件 |

### 2.2 表单组件

| 组件名 | 文件 | 说明 |
|--------|------|------|
| FormField | `FormField.vue` | 表单字段包装器 |
| Toggle | `Toggle.vue` | 开关组件 |

---

## 三、大文件拆分计划

### 3.1 ChatWindow.vue 拆分

**当前行数**: 5,284 行
**目标**: 拆分为 ~500 行以内的多个组件

#### 拆分结构

```
src/components/chat/
├── ChatWindow.vue          # 主容器组件 (~300行)
├── MessageList.vue         # 消息列表组件
├── MessageItem.vue         # 单条消息组件
├── UserMessage.vue         # 用户消息组件
├── AssistantMessage.vue    # 助手消息组件
├── EnvInfoBar.vue          # 环境信息栏
├── ChatInput.vue           # 输入区域组件
├── PermissionHandler.vue   # 权限处理组件
├── StickyHeader.vue        # 粘性头部组件
├── HistoryPicker.vue       # 历史记录选择器
├── ActionMenu.vue          # 消息操作菜单
├── RewindDialog.vue        # 还原确认对话框
└── composables/
    ├── useMessage.js       # 消息相关逻辑
    ├── useScroll.js        # 滚动相关逻辑
    └── useHistory.js       # 历史记录逻辑
```

#### 拆分步骤

1. **提取 ChatInput 组件**
   - 输入框
   - 发送按钮
   - 拖放处理
   - 历史记录导航

2. **提取 EnvInfoBar 组件**
   - 环境信息显示
   - PID 状态
   - MCP 服务器状态
   - 权限模式选择

3. **提取 MessageList 组件**
   - 消息列表渲染
   - 滚动处理
   - 粘性头部

4. **提取 MessageItem 组件**
   - 单条消息渲染
   - 消息操作菜单
   - 折叠/展开逻辑

5. **提取 composables**
   - useMessage: 消息格式化、复制等
   - useScroll: 滚动到底部、粘性消息
   - useHistory: 输入历史记录

### 3.2 SettingsDialog.vue 拆分

**当前行数**: 3,373 行
**目标**: 拆分为 ~400 行以内的多个组件

#### 拆分结构

```
src/components/settings/
├── SettingsDialog.vue      # 主容器组件 (~200行)
├── SettingsNav.vue         # 左侧导航
├── ModelSection.vue        # 模型配置区域
├── PromptSection.vue       # 提示词配置区域
├── SoftwareSection.vue     # 软件配置区域
├── ModelCard.vue           # 模型卡片
├── ModelFormDialog.vue     # 模型编辑对话框
├── PromptFormDialog.vue    # 提示词编辑对话框
├── DocumentFormDialog.vue  # 规范文档编辑对话框
├── DefaultConfigCard.vue   # Claude 默认配置卡片
├── DefaultConfigDialog.vue # 默认配置编辑对话框
└── composables/
    └── useSettings.js      # 设置相关逻辑
```

#### 拆分步骤

1. **提取 SettingsNav 组件**
   - 左侧导航列表
   - 滚动同步

2. **提取 ModelSection 组件**
   - 模型列表
   - 模型卡片
   - 添加/编辑/删除操作

3. **提取 PromptSection 组件**
   - 提示词列表
   - 规范文档列表

4. **提取 SoftwareSection 组件**
   - 主题设置
   - 语言设置
   - Bark 通知设置

5. **提取表单对话框组件**
   - ModelFormDialog
   - PromptFormDialog
   - DocumentFormDialog
   - DefaultConfigDialog

### 3.3 ToolUseMessage.vue 拆分

**当前行数**: 1,733 行
**目标**: 拆分为 ~300 行以内的多个组件

#### 拆分结构

```
src/components/tools/
├── ToolUseMessage.vue      # 主容器组件 (~200行)
├── ToolHeader.vue          # 工具头部（图标、名称、状态）
├── EditToolDisplay.vue     # Edit 工具展示
├── WriteToolDisplay.vue    # Write 工具展示
├── BashToolDisplay.vue     # Bash 工具展示
├── ReadToolDisplay.vue     # Read 工具展示
├── GrepToolDisplay.vue     # Grep 工具展示
├── AgentToolDisplay.vue    # Agent 工具展示
├── WebSearchDisplay.vue    # WebSearch 工具展示
├── TodoWriteDisplay.vue    # TodoWrite 工具展示
├── GenericToolDisplay.vue  # 通用工具展示
├── ToolResultDisplay.vue   # 工具结果展示
├── DiffViewer.vue          # Diff 对比视图
└── composables/
    └── useToolDisplay.js   # 工具展示相关逻辑
```

#### 拆分步骤

1. **提取 ToolHeader 组件**
   - 工具图标
   - 工具名称
   - 执行状态
   - 折叠/展开按钮

2. **按工具类型提取展示组件**
   - 每种工具类型的输入展示
   - 折叠摘要
   - 展开详情

3. **提取 ToolResultDisplay 组件**
   - 结果内容展示
   - 错误状态

4. **提取 DiffViewer 组件**
   - 代码对比视图
   - 行号
   - 增删高亮

---

## 四、实施顺序

### 阶段一：基础设施（预计工作量：小）

1. ✅ 创建 `docs/theme-guide.md` 主题指南
2. 创建 `src/styles/variables.css` CSS 变量
3. 更新 `src/styles/global.css` 引入变量
4. 创建 `src/styles/utilities.css` 工具类

### 阶段二：通用组件（预计工作量：中）

1. 创建 `BaseButton.vue`
2. 创建 `BaseInput.vue`
3. 创建 `BaseDialog.vue`
4. 创建 `IconButton.vue`
5. 创建 `Badge.vue`
6. 创建 `EmptyState.vue`
7. 创建 `FormField.vue`

### 阶段三：ChatWindow 拆分（预计工作量：大）

1. 创建 `src/components/chat/` 目录
2. 提取 `ChatInput.vue`
3. 提取 `EnvInfoBar.vue`
4. 提取 `MessageList.vue`
5. 提取 `MessageItem.vue`
6. 提取 `UserMessage.vue`
7. 提取 `AssistantMessage.vue`
8. 创建 composables
9. 重构主 `ChatWindow.vue`

### 阶段四：SettingsDialog 拆分（预计工作量：中）

1. 创建 `src/components/settings/` 目录
2. 提取 `SettingsNav.vue`
3. 提取 `ModelSection.vue`
4. 提取 `PromptSection.vue`
5. 提取 `SoftwareSection.vue`
6. 提取各种表单对话框
7. 重构主 `SettingsDialog.vue`

### 阶段五：ToolUseMessage 拆分（预计工作量：中）

1. 创建 `src/components/tools/` 目录
2. 提取 `ToolHeader.vue`
3. 按类型提取各种工具展示组件
4. 提取 `ToolResultDisplay.vue`
5. 提取 `DiffViewer.vue`
6. 重构主 `ToolUseMessage.vue`

### 阶段六：收尾工作（预计工作量：小）

1. 更新所有组件使用新的 CSS 变量
2. 更新组件使用通用基础组件
3. 测试所有功能
4. 清理冗余代码

---

## 五、注意事项

1. **保持向后兼容**：拆分后的组件应保持与原有功能完全一致
2. **渐进式重构**：每个阶段完成后应确保应用可正常运行
3. **不修改 Electron 代码**：只重构前端 Vue 代码
4. **不操作 Git**：按照用户要求不进行 git 操作
5. **保留原有样式**：拆分时保持样式不变，使用相同的类名

---

## 六、文件清单

### 新增文件

```
src/styles/
├── variables.css           # CSS 变量定义
└── utilities.css           # 工具类

src/components/common/
├── BaseButton.vue
├── BaseInput.vue
├── BaseDialog.vue
├── BaseCard.vue
├── IconButton.vue
├── Badge.vue
├── EmptyState.vue
├── FormField.vue
└── Toggle.vue

src/components/chat/
├── ChatInput.vue
├── EnvInfoBar.vue
├── MessageList.vue
├── MessageItem.vue
├── UserMessage.vue
├── AssistantMessage.vue
├── StickyHeader.vue
├── HistoryPicker.vue
├── ActionMenu.vue
├── RewindDialog.vue
└── composables/
    ├── useMessage.js
    ├── useScroll.js
    └── useHistory.js

src/components/settings/
├── SettingsNav.vue
├── ModelSection.vue
├── PromptSection.vue
├── SoftwareSection.vue
├── ModelCard.vue
├── ModelFormDialog.vue
├── PromptFormDialog.vue
├── DocumentFormDialog.vue
├── DefaultConfigCard.vue
├── DefaultConfigDialog.vue
└── composables/
    └── useSettings.js

src/components/tools/
├── ToolHeader.vue
├── EditToolDisplay.vue
├── WriteToolDisplay.vue
├── BashToolDisplay.vue
├── ReadToolDisplay.vue
├── GrepToolDisplay.vue
├── AgentToolDisplay.vue
├── WebSearchDisplay.vue
├── TodoWriteDisplay.vue
├── GenericToolDisplay.vue
├── ToolResultDisplay.vue
├── DiffViewer.vue
└── composables/
    └── useToolDisplay.js
```

### 修改文件

```
src/styles/global.css       # 引入 variables.css
src/components/ChatWindow.vue
src/components/dialogs/SettingsDialog.vue
src/components/ToolUseMessage.vue
src/main.js                 # 引入新样式文件
```
