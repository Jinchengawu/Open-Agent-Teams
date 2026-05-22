# Open-Agent-Teams 集成模板（方案 A）

本目录存放 **OpenClaw + 多实例 Hermes** 私有化集成的**文档与占位模板**，与下列文件一起阅读：

| 顺序 | 文档 | 说明 |
| --- | --- | --- |
| 1 | [../specs/2026-04-26-ai-local-os-design.md](../specs/2026-04-26-ai-local-os-design.md) | 架构、数据域、路由原则、待补材料 |
| 2 | [routing-rules.md](./routing-rules.md) | 内核自执行 vs 下发 Hermes 判定表 |
| 3 | [hermes-instances.template.yaml](./hermes-instances.template.yaml) | 多实例注册表模板（复制后填写） |
| 4 | [.env.example](./.env.example) | 环境变量占位（勿提交含真实密钥的 `.env`） |
| 5 | [../plans/2026-04-26-ai-local-os.md](../plans/2026-04-26-ai-local-os.md) | 分步实现与验证清单 |
| 6 | [integration-handoff.md](./integration-handoff.md) | **阶段 2**：集成移交、官方文档链接表、可运行检查项 |
| 7 | [milestones-roadmap.md](./milestones-roadmap.md) | **里程碑**：A → A+ → B → C 按周建议节奏与验收 |
| 8 | [monorepo-packages.md](./monorepo-packages.md) | **pnpm 多包**：`@ai-local-os/openclaw` + `@ai-local-os/hermes-agent` 与根脚本 |

**侧车（意图 SSOT）**：[debug/superpowers-intent/REQ-2026-0426-ai-local-os.md](../../debug/superpowers-intent/REQ-2026-0426-ai-local-os.md)

**方案说明**：当前按 **方案 A（纯集成编排）** 落地（用户已确认）；执行顺序见 [integration-handoff.md §0](./integration-handoff.md)。若后续采用 **方案 B（薄网关）** 或 **方案 C（IaC）**，见规格文档第 8 节及实现计划中「未激活」占位任务。
