/**
 * Orchestrator 本地类型定义
 *
 * 这些类型不依赖 @open-multi-agent/core，用于解耦。
 */
export interface TeamAgentConfig {
    id: string;
    name: string;
    role: string;
    systemPrompt: string;
    model: string;
    apiKey: string;
    baseUrl: string;
    /** 专长领域列表（用于路由匹配） */
    expertise: string[];
    /** 可用工具列表 */
    tools: string[];
    /** 典型任务示例（帮助 LLM 理解 Agent 能力边界） */
    typicalTasks: string[];
}
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
    content: string | Array<{
        type: string;
        text?: string;
        [key: string]: unknown;
    }>;
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
export interface TaskDefinition {
    title: string;
    description: string;
    assignee?: string;
    dependsOn?: string[];
}
export type MeetingProgressEvent = {
    type: 'agent_start';
    agent: string;
    name: string;
    role: string;
    index: number;
    total: number;
} | {
    type: 'thinking';
    agent: string;
    name: string;
    message: string;
} | {
    type: 'output';
    agent: string;
    name: string;
    role: string;
    output: string;
    toolCalls: number;
    index: number;
    total: number;
} | {
    type: 'error';
    agent: string;
    name: string;
    error: string;
} | {
    type: 'done';
};
export type OrchestratorEvent = {
    type: 'task_start';
    task?: string;
} | {
    type: 'task_complete';
    task?: string;
} | {
    type: 'agent_start';
    agent: string;
} | {
    type: 'agent_complete';
    agent: string;
} | {
    type: 'error';
    error: string;
};
export interface OrchestratorAgentInfo {
    name: string;
    model: string;
}
export interface OrchestratorStatus {
    teamAgents: OrchestratorAgentInfo[];
    sharedMemory: boolean;
}
export interface TeamOrchestratorConfig {
    agents: TeamAgentConfig[];
    defaultModel: string;
    apiKey: string;
    baseUrl: string;
    /** Team profile id/name for framework-level runtime identity */
    profileId?: string;
    profileName?: string;
    /** Default Role Agent used when routing cannot confidently pick one */
    defaultAgentId?: string;
    /** Role Agent used for arbitration or conflict resolution */
    arbitrationAgentId?: string;
    maxConcurrency?: number;
    maxDelegationDepth?: number;
    onProgress?: (event: OrchestratorEvent) => void;
    /** 工作流状态管理器（可选 — 用于断点续传） */
    workflowStateManager?: import('../session/WorkflowStateManager.js').WorkflowStateManager;
    /** Token 预算管理器（可选 — 用于成本控制） */
    tokenBudgetManager?: import('../telemetry/TokenBudgetManager.js').TokenBudgetManager;
    /** 额外的自定义工具（如文档工具、看板工具） */
    extraCustomTools?: any[];
}
/**
 * 路由决策结果 — LLM 输出的结构化决策
 */
export interface RoutingDecision {
    /** 协作策略 */
    strategy: 'single' | 'team' | 'meeting';
    /** 主 Agent ID（single 模式下） */
    primaryAgent?: string;
    /** 参与 Agent ID 列表（team/meeting 模式下） */
    involvedAgents?: string[];
    /** 路由决策理由（可审计） */
    reasoning: string;
    /** 复杂度评估 */
    complexity: 'low' | 'medium' | 'high';
}
/**
 * IntentRouter 配置
 */
export interface IntentRouterConfig {
    /** LLM 模型名 */
    model: string;
    /** LLM baseURL */
    baseURL: string;
    /** LLM apiKey */
    apiKey: string;
    /** 超时时间（毫秒），默认 10000 */
    timeoutMs?: number;
    /** 默认 Agent ID，路由失败或 primaryAgent 无效时使用 */
    defaultAgentId?: string;
}
//# sourceMappingURL=types.d.ts.map