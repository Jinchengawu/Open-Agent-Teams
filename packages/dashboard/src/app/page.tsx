'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import useSWR from 'swr'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { SkeletonCard } from '@/components/ui/skeleton'
import { useAgentHealth } from '@/hooks/useAgentHealth'
import { useI18n } from '@/lib/i18n'

interface ReadinessResponse {
  ok: boolean
  checkedAt: number
  source: string
  runtime?: {
    node?: { ok: boolean; version?: string; path?: string }
    pnpm?: { ok: boolean; version?: string; path?: string }
    hermes?: { ok: boolean; version?: string; path?: string }
  }
  gateway?: { ok: boolean; agents?: number }
  dashboard?: { ok: boolean; gatewayOnline?: boolean }
  agentHealth?: {
    ok: boolean
    onlineCount?: number
    totalAgents?: number
    livePipelineReady?: boolean
  }
  openFrameworkSync?: {
    ok: boolean
    head?: string
    remote?: string
    dirtyCount?: number
    path?: string
    error?: string
  }
}

interface DeliveryGateResponse {
  ok: boolean
  report?: string
  reportTime?: string | null
  pass?: number
  fail?: number
  warn?: number
  total?: number
  summary?: string
}

interface DeliveryGateHistoryResponse {
  ok: boolean
  count?: number
  latestOk?: boolean
}

interface TeamLoopStatusResponse {
  ok: boolean
  checkedAt?: number
  checkSummary?: string
  missing?: string[]
  latestInstance?: {
    id: string
    status: string
    pipelineId: string
    projectId?: string
    surfaceTaskCount: number
    surfaceDocumentCount: number
    href?: string
  } | null
  kanban?: {
    taskCount: number
    surfaceTaskCount: number
    href?: string | null
  }
  documents?: {
    projectDocumentCount: number
    boundProjectDocumentCount: number
    total: number
    href?: string | null
    latestDocument?: {
      id: string
      title: string
      type: string
      taskId?: string | null
      href: string
    } | null
  }
}

interface CurrentProjectSummaryResponse {
  ok: boolean
  checkedAt: number
  health: {
    status: 'Healthy' | 'Degraded' | 'Failed' | 'Checking'
    label: string
    reason: string
    tone: 'green' | 'amber' | 'red' | 'gray'
  }
  project: {
    id: string
    name: string
    goal: string
    updatedAt: number
  } | null
  currentPipeline: {
    id: string
    pipelineId: string
    status: string
    currentSurface?: string | null
    failedSurface?: { surfaceId: string; status: string; error?: string | null; agent?: string | null } | null
    error?: string | null
    href: string
  } | null
  deliveryGate?: {
    ok: boolean
    pass?: number
    fail?: number
    warn?: number
    total?: number
  } | null
  deliveryLoop: Array<{ key: string; label: string; status: string }>
  tasks: {
    total: number
    blocked: number
    blockerGroups: Record<string, number>
    href: string
  }
  documents: {
    total: number
    latest?: { id: string; title: string; type: string; href: string } | null
    href: string
  }
  nextActions: Array<{ label: string; href: string }>
}

const readinessFetcher = (url: string): Promise<ReadinessResponse> =>
  fetch(url, { cache: 'no-store' }).then(async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return { ok: false, ...data }
    }
    return data
  })

const jsonFetcher = <T,>(url: string): Promise<T> =>
  fetch(url, { cache: 'no-store' }).then(async (response) => {
    const data = await response.json()
    if (!response.ok) {
      return { ok: false, ...data }
    }
    return data
  })

