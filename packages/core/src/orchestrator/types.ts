/**
 * Orchestrator 本地类型定义
 *
 * 这些类型不依赖 @open-multi-agent/core，用于解耦。
 */

// ============================================================================
// Agent 配置
// ============================================================================

export interface TeamAgentConfig {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  model: string;
  apiKey: string;
  baseUrl: string;
}

// ============================================================================
// 执行结果
// ============================================================================

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

export interface ToolCallRecord {
  toolName: string;
  input: Record<string, unknown>;
  output: string;
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | Array<{ type: string; text?: string; [key: string]: unknown }>;
}

export interface AgentRunResult {
  success: boolean;
  output: string;
  messages: LLMMessage[];
  tokenUsage: TokenUsage;
  toolCalls: ToolCallRecord[];
}

export interface TeamRunResult {
  success: boolean;
  goal: string;
  agentResults: Map<string, AgentRunResult>;
  totalTokenUsage: TokenUsage;
}

// ============================================================================
// 任务定义
// ============================================================================

export interface TaskDefinition {
  title: string;
  description: string;
  assignee?: string;
  dependsOn?: string[];
}

// ============================================================================
// 进度事件
// ============================================================================

export type MeetingProgressEvent =
  | { type: 'agent_start'; agent: string; name: string; role: string; index: number; total: number }
  | { type: 'thinking'; agent: string; name: string; message: string }
  | { type: 'output'; agent: string; name: string; role: string; output: string; toolCalls: number; index: number; total: number }
  | { type: 'error'; agent: string; name: string; error: string }
  | { type: 'done' };

export type OrchestratorEvent =
  | { type: 'task_start'; task?: string }
  | { type: 'task_complete'; task?: string }
  | { type: 'agent_start'; agent: string }
  | { type: 'agent_complete'; agent: string }
  | { type: 'error'; error: string };

// ============================================================================
// 编排器状态
// ============================================================================

export interface OrchestratorAgentInfo {
  name: string;
  model: string;
}

export interface OrchestratorStatus {
  teamAgents: OrchestratorAgentInfo[];
  sharedMemory: boolean;
}

// ============================================================================
// 编排器配置
// ============================================================================

export interface TeamOrchestratorConfig {
  agents: TeamAgentConfig[];
  defaultModel: string;
  apiKey: string;
  baseUrl: string;
  maxConcurrency?: number;
  maxDelegationDepth?: number;
  onProgress?: (event: OrchestratorEvent) => void;
}
