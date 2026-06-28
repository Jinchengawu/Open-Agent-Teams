import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';

const DB_PATH = process.env.SESSION_DB_PATH || `${process.env.HOME}/.dev-agent/data/sessions.db`;
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8400';

type KanbanTask = {
  id: string;
  title: string;
  description: string;
  status: string;
  assignee: string;
  priority: string;
  task_type: string;
  progress: number;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  source?: 'local' | 'coordination';
  project_id?: string;
  document_count?: number;
  pipeline_instance_id?: string;
  pipeline_id?: string;
  surface_id?: string;
  knowledge_url?: string;
  workflow_url?: string;
};

async function fetchDocumentCount(taskId: string): Promise<number> {
  try {
    const res = await fetch(`${GATEWAY_URL}/api/v2/documents?taskId=${encodeURIComponent(taskId)}&limit=1`, {
      cache: 'no-store',
    });
    if (!res.ok) return 0;
    const data = await res.json();
    return Number(data.total || 0);
  } catch {
    return 0;
  }
}

type PipelineTaskLink = {
  pipelineInstanceId: string;
  pipelineId: string;
  surfaceId: string;
};

async function fetchPipelineTaskLinks(): Promise<Map<string, PipelineTaskLink>> {
  const links = new Map<string, PipelineTaskLink>();
  try {
    const res = await fetch(`${GATEWAY_URL}/pipeline-instances?limit=500`, { cache: 'no-store' });
    if (!res.ok) return links;
    const data = await res.json();
    for (const instance of data.instances || []) {
      const taskIdsBySurface = instance.coordination?.taskIdsBySurface || {};
      for (const [surfaceId, taskId] of Object.entries(taskIdsBySurface)) {
        if (!taskId || links.has(String(taskId))) continue;
        links.set(String(taskId), {
          pipelineInstanceId: instance.id,
          pipelineId: instance.pipelineId,
          surfaceId,
        });
      }
    }
  } catch {
    // Keep Kanban usable if Pipeline history is temporarily unavailable.
  }
  return links;
}

async function fetchCurrentProjectId(): Promise<string | null> {
  try {
    const res = await fetch(`${GATEWAY_URL}/pipeline-instances?limit=1`, { cache: 'no-store' });
    if (!res.ok) return null;
    const data = await res.json();
    return data.instances?.[0]?.coordination?.projectId || null;
  } catch {
    return null;
  }
}

function classifyBlockedReason(task: KanbanTask): string {
  const text = `${task.title || ''} ${task.description || ''}`.toLowerCase();
  if (text.includes('model') || text.includes('api_key') || text.includes('配置')) return '缺少配置';
  if (text.includes('pipeline') || text.includes('failed') || text.includes('失败') || text.includes('timeout')) return 'Pipeline 执行失败';
  if (text.includes('test') || text.includes('测试')) return '测试未通过';
  if (text.includes('用户') || text.includes('确认') || text.includes('input')) return '等待用户输入';
  if (task.surface_id || task.pipeline_instance_id) return '等待上游任务';
  if (task.assignee) return 'Agent 调用失败';
  return '未分类';
}

async function mapCoordinationTask(task: any, link?: PipelineTaskLink): Promise<KanbanTask> {
  const documentCount = await fetchDocumentCount(task.id);
  return {
    id: task.id,
    title: task.title,
    description: task.description || '',
    status: task.status,
    assignee: task.assignee || '',
    priority: 'medium',
    task_type: 'pipeline',
    progress: task.status === 'done' ? 100 : task.status === 'in_progress' ? 50 : 0,
    due_at: null,
    created_at: new Date(task.createdAt).toISOString(),
    updated_at: new Date(task.updatedAt).toISOString(),
    source: 'coordination',
    project_id: task.projectId,
    document_count: documentCount,
    pipeline_instance_id: link?.pipelineInstanceId,
    pipeline_id: link?.pipelineId,
    surface_id: link?.surfaceId,
    knowledge_url: task.projectId ? `/knowledge?projectId=${encodeURIComponent(task.projectId)}&taskId=${encodeURIComponent(task.id)}` : undefined,
    workflow_url: link?.pipelineInstanceId ? `/pipeline?instanceId=${encodeURIComponent(link.pipelineInstanceId)}` : undefined,
  };
}

async function fetchCoordinationTasks(): Promise<KanbanTask[]> {
  try {
    const [res, pipelineTaskLinks] = await Promise.all([
      fetch(`${GATEWAY_URL}/api/v2/tasks`, { cache: 'no-store' }),
      fetchPipelineTaskLinks(),
    ]);
    if (!res.ok) return [];
    const data = await res.json();
    return Promise.all((data.tasks || []).map((task: any) => mapCoordinationTask(task, pipelineTaskLinks.get(task.id))));
  } catch {
    return [];
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sourceFilter = searchParams.get('source');
  const assigneeFilter = searchParams.get('assignee');
  const statusFilter = searchParams.get('status');
  const explicitProjectId = searchParams.get('projectId');
  const scope = searchParams.get('scope') || 'current';
  const currentProjectId = scope === 'all' ? null : (explicitProjectId || await fetchCurrentProjectId());

  const db = new Database(DB_PATH, { readonly: true });
  try {
    const localTasks = db.prepare('SELECT * FROM tasks ORDER BY updated_at DESC').all() as KanbanTask[];
    const coordinationTasks = await fetchCoordinationTasks();
    const allTasks = [
      ...coordinationTasks,
      ...localTasks.map((task) => ({ ...task, source: 'local' as const })),
    ];
    const tasks = allTasks
      .filter((task) => !sourceFilter || sourceFilter === 'all' || task.source === sourceFilter)
      .filter((task) => !assigneeFilter || assigneeFilter === 'all' || task.assignee === assigneeFilter)
      .filter((task) => !statusFilter || statusFilter === 'all' || task.status === statusFilter)
      .filter((task) => !currentProjectId || task.project_id === currentProjectId);
    const milestones = db.prepare('SELECT * FROM milestones ORDER BY target_date ASC').all();

    // 按 Agent 统计
    const agentStats = tasks.reduce((acc: any, task: any) => {
      if (!task.assignee) return acc;
      acc[task.assignee] ||= { assignee: task.assignee, total: 0, todo: 0, in_progress: 0, review: 0, done: 0, blocked: 0 };
      acc[task.assignee].total += 1;
      if (task.status in acc[task.assignee]) acc[task.assignee][task.status] += 1;
      return acc;
    }, {});

    const total = tasks.length;
    const completed = tasks.filter(t => t.status === 'done').length;
    const blocked = tasks.filter(t => t.status === 'blocked').length;
    const blocked_reason_groups = tasks
      .filter((task) => task.status === 'blocked')
      .reduce<Record<string, number>>((acc, task) => {
        const reason = classifyBlockedReason(task);
        acc[reason] = (acc[reason] || 0) + 1;
        return acc;
      }, {});
    const overdue = tasks.filter(
      t => t.due_at && t.due_at < new Date().toISOString() && t.status !== 'done'
    ).length;

    return NextResponse.json({
      tasks,
      milestones,
      agent_stats: agentStats,
      summary: {
        total_tasks: total,
        completed,
        blocked,
        blocked_reason_groups,
        overdue,
        active_milestones: (milestones as any[]).filter(m => m.status === 'active').length,
      },
      filters: {
        source: sourceFilter || 'all',
        assignee: assigneeFilter || 'all',
        status: statusFilter || 'all',
        projectId: currentProjectId,
        scope,
      },
    });
  } finally {
    db.close();
  }
}
