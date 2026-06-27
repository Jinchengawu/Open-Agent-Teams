import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

export interface CustomAgent {
  id: string;
  name: string;
  role: string;
  description: string;
  endpoint?: string;
  skills: string[];
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

export async function listCustomAgents(): Promise<CustomAgent[]> {
  const store = await readStore();
  return store.agents.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
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
  const nextAgents = store.agents.filter((agent) => agent.id !== normalizedId);
  if (nextAgents.length === store.agents.length) return false;
  await writeStore({ agents: nextAgents });
  return true;
}
