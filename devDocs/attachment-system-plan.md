# CCGUI 附件系统开发方案

**文档版本**: 1.0  
**最后更新**: 2026-03-23  
**状态**: 待实施

---

## 1. 目标

为 CCGUI 建立一套独立于 provider 协议的统一附件系统，覆盖：

- 输入区附件条
- 文本中的附件引用 token
- 临时缓存与历史归档
- Codex / Claude 的协议翻译

设计原则：

1. 前端交互统一，不暴露 provider 差异
2. 历史记录统一保存 CCGUI 自己的语义结构
3. provider 自己决定“嵌入内容”还是“路径/引用”
4. renderer 和 adapter 之间只传“附件事实”，不传 provider 策略

---

## 2. 前端交互

### 2.1 输入区结构

输入区由三部分组成：

1. 附件条
2. 富文本输入区
3. 发送控制区

### 2.2 附件条

附件条展示当前已插入的附件：

- 图片：显示缩略图、名称、大小
- 文件：显示文件图标、名称、大小
- 文件片段：显示文件名与行号范围，例如 `App.vue (20-80)`

每个附件项都必须支持：

- 点击图片可全窗口预览
- 删除按钮
- 悬浮显示完整路径或详情

### 2.3 文本中的附件引用

用户文本中可以引用附件，但前端不能直接显示原始占位符文本。

要求：

- 存储层保留稳定 token
- 展示层渲染成不可部分编辑的 inline token
- 删除时整个 token 一起删除

内部序列化格式：

```txt
请处理这个 [[att:att_abc123]]，再参考 [[att:att_def456]]
```

展示层渲染为：

- 图片附件 token
- 文件附件 token
- 文件片段 token

不允许用户把 token 手动删成半截字符串。

### 2.4 附件来源

第一阶段支持：

- 拖拽文件
- 文件选择器
- 粘贴图片

为后续预留：

- 编辑器选中代码片段插入为 `file-range`
- 从工作区文件树插入引用

---

## 3. 统一语义

### 3.1 统一消息结构

```ts
type CCGUIComposedMessage = {
  text: string
  attachments: CCGUIAttachment[]
}
```

其中：

- `text` 使用内部 token 引用附件
- `attachments` 存储附件事实信息

### 3.2 附件结构

```ts
type CCGUIAttachment = {
  id: string
  kind: 'image' | 'file' | 'file-range'
  name: string
  path: string
  size: number | null
  mimeType: string | null
  source: 'clipboard' | 'drag-drop' | 'picker' | 'editor'
  startLine?: number
  endLine?: number
}
```

说明：

- `path` 永远指向当前附件实体路径
- `file-range` 的 `path` 就是原始文件路径
- 不再保留重复字段 `originFilePath`
- 统一语义层不包含 `embed/reference` 等 provider 决策字段

### 3.3 Token 解析规则

统一 token 格式：

```txt
[[att:<attachmentId>]]
```

解析规则：

- 若能找到对应附件，渲染为 token
- 若历史记录中找不到附件，降级显示为失效 token
- provider 翻译前根据 `text + attachments` 一起处理

---

## 4. 缓存与历史

### 4.1 临时缓存目录

剪贴板图片先落地到：

```txt
/tmp/cache/ccgui-attachments/
```

命名规则：

- 使用短随机名
- 保留正确扩展名
- 示例：`paste-a7f3c2.png`

### 4.2 历史目录

会话历史目录新增：

```txt
~/.ccgui/projects/<projectId>/sessions/<sessionId>/history/data/
```

用途：

- 保存发送后需要长期保留的图片附件实体

### 4.3 生命周期

编辑阶段：

- 剪贴板图片保存在 `/tmp/cache/ccgui-attachments/`
- 普通文件直接引用原路径

发送阶段：

- 如果附件是临时图片，则复制到 `history/data/`
- 更新附件对象中的 `path` 为历史目录路径
- 再写入历史记录

删除阶段：

- 若附件来自 `/tmp/cache/ccgui-attachments/`，且尚未进入历史，删除实体文件

清理阶段：

- 启动时或定时清理过期缓存
- 仅清理 `/tmp/cache/ccgui-attachments/` 下未使用的旧文件

---

## 5. Provider 翻译边界

### 5.1 总原则

CCGUI 统一层只表达：

- 用户输入了什么文字
- 用户附加了哪些附件

Provider 自己决定：

- 是否读取附件实体内容
- 是否转为图片块 / 文档块 / 引用描述
- 是否因附件过大而降级

### 5.2 Codex

Codex adapter 负责将统一结构翻译为：

- 文本：`input[text]`
- 图片：`input[image/localImage]`
- 文件：`attachments`
- 文件片段：优先翻译成带路径/行号的引用

文本中的 `[[att:id]]` 需要在发送前替换成稳定可理解的引用文案。

### 5.3 Claude

Claude adapter 负责将统一结构翻译为：

- 图片：`message.content[]` 中的 `image`
- 小文本文件：`document(text)`
- PDF：`document(base64)`
- 大文件：降级成路径或片段说明文本

文本中的 `[[att:id]]` 需要替换成结构化说明，例如：

```txt
[附件: foo.ts (120-180)]
```

### 5.4 大小策略

大小判断由 provider 自己完成，不在统一语义层固化。

例如：

- Claude 可以根据文件大小决定是否直接发送全文
- Codex 可以优先走本地文件引用

---

## 6. 历史记录展示

历史记录直接保存 CCGUI 统一消息结构，因此前端回放时可以直接恢复：

- 附件条
- 文本中的附件 token
- 图片路径
- 文件片段信息

要求：

- 文件附件不需要复制实体进入历史
- 图片附件需要有稳定历史路径
- 历史回放不能依赖 `/tmp/cache`

---

## 7. 模块划分

### 7.1 renderer

- `ChatInput.vue`
  - 附件条
  - token 渲染
  - 拖拽 / 粘贴 / 文件选择

- `attachment-utils`
  - token 解析与序列化
  - 前端展示辅助

### 7.2 main / backend

- `attachment-service`
  - 保存临时图片
  - 删除临时附件
  - 复制图片到历史目录
  - 读取文件内容 / 文件片段
  - mime / 大小信息

- `history-manager`
  - 提供 history data 目录

- `provider adapters`
  - Codex / Claude 翻译

---

## 8. 第一阶段实施范围

第一阶段包含：

1. 输入区附件条
2. token 化附件引用
3. 拖拽文件
4. 文件选择器
5. 粘贴图片
6. 临时缓存与历史图片归档
7. Codex / Claude 基础翻译

第一阶段暂不包含：

- 从编辑器主动插入 `file-range` 的完整 UI
- 图片压缩
- 附件冲突检测
- 多 provider 独立附件策略配置界面
