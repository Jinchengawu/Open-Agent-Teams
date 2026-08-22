import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { DurableDispatchWaiterStore } from './DurableDispatchWaiterStore.js';
import { PipelineRecoveryStore } from './PipelineRecoveryStore.js';

test('PipelineRecoveryStore reopens a durable dispatch binding and checkpoint', () => {
  const root = mkdtempSync(join(tmpdir(), 'pipeline-recovery-contract-'));
  const databasePath = join(root, 'recovery.db');
  let database = new Database(databasePath);
  try {
    const first = new PipelineRecoveryStore(database);
    first.createRun({ instanceId: 'pipeline-1', pipelineId: 'delivery', definitionHash: 'a'.repeat(64), initialInputRef: 'artifact://request' });
    first.registerExecutionNode({ instanceId: 'pipeline-1', executionNodeId: 'backend:BE-1', surfaceId: 'backend', taskId: 'BE-1', resumePolicy: 'checkpointed', sideEffectState: 'none' });
    first.bindDispatch('pipeline-1', 'backend:BE-1', { workItemId: 'work-1', attemptId: 'attempt-1' });
    const checkpoint = first.saveCheckpoint('pipeline-1', 'backend:BE-1', { sequence: 1, cursor: 'unit-1', completedUnitIds: ['unit-1'] });
    first.markInterrupted('pipeline-1', 'restart');
    database.close();
    database = new Database(databasePath);
    const reopened = new PipelineRecoveryStore(database);
    assert.deepEqual(reopened.planRecovery('pipeline-1'), [{
      executionNodeId: 'backend:BE-1', action: 'reattach',
      reason: 'checkpointed execution has a durable dispatch binding and checkpoint',
      dispatchBinding: { workItemId: 'work-1', attemptId: 'attempt-1' }, checkpoint,
    }]);
  } finally {
    if (database.open) database.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test('PipelineRecoveryStore fails closed on unknown side effects', () => {
  const database = new Database(':memory:');
  try {
    const store = new PipelineRecoveryStore(database);
    store.createRun({ instanceId: 'unsafe', pipelineId: 'release', definitionHash: 'b'.repeat(64), initialInputRef: 'artifact://release' });
    store.registerExecutionNode({ instanceId: 'unsafe', executionNodeId: 'release:publish', surfaceId: 'release', taskId: 'publish', resumePolicy: 'replay_safe' });
    store.markInterrupted('unsafe', 'crash');
    assert.deepEqual(store.planRecovery('unsafe'), [{ executionNodeId: 'release:publish', action: 'manual', reason: 'side effect state unknown is not safe to replay' }]);
  } finally {
    database.close();
  }
});

test('PipelineRecoveryStore keeps a dispatch binding immutable', () => {
  const database = new Database(':memory:');
  try {
    const store = new PipelineRecoveryStore(database);
    store.createRun({ instanceId: 'binding', pipelineId: 'delivery', definitionHash: 'c'.repeat(64), initialInputRef: 'artifact://binding' });
    store.registerExecutionNode({ instanceId: 'binding', executionNodeId: 'testing:T-1', surfaceId: 'testing', taskId: 'T-1', resumePolicy: 'checkpointed', sideEffectState: 'none' });
    store.bindDispatch('binding', 'testing:T-1', { workItemId: 'work-1', attemptId: 'attempt-1' });
    assert.throws(() => store.bindDispatch('binding', 'testing:T-1', { workItemId: 'work-2', attemptId: 'attempt-2' }), /different dispatch binding/);
  } finally {
    database.close();
  }
});

test('PipelineRecoveryStore stores artifact references instead of raw initial input', () => {
  const database = new Database(':memory:');
  try {
    const store = new PipelineRecoveryStore(database);
    assert.throws(() => store.createRun({
      instanceId: 'raw-input', pipelineId: 'delivery', definitionHash: 'd'.repeat(64),
      initialInputRef: '{"secret":"raw"}',
    }), /artifact-style URI/);
  } finally {
    database.close();
  }
});

test('PipelineRecoveryStore binds dispatch and durable waiter atomically and idempotently', () => {
  const database = new Database(':memory:');
  try {
    const store = new PipelineRecoveryStore(database);
    store.createRun({
      instanceId: 'waiter', pipelineId: 'delivery', definitionHash: 'e'.repeat(64),
      initialInputRef: 'artifact://request',
    });
    store.registerExecutionNode({
      instanceId: 'waiter', executionNodeId: 'backend:BE-1', surfaceId: 'backend', taskId: 'BE-1',
      resumePolicy: 'checkpointed', sideEffectState: 'none',
    });
    const binding = { workItemId: 'work-waiter', attemptId: 'attempt-1' };
    store.bindDispatch('waiter', 'backend:BE-1', binding);
    store.bindDispatch('waiter', 'backend:BE-1', binding);
    const waiter = new DurableDispatchWaiterStore(database).poll(binding.workItemId, binding.attemptId);
    assert.equal(waiter?.instanceId, 'waiter');
    assert.equal(waiter?.executionNodeId, 'backend:BE-1');
    assert.equal(waiter?.workItemId, binding.workItemId);
    assert.equal(waiter?.attemptId, binding.attemptId);
    assert.equal(waiter?.status, 'waiting');
    assert.equal(typeof waiter?.createdAt, 'number');
  } finally {
    database.close();
  }
});
