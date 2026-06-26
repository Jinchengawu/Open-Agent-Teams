/**
 * IntentRouter — LLM-based 意图路由
 *
 * 职责：
 * - 接收用户查询
 * - 分析意图和复杂度
 * - 决策协作模式（single / team / meeting）
 * - 返回结构化路由决策（含推理理由，可审计）
 *
 * 不直接执行任何 Agent 操作，只负责"决策"。
 */
import type { TeamAgentConfig, RoutingDecision, IntentRouterConfig } from '../orchestrator/types.js';
/**
 * IntentRouter — LLM-based 意图路由
 */
export declare class IntentRouter {
    private config;
    private agentCapabilities;
    constructor(config: IntentRouterConfig, agentCapabilities: TeamAgentConfig[]);
    /**
     * 核心路由方法
     */
    route(userQuery: string): Promise<RoutingDecision>;
    /**
     * 构建系统 Prompt — 定义路由专家的职责和行为
     */
    private buildSystemPrompt;
    /**
     * 构建路由分析 Prompt
     */
    private buildRouterPrompt;
    /**
     * 解析并校验 LLM 返回的决策
     */
    private parseAndValidateDecision;
    /**
     * 从非 JSON 文本中提取决策（应急处理）
     */
    private extractDecisionFromText;
    /**
     * 回退决策 — 当 LLM 路由失败时使用
     */
    private fallbackDecision;
}
//# sourceMappingURL=IntentRouter.d.ts.map