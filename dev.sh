#!/bin/bash

# Electron + Vue3 开发启动脚本

echo "🚀 启动 Electron + Vue3 开发环境..."

# 检查依赖是否安装
if [ ! -d "node_modules" ]; then
    echo "📦 正在安装依赖..."
    npm install --registry=https://registry.npmmirror.com
fi

# 启动开发环境
NODE_ENV=development npm run electron:dev
