# CCGUI 界面风格指南

## 1. 概述

CCGUI 采用现代深色主题设计，以深灰色为背景，橙色为强调色，提供舒适的视觉体验。

## 2. 色彩系统

### 2.1 背景色 (Background Colors)

| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--bg-primary` | `#1E1E1E` | 主背景色，用于页面、对话框背景 |
| `--bg-secondary` | `#18181B` | 次级背景，用于侧边栏、输入框背景、滚动条轨道 |
| `--bg-tertiary` | `#27272A` | 三级背景，用于卡片悬停、选中状态 |
| `--bg-hover` | `#3F3F46` | 悬停背景，用于按钮、列表项悬停 |
| `--bg-active` | `#52525B` | 激活背景，用于按下状态 |

### 2.2 文字色 (Text Colors)

| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--text-primary` | `#E4E4E7` | 主要文字，用于标题、正文 |
| `--text-secondary` | `#A1A1AA` | 次要文字，用于描述、标签 |
| `--text-muted` | `#71717A` | 弱化文字，用于占位符、禁用状态 |
| `--text-inverse` | `#18181B` | 反色文字，用于深色按钮上的文字 |

### 2.3 强调色 (Accent Colors)

| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--accent-primary` | `#F97316` | 主强调色（橙色），用于按钮、链接、选中状态 |
| `--accent-hover` | `#FB923C` | 强调色悬停状态 |
| `--accent-active` | `#EA580C` | 强调色按下状态 |
| `--accent-light` | `rgba(249, 115, 22, 0.1)` | 强调色淡背景，用于高亮背景 |

### 2.4 边框色 (Border Colors)

| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--border-default` | `#3F3F46` | 默认边框 |
| `--border-light` | `#52525B` | 浅边框，用于分割线 |
| `--border-hover` | `#71717A` | 悬停边框 |
| `--border-focus` | `#F97316` | 聚焦边框 |

### 2.5 状态色 (Status Colors)

| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--color-success` | `#22C55E` | 成功状态 |
| `--color-success-bg` | `rgba(34, 197, 94, 0.1)` | 成功背景 |
| `--color-error` | `#EF4444` | 错误状态 |
| `--color-error-bg` | `rgba(239, 68, 68, 0.1)` | 错误背景 |
| `--color-warning` | `#F59E0B` | 警告状态 |
| `--color-warning-bg` | `rgba(245, 158, 11, 0.1)` | 警告背景 |
| `--color-info` | `#3B82F6` | 信息状态 |
| `--color-info-bg` | `rgba(59, 130, 246, 0.1)` | 信息背景 |

### 2.6 代码/语法色

| 变量名 | 色值 | 用途 |
|--------|------|------|
| `--code-bg` | `#0D0D0D` | 代码块背景 |
| `--code-inline-bg` | `#27272A` | 行内代码背景 |
| `--code-border` | `#3F3F46` | 代码块边框 |

## 3. 间距系统 (Spacing)

使用 4px 为基础单位的间距系统：

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--spacing-xs` | `4px` | 极小间距，紧凑元素 |
| `--spacing-sm` | `8px` | 小间距，按钮内边距 |
| `--spacing-md` | `12px` | 中等间距，卡片内边距 |
| `--spacing-lg` | `16px` | 大间距，区块间距 |
| `--spacing-xl` | `24px` | 超大间距，模块间距 |
| `--spacing-2xl` | `32px` | 巨大间距，页面边距 |

## 4. 圆角系统 (Border Radius)

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--radius-sm` | `4px` | 小圆角，标签、徽章 |
| `--radius-md` | `6px` | 中等圆角，按钮、输入框 |
| `--radius-lg` | `8px` | 大圆角，卡片 |
| `--radius-xl` | `12px` | 超大圆角，对话框 |
| `--radius-full` | `9999px` | 全圆角，圆形按钮 |

## 5. 字体系统 (Typography)

### 5.1 字体族

```css
font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', 'Oxygen',
  'Ubuntu', 'Cantarell', 'Fira Sans', 'Droid Sans', 'Helvetica Neue', sans-serif;
```

代码字体使用等宽字体：
```css
font-family: 'SF Mono', 'Fira Code', 'Consolas', monospace;
```

### 5.2 字号

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--font-size-xs` | `11px` | 极小字号，辅助信息 |
| `--font-size-sm` | `12px` | 小字号，标签、描述 |
| `--font-size-base` | `14px` | 基础字号，正文 |
| `--font-size-md` | `15px` | 中等字号 |
| `--font-size-lg` | `16px` | 大字号，标题 |
| `--font-size-xl` | `18px` | 超大字号，主标题 |
| `--font-size-2xl` | `24px` | 巨大字号，页面标题 |

### 5.3 字重

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--font-weight-normal` | `400` | 正常 |
| `--font-weight-medium` | `500` | 中等 |
| `--font-weight-semibold` | `600` | 半粗 |
| `--font-weight-bold` | `700` | 粗体 |

