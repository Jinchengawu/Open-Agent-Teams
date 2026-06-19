#!/bin/bash

# AI-local-OS 插件安装脚本
# 使用方法: ./setup-plugin.sh

set -e

echo "🔧 AI-local-OS 插件安装"
echo "========================"

# 检查 openclaw CLI 是否已安装
if ! command -v openclaw &> /dev/null; then
    echo "❌ openclaw CLI 未安装，请先安装 openclaw"
    exit 1
fi

echo "✅ openclaw CLI 已安装"

# 检查插件目录是否存在
PLUGIN_DIR="./packages/openclaw/plugins/ai-local-os-router"
if [ ! -d "$PLUGIN_DIR" ]; then
    echo "❌ 插件目录不存在: $PLUGIN_DIR"
    exit 1
fi

echo "✅ 插件目录存在"

# 安装插件（链接模式）
echo ""
echo "📦 安装插件..."
openclaw plugins install --link "$PLUGIN_DIR"
echo "   ✅ 插件安装成功"

# 启用插件
echo ""
echo "🔌 启用插件..."
openclaw plugins enable ai-local-os-router
echo "   ✅ 插件已启用"

# 验证插件
echo ""
echo "🔍 验证插件安装..."
openclaw plugins inspect ai-local-os-router --runtime

echo ""
echo "🎉 插件安装完成！"
echo ""
echo "📋 下一步："
echo "   1. 启动 Hermes Proxy: ./start-hermes.sh"
echo "   2. 验证 Hermes 运行: curl http://127.0.0.1:8002/v1/models"
echo "   3. 测试路由: openclaw agent \"帮我分析项目结构\""
