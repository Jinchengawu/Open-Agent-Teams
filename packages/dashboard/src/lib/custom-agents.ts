import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { homedir } from 'node:os';

export interface CustomAgent {
  id: string;
  name: string;
  role: string;
  description: string;
  endpoint?: string;
  skills: string[];
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
}

interface CustomAgentStore {
  agents: CustomAgent[];
}

const STORE_PATH =
  process.env.OPEN_AGENT_CUSTOM_AGENTS_FILE ||
  process.env.DEV_AGENT_CUSTOM_AGENTS_FILE ||
  join(process.env.OPEN_AGENT_DATA_DIR || process.env.DEV_AGENT_DATA_DIR || join(homedir(), '.open-agent-teams/data'), 'custom-agents.json');
const RUNTIME_SCRIPT = resolve(process.cwd(), '../../scripts/custom-agent-runtime.mjs');

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

  const agent: CustomAgent = {
    id,
    name,
    role,
    description: description || role,
    endpoint: endpoint || undefined,
    skills,
    createdAt: now,
    updatedAt: now,
  };

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

  const port = await findFreePort(agent.runtime?.port || 8700);
  const endpoint = `http://127.0.0.1:${port}`;

  const child = spawn(process.execPath, [RUNTIME_SCRIPT], {
    detached: true,
    stdio: ['ignore', 'ignore', 'ignore'],
    env: {
      ...process.env,
      CUSTOM_AGENT_ID: agent.id,
      CUSTOM_AGENT_NAME: agent.name,
      CUSTOM_AGENT_ROLE: agent.role,
      CUSTOM_AGENT_DESCRIPTION: agent.description,
      CUSTOM_AGENT_SKILLS: agent.skills.join(','),
      CUSTOM_AGENT_PORT: String(port),
    },
  });
  child.unref();

  return updateCustomAgent(id, (current) => ({
    ...current,
    endpoint,
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
