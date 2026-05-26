# REQ-2026-0426：Open-Agent-Teams（OpenClaw + Hermes 私有化本地智能操作系统）

## 元信息

| 字段 | 值 |
| --- | --- |
| **requirementId** | REQ-2026-0426-open-agent-teams |
| **来源文档** | `Open-Agent-Teams：OpenClaw+Hermes 私有化本地智能操作系统方案.pdf`（仓库根目录） |
| **分支** | （待填） |
| **PR** | （待填） |
| **负责人** | （待填） |
| **创建时间** | 2026-04-26 |
| **最后更新** | 2026-04-28（用户明确「按 A 落地」；更新方案门禁记录） |

## 规格与计划（回链）

| 类型 | 路径 |
| --- | --- |
| 设计规格 | [docs/specs/2026-04-26-open-agent-teams-design.md](../../docs/specs/2026-04-26-open-agent-teams-design.md) |
| 实现计划 | [docs/plans/2026-04-26-open-agent-teams.md](../../docs/plans/2026-04-26-open-agent-teams.md) |
| 集成模板索引 | [docs/open-agent-teams/README.md](../../docs/open-agent-teams/README.md) |
| 阶段 2 移交清单 | [docs/open-agent-teams/integration-handoff.md](../../docs/open-agent-teams/integration-handoff.md) |
| 里程碑路线图 | [docs/open-agent-teams/milestones-roadmap.md](../../docs/open-agent-teams/milestones-roadmap.md) |
| pnpm 多包（Node） | [docs/open-agent-teams/monorepo-packages.md](../../docs/open-agent-teams/monorepo-packages.md) |

## 产品与 API 文档链接（粘贴区）

> 由负责人在完成 [integration-handoff.md §2](../../docs/open-agent-teams/integration-handoff.md) 后填写**可公开**链接；敏感内网请写「见内网 wiki：xxx（不附 URL）」或脱敏说明。

| 组件 | 文档链接 |
| --- | --- |
| OpenClaw | （待填） |
| Hermes | （待填） |

## 方案门禁执行记录

| 项 | 说明 |
| --- | --- |
| **执行授权** | 用户会话指令：按《Open-Agent-Teams 落地计划（与当前方案对齐版）》**Implement the plan** 实施；未修改 Plan 文件本体。 |
| **推荐 vs 已选** | 下文「候选方案」中的文字**仅为选型参考**，**不构成已选定**；已选定项以本表为准。 |
| **本轮已选定** | **方案 A — 纯集成编排**（文档 + 路由表 + 实例模板 + `.env.example`；无薄网关代码、无 IaC 目录交付）。 |
| **A 方案显式确认** | **2026-04-28** 用户指令：**「按 A 方案进行落地」** — 继续仅执行方案 A 范围；不启动 B/C 实现与 IaC 目录交付。 |
| **说明** | 若需升级为 **B** 或 **C**，请另条消息明确 **「选定方案：B」** / **「选定方案：C」**（或混合）后再开迭代。 |

## 意图 SSOT（当前对齐）

### 目标

- 基于 PDF 方案，将 **Open-Agent-Teams** 定义为：**OpenClaw（全局调度内核）+ 多实例 Hermes（垂类心智单元）** 的私有化、全本地智能操作系统。
- 实现「内核 + 应用集群」式双分层：**广度/工具/系统任务** 与 **深度记忆/垂类进化** 解耦又闭环。
- **侧车本文件** 作为与对话解耦的 SSOT：意图、约束、证据、后续 PR/审计可检索。

### 非目标（本轮设计边界）

- 不假定 OpenClaw / Hermes 的具体商业发行版与版本号；落地以实际产品 API 为准。
- 不在此文件存放真实 API Key、内网 URL（仅示例占位）；密钥走环境变量或私密配置。

### 验收口径（用户原话摘要）

- 「设计一个 Open-Agent-Teams，用来实现本地 AI OS」
- 「开启侧车调试模式，便于后续调试跟踪」→ 本目录 + 本 REQ 文件为侧车载体。

## 对齐证据：方案要点（来自 PDF）

### 命名与定位

- **AI**：双智能体协同、调度、推理、自动化。
- **local**：数据、记忆、技能、调度本地化，降低云端泄露面。
- **OS**：非单一聊天工具；含任务调度、资源管理、插件生态、心智进化与系统兜底。

### 架构准则

| 层级 | 角色 | 职责 |
| --- | --- | --- |
| **OpenClaw** | 全局系统调度层（OS 内核） | 意图识别、任务拆解、权限、插件调度、系统操作、多工具、对外通道 |
| **Hermes（多实例）** | 垂类心智进化层 | 深度记忆、习惯沉淀、垂类学习、自主迭代；每垂类独立实例 |

