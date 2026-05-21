---
name: ai-local-os-router
description: "AI-local-OS 垂类心智调度器 - 根据路由规则将任务分发到 Hermes 实例"
metadata:
  { "openclaw": { "emoji": "🧠", "events": ["message:received"], "requires": { "bins": ["node"] } } }
---

# AI-local-OS Router Hook

本 Hook 实现 AI-local-OS 的核心路由功能：

1. 接收用户消息
2. 分析意图，判断是否需要路由到 Hermes 实例
3. 根据路由规则选择合适的 Hermes 实例
4. 调用 Hermes API 并返回结果

## 路由规则

- **内核自执行**：文件操作、网络爬取、办公自动化、通用运维
- **下发 Hermes**：个人习惯、项目上下文、长期跟踪、垂类深度

## 配置

Hook 配置位于 `~/.hermes-dev/config.yaml` 中的 `platforms.api_server` 部分。
