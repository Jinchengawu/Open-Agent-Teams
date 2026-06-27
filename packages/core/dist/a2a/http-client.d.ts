import type { A2AAgentCard, A2AMessage, A2ASendMessageRequest, A2ASendMessageResult, A2ATask } from './types.js';
export interface HttpA2AClientOptions {
    baseUrl: string;
    headers?: Record<string, string>;
    fetchImpl?: typeof fetch;
}
export declare class HttpA2AClient {
    private readonly baseUrl;
    private readonly headers;
    private readonly fetchImpl;
    constructor(options: HttpA2AClientOptions);
    listAgentCards(): Promise<A2AAgentCard[]>;
    getAgentCard(agentId: string): Promise<A2AAgentCard>;
    sendMessage(agentId: string, request: A2ASendMessageRequest): Promise<A2ASendMessageResult>;
    listMessages(agentId?: string): Promise<A2AMessage[]>;
    listTasks(limit?: number): Promise<A2ATask[]>;
    getTask(taskId: string): Promise<A2ATask>;
    private getJson;
    private postJson;
    private parseJsonResponse;
}
//# sourceMappingURL=http-client.d.ts.map