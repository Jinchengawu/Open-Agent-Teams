// Pipeline 引擎

export type {
  // 核心类型
  PipelineDefinition,
  PipelineInstance,
  PipelineStatus,
  PipelineContext,
  PipelineEvent,
  PipelineEventType,
  
  // 面定义
  SurfaceDefinition,
  SurfaceWorkflow,
  SurfaceResult,
  SurfaceStatus,
  
  // 输入/输出
  InputContract,
  OutputContract,
  
  // 编排
  Edge,
  GateDefinition,
  CacheConfig,
  
  // 执行器接口
  IPipelineOrchestrator,
} from './types.js';

export { Surface, createSurface } from './Surface.js';
export { PipelineOrchestrator, createPipelineOrchestrator } from './Orchestrator.js';
export { ConflictResolver, createConflictResolver } from './ConflictResolver.js';
export type { ConflictResolution, ConflictStrategy, Conflict, ConflictConfig } from './ConflictResolver.js';
export { PipelineRecoveryStore } from './PipelineRecoveryStore.js';
export { DurableDispatchWaiterStore } from './DurableDispatchWaiterStore.js';
export type {
  DurableDispatchWaiter,
  DurableDispatchWaiterStatus,
} from './DurableDispatchWaiterStore.js';
export { RecoveryCoordinator } from './RecoveryCoordinator.js';
export type { PipelineReattachHandle } from './RecoveryCoordinator.js';
export { SideEffectLedger } from './SideEffectLedger.js';
export type {
  SideEffectIntent,
  SideEffectLedgerEntry,
  SideEffectLedgerState,
} from './SideEffectLedger.js';
export { ManualRecoveryApprovalStore } from './ManualRecoveryApprovalStore.js';
export type { ManualRecoveryAction, ManualRecoveryApproval } from './ManualRecoveryApprovalStore.js';
export { CompensationRegistry } from './CompensationRegistry.js';
export type {
  CompensationBinding,
  CompensationHandlerContext,
  CompensationReceipt,
  CompensationSpec,
} from './CompensationRegistry.js';
export { RecoveryActionCoordinator } from './RecoveryActionCoordinator.js';
export type { RecoveryApprovalCredential } from './RecoveryActionCoordinator.js';
export { CheckpointResumeRegistry, ReplayRegistry } from './RecoveryHandlerRegistries.js';
export type {
  CheckpointResumeContext,
  DurableRecoveryHandlerResult,
  RecoveryHandlerBinding,
  RecoveryHandlerSpec,
  ReplayHandlerContext,
} from './RecoveryHandlerRegistries.js';
export { RecoveryReconciler, hashRecoveryDecision } from './RecoveryReconciler.js';
export type { RecoveryAuditAction, RecoveryAuditRecord } from './RecoveryReconciler.js';
export type {
  PipelineDispatchBinding,
  PipelineExecutionCheckpoint,
  PipelineExecutionRecoveryStatus,
  PipelineRecoveryDecision,
  PipelineResumePolicy,
  PipelineSideEffectState,
} from './PipelineRecoveryStore.js';
