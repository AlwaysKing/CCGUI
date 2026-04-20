# Provider 命令与引用统一语义设计（草案）

**文档版本**: 0.1  
**最后更新**: 2026-04-20

## 目标

在 `CCGUI` 中为 `Claude` 与 `Codex` 建立一套**最小可实施**的 provider 层统一封装，覆盖：

- `/` 命令
- `@` 指令
- `$` 指令
- `引用型 /`

本设计只覆盖当前已经讨论确认的范围，遵循两条原则：

- **不要过度设计**
- **不要扩大范围**

---

## 一句话结论

统一的对象不是字符触发器 `/`、`@`、`$`，而是 provider 层的两类能力：

1. `queryCommands`：查询可供 UI 展示的候选项
2. 两种提交方式：
   - `runCommands`：执行“命令型 /”
   - `referenceAttachments`：承载“引用型 /”、`@指令`、`$指令`

也就是说：

- UI 层看到的是四类候选
- provider 层真正处理的是两种提交方式
- 最终由各 provider 负责把它们翻译成 `Claude` / `Codex` 的实际后端语义

---

## 范围

### 本轮纳入范围

- provider 层接口设计
- `命令型 /` 查询与执行
- `引用型 /` 的引用附件化
- `@指令` 的引用附件化
- `$指令` 的引用附件化
- `Claude` / `Codex` 的最小映射规则
- `/` 按钮的第一阶段 UI 方案

### 本轮不纳入范围

- 富文本编辑器整体重构
- 通用 AST 大一统模型
- 所有 provider 的全量抽象
- 历史消息存储系统整体改版
- `@` / `$` 的完整联想菜单实现
- 收藏、最近使用、全局搜索、复杂排序

---

## Provider 层统一框架

### 1. 查询能力

provider 需要提供：

```ts
queryCommands(params)
```

其返回结果以 UI 分类组织，共四类：

- `命令型/`
- `引用型/`
- `@指令`
- `$指令`

注意：

- 四类是**UI 分类**
- 不是底层协议分类
- 不是最终发送格式

### 2. 提交能力

provider 需要提供两种提交方式：

#### 2.1 `runCommands`

用于执行：

- `命令型/`

这类候选选择后，不进入“附件引用”通道，而由 provider 直接执行。

#### 2.2 `referenceAttachments`

用于承载：

- `引用型/`
- `@指令`
- `$指令`

它的定位参考现有：

- 文件附件
- 图片附件

区别在于：

- 文件/图片附件主要表示文件与图像输入
- `referenceAttachments` 表示 provider 可解释的“引用语义”

最终由 provider 将这些引用附件翻译为各自后端可接受的发送形式。

---

## 最小数据模型

本轮只保留最小必要字段。

### 1. 查询结果项

建议每个候选项至少包含：

- `id`
- `label`
- `category`
- `submitMode`
- `kind`
- `value`
- `providerMeta`

字段含义：

- `category`
  - UI 分类
  - 枚举值：`slash_command`、`slash_reference`、`at_directive`、`dollar_directive`
- `submitMode`
  - 提交方式
  - 枚举值：`runCommand`、`referenceAttachment`
- `kind`
  - provider 解释所需的轻量语义类型
  - 例如：`builtin-command`、`mcp-prompt`、`mcp-resource`、`agent`、`skill`、`app`、`plugin`
- `value`
  - provider 最终编译时的核心值
- `providerMeta`
  - provider 私有的附加信息

不在这一轮引入复杂统一 AST。

### 2. 引用附件

建议新增轻量引用附件结构：

- `id`
- `category`
- `kind`
- `label`
- `value`
- `providerMeta`

它与现有文件附件、图片附件并列存在。

---

## Claude 与 Codex 的最小适配原则

### 1. `Claude`

#### 1.1 `命令型 /`

由 `runCommands` 执行。

典型映射：

- 内置 slash command
- MCP prompt 对应的 `/mcp__server__prompt`

#### 1.2 `引用型 /`

进入 `referenceAttachments`，再由 provider 决定最终如何编译。

本轮不强行规定其一定编译成某一种固定文本。

#### 1.3 `@指令`

至少覆盖：

- `@mcp-resource`
- `@agent`

