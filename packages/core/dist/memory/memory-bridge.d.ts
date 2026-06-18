/**
 * 记忆桥接（层3）
 *
 * 只读桥接 Hermes Profile 的记忆和技能。
 * 支持跨 Profile 状态共享，保持 Hermes 自进化闭环完整。
 */
import type Database from 'better-sqlite3';
/** 最小 ProfileManager 接口（避免跨包导入） */
interface ProfileManager {
    getProfile(agentId: string): {
        status: string;
        port: number;
    } | undefined;
}
/** Profile 记忆条目 */
export interface ProfileMemoryEntry {
    agentId: string;
    key: string;
    value: string;
    source: 'profile' | 'shared';
    retrieved_at: string;
}
/** Profile 技能 */
export interface ProfileSkill {
    agentId: string;
    name: string;
    description: string;
    version?: string;
    source: 'profile';
}
/** 共享状态条目 */
export interface SharedStateEntry {
    key: string;
    value: string;
    owner: string;
    version: number;
    updated_at: string;
}
export interface MemoryBridgeConfig {
    /** 请求超时（ms） */
    requestTimeout?: number;
}
export declare class MemoryBridge {
    private db;
    private profileManager;
    private config;
    constructor(db: Database.Database, profileManager: ProfileManager, config?: MemoryBridgeConfig);
    private initSchema;
    /** 设置共享状态 */
    setSharedState(key: string, value: string, owner: string): void;
    /** 获取共享状态 */
    getSharedState(key: string): SharedStateEntry | null;
    /** 列出共享状态 */
    listSharedState(owner?: string): SharedStateEntry[];
    /** 删除共享状态 */
    deleteSharedState(key: string): boolean;
    /** 查询 Profile 记忆（通过 HTTP API） */
    queryProfileMemory(agentId: string, query: string): Promise<ProfileMemoryEntry[]>;
    /** 查询 Profile 技能（通过 HTTP API） */
    queryProfileSkills(agentId: string): Promise<ProfileSkill[]>;
    /** 构建共享上下文（用于 Agent 提示词注入） */
    buildSharedContext(agentId?: string): string;
    /** 构建跨 Profile 上下文（包含共享状态 + 其他 Agent 的记忆） */
    buildCrossProfileContext(agentId: string, otherAgents: string[]): Promise<string>;
}
export {};
//# sourceMappingURL=memory-bridge.d.ts.map