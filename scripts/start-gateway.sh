#!/bin/bash

# DEV-Agent Gateway 启动脚本
# 使用方法: ./start-gateway.sh

set -e

echo "🚀 DEV-Agent Gateway 启动"
echo "=========================="

# 检查 Node.js 是否已安装
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装"
    exit 1
fi

echo "✅ Node.js 已安装: $(node --version)"

# 进入 gateway 目录
cd "$(dirname "$0")/packages/gateway"

# 检查依赖是否已安装
if [ ! -d "node_modules" ]; then
    echo ""
    echo "📦 安装依赖..."
    npm install
fi

# 检查配置文件
CONFIG_DIR="$HOME/.dev-agent"
CONFIG_FILE="$CONFIG_DIR/config.yaml"

if [ ! -f "$CONFIG_FILE" ]; then
    echo ""
    echo "📝 创建配置文件..."
    mkdir -p "$CONFIG_DIR/logs"
    
    cp "$(dirname "$0")/config/gateway-config.yaml" "$CONFIG_FILE"
    echo "   ✅ 配置文件已创建: $CONFIG_FILE"
fi

# 启动 Gateway
echo ""
echo "🚀 启动 Gateway..."
echo "   按 Ctrl+C 停止"
echo ""

npm run dev
