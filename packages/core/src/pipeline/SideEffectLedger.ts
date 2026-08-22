import type Database from 'better-sqlite3';

export type SideEffectLedgerState = 'pending' | 'committed' | 'compensated' | 'unknown';

export interface SideEffectIntent {
  tenantId: string;
  projectId: string;
  instanceId: string;
  executionNodeId: string;
  operation: string;
  idempotencyKey: string;
  intentHash: string;
}

export interface SideEffectLedgerEntry extends SideEffectIntent {
  state: SideEffectLedgerState;
  resultRef?: string;
  externalRef?: string;
  compensationReceiptRef?: string;
  createdAt: number;
  updatedAt: number;
  committedAt?: number;
  compensatedAt?: number;
  unknownAt?: number;
}

interface LedgerRow {
  tenant_id: string;
  project_id: string;
  instance_id: string;
  execution_node_id: string;
  operation: string;
  idempotency_key: string;
  intent_hash: string;
  state: SideEffectLedgerState;
  result_ref: string | null;
  external_ref: string | null;
  compensation_receipt_ref: string | null;
  created_at: number;
  updated_at: number;
  committed_at: number | null;
  compensated_at: number | null;
  unknown_at: number | null;
}

export class SideEffectLedger {
  constructor(
    private readonly database: Database.Database,
    private readonly now: () => number = Date.now,
  ) {
    this.initializeSchema();
  }

  begin(intent: SideEffectIntent): SideEffectLedgerEntry {
    validateIntent(intent);
    const existing = this.getByKey(intent);
    if (existing) {
      this.assertSameIntent(existing, intent);
      return toEntry(existing);
    }
    const now = this.now();
    try {
      this.database.prepare(`
        INSERT INTO pipeline_side_effect_ledger
          (tenant_id, project_id, instance_id, execution_node_id, operation,
           idempotency_key, intent_hash, state, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
      `).run(
        intent.tenantId, intent.projectId, intent.instanceId, intent.executionNodeId,
        intent.operation, intent.idempotencyKey, intent.intentHash, now, now,
      );
    } catch {
      const raced = this.getByKey(intent);
      if (!raced) throw new Error(`Side effect begin CAS failed for ${intent.idempotencyKey}`);
      this.assertSameIntent(raced, intent);
      return toEntry(raced);
    }
    return this.requireEntry(intent);
  }

  commit(input: SideEffectIntent & { resultRef: string; externalRef?: string }): SideEffectLedgerEntry {
    validateIntent(input);
    requireReference('resultRef', input.resultRef);
    if (input.externalRef) requireReference('externalRef', input.externalRef);
    const existing = this.requireEntry(input);
    this.assertSameIntentRow(existing, input);
    if (existing.state === 'committed') {
      if (existing.resultRef === input.resultRef && existing.externalRef === input.externalRef) return existing;
      throw new Error(`Side effect commit conflict for ${input.idempotencyKey}`);
    }
    if (existing.state !== 'pending') throw new Error(`Side effect ${input.idempotencyKey} is ${existing.state}, not pending`);
    const now = this.now();
    const result = this.database.prepare(`
      UPDATE pipeline_side_effect_ledger
      SET state = 'committed', result_ref = ?, external_ref = ?, committed_at = ?, updated_at = ?
      WHERE tenant_id = ? AND project_id = ? AND operation = ? AND idempotency_key = ?
        AND intent_hash = ? AND state = 'pending'
    `).run(
      input.resultRef, input.externalRef ?? null, now, now,
      input.tenantId, input.projectId, input.operation, input.idempotencyKey, input.intentHash,
    );
    if (result.changes !== 1) throw new Error(`Side effect commit CAS conflict for ${input.idempotencyKey}`);
    return this.requireEntry(input);
  }

  markUnknown(intent: SideEffectIntent): SideEffectLedgerEntry {
    validateIntent(intent);
    const existing = this.requireEntry(intent);
    this.assertSameIntentRow(existing, intent);
    if (existing.state === 'unknown') return existing;
    if (existing.state !== 'pending') throw new Error(`Side effect ${intent.idempotencyKey} is ${existing.state}, not pending`);
    const now = this.now();
    const result = this.database.prepare(`
      UPDATE pipeline_side_effect_ledger
      SET state = 'unknown', unknown_at = ?, updated_at = ?
      WHERE tenant_id = ? AND project_id = ? AND operation = ? AND idempotency_key = ?
        AND intent_hash = ? AND state = 'pending'
    `).run(
      now, now, intent.tenantId, intent.projectId, intent.operation, intent.idempotencyKey, intent.intentHash,
    );
    if (result.changes !== 1) throw new Error(`Side effect unknown-state CAS conflict for ${intent.idempotencyKey}`);
    return this.requireEntry(intent);
  }

