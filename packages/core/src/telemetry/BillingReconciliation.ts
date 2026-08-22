import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';

export interface ProviderBillingStatement {
  statementId: string;
  tenantId: string;
  projectId: string;
  providerId: string;
  accountRef: string;
  windowStart: number;
  windowEnd: number;
  currency: string;
  totalAmount: number;
  issuedAt: string;
}

export interface BillingSourceBinding {
  sourceId: string;
  version: number;
  implementationHash: string;
}

export interface ProviderBillingSource {
  readonly sourceId: string;
  readonly version: number;
  readonly implementationId: string;
  load(statementRef: string): Promise<ProviderBillingStatement>;
  /** Server-owned discovery; callers cannot supply a URL or statement handler. */
  discover?(input: {
    tenantId: string; projectId: string; providerId: string; accountRef: string; cursor: string | null;
  }): Promise<{ statementRef: string; nextCursor: string }>;
}

export interface StoredProviderBillingStatement extends ProviderBillingStatement {
  sourceRef: string;
  sourceBinding: BillingSourceBinding;
  contentHash: string;
  importedAt: string;
}

export interface BillingReconciliationResult {
  reconciliationId: string;
  tenantId: string;
  projectId: string;
  statementId: string;
  status: 'matched' | 'variance' | 'incomplete';
  statementAmount: number;
  ledgerAmount: number;
  varianceAmount: number;
  currency: string;
  scopedEventCount: number;
  boundMeasuredEventCount: number;
  toleranceAmount: number;
  evidenceRef: string;
  reconciledAt: string;
}

export class BillingSourceRegistry {
  private readonly sources = new Map<string, ProviderBillingSource>();
  constructor(sources: readonly ProviderBillingSource[]) {
    for (const source of sources) {
      if (!source.sourceId.trim() || !Number.isSafeInteger(source.version) || source.version < 1 || !source.implementationId.trim()) {
        throw new Error('billing source requires stable id, version and implementationId');
      }
      if (this.sources.has(source.sourceId)) throw new Error(`duplicate billing source ${source.sourceId}`);
      this.sources.set(source.sourceId, source);
    }
  }
  binding(sourceId: string): BillingSourceBinding {
    const source = this.sources.get(sourceId);
    if (!source) throw new Error('billing source not registered');
    return { sourceId, version: source.version, implementationHash: sha({ sourceId, version: source.version, implementationId: source.implementationId }) };
  }
  resolve(binding: BillingSourceBinding): ProviderBillingSource {
    const source = this.sources.get(binding.sourceId);
    if (!source || source.version !== binding.version || this.binding(binding.sourceId).implementationHash !== binding.implementationHash) {
      throw new Error('billing source binding mismatch');
    }
    return source;
  }
}

type StatementRow = { statement_json: string };

export class ProviderBillingReconciler {
  constructor(
    private readonly database: Database.Database,
    private readonly registry: BillingSourceRegistry,
    private readonly now: () => Date = () => new Date(),
  ) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS usage_billing_bindings (
        event_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL,
        provider_id TEXT NOT NULL, account_ref TEXT NOT NULL, binding_hash TEXT NOT NULL, bound_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_usage_billing_scope ON usage_billing_bindings(tenant_id,project_id,provider_id,account_ref);
      CREATE TABLE IF NOT EXISTS provider_billing_statements (
        tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, statement_id TEXT NOT NULL,
        provider_id TEXT NOT NULL, account_ref TEXT NOT NULL, window_start INTEGER NOT NULL, window_end INTEGER NOT NULL,
        currency TEXT NOT NULL, total_amount REAL NOT NULL, content_hash TEXT NOT NULL, source_ref TEXT NOT NULL,
        source_id TEXT NOT NULL, source_version INTEGER NOT NULL, source_hash TEXT NOT NULL,
        statement_json TEXT NOT NULL, imported_at TEXT NOT NULL,
        PRIMARY KEY(tenant_id,project_id,statement_id)
      );
      CREATE TABLE IF NOT EXISTS provider_billing_reconciliations (
        reconciliation_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL,
        statement_id TEXT NOT NULL, evidence_ref TEXT NOT NULL, result_json TEXT NOT NULL, reconciled_at TEXT NOT NULL,
        UNIQUE(tenant_id,project_id,statement_id,evidence_ref)
      );
    `);
  }

  bindUsage(input: { tenantId: string; projectId: string; eventId: string; providerId: string; accountRef: string }): void {
    for (const [field, value] of Object.entries(input)) if (!value.trim()) throw new Error(`${field} is required`);
    const event = this.database.prepare(`SELECT tenant_id,project_id FROM usage_events WHERE id=?`).get(input.eventId) as
      { tenant_id: string | null; project_id: string | null } | undefined;
    if (!event || event.tenant_id !== input.tenantId || event.project_id !== input.projectId) throw new Error('usage event scope mismatch');
    const bindingHash = sha(input);
    const current = this.database.prepare(`SELECT binding_hash FROM usage_billing_bindings WHERE event_id=?`)
      .get(input.eventId) as { binding_hash: string } | undefined;
    if (current) {
      if (current.binding_hash !== bindingHash) throw new Error('usage billing binding conflict');
      return;
    }
    this.database.prepare(`INSERT INTO usage_billing_bindings
      (event_id,tenant_id,project_id,provider_id,account_ref,binding_hash,bound_at) VALUES(?,?,?,?,?,?,?)`)
      .run(input.eventId, input.tenantId, input.projectId, input.providerId, input.accountRef, bindingHash, this.now().toISOString());
  }

  async importStatement(input: { tenantId: string; projectId: string; statementRef: string; sourceBinding: BillingSourceBinding }): Promise<StoredProviderBillingStatement> {
    if (!/^artifact:\/\/[A-Za-z0-9._~!$&'()*+,;=:@%/-]+$/.test(input.statementRef)) throw new Error('statementRef must be an artifact URI');
    const source = this.registry.resolve(input.sourceBinding);
    const statement = await source.load(input.statementRef);
    validateStatement(statement);
    if (statement.tenantId !== input.tenantId || statement.projectId !== input.projectId) throw new Error('billing statement scope mismatch');
    const contentHash = sha(statement);
    const stored: StoredProviderBillingStatement = {
      ...statement, sourceRef: input.statementRef, sourceBinding: input.sourceBinding,
      contentHash, importedAt: this.now().toISOString(),
    };
    const current = this.getStatement(input.tenantId, input.projectId, statement.statementId);
    if (current) {
      if (current.contentHash !== contentHash || current.sourceBinding.implementationHash !== input.sourceBinding.implementationHash) {
        throw new Error('billing statement content conflict');
      }
      return current;
    }
    this.database.prepare(`INSERT INTO provider_billing_statements
      (tenant_id,project_id,statement_id,provider_id,account_ref,window_start,window_end,currency,total_amount,
       content_hash,source_ref,source_id,source_version,source_hash,statement_json,imported_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      stored.tenantId, stored.projectId, stored.statementId, stored.providerId, stored.accountRef,
      stored.windowStart, stored.windowEnd, stored.currency, stored.totalAmount, stored.contentHash, stored.sourceRef,
      stored.sourceBinding.sourceId, stored.sourceBinding.version, stored.sourceBinding.implementationHash,
      JSON.stringify(stored), stored.importedAt,
    );
    return stored;
  }

