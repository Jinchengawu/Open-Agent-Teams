import { AgentInfo } from './types';

export const AGENTS: Record<string, AgentInfo> = {
  frontend: {
    id: 'frontend',
    name: 'Frontend Agent',
    label: '前端开发 Agent',
    port: 8201,
    icon: '🎨',
    color: 'from-blue-500 to-blue-600',
    tags: ['react', 'vue', 'component', 'ui', 'css', 'typescript', 'frontend', '前端'],
  },
  backend: {
    id: 'backend',
    name: 'Backend Agent',
    label: '后端开发 Agent',
    port: 8202,
    icon: '⚙️',
    color: 'from-green-500 to-green-600',
    tags: ['api', 'database', 'server', 'python', 'node', 'go', 'backend', '后端'],
  },
  testing: {
    id: 'testing',
    name: 'Testing Agent',
    label: '测试开发 Agent',
    port: 8203,
    icon: '🧪',
    color: 'from-yellow-500 to-orange-500',
    tags: ['test', 'unit', 'e2e', 'coverage', 'jest', 'pytest', 'testing', '测试'],
  },
  devops: {
    id: 'devops',
    name: 'DevOps Agent',
    label: 'DevOps Agent',
    port: 8204,
    icon: '🚀',
    color: 'from-purple-500 to-purple-600',
    tags: ['docker', 'k8s', 'kubernetes', 'deploy', 'ci/cd', 'devops', '运维'],
  },
  pm: {
    id: 'pm',
    name: 'PM Agent',
    label: '产品经理 Agent',
    port: 8205,
    icon: '📋',
    color: 'from-red-500 to-pink-600',
    tags: ['prd', 'requirement', 'product', 'strategy', 'user-story', 'pm', '产品', '需求', '用户研究'],
  },
};

export const AGENT_LIST: AgentInfo[] = Object.values(AGENTS);

export function getAgentUrl(agentId: string): string {
  const agent = AGENTS[agentId];
  if (!agent) return 'http://localhost:8201';
  const ports: Record<string, number> = {
    frontend: 8201,
    backend: 8202,
    testing: 8203,
    devops: 8204,
    pm: 8205,
  };
  return `http://localhost:${ports[agentId] || 8201}`;
}

export function detectAgent(message: string): string {
  const lower = message.toLowerCase();
  for (const agent of AGENT_LIST) {
    for (const tag of agent.tags) {
      if (lower.includes(tag.toLowerCase())) {
        return agent.id;
      }
    }
  }
  return 'backend';
}
