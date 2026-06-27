// @open-agent-teams/core — Agent Teams 协作框架核心能力

// ── Hermes Agent 客户端（新增 — 替代 omAgent）──
export {
  HermesAgentClient,
  createHermesAgentClient,
  getGlobalHermesClient,
} from './hermes/index.js';
export type {
  HermesInstance,
  HermesConfig,
  HermesAgentResult,
} from './hermes/index.js';

// ── 会话管理 ──
export { SessionManager } from './session/SessionManager';
export { initSchema } from './session/schema';
export { WorkflowStateManager } from './session/WorkflowStateManager';
export type { WorkflowState, WorkflowStepState, WorkflowContext } from './session/WorkflowStateManager';
export { RollbackManager } from './session/rollback';
export type { SessionSnapshot } from './session/rollback';

// ── 记忆、上下文与 Agent 通信基础设施 ──
export { MemoryStore } from './memory/MemoryStore';
export { ProjectMemory } from './memory/project-memory';
export type { MemoryEntry, MemoryQuery } from './memory/project-memory';
export { CollaborationMemory } from './memory/collaboration-memory';
export type { CollaborationSession, CollaborationComment, CollaborationSnapshot } from './memory/collaboration-memory';
export { MemoryBridge } from './memory/memory-bridge';
export type { ProfileMemoryEntry, ProfileSkill, SharedStateEntry, MemoryBridgeConfig } from './memory/memory-bridge';
export { ContextCompressor } from './context/ContextCompressor';
export type { CompressionConfig } from './context/ContextCompressor';
export { RegistryClient } from './bus/RegistryClient';
export { AgentBus } from './bus/AgentBus';
export { MessageType } from './bus/types';
export type { AgentMessageEnvelope, AgentRegistration } from './bus/types';

// ── 模板化工作流 ──
export { WorkflowOrchestrator } from './workflow/WorkflowOrchestrator';
export { BUILTIN_TEMPLATES } from './workflow/templates';
export type { WorkflowTemplate, WorkflowStepDefinition as WorkflowStep, WorkflowStatus, StepStatus } from './workflow/types';

// ── 编排器（核心）──
export {
  TeamOrchestrator,
  createTeamOrchestrator,
  createProfileTeamOrchestrator,
  createOpenTeamOrchestrator,
  createDevTeamOrchestrator,
} from './team/TeamOrchestrator';

// ── 编排器抽象层（解耦 @open-multi-agent/core）──
export type { IOrchestrator } from './orchestrator/IOrchestrator';
export type {
  TeamAgentConfig,
  TeamOrchestratorConfig,
  MeetingProgressEvent,
  OrchestratorEvent,
  AgentRunResult,
  TeamRunResult,
  TaskDefinition,
  OrchestratorStatus,
  TokenUsage,
  RoutingDecision,
  IntentRouterConfig,
} from './orchestrator/types';

// ── 意图路由（新增）──
export { IntentRouter } from './intent/IntentRouter';

// ── 模型消耗保护（Codex 回填模式）──
export {
  createGuardedAgentResult,
  createGuardedRoutingDecision,
  isModelSpendGuardEnabled,
  modelSpendGuardMessage,
} from './runtime/model-spend-guard.js';

// ── 质量评估与遥测 ──
export { OutputJudge } from './quality/judge';
export type { EvaluationResult, EvaluationRequest, EvaluationDimension, LLMCaller } from './quality/judge';
export { EventBus as TelemetryEventBus, createEvent, generateEventId } from './telemetry/events';
export type { TelemetryEvent, EventType, EventLevel, EventHandler as TelemetryEventHandler } from './telemetry/events';
export { TokenTracker } from './telemetry/token-tracker';
export type { TokenUsageRecord, ModelPricing } from './telemetry/token-tracker';

// ── 事件总线（新增 — Phase 1: 打通孤岛）──
export { EventBus, eventBus } from './event/EventBus';
export type { AnyEvent } from './event/EventBus';
export type {
  KanbanEvent,
  WorkflowEvent,
  MeetingEvent,
  SystemEvent,
  ActionItem,
  TaskStatus,
  EventHandler,
} from './event/types';
export {
  registerAllHandlers,
  registerKanbanHandlers,
  registerWorkflowHandlers,
  registerMeetingHandlers,
} from './event/handlers';
export type {
  AllHandlerDeps,
  KanbanHandlerDeps,
  WorkflowHandlerDeps,
  MeetingHandlerDeps,
} from './event/handlers';

