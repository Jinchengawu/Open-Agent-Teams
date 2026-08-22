import assert from 'node:assert/strict';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { BillingImportScheduler } from './BillingImportScheduler.js';
import { BillingSourceRegistry, ProviderBillingReconciler } from './BillingReconciliation.js';

test('scheduled billing import binds source discovery, durable cursor, lease and idempotent reconciliation', async () => {
  const database = new Database(':memory:');
  try {
    database.exec(`CREATE TABLE usage_events (
      id TEXT PRIMARY KEY, tenant_id TEXT, project_id TEXT, occurred_at INTEGER,
      cost_amount REAL, cost_currency TEXT, cost_status TEXT
    )`);
    database.prepare(`INSERT INTO usage_events VALUES(?,?,?,?,?,?,?)`).run(
      'usage-1', 'tenant-a', 'project-a', Date.parse('2026-08-01T12:00:00Z'), 10, 'USD', 'measured',
    );
    const source = {
      sourceId: 'fixture', version: 1, implementationId: 'fixture-v1',
      discover: async () => ({ statementRef: 'artifact://billing/one', nextCursor: 'cursor-1' }),
      load: async () => ({
        statementId: 'statement-1', tenantId: 'tenant-a', projectId: 'project-a', providerId: 'provider-a', accountRef: 'acct-a',
        windowStart: Date.parse('2026-08-01T00:00:00Z'), windowEnd: Date.parse('2026-08-02T00:00:00Z'),
        currency: 'USD', totalAmount: 10, issuedAt: '2026-08-03T00:00:00.000Z',
      }),
    };
    const registry = new BillingSourceRegistry([source]);
    const reconciler = new ProviderBillingReconciler(database, registry);
    reconciler.bindUsage({ tenantId: 'tenant-a', projectId: 'project-a', eventId: 'usage-1', providerId: 'provider-a', accountRef: 'acct-a' });
    const scheduler = new BillingImportScheduler(database, registry, reconciler);
    scheduler.createSchedule({ scheduleId: 'daily', tenantId: 'tenant-a', projectId: 'project-a', providerId: 'provider-a', accountRef: 'acct-a', sourceBinding: registry.binding('fixture'), intervalMs: 60_000, toleranceAmount: 0.01, firstRunAt: 0 });
    const claim = scheduler.claimDue({ workerId: 'worker-a', now: 0, leaseMs: 1_000, limit: 1 })[0]!;
    assert.deepEqual(scheduler.claimDue({ workerId: 'worker-b', now: 0, leaseMs: 1_000, limit: 1 }), []);
    const result = await scheduler.process(claim, { now: 0 });
    assert.equal(result.reconciliation?.status, 'matched');
    const reopened = new BillingImportScheduler(database, registry, reconciler);
    assert.equal(reopened.getSchedule('tenant-a', 'project-a', 'daily')?.cursor, 'cursor-1');
  } finally { database.close(); }
});
