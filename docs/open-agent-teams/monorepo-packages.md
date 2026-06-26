# Node / pnpm 多包工作区（Open Multi-Agent + Hermes 纳管）

本仓库根目录已启用 **pnpm workspace**，以 **Node.js** 为工程基线，将两侧运行时纳入统一依赖与脚本入口。

## 布局

| 包名 | 路径 | 说明 |
| --- | --- | --- |
| `open-agent-teams` | `/package.json` | 工作区根；聚合脚本 |
| `@open-agent-teams/core` | `packages/core/` | 共享 Agent Teams 协同抽象、Pipeline、Knowledge、Kanban 与 Gateway 支撑能力 |
| `@open-agent-teams/gateway` | `packages/gateway/` | HTTP API Gateway 与统一入口 |
| `@open-agent-teams/dashboard` | `packages/dashboard/` | 可观测 Dashboard、Kanban、Pipeline、Knowledge、Agents 等界面 |
| `@open-agent-teams/hermes-agent` | `packages/hermes-agent/` | **无** Hermes 核心 npm 依赖；提供 `bootstrap`（官方 curl 安装）与 `doctor` |

## 命令（在仓库根）

```bash
pnpm install

# Hermes Agent（官方脚本 + 本机 PATH）
pnpm hermes:install-help   # 仅打印官方安装命令
pnpm hermes:bootstrap      # 执行 curl | bash（需网络与用户确认）
pnpm hermes:doctor         # 检测是否已安装 hermes CLI
```

## Node 版本

- **当前声明**：根与子包 `engines` 为 **≥ 22.17**（与常见 CI 对齐）。  
- **推荐**：Node **≥ 22.19** 或 **24 LTS**，以与当前 Dashboard/Gateway 工具链保持一致。
- 根目录 `.npmrc` 中 `engine-strict=false` 可在未升级 Node 时完成安装，但可能收到 **WARN**。

## Hermes：`pnpm hermes:bootstrap` 卡在 SSH clone

官方安装脚本会尝试 `git@github.com:...`；无 SSH 密钥时可能长时间等待。`bootstrap` 已为子进程设置 `GIT_SSH_COMMAND`（`BatchMode=yes` + 超时）以尽快失败并回退 HTTPS。若曾 `^C` 中断，见 [packages/hermes-agent/README.md](../../packages/hermes-agent/README.md) 排障节。

## 与方案 A 文档的关系

架构、路由、实例模板仍以 [README](./README.md) 与 [设计规格](../specs/2026-04-26-open-agent-teams-design.md) 为准；本页仅描述 **Node 工程层** 纳管方式。
