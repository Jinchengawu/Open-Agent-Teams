'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SkeletonCard } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import { useAgentHealth } from '@/hooks/useAgentHealth'

interface TeamLoopStatusResponse {
  ok: boolean
  checkedAt?: number
  checkSummary?: string
  missing?: string[]
  deliveryGate?: {
    ok: boolean
    report: string
    summary: string
    href: string
  } | null
  latestWorkflow?: {
    id: string
    status?: string
    pipelineId?: string | null
    projectId?: string | null
    taskCount?: number
    href?: string | null
  } | null
  agents?: {
    onlineCount: number
    totalAgents: number
  }
}

const jsonFetcher = <T,>(url: string): Promise<T> =>
  fetch(url, { cache: 'no-store' }).then(async (response) => {
    const data = await response.json()
    if (!response.ok) return { ok: false, ...data }
    return data
  })

export default function Dashboard() {
  const router = useRouter()
  const { agents, stats, error, isLoading, mutate } = useAgentHealth()
  const {
    data: teamLoop,
    mutate: refreshTeamLoop,
  } = useSWR<TeamLoopStatusResponse>('/api/team-loop/status', jsonFetcher, {
    refreshInterval: 30000,
    revalidateOnFocus: false,
  })

  const statCards = [
    {
      title: 'Active Agents',
      value: `${stats.onlineCount}/${stats.totalAgents}`,
      icon: '🤖',
      color: 'from-blue-500 to-blue-600',
      detail: stats.onlineCount > 0 ? `${stats.onlineCount} online` : 'All offline',
    },
    {
      title: 'Total Skills',
      value: String(stats.totalSkills),
      icon: '📚',
      color: 'from-green-500 to-green-600',
      detail: 'Across all agents',
    },
    {
      title: 'Success Rate',
      value: stats.onlineCount > 0 ? `${stats.successRate}%` : '--',
      icon: '✅',
      color: 'from-yellow-500 to-orange-500',
      detail: stats.onlineCount > 0 ? 'Agents reachable' : 'No agents',
    },
    {
      title: 'System',
      value: stats.onlineCount > 0 ? 'Online' : 'Offline',
      icon: '⚡',
      color: stats.onlineCount > 0 ? 'from-green-500 to-green-600' : 'from-red-500 to-red-600',
      detail: 'Via Hermes runtime',
    },
  ]

  const quickActions = [
    { icon: '🆕', title: 'New Project', desc: 'Start a new project', path: '/chat' },
    { icon: '📋', title: 'Templates', desc: 'Browse templates', path: '/chat' },
    { icon: '📚', title: 'Skills', desc: 'View all skills', path: '/skills' },
    { icon: '⚙️', title: 'Settings', desc: 'Configure system', path: '/settings' },
  ]

  if (error) {
    return (
      <ErrorState
        title="Failed to load agents"
        message="Cannot connect to agent services. Make sure the agents are running (./scripts/start-all.sh)."
        onRetry={() => mutate()}
      />
    )
  }

  return (
    <div className="space-y-6">
      {/* Team Coordination Loop */}
      <Card
        className={teamLoop?.ok ? 'border-green-200 bg-green-50' : 'border-amber-200 bg-amber-50'}
        data-testid="dashboard-team-loop-card"
      >
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <Badge className={teamLoop?.ok ? 'bg-green-600' : 'bg-amber-600'} data-testid="dashboard-team-loop-badge">
                {teamLoop?.ok ? 'Framework Ready' : 'Needs Evidence'}
              </Badge>
              <div>
                <p className="text-sm font-semibold text-gray-900">Team Coordination Loop</p>
                <p className="text-xs text-gray-600" data-testid="dashboard-team-loop-diagnostics">
                  {teamLoop?.checkSummary
                    ? teamLoop.ok
                      ? `Checks ${teamLoop.checkSummary}`
                      : `Missing ${teamLoop.missing?.[0] || 'coordination evidence'}`
                    : 'Checking framework loop evidence'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
              <div className="rounded-md bg-white/80 px-3 py-2" data-testid="dashboard-team-loop-agents">
                <p className="text-gray-500">Agents</p>
                <p className="font-semibold text-gray-900">
                  {teamLoop?.agents ? `${teamLoop.agents.onlineCount}/${teamLoop.agents.totalAgents}` : '--'}
                </p>
              </div>
              <div className="rounded-md bg-white/80 px-3 py-2" data-testid="dashboard-team-loop-workflow">
                <p className="text-gray-500">Workflow</p>
                <p className="font-semibold text-gray-900">
                  {teamLoop?.latestWorkflow?.status || '--'}
                </p>
                {teamLoop?.latestWorkflow?.href && (
                  <Link href={teamLoop.latestWorkflow.href} className="mt-1 inline-block text-[11px] font-medium text-blue-700 hover:text-blue-900">
                    Open
                  </Link>
                )}
              </div>
              <div className="rounded-md bg-white/80 px-3 py-2" data-testid="dashboard-team-loop-gate">
                <p className="text-gray-500">E2E Gate</p>
                <p className="font-semibold text-gray-900">
                  {teamLoop?.deliveryGate?.summary || '--'}
                </p>
                {teamLoop?.deliveryGate?.href && (
                  <Link href={teamLoop.deliveryGate.href} target="_blank" className="mt-1 inline-block text-[11px] font-medium text-blue-700 hover:text-blue-900">
                    Report
                  </Link>
                )}
              </div>
              <div className="rounded-md bg-white/80 px-3 py-2">
                <p className="text-gray-500">Checked</p>
                <p className="font-semibold text-gray-900">
                  {teamLoop?.checkedAt ? new Date(teamLoop.checkedAt).toLocaleTimeString() : '--'}
                </p>
              </div>
            </div>

            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                mutate()
                refreshTeamLoop()
              }}
              data-testid="dashboard-team-loop-refresh"
            >
              Refresh
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          : statCards.map((stat, i) => (
              <Card
                key={i}
                className="overflow-hidden hover:shadow-lg transition-shadow"
              >
                <CardContent className="p-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-500">
                        {stat.title}
                      </p>
                      <p className="text-3xl font-bold text-gray-900 mt-1">
                        {stat.value}
                      </p>
                      <p className="text-sm text-gray-500 mt-1">{stat.detail}</p>
                    </div>
                    <div
                      className={`w-14 h-14 bg-gradient-to-br ${stat.color} rounded-2xl flex items-center justify-center shadow-lg`}
                    >
                      <span className="text-2xl">{stat.icon}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
      </div>

      {/* Agent Status */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Agent Status</CardTitle>
          <Button
            variant="outline"
            size="sm"
            onClick={() => router.push('/agents')}
          >
            View All
          </Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonCard key={i} />
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="p-4 border border-slate-200 rounded-xl hover:border-blue-300 hover:shadow-md transition-all cursor-pointer"
                  onClick={() => router.push(`/chat?agent=${agent.id}`)}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center space-x-3">
                      <div className="w-10 h-10 bg-gradient-to-br from-slate-100 to-slate-200 rounded-xl flex items-center justify-center">
                        <span className="text-xl">{agent.icon}</span>
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">
                          {agent.name}
                        </h3>
                        <p className="text-xs text-gray-500">
                          Port {agent.port}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-1">
                      <div
                        className={`w-2 h-2 rounded-full ${
                          agent.online ? 'bg-green-500' : 'bg-red-500'
                        }`}
                      ></div>
                      <span
                        className={`text-xs ${
                          agent.online ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {agent.online ? 'Online' : 'Offline'}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="bg-slate-50 rounded-lg p-2">
                      <p className="text-gray-500 text-xs">Skills</p>
                      <p className="font-semibold">{agent.skillCount}</p>
                    </div>
                    <div className="bg-slate-50 rounded-lg p-2">
                      <p className="text-gray-500 text-xs">Port</p>
                      <p className="font-semibold">{agent.port}</p>
                    </div>
                  </div>

                  <Button className="w-full mt-3" size="sm">
                    Open Chat
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Quick Actions & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {quickActions.map((action, i) => (
                <Button
                  key={i}
                  variant="outline"
                  className="h-auto py-4 flex flex-col items-center justify-center space-y-2"
                  onClick={() => router.push(action.path)}
                >
                  <span className="text-2xl">{action.icon}</span>
                  <span className="font-medium">{action.title}</span>
                  <span className="text-xs text-gray-500">{action.desc}</span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System Info</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { label: 'Model Provider', value: 'DeepSeek' },
                { label: 'Model', value: 'deepseek-v4-pro[1m]' },
                {
                  label: 'Agents',
                  value: `${stats.onlineCount}/${agents.length} online`,
                },
                { label: 'Skills', value: String(stats.totalSkills) },
                { label: 'Updated', value: new Date().toLocaleTimeString() },
              ].map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between p-3 bg-slate-50 rounded-xl"
                >
                  <span className="text-sm text-gray-600">{item.label}</span>
                  <span className="text-sm font-medium text-gray-900">
                    {item.value}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
