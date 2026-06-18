/**
 * 协作会话记忆（层2）
 *
 * 管理多 Agent 协作会话：创建/评论/归档/快照。
 * 用于会议模式、需求讨论、架构评审等场景。
 */
import type Database from 'better-sqlite3';
/** 协作会话 */
export interface CollaborationSession {
    id: string;
    title: string;
    goal: string;
    status: 'active' | 'archived' | 'resolved';
    participants: string[];
    created_at: string;
    updated_at: string;
    resolved_at?: string;
}
/** 协作评论 */
export interface CollaborationComment {
    id: number;
    session_id: string;
    agent_id: string;
    content: string;
    round: number;
    tokens: number;
    created_at: string;
}
/** 会话快照 */
export interface CollaborationSnapshot {
    id: number;
    session_id: string;
    resolution: string;
    summary: string;
    total_tokens: number;
    duration: number;
    created_at: string;
}
export declare class CollaborationMemory {
    private db;
    constructor(db: Database.Database);
    private initSchema;
    /** 创建协作会话 */
    createSession(title: string, goal: string, participants?: string[]): string;
    /** 获取会话 */
    getSession(sessionId: string): CollaborationSession | null;
    /** 列出会话 */
    listSessions(status?: string, limit?: number): CollaborationSession[];
    /** 归档会话 */
    archiveSession(sessionId: string): boolean;
    /** 标记为已解决 */
    resolveSession(sessionId: string): boolean;
    /** 添加评论 */
    addComment(sessionId: string, agentId: string, content: string, round?: number, tokens?: number): number;
    /** 获取会话评论 */
    getComments(sessionId: string, round?: number): CollaborationComment[];
    /** 获取评论数量 */
    getCommentCount(sessionId: string): number;
    /** 保存快照（决议） */
    saveSnapshot(sessionId: string, resolution: string, summary: string, totalTokens: number, duration: number): number;
    /** 获取会话快照 */
    getSnapshots(sessionId: string): CollaborationSnapshot[];
    /** 获取最新快照 */
    getLatestSnapshot(sessionId: string): CollaborationSnapshot | null;
    /** 会话统计 */
    getSessionStats(sessionId: string): {
        commentCount: number;
        totalTokens: number;
        participants: string[];
        rounds: number;
    };
}
//# sourceMappingURL=collaboration-memory.d.ts.map