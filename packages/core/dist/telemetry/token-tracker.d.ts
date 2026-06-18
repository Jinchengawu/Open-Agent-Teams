/**
 * Token 使用统计 + 成本追踪
 *
 * 追踪每个 Agent/任务的 Token 使用量和成本。
 */
/** Token 使用记录 */
export interface TokenUsageRecord {
    agentId: string;
    taskType: string;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cost: number;
    timestamp: string;
}
/** 模型定价（每 1M tokens，单位：元） */
export interface ModelPricing {
    inputPrice: number;
    outputPrice: number;
}
export declare class TokenTracker {
    private records;
    private pricing;
    private maxRecords;
    constructor(config?: {
        pricing?: ModelPricing;
        maxRecords?: number;
    });
    /** 记录 Token 使用 */
    track(agentId: string, taskType: string, inputTokens: number, outputTokens: number): TokenUsageRecord;
    /** 计算成本 */
    calculateCost(inputTokens: number, outputTokens: number): number;
    /** 获取总使用量 */
    getTotalUsage(): {
        tokens: number;
        cost: number;
        count: number;
    };
    /** 按 Agent 统计 */
    getByAgent(): Map<string, {
        tokens: number;
        cost: number;
        count: number;
    }>;
    /** 按任务类型统计 */
    getByTaskType(): Map<string, {
        tokens: number;
        cost: number;
        count: number;
    }>;
    /** 获取最近 N 条记录 */
    getRecent(count: number): TokenUsageRecord[];
    /** 获取所有记录 */
    getAll(): TokenUsageRecord[];
    /** 清空记录 */
    clear(): void;
}
//# sourceMappingURL=token-tracker.d.ts.map