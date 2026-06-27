import type { RegistryClient } from './RegistryClient.js';
import type { AgentMessageEnvelope } from './types.js';
export declare class AgentBus {
    private registry;
    private timeoutMs;
    constructor(registry: RegistryClient, timeoutMs?: number);
    sendAndWait(to: string, partial: Omit<AgentMessageEnvelope, 'id' | 'timestamp'>, timeoutMs?: number): Promise<AgentMessageEnvelope>;
    sendAsync(to: string, partial: Omit<AgentMessageEnvelope, 'id' | 'timestamp'>): Promise<void>;
    broadcast(partial: Omit<AgentMessageEnvelope, 'id' | 'to' | 'timestamp'>): Promise<void>;
}
//# sourceMappingURL=AgentBus.d.ts.map