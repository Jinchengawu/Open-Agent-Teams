import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { OperationalSloEvaluator, type OperationalSloPolicy, type OperationalSloResult } from './OperationalSloEvaluator.js';
import type { DurableOperationalEventStore } from './operational-events.js';

export interface StoredOperationalSloPolicy extends OperationalSloPolicy {
  version: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export type CreateOperationalSloPolicy = OperationalSloPolicy & { enabled: boolean };
export type ReviseOperationalSloPolicy = CreateOperationalSloPolicy & { expectedVersion: number };
export type SloTransition = 'initial' | 'changed' | 'unchanged';

export interface OperationalSloEvaluation extends OperationalSloResult {
  tenantId: string;
  projectId: string;
  policyId: string;
  policyVersion: number;
  evaluationId: string;
  transition: SloTransition;
}

export interface OperationalSloAlert {
  alertId: string;
  tenantId: string;
  projectId: string;
  policyId: string;
  policyVersion: number;
  evaluationId: string;
  status: 'breached';
  value: number;
  evidenceRef: string;
  createdAt: string;
}

export interface OperationalSloAlertSink {
  /** alertId is stable; sinks must use it as their idempotency key. */
  send(alert: OperationalSloAlert): Promise<void>;
}

type PolicyRow = { policy_json: string };
type EvaluationRow = { evaluation_json: string };
type AlertRow = { alert_json: string };

export class OperationalSloPolicyStore {
  constructor(private readonly database: Database.Database, private readonly now: () => Date = () => new Date()) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS operational_slo_policies (
        tenant_id TEXT NOT NULL, project_id TEXT NOT NULL, policy_id TEXT NOT NULL,
        version INTEGER NOT NULL, enabled INTEGER NOT NULL, policy_json TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        PRIMARY KEY (tenant_id, project_id, policy_id)
      );
      CREATE TABLE IF NOT EXISTS operational_slo_evaluations (
        evaluation_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL,
        policy_id TEXT NOT NULL, policy_version INTEGER NOT NULL, status TEXT NOT NULL,
        evidence_ref TEXT, result_fingerprint TEXT NOT NULL UNIQUE, evaluation_json TEXT NOT NULL,
        evaluated_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_operational_slo_eval_scope
        ON operational_slo_evaluations(tenant_id, project_id, policy_id, evaluated_at, evaluation_id);
      CREATE TABLE IF NOT EXISTS operational_slo_alert_outbox (
        alert_id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, project_id TEXT NOT NULL,
        policy_id TEXT NOT NULL, evaluation_id TEXT NOT NULL UNIQUE, alert_json TEXT NOT NULL,
        created_at TEXT NOT NULL, delivered_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_operational_slo_alert_pending
        ON operational_slo_alert_outbox(tenant_id, project_id, delivered_at, created_at);
    `);
  }

  create(input: CreateOperationalSloPolicy): StoredOperationalSloPolicy {
    validateStoredPolicy(input);
    const timestamp = this.now().toISOString();
    const stored: StoredOperationalSloPolicy = { ...input, version: 1, createdAt: timestamp, updatedAt: timestamp };
    try {
      this.database.prepare(`INSERT INTO operational_slo_policies
        (tenant_id,project_id,policy_id,version,enabled,policy_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(input.tenantId, input.projectId, input.policyId, 1, input.enabled ? 1 : 0, JSON.stringify(stored), timestamp, timestamp);
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new Error('SLO policy already exists');
      throw error;
    }
    return stored;
  }

  get(tenantId: string, projectId: string, policyId: string): StoredOperationalSloPolicy | undefined {
    const row = this.database.prepare(`SELECT policy_json FROM operational_slo_policies
      WHERE tenant_id=? AND project_id=? AND policy_id=?`).get(tenantId, projectId, policyId) as PolicyRow | undefined;
    return row ? JSON.parse(row.policy_json) as StoredOperationalSloPolicy : undefined;
  }

  revise(input: ReviseOperationalSloPolicy): StoredOperationalSloPolicy {
    validateStoredPolicy(input);
    const current = this.get(input.tenantId, input.projectId, input.policyId);
    if (!current || current.version !== input.expectedVersion) throw new Error('SLO policy version conflict');
    const updated: StoredOperationalSloPolicy = {
      policyId: input.policyId, tenantId: input.tenantId, projectId: input.projectId, kind: input.kind,
      metric: input.metric, operator: input.operator, threshold: input.threshold, windowMs: input.windowMs,
      maximumFreshnessMs: input.maximumFreshnessMs, minimumEventCount: input.minimumEventCount,
      enabled: input.enabled, version: current.version + 1, createdAt: current.createdAt, updatedAt: this.now().toISOString(),
    };
    const result = this.database.prepare(`UPDATE operational_slo_policies SET version=?,enabled=?,policy_json=?,updated_at=?
      WHERE tenant_id=? AND project_id=? AND policy_id=? AND version=?`).run(
      updated.version, updated.enabled ? 1 : 0, JSON.stringify(updated), updated.updatedAt,
      updated.tenantId, updated.projectId, updated.policyId, input.expectedVersion,
    );
    if (result.changes !== 1) throw new Error('SLO policy version conflict');
    return updated;
  }

  recordEvaluation(policy: StoredOperationalSloPolicy, result: OperationalSloResult): OperationalSloEvaluation {
    const previous = this.latestEvaluation(policy.tenantId, policy.projectId, policy.policyId);
    const transition: SloTransition = !previous ? 'initial' : previous.status === result.status ? 'unchanged' : 'changed';
    const fingerprint = sha({
      tenantId: policy.tenantId, projectId: policy.projectId, policyId: policy.policyId,
      policyVersion: policy.version, status: result.status, value: result.value, evidenceRef: result.evidenceRef,
    });
    const evaluationId = `slo-eval-${fingerprint}`;
    const evaluation: OperationalSloEvaluation = {
      ...result, tenantId: policy.tenantId, projectId: policy.projectId, policyId: policy.policyId,
      policyVersion: policy.version, evaluationId, transition,
    };
    const transaction = this.database.transaction(() => {
      const inserted = this.database.prepare(`INSERT OR IGNORE INTO operational_slo_evaluations
        (evaluation_id,tenant_id,project_id,policy_id,policy_version,status,evidence_ref,result_fingerprint,evaluation_json,evaluated_at)
        VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
        evaluationId, policy.tenantId, policy.projectId, policy.policyId, policy.version, result.status,
        result.evidenceRef, fingerprint, JSON.stringify(evaluation), result.evaluatedAt,
      );
      if (inserted.changes === 1 && result.status === 'breached' && transition !== 'unchanged'
        && result.value !== null && result.evidenceRef) {
        const alertId = `slo-alert-${sha({ evaluationId, status: result.status })}`;
        const alert: OperationalSloAlert = {
          alertId, tenantId: policy.tenantId, projectId: policy.projectId, policyId: policy.policyId,
          policyVersion: policy.version, evaluationId, status: 'breached', value: result.value,
          evidenceRef: result.evidenceRef, createdAt: result.evaluatedAt,
        };
        this.database.prepare(`INSERT OR IGNORE INTO operational_slo_alert_outbox
          (alert_id,tenant_id,project_id,policy_id,evaluation_id,alert_json,created_at) VALUES (?,?,?,?,?,?,?)`)
          .run(alertId, policy.tenantId, policy.projectId, policy.policyId, evaluationId, JSON.stringify(alert), result.evaluatedAt);
      }
      return inserted.changes === 1;
    });
    const inserted = transaction();
    const persisted = this.database.prepare(`SELECT evaluation_json FROM operational_slo_evaluations WHERE result_fingerprint=?`)
      .get(fingerprint) as EvaluationRow;
    const stored = JSON.parse(persisted.evaluation_json) as OperationalSloEvaluation;
    return inserted ? stored : { ...stored, transition: 'unchanged' };
  }

  listEvaluations(tenantId: string, projectId: string, policyId: string): OperationalSloEvaluation[] {
    return (this.database.prepare(`SELECT evaluation_json FROM operational_slo_evaluations
      WHERE tenant_id=? AND project_id=? AND policy_id=? ORDER BY evaluated_at,evaluation_id`).all(
      tenantId, projectId, policyId,
    ) as EvaluationRow[]).map((row) => JSON.parse(row.evaluation_json) as OperationalSloEvaluation);
  }

  listPendingAlerts(tenantId: string, projectId: string): OperationalSloAlert[] {
    return (this.database.prepare(`SELECT alert_json FROM operational_slo_alert_outbox
      WHERE tenant_id=? AND project_id=? AND delivered_at IS NULL ORDER BY created_at,alert_id`).all(
      tenantId, projectId,
    ) as AlertRow[]).map((row) => JSON.parse(row.alert_json) as OperationalSloAlert);
  }

  markAlertDelivered(tenantId: string, projectId: string, alertId: string): void {
    const result = this.database.prepare(`UPDATE operational_slo_alert_outbox SET delivered_at=?
      WHERE tenant_id=? AND project_id=? AND alert_id=? AND delivered_at IS NULL`)
      .run(this.now().toISOString(), tenantId, projectId, alertId);
    if (result.changes !== 1) throw new Error('pending SLO alert not found');
  }

  private latestEvaluation(tenantId: string, projectId: string, policyId: string): OperationalSloEvaluation | undefined {
    const row = this.database.prepare(`SELECT evaluation_json FROM operational_slo_evaluations
      WHERE tenant_id=? AND project_id=? AND policy_id=? ORDER BY evaluated_at DESC,evaluation_id DESC LIMIT 1`)
      .get(tenantId, projectId, policyId) as EvaluationRow | undefined;
    return row ? JSON.parse(row.evaluation_json) as OperationalSloEvaluation : undefined;
  }
}

export class OperationalSloMonitor {
  constructor(
    private readonly policies: OperationalSloPolicyStore,
    private readonly events: DurableOperationalEventStore,
    private readonly alerts: OperationalSloAlertSink,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async evaluate(tenantId: string, projectId: string, policyId: string): Promise<OperationalSloEvaluation> {
    const policy = this.policies.get(tenantId, projectId, policyId);
    if (!policy) throw new Error('SLO policy not found');
    if (!policy.enabled) throw new Error('SLO policy is disabled');
    const result = new OperationalSloEvaluator(this.events, this.now).evaluate(policy);
    const evaluation = this.policies.recordEvaluation(policy, result);
    for (const alert of this.policies.listPendingAlerts(tenantId, projectId)) {
      await this.alerts.send(alert);
      this.policies.markAlertDelivered(tenantId, projectId, alert.alertId);
    }
    return evaluation;
  }
}

function validateStoredPolicy(policy: CreateOperationalSloPolicy): void {
  const emptyStore = { list: () => [] } as unknown as DurableOperationalEventStore;
  new OperationalSloEvaluator(emptyStore).evaluate(policy);
}

function sha(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
