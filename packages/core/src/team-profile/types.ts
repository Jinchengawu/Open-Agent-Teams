import type { TeamAgentConfig } from '../orchestrator/types.js';
import type { PipelineDefinition } from '../pipeline/types.js';

export interface TeamProfileAgentDefinition {
  id: string;
  name: string;
  role: string;
  systemPrompt: string;
  expertise: string[];
  tools: string[];
  typicalTasks: string[];
  tags?: string[];
  port?: number;
  hermesPort?: number;
  timeoutMs?: number;
}

export interface TeamProfileHermesInstance {
  id: string;
  label: string;
  port: number;
  hermes_port: number;
  tags: string[];
  skills: string[];
  timeout_ms: number;
}

export interface TeamProfileHermesConfig {
  instances: TeamProfileHermesInstance[];
  routing: {
    rules: { tags: string[]; instance: string }[];
    default: string;
  };
}

export interface TeamProfile {
  id: string;
  name: string;
  description: string;
  defaultAgentId: string;
  arbitrationAgentId: string;
  agents: TeamProfileAgentDefinition[];
  hermes: TeamProfileHermesConfig;
  lifecyclePipeline: PipelineDefinition;
}

export interface TeamProfileRuntimeOptions {
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  communicationGuide?: string;
}

export function materializeTeamAgents(
  profile: TeamProfile,
  options: TeamProfileRuntimeOptions = {},
): TeamAgentConfig[] {
  const model = options.model || process.env.MODEL_NAME || 'mimo-v2.5-pro';
  const apiKey = options.apiKey || process.env.API_KEY || '';
  const baseUrl = options.baseUrl || process.env.MODEL_BASE_URL || 'https://token-plan-cn.xiaomimimo.com/v1';
  const guide = options.communicationGuide || buildTeamCommunicationGuide(profile);

  return profile.agents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    systemPrompt: `${agent.systemPrompt}${guide}`,
    model,
    apiKey,
    baseUrl,
    expertise: agent.expertise,
    tools: agent.tools,
    typicalTasks: agent.typicalTasks,
  }));
}

export function buildTeamCommunicationGuide(profile: TeamProfile): string {
  const members = profile.agents.map((agent) => agent.id).join(', ');
  const exampleTarget = profile.defaultAgentId;

  return [
    '',
    '',
    'Team communication:',
    'Use the team messaging tool when another Role Agent needs context, review, or a handoff.',
    `- send_message({ to: "${exampleTarget}", content: "..." }) sends a message to one Role Agent.`,
    '- send_message({ to: "*", content: "..." }) broadcasts to the team.',
    `Available Role Agents: ${members}.`,
    'Treat messages as coordination notes; durable decisions and artifacts should be captured in documents, tasks, or pipeline outputs.',
  ].join('\n');
}

export function getProfileAgent(profile: TeamProfile, agentId: string): TeamProfileAgentDefinition | undefined {
  return profile.agents.find((agent) => agent.id === agentId);
}
