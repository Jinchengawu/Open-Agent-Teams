import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

const DB_PATH = process.env.SESSION_DB_PATH || `${process.env.HOME}/.dev-agent/data/sessions.db`;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status');
  const assignee = searchParams.get('assignee');
  const milestoneId = searchParams.get('milestone_id');

  const db = new Database(DB_PATH, { readonly: true });
  try {
    let query = 'SELECT * FROM tasks WHERE 1=1';
    const params: any[] = [];
    if (status) { query += ' AND status = ?'; params.push(status); }
    if (assignee) { query += ' AND assignee = ?'; params.push(assignee); }
    if (milestoneId) { query += ' AND milestone_id = ?'; params.push(milestoneId); }
    query += ' ORDER BY updated_at DESC';

    const tasks = db.prepare(query).all(...params);
    return NextResponse.json({ tasks });
  } finally {
    db.close();
  }
}

export async function POST(request: Request) {
  const body = await request.json();
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  if (!title) {
    return NextResponse.json({ error: 'title is required' }, { status: 400 });
  }

  const id = randomUUID();

  const db = new Database(DB_PATH);
  try {
    db.prepare(`
      INSERT INTO tasks (id, title, description, status, assignee, priority, task_type, milestone_id, parent_id, due_at, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      title,
      body.description || '',
      body.status || 'todo',
      body.assignee || '',
      body.priority || 'medium',
      body.task_type || 'feature',
      body.milestone_id || null,
      body.parent_id || null,
      body.due_at || null,
      body.tags ? JSON.stringify(body.tags) : null
    );
    const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
    return NextResponse.json(task, { status: 201 });
  } finally {
    db.close();
  }
}
