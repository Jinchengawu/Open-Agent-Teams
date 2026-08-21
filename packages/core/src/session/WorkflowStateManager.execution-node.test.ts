import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { WorkflowStateManager } from './WorkflowStateManager.js';

test('WorkflowStateManager keeps same-Surface execution nodes as separate recoverable steps', () => {
  const database = new Database(':memory:');
  try {
    const manager = new WorkflowStateManager(database);
    manager.createState('projected delivery', 1, 'workflow-1', { kind: 'pipeline' });
    manager.updateExecutionNode('workflow-1', 'backend:BE-1', {
      agentId: 'dev-backend', goal: 'first', output: 'first result', status: 'completed',
    });
    manager.updateExecutionNode('workflow-1', 'backend:BE-2', {
      agentId: 'dev-backend', goal: 'second', output: 'second result', status: 'completed',
    });
    manager.updateExecutionNode('workflow-1', 'backend:BE-1', {
      output: 'first amended', status: 'completed',
    });
    const state = manager.load('workflow-1');
    assert.deepEqual(state?.steps.map((step) => step.executionNodeId), ['backend:BE-1', 'backend:BE-2']);
    assert.deepEqual(state?.steps.map((step) => step.output), ['first amended', 'second result']);
    assert.equal(new Set(state?.steps.map((step) => step.index)).size, 2);
  } finally {
    database.close();
  }
});
