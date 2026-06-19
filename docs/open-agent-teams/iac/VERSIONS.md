# Open-Agent-Teams 版本钉扎

> 记录所有依赖的版本号，确保可复现部署

## 核心组件版本

### Hermes Agent

| 组件 | 版本 | 说明 |
|------|------|------|
| hermes-agent | 0.14.0 | AI Agent 核心 |
| Python | 3.11 | 运行时 |
| OpenAI SDK | 2.24.0 | API 客户端 |

### openclaw CLI

| 组件 | 版本 | 说明 |
|------|------|------|
| openclaw | 2026.3.7 | CLI 工具 |
| Node.js | >= 20 | 运行时 |

### Open-Agent-Teams Gateway

| 组件 | 版本 | 说明 |
|------|------|------|
| Node.js | 20 | 运行时 |
| TypeScript | 5.3 | 开发语言 |
| tsx | 4.7 | 开发工具 |

## Docker 镜像版本

| 镜像 | 标签 | 说明 |
|------|------|------|
| python | 3.11-slim | Hermes 运行时 |
| node | 20-slim | Gateway 运行时 |

## 依赖版本

### Gateway 依赖 (package.json)

```json
{
  "dependencies": {
    "yaml": "^2.4.0"
  },
  "devDependencies": {
    "@types/node": "^20.11.0",
    "tsx": "^4.7.0",
    "typescript": "^5.3.0",
    "vitest": "^1.2.0"
  }
}
```

## 版本升级流程

### 1. 评估影响

- 检查变更日志
- 评估 breaking changes
- 测试兼容性

### 2. 更新版本

```bash
# 更新 package.json
npm outdated
npm update

# 更新 Docker 镜像
docker compose build --no-cache
```

### 3. 测试验证

```bash
# 运行测试
npm test

# 部署测试
docker compose up -d
./test-gateway.sh
```

### 4. 记录变更

更新本文档的版本表格

## 已知问题

### Hermes 0.14.0

- 需要 Python 3.10+
- 某些工具需要额外依赖

### openclaw 2026.3.7

- feishu 插件需要额外依赖
- 部分配置项已弃用

## 升级 Runbook

### 升级 Hermes

```bash
# 1. 备份数据
docker compose exec hermes-dev tar -czf /tmp/hermes-backup.tar.gz /root/.hermes

# 2. 停止服务
docker compose stop hermes-dev

# 3. 更新镜像
docker compose build hermes-dev

# 4. 启动服务
docker compose up -d hermes-dev

# 5. 验证
curl http://127.0.0.1:8002/health
```

### 升级 Gateway

```bash
# 1. 备份配置
cp gateway-config/config.yaml gateway-config/config.yaml.bak

# 2. 停止服务
docker compose stop gateway

# 3. 更新镜像
docker compose build gateway

# 4. 启动服务
docker compose up -d gateway

# 5. 验证
curl http://127.0.0.1:8100/health
```

### 回滚

```bash
# 1. 停止服务
docker compose down

# 2. 恢复配置
git checkout HEAD~1 -- docs/open-agent-teams/iac/

# 3. 重新部署
docker compose up -d
```

---

**最后更新**：2026-05-21
