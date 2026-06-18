export interface Session {
    id: string;
    title: string;
    status: string;
    created_at: string;
    updated_at: string;
}
export interface Message {
    id: number;
    session_id: string;
    role: 'user' | 'assistant' | 'system';
    agent_id: string;
    content: string;
    tokens: number;
    created_at: string;
}
export declare class SessionManager {
    private db;
    constructor(dbPath: string);
    createSession(title?: string, clientId?: string): string;
    getSession(sessionId: string): Session | null;
    listSessions(limit?: number, offset?: number): Session[];
    private readonly ALLOWED_COLUMNS;
    updateSession(sessionId: string, updates: Partial<Session>): void;
    deleteSession(sessionId: string): void;
    addMessage(sessionId: string, role: string, content: string, agentId?: string): number;
    getMessages(sessionId: string, limit?: number): Message[];
    getAllMessages(sessionId: string): Message[];
    getRecentMessages(sessionId: string, count: number): Message[];
    countMessageTokens(sessionId: string): number;
    getSessionCount(): number;
    getTotalMessageCount(): number;
    close(): void;
}
//# sourceMappingURL=SessionManager.d.ts.map