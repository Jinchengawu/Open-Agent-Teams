/**
 * TeamOrchestrator — 基于 Hermes Agent 集群的多 Agent 协作编排器
 *
 * 重构说明：
 * - 移除对 @open-multi-agent/core 的依赖
 * - 使用 HermesAgentClient 通过 HTTP 调用 Hermes 实例（端口 8201-8205）
 * - Hermes 已自带工具、记忆、RAG，平台层只负责编排和通信
 */
import type { IOrchestrator } from '../orchestrator/IOrchestrator.js';
import type { TeamProfile } from '../team-profile/index.js';
import type { A2AMessage, A2ASendMessageRequest, A2ASendMessageResult } from '../a2a/index.js';
import type { TeamAgentConfig, TeamOrchestratorConfig, TeamRunResult, AgentRunResult, TaskDefinition, OrchestratorStatus, MeetingProgressEvent, OrchestratorEvent, RoutingDecision } from '../orchestrator/types.js';
export type { TeamAgentConfig, TeamOrchestratorConfig, MeetingProgressEvent, OrchestratorEvent } from '../orchestrator/types.js';
export declare class TeamOrchestrator implements IOrchestrator {
    private hermesClient;
    private agentConfigs;
    private intentRouter;
    private lastRoutingDecision;
    private workflowStateManager?;
    private tokenBudgetManager?;
    private extraCustomTools;
    private maxConcurrency;
    private maxDelegationDepth;
    private profileId;
    private profileName;
    private defaultAgentId;
    private arbitrationAgentId;
    private profile?;
    private onProgress?;
    constructor(config: TeamOrchestratorConfig);
    /**
     * runAgent — 单 Agent 执行
     * 直接调用 Hermes Agent 实例，让 Hermes 处理工具、记忆、RAG
     */
    runAgent(agentId: string, goal: string, sessionId?: string, options?: {
        signal?: AbortSignal;
        timeoutMs?: number;
        maxTokens?: number;
    }): Promise<AgentRunResult>;
    /**
     * runTeam — 多 Agent 协作执行
     * 由 IntentRouter 分析目标，决定哪些 Agent 参与，然后并行/串行调用 Hermes
     */
    runTeam(goal: string, options?: {
        maxRounds?: number;
        sessionId?: string;
    }): Promise<TeamRunResult>;
    /**
     * runTasks — 显式任务列表（串行执行）
     */
    runTasks(tasks: TaskDefinition[]): Promise<TeamRunResult>;
    /**
     * runMeeting — 圆桌会议模式
     * 所有 Agent 顺序执行，共享上下文，每人从自己的专业角度发表意见
     */
    runMeeting(goal: string, sessionId?: string, options?: {
        participantAgentIds?: string[];
    }): Promise<TeamRunResult>;
    /**
     * runMeetingWithProgress — 带实时进度的圆桌会议（并发控制 + 重试）
     */
    runMeetingWithProgress(goal: string, onProgress: (event: MeetingProgressEvent) => void, options?: {
        participantAgentIds?: string[];
    }): Promise<TeamRunResult>;
    private resolveMeetingAgentIds;
    /**
     * resumeWorkflow — 从断点续传工作流
     */
    resumeWorkflow(workflowId: string): Promise<TeamRunResult>;
    listWorkflows(limit?: number, offset?: number): import("../index.js").WorkflowState[];
    getRunningWorkflows(): import("../index.js").WorkflowState[];
    private checkBudget;
    private trackTokenUsage;
    /**
     * 获取 Agent 间消息历史
     */
    getMessages(agentName?: string): any[];
    /**
     * 广播消息给所有 Agent（fire-and-forget）
     */
    broadcast(from: string, content: string): void;
    /**
     * 异步广播 — 优先使用 A2A transport，失败时回退 MessageBus。
     */
    asyncBroadcast(from: string, content: string): Promise<void>;
    sendA2AMessage(toAgentId: string, request: A2ASendMessageRequest): Promise<A2ASendMessageResult>;
    broadcastA2AMessage(message: A2AMessage, from?: string): Promise<void>;
    getA2AMessages(agentId?: string): A2AMessage[];
    getStatus(): OrchestratorStatus;
    /**
     * 关闭编排器
     */
    shutdown(): Promise<void>;
    handleRequest(userQuery: string, sessionId?: string): Promise<TeamRunResult>;
    getLastRoutingDecision(): RoutingDecision | null;
    getDefaultAgentId(): string;
    getArbitrationAgentId(): string;
    private resolveAgentId;
    private registerA2AAgents;
    private toProfileAgentDefinition;
}
export declare function createTeamOrchestrator(agents: TeamAgentConfig[], model?: string, options?: {
    onProgress?: (event: OrchestratorEvent) => void;
    profileId?: string;
    profileName?: string;
    defaultAgentId?: string;
    arbitrationAgentId?: string;
    profile?: TeamProfile;
}): TeamOrchestrator;
export declare function createProfileTeamOrchestrator(profile: TeamProfile, options?: {
    onProgress?: (event: OrchestratorEvent) => void;
    workflowStateManager?: import('../session/WorkflowStateManager.js').WorkflowStateManager;
    tokenBudgetManager?: import('../telemetry/TokenBudgetManager.js').TokenBudgetManager;
    extraCustomTools?: any[];
}): TeamOrchestrator;
export declare function createOpenTeamOrchestrator(options?: {
    onProgress?: (event: OrchestratorEvent) => void;
    workflowStateManager?: import('../session/WorkflowStateManager.js').WorkflowStateManager;
    tokenBudgetManager?: import('../telemetry/TokenBudgetManager.js').TokenBudgetManager;
    extraCustomTools?: any[];
}): TeamOrchestrator;
/** @deprecated Use createOpenTeamOrchestrator or createProfileTeamOrchestrator. */
export declare function createDevTeamOrchestrator(options?: {
    onProgress?: (event: OrchestratorEvent) => void;
    workflowStateManager?: import('../session/WorkflowStateManager.js').WorkflowStateManager;
    tokenBudgetManager?: import('../telemetry/TokenBudgetManager.js').TokenBudgetManager;
    extraCustomTools?: any[];
}): TeamOrchestrator;
//# sourceMappingURL=TeamOrchestrator.d.ts.map