import { NextResponse } from 'next/server';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8401';

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

function withSystemAgents(agents: HealthResult[]): HealthResult[] {
  if (agents.some((agent) => agent.id === 'system-team-architect')) return agents;
  return [
    {
      id: 'system-team-architect',
      online: true,
      data: {
        status: 'online',
        agent: 'Team Architect Agent',
        label: '团队架构师 Agent',
        hermesPort: 0,
        skills: 5,
      },
    },
    ...agents,
  ];
}

async function checkGateway(request: Request): Promise<{
  online: boolean;
  agents: HealthResult[];
  livePipelineReady: boolean;
  modelSpendGuard: boolean;
  codexBackfillReady: boolean;
  locale?: string;
}> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const requestUrl = new URL(request.url);
    const lang = requestUrl.searchParams.get('lang');
    const res = await fetch(`${GATEWAY_URL}/agent-health${lang ? `?lang=${encodeURIComponent(lang)}` : ''}`, {
      signal: controller.signal,
      cache: 'no-store',
      headers: {
        'Accept-Language': request.headers.get('accept-language') || 'zh-CN,zh;q=0.9',
      },
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const agents: HealthResult[] = (data.agents || []).map((a: {
      id: string;
      name?: string;
      label?: string;
      displayName?: string;
      displayLabel?: string;
      online: boolean;
      hermesPort?: number;
      skills?: number;
      error?: string;
    }) => ({
      id: a.id || a.name || '',
      online: Boolean(a.online),
      data: {
        status: a.online ? 'online' : 'offline',
        agent: a.displayName || a.id || a.name || '',
        label: a.displayLabel || a.label || a.id || a.name || '',
        hermesPort: a.hermesPort || 0,
        skills: a.skills || 0,
      },
      error: a.error,
    }));
    return {
      online: true,
      agents: withSystemAgents(agents),
      livePipelineReady: Boolean(data.livePipelineReady),
      modelSpendGuard: Boolean(data.modelSpendGuard),
      codexBackfillReady: Boolean(data.codexBackfillReady),
      locale: data.locale,
    };
  } catch (e) {
    return {
      online: false,
      livePipelineReady: false,
      modelSpendGuard: false,
      codexBackfillReady: false,
      agents: withSystemAgents(['intent-router', 'team-orchestrator', 'workflow-conductor', 'knowledge-steward', 'recovery-agent', 'integration-agent'].map(id => ({
        id,
        online: false,
        error: e instanceof Error ? e.message : 'Gateway offline',
      }))),
    };
  }
}

export async function GET(request: Request) {
  const { online, agents, livePipelineReady, modelSpendGuard, codexBackfillReady, locale } = await checkGateway(request);
  const onlineCount = agents.filter((agent) => agent.online).length;

  return NextResponse.json({
    timestamp: Date.now(),
    locale: locale || 'zh',
    gatewayOnline: online,
    livePipelineReady,
    modelSpendGuard,
    codexBackfillReady,
    onlineCount,
    totalAgents: agents.length,
    totalSkills: agents.reduce((sum, agent) => sum + (agent.data?.skills || 0), 0),
    agents,
  });
}
