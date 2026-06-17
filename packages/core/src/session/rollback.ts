/**
 * 会话级回滚机制
 *
 * 支持会话状态快照和恢复到任意步骤。
 */

import type Database from 'better-sqlite3';

/** 会话快照 */
export interface SessionSnapshot {
  id: number;
  session_id: string;
  step: number;
  description: string;
  state: string; // JSON 序列化的状态
  created_at: string;
}

export class RollbackManager {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_snapshots (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id  TEXT NOT NULL,
        step        INTEGER NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        state       TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_session_snapshots_session ON session_snapshots(session_id, step);
    `);
  }

  /** 保存快照 */
  saveSnapshot(sessionId: string, step: number, description: string, state: unknown): number {
    const result = this.db.prepare(`
      INSERT INTO session_snapshots (session_id, step, description, state) VALUES (?, ?, ?, ?)
    `).run(sessionId, step, description, JSON.stringify(state));
    return Number(result.lastInsertRowid);
  }

  /** 获取快照 */
  getSnapshot(sessionId: string, step: number): SessionSnapshot | null {
    return (this.db.prepare(`
      SELECT * FROM session_snapshots WHERE session_id = ? AND step = ?
    `).get(sessionId, step) as SessionSnapshot) ?? null;
  }

  /** 获取最新快照 */
  getLatestSnapshot(sessionId: string): SessionSnapshot | null {
    return (this.db.prepare(`
      SELECT * FROM session_snapshots WHERE session_id = ? ORDER BY step DESC LIMIT 1
    `).get(sessionId) as SessionSnapshot) ?? null;
  }

  /** 获取所有快照 */
  getSnapshots(sessionId: string): SessionSnapshot[] {
    return this.db.prepare(`
      SELECT * FROM session_snapshots WHERE session_id = ? ORDER BY step ASC
    `).all(sessionId) as SessionSnapshot[];
  }

  /** 回滚到指定步骤 */
  rollback(sessionId: string, step: number): { success: boolean; state: unknown; snapshot: SessionSnapshot | null } {
    const snapshot = this.getSnapshot(sessionId, step);
    if (!snapshot) {
      return { success: false, state: null, snapshot: null };
    }

    // 删除该步骤之后的所有快照
    this.db.prepare(`
      DELETE FROM session_snapshots WHERE session_id = ? AND step > ?
    `).run(sessionId, step);

    // 删除该步骤之后的所有消息
    const snapshotTime = snapshot.created_at;
    this.db.prepare(`
      DELETE FROM messages WHERE session_id = ? AND created_at > ?
    `).run(sessionId, snapshotTime);

    return {
      success: true,
      state: JSON.parse(snapshot.state),
      snapshot,
    };
  }

  /** 删除会话的所有快照 */
  deleteSnapshots(sessionId: string): boolean {
    const result = this.db.prepare('DELETE FROM session_snapshots WHERE session_id = ?').run(sessionId);
    return result.changes > 0;
  }

  /** 获取快照数量 */
  getSnapshotCount(sessionId: string): number {
    const row = this.db.prepare('SELECT COUNT(*) as count FROM session_snapshots WHERE session_id = ?')
      .get(sessionId) as { count: number };
    return row.count;
  }
}
