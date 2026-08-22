import type { A2AV1TaskState } from './types.js';

const TERMINAL_STATES = new Set<A2AV1TaskState>([
  'TASK_STATE_COMPLETED',
  'TASK_STATE_FAILED',
  'TASK_STATE_CANCELED',
  'TASK_STATE_REJECTED',
]);

const transitions: Record<A2AV1TaskState, ReadonlySet<A2AV1TaskState>> = {
  TASK_STATE_UNSPECIFIED: new Set(['TASK_STATE_SUBMITTED']),
  TASK_STATE_SUBMITTED: new Set([
    'TASK_STATE_WORKING',
    'TASK_STATE_COMPLETED',
    'TASK_STATE_FAILED',
    'TASK_STATE_CANCELED',
    'TASK_STATE_REJECTED',
    'TASK_STATE_INPUT_REQUIRED',
    'TASK_STATE_AUTH_REQUIRED',
  ]),
  TASK_STATE_WORKING: new Set([
    'TASK_STATE_COMPLETED',
    'TASK_STATE_FAILED',
    'TASK_STATE_CANCELED',
    'TASK_STATE_REJECTED',
    'TASK_STATE_INPUT_REQUIRED',
    'TASK_STATE_AUTH_REQUIRED',
  ]),
  TASK_STATE_INPUT_REQUIRED: new Set([
    'TASK_STATE_WORKING',
    'TASK_STATE_FAILED',
    'TASK_STATE_CANCELED',
    'TASK_STATE_REJECTED',
  ]),
  TASK_STATE_AUTH_REQUIRED: new Set([
    'TASK_STATE_WORKING',
    'TASK_STATE_FAILED',
    'TASK_STATE_CANCELED',
    'TASK_STATE_REJECTED',
  ]),
  TASK_STATE_COMPLETED: new Set(),
  TASK_STATE_FAILED: new Set(),
  TASK_STATE_CANCELED: new Set(),
  TASK_STATE_REJECTED: new Set(),
};

export type A2AV1TransitionDecision =
  | { allowed: true; idempotent: boolean }
  | { allowed: false; reason: 'terminal-state-is-immutable' | 'transition-not-allowed' };

/**
 * DEV-Agent-Teams' conservative persistence policy for A2A v1 Task states.
 * The protocol defines the states; this function defines the transitions this
 * implementation will accept once a durable task store is introduced.
 */
export function evaluateA2ATaskTransition(
  from: A2AV1TaskState,
  to: A2AV1TaskState,
): A2AV1TransitionDecision {
  if (from === to) return { allowed: true, idempotent: true };
  if (TERMINAL_STATES.has(from)) return { allowed: false, reason: 'terminal-state-is-immutable' };
  if (transitions[from].has(to)) return { allowed: true, idempotent: false };
  return { allowed: false, reason: 'transition-not-allowed' };
}
