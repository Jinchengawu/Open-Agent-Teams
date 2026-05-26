import { NextResponse } from 'next/server';

const AGENT_PORTS = [8201, 8202, 8203, 8204, 8205];
const AGENT_IDS = ['frontend', 'backend', 'testing', 'devops', 'pm'];

interface HealthResult {
  id: string;
  online: boolean;
  data?: {
    status: string;
    agent: string;
    label: string;
    hermesPort: number;
    skills: number;
  };
  error?: string;
}

async function checkAgent(port: number, id: string): Promise<HealthResult> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(`http://localhost:${port}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { id, online: true, data };
  } catch (e) {
    return {
      id,
      online: false,
      error: e instanceof Error ? e.message : 'Unknown error',
    };
  }
}

export async function GET() {
  const results = await Promise.all(
    AGENT_PORTS.map((port, i) => checkAgent(port, AGENT_IDS[i]))
  );

  const onlineCount = results.filter((r) => r.online).length;
  const totalSkills = results.reduce(
    (sum, r) => sum + (r.data?.skills || 0),
    0
  );

  return NextResponse.json({
    timestamp: Date.now(),
    onlineCount,
    totalAgents: results.length,
    totalSkills,
    agents: results,
  });
}
