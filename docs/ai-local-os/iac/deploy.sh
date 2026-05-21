#!/bin/bash

# AI-local-OS Docker 部署脚本
# 使用方法: ./deploy.sh [up|down|status|logs]

set -e

COMPOSE_FILE="docker-compose.yml"
PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "🚀 AI-local-OS Docker 部署"
echo "=========================="

# 检查 Docker 是否已安装
if ! command -v docker &> /dev/null; then
    echo "❌ Docker 未安装"
    exit 1
fi

if ! command -v docker compose &> /dev/null; then
    echo "❌ Docker Compose 未安装"
    exit 1
fi

echo "✅ Docker 已安装"

# 解析命令
ACTION=${1:-up}

case $ACTION in
    up|start)
        echo ""
        echo "📦 启动所有服务..."
        cd "$PROJECT_DIR"
        docker compose -f "$COMPOSE_FILE" up -d
        
        echo ""
        echo "✅ 服务已启动"
        echo ""
        echo "📋 服务状态:"
        docker compose -f "$COMPOSE_FILE" ps
        
        echo ""
        echo "📋 访问地址:"
        echo "   Gateway: http://127.0.0.1:8100"
        echo "   Hermes Dev: http://127.0.0.1:8002"
        echo "   Hermes Life: http://127.0.0.1:8003"
        echo "   Hermes Research: http://127.0.0.1:8004"
        ;;
        
    down|stop)
        echo ""
        echo "🛑 停止所有服务..."
        cd "$PROJECT_DIR"
        docker compose -f "$COMPOSE_FILE" down
        
        echo ""
        echo "✅ 服务已停止"
        ;;
        
    status|ps)
        echo ""
        echo "📋 服务状态:"
        cd "$PROJECT_DIR"
        docker compose -f "$COMPOSE_FILE" ps
        ;;
        
    logs|log)
        echo ""
        echo "📋 查看日志:"
        cd "$PROJECT_DIR"
        docker compose -f "$COMPOSE_FILE" logs -f
        ;;
        
    restart)
        echo ""
        echo "🔄 重启所有服务..."
        cd "$PROJECT_DIR"
        docker compose -f "$COMPOSE_FILE" restart
        
        echo ""
        echo "✅ 服务已重启"
        ;;
        
    *)
        echo "❌ 未知命令: $ACTION"
        echo ""
        echo "使用方法: ./deploy.sh [up|down|status|logs|restart]"
        exit 1
        ;;
esac
