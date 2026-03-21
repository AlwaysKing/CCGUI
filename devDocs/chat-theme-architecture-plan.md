# 聊天消息多主题改造纲领

## 背景

当前聊天区消息渲染结构大致为：

```text
MessageList
  -> v-for message
    -> MessageItem
      -> 按 role / subtype 分发到各类消息组件
```

现有实现中：

- `MessageList` 负责 `v-for` 和事件透传
- `MessageItem` 负责消息级公共结构与大量交互逻辑
- `AssistantMessage`、`ToolUseMessage`、`UserMessage` 等组件负责具体消息内容呈现

这一结构已经能够支撑单一主题，但如果未来需要引入多套可切换聊天主题，且主题差异不止颜色和边框，而包含：

- 气泡样式明显不同
- 头像可能隐藏或替换为其他呈现方式
- `status / stats / thinking / tool` 等区块位置变化
- 某些消息类型在不同主题下呈现方式不同

那么现有单文件内继续累积 `if theme === ...` 分支，后续维护成本会快速上升。

## 本次讨论的主题与目的

本次讨论聚焦的问题是：

- 如何为聊天框引入一套可选的新 UI 主题样式
- 在未来还会继续增加 `theme2 / theme3` 时，如何避免架构失控
- 如何在保持现有消息行为稳定的前提下，为主题扩展预留空间

本次讨论的目标不是立刻实现某个视觉稿，而是形成一份后续重构时可遵循的架构原则与落地路径。

## 已讨论的两种直接方案

### 方案 A

在现有 `MessageItem` 中，根据主题配置切换不同元素样式，并让 `message`、`tooluse` 等子节点跟随主题变化。

### 方案 B

分别实现：

- `MessageItemTheme1`
- `MessageItemTheme2`

以及其下成套的：

- `MessageTheme1`
- `MessageTheme2`
- `ToolUseTheme1`
- `ToolUseTheme2`

再由 `MessageList` 根据主题决定 `v-for` 渲染哪一套组件。

## 对上述两种方案的判断

### 为什么不建议长期停留在方案 A

当主题只有 1 到 2 套，且差异主要是颜色、圆角、边框、间距时，方案 A 可以成立。

但如果未来主题继续增加，且差异扩大到结构层面，方案 A 会逐步出现以下问题：

- `MessageItem` 内部主题分支越来越多
- 模板可读性快速下降
- 不同主题的逻辑和样式耦合在一起
- 新增 message type 时，需要在同一文件里兼顾所有主题分支
- 某些主题仅修改局部布局，却必须穿透整个消息树传递判断

最终结果通常是：文件越来越大，但仍然难以安全修改。

### 为什么不建议直接采用方案 B

方案 B 的核心问题不是“分文件”，而是“复制逻辑”。

当前 `MessageItem` 并不只是样式容器，它已经承担了大量行为逻辑，例如：

- 不同消息类型分发
- 折叠与展开
- thinking 显示控制
- rewind / fork 操作菜单
- copy 行为
- streaming / duration 状态计算
- 各类消息辅助状态判断

如果直接复制多份 `MessageItemThemeX`，会带来以下长期风险：

- 同一行为逻辑在多套主题组件中重复维护
- 修一个 bug 需要改多处
- 新增能力时容易漏改某个主题
- 主题之间行为逐渐漂移
- `MessageList` 本身开始承担主题分发职责，列表层变得不再纯粹

因此，方案 B 虽然能暂时减少单文件分支，但会把问题转化为“多份逻辑副本”。

## 最终建议方案

推荐采用第三种结构：

**共享逻辑容器 + 可替换主题渲染层**

即：

1. 保持 `MessageList` 只有一套循环逻辑
2. 将 `MessageItem` 演进为消息级逻辑容器
3. 将“具体长什么样、怎么摆”交给主题渲染器
4. 主题差异大时，不复制整个消息系统，只替换渲染层或局部渲染块

这是本次讨论的最终方案，也是后续改造的推荐纲领。

## 架构原则

### 原则 1：列表层不参与主题分叉

`MessageList` 应继续只负责：

- `v-for`
- key 管理
- props 透传
- 事件上抛

不建议让 `MessageList` 根据主题去切换整套 `MessageItemThemeX` 列表渲染逻辑。

原因是：

- 列表层应该稳定、轻量
- 主题扩展不应污染消息遍历逻辑
- 避免把主题判断抬高到消息树顶层

### 原则 2：行为逻辑集中，视觉结构分离

后续应明确区分两类内容：

#### 公共逻辑层

属于所有主题都共享的消息行为和状态计算，包括但不限于：

- message role / subtype 分发
- 折叠与展开状态
- 回答隐藏占位逻辑
- thinking 是否显示
- copy / rewind / fork 行为
- streaming / duration / startTime 计算
- 工具消息输入数据归一化
- 对 session store / composable 的依赖

