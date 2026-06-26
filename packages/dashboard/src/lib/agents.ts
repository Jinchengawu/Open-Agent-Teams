import { AgentInfo } from './types';

export const AGENTS: Record<string, AgentInfo> = {
  'dev-frontend': {
    id: 'dev-frontend',
    name: 'Frontend Agent',
    label: '前端开发 Agent',
    icon: '🎨',
    color: 'from-blue-500 to-blue-600',
    tags: ['react', 'vue', 'component', 'ui', 'css', 'typescript', 'frontend', '前端'],
  },
  'dev-backend': {
    id: 'dev-backend',
    name: 'Backend Agent',
    label: '后端开发 Agent',
    icon: '⚙️',
    color: 'from-green-500 to-green-600',
    tags: ['api', 'database', 'server', 'python', 'node', 'go', 'backend', '后端'],
  },
  'dev-testing': {
    id: 'dev-testing',
    name: 'Testing Agent',
    label: '测试开发 Agent',
    icon: '🧪',
    color: 'from-yellow-500 to-orange-500',
    tags: ['test', 'unit', 'e2e', 'coverage', 'jest', 'pytest', 'testing', '测试'],
  },
  'dev-devops': {
    id: 'dev-devops',
    name: 'DevOps Agent',
    label: 'DevOps Agent',
    icon: '🚀',
    color: 'from-purple-500 to-purple-600',
    tags: ['docker', 'k8s', 'kubernetes', 'deploy', 'ci/cd', 'devops', '运维'],
  },
  'dev-pm': {
    id: 'dev-pm',
    name: 'PM Agent',
    label: '产品经理 Agent',
    icon: '📋',
    color: 'from-red-500 to-pink-600',
    tags: ['prd', 'requirement', 'product', 'strategy', 'user-story', 'pm', '产品', '需求'],
  },
  'project-admin': {
    id: 'project-admin',
    name: 'Project Admin',
    label: '项目管理员 Agent',
    icon: '📊',
    color: 'from-indigo-500 to-indigo-600',
    tags: ['project', 'admin', 'kanban', 'milestone', 'progress', 'task', '管理', '进度', '里程碑'],
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
  return 'dev-backend';
}
