import type { RegistryClient } from './RegistryClient';
import type { AgentMessageEnvelope } from './types';
export declare class AgentBus {
    private registry;
    private timeoutMs;
    constructor(registry: RegistryClient, timeoutMs?: number);
    sendAndWait(to: string, partial: Omit<AgentMessageEnvelope, 'id' | 'timestamp'>, timeoutMs?: number): Promise<AgentMessageEnvelope>;
    sendAsync(to: string, partial: Omit<AgentMessageEnvelope, 'id' | 'timestamp'>): Promise<void>;
    broadcast(partial: Omit<AgentMessageEnvelope, 'id' | 'to' | 'timestamp'>): Promise<void>;
}
//# sourceMappingURL=AgentBus.d.ts.map