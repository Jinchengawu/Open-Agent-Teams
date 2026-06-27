/**
 * Kanban Tools — 看板系统操作工具
 *
 * 让 Agent 可以直接操作看板系统，创建/更新/查询任务。
 * 底层直接操作 SQLite，与 Dashboard 共享数据源。
 */
import { defineTool } from '@open-multi-agent/core';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
let _db = null;
export function setKanbanDatabase(db) {
    _db = db;
}
function getDb() {
    if (!_db)
        throw new Error('Kanban database not initialized. Call setKanbanDatabase() first.');
    return _db;
}
export function createKanbanTools() {
    return [
        defineTool({
            name: 'create_task',
            description: '在看板系统中创建新任务。用于将工作拆分为可执行的任务项。' +
                '支持指定标题、描述、负责人、优先级、任务类型。',
            inputSchema: z.object({
                title: z.string().describe('任务标题'),
                description: z.string().optional().describe('任务描述'),
                assignee: z.string().optional().describe('负责人 Agent ID（来自当前 Team Profile）'),
                priority: z.enum(['low', 'medium', 'high', 'critical']).optional().describe('优先级'),
                task_type: z.enum(['feature', 'bug', 'refactor', 'test', 'deploy', 'doc']).optional().describe('任务类型'),
                parent_id: z.string().optional().describe('父任务 ID（用于子任务）'),
                tags: z.string().optional().describe('标签（逗号分隔）'),
                due_date: z.string().optional().describe('截止日期（ISO 格式，如 2026-06-30）'),
            }),
            execute: async (input, _context) => {
                try {
                    const db = getDb();
                    const taskId = randomUUID();
                    const stmt = db.prepare(`
            INSERT INTO tasks (id, title, description, status, assignee, priority, task_type, parent_id, tags, due_at)
            VALUES (?, ?, ?, 'todo', ?, ?, ?, ?, ?, ?)
          `);
                    stmt.run(taskId, input.title, input.description || null, input.assignee || null, input.priority || 'medium', input.task_type || 'feature', input.parent_id || null, input.tags || null, input.due_date || null);
                    return {
                        data: JSON.stringify({ taskId, title: input.title, status: 'todo' }),
                        isError: false,
                    };
                }
                catch (err) {
                    return {
                        data: `创建任务失败: ${err instanceof Error ? err.message : String(err)}`,
                        isError: true,
                    };
                }
            },
        }),
        defineTool({
            name: 'update_task_status',
            description: '更新看板任务的状态。用于标记任务进展（todo → in_progress → review → done）。',
            inputSchema: z.object({
                task_id: z.string().describe('任务 ID'),
                status: z.enum(['todo', 'in_progress', 'review', 'done', 'blocked']).describe('新状态'),
                progress: z.number().min(0).max(100).optional().describe('进度百分比（0-100）'),
            }),
            execute: async (input, _context) => {
                try {
                    const db = getDb();
                    const updates = ['status = ?'];
                    const values = [input.status];
                    if (input.progress !== undefined) {
                        updates.push('progress = ?');
                        values.push(input.progress);
                    }
                    if (input.status === 'done') {
                        updates.push('completed_at = datetime(\'now\')');
                    }
                    updates.push('updated_at = datetime(\'now\')');
                    values.push(input.task_id);
                    const sql = `UPDATE tasks SET ${updates.join(', ')} WHERE id = ?`;
                    db.prepare(sql).run(...values);
                    return {
                        data: `任务 ${input.task_id} 状态已更新为 ${input.status}`,
                        isError: false,
                    };
                }
                catch (err) {
                    return {
                        data: `更新任务失败: ${err instanceof Error ? err.message : String(err)}`,
                        isError: true,
                    };
                }
            },
        }),
        defineTool({
            name: 'list_tasks',
            description: '查询看板任务列表。支持按状态、负责人筛选。',
            inputSchema: z.object({
                status: z.enum(['todo', 'in_progress', 'review', 'done', 'blocked']).optional().describe('筛选状态'),
                assignee: z.string().optional().describe('筛选负责人'),
                limit: z.number().default(50).describe('返回数量限制'),
            }),
            execute: async (input, _context) => {
                try {
                    const db = getDb();
                    let sql = 'SELECT * FROM tasks WHERE 1=1';
                    const params = [];
                    if (input.status) {
                        sql += ' AND status = ?';
                        params.push(input.status);
                    }
                    if (input.assignee) {
                        sql += ' AND assignee = ?';
                        params.push(input.assignee);
                    }
                    sql += ' ORDER BY updated_at DESC LIMIT ?';
                    params.push(input.limit ?? 50);
                    const rows = db.prepare(sql).all(...params);
                    const tasks = rows.map((r) => ({
                        id: r.id,
                        title: r.title,
                        status: r.status,
                        assignee: r.assignee,
                        priority: r.priority,
                        progress: r.progress,
                        updated_at: r.updated_at,
                    }));
                    return {
                        data: JSON.stringify(tasks, null, 2),
                        isError: false,
                    };
                }
                catch (err) {
                    return {
                        data: `查询任务失败: ${err instanceof Error ? err.message : String(err)}`,
                        isError: true,
                    };
                }
            },
        }),
        defineTool({
            name: 'assign_task',
            description: '将任务分配给指定 Agent。',
            inputSchema: z.object({
                task_id: z.string().describe('任务 ID'),
                assignee: z.string().describe('负责人 Agent ID'),
            }),
            execute: async (input, _context) => {
                try {
                    const db = getDb();
                    db.prepare('UPDATE tasks SET assignee = ?, updated_at = datetime(\'now\') WHERE id = ?')
                        .run(input.assignee, input.task_id);
                    return {
                        data: `任务 ${input.task_id} 已分配给 ${input.assignee}`,
                        isError: false,
                    };
                }
                catch (err) {
                    return {
                        data: `分配任务失败: ${err instanceof Error ? err.message : String(err)}`,
                        isError: true,
                    };
                }
            },
        }),
    ];
}
//# sourceMappingURL=kanban-tools.js.map