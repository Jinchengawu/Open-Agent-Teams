import { teamProfileAgentToA2AAgentCard } from './converters.js';
export class HermesA2AAgentAdapter {
    hermesClient;
    profile;
    agent;
    agentId;
    agentCard;
    constructor(hermesClient, profile, agent) {
        this.hermesClient = hermesClient;
        this.profile = profile;
        this.agent = agent;
        this.agentId = agent.id;
        this.agentCard = teamProfileAgentToA2AAgentCard(profile, agent);
    }
    async sendMessage(request) {
        return this.hermesClient.sendA2AMessage(this.agent.id, request, {
            systemPrompt: this.agent.systemPrompt,
            timeoutMs: this.agent.timeoutMs,
        });
    }
    register(transport) {
        return transport.registerAgent(this.agentCard, (request) => this.sendMessage(request));
    }
}
export function createHermesA2AAdapters(hermesClient, profile) {
    return profile.agents.map((agent) => new HermesA2AAgentAdapter(hermesClient, profile, agent));
}
//# sourceMappingURL=hermes-adapter.js.map