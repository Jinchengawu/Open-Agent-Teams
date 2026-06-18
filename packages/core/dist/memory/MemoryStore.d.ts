export declare class MemoryStore {
    private db;
    constructor(dbPath: string);
    set(agentId: string, key: string, value: string, ttlMs?: number): void;
    get(agentId: string, key: string): string | null;
    delete(agentId: string, key: string): void;
    search(agentId: string, query: string): {
        key: string;
        value: string;
    }[];
    keys(agentId: string): string[];
    purgeExpired(): number;
    close(): void;
}
//# sourceMappingURL=MemoryStore.d.ts.map