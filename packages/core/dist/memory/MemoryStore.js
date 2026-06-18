import Database from 'better-sqlite3';
const MEMORY_SCHEMA = `
CREATE TABLE IF NOT EXISTS agent_memory (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  agent_id    TEXT NOT NULL,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  ttl         INTEGER DEFAULT NULL,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_memory_agent_key ON agent_memory(agent_id, key);
CREATE INDEX IF NOT EXISTS idx_memory_agent ON agent_memory(agent_id);
`;
export class MemoryStore {
    db;
    constructor(dbPath) {
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.db.exec(MEMORY_SCHEMA);
    }
    set(agentId, key, value, ttlMs) {
        const ttl = ttlMs ? Date.now() + ttlMs : null;
        this.db
            .prepare(`INSERT INTO agent_memory (agent_id, key, value, ttl)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(agent_id, key) DO UPDATE SET value = excluded.value, ttl = excluded.ttl, created_at = datetime('now')`)
            .run(agentId, key, value, ttl);
    }
    get(agentId, key) {
        const row = this.db
            .prepare('SELECT value, ttl FROM agent_memory WHERE agent_id = ? AND key = ?')
            .get(agentId, key);
        if (!row)
            return null;
        if (row.ttl && row.ttl < Date.now()) {
            this.delete(agentId, key);
            return null;
        }
        return row.value;
    }
    delete(agentId, key) {
        this.db
            .prepare('DELETE FROM agent_memory WHERE agent_id = ? AND key = ?')
            .run(agentId, key);
    }
    search(agentId, query) {
        const pattern = `%${query}%`;
        return this.db
            .prepare(`SELECT key, value FROM agent_memory
         WHERE agent_id = ? AND (key LIKE ? OR value LIKE ?)
         AND (ttl IS NULL OR ttl > ?)
         ORDER BY created_at DESC LIMIT 50`)
            .all(agentId, pattern, pattern, Date.now());
    }
    keys(agentId) {
        const rows = this.db
            .prepare(`SELECT key FROM agent_memory
         WHERE agent_id = ? AND (ttl IS NULL OR ttl > ?)
         ORDER BY created_at DESC`)
            .all(agentId, Date.now());
        return rows.map((r) => r.key);
    }
    purgeExpired() {
        const result = this.db
            .prepare('DELETE FROM agent_memory WHERE ttl IS NOT NULL AND ttl < ?')
            .run(Date.now());
        return result.changes;
    }
    close() {
        this.db.close();
    }
}
//# sourceMappingURL=MemoryStore.js.map