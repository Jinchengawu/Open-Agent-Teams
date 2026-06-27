/**
 * Kanban Tools — 看板系统操作工具
 *
 * 让 Agent 可以直接操作看板系统，创建/更新/查询任务。
 * 底层直接操作 SQLite，与 Dashboard 共享数据源。
 */
import type { Database } from 'better-sqlite3';
export declare function setKanbanDatabase(db: Database): void;
export declare function createKanbanTools(): (import("@open-multi-agent/core").ToolDefinition<{
    title: string;
    description?: string | undefined;
    tags?: string | undefined;
    assignee?: string | undefined;
    priority?: "low" | "medium" | "high" | "critical" | undefined;
    task_type?: "feature" | "bug" | "refactor" | "test" | "deploy" | "doc" | undefined;
    parent_id?: string | undefined;
    due_date?: string | undefined;
}> | import("@open-multi-agent/core").ToolDefinition<{
    status: "done" | "todo" | "in_progress" | "review" | "blocked";
    task_id: string;
    progress?: number | undefined;
}> | import("@open-multi-agent/core").ToolDefinition<{
    status?: "done" | "todo" | "in_progress" | "review" | "blocked" | undefined;
    assignee?: string | undefined;
    limit?: number | undefined;
}> | import("@open-multi-agent/core").ToolDefinition<{
    assignee: string;
    task_id: string;
}>)[];
//# sourceMappingURL=kanban-tools.d.ts.map