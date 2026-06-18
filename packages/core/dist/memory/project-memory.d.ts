/**
 * 项目锚定记忆（层1）
 *
 * 为项目提供持久化的文档版本化、CRUD、FTS5 全文搜索、上下文注入能力。
 * 基于 SQLite 实现，与 SessionManager 共享数据库实例。
 */
import type Database from 'better-sqlite3';
export interface MemoryEntry {
    id: number;
    key: string;
    value: string;
    metadata: string;
    version: number;
    created_at: string;
    updated_at: string;
}
export interface MemoryQuery {
    key?: string;
    search?: string;
    limit?: number;
    offset?: number;
}
export declare class ProjectMemory {
    private db;
    constructor(db: Database.Database);
    /** 初始化表结构 */
    private initSchema;
    private ftsAvailable;
    /** 存储记忆条目 */
    store(key: string, value: string, metadata?: Record<string, unknown>): MemoryEntry;
    /** 获取记忆条目（按 key） */
    get(key: string): MemoryEntry | null;
    /** 获取记忆条目（按 id） */
    getById(id: number): MemoryEntry | null;
    /** 查询记忆 */
    query(options: MemoryQuery): MemoryEntry[];
    /** 获取历史版本 */
    getVersions(key: string): Array<{
        value: string;
        metadata: string;
        version: number;
        created_at: string;
    }>;
    /** 删除记忆条目 */
    delete(key: string): boolean;
    /** 获取条目数量 */
    count(): number;
    /** 构建上下文注入文本（用于 Agent 提示词） */
    buildContext(keys?: string[]): string;
}
//# sourceMappingURL=project-memory.d.ts.map