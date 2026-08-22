import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type ManualRecoveryAction = 'replay' | 'compensate' | 'skip';

export interface ManualRecoveryApproval {
  approvalId: string;
  tenantId: string;
  projectId: string;
  instanceId: string;
  executionNodeId: string;
  decisionHash: string;
  action: ManualRecoveryAction;
  approver: string;
  evidenceRef: string;
  expiresAt: number;
  createdAt: number;
  usedAt?: number;
}

interface ApprovalRow {
  approval_id: string;
  tenant_id: string;
  project_id: string;
  instance_id: string;
  execution_node_id: string;
  decision_hash: string;
  action: ManualRecoveryAction;
  approver: string;
  evidence_ref: string;
  token_hash: string;
  expires_at: number;
  created_at: number;
  used_at: number | null;
}

export class ManualRecoveryApprovalStore {
  constructor(
    private readonly database: Database.Database,
    private readonly now: () => number = Date.now,
  ) {
    this.initializeSchema();
  }

  approve(input: {
    tenantId: string;
    projectId: string;
    instanceId: string;
    executionNodeId: string;
    decisionHash: string;
    action: ManualRecoveryAction;
    approver: string;
    evidenceRef: string;
    expiresAt: number;
  }): { approval: ManualRecoveryApproval; token: string } {
    validateApprovalInput(input);
    const now = this.now();
    if (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now) throw new Error('approval expiry must be in the future');
    const approvalId = `recovery-approval-${randomUUID()}`;
    const token = randomBytes(32).toString('base64url');
    this.database.prepare(`
      INSERT INTO pipeline_manual_recovery_approvals
        (approval_id, tenant_id, project_id, instance_id, execution_node_id,
         decision_hash, action, approver, evidence_ref, token_hash, expires_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      approvalId, input.tenantId, input.projectId, input.instanceId, input.executionNodeId,
      input.decisionHash, input.action, input.approver, input.evidenceRef,
      hashToken(token), input.expiresAt, now,
    );
    return { approval: this.requireApproval(approvalId), token };
  }

  consume(input: {
    approvalId: string;
    token: string;
    tenantId: string;
    projectId: string;
    instanceId: string;
    executionNodeId: string;
    decisionHash: string;
    action: ManualRecoveryAction;
  }): ManualRecoveryApproval {
    const row = this.requireRow(input.approvalId);
    if (row.tenant_id !== input.tenantId || row.project_id !== input.projectId
      || row.instance_id !== input.instanceId || row.execution_node_id !== input.executionNodeId
      || row.action !== input.action) throw new Error('Manual recovery approval binding mismatch');
    if (row.decision_hash !== input.decisionHash) throw new Error('Manual recovery approval rejected because the plan changed');
    if (row.token_hash !== hashToken(input.token)) throw new Error('Manual recovery approval token mismatch');
    const now = this.now();
    if (row.expires_at <= now) throw new Error('Manual recovery approval expired');
    if (row.used_at !== null) throw new Error('Manual recovery approval token was already used');
    const result = this.database.prepare(`
      UPDATE pipeline_manual_recovery_approvals
      SET used_at = ?
      WHERE approval_id = ? AND used_at IS NULL AND expires_at > ? AND token_hash = ? AND decision_hash = ?
    `).run(now, input.approvalId, now, hashToken(input.token), input.decisionHash);
    if (result.changes !== 1) throw new Error('Manual recovery approval CAS rejected');
    return this.requireApproval(input.approvalId);
  }

  private requireApproval(approvalId: string): ManualRecoveryApproval {
    return toApproval(this.requireRow(approvalId));
  }

  private requireRow(approvalId: string): ApprovalRow {
    const row = this.database.prepare(`
      SELECT approval_id, tenant_id, project_id, instance_id, execution_node_id,
             decision_hash, action, approver, evidence_ref, token_hash, expires_at, created_at, used_at
      FROM pipeline_manual_recovery_approvals WHERE approval_id = ?
    `).get(approvalId) as ApprovalRow | undefined;
    if (!row) throw new Error(`Manual recovery approval ${approvalId} not found`);
    return row;
  }

  private initializeSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_manual_recovery_approvals (
        approval_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        execution_node_id TEXT NOT NULL,
        decision_hash TEXT NOT NULL,
        action TEXT NOT NULL,
        approver TEXT NOT NULL,
        evidence_ref TEXT NOT NULL,
        token_hash TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        used_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_pipeline_manual_recovery_binding
        ON pipeline_manual_recovery_approvals(instance_id, execution_node_id, action, expires_at);
    `);
  }
}

function validateApprovalInput(input: {
  tenantId: string; projectId: string; instanceId: string; executionNodeId: string;
  decisionHash: string; action: ManualRecoveryAction; approver: string; evidenceRef: string;
}): void {
  for (const [name, value] of Object.entries({
    tenantId: input.tenantId,
    projectId: input.projectId,
    instanceId: input.instanceId,
    executionNodeId: input.executionNodeId,
    decisionHash: input.decisionHash,
    action: input.action,
    approver: input.approver,
    evidenceRef: input.evidenceRef,
  })) requireText(name, value);
  if (!/^[a-f0-9]{64}$/.test(input.decisionHash)) throw new Error('decisionHash must be a lowercase SHA-256 hash');
  if (!['replay', 'compensate', 'skip'].includes(input.action)) throw new Error('Manual recovery action is invalid');
  requireReference('evidenceRef', input.evidenceRef);
}

function toApproval(row: ApprovalRow): ManualRecoveryApproval {
  return {
    approvalId: row.approval_id,
    tenantId: row.tenant_id,
    projectId: row.project_id,
    instanceId: row.instance_id,
    executionNodeId: row.execution_node_id,
    decisionHash: row.decision_hash,
    action: row.action,
    approver: row.approver,
    evidenceRef: row.evidence_ref,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    ...(row.used_at === null ? {} : { usedAt: row.used_at }),
  };
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function requireText(name: string, value: string): void {
  if (!value?.trim()) throw new Error(`${name} is required`);
}

function requireReference(name: string, value: string): void {
  requireText(name, value);
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) throw new Error(`${name} must be an artifact-style URI`);
}
