import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { SideEffectLedgerEntry } from './SideEffectLedger.js';

export interface CompensationBinding {
  operation: string;
  version: string;
  hash: string;
}

export interface CompensationHandlerContext {
  effect: SideEffectLedgerEntry;
}

export interface CompensationSpec {
  operation: string;
  version: string;
  handlerId: string;
  handler: (context: CompensationHandlerContext) => { receiptRef: string };
}

export interface CompensationReceipt {
  binding: CompensationBinding;
  tenantId: string;
  projectId: string;
  instanceId: string;
  executionNodeId: string;
  idempotencyKey: string;
  receiptRef: string;
  createdAt: number;
}

interface RegisteredCompensation {
  spec: CompensationSpec;
  binding: CompensationBinding;
}

export class CompensationRegistry {
  private readonly handlers = new Map<string, RegisteredCompensation>();

  constructor(
    private readonly database: Database.Database,
    private readonly now: () => number = Date.now,
  ) {
    this.initializeSchema();
  }

  register(spec: CompensationSpec): CompensationBinding {
    for (const [name, value] of Object.entries({ operation: spec.operation, version: spec.version, handlerId: spec.handlerId })) {
      if (!value.trim()) throw new Error(`compensation ${name} is required`);
    }
    const binding = bindingFor(spec);
    const key = registryKey(spec.operation, spec.version);
    const existing = this.handlers.get(key);
    if (existing && existing.binding.hash !== binding.hash) {
      throw new Error(`Compensation ${key} already registered with different content`);
    }
    this.handlers.set(key, { spec: { ...spec }, binding });
    return binding;
  }

  execute(binding: CompensationBinding, effect: SideEffectLedgerEntry): CompensationReceipt {
    const registered = this.handlers.get(registryKey(binding.operation, binding.version));
    if (!registered) throw new Error(`Unknown compensation ${binding.operation}@${binding.version}`);
    if (registered.binding.hash !== binding.hash || effect.operation !== binding.operation) {
      throw new Error(`Compensation binding hash or operation mismatch for ${binding.operation}@${binding.version}`);
    }
    const existing = this.findReceipt(binding, effect);
    if (existing) return existing;
    const output = registered.spec.handler({ effect: structuredClone(effect) });
    requireReference('compensation receiptRef', output.receiptRef);
    const createdAt = this.now();
    try {
      this.database.prepare(`
        INSERT INTO pipeline_compensation_receipts
          (tenant_id, project_id, instance_id, execution_node_id, operation, idempotency_key,
           compensation_version, compensation_hash, receipt_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        effect.tenantId, effect.projectId, effect.instanceId, effect.executionNodeId,
        effect.operation, effect.idempotencyKey, binding.version, binding.hash, output.receiptRef, createdAt,
      );
    } catch {
      const raced = this.findReceipt(binding, effect);
      if (raced) return raced;
      throw new Error(`Compensation receipt persistence failed for ${effect.idempotencyKey}`);
    }
    return this.findReceipt(binding, effect)!;
  }

  private findReceipt(binding: CompensationBinding, effect: SideEffectLedgerEntry): CompensationReceipt | undefined {
    const row = this.database.prepare(`
      SELECT tenant_id, project_id, instance_id, execution_node_id, operation, idempotency_key,
             compensation_version, compensation_hash, receipt_ref, created_at
      FROM pipeline_compensation_receipts
      WHERE tenant_id = ? AND project_id = ? AND operation = ? AND idempotency_key = ?
    `).get(effect.tenantId, effect.projectId, effect.operation, effect.idempotencyKey) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    if (row.compensation_version !== binding.version || row.compensation_hash !== binding.hash
      || row.instance_id !== effect.instanceId || row.execution_node_id !== effect.executionNodeId) {
      throw new Error(`Compensation receipt binding conflict for ${effect.idempotencyKey}`);
    }
    return {
      binding: { ...binding },
      tenantId: String(row.tenant_id),
      projectId: String(row.project_id),
      instanceId: String(row.instance_id),
      executionNodeId: String(row.execution_node_id),
      idempotencyKey: String(row.idempotency_key),
      receiptRef: String(row.receipt_ref),
      createdAt: Number(row.created_at),
    };
  }

  private initializeSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_compensation_receipts (
        tenant_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        execution_node_id TEXT NOT NULL,
        operation TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        compensation_version TEXT NOT NULL,
        compensation_hash TEXT NOT NULL,
        receipt_ref TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (tenant_id, project_id, operation, idempotency_key)
      );
    `);
  }
}

function bindingFor(spec: Pick<CompensationSpec, 'operation' | 'version' | 'handlerId'>): CompensationBinding {
  const hash = createHash('sha256').update(JSON.stringify({
    operation: spec.operation, version: spec.version, handlerId: spec.handlerId,
  })).digest('hex');
  return { operation: spec.operation, version: spec.version, hash };
}

function registryKey(operation: string, version: string): string {
  return `${operation}@${version}`;
}

function requireReference(name: string, value: string): void {
  if (!value?.trim() || !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) throw new Error(`${name} must be an artifact-style URI`);
}
