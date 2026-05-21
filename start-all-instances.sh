#!/bin/bash

# AI-local-OS 多实例启动脚本
# 使用方法: ./start-all-instances.sh

set -e

echo "🚀 AI-local-OS 多实例启动"
echo "=========================="

# 检查 Hermes 是否已安装
if ! command -v hermes &> /dev/null; then
    echo "❌ Hermes 未安装"
    exit 1
fi

echo "✅ Hermes 已安装"

# 定义实例配置
declare -A INSTANCES=(
    ["hermes-dev"]="8002:~/.hermes-dev:编程开发心智"
    ["hermes-life"]="8003:~/.hermes-life:个人生活心智"
    ["hermes-research"]="8004:~/.hermes-research:行业研究心智"
)

# 启动每个实例
for instance in "${!INSTANCES[@]}"; do
    IFS=':' read -r port home_dir label <<< "${INSTANCES[$instance]}"
    
    echo ""
    echo "📦 启动 $label ($instance)..."
    
    # 创建配置目录
    mkdir -p "$home_dir"
    
    # 创建配置文件
    cat > "$home_dir/config.yaml" << EOF
model:
  default: mimo-v2.5
  provider: xiaomi
  base_url: https://token-plan-sgp.xiaomimimo.com/v1

platforms:
  api_server:
    enabled: true
    extra:
      host: "127.0.0.1"
      port: $port
      model_name: "hermes-agent"

agent:
  max_turns: 90
  gateway_timeout: 1800

toolsets:
  - hermes-cli
EOF
    
    echo "   ✅ 配置文件已创建: $home_dir/config.yaml"
    
    # 启动实例（后台运行）
    HERMES_HOME="$home_dir" hermes gateway run &
    PID=$!
    
    echo "   ✅ 实例已启动 (PID: $PID, 端口: $port)"
    
    # 等待实例启动
    sleep 2
done

echo ""
echo "🎉 所有实例已启动！"
echo ""
echo "📋 实例状态："
for instance in "${!INSTANCES[@]}"; do
    IFS=':' read -r port home_dir label <<< "${INSTANCES[$instance]}"
    if curl -s "http://127.0.0.1:$port/health" > /dev/null 2>&1; then
        echo "   ✅ $label (端口 $port) - 运行中"
    else
        echo "   ❌ $label (端口 $port) - 未响应"
    fi
done

echo ""
echo "📋 下一步："
echo "   1. 测试路由: openclaw agent --local -m \"记录我的饮食习惯\""
echo "   2. 查看日志: tail -f ~/.hermes-*/logs/gateway.log"
echo "   3. 停止所有实例: pkill -f 'hermes gateway run'"
