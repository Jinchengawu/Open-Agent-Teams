import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type RuntimeLifecycleKind = 'agent-app' | 'managed-worker' | 'glue-profile' | 'system-worker' | 'pipeline';
export type RuntimeLifecycleState = 'starting' | 'ready' | 'degraded' | 'stopping' | 'stopped' | 'failed' | 'quarantined';

export interface RuntimeLifecycleRecord {
  runtimeId: string; kind: RuntimeLifecycleKind; instanceId: string; generation: number;
  state: RuntimeLifecycleState; leaseStatus: 'live' | 'expired' | 'none';
  heartbeatAt: number | null; leaseExpiresAt: number | null; restartCount: number;
  cooldownUntil: number | null; reasonCode: string | null; createdAt: number; updatedAt: number;
}
export interface RuntimeShutdownReceipt {
  receiptId: string; runtimeId: string; instanceId: string; generation: number;
  requestedBy: string; childrenStopped: boolean; recordedAt: number;
}
export interface RuntimeLifecyclePort {
  begin(input: { runtimeId: string; kind: RuntimeLifecycleKind; instanceId?: string; heartbeatTtlMs: number }): RuntimeLifecycleRecord;
  transition(input: { runtimeId: string; instanceId: string; generation: number; from: RuntimeLifecycleState; to: RuntimeLifecycleState; reasonCode?: string }): RuntimeLifecycleRecord;
  heartbeat(input: { runtimeId: string; instanceId: string; generation: number; state: 'ready' | 'degraded'; ttlMs: number }): RuntimeLifecycleRecord;
  fail(input: { runtimeId: string; instanceId: string; generation: number; reasonCode: string }): RuntimeLifecycleRecord;
  inspect(runtimeId: string): RuntimeLifecycleRecord | undefined;
  requestRestart(input: { runtimeId: string; maxRestarts: number; cooldownMs: number }): RuntimeRestartDecision;
  recordShutdown(input: Omit<RuntimeShutdownReceipt, 'receiptId' | 'recordedAt'>): RuntimeShutdownReceipt;
}
export type RuntimeRestartDecision =
  | { allowed: true; restartCount: number; retryAt: number }
  | { allowed: false; reason: 'cooldown'; retryAt: number }
  | { allowed: false; reason: 'budget-exhausted' };

const LEGAL: Readonly<Record<RuntimeLifecycleState, readonly RuntimeLifecycleState[]>> = {
  starting: ['ready', 'degraded', 'failed', 'stopping'], ready: ['degraded', 'stopping', 'failed'],
  degraded: ['ready', 'stopping', 'failed', 'quarantined'], stopping: ['stopped', 'failed'],
  stopped: ['starting'], failed: ['starting', 'quarantined', 'stopping'], quarantined: ['stopping'],
};

export class RuntimeLifecycleConflictError extends Error {
  readonly code = 'RUNTIME_LIFECYCLE_CONFLICT';
  constructor(message: string) { super(message); this.name = 'RuntimeLifecycleConflictError'; }
}

export class SqliteRuntimeLifecycleStore implements RuntimeLifecyclePort {
  private readonly now: () => number;
  constructor(private readonly database: Database.Database, options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now; this.initialize();
  }

  begin(input: { runtimeId: string; kind: RuntimeLifecycleKind; instanceId?: string; heartbeatTtlMs: number }): RuntimeLifecycleRecord {
    requireText(input.runtimeId, 'runtimeId'); requirePositive(input.heartbeatTtlMs, 'heartbeatTtlMs');
    const now = this.now(); const instanceId = input.instanceId ?? randomUUID();
    return this.database.transaction(() => {
      const prior = this.raw(input.runtimeId);
      const priorLeaseExpired = prior?.lease_expires_at !== null && Number(prior?.lease_expires_at) <= now;
      if (prior && !priorLeaseExpired && !['stopped', 'failed', 'quarantined'].includes(String(prior.state))) {
        throw new RuntimeLifecycleConflictError(`runtime ${input.runtimeId} already has an active generation`);
      }
      const generation = prior ? Number(prior.generation) + 1 : 1;
      this.database.prepare(`INSERT INTO runtime_lifecycle
        (runtime_id,kind,instance_id,generation,state,heartbeat_at,lease_expires_at,restart_count,cooldown_until,reason_code,created_at,updated_at)
        VALUES (?,?,?,?, 'starting', ?, ?, ?, NULL,NULL,?,?)
        ON CONFLICT(runtime_id) DO UPDATE SET kind=excluded.kind,instance_id=excluded.instance_id,generation=excluded.generation,
          state='starting',heartbeat_at=excluded.heartbeat_at,lease_expires_at=excluded.lease_expires_at,
          reason_code=NULL,updated_at=excluded.updated_at`)
        .run(input.runtimeId, input.kind, instanceId, generation, now, now + input.heartbeatTtlMs, prior ? Number(prior.restart_count) : 0, now, now);
      return this.read(input.runtimeId)!;
    })();
  }

