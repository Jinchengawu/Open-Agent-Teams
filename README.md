# Open-Agent-Teams

> Open Multi-Agent（`@open-multi-agent/core`） × Hermes = 能力倍增（x * y = k）

本仓库是 **Open-Agent-Teams** 的抽象架构层，沉淀 **集成规格、分步计划、路由与实例模板**，配套 **Superpowers 技能包**（Cursor / Claude / Agents 侧一致入口），并作为下游具体实现（如 [DEV-Agent-Teams](https://github.com/Jinchengawu/DEV-Agent-Teams)）的共享基础设施。

> **注意**：`OpenClaw`（`openclaw` npm 包）在本工程中的角色是 **CLI 工具包装器**，已作为历史依赖移除。本工程的**多 Agent 编排内核**是 **`@open-multi-agent/core`**（第三方框架）。下文所有"编排框架/调度内核"相关描述均指 `@open-multi-agent/core`，而非 `OpenClaw` CLI。

## 核心理念

```
Open Multi-Agent（`@open-multi-agent/core` 横向编排） × Hermes（垂类深度） = Open-Agent-Teams（能力倍增）
     x                              y                    k
```

- **Open Multi-Agent（`@open-multi-agent/core`）**：多 Agent 协同、路由、调度、权限、日志（编排内核）
- **Hermes**：深度记忆、技能、垂类推理、自进化
- **Open-Agent-Teams**：整合二者优势，实现 1+1 > 2 的效果

> ⚠️ **术语澄清**：本工程早期文档使用"OpenClaw"指代编排框架，这是不准确的。实际编排框架为 `@open-multi-agent/core`（`TeamOrchestrator` 封装其 `OpenMultiAgent`）。`OpenClaw`（`openclaw` npm 包）已作为历史 CLI 依赖移除。

> 📖 详细架构说明请参阅 [CORE-ARCHITECTURE.md](./docs/open-agent-teams/CORE-ARCHITECTURE.md)

## 仓库结构

```
Open-Agent-Teams/
├── packages/
│   ├── core/                        # 共享核心库 (@open-agent-teams/core)
│   │   └── src/
│   │       ├── agent-factory.ts     # Agent 创建工厂（含重试/会话锁/thinking禁用）
│   │       ├── session/             # SQLite 会话管理（软删除/字段白名单）
│   │       ├── context/             # 上下文压缩器（token估算/自动摘要）
│   │       ├── bus/                 # Agent 间通信总线
│   │       ├── memory/              # 内存存储
│   │       └── workflow/            # 工作流编排（内置模板）
│   ├── gateway/                     # API 网关 (@open-agent-teams/gateway)
│   │   └── src/index.ts            # 路由/鉴权/熔断/日志
│   ├── openclaw/                    # CLI 工具包装器（`openclaw` npm 包），非编排内核
│   │   └── hooks/                  # CLI 路由 Hook（辅助入口，非核心调度）
│   └── hermes-agent/               # Hermes 安装引导 (@open-agent-teams/hermes-agent)
├── docs/
│   ├── open-agent-teams/            # 集成文档（架构/路由/实例模板/移交清单）
│   ├── specs/                       # 设计规格
│   └── plans/                       # 分步实现计划
├── .agents/skills/                  # Agent 技能包（38 个技能）
├── .claude/skills/                  # Claude Code 技能
├── .cursor/skills/                  # Cursor 技能
├── debug/superpowers-intent/        # 意图与对齐证据侧车
└── AGENTS.md                       # AI 编码代理操作手册
```

## 仓库里有什么

| 路径 | 说明 |
| --- | --- |
| [packages/core/](./packages/core/) | **共享核心库** — Agent 工厂、会话管理、上下文压缩、Agent 总线、工作流编排 |
| [packages/gateway/](./packages/gateway/) | **API 网关** — 统一入口、鉴权、路由、熔断 |
| [docs/open-agent-teams/CORE-ARCHITECTURE.md](./docs/open-agent-teams/CORE-ARCHITECTURE.md) | **核心架构思想**（Open Multi-Agent × Hermes） |
| [docs/open-agent-teams/README.md](./docs/open-agent-teams/README.md) | **集成文档索引**（阅读顺序、模板列表） |
| [docs/specs/2026-04-26-open-agent-teams-design.md](./docs/specs/2026-04-26-open-agent-teams-design.md) | 架构、数据域、路由原则、待补材料 |
| [docs/plans/2026-04-26-open-agent-teams.md](./docs/plans/2026-04-26-open-agent-teams.md) | 分步实现与验证清单 |
| [docs/open-agent-teams/routing-rules.md](./docs/open-agent-teams/routing-rules.md) | 内核自执行 vs 下发 Hermes 判定表 |
| [docs/open-agent-teams/hermes-instances.template.yaml](./docs/open-agent-teams/hermes-instances.template.yaml) | 多实例注册表模板（复制后填写） |
| [docs/open-agent-teams/.env.example](./docs/open-agent-teams/.env.example) | 环境变量占位 |
| [docs/open-agent-teams/integration-handoff.md](./docs/open-agent-teams/integration-handoff.md) | 集成移交、官方文档链接表、可运行检查项 |
| [AGENTS.md](./AGENTS.md) | 写给 AI 编码代理的操作手册（含 Superpowers 门禁） |

## 快速开始

```bash
# 安装依赖
pnpm install

# 核心库类型检查
pnpm core:check

# 核心库构建
pnpm core:build

# Hermes 引导安装
pnpm hermes:bootstrap
pnpm hermes:doctor
```

### 阅读文档

1. 阅读 [CORE-ARCHITECTURE.md](./docs/open-agent-teams/CORE-ARCHITECTURE.md) — 理解核心架构思想
2. 打开 [docs/open-agent-teams/README.md](./docs/open-agent-teams/README.md)，按表格顺序阅读规格与模板
3. 需要落到「可运行」勾选清单时，继续 [docs/open-agent-teams/integration-handoff.md](./docs/open-agent-teams/integration-handoff.md)
4. 使用 AI 代理改本仓库时，先遵循 [AGENTS.md](./AGENTS.md)

## 架构速览

```
用户请求 → Gateway (:8400) → 编排器意图分析（`@open-multi-agent/core`） → Agent 路由
                │
    ┌───────────┼───────────┬───────────┬───────────┐
    │           │           │           │           │
    ▼           ▼           ▼           ▼           ▼
┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐
│Agent 1 │ │Agent 2 │ │Agent 3 │ │Agent 4 │ │Agent N │
│Hermes  │ │Hermes  │ │Hermes  │ │Hermes  │ │Hermes  │
│(垂类)  │ │(垂类)  │ │(垂类)  │ │(垂类)  │ │(垂类)  │
└────────┘ └────────┘ └────────┘ └────────┘ └────────┘
     │          │          │          │          │
     └──────────┴──────────┴──────────┴──────────┘
                        │
                ┌───────┴───────┐
                │  Shared Core  │
                │ (@open-agent- │
                │  teams/core)  │
                └───────────────┘
```

## 实现原则

1. **复用 Open Multi-Agent 框架** — 不要重新实现路由、鉴权、日志（`@open-multi-agent/core` 已提供）
2. **复用 Hermes** — 不要重新实现技能、记忆、推理
3. **配置驱动** — 通过配置文件定义 Agent 实例
4. **Hook 扩展** — 通过 Hook 实现自定义逻辑
5. **分层设计** — 本仓库为抽象架构层，具体 Agent 实现在下游工程

## 与下游工程的关系

| 工程 | 说明 |
|------|------|
| **Open-Agent-Teams**（本仓库） | 抽象架构层 — 核心库、集成规格、技能包、实例模板 |
| [DEV-Agent-Teams](https://github.com/Jinchengawu/DEV-Agent-Teams) | 具体实现 — 5 个 Agent 实例、Next.js 仪表盘、管理模板 |

下游工程（如 DEV-Agent-Teams）依赖本仓库的 `@open-agent-teams/core` 共享库，在其基础上构建具体 Agent 服务和用户界面。

## 机密与本地文件

- **勿**将含真实密钥的 `.env`、本地实例 YAML 提交版本库；模板见 [.env.example](./docs/open-agent-teams/.env.example)，本地覆盖文件名建议见 [integration-handoff.md](./docs/open-agent-teams/integration-handoff.md) 与仓库 [.gitignore](./.gitignore)。

---

许可与贡献方式若未在仓库内单独声明，以项目所有者约定为准。
