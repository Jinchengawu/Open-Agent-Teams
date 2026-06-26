import { NextResponse } from 'next/server'
import { getCompletedDeliveryGateReports } from '@/lib/delivery-gate-reports'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

const AGENT_PORTS = [8201, 8202, 8203, 8204, 8205]
const AGENT_IDS = ['frontend', 'backend', 'testing', 'devops', 'pm']

async function fetchJson(url: string, timeoutMs = 3000) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!response.ok) return null
    return response.json()
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}

async function getAgentHealth() {
  const agents = await Promise.all(
    AGENT_PORTS.map(async (port, index) => {
      const data = await fetchJson(`http://127.0.0.1:${port}/health`)
      return {
        id: AGENT_IDS[index],
        port,
        online: Boolean(data?.status === 'ok'),
        skills: Number(data?.skills || 0),
      }
    }),
  )
  return {
    agents,
    onlineCount: agents.filter((agent) => agent.online).length,
    totalAgents: agents.length,
    totalSkills: agents.reduce((sum, agent) => sum + agent.skills, 0),
  }
}

async function getWorkflowEvidence() {
  const data = await fetchJson('http://127.0.0.1:8205/v1/workflows', 5000)
  const workflows = Array.isArray(data?.workflows) ? data.workflows : []
  const latestWorkflow = workflows[0] ?? null
  return {
    reachable: Boolean(data),
    workflows,
    latestWorkflow,
    workflowCount: workflows.length,
  }
}

function getMissingChecks(checks: Record<string, boolean>) {
  return Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)
}

export async function GET() {
  const [agentHealth, workflowEvidence] = await Promise.all([
    getAgentHealth(),
    getWorkflowEvidence(),
  ])
  const latestGate = getCompletedDeliveryGateReports(1)[0] ?? null
  const latestWorkflow = workflowEvidence.latestWorkflow
  const projectId = latestWorkflow?.project_id || latestWorkflow?.projectId || null
  const taskCount = Number(latestWorkflow?.coordination_task_count || latestWorkflow?.taskCount || 0)
  const checks = {
    agentsOnline: agentHealth.onlineCount > 0,
    teamReachable: agentHealth.onlineCount === agentHealth.totalAgents,
    workflowEndpointReachable: workflowEvidence.reachable,
    latestWorkflowPresent: Boolean(latestWorkflow?.id),
    deliveryGateEvidencePresent: Boolean(latestGate?.total),
    deliveryGateOk: Boolean(latestGate?.ok),
  }
  const missing = getMissingChecks(checks)

  return NextResponse.json({
    ok: missing.length === 0,
    checkedAt: Date.now(),
    checks,
    missing,
    checkSummary: `${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`,
    agents: agentHealth,
    deliveryGate: latestGate
      ? {
          ok: latestGate.ok,
          report: latestGate.report,
          reportTime: latestGate.reportTime,
          summary: latestGate.summary,
          href: '/api/delivery-gate/latest?format=markdown',
        }
      : null,
    latestWorkflow: latestWorkflow
      ? {
          id: latestWorkflow.id,
          status: latestWorkflow.status,
          pipelineId: latestWorkflow.pipeline_id || latestWorkflow.template || latestWorkflow.pipelineId || null,
          projectId,
          taskCount,
          href: '/workflows',
        }
      : null,
    kanban: {
      projectId,
      taskCount,
      surfaceTaskCount: taskCount,
      href: null,
    },
    documents: {
      projectDocumentCount: 0,
      boundProjectDocumentCount: 0,
      total: 0,
      href: null,
      latestDocument: null,
    },
  })
}
