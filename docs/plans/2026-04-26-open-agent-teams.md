# Open-Agent-Teams 实现计划

> **给代理工作者：** 必须调用的子 skill：使用 subagent-driven-development（推荐）或 executing-plans 来逐任务实现此计划。步骤使用复选框（`- [ ]`）语法进行追踪。

**目标：** 在仓库内落地与 **方案 A（纯集成编排）** 一致的文档、路由表、Hermes 实例模板与环境占位，并同步侧车 REQ；不实现 Open Multi-Agent/Hermes 本体。

**架构：** `@open-multi-agent/core` 为调度内核，多 Hermes 为垂类 API；集成通过配置与 HTTP 调用约定完成；熔断与兜底在规格中约定，由产品侧配置实现。

**技术栈：** Markdown、YAML、`.env` 占位；无新增应用代码（本轮）。

**关联规格：** [docs/specs/2026-04-26-open-agent-teams-design.md](../specs/2026-04-26-open-agent-teams-design.md)  
**侧车 REQ：** [debug/superpowers-intent/REQ-2026-0426-open-agent-teams.md](../../debug/superpowers-intent/REQ-2026-0426-open-agent-teams.md)

**本轮选用方案：** **A**。方案 B/C 见规格第 8 节；未列入下方可勾选实现任务。

---

## 任务 1：集成索引与阅读顺序

**文件：**

- 创建：`docs/open-agent-teams/README.md`

- [x] **步骤 1：** 编写 README，说明 `routing-rules.md`、`hermes-instances.template.yaml`、`.env.example` 的阅读顺序及与规格的关系。

- [x] **步骤 2：** 自检相对路径指向 `../specs/` 与侧车 REQ 正确。

---

## 任务 2：路由判定表

**文件：**

- 创建：`docs/open-agent-teams/routing-rules.md`

- [x] **步骤 1：** 按规格第 3 节补充「内核 vs Hermes」判定表与灰区处理原则。

- [x] **步骤 2：** 与规格互链。

---

## 任务 3：Hermes 实例注册模板

**文件：**

- 创建：`docs/open-agent-teams/hermes-instances.template.yaml`

- [x] **步骤 1：** 填写占位字段：`id`、`label`、`baseUrl`、`tags`、`timeoutMs`、`notes`（至少 2 个示例实例块）。

- [x] **步骤 2：** 注释说明复制后脱敏、勿提交真实 Key。

---

## 任务 4：环境变量占位

**文件：**

- 创建：`docs/open-agent-teams/.env.example`

- [x] **步骤 1：** 仅包含占位变量名（如 `HERMES_LIFE_BASE_URL`、`HERMES_DEV_API_KEY`），无真实值。

- [x] **步骤 2：** 在 README 中说明复制为 `.env` 并加入 `.gitignore`（若本地含密钥）。

---

## 任务 5：侧车 REQ 同步

**文件：**

- 修改：`debug/superpowers-intent/REQ-2026-0426-open-agent-teams.md`

- [x] **步骤 1：** 写入「推荐 vs 已选」、本轮 **选定方案 A**、执行授权摘要、规格与计划路径。

- [x] **步骤 2：** 勾选「用户确认方案」跟踪项（若与用户指令一致）。

---

## 任务 6：AGENTS 索引（可选）

**文件：**

- 修改：`AGENTS.md`（文末一行）

- [x] **步骤 1：** 增加指向 `docs/open-agent-teams/README.md` 的一行索引（最小改动）。

---

## 任务 7：验证

- [x] **步骤 1：** 通读所有新建 Markdown/YAML 链接与术语一致性。

- [x] **步骤 2：** 若仓库根存在 `package.json`，运行 `pnpm lint` 并记录结果；否则在 REQ 或本计划备注「本工作区无根 package.json，跳过」。

---

## 方案 B / 方案 C（后续迭代任务占位，本轮不执行）

以下为 **未激活** 占位列表；仅当选定 B 或 C 时由新计划打开。

### 方案 B（薄网关）

- [ ] （未激活）新增网关规格子文档与最小可运行骨架的设计任务。

### 方案 C（IaC）

- [ ] （未激活）新增 `docs/open-agent-teams/iac/README.md` 与 Compose/Ansible 示例。

---

## 阶段 2：产品与接线推进（方案 A 延续）

> 目标：补齐真实产品信息与可运行接线，不虚构 API。执行中同步更新侧车 REQ 与下方勾选。  
> **用户确认（2026-04-28）**：继续按 **方案 A** 落地（见 REQ「A 方案显式确认」与 [integration-handoff.md §0](../open-agent-teams/integration-handoff.md)）。

**入口文档（单一 SSOT）：** [docs/open-agent-teams/integration-handoff.md](../open-agent-teams/integration-handoff.md)

- [ ] **步骤 1：** 在移交清单 **§2 官方文档链接表** 填写 `@open-multi-agent/core` / Hermes 的**可公开**文档 URL（内网则 REQ 脱敏说明，勿提交密钥）。

- [ ] **步骤 2：** 完成移交清单 **§3–§4**（本地实例、密钥、Gateway 侧接入顺序概念核对）。

- [ ] **步骤 3：** 确认 `.env`、本地实例 YAML 已按 [.gitignore](../../.gitignore) 忽略（必要时补规则）。

- [ ] **步骤 4：** 将 §2 链接摘要同步到侧车 [REQ-2026-0426-open-agent-teams.md](../../debug/superpowers-intent/REQ-2026-0426-open-agent-teams.md)「产品与 API 文档链接」节。

- [ ] **步骤 5：** 在规格 [§6](../specs/2026-04-26-open-agent-teams-design.md) 或 REQ 勾选「待补材料」对应项（团队约定单一 SSOT 即可）。
