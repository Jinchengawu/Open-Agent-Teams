import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { openSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface CustomAgent {
  id: string;
  name: string;
  role: string;
  description: string;
  endpoint?: string;
  skills: string[];
  tags: string[];
  systemPrompt?: string;
  hermes: {
    homeDir: string;
    port?: number;
    timeoutMs: number;
    configPath: string;
    source: 'dashboard';
  };
  runtime?: {
    status: 'stopped' | 'starting' | 'running' | 'error';
    pid?: number;
    port?: number;
    endpoint?: string;
    startedAt?: string;
    stoppedAt?: string;
    error?: string;
  };
  createdAt: string;
  updatedAt: string;
}

export interface CustomAgentInput {
  name?: string;
  role?: string;
  description?: string;
  endpoint?: string;
  skills?: string[] | string;
  tags?: string[] | string;
  systemPrompt?: string;
}

interface CustomAgentStore {
  agents: CustomAgent[];
}

const STORE_PATH =
  process.env.OPEN_AGENT_CUSTOM_AGENTS_FILE ||
  process.env.DEV_AGENT_CUSTOM_AGENTS_FILE ||
  join(process.env.OPEN_AGENT_DATA_DIR || process.env.DEV_AGENT_DATA_DIR || join(homedir(), '.open-agent-teams/data'), 'custom-agents.json');
const LOG_DIR = join(dirname(STORE_PATH), 'logs');
const HERMES_CUSTOM_HOME_ROOT =
  process.env.OPEN_AGENT_CUSTOM_HERMES_HOME_ROOT ||
  process.env.DEV_AGENT_CUSTOM_HERMES_HOME_ROOT ||
  join(homedir(), '.hermes-open-agent-custom');

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function parseSkills(value: CustomAgentInput['skills']): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeText(item)).filter(Boolean);
  }
  return normalizeText(value)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseList(value: CustomAgentInput['skills']): string[] {
  return parseSkills(value);
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
  return slug || 'custom-agent';
}

async function readStore(): Promise<CustomAgentStore> {
  try {
    const raw = await readFile(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<CustomAgentStore>;
    return { agents: Array.isArray(parsed.agents) ? parsed.agents : [] };
  } catch {
    return { agents: [] };
  }
}

async function writeStore(store: CustomAgentStore): Promise<void> {
  await mkdir(dirname(STORE_PATH), { recursive: true });
  await writeFile(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

function escapeYamlString(value: string): string {
  return JSON.stringify(value);
}

function resolveModelConfig() {
  return {
    provider: process.env.MODEL_PROVIDER || 'deepseek',
    model: process.env.MODEL_NAME || 'deepseek-v4-pro',
    baseUrl: process.env.MODEL_BASE_URL || 'https://api.deepseek.com/v1',
    apiKey: process.env.API_KEY || '',
  };
}

function defaultSystemPrompt(agent: Pick<CustomAgent, 'name' | 'role' | 'description' | 'skills'>): string {
  const skills = agent.skills.length > 0 ? `\nCapability tags: ${agent.skills.join(', ')}` : '';
  return `You are ${agent.name}.\nResponsibility: ${agent.role}\nContext and boundaries: ${agent.description || agent.role}${skills}\nProduce structured, executable, deliverable-oriented outputs.`;
}

async function writeHermesProfile(agent: CustomAgent, port: number): Promise<void> {
  const model = resolveModelConfig();
  await mkdir(agent.hermes.homeDir, { recursive: true });
  const config = `model:
  default: ${escapeYamlString(model.model)}
  provider: ${escapeYamlString(model.provider)}
  base_url: ${escapeYamlString(model.baseUrl)}

platforms:
  api_server:
    enabled: true
    extra:
      host: "127.0.0.1"
      port: ${port}
      model_name: "hermes-agent"

agent:
  name: ${escapeYamlString(agent.name)}
  role: ${escapeYamlString(agent.role)}
  description: ${escapeYamlString(agent.description)}
  system_prompt: ${escapeYamlString(agent.systemPrompt || defaultSystemPrompt(agent))}
  max_turns: 3
  gateway_timeout: 1800

toolsets: []

delegation:
  model: ${escapeYamlString(model.model)}
  provider: ${escapeYamlString(model.provider)}
  base_url: ${escapeYamlString(model.baseUrl)}
  api_key: ${escapeYamlString(model.apiKey)}
  orchestrator_enabled: true
  max_concurrent_children: 3
  max_spawn_depth: 1
  child_timeout_seconds: 600
  max_iterations: 50
`;
  await writeFile(agent.hermes.configPath, config, 'utf8');
}

function isPidRunning(pid?: number): boolean {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function findFreePort(start = 8700, end = 8799): Promise<number> {
  for (let port = start; port <= end; port += 1) {
    const available = await new Promise<boolean>((resolvePort) => {
      const server = createServer();
      server.once('error', () => resolvePort(false));
      server.once('listening', () => server.close(() => resolvePort(true)));
      server.listen(port, '127.0.0.1');
    });
    if (available) return port;
  }
  throw new Error(`No free custom agent port in range ${start}-${end}`);
}

async function waitForHermesHealth(port: number, timeoutMs = 25000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        signal: AbortSignal.timeout(1500),
      });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : 'health check failed';
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1000));
  }
  throw new Error(`Hermes health check timed out on port ${port}: ${lastError}`);
}

async function updateCustomAgent(id: string, updater: (agent: CustomAgent) => CustomAgent): Promise<CustomAgent> {
  const store = await readStore();
  const index = store.agents.findIndex((agent) => agent.id === id);
  if (index === -1) throw new Error('Custom agent not found');
  const updated = updater(store.agents[index]);
  store.agents[index] = { ...updated, updatedAt: new Date().toISOString() };
  await writeStore(store);
  return store.agents[index];
}

