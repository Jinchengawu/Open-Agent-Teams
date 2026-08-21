import { RuntimeAdmissionController, type RuntimeAdmissionLimits } from './RuntimeAdmissionController.js';
import { ResilientCallExecutor } from './ResilientCallExecutor.js';

export interface SyntheticPressureThresholds {
  maxRssGrowthBytes: number;
  maxHandleGrowth: number;
  p95QueueLatencyMs: number;
  duplicateExecutions: 0;
}

export interface SyntheticPressureConfig {
  mode: 'short' | 'soak';
  requestCount: number;
  limits: Required<RuntimeAdmissionLimits>;
  thresholds: SyntheticPressureThresholds;
}

export interface SyntheticPressureReport {
  schemaVersion: 'dat-synthetic-pressure/v1';
  synthetic: true;
  providerCalls: 0;
  mode: 'short' | 'soak';
  dimensions: { models: string[]; agents: string[]; sessions: string[] };
  observed: {
    maxGlobal: number; maxQueued: number;
    maxByAgent: Record<string, number>; maxByModel: Record<string, number>; maxBySession: Record<string, number>;
  };
  latencyMs: { queueP50: number; queueP95: number; queueP99: number };
  resources: { rssGrowthBytes: number; activeHandleGrowth: number };
  execution: {
    requested: number; admittedImmediate: number; admittedFromQueue: number; queueRejected: number;
    completed: number; cancelled: number; cancelledWhileQueued: number; duplicateExecutions: number; fifoViolations: number;
  };
  resilience: { saw429Retry: boolean; saw503CircuitOpen: boolean; sawTimeoutRetry: boolean; fallbackUsed: boolean; retryBudgetRejected: boolean };
  thresholds: SyntheticPressureThresholds;
  thresholdFailures: string[];
  thresholdsPassed: boolean;
}

export class SyntheticPressureHarness {
  constructor(private readonly dependencies: {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
    resourceProbe?: () => { rssBytes: number; activeHandles: number };
  } = {}) {}

