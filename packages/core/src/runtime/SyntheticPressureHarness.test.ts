import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SyntheticPressureHarness } from './SyntheticPressureHarness.js';

test('synthetic pressure proves bounded dimensions and resilience without provider calls', async () => {
  const report = await new SyntheticPressureHarness({
    now: (() => { let tick = 0; return () => ++tick; })(), sleep: async () => undefined,
    resourceProbe: () => ({ rssBytes: 1000, activeHandles: 2 }),
  }).run({
    mode: 'short', requestCount: 12,
    limits: { maxGlobal: 3, maxPerAgent: 2, maxPerModel: 2, maxPerSession: 1, maxQueueDepth: 20, maxQueueWaitMs: 1000 },
    thresholds: { maxRssGrowthBytes: 1, maxHandleGrowth: 1, p95QueueLatencyMs: 30, duplicateExecutions: 0 },
  });
  assert.equal(report.synthetic, true);
  assert.equal(report.providerCalls, 0);
  assert.equal(report.thresholdsPassed, true);
  assert.equal(report.execution.duplicateExecutions, 0);
  assert.equal(report.execution.cancelled, 1);
  assert.equal(report.execution.cancelledWhileQueued, 1);
  assert.equal(report.execution.fifoViolations, 0);
  assert.ok(report.observed.maxGlobal <= 3);
  assert.equal(report.resilience.saw503CircuitOpen, true);
  assert.equal(report.resilience.retryBudgetRejected, true);
});
