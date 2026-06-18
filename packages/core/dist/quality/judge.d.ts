/**
 * LLM-as-a-judge 自检模式
 *
 * 自动评估 Agent 输出质量，生成评分和改进建议。
 */
/** 评估维度 */
export type EvaluationDimension = 'relevance' | 'completeness' | 'accuracy' | 'clarity' | 'efficiency';
/** 评估结果 */
export interface EvaluationResult {
    agentId: string;
    taskType: string;
    scores: Record<EvaluationDimension, number>;
    overallScore: number;
    feedback: string;
    suggestions: string[];
    timestamp: string;
}
/** 评估请求 */
export interface EvaluationRequest {
    agentId: string;
    taskType: string;
    task: string;
    output: string;
    context?: string;
    dimensions?: EvaluationDimension[];
}
/** LLM 调用接口 */
export interface LLMCaller {
    call(prompt: string): Promise<string>;
}
export declare class OutputJudge {
    private llm;
    private evaluations;
    constructor(llm: LLMCaller);
    /** 评估 Agent 输出 */
    evaluate(request: EvaluationRequest): Promise<EvaluationResult>;
    /** 构建评估提示词 */
    private buildPrompt;
    /** 获取维度描述 */
    private getDimensionDescription;
    /** 解析 LLM 响应 */
    private parseResponse;
    /** 获取评估历史 */
    getEvaluations(agentId?: string): EvaluationResult[];
    /** 获取平均评分 */
    getAverageScore(agentId?: string): number;
    /** 清空评估历史 */
    clear(): void;
}
//# sourceMappingURL=judge.d.ts.map