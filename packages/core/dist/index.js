// @open-agent-teams/core — Agent Teams 协作框架核心能力
// ── Hermes Agent 客户端（新增 — 替代 omAgent）──
export { HermesAgentClient, createHermesAgentClient, getGlobalHermesClient, } from './hermes/index.js';
// ── 会话管理 ──
export { SessionManager } from './session/SessionManager.js';
export { initSchema } from './session/schema.js';
export { WorkflowStateManager } from './session/WorkflowStateManager.js';
export { RollbackManager } from './session/rollback.js';
// ── 记忆、上下文与 Agent 通信基础设施 ──
export { MemoryStore } from './memory/MemoryStore.js';
export { ProjectMemory } from './memory/project-memory.js';
export { CollaborationMemory } from './memory/collaboration-memory.js';
export { MemoryBridge } from './memory/memory-bridge.js';
export { ContextCompressor } from './context/ContextCompressor.js';
export { RegistryClient } from './bus/RegistryClient.js';
export { AgentBus } from './bus/AgentBus.js';
export { MessageType } from './bus/types.js';
// ── 模板化工作流 ──
export { WorkflowOrchestrator } from './workflow/WorkflowOrchestrator.js';
export { BUILTIN_TEMPLATES } from './workflow/templates.js';
// ── 编排器（核心）──
export { TeamOrchestrator, createTeamOrchestrator, createProfileTeamOrchestrator, createOpenTeamOrchestrator, createDevTeamOrchestrator, } from './team/TeamOrchestrator.js';
// ── 意图路由（新增）──
export { IntentRouter } from './intent/IntentRouter.js';
// ── 模型消耗保护（Codex 回填模式）──
export { createGuardedAgentResult, createGuardedRoutingDecision, isModelSpendGuardEnabled, modelSpendGuardMessage, } from './runtime/model-spend-guard.js';
// ── 质量评估与遥测 ──
export { OutputJudge } from './quality/judge.js';
export { EventBus as TelemetryEventBus, createEvent, generateEventId } from './telemetry/events.js';
export { TokenTracker } from './telemetry/token-tracker.js';
// ── 事件总线（新增 — Phase 1: 打通孤岛）──
export { EventBus, eventBus } from './event/EventBus.js';
export { registerAllHandlers, registerKanbanHandlers, registerWorkflowHandlers, registerMeetingHandlers, } from './event/handlers/index.js';
// ── Pipeline 引擎（新增 — 面编排）──
export { Surface, createSurface, PipelineOrchestrator, createPipelineOrchestrator, ConflictResolver, createConflictResolver, } from './pipeline/index.js';
// ── Team Profile Registry ──
export { OPEN_FRAMEWORK_TEAM_PROFILE, OPEN_TEAM_MINIMUM_LOOP_PIPELINE, buildTeamCommunicationGuide, getProfileAgent, materializeTeamAgents, } from './team-profile/index.js';
// ── 内置生命周期模板（兼容旧命名） ──
export { DEV_TEAM_MINIMUM_LOOP_PIPELINE } from './lifecycle/dev-team-minimum-loop.js';
// ── 知识中心（新增 — P1）──
export { KnowledgeCenter, getGlobalKnowledgeCenter, resetGlobalKnowledgeCenter, createKnowledgeCenter, } from './knowledge/KnowledgeCenter.js';
// ── 增强文档管理（新增 — 支持项目/任务/Agent关联、评论、版本）──
export { DocumentManager, createDocumentManager, getGlobalDocumentManager, resetGlobalDocumentManager, } from './knowledge/DocumentManager.js';
export { MessageBus, getGlobalMessageBus, resetGlobalMessageBus } from './event/MessageBus.js';
// ── A2A 语义模型（内部统一 Agent 通信语言）──
export { a2aMessageToAgentMessage, agentMessageToA2AMessage, createHermesA2AAdapters, createA2ADataPart, createA2AMessage, createA2ATextPart, getAgentIdFromCard, getGlobalInProcessA2ATransport, HermesA2AAgentAdapter, HttpA2AClient, InProcessA2ATransport, isA2ATask, isTerminalA2ATaskState, partsToText, pipelineInstanceToA2ATask, pipelineStatusToA2AState, surfaceResultToA2AArtifact, surfaceStatusToA2AState, SqliteA2AHistoryStore, teamProfileAgentToA2AAgentCard, teamProfileToA2AAgentCards, resetGlobalInProcessA2ATransport, } from './a2a/index.js';
// ── Token 预算管理（新增 — Phase 5: 成本控制）──
export { TokenBudgetManager, getGlobalTokenBudgetManager, resetGlobalTokenBudgetManager } from './telemetry/TokenBudgetManager.js';
// ── 国际化（新增 — 全栈中英展示协商）──
export { normalizeLocale, negotiateLocale, isSupportedLocale, pickText, localizeAgent, localizeAgents, } from './i18n/index.js';
// ── HTTP API 层 ──
export { createAgentApp } from './agent-factory.js';
// ── Agent 可用工具 ──
export { createDocumentTools } from './tools/document-tools.js';
export { createDocumentToolsV2 } from './tools/document-tools-v2.js';
export { createKanbanTools, setKanbanDatabase } from './tools/kanban-tools.js';
//# sourceMappingURL=index.js.map