**路由原则（核心）**

- 通用任务（文件、爬虫、办公自动化、运维等）→ **OpenClaw 内核自执行**。
- 个性化 / 垂类 / 长期迭代 / 深度决策 → **下发对应 Hermes 心智单元**，结果回流内核统一润色与输出。

### 数据与闭环

- **统一存储**：内核侧（通用资料、插件配置、任务日志、调度规则）+ 心智侧（个人记忆、垂类经验、自进化技能）。
- **双向迭代**：内核优化调度与资源分配；Hermes 复盘更新技能与记忆。

### 推荐接入（API 互联）

1. **Hermes**：每垂类独立部署与端口；开启 API 网关与 CORS；API Key；固定本机地址示例 `127.0.0.1:8001/8002/8003…`；白名单仅允许本地 OpenClaw 调用。
2. **OpenClaw**：自定义插件「Open-Agent-Teams 垂类心智调度器」；注册各 Hermes 的 URL、Key、垂类标签；配置上述路由规则。
3. **任务闭环**：用户入口 → 内核判型 → 必要时 API 转发 Hermes → Hermes 用记忆与技能执行并复盘 → 回传内核 → 统一输出。
4. **熔断**：超时与异常捕获；Hermes 故障时内核兜底，保证服务不断。

### 避坑规范（PDF）

- 心智实例隔离：独立端口、独立库，避免跨域记忆混杂。
- 权限：Hermes 私有心智库不对公网暴露，仅内核调用。
- 熔断与降级已在上文。

## 实现层候选方案（选型参考；已选以「方案门禁执行记录」为准）

> **未在「方案门禁执行记录」中勾选的选项**，不视为已承诺实现。

### 方案 A：纯集成编排

- [x] **已选定（本轮）** — 不重复造「OS」运行时；以 OpenClaw + 多 Hermes 的 **配置 + 插件 + 路由表** 为主交付物；仓库内维护路由说明、实例模板、`.env.example`（无密钥）。

### 方案 B：薄编排网关

- [ ] 未选定 — 在本地增加一轻量服务（如 Node/Go），统一鉴权、日志、熔断，再调 OpenClaw/Hermes；适合多客户端入口。设计占位见 [设计规格 §8.1](../../docs/specs/2026-04-26-open-agent-teams-design.md)。

### 方案 C：文档与 IaC 包

- [ ] 未选定 — 用 compose/ansible 一键起多 Hermes + 网络策略；适合团队同构环境。设计占位见 [设计规格 §8.2](../../docs/specs/2026-04-26-open-agent-teams-design.md)。

**选型参考（非已选）**：若从零起步，可先按 A 验证闭环，再按需引入 B 或 C；**以用户显式消息为准**。

## Superpowers 门禁记录（本会话）

- [x] `using-skills`：已 Read（当次）。
- [x] `brainstorming`：此前已 Read；本轮为计划执行落地。
- [x] `superpowers-intent-trace`：本文件即侧车 SSOT。
- [x] `writing-plans`：已产出 [实现计划](../../docs/plans/2026-04-26-open-agent-teams.md)。
- [x] `verification-before-completion`：本轮见下方验证记录。

## Pipeline 关系（可选）

- 已 Read：`.cursor/superpowers-pipeline.json`（schemaVersion 1，示例标题 web3-fe-superpowers 默认编排）。

## 后续跟踪清单（代理/人类共用）

- [x] 用户确认：本轮为 **方案 A**（见方案门禁执行记录；升级 B/C 需新指令）。
- [ ] 实际 OpenClaw / Hermes 产品形态与 API 文档链接写入本节。
- [ ] 填写分支、PR、负责人。
- [ ] 若含敏感链接：将 `debug/superpowers-intent/` 纳入 `.gitignore` 或改为脱敏副本策略。

## 验证记录（本轮）

- 已通读新建文档相对链接（规格、计划、README、路由、模板互指）。
- 本工作区根目录 **无** `package.json`（Glob 未命中），**跳过** `pnpm lint`；若合并入完整 monorepo 后再补跑。

### 阶段 2 增量（文档结构）

- 阶段 2 **单一执行入口**：[integration-handoff.md](../../docs/open-agent-teams/integration-handoff.md)；[实现计划](../../docs/plans/2026-04-26-open-agent-teams.md) 含「阶段 2」复选框任务。REQ「产品与 API 文档链接」待人工填表后，可将跟踪清单「实际 OpenClaw / Hermes…」标为完成。
