/**
 * TokenBudgetManager — Token 预算管理器
 *
 * 职责：
 * - 为每个 session/workflow 设置 Token 预算上限
 * - 跟踪已用 Token 数量
 * - 超出预算时阻止新的 LLM 调用
 * - 触发告警事件（阈值：80%）
 * - 支持优雅降级（停止非关键 Agent）
 *
 * 设计为轻量级，不依赖外部存储（内存 + 可选 SQLite）。
 */
export interface TokenBudget {
    sessionId: string;
    maxTokens: number;
    usedTokens: number;
    alertThreshold: number;
    status: 'active' | 'warning' | 'exceeded';
    createdAt: number;
}
export interface BudgetCheckResult {
    allowed: boolean;
    remaining: number;
    status: 'ok' | 'warning' | 'exceeded';
    message: string;
}
export declare class TokenBudgetManager {
    private budgets;
    private defaultMaxTokens;
    private defaultAlertThreshold;
    constructor(options?: {
        defaultMaxTokens?: number;
        defaultAlertThreshold?: number;
    });
    /**
     * 创建预算
     */
    createBudget(sessionId: string, maxTokens?: number, alertThreshold?: number): TokenBudget;
    /**
     * 检查是否允许使用 estimatedTokens
     */
    checkBudget(sessionId: string, estimatedTokens?: number): BudgetCheckResult;
    /**
     * 记录实际使用（调用后）
     */
    trackUsage(sessionId: string, actualTokens: number): void;
    /**
     * 消费 Token（trackUsage 的别名，兼容旧版 API）
     */
    consumeTokens: (sessionId: string, actualTokens: number) => void;
    /**
     * 获取预算状态
     */
    getBudgetStatus(sessionId: string): TokenBudget | null;
    /**
     * 获取所有预算
     */
    getAllBudgets(): TokenBudget[];
    /**
     * 删除预算
     */
    deleteBudget(sessionId: string): void;
    /**
     * 设置全局默认预算
     */
    setDefaultMaxTokens(maxTokens: number): void;
    /**
     * 清理过期预算（超过 24 小时）
     */
    cleanupExpired(maxAgeMs?: number): number;
}
export declare function getGlobalTokenBudgetManager(options?: {
    defaultMaxTokens?: number;
    defaultAlertThreshold?: number;
}): TokenBudgetManager;
export declare function resetGlobalTokenBudgetManager(): void;
//# sourceMappingURL=TokenBudgetManager.d.ts.map