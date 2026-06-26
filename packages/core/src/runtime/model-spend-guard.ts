import type { AgentRunResult, RoutingDecision } from '../orchestrator/types.js';

const truthy = new Set(['1', 'true', 'yes', 'on']);

export function isModelSpendGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (truthy.has(String(env.ALLOW_LIVE_MODEL || '').toLowerCase())) {
    return false;
  }
  return truthy.has(String(env.MODEL_SPEND_GUARD || '').toLowerCase());
}

export function modelSpendGuardMessage(agentId?: string): string {
  const target = agentId ? `Agent ${agentId}` : 'LLM route';
  return [
    `${target} blocked by MODEL_SPEND_GUARD.`,
    'External model calls are disabled to avoid provider spend.',
    'Use Codex to generate the result, then backfill artifacts into the framework data stores.',
  ].join(' ');
}

export function createGuardedAgentResult(agentId: string): AgentRunResult {
  const output = modelSpendGuardMessage(agentId);
  return {
    success: false,
    output,
    messages: [{ role: 'assistant', content: output }],
    tokenUsage: { input_tokens: 0, output_tokens: 0 },
    toolCalls: [],
  };
}

export function createGuardedRoutingDecision(defaultAgentId: string, reason?: string): RoutingDecision {
  return {
    strategy: 'single',
    primaryAgent: defaultAgentId,
    reasoning: reason || modelSpendGuardMessage(),
    complexity: 'medium',
  };
}
