import type { TeamAgentConfig } from '../orchestrator/types.js';
import type { PipelineDefinition } from '../pipeline/types.js';
export interface TeamProfileAgentDefinition {
    id: string;
    name: string;
    role: string;
    systemPrompt: string;
    expertise: string[];
    tools: string[];
    typicalTasks: string[];
    tags?: string[];
    port?: number;
    hermesPort?: number;
    timeoutMs?: number;
}
export interface TeamProfileHermesInstance {
    id: string;
    label: string;
    port: number;
    hermes_port: number;
    tags: string[];
    skills: string[];
    timeout_ms: number;
}
export interface TeamProfileHermesConfig {
    instances: TeamProfileHermesInstance[];
    routing: {
        rules: {
            tags: string[];
            instance: string;
        }[];
        default: string;
    };
}
export interface TeamProfile {
    id: string;
    name: string;
    description: string;
    defaultAgentId: string;
    arbitrationAgentId: string;
    agents: TeamProfileAgentDefinition[];
    hermes: TeamProfileHermesConfig;
    lifecyclePipeline: PipelineDefinition;
}
export interface TeamProfileRuntimeOptions {
    model?: string;
    apiKey?: string;
    baseUrl?: string;
    communicationGuide?: string;
}
export declare function materializeTeamAgents(profile: TeamProfile, options?: TeamProfileRuntimeOptions): TeamAgentConfig[];
export declare function buildTeamCommunicationGuide(profile: TeamProfile): string;
export declare function getProfileAgent(profile: TeamProfile, agentId: string): TeamProfileAgentDefinition | undefined;
//# sourceMappingURL=types.d.ts.map