'use client';
import useSWR from 'swr';
import { AGENT_LIST } from '@/lib/agents';
import type { AgentStatus } from '@/lib/types';

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
  timestamp: number;
}

const fetcher = (url: string): Promise<HealthResponse> =>
  fetch(url).then((r) => {
    if (!r.ok) throw new Error('Failed to fetch agent health');
    return r.json();
  });

export function useAgentHealth() {
  const { data, error, isLoading, mutate } = useSWR<HealthResponse>(
    '/api/health',
    fetcher,
    { refreshInterval: 30000, revalidateOnFocus: false }
  );

  const agents: AgentStatus[] = AGENT_LIST.map((info) => {
    const result = data?.agents?.find((a) => a.id === info.id);
    return {
      ...info,
      online: result?.online || false,
      skillCount: result?.data?.skills || 0,
      error: result?.error,
    };
  });

  const stats = {
    totalAgents: data?.totalAgents || AGENT_LIST.length,
    onlineCount: data?.onlineCount || 0,
    successRate: data ? Math.round((data.onlineCount / data.totalAgents) * 100) : 0,
    totalSkills: data?.totalSkills || 0,
  };

  return { agents, stats, error, isLoading, mutate };
}
