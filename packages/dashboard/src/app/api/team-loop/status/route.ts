import { NextResponse } from 'next/server';
import { getCompletedDeliveryGateReports } from '@/lib/delivery-gate-reports';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8401';

async function fetchGatewayJson(path: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${GATEWAY_URL}${path}`, {
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return null;
    return response.json();
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function countObjectValues(value: unknown) {
  if (!value || typeof value !== 'object') return 0;
  return Object.values(value as Record<string, unknown>).filter(Boolean).length;
}

function getTaskStatusCounts(tasks: any[]) {
  return tasks.reduce<Record<string, number>>((acc, task) => {
    const status = String(task.status || 'unknown');
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
}

function getMissingChecks(checks: Record<string, boolean>) {
  return Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);
}

export async function GET() {
  const [instancesData, workflowsData, tasksData, documentsData] = await Promise.all([
    fetchGatewayJson('/pipeline-instances?limit=1'),
    fetchGatewayJson('/v1/workflows?limit=1'),
    fetchGatewayJson('/api/v2/tasks'),
    fetchGatewayJson('/api/v2/documents?limit=50'),
  ]);

  const gateReports = getCompletedDeliveryGateReports(20);
  const latestGate = gateReports[0] ?? null;
  const evidenceGate = gateReports.find((report) => report.ok) ?? latestGate;
  const latestInstance = instancesData?.instances?.[0] ?? null;
  const latestWorkflow = workflowsData?.workflows?.[0] ?? null;
  const tasks = Array.isArray(tasksData?.tasks) ? tasksData.tasks : [];
  const documents = Array.isArray(documentsData?.documents) ? documentsData.documents : [];
  const projectId = latestInstance?.coordination?.projectId ?? latestWorkflow?.project_id ?? null;
  const taskIdsBySurface = latestInstance?.coordination?.taskIdsBySurface || {};
  const documentIdsBySurface = latestInstance?.coordination?.documentIdsBySurface || {};
  const surfaceTaskCount = countObjectValues(taskIdsBySurface);
  const surfaceDocumentCount = countObjectValues(documentIdsBySurface);
  const projectTasks = projectId ? tasks.filter((task: any) => task.projectId === projectId) : [];
  const projectDocuments = projectId ? documents.filter((doc: any) => doc.projectId === projectId) : [];
  const boundProjectDocuments = projectDocuments.filter((doc: any) => {
    const relatedTasks = Array.isArray(doc.relatedTaskIds) ? doc.relatedTaskIds : [];
    return Boolean(doc.taskId) || relatedTasks.length > 0 || doc.metadata?.instanceId === latestInstance?.id;
  });
  const latestDocument = [...boundProjectDocuments].sort((a: any, b: any) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] ?? null;
  const taskStatusCounts = getTaskStatusCounts(projectTasks);
  const checks = {
    deliveryGateOk: Boolean(evidenceGate?.ok),
    latestPipelinePresent: Boolean(latestInstance?.id),
    projectBound: Boolean(projectId),
    surfaceTasksBound: surfaceTaskCount > 0,
    projectTasksPresent: projectTasks.length > 0,
    surfaceDocumentsBound: surfaceDocumentCount > 0,
    boundDocumentsPresent: boundProjectDocuments.length > 0,
  };
  const missing = getMissingChecks(checks);
  const loopOk = missing.length === 0;

  return NextResponse.json({
    ok: loopOk,
    checkedAt: Date.now(),
    checks,
    missing,
    checkSummary: `${Object.values(checks).filter(Boolean).length}/${Object.keys(checks).length}`,
    deliveryGate: latestGate
      ? {
          ok: Boolean(evidenceGate?.ok),
          report: evidenceGate?.report ?? latestGate.report,
          summary: evidenceGate?.summary ?? latestGate.summary,
          reportTime: evidenceGate?.reportTime ?? latestGate.reportTime,
          latestReport: {
            ok: latestGate.ok,
            report: latestGate.report,
            summary: latestGate.summary,
            reportTime: latestGate.reportTime,
          },
        }
      : null,
    latestWorkflow: latestWorkflow
      ? {
          id: latestWorkflow.id,
          status: latestWorkflow.status,
          pipelineId: latestWorkflow.pipeline_id || latestWorkflow.template,
          projectId: latestWorkflow.project_id || projectId,
          taskCount: latestWorkflow.coordination_task_count ?? surfaceTaskCount,
          href: latestWorkflow.pipeline_url || (latestInstance?.id ? `/pipeline?instanceId=${latestInstance.id}` : null),
        }
      : null,
    latestInstance: latestInstance
      ? {
          id: latestInstance.id,
          status: latestInstance.status,
          pipelineId: latestInstance.pipelineId,
          projectId,
          surfaceTaskCount,
          surfaceDocumentCount,
          currentSurface: latestInstance.currentSurface || null,
          href: latestInstance.pipeline_url || `/pipeline?instanceId=${latestInstance.id}`,
        }
      : null,
    kanban: {
      projectId,
      taskCount: projectTasks.length,
      statusCounts: taskStatusCounts,
      surfaceTaskCount,
      href: projectId ? `/kanban?source=coordination` : null,
    },
    documents: {
      projectDocumentCount: projectDocuments.length,
      boundProjectDocumentCount: boundProjectDocuments.length,
      total: Number(documentsData?.total || documents.length || 0),
      href: projectId ? `/knowledge?projectId=${encodeURIComponent(projectId)}` : null,
      latestDocument: latestDocument
        ? {
            id: latestDocument.id,
            title: latestDocument.title,
            type: latestDocument.type,
            taskId: latestDocument.taskId || null,
            href: projectId
              ? `/knowledge?projectId=${encodeURIComponent(projectId)}&documentId=${encodeURIComponent(latestDocument.id)}`
              : `/knowledge?documentId=${encodeURIComponent(latestDocument.id)}`,
          }
        : null,
    },
  });
}
