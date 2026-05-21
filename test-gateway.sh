#!/bin/bash

# AI-local-OS Gateway 测试脚本
# 使用方法: ./test-gateway.sh

set -e

GATEWAY_URL="http://127.0.0.1:8100"

echo "🧪 AI-local-OS Gateway 测试"
echo "=========================="

# 测试 1: 健康检查
echo ""
echo "1️⃣ 测试健康检查..."
if curl -s "$GATEWAY_URL/health" > /dev/null 2>&1; then
    echo "   ✅ Gateway 运行正常"
    curl -s "$GATEWAY_URL/health" | head -20
else
    echo "   ❌ Gateway 未运行"
    echo "   请先启动: ./start-gateway.sh"
    exit 1
fi

# 测试 2: 实例状态
echo ""
echo "2️⃣ 测试实例状态..."
if curl -s "$GATEWAY_URL/health/instances" > /dev/null 2>&1; then
    echo "   ✅ 实例状态查询成功"
    curl -s "$GATEWAY_URL/health/instances" | head -30
else
    echo "   ⚠️  无法获取实例状态"
fi

# 测试 3: 聊天补全（开发相关）
echo ""
echo "3️⃣ 测试聊天补全（开发相关）..."
RESPONSE=$(curl -s -X POST "$GATEWAY_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "hermes-agent",
    "messages": [{"role": "user", "content": "你好，请简单回复"}],
    "max_tokens": 50
  }' 2>&1)

if echo "$RESPONSE" | grep -q "choices"; then
    echo "   ✅ 聊天补全成功"
    echo "   响应: $(echo "$RESPONSE" | grep -o '"content":"[^"]*"' | head -1 | sed 's/"content":"//;s/"//')"
else
    echo "   ⚠️  聊天补全失败"
    echo "   响应: $RESPONSE"
fi

# 测试 4: 路由到开发实例
echo ""
echo "4️⃣ 测试路由到开发实例..."
RESPONSE=$(curl -s -X POST "$GATEWAY_URL/v1/chat/completions" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "hermes-agent",
    "messages": [{"role": "user", "content": "帮我分析代码结构"}],
    "max_tokens": 100
  }' 2>&1)

if echo "$RESPONSE" | grep -q "hermes-dev"; then
    echo "   ✅ 正确路由到 hermes-dev"
else
    echo "   ⚠️  路由结果:"
    echo "   $RESPONSE" | head -5
fi

echo ""
echo "🎉 测试完成！"
echo ""
echo "📋 Gateway 端点:"
echo "   GET  $GATEWAY_URL/health"
echo "   GET  $GATEWAY_URL/health/instances"
echo "   POST $GATEWAY_URL/v1/chat/completions"
