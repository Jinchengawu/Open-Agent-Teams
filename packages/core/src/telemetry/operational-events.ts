import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type OperationalEventKind = 'usage' | 'health' | 'task' | 'attempt' | 'outcome' | 'experiment';
export type MeasurementStatus = 'measured' | 'unmeasured';
export type DataCompleteness = 'complete' | 'partial' | 'unknown';

export interface OperationalDimensions {
  tenantId: string;
  projectId: string;
  agentId?: string | null;
  modelId?: string | null;
  sessionId?: string | null;
  taskId?: string | null;
  attemptId?: string | null;
}

export interface OperationalEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  eventId: string;
  schemaVersion: '1.0';
  kind: OperationalEventKind;
  dimensions: OperationalDimensions;
  source: string;
  sourceEventId: string;
  observedAt: string;
  ingestedAt: string;
  freshnessMs: number;
  completeness: DataCompleteness;
  measurementStatus: MeasurementStatus;
  payload: TPayload;
  contentHash: string;
}

export interface CreateOperationalEventInput<TPayload extends Record<string, unknown>> {
  kind: OperationalEventKind;
  dimensions: OperationalDimensions;
  source: string;
  sourceEventId: string;
  observedAt: string;
  completeness: DataCompleteness;
  measurementStatus: MeasurementStatus;
  payload: TPayload;
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, stable(child)]));
  }
  return value;
}

export function createOperationalEvent<TPayload extends Record<string, unknown>>(
  input: CreateOperationalEventInput<TPayload>,
  dependencies: { now?: () => Date; id?: () => string } = {},
): OperationalEvent<TPayload> {
  for (const [field, value] of Object.entries({
    tenantId: input.dimensions.tenantId,
    projectId: input.dimensions.projectId,
    source: input.source,
    sourceEventId: input.sourceEventId,
  })) {
    if (!value?.trim()) throw new Error(`${field} is required`);
  }
  const observedAtMs = Date.parse(input.observedAt);
  if (!Number.isFinite(observedAtMs)) throw new Error('observedAt must be an ISO timestamp');
  if (input.measurementStatus === 'measured' && input.completeness !== 'complete') {
    throw new Error('measured events require complete source data');
  }
  if (input.kind === 'attempt' && (!input.dimensions.taskId || !input.dimensions.attemptId)) {
    throw new Error('attempt events require taskId and attemptId');
  }
  if (input.kind === 'usage' && (!input.dimensions.agentId || !input.dimensions.modelId)) {
    throw new Error('usage events require agentId and modelId');
  }
  const now = (dependencies.now ?? (() => new Date()))();
  const canonical = {
    schemaVersion: '1.0' as const, kind: input.kind, dimensions: input.dimensions,
    source: input.source, sourceEventId: input.sourceEventId,
    observedAt: new Date(observedAtMs).toISOString(), completeness: input.completeness,
    measurementStatus: input.measurementStatus, payload: input.payload,
  };
  return {
    eventId: (dependencies.id ?? randomUUID)(), ...canonical,
    ingestedAt: now.toISOString(), freshnessMs: Math.max(0, now.getTime() - observedAtMs),
    contentHash: createHash('sha256').update(JSON.stringify(stable(canonical))).digest('hex'),
  };
}

export function isOperationalEventStale(event: OperationalEvent, maximumFreshnessMs: number): boolean {
  return event.freshnessMs > maximumFreshnessMs;
}

export class DurableOperationalEventStore {
  constructor(private readonly database: Database.Database) {
    database.exec(`CREATE TABLE IF NOT EXISTS operational_events (
      event_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL,
      kind TEXT NOT NULL, source TEXT NOT NULL, source_event_id TEXT NOT NULL,
      observed_at TEXT NOT NULL, payload_json TEXT NOT NULL, content_hash TEXT NOT NULL,
      UNIQUE(tenant_id, project_id, source, source_event_id)
    ); CREATE INDEX IF NOT EXISTS idx_operational_scope_time ON operational_events(tenant_id,project_id,observed_at);`);
  }

  appendIfAbsent(event: OperationalEvent): { event: OperationalEvent; inserted: boolean } {
    const result = this.database.prepare(`INSERT OR IGNORE INTO operational_events
      (event_id,tenant_id,project_id,kind,source,source_event_id,observed_at,payload_json,content_hash)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(
      event.eventId, event.dimensions.tenantId, event.dimensions.projectId, event.kind,
      event.source, event.sourceEventId, event.observedAt, JSON.stringify(event), event.contentHash,
    );
    const row = this.database.prepare(`SELECT payload_json FROM operational_events
      WHERE tenant_id=? AND project_id=? AND source=? AND source_event_id=?`)
      .get(event.dimensions.tenantId, event.dimensions.projectId, event.source, event.sourceEventId) as { payload_json: string };
    return { event: JSON.parse(row.payload_json) as OperationalEvent, inserted: result.changes === 1 };
  }

  append(event: OperationalEvent): OperationalEvent {
    return this.appendIfAbsent(event).event;
  }

  list(tenantId: string, projectId: string): OperationalEvent[] {
    return (this.database.prepare(`SELECT payload_json FROM operational_events WHERE tenant_id=? AND project_id=? ORDER BY observed_at,event_id`)
      .all(tenantId, projectId) as Array<{ payload_json: string }>).map((row) => JSON.parse(row.payload_json) as OperationalEvent);
  }
}

/** Dual-writes durable events while preserving an existing in-process bus callback. */
export class OperationalEventCompatibilityAdapter {
  constructor(private readonly store: DurableOperationalEventStore, private readonly legacyEmit?: (event: unknown) => void) {}
  emit(event: OperationalEvent, legacyEvent?: unknown): OperationalEvent {
    const persisted = this.store.append(event);
    if (legacyEvent !== undefined) this.legacyEmit?.(legacyEvent);
    return persisted;
  }
}
