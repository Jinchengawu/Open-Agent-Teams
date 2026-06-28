import { NextResponse } from 'next/server';
import { getCompletedDeliveryGateReports } from '@/lib/delivery-gate-reports';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8400';

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

function countStatuses(tasks: any[]) {
  return tasks.reduce<Record<string, number>>((acc, task) => {
    const status = String(task.status || 'unknown');
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {});
}

function classifyBlocker(task: any, latestInstance: any) {
  const text = `${task.title || ''} ${task.description || ''} ${latestInstance?.error || ''}`.toLowerCase();
  if (text.includes('model') || text.includes('api_key') || text.includes('config')) return '缺少配置';
  if (text.includes('timeout') || text.includes('failed') || text.includes('error') || text.includes('失败')) return 'Pipeline 执行失败';
  if (text.includes('test') || text.includes('测试')) return '测试未通过';
  if (text.includes('user') || text.includes('用户') || text.includes('确认')) return '等待用户输入';
  if (task.surface_id || task.pipeline_instance_id) return '等待上游任务';
  return '未分类';
}

function getFailedSurface(instance: any) {
  const results = instance?.surfaceResults || {};
  const entry = Object.entries(results).find(([, result]: [string, any]) => result?.status === 'failed' || result?.status === 'cancelled');
  if (!entry) return null;
  const [surfaceId, result] = entry as [string, any];
  return {
    surfaceId,
    status: result.status,
    error: result.error || instance?.error || null,
    agent: result.agent || null,
  };
}

function deriveHealth(input: {
  agentHealth: any;
  latestGate: any;
  latestInstance: any;
  openSyncOk: boolean;
}) {
  const totalAgents = Number(input.agentHealth?.totalAgents || 0);
  const onlineCount = Number(input.agentHealth?.onlineCount || 0);
  const failedSurface = getFailedSurface(input.latestInstance);

  if (!input.agentHealth || totalAgents === 0 || onlineCount === 0) {
    return {
      status: 'Failed',
      label: 'Failed',
      reason: 'Gateway 或 Agent 不可用',
      tone: 'red',
    };
  }

  if (
    onlineCount < totalAgents ||
    Number(input.latestGate?.warn || 0) > 0 ||
    input.latestInstance?.status === 'failed' ||
    input.latestInstance?.status === 'cancelled' ||
    !input.openSyncOk
  ) {
    return {
      status: 'Degraded',
      label: 'Degraded',
      reason: failedSurface?.error
        ? `Pipeline ${failedSurface.surfaceId} 失败: ${failedSurface.error}`
        : Number(input.latestGate?.warn || 0) > 0
          ? `${input.latestGate.pass}/${input.latestGate.total} checks passed, ${input.latestGate.warn} warning requires review`
          : onlineCount < totalAgents
            ? `${onlineCount}/${totalAgents} Agents 在线`
            : '存在需要处理的交付风险',
      tone: 'amber',
    };
  }

  return {
    status: 'Healthy',
    label: 'Healthy',
    reason: 'Gateway、Agent、Delivery Gate 与 Team Loop 均可用',
    tone: 'green',
  };
}

export async function GET() {
  const [agentHealth, instancesData, workflowsData, tasksData, documentsData] = await Promise.all([
    fetchGatewayJson('/agent-health'),
    fetchGatewayJson('/pipeline-instances?limit=1'),
    fetchGatewayJson('/v1/workflows?limit=1'),
    fetchGatewayJson('/api/v2/tasks'),
    fetchGatewayJson('/api/v2/documents?limit=200'),
  ]);

  const gateReports = getCompletedDeliveryGateReports(10);
  const latestGate = gateReports[0] || null;
  const latestInstance = instancesData?.instances?.[0] || null;
  const latestWorkflow = workflowsData?.workflows?.[0] || null;
  const projectId = latestInstance?.coordination?.projectId || latestWorkflow?.project_id || null;
  const allTasks = Array.isArray(tasksData?.tasks) ? tasksData.tasks : [];
  const allDocuments = Array.isArray(documentsData?.documents) ? documentsData.documents : [];
  const tasks = projectId ? allTasks.filter((task: any) => task.projectId === projectId) : [];
  const documents = projectId ? allDocuments.filter((doc: any) => doc.projectId === projectId) : [];
  const blockedTasks = tasks.filter((task: any) => task.status === 'blocked');
  const failedSurface = getFailedSurface(latestInstance);
  const blockerGroups: Record<string, number> = blockedTasks.reduce((acc: Record<string, number>, task: any) => {
    const group = classifyBlocker(task, latestInstance);
    acc[group] = (acc[group] || 0) + 1;
    return acc;
  }, {});
  const statusCounts = countStatuses(tasks);
  const openSyncOk = true;
  const health = deriveHealth({ agentHealth, latestGate, latestInstance, openSyncOk });
  const latestDocument = [...documents].sort((a: any, b: any) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))[0] || null;

  return NextResponse.json({
    ok: Boolean(projectId),
    checkedAt: Date.now(),
    health,
    project: projectId
      ? {
          id: projectId,
          name: latestWorkflow?.goal || latestInstance?.pipelineId || '当前交付项目',
          goal: latestWorkflow?.goal || latestWorkflow?.template || latestInstance?.pipelineId || 'AI 软件交付项目',
          updatedAt: latestInstance?.completedAt || latestInstance?.startedAt || Date.now(),
        }
      : null,
    currentPipeline: latestInstance
      ? {
          id: latestInstance.id,
          pipelineId: latestInstance.pipelineId,
          status: latestInstance.status,
          currentSurface: latestInstance.currentSurface || failedSurface?.surfaceId || null,
          failedSurface,
          error: latestInstance.error || failedSurface?.error || null,
          href: latestInstance.pipeline_url || `/pipeline?instanceId=${encodeURIComponent(latestInstance.id)}`,
        }
      : null,
    deliveryGate: latestGate
      ? {
          ok: latestGate.ok,
          pass: latestGate.pass,
          fail: latestGate.fail,
          warn: latestGate.warn,
          total: latestGate.total,
          report: latestGate.report,
        }
      : null,
    deliveryLoop: [
      { key: 'meeting', label: 'Meeting', status: documents.some((doc: any) => doc.type === 'meeting_summary') ? 'done' : 'pending' },
      { key: 'document', label: 'Document', status: documents.length > 0 ? 'done' : 'pending' },
      { key: 'kanban', label: 'Kanban', status: tasks.length > 0 ? 'done' : 'pending' },
      { key: 'workflow', label: 'Workflow', status: latestInstance?.status || 'pending' },
      { key: 'artifact', label: 'Artifact', status: documents.some((doc: any) => ['test_report', 'release_note', 'report'].includes(doc.type)) ? 'done' : 'pending' },
      { key: 'experience', label: 'Experience', status: documents.some((doc: any) => ['experience', 'experience_note', 'retrospective'].includes(doc.type)) ? 'done' : 'pending' },
    ],
    tasks: {
      total: tasks.length,
      statusCounts,
      blocked: blockedTasks.length,
      blockerGroups,
      topBlocker: blockedTasks[0] || null,
      href: projectId ? `/kanban?source=coordination&projectId=${encodeURIComponent(projectId)}` : '/kanban',
    },
    documents: {
      total: documents.length,
      latest: latestDocument
        ? {
            id: latestDocument.id,
            title: latestDocument.title,
            type: latestDocument.type,
            href: `/knowledge?projectId=${encodeURIComponent(projectId)}&documentId=${encodeURIComponent(latestDocument.id)}`,
          }
        : null,
      href: projectId ? `/knowledge?projectId=${encodeURIComponent(projectId)}` : '/knowledge',
    },
    nextActions: [
      latestInstance?.status === 'failed'
        ? { label: '查看失败详情', href: latestInstance.pipeline_url || `/pipeline?instanceId=${encodeURIComponent(latestInstance.id)}` }
        : null,
      blockedTasks.length > 0 && projectId
        ? { label: '处理阻塞任务', href: `/kanban?source=coordination&projectId=${encodeURIComponent(projectId)}&status=blocked` }
        : null,
      projectId ? { label: '查看交付看板', href: `/kanban?source=coordination&projectId=${encodeURIComponent(projectId)}` } : null,
      projectId ? { label: '查看项目文档', href: `/knowledge?projectId=${encodeURIComponent(projectId)}` } : null,
    ].filter(Boolean),
  });
}
