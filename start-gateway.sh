#!/bin/bash

# AI-local-OS Gateway 启动脚本
# 使用方法: ./start-gateway.sh

set -e

echo "🚀 AI-local-OS Gateway 启动"
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
CONFIG_DIR="$HOME/.hermes-gateway"
CONFIG_FILE="$CONFIG_DIR/config.yaml"

if [ ! -f "$CONFIG_FILE" ]; then
    echo ""
    echo "📝 创建配置文件..."
    mkdir -p "$CONFIG_DIR/logs"
    
    cat > "$CONFIG_FILE" << 'EOF'
server:
  host: "127.0.0.1"
  port: 8100

auth:
  enabled: false
  api_key: ""

instances:
  - id: hermes-dev
    url: "http://127.0.0.1:8002"
    tags: ["dev", "code", "debug", "test"]
    timeout_ms: 120000
  - id: hermes-life
    url: "http://127.0.0.1:8003"
    tags: ["life", "health", "habit"]
    timeout_ms: 60000
  - id: hermes-research
    url: "http://127.0.0.1:8004"
    tags: ["research", "market", "trend"]
    timeout_ms: 120000

routing:
  default_instance: "hermes-dev"

rate_limit:
  enabled: true
  requests_per_minute: 60
  burst_size: 10

circuit_breaker:
  enabled: true
  failure_threshold: 3
  cool_down_seconds: 120

logging:
  level: "INFO"
  audit_file: "~/.hermes-gateway/logs/audit.log"
  max_size_mb: 100
  backup_count: 5
EOF

    echo "   ✅ 配置文件已创建: $CONFIG_FILE"
fi

# 启动 Gateway
echo ""
echo "🚀 启动 Gateway..."
echo "   按 Ctrl+C 停止"
echo ""

npm run dev