由 provider 翻译为 Claude 可解释的对应语义。

#### 1.4 `$指令`

`Claude` 不要求原生保留 `$` 字符语法。

在统一框架下，`$` 只是 UI 分类；provider 可将其翻译为 Claude 支持的等价能力，例如：

- slash command
- skill-like command
- 其他 Claude 可接受的引用形式

### 2. `Codex`

#### 2.1 `命令型 /`

由 `runCommands` 执行。

优先由 provider 自行决定是否映射为：

- 独立控制 RPC
- slash-like 文本命令
- 本地命令行为

#### 2.2 `引用型 /`

进入 `referenceAttachments`，由 provider 编译为 Codex 可接受的 prompt/上下文输入形式。

#### 2.3 `@指令`

至少覆盖：

- `@agent`
- `@plugin`
- 文件类 mention 的后续兼容空间

#### 2.4 `$指令`

至少覆盖：

- `$skill`
- `$app`

由 provider 编译为 Codex 当前使用的对应文本编码或其他输入结构。

---

## 为什么采用“引用附件”

原因很简单：

- `引用型 /`、`@指令`、`$指令` 的共同点，都不是普通裸文本
- 它们本质上都在为当前消息追加“可解释上下文”
- 这和文件附件、图片附件在交互形态上更接近

因此：

- 它们适合作为 message composer 上的独立 chip / 附件项存在
- 由 provider 在发送阶段统一翻译
- 不要求 UI 层知道每个 provider 的底层协议细节

---

## `/` 的统一处理原则

`/` 在统一设计中必须至少区分两种情况：

### 1. `命令型 /`

特征：

- 选择后立即执行
- 不作为“引用附件”挂到输入消息上
- 使用 `runCommands`

### 2. `引用型 /`

特征：

- 选择后作为引用内容加入当前输入
- 使用 `referenceAttachments`
- 与文本一起发送

这两类都带 `/` 触发外观，但不能在底层被视为同一种提交语义。

---

## 第一阶段 UI 方案：`[/]` 按钮

### 1. 总体原则

第一阶段只做：

- `命令型 /`

不在一开始查询全部四类候选。

### 2. 入口位置

在聊天输入框的 `inputToolbar` 中：

- 在附件图标前方插入一个 `[/]` 按钮

### 3. 查询时机

不要预加载。

仅在用户点击 `[/]` 按钮后，调用当前 provider：

```ts
queryCommands({ category: 'slash_command' })
```

### 4. 展示要求

菜单展示所有 `命令型 /`，并支持多级结构。

第一阶段只要求支持两级：

- 一级：命令组
- 二级：具体命令

典型例子：

- 一级显示某个 MCP server
- 二级显示该 MCP server 提供的具体命令

### 5. 执行动作

当用户选择叶子命令后：

- 调用 `runCommands`
- 不进入 `referenceAttachments`
- 不在这一阶段混入 `@` / `$` / `引用型 /`

---

## Provider 返回给 `/` 菜单的最小结构

为了避免 UI 自己做复杂 regroup，建议 `queryCommands` 直接返回轻量树结构。

最小要求：

- group
  - `id`
  - `label`
  - `children`
- item
  - `id`
  - `label`
  - `description`
  - `submitMode`
  - `kind`
  - `value`
  - `providerMeta`

第一阶段菜单只消费：

- `命令型 /`
- 两级结构

---

## 实施顺序建议

### 第一阶段

- provider 增加 `queryCommands`
- provider 增加 `runCommands`
- UI 增加 `[/]` 按钮
- 点击后查询 `命令型 /`
- 菜单支持两级展示
- 选择叶子后执行 `runCommands`

### 第二阶段

- 新增 `referenceAttachments`
- 承接 `引用型 /`
- 为后续 `@指令` / `$指令` 预留统一承载方式

### 第三阶段

- 再分别做 `@`、`$` 的输入联想与插入体验

---

## 当前结论

当前最稳妥的实现方向是：

- provider 层统一
- UI 按四类展示
- 发送只保留两种提交方式
- 第一阶段先把 `命令型 /` 和 `[/]` 菜单做好

这样既能覆盖 `Claude` 与 `Codex` 的差异，又不会把系统提前推进到过度抽象。
