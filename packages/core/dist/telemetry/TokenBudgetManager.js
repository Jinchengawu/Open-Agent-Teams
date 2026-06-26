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
export class TokenBudgetManager {
    budgets = new Map();
    defaultMaxTokens;
    defaultAlertThreshold;
    constructor(options) {
        this.defaultMaxTokens = options?.defaultMaxTokens || 100_000; // 默认 10万 token
        this.defaultAlertThreshold = options?.defaultAlertThreshold || 0.8; // 80% 告警
    }
    /**
     * 创建预算
     */
    createBudget(sessionId, maxTokens, alertThreshold) {
        const budget = {
            sessionId,
            maxTokens: maxTokens || this.defaultMaxTokens,
            usedTokens: 0,
            alertThreshold: alertThreshold || this.defaultAlertThreshold,
            status: 'active',
            createdAt: Date.now(),
        };
        this.budgets.set(sessionId, budget);
        return budget;
    }
    /**
     * 检查是否允许使用 estimatedTokens
     */
    checkBudget(sessionId, estimatedTokens = 1000) {
        let budget = this.budgets.get(sessionId);
        if (!budget) {
            budget = this.createBudget(sessionId);
        }
        const remaining = budget.maxTokens - budget.usedTokens;
        const projected = budget.usedTokens + estimatedTokens;
        const ratio = budget.usedTokens / budget.maxTokens;
        const projectedRatio = projected / budget.maxTokens;
        if (projected > budget.maxTokens) {
            budget.status = 'exceeded';
            return {
                allowed: false,
                remaining,
                status: 'exceeded',
                message: `Token 预算已超出: ${budget.usedTokens}/${budget.maxTokens} (需 ${estimatedTokens}，剩余 ${remaining})`,
            };
        }
        if (projectedRatio >= budget.alertThreshold) {
            budget.status = 'warning';
            return {
                allowed: true,
                remaining: remaining - estimatedTokens,
                status: 'warning',
                message: `Token 预算告警: ${projected}/${budget.maxTokens} (${Math.round(projectedRatio * 100)}%)`,
            };
        }
        budget.status = 'active';
        return {
            allowed: true,
            remaining: remaining - estimatedTokens,
            status: 'ok',
            message: `Token 预算充足: ${projected}/${budget.maxTokens}`,
        };
    }
    /**
     * 记录实际使用（调用后）
     */
    trackUsage(sessionId, actualTokens) {
        let budget = this.budgets.get(sessionId);
        if (!budget) {
            budget = this.createBudget(sessionId);
        }
        budget.usedTokens += actualTokens;
        const ratio = budget.usedTokens / budget.maxTokens;
        if (ratio >= 1.0) {
            budget.status = 'exceeded';
        }
        else if (ratio >= budget.alertThreshold) {
            budget.status = 'warning';
        }
        else {
            budget.status = 'active';
        }
    }
    /**
     * 消费 Token（trackUsage 的别名，兼容旧版 API）
     */
    consumeTokens = this.trackUsage.bind(this);
    /**
     * 获取预算状态
     */
    getBudgetStatus(sessionId) {
        return this.budgets.get(sessionId) || null;
    }
    /**
     * 获取所有预算
     */
    getAllBudgets() {
        return [...this.budgets.values()];
    }
    /**
     * 删除预算
     */
    deleteBudget(sessionId) {
        this.budgets.delete(sessionId);
    }
    /**
     * 设置全局默认预算
     */
    setDefaultMaxTokens(maxTokens) {
        this.defaultMaxTokens = maxTokens;
    }
    /**
     * 清理过期预算（超过 24 小时）
     */
    cleanupExpired(maxAgeMs = 24 * 60 * 60 * 1000) {
        const now = Date.now();
        let removed = 0;
        for (const [sid, budget] of this.budgets) {
            if (now - budget.createdAt > maxAgeMs) {
                this.budgets.delete(sid);
                removed++;
            }
        }
        return removed;
    }
}
/**
 * 全局单例
 */
let globalTokenBudgetManager = null;
export function getGlobalTokenBudgetManager(options) {
    if (!globalTokenBudgetManager) {
        globalTokenBudgetManager = new TokenBudgetManager(options);
    }
    return globalTokenBudgetManager;
}
export function resetGlobalTokenBudgetManager() {
    globalTokenBudgetManager = null;
}
//# sourceMappingURL=TokenBudgetManager.js.map