  transition(input: { runtimeId: string; instanceId: string; generation: number; from: RuntimeLifecycleState; to: RuntimeLifecycleState; reasonCode?: string }): RuntimeLifecycleRecord {
    if (!LEGAL[input.from].includes(input.to)) throw new RuntimeLifecycleConflictError(`illegal lifecycle transition ${input.from} -> ${input.to}`);
    const result = this.database.prepare(`UPDATE runtime_lifecycle SET state=?,reason_code=?,updated_at=?
      WHERE runtime_id=? AND instance_id=? AND generation=? AND state=?`)
      .run(input.to, input.reasonCode ?? null, this.now(), input.runtimeId, input.instanceId, input.generation, input.from);
    if (result.changes !== 1) throw new RuntimeLifecycleConflictError('stale runtime identity, generation, or state');
    return this.read(input.runtimeId)!;
  }

  heartbeat(input: { runtimeId: string; instanceId: string; generation: number; state: 'ready' | 'degraded'; ttlMs: number }): RuntimeLifecycleRecord {
    requirePositive(input.ttlMs, 'ttlMs'); const now = this.now();
    const result = this.database.prepare(`UPDATE runtime_lifecycle SET state=?,heartbeat_at=?,lease_expires_at=?,updated_at=?
      WHERE runtime_id=? AND instance_id=? AND generation=? AND state NOT IN ('stopped','quarantined')`)
      .run(input.state, now, now + input.ttlMs, now, input.runtimeId, input.instanceId, input.generation);
    if (result.changes !== 1) throw new RuntimeLifecycleConflictError('stale runtime heartbeat');
    return this.read(input.runtimeId)!;
  }

  fail(input: { runtimeId: string; instanceId: string; generation: number; reasonCode: string }): RuntimeLifecycleRecord {
    requireText(input.reasonCode, 'reasonCode');
    const result = this.database.prepare(`UPDATE runtime_lifecycle SET state='failed',reason_code=?,updated_at=?
      WHERE runtime_id=? AND instance_id=? AND generation=? AND state NOT IN ('stopped','quarantined')`)
      .run(input.reasonCode, this.now(), input.runtimeId, input.instanceId, input.generation);
    if (result.changes !== 1) throw new RuntimeLifecycleConflictError('stale runtime failure binding');
    return this.read(input.runtimeId)!;
  }

  inspect(runtimeId: string): RuntimeLifecycleRecord | undefined { return this.read(runtimeId); }

  requestRestart(input: { runtimeId: string; maxRestarts: number; cooldownMs: number }): RuntimeRestartDecision {
    requireText(input.runtimeId, 'runtimeId');
    if (!Number.isSafeInteger(input.maxRestarts) || input.maxRestarts < 0) throw new Error('maxRestarts must be a non-negative integer');
    if (!Number.isFinite(input.cooldownMs) || input.cooldownMs < 0) throw new Error('cooldownMs must be non-negative');
    return this.database.transaction((): RuntimeRestartDecision => {
      const row = this.raw(input.runtimeId); if (!row) throw new Error(`runtime ${input.runtimeId} not found`);
      const now = this.now(); const cooldownUntil = row.cooldown_until === null ? null : Number(row.cooldown_until);
      if (cooldownUntil !== null && now < cooldownUntil) return { allowed: false, reason: 'cooldown', retryAt: cooldownUntil };
      const count = Number(row.restart_count);
      if (count >= input.maxRestarts) return { allowed: false, reason: 'budget-exhausted' };
      const retryAt = now + input.cooldownMs;
      const updated = this.database.prepare(`UPDATE runtime_lifecycle
        SET restart_count=restart_count+1,cooldown_until=?,updated_at=?
        WHERE runtime_id=? AND restart_count=? AND restart_count<?
          AND (cooldown_until IS NULL OR cooldown_until<=?)`)
        .run(retryAt, now, input.runtimeId, count, input.maxRestarts, now);
      if (updated.changes === 1) return { allowed: true, restartCount: count + 1, retryAt };
      const winner = this.raw(input.runtimeId)!;
      const winnerCooldown = winner.cooldown_until === null ? null : Number(winner.cooldown_until);
      if (winnerCooldown !== null && now < winnerCooldown) return { allowed: false, reason: 'cooldown', retryAt: winnerCooldown };
      return { allowed: false, reason: 'budget-exhausted' };
    })();
  }

