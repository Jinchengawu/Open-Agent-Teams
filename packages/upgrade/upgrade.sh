#!/bin/bash

# AI-local-OS 版本检查和升级脚本
# 使用方法: ./upgrade.sh [check|upgrade|version]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VERSION_FILE="$SCRIPT_DIR/VERSION"
REMOTE_VERSION_URL="https://raw.githubusercontent.com/Jinchengawu/AI-local-OS/main/VERSION"
CHANGELOG_URL="https://raw.githubusercontent.com/Jinchengawu/AI-local-OS/main/CHANGELOG.md"

echo "🔄 AI-local-OS 版本管理"
echo "======================"

# 获取当前版本
get_current_version() {
    if [ -f "$VERSION_FILE" ]; then
        cat "$VERSION_FILE"
    else
        echo "0.0.0"
    fi
}

# 获取远程版本
get_remote_version() {
    curl -s "$REMOTE_VERSION_URL" 2>/dev/null || echo "unknown"
}

# 检查版本
check_version() {
    echo "📋 版本检查"
    echo ""
    
    current=$(get_current_version)
    remote=$(get_remote_version)
    
    echo "  当前版本: $current"
    echo "  远程版本: $remote"
    echo ""
    
    if [ "$remote" == "unknown" ]; then
        echo "  ⚠️  无法获取远程版本"
        return 1
    fi
    
    if [ "$current" == "$remote" ]; then
        echo "  ✅ 已是最新版本"
        return 0
    else
        echo "  📦 有新版本可用: $remote"
        return 2
    fi
}

# 执行升级
do_upgrade() {
    echo "⬆️  执行升级"
    echo ""
    
    current=$(get_current_version)
    remote=$(get_remote_version)
    
    if [ "$current" == "$remote" ]; then
        echo "  ✅ 已是最新版本，无需升级"
        return 0
    fi
    
    echo "  📥 下载新版本..."
    
    # 备份当前配置
    echo "  💾 备份配置..."
    backup_dir="$HOME/.ai-local-os-backup/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$backup_dir"
    
    if [ -d "$HOME/.hermes-gateway" ]; then
        cp -r "$HOME/.hermes-gateway" "$backup_dir/"
    fi
    
    if [ -f "$HOME/.ai-local-os/config.yaml" ]; then
        cp "$HOME/.ai-local-os/config.yaml" "$backup_dir/"
    fi
    
    echo "  ✅ 配置已备份到: $backup_dir"
    
    # 拉取最新代码
    echo "  📥 拉取最新代码..."
    cd "$SCRIPT_DIR"
    git pull origin main
    
    # 更新版本文件
    echo "$remote" > "$VERSION_FILE"
    
    # 安装依赖（如果有）
    if [ -f "package.json" ]; then
        echo "  📦 安装依赖..."
        npm install
    fi
    
    # 运行迁移脚本（如果有）
    if [ -f "migrate.sh" ]; then
        echo "  🔄 运行迁移..."
        ./migrate.sh
    fi
    
    echo ""
    echo "  ✅ 升级完成！"
    echo "  📋 当前版本: $remote"
    echo ""
    echo "  💡 建议操作："
    echo "    1. 检查配置兼容性"
    echo "    2. 重启服务: ./start-all-instances.sh"
    echo "    3. 验证功能: ./test-gateway.sh"
}

# 显示版本信息
show_version() {
    echo "📋 版本信息"
    echo ""
    
    current=$(get_current_version)
    echo "  版本: $current"
    echo "  仓库: https://github.com/Jinchengawu/AI-local-OS"
    echo ""
    
    # 显示最近更新
    if [ -f "CHANGELOG.md" ]; then
        echo "📋 最近更新："
        head -20 "CHANGELOG.md"
    fi
}

# 主函数
main() {
    case ${1:-check} in
        check)
            check_version
            ;;
        upgrade|update)
            do_upgrade
            ;;
        version|ver)
            show_version
            ;;
        *)
            echo "使用方法: $0 [check|upgrade|version]"
            echo ""
            echo "命令："
            echo "  check    - 检查是否有新版本"
            echo "  upgrade  - 执行升级"
            echo "  version  - 显示版本信息"
            exit 1
            ;;
    esac
}

main "$@"
