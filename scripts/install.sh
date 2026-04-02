#!/bin/bash

# 安装 CCGUI 到 /Applications
# 使用方法: ./scripts/install.sh

set -e

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 查找构建产物
APP_PATH=$(ls -d output/mac*/CCGUI.app 2>/dev/null | head -1)

if [ -z "$APP_PATH" ]; then
    echo -e "${RED}✗ 未找到构建产物，请先运行 ./scripts/rebuild.sh${NC}"
    exit 1
fi

echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${BLUE}   CCGUI 安装到 /Applications${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}源路径: ${APP_PATH}${NC}"
echo -e "${BLUE}目标: /Applications/CCGUI.app${NC}"
echo ""

# 删除旧版本
if [ -d "/Applications/CCGUI.app" ]; then
    echo -e "${YELLOW}删除旧版本...${NC}"
    rm -rf /Applications/CCGUI.app
fi

# 复制
echo -e "${YELLOW}复制中...${NC}"
cp -R "$APP_PATH" /Applications/CCGUI.app

echo ""
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}   ✓ 安装完成${NC}"
echo -e "${GREEN}═══════════════════════════════════════${NC}"
echo ""
echo -e "${BLUE}运行 'open /Applications/CCGUI.app' 启动应用${NC}"
