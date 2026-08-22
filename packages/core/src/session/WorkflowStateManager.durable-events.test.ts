import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import type { WorkflowEvent } from '../event/types.js';
import { DurableOperationalEventStore } from '../telemetry/operational-events.js';
import { WorkflowStateManager } from './WorkflowStateManager.js';

test('scoped workflow events persist before legacy delivery and remain idempotent', () => {
  const database = new Database(':memory:');
  const emitted: WorkflowEvent[] = [];
  const store = new DurableOperationalEventStore(database);
  const manager = new WorkflowStateManager(database, {
    operationalEventStore: store,
    legacyEmit: (event) => emitted.push(event),
    now: () => new Date('2026-08-13T08:00:00.000Z'),
  });
  const scope = { trusted: true as const, tenantId: 'tenant-a', projectId: 'project-a' };
  manager.createState('work', 1, 'workflow-a', {}, scope);
  manager.updateStep('workflow-a', 0, { agentId: 'agent', status: 'running', output: 'partial' });
  manager.updateStep('workflow-a', 0, { agentId: 'agent', status: 'completed', output: 'final' });
  manager.complete('workflow-a');
  manager.complete('workflow-a');

  assert.deepEqual(store.list('tenant-a', 'project-a').map((event) => event.sourceEventId).sort(), [
    'workflow:workflow-a:completed',
    'workflow:workflow-a:started',
    'workflow:workflow-a:step:0:completed',
  ]);
  assert.deepEqual(store.list('tenant-b', 'project-a'), []);
  assert.deepEqual(emitted.map((event) => event.type), [
    'workflow.started', 'workflow.step_completed', 'workflow.completed',
  ]);
  assert.equal(emitted[1]?.payload.output, 'final');
  database.close();
});

test('unscoped remains legacy-only and durable failure rolls state back', () => {
  const database = new Database(':memory:');
  const legacy: WorkflowEvent[] = [];
  const manager = new WorkflowStateManager(database, { legacyEmit: (event) => legacy.push(event) });
  manager.createState('legacy', 0, 'legacy', { tenantId: 'untrusted', projectId: 'untrusted' });
  assert.equal(legacy[0]?.payload.scopeStatus, 'unscoped');
  assert.equal((database.prepare('SELECT COUNT(*) AS count FROM operational_events').get() as { count: number }).count, 0);

  const failing = new WorkflowStateManager(database, {
    operationalEventStore: { appendIfAbsent: () => { throw new Error('disk full'); } },
    legacyEmit: (event) => legacy.push(event),
  });
  assert.throws(() => failing.createState('rollback', 0, 'rollback', {}, {
    trusted: true, tenantId: 'tenant', projectId: 'project',
  }), /disk full/);
  assert.equal(failing.load('rollback'), null);
  database.close();
});
