import type { TeamProfile, TeamProfileAgentDefinition } from '../team-profile/index.js';
import type { PipelineInstance, PipelineStatus, SurfaceResult, SurfaceStatus } from '../pipeline/types.js';
import type { AgentMessage } from '../event/MessageBus.js';
import type { A2AAgentCard, A2AArtifact, A2AMessage, A2APart, A2ATask, A2ATaskState } from './types.js';
export declare function createA2ATextPart(text: string, metadata?: Record<string, unknown>): A2APart;
export declare function createA2ADataPart(data: Record<string, unknown>, metadata?: Record<string, unknown>): A2APart;
export declare function createA2AMessage(input: {
    role: 'user' | 'agent';
    text?: string;
    parts?: A2APart[];
    contextId?: string;
    taskId?: string;
    metadata?: Record<string, unknown>;
    messageId?: string;
}): A2AMessage;
export declare function agentMessageToA2AMessage(message: AgentMessage): A2AMessage;
export declare function a2aMessageToAgentMessage(message: A2AMessage, fallback: {
    from: string;
    to: string | 'broadcast';
    type?: AgentMessage['type'];
}): Omit<AgentMessage, 'id' | 'metadata'> & {
    metadata?: Partial<AgentMessage['metadata']>;
};
export declare function teamProfileAgentToA2AAgentCard(profile: TeamProfile, agent: TeamProfileAgentDefinition): A2AAgentCard;
export declare function teamProfileToA2AAgentCards(profile: TeamProfile): A2AAgentCard[];
export declare function pipelineInstanceToA2ATask(instance: PipelineInstance): A2ATask;
export declare function surfaceResultToA2AArtifact(result: SurfaceResult): A2AArtifact;
export declare function pipelineStatusToA2AState(status: PipelineStatus): A2ATaskState;
export declare function surfaceStatusToA2AState(status: SurfaceStatus): A2ATaskState;
export declare function partsToText(parts: A2APart[]): string;
//# sourceMappingURL=converters.d.ts.map