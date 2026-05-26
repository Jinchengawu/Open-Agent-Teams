# Node / pnpm 多包工作区（OpenClaw + Hermes 纳管）

本仓库根目录已启用 **pnpm workspace**，以 **Node.js** 为工程基线，将两侧运行时纳入统一依赖与脚本入口。

## 布局

| 包名 | 路径 | 说明 |
| --- | --- | --- |
| `open-agent-teams` | `/package.json` | 工作区根；聚合脚本 |
| `@open-agent-teams/openclaw` | `packages/openclaw/` | 依赖 npm **`openclaw`**（CLI 与 Gateway 能力以官方为准） |
| `@open-agent-teams/hermes-agent` | `packages/hermes-agent/` | **无** Hermes 核心 npm 依赖；提供 `bootstrap`（官方 curl 安装）与 `doctor` |

## 命令（在仓库根）

```bash
pnpm install

# OpenClaw（来自子包依赖）
pnpm openclaw:version
pnpm openclaw -- --help

# Hermes Agent（官方脚本 + 本机 PATH）
pnpm hermes:install-help   # 仅打印官方安装命令
pnpm hermes:bootstrap      # 执行 curl | bash（需网络与用户确认）
pnpm hermes:doctor         # 检测是否已安装 hermes CLI
```

## Node 版本

- **当前声明**：根与子包 `engines` 为 **≥ 22.17**（与常见 CI 对齐）。  
- **推荐**：Node **≥ 22.19** 或 **24 LTS**，以与 `openclaw` 上游子依赖声明完全一致。  
- 根目录 `.npmrc` 中 `engine-strict=false` 可在未升级 Node 时完成安装，但可能收到 **WARN**。

## OpenClaw postinstall 权限提示

若安装日志出现 `EACCES` 读取 `~/.openclaw/openclaw.json`，按日志提示修正该文件属主（`chown`）后重启 Gateway；属本机配置问题，与仓库代码无关。

## Hermes：`pnpm hermes:bootstrap` 卡在 SSH clone

官方安装脚本会尝试 `git@github.com:...`；无 SSH 密钥时可能长时间等待。`bootstrap` 已为子进程设置 `GIT_SSH_COMMAND`（`BatchMode=yes` + 超时）以尽快失败并回退 HTTPS。若曾 `^C` 中断，见 [packages/hermes-agent/README.md](../../packages/hermes-agent/README.md) 排障节。

## 与方案 A 文档的关系

架构、路由、实例模板仍以 [README](./README.md) 与 [设计规格](../specs/2026-04-26-open-agent-teams-design.md) 为准；本页仅描述 **Node 工程层** 纳管方式。
