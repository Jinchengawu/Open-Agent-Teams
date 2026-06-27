import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { initSchema } from './schema.js';
export class SessionManager {
    db;
    getDb() {
        return this.db;
    }
    constructor(dbPath) {
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.pragma('foreign_keys = ON');
        initSchema(this.db);
    }
    createSession(title = '', clientId = '') {
        const id = clientId || uuidv4();
        this.db
            .prepare('INSERT INTO sessions (id, title) VALUES (?, ?)')
            .run(id, title);
        return id;
    }
    getSession(sessionId) {
        const row = this.db
            .prepare('SELECT * FROM sessions WHERE id = ?')
            .get(sessionId);
        return row || null;
    }
    listSessions(limit = 50, offset = 0) {
        return this.db
            .prepare('SELECT * FROM sessions WHERE status != ? ORDER BY updated_at DESC LIMIT ? OFFSET ?')
            .all('deleted', limit, offset);
    }
    ALLOWED_COLUMNS = new Set(['title', 'status']);
    updateSession(sessionId, updates) {
        const fields = [];
        const values = [];
        for (const [key, value] of Object.entries(updates)) {
            if (!this.ALLOWED_COLUMNS.has(key))
                continue;
            fields.push(`${key} = ?`);
            values.push(value);
        }
        if (fields.length === 0)
            return;
        fields.push("updated_at = datetime('now')");
        values.push(sessionId);
        this.db
            .prepare(`UPDATE sessions SET ${fields.join(', ')} WHERE id = ?`)
            .run(...values);
    }
    deleteSession(sessionId) {
        this.db
            .prepare("UPDATE sessions SET status = 'deleted', updated_at = datetime('now') WHERE id = ?")
            .run(sessionId);
    }
    addMessage(sessionId, role, content, agentId = '') {
        const tokens = Math.ceil(content.length * 0.4);
        const result = this.db
            .prepare('INSERT INTO messages (session_id, role, agent_id, content, tokens) VALUES (?, ?, ?, ?, ?)')
            .run(sessionId, role, agentId, content, tokens);
        this.db
            .prepare("UPDATE sessions SET updated_at = datetime('now') WHERE id = ?")
            .run(sessionId);
        return Number(result.lastInsertRowid);
    }
    getMessages(sessionId, limit = 50) {
        return this.db
            .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?')
            .all(sessionId, limit)
            .reverse();
    }
    getAllMessages(sessionId) {
        return this.db
            .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id ASC')
            .all(sessionId);
    }
    getRecentMessages(sessionId, count) {
        return this.db
            .prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY id DESC LIMIT ?')
            .all(sessionId, count)
            .reverse();
    }
    countMessageTokens(sessionId) {
        const row = this.db
            .prepare('SELECT COALESCE(SUM(tokens), 0) as total FROM messages WHERE session_id = ?')
            .get(sessionId);
        return row.total;
    }
    getSessionCount() {
        const row = this.db
            .prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'active'")
            .get();
        return row.count;
    }
    getTotalMessageCount() {
        const row = this.db
            .prepare('SELECT COUNT(*) as count FROM messages')
            .get();
        return row.count;
    }
    close() {
        this.db.close();
    }
}
//# sourceMappingURL=SessionManager.js.map