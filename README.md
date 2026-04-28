# AI-local-OS

本仓库围绕 **OpenClaw + 多实例 Hermes** 的私有化本地智能操作系统方案，沉淀 **集成规格、分步计划、路由与实例模板**，并配套 **Superpowers 技能包**（Cursor / Claude / Agents 侧一致入口），便于 AI 编码代理按门禁协作。

> 若你持有完整的 **ai-work-flow** monorepo（含 `packages/cli`、`packages/core` 等），根目录 [AGENTS.md](./AGENTS.md) 中仍描述该上游形态；**当前工作区以本 README 与 `docs/` 实际文件为准**。

## 仓库里有什么

| 路径 | 说明 |
| --- | --- |
| [docs/ai-local-os/README.md](./docs/ai-local-os/README.md) | **集成文档索引**（阅读顺序、模板列表） |
| [docs/specs/2026-04-26-ai-local-os-design.md](./docs/specs/2026-04-26-ai-local-os-design.md) | 架构、数据域、路由原则、待补材料 |
| [docs/plans/2026-04-26-ai-local-os.md](./docs/plans/2026-04-26-ai-local-os.md) | 分步实现与验证清单 |
| [docs/ai-local-os/routing-rules.md](./docs/ai-local-os/routing-rules.md) | 内核自执行 vs 下发 Hermes 判定表 |
| [docs/ai-local-os/hermes-instances.template.yaml](./docs/ai-local-os/hermes-instances.template.yaml) | 多实例注册表模板（复制后填写） |
| [docs/ai-local-os/.env.example](./docs/ai-local-os/.env.example) | 环境变量占位 |
| [docs/ai-local-os/integration-handoff.md](./docs/ai-local-os/integration-handoff.md) | 阶段 2：集成移交、官方文档链接表、可运行检查项 |
| [AGENTS.md](./AGENTS.md) | 写给 AI 编码代理的操作手册（含 Superpowers 门禁） |
| `.cursor/`、`.claude/`、`.agents/` | Skills、Agents、`superpowers-pipeline.json` 等（与上游包约定一致时由 `pnpm sync:superpowers` 维护 symlink） |
| `debug/superpowers-intent/` | 意图与对齐证据侧车（如 REQ 文档） |
| 根目录 PDF | 方案与拓扑说明（二进制附件，Git 中按需管理体积） |

## 快速开始（读文档）

1. 打开 [docs/ai-local-os/README.md](./docs/ai-local-os/README.md)，按表格顺序阅读规格与模板。  
2. 需要落到「可运行」勾选清单时，继续 [docs/ai-local-os/integration-handoff.md](./docs/ai-local-os/integration-handoff.md)。  
3. 使用 AI 代理改本仓库时，先遵循 [AGENTS.md](./AGENTS.md)（含对 `.cursor/skills/using-skills` 的门禁说明）。

## 机密与本地文件

- **勿**将含真实密钥的 `.env`、本地实例 YAML 提交版本库；模板见 [.env.example](./docs/ai-local-os/.env.example)，本地覆盖文件名建议见 [integration-handoff.md](./docs/ai-local-os/integration-handoff.md) 与仓库 [.gitignore](./.gitignore)。

## 与上游 ai-work-flow 的关系

[AGENTS.md](./AGENTS.md) 将本仓库定位为 **ai-work-flow** 工作流 monorepo 的扩展文档锚点之一（AI-local-OS 与业务包无强耦合）。若你只在维护本目录的文档与技能资产，以本文档树与 AGENTS 为准即可；若需 CLI / core 包开发，请在上游完整 clone 中执行 `pnpm install`、`pnpm sync:superpowers` 等（详见 AGENTS.md「Build & Test」）。

---

许可与贡献方式若未在仓库内单独声明，以项目所有者约定为准。