## 6. 阴影系统 (Shadows)

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--shadow-sm` | `0 1px 2px rgba(0, 0, 0, 0.3)` | 小阴影 |
| `--shadow-md` | `0 4px 6px rgba(0, 0, 0, 0.4)` | 中等阴影 |
| `--shadow-lg` | `0 10px 15px rgba(0, 0, 0, 0.5)` | 大阴影，对话框 |
| `--shadow-xl` | `0 20px 25px rgba(0, 0, 0, 0.6)` | 超大阴影 |

## 7. 过渡动画 (Transitions)

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--transition-fast` | `0.1s ease` | 快速过渡，hover 状态 |
| `--transition-normal` | `0.2s ease` | 正常过渡，展开/折叠 |
| `--transition-slow` | `0.3s ease` | 慢速过渡，对话框 |

## 8. 组件样式规范

### 8.1 按钮 (Button)

```css
/* 主要按钮 */
background: var(--accent-primary);
color: white;
border-radius: var(--radius-md);
padding: 8px 16px;
font-size: var(--font-size-base);
transition: background var(--transition-fast);

/* 主要按钮悬停 */
background: var(--accent-hover);

/* 次要按钮 */
background: var(--bg-tertiary);
color: var(--text-primary);
border: 1px solid var(--border-default);

/* 图标按钮 */
padding: 6px;
background: transparent;
color: var(--text-secondary);

/* 图标按钮悬停 */
background: var(--bg-hover);
color: var(--text-primary);
```

### 8.2 输入框 (Input)

```css
background: var(--bg-secondary);
border: 1px solid var(--border-default);
border-radius: var(--radius-md);
padding: 8px 12px;
color: var(--text-primary);
font-size: var(--font-size-base);

/* 聚焦状态 */
border-color: var(--accent-primary);
outline: none;

/* 占位符 */
color: var(--text-muted);
```

### 8.3 卡片 (Card)

```css
background: var(--bg-tertiary);
border: 1px solid var(--border-default);
border-radius: var(--radius-lg);
padding: var(--spacing-md);

/* 悬停状态 */
border-color: var(--border-hover);

/* 选中状态 */
border-color: var(--accent-primary);
background: var(--accent-light);
```

### 8.4 对话框 (Dialog)

```css
background: var(--bg-primary);
border: 1px solid var(--border-default);
border-radius: var(--radius-xl);
box-shadow: var(--shadow-lg);

/* 遮罩层 */
background: rgba(0, 0, 0, 0.6);
```

### 8.5 标签/徽章 (Badge)

```css
background: var(--bg-tertiary);
color: var(--text-secondary);
border-radius: var(--radius-sm);
padding: 2px 8px;
font-size: var(--font-size-xs);

/* 强调徽章 */
background: var(--accent-light);
color: var(--accent-primary);
```

## 9. 滚动条样式

```css
/* Webkit 浏览器 */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: var(--bg-secondary);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb {
  background: var(--border-light);
  border-radius: 4px;
  border: 2px solid var(--bg-secondary);
}

::-webkit-scrollbar-thumb:hover {
  background: var(--border-hover);
}

/* Firefox */
* {
  scrollbar-width: thin;
  scrollbar-color: var(--border-light) var(--bg-secondary);
}
```

## 10. 焦点样式

```css
*:focus-visible {
  outline: 2px solid var(--accent-primary);
  outline-offset: 2px;
}
```

## 11. 选择样式

```css
::selection {
  background: var(--accent-primary);
  color: white;
}
```

## 12. 图标规范

- 使用 SVG 内联图标
- 默认尺寸：16px（小图标）、18px（中等图标）、20px（大图标）
- 描边宽度：2px
- 颜色继承自 `currentColor`

## 13. 动画效果

### 13.1 淡入淡出

```css
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}
```

### 13.2 滑入

```css
@keyframes slideIn {
  from {
    opacity: 0;
    transform: translateY(-10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

### 13.3 脉冲（用于加载状态）

```css
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

## 14. Z-Index 层级

| 变量名 | 值 | 用途 |
|--------|-----|------|
| `--z-dropdown` | `100` | 下拉菜单 |
| `--z-sticky` | `200` | 粘性元素 |
| `--z-modal` | `1000` | 对话框 |
| `--z-tooltip` | `1100` | 工具提示 |
| `--z-toast` | `1200` | 通知消息 |
