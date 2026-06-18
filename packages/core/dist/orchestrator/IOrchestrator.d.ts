/**
 * IOrchestrator — 编排器抽象接口
 *
 * 定义编排器的公共 API，不暴露底层实现细节。
 * 当前由 TeamOrchestrator（基于 @open-multi-agent/core）实现，
 * 未来可替换为其他编排后端。
 */
import type { TeamRunResult, AgentRunResult, TaskDefinition, OrchestratorStatus, MeetingProgressEvent } from './types.js';
export interface IOrchestrator {
    /** 自动编排：目标 → DAG 分解 → 并行执行 → 汇总 */
    runTeam(goal: string, options?: {
        maxRounds?: number;
    }): Promise<TeamRunResult>;
    /** 单 Agent 执行简单任务 */
    runAgent(agentId: string, goal: string): Promise<AgentRunResult>;
    /** 显式任务列表（用户指定具体步骤） */
    runTasks(tasks: TaskDefinition[]): Promise<TeamRunResult>;
    /** 圆桌会议：所有 Agent 顺序发言，共享上下文 */
    runMeeting(goal: string): Promise<TeamRunResult>;
    /** 带实时进度的圆桌会议（并发控制 + 重试） */
    runMeetingWithProgress(goal: string, onProgress: (event: MeetingProgressEvent) => void): Promise<TeamRunResult>;
    /** 获取 Agent 间消息历史 */
    getMessages(agentName?: string): unknown[];
    /** 广播消息给所有 Agent */
    broadcast(from: string, content: string): void;
    /** 获取编排器状态（不暴露上游类型） */
    getStatus(): OrchestratorStatus;
    /** 关闭编排器，释放资源 */
    shutdown(): Promise<void>;
}
//# sourceMappingURL=IOrchestrator.d.ts.map