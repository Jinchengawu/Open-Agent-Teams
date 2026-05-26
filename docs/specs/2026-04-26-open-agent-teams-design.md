# Open-Agent-Teams 设计规格（OpenClaw + Hermes）

> **需求 ID**：REQ-2026-0426-open-agent-teams  
> **事实来源**：仓库根目录《Open-Agent-Teams：OpenClaw+Hermes 私有化本地智能操作系统方案》PDF  
> **本轮落地路径**：**方案 A — 纯集成编排**（配置约定 + 文档 + 模板；无自研运行时）  
> **用户确认（2026-04-28）**：按 **A** 方案落地；执行载体为 [integration-handoff.md](../open-agent-teams/integration-handoff.md)（含 §0 速览）。  
> **关联**：侧车 [debug/superpowers-intent/REQ-2026-0426-open-agent-teams.md](../../debug/superpowers-intent/REQ-2026-0426-open-agent-teams.md)；集成索引 [docs/open-agent-teams/README.md](../open-agent-teams/README.md)

---

## 1. 目标与非目标

### 1.1 目标

- 定义 **Open-Agent-Teams**：以 **OpenClaw** 为全局调度内核、以 **多实例 Hermes** 为垂类心智单元，数据与流程默认本地化。
- 明确 **路由与数据域**，使「通用任务走内核、个性化/垂类任务下发 Hermes、结果回流」可实施、可审计。
- 通过仓库内 **路由表、实例模板、环境变量占位** 支撑落地，不依赖虚构的产品 API。

### 1.2 非目标

- 不绑定具体 OpenClaw / Hermes **发行版、版本号或 URL 路径**；真实端点与鉴权方式以各产品官方文档为准。
- 本仓库 **不实现** OpenClaw/Hermes 二进制或插件代码；不写调用不存在接口的可执行「假客户端」。
- **方案 B（薄网关）**、**方案 C（IaC）** 在本轮 **不交付实现**；仅在本文第 8 节做后续扩展说明。

---

## 2. 架构概览

| 层级 | 组件 | 职责 |
| --- | --- | --- |
| 用户交互 | 用户 / 微信 / Telegram / 终端 / 网页等 | 统一入口至 OpenClaw |
| 系统内核 | OpenClaw 主智能体 | 意图识别、任务拆解、权限、插件调度、系统与多工具集成 |
| 垂类集群 | 多实例 Hermes（独立部署） | 深度记忆、习惯与项目沉淀、垂类推理与复盘进化 |
| 存储 | 内核数据 + 各 Hermes 私有心智数据 | 隔离存储；内核不替代 Hermes 长期记忆库 |

**数据流（与 PDF 一致）**

1. 用户输入 → OpenClaw。  
2. 判型：通用 / 系统类 → 内核自执行；个性化、垂类、长期迭代、深度决策 → 调用已注册的 Hermes 实例 API。  
3. Hermes 返回结构化或自然语言结果 → 内核整合、统一格式 → 输出用户。  
4. 双向迭代：内核侧调度日志与规则优化；Hermes 侧记忆与技能更新（由各产品能力提供）。

---

## 3. 路由原则（规范性）

详细判定表见 [routing-rules.md](../open-agent-teams/routing-rules.md)。摘要：

- **内核自执行**：文件与目录操作、爬虫、办公自动化、通用运维、不涉及长期个人心智沉淀的问答等。
- **下发 Hermes**：强依赖个人习惯/偏好、专属项目上下文、长期跟踪、垂类研究/创作风格、深度决策等（与具体实例标签绑定）。

---

## 4. 数据域与隔离

- **OpenClaw 侧**：通用资料、插件与调度配置、任务与工具调用日志、路由规则（无长期私有心智替代物）。
- **Hermes 侧（每实例）**：个人记忆、垂类经验、自进化技能；**独立端口、独立持久化**，避免跨垂类记忆混杂。
- **隐私**：Hermes 私有心智 API 建议仅对本机内核与白名单开放，不对外网暴露。

---

## 5. API 互联（推荐形态，占位）

以下仅为**集成意图**描述；路径、Header、Body 以官方文档为准。

1. **Hermes**：每垂类独立进程与端口；开启 API 网关；配置 API Key；示例基址占位 `http://127.0.0.1:8xxx`（见实例模板）。
2. **OpenClaw**：通过自定义插件/函数（名称可如「Open-Agent-Teams 垂类心智调度器」）读取实例注册表，按路由规则 HTTP 调用 Hermes。
3. **熔断与兜底**：调用超时、错误捕获；失败时由内核降级（简化回答或仅内核能力处理），保证主路径不静默挂死。

---

## 6. 待补材料清单（落地前由负责人补齐）

**执行载体**：逐项在 [integration-handoff.md](../open-agent-teams/integration-handoff.md) 勾选并填写 **§2 官方文档链接表**，再同步到侧车 REQ「后续跟踪清单」。

- [ ] OpenClaw 实际产品名/版本与「自定义函数/插件」文档链接。  
- [ ] Hermes 实际产品名/版本与 HTTP API 契约（鉴权、对话/任务接口）。  
- [ ] 各 Hermes 实例的最终 `baseUrl`、端口、API Key 管理策略（密钥不入库，使用环境变量或私密配置）。  
- [ ] 生产环境是否需反向代理 / mTLS（若选方案 B 再细化）。

---

## 7. 本轮交付物与仓库路径

| 类型 | 路径 |
| --- | --- |
| 本规格 | `docs/specs/2026-04-26-open-agent-teams-design.md` |
| 实现计划 | `docs/plans/2026-04-26-open-agent-teams.md` |
| 集成模板 | `docs/open-agent-teams/*` |
| 里程碑路线图 | `docs/open-agent-teams/milestones-roadmap.md` |

---

## 8. 后续扩展（未在本轮实施）

### 8.1 方案 B：薄编排网关（占位专节）

**意图**：在 OpenClaw 与用户/多客户端之间增加本地轻量服务，统一鉴权、审计日志、熔断与限流，再转发至 OpenClaw 或 Hermes。

**本轮状态**：无代码、无端口；若启用，需单独规格补充：网关语言栈、与现仓库关系、OpenAPI/健康检查、与 OpenClaw 的调用方向。

### 8.2 方案 C：IaC 一键环境（占位专节）

**意图**：使用 Docker Compose / Ansible 等同构拉起多 Hermes 实例与网络策略，便于团队复制环境。

**本轮状态**：不新增 `docs/open-agent-teams/iac/` 下文件；选定方案 C 后补 `iac/README` 与可运行片段。

---

## 9. 验收（本轮）

- 规格与计划、模板文件路径可互相链接且内容一致。  
- 不包含真实密钥与内网不可公开 URL。  
- REQ 侧车已记录本轮选用方案 **A** 及执行授权摘要。
