# Open-Agent-Teams

> OpenClaw × Hermes = 能力倍增（x * y = k）

本仓库围绕 **OpenClaw + 多实例 Hermes** 的私有化本地智能操作系统方案，沉淀 **集成规格、分步计划、路由与实例模板**，并配套 **Superpowers 技能包**（Cursor / Claude / Agents 侧一致入口），便于 AI 编码代理按门禁协作。

## 核心理念

```
OpenClaw（横向编排） × Hermes（垂类深度） = Open-Agent-Teams（能力倍增）
     x                              y                    k
```

- **OpenClaw**：多 Agent 协同、路由、调度、权限、日志
- **Hermes**：深度记忆、技能、垂类推理、自进化
- **Open-Agent-Teams**：整合二者优势，实现 1+1 > 2 的效果

> 📖 详细架构说明请参阅 [CORE-ARCHITECTURE.md](./docs/open-agent-teams/CORE-ARCHITECTURE.md)

## 仓库里有什么

| 路径 | 说明 |
| --- | --- |
| [docs/open-agent-teams/CORE-ARCHITECTURE.md](./docs/open-agent-teams/CORE-ARCHITECTURE.md) | **核心架构思想**（OpenClaw × Hermes） |
| [docs/open-agent-teams/README.md](./docs/open-agent-teams/README.md) | **集成文档索引**（阅读顺序、模板列表） |
| [docs/specs/2026-04-26-open-agent-teams-design.md](./docs/specs/2026-04-26-open-agent-teams-design.md) | 架构、数据域、路由原则、待补材料 |
| [docs/plans/2026-04-26-open-agent-teams.md](./docs/plans/2026-04-26-open-agent-teams.md) | 分步实现与验证清单 |
| [docs/open-agent-teams/routing-rules.md](./docs/open-agent-teams/routing-rules.md) | 内核自执行 vs 下发 Hermes 判定表 |
| [docs/open-agent-teams/hermes-instances.template.yaml](./docs/open-agent-teams/hermes-instances.template.yaml) | 多实例注册表模板（复制后填写） |
| [docs/open-agent-teams/.env.example](./docs/open-agent-teams/.env.example) | 环境变量占位 |
| [docs/open-agent-teams/integration-handoff.md](./docs/open-agent-teams/integration-handoff.md) | 阶段 2：集成移交、官方文档链接表、可运行检查项 |
| [AGENTS.md](./AGENTS.md) | 写给 AI 编码代理的操作手册（含 Superpowers 门禁） |
| `.cursor/`、`.claude/`、`.agents/` | Skills、Agents、`superpowers-pipeline.json` 等（与上游包约定一致时由 `pnpm sync:superpowers` 维护 symlink） |
| `debug/superpowers-intent/` | 意图与对齐证据侧车（如 REQ 文档） |
| 根目录 PDF | 方案与拓扑说明（二进制附件，Git 中按需管理体积） |

## 快速开始（读文档）

1. 阅读 [CORE-ARCHITECTURE.md](./docs/open-agent-teams/CORE-ARCHITECTURE.md) — 理解核心架构思想
2. 打开 [docs/open-agent-teams/README.md](./docs/open-agent-teams/README.md)，按表格顺序阅读规格与模板  
3. 需要落到「可运行」勾选清单时，继续 [docs/open-agent-teams/integration-handoff.md](./docs/open-agent-teams/integration-handoff.md)  
4. 使用 AI 代理改本仓库时，先遵循 [AGENTS.md](./AGENTS.md)（含对 `.cursor/skills/using-skills` 的门禁说明）

## 架构速览

```
用户请求 → OpenClaw 内核 → 意图分析 → Agent 路由
                │
    ┌───────────┼───────────┬───────────┐
    │           │           │           │
    ▼           ▼           ▼           ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│Agent 1 │ │Agent 2 │ │Agent 3 │ │Agent N │
│Hermes  │ │Hermes  │ │Hermes  │ │Hermes  │
│(垂类)  │ │(垂类)  │ │(垂类)  │ │(垂类)  │
└────────┘ └────────┘ └────────┘ └────────┘
```

## 实现原则

1. **复用 OpenClaw** — 不要重新实现路由、鉴权、日志
2. **复用 Hermes** — 不要重新实现技能、记忆、推理
3. **配置驱动** — 通过配置文件定义 Agent 实例
4. **Hook 扩展** — 通过 Hook 实现自定义逻辑

## 机密与本地文件

- **勿**将含真实密钥的 `.env`、本地实例 YAML 提交版本库；模板见 [.env.example](./docs/open-agent-teams/.env.example)，本地覆盖文件名建议见 [integration-handoff.md](./docs/open-agent-teams/integration-handoff.md) 与仓库 [.gitignore](./.gitignore)。

## 与上游 ai-work-flow 的关系

[AGENTS.md](./AGENTS.md) 将本仓库定位为 **ai-work-flow** 工作流 monorepo 的扩展文档锚点之一（Open-Agent-Teams 与业务包无强耦合）。若你只在维护本目录的文档与技能资产，以本文档树与 AGENTS 为准即可；若需 CLI / core 包开发，请在上游完整 clone 中执行 `pnpm install`、`pnpm sync:superpowers` 等（详见 AGENTS.md「Build & Test」）。

---

许可与贡献方式若未在仓库内单独声明，以项目所有者约定为准。
