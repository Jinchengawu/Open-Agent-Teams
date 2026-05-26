'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { SkeletonCard } from '@/components/ui/skeleton'
import { ErrorState } from '@/components/ui/error-state'
import { EmptyState } from '@/components/ui/empty-state'

interface WorkflowRecord {
  id: string
  session_id: string
  template: string
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
  steps: { agentId: string; order: number; description: string }[]
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-gray-200',
  running: 'bg-blue-500',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
  skipped: 'bg-yellow-500',
}

export default function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WorkflowRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [templates, setTemplates] = useState<Template[]>([])

  const fetchWorkflows = () => {
    setLoading(true)
    setError('')
    fetch('/api/workflows')
      .then((r) => r.json())
      .then((data) => {
        setWorkflows(data.workflows || [])
        if (data.error) setError(data.error)
      })
      .catch(() => setError('Failed to fetch workflows'))
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchWorkflows() }, [])

  useEffect(() => {
    fetch('http://localhost:8205/v1/templates')
      .then((r) => r.json())
      .then((data) => setTemplates(data.templates || []))
      .catch(() => {})
  }, [])

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
        message="Start the PM agent to enable workflow orchestration."
        onRetry={fetchWorkflows}
      />
    )
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Workflows</h1>
        <p className="text-sm text-gray-500 mt-1">
          {workflows.length} workflows · {templates.length} templates available
        </p>
      </div>

      {/* Templates */}
      {templates.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-gray-700 mb-3 uppercase">Available Templates</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {templates.map((tpl) => (
              <Card key={tpl.id}>
                <CardContent className="p-4">
                  <h3 className="font-semibold text-gray-900">{tpl.name}</h3>
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
      {workflows.length === 0 ? (
        <EmptyState
          icon="🔄"
          title="No workflows yet"
          description="Start a workflow from the PM agent when you confirm requirements."
        />
      ) : (
        <div className="space-y-3">
          {workflows.map((wf) => (
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
                  <span className="text-xs text-gray-400">
                    {new Date(wf.created_at).toLocaleString()}
                  </span>
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
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
