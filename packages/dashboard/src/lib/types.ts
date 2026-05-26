export interface AgentHealth {
  status: string;
  agent: string;
  label: string;
  hermesPort: number;
  skills: number;
}

export interface AgentInfo {
  id: string;
  name: string;
  label: string;
  port: number;
  icon: string;
  color: string;
  tags: string[];
}

export interface AgentStatus extends AgentInfo {
  online: boolean;
  skillCount: number;
  error?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  agentId?: string;
  timestamp: number;
}

export interface Skill {
  id: string;
  name: string;
  category: string;
  description: string;
  tags: string[];
  agent: string;
}

export interface AppSettings {
  modelProvider: string;
  modelName: string;
  apiEndpoint: string;
  maxTokens: number;
  temperature: number;
  autoRoute: boolean;
  logLevel: string;
}

export interface DashboardStats {
  totalRequests: number;
  successRate: number;
  avgResponse: string;
  activeAgents: number;
}

export interface ActivityItem {
  id: number;
  agent: string;
  action: string;
  time: string;
  icon: string;
  color: string;
}
