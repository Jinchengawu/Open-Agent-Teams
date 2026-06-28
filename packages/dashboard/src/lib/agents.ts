import { AgentInfo } from './types';

export const AGENTS: Record<string, AgentInfo> = {
  'system-team-architect': {
    id: 'system-team-architect',
    name: 'Team Architect Agent',
    label: '团队架构师 Agent',
    icon: '🧭',
    color: 'from-cyan-500 to-emerald-500',
    tags: ['team-architect', 'onboarding', 'blueprint', 'workflow', 'initialization', '团队架构', '初始化'],
  },
  'intent-router': {
    id: 'intent-router',
    name: 'Intent Router',
    label: '智能意图路由 Agent',
    icon: '🧭',
    color: 'from-cyan-500 to-blue-600',
    tags: ['intent', 'route', 'triage', 'router', '意图', '路由', '分流'],
  },
  'team-orchestrator': {
    id: 'team-orchestrator',
    name: 'Team Orchestrator',
    label: '团队编排 Agent',
    icon: '🕸️',
    color: 'from-indigo-500 to-violet-600',
    tags: ['orchestrator', 'meeting', 'coordination', 'team', '编排', '会议', '协同'],
  },
  'workflow-conductor': {
    id: 'workflow-conductor',
    name: 'Workflow Conductor',
    label: '工作流执行 Agent',
    icon: '🔁',
    color: 'from-emerald-500 to-teal-600',
    tags: ['workflow', 'pipeline', 'surface', 'gate', '工作流', '流水线', '交付面'],
  },
  'knowledge-steward': {
    id: 'knowledge-steward',
    name: 'Knowledge Steward',
    label: '知识与文档 Agent',
    icon: '🧠',
    color: 'from-amber-500 to-orange-500',
    tags: ['knowledge', 'document', 'rag', 'memory', '知识', '文档', '记忆'],
  },
  'recovery-agent': {
    id: 'recovery-agent',
    name: 'Recovery Agent',
    label: '系统自检修复 Agent',
    icon: '🛠️',
    color: 'from-rose-500 to-red-600',
    tags: ['recovery', 'debug', 'repair', 'rollback', '自检', '修复', '回滚'],
  },
  'integration-agent': {
    id: 'integration-agent',
    name: 'Integration Agent',
    label: '协议与集成 Agent',
    icon: '🔌',
    color: 'from-slate-500 to-gray-700',
    tags: ['integration', 'adapter', 'mcp', 'a2a', 'hermes', '集成', '协议', '适配'],
  },
};

export const AGENT_LIST: AgentInfo[] = Object.values(AGENTS);

/**
 * 客户端降级路由 — Gateway 不可用时使用
 * 正常流程由 Gateway 的 TeamOrchestrator 处理
 */
export function detectAgent(message: string): string {
  const lower = message.toLowerCase();
  for (const agent of AGENT_LIST) {
    for (const tag of agent.tags) {
      if (lower.includes(tag.toLowerCase())) {
        return agent.id;
      }
    }
  }
  return 'team-orchestrator';
}
