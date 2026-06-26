import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';

const DB_PATH = process.env.SESSION_DB_PATH || `${process.env.HOME}/.dev-agent/data/sessions.db`;
const GATEWAY_URL = process.env.GATEWAY_URL || 'http://127.0.0.1:8400';

function isCoordinationTask(id: string): boolean {
  return id.startsWith('task-');
}

export async function GET(_: Request, { params }: { params: { id: string } }) {
  if (isCoordinationTask(params.id)) {
    const res = await fetch(`${GATEWAY_URL}/api/v2/tasks/${params.id}`, { cache: 'no-store' });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  }

  const db = new Database(DB_PATH, { readonly: true });
  try {
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(params.id);
    if (!task) return NextResponse.json({ error: 'not found' }, { status: 404 });
    return NextResponse.json(task);
  } finally {
    db.close();
  }
}

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json();

  if (isCoordinationTask(params.id)) {
    const res = await fetch(`${GATEWAY_URL}/api/v2/tasks/${params.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: body.status }),
      cache: 'no-store',
    });
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  }

  const db = new Database(DB_PATH);
  try {
    const existing: any = db.prepare('SELECT * FROM tasks WHERE id = ?').get(params.id);
    if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const completedAt = body.status === 'done' && existing.status !== 'done'
      ? new Date().toISOString()
      : existing.completed_at;

    db.prepare(`
      UPDATE tasks SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        status = COALESCE(?, status),
        assignee = COALESCE(?, assignee),
        priority = COALESCE(?, priority),
        task_type = COALESCE(?, task_type),
        milestone_id = COALESCE(?, milestone_id),
        parent_id = COALESCE(?, parent_id),
        progress = COALESCE(?, progress),
        tags = COALESCE(?, tags),
        due_at = COALESCE(?, due_at),
        completed_at = COALESCE(?, completed_at),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      body.title, body.description, body.status, body.assignee, body.priority,
      body.task_type, body.milestone_id, body.parent_id, body.progress,
      body.tags ? JSON.stringify(body.tags) : null, body.due_at, completedAt, params.id
    );
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(params.id);
    return NextResponse.json(task);
  } finally {
    db.close();
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  if (isCoordinationTask(params.id)) {
    return NextResponse.json({ error: 'Coordination tasks are managed by Pipeline history' }, { status: 405 });
  }

  const db = new Database(DB_PATH);
  try {
    const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(params.id);
    if (result.changes === 0) {
      return NextResponse.json({ error: 'not found' }, { status: 404 });
    }
    return NextResponse.json({ deleted: params.id });
  } finally {
    db.close();
  }
}
