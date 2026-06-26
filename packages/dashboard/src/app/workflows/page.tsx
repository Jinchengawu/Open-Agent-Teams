'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { SkeletonCard } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import { EmptyState } from '@/components/ui/empty-state'
import { useToast } from '@/components/ui/toast'

interface WorkflowRecord {
  id: string
  session_id: string
  template: string
  pipeline_instance_id?: string
  pipeline_id?: string
  project_id?: string
  coordination_task_count?: number
  pipeline_url?: string
  knowledge_url?: string
  kanban_url?: string
  status: string
  current_step: number
  created_at: string
}

interface WorkflowStep {
  id: number
  workflow_id: string
  agent_id: string
  step_order: number
  input: string
  output: string
  status: string
  started_at: string | null
  completed_at: string | null
}

interface Template {
  id: string
  name: string
  description: string
  source?: string
  deletable?: boolean
  steps: { agentId: string; order: number; description: string }[]
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-200',
  running: 'bg-blue-500',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  skipped: 'bg-yellow-500',
}

const STATUS_OPTIONS = [
  { label: '全部', value: 'all' },
  { label: '运行中', value: 'running' },
  { label: '失败', value: 'failed' },
  { label: '完成', value: 'completed' },
  { label: '等待', value: 'pending' },
]

export default function WorkflowsPage() {
  const { showToast } = useToast()
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [templates, setTemplates] = useState<Template[]>([])
  const [startingTemplate, setStartingTemplate] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState('all')
  const [pipelineOnly, setPipelineOnly] = useState(false)

  const fetchWorkflows = () => {
    setLoading(true)
    setError('')
    fetch('/api/workflows?limit=100')
      .then((r) => r.json())
      .then((data) => {
        setWorkflows(data.workflows || [])
        if (data.error) setError(data.error)
      })
      .catch(() => setError('Failed to fetch workflows'))
      .finally(() => setLoading(false))
  }

  const visibleWorkflows = workflows.filter((workflow) => {
    if (statusFilter !== 'all' && workflow.status !== statusFilter) return false
    if (pipelineOnly && !workflow.pipeline_instance_id) return false
    return true
  })

  useEffect(() => { fetchWorkflows() }, [])

  useEffect(() => {
    fetch('/api/workflows/templates')
      .then((r) => r.json())
      .then((data) => setTemplates(data.templates || []))
      .catch(() => {})
  }, [])

  const startTemplate = async (template: Template) => {
    setStartingTemplate(template.id)
    try {
      const res = await fetch('/api/pipelines/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pipelineId: template.id,
          initialInput: {
            userRequest: `Dashboard workflow template started ${template.id}. Produce concise coordination artifacts and preserve results as documents.`,
            requestedBy: 'dashboard-workflows',
          },
          options: {
            dryRun: true,
            surfaceTimeoutMs: 90_000,
          },
        }),
      })
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || 'Workflow start failed')
      showToast(`Workflow started: ${template.id}`, 'success')
      fetchWorkflows()
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Unknown error'
      showToast(msg, 'error')
    } finally {
      setStartingTemplate(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">Workflows</h1>
        <div className="grid grid-cols-1 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <SkeletonCard key={i} />)}
        </div>
      </div>
    )
  }

  if (error && workflows.length === 0) {
    return (
      <ErrorState
        title="No workflows available"
        message="Start the Gateway to enable workflow orchestration."
        onRetry={fetchWorkflows}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Workflows</h1>
        <p className="text-sm text-gray-500 mt-1">
          {visibleWorkflows.length}/{workflows.length} workflows · {templates.length} templates available
        </p>
      </div>

      <Card>
        <CardContent className="flex flex-col gap-3 p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={statusFilter}
              onChange={(event) => setStatusFilter(event.target.value)}
              className="h-9 rounded-md border border-gray-300 bg-white px-3 text-sm focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-100"
              aria-label="Workflow status filter"
              data-testid="workflow-status-filter"
            >
              {STATUS_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <label className="flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={pipelineOnly}
                onChange={(event) => setPipelineOnly(event.target.checked)}
                data-testid="workflow-pipeline-only"
              />
              只看 Pipeline
            </label>
          </div>
          <Button variant="outline" size="sm" onClick={fetchWorkflows}>
            刷新
          </Button>
        </CardContent>
      </Card>

      {/* Templates */}
      {templates.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase">Available Templates</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {templates.map((tpl) => (
              <Card key={tpl.id} data-testid={`workflow-template-${tpl.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-semibold text-gray-900">{tpl.name}</h3>
                        {tpl.source === 'runtime-yaml' && (
                          <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                            运行时 YAML
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs font-mono text-gray-400">{tpl.id}</p>
                    </div>
                    <Button
                      size="sm"
                      onClick={() => startTemplate(tpl)}
                      disabled={startingTemplate === tpl.id}
                      data-testid={`workflow-template-start-${tpl.id}`}
                    >
                      {startingTemplate === tpl.id ? '启动中...' : '启动'}
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{tpl.description}</p>
                  <div className="flex items-center space-x-1 mt-3">
                    {tpl.steps.map((step, i) => (
                      <span key={i} className="text-xs">
                        <span className="text-gray-400">{step.agentId.replace('dev-', '')}</span>
                        {i < tpl.steps.length - 1 && <span className="text-gray-300 mx-1">→</span>}
                      </span>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* Workflow List */}
      {visibleWorkflows.length === 0 ? (
        <EmptyState
          icon="🔄"
          title={workflows.length === 0 ? 'No workflows yet' : 'No matching workflows'}
          description={workflows.length === 0 ? 'Start a workflow from the PM agent when you confirm requirements.' : 'Change the filters to review more workflow records.'}
        />
      ) : (
        <div className="space-y-3">
          {visibleWorkflows.map((wf) => (
            <Card key={wf.id}>
              <CardContent className="p-5">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="flex items-center space-x-2">
                      <h3 className="font-semibold text-gray-900">{wf.template}</h3>
                      <Badge
                        variant={
                          wf.status === 'completed'
                            ? 'default'
                            : wf.status === 'failed'
                            ? 'destructive'
                            : 'secondary'
                        }
                      >
                        {wf.status}
                      </Badge>
                    </div>
                    <p className="text-xs text-gray-400 font-mono mt-1">{wf.id}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 text-xs">
                    <span className="text-gray-400">
                      {new Date(wf.created_at).toLocaleString()}
                    </span>
                    <div className="flex flex-wrap justify-end gap-2">
                      {wf.pipeline_instance_id && (
                        <a
                          href={wf.pipeline_url || `/pipeline?instanceId=${encodeURIComponent(wf.pipeline_instance_id)}`}
                          className="text-blue-600 hover:underline"
                          data-testid={`workflow-pipeline-${wf.id}`}
                        >
                          Pipeline
                        </a>
                      )}
                      {wf.project_id && (
                        <a
                          href={wf.knowledge_url || `/knowledge?projectId=${encodeURIComponent(wf.project_id)}`}
                          className="text-emerald-700 hover:underline"
                          data-testid={`workflow-knowledge-${wf.id}`}
                        >
                          文档
                        </a>
                      )}
                      {wf.kanban_url && (
                        <a
                          href={wf.kanban_url}
                          className="text-slate-600 hover:underline"
                          data-testid={`workflow-kanban-${wf.id}`}
                        >
                          看板
                        </a>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center space-x-2">
                  {Array.from({ length: wf.current_step + 1 }).map((_, i) => (
                    <div
                      key={i}
                      className={`h-2 flex-1 rounded-full ${
                        i < wf.current_step
                          ? 'bg-green-500'
                          : i === wf.current_step && wf.status === 'running'
                          ? 'bg-blue-500 animate-pulse'
                          : i === wf.current_step && wf.status === 'completed'
                          ? 'bg-green-500'
                          : 'bg-gray-200'
                      }`}
                    />
                  ))}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  Step {wf.current_step + 1} · Session: {wf.session_id}
                  {wf.coordination_task_count ? ` · Tasks: ${wf.coordination_task_count}` : ''}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
