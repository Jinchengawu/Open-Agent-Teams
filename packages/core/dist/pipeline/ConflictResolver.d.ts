/**
 * ConflictResolver — 冲突解决引擎
 *
 * 当 Pipeline 中多个 Agent 产生冲突产物时，自动触发仲裁机制。
 * 支持多种解决策略：
 * - project-admin 仲裁（默认）
 * - 投票机制（多数决）
 * - 合并策略（取并集）
 * - 最新优先（取最后一次执行结果）
 */
import type { TeamOrchestrator } from '../team/TeamOrchestrator.js';
import type { KnowledgeCenter } from '../knowledge/KnowledgeCenter.js';
import type { SurfaceResult } from './types.js';
export type ConflictStrategy = 'arbitration' | 'vote' | 'merge' | 'latest' | 'manual';
export interface ConflictConfig {
    /** 解决策略 */
    strategy: ConflictStrategy;
    /** 策略参数 */
    params?: Record<string, any>;
}
export interface ConflictResolution {
    resolved: boolean;
    winner?: string;
    merged?: Record<string, any>;
    reason: string;
    strategy: ConflictStrategy;
    metadata?: Record<string, any>;
}
export interface Conflict {
    /** 冲突 ID */
    id: string;
    /** 冲突描述 */
    description: string;
    /** 冲突面 */
    surfaceIds: string[];
    /** 冲突产物 */
    artifacts: Record<string, SurfaceResult>;
    /** 创建时间 */
    createdAt: number;
    /** 解决状态 */
    status: 'pending' | 'resolved' | 'rejected';
    /** 解决结果 */
    resolution?: ConflictResolution;
}
export declare class ConflictResolver {
    private teamOrchestrator;
    private knowledgeCenter?;
    private conflicts;
    private defaultStrategy;
    constructor(teamOrchestrator: TeamOrchestrator, knowledgeCenter?: KnowledgeCenter, defaultStrategy?: ConflictStrategy);
    /**
     * 注册冲突（Pipeline 调用）
     */
    registerConflict(instanceId: string, surfaceIds: string[], artifacts: Record<string, SurfaceResult>, description: string): Conflict;
    /**
     * 解决冲突（主入口）
     */
    resolve(conflictId: string, config?: ConflictConfig): Promise<ConflictResolution>;
    /**
     * 策略 1: project-admin 仲裁（默认）
     */
    private arbitrate;
    /**
     * 策略 2: 投票机制（多数决）
     */
    private vote;
    /**
     * 策略 3: 合并策略（取并集）
     */
    private merge;
    /**
     * 策略 4: 最新优先
     */
    private latest;
    /**
     * 策略 5: 人工介入（暂停等待）
     */
    private manual;
    /**
     * 获取所有未解决的冲突
     */
    getPendingConflicts(): Conflict[];
    /**
     * 获取冲突详情
     */
    getConflict(id: string): Conflict | undefined;
    /**
     * 列出所有冲突
     */
    listConflicts(): Conflict[];
    /**
     * 构建仲裁提示词
     */
    private buildArbitrationPrompt;
    /**
     * 构建投票提示词
     */
    private buildVotePrompt;
    /**
     * 从投票结果中提取胜出者
     */
    private extractWinnerFromVote;
    /**
     * 记录到知识中心
     */
    private recordToKnowledgeCenter;
}
export declare function createConflictResolver(teamOrchestrator: TeamOrchestrator, knowledgeCenter?: KnowledgeCenter, defaultStrategy?: ConflictStrategy): ConflictResolver;
//# sourceMappingURL=ConflictResolver.d.ts.map