  recordShutdown(input: Omit<RuntimeShutdownReceipt, 'receiptId' | 'recordedAt'>): RuntimeShutdownReceipt {
    const bound = this.raw(input.runtimeId);
    if (!bound || String(bound.instance_id) !== input.instanceId || Number(bound.generation) !== input.generation
      || !['stopped', 'quarantined'].includes(String(bound.state))) {
      throw new RuntimeLifecycleConflictError('shutdown receipt requires the bound runtime terminal state');
    }
    const existing = this.getShutdownReceipt(input.runtimeId);
    if (existing && existing.instanceId === input.instanceId && existing.generation === input.generation
      && existing.requestedBy === input.requestedBy && existing.childrenStopped === input.childrenStopped) return existing;
    const receipt = { ...input, receiptId: randomUUID(), recordedAt: this.now() };
    this.database.prepare(`INSERT INTO runtime_shutdown_receipts
      (receipt_id,runtime_id,instance_id,generation,requested_by,children_stopped,recorded_at) VALUES (?,?,?,?,?,?,?)`)
      .run(receipt.receiptId, receipt.runtimeId, receipt.instanceId, receipt.generation, receipt.requestedBy, receipt.childrenStopped ? 1 : 0, receipt.recordedAt);
    return receipt;
  }
  getShutdownReceipt(runtimeId: string): RuntimeShutdownReceipt | undefined {
    const row = this.database.prepare(`SELECT * FROM runtime_shutdown_receipts WHERE runtime_id=? ORDER BY recorded_at DESC,receipt_id DESC LIMIT 1`).get(runtimeId) as Record<string, unknown> | undefined;
    return row ? { receiptId: String(row.receipt_id), runtimeId: String(row.runtime_id), instanceId: String(row.instance_id), generation: Number(row.generation), requestedBy: String(row.requested_by), childrenStopped: Boolean(row.children_stopped), recordedAt: Number(row.recorded_at) } : undefined;
  }

  private read(runtimeId: string): RuntimeLifecycleRecord | undefined {
    const row = this.raw(runtimeId); if (!row) return undefined;
    const now = this.now(); const expires = row.lease_expires_at === null ? null : Number(row.lease_expires_at);
    const expired = expires !== null && expires <= now;
    const state = expired && ['starting', 'ready'].includes(String(row.state)) ? 'degraded' : String(row.state) as RuntimeLifecycleState;
    return { runtimeId: String(row.runtime_id), kind: String(row.kind) as RuntimeLifecycleKind, instanceId: String(row.instance_id), generation: Number(row.generation), state,
      leaseStatus: expires === null ? 'none' : expired ? 'expired' : 'live', heartbeatAt: row.heartbeat_at === null ? null : Number(row.heartbeat_at), leaseExpiresAt: expires,
      restartCount: Number(row.restart_count), cooldownUntil: row.cooldown_until === null ? null : Number(row.cooldown_until), reasonCode: row.reason_code === null ? null : String(row.reason_code),
      createdAt: Number(row.created_at), updatedAt: Number(row.updated_at) };
  }
  private raw(runtimeId: string): Record<string, unknown> | undefined { return this.database.prepare(`SELECT * FROM runtime_lifecycle WHERE runtime_id=?`).get(runtimeId) as Record<string, unknown> | undefined; }
  private initialize(): void { this.database.exec(`
    CREATE TABLE IF NOT EXISTS runtime_lifecycle (runtime_id TEXT PRIMARY KEY,kind TEXT NOT NULL,instance_id TEXT NOT NULL,generation INTEGER NOT NULL,state TEXT NOT NULL,
      heartbeat_at INTEGER,lease_expires_at INTEGER,restart_count INTEGER NOT NULL DEFAULT 0,cooldown_until INTEGER,reason_code TEXT,created_at INTEGER NOT NULL,updated_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS runtime_shutdown_receipts (receipt_id TEXT PRIMARY KEY,runtime_id TEXT NOT NULL,instance_id TEXT NOT NULL,generation INTEGER NOT NULL,
      requested_by TEXT NOT NULL,children_stopped INTEGER NOT NULL,recorded_at INTEGER NOT NULL);`); }
}
function requireText(value: string, field: string): void { if (!value?.trim()) throw new Error(`${field} is required`); }
function requirePositive(value: number, field: string): void { if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} must be positive`); }
