import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import {
  BillingSourceRegistry,
  ProviderBillingReconciler,
  type BillingReconciliationResult,
  type BillingSourceBinding,
} from './BillingReconciliation.js';

export interface BillingImportSchedule {
  scheduleId: string; tenantId: string; projectId: string; providerId: string; accountRef: string;
  sourceBinding: BillingSourceBinding; intervalMs: number; toleranceAmount: number; cursor: string | null;
  nextRunAt: number; attemptCount: number; deadLetteredAt: string | null;
}

export interface BillingImportClaim extends BillingImportSchedule {
  workerId: string; leaseToken: string; leaseExpiresAt: number;
}

type Row = Record<string, unknown>;

export class BillingImportScheduler {
  constructor(
    private readonly database: Database.Database,
    private readonly registry: BillingSourceRegistry,
    private readonly reconciler: ProviderBillingReconciler,
    private readonly now: () => Date = () => new Date(),
  ) {
    database.exec(`CREATE TABLE IF NOT EXISTS billing_import_schedules (
      schedule_id TEXT NOT NULL, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL,
      provider_id TEXT NOT NULL, account_ref TEXT NOT NULL,
      source_binding_json TEXT NOT NULL, interval_ms INTEGER NOT NULL, tolerance_amount REAL NOT NULL,
      cursor TEXT, next_run_at INTEGER NOT NULL, attempt_count INTEGER NOT NULL DEFAULT 0,
      lease_owner TEXT, lease_token TEXT, lease_expires_at INTEGER, dead_lettered_at TEXT,
      last_error TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(tenant_id,project_id,schedule_id)
    ); CREATE INDEX IF NOT EXISTS idx_billing_import_due
      ON billing_import_schedules(next_run_at,dead_lettered_at,lease_expires_at);`);
  }

  createSchedule(input: {
    scheduleId: string; tenantId: string; projectId: string; providerId: string; accountRef: string;
    sourceBinding: BillingSourceBinding; intervalMs: number; toleranceAmount: number; firstRunAt: number;
  }): BillingImportSchedule {
    if (Object.prototype.hasOwnProperty.call(input, 'statementRef') || Object.prototype.hasOwnProperty.call(input, 'handler')) {
      throw new Error('statement refs and handlers are source-owned');
    }
    for (const [field, value] of Object.entries({ scheduleId: input.scheduleId, tenantId: input.tenantId, projectId: input.projectId, providerId: input.providerId, accountRef: input.accountRef })) {
      if (!value.trim()) throw new Error(`${field} is required`);
    }
    if (!Number.isSafeInteger(input.intervalMs) || input.intervalMs < 1 || !Number.isSafeInteger(input.firstRunAt)) throw new Error('invalid billing schedule interval/time');
    if (!Number.isFinite(input.toleranceAmount) || input.toleranceAmount < 0) throw new Error('invalid reconciliation tolerance');
    const source = this.registry.resolve(input.sourceBinding);
    if (!source.discover) throw new Error('billing source does not support scheduled discovery');
    this.database.prepare(`INSERT INTO billing_import_schedules
      (schedule_id,tenant_id,project_id,provider_id,account_ref,source_binding_json,interval_ms,tolerance_amount,next_run_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)`).run(
      input.scheduleId, input.tenantId, input.projectId, input.providerId, input.accountRef,
      JSON.stringify(input.sourceBinding), input.intervalMs, input.toleranceAmount, input.firstRunAt, this.now().toISOString(),
    );
    return this.getSchedule(input.tenantId, input.projectId, input.scheduleId)!;
  }

  getSchedule(tenantId: string, projectId: string, scheduleId: string): BillingImportSchedule | null {
    const row = this.database.prepare(`SELECT * FROM billing_import_schedules WHERE tenant_id=? AND project_id=? AND schedule_id=?`)
      .get(tenantId, projectId, scheduleId) as Row | undefined;
    return row ? map(row) : null;
  }

  claimDue(input: { workerId: string; now: number; leaseMs: number; limit: number }): BillingImportClaim[] {
    if (!input.workerId.trim() || !Number.isSafeInteger(input.leaseMs) || input.leaseMs < 1 || !Number.isSafeInteger(input.limit) || input.limit < 1) throw new Error('invalid billing import claim');
    return this.database.transaction(() => {
      const rows = this.database.prepare(`SELECT * FROM billing_import_schedules
        WHERE dead_lettered_at IS NULL AND next_run_at<=? AND (lease_expires_at IS NULL OR lease_expires_at<=?)
        ORDER BY next_run_at,schedule_id LIMIT ?`).all(input.now, input.now, input.limit) as Row[];
      const claims: BillingImportClaim[] = [];
      for (const row of rows) {
        const leaseToken = randomUUID();
        const result = this.database.prepare(`UPDATE billing_import_schedules SET lease_owner=?,lease_token=?,lease_expires_at=?,updated_at=?
          WHERE tenant_id=? AND project_id=? AND schedule_id=? AND dead_lettered_at IS NULL
            AND (lease_expires_at IS NULL OR lease_expires_at<=?)`).run(
          input.workerId, leaseToken, input.now + input.leaseMs, this.now().toISOString(),
          row.tenant_id, row.project_id, row.schedule_id, input.now,
        );
        if (result.changes === 1) claims.push({ ...map(row), workerId: input.workerId, leaseToken, leaseExpiresAt: input.now + input.leaseMs });
      }
      return claims;
    })();
  }

