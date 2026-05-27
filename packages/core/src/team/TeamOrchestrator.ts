/**
 * TeamOrchestrator — 基于 open-multi-agent 的多 Agent 协作编排器
 *
 * 核心能力：
 * - runTeam(): 自动拆解目标 → 并行分配 → 结果汇总
 * - 内置 delegateToAgentTool: Agent 可主动委托其他 Agent
 * - MessageBus: Agent 间消息传递
 * - SharedMemory: 团队共享上下文
 */

import {
  OpenMultiAgent,
  Team,
  Agent,
  type TeamConfig,
  type TeamRunResult,
  type AgentConfig,
  type AgentRunResult,
} from '@open-multi-agent/core';

// ============================================================================
// Config
// ============================================================================

export interface TeamAgentConfig {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  model: string;
  apiKey: string;
  baseUrl: string;
}

export interface TeamOrchestratorConfig {
  agents: TeamAgentConfig[];
  defaultModel: string;
  apiKey: string;
  baseUrl: string;
}

// ============================================================================
// Orchestrator
// ============================================================================

export class TeamOrchestrator {
  private omAgent: OpenMultiAgent;
  private team: Team;
  private agentConfigs: Map<string, TeamAgentConfig>;

  constructor(config: TeamOrchestratorConfig) {
    this.agentConfigs = new Map();
    for (const a of config.agents) {
      this.agentConfigs.set(a.id, a);
    }

    // 初始化 OpenMultiAgent
    this.omAgent = new OpenMultiAgent({
      defaultModel: config.defaultModel,
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });

    // 创建团队 — 每个 DEV Agent 映射为一个 open-multi-agent Agent
    const teamAgents: Agent[] = config.agents.map((a) => ({
      name: a.id,
      model: config.defaultModel,
      systemPrompt: a.systemPrompt,
    }));

    // 添加协调员 Agent
    const coordinator: Agent = {
      name: 'coordinator',
      model: config.defaultModel,
      systemPrompt: `你是一个多 Agent 团队的协调员。根据用户目标：
1. 分析任务，拆解为独立子任务
2. 将子任务通过 delegate_to_agent 工具分配给合适的 Agent
3. 收集各 Agent 结果后汇总输出

可用 Agent 成员：
${config.agents.map((a) => `- ${a.id}: ${a.role}`).join('\n')}`,
    };

    this.team = this.omAgent.createTeam('dev-agent-team', {
      name: 'DEV-Agent-Team',
      agents: [coordinator, ...teamAgents],
      sharedMemory: true,
    });

    console.log(`[TeamOrchestrator] 团队已创建: ${this.team.agents.length} 成员`);
  }

  /**
   * runTeam — 自动编排多 Agent 协作
   * 协调员分析目标 → 拆解任务 → delegate 给各 Agent → 汇总结果
   */
  async runTeam(goal: string): Promise<TeamRunResult> {
    console.log(`[TeamOrchestrator] runTeam: "${goal.substring(0, 60)}..."`);
    return this.omAgent.runTeam(this.team, goal);
  }

  /**
   * runAgent — 单 Agent 执行
   */
  async runAgent(agentId: string, goal: string): Promise<AgentRunResult> {
    const config = this.agentConfigs.get(agentId);
    if (!config) throw new Error(`Agent "${agentId}" not found`);

    return this.omAgent.runAgent(
      {
        name: config.id,
        model: this.team.config?.defaultModel || config.model,
        systemPrompt: config.systemPrompt,
      },
      goal
    );
  }

  /**
   * 获取 Agent 间消息历史
   */
  getMessages() {
    return this.team.messageBus?.getHistory() || [];
  }

  /**
   * 获取团队状态
   */
  getStatus() {
    return {
      teamAgents: this.team.agents.map((a) => ({
        name: a.name,
        model: a.model || 'default',
      })),
      coordinator: this.team.coordinator?.name || 'coordinator',
      sharedMemory: !!this.team.config?.sharedMemory,
    };
  }
}

/**
 * 便捷工厂 — 用 DEV-Agent-Teams 的 Agent 配置创建编排器
 */
export function createTeamOrchestrator(agents: TeamAgentConfig[], model?: string): TeamOrchestrator {
  return new TeamOrchestrator({
    agents,
    defaultModel: model || process.env.MODEL_NAME || 'mimo-v2.5-pro',
    apiKey: process.env.API_KEY || '',
    baseUrl: process.env.MODEL_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1',
  });
}

/**
 * 从环境变量创建 DEV-Agent-Teams 标准团队
 */
export function createDevTeamOrchestrator(): TeamOrchestrator {
  const model = process.env.MODEL_NAME || 'mimo-v2.5-pro';
  const apiKey = process.env.API_KEY || '';
  const baseUrl = process.env.MODEL_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1';

  const agents: TeamAgentConfig[] = [
    {
      id: 'dev-frontend',
      name: 'Frontend Agent',
      role: '前端开发专家 — React/Vue/TypeScript/CSS/Tailwind',
      systemPrompt: '你是前端开发专家，专注于 React、Vue、TypeScript、CSS、Tailwind。收到任务后给出具体可运行的代码方案。',
      model, apiKey, baseUrl,
    },
    {
      id: 'dev-backend',
      name: 'Backend Agent',
      role: '后端开发专家 — Python/Node.js/Go/API/数据库',
      systemPrompt: '你是后端开发专家，专注于 Python、Node.js、Go、API 设计、数据库。收到任务后给出具体可运行的代码方案。',
      model, apiKey, baseUrl,
    },
    {
      id: 'dev-testing',
      name: 'Testing Agent',
      role: '测试专家 — pytest/Jest/Playwright/覆盖率',
      systemPrompt: '你是测试专家，专注于 pytest、Jest、Playwright、覆盖率。收到任务后给出具体的测试方案和用例。',
      model, apiKey, baseUrl,
    },
    {
      id: 'dev-devops',
      name: 'DevOps Agent',
      role: '运维专家 — Docker/K8s/CI-CD/部署',
      systemPrompt: '你是 DevOps 专家，专注于 Docker、K8s、CI/CD、部署。收到任务后给出具体的部署方案。',
      model, apiKey, baseUrl,
    },
    {
      id: 'dev-pm',
      name: 'PM Agent',
      role: '产品经理 — PRD/需求分析/用户故事/产品策略',
      systemPrompt: '你是产品经理，专注于 PRD、需求分析、用户故事、产品策略。收到任务后给出结构化的产品文档。',
      model, apiKey, baseUrl,
    },
  ];

  return new TeamOrchestrator({ agents, defaultModel: model, apiKey, baseUrl });
}
