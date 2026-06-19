#!/bin/bash

# AI-local-OS Hook 安装脚本
# 使用方法: ./setup-hook.sh

set -e

echo "🔧 AI-local-OS Hook 安装"
echo "========================"

# 检查 openclaw CLI 是否已安装
if ! command -v openclaw &> /dev/null; then
    echo "❌ openclaw CLI 未安装，请先安装 openclaw"
    exit 1
fi

echo "✅ openclaw CLI 已安装"

# 检查 Hook 目录是否存在
HOOK_DIR="./packages/openclaw/hooks/ai-local-os-router"
if [ ! -d "$HOOK_DIR" ]; then
    echo "❌ Hook 目录不存在: $HOOK_DIR"
    exit 1
fi

echo "✅ Hook 目录存在"

# 复制 Hook 到 openclaw hooks 目录
echo ""
echo "📦 安装 Hook..."
OPENCLAW_HOOKS_DIR="$HOME/.openclaw/hooks"
mkdir -p "$OPENCLAW_HOOKS_DIR"
cp -r "$HOOK_DIR" "$OPENCLAW_HOOKS_DIR/"
echo "   ✅ Hook 已复制到 $OPENCLAW_HOOKS_DIR"

# 验证 Hook 安装
echo ""
echo "🔍 验证 Hook 安装..."
if [ -f "$OPENCLAW_HOOKS_DIR/ai-local-os-router/HOOK.md" ]; then
    echo "   ✅ Hook 文件存在"
else
    echo "   ❌ Hook 文件不存在"
    exit 1
fi

echo ""
echo "🎉 Hook 安装完成！"
echo ""
echo "📋 下一步："
echo "   1. 启动 Hermes API Server: ./start-hermes.sh"
echo "   2. 测试本地 Agent: openclaw agent --local -m \"帮我分析项目结构\""
echo ""
echo "⚠️  注意："
echo "   - 测试时使用 --local 参数运行本地 Agent"
echo "   - Hermes API Server 需要保持运行"
