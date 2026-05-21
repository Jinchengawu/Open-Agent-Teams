#!/bin/bash

# AI-local-OS 验证脚本
# 使用方法: ./verify-setup.sh

set -e

echo "🔍 AI-local-OS 设置验证"
echo "========================"

# 检查 Hermes API Server 是否运行
echo ""
echo "1️⃣ 检查 Hermes API Server 状态..."
if curl -s http://127.0.0.1:8002/health > /dev/null 2>&1; then
    echo "   ✅ Hermes API Server 正在运行 (端口 8002)"
    
    # 获取健康检查详情
    echo ""
    echo "   📋 健康检查详情:"
    curl -s http://127.0.0.1:8002/health | head -20
else
    echo "   ❌ Hermes API Server 未运行"
    echo "   请先启动: ./start-hermes.sh"
    exit 1
fi

# 检查可用模型
echo ""
echo "2️⃣ 检查可用模型..."
if curl -s http://127.0.0.1:8002/v1/models > /dev/null 2>&1; then
    echo "   ✅ 模型列表:"
    curl -s http://127.0.0.1:8002/v1/models | grep -o '"id":"[^"]*"' | sed 's/"id":"//;s/"//' | head -5
else
    echo "   ⚠️  无法获取模型列表"
fi

# 检查 OpenClaw 插件状态
echo ""
echo "3️⃣ 检查 OpenClaw 插件状态..."
if openclaw plugins list 2>/dev/null | grep -q "ai-local-os-router"; then
    echo "   ✅ ai-local-os-router 插件已安装"
else
    echo "   ❌ ai-local-os-router 插件未安装"
    echo "   请先安装: ./setup-plugin.sh"
    exit 1
fi

# 测试 API 调用
echo ""
echo "4️⃣ 测试 Hermes API 调用..."
TEST_RESPONSE=$(curl -s -X POST http://127.0.0.1:8002/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "hermes-agent",
    "messages": [{"role": "user", "content": "你好，请简单回复"}],
    "max_tokens": 50
  }' 2>&1)

if echo "$TEST_RESPONSE" | grep -q "choices"; then
    echo "   ✅ API 调用成功"
    echo "   响应: $(echo "$TEST_RESPONSE" | grep -o '"content":"[^"]*"' | head -1 | sed 's/"content":"//;s/"//')"
else
    echo "   ⚠️  API 调用失败"
    echo "   响应: $TEST_RESPONSE"
fi

echo ""
echo "🎉 验证完成！"
echo ""
echo "📋 使用说明："
echo "   1. 确保 Hermes API Server 正在运行: ./start-hermes.sh"
echo "   2. 测试路由: openclaw agent \"帮我分析项目结构\""
echo "   3. 查看日志: openclaw logs --follow"
