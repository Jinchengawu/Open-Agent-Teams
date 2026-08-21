import type {
  DurableDispatchWaiter,
  DurableDispatchWaiterStore,
} from './DurableDispatchWaiterStore.js';
import type { PipelineRecoveryStore } from './PipelineRecoveryStore.js';
import type { PipelineRecoveryDecision } from './PipelineRecoveryStore.js';
import type { SideEffectLedger } from './SideEffectLedger.js';

export interface PipelineReattachHandle {
  executionNodeId: string;
  workItemId: string;
  attemptId: string;
  status: DurableDispatchWaiter['status'];
  resultRef?: string;
  errorRef?: string;
}

/**
 * Read-only reattachment surface used before a recovery plan is executed.
 * It can observe or wait for an existing dispatch, but has no replay API.
 */
export class RecoveryCoordinator {
  constructor(
    private readonly recoveryStore: PipelineRecoveryStore,
    private readonly waiterStore: DurableDispatchWaiterStore,
    private readonly sideEffectLedger?: SideEffectLedger,
  ) {}

  planRecovery(instanceId: string): PipelineRecoveryDecision[] {
    return this.recoveryStore.planRecovery(instanceId).map((decision) => {
      if (!this.sideEffectLedger || decision.action === 'skip' || decision.action === 'manual') return decision;
      const effects = this.sideEffectLedger.listForExecution(instanceId, decision.executionNodeId);
      const unsafe = effects.filter((effect) => effect.state !== 'compensated');
      if (unsafe.length === 0) return decision;
      return {
        executionNodeId: decision.executionNodeId,
        action: 'manual',
        reason: `side effect ledger contains non-replayable state: ${[...new Set(unsafe.map((effect) => effect.state))].sort().join(', ')}`,
      };
    });
  }

  planReattachments(instanceId: string): PipelineReattachHandle[] {
    return this.planRecovery(instanceId)
      .filter((decision) => decision.action === 'reattach' && decision.dispatchBinding)
      .map((decision) => {
        const binding = decision.dispatchBinding!;
        const waiter = this.waiterStore.poll(binding.workItemId, binding.attemptId);
        if (!waiter) throw new Error(`Durable dispatch waiter missing for ${decision.executionNodeId}`);
        if (waiter.instanceId !== instanceId || waiter.executionNodeId !== decision.executionNodeId) {
          throw new Error(`Durable dispatch waiter binding mismatch for ${decision.executionNodeId}`);
        }
        return {
          executionNodeId: decision.executionNodeId,
          workItemId: binding.workItemId,
          attemptId: binding.attemptId,
          status: waiter.status,
          ...(waiter.resultRef ? { resultRef: waiter.resultRef } : {}),
          ...(waiter.errorRef ? { errorRef: waiter.errorRef } : {}),
        };
      });
  }

  waitForTerminal(
    binding: { workItemId: string; attemptId: string },
    options: { timeoutMs: number; pollIntervalMs?: number; signal?: AbortSignal },
  ): Promise<DurableDispatchWaiter> {
    return this.waiterStore.waitForTerminal(binding, options);
  }
}
