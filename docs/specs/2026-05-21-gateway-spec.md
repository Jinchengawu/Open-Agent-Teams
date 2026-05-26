# Open-Agent-Teams 薄网关规格（Phase 3）

> **需求 ID**：REQ-2026-0426-open-agent-teams-phase3  
> **当前状态**：设计中  
> **目标**：在 OpenClaw 与 Hermes 实例之间增加本地轻量网关，统一鉴权、审计日志、熔断与限流

---

## 1. 目标与非目标

### 1.1 目标

- **统一入口**：所有请求通过网关转发，不再直接调用 Hermes 实例
- **鉴权**：支持 API Key 认证，保护 Hermes 实例
- **审计日志**：记录所有请求和响应，便于追踪和调试
- **熔断与限流**：防止故障扩散，保护系统稳定性
- **健康检查**：监控所有后端实例状态

### 1.2 非目标

- 不实现复杂的负载均衡（当前阶段）
- 不实现 HTTPS/TLS（本地开发环境）
- 不实现用户管理（单用户场景）

---

## 2. 架构设计

```
用户请求
    │
    ▼
┌─────────────────────────────────┐
│       Open-Agent-Teams Gateway       │
│  (端口: 8100)                   │
├─────────────────────────────────┤
│  • 鉴权 (API Key)              │
│  • 路由 (标签匹配)             │
│  • 限流 (滑动窗口)             │
│  • 熔断 (断路器模式)           │
│  • 审计日志 (结构化)           │
└───────────────┬─────────────────┘
                │
    ┌───────────┼───────────┐
    │           │           │
    ▼           ▼           ▼
┌───────┐  ┌───────┐  ┌───────┐
│Hermes │  │Hermes │  │Hermes │
│ :8002 │  │ :8003 │  │ :8004 │
│  dev  │  │ life  │  │research│
└───────┘  └───────┘  └───────┘
```

---

## 3. API 设计

### 3.1 基础端点

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/health` | 网关健康检查 |
| GET | `/health/instances` | 所有实例状态 |
| POST | `/v1/chat/completions` | OpenAI 兼容聊天接口 |
| GET | `/v1/models` | 可用模型列表 |
| GET | `/logs` | 查询审计日志（管理员） |

### 3.2 请求格式

```json
POST /v1/chat/completions
{
  "model": "hermes-agent",
  "messages": [{"role": "user", "content": "你好"}],
  "instance": "hermes-dev",  // 可选：指定实例
  "stream": false
}
```

### 3.3 响应格式

```json
{
  "id": "chatcmpl-xxx",
  "object": "chat.completion",
  "created": 1234567890,
  "model": "hermes-agent",
  "choices": [{
    "index": 0,
    "message": {"role": "assistant", "content": "..."},
    "finish_reason": "stop"
  }],
  "usage": {"prompt_tokens": 100, "completion_tokens": 50},
  "instance": "hermes-dev",
  "latency_ms": 1234
}
```

---

## 4. 鉴权

### 4.1 API Key 认证

- 请求头：`Authorization: Bearer <api-key>`
- 环境变量：`AI_LOCAL_OS_API_KEY`
- 配置文件：`~/.hermes-gateway/config.yaml`

### 4.2 无认证模式（开发环境）

- 设置 `AI_LOCAL_OS_AUTH_ENABLED=false`
- 跳过鉴权检查

---

## 5. 路由规则

### 5.1 基于标签匹配

```yaml
routing:
  rules:
    - tags: ["dev", "code", "debug"]
      instance: "hermes-dev"
    - tags: ["life", "health", "habit"]
      instance: "hermes-life"
    - tags: ["research", "market", "trend"]
      instance: "hermes-research"
  default: "hermes-dev"
```

### 5.2 基于意图分析（复用 Phase 2 逻辑）

- 关键词匹配
- 评分机制
- 实例选择

---

## 6. 限流

### 6.1 配置

```yaml
rate_limit:
  enabled: true
  requests_per_minute: 60
  burst_size: 10
```

### 6.2 实现

- 滑动窗口算法
- 每个实例独立限流
- 超限返回 429 Too Many Requests

---

## 7. 熔断器

### 7.1 配置

```yaml
circuit_breaker:
  enabled: true
  failure_threshold: 3
  cool_down_seconds: 120
  half_open_max_requests: 1
```

### 7.2 状态转换

```
CLOSED → (失败达阈值) → OPEN → (冷却期结束) → HALF_OPEN → (成功) → CLOSED
                                                      ↓
                                                    (失败) → OPEN
```

---

## 8. 审计日志

### 8.1 日志格式

```json
{
  "timestamp": "2026-05-21T15:00:00Z",
  "request_id": "req-xxx",
  "method": "POST",
  "path": "/v1/chat/completions",
  "instance": "hermes-dev",
  "status": 200,
  "latency_ms": 1234,
  "prompt_tokens": 100,
  "completion_tokens": 50,
  "error": null
}
```

### 8.2 日志存储

- 文件：`~/.hermes-gateway/logs/audit.log`
- 格式：JSON Lines
- 轮转：按大小或时间

---

## 9. 配置文件

```yaml
# ~/.hermes-gateway/config.yaml
server:
  host: "127.0.0.1"
  port: 8100

auth:
  enabled: true
  api_key: "${AI_LOCAL_OS_API_KEY}"

instances:
  - id: hermes-dev
    url: "http://127.0.0.1:8002"
    tags: ["dev", "code", "debug"]
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
```

---

## 10. 实现计划

### M3.1: 网关规格（本文档）
- ✅ 完成

### M3.2: 网关 MVP
- 创建 Node.js/TypeScript 项目
- 实现 HTTP 服务器
- 实现路由转发
- 实现健康检查

### M3.3: 结构化日志和限流
- 实现审计日志
- 实现限流中间件
- 实现熔断器

### M3.4: 集成测试和文档
- 编写测试用例
- 更新 README
- 部署脚本

---

## 11. 技术栈

- **运行时**：Node.js >= 20
- **语言**：TypeScript
- **HTTP 框架**：Fastify 或原生 http
- **日志**：pino
- **测试**：vitest

---

**文档版本**：v1.0  
**最后更新**：2026-05-21
