import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type DurableDispatchWaiterStatus = 'waiting' | 'leased' | 'completed' | 'failed';

export interface DurableDispatchWaiter {
  instanceId: string;
  executionNodeId: string;
  workItemId: string;
  attemptId: string;
  status: DurableDispatchWaiterStatus;
  consumerId?: string;
  leaseToken?: string;
  leaseExpiresAt?: number;
  resultRef?: string;
  errorRef?: string;
  createdAt: number;
  updatedAt: number;
}

interface WaiterRow {
  instance_id: string;
  execution_node_id: string;
  work_item_id: string;
  attempt_id: string;
  status: DurableDispatchWaiterStatus;
  consumer_id: string | null;
  lease_token: string | null;
  lease_expires_at: number | null;
  result_ref: string | null;
  error_ref: string | null;
  created_at: number;
  updated_at: number;
}

export class DurableDispatchWaiterStore {
  constructor(
    private readonly database: Database.Database,
    private readonly now: () => number = Date.now,
  ) {
    this.initializeSchema();
  }

  subscribe(input: {
    instanceId: string;
    executionNodeId: string;
    workItemId: string;
    attemptId: string;
  }): DurableDispatchWaiter {
    for (const [name, value] of Object.entries(input)) requireText(name, value);
    const existing = this.getRow(input.workItemId, input.attemptId);
    if (existing) {
      if (existing.instance_id === input.instanceId && existing.execution_node_id === input.executionNodeId) {
        return toWaiter(existing, false);
      }
      throw new Error(`Dispatch waiter ${input.workItemId}/${input.attemptId} already has a different subscriber`);
    }
    const now = this.now();
    this.database.prepare(`
      INSERT INTO pipeline_dispatch_waiters
        (instance_id, execution_node_id, work_item_id, attempt_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'waiting', ?, ?)
    `).run(input.instanceId, input.executionNodeId, input.workItemId, input.attemptId, now, now);
    return this.requireWaiter(input.workItemId, input.attemptId);
  }

  poll(workItemId: string, attemptId: string): DurableDispatchWaiter | undefined {
    const row = this.getRow(workItemId, attemptId);
    return row ? toWaiter(row, false) : undefined;
  }

  claim(input: {
    workItemId: string;
    attemptId: string;
    consumerId: string;
    leaseMs: number;
  }): DurableDispatchWaiter | undefined {
    requireText('consumerId', input.consumerId);
    if (!Number.isSafeInteger(input.leaseMs) || input.leaseMs < 1) throw new Error('leaseMs must be a positive integer');
    const now = this.now();
    const leaseToken = randomUUID();
    const result = this.database.prepare(`
      UPDATE pipeline_dispatch_waiters
      SET status = 'leased', consumer_id = ?, lease_token = ?, lease_expires_at = ?, updated_at = ?
      WHERE work_item_id = ? AND attempt_id = ?
        AND status IN ('waiting', 'leased')
        AND (lease_token IS NULL OR lease_expires_at <= ?)
    `).run(
      input.consumerId, leaseToken, now + input.leaseMs, now,
      input.workItemId, input.attemptId, now,
    );
    return result.changes === 1 ? this.requireWaiter(input.workItemId, input.attemptId) : undefined;
  }

  complete(input: {
    workItemId: string;
    attemptId: string;
    consumerId: string;
    leaseToken: string;
    resultRef: string;
  }): DurableDispatchWaiter {
    requireReference('resultRef', input.resultRef);
    return this.finish(input, 'completed', input.resultRef);
  }

  fail(input: {
    workItemId: string;
    attemptId: string;
    consumerId: string;
    leaseToken: string;
    errorRef: string;
  }): DurableDispatchWaiter {
    requireReference('errorRef', input.errorRef);
    return this.finish(input, 'failed', input.errorRef);
  }