#### 主题渲染层

属于某个主题独有或可自由变化的展示方式，包括但不限于：

- 是否显示头像
- 头像位置和形式
- stats 放在气泡外、气泡内还是侧边
- status 是否归并到别的区域
- 气泡边框、背景、阴影、间距、对齐方式
- assistant / tool / question 等消息块的视觉编排
- thinking 区块是否内嵌、独立、折叠条形态如何

### 原则 3：避免复制整颗消息树

不应为每个主题复制整套：

- `MessageList`
- `MessageItem`
- 全量子组件

应优先采用：

- 公共逻辑容器 1 套
- 多套主题 renderer
- 只在必要时替换局部主题组件

### 原则 4：主题扩展应是“新增文件”，而不是“扩大条件分支”

当新增 `theme2`、`theme3` 时，理想状态应是：

- 新增一套主题 renderer 文件
- 新增少量主题专属子组件
- 尽量少改共享逻辑层

而不是在已有组件中持续增加：

```vue
v-if="theme === 'a'"
v-else-if="theme === 'b'"
v-else-if="theme === 'c'"
```

## 推荐演进架构

### 总体结构

建议未来把消息系统拆成两层：

```text
MessageList
  -> MessageItemContainer
    -> 计算公共状态、整理动作、决定消息类型
    -> 选择当前主题 renderer
      -> ThemeMessageRenderer
        -> 主题内部再组合 AssistantBubble / ToolCard / StatusBlock 等
```

### 角色定义

#### 1. `MessageList`

职责：

- 遍历消息
- 传入上下文参数
- 接收并透传事件

不负责：

- 主题判断
- 具体消息视觉结构

#### 2. `MessageItemContainer`

职责：

- 集中处理当前 `MessageItem` 中的公共逻辑
- 统一生成消息 UI 所需的状态数据
- 统一封装操作行为
- 为 renderer 提供干净的输入

典型输出可抽象为：

- `message`
- `messageIndex`
- `uiState`
- `actions`
- `meta`
- `theme`

其中：

- `uiState` 表示当前消息各种可视状态
- `actions` 表示 copy / rewind / toggle 等行为
- `meta` 表示头像、时间、是否新 turn 等衍生信息

#### 3. `ThemeMessageRenderer`

职责：

- 以当前主题的方式摆放消息区块
- 决定哪些公共块在本主题下显示或隐藏
- 组合主题专属气泡和卡片组件

不负责：

- 直接操作 store
- 重新计算业务状态
- 重复实现一遍 message 行为逻辑

## 组件层面的建议拆分

下面给出一份推荐目录，不要求一次性到位，但后续改造可逐步朝这个方向演进：

```text
src/views/workspace/chat/components/messages/
  MessageList.vue
  core/
    MessageItemContainer.vue
    useMessageItemViewModel.js
  themes/
    classic/
      MessageRenderer.vue
      AssistantBubble.vue
      UserBubble.vue
      ToolCard.vue
      StatusBlock.vue
    compact/
      MessageRenderer.vue
      AssistantBubble.vue
      UserBubble.vue
      ToolCard.vue
      StatusBlock.vue
    minimal/
      MessageRenderer.vue
      AssistantBubble.vue
      ToolCard.vue
  shared/
    ThinkingSection.vue
    MessageStats.vue
    RewindActions.vue
    MessageAvatar.vue
```

说明：

- `core/` 放逻辑
- `themes/` 放主题 renderer
- `shared/` 放仍然可跨主题复用的视觉块

## 当前代码的演进建议

结合当前代码现状，后续改造建议按以下方向进行。

### 第一步：识别并冻结 `MessageList` 的职责

当前 `MessageList` 已经比较纯粹，这一点应尽量保持，不要让它开始负责：

- `theme -> item component` 的分发
- 主题相关 props 拼装

建议继续让它稳定地只做列表层。

### 第二步：把 `MessageItem.vue` 视为临时逻辑中心

当前 `MessageItem.vue` 已承担大量职责，因此后续不建议再继续往里面增加主题判断。

应把它作为“待拆分的逻辑中心”，逐步提取出：

- 公共状态计算
- 公共事件动作
- 公共消息元数据

最终收敛为 `MessageItemContainer` 或同等角色。

### 第三步：先做一套默认 renderer

第一次重构时，不需要立刻实现多套主题。

更稳妥的做法是：

1. 先把现有 UI 原样搬成一套 `classic` 或 `default` renderer
2. 确保逻辑提取后，视觉效果与现有版本一致
3. 再新增第二套主题 renderer

这样能降低重构时行为回归风险。

### 第四步：局部差异大时，优先替换局部块而不是整套系统

即使在主题 renderer 内部，也不需要所有块都为每个主题重写。

可以按差异程度决定：