export async function listCustomAgents(): Promise<CustomAgent[]> {
  const store = await readStore();
  return store.agents
    .map((agent) => {
      if (agent.runtime?.status === 'running' && !isPidRunning(agent.runtime.pid)) {
        return {
          ...agent,
          runtime: {
            ...agent.runtime,
            status: 'stopped' as const,
            stoppedAt: new Date().toISOString(),
            error: 'Process is not running',
          },
        };
      }
      return agent;
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function createCustomAgent(input: CustomAgentInput): Promise<CustomAgent> {
  const name = normalizeText(input.name);
  const role = normalizeText(input.role);
  const description = normalizeText(input.description);
  const endpoint = normalizeText(input.endpoint);
  const skills = parseSkills(input.skills);
  const tags = parseList(input.tags).length > 0 ? parseList(input.tags) : skills;
  const systemPrompt = normalizeText(input.systemPrompt);

  if (!name) throw new Error('Agent name is required');
  if (!role) throw new Error('Agent role is required');

  const store = await readStore();
  const now = new Date().toISOString();
  const baseId = `custom-${slugify(name)}`;
  let id = baseId;
  let suffix = 2;
  while (store.agents.some((agent) => agent.id === id)) {
    id = `${baseId}-${suffix}`;
    suffix += 1;
  }

  const port = await findFreePort(8700);
  const agent: CustomAgent = {
    id,
    name,
    role,
    description: description || role,
    endpoint: endpoint || `http://127.0.0.1:${port}`,
    skills,
    tags,
    systemPrompt: systemPrompt || defaultSystemPrompt({ name, role, description: description || role, skills }),
    hermes: {
      homeDir: join(HERMES_CUSTOM_HOME_ROOT, id),
      port,
      timeoutMs: 120000,
      configPath: join(HERMES_CUSTOM_HOME_ROOT, id, 'config.yaml'),
      source: 'dashboard',
    },
    createdAt: now,
    updatedAt: now,
  };

  await writeHermesProfile(agent, port);
  store.agents.unshift(agent);
  await writeStore(store);
  return agent;
}

export async function deleteCustomAgent(id: string): Promise<boolean> {
  const normalizedId = normalizeText(id);
  const store = await readStore();
  const existing = store.agents.find((agent) => agent.id === normalizedId);
  if (existing?.runtime?.pid && isPidRunning(existing.runtime.pid)) {
    try {
      process.kill(existing.runtime.pid, 'SIGTERM');
    } catch {
      // process already gone
    }
  }
  const nextAgents = store.agents.filter((agent) => agent.id !== normalizedId);
  if (nextAgents.length === store.agents.length) return false;
  await writeStore({ agents: nextAgents });
  return true;
}

export async function startCustomAgent(id: string): Promise<CustomAgent> {
  const store = await readStore();
  const agent = store.agents.find((item) => item.id === id);
  if (!agent) throw new Error('Custom agent not found');

  if (agent.runtime?.status === 'running' && isPidRunning(agent.runtime.pid)) {
    return agent;
  }

  if (!agent.hermes) {
    agent.hermes = {
      homeDir: join(HERMES_CUSTOM_HOME_ROOT, agent.id),
      timeoutMs: 120000,
      configPath: join(HERMES_CUSTOM_HOME_ROOT, agent.id, 'config.yaml'),
      source: 'dashboard',
    };
  }

  const port = await findFreePort(agent.hermes.port || agent.runtime?.port || 8700);
  const endpoint = `http://127.0.0.1:${port}`;
  await mkdir(LOG_DIR, { recursive: true });
  await writeHermesProfile({ ...agent, hermes: { ...agent.hermes, port } }, port);

  const out = openSync(join(LOG_DIR, `${agent.id}.log`), 'a');
  const err = openSync(join(LOG_DIR, `${agent.id}.err.log`), 'a');
  const child = spawn('hermes', ['gateway', 'run'], {
    detached: true,
    stdio: ['ignore', out, err],
    env: {
      ...process.env,
      HERMES_HOME: agent.hermes.homeDir,
    },
  });
  let spawnError: Error | null = null;
  child.once('error', (error) => {
    spawnError = error;
  });
  child.unref();

  try {
    if (spawnError) throw spawnError;
    await waitForHermesHealth(port);
  } catch (error) {
    if (child.pid && isPidRunning(child.pid)) {
      try {
        process.kill(child.pid, 'SIGTERM');
      } catch {
        // process already gone
      }
    }
    const message = error instanceof Error ? error.message : 'Hermes start failed';
    await updateCustomAgent(id, (current) => ({
      ...current,
      hermes: { ...current.hermes, port },
      runtime: {
        status: 'error',
        pid: child.pid,
        port,
        endpoint,
        error: message,
        stoppedAt: new Date().toISOString(),
      },
    }));
    throw new Error(message);
  }

  return updateCustomAgent(id, (current) => ({
    ...current,
    endpoint,
    hermes: {
      ...current.hermes,
      port,
    },
    runtime: {
      status: 'running',
      pid: child.pid,
      port,
      endpoint,
      startedAt: new Date().toISOString(),
    },
  }));
}

export async function stopCustomAgent(id: string): Promise<CustomAgent> {
  return updateCustomAgent(id, (agent) => {
    if (agent.runtime?.pid && isPidRunning(agent.runtime.pid)) {
      try {
        process.kill(agent.runtime.pid, 'SIGTERM');
      } catch {
        // process already gone
      }
    }

    return {
      ...agent,
      runtime: {
        ...agent.runtime,
        status: 'stopped',
        stoppedAt: new Date().toISOString(),
      },
    };
  });
}
