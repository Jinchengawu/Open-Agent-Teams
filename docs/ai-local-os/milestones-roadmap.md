# Open-Agent-Teams 里程碑路线图（A → B → C）

> **用途**：按周拆解推进顺序；周次为**建议节奏**，可按团队带宽压缩或拉长。  
> **当前仓库默认**：方案 **A** 已文档化；**B/C** 为后续增强。  
> **执行入口**：[integration-handoff.md](./integration-handoff.md) · [设计规格 §8](../specs/2026-04-26-ai-local-os-design.md)

---

## 总览（三叠里程碑）

```mermaid
flowchart LR
  subgraph phaseA [PhaseA]
    A1[文档与模板]
    A2[接线冒烟]
    A3[路由稳定]
  end
  subgraph phaseB [PhaseB]
    B1[网关规格]
    B2[网关MVP]
    B3[观测与熔断]
  end
  subgraph phaseC [PhaseC]
    C1[IaC草案]
    C2[多实例编排]
    C3[可复制交付]
  end
  phaseA --> phaseB
  phaseB --> phaseC
```

| 阶段 | 方案标签 | 核心交付 | 建议周次 |
| --- | --- | --- | --- |
| 一 | **A** 纯集成 | 可跑通的最小闭环（内核 + ≥1 Hermes） | 第 1–2 周 |
| 二 | **A+** 硬化 | 路由准确率、超时兜底、密钥与实例隔离落地 | 第 3–4 周 |
| 三 | **B** 薄网关 | 统一入口、鉴权、审计日志、限流雏形 | 第 5–6 周 |
| 四 | **C** IaC | 一键/半一键起多实例 + 网络策略文档化 | 第 7–8 周 |

---

## 第 1–2 周：方案 A — 最小可运行闭环

**目标**：单路径「用户 → OpenClaw →（可选）Hermes → 用户」跑通，不引入自研网关。

| 里程碑 | 交付物 / 动作 | 验收 |
| --- | --- | --- |
| M1.1 | 完成 [integration-handoff.md](./integration-handoff.md) §2 官方文档链接表（可公开 URL 或脱敏说明） | REQ「产品与 API 文档链接」有对应条目 |
| M1.2 | 本地实例表：`hermes-instances.local.yaml` + `.env`（不入库） | `.gitignore` 已覆盖；仓库无密钥 |
| M1.3 | OpenClaw 侧插件/函数能按 [routing-rules.md](./routing-rules.md) 调用 **至少 1** 个 Hermes | 有日志或截图类证据（团队自定） |
| M1.4 | 熔断与内核兜底可感知（超时或 Hermes 宕机时用户得到明确提示） | 与规格 §5 一致 |

**周末检查**：是否愿意把「误路由率」作为下一阶段的量化指标（是/否，记录到 REQ）。

---

## 第 3–4 周：方案 A+ — 稳定化与多实例

**目标**：多 Hermes 实例注册完整、路由可维护、运维可重复。

| 里程碑 | 交付物 / 动作 | 验收 |
| --- | --- | --- |
| M2.1 | 实例表覆盖 ≥2 垂类（生活 / 开发等），标签与 [routing-rules.md](./routing-rules.md) 一致 | 人工用例集 ≥10 条，判型结果可复盘 |
| M2.2 | 超时、重试、熔断参数按实例调优并文档化 | 写入 handoff 或 REQ，避免口口相传 |
| M2.3 | 备份/恢复或数据目录规范（按 Hermes 官方建议） | 有 Runbook 链接或内网说明 |

**周末决策点**：若出现「多客户端入口混乱、鉴权分散、审计困难」任一，则 **第 5 周起启动方案 B**；否则可继续加固 A 并并行准备 C 的草案。

---

## 第 5–6 周：方案 B — 薄编排网关

**目标**：在 OpenClaw 与（可选）多上游之间增加**本地网关**，统一治理。

| 里程碑 | 交付物 / 动作 | 验收 |
| --- | --- | --- |
| M3.1 | 网关规格补档（路由、鉴权、mTLS 是否采用、与 OpenClaw 调用方向） | 新小节进入 `docs/specs/` 或由团队另开 spec 文件并链回 README |
| M3.2 | 网关 MVP：单进程监听本机端口，转发到 OpenClaw 或 Hermes | 健康检查端点可用；无密钥写死 |
| M3.3 | 结构化请求日志（脱敏）+ 基础限流 | 能定位一次完整请求的 trace id |

**依赖**：语言栈与部署方式需与团队约定（本仓库不预设实现语言）。

---

## 第 7–8 周：方案 C — IaC 与可复制环境

**目标**：新成员或新机器能在文档指引下**复现**多实例拓扑。

| 里程碑 | 交付物 / 动作 | 验收 |
| --- | --- | --- |
| M4.1 | `docs/ai-local-os/iac/README.md` + Compose 或 Ansible **最小可运行片段** | 干净环境按 README 起齐实例（或等价步骤） |
| M4.2 | 网络策略：仅内核/网关可达 Hermes 的说明与配置片段 | 与规格 §4 隐私原则一致 |
| M4.3 | 版本钉扎（镜像 tag / 包版本）与升级 Runbook | 可回答「如何安全升级一个 Hermes 实例」 |

---

## 并行与风险（简表）

| 风险 | 缓解 |
| --- | --- |
| OpenClaw / Hermes 官方接口变更 | 文档链接钉版本；升级纳入 M4.3 |
| 密钥误提交 | 仅用手动 env / 秘密管理；定期 `git log` 抽查 |
| B 与 C 同时开工导致范围膨胀 | **默认串行**：B 验证后再上 C；除非有专职 SRE |

---

## 与仓库文档的对应关系

| 路线图阶段 | 主要阅读 |
| --- | --- |
| 第 1–2 周 | [integration-handoff.md](./integration-handoff.md)、[routing-rules.md](./routing-rules.md) |
| 第 3–4 周 | [设计规格](../specs/2026-04-26-ai-local-os-design.md) §3–§6、[../plans/2026-04-26-ai-local-os.md](../plans/2026-04-26-ai-local-os.md) 阶段 2 |
| 第 5–8 周 | 规格 §8、（待建）`iac/README`、网关 spec 增补 |

修订本路线图时，建议在侧车 REQ 的「最后更新」或验证记录中记一行日期与变更摘要。
