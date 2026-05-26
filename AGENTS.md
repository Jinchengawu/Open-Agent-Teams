# ai-work-flow 开发指南

本文件是专门写给 **AI 编码代理** 的操作手册。

**仓库定位**：`ai-work-flow` 是 **前端 AI 工作流编排与工具链** 的 monorepo，包含 CLI、核心编排/类型包，以及 **web3-fe-superpowers** 资产（`.cursor/skills`、安装脚本、文档等）。本仓库**不是**业务 Web 应用仓库；若任务涉及消费端业务应用，以该应用仓库的 `AGENTS.md` 为准，此处侧重 **工作流、技能包与脚本** 的维护与演进。

**目标**：在本仓库中产出 **可维护、可验证、与 Superpowers 体系一致** 的变更（TypeScript、脚本、技能文档），并避免与既有门禁冲突。

## Agent Rules

**🚨 最高优先级规则（以下两条并列、同等强制、均不可跳过）：**

1. **称呼用户**：每次回复时必须在开头或结尾称呼用户为「大佬」——强制要求，没有例外。
2. **Superpowers 门禁**：本仓库内 **AI 编码代理**（含 Cursor Agent、Claude Code 等）在处理**每条**用户消息时，必须先完成 skill 门禁，再回复或执行工具；必须执行 **Superpowers** 流程，不得以「问题简单」「需要先探索代码库」等理由跳过。

**Superpowers 门禁细则（每条用户消息必做）**

1. **入口 skill**：先评估并遵循 `.cursor/skills/using-skills/SKILL.md`（若存在同名 skill，以仓库内该文件为准）。若判断有任意 skill 可能适用（含 **1%** 可能性），必须先加载该 skill 再行动。
2. **流程类优先**：创造性工作、复杂需求、多步骤实现前，按需加载 `brainstorming`、`writing-plans`；调试问题加载 `systematic-debugging`；其余按 `using-skills` 中的优先级与清单执行。
3. **Cursor 环境**：无独立 `Skill` 工具时，**使用 Read 读取** `.cursor/skills/<skill-name>/SKILL.md`（及该 skill 引用的文件）即视为已「调用」该 skill，与 Superpowers 要求等价。
4. **优先级**：**用户明确指令与本文件（含本段 Agent Rules）** 高于各 skill 的默认流程；若冲突，以用户与本文件为准。
5. **子代理例外**：若某 skill 含 `<SUBAGENT-STOP>` 等说明，子代理执行任务时可按该 skill 跳过对应步骤。

**Superpowers 门禁 — 禁止**

- 未做 skill 适用性检查即直接输出方案、改代码或批量调用工具。
- 用「我记得流程」替代当次读取 skill 文件。

**范式违约（明确禁止的「我行我素」行为）**

以下均视为**违反仓库强制范式**，与是否「觉得更快」「觉得简单」无关：

- 未按任务类型完成对应 skill（含当次 Read）就下结论、给方案、改代码或批量调用工具。
- **新功能 / 多步 / 改行为**：未完成 **`brainstorming` → 用户确认设计要点 → `writing-plans`（或 skill 规定的等价物）→ 用户确认计划/范围** 就进入实现（含写文件、大范围检索后直接开改）。
- 缺接口契约、业务规则、设计稿、环境/链约束、验收标准时，**不**输出「待补材料清单」并停问，而用占位假设、虚构 API、或「先上一版 UI/假数据」代替对齐。
- 用户仅说「帮我做」「开发某模块」**未**在同一条消息里**明文授权跳过某一步**时，自行决定跳过头脑风暴、书面计划或确认环节。

**默认范式（强制，非代理自选；禁止代理默认采用「先干后补」风格）**

以下规则与上文的 Superpowers 门禁**同等强制**。代理**不得**凭「简单」「赶进度」「先探索代码库」「先写一版再对齐」「我推断可以」「单会话内先出活」等理由自行缩短或跳过；**默认 = 必须按范式执行**，除非本文件另有明文例外，或用户在**同一条消息里用自然语言明确授权跳过某一步**（代理须在回复中**复述**跳过的步骤与风险）。

1. **缺省执行顺序（按任务类型）**
   - **每条用户消息**：先完成 `using-skills` 门禁（读取 `.cursor/skills/using-skills/SKILL.md`），并在回复**开头**用一行声明：`[using-skills] 已检查 skill 列表 → 调用: …` 或 `→ 无匹配`。
   - **新功能 / 改行为 / 多文件或多步实现**：在动代码前，按需加载并遵循 **`brainstorming`** → **`writing-plans`**（或同 skill 规定的等价步骤）；**未经用户确认设计/计划前，不开始实现**（实现包括：创建/修改业务代码、接 API、改 locales，除非用户在该条消息中明确授权跳过或缩小范围）。若缺 PRD、接口契约、设计稿、链/环境约束等，**列出「待补材料清单」向用户索取**，**禁止**用占位业务假设代替确认。
   - **Bug / 异常行为**：在提出修复前，按需加载并遵循 **`systematic-debugging`**。
   - **声称完成、已修复、已通过、可提交/可合并前**：加载并遵循 **`verification-before-completion`**（运行约定验证命令并展示关键输出；无证据则不得下结论）。

2. **禁止自作主张**
   - 材料不足、规则未定、API 未对齐时：**停止实现，先提问或列清单请用户补全**；不得静默编造接口路径、业务规则或「先写一版再说」。

