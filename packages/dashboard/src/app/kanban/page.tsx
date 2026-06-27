'use client'

import { useState, useEffect, useCallback } from 'react'

interface Task {
  id: string
  title: string
  description: string
  status: 'todo' | 'in_progress' | 'review' | 'done' | 'blocked'
  assignee: string
  priority: 'low' | 'medium' | 'high' | 'critical'
  task_type: string
  progress: number
  due_at: string | null
  created_at: string
  updated_at: string
  source?: 'local' | 'coordination'
  project_id?: string
  document_count?: number
  pipeline_instance_id?: string
  pipeline_id?: string
  surface_id?: string
  knowledge_url?: string
  workflow_url?: string
}

interface Milestone {
  id: string
  title: string
  description: string
  status: string
  target_date: string
  progress: number
}

interface KanbanData {
  tasks: Task[]
  milestones: Milestone[]
  agent_stats: Record<string, { total: number; todo: number; in_progress: number; done: number; blocked: number }>
  summary: {
    total_tasks: number
    completed: number
    blocked: number
    overdue: number
    active_milestones: number
  }
}

const STATUS_COLUMNS = [
  { key: 'todo', label: '待办', color: 'border-slate-200 bg-white/58', badge: 'border-slate-200 bg-white text-slate-700' },
  { key: 'in_progress', label: '进行中', color: 'border-cyan-200 bg-cyan-50/60', badge: 'border-cyan-200 bg-cyan-50 text-cyan-700' },
  { key: 'review', label: '评审中', color: 'border-violet-200 bg-violet-50/55', badge: 'border-violet-200 bg-violet-50 text-violet-700' },
  { key: 'done', label: '已完成', color: 'border-emerald-200 bg-emerald-50/55', badge: 'border-emerald-200 bg-emerald-50 text-emerald-700' },
  { key: 'blocked', label: '阻塞', color: 'border-red-200 bg-red-50/55', badge: 'border-red-200 bg-red-50 text-red-700' },
] as const

const PRIORITY_COLORS = {
  low: 'border-slate-200 bg-white text-slate-600',
  medium: 'border-cyan-200 bg-cyan-50 text-cyan-700',
  high: 'border-orange-200 bg-orange-50 text-orange-700',
  critical: 'border-red-200 bg-red-50 text-red-700',
} as const

const AGENT_ICONS: Record<string, string> = {
  'intent-router': '🧭',
  'team-orchestrator': '🕸️',
  'workflow-conductor': '🔁',
  'knowledge-steward': '🧠',
  'recovery-agent': '🛠️',
  'integration-agent': '🔌',
}

const AGENT_FILTERS = [
  { value: 'all', label: '全部负责人' },
  { value: 'intent-router', label: 'Intent Router' },
  { value: 'team-orchestrator', label: 'Team Orchestrator' },
  { value: 'workflow-conductor', label: 'Workflow Conductor' },
  { value: 'knowledge-steward', label: 'Knowledge Steward' },
  { value: 'recovery-agent', label: 'Recovery Agent' },
  { value: 'integration-agent', label: 'Integration Agent' },
]

const SOURCE_FILTERS = [
  { value: 'all', label: '全部来源' },
  { value: 'coordination', label: 'Pipeline 协作' },
  { value: 'local', label: '本地任务' },
]

const COLUMN_TASK_LIMIT = 12