// ── Pipeline 引擎（新增 — 面编排）──
export {
  Surface,
  createSurface,
  PipelineOrchestrator,
  createPipelineOrchestrator,
  ConflictResolver,
  createConflictResolver,
} from './pipeline';
export type {
  PipelineDefinition,
  PipelineInstance,
  PipelineStatus,
  SurfaceDefinition,
  SurfaceResult,
  SurfaceStatus,
  InputContract,
  OutputContract,
  Edge,
  GateDefinition,
  ConflictResolution,
  ConflictStrategy,
  Conflict,
  ConflictConfig,
} from './pipeline';

// ── Team Profile Registry ──
export {
  OPEN_FRAMEWORK_TEAM_PROFILE,
  OPEN_TEAM_MINIMUM_LOOP_PIPELINE,
  buildTeamCommunicationGuide,
  getProfileAgent,
  materializeTeamAgents,
} from './team-profile/index.js';
export type {
  TeamProfile,
  TeamProfileAgentDefinition,
  TeamProfileHermesConfig,
  TeamProfileHermesInstance,
  TeamProfileRuntimeOptions,
} from './team-profile/index.js';

// ── 内置生命周期模板（兼容旧命名） ──
export { DEV_TEAM_MINIMUM_LOOP_PIPELINE } from './lifecycle/dev-team-minimum-loop.js';

// ── 知识中心（新增 — P1）──
export {
  KnowledgeCenter,
  getGlobalKnowledgeCenter,
  resetGlobalKnowledgeCenter,
  createKnowledgeCenter,
} from './knowledge/KnowledgeCenter.js';
export type {
  KnowledgeDocument,
  KnowledgeQuery,
  KnowledgeResult,
  KnowledgeCenterConfig,
} from './knowledge/KnowledgeCenter.js';

// ── 增强文档管理（新增 — 支持项目/任务/Agent关联、评论、版本）──
export {
  DocumentManager,
  createDocumentManager,
  getGlobalDocumentManager,
  resetGlobalDocumentManager,
} from './knowledge/DocumentManager.js';
export type {
  DocumentV2,
  DocumentComment,
  DocumentQuery,
  Project,
  Task,
  DocumentManagerConfig,
} from './knowledge/DocumentManager.js';
export { MessageBus, getGlobalMessageBus, resetGlobalMessageBus } from './event/MessageBus';
export type { AgentMessage, MessageBusOptions } from './event/MessageBus';

// ── A2A 语义模型（内部统一 Agent 通信语言）──
export {
  a2aMessageToAgentMessage,
  agentMessageToA2AMessage,
  createA2ADataPart,
  createA2AMessage,
  createA2ATextPart,
  isA2ATask,
  isTerminalA2ATaskState,
  partsToText,
  pipelineInstanceToA2ATask,
  pipelineStatusToA2AState,
  surfaceResultToA2AArtifact,
  surfaceStatusToA2AState,
  teamProfileAgentToA2AAgentCard,
  teamProfileToA2AAgentCards,
} from './a2a/index.js';
export type {
  A2AAgentCapabilities,
  A2AAgentCard,
  A2AAgentSkill,
  A2AArtifact,
  A2AEvent,
  A2AMessage,
  A2APart,
  A2ARole,
  A2ASendMessageRequest,
  A2ASendMessageResult,
  A2ATask,
  A2ATaskArtifactUpdateEvent,
  A2ATaskState,
  A2ATaskStatus,
  A2ATaskStatusUpdateEvent,
} from './a2a/index.js';

// ── Token 预算管理（新增 — Phase 5: 成本控制）──
export { TokenBudgetManager, getGlobalTokenBudgetManager, resetGlobalTokenBudgetManager } from './telemetry/TokenBudgetManager';
export type { TokenBudget, BudgetCheckResult } from './telemetry/TokenBudgetManager';

// ── 国际化（新增 — 全栈中英展示协商）──
export {
  normalizeLocale,
  negotiateLocale,
  isSupportedLocale,
  pickText,
  localizeAgent,
  localizeAgents,
} from './i18n/index.js';
export type { Locale, LocalizedText } from './i18n/index.js';

// ── HTTP API 层 ──
export { createAgentApp } from './agent-factory';
export type { AgentAppConfig, AgentApp } from './agent-factory';

// ── Agent 可用工具 ──
export { createDocumentTools } from './tools/document-tools.js';
export { createDocumentToolsV2 } from './tools/document-tools-v2.js';
export { createKanbanTools, setKanbanDatabase } from './tools/kanban-tools.js';
