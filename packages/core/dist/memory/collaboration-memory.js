/**
 * 协作会话记忆（层2）
 *
 * 管理多 Agent 协作会话：创建/评论/归档/快照。
 * 用于会议模式、需求讨论、架构评审等场景。
 */
export class CollaborationMemory {
    db;
    constructor(db) {
        this.db = db;
        this.initSchema();
    }
    initSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS collab_sessions (
        id           TEXT PRIMARY KEY,
        title        TEXT NOT NULL DEFAULT '',
        goal         TEXT NOT NULL DEFAULT '',
        status       TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived','resolved')),
        participants TEXT NOT NULL DEFAULT '[]',
        created_at   TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
        resolved_at  TEXT
      );

      CREATE TABLE IF NOT EXISTS collab_comments (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES collab_sessions(id) ON DELETE CASCADE,
        agent_id   TEXT NOT NULL,
        content    TEXT NOT NULL,
        round      INTEGER NOT NULL DEFAULT 1,
        tokens     INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_collab_comments_session ON collab_comments(session_id, round);

      CREATE TABLE IF NOT EXISTS collab_snapshots (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id   TEXT NOT NULL REFERENCES collab_sessions(id) ON DELETE CASCADE,
        resolution   TEXT NOT NULL DEFAULT '',
        summary      TEXT NOT NULL DEFAULT '',
        total_tokens INTEGER NOT NULL DEFAULT 0,
        duration     INTEGER NOT NULL DEFAULT 0,
        created_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_collab_snapshots_session ON collab_snapshots(session_id);
    `);
    }
    // ==================== 会话 CRUD ====================
    /** 创建协作会话 */
    createSession(title, goal, participants = []) {
        const id = `collab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        this.db.prepare(`
      INSERT INTO collab_sessions (id, title, goal, participants) VALUES (?, ?, ?, ?)
    `).run(id, title, goal, JSON.stringify(participants));
        return id;
    }
    /** 获取会话 */
    getSession(sessionId) {
        const row = this.db.prepare('SELECT * FROM collab_sessions WHERE id = ?')
            .get(sessionId);
        if (!row)
            return null;
        return { ...row, participants: JSON.parse(row.participants) };
    }
    /** 列出会话 */
    listSessions(status, limit = 50) {
        const rows = status
            ? this.db.prepare('SELECT * FROM collab_sessions WHERE status = ? ORDER BY updated_at DESC LIMIT ?')
                .all(status, limit)
            : this.db.prepare('SELECT * FROM collab_sessions ORDER BY updated_at DESC LIMIT ?')
                .all(limit);
        return rows
            .map(r => ({ ...r, participants: JSON.parse(r.participants) }));
    }
    /** 归档会话 */
    archiveSession(sessionId) {
        const result = this.db.prepare(`
      UPDATE collab_sessions SET status = 'archived', updated_at = datetime('now') WHERE id = ?
    `).run(sessionId);
        return result.changes > 0;
    }
    /** 标记为已解决 */
    resolveSession(sessionId) {
        const result = this.db.prepare(`
      UPDATE collab_sessions SET status = 'resolved', resolved_at = datetime('now'), updated_at = datetime('now') WHERE id = ?
    `).run(sessionId);
        return result.changes > 0;
    }
    // ==================== 评论 ====================
    /** 添加评论 */
    addComment(sessionId, agentId, content, round = 1, tokens = 0) {
        const result = this.db.prepare(`
      INSERT INTO collab_comments (session_id, agent_id, content, round, tokens) VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, agentId, content, round, tokens);
        // 更新会话时间
        this.db.prepare("UPDATE collab_sessions SET updated_at = datetime('now') WHERE id = ?").run(sessionId);
        return Number(result.lastInsertRowid);
    }
    /** 获取会话评论 */
    getComments(sessionId, round) {
        if (round !== undefined) {
            return this.db.prepare(`
        SELECT * FROM collab_comments WHERE session_id = ? AND round = ? ORDER BY id ASC
      `).all(sessionId, round);
        }
        return this.db.prepare(`
      SELECT * FROM collab_comments WHERE session_id = ? ORDER BY round ASC, id ASC
    `).all(sessionId);
    }
    /** 获取评论数量 */
    getCommentCount(sessionId) {
        const row = this.db.prepare('SELECT COUNT(*) as count FROM collab_comments WHERE session_id = ?')
            .get(sessionId);
        return row.count;
    }
    // ==================== 快照 ====================
    /** 保存快照（决议） */
    saveSnapshot(sessionId, resolution, summary, totalTokens, duration) {
        const result = this.db.prepare(`
      INSERT INTO collab_snapshots (session_id, resolution, summary, total_tokens, duration) VALUES (?, ?, ?, ?, ?)
    `).run(sessionId, resolution, summary, totalTokens, duration);
        return Number(result.lastInsertRowid);
    }
    /** 获取会话快照 */
    getSnapshots(sessionId) {
        return this.db.prepare(`
      SELECT * FROM collab_snapshots WHERE session_id = ? ORDER BY created_at DESC
    `).all(sessionId);
    }
    /** 获取最新快照 */
    getLatestSnapshot(sessionId) {
        return this.db.prepare(`
      SELECT * FROM collab_snapshots WHERE session_id = ? ORDER BY id DESC LIMIT 1
    `).get(sessionId) ?? null;
    }
    // ==================== 统计 ====================
    /** 会话统计 */
    getSessionStats(sessionId) {
        const comments = this.getComments(sessionId);
        const session = this.getSession(sessionId);
        const rounds = comments.length > 0 ? Math.max(...comments.map(c => c.round)) : 0;
        return {
            commentCount: comments.length,
            totalTokens: comments.reduce((sum, c) => sum + c.tokens, 0),
            participants: session?.participants ?? [],
            rounds,
        };
    }
}
//# sourceMappingURL=collaboration-memory.js.map