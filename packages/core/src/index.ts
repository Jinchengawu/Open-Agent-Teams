// @open-agent-teams/core - Shared Agent Team infrastructure
export { SessionManager } from './session/SessionManager';
export { initSchema } from './session/schema';
export { RollbackManager } from './session/rollback';
export type { SessionSnapshot } from './session/rollback';
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
export { WorkflowOrchestrator } from './workflow/WorkflowOrchestrator';
export { BUILTIN_TEMPLATES } from './workflow/templates';
export type { WorkflowTemplate, WorkflowStepDefinition as WorkflowStep, WorkflowStatus, StepStatus } from './workflow/types';
export { createAgentApp } from './agent-factory';
export type { AgentFactoryConfig } from './agent-factory';
export { TeamOrchestrator, createTeamOrchestrator, createDevTeamOrchestrator } from './team/TeamOrchestrator';
export type { TeamAgentConfig, TeamOrchestratorConfig } from './team/TeamOrchestrator';

// Quality - LLM-as-a-judge
export { OutputJudge } from './quality/judge';
export type { EvaluationResult, EvaluationRequest, EvaluationDimension, LLMCaller } from './quality/judge';

// Telemetry - 可观测性
export { EventBus, createEvent, generateEventId } from './telemetry/events';
export type { TelemetryEvent, EventType, EventLevel, EventHandler } from './telemetry/events';
export { TokenTracker } from './telemetry/token-tracker';
export type { TokenUsageRecord, ModelPricing } from './telemetry/token-tracker';

// Orchestrator - 编排器抽象层
export type { IOrchestrator } from './orchestrator/IOrchestrator';
export type {
  TeamAgentConfig as OrchestratorTeamAgentConfig,
  TeamOrchestratorConfig as OrchestratorTeamOrchestratorConfig,
  TokenUsage,
  ToolCallRecord,
  LLMMessage,
  AgentRunResult,
  TeamRunResult,
  TaskDefinition,
  MeetingProgressEvent,
  OrchestratorEvent,
  OrchestratorAgentInfo,
  OrchestratorStatus,
  RoutingDecision,
  IntentRouterConfig,
} from './orchestrator/types';

// IntentRouter - 智能意图路由
export { IntentRouter } from './intent/IntentRouter';

// Runtime guards
export {
  createGuardedAgentResult,
  createGuardedRoutingDecision,
  isModelSpendGuardEnabled,
  modelSpendGuardMessage,
} from './runtime/model-spend-guard.js';

// ── Hermes Agent 客户端（可选的 Agent 后端）──
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

// ── Pipeline 引擎（面编排）──
export {
  Surface,
  createSurface,
  PipelineOrchestrator,
  createPipelineOrchestrator,
  ConflictResolver,
  createConflictResolver,
} from './pipeline/index.js';
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
} from './pipeline/index.js';

// ── 知识中心 ──
export {
  KnowledgeCenter,
  createKnowledgeCenter,
  getGlobalKnowledgeCenter,
  resetGlobalKnowledgeCenter,
} from './knowledge/index.js';
export type {
  KnowledgeDocument,
  KnowledgeQuery,
  KnowledgeResult,
  KnowledgeCenterConfig,
} from './knowledge/index.js';

// ── 业务事件总线（与遥测 EventBus 区分）──
export { EventBus as AppEventBus, eventBus as appEventBus } from './event/EventBus.js';
export type { AnyEvent as AppAnyEvent } from './event/EventBus.js';
export { MessageBus, getGlobalMessageBus, resetGlobalMessageBus } from './event/MessageBus.js';
export type { AgentMessage, MessageBusOptions } from './event/MessageBus.js';
export type {
  KanbanEvent,
  WorkflowEvent,
  MeetingEvent,
  SystemEvent,
  EventHandler as AppEventHandler,
  TaskStatus,
  ActionItem,
} from './event/types.js';
export {
  registerAllHandlers,
  registerKanbanHandlers,
  registerWorkflowHandlers,
  registerMeetingHandlers,
} from './event/handlers/index.js';
export type {
  AllHandlerDeps,
  KanbanHandlerDeps,
  WorkflowHandlerDeps,
  MeetingHandlerDeps,
} from './event/handlers/index.js';

// ── 工作流状态管理 ──
export { WorkflowStateManager } from './session/WorkflowStateManager.js';
export type { WorkflowState, WorkflowStepState, WorkflowContext } from './session/WorkflowStateManager.js';

// ── Token 预算管理 ──
export { TokenBudgetManager, getGlobalTokenBudgetManager, resetGlobalTokenBudgetManager } from './telemetry/TokenBudgetManager.js';
export type { TokenBudget, BudgetCheckResult } from './telemetry/TokenBudgetManager.js';

// ── 国际化 / 本地化协商 ──
export {
  normalizeLocale,
  negotiateLocale,
  isSupportedLocale,
  pickText,
  localizeAgent,
  localizeAgents,
} from './i18n/index.js';
export type { Locale, LocalizedText } from './i18n/index.js';

// ── 新增工具 ──
export { createDocumentTools } from './tools/document-tools.js';
export { createKanbanTools, setKanbanDatabase } from './tools/kanban-tools.js';
