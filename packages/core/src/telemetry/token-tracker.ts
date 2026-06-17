/**
 * Token 使用统计 + 成本追踪
 *
 * 追踪每个 Agent/任务的 Token 使用量和成本。
 */

/** Token 使用记录 */
export interface TokenUsageRecord {
  agentId: string;
  taskType: string; // 'chat' | 'meeting' | 'tool' | 'system'
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

/** 默认定价（MiMo-v2.5-pro 参考价格） */
const DEFAULT_PRICING: ModelPricing = {
  inputPrice: 2.0,   // 2 元 / 1M input tokens
  outputPrice: 6.0,  // 6 元 / 1M output tokens
};

export class TokenTracker {
  private records: TokenUsageRecord[] = [];
  private pricing: ModelPricing;
  private maxRecords: number;

  constructor(config?: { pricing?: ModelPricing; maxRecords?: number }) {
    this.pricing = config?.pricing ?? DEFAULT_PRICING;
    this.maxRecords = config?.maxRecords ?? 10_000;
  }

  /** 记录 Token 使用 */
  track(
    agentId: string,
    taskType: string,
    inputTokens: number,
    outputTokens: number
  ): TokenUsageRecord {
    const totalTokens = inputTokens + outputTokens;
    const cost = this.calculateCost(inputTokens, outputTokens);

    const record: TokenUsageRecord = {
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
  calculateCost(inputTokens: number, outputTokens: number): number {
    return (
      (inputTokens / 1_000_000) * this.pricing.inputPrice +
      (outputTokens / 1_000_000) * this.pricing.outputPrice
    );
  }

  /** 获取总使用量 */
  getTotalUsage(): { tokens: number; cost: number; count: number } {
    return {
      tokens: this.records.reduce((sum, r) => sum + r.totalTokens, 0),
      cost: this.records.reduce((sum, r) => sum + r.cost, 0),
      count: this.records.length,
    };
  }

  /** 按 Agent 统计 */
  getByAgent(): Map<string, { tokens: number; cost: number; count: number }> {
    const stats = new Map<string, { tokens: number; cost: number; count: number }>();
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
  getByTaskType(): Map<string, { tokens: number; cost: number; count: number }> {
    const stats = new Map<string, { tokens: number; cost: number; count: number }>();
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
  getRecent(count: number): TokenUsageRecord[] {
    return this.records.slice(-count);
  }

  /** 获取所有记录 */
  getAll(): TokenUsageRecord[] {
    return [...this.records];
  }

  /** 清空记录 */
  clear(): void {
    this.records = [];
  }
}
