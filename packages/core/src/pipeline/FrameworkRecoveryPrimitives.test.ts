import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { CompensationRegistry } from './CompensationRegistry.js';
import { DurableDispatchWaiterStore } from './DurableDispatchWaiterStore.js';
import { ManualRecoveryApprovalStore } from './ManualRecoveryApprovalStore.js';
import { PipelineRecoveryStore } from './PipelineRecoveryStore.js';
import { RecoveryActionCoordinator } from './RecoveryActionCoordinator.js';
import { RecoveryCoordinator } from './RecoveryCoordinator.js';
import { CheckpointResumeRegistry, ReplayRegistry } from './RecoveryHandlerRegistries.js';
import { RecoveryReconciler, hashRecoveryDecision } from './RecoveryReconciler.js';
import { SideEffectLedger } from './SideEffectLedger.js';

test('durable waiter reclaims expired leases and completes with CAS idempotency', () => {
  const database = new Database(':memory:');
  try {
    let now = 1_000;
    const waiters = new DurableDispatchWaiterStore(database, () => now);
    waiters.subscribe({
      instanceId: 'pipeline-1', executionNodeId: 'backend:BE-1',
      workItemId: 'work-1', attemptId: 'attempt-1',
    });
    const oldLease = waiters.claim({ workItemId: 'work-1', attemptId: 'attempt-1', consumerId: 'old', leaseMs: 50 });
    now = 1_051;
    const replacement = waiters.claim({ workItemId: 'work-1', attemptId: 'attempt-1', consumerId: 'new', leaseMs: 100 });
    assert.notEqual(replacement?.leaseToken, oldLease?.leaseToken);
    assert.throws(() => waiters.complete({
      workItemId: 'work-1', attemptId: 'attempt-1', consumerId: 'old',
      leaseToken: oldLease!.leaseToken!, resultRef: 'artifact://stale',
    }), /lease token/);
    const completed = waiters.complete({
      workItemId: 'work-1', attemptId: 'attempt-1', consumerId: 'new',
      leaseToken: replacement!.leaseToken!, resultRef: 'artifact://result',
    });
    assert.equal(completed.status, 'completed');
    assert.doesNotThrow(() => waiters.complete({
      workItemId: 'work-1', attemptId: 'attempt-1', consumerId: 'new',
      leaseToken: replacement!.leaseToken!, resultRef: 'artifact://result',
    }));
  } finally {
    database.close();
  }
});

test('side-effect ledger and approval gate fail closed before registered compensation', () => {
  const database = new Database(':memory:');
  try {
    const ledger = new SideEffectLedger(database);
    const approvals = new ManualRecoveryApprovalStore(database);
    const compensations = new CompensationRegistry(database);
    let calls = 0;
    const binding = compensations.register({
      operation: 'publish-release', version: '1.0.0', handlerId: 'release-compensator-v1',
      handler: ({ effect }) => {
        calls += 1;
        return { receiptRef: `artifact://compensation/${effect.idempotencyKey}` };
      },
    });
    const coordinator = new RecoveryActionCoordinator(approvals, compensations, ledger);
    const effect = {
      tenantId: 'tenant-1', projectId: 'project-1', instanceId: 'pipeline-1', executionNodeId: 'release:PUBLISH',
      operation: 'publish-release', idempotencyKey: 'release-123', intentHash: 'c'.repeat(64),
    };
    ledger.begin(effect);
    ledger.markUnknown(effect);
    const scope = {
      tenantId: effect.tenantId, projectId: effect.projectId, instanceId: effect.instanceId,
      executionNodeId: effect.executionNodeId, decisionHash: 'd'.repeat(64), approver: 'ops@example.com',
      evidenceRef: 'artifact://approval/incident-1', expiresAt: Date.now() + 60_000,
    };
    const replay = approvals.approve({ ...scope, action: 'replay' });
    assert.throws(() => coordinator.authorizeNonExecutingAction(credential(replay, scope), 'replay'), /Replay remains forbidden/);
    const compensation = approvals.approve({ ...scope, action: 'compensate' });
    const result = coordinator.compensate({ credential: credential(compensation, scope), effect, compensation: binding });
    assert.equal(result.effect.state, 'compensated');
    assert.equal(calls, 1);
  } finally {
    database.close();
  }
});

test('reconciler projects a completed reattach and records a durable audit', () => {
  const database = new Database(':memory:');
  try {
    const store = new PipelineRecoveryStore(database);
    const waiters = new DurableDispatchWaiterStore(database);
    const ledger = new SideEffectLedger(database);
    const approvals = new ManualRecoveryApprovalStore(database);
    const recovery = new RecoveryCoordinator(store, waiters, ledger);
    const actions = new RecoveryActionCoordinator(approvals, new CompensationRegistry(database), ledger);
    store.createRun({ instanceId: 'pipeline-reattach', pipelineId: 'delivery', definitionHash: 'a'.repeat(64), initialInputRef: 'artifact://request' });
    store.registerExecutionNode({
      instanceId: 'pipeline-reattach', executionNodeId: 'backend:WAIT', surfaceId: 'backend', taskId: 'WAIT',
      resumePolicy: 'checkpointed', sideEffectState: 'none',
    });
    store.bindDispatch('pipeline-reattach', 'backend:WAIT', { workItemId: 'work-wait', attemptId: 'attempt-1' });
    store.saveCheckpoint('pipeline-reattach', 'backend:WAIT', { sequence: 1, cursor: 'remote-running' });
    const lease = waiters.claim({ workItemId: 'work-wait', attemptId: 'attempt-1', consumerId: 'worker', leaseMs: 10_000 })!;
    waiters.complete({
      workItemId: 'work-wait', attemptId: 'attempt-1', consumerId: 'worker', leaseToken: lease.leaseToken!,
      resultRef: 'artifact://dispatch/result-wait',
    });
    store.markInterrupted('pipeline-reattach', 'process killed');
    const reconciler = new RecoveryReconciler(
      database, recovery, waiters, actions, new ReplayRegistry(database), new CheckpointResumeRegistry(database),
    );
    const records = reconciler.reconcile({ instanceId: 'pipeline-reattach' });
    assert.equal(records[0]?.action, 'reattach_projection');
    assert.equal(records[0]?.resultRef, 'artifact://dispatch/result-wait');
    assert.equal(reconciler.listAudit('pipeline-reattach').length, 1);
    assert.equal(hashRecoveryDecision(recovery.planRecovery('pipeline-reattach')[0]!).length, 64);
  } finally {
    database.close();
  }
});

function credential(
  issued: { approval: { approvalId: string }; token: string },
  scope: { tenantId: string; projectId: string; instanceId: string; executionNodeId: string; decisionHash: string },
) {
  return {
    approvalId: issued.approval.approvalId,
    token: issued.token,
    tenantId: scope.tenantId,
    projectId: scope.projectId,
    instanceId: scope.instanceId,
    executionNodeId: scope.executionNodeId,
    decisionHash: scope.decisionHash,
  };
}
