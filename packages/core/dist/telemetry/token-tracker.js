/**
 * Token 使用统计 + 成本追踪
 *
 * 追踪每个 Agent/任务的 Token 使用量和成本。
 */
/** 默认定价（MiMo-v2.5-pro 参考价格） */
const DEFAULT_PRICING = {
    inputPrice: 2.0, // 2 元 / 1M input tokens
    outputPrice: 6.0, // 6 元 / 1M output tokens
};
export class TokenTracker {
    records = [];
    pricing;
    maxRecords;
    constructor(config) {
        this.pricing = config?.pricing ?? DEFAULT_PRICING;
        this.maxRecords = config?.maxRecords ?? 10_000;
    }
    /** 记录 Token 使用 */
    track(agentId, taskType, inputTokens, outputTokens) {
        const totalTokens = inputTokens + outputTokens;
        const cost = this.calculateCost(inputTokens, outputTokens);
        const record = {
            agentId,
            taskType,
            inputTokens,
            outputTokens,
            totalTokens,
            cost,
            timestamp: new Date().toISOString(),
        };
        this.records.push(record);
        // 超过上限时清理旧记录
        if (this.records.length > this.maxRecords) {
            this.records = this.records.slice(-this.maxRecords);
        }
        return record;
    }
    /** 计算成本 */
    calculateCost(inputTokens, outputTokens) {
        return ((inputTokens / 1_000_000) * this.pricing.inputPrice +
            (outputTokens / 1_000_000) * this.pricing.outputPrice);
    }
    /** 获取总使用量 */
    getTotalUsage() {
        return {
            tokens: this.records.reduce((sum, r) => sum + r.totalTokens, 0),
            cost: this.records.reduce((sum, r) => sum + r.cost, 0),
            count: this.records.length,
        };
    }
    /** 按 Agent 统计 */
    getByAgent() {
        const stats = new Map();
        for (const record of this.records) {
            const existing = stats.get(record.agentId) ?? { tokens: 0, cost: 0, count: 0 };
            existing.tokens += record.totalTokens;
            existing.cost += record.cost;
            existing.count += 1;
            stats.set(record.agentId, existing);
        }
        return stats;
    }
    /** 按任务类型统计 */
    getByTaskType() {
        const stats = new Map();
        for (const record of this.records) {
            const existing = stats.get(record.taskType) ?? { tokens: 0, cost: 0, count: 0 };
            existing.tokens += record.totalTokens;
            existing.cost += record.cost;
            existing.count += 1;
            stats.set(record.taskType, existing);
        }
        return stats;
    }
    /** 获取最近 N 条记录 */
    getRecent(count) {
        return this.records.slice(-count);
    }
    /** 获取所有记录 */
    getAll() {
        return [...this.records];
    }
    /** 清空记录 */
    clear() {
        this.records = [];
    }
}
//# sourceMappingURL=token-tracker.js.map