'use client';
import { useEffect, useMemo, useState } from 'react';
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

type AgentHealthStatus = 'checking' | 'online' | 'degraded' | 'offline' | 'stale';

const HEALTH_CACHE_KEY = 'open-agent-health-last-good';

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
  const [cachedHealth, setCachedHealth] = useState<HealthResponse | null>(null);
  const { data, error, isLoading, mutate } = useSWR<HealthResponse>(
    ['/api/health', locale],
    fetcher,
    { refreshInterval: 30000, revalidateOnFocus: false }
  );

  useEffect(() => {
    try {
      const stored = localStorage.getItem(HEALTH_CACHE_KEY);
      if (!stored) return;
      const parsed = JSON.parse(stored) as HealthResponse;
      if (parsed?.timestamp && Array.isArray(parsed.agents)) {
        setCachedHealth(parsed);
      }
    } catch {
      // Ignore corrupt browser cache and fall back to checking state.
    }
  }, []);

  useEffect(() => {
    if (!data?.timestamp || !Array.isArray(data.agents)) return;
    setCachedHealth(data);
    try {
      localStorage.setItem(HEALTH_CACHE_KEY, JSON.stringify(data));
    } catch {
      // Ignore storage quota or private mode failures.
    }
  }, [data]);

  const effectiveData = data || cachedHealth || undefined;
  const healthStatus = useMemo<AgentHealthStatus>(() => {
    if (data) {
      if (data.gatewayOnline === false) return 'offline';
      if (data.totalAgents > 0 && data.onlineCount === data.totalAgents) return 'online';
      if (data.onlineCount > 0) return 'degraded';
      return 'offline';
    }
    if (cachedHealth && error) return 'stale';
    if (isLoading) return 'checking';
    if (error) return 'offline';
    return 'checking';
  }, [cachedHealth, data, error, isLoading]);

  const statusReason = useMemo(() => {
    if (healthStatus === 'checking') return locale === 'zh' ? '正在检查 Agent 状态' : 'Checking agents';
    if (healthStatus === 'stale') return locale === 'zh' ? '使用最近可信状态，正在重试连接' : 'Using last trusted status while reconnecting';
    if (effectiveData?.gatewayOnline === false) return 'Gateway offline';
    if (healthStatus === 'degraded') return locale === 'zh' ? '部分 Agent 不可达' : 'Some agents are unreachable';
    if (healthStatus === 'online') return locale === 'zh' ? '团队在线' : 'Team online';
    return locale === 'zh' ? '未检测到在线 Agent' : 'No agents online';
  }, [effectiveData?.gatewayOnline, healthStatus, locale]);

  const agents: AgentStatus[] = AGENT_LIST.map((info) => {
    const result = effectiveData?.agents?.find((a) => a.id === info.id);
    return {
      ...info,
      name: result?.data?.agent || info.name,
      label: result?.data?.label || info.label,
      online: Boolean(result?.online),
      skillCount: result?.data?.skills || 0,
      error: result?.error,
    };
  });
  const staticAgentIds = new Set(AGENT_LIST.map((agent) => agent.id));
  const dynamicAgents: AgentStatus[] = (effectiveData?.agents || [])
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
    totalAgents: effectiveData?.totalAgents || AGENT_LIST.length,
    onlineCount: effectiveData?.onlineCount || 0,
    successRate: effectiveData?.totalAgents ? Math.round((effectiveData.onlineCount / effectiveData.totalAgents) * 100) : 0,
    totalSkills: effectiveData?.totalSkills || 0,
    gatewayOnline: Boolean(effectiveData?.gatewayOnline),
    livePipelineReady: Boolean(effectiveData?.livePipelineReady),
    status: healthStatus,
    statusReason,
    lastCheckedAt: effectiveData?.timestamp,
    isStale: healthStatus === 'stale',
    isChecking: healthStatus === 'checking',
  };

  return { agents, availableAgents, stats, error, isLoading: isLoading && !cachedHealth, mutate };
}
