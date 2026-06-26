import { NextResponse } from 'next/server';
import Database from 'better-sqlite3';
import { randomUUID } from 'crypto';

const DB_PATH = process.env.SESSION_DB_PATH || `${process.env.HOME}/.dev-agent/data/sessions.db`;

export async function GET() {
  const db = new Database(DB_PATH, { readonly: true });
  try {
    const milestones = db.prepare('SELECT * FROM milestones ORDER BY target_date ASC').all();
    return NextResponse.json({ milestones });
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
      INSERT INTO milestones (id, title, description, target_date)
      VALUES (?, ?, ?, ?)
    `).run(id, body.title || '', body.description || '', body.target_date || '');
    return NextResponse.json({ id, ...body }, { status: 201 });
  } finally {
    db.close();
  }
}
