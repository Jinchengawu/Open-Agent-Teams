import type { A2AAgentCard, A2AMessage, A2ASendMessageRequest, A2ASendMessageResult, A2ATask } from './types.js';
export interface A2ATransportHandler {
    agentCard: A2AAgentCard;
    handleMessage: (request: A2ASendMessageRequest) => Promise<A2ASendMessageResult>;
}
export interface A2ATransport {
    registerAgent(card: A2AAgentCard, handler: A2ATransportHandler['handleMessage']): () => void;
    getAgentCard(agentId: string): A2AAgentCard | undefined;
    listAgentCards(): A2AAgentCard[];
    sendMessage(toAgentId: string, request: A2ASendMessageRequest): Promise<A2ASendMessageResult>;
    getMessageHistory(agentId: string): A2AMessage[];
    getTaskHistory(agentId: string): A2ATask[];
}
export declare class InProcessA2ATransport implements A2ATransport {
    private handlers;
    private messageHistory;
    private taskHistory;
    private emitter;
    registerAgent(card: A2AAgentCard, handler: A2ATransportHandler['handleMessage']): () => void;
    getAgentCard(agentId: string): A2AAgentCard | undefined;
    listAgentCards(): A2AAgentCard[];
    sendMessage(toAgentId: string, request: A2ASendMessageRequest): Promise<A2ASendMessageResult>;
    getMessageHistory(agentId: string): A2AMessage[];
    getTaskHistory(agentId: string): A2ATask[];
    private appendMessage;
    private appendTask;
}
export declare function getGlobalInProcessA2ATransport(): InProcessA2ATransport;
export declare function resetGlobalInProcessA2ATransport(): void;
export declare function getAgentIdFromCard(card: A2AAgentCard): string;
//# sourceMappingURL=transport.d.ts.map