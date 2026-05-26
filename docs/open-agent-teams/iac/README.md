# Open-Agent-Teams IaC (Infrastructure as Code)

> 使用 Docker Compose 一键部署 Open-Agent-Teams 多实例环境

## 前置条件

- Docker Engine >= 20.10
- Docker Compose >= 2.0
- 至少 4GB 可用内存
- 至少 20GB 可用磁盘空间

## 快速开始

### 1. 启动所有服务

```bash
cd docs/open-agent-teams/iac
./deploy.sh up
```

### 2. 验证部署

```bash
# 检查服务状态
./deploy.sh status

# 测试 Gateway
curl http://127.0.0.1:8100/health

# 测试聊天补全
curl -X POST http://127.0.0.1:8100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model": "hermes-agent", "messages": [{"role": "user", "content": "你好"}]}'
```

### 3. 停止服务

```bash
./deploy.sh down
```

## 服务架构

```
┌─────────────────────────────────────────────────────────────┐
│                    Docker Network                          │
│                  (172.28.0.0/16)                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ hermes-dev  │  │ hermes-life │  │hermes-research│       │
│  │   :8002     │  │   :8003     │  │   :8004     │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│         │                │                │                 │
│         └────────────────┼────────────────┘                 │
│                          │                                  │
│                  ┌───────▼───────┐                          │
│                  │    Gateway    │                          │
│                  │    :8100      │                          │
│                  └───────────────┘                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## 服务说明

| 服务 | 端口 | 说明 |
|------|------|------|
| hermes-dev | 8002 | 编程开发心智 |
| hermes-life | 8003 | 个人生活心智 |
| hermes-research | 8004 | 行业研究心智 |
| gateway | 8100 | Open-Agent-Teams 薄网关 |

## 配置

### 环境变量

在 `docker-compose.yml` 中可以配置以下环境变量：

| 变量 | 默认值 | 说明 |
|------|--------|------|
| AI_LOCAL_OS_HOST | 0.0.0.0 | Gateway 监听地址 |
| AI_LOCAL_OS_PORT | 8100 | Gateway 监听端口 |
| AI_LOCAL_OS_AUTH_ENABLED | false | 是否启用鉴权 |
| AI_LOCAL_OS_API_KEY | - | API Key |

### 配置文件

- Hermes 实例配置：`./hermes-{dev,life,research}-config/config.yaml`
- Gateway 配置：`./gateway-config/config.yaml`

## 网络策略

- 所有服务运行在 `hermes-network` Docker 网络中
- 只有 Gateway 暴露到宿主机（端口 8100）
- Hermes 实例仅在内部网络可达
- 外部访问必须通过 Gateway

## 数据持久化

使用 Docker Volumes 持久化数据：

- `hermes-dev-data`：开发实例数据
- `hermes-life-data`：生活实例数据
- `hermes-research-data`：研究实例数据
- `gateway-logs`：网关日志

## 升级

### 升级 Hermes 版本

```bash
# 修改 Dockerfile 中的 hermes-agent 版本
# 重新构建
docker compose build hermes-dev hermes-life hermes-research
docker compose up -d
```

### 升级 Gateway 版本

```bash
# 修改 packages/gateway/package.json 中的依赖版本
# 重新构建
docker compose build gateway
docker compose up -d
```

## 故障排除

### 服务无法启动

```bash
# 查看日志
docker compose logs hermes-dev
docker compose logs gateway

# 检查资源
docker stats
```

### 端口被占用

```bash
# 检查端口占用
lsof -i :8002
lsof -i :8003
lsof -i :8004
lsof -i :8100

# 修改 docker-compose.yml 中的端口映射
```

### 内存不足

```bash
# 检查 Docker 资源限制
docker system df

# 清理未使用的资源
docker system prune -a
```

## 开发模式

### 本地开发

```bash
# 使用本地 Hermes 实例
./start-all-instances.sh

# 使用本地 Gateway
./start-gateway.sh
```

### Docker 开发

```bash
# 构建并启动
docker compose build
docker compose up -d

# 查看日志
docker compose logs -f

# 进入容器调试
docker exec -it hermes-dev bash
```

## 相关文档

- [Phase 3 网关规格](../../specs/2026-05-21-gateway-spec.md)
- [设计规格](../../specs/2026-04-26-open-agent-teams-design.md)
- [集成移交](../../integration-handoff.md)

---

**最后更新**：2026-05-21
