import type Database from 'better-sqlite3';
import type { A2AMessage, A2ATask } from './types.js';
export interface A2AHistoryStore {
    appendMessage(agentId: string, message: A2AMessage): void;
    appendTask(agentId: string, task: A2ATask): void;
    getMessageHistory(agentId: string): A2AMessage[];
    getTaskHistory(agentId: string): A2ATask[];
}
export declare class SqliteA2AHistoryStore implements A2AHistoryStore {
    private readonly db;
    constructor(db: Database.Database);
    appendMessage(agentId: string, message: A2AMessage): void;
    appendTask(agentId: string, task: A2ATask): void;
    getMessageHistory(agentId: string): A2AMessage[];
    getTaskHistory(agentId: string): A2ATask[];
    private initSchema;
    private readTimestamp;
}
//# sourceMappingURL=history-store.d.ts.map