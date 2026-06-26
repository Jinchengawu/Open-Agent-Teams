/**
 * KnowledgeCenter — 跨 Agent 共享知识中心
 *
 * 提供文档存储、全文检索、语义搜索能力。
 * 所有 Agent 共享同一知识库，Pipeline 产物自动沉淀。
 *
 * 存储后端：SQLite + FTS5（全文检索）
 * 语义搜索：基于关键词频率的简单向量相似度（不依赖外部 embedding 服务）
 */
import Database from 'better-sqlite3';
import { join } from 'node:path';
// ============================================================================
// 知识中心
// ============================================================================
export class KnowledgeCenter {
    db;
    maxResults;
    constructor(config = {}) {
        const dbPath = config.dbPath || join(process.cwd(), 'data', 'knowledge.db');
        this.maxResults = config.maxResults || 20;
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.initSchema();
    }
    // ── 初始化表结构 ──
    initSchema() {
        // 主文档表
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'general',
        source TEXT NOT NULL DEFAULT '',
        tags TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT DEFAULT '{}'
      )
    `);
        // FTS5 虚拟表（全文检索）
        this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
        id,
        title,
        content,
        content_rowid=id
      )
    `);
        // 标签索引表
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS document_tags (
        doc_id TEXT NOT NULL,
        tag TEXT NOT NULL,
        PRIMARY KEY (doc_id, tag)
      )
    `);
        // 触发器：同步 FTS 索引
        this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS documents_fts_insert AFTER INSERT ON documents BEGIN
        INSERT INTO documents_fts(id, title, content) VALUES (new.id, new.title, new.content);
      END
    `);
        this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS documents_fts_delete AFTER DELETE ON documents BEGIN
        DELETE FROM documents_fts WHERE id = old.id;
      END
    `);
        this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS documents_fts_update AFTER UPDATE ON documents BEGIN
        DELETE FROM documents_fts WHERE id = old.id;
        INSERT INTO documents_fts(id, title, content) VALUES (new.id, new.title, new.content);
      END
    `);
    }
    // ============================================================================
    // 文档操作
    // ============================================================================
    /**
     * 添加文档到知识中心
     */
    addDocument(doc) {
        const id = doc.id || `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const now = Date.now();
        const fullDoc = {
            ...doc,
            id,
            createdAt: now,
            updatedAt: now,
        };
        const stmt = this.db.prepare(`
      INSERT INTO documents (id, title, content, type, source, tags, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
        stmt.run(id, fullDoc.title, fullDoc.content, fullDoc.type, fullDoc.source, JSON.stringify(fullDoc.tags), fullDoc.createdAt, fullDoc.updatedAt, JSON.stringify(fullDoc.metadata || {}));
        // 添加标签索引
        if (fullDoc.tags.length > 0) {
            const tagStmt = this.db.prepare('INSERT OR IGNORE INTO document_tags (doc_id, tag) VALUES (?, ?)');
            for (const tag of fullDoc.tags) {
                tagStmt.run(id, tag);
            }
        }
        return fullDoc;
    }
    /**
     * 更新文档
     */
    updateDocument(id, updates) {
        const existing = this.getDocument(id);
        if (!existing)
            return null;
        const updated = {
            ...existing,
            ...updates,
            updatedAt: Date.now(),
        };
        const stmt = this.db.prepare(`
      UPDATE documents SET
        title = COALESCE(?, title),
        content = COALESCE(?, content),
        type = COALESCE(?, type),
        source = COALESCE(?, source),
        tags = COALESCE(?, tags),
        updated_at = ?,
        metadata = COALESCE(?, metadata)
      WHERE id = ?
    `);
        stmt.run(updates.title ?? null, updates.content ?? null, updates.type ?? null, updates.source ?? null, updates.tags ? JSON.stringify(updates.tags) : null, updated.updatedAt, updates.metadata ? JSON.stringify(updates.metadata) : null, id);
        // 更新标签索引
        if (updates.tags) {
            this.db.prepare('DELETE FROM document_tags WHERE doc_id = ?').run(id);
            const tagStmt = this.db.prepare('INSERT OR IGNORE INTO document_tags (doc_id, tag) VALUES (?, ?)');
            for (const tag of updates.tags) {
                tagStmt.run(id, tag);
            }
        }
        return updated;
    }
    /**
     * 获取单个文档
     */
    getDocument(id) {
        const row = this.db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
        if (!row)
            return null;
        return this.rowToDocument(row);
    }
    /**
     * 删除文档
     */
    deleteDocument(id) {
        const result = this.db.prepare('DELETE FROM documents WHERE id = ?').run(id);
        this.db.prepare('DELETE FROM document_tags WHERE doc_id = ?').run(id);
        return result.changes > 0;
    }
    /**
     * 列出所有文档（支持分页）
     */
    listDocuments(options) {
        let sql = 'SELECT * FROM documents WHERE 1=1';
        const params = [];
        if (options?.type) {
            sql += ' AND type = ?';
            params.push(options.type);
        }
        if (options?.source) {
            sql += ' AND source = ?';
            params.push(options.source);
        }
        sql += ' ORDER BY updated_at DESC LIMIT ? OFFSET ?';
        params.push(options?.limit ?? 50, options?.offset ?? 0);
        const rows = this.db.prepare(sql).all(...params);
        return rows.map((r) => this.rowToDocument(r));
    }
    // ============================================================================
    // 搜索
    // ============================================================================
    /**
     * 综合搜索：FTS + 语义 + 标签
     */
    search(query) {
        const results = new Map();
        // 1. FTS 全文搜索
        if (query.q) {
            const ftsResults = this.searchFTS(query.q);
            for (const r of ftsResults) {
                results.set(r.document.id, r);
            }
        }
        // 2. 语义搜索（关键词频率匹配）
        if (query.semantic && query.q) {
            const semanticResults = this.searchSemantic(query.q);
            for (const r of semanticResults) {
                const existing = results.get(r.document.id);
                if (existing) {
                    existing.score = Math.max(existing.score, r.score);
                }
                else {
                    results.set(r.document.id, r);
                }
            }
        }
        // 3. 标签搜索
        if (query.tags && query.tags.length > 0) {
            const tagResults = this.searchByTags(query.tags);
            for (const r of tagResults) {
                const existing = results.get(r.document.id);
                if (existing) {
                    existing.score = Math.max(existing.score, r.score);
                }
                else {
                    results.set(r.document.id, r);
                }
            }
        }
        // 4. 来源过滤
        if (query.source) {
            const sourceResults = this.searchBySource(query.source);
            for (const r of sourceResults) {
                const existing = results.get(r.document.id);
                if (existing) {
                    existing.score = Math.max(existing.score, r.score);
                }
                else {
                    results.set(r.document.id, r);
                }
            }
        }
        // 5. 类型过滤
        let filtered = Array.from(results.values());
        if (query.type) {
            filtered = filtered.filter((r) => r.document.type === query.type);
        }
        // 按分数排序，返回前 N 个
        filtered.sort((a, b) => b.score - a.score);
        return filtered.slice(0, query.limit ?? this.maxResults);
    }
    /**
     * 自然语言查询（带上下文摘要）
     */
    async query(question, options) {
        const results = this.search({ q: question, semantic: true, limit: options?.limit ?? 5 });
        if (results.length === 0) {
            return { answer: '知识库中未找到相关内容。', sources: [] };
        }
        // 构建上下文摘要
        const context = results
            .map((r, i) => `【参考 ${i + 1}】${r.document.title}\n${r.document.content.substring(0, 500)}`)
            .join('\n\n');
        const answer = `根据知识库中的 ${results.length} 份文档，相关内容如下：\n\n${context}`;
        return { answer, sources: results };
    }
    // ============================================================================
    // 内部搜索方法
    // ============================================================================
    /**
     * FTS5 全文搜索
     */
    searchFTS(query) {
        try {
            // 清理查询：去除非法字符，支持中文和英文
            const cleanQuery = query.replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ').trim();
            if (!cleanQuery)
                return [];
            // 将查询拆分为关键词，用 OR 连接
            const keywords = cleanQuery.split(/\s+/).filter((k) => k.length > 0);
            const ftsQuery = keywords.join(' OR ');
            const rows = this.db.prepare(`
        SELECT d.*, rank FROM documents_fts
        JOIN documents d ON documents_fts.id = d.id
        WHERE documents_fts MATCH ?
        ORDER BY rank
        LIMIT ?
      `).all(ftsQuery, this.maxResults);
            return rows.map((row) => ({
                document: this.rowToDocument(row),
                score: this.normalizeScore(row.rank || 0),
                matchType: 'fts',
            }));
        }
        catch (error) {
            console.warn('[KnowledgeCenter] FTS 搜索失败:', error);
            return [];
        }
    }
    /**
     * 语义搜索：基于关键词频率的简单向量相似度
     */
    searchSemantic(query) {
        const queryKeywords = this.extractKeywords(query);
        if (queryKeywords.size === 0)
            return [];
        const docs = this.listDocuments({ limit: 100 });
        const results = [];
        for (const doc of docs) {
            const docKeywords = this.extractKeywords(doc.title + ' ' + doc.content);
            const similarity = this.cosineSimilarity(queryKeywords, docKeywords);
            if (similarity > 0.1) {
                results.push({
                    document: doc,
                    score: similarity,
                    matchType: 'semantic',
                });
            }
        }
        return results.sort((a, b) => b.score - a.score).slice(0, this.maxResults);
    }
    /**
     * 标签搜索
     */
    searchByTags(tags) {
        const placeholders = tags.map(() => '?').join(',');
        const rows = this.db.prepare(`
      SELECT d.* FROM documents d
      JOIN document_tags dt ON d.id = dt.doc_id
      WHERE dt.tag IN (${placeholders})
      GROUP BY d.id
      ORDER BY COUNT(dt.tag) DESC
      LIMIT ?
    `).all(...tags, this.maxResults);
        return rows.map((row) => ({
            document: this.rowToDocument(row),
            score: 0.8, // 标签匹配的固定分数
            matchType: 'tag',
        }));
    }
    /**
     * 来源搜索
     */
    searchBySource(source) {
        const rows = this.db.prepare(`
      SELECT * FROM documents WHERE source = ? ORDER BY updated_at DESC LIMIT ?
    `).all(source, this.maxResults);
        return rows.map((row) => ({
            document: this.rowToDocument(row),
            score: 0.7, // 来源匹配的固定分数
            matchType: 'source',
        }));
    }
    // ============================================================================
    // 辅助方法
    // ============================================================================
    /**
     * 提取关键词（简单的分词）
     */
    extractKeywords(text) {
        const keywords = new Map();
        // 中文：按字符分词（每个汉字作为一个词）
        const chineseChars = text.match(/[\u4e00-\u9fa5]/g) || [];
        for (const char of chineseChars) {
            keywords.set(char, (keywords.get(char) || 0) + 1);
        }
        // 英文：按单词分词
        const words = text.toLowerCase().match(/[a-z]{2,}/g) || [];
        for (const word of words) {
            keywords.set(word, (keywords.get(word) || 0) + 1);
        }
        return keywords;
    }
    /**
     * 余弦相似度计算
     */
    cosineSimilarity(a, b) {
        const allKeys = new Set([...a.keys(), ...b.keys()]);
        let dotProduct = 0;
        let normA = 0;
        let normB = 0;
        for (const key of allKeys) {
            const va = a.get(key) || 0;
            const vb = b.get(key) || 0;
            dotProduct += va * vb;
            normA += va * va;
            normB += vb * vb;
        }
        if (normA === 0 || normB === 0)
            return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
    /**
     * 归一化 FTS 分数到 0-1
     */
    normalizeScore(rank) {
        // FTS rank 越小越好，转换为 0-1 分数
        const raw = Math.abs(rank);
        if (raw === 0)
            return 1.0;
        return Math.min(1.0, 1.0 / (1.0 + Math.log(1 + raw)));
    }
    /**
     * 数据库行转文档对象
     */
    rowToDocument(row) {
        return {
            id: row.id,
            title: row.title,
            content: row.content,
            type: row.type,
            source: row.source,
            tags: row.tags ? JSON.parse(row.tags) : [],
            createdAt: row.created_at,
            updatedAt: row.updated_at,
            metadata: row.metadata ? JSON.parse(row.metadata) : {},
        };
    }
    // ============================================================================
    // 统计和维护
    // ============================================================================
    /**
     * 统计信息
     */
    stats() {
        const total = this.db.prepare('SELECT COUNT(*) as count FROM documents').get().count;
        const typeRows = this.db.prepare('SELECT type, COUNT(*) as count FROM documents GROUP BY type').all();
        const types = {};
        for (const row of typeRows) {
            types[row.type] = row.count;
        }
        const sourceRows = this.db.prepare('SELECT source, COUNT(*) as count FROM documents GROUP BY source').all();
        const sources = {};
        for (const row of sourceRows) {
            sources[row.source] = row.count;
        }
        return { total, types, sources };
    }
    /**
     * 关闭数据库连接
     */
    close() {
        this.db.close();
    }
}
// ============================================================================
// 便捷工厂
// ============================================================================
let globalKnowledgeCenter = null;
export function getGlobalKnowledgeCenter(config) {
    if (!globalKnowledgeCenter) {
        globalKnowledgeCenter = new KnowledgeCenter(config);
    }
    return globalKnowledgeCenter;
}
export function resetGlobalKnowledgeCenter() {
    globalKnowledgeCenter?.close();
    globalKnowledgeCenter = null;
}
export function createKnowledgeCenter(config) {
    return new KnowledgeCenter(config);
}
//# sourceMappingURL=KnowledgeCenter.js.map