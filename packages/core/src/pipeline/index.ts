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
