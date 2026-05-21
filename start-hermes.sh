#!/bin/bash

# AI-local-OS Phase 1 快速启动脚本
# 使用方法: ./start-hermes.sh

set -e

echo "🚀 AI-local-OS Phase 1 快速启动"
echo "================================"

# 检查 Hermes 是否已安装
if ! command -v hermes &> /dev/null; then
    echo "❌ Hermes 未安装，请先安装: curl -fsSL https://hermes-agent.nousresearch.com/install.sh | bash"
    exit 1
fi

echo "✅ Hermes 已安装"

# 创建 Hermes 配置目录
echo ""
echo "📁 创建 Hermes 配置目录..."
mkdir -p ~/.hermes-dev
echo "   ✅ ~/.hermes-dev"

# 检查配置文件是否存在
if [ ! -f ~/.hermes-dev/config.yaml ]; then
    echo ""
    echo "📝 创建配置文件..."
    cat > ~/.hermes-dev/config.yaml << 'EOF'
model:
  default: mimo-v2.5
  provider: xiaomi
  base_url: https://token-plan-sgp.xiaomimimo.com/v1

platforms:
  api_server:
    enabled: true
    extra:
      host: "127.0.0.1"
      port: 8002
      model_name: "hermes-agent"

agent:
  max_turns: 90
  gateway_timeout: 1800

toolsets:
  - hermes-cli
EOF
    echo "   ✅ 配置文件已创建"
fi

# 启动 Hermes Gateway
echo ""
echo "🚀 启动 Hermes Gateway（端口 8002）..."
echo "   按 Ctrl+C 停止"
echo ""

# 设置环境变量
export HERMES_HOME=~/.hermes-dev

# 启动 gateway（前台运行）
hermes gateway run
