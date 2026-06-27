import type { HermesAgentClient } from '../hermes/HermesAgentClient.js';
import type { TeamProfile, TeamProfileAgentDefinition } from '../team-profile/index.js';
import type { A2AAgentCard, A2ASendMessageRequest, A2ATask } from './types.js';
import type { A2ATransport } from './transport.js';
export declare class HermesA2AAgentAdapter {
    private readonly hermesClient;
    private readonly profile;
    private readonly agent;
    readonly agentId: string;
    readonly agentCard: A2AAgentCard;
    constructor(hermesClient: HermesAgentClient, profile: TeamProfile, agent: TeamProfileAgentDefinition);
    sendMessage(request: A2ASendMessageRequest): Promise<A2ATask>;
    register(transport: A2ATransport): () => void;
}
export declare function createHermesA2AAdapters(hermesClient: HermesAgentClient, profile: TeamProfile): HermesA2AAgentAdapter[];
//# sourceMappingURL=hermes-adapter.d.ts.map