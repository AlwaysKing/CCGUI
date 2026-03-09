# CCGUI 开发脚本使用指南

## 脚本概览

CCGUI 提供了两个主要的开发脚本：

### 1. 重新编译打包脚本 (`rebuild.sh`)

用于清理、构建和打包应用。

#### 使用方法

```bash
# 完整的重新编译打包（推荐）
npm run rebuild

# 或者直接运行脚本
./scripts/rebuild.sh

# 快速重新编译（跳过清理步骤）
npm run rebuild:fast

# 只构建前端，不打包应用
npm run rebuild:only
```

#### 选项说明

- `--skip-clean` - 跳过清理步骤，直接开始构建（更快）
- `--only-build` - 只构建前端资源，不打包 Electron 应用

#### 执行步骤

1. 清理旧的构建文件（`dist/` 和 `node_modules/.vite/`）
2. 构建前端资源（Vite build）
3. 打包 Electron 应用（electron-builder）

---

### 2. 启动调试脚本 (`debug.sh`)

用于启动开发环境，支持热重载和实时日志。

#### 使用方法

```bash
# 标准调试模式（推荐）
npm run debug

# 或者直接运行脚本
./scripts/debug.sh

# 启动时自动打开开发者工具
npm run debug:tools

# 安静模式（不显示日志输出）
npm run debug:quiet
```

#### 选项说明

- `--devtools` - 启动时自动打开开发者工具
- `--no-logs` - 不显示日志输出

#### 启动信息

脚本启动后会显示：
- 前端开发服务器地址：`http://localhost:5173`
- 日志文件位置：`/tmp/ccgui/app.log`
- 快捷键提示

#### 快捷键

- `Cmd+Option+I` - 打开开发者工具
- `Cmd+R` - 刷新页面
- `Ctrl+C` - 停止调试

---

## 完整开发流程示例

### 日常开发

```bash
# 1. 启动调试模式
npm run debug

# 2. 修改代码...（自动热重载）

# 3. 测试完成后按 Ctrl+C 停止
```

### 发布新版本

```bash
# 1. 完整重新编译打包
npm run rebuild

# 2. 测试打包后的应用
open dist/mac-arm64/CCGUI.app

# 3. 发布到应用商店或分发 DMG 文件
```

### 快速迭代

```bash
# 如果只是修改前端代码，使用快速模式
npm run rebuild:fast

# 或者只构建前端
npm run rebuild:only
```

---

## 其他有用的命令

```bash
# 只启动前端开发服务器
npm run dev

# 只构建前端
npm run build

# 只启动 Electron（需要先启动前端）
npm run electron

# 标准的 Electron 开发模式
npm run electron:dev

# 标准的 Electron 打包
npm run electron:build
```

---

## 故障排除

### 问题：应用启动后显示空白页面

**解决方案**：
```bash
# 清理缓存并重新启动
npm run rebuild
```

### 问题：修改代码后没有更新

**解决方案**：
```bash
# 清理 Vite 缓存
rm -rf node_modules/.vite

# 重新启动调试
npm run debug
```

### 问题：打包后的应用名称不正确

**解决方案**：
```bash
# 运行完整的重新编译
npm run rebuild

# 检查 package.json 中的 productName 设置
```

---

## 日志查看

应用运行时会将日志写入 `/tmp/ccgui/app.log`。

```bash
# 实时查看日志
tail -f /tmp/ccgui/app.log

# 查看最近的日志
tail -n 50 /tmp/ccgui/app.log

# 清理日志
rm /tmp/ccgui/app.log
```

---

## 文件结构

```
scripts/
├── rebuild.sh  # 重新编译打包脚本
└── debug.sh    # 启动调试脚本
```

---

## 技术细节

### rebuild.sh

- 使用 `set -e` 在命令失败时立即退出
- 彩色输出提供清晰的状态反馈
- 支持参数自定义执行流程

### debug.sh

- 自动检查并安装依赖
- 设置 `NODE_ENV=development` 环境变量
- 可选的实时日志监控
- 优雅的后台进程清理（使用 trap）

---

## 贡献

如果发现问题或有改进建议，欢迎提交 Issue 或 Pull Request。