  async run(config: SyntheticPressureConfig): Promise<SyntheticPressureReport> {
    validate(config);
    const now = this.dependencies.now ?? Date.now;
    const sleep = this.dependencies.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const resourceProbe = this.dependencies.resourceProbe ?? (() => ({
      rssBytes: process.memoryUsage().rss,
      activeHandles: (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.().length ?? 0,
    }));
    const controller = new RuntimeAdmissionController(config.limits);
    const agents = ['agent-a', 'agent-b', 'agent-c'];
    const models = ['model-a', 'model-b'];
    const sessions = ['session-a', 'session-b', 'session-c', 'session-d'];
    const before = resourceProbe();
    const maxByAgent: Record<string, number> = {}, maxByModel: Record<string, number> = {}, maxBySession: Record<string, number> = {};
    let maxGlobal = 0, maxQueued = 0, cancelled = 0, cancelledWhileQueued = 0, queueRejected = 0, admittedImmediate = 0, admittedFromQueue = 0;
    const executions = new Map<string, number>();
    const queueLatency: number[] = [];
    const admittedQueuedOrder: number[] = [];
    const queuedIndexes = new Set<number>();
    const abort = new AbortController();
    const cancellationIndex = Math.min(config.requestCount - 1, config.limits.maxGlobal);
    const tasks = Array.from({ length: config.requestCount }, (_, index) => {
      const requestId = `synthetic-${index}`;
      const enqueuedAt = now();
      const signal = index === cancellationIndex ? abort.signal : undefined;
      const queuedBefore = controller.snapshot().queued;
      const acquired = controller.acquire({
        agentId: agents[index % agents.length], modelId: models[index % models.length],
        sessionId: sessions[index % sessions.length], signal,
      });
      const wasQueued = controller.snapshot().queued > queuedBefore;
      if (wasQueued) queuedIndexes.add(index);
      else admittedImmediate += 1;
      return acquired.then(async (release) => {
        queueLatency.push(Math.max(0, now() - enqueuedAt));
        if (wasQueued) { admittedFromQueue += 1; admittedQueuedOrder.push(index); }
        executions.set(requestId, (executions.get(requestId) ?? 0) + 1);
        const snapshot = controller.snapshot();
        maxGlobal = Math.max(maxGlobal, snapshot.activeGlobal); maxQueued = Math.max(maxQueued, snapshot.queued);
        mergeMax(maxByAgent, snapshot.activeByAgent); mergeMax(maxByModel, snapshot.activeByModel); mergeMax(maxBySession, snapshot.activeBySession);
        await sleep(config.mode === 'soak' ? 10 : 1);
        release();
      }).catch((error: unknown) => {
        if ((error as { code?: string }).code === 'ADMISSION_ABORTED') {
          cancelled += 1; if (queuedIndexes.has(index)) cancelledWhileQueued += 1; return;
        }
        if ((error as { code?: string }).code === 'BACKPRESSURE_QUEUE_FULL') { queueRejected += 1; return; }
        throw error;
      });
    });
    abort.abort();
    // Capture the initial pressure peak before admitted jobs begin releasing.
    const initial = controller.snapshot(); maxQueued = Math.max(maxQueued, initial.queued); maxGlobal = Math.max(maxGlobal, initial.activeGlobal);
    mergeMax(maxByAgent, initial.activeByAgent); mergeMax(maxByModel, initial.activeByModel); mergeMax(maxBySession, initial.activeBySession);
    await Promise.all(tasks);
    const resilience = await resilienceMatrix();
    const after = resourceProbe();
    const duplicateExecutions = [...executions.values()].filter((count) => count > 1).length;
    const fifoViolations = admittedQueuedOrder.reduce((violations, value, index) => index > 0 && value < admittedQueuedOrder[index - 1]! ? violations + 1 : violations, 0);
    const resources = { rssGrowthBytes: Math.max(0, after.rssBytes - before.rssBytes), activeHandleGrowth: Math.max(0, after.activeHandles - before.activeHandles) };
    const latencyMs = { queueP50: percentile(queueLatency, 0.5), queueP95: percentile(queueLatency, 0.95), queueP99: percentile(queueLatency, 0.99) };
    const thresholdFailures = [
      ...(resources.rssGrowthBytes > config.thresholds.maxRssGrowthBytes ? ['rss growth'] : []),
      ...(resources.activeHandleGrowth > config.thresholds.maxHandleGrowth ? ['active handle growth'] : []),
      ...(latencyMs.queueP95 > config.thresholds.p95QueueLatencyMs ? ['queue p95'] : []),
      ...(duplicateExecutions > config.thresholds.duplicateExecutions ? ['duplicate executions'] : []),
      ...(fifoViolations > 0 ? ['queue fairness'] : []),
      ...(maxGlobal > config.limits.maxGlobal ? ['global concurrency'] : []),
      ...(Object.values(maxByAgent).some((value) => value > config.limits.maxPerAgent) ? ['agent concurrency'] : []),
      ...(Object.values(maxByModel).some((value) => value > config.limits.maxPerModel) ? ['model concurrency'] : []),
      ...(Object.values(maxBySession).some((value) => value > config.limits.maxPerSession) ? ['session concurrency'] : []),
    ];
    return {
      schemaVersion: 'dat-synthetic-pressure/v1', synthetic: true, providerCalls: 0, mode: config.mode,
      dimensions: { models, agents, sessions }, observed: { maxGlobal, maxQueued, maxByAgent, maxByModel, maxBySession },
      latencyMs, resources, execution: {
        requested: config.requestCount, admittedImmediate, admittedFromQueue, queueRejected,
        completed: executions.size, cancelled, cancelledWhileQueued, duplicateExecutions, fifoViolations,
      },
      resilience, thresholds: config.thresholds, thresholdFailures, thresholdsPassed: thresholdFailures.length === 0,
    };
  }
}

async function resilienceMatrix(): Promise<SyntheticPressureReport['resilience']> {
  type Result = { success: boolean; statusCode?: number; error?: string };
  const executor = () => new ResilientCallExecutor(
    { maxAttempts: 2, baseDelayMs: 1, retryBudgetMs: 10, circuitFailureThreshold: 2 },
    { now: () => 0, random: () => 1, sleep: async () => undefined },
  );
  let calls429 = 0, callsTimeout = 0;
  await executor().execute<Result>('429', async () => ++calls429 === 1 ? { success: false, statusCode: 429 } : { success: true });
  await executor().execute<Result>('timeout', async () => ++callsTimeout === 1 ? { success: false, error: 'timed out' } : { success: true });
  const circuit = new ResilientCallExecutor({ maxAttempts: 1, circuitFailureThreshold: 2 }, { now: () => 1 });
  await circuit.execute('503', async () => ({ success: false, statusCode: 503 }));
  await circuit.execute('503', async () => ({ success: false, statusCode: 503 }));
  let saw503CircuitOpen = false;
  try { await circuit.execute('503', async () => ({ success: true })); } catch { saw503CircuitOpen = true; }
  const fallback = await new ResilientCallExecutor({ maxAttempts: 1 }).executeWithFallback<Result>(
    'primary', async () => ({ success: false, statusCode: 503 }),
    { policyId: 'synthetic-fallback/v1', key: 'fallback', operation: async () => ({ success: true }) },
  );
  let retryBudgetRejected = false;
  try {
    await new ResilientCallExecutor({ maxAttempts: 2, baseDelayMs: 10, retryBudgetMs: 1 }, { now: () => 0, random: () => 1 })
      .execute('budget', async () => ({ success: false, statusCode: 503 }));
  } catch { retryBudgetRejected = true; }
  return { saw429Retry: calls429 === 2, saw503CircuitOpen, sawTimeoutRetry: callsTimeout === 2, fallbackUsed: fallback.route === 'fallback', retryBudgetRejected };
}

function mergeMax(target: Record<string, number>, current: Record<string, number>): void {
  for (const [key, value] of Object.entries(current)) target[key] = Math.max(target[key] ?? 0, value);
}

function percentile(values: number[], ratio: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)]!;
}

function validate(config: SyntheticPressureConfig): void {
  if (!Number.isSafeInteger(config.requestCount) || config.requestCount < 2) throw new Error('requestCount must be at least 2');
  for (const [key, value] of Object.entries(config.thresholds)) if (!Number.isFinite(value) || value < 0) throw new Error(`${key} threshold is invalid`);
}
