# @open-agent-teams/openclaw

本包将 **OpenClaw** 作为 **npm 依赖** 固定在工作区内（版本见 `package.json`），便于与 Hermes 侧包统一用 **pnpm** 管理。

## 使用

在仓库根目录：

```bash
pnpm install
pnpm openclaw -- --version
pnpm --filter @open-agent-teams/openclaw exec openclaw onboard --help
```

完整能力与 Gateway 配置见官方文档：<https://docs.openclaw.ai/>（索引：<https://docs.openclaw.ai/llms.txt>）。

## 说明

- 子包 `engines` 当前为 **≥ 22.17**（与仓库根一致）；**推荐**升级到 **≥ 22.19** 或 **24 LTS** 以消除上游依赖的 engine 告警。
- 全局守护进程（`onboard --install-daemon`）属于**本机运维操作**，请在理解官方文档后于本机执行，勿在 CI 中默认开启。
