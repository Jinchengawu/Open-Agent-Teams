/**
 * GlueService 类型定义
 *
 * 胶水层（Glue Service）是 TeamOrchestrator 与 Hermes Profile 之间的桥梁。
 * - 薄胶水（ThinGlue）：单 Agent 任务透传
 * - 厚胶水（ThickGlue）：多 Agent 协作（会议模式）
 */

/** Profile 状态 */
export type ProfileStatus = 'starting' | 'running' | 'unhealthy' | 'stopped' | 'error';

/** Profile 信息 */
export interface ProfileInfo {
  agentId: string;
  name: string;
  role: string;
  port: number;
  status: ProfileStatus;
  pid?: number;
  lastHealthCheck?: Date;
  restartCount: number;
  error?: string;
}

/** Profile 配置 */
export interface ProfileConfig {
  agentId: string;
  name: string;
  role: string;
  port: number;
  skills: string[];
  tags: string[];
  /** Python 可执行路径，默认 'python3' */
  pythonPath?: string;
  /** Hermes 启动脚本路径 */
  scriptPath?: string;
  /** 环境变量 */
  env?: Record<string, string>;
}

/** 任务请求 */
export interface TaskRequest {
  agentId: string;
  task: string;
  context?: string;
  sessionId?: string;
  maxTokens?: number;
}

/** 任务响应 */
export interface TaskResponse {
  agentId: string;
  output: string;
  tokens: number;
  duration: number;
  source: 'profile' | 'fallback';
}

/** 会议请求 */
export interface MeetingRequest {
  goal: string;
  agents?: string[];
  maxRounds?: number;
}

/** 会议响应 */
export interface MeetingResponse {
  goal: string;
  comments: MeetingComment[];
  resolution: string;
  totalTokens: number;
  duration: number;
}

/** 会议评论 */
export interface MeetingComment {
  agentId: string;
  round: number;
  content: string;
  tokens: number;
}

/** 健康检查结果 */
export interface HealthCheckResult {
  agentId: string;
  healthy: boolean;
  latency: number;
  error?: string;
}

/** GlueService 配置 */
export interface GlueServiceConfig {
  /** Profile 配置列表 */
  profiles: ProfileConfig[];
  /** 健康检查间隔（ms），默认 30000 */
  healthCheckInterval?: number;
  /** 健康检查超时（ms），默认 5000 */
  healthCheckTimeout?: number;
  /** 最大重启次数，默认 3 */
  maxRestartCount?: number;
  /** 是否启用自动重启，默认 true */
  autoRestart?: boolean;
}
