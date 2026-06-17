/**
 * GlueService - 胶水层
 *
 * TeamOrchestrator 与 Hermes Profile 之间的桥梁
 */

export { ThinGlue } from './thin-glue.js';
export type { ThinGlueConfig } from './thin-glue.js';

export { ThickGlue } from './thick-glue.js';
export type { ThickGlueConfig, MeetingSnapshot } from './thick-glue.js';

export { ProfileManager } from './lifecycle/profile-manager.js';
export { ProcessManager } from './lifecycle/process-manager.js';
export type { ProcessInfo } from './lifecycle/process-manager.js';
export { HealthChecker } from './lifecycle/health-checker.js';
export type { HealthCheckerConfig } from './lifecycle/health-checker.js';

export type {
  ProfileConfig,
  ProfileInfo,
  ProfileStatus,
  TaskRequest,
  TaskResponse,
  MeetingRequest,
  MeetingResponse,
  MeetingComment,
  HealthCheckResult,
  GlueServiceConfig,
} from './types.js';
