import type { AgentRegistration } from './types';
interface PeerConfig {
    host: string;
    port: number;
    id: string;
}
export declare class RegistryClient {
    private agents;
    private selfRegistration;
    constructor(selfRegistration: AgentRegistration);
    getAgent(agentId: string): AgentRegistration | undefined;
    getAllAgents(): AgentRegistration[];
    getSelf(): AgentRegistration;
    addPeer(peer: AgentRegistration): void;
    removePeer(agentId: string): void;
    registerWithPeers(peers: PeerConfig[], retries?: number, delayMs?: number): Promise<number>;
}
export {};
//# sourceMappingURL=RegistryClient.d.ts.map