#!/bin/bash

# 启动 CCGUI 开发调试模式
# 使用方法: ./scripts/debug.sh [选项]
# 选项:
#   --no-logs    不显示日志输出
#   --devtools   自动打开开发者工具

set -e

# 颜色输出
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo -e "${BLUE}   CCGUI 开发调试模式${NC}"
echo -e "${BLUE}═══════════════════════════════════════${NC}"
echo ""

# 解析参数
SHOW_LOGS=true
OPEN_DEVTOOLS=false

for arg in "$@"; do
    case $arg in
        --no-logs)
            SHOW_LOGS=false
            shift
            ;;
        --devtools)
            OPEN_DEVTOOLS=true
            shift
            ;;
        *)
            echo -e "${RED}未知参数: $arg${NC}"
            exit 1
            ;;
    esac
done

# 检查依赖
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}未找到 node_modules，正在安装依赖...${NC}"
    npm install
    echo ""
fi

# 使用独立 debug profile，避免与正式应用争用代理端口、PID 注册表和运行数据
export NODE_ENV=development
export CCGUI_DEBUG_STARTUP=1
export CCGUI_PROFILE=debug

PROFILE_HOME="${CCGUI_HOME:-$HOME/.ccgui}"
PROXY_PORT=18921
VITE_PORT=5183
LOG_FILE="/tmp/ccgui-dev/app.log"

# 清理当前 profile 的旧日志文件
if [ -f "$LOG_FILE" ]; then
    echo -e "${YELLOW}清理旧日志文件...${NC}"
    rm -f "$LOG_FILE"
fi
mkdir -p "$(dirname "$LOG_FILE")"
: > "$LOG_FILE"

# 启动提示
echo -e "${CYAN}═══════════════════════════════════════${NC}"
echo -e "${CYAN}   启动信息${NC}"
echo -e "${CYAN}═══════════════════════════════════════${NC}"
echo -e "${GREEN}✓ 前端开发服务器:${NC} http://localhost:${VITE_PORT}"
echo -e "${GREEN}✓ 共享数据目录:${NC} $PROFILE_HOME"
echo -e "${GREEN}✓ 本地模型代理端口:${NC} $PROXY_PORT（占用时自动顺延）"
echo -e "${GREEN}✓ 日志文件:${NC} $LOG_FILE"
echo ""
echo -e "${YELLOW}快捷键提示:${NC}"
echo -e "  ${BLUE}Cmd+Option+I${NC} - 打开开发者工具"
echo -e "  ${BLUE}Cmd+R${NC}        - 刷新页面"
echo -e "  ${BLUE}Ctrl+C${NC}       - 停止调试"
echo ""
echo -e "${CYAN}═══════════════════════════════════════${NC}"
echo ""

# 添加开发者工具参数
if [ "$OPEN_DEVTOOLS" = true ]; then
    export OPEN_DEVTOOLS=true
fi

# 启动开发模式
if [ "$SHOW_LOGS" = true ]; then
    # 启动日志监控（后台）
    (sleep 3 && tail -f "$LOG_FILE" 2>/dev/null) &
    TAIL_PID=$!

    # 捕获退出信号，清理后台进程
    trap "kill $TAIL_PID 2>/dev/null || true" EXIT

    # 启动应用
    npm run electron:dev
else
    npm run electron:dev
fi
