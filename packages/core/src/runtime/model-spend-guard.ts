import type { AgentRunResult, RoutingDecision } from '../orchestrator/types.js';

const truthy = new Set(['1', 'true', 'yes', 'on']);
const falsy = new Set(['0', 'false', 'no', 'off']);

export function isModelSpendGuardEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (truthy.has(String(env.ALLOW_LIVE_MODEL || '').toLowerCase())) {
    return false;
  }
  const guard = String(env.MODEL_SPEND_GUARD || '').toLowerCase();
  if (falsy.has(guard)) {
    return false;
  }
  return true;
}

export function modelSpendGuardMessage(agentId?: string): string {
  const target = agentId ? `Agent ${agentId}` : 'LLM route';
  return [
    `${target} blocked by MODEL_SPEND_GUARD.`,
    'External model calls are disabled to avoid provider spend.',
    'Use Codex to generate the result, then run scripts/codex-backfill-legal-team.mjs or another Codex backfill script to persist artifacts.',
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

export function createGuardedRoutingDecision(reason?: string): RoutingDecision {
  const defaultAgentId = process.env.DEFAULT_AGENT_ID || 'team-orchestrator';
  return {
    strategy: 'single',
    primaryAgent: defaultAgentId,
    reasoning: reason || modelSpendGuardMessage(),
    complexity: 'medium',
  };
}
