import { createHash } from 'node:crypto';
import type { DurableOperationalEventStore, OperationalEventKind } from './operational-events.js';

export interface OperationalSloPolicy {
  policyId: string;
  tenantId: string;
  projectId: string;
  kind: OperationalEventKind;
  metric: 'latency_ms' | 'success_rate';
  operator: 'lte' | 'gte';
  threshold: number;
  windowMs: number;
  maximumFreshnessMs: number;
  minimumEventCount: number;
}

export interface OperationalSloResult {
  status: 'healthy' | 'breached' | 'insufficient_data';
  value: number | null;
  eventCount: number;
  evidenceRef: string | null;
  evaluatedAt: string;
  reason?: string;
}

export class OperationalSloEvaluator {
  constructor(private readonly store: DurableOperationalEventStore, private readonly now: () => Date = () => new Date()) {}

  evaluate(policy: OperationalSloPolicy): OperationalSloResult {
    validatePolicy(policy);
    const now = this.now();
    const evidence = this.store.list(policy.tenantId, policy.projectId).filter((event) =>
      event.kind === policy.kind && event.measurementStatus === 'measured' && event.completeness === 'complete'
      && Date.parse(event.observedAt) >= now.getTime() - policy.windowMs
      && now.getTime() - Date.parse(event.observedAt) <= policy.maximumFreshnessMs
      && metricValue(policy.metric, event.payload) !== null,
    );
    if (evidence.length < policy.minimumEventCount) return {
      status: 'insufficient_data', value: null, eventCount: evidence.length, evidenceRef: null,
      evaluatedAt: now.toISOString(), reason: 'minimum measured evidence not met',
    };
    const values = evidence.map((event) => metricValue(policy.metric, event.payload)!);
    const value = values.reduce((sum, current) => sum + current, 0) / values.length;
    const healthy = policy.operator === 'lte' ? value <= policy.threshold : value >= policy.threshold;
    const evidenceRef = `sha256:${createHash('sha256').update(JSON.stringify({
      policy, eventIds: evidence.map((event) => event.eventId).sort(), value,
    })).digest('hex')}`;
    return { status: healthy ? 'healthy' : 'breached', value, eventCount: evidence.length, evidenceRef, evaluatedAt: now.toISOString() };
  }
}

function metricValue(metric: OperationalSloPolicy['metric'], payload: Record<string, unknown>): number | null {
  if (metric === 'latency_ms') return typeof payload.latencyMs === 'number' && Number.isFinite(payload.latencyMs) ? payload.latencyMs : null;
  return typeof payload.success === 'boolean' ? (payload.success ? 1 : 0) : null;
}

function validatePolicy(policy: OperationalSloPolicy): void {
  for (const [field, value] of Object.entries({ policyId: policy.policyId, tenantId: policy.tenantId, projectId: policy.projectId })) {
    if (!value.trim()) throw new Error(`${field} is required`);
  }
  if (!Number.isFinite(policy.threshold) || policy.threshold < 0) throw new Error('threshold must be non-negative');
  if (policy.metric === 'success_rate' && policy.threshold > 1) throw new Error('success_rate threshold must be between 0 and 1');
  for (const [field, value] of Object.entries({ windowMs: policy.windowMs,
    maximumFreshnessMs: policy.maximumFreshnessMs, minimumEventCount: policy.minimumEventCount })) {
    if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} must be positive`);
  }
  if (!Number.isInteger(policy.minimumEventCount)) throw new Error('minimumEventCount must be an integer');
}
