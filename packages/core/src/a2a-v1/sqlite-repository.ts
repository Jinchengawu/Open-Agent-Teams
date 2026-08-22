import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { validateA2AV1 } from './schemas.js';
import { evaluateA2ATaskTransition } from './task-state.js';
import type { A2AV1Artifact, A2AV1Message, A2AV1Task } from './types.js';

export interface A2AV1TaskSnapshotCommand {
  tenantId: string;
  idempotencyKey: string;
  task: A2AV1Task;
}

export interface A2AV1AcceptedSnapshot {
  applied: boolean;
  taskId: string;
  outboxEventId: string;
}

export interface A2AV1TaskEvent {
  cursor: number;
  tenantId: string;
  taskId: string;
  idempotencyKey: string;
  acceptedAt: number;
  task: A2AV1Task;
}

export interface A2AV1OutboxEvent {
  id: string;
  tenantId: string;
  topic: 'a2a.task.snapshot-accepted';
  aggregateId: string;
  idempotencyKey: string;
  payload: Record<string, unknown>;
  createdAt: number;
  dispatchedAt?: number;
}

export interface A2AV1OutboxLease extends A2AV1OutboxEvent {
  leaseOwner: string;
  leaseToken: string;
  leaseExpiresAt: number;
  attemptCount: number;
}

export interface A2AV1ClaimOutboxInput {
  tenantId: string;
  workerId: string;
  now: number;
  leaseMs: number;
  limit: number;
  maxAttempts: number;
}

export interface A2AV1AckOutboxLeaseInput {
  tenantId: string;
  eventId: string;
  workerId: string;
  leaseToken: string;
  dispatchedAt: number;
}

export interface A2AV1FailOutboxLeaseInput {
  tenantId: string;
  eventId: string;
  workerId: string;
  leaseToken: string;
  failedAt: number;
  error: string;
  baseDelayMs: number;
  maxDelayMs: number;
  maxAttempts: number;
}

export type A2AV1FailOutboxLeaseResult =
  | { status: 'retry-scheduled'; attemptCount: number; nextAttemptAt: number }
  | { status: 'dead-lettered'; attemptCount: number }
  | { status: 'lease-lost' };

export interface A2AV1DeadLetterEvent extends A2AV1OutboxEvent {
  attemptCount: number;
  deadLetteredAt: number;
  lastError: string;
}

export class A2AV1IdempotencyConflictError extends Error {
  readonly code = 'A2A_IDEMPOTENCY_CONFLICT';

  constructor(tenantId: string, idempotencyKey: string) {
    super(`A2A idempotency key already has a different binding: ${tenantId}/${idempotencyKey}`);
    this.name = 'A2AV1IdempotencyConflictError';
  }
}

export class SqliteA2AV1Repository {
  private readonly now: () => number;

  constructor(
    private readonly database: Database.Database,
    options: { now?: () => number } = {},
  ) {
    this.now = options.now ?? Date.now;
    this.initializeSchema();
  }