  async waitForTerminal(
    binding: { workItemId: string; attemptId: string },
    options: { timeoutMs: number; pollIntervalMs?: number; signal?: AbortSignal },
  ): Promise<DurableDispatchWaiter> {
    if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 0) throw new Error('timeoutMs must be non-negative');
    const interval = options.pollIntervalMs ?? 50;
    const deadline = Date.now() + options.timeoutMs;
    while (true) {
      if (options.signal?.aborted) throw new Error('Dispatch reattachment wait aborted');
      const waiter = this.poll(binding.workItemId, binding.attemptId);
      if (!waiter) throw new Error(`Dispatch waiter ${binding.workItemId}/${binding.attemptId} not found`);
      if (waiter.status === 'completed' || waiter.status === 'failed') return waiter;
      if (Date.now() >= deadline) throw new Error(`Dispatch reattachment timed out for ${binding.workItemId}/${binding.attemptId}`);
      await new Promise<void>((resolve) => setTimeout(resolve, Math.min(interval, Math.max(1, deadline - Date.now()))));
    }
  }

  private finish(
    input: { workItemId: string; attemptId: string; consumerId: string; leaseToken: string },
    status: 'completed' | 'failed',
    terminalRef: string,
  ): DurableDispatchWaiter {
    requireText('consumerId', input.consumerId);
    requireText('leaseToken', input.leaseToken);
    const existing = this.requireWaiter(input.workItemId, input.attemptId);
    if (existing.status === 'completed' || existing.status === 'failed') {
      const same = existing.status === status
        && (status === 'completed' ? existing.resultRef : existing.errorRef) === terminalRef;
      if (same) return existing;
      throw new Error(`Dispatch waiter terminal result conflict for ${input.workItemId}/${input.attemptId}`);
    }
    if (existing.consumerId !== input.consumerId || existing.leaseToken !== input.leaseToken) {
      throw new Error(`Dispatch waiter lease token or consumer mismatch for ${input.workItemId}/${input.attemptId}`);
    }
    const now = this.now();
    if (!existing.leaseExpiresAt || existing.leaseExpiresAt <= now) {
      throw new Error(`Dispatch waiter lease expired for ${input.workItemId}/${input.attemptId}`);
    }
    const result = this.database.prepare(`
      UPDATE pipeline_dispatch_waiters
      SET status = ?, result_ref = ?, error_ref = ?, consumer_id = NULL,
          lease_token = NULL, lease_expires_at = NULL, updated_at = ?
      WHERE work_item_id = ? AND attempt_id = ? AND status = 'leased'
        AND consumer_id = ? AND lease_token = ? AND lease_expires_at > ?
    `).run(
      status,
      status === 'completed' ? terminalRef : null,
      status === 'failed' ? terminalRef : null,
      now,
      input.workItemId,
      input.attemptId,
      input.consumerId,
      input.leaseToken,
      now,
    );
    if (result.changes !== 1) throw new Error(`Dispatch waiter CAS conflict for ${input.workItemId}/${input.attemptId}`);
    return this.requireWaiter(input.workItemId, input.attemptId);
  }

  private requireWaiter(workItemId: string, attemptId: string): DurableDispatchWaiter {
    const row = this.getRow(workItemId, attemptId);
    if (!row) throw new Error(`Dispatch waiter ${workItemId}/${attemptId} not found`);
    return toWaiter(row, true);
  }

  private getRow(workItemId: string, attemptId: string): WaiterRow | undefined {
    requireText('workItemId', workItemId);
    requireText('attemptId', attemptId);
    return this.database.prepare(`
      SELECT instance_id, execution_node_id, work_item_id, attempt_id, status,
             consumer_id, lease_token, lease_expires_at, result_ref, error_ref,
             created_at, updated_at
      FROM pipeline_dispatch_waiters
      WHERE work_item_id = ? AND attempt_id = ?
    `).get(workItemId, attemptId) as WaiterRow | undefined;
  }

  private initializeSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_dispatch_waiters (
        instance_id TEXT NOT NULL,
        execution_node_id TEXT NOT NULL,
        work_item_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        status TEXT NOT NULL,
        consumer_id TEXT,
        lease_token TEXT,
        lease_expires_at INTEGER,
        result_ref TEXT,
        error_ref TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (work_item_id, attempt_id),
        UNIQUE (instance_id, execution_node_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pipeline_dispatch_waiter_claim
        ON pipeline_dispatch_waiters(status, lease_expires_at, created_at);
    `);
  }
}

function toWaiter(row: WaiterRow, exposeLeaseToken: boolean): DurableDispatchWaiter {
  return {
    instanceId: row.instance_id,
    executionNodeId: row.execution_node_id,
    workItemId: row.work_item_id,
    attemptId: row.attempt_id,
    status: row.status,
    ...(row.consumer_id ? { consumerId: row.consumer_id } : {}),
    ...(exposeLeaseToken && row.lease_token ? { leaseToken: row.lease_token } : {}),
    ...(row.lease_expires_at === null ? {} : { leaseExpiresAt: row.lease_expires_at }),
    ...(row.result_ref ? { resultRef: row.result_ref } : {}),
    ...(row.error_ref ? { errorRef: row.error_ref } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function requireText(name: string, value: string): void {
  if (!value?.trim()) throw new Error(`${name} is required`);
}

function requireReference(name: string, value: string): void {
  requireText(name, value);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) throw new Error(`${name} must be an artifact-style URI`);
}
