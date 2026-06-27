'use client';
import useSWR from 'swr';
import { AGENT_LIST } from '@/lib/agents';
import type { AgentStatus } from '@/lib/types';
import { useI18n } from '@/lib/i18n';

interface HealthResponse {
  agents: {
    id: string;
    online: boolean;
    data?: { status: string; agent: string; label: string; hermesPort: number; skills: number };
    error?: string;
  }[];
  onlineCount: number;
  totalAgents: number;
  totalSkills: number;
  gatewayOnline?: boolean;
  livePipelineReady?: boolean;
  timestamp: number;
}

const fetcher = ([url, locale]: [string, string]): Promise<HealthResponse> =>
  fetch(`${url}?lang=${encodeURIComponent(locale)}`, {
    headers: {
      'Accept-Language': locale === 'zh' ? 'zh-CN,zh;q=0.9' : 'en-US,en;q=0.9',
    },
  }).then((r) => {
    if (!r.ok) throw new Error('Failed to fetch agent health');
    return r.json();
  });

export function useAgentHealth() {
  const { locale } = useI18n();
  const { data, error, isLoading, mutate } = useSWR<HealthResponse>(
    ['/api/health', locale],
    fetcher,
    { refreshInterval: 30000, revalidateOnFocus: false }
  );

  const agents: AgentStatus[] = AGENT_LIST.map((info) => {
    const result = data?.agents?.find((a) => a.id === info.id);
    return {
      ...info,
      name: result?.data?.agent || info.name,
      label: result?.data?.label || info.label,
      online: result?.online || false,
      skillCount: result?.data?.skills || 0,
      error: result?.error,
    };
  });
  const staticAgentIds = new Set(AGENT_LIST.map((agent) => agent.id));
  const dynamicAgents: AgentStatus[] = (data?.agents || [])
    .filter((agent) => agent.id && !staticAgentIds.has(agent.id))
    .map((agent) => ({
      id: agent.id,
      name: agent.data?.agent || agent.id,
      label: agent.data?.label || agent.data?.agent || agent.id,
      port: agent.data?.hermesPort,
      icon: '🤖',
      color: 'from-slate-500 to-cyan-500',
      tags: [],
      online: Boolean(agent.online),
      skillCount: agent.data?.skills || 0,
      error: agent.error,
    }));
  const availableAgents = [...agents, ...dynamicAgents];

  const stats = {
    totalAgents: data?.totalAgents || AGENT_LIST.length,
    onlineCount: data?.onlineCount || 0,
    successRate: data ? Math.round((data.onlineCount / data.totalAgents) * 100) : 0,
    totalSkills: data?.totalSkills || 0,
    gatewayOnline: data?.gatewayOnline || false,
    livePipelineReady: data?.livePipelineReady || false,
  };

  return { agents, availableAgents, stats, error, isLoading, mutate };
}
