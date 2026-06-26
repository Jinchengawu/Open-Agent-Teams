# Open-Agent-Teams 升级指南

> 如何检查和升级 Open-Agent-Teams 到最新版本

## 快速升级

```bash
# 检查是否有新版本
./packages/upgrade/upgrade.sh check

# 执行升级
./packages/upgrade/upgrade.sh upgrade

# 查看版本信息
./packages/upgrade/upgrade.sh version
```

## 升级流程

### 1. 检查版本

```bash
./packages/upgrade/upgrade.sh check
```

输出示例：
```
📋 版本检查

  当前版本: 0.3.0
  远程版本: 0.4.0

  📦 有新版本可用: 0.4.0
```

### 2. 备份配置

升级脚本会自动备份以下内容：

- `~/.hermes-gateway/` - Gateway 配置和日志
- `~/.open-agent-teams/config.yaml` - 本地配置

备份位置：`~/.open-agent-teams-backup/YYYYMMDD_HHMMSS/`

### 3. 执行升级

```bash
./packages/upgrade/upgrade.sh upgrade
```

升级过程：
1. 备份当前配置
2. 拉取最新代码
3. 安装依赖（如果需要）
4. 运行迁移脚本（如果需要）
5. 更新版本文件

### 4. 验证升级

```bash
# 检查版本
./packages/upgrade/upgrade.sh version

# 测试功能
bash scripts/run-tests.sh

# 检查服务状态
./deploy.sh status
```

## 版本号规则

采用 [Semantic Versioning](https://semver.org/)：

- **MAJOR**：不兼容的 API 变更
- **MINOR**：向后兼容的功能性新增
- **PATCH**：向后兼容的问题修复

示例：
- `0.4.0` → `0.5.0`：新增功能
- `0.5.0` → `0.5.1`：问题修复
- `0.5.1` → `1.0.0`：重大更新

## 自动升级

### 设置定时检查

```bash
# 添加 crontab 任务
crontab -e

# 每天检查一次更新
0 9 * * * /path/to/Open-Agent-Teams/packages/upgrade/upgrade.sh check >> ~/.open-agent-teams-upgrade.log 2>&1
```

### 升级通知

升级脚本会输出以下状态：

- ✅ `已是最新版本` - 无需操作
- 📦 `有新版本可用` - 建议升级
- ⚠️ `无法获取远程版本` - 网络问题

## 回滚

如果升级后出现问题，可以回滚到备份版本：

```bash
# 查看备份
ls ~/.open-agent-teams-backup/

# 恢复配置
cp -r ~/.open-agent-teams-backup/YYYYMMDD_HHMMSS/.hermes-gateway ~/.hermes-gateway

# 重新部署
./deploy.sh restart
```

## 故障排除

### 无法获取远程版本

```bash
# 检查网络连接
curl -I https://github.com

# 检查 Git 配置
git remote -v
```

### 升级失败

```bash
# 查看升级日志
cat ~/.open-agent-teams-upgrade.log

# 手动拉取
git pull origin main

# 重新安装依赖
npm install
```

### 配置不兼容

```bash
# 查看配置迁移日志
cat migrate.log

# 手动更新配置
# 参考 docs/open-agent-teams/ 目录下的配置模板
```

## 版本历史

详见 [CHANGELOG.md](./CHANGELOG.md)

---

**最后更新**：2026-05-21