export default function Dashboard() {
  const router = useRouter()
  const [clientTime, setClientTime] = useState('--')
  const { agents, stats, isLoading, mutate } = useAgentHealth()
  const { locale, t, apiHeaders } = useI18n()
  const {
    data: readiness,
    isLoading: readinessLoading,
    mutate: refreshReadiness,
  } = useSWR<ReadinessResponse>(['/api/readiness', locale], ([url]) =>
    fetch(String(url), { cache: 'no-store', headers: apiHeaders }).then(async (response) => {
      const data = await response.json()
      if (!response.ok) return { ok: false, ...data }
      return data
    }), {
    refreshInterval: 30000,
    revalidateOnFocus: false,
  })
  const {
    data: deliveryGate,
    mutate: refreshDeliveryGate,
  } = useSWR<DeliveryGateResponse>('/api/delivery-gate/latest', jsonFetcher, {
    refreshInterval: 30000,
    revalidateOnFocus: false,
  })
  const {
    data: deliveryGateHistory,
    mutate: refreshDeliveryGateHistory,
  } = useSWR<DeliveryGateHistoryResponse>('/api/delivery-gate/history?limit=5', jsonFetcher, {
    refreshInterval: 30000,
    revalidateOnFocus: false,
  })
  const {
    data: teamLoop,
    mutate: refreshTeamLoop,
  } = useSWR<TeamLoopStatusResponse>('/api/team-loop/status', jsonFetcher, {
    refreshInterval: 30000,
    revalidateOnFocus: false,
  })
  const {
    data: currentProject,
    mutate: refreshCurrentProject,
  } = useSWR<CurrentProjectSummaryResponse>('/api/projects/current/summary', jsonFetcher, {
    refreshInterval: 30000,
    revalidateOnFocus: false,
  })
  const deliveryGateLoaded = Boolean(deliveryGate?.total)
  const teamLoopLoaded = Boolean(teamLoop?.checkedAt)
  const globalStatus = currentProject?.health?.status || (readinessLoading || !deliveryGateLoaded || !teamLoopLoaded ? 'Checking' : 'Degraded')
  const globalStatusTone = currentProject?.health?.tone || 'gray'
  const globalStatusClass = {
    green: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50 text-amber-700',
    red: 'border-red-200 bg-red-50 text-red-700',
    gray: 'border-slate-200 bg-slate-50 text-slate-700',
  }[globalStatusTone]
  const globalCardClass = {
    green: 'border-emerald-200 bg-emerald-50/70',
    amber: 'border-amber-200 bg-amber-50/70',
    red: 'border-red-200 bg-red-50/70',
    gray: 'border-slate-200 bg-white/70',
  }[globalStatusTone]
  const agentsReachable = stats.status === 'online' || stats.status === 'degraded' || stats.status === 'stale'
  const healthCardColor = {
    checking: 'border-sky-200 bg-sky-50 text-sky-700',
    online: 'border-emerald-200 bg-emerald-50 text-emerald-700',
    degraded: 'border-amber-200 bg-amber-50 text-amber-700',
    stale: 'border-slate-200 bg-slate-50 text-slate-700',
    offline: 'border-red-200 bg-red-50 text-red-700',
  }[stats.status]

  useEffect(() => {
    const updateTime = () => setClientTime(new Date().toLocaleTimeString())
    updateTime()
    const timer = window.setInterval(updateTime, 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const statCards = [
    {
      title: t('dashboard.activeAgents'),
      value: `${stats.onlineCount}/${stats.totalAgents}`,
      icon: 'AG',
      color: healthCardColor,
      detail: stats.statusReason,
    },
    {
      title: t('dashboard.totalSkills'),
      value: String(stats.totalSkills),
      icon: 'SK',
      color: 'border-emerald-200 bg-emerald-50 text-emerald-700',
      detail: locale === 'zh' ? '覆盖全部 Agent' : 'Across all agents',
    },
    {
      title: t('dashboard.successRate'),
      value: agentsReachable ? `${stats.successRate}%` : '--',
      icon: '%',
      color: 'border-orange-200 bg-orange-50 text-orange-700',
      detail: agentsReachable ? (locale === 'zh' ? 'Agent 可触达' : 'Agents reachable') : stats.statusReason,
    },
    {
      title: t('dashboard.system'),
      value: stats.status === 'checking' ? t('dashboard.checking') : agentsReachable ? t('common.online') : t('common.offline'),
      icon: 'OS',
      color: healthCardColor,
      detail: stats.gatewayOnline ? (locale === 'zh' ? 'Gateway 已连接' : 'Gateway connected') : stats.statusReason,
    },
  ]

  const quickActions = [
    { icon: 'NEW', title: locale === 'zh' ? '新项目' : 'New Project', desc: locale === 'zh' ? '启动一个真实交付项目' : 'Start a new project', path: '/chat' },
    { icon: 'TPL', title: locale === 'zh' ? '模板' : 'Templates', desc: locale === 'zh' ? '浏览工作流模板' : 'Browse templates', path: '/chat' },
    { icon: 'SKL', title: t('nav.skills'), desc: locale === 'zh' ? '查看团队技能' : 'View all skills', path: '/skills' },
    { icon: 'CFG', title: t('nav.settings'), desc: locale === 'zh' ? '配置系统' : 'Configure system', path: '/settings' },
  ]

  return (
    <div className="space-y-8">
      <section className="border-b border-slate-300/70 pb-8 pt-6" data-testid="dashboard-delivery-cockpit">
        <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.28em] text-[#007f96]">
              Delivery Cockpit
            </p>
            <h1 className="mt-2 text-3xl font-black tracking-normal text-[#111820] md:text-5xl">
              {locale === 'zh' ? 'Agent Teams 交付驾驶舱' : 'Agent Teams Delivery Cockpit'}
            </h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 md:text-base">
              {locale === 'zh'
                ? '聚合当前项目、Agent 状态、交付循环、产物证据和下一步动作。'
                : 'Current project, agent health, delivery loop evidence, artifacts, and next actions in one place.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2" data-testid="dashboard-next-actions">
            {(currentProject?.nextActions?.length ? currentProject.nextActions.slice(0, 3) : [
              { label: locale === 'zh' ? '初始化我的 AI 团队' : 'Initialize my AI team', href: '/team-architect' },
              { label: locale === 'zh' ? '启动协作会议' : 'Start coordination meeting', href: '/chat?mode=meeting' },
              { label: locale === 'zh' ? '运行 Pipeline' : 'Run pipeline', href: '/pipeline' },
            ]).map((action, index) => (
              <Button
                key={`${action.label}-${index}`}
                variant={index === 0 ? 'default' : 'outline'}
                onClick={() => {
                  if (action.href.startsWith('/api/')) {
                    window.open(action.href, '_blank')
                  } else {
                    router.push(action.href)
                  }
                }}
              >
                {action.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-lg border border-slate-200 bg-white/72 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)]" data-testid="dashboard-current-project-summary">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                  {locale === 'zh' ? '当前交付项目' : 'Current Delivery Project'}
                </p>
                <h2 className="mt-2 text-2xl font-black text-[#111820]">
                  {currentProject?.project?.name || (locale === 'zh' ? '暂无当前交付项目' : 'No active project yet')}
                </h2>
                <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
                  {currentProject?.project?.goal || (locale === 'zh'
                    ? '启动一次团队协作后，这里会展示项目阶段、任务、文档、Pipeline 与验证报告。'
                    : 'Start a team collaboration run to surface project phase, tasks, documents, pipeline, and gate report.')}
                </p>
              </div>
              <Badge className={globalStatusClass}>{globalStatus}</Badge>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  label: 'Gateway',
                  value: readiness?.gateway?.ok ? 'Online' : stats.gatewayOnline ? 'Online' : '--',
                  tone: readiness?.gateway?.ok || stats.gatewayOnline ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600',
                },
                {
                  label: 'Agents',
                  value: `${stats.onlineCount}/${stats.totalAgents}`,
                  tone: healthCardColor,
                },
                {
                  label: 'Live Pipeline',
                  value: readiness?.agentHealth?.livePipelineReady || stats.livePipelineReady ? 'Ready' : '--',
                  tone: readiness?.agentHealth?.livePipelineReady || stats.livePipelineReady ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200 bg-slate-50 text-slate-600',
                },
                {
                  label: 'E2E Gate',
                  value: deliveryGate?.total ? `${deliveryGate.pass}/${deliveryGate.total}` : '--',
                  tone: deliveryGate?.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-amber-200 bg-amber-50 text-amber-700',
                },
              ].map((item) => (
                <div key={item.label} className={`rounded-md border px-3 py-2 ${item.tone}`}>
                  <p className="text-[11px] font-black uppercase tracking-[0.14em] opacity-75">{item.label}</p>
                  <p className="mt-1 text-lg font-black">{item.value}</p>
                </div>
              ))}
            </div>

            <div className="mt-5 grid gap-3 md:grid-cols-3">
              <div className="rounded-md border border-slate-200 bg-white/80 p-3">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Project Stage</p>
                <p className="mt-1 font-semibold text-[#111820]">
                  {currentProject?.currentPipeline?.currentSurface || currentProject?.currentPipeline?.status || (locale === 'zh' ? '待启动' : 'Not started')}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-white/80 p-3">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Blocked</p>
                <p className="mt-1 font-semibold text-[#111820]">
                  {currentProject ? `${currentProject.tasks.blocked} / ${currentProject.tasks.total}` : '--'}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-white/80 p-3">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Last Checked</p>
                <p className="mt-1 font-semibold text-[#111820]">
                  {readiness?.checkedAt ? new Date(readiness.checkedAt).toLocaleTimeString() : clientTime}
                </p>
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white/72 p-5 shadow-[0_24px_80px_rgba(15,23,42,0.08)]" data-testid="dashboard-recent-evidence">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">
                  {locale === 'zh' ? '最近交付证据' : 'Recent Delivery Evidence'}
                </p>
                <p className="mt-1 text-sm text-slate-500">
                  {locale === 'zh' ? '文档、任务、Pipeline、验证报告可回跳追踪。' : 'Documents, tasks, pipelines, and gate reports are traceable.'}
                </p>
              </div>
              <Link href="/knowledge" className="text-xs font-black uppercase tracking-[0.12em] text-[#007f96]">
                Knowledge
              </Link>
            </div>
            <div className="space-y-3">
              {[
                {
                  label: 'Latest Document',
                  value: currentProject?.documents.latest?.title || (locale === 'zh' ? '暂无项目文档' : 'No project document'),
                  href: currentProject?.documents.latest?.href || currentProject?.documents.href || '/knowledge',
                },
                {
                  label: 'Latest Pipeline',
                  value: currentProject?.currentPipeline ? `${currentProject.currentPipeline.pipelineId} · ${currentProject.currentPipeline.status}` : (locale === 'zh' ? '暂无 Pipeline 实例' : 'No pipeline instance'),
                  href: currentProject?.currentPipeline?.href || '/pipeline',
                },
                {
                  label: 'Kanban',
                  value: currentProject ? `${currentProject.tasks.total} tasks · ${currentProject.tasks.blocked} blocked` : (locale === 'zh' ? '暂无任务' : 'No tasks'),
                  href: currentProject?.tasks.href || '/kanban?source=coordination',
                },
                {
                  label: 'E2E Report',
                  value: deliveryGate?.summary || (deliveryGate?.total ? `${deliveryGate.pass}/${deliveryGate.total} PASS` : (locale === 'zh' ? '暂无报告' : 'No report')),
                  href: '/api/delivery-gate/latest?format=markdown',
                },
              ].map((item) => (
                <Link key={item.label} href={item.href} target={item.href.startsWith('/api/') ? '_blank' : undefined} className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-white/80 px-3 py-2 transition-colors hover:border-[#007f96]/30 hover:bg-white">
                  <div className="min-w-0">
                    <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
                    <p className="mt-1 truncate text-sm font-semibold text-[#111820]">{item.value}</p>
                  </div>
                  <span className="text-xs font-black text-[#007f96]">Open</span>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-slate-200 bg-white/72 p-4" data-testid="dashboard-loop-timeline">
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-slate-500">Team Coordination Loop</p>
            {currentProject?.project?.id && <span className="font-mono text-[11px] text-slate-400">{currentProject.project.id}</span>}
          </div>
          <div className="grid gap-2 md:grid-cols-6">
            {(currentProject?.deliveryLoop || ['Meeting', 'Document', 'Kanban', 'Workflow', 'Artifact', 'Experience'].map((label) => ({ key: label, label, status: 'pending' }))).map((step) => {
              const statusTone =
                step.status === 'completed' || step.status === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                  : step.status === 'failed' || step.status === 'cancelled' ? 'border-red-200 bg-red-50 text-red-700'
                    : step.status === 'running' ? 'border-cyan-200 bg-cyan-50 text-cyan-700'
                      : 'border-slate-200 bg-slate-50 text-slate-600'
              return (
                <div key={step.key} className={`rounded-md border px-3 py-2 text-center text-xs font-bold ${statusTone}`}>
                  <div>{step.label}</div>
                  <div className="mt-1 uppercase">{step.status}</div>
                </div>
              )
            })}
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-3" data-testid="dashboard-risk-queue">
            <div className="rounded-md border border-slate-200 bg-white/80 p-3">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{locale === 'zh' ? '阻塞任务' : 'Blocked Tasks'}</p>
              <p className="mt-1 text-lg font-black text-[#111820]">{currentProject?.tasks.blocked ?? 0}</p>
            </div>
            <div className="rounded-md border border-slate-200 bg-white/80 p-3">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">{locale === 'zh' ? '未绑定文档' : 'Unlinked Docs'}</p>
              <p className="mt-1 text-lg font-black text-[#111820]">
                {teamLoop?.documents ? Math.max(teamLoop.documents.projectDocumentCount - teamLoop.documents.boundProjectDocumentCount, 0) : 0}
              </p>
            </div>
            <div className="rounded-md border border-slate-200 bg-white/80 p-3">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">Gate Warnings</p>
              <p className="mt-1 text-lg font-black text-[#111820]">{deliveryGate?.warn ?? 0}</p>
            </div>
          </div>
        </div>
      </section>

      <Card
        className={globalCardClass}
        data-testid="dashboard-readiness-card"
      >
        <CardContent className="p-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <Badge className={globalStatusClass} data-testid="dashboard-readiness-badge">
                {globalStatus}
              </Badge>
              <div>
                <p className="text-sm font-black uppercase tracking-[0.16em] text-[#111820]">System Status</p>
                <p className="text-xs text-slate-500">
                  {currentProject?.health?.reason ||
                    (readiness?.agentHealth
                      ? `${readiness.agentHealth.onlineCount ?? 0}/${readiness.agentHealth.totalAgents ?? 0} ${locale === 'zh' ? '个 Agent 在线' : 'Agents online'}`
                      : locale === 'zh' ? '检查本地团队就绪状态' : 'Checking local team readiness')}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
              {[
                ['Gateway', readiness?.gateway?.ok ? 'Online' : '--'],
                ['Live Pipeline', readiness?.agentHealth?.livePipelineReady ? 'Ready' : '--'],
                ['Hermes', readiness?.runtime?.hermes?.ok ? 'OK' : '--'],
                ['Checked', readiness?.checkedAt ? new Date(readiness.checkedAt).toLocaleTimeString() : '--'],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md border border-slate-200 bg-white/70 px-3 py-2">
                  <p className="text-slate-500">{label}</p>
                  <p className="font-semibold text-[#111820]">{value}</p>
                </div>
              ))}
              <div className="rounded-md border border-slate-200 bg-white/70 px-3 py-2" data-testid="dashboard-delivery-gate-summary">
                <p className="text-slate-500">E2E Gate</p>
                <p className="font-semibold text-[#111820]">
                  {deliveryGate?.total
                    ? Number(deliveryGate.warn || 0) > 0
                      ? `${deliveryGate.pass}/${deliveryGate.total} PASS · ${deliveryGate.warn} WARN`
                      : deliveryGate.ok
                        ? `${deliveryGate.pass}/${deliveryGate.total} PASS`
                        : `${deliveryGate.fail ?? 0} FAIL`
                    : '--'}
                </p>
                {deliveryGate?.report && (
                  <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[11px] font-medium">
                    <Link href="/api/delivery-gate/latest?format=markdown" target="_blank" className="text-[#007f96]" data-testid="dashboard-delivery-gate-report-link">
                      Report
                    </Link>
                    <Link href="/api/delivery-gate/history?limit=5" target="_blank" className="text-[#007f96]" data-testid="dashboard-delivery-gate-history-link">
                      History
                    </Link>
                    {deliveryGateHistory?.count ? (
                      <span className="text-slate-500" data-testid="dashboard-delivery-gate-history-count">
                        Recent {deliveryGateHistory.count}
                      </span>
                    ) : null}
                  </div>
                )}
              </div>
              <div className="rounded-md border border-slate-200 bg-white/70 px-3 py-2" data-testid="dashboard-open-sync-summary">
                <p className="text-slate-500">Open Sync</p>
                <p className="font-semibold text-[#111820]">{readiness?.openFrameworkSync?.ok ? 'Synced' : '--'}</p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                mutate()
                refreshReadiness()
                refreshDeliveryGate()
                refreshDeliveryGateHistory()
                refreshTeamLoop()
                refreshCurrentProject()
              }}
              data-testid="dashboard-readiness-refresh"
            >
              {t('common.refresh')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="dashboard-current-project-cockpit">
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-[#007f96]">Current Project Cockpit</p>
            <CardTitle className="mt-2">
              {currentProject?.project?.name || '暂无当前交付项目'}
            </CardTitle>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              {currentProject?.project?.goal || '启动一个项目后，这里会聚合 Meeting、Document、Kanban、Workflow、Artifact、Experience 的交付状态。'}
            </p>
          </div>
          <Badge className={globalStatusClass}>{globalStatus}</Badge>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-white/70 p-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Pipeline</p>
              <p className="mt-1 font-semibold text-[#111820]">
                {currentProject?.currentPipeline
                  ? `${currentProject.currentPipeline.pipelineId} · ${currentProject.currentPipeline.status}`
                  : '--'}
              </p>
              {currentProject?.currentPipeline?.failedSurface && (
                <p className="mt-1 text-xs text-red-700">
                  失败阶段：{currentProject.currentPipeline.failedSurface.surfaceId}
                </p>
              )}
              {currentProject?.currentPipeline?.href && (
                <Link href={currentProject.currentPipeline.href} className="mt-2 inline-block text-xs font-bold text-[#007f96]">
                  查看 Pipeline
                </Link>
              )}
            </div>
            <div className="rounded-lg border border-slate-200 bg-white/70 p-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Kanban</p>
              <p className="mt-1 font-semibold text-[#111820]">
                {currentProject ? `${currentProject.tasks.total} tasks · ${currentProject.tasks.blocked} blocked` : '--'}
              </p>
              {Object.entries(currentProject?.tasks.blockerGroups || {}).slice(0, 2).map(([reason, count]) => (
                <span key={reason} className="mr-1 mt-2 inline-block rounded border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-800">
                  {reason}: {count}
                </span>
              ))}
              {currentProject?.tasks.href && (
                <Link href={currentProject.tasks.href} className="block mt-2 text-xs font-bold text-[#007f96]">
                  查看交付看板
                </Link>
              )}
            </div>
            <div className="rounded-lg border border-slate-200 bg-white/70 p-3">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Knowledge</p>
              <p className="mt-1 font-semibold text-[#111820]">
                {currentProject ? `${currentProject.documents.total} documents` : '--'}
              </p>
              <p className="mt-1 truncate text-xs text-slate-500">
                {currentProject?.documents.latest?.title || '暂无关键产物'}
              </p>
              <Link href={currentProject?.documents.latest?.href || currentProject?.documents.href || '/knowledge'} className="mt-2 inline-block text-xs font-bold text-[#007f96]">
                查看项目文档
              </Link>
            </div>
          </div>

          <div className="rounded-lg border border-slate-200 bg-white/70 p-3">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">Delivery Loop</p>
              {currentProject?.project?.id && (
                <span className="font-mono text-[11px] text-slate-400">{currentProject.project.id}</span>
              )}
            </div>
            <div className="grid gap-2 md:grid-cols-6">
              {(currentProject?.deliveryLoop || ['Meeting', 'Document', 'Kanban', 'Workflow', 'Artifact', 'Experience'].map((label) => ({ key: label, label, status: 'pending' }))).map((step) => {
                const statusTone =
                  step.status === 'completed' || step.status === 'done' ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : step.status === 'failed' || step.status === 'cancelled' ? 'border-red-200 bg-red-50 text-red-700'
                      : step.status === 'running' ? 'border-cyan-200 bg-cyan-50 text-cyan-700'
                        : 'border-slate-200 bg-slate-50 text-slate-600'
                return (
                  <div key={step.key} className={`rounded-md border px-3 py-2 text-center text-xs font-bold ${statusTone}`}>
                    <div>{step.label}</div>
                    <div className="mt-1 uppercase">{step.status}</div>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {(currentProject?.nextActions?.length ? currentProject.nextActions : [{ label: locale === 'zh' ? '初始化我的 AI 团队' : 'Initialize my AI team', href: '/team-architect' }]).map((action) => (
              <Button key={action.label} variant={action.label.includes('失败') || action.label.includes('阻塞') ? 'default' : 'outline'} size="sm" onClick={() => router.push(action.href)}>
                {action.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card data-testid="dashboard-team-loop-card">
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>{t('dashboard.loop')}</CardTitle>
            <p className="mt-1 text-xs text-slate-500" data-testid="dashboard-team-loop-diagnostics">
              {teamLoop?.checkSummary
                ? teamLoop.ok
                  ? `Checks ${teamLoop.checkSummary}`
                  : `Missing ${teamLoop.missing?.[0] || 'coordination evidence'}`
                : 'Checking loop evidence'}
            </p>
          </div>
          <Badge className={teamLoop?.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-orange-200 bg-orange-50 text-orange-700'} data-testid="dashboard-team-loop-badge">
            {teamLoop?.ok ? 'Linked' : 'Incomplete'}
          </Badge>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
            {[
              { testId: 'dashboard-team-loop-workflow', label: 'Workflow', value: teamLoop?.latestInstance?.status || '--', href: teamLoop?.latestInstance?.href },
              { testId: 'dashboard-team-loop-kanban', label: 'Kanban Tasks', value: teamLoop?.kanban ? `${teamLoop.kanban.taskCount}/${teamLoop.kanban.surfaceTaskCount}` : '--', href: teamLoop?.kanban?.href },
              { testId: 'dashboard-team-loop-documents', label: 'Documents', value: teamLoop?.documents ? `${teamLoop.documents.boundProjectDocumentCount}/${teamLoop.documents.projectDocumentCount}` : '--', href: teamLoop?.documents?.href },
              { testId: 'dashboard-team-loop-gate', label: 'Gate Binding', value: teamLoop?.latestInstance ? `${teamLoop.latestInstance.surfaceDocumentCount} docs` : '--' },
            ].map(item => (
              <div key={item.testId} className="rounded-md border border-slate-200 bg-white/64 px-3 py-2" data-testid={item.testId}>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{item.label}</p>
                <p className="mt-1 font-semibold text-[#111820]">{item.value}</p>
                {item.href && (
                  <Link href={item.href} className="mt-1 inline-block text-xs font-bold text-[#007f96]">
                    Open
                  </Link>
                )}
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)
          : statCards.map((stat) => (
              <Card key={stat.title} className="overflow-hidden transition-all hover:-translate-y-0.5 hover:border-slate-300">
                <CardContent className="p-6">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-500">{stat.title}</p>
                      <p className="mt-2 text-3xl font-black text-[#111820]">{stat.value}</p>
                      <p className="mt-1 text-sm text-slate-500">{stat.detail}</p>
                    </div>
                    <div className={`flex h-14 w-14 items-center justify-center rounded-md border text-sm font-black tracking-[0.18em] ${stat.color}`}>
                      <span>{stat.icon}</span>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>{t('dashboard.agentStatus')}</CardTitle>
          <Button variant="outline" size="sm" onClick={() => router.push('/agents')}>{t('dashboard.viewAll')}</Button>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {Array.from({ length: 4 }).map((_, i) => <SkeletonCard key={i} />)}
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
              {agents.map((agent) => (
                <div
                  key={agent.id}
                  className="cursor-pointer rounded-lg border border-slate-200 bg-white/64 p-4 transition-all hover:-translate-y-0.5 hover:border-[#007f96]/30 hover:bg-white"
                  onClick={() => router.push(`/chat?agent=${agent.id}`)}
                >
                  <div className="mb-3 flex items-center justify-between">
                    <div className="flex items-center space-x-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-md border border-slate-200 bg-white">
                        <span className="text-xl">{agent.icon}</span>
                      </div>
                      <div>
                        <h3 className="font-semibold text-[#111820]">{agent.name}</h3>
                        <p className="text-xs text-slate-500">Port {agent.port}</p>
                      </div>
                    </div>
                    <span className={`rounded border px-2 py-0.5 text-[11px] font-black uppercase ${agent.online ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-red-200 bg-red-50 text-red-700'}`}>
                      {agent.online ? t('common.online') : t('common.offline')}
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="rounded-md border border-slate-200 bg-white/70 p-2">
                      <p className="text-xs text-slate-500">Skills</p>
                      <p className="font-semibold">{agent.skillCount}</p>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-white/70 p-2">
                      <p className="text-xs text-slate-500">Port</p>
                      <p className="font-semibold">{agent.port}</p>
                    </div>
                  </div>
                  <Button className="mt-3 w-full" size="sm">{t('dashboard.openChat')}</Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.quickActions')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3">
              {quickActions.map((action) => (
                <Button key={action.title} variant="outline" className="h-auto flex-col items-start justify-center space-y-2 py-4 text-left" onClick={() => router.push(action.path)}>
                  <span className="font-mono text-xs font-black tracking-[0.18em] text-[#c2410c]">{action.icon}</span>
                  <span className="font-medium">{action.title}</span>
                  <span className="text-xs text-slate-500">{action.desc}</span>
                </Button>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('dashboard.systemInfo')}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {[
                { label: 'Model Provider', value: 'DeepSeek' },
                { label: 'Model', value: 'deepseek-v4-pro[1m]' },
                { label: locale === 'zh' ? 'Agents' : 'Agents', value: `${stats.onlineCount}/${stats.totalAgents} ${t('common.online').toLowerCase()}` },
                { label: t('nav.skills'), value: String(stats.totalSkills) },
                { label: locale === 'zh' ? '更新时间' : 'Updated', value: clientTime },
              ].map((item) => (
                <div key={item.label} className="flex items-center justify-between rounded-md border border-slate-200 bg-white/64 p-3">
                  <span className="text-sm text-slate-600">{item.label}</span>
                  <span className="text-sm font-medium text-[#111820]">{item.value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