  acceptTaskSnapshot(command: A2AV1TaskSnapshotCommand): A2AV1AcceptedSnapshot {
    assertNonEmpty(command.tenantId, 'tenantId');
    assertNonEmpty(command.idempotencyKey, 'idempotencyKey');
    const validation = validateA2AV1('task', command.task);
    if (!validation.valid) {
      throw new Error(`A2A v1 Task is invalid: ${validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
    }
    const acceptedAt = this.now();
    const outboxEventId = `a2a-outbox-${randomUUID()}`;
    const payload = { task: command.task };
    const commandHash = sha256(stableJson(command.task));

    return this.database.transaction((): A2AV1AcceptedSnapshot => {
      const prior = this.database.prepare(`
        SELECT command_hash, task_id, outbox_event_id
        FROM a2a_v1_inbox
        WHERE tenant_id = ? AND idempotency_key = ?
      `).get(command.tenantId, command.idempotencyKey) as {
        command_hash: string;
        task_id: string;
        outbox_event_id: string;
      } | undefined;
      if (prior) {
        if (prior.command_hash !== commandHash || prior.task_id !== command.task.id) {
          throw new A2AV1IdempotencyConflictError(command.tenantId, command.idempotencyKey);
        }
        return {
          applied: false,
          taskId: prior.task_id,
          outboxEventId: prior.outbox_event_id,
        };
      }

      const current = this.database.prepare(`
        SELECT state FROM a2a_v1_tasks WHERE tenant_id = ? AND task_id = ?
      `).get(command.tenantId, command.task.id) as { state: A2AV1Task['status']['state'] } | undefined;
      if (!current && command.task.status.state !== 'TASK_STATE_SUBMITTED') {
        throw new Error('An initial durable A2A Task snapshot must be TASK_STATE_SUBMITTED');
      }
      if (current) {
        const decision = evaluateA2ATaskTransition(current.state, command.task.status.state);
        if (!decision.allowed) {
          throw new Error(`A2A Task transition rejected: ${current.state} -> ${command.task.status.state} (${decision.reason})`);
        }
      }

      this.database.prepare(`
        INSERT INTO a2a_v1_tasks (tenant_id, task_id, state, snapshot_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (tenant_id, task_id) DO UPDATE SET
          state = excluded.state,
          snapshot_json = excluded.snapshot_json,
          updated_at = excluded.updated_at
      `).run(command.tenantId, command.task.id, command.task.status.state, JSON.stringify(command.task), acceptedAt, acceptedAt);
      this.database.prepare(`
        INSERT INTO a2a_v1_task_history
          (tenant_id, task_id, state, snapshot_json, idempotency_key, accepted_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        command.tenantId,
        command.task.id,
        command.task.status.state,
        JSON.stringify(command.task),
        command.idempotencyKey,
        acceptedAt,
      );
      for (const message of command.task.history ?? []) {
        this.database.prepare(`
          INSERT INTO a2a_v1_messages
            (tenant_id, task_id, message_id, payload_json, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (tenant_id, task_id, message_id) DO UPDATE SET
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at
        `).run(command.tenantId, command.task.id, message.messageId, JSON.stringify(message), acceptedAt);
      }
      for (const artifact of command.task.artifacts ?? []) {
        this.database.prepare(`
          INSERT INTO a2a_v1_artifacts
            (tenant_id, task_id, artifact_id, payload_json, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (tenant_id, task_id, artifact_id) DO UPDATE SET
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at
        `).run(command.tenantId, command.task.id, artifact.artifactId, JSON.stringify(artifact), acceptedAt);
      }
      this.database.prepare(`
        INSERT INTO a2a_v1_inbox
          (tenant_id, idempotency_key, command_hash, task_id, outbox_event_id, accepted_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        command.tenantId,
        command.idempotencyKey,
        commandHash,
        command.task.id,
        outboxEventId,
        acceptedAt,
      );
      this.database.prepare(`
        INSERT INTO a2a_v1_outbox
          (event_id, tenant_id, topic, aggregate_id, idempotency_key, payload_json, created_at)
        VALUES (?, ?, 'a2a.task.snapshot-accepted', ?, ?, ?, ?)
      `).run(
        outboxEventId,
        command.tenantId,
        command.task.id,
        command.idempotencyKey,
        JSON.stringify(payload),
        acceptedAt,
      );
      return { applied: true, taskId: command.task.id, outboxEventId };
    })();
  }

  getTask(tenantId: string, taskId: string): A2AV1Task | undefined {
    const row = this.database.prepare(`
      SELECT snapshot_json FROM a2a_v1_tasks WHERE tenant_id = ? AND task_id = ?
    `).get(tenantId, taskId) as { snapshot_json: string } | undefined;
    return row ? JSON.parse(row.snapshot_json) as A2AV1Task : undefined;
  }

  listTasks(tenantId: string): A2AV1Task[] {
    const rows = this.database.prepare(`
      SELECT snapshot_json
      FROM a2a_v1_tasks
      WHERE tenant_id = ?
      ORDER BY created_at ASC, task_id ASC
    `).all(tenantId) as Array<{ snapshot_json: string }>;
    return rows.map((row) => JSON.parse(row.snapshot_json) as A2AV1Task);
  }

  getTaskHistory(tenantId: string, taskId: string): A2AV1Task[] {
    const rows = this.database.prepare(`
      SELECT snapshot_json
      FROM a2a_v1_task_history
      WHERE tenant_id = ? AND task_id = ?
      ORDER BY sequence ASC
    `).all(tenantId, taskId) as Array<{ snapshot_json: string }>;
    return rows.map((row) => JSON.parse(row.snapshot_json) as A2AV1Task);
  }

  listTaskEvents(input: {
    tenantId: string;
    taskId: string;
    afterCursor?: number;
    limit?: number;
  }): A2AV1TaskEvent[] {
    assertNonEmpty(input.tenantId, 'tenantId');
    assertNonEmpty(input.taskId, 'taskId');
    const afterCursor = input.afterCursor ?? 0;
    const limit = input.limit ?? 100;
    if (!Number.isSafeInteger(afterCursor) || afterCursor < 0) throw new Error('afterCursor must be a non-negative integer');
    assertPositiveInteger(limit, 'limit');
    const rows = this.database.prepare(`
      SELECT sequence, tenant_id, task_id, idempotency_key, accepted_at, snapshot_json
      FROM a2a_v1_task_history
      WHERE tenant_id = ? AND task_id = ? AND sequence > ?
      ORDER BY sequence ASC
      LIMIT ?
    `).all(input.tenantId, input.taskId, afterCursor, limit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      cursor: Number(row.sequence),
      tenantId: String(row.tenant_id),
      taskId: String(row.task_id),
      idempotencyKey: String(row.idempotency_key),
      acceptedAt: Number(row.accepted_at),
      task: JSON.parse(String(row.snapshot_json)) as A2AV1Task,
    }));
  }

  listMessages(tenantId: string, taskId: string): A2AV1Message[] {
    const rows = this.database.prepare(`
      SELECT payload_json
      FROM a2a_v1_messages
      WHERE tenant_id = ? AND task_id = ?
      ORDER BY sequence ASC
    `).all(tenantId, taskId) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as A2AV1Message);
  }

  listArtifacts(tenantId: string, taskId: string): A2AV1Artifact[] {
    const rows = this.database.prepare(`
      SELECT payload_json
      FROM a2a_v1_artifacts
      WHERE tenant_id = ? AND task_id = ?
      ORDER BY sequence ASC
    `).all(tenantId, taskId) as Array<{ payload_json: string }>;
    return rows.map((row) => JSON.parse(row.payload_json) as A2AV1Artifact);
  }

  listPendingOutbox(tenantId: string): A2AV1OutboxEvent[] {
    const rows = this.database.prepare(`
      SELECT event_id, tenant_id, topic, aggregate_id, idempotency_key,
             payload_json, created_at, dispatched_at
      FROM a2a_v1_outbox
      WHERE tenant_id = ? AND dispatched_at IS NULL AND dead_lettered_at IS NULL
      ORDER BY created_at ASC, event_id ASC
    `).all(tenantId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.event_id),
      tenantId: String(row.tenant_id),
      topic: 'a2a.task.snapshot-accepted',
      aggregateId: String(row.aggregate_id),
      idempotencyKey: String(row.idempotency_key),
      payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
      createdAt: Number(row.created_at),
      ...(row.dispatched_at === null ? {} : { dispatchedAt: Number(row.dispatched_at) }),
    }));
  }

  claimPendingOutbox(input: A2AV1ClaimOutboxInput): A2AV1OutboxLease[] {
    assertNonEmpty(input.tenantId, 'tenantId');
    assertNonEmpty(input.workerId, 'workerId');
    assertPositiveInteger(input.leaseMs, 'leaseMs');
    assertPositiveInteger(input.limit, 'limit');
    assertPositiveInteger(input.maxAttempts, 'maxAttempts');
    assertTimestamp(input.now, 'now');

    return this.database.transaction(() => {
      this.database.prepare(`
        UPDATE a2a_v1_outbox
        SET dead_lettered_at = ?,
            last_error = COALESCE(last_error, 'lease expired after maximum attempts'),
            lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
        WHERE tenant_id = ?
          AND dispatched_at IS NULL
          AND dead_lettered_at IS NULL
          AND attempt_count >= ?
          AND lease_expires_at IS NOT NULL
          AND lease_expires_at <= ?
      `).run(input.now, input.tenantId, input.maxAttempts, input.now);
      const candidates = this.database.prepare(`
        SELECT event_id
        FROM a2a_v1_outbox
        WHERE tenant_id = ?
          AND dispatched_at IS NULL
          AND dead_lettered_at IS NULL
          AND attempt_count < ?
          AND next_attempt_at <= ?
          AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
        ORDER BY created_at ASC, event_id ASC
        LIMIT ?
      `).all(input.tenantId, input.maxAttempts, input.now, input.now, input.limit) as Array<{ event_id: string }>;
      const leases: A2AV1OutboxLease[] = [];
      for (const candidate of candidates) {
        const leaseToken = randomUUID();
        const leaseExpiresAt = input.now + input.leaseMs;
        const claimed = this.database.prepare(`
          UPDATE a2a_v1_outbox
          SET lease_owner = ?, lease_token = ?, lease_expires_at = ?, attempt_count = attempt_count + 1
          WHERE tenant_id = ? AND event_id = ?
            AND dispatched_at IS NULL
            AND dead_lettered_at IS NULL
            AND attempt_count < ?
            AND next_attempt_at <= ?
            AND (lease_expires_at IS NULL OR lease_expires_at <= ?)
        `).run(
          input.workerId,
          leaseToken,
          leaseExpiresAt,
          input.tenantId,
          candidate.event_id,
          input.maxAttempts,
          input.now,
          input.now,
        );
        if (claimed.changes !== 1) continue;
        const row = this.database.prepare(`
          SELECT event_id, tenant_id, topic, aggregate_id, idempotency_key, payload_json,
                 created_at, dispatched_at, lease_owner, lease_token, lease_expires_at, attempt_count
          FROM a2a_v1_outbox WHERE tenant_id = ? AND event_id = ?
        `).get(input.tenantId, candidate.event_id) as Record<string, unknown>;
        leases.push(mapOutboxLease(row));
      }
      return leases;
    })();
  }

  ackOutboxLease(input: A2AV1AckOutboxLeaseInput): boolean {
    validateLeaseIdentity(input);
    assertTimestamp(input.dispatchedAt, 'dispatchedAt');
    const result = this.database.prepare(`
      UPDATE a2a_v1_outbox
      SET dispatched_at = ?, lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
      WHERE tenant_id = ? AND event_id = ?
        AND lease_owner = ? AND lease_token = ?
        AND dispatched_at IS NULL AND dead_lettered_at IS NULL
    `).run(input.dispatchedAt, input.tenantId, input.eventId, input.workerId, input.leaseToken);
    return result.changes === 1;
  }

  failOutboxLease(input: A2AV1FailOutboxLeaseInput): A2AV1FailOutboxLeaseResult {
    validateLeaseIdentity(input);
    assertNonEmpty(input.error, 'error');
    assertTimestamp(input.failedAt, 'failedAt');
    assertPositiveInteger(input.baseDelayMs, 'baseDelayMs');
    assertPositiveInteger(input.maxDelayMs, 'maxDelayMs');
    assertPositiveInteger(input.maxAttempts, 'maxAttempts');
    if (input.maxDelayMs < input.baseDelayMs) throw new Error('maxDelayMs must be greater than or equal to baseDelayMs');

    return this.database.transaction((): A2AV1FailOutboxLeaseResult => {
      const row = this.database.prepare(`
        SELECT attempt_count
        FROM a2a_v1_outbox
        WHERE tenant_id = ? AND event_id = ?
          AND lease_owner = ? AND lease_token = ?
          AND dispatched_at IS NULL AND dead_lettered_at IS NULL
      `).get(input.tenantId, input.eventId, input.workerId, input.leaseToken) as { attempt_count: number } | undefined;
      if (!row) return { status: 'lease-lost' };
      if (row.attempt_count >= input.maxAttempts) {
        const result = this.database.prepare(`
          UPDATE a2a_v1_outbox
          SET dead_lettered_at = ?, last_error = ?,
              lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
          WHERE tenant_id = ? AND event_id = ? AND lease_owner = ? AND lease_token = ?
            AND dispatched_at IS NULL AND dead_lettered_at IS NULL
        `).run(input.failedAt, input.error, input.tenantId, input.eventId, input.workerId, input.leaseToken);
        return result.changes === 1
          ? { status: 'dead-lettered', attemptCount: row.attempt_count }
          : { status: 'lease-lost' };
      }
      const delay = Math.min(input.maxDelayMs, input.baseDelayMs * (2 ** (row.attempt_count - 1)));
      const nextAttemptAt = input.failedAt + delay;
      const result = this.database.prepare(`
        UPDATE a2a_v1_outbox
        SET next_attempt_at = ?, last_error = ?,
            lease_owner = NULL, lease_token = NULL, lease_expires_at = NULL
        WHERE tenant_id = ? AND event_id = ? AND lease_owner = ? AND lease_token = ?
          AND dispatched_at IS NULL AND dead_lettered_at IS NULL
      `).run(nextAttemptAt, input.error, input.tenantId, input.eventId, input.workerId, input.leaseToken);
      return result.changes === 1
        ? { status: 'retry-scheduled', attemptCount: row.attempt_count, nextAttemptAt }
        : { status: 'lease-lost' };
    })();
  }

  listDeadLetterOutbox(tenantId: string): A2AV1DeadLetterEvent[] {
    assertNonEmpty(tenantId, 'tenantId');
    const rows = this.database.prepare(`
      SELECT event_id, tenant_id, topic, aggregate_id, idempotency_key, payload_json,
             created_at, dispatched_at, attempt_count, dead_lettered_at, last_error
      FROM a2a_v1_outbox
      WHERE tenant_id = ? AND dead_lettered_at IS NOT NULL
      ORDER BY dead_lettered_at ASC, event_id ASC
    `).all(tenantId) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      ...mapOutboxEvent(row),
      attemptCount: Number(row.attempt_count),
      deadLetteredAt: Number(row.dead_lettered_at),
      lastError: String(row.last_error),
    }));
  }

  markOutboxDispatched(tenantId: string, eventId: string, dispatchedAt = this.now()): boolean {
    assertNonEmpty(tenantId, 'tenantId');
    assertNonEmpty(eventId, 'eventId');
    if (!Number.isFinite(dispatchedAt) || dispatchedAt < 0) throw new Error('dispatchedAt must be a non-negative timestamp');
    const result = this.database.prepare(`
      UPDATE a2a_v1_outbox
      SET dispatched_at = ?
      WHERE tenant_id = ? AND event_id = ? AND dispatched_at IS NULL
    `).run(dispatchedAt, tenantId, eventId);
    return result.changes === 1;
  }

  private initializeSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS a2a_v1_tasks (
        tenant_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        state TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, task_id)
      );
      CREATE TABLE IF NOT EXISTS a2a_v1_inbox (
        tenant_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        command_hash TEXT NOT NULL,
        task_id TEXT NOT NULL,
        outbox_event_id TEXT NOT NULL,
        accepted_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, idempotency_key)
      );
      CREATE TABLE IF NOT EXISTS a2a_v1_task_history (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        state TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        accepted_at INTEGER NOT NULL,
        UNIQUE (tenant_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_a2a_v1_task_history
        ON a2a_v1_task_history (tenant_id, task_id, sequence);
      CREATE TABLE IF NOT EXISTS a2a_v1_messages (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        message_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (tenant_id, task_id, message_id)
      );
      CREATE INDEX IF NOT EXISTS idx_a2a_v1_messages_task
        ON a2a_v1_messages (tenant_id, task_id, sequence);
      CREATE TABLE IF NOT EXISTS a2a_v1_artifacts (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        artifact_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (tenant_id, task_id, artifact_id)
      );
      CREATE INDEX IF NOT EXISTS idx_a2a_v1_artifacts_task
        ON a2a_v1_artifacts (tenant_id, task_id, sequence);
      CREATE TABLE IF NOT EXISTS a2a_v1_outbox (
        event_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        topic TEXT NOT NULL,
        aggregate_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        dispatched_at INTEGER,
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_attempt_at INTEGER NOT NULL DEFAULT 0,
        lease_owner TEXT,
        lease_token TEXT,
        lease_expires_at INTEGER,
        dead_lettered_at INTEGER,
        last_error TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_a2a_v1_outbox_pending
        ON a2a_v1_outbox (tenant_id, dispatched_at, created_at);
    `);
    this.ensureOutboxColumns();
    this.database.exec(`
      CREATE INDEX IF NOT EXISTS idx_a2a_v1_outbox_claimable
        ON a2a_v1_outbox
          (tenant_id, dispatched_at, dead_lettered_at, next_attempt_at, lease_expires_at, created_at);
    `);
  }

  private ensureOutboxColumns(): void {
    const columns = new Set((this.database.prepare('PRAGMA table_info(a2a_v1_outbox)').all() as Array<{ name: string }>).map((column) => column.name));
    const migrations = [
      ['attempt_count', 'INTEGER NOT NULL DEFAULT 0'],
      ['next_attempt_at', 'INTEGER NOT NULL DEFAULT 0'],
      ['lease_owner', 'TEXT'],
      ['lease_token', 'TEXT'],
      ['lease_expires_at', 'INTEGER'],
      ['dead_lettered_at', 'INTEGER'],
      ['last_error', 'TEXT'],
    ] as const;
    for (const [name, definition] of migrations) {
      if (!columns.has(name)) this.database.exec(`ALTER TABLE a2a_v1_outbox ADD COLUMN ${name} ${definition}`);
    }
  }
}

function assertNonEmpty(value: string, field: string): void {
  if (!value?.trim()) throw new Error(`${field} is required`);
}

function assertPositiveInteger(value: number, field: string): void {
  if (!Number.isInteger(value) || value <= 0) throw new Error(`${field} must be a positive integer`);
}

function assertTimestamp(value: number, field: string): void {
  if (!Number.isFinite(value) || value < 0) throw new Error(`${field} must be a non-negative timestamp`);
}

function validateLeaseIdentity(input: { tenantId: string; eventId: string; workerId: string; leaseToken: string }): void {
  assertNonEmpty(input.tenantId, 'tenantId');
  assertNonEmpty(input.eventId, 'eventId');
  assertNonEmpty(input.workerId, 'workerId');
  assertNonEmpty(input.leaseToken, 'leaseToken');
}

function mapOutboxEvent(row: Record<string, unknown>): A2AV1OutboxEvent {
  return {
    id: String(row.event_id),
    tenantId: String(row.tenant_id),
    topic: 'a2a.task.snapshot-accepted',
    aggregateId: String(row.aggregate_id),
    idempotencyKey: String(row.idempotency_key),
    payload: JSON.parse(String(row.payload_json)) as Record<string, unknown>,
    createdAt: Number(row.created_at),
    ...(row.dispatched_at === null || row.dispatched_at === undefined ? {} : { dispatchedAt: Number(row.dispatched_at) }),
  };
}

function mapOutboxLease(row: Record<string, unknown>): A2AV1OutboxLease {
  return {
    ...mapOutboxEvent(row),
    leaseOwner: String(row.lease_owner),
    leaseToken: String(row.lease_token),
    leaseExpiresAt: Number(row.lease_expires_at),
    attemptCount: Number(row.attempt_count),
  };
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
