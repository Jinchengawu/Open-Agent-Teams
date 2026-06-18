# OpenClaw 术语统一修复文档

## 问题描述

Open-Agent-Teams 工程中存在大量 `OpenClaw` 字眼，需要统一替换为 `Open-Agent-Teams` 或 `OAT`。

## 统计

- 总计：149 处 OpenClaw 引用
- 涉及文件：27 个

## 修复规则

| 原术语 | 替换为 | 说明 |
|--------|--------|------|
| OpenClaw | Open-Agent-Teams | 项目名称 |
| openclaw | open-agent-teams | 包名/目录名 |
| @openclaw/ | @open-agent-teams/ | npm 包作用域 |
| OpenClaw Gateway | Open-Agent-Teams Gateway | 网关名称 |

## 修复清单

### P0 - 核心代码文件

| 文件 | 出现次数 | 状态 |
|------|----------|------|
| `packages/gateway/src/api-gateway.ts` | 31 | 待修复 |
| `packages/dashboard/src/app/api/chat/route.ts` | 3 | 待修复 |
| `packages/dashboard/src/lib/agents.ts` | 2 | 待修复 |
| `packages/dashboard/src/app/layout.tsx` | 1 | 待修复 |
| `packages/dashboard/src/components/NavBar.tsx` | 1 | 待修复 |

### P1 - 配置文件

| 文件 | 出现次数 | 状态 |
|------|----------|------|
| `package.json` | 1 | 待修复 |
| `packages/gateway/package.json` | 1 | 待修复 |
| `packages/openclaw/package.json` | 1 | 待修复 |
| `packages/openclaw/hooks/open-agent-teams-router/package.json` | 1 | 待修复 |

### P2 - 文档文件

| 文件 | 出现次数 | 状态 |
|------|----------|------|
| `README.md` | 7 | 待修复 |
| `PROJECT-REPORT.md` | 10 | 待修复 |
| `PHASE1-REPORT.md` | 5 | 待修复 |
| `AGENTS.md` | 1 | 待修复 |
| `CHANGELOG.md` | 1 | 待修复 |
| `docs/open-agent-teams/CORE-ARCHITECTURE.md` | 20 | 待修复 |
| `docs/specs/2026-04-26-open-agent-teams-design.md` | 13 | 待修复 |
| `debug/superpowers-intent/REQ-2026-0426-open-agent-teams.md` | 13 | 待修复 |
| `docs/open-agent-teams/integration-handoff.md` | 9 | 待修复 |
| `docs/open-agent-teams/milestones-roadmap.md` | 6 | 待修复 |
| `docs/open-agent-teams/questionnaire-q04-agent-results.md` | 5 | 待修复 |
| `docs/plans/2026-04-26-open-agent-teams.md` | 4 | 待修复 |
| `docs/open-agent-teams/routing-rules.md` | 4 | 待修复 |
| `docs/open-agent-teams/monorepo-packages.md` | 3 | 待修复 |
| `docs/open-agent-teams/iac/VERSIONS.md` | 2 | 待修复 |
| `docs/specs/2026-05-21-gateway-spec.md` | 1 | 待修复 |
| `packages/openclaw/README.md` | 1 | 待修复 |
| `packages/hermes-agent/README.md` | 1 | 待修复 |

### P3 - 包目录重命名

| 原目录 | 新目录 | 状态 |
|--------|--------|------|
| `packages/openclaw/` | `packages/open-agent-teams/` | 待处理 |

## 注意事项

1. 包目录重命名需要更新所有引用路径
2. npm 包名变更需要更新 `package.json` 的 `name` 字段
3. 文档中的历史记录可以保留 OpenClaw（表示过去名称）
4. 代码中的变量名、函数名如果包含 `openclaw` 也需要修改