3. **与用户指令的关系**
   - 用户说「实现某功能」「修某个问题」**不**等于授权跳过范式；若用户要求跳过某流程步骤，须**显式写出**（例如：「跳过书面 plan，直接改」）。未显式写出则仍按默认范式执行。

4. **工具与代码的先后顺序（硬性）**
   - 对「新功能 / 多步 / 改行为」类任务：**先**完成本条规定的门禁与确认，**再**使用会修改代码库或依赖实现假设的工具步骤；不得以「先读一下代码」为名跳过确认（读 skill、问用户、列材料清单除外）。

**其他规则**

- 对话语言使用**简体中文**
- 代码注释优先使用**简体中文**，技术术语可保留英文
- 修改代码后不要自动提交，等待用户确认
- 遵循最小变更原则：只改动与任务直接相关的代码，避免顺手重构
- 修改 **skills / 安装脚本 / 与 Superpowers 共存的提示词** 时，注意与 `packages/web3-fe-superpowers` 及仓库根 `.cursor/skills` 的一致性，避免破坏性「排异」；重大变更需有验证说明（见 `verification-before-completion`）；**默认开发流以包内源为准**，根目录 `.cursor/skills` 等为指向该包的 symlink（见下条）。

## 与本仓库相关的技能与资产

- **开发环境同步**：clone 或拉取含技能包的大更新后，在仓库根执行 **`pnpm sync:superpowers`**（`scripts/sync-web3-superpowers-dev.sh`）。会将 `packages/web3-fe-superpowers/skills`、`agents` 以 symlink 挂到 `.cursor/`、`.claude/`、`.agents/` 下，并将 `.cursor/superpowers-pipeline.json` 链到包内流水线示例；**勿**把真实目录复制到 `.cursor/skills` 以免与包内源分叉。
- **仓库内 Cursor Skills**：根目录 `.cursor/skills/`（由 `using-skills` 统筹；**默认**与 `packages/web3-fe-superpowers/skills` 为同一目录树；编排阶段可 Read `.cursor/superpowers-pipeline.json` 对齐 `steps` / `triggers`）
- **web3-fe-superpowers 包**：`packages/web3-fe-superpowers/`（文档、dev-ops 安装脚本、分发与自检相关说明见该包内 `doc/` 与 `skills/`）
- **业务前端栈**（供技能文档与示例对齐参考，**非本仓库默认运行时**）：若任务需要描述「典型 Web3 前端」技术选型，可与用户确认是否指向 Gate Web3 / Fomox 等外部应用仓库；**不要**默认本仓库已安装 React、Next 等业务依赖

## Tech Stack（本 monorepo 实际使用）

### 语言与运行时

- **TypeScript 5** — 主要实现语言
- **Node.js** >= 20 — 运行与构建

### 包与工程

- **pnpm** — 包管理（workspace 见 `pnpm-workspace.yaml`）
- **Turborepo** — 任务编排与缓存（`turbo.json`）

### 包职责（概要）

| 包 | 说明 |
| --- | --- |
| `@ai-work-flow/core` | 类型、编排模型与扩展点 |
| `@ai-work-flow/cli` | 命令行入口（`ai-work-flow`），依赖 core |
| `@ai-work-flow/web3-fe-superpowers` | Skills/Agents 与规范资产、构建占位（内容包） |

## Build & Test

### 根目录脚本

```bash
pnpm install    # 安装依赖
pnpm sync:superpowers  # 链 skills/agents 与流水线到 .cursor / .claude / .agents（clone 或大更新后）
pnpm build      # turbo run build（各包 build）
pnpm dev        # turbo run dev
pnpm lint       # turbo run lint
pnpm typecheck  # turbo run typecheck（注意：脚本名为 typecheck，非 type-check）
pnpm demo       # 运行 CLI demo（需先 build cli 等）
pnpm clean      # 清理构建产物与 node_modules
```

### 单包开发（示例）

```bash
pnpm --filter @ai-work-flow/cli dev    # CLI 开发（tsx watch）
```

### 环境要求

- Node.js >= 20
- pnpm（与 `package.json` 的 `packageManager` 字段一致即可）

## Project Layout

```
ai-work-flow/
├── packages/
│   ├── cli/                    # @ai-work-flow/cli — CLI 入口与命令扩展
│   ├── core/                   # @ai-work-flow/core — 类型与编排核心
│   └── web3-fe-superpowers/    # Skills、Agents、doc、dev-ops 脚本等资产
├── .cursor/
│   ├── skills/ → packages/web3-fe-superpowers/skills（symlink，pnpm sync:superpowers）
│   ├── agents/ → packages/web3-fe-superpowers/agents
│   └── superpowers-pipeline.json → 包内流水线模板（同上）
├── turbo.json
├── pnpm-workspace.yaml
├── package.json
└── AGENTS.md                   # 本文件
```

---

若本文件与具体子包 README 冲突，以**用户当前任务指向的包**及**用户明示指令**为准；**Superpowers 门禁与本文件 Agent Rules 不因此豁免**。

**扩展文档（Open-Agent-Teams）**：[docs/open-agent-teams/README.md](docs/open-agent-teams/README.md) — OpenClaw + Hermes 私有化集成模板与规格索引（与 monorepo 业务包无强耦合）。**Node 工作区**：根目录 `pnpm-workspace.yaml`，包见 `packages/openclaw`、`packages/hermes-agent` 与 [monorepo-packages.md](docs/open-agent-teams/monorepo-packages.md)。
