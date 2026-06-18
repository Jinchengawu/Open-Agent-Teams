/**
 * 项目锚定记忆（层1）
 *
 * 为项目提供持久化的文档版本化、CRUD、FTS5 全文搜索、上下文注入能力。
 * 基于 SQLite 实现，与 SessionManager 共享数据库实例。
 */
export class ProjectMemory {
    db;
    constructor(db) {
        this.db = db;
        this.initSchema();
    }
    /** 初始化表结构 */
    initSchema() {
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_memory (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        metadata   TEXT NOT NULL DEFAULT '{}',
        version    INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_project_memory_key ON project_memory(key);

      CREATE TABLE IF NOT EXISTS project_memory_versions (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        memory_id  INTEGER NOT NULL REFERENCES project_memory(id) ON DELETE CASCADE,
        value      TEXT NOT NULL,
        metadata   TEXT NOT NULL DEFAULT '{}',
        version    INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_memory_versions_id ON project_memory_versions(memory_id);
    `);
        // 尝试创建 FTS5 虚拟表（如果 SQLite 支持）
        try {
            this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS project_memory_fts USING fts5(
          key, value, metadata,
          content='project_memory',
          content_rowid='id'
        );
      `);
            // 创建触发器保持 FTS 索引同步
            this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS project_memory_ai AFTER INSERT ON project_memory BEGIN
          INSERT INTO project_memory_fts(rowid, key, value, metadata)
          VALUES (new.id, new.key, new.value, new.metadata);
        END;
        CREATE TRIGGER IF NOT EXISTS project_memory_ad AFTER DELETE ON project_memory BEGIN
          INSERT INTO project_memory_fts(project_memory_fts, rowid, key, value, metadata)
          VALUES ('delete', old.id, old.key, old.value, old.metadata);
        END;
        CREATE TRIGGER IF NOT EXISTS project_memory_au AFTER UPDATE ON project_memory BEGIN
          INSERT INTO project_memory_fts(project_memory_fts, rowid, key, value, metadata)
          VALUES ('delete', old.id, old.key, old.value, old.metadata);
          INSERT INTO project_memory_fts(rowid, key, value, metadata)
          VALUES (new.id, new.key, new.value, new.metadata);
        END;
      `);
            this.ftsAvailable = true;
        }
        catch {
            // FTS5 不可用，降级为 LIKE 查询
            this.ftsAvailable = false;
        }
    }
    ftsAvailable = false;
    /** 存储记忆条目 */
    store(key, value, metadata = {}) {
        const existing = this.get(key);
        const metaStr = JSON.stringify(metadata);
        if (existing) {
            // 保存历史版本
            this.db.prepare(`
        INSERT INTO project_memory_versions (memory_id, value, metadata, version, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(existing.id, existing.value, existing.metadata, existing.version, existing.updated_at);
            // 更新当前版本
            const newVersion = existing.version + 1;
            this.db.prepare(`
        UPDATE project_memory SET value = ?, metadata = ?, version = ?, updated_at = datetime('now')
        WHERE id = ?
      `).run(value, metaStr, newVersion, existing.id);
            return this.get(key);
        }
        // 新增
        const result = this.db.prepare(`
      INSERT INTO project_memory (key, value, metadata) VALUES (?, ?, ?)
    `).run(key, value, metaStr);
        return this.getById(Number(result.lastInsertRowid));
    }
    /** 获取记忆条目（按 key） */
    get(key) {
        return this.db.prepare('SELECT * FROM project_memory WHERE key = ?').get(key) ?? null;
    }
    /** 获取记忆条目（按 id） */
    getById(id) {
        return this.db.prepare('SELECT * FROM project_memory WHERE id = ?').get(id) ?? null;
    }
    /** 查询记忆 */
    query(options) {
        const { key, search, limit = 50, offset = 0 } = options;
        if (search && this.ftsAvailable) {
            // FTS5 全文搜索
            return this.db.prepare(`
        SELECT pm.* FROM project_memory pm
        JOIN project_memory_fts fts ON pm.id = fts.rowid
        WHERE project_memory_fts MATCH ?
        ${key ? 'AND pm.key = ?' : ''}
        ORDER BY rank
        LIMIT ? OFFSET ?
      `).all(...(key ? [search, key, limit, offset] : [search, limit, offset]));
        }
        if (search) {
            // 降级为 LIKE 查询
            const pattern = `%${search}%`;
            return this.db.prepare(`
        SELECT * FROM project_memory
        WHERE (key LIKE ? OR value LIKE ? OR metadata LIKE ?)
        ${key ? 'AND key = ?' : ''}
        ORDER BY updated_at DESC
        LIMIT ? OFFSET ?
      `).all(...(key ? [pattern, pattern, pattern, key, limit, offset] : [pattern, pattern, pattern, limit, offset]));
        }
        // 按 key 查询
        return this.db.prepare(`
      SELECT * FROM project_memory
      ${key ? 'WHERE key = ?' : ''}
      ORDER BY updated_at DESC
      LIMIT ? OFFSET ?
    `).all(...(key ? [key, limit, offset] : [limit, offset]));
    }
    /** 获取历史版本 */
    getVersions(key) {
        const entry = this.get(key);
        if (!entry)
            return [];
        return this.db.prepare(`
      SELECT value, metadata, version, created_at
      FROM project_memory_versions
      WHERE memory_id = ?
      ORDER BY version ASC
    `).all(entry.id);
    }
    /** 删除记忆条目 */
    delete(key) {
        const result = this.db.prepare('DELETE FROM project_memory WHERE key = ?').run(key);
        return result.changes > 0;
    }
    /** 获取条目数量 */
    count() {
        const row = this.db.prepare('SELECT COUNT(*) as count FROM project_memory').get();
        return row.count;
    }
    /** 构建上下文注入文本（用于 Agent 提示词） */
    buildContext(keys) {
        let entries;
        if (keys && keys.length > 0) {
            entries = keys.map(k => this.get(k)).filter(Boolean);
        }
        else {
            entries = this.query({ limit: 20 });
        }
        if (entries.length === 0)
            return '';
        const lines = entries.map(e => {
            const meta = e.metadata !== '{}' ? ` (${e.metadata})` : '';
            return `- [${e.key}]${meta}: ${e.value}`;
        });
        return `## 项目记忆\n\n${lines.join('\n')}`;
    }
}
//# sourceMappingURL=project-memory.js.map