  async process(claim: BillingImportClaim, options: { maxAttempts?: number; baseBackoffMs?: number; now?: number } = {}): Promise<{
    status: 'succeeded' | 'retry_scheduled' | 'dead_lettered'; cursor?: string; reconciliation?: BillingReconciliationResult;
  }> {
    const maxAttempts = options.maxAttempts ?? 5, baseBackoffMs = options.baseBackoffMs ?? 1_000;
    const nowMs = options.now ?? this.now().getTime();
    this.assertActiveLease(claim, nowMs);
    try {
      const source = this.registry.resolve(claim.sourceBinding);
      if (!source.discover) throw new Error('billing source does not support scheduled discovery');
      const discovered = await source.discover({
        tenantId: claim.tenantId, projectId: claim.projectId, providerId: claim.providerId,
        accountRef: claim.accountRef, cursor: claim.cursor,
      });
      if (!discovered.nextCursor.trim()) throw new Error('billing source cursor is required');
      const statement = await this.reconciler.importStatement({
        tenantId: claim.tenantId, projectId: claim.projectId,
        statementRef: discovered.statementRef, sourceBinding: claim.sourceBinding,
      });
      if (statement.providerId !== claim.providerId || statement.accountRef !== claim.accountRef) throw new Error('billing provider/account scope mismatch');
      const reconciliation = this.reconciler.reconcile(claim.tenantId, claim.projectId, statement.statementId, claim.toleranceAmount);
      this.ack(claim, discovered.nextCursor, nowMs);
      return { status: 'succeeded', cursor: discovered.nextCursor, reconciliation };
    } catch (error) {
      const attempt = claim.attemptCount + 1;
      const deadLettered = attempt >= maxAttempts;
      const nextRunAt = nowMs + baseBackoffMs * 2 ** (attempt - 1);
      const result = this.database.prepare(`UPDATE billing_import_schedules SET attempt_count=?,next_run_at=?,
        dead_lettered_at=?,last_error=?,lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,updated_at=?
        WHERE tenant_id=? AND project_id=? AND schedule_id=? AND lease_owner=? AND lease_token=? AND lease_expires_at>?`).run(
        attempt, nextRunAt, deadLettered ? this.now().toISOString() : null,
        sanitize(error), this.now().toISOString(), claim.tenantId, claim.projectId, claim.scheduleId, claim.workerId, claim.leaseToken, nowMs,
      );
      if (result.changes !== 1) throw new Error('billing import lease lost');
      return { status: deadLettered ? 'dead_lettered' : 'retry_scheduled' };
    }
  }

  private ack(claim: BillingImportClaim, cursor: string, nowMs: number): void {
    const result = this.database.prepare(`UPDATE billing_import_schedules SET cursor=?,next_run_at=?,attempt_count=0,
      lease_owner=NULL,lease_token=NULL,lease_expires_at=NULL,last_error=NULL,updated_at=?
      WHERE tenant_id=? AND project_id=? AND schedule_id=? AND lease_owner=? AND lease_token=? AND lease_expires_at>?`).run(
      cursor, nowMs + claim.intervalMs, this.now().toISOString(),
      claim.tenantId, claim.projectId, claim.scheduleId, claim.workerId, claim.leaseToken, nowMs,
    );
    if (result.changes !== 1) throw new Error('billing import lease lost');
  }

  private assertActiveLease(claim: BillingImportClaim, nowMs: number): void {
    const row = this.database.prepare(`SELECT 1 AS active FROM billing_import_schedules
      WHERE tenant_id=? AND project_id=? AND schedule_id=? AND lease_owner=? AND lease_token=?
        AND lease_expires_at>? AND dead_lettered_at IS NULL`).get(
      claim.tenantId, claim.projectId, claim.scheduleId, claim.workerId, claim.leaseToken, nowMs,
    );
    if (!row) throw new Error('billing import lease is stale or expired');
  }
}

function map(row: Row): BillingImportSchedule {
  return {
    scheduleId: String(row.schedule_id), tenantId: String(row.tenant_id), projectId: String(row.project_id),
    providerId: String(row.provider_id), accountRef: String(row.account_ref),
    sourceBinding: JSON.parse(String(row.source_binding_json)) as BillingSourceBinding,
    intervalMs: Number(row.interval_ms), toleranceAmount: Number(row.tolerance_amount), cursor: row.cursor ? String(row.cursor) : null,
    nextRunAt: Number(row.next_run_at), attemptCount: Number(row.attempt_count), deadLetteredAt: row.dead_lettered_at ? String(row.dead_lettered_at) : null,
  };
}
function sanitize(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).replace(/https?:\/\/\S+/g, '[REDACTED_URL]').slice(0, 500);
}
