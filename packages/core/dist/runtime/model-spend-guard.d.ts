import type { AgentRunResult, RoutingDecision } from '../orchestrator/types.js';
export declare function isModelSpendGuardEnabled(env?: NodeJS.ProcessEnv): boolean;
export declare function modelSpendGuardMessage(agentId?: string): string;
export declare function createGuardedAgentResult(agentId: string): AgentRunResult;
export declare function createGuardedRoutingDecision(reason?: string): RoutingDecision;
//# sourceMappingURL=model-spend-guard.d.ts.map