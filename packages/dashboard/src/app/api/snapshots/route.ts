import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

const DB_PATH = process.env.SESSION_DB_PATH || `${process.env.HOME}/.dev-agent/data/sessions.db`;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const sessionId = searchParams.get('session_id');

  const db = new Database(DB_PATH, { readonly: true });
  try {
    let query = 'SELECT * FROM snapshots';
    const params: any[] = [];
    if (sessionId) {
      query += ' WHERE session_id = ?';
      params.push(sessionId);
    }
    query += ' ORDER BY created_at DESC';
    const snapshots = db.prepare(query).all(...params);
    return NextResponse.json({ snapshots });
  } finally {
    db.close();
  }
}

export async function POST(request: Request) {
  const body = await request.json();
  const id = randomUUID();

  const db = new Database(DB_PATH);
  try {
    db.prepare(`
      INSERT INTO snapshots (id, session_id, user_id, title, description, files, commit_message)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      body.session_id || '',
      body.user_id || '',
      body.title || '未命名快照',
      body.description || '',
      JSON.stringify(body.files || []),
      body.commit_message || ''
    );
    return NextResponse.json({ id, ...body }, { status: 201 });
  } finally {
    db.close();
  }
}

export async function DELETE(request: Request) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const db = new Database(DB_PATH);
  try {
    db.prepare('DELETE FROM snapshots WHERE id = ?').run(id);
    return NextResponse.json({ deleted: id });
  } finally {
    db.close();
  }
}
