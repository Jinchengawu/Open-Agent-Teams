import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { TeamAgentConfig } from '../orchestrator/types.js';

export interface RuntimeModelProfile {
  id: string;
  name?: string;
  provider?: string;
  modelName: string;
  apiEndpoint: string;
  apiKey?: string;
}

export interface RuntimeModelSettings {
  modelProfiles: RuntimeModelProfile[];
  defaultModelProfileId?: string;
  agentModelAssignments?: Record<string, string>;
}

const SETTINGS_PATH =
  process.env.DEV_AGENT_MODEL_SETTINGS_FILE ||
  join(process.env.DEV_AGENT_DATA_DIR || join(homedir(), '.dev-agent/data'), 'model-settings.json');

export function loadRuntimeModelSettings(): RuntimeModelSettings | null {
  try {
    if (!existsSync(SETTINGS_PATH)) return null;
    const parsed = JSON.parse(readFileSync(SETTINGS_PATH, 'utf8')) as Partial<RuntimeModelSettings>;
    const modelProfiles = Array.isArray(parsed.modelProfiles)
      ? parsed.modelProfiles.filter((profile) => profile?.id && profile.modelName && profile.apiEndpoint)
      : [];
    if (modelProfiles.length === 0) return null;
    return {
      modelProfiles,
      defaultModelProfileId: parsed.defaultModelProfileId,
      agentModelAssignments: parsed.agentModelAssignments || {},
    };
  } catch {
    return null;
  }
}

export function applyRuntimeModelSettings(agent: TeamAgentConfig): TeamAgentConfig {
  const settings = loadRuntimeModelSettings();
  if (!settings) return agent;
  const assignedModelId = settings.agentModelAssignments?.[agent.id] || settings.defaultModelProfileId;
  const profile =
    settings.modelProfiles.find((item) => item.id === assignedModelId) ||
    settings.modelProfiles.find((item) => item.id === settings.defaultModelProfileId) ||
    settings.modelProfiles[0];
  if (!profile) return agent;

  return {
    ...agent,
    model: profile.modelName || agent.model,
    baseUrl: profile.apiEndpoint || agent.baseUrl,
    apiKey: profile.apiKey || agent.apiKey,
  };
}
