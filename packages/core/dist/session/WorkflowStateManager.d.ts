/**
 * WorkflowStateManager — 工作流状态持久化管理器
 *
 * 职责：
 * - 保存工作流执行状态到 SQLite
 * - 从 SQLite 恢复工作流状态
 * - 支持断点续传（resume from checkpoint）
 * - 状态变更时自动触发 EventBus 事件
 *
 * 与 SessionManager 共享同一个 SQLite 数据库实例。
 */
import type { Database } from 'better-sqlite3';
import type { AgentRunResult, TokenUsage } from '../orchestrator/types.js';
export interface WorkflowStepState {
    index: number;
    agentId: string;
    goal: string;
    output: string;
    status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
    startedAt?: number;
    completedAt?: number;
    error?: string;
}
export interface WorkflowContext {
    sharedMemory?: string;
    discussion?: string[];
    [key: string]: unknown;
}
export interface WorkflowState {
    id: string;
    goal: string;
    status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
    currentStep: number;
    totalSteps: number;
    steps: WorkflowStepState[];
    context: WorkflowContext;
    tokenUsage: TokenUsage;
    error?: string;
    createdAt: number;
    updatedAt: number;
}
export declare class WorkflowStateManager {
    private db;
    constructor(db: Database);
    private initSchema;
    private migrateCancelledStatusConstraint;
    /**
     * 创建并保存新的工作流状态
     */
    createState(goal: string, totalSteps: number, id?: string, context?: WorkflowContext): WorkflowState;
    /**
     * 合并更新工作流上下文，用于持久化 Pipeline 元数据、协作绑定等恢复信息。
     */
    updateContext(workflowId: string, context: WorkflowContext): WorkflowState | null;
    /**
     * 保存工作流状态到 SQLite
     */
    save(state: WorkflowState): void;
    /**
     * 从 SQLite 加载工作流状态
     */
    load(workflowId: string): WorkflowState | null;
    /**
     * 更新步骤状态
     */
    updateStep(workflowId: string, stepIndex: number, updates: Partial<WorkflowStepState> & {
        agentResult?: AgentRunResult;
    }): void;
    /**
     * 完成工作流
     */
    complete(workflowId: string, finalOutput?: string): void;
    /**
     * 标记工作流失败
     */
    fail(workflowId: string, error: string): void;
    /**
     * 取消工作流
     */
    cancel(workflowId: string, reason?: string): void;
    /**
     * 获取所有正在运行的工作流
     */
    getRunningWorkflows(): WorkflowState[];
    /**
     * 列出所有工作流（分页）
     */
    listWorkflows(limit?: number, offset?: number): WorkflowState[];
    /**
     * 删除工作流状态
     */
    delete(workflowId: string): void;
}
//# sourceMappingURL=WorkflowStateManager.d.ts.map