/**
 * TeamOrchestrator — 基于 open-multi-agent 的多 Agent 协作编排器
 *
 * 核心能力：
 * - runTeam(): 自动拆解目标 → 并行分配 → 结果汇总
 * - 内置 delegateToAgentTool: Agent 可主动委托其他 Agent
 * - MessageBus: Agent 间消息传递
 * - SharedMemory: 团队共享上下文
 */
import { type TeamRunResult, type AgentRunResult } from '@open-multi-agent/core';
export interface TeamAgentConfig {
    id: string;
    name: string;
    role: string;
    systemPrompt: string;
    model: string;
    apiKey: string;
    baseUrl: string;
}
export interface TeamOrchestratorConfig {
    agents: TeamAgentConfig[];
    defaultModel: string;
    apiKey: string;
    baseUrl: string;
}
export declare class TeamOrchestrator {
    private omAgent;
    private team;
    private agentConfigs;
    constructor(config: TeamOrchestratorConfig);
    /**
     * runTeam — 自动编排多 Agent 协作
     * 协调员分析目标 → 拆解任务 → delegate 给各 Agent → 汇总结果
     */
    runTeam(goal: string): Promise<TeamRunResult>;
    /**
     * runAgent — 单 Agent 执行
     */
    runAgent(agentId: string, goal: string): Promise<AgentRunResult>;
    /**
     * runMeeting — 圆桌会议模式
     * 所有 Agent 顺序执行，共享上下文，每人从自己的专业角度发表意见
     */
    runMeeting(goal: string): Promise<TeamRunResult>;
    /**
     * 获取 Agent 间消息历史
     */
    getMessages(agentName?: string): unknown[];
    /**
     * 获取团队状态
     */
    getStatus(): {
        teamAgents: {
            name: string;
            model: string;
        }[];
        coordinator: string;
        sharedMemory: boolean;
    };
}
/**
 * 便捷工厂 — 用 DEV-Agent-Teams 的 Agent 配置创建编排器
 */
export declare function createTeamOrchestrator(agents: TeamAgentConfig[], model?: string): TeamOrchestrator;
/**
 * 从环境变量创建 DEV-Agent-Teams 标准团队
 */
export declare function createDevTeamOrchestrator(): TeamOrchestrator;
//# sourceMappingURL=TeamOrchestrator.d.ts.map