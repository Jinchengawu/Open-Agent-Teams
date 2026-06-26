/**
 * DocumentManager — 增强版文档管理中心
 *
 * 在 KnowledgeCenter 基础上扩展：
 * - 项目/类型/任务分类归档
 * - 时间排序
 * - 文档关联（任务看板、Agent 个体）
 * - 评论系统（多 Agent 迭代）
 * - 文档追踪（作者、版本历史）
 */
import Database from 'better-sqlite3';
import { join } from 'node:path';
import { eventBus } from '../event/EventBus.js';
// ============================================================================
// DocumentManager
// ============================================================================
export class DocumentManager {
    db;
    maxResults;
    constructor(config = {}) {
        const dbPath = config.dbPath || join(process.cwd(), 'data', 'documents.db');
        this.maxResults = config.maxResults || 50;
        this.db = new Database(dbPath);
        this.db.pragma('journal_mode = WAL');
        this.initSchema();
    }
    // ── 初始化表结构 ──
    initSchema() {
        // 项目表
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
        // 任务表（与看板关联）
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'todo',
        assignee TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
        // 文档主表（增强版）
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents_v2 (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'general',
        project_id TEXT,
        task_id TEXT,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        parent_id TEXT,
        tags TEXT NOT NULL DEFAULT '[]',
        related_doc_ids TEXT NOT NULL DEFAULT '[]',
        related_task_ids TEXT NOT NULL DEFAULT '[]',
        related_agent_ids TEXT NOT NULL DEFAULT '[]',
        comment_count INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        metadata TEXT DEFAULT '{}'
      )
    `);
        // 文档评论表
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS document_comments (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        author_id TEXT NOT NULL,
        author_name TEXT NOT NULL,
        content TEXT NOT NULL,
        parent_id TEXT,
        resolved INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `);
        // 文档版本历史表
        this.db.exec(`
      CREATE TABLE IF NOT EXISTS document_versions (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        author_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      )
    `);
        // FTS5 虚拟表（全文检索）
        this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS documents_v2_fts USING fts5(
        id,
        title,
        content,
        content_rowid=id
      )
    `);
        // 触发器：同步 FTS 索引
        this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS documents_v2_fts_insert AFTER INSERT ON documents_v2 BEGIN
        INSERT INTO documents_v2_fts(id, title, content) VALUES (new.id, new.title, new.content);
      END
    `);
        this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS documents_v2_fts_delete AFTER DELETE ON documents_v2 BEGIN
        DELETE FROM documents_v2_fts WHERE id = old.id;
      END
    `);
        this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS documents_v2_fts_update AFTER UPDATE ON documents_v2 BEGIN
        DELETE FROM documents_v2_fts WHERE id = old.id;
        INSERT INTO documents_v2_fts(id, title, content) VALUES (new.id, new.title, new.content);
      END
    `);
        // 索引
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_docs_v2_project ON documents_v2(project_id)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_docs_v2_task ON documents_v2(task_id)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_docs_v2_author ON documents_v2(author_id)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_docs_v2_type ON documents_v2(type)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_docs_v2_updated ON documents_v2(updated_at DESC)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_comments_doc ON document_comments(document_id)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_versions_doc ON document_versions(document_id)`);
    }
    // ============================================================================
    // 项目操作
    // ============================================================================
    createProject(name, description) {
        const id = `proj-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const now = Date.now();
        const project = { id, name, description: description || '', createdAt: now, updatedAt: now };
        this.db.prepare(`
      INSERT INTO projects (id, name, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(id, name, project.description, now, now);
        return project;
    }
    getProject(id) {
        const row = this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
        if (!row)
            return null;
        return this.rowToProject(row);
    }
    listProjects() {
        const rows = this.db.prepare('SELECT * FROM projects ORDER BY updated_at DESC').all();
        return rows.map(r => this.rowToProject(r));
    }
    // ============================================================================
    // 任务操作
    // ============================================================================
    createTask(projectId, title, description, assignee) {
        const id = `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const now = Date.now();
        const task = { id, projectId, title, description: description || '', status: 'todo', assignee: assignee || '', createdAt: now, updatedAt: now };
        this.db.prepare(`
      INSERT INTO tasks (id, project_id, title, description, status, assignee, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, projectId, title, task.description, 'todo', assignee || '', now, now);
        return task;
    }
    getTask(id) {
        const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
        if (!row)
            return null;
        return this.rowToTask(row);
    }
    listTasks(projectId) {
        let sql = 'SELECT * FROM tasks';
        const params = [];
        if (projectId) {
            sql += ' WHERE project_id = ?';
            params.push(projectId);
        }
        sql += ' ORDER BY updated_at DESC';
        const rows = this.db.prepare(sql).all(...params);
        return rows.map(r => this.rowToTask(r));
    }
    listTasksByAssignee(assignee) {
        const rows = this.db.prepare('SELECT * FROM tasks WHERE assignee = ? ORDER BY updated_at DESC').all(assignee);
        return rows.map(r => this.rowToTask(r));
    }
    updateTaskStatus(id, status) {
        const now = Date.now();
        this.db.prepare(`
      UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?
    `).run(status, now, id);
        return this.getTask(id);
    }
    // ============================================================================
    // 文档操作
    // ============================================================================
    createDocument(doc) {
        const id = `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const now = Date.now();
        const fullDoc = {
            ...doc,
            id,
            version: 1,
            commentCount: 0,
            createdAt: now,
            updatedAt: now,
        };
        this.db.prepare(`
      INSERT INTO documents_v2 (id, title, content, type, project_id, task_id, author_id, author_name,
        version, parent_id, tags, related_doc_ids, related_task_ids, related_agent_ids,
        comment_count, created_at, updated_at, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, fullDoc.title, fullDoc.content, fullDoc.type, fullDoc.projectId || null, fullDoc.taskId || null, fullDoc.authorId, fullDoc.authorName, fullDoc.version, fullDoc.parentId || null, JSON.stringify(fullDoc.tags), JSON.stringify(fullDoc.relatedDocIds), JSON.stringify(fullDoc.relatedTaskIds), JSON.stringify(fullDoc.relatedAgentIds), fullDoc.commentCount, fullDoc.createdAt, fullDoc.updatedAt, JSON.stringify(fullDoc.metadata));
        eventBus.emit({
            type: 'document.created',
            source: 'document',
            timestamp: now,
            payload: {
                documentId: fullDoc.id,
                projectId: fullDoc.projectId,
                taskId: fullDoc.taskId,
                type: fullDoc.type,
                title: fullDoc.title,
                tags: fullDoc.tags,
                relatedTaskIds: fullDoc.relatedTaskIds,
                relatedDocIds: fullDoc.relatedDocIds,
                metadata: fullDoc.metadata,
            },
        });
        return fullDoc;
    }
    getDocument(id) {
        const row = this.db.prepare('SELECT * FROM documents_v2 WHERE id = ?').get(id);
        if (!row)
            return null;
        return this.rowToDocument(row);
    }
    updateDocument(id, updates, authorId, authorName) {
        const existing = this.getDocument(id);
        if (!existing)
            return null;
        // 保存版本历史
        const newVersion = existing.version + 1;
        this.db.prepare(`
      INSERT INTO document_versions (id, document_id, version, title, content, author_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(`ver-${Date.now()}`, id, existing.version, existing.title, existing.content, authorId || existing.authorId, Date.now());
        const updated = {
            ...existing,
            ...updates,
            version: newVersion,
            updatedAt: Date.now(),
        };
        this.db.prepare(`
      UPDATE documents_v2 SET
        title = COALESCE(?, title),
        content = COALESCE(?, content),
        type = COALESCE(?, type),
        project_id = COALESCE(?, project_id),
        task_id = COALESCE(?, task_id),
        author_id = ?,
        author_name = COALESCE(?, author_name),
        version = ?,
        parent_id = COALESCE(?, parent_id),
        tags = COALESCE(?, tags),
        related_doc_ids = COALESCE(?, related_doc_ids),
        related_task_ids = COALESCE(?, related_task_ids),
        related_agent_ids = COALESCE(?, related_agent_ids),
        updated_at = ?,
        metadata = COALESCE(?, metadata)
      WHERE id = ?
    `).run(updates.title ?? null, updates.content ?? null, updates.type ?? null, updates.projectId ?? null, updates.taskId ?? null, authorId || existing.authorId, authorName || existing.authorName, newVersion, updates.parentId ?? null, updates.tags ? JSON.stringify(updates.tags) : null, updates.relatedDocIds ? JSON.stringify(updates.relatedDocIds) : null, updates.relatedTaskIds ? JSON.stringify(updates.relatedTaskIds) : null, updates.relatedAgentIds ? JSON.stringify(updates.relatedAgentIds) : null, updated.updatedAt, updates.metadata ? JSON.stringify(updates.metadata) : null, id);
        return updated;
    }
    deleteDocument(id) {
        const result = this.db.prepare('DELETE FROM documents_v2 WHERE id = ?').run(id);
        this.db.prepare('DELETE FROM document_comments WHERE document_id = ?').run(id);
        this.db.prepare('DELETE FROM document_versions WHERE document_id = ?').run(id);
        return result.changes > 0;
    }
    // ============================================================================
    // 文档查询（支持多维度过滤）
    // ============================================================================
    queryDocuments(query) {
        const conditions = ['1=1'];
        const params = [];
        if (query.projectId) {
            conditions.push('project_id = ?');
            params.push(query.projectId);
        }
        if (query.taskId) {
            conditions.push('task_id = ?');
            params.push(query.taskId);
        }
        if (query.type) {
            conditions.push('type = ?');
            params.push(query.type);
        }
        if (query.authorId) {
            conditions.push('author_id = ?');
            params.push(query.authorId);
        }
        const whereClause = conditions.join(' AND ');
        const sortColumn = query.sortBy === 'title' ? 'title' : (query.sortBy === 'createdAt' ? 'created_at' : 'updated_at');
        const sortOrder = query.sortOrder === 'asc' ? 'ASC' : 'DESC';
        // 总数
        const totalRow = this.db.prepare(`SELECT COUNT(*) as count FROM documents_v2 WHERE ${whereClause}`).get(...params);
        const total = totalRow.count;
        // 分页查询
        const limit = query.limit ?? this.maxResults;
        const offset = query.offset ?? 0;
        const sql = `SELECT * FROM documents_v2 WHERE ${whereClause} ORDER BY ${sortColumn} ${sortOrder} LIMIT ? OFFSET ?`;
        const rows = this.db.prepare(sql).all(...params, limit, offset);
        return { documents: rows.map(r => this.rowToDocument(r)), total };
    }
    /**
     * 全文搜索
     */
    searchDocuments(keyword, options) {
        const cleanQuery = keyword.replace(/[^\u4e00-\u9fa5a-zA-Z0-9\s]/g, ' ').trim();
        if (!cleanQuery)
            return [];
        const keywords = cleanQuery.split(/\s+/).filter(k => k.length > 0);
        const ftsQuery = keywords.join(' OR ');
        let sql = `
      SELECT d.* FROM documents_v2_fts
      JOIN documents_v2 d ON documents_v2_fts.id = d.id
      WHERE documents_v2_fts MATCH ?
    `;
        const params = [ftsQuery];
        if (options?.projectId) {
            sql += ' AND d.project_id = ?';
            params.push(options.projectId);
        }
        if (options?.taskId) {
            sql += ' AND d.task_id = ?';
            params.push(options.taskId);
        }
        if (options?.type) {
            sql += ' AND d.type = ?';
            params.push(options.type);
        }
        sql += ' ORDER BY rank LIMIT ?';
        params.push(options?.limit ?? this.maxResults);
        const rows = this.db.prepare(sql).all(...params);
        return rows.map(r => this.rowToDocument(r));
    }
    /**
     * 获取 Agent 最近活动（文档 + 评论 + 任务）
     */
    getAgentActivities(agentId, limit = 5) {
        const activities = [];
        // 1. 文档创建
        const docs = this.db.prepare(`
      SELECT title, type, created_at FROM documents_v2
      WHERE author_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(agentId, limit);
        for (const doc of docs) {
            const typeMap = {
                prd: 'document', tech_spec: 'document', meeting: 'meeting',
                report: 'document', task: 'task', general: 'document',
                review: 'code', code_review: 'code',
            };
            activities.push({
                action: `创建文档: ${doc.title}`,
                time: this.timeAgo(doc.created_at),
                type: typeMap[doc.type] || 'document',
                timestamp: doc.created_at,
            });
        }
        // 2. 评论
        const comments = this.db.prepare(`
      SELECT c.content, c.created_at, d.title as doc_title
      FROM document_comments c
      JOIN documents_v2 d ON c.document_id = d.id
      WHERE c.author_id = ? ORDER BY c.created_at DESC LIMIT ?
    `).all(agentId, limit);
        for (const c of comments) {
            activities.push({
                action: `评论文档: ${c.doc_title}`,
                time: this.timeAgo(c.created_at),
                type: 'comment',
                details: c.content.substring(0, 50),
                timestamp: c.created_at,
            });
        }
        // 3. 任务分配
        const tasks = this.db.prepare(`
      SELECT title, status, updated_at FROM tasks
      WHERE assignee = ? ORDER BY updated_at DESC LIMIT ?
    `).all(agentId, limit);
        for (const task of tasks) {
            const statusMap = {
                todo: '待处理', in_progress: '进行中', review: '审核中', done: '已完成',
            };
            activities.push({
                action: `任务 ${statusMap[task.status] || task.status}: ${task.title}`,
                time: this.timeAgo(task.updated_at),
                type: 'task',
                timestamp: task.updated_at,
            });
        }
        // 按时间排序，取 limit 条
        activities.sort((a, b) => b.timestamp - a.timestamp);
        return activities.slice(0, limit).map(({ timestamp, ...rest }) => rest);
    }
    timeAgo(timestamp) {
        const now = Date.now();
        const diff = now - timestamp;
        const minutes = Math.floor(diff / 60000);
        const hours = Math.floor(diff / 3600000);
        const days = Math.floor(diff / 86400000);
        if (minutes < 1)
            return '刚刚';
        if (minutes < 60)
            return `${minutes}分钟前`;
        if (hours < 24)
            return `${hours}小时前`;
        if (days < 7)
            return `${days}天前`;
        return new Date(timestamp).toLocaleDateString('zh-CN');
    }
    /**
     * 获取 Agent 产出的所有文档（供其他 Agent 查看）
     */
    getDocumentsByAgent(agentId, options) {
        let sql = 'SELECT * FROM documents_v2 WHERE author_id = ? OR related_agent_ids LIKE ?';
        const params = [agentId, `%${agentId}%`];
        if (options?.projectId) {
            sql += ' AND project_id = ?';
            params.push(options.projectId);
        }
        if (options?.type) {
            sql += ' AND type = ?';
            params.push(options.type);
        }
        sql += ' ORDER BY updated_at DESC LIMIT ?';
        params.push(this.maxResults);
        const rows = this.db.prepare(sql).all(...params);
        return rows.map(r => this.rowToDocument(r));
    }
    /**
     * 获取与某任务关联的所有文档
     */
    getDocumentsByTask(taskId) {
        const rows = this.db.prepare(`
      SELECT * FROM documents_v2 WHERE task_id = ? OR related_task_ids LIKE ?
      ORDER BY updated_at DESC
    `).all(taskId, `%${taskId}%`);
        return rows.map(r => this.rowToDocument(r));
    }
    /**
     * 获取某项目的所有文档（按类型分组）
     */
    getDocumentsByProject(projectId) {
        const rows = this.db.prepare(`
      SELECT * FROM documents_v2 WHERE project_id = ? ORDER BY type, updated_at DESC
    `).all(projectId);
        const docs = rows.map(r => this.rowToDocument(r));
        const grouped = new Map();
        for (const doc of docs) {
            const list = grouped.get(doc.type) || [];
            list.push(doc);
            grouped.set(doc.type, list);
        }
        return Array.from(grouped.entries()).map(([type, documents]) => ({ type, documents }));
    }
    // ============================================================================
    // 评论系统
    // ============================================================================
    addComment(comment) {
        const id = `comment-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const now = Date.now();
        const fullComment = { ...comment, id, createdAt: now };
        this.db.prepare(`
      INSERT INTO document_comments (id, document_id, author_id, author_name, content, parent_id, resolved, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, comment.documentId, comment.authorId, comment.authorName, comment.content, comment.parentId || null, comment.resolved ? 1 : 0, now);
        // 更新文档评论计数
        this.db.prepare(`
      UPDATE documents_v2 SET comment_count = (
        SELECT COUNT(*) FROM document_comments WHERE document_id = ?
      ) WHERE id = ?
    `).run(comment.documentId, comment.documentId);
        return fullComment;
    }
    getComments(documentId) {
        const rows = this.db.prepare(`
      SELECT * FROM document_comments WHERE document_id = ? ORDER BY created_at ASC
    `).all(documentId);
        return rows.map(r => this.rowToComment(r));
    }
    resolveComment(commentId) {
        const result = this.db.prepare(`
      UPDATE document_comments SET resolved = 1 WHERE id = ?
    `).run(commentId);
        return result.changes > 0;
    }
    deleteComment(commentId) {
        const result = this.db.prepare('DELETE FROM document_comments WHERE id = ?').run(commentId);
        return result.changes > 0;
    }
    // ============================================================================
    // 版本历史
    // ============================================================================
    getVersions(documentId) {
        const rows = this.db.prepare(`
      SELECT id, version, title, author_id, created_at FROM document_versions
      WHERE document_id = ? ORDER BY version DESC
    `).all(documentId);
        return rows.map(r => ({
            id: r.id, version: r.version, title: r.title,
            authorId: r.author_id, createdAt: r.created_at,
        }));
    }
    // ============================================================================
    // 统计
    // ============================================================================
    stats() {
        const totalDocuments = this.db.prepare('SELECT COUNT(*) as count FROM documents_v2').get().count;
        const totalProjects = this.db.prepare('SELECT COUNT(*) as count FROM projects').get().count;
        const totalTasks = this.db.prepare('SELECT COUNT(*) as count FROM tasks').get().count;
        const totalComments = this.db.prepare('SELECT COUNT(*) as count FROM document_comments').get().count;
        const typeRows = this.db.prepare('SELECT type, COUNT(*) as count FROM documents_v2 GROUP BY type').all();
        const typeDistribution = {};
        for (const row of typeRows)
            typeDistribution[row.type] = row.count;
        const authorRows = this.db.prepare('SELECT author_id, COUNT(*) as count FROM documents_v2 GROUP BY author_id').all();
        const authorDistribution = {};
        for (const row of authorRows)
            authorDistribution[row.author_id] = row.count;
        const recentRows = this.db.prepare('SELECT * FROM documents_v2 ORDER BY updated_at DESC LIMIT 5').all();
        return {
            totalDocuments, totalProjects, totalTasks, totalComments,
            typeDistribution, authorDistribution,
            recentDocuments: recentRows.map(r => this.rowToDocument(r)),
        };
    }
    // ============================================================================
    // 辅助方法
    // ============================================================================
    rowToProject(row) {
        return { id: row.id, name: row.name, description: row.description, createdAt: row.created_at, updatedAt: row.updated_at };
    }
    rowToTask(row) {
        return {
            id: row.id, projectId: row.project_id, title: row.title, description: row.description,
            status: row.status, assignee: row.assignee, createdAt: row.created_at, updatedAt: row.updated_at,
        };
    }
    rowToDocument(row) {
        return {
            id: row.id, title: row.title, content: row.content, type: row.type,
            projectId: row.project_id, taskId: row.task_id,
            authorId: row.author_id, authorName: row.author_name,
            version: row.version, parentId: row.parent_id,
            tags: row.tags ? JSON.parse(row.tags) : [],
            relatedDocIds: row.related_doc_ids ? JSON.parse(row.related_doc_ids) : [],
            relatedTaskIds: row.related_task_ids ? JSON.parse(row.related_task_ids) : [],
            relatedAgentIds: row.related_agent_ids ? JSON.parse(row.related_agent_ids) : [],
            commentCount: row.comment_count,
            createdAt: row.created_at, updatedAt: row.updated_at,
            metadata: row.metadata ? JSON.parse(row.metadata) : {},
        };
    }
    rowToComment(row) {
        return {
            id: row.id, documentId: row.document_id, authorId: row.author_id, authorName: row.author_name,
            content: row.content, parentId: row.parent_id, resolved: !!row.resolved, createdAt: row.created_at,
        };
    }
    close() {
        this.db.close();
    }
}
// ============================================================================
// 便捷工厂
// ============================================================================
let globalDocumentManager = null;
export function getGlobalDocumentManager(config) {
    if (!globalDocumentManager) {
        globalDocumentManager = new DocumentManager(config);
    }
    return globalDocumentManager;
}
export function resetGlobalDocumentManager() {
    globalDocumentManager?.close();
    globalDocumentManager = null;
}
export function createDocumentManager(config) {
    return new DocumentManager(config);
}
//# sourceMappingURL=DocumentManager.js.map