export default function KanbanPage() {
  const [data, setData] = useState<KanbanData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [newTask, setNewTask] = useState({ title: '', description: '', assignee: 'team-orchestrator', priority: 'medium' })
  const [sourceFilter, setSourceFilter] = useState('all')
  const [assigneeFilter, setAssigneeFilter] = useState('all')
  const [urlFiltersLoaded, setUrlFiltersLoaded] = useState(false)

  const fetchKanban = useCallback(() => {
    const params = new URLSearchParams()
    if (sourceFilter !== 'all') params.set('source', sourceFilter)
    if (assigneeFilter !== 'all') params.set('assignee', assigneeFilter)
    const query = params.toString()
    fetch(`/api/kanban${query ? `?${query}` : ''}`)
      .then(r => r.json())
      .then(setData)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [sourceFilter, assigneeFilter])

  const syncUrlFilters = useCallback(() => {
    const params = new URLSearchParams(window.location.search)
    if (sourceFilter !== 'all') params.set('source', sourceFilter)
    else params.delete('source')
    if (assigneeFilter !== 'all') params.set('assignee', assigneeFilter)
    else params.delete('assignee')

    const query = params.toString()
    const nextUrl = query ? `${window.location.pathname}?${query}` : window.location.pathname
    window.history.replaceState(null, '', nextUrl)
  }, [sourceFilter, assigneeFilter])

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const source = params.get('source')
    const assignee = params.get('assignee')
    if (source && SOURCE_FILTERS.some(option => option.value === source)) setSourceFilter(source)
    if (assignee && AGENT_FILTERS.some(option => option.value === assignee)) setAssigneeFilter(assignee)
    setUrlFiltersLoaded(true)
  }, [])

  useEffect(() => {
    if (!urlFiltersLoaded) return
    syncUrlFilters()
    fetchKanban()
  }, [urlFiltersLoaded, syncUrlFilters, fetchKanban])

  const handleCreateTask = async () => {
    if (!newTask.title.trim()) return
    await fetch('/api/kanban/tasks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newTask),
    })
    setNewTask({ title: '', description: '', assignee: 'team-orchestrator', priority: 'medium' })
    setShowCreate(false)
    fetchKanban()
  }

  const handleStatusChange = async (taskId: string, newStatus: string) => {
    await fetch(`/api/kanban/tasks/${taskId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    })
    fetchKanban()
  }

  const handleDeleteTask = async (taskId: string) => {
    await fetch(`/api/kanban/tasks/${taskId}`, { method: 'DELETE' })
    fetchKanban()
  }

  if (loading) {
    return (
      <div className="mx-auto max-w-[1540px] py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-1/4 rounded bg-slate-200"></div>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-5">
            {[1,2,3,4,5].map(i => <div key={i} className="h-64 rounded-lg border border-slate-200 bg-white/70"></div>)}
          </div>
        </div>
      </div>
    )
  }

  const summary = data?.summary

  return (
    <div className="mx-auto max-w-[1540px] space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-3 border-b border-slate-300/70 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.26em] text-[#007f96]">Task Command Board</p>
          <h1 className="mt-2 text-3xl font-black uppercase tracking-[0.12em] text-[#111820]">项目看板</h1>
          <p className="mt-1 text-sm text-slate-600">串联任务、文档、工作流与角色 Agent 的执行状态</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="rounded-md border border-[#111820] bg-[#111820] px-4 py-2 text-sm font-bold text-white shadow-[7px_7px_0_rgba(255,92,31,0.14)] transition-colors hover:bg-black"
        >
          新建任务
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-5">
        {[
          { label: '总任务', value: summary?.total_tasks ?? 0, tone: 'text-[#111820]' },
          { label: '已完成', value: summary?.completed ?? 0, tone: 'text-emerald-700' },
          { label: '进行中', value: (summary?.total_tasks ?? 0) - (summary?.completed ?? 0) - (summary?.blocked ?? 0), tone: 'text-cyan-700' },
          { label: '阻塞', value: summary?.blocked ?? 0, tone: 'text-red-700' },
          { label: '逾期', value: summary?.overdue ?? 0, tone: 'text-orange-700' },
        ].map(item => (
          <div key={item.label} className="rounded-lg border border-slate-200 bg-white/76 p-4 shadow-[0_18px_60px_rgba(15,23,42,0.06)]">
            <div className={`text-2xl font-black ${item.tone}`}>{item.value}</div>
            <div className="mt-1 text-xs font-bold uppercase tracking-[0.14em] text-slate-500">{item.label}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-white/76 p-4 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value)}
            className="h-9 rounded-md border border-slate-200 bg-white/80 px-3 text-sm text-[#111820] focus:border-[#007f96]/45 focus:outline-none focus:ring-2 focus:ring-[#007f96]/15"
            aria-label="Kanban source filter"
            data-testid="kanban-source-filter"
          >
            {SOURCE_FILTERS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            value={assigneeFilter}
            onChange={e => setAssigneeFilter(e.target.value)}
            className="h-9 rounded-md border border-slate-200 bg-white/80 px-3 text-sm text-[#111820] focus:border-[#007f96]/45 focus:outline-none focus:ring-2 focus:ring-[#007f96]/15"
            aria-label="Kanban assignee filter"
            data-testid="kanban-assignee-filter"
          >
            {AGENT_FILTERS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </div>
        <button
          onClick={fetchKanban}
          className="h-9 rounded-md border border-slate-300 bg-white/80 px-3 text-sm font-bold text-[#111820] transition hover:border-[#007f96]/35 hover:bg-white"
        >
          刷新
        </button>
      </div>

      {/* Create Task Form */}
      {showCreate && (
        <div className="rounded-lg border border-[#ff5c1f]/25 bg-white/82 p-4">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
            <input
              placeholder="任务标题"
              value={newTask.title}
              onChange={e => setNewTask({...newTask, title: e.target.value})}
              className="rounded-md border border-slate-200 bg-white/80 px-3 py-2 text-sm"
            />
            <input
              placeholder="描述（可选）"
              value={newTask.description}
              onChange={e => setNewTask({...newTask, description: e.target.value})}
              className="rounded-md border border-slate-200 bg-white/80 px-3 py-2 text-sm"
            />
            <select
              value={newTask.assignee}
              onChange={e => setNewTask({...newTask, assignee: e.target.value})}
              className="rounded-md border border-slate-200 bg-white/80 px-3 py-2 text-sm"
            >
              <option value="intent-router">🧭 Intent Router</option>
              <option value="team-orchestrator">🕸️ Team Orchestrator</option>
              <option value="workflow-conductor">🔁 Workflow Conductor</option>
              <option value="knowledge-steward">🧠 Knowledge Steward</option>
              <option value="recovery-agent">🛠️ Recovery Agent</option>
              <option value="integration-agent">🔌 Integration Agent</option>
            </select>
            <div className="flex gap-2">
              <select
                value={newTask.priority}
                onChange={e => setNewTask({...newTask, priority: e.target.value})}
                className="flex-1 rounded-md border border-slate-200 bg-white/80 px-3 py-2 text-sm"
              >
                <option value="low">低</option>
                <option value="medium">中</option>
                <option value="high">高</option>
                <option value="critical">紧急</option>
              </select>
              <button onClick={handleCreateTask} className="rounded-md bg-[#111820] px-4 py-2 text-sm font-bold text-white">创建</button>
            </div>
          </div>
        </div>
      )}

      {/* Kanban Board */}
      <div className="overflow-x-auto pb-2">
        <div className="grid min-w-[1280px] grid-cols-5 gap-4">
          {STATUS_COLUMNS.map(col => {
            const tasks = (data?.tasks ?? []).filter(t => t.status === col.key)
            const visibleTasks = tasks.slice(0, COLUMN_TASK_LIMIT)
            const hiddenTaskCount = Math.max(0, tasks.length - visibleTasks.length)
            return (
              <div key={col.key} className={`${col.color} min-h-[320px] rounded-lg border p-3`}>
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold uppercase tracking-[0.16em] text-[#111820]">{col.label}</h3>
                  <span className={`${col.badge} rounded-md border px-2 py-0.5 text-xs font-black`}>{tasks.length}</span>
                </div>
                <div className="min-h-[200px] space-y-2">
                  {visibleTasks.map(task => (
                  <div key={task.id} className="rounded-lg border border-slate-200 bg-white/82 p-3 text-sm transition hover:-translate-y-0.5 hover:border-[#007f96]/30 hover:bg-white" data-testid={`kanban-task-${task.id}`}>
                    <div className="flex items-start justify-between gap-2">
                      <span className="font-medium text-gray-900 leading-tight">{task.title}</span>
                      {task.source !== 'coordination' && (
                        <button onClick={() => handleDeleteTask(task.id)} className="text-xs text-gray-400 hover:text-red-500">✕</button>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-[11px] text-gray-400">{task.id}</p>
                    {task.description && <p className="text-xs text-gray-500 mt-1 line-clamp-2">{task.description}</p>}
                    {task.source === 'coordination' && (
                      <div className="mt-2 rounded-md border border-[#007f96]/20 bg-[#007f96]/8 px-2 py-1 text-[11px] text-[#007f96]">
                        <div className="flex flex-wrap items-center gap-1">
                          <span>Pipeline 协作任务</span>
                          <span>·</span>
                          <span>{task.document_count ?? 0} 篇文档</span>
                        </div>
                        {(task.knowledge_url || task.project_id) && (
                          <a
                            href={task.knowledge_url || `/knowledge?projectId=${encodeURIComponent(task.project_id || '')}&taskId=${encodeURIComponent(task.id)}`}
                            className="mt-1 inline-flex font-mono hover:underline"
                            data-testid={`kanban-task-docs-${task.id}`}
                          >
                            文档: {task.project_id}
                          </a>
                        )}
                        {(task.workflow_url || task.pipeline_instance_id) && (
                          <a
                            href={task.workflow_url || `/pipeline?instanceId=${encodeURIComponent(task.pipeline_instance_id || '')}`}
                            className="mt-1 inline-flex font-mono hover:underline"
                            data-testid={`kanban-task-pipeline-${task.id}`}
                          >
                            工作流: {task.surface_id || task.pipeline_id || task.pipeline_instance_id}
                          </a>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs">{AGENT_ICONS[task.assignee] ?? '🤖'}</span>
                      <span className={`rounded border px-1.5 py-0.5 text-xs font-bold uppercase ${PRIORITY_COLORS[task.priority]}`}>{task.priority}</span>
                    </div>
                    {/* Status change buttons */}
                    <div className="flex gap-1 mt-2 flex-wrap">
                      {STATUS_COLUMNS.filter(c => c.key !== task.status).slice(0, 2).map(c => (
                        <button
                          key={c.key}
                          onClick={() => handleStatusChange(task.id, c.key)}
                          className="rounded border border-slate-200 bg-white/70 px-1.5 py-0.5 text-xs text-slate-600 hover:border-[#007f96]/30 hover:text-[#007f96]"
                        >
                          → {c.label}
                        </button>
                      ))}
                    </div>
                  </div>
                  ))}
                  {hiddenTaskCount > 0 && (
                    <div className="rounded-lg border border-dashed border-slate-300 bg-white/60 p-3 text-center text-xs font-medium text-slate-500">
                      还有 {hiddenTaskCount} 个任务未渲染，可用筛选缩小范围
                    </div>
                  )}
                  {tasks.length === 0 && <div className="py-8 text-center text-xs text-gray-400">暂无任务</div>}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Milestones */}
      {(data?.milestones ?? []).length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white/76 p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.16em] text-gray-900">里程碑</h2>
          <div className="space-y-3">
            {(data?.milestones ?? []).map(ms => (
              <div key={ms.id} className="flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{ms.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${ms.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {ms.status}
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full rounded-full bg-slate-200">
                    <div className="h-2 rounded-full bg-[#007f96]" style={{ width: `${ms.progress}%` }}></div>
                  </div>
                </div>
                <span className="text-xs text-gray-500">目标: {ms.target_date}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Agent Stats */}
      {data?.agent_stats && Object.keys(data.agent_stats).length > 0 && (
        <div className="rounded-lg border border-slate-200 bg-white/76 p-4">
          <h2 className="mb-3 text-sm font-bold uppercase tracking-[0.16em] text-gray-900">Agent 工作量</h2>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {Object.entries(data.agent_stats).map(([agent, stats]) => (
              <div key={agent} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white/70 p-2">
                <span className="text-xl">{AGENT_ICONS[agent] ?? '🤖'}</span>
                <div>
                  <div className="text-sm font-medium">{agent}</div>
                  <div className="text-xs text-gray-500">{stats.total} 任务 · {stats.done} 完成</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
