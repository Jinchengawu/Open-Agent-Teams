#!/bin/bash

# Open-Agent-Teams 自动化测试脚本
# 使用方法: ./run-tests.sh [all|gateway|frontend|backend|testing|devops]

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPORT_DIR="$SCRIPT_DIR/test-reports"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
REPORT_FILE="$REPORT_DIR/test-report-$TIMESTAMP.md"

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# 创建报告目录
mkdir -p "$REPORT_DIR"

# 初始化报告
init_report() {
    cat > "$REPORT_FILE" << EOF
# Open-Agent-Teams 测试报告

**测试时间**：$(date)
**测试环境**：$(uname -a)

---

## 测试执行记录

EOF
}

# 追加测试结果到报告
append_result() {
    local test_name="$1"
    local status="$2"
    local details="$3"
    
    echo "| $test_name | $status | $details |" >> "$REPORT_FILE"
}

# 测试 Gateway
test_gateway() {
    echo -e "${BLUE}🧪 测试 Gateway...${NC}"
    
    # 测试 1: 健康检查
    echo -e "${YELLOW}  测试 1: 健康检查${NC}"
    RESPONSE=$(curl -s http://127.0.0.1:8200/health 2>/dev/null)
    if echo "$RESPONSE" | grep -q '"status":"ok"'; then
        echo -e "  ${GREEN}✅ 通过${NC}"
        append_result "Gateway 健康检查" "✅ 通过" "返回正常"
    else
        echo -e "  ${RED}❌ 失败${NC}"
        append_result "Gateway 健康检查" "❌ 失败" "无响应"
    fi
    
    # 测试 2: Agent 状态
    echo -e "${YELLOW}  测试 2: Agent 状态${NC}"
    RESPONSE=$(curl -s http://127.0.0.1:8200/health/agents 2>/dev/null)
    if echo "$RESPONSE" | grep -q '"agents"'; then
        echo -e "  ${GREEN}✅ 通过${NC}"
        append_result "Agent 状态查询" "✅ 通过" "返回 Agent 列表"
    else
        echo -e "  ${RED}❌ 失败${NC}"
        append_result "Agent 状态查询" "❌ 失败" "无响应"
    fi
    
    # 测试 3: 前端路由
    echo -e "${YELLOW}  测试 3: 前端任务路由${NC}"
    RESPONSE=$(curl -s -X POST http://127.0.0.1:8200/v1/chat/completions \
      -H "Content-Type: application/json" \
      -d '{"model":"open-agent-teams","messages":[{"role":"user","content":"创建 React 组件"}]}' 2>/dev/null)
    if echo "$RESPONSE" | grep -q '"agent":"dev-frontend"'; then
        echo -e "  ${GREEN}✅ 通过${NC}"
        append_result "前端任务路由" "✅ 通过" "路由到 dev-frontend"
    else
        echo -e "  ${RED}❌ 失败${NC}"
        append_result "前端任务路由" "❌ 失败" "路由错误"
    fi
    
    # 测试 4: 后端路由
    echo -e "${YELLOW}  测试 4: 后端任务路由${NC}"
    RESPONSE=$(curl -s -X POST http://127.0.0.1:8200/v1/chat/completions \
      -H "Content-Type: application/json" \
      -d '{"model":"open-agent-teams","messages":[{"role":"user","content":"设计数据库表结构"}]}' 2>/dev/null)
    if echo "$RESPONSE" | grep -q '"agent":"dev-backend"'; then
        echo -e "  ${GREEN}✅ 通过${NC}"
        append_result "后端任务路由" "✅ 通过" "路由到 dev-backend"
    else
        echo -e "  ${RED}❌ 失败${NC}"
        append_result "后端任务路由" "❌ 失败" "路由错误"
    fi
}

# 测试前端 Agent
test_frontend() {
    echo -e "${BLUE}🧪 测试前端 Agent...${NC}"
    
    # 测试 1: React 组件创建
    echo -e "${YELLOW}  测试 1: React 组件创建${NC}"
    RESPONSE=$(curl -s -X POST http://127.0.0.1:8201/v1/chat/completions \
      -H "Content-Type: application/json" \
      -d '{"model":"hermes-agent","messages":[{"role":"user","content":"创建 Button 组件"}]}' 2>/dev/null)
    if echo "$RESPONSE" | grep -q "React"; then
        echo -e "  ${GREEN}✅ 通过${NC}"
        append_result "React 组件创建" "✅ 通过" "返回组件代码"
    else
        echo -e "  ${RED}❌ 失败${NC}"
        append_result "React 组件创建" "❌ 失败" "无响应"
    fi
    
    # 测试 2: TypeScript 类型
    echo -e "${YELLOW}  测试 2: TypeScript 类型${NC}"
    RESPONSE=$(curl -s -X POST http://127.0.0.1:8201/v1/chat/completions \
      -H "Content-Type: application/json" \
      -d '{"model":"hermes-agent","messages":[{"role":"user","content":"定义 User 类型"}]}' 2>/dev/null)
    if echo "$RESPONSE" | grep -q "interface"; then
        echo -e "  ${GREEN}✅ 通过${NC}"
        append_result "TypeScript 类型" "✅ 通过" "返回类型定义"
    else
        echo -e "  ${RED}❌ 失败${NC}"
        append_result "TypeScript 类型" "❌ 失败" "无响应"
    fi
}

# 测试后端 Agent
test_backend() {
    echo -e "${BLUE}🧪 测试后端 Agent...${NC}"
    
    # 测试 1: API 路由
    echo -e "${YELLOW}  测试 1: API 路由创建${NC}"
    RESPONSE=$(curl -s -X POST http://127.0.0.1:8202/v1/chat/completions \
      -H "Content-Type: application/json" \
      -d '{"model":"hermes-agent","messages":[{"role":"user","content":"创建用户 API"}]}' 2>/dev/null)
    if echo "$RESPONSE" | grep -q "router"; then
        echo -e "  ${GREEN}✅ 通过${NC}"
        append_result "API 路由创建" "✅ 通过" "返回路由代码"
    else
        echo -e "  ${RED}❌ 失败${NC}"
        append_result "API 路由创建" "❌ 失败" "无响应"
    fi
    
    # 测试 2: 数据库 Schema
    echo -e "${YELLOW}  测试 2: 数据库 Schema${NC}"
    RESPONSE=$(curl -s -X POST http://127.0.0.1:8202/v1/chat/completions \
      -H "Content-Type: application/json" \
      -d '{"model":"hermes-agent","messages":[{"role":"user","content":"设计用户表"}]}' 2>/dev/null)
    if echo "$RESPONSE" | grep -q "model"; then
        echo -e "  ${GREEN}✅ 通过${NC}"
        append_result "数据库 Schema" "✅ 通过" "返回 Schema"
    else
        echo -e "  ${RED}❌ 失败${NC}"
        append_result "数据库 Schema" "❌ 失败" "无响应"
    fi
}

# 测试测试 Agent
test_testing() {
    echo -e "${BLUE}🧪 测试测试 Agent...${NC}"
    
    # 测试 1: 单元测试
    echo -e "${YELLOW}  测试 1: 单元测试编写${NC}"
    RESPONSE=$(curl -s -X POST http://127.0.0.1:8203/v1/chat/completions \
      -H "Content-Type: application/json" \
      -d '{"model":"hermes-agent","messages":[{"role":"user","content":"编写 add 函数测试"}]}' 2>/dev/null)
    if echo "$RESPONSE" | grep -q "describe\|it\|test"; then
        echo -e "  ${GREEN}✅ 通过${NC}"
        append_result "单元测试编写" "✅ 通过" "返回测试代码"
    else
        echo -e "  ${RED}❌ 失败${NC}"
        append_result "单元测试编写" "❌ 失败" "无响应"
    fi
    
    # 测试 2: E2E 测试
    echo -e "${YELLOW}  测试 2: E2E 测试编写${NC}"
    RESPONSE=$(curl -s -X POST http://127.0.0.1:8203/v1/chat/completions \
      -H "Content-Type: application/json" \
      -d '{"model":"hermes-agent","messages":[{"role":"user","content":"编写登录测试"}]}' 2>/dev/null)
    if echo "$RESPONSE" | grep -q "test\|expect"; then
        echo -e "  ${GREEN}✅ 通过${NC}"
        append_result "E2E 测试编写" "✅ 通过" "返回测试代码"
    else
        echo -e "  ${RED}❌ 失败${NC}"
        append_result "E2E 测试编写" "❌ 失败" "无响应"
    fi
}

# 测试 DevOps Agent
test_devops() {
    echo -e "${BLUE}🧪 测试 DevOps Agent...${NC}"
    
    # 测试 1: Docker 配置
    echo -e "${YELLOW}  测试 1: Docker 配置${NC}"
    RESPONSE=$(curl -s -X POST http://127.0.0.1:8204/v1/chat/completions \
      -H "Content-Type: application/json" \
      -d '{"model":"hermes-agent","messages":[{"role":"user","content":"创建 Dockerfile"}]}' 2>/dev/null)
    if echo "$RESPONSE" | grep -q "FROM\|RUN\|COPY"; then
        echo -e "  ${GREEN}✅ 通过${NC}"
        append_result "Docker 配置" "✅ 通过" "返回 Dockerfile"
    else
        echo -e "  ${RED}❌ 失败${NC}"
        append_result "Docker 配置" "❌ 失败" "无响应"
    fi
    
    # 测试 2: CI/CD 配置
    echo -e "${YELLOW}  测试 2: CI/CD 配置${NC}"
    RESPONSE=$(curl -s -X POST http://127.0.0.1:8204/v1/chat/completions \
      -H "Content-Type: application/json" \
      -d '{"model":"hermes-agent","messages":[{"role":"user","content":"创建 GitHub Actions"}]}' 2>/dev/null)
    if echo "$RESPONSE" | grep -q "github\|actions\|workflow"; then
        echo -e "  ${GREEN}✅ 通过${NC}"
        append_result "CI/CD 配置" "✅ 通过" "返回 Actions 配置"
    else
        echo -e "  ${RED}❌ 失败${NC}"
        append_result "CI/CD 配置" "❌ 失败" "无响应"
    fi
}

# 生成测试报告
generate_report() {
    local total=$1
    local passed=$2
    local failed=$((total - passed))
    
    cat >> "$REPORT_FILE" << EOF

---

## 测试结果汇总

| 项目 | 数值 |
|------|------|
| 总用例数 | $total |
| 通过 | $passed |
| 失败 | $failed |
| 通过率 | $(echo "scale=2; $passed * 100 / $total" | bc)% |

---

**测试完成时间**：$(date)
**测试状态**：$([ $failed -eq 0 ] && echo "✅ 全部通过" || echo "❌ 存在失败")
EOF

    echo ""
    echo -e "${BLUE}📋 测试报告已生成: $REPORT_FILE${NC}"
}

# 主函数
main() {
    local test_type=${1:-all}
    
    echo -e "${BLUE}🚀 Open-Agent-Teams 自动化测试${NC}"
    echo "========================"
    echo ""
    
    init_report
    
    local total=0
    local passed=0
    
    case $test_type in
        gateway)
            test_gateway
            total=4
            passed=$(grep -c "✅ 通过" "$REPORT_FILE" || echo 0)
            ;;
        frontend)
            test_frontend
            total=2
            passed=$(grep -c "✅ 通过" "$REPORT_FILE" || echo 0)
            ;;
        backend)
            test_backend
            total=2
            passed=$(grep -c "✅ 通过" "$REPORT_FILE" || echo 0)
            ;;
        testing)
            test_testing
            total=2
            passed=$(grep -c "✅ 通过" "$REPORT_FILE" || echo 0)
            ;;
        devops)
            test_devops
            total=2
            passed=$(grep -c "✅ 通过" "$REPORT_FILE" || echo 0)
            ;;
        all)
            test_gateway
            test_frontend
            test_backend
            test_testing
            test_devops
            total=13
            passed=$(grep -c "✅ 通过" "$REPORT_FILE" || echo 0)
            ;;
        *)
            echo -e "${RED}未知测试类型: $test_type${NC}"
            echo "使用方法: $0 [all|gateway|frontend|backend|testing|devops]"
            exit 1
            ;;
    esac
    
    generate_report $total $passed
}

main "$@"