  getStatement(tenantId: string, projectId: string, statementId: string): StoredProviderBillingStatement | undefined {
    const row = this.database.prepare(`SELECT statement_json FROM provider_billing_statements
      WHERE tenant_id=? AND project_id=? AND statement_id=?`).get(tenantId, projectId, statementId) as StatementRow | undefined;
    return row ? JSON.parse(row.statement_json) as StoredProviderBillingStatement : undefined;
  }

  reconcile(tenantId: string, projectId: string, statementId: string, toleranceAmount: number): BillingReconciliationResult {
    if (!Number.isFinite(toleranceAmount) || toleranceAmount < 0) throw new Error('toleranceAmount must be non-negative');
    const statement = this.getStatement(tenantId, projectId, statementId);
    if (!statement) throw new Error('billing statement not found');
    const rows = this.database.prepare(`SELECT u.cost_amount,u.cost_currency,u.cost_status,b.provider_id,b.account_ref
      FROM usage_events u LEFT JOIN usage_billing_bindings b ON b.event_id=u.id
      WHERE u.tenant_id=? AND u.project_id=? AND u.occurred_at>=? AND u.occurred_at<?
        AND (b.event_id IS NULL OR (b.provider_id=? AND b.account_ref=?))`)
      .all(tenantId, projectId, statement.windowStart, statement.windowEnd, statement.providerId, statement.accountRef) as Array<{
        cost_amount: number | null; cost_currency: string | null; cost_status: string;
        provider_id: string | null; account_ref: string | null;
      }>;
    const measured = rows.filter((row) => row.provider_id === statement.providerId && row.account_ref === statement.accountRef
      && row.cost_status === 'measured' && row.cost_amount !== null && row.cost_currency === statement.currency);
    const ledgerAmount = measured.reduce((sum, row) => sum + row.cost_amount!, 0);
    const varianceAmount = ledgerAmount - statement.totalAmount;
    const complete = rows.length === measured.length;
    const status: BillingReconciliationResult['status'] = !complete ? 'incomplete'
      : Math.abs(varianceAmount) <= toleranceAmount ? 'matched' : 'variance';
    const evidenceRef = `sha256:${sha({ statementHash: statement.contentHash, eventRows: rows, toleranceAmount })}`;
    const reconciledAt = this.now().toISOString();
    const reconciliationId = `billing-reconciliation-${sha({ tenantId, projectId, statementId, evidenceRef }).slice(0, 32)}`;
    const result: BillingReconciliationResult = {
      reconciliationId, tenantId, projectId, statementId, status, statementAmount: statement.totalAmount,
      ledgerAmount, varianceAmount, currency: statement.currency, scopedEventCount: rows.length,
      boundMeasuredEventCount: measured.length, toleranceAmount, evidenceRef, reconciledAt,
    };
    this.database.prepare(`INSERT OR IGNORE INTO provider_billing_reconciliations
      (reconciliation_id,tenant_id,project_id,statement_id,evidence_ref,result_json,reconciled_at) VALUES(?,?,?,?,?,?,?)`)
      .run(reconciliationId, tenantId, projectId, statementId, evidenceRef, JSON.stringify(result), reconciledAt);
    return result;
  }
}

function validateStatement(statement: ProviderBillingStatement): void {
  for (const [field, value] of Object.entries({ statementId: statement.statementId, tenantId: statement.tenantId,
    projectId: statement.projectId, providerId: statement.providerId, accountRef: statement.accountRef,
    currency: statement.currency, issuedAt: statement.issuedAt })) {
    if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required`);
  }
  if (!Number.isSafeInteger(statement.windowStart) || !Number.isSafeInteger(statement.windowEnd)
    || statement.windowStart >= statement.windowEnd) throw new Error('billing window is invalid');
  if (!Number.isFinite(statement.totalAmount) || statement.totalAmount < 0) throw new Error('totalAmount must be non-negative');
  if (!Number.isFinite(Date.parse(statement.issuedAt))) throw new Error('issuedAt is invalid');
}

function sha(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, stable(child)]));
  return value;
}