  compensate(input: SideEffectIntent & { compensationReceiptRef: string }): SideEffectLedgerEntry {
    validateIntent(input);
    requireReference('compensationReceiptRef', input.compensationReceiptRef);
    const existing = this.requireEntry(input);
    this.assertSameIntentRow(existing, input);
    if (existing.state === 'compensated') {
      if (existing.compensationReceiptRef === input.compensationReceiptRef) return existing;
      throw new Error(`Side effect compensation conflict for ${input.idempotencyKey}`);
    }
    if (existing.state !== 'committed' && existing.state !== 'unknown') {
      throw new Error(`Side effect ${input.idempotencyKey} cannot be compensated from ${existing.state}`);
    }
    const now = this.now();
    const result = this.database.prepare(`
      UPDATE pipeline_side_effect_ledger
      SET state = 'compensated', compensation_receipt_ref = ?, compensated_at = ?, updated_at = ?
      WHERE tenant_id = ? AND project_id = ? AND operation = ? AND idempotency_key = ?
        AND intent_hash = ? AND state IN ('committed', 'unknown')
    `).run(
      input.compensationReceiptRef, now, now,
      input.tenantId, input.projectId, input.operation, input.idempotencyKey, input.intentHash,
    );
    if (result.changes !== 1) throw new Error(`Side effect compensation CAS conflict for ${input.idempotencyKey}`);
    return this.requireEntry(input);
  }

  listForExecution(instanceId: string, executionNodeId: string): SideEffectLedgerEntry[] {
    requireText('instanceId', instanceId);
    requireText('executionNodeId', executionNodeId);
    const rows = this.database.prepare(`
      SELECT tenant_id, project_id, instance_id, execution_node_id, operation, idempotency_key,
             intent_hash, state, result_ref, external_ref, compensation_receipt_ref,
             created_at, updated_at, committed_at, compensated_at, unknown_at
      FROM pipeline_side_effect_ledger
      WHERE instance_id = ? AND execution_node_id = ?
      ORDER BY created_at ASC, operation ASC, idempotency_key ASC
    `).all(instanceId, executionNodeId) as LedgerRow[];
    return rows.map(toEntry);
  }

  private requireEntry(intent: SideEffectIntent): SideEffectLedgerEntry {
    const row = this.getByKey(intent);
    if (!row) throw new Error(`Side effect ${intent.idempotencyKey} not found`);
    return toEntry(row);
  }

  private getByKey(intent: Pick<SideEffectIntent, 'tenantId' | 'projectId' | 'operation' | 'idempotencyKey'>): LedgerRow | undefined {
    return this.database.prepare(`
      SELECT tenant_id, project_id, instance_id, execution_node_id, operation, idempotency_key,
             intent_hash, state, result_ref, external_ref, compensation_receipt_ref,
             created_at, updated_at, committed_at, compensated_at, unknown_at
      FROM pipeline_side_effect_ledger
      WHERE tenant_id = ? AND project_id = ? AND operation = ? AND idempotency_key = ?
    `).get(intent.tenantId, intent.projectId, intent.operation, intent.idempotencyKey) as LedgerRow | undefined;
  }

  private assertSameIntent(row: LedgerRow, intent: SideEffectIntent): void {
    if (row.instance_id !== intent.instanceId || row.execution_node_id !== intent.executionNodeId
      || row.intent_hash !== intent.intentHash) {
      throw new Error(`Side effect intent conflict for ${intent.idempotencyKey}`);
    }
  }

  private assertSameIntentRow(entry: SideEffectLedgerEntry, intent: SideEffectIntent): void {
    if (entry.instanceId !== intent.instanceId || entry.executionNodeId !== intent.executionNodeId
      || entry.intentHash !== intent.intentHash) {
      throw new Error(`Side effect intent conflict for ${intent.idempotencyKey}`);
    }
  }

  private initializeSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_side_effect_ledger (
        tenant_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        execution_node_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        intent_hash TEXT NOT NULL,
        state TEXT NOT NULL,
        result_ref TEXT,
        external_ref TEXT,
        compensation_receipt_ref TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        committed_at INTEGER,
        compensated_at INTEGER,
        unknown_at INTEGER,
        PRIMARY KEY (tenant_id, project_id, operation, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_pipeline_side_effect_execution
        ON pipeline_side_effect_ledger(instance_id, execution_node_id, state);
    `);
  }
}

function toEntry(row: LedgerRow): SideEffectLedgerEntry {
  return {
    tenantId: row.tenant_id,
    projectId: row.project_id,
    instanceId: row.instance_id,
    executionNodeId: row.execution_node_id,
    operation: row.operation,
    idempotencyKey: row.idempotency_key,
    intentHash: row.intent_hash,
    state: row.state,
    ...(row.result_ref ? { resultRef: row.result_ref } : {}),
    ...(row.external_ref ? { externalRef: row.external_ref } : {}),
    ...(row.compensation_receipt_ref ? { compensationReceiptRef: row.compensation_receipt_ref } : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.committed_at === null ? {} : { committedAt: row.committed_at }),
    ...(row.compensated_at === null ? {} : { compensatedAt: row.compensated_at }),
    ...(row.unknown_at === null ? {} : { unknownAt: row.unknown_at }),
  };
}

function validateIntent(intent: SideEffectIntent): void {
  for (const [name, value] of Object.entries(intent)) requireText(name, value);
  if (!/^[a-f0-9]{64}$/.test(intent.intentHash)) throw new Error('intentHash must be a lowercase SHA-256 hash');
}

function requireText(name: string, value: string): void {
  if (!value?.trim()) throw new Error(`${name} is required`);
}

function requireReference(name: string, value: string): void {
  requireText(name, value);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) throw new Error(`${name} must be an artifact-style URI`);
}
