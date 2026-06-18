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
    state: string;
    created_at: string;
}
export declare class RollbackManager {
    private db;
    constructor(db: Database.Database);
    private initSchema;
    /** 保存快照 */
    saveSnapshot(sessionId: string, step: number, description: string, state: unknown): number;
    /** 获取快照 */
    getSnapshot(sessionId: string, step: number): SessionSnapshot | null;
    /** 获取最新快照 */
    getLatestSnapshot(sessionId: string): SessionSnapshot | null;
    /** 获取所有快照 */
    getSnapshots(sessionId: string): SessionSnapshot[];
    /** 回滚到指定步骤 */
    rollback(sessionId: string, step: number): {
        success: boolean;
        state: unknown;
        snapshot: SessionSnapshot | null;
    };
    /** 删除会话的所有快照 */
    deleteSnapshots(sessionId: string): boolean;
    /** 获取快照数量 */
    getSnapshotCount(sessionId: string): number;
}
//# sourceMappingURL=rollback.d.ts.map