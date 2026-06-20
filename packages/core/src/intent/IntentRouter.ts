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
 * 设计为通用模块，不耦合任何业务 Agent ID。
 */

import type {
  TeamAgentConfig,
  RoutingDecision,
  IntentRouterConfig,
} from '../orchestrator/types.js';

/**
 * IntentRouter — LLM-based 意图路由
 */
export class IntentRouter {
  private config: Required<IntentRouterConfig>;
  private agentCapabilities: TeamAgentConfig[];
  private defaultAgentId: string;

  constructor(
    config: IntentRouterConfig,
    agentCapabilities: TeamAgentConfig[],
    defaultAgentId: string,
  ) {
    this.config = {
      timeoutMs: 10000,
      ...config,
    };
    this.agentCapabilities = agentCapabilities;
    this.defaultAgentId = defaultAgentId;
  }

  /**
   * 核心路由方法
   */
  async route(userQuery: string): Promise<RoutingDecision> {
    const prompt = this.buildRouterPrompt(userQuery);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);

      const response = await fetch(`${this.config.baseURL}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: 'system', content: this.buildSystemPrompt() },
            { role: 'user', content: prompt },
          ],
          temperature: 0.2, // 低温度确保路由稳定性
          max_tokens: 800,
          response_format: { type: 'json_object' },
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
      }

      const data = (await response.json()) as {
        choices: [{ message: { content: string } }];
      };

      const rawContent = data.choices[0]?.message?.content || '{}';
      const decision = this.parseAndValidateDecision(rawContent, userQuery);

      return decision;
    } catch (error) {
      // 路由失败时回退到默认策略
      console.warn('[IntentRouter] 路由决策失败，使用默认回退:', error);
      return this.fallbackDecision(userQuery);
    }
  }

  /**
   * 构建系统 Prompt — 定义路由专家的职责和行为
   */
  private buildSystemPrompt(): string {
    return `你是一个专业的意图路由分析师。你的职责是分析用户需求，选择最佳的 Agent 协作策略。

你的输出必须是合法的 JSON 对象，包含以下字段：
- strategy: "single" | "team" | "meeting"
- primaryAgent: string（strategy 为 single 时必填，指定主 Agent ID）
- involvedAgents: string[]（strategy 为 team 或 meeting 时必填，列出参与的 Agent）
- reasoning: string（详细说明路由决策的理由）
- complexity: "low" | "medium" | "high"

路由策略定义：
- single: 任务单一、明确，一个 Agent 的专业领域即可独立完成
- team: 任务复杂、有多个子任务和依赖关系，需要多个 Agent 按 DAG 编排协作
- meeting: 任务涉及多个领域的判断和讨论，需要多 Agent 共同商议决策

复杂度判断标准：
- low: 原子性任务，目标单一，步骤不超过3步
- medium: 多步骤但领域关联紧密
- high: 架构级、跨多个独立领域、需要权衡取舍`;
  }

  /**
   * 构建路由分析 Prompt
   */
  private buildRouterPrompt(userQuery: string): string {
    const agentDescriptions = this.agentCapabilities
      .map(
        (a) => `
【Agent: ${a.id}】
名称: ${a.name}
角色: ${a.role}
${a.expertise ? `专长: ${a.expertise.join('、')}` : ''}
${a.typicalTasks ? `典型任务: ${a.typicalTasks.join('、')}` : ''}
${a.tools ? `可用工具: ${a.tools.join('、')}` : ''}
`,
      )
      .join('\n---\n');

    return `以下是可用的 Agent 列表：

${agentDescriptions}

---

用户请求: "${userQuery}"

请分析这个请求：
1. 用户的核心意图是什么？
2. 涉及哪些技术领域？
3. 任务的复杂度如何？
4. 最适合的协作策略是什么？

输出 JSON 格式的路由决策。`;
  }

  /**
   * 解析并校验 LLM 返回的决策
   */
  private parseAndValidateDecision(rawContent: string, userQuery: string): RoutingDecision {
    let parsed: Partial<RoutingDecision>;

    try {
      parsed = JSON.parse(rawContent) as Partial<RoutingDecision>;
    } catch {
      console.warn('[IntentRouter] LLM 返回非 JSON，尝试提取:', rawContent.substring(0, 200));
      parsed = this.extractDecisionFromText(rawContent);
    }

    // 校验并修正
    const validAgentIds = new Set(this.agentCapabilities.map((a) => a.id));

    let strategy = parsed.strategy || 'single';
    if (!['single', 'team', 'meeting'].includes(strategy)) {
      strategy = 'single';
    }

    // 校验 primaryAgent
    let primaryAgent = parsed.primaryAgent;
    if (strategy === 'single' && (!primaryAgent || !validAgentIds.has(primaryAgent))) {
      primaryAgent = this.defaultAgentId;
    }

    // 校验 involvedAgents
    let involvedAgents = parsed.involvedAgents || [];
    if (strategy === 'team' || strategy === 'meeting') {
      involvedAgents = involvedAgents.filter((id) => validAgentIds.has(id));
      if (involvedAgents.length === 0) {
        // 如果都没命中，包含所有 Agent
        involvedAgents = [...validAgentIds];
      }
    }

    const reasoning = parsed.reasoning || `基于用户请求"${userQuery.substring(0, 50)}"的默认路由`;

    let complexity = parsed.complexity || 'medium';
    if (!['low', 'medium', 'high'].includes(complexity)) {
      complexity = 'medium';
    }

    return {
      strategy: strategy as 'single' | 'team' | 'meeting',
      primaryAgent: strategy === 'single' ? primaryAgent : undefined,
      involvedAgents: strategy !== 'single' ? involvedAgents : undefined,
      reasoning,
      complexity: complexity as 'low' | 'medium' | 'high',
    };
  }

  /**
   * 从非 JSON 文本中提取决策（应急处理）
   */
  private extractDecisionFromText(text: string): Partial<RoutingDecision> {
    const lower = text.toLowerCase();
    let strategy: 'single' | 'team' | 'meeting' = 'single';
    if (lower.includes('meeting')) strategy = 'meeting';
    else if (lower.includes('team')) strategy = 'team';

    const complexity: 'low' | 'medium' | 'high' = lower.includes('high')
      ? 'high'
      : lower.includes('low')
        ? 'low'
        : 'medium';

    return { strategy, complexity, reasoning: text.substring(0, 200) };
  }

  /**
   * 回退决策 — 当 LLM 路由失败时使用
   */
  private fallbackDecision(_userQuery: string): RoutingDecision {
    return {
      strategy: 'single',
      primaryAgent: this.defaultAgentId,
      reasoning: `LLM 路由失败，使用默认回退策略（${this.defaultAgentId}）`,
      complexity: 'medium',
    };
  }
}