- 差异小：共享组件 + 不同 class / token
- 差异中：共享组件 + variant props
- 差异大：主题专属局部组件

例如：

- `AssistantBubble` 主题差异很大，可拆主题专属版本
- `RewindActions` 行为相同、样式差异小，可保留共享组件

## 什么情况用“样式切换”就够了

满足以下条件时，不必引入整套 renderer：

- 只改颜色
- 只改圆角、边框、间距
- 只改 hover / shadow / 字体层级
- 消息块顺序不变
- 是否显示头像不影响整体布局

这类变化可用：

- CSS variables
- `data-theme`
- `themeVariant` props

来完成。

## 什么情况应进入“renderer 分层”

满足以下任意条件时，应优先考虑 renderer 分层：

- 同一类消息在不同主题下布局顺序不同
- 头像在某些主题中消失，导致整体栅格结构变化
- `stats / status / thinking / tool` 的位置发生结构变化
- 某个主题中多个 message type 被合并呈现
- 单文件中已出现大量主题条件分支

换言之，只要差异从“样式”升级为“编排”，就不应继续停留在简单 class 切换阶段。

## 主题系统的配置建议

未来建议为聊天消息单独引入主题配置，而不是复用应用级全局主题概念。

建议至少具备：

- `chatThemeKey`
- 默认主题
- 主题注册表

概念上可理解为：

```js
const chatThemeRegistry = {
  classic: {
    renderer: ClassicMessageRenderer
  },
  compact: {
    renderer: CompactMessageRenderer
  },
  minimal: {
    renderer: MinimalMessageRenderer
  }
}
```

注意：

- 主题注册表负责组织映射关系
- 逻辑容器只消费当前主题，不负责知道所有主题细节

## 推荐的数据边界

为了避免 renderer 直接依赖复杂业务逻辑，建议逻辑层向 renderer 提供稳定、明确的数据结构。

可参考以下边界：

### `uiState`

用于描述当前消息的可视状态，例如：

- `showAvatar`
- `avatarChar`
- `isNewTurn`
- `showThinking`
- `isThinkingCollapsed`
- `showCollapsedPlaceholder`
- `isStreaming`
- `showRewindBtn`
- `showCollapseBtn`

### `actions`

用于描述 renderer 可调用的交互动作，例如：

- `onCopy`
- `onToggleThinking`
- `onToggleResponseCollapse`
- `onRewind`
- `onFork`
- `onRewindAndFork`

### `meta`

用于描述消息的辅助元数据，例如：

- `timestamp`
- `duration`
- `usage`
- `turnNumber`
- `isLastUserMessage`

renderer 只消费这些已整理好的字段，避免主题层直接拼接业务判断。

## 未来实施时的推荐步骤

### 阶段 1：整理逻辑边界

- 梳理 `MessageItem.vue` 中所有 computed 和事件
- 区分哪些是共享逻辑，哪些是视觉选择
- 提取出统一 view-model 或 container 层

### 阶段 2：复制当前视觉为默认 renderer

- 以当前 UI 为基准建立 `default/classic` renderer
- 保证重构后视觉和行为一致
- 用它作为后续所有主题的对照基线

### 阶段 3：实现第二套主题

- 根据新主题要求决定哪些块共享、哪些块专属
- 优先替换变化最大的局部块
- 尽量不修改共享逻辑层

### 阶段 4：沉淀主题 token

- 将各主题的颜色、圆角、间距、边框等统一收敛到 token
- 降低组件内部硬编码样式比例

### 阶段 5：评估状态类消息的聚合策略

- 单独评估 `status / system_notification / task_complete / permission_result`
- 确定这些类型在不同主题中是否保留独立块
- 若需要“归拢到别处”，应在 renderer 层实现，不应改写底层消息数据模型

## 明确不建议的做法

后续实施时，应尽量避免以下方式：

- 在 `MessageList` 中写主题分支，决定遍历哪套 `MessageItem`
- 为每个主题复制整套 `MessageItem.vue`
- 在所有子组件内部零散加入 `if theme === ...`
- 让 renderer 直接依赖 store 并重新计算业务逻辑
- 主题改造顺手改动消息数据模型，导致表现层和数据层耦合

## 最终结论

本次讨论最终形成的纲领如下：

1. 当前不适合直接走“多套完整 `MessageItem` 复制”的路线
2. 未来也不应把所有主题分支持续堆进单一 `MessageItem`
3. 最优演进方向是“共享逻辑容器 + 多套主题 renderer”
4. `MessageList` 保持纯粹，`MessageItem` 演进为逻辑容器，主题差异下沉到 renderer
5. 新增 `theme2 / theme3` 时，应尽量通过新增 renderer 和局部主题组件完成，而不是复制业务逻辑

这份文档将作为后续聊天消息多主题改造的架构纲领。
