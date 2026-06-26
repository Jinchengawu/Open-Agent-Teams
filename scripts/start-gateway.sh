#!/bin/bash

# DEV-Agent Gateway 启动脚本
# 使用方法: ./start-gateway.sh

set -e

echo "🚀 DEV-Agent Gateway 启动"
echo "=========================="

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 检查 Node.js 是否已安装
if ! command -v node &> /dev/null; then
    echo "❌ Node.js 未安装"
    exit 1
fi

echo "✅ Node.js 已安装: $(node --version)"

# 进入 gateway 目录
cd "$ROOT/packages/gateway"

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

    cat > "$CONFIG_FILE" <<'EOF'
# Open-Agent-Teams Gateway default local config.
# packages/gateway/src/api-gateway.ts will use built-in defaults when no
# config/oat/instances.yaml file is present; this file documents the local
# runtime location for operators.
gateway:
  host: 127.0.0.1
  port: 8400
EOF
    echo "   ✅ 配置文件已创建: $CONFIG_FILE"
fi

# 启动 Gateway
echo ""
echo "🚀 启动 Gateway..."
echo "   按 Ctrl+C 停止"
echo ""

npm run dev
