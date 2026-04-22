#!/bin/bash

# 重新编译打包并安装 CCGUI 到 /Applications
# 使用方法: ./scripts/rebuild-install.sh [选项]
# 选项:
#   --skip-clean  跳过清理步骤
#   --only-build  只构建前端，不打包

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo -e "\033[0;34m═══════════════════════════════════════\033[0m"
echo -e "\033[0;34m   CCGUI 编译打包 + 安装\033[0m"
echo -e "\033[0;34m═══════════════════════════════════════\033[0m"
echo ""

# Step 1: Rebuild
echo -e "\033[1;33m[Step 1/2] 执行重新编译打包...${NC}"
echo ""
bash "$SCRIPT_DIR/rebuild.sh" "$@"

echo ""

# Step 2: Install
echo -e "\033[1;33m[Step 2/2] 安装到 /Applications...${NC}"
echo ""
bash "$SCRIPT_DIR/install.sh"
