import type { HermesAgentClient } from '../hermes/HermesAgentClient.js';
import type { TeamProfile, TeamProfileAgentDefinition } from '../team-profile/index.js';
import { teamProfileAgentToA2AAgentCard } from './converters.js';
import type { A2AAgentCard, A2ASendMessageRequest, A2ATask } from './types.js';
import type { A2ATransport } from './transport.js';

export class HermesA2AAgentAdapter {
  readonly agentId: string;
  readonly agentCard: A2AAgentCard;

  constructor(
    private readonly hermesClient: HermesAgentClient,
    private readonly profile: TeamProfile,
    private readonly agent: TeamProfileAgentDefinition,
  ) {
    this.agentId = agent.id;
    this.agentCard = teamProfileAgentToA2AAgentCard(profile, agent);
  }

  async sendMessage(request: A2ASendMessageRequest): Promise<A2ATask> {
    return this.hermesClient.sendA2AMessage(this.agent.id, request, {
      systemPrompt: this.agent.systemPrompt,
      timeoutMs: this.agent.timeoutMs,
    });
  }

  register(transport: A2ATransport): () => void {
    return transport.registerAgent(this.agentCard, (request) => this.sendMessage(request));
  }
}

export function createHermesA2AAdapters(
  hermesClient: HermesAgentClient,
  profile: TeamProfile,
): HermesA2AAgentAdapter[] {
  return profile.agents.map((agent) => new HermesA2AAgentAdapter(hermesClient, profile, agent));
}
