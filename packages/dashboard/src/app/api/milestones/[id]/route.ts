import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';

const DB_PATH = process.env.SESSION_DB_PATH || `${process.env.HOME}/.open-agent-teams/data/sessions.db`;

export async function PUT(request: Request, { params }: { params: { id: string } }) {
  const body = await request.json();
  if (body.progress !== undefined
    && (!Number.isInteger(body.progress) || body.progress < 0 || body.progress > 100)) {
    return NextResponse.json({ error: 'progress must be an integer from 0 to 100' }, { status: 400 });
  }
  const db = new Database(DB_PATH);
  try {
    const existing: any = db.prepare('SELECT * FROM milestones WHERE id = ?').get(params.id);
    if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 });

    const completedAt = body.status === 'completed' && existing.status !== 'completed'
      ? new Date().toISOString()
      : existing.completed_at;

    db.prepare(`
      UPDATE milestones SET
        title = COALESCE(?, title),
        description = COALESCE(?, description),
        status = COALESCE(?, status),
        target_date = COALESCE(?, target_date),
        progress = COALESCE(?, progress),
        completed_at = COALESCE(?, completed_at),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(body.title, body.description, body.status, body.target_date, body.progress, completedAt, params.id);
    return NextResponse.json(db.prepare('SELECT * FROM milestones WHERE id = ?').get(params.id));
  } finally {
    db.close();
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const db = new Database(DB_PATH);
  try {
    db.prepare('DELETE FROM milestones WHERE id = ?').run(params.id);
    return NextResponse.json({ deleted: params.id });
  } finally {
    db.close();
  }
}
