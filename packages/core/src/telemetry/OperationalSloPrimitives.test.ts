import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { OperationalSloEvaluator } from './OperationalSloEvaluator.js';
import { OperationalSloMonitor, OperationalSloPolicyStore } from './OperationalSloPolicyStore.js';
import { createOperationalEvent, DurableOperationalEventStore } from './operational-events.js';

const now = new Date('2026-08-13T10:00:00.000Z');
const policy = {
  policyId: 'latency', tenantId: 'tenant-a', projectId: 'project-a', kind: 'usage' as const,
  metric: 'latency_ms' as const, operator: 'lte' as const, threshold: 200,
  windowMs: 60_000, maximumFreshnessMs: 60_000, minimumEventCount: 2,
};

test('SLO evaluator uses only fresh complete measured tenant/project evidence', () => {
  const database = new Database(':memory:');
  try {
    const events = new DurableOperationalEventStore(database);
    for (const [sourceEventId, latencyMs] of [['one', 220], ['two', 240]] as const) {
      events.append(createOperationalEvent({
        kind: 'usage', dimensions: { tenantId: 'tenant-a', projectId: 'project-a', agentId: 'agent', modelId: 'model' },
        source: 'runtime', sourceEventId, observedAt: new Date(now.getTime() - 1_000).toISOString(),
        completeness: 'complete', measurementStatus: 'measured', payload: { latencyMs },
      }, { now: () => now, id: () => `event-${sourceEventId}` }));
    }
    const result = new OperationalSloEvaluator(events, () => now).evaluate(policy);
    assert.deepEqual({ status: result.status, value: result.value, eventCount: result.eventCount }, {
      status: 'breached', value: 230, eventCount: 2,
    });
    assert.match(result.evidenceRef ?? '', /^sha256:/);
    assert.equal(new OperationalSloEvaluator(events, () => now).evaluate({ ...policy, tenantId: 'tenant-b' }).status, 'insufficient_data');
  } finally { database.close(); }
});

test('policy CAS, evaluation dedupe and breach outbox survive store recreation', async () => {
  const database = new Database(':memory:');
  try {
    const events = new DurableOperationalEventStore(database);
    const policies = new OperationalSloPolicyStore(database, () => now);
    policies.create({ ...policy, enabled: true });
    assert.throws(() => policies.revise({ ...policy, enabled: true, expectedVersion: 9 }), /version conflict/);
    for (const [sourceEventId, latencyMs] of [['one', 220], ['two', 240]] as const) {
      events.append(createOperationalEvent({
        kind: 'usage', dimensions: { tenantId: 'tenant-a', projectId: 'project-a', agentId: 'agent', modelId: 'model' },
        source: 'runtime', sourceEventId, observedAt: new Date(now.getTime() - 1_000).toISOString(),
        completeness: 'complete', measurementStatus: 'measured', payload: { latencyMs },
      }, { now: () => now, id: () => `event-${sourceEventId}` }));
    }
    const delivered: string[] = [];
    const monitor = new OperationalSloMonitor(
      new OperationalSloPolicyStore(database, () => now), events,
      { send: async (alert) => { delivered.push(alert.alertId); } }, () => now,
    );
    const first = await monitor.evaluate('tenant-a', 'project-a', 'latency');
    const duplicate = await monitor.evaluate('tenant-a', 'project-a', 'latency');
    assert.equal(first.status, 'breached');
    assert.equal(duplicate.evaluationId, first.evaluationId);
    assert.equal(delivered.length, 1);
  } finally { database.close(); }
});
