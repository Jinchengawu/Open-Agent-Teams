import type { CompensationBinding, CompensationReceipt, CompensationRegistry } from './CompensationRegistry.js';
import type { ManualRecoveryAction, ManualRecoveryApproval, ManualRecoveryApprovalStore } from './ManualRecoveryApprovalStore.js';
import type { SideEffectIntent, SideEffectLedger, SideEffectLedgerEntry } from './SideEffectLedger.js';

export interface RecoveryApprovalCredential {
  approvalId: string;
  token: string;
  tenantId: string;
  projectId: string;
  instanceId: string;
  executionNodeId: string;
  decisionHash: string;
}

/** Explicit recovery actions only. This coordinator has no automatic plan executor. */
export class RecoveryActionCoordinator {
  constructor(
    private readonly approvals: ManualRecoveryApprovalStore,
    private readonly compensations: CompensationRegistry,
    private readonly ledger: SideEffectLedger,
  ) {}

  authorizeNonExecutingAction(
    credential: RecoveryApprovalCredential,
    action: Exclude<ManualRecoveryAction, 'compensate'>,
  ): ManualRecoveryApproval {
    if (action === 'replay') {
      const unsafe = this.ledger.listForExecution(credential.instanceId, credential.executionNodeId)
        .filter((effect) => effect.state !== 'compensated');
      if (unsafe.length > 0) {
        throw new Error(`Replay remains forbidden while side effects are ${[...new Set(unsafe.map((effect) => effect.state))].sort().join(', ')}`);
      }
    }
    return this.approvals.consume({ ...credential, action });
  }

  compensate(input: {
    credential: RecoveryApprovalCredential;
    effect: SideEffectIntent;
    compensation: CompensationBinding;
  }): { approval: ManualRecoveryApproval; receipt: CompensationReceipt; effect: SideEffectLedgerEntry } {
    if (input.effect.tenantId !== input.credential.tenantId
      || input.effect.projectId !== input.credential.projectId
      || input.effect.instanceId !== input.credential.instanceId
      || input.effect.executionNodeId !== input.credential.executionNodeId) {
      throw new Error('Compensation effect does not match approval scope');
    }
    const existing = this.ledger.listForExecution(input.effect.instanceId, input.effect.executionNodeId)
      .find((effect) => effect.tenantId === input.effect.tenantId
        && effect.projectId === input.effect.projectId
        && effect.operation === input.effect.operation
        && effect.idempotencyKey === input.effect.idempotencyKey
        && effect.intentHash === input.effect.intentHash);
    if (!existing) throw new Error(`Side effect ${input.effect.idempotencyKey} not found for compensation`);
    if (existing.state !== 'committed' && existing.state !== 'unknown' && existing.state !== 'compensated') {
      throw new Error(`Side effect ${input.effect.idempotencyKey} cannot be compensated from ${existing.state}`);
    }
    const approval = this.approvals.consume({ ...input.credential, action: 'compensate' });
    const receipt = this.compensations.execute(input.compensation, existing);
    const effect = this.ledger.compensate({
      ...input.effect,
      compensationReceiptRef: receipt.receiptRef,
    });
    return { approval, receipt, effect };
  }
}
