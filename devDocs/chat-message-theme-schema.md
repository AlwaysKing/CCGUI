# Chat Message Theme Schema

## 目标

本次改造只针对聊天区 `message` 展示主题，不是整个应用换肤。

设计目标：

- 用少量稳定的视觉开关组合出多种消息展示风格
- 支持 `应用 -> 项目 -> 会话` 三层配置覆盖
- 在不重构整套消息树的前提下，先落地一套可用的 `Codex` 风格主题
- 后续如果差异扩大到结构编排，再升级到 renderer 分层

## 三层配置模型

### 应用层

应用层保存全局默认主题：

- `settings.chatMessageThemePreset`
- `settings.chatMessageTheme`

应用层没有“继承”概念，始终给出一份完整默认值。

### 项目层

项目层新增：

- `settings.chatMessageThemeMode`
- `settings.chatMessageThemePreset`
- `settings.chatMessageTheme`

其中：

- `app`：跟随应用层
- `preset`：使用指定预设
- `custom`：使用自定义开关组合

### 会话层

会话层新增：

- `settings.chatMessageThemeMode`
- `settings.chatMessageThemePreset`
- `settings.chatMessageTheme`

其中：

- `project`：跟随项目层
- `app`：直接跟随应用层
- `preset`：使用指定预设
- `custom`：使用自定义开关组合

## 解析优先级

最终运行时主题按以下顺序解析：

1. 会话层 `custom / preset / app / project`
2. 项目层 `custom / preset / app`
3. 应用层默认主题

解析结果始终收敛为一份完整的 `chatMessageTheme` 对象。

## Theme Schema

当前落地的 schema 先控制最关键的 4 个维度：

```js
{
  avatarMode: 'large' | 'small' | 'none',
  statusStyle: 'full' | 'compact' | 'floating' | 'hidden',
  messageSurface: 'bubble' | 'ghost',
  messageSpacing: 'large' | 'medium' | 'small'
}
```

说明：

- `avatarMode`
  - `large`：当前大头像列
  - `small`：缩成小圆点
  - `none`：不保留头像区域
- `statusStyle`
  - `full`：完整 badge 风格，展示时间、耗时、turn、token
  - `compact`：简约样式，弱化为轻量文本 pill
  - `floating`：悬浮样式，不占布局空间，仅在 hover 当前消息时显示，固定悬浮在消息上方
  - `hidden`：不显示
- `messageSurface`
  - `bubble`：气泡样式
  - `ghost`：简约样式，弱化背景和边框；`tool use / 权限确认 / AskUserQuestion` 也跟随这一开关
- `messageSpacing`
  - `large`：大间距
  - `medium`：中间距
  - `small`：小间距

## 预设

### `classic`

对外名称显示为 `聊天模式`，内部 preset key 仍然保留 `classic` 以兼容旧配置。

定义为：

- `avatarMode: large`
- `statusStyle: compact`
- `messageSurface: bubble`
- `messageSpacing: large`

### `codex`

对外名称显示为 `编程模式`，内部 preset key 仍然保留 `codex` 以兼容旧配置。

定义为：

- `avatarMode: small`
- `statusStyle: floating`
- `messageSurface: ghost`
- `messageSpacing: small`

特征：

- 消息主体更像连续文档流，而不是强气泡对话
- 工具调用弱化为简洁说明条目
- 状态信息改为 hover 才出现的悬浮样式
- 行间距更紧凑，更接近编码助手工作流

## 当前实施边界

本次先在现有组件结构中落地 schema 控制：

- `MessageItem`
- `AssistantMessage`
- `UserMessage`
- `ThinkingSection`
- `MessageStats`
- `ToolUseMessage`

暂不对以下消息块做彻底重排：

- `PermissionResultMessage`
- `QuestionMessage`
- `TaskCompleteMessage`
- `SystemNotificationMessage`

这类消息先尽量跟随通用 token 和间距变化，不在本次引入专属 renderer。

## 后续升级条件

如果后续出现以下需求，就应升级到 renderer 分层：

- 头像消失后需要整体换栅格结构
- thinking / tool / status 顺序在不同主题下完全不同
- 多类消息需要合并为新的复合块
- 单文件内已经出现大量主题判断

届时保留本 schema 作为高层主题配置，底层再切换到 renderer 实现。
