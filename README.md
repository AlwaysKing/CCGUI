# Electron + Vue3 应用

这是一个基于 Electron + Vue3 + Vite 的桌面应用项目。

## 安装依赖

### 使用默认源
```bash
npm install
```

### 使用国内镜像（推荐）
```bash
npm install --registry=https://registry.npmmirror.com
```

## 快速启动

使用启动脚本（推荐）：
```bash
./dev.sh
```

## 开发模式

### 启动 Vite 开发服务器（仅 Vue3）
```bash
npm run dev
```

### 启动 Electron 应用（包含 Vue3 开发服务器）
```bash
npm run electron:dev
```

## 构建

### 构建 Vue3 应用
```bash
npm run build
```

### 构建 Electron 应用
```bash
npm run electron:build
```

## 项目结构

```
├── electron/          # Electron 主进程文件
│   └── main.cjs      # Electron 主进程入口
├── src/              # Vue3 应用源代码
│   ├── App.vue      # 根组件
│   └── main.js      # Vue3 应用入口
├── index.html        # HTML 模板
├── vite.config.js    # Vite 配置
└── package.json      # 项目配置

## 技术栈

- **Electron**: 桌面应用框架
- **Vue3**: 前端框架
- **Vite**: 构建工具
