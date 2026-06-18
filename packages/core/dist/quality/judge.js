/**
 * LLM-as-a-judge 自检模式
 *
 * 自动评估 Agent 输出质量，生成评分和改进建议。
 */
const DEFAULT_DIMENSIONS = [
    'relevance', 'completeness', 'accuracy', 'clarity', 'efficiency'
];
export class OutputJudge {
    llm;
    evaluations = [];
    constructor(llm) {
        this.llm = llm;
    }
    /** 评估 Agent 输出 */
    async evaluate(request) {
        const dimensions = request.dimensions ?? DEFAULT_DIMENSIONS;
        const prompt = this.buildPrompt(request, dimensions);
        try {
            const response = await this.llm.call(prompt);
            const result = this.parseResponse(response, request.agentId, request.taskType);
            this.evaluations.push(result);
            return result;
        }
        catch (error) {
            // LLM 调用失败时返回默认评分
            const fallback = {
                agentId: request.agentId,
                taskType: request.taskType,
                scores: Object.fromEntries(dimensions.map(d => [d, 5])),
                overallScore: 5,
                feedback: `评估失败: ${error instanceof Error ? error.message : String(error)}`,
                suggestions: [],
                timestamp: new Date().toISOString(),
            };
            this.evaluations.push(fallback);
            return fallback;
        }
    }
    /** 构建评估提示词 */
    buildPrompt(request, dimensions) {
        const dimensionList = dimensions.map(d => `- ${d}: ${this.getDimensionDescription(d)}`).join('\n');
        return `你是一个 AI 输出质量评估专家。请评估以下 Agent 输出的质量。

## 任务
${request.task}

## Agent 输出
${request.output}

${request.context ? `## 上下文\n${request.context}\n` : ''}
## 评估维度（每个维度 1-10 分）
${dimensionList}

请以 JSON 格式返回评估结果：
{
  "scores": { "relevance": 8, "completeness": 7, ... },
  "feedback": "总体评价...",
  "suggestions": ["改进建议1", "改进建议2"]
}`;
    }
    /** 获取维度描述 */
    getDimensionDescription(dim) {
        const descriptions = {
            relevance: '输出与任务的相关程度',
            completeness: '输出是否完整覆盖任务要求',
            accuracy: '信息的准确性和正确性',
            clarity: '表达是否清晰易懂',
            efficiency: '是否简洁高效，无冗余',
        };
        return descriptions[dim];
    }
    /** 解析 LLM 响应 */
    parseResponse(response, agentId, taskType) {
        try {
            // 尝试提取 JSON
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch)
                throw new Error('No JSON found in response');
            const parsed = JSON.parse(jsonMatch[0]);
            const scores = parsed.scores;
            // 计算总分
            const scoreValues = Object.values(scores);
            const overallScore = scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length;
            return {
                agentId,
                taskType,
                scores,
                overallScore: Math.round(overallScore * 10) / 10,
                feedback: parsed.feedback ?? '',
                suggestions: parsed.suggestions ?? [],
                timestamp: new Date().toISOString(),
            };
        }
        catch {
            // 解析失败时返回默认评分
            return {
                agentId,
                taskType,
                scores: Object.fromEntries(DEFAULT_DIMENSIONS.map(d => [d, 5])),
                overallScore: 5,
                feedback: '响应解析失败',
                suggestions: [],
                timestamp: new Date().toISOString(),
            };
        }
    }
    /** 获取评估历史 */
    getEvaluations(agentId) {
        if (agentId) {
            return this.evaluations.filter(e => e.agentId === agentId);
        }
        return [...this.evaluations];
    }
    /** 获取平均评分 */
    getAverageScore(agentId) {
        const evals = this.getEvaluations(agentId);
        if (evals.length === 0)
            return 0;
        return evals.reduce((sum, e) => sum + e.overallScore, 0) / evals.length;
    }
    /** 清空评估历史 */
    clear() {
        this.evaluations = [];
    }
}
//# sourceMappingURL=judge.js.map