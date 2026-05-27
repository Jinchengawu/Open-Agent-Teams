import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { initSchema } from './schema';

export interface Session {
  id: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  agent_id: string;
  content: string;
  tokens: number;
  created_at: string;
}

export class SessionManager {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    initSchema(this.db);
  }

  createSession(title = '', clientId = ''): string {
    const id = clientId || uuidv4();
    this.db
      .prepare('INSERT INTO sessions (id, title) VALUES (?, ?)')
      .run(id, title);
    return id;
  }

  getSession(sessionId: string): Session | null {
    const row = this.db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(sessionId) as Session | undefined;
    return row || null;
  }

  listSessions(limit = 50, offset = 0): Session[] {
    return this.db
      .prepare(
        'SELECT * FROM sessions WHERE status != ? ORDER BY updated_at DESC LIMIT ? OFFSET ?'
      )
      .all('deleted', limit, offset) as Session[];
  }

  private readonly ALLOWED_COLUMNS = new Set(['title', 'status']);

  updateSession(sessionId: string, updates: Partial<Session>): void {
    const fields: string[] = [];
    const values: unknown[] = [];
    for (const [key, value] of Object.entries(updates)) {
      if (!this.ALLOWED_COLUMNS.has(key)) continue;
      fields.push(`${key} = ?`);
      values.push(value);
    }
    if (fields.length === 0) return;
    fields.push("updated_at = datetime('now')");
    values.push(sessionId);
    this.db
      .prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`)
      .run(...values);
  }

  deleteSession(sessionId: string): void {
    this.db
      .prepare("UPDATE sessions SET status = 'deleted', updated_at = datetime('now') WHERE id = ?")
      .run(sessionId);
  }

  addMessage(
    sessionId: string,
    role: string,
    content: string,
    agentId = ''
  ): number {
    const tokens = Math.ceil(content.length * 0.4);
    const result = this.db
      .prepare(
        'INSERT INTO messages (session_id, role, agent_id, content, tokens) VALUES (?, ?, ?, ?, ?)'
      )
      .run(sessionId, role, agentId, content, tokens);
    this.db
      .prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?")
      .run(sessionId);
    return Number(result.lastInsertRowid);
  }

  getMessages(sessionId: string, limit = 50): Message[] {
    return this.db
      .prepare(
        'SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?'
      )
      .all(sessionId, limit)
      .reverse() as Message[];
  }

  getAllMessages(sessionId: string): Message[] {
    return this.db
      .prepare(
        'SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC'
      )
      .all(sessionId) as Message[];
  }

  getRecentMessages(sessionId: string, count: number): Message[] {
    return this.db
      .prepare(
        'SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?'
      )
      .all(sessionId, count)
      .reverse() as Message[];
  }

  countMessageTokens(sessionId: string): number {
    const row = this.db
      .prepare(
        'SELECT COALESCE(SUM(tokens), 0) as total FROM messages WHERE session_id = ?'
      )
      .get(sessionId) as { total: number };
    return row.total;
  }

  getSessionCount(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'active'")
      .get() as { count: number };
    return row.count;
  }

  getTotalMessageCount(): number {
    const row = this.db
      .prepare('SELECT COUNT(*) as count FROM messages')
      .get() as { count: number };
    return row.count;
  }

  close(): void {
    this.db.close();
  }
}
