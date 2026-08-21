import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { DurableDispatchWaiterStore } from './DurableDispatchWaiterStore.js';
import type { RecoveryActionCoordinator, RecoveryApprovalCredential } from './RecoveryActionCoordinator.js';
import type { RecoveryCoordinator } from './RecoveryCoordinator.js';
import type {
  CheckpointResumeRegistry,
  RecoveryHandlerBinding,
  ReplayRegistry,
} from './RecoveryHandlerRegistries.js';
import type { PipelineRecoveryDecision } from './PipelineRecoveryStore.js';

export type RecoveryAuditAction = 'skip' | 'reattach_projection' | 'replay' | 'checkpoint_resume' | 'compensate';

export interface RecoveryAuditRecord {
  auditId: number;
  instanceId: string;
  executionNodeId: string;
  decisionHash: string;
  action: RecoveryAuditAction;
  outcome: 'completed' | 'failed' | 'skipped';
  resultRef?: string;
  errorRef?: string;
  createdAt: number;
}

export class RecoveryReconciler {
  constructor(
    private readonly database: Database.Database,
    private readonly recovery: RecoveryCoordinator,
    private readonly waiters: DurableDispatchWaiterStore,
    private readonly actions: RecoveryActionCoordinator,
    private readonly replays: ReplayRegistry,
    private readonly checkpointResumes: CheckpointResumeRegistry,
    private readonly now: () => number = Date.now,
  ) {
    this.initializeSchema();
  }

  reconcile(input: {
    instanceId: string;
    replayRequests?: Record<string, {
      credential: RecoveryApprovalCredential;
      binding: RecoveryHandlerBinding;
      tenantId: string;
      projectId: string;
    }>;
  }): RecoveryAuditRecord[] {
    const written: RecoveryAuditRecord[] = [];
    for (const decision of this.recovery.planRecovery(input.instanceId)) {
      const decisionHash = hashRecoveryDecision(decision);
      if (decision.action === 'skip') {
        written.push(this.record({
          instanceId: input.instanceId, decision, decisionHash, action: 'skip', outcome: 'skipped',
        }));
        continue;
      }
      if (decision.action === 'reattach' && decision.dispatchBinding) {
        const waiter = this.waiters.poll(decision.dispatchBinding.workItemId, decision.dispatchBinding.attemptId);
        if (!waiter || (waiter.status !== 'completed' && waiter.status !== 'failed')) continue;
        written.push(this.record({
          instanceId: input.instanceId,
          decision,
          decisionHash,
          action: 'reattach_projection',
          outcome: waiter.status,
          resultRef: waiter.resultRef,
          errorRef: waiter.errorRef,
        }));
        continue;
      }
      if (decision.action !== 'replay') continue;
      const request = input.replayRequests?.[decision.executionNodeId];
      if (!request) continue;
      const prior = this.find(input.instanceId, decision.executionNodeId, 'replay', decisionHash);
      if (prior) {
        written.push(prior);
        continue;
      }
      if (request.credential.decisionHash !== decisionHash) throw new Error('Replay approval decision hash does not match the current plan');
      this.actions.authorizeNonExecutingAction(request.credential, 'replay');
      const result = this.replays.execute(request.binding, {
        tenantId: request.tenantId,
        projectId: request.projectId,
        instanceId: input.instanceId,
        decision,
        decisionHash,
      });
      written.push(this.record({
        instanceId: input.instanceId, decision, decisionHash, action: 'replay', outcome: 'completed', resultRef: result.resultRef,
      }));
    }
    return written;
  }

  resumeCheckpointed(input: {
    instanceId: string;
    executionNodeId: string;
    credential: RecoveryApprovalCredential;
    binding: RecoveryHandlerBinding;
    checkpointHash: string;
    tenantId: string;
    projectId: string;
  }): RecoveryAuditRecord {
    const decision = this.recovery.planRecovery(input.instanceId)
      .find((candidate) => candidate.executionNodeId === input.executionNodeId);
    if (!decision || decision.action !== 'reattach' || !decision.checkpoint) {
      throw new Error('Checkpoint resume requires a checkpointed reattach decision');
    }
    const decisionHash = hashRecoveryDecision(decision);
    const prior = this.find(input.instanceId, input.executionNodeId, 'checkpoint_resume', decisionHash);
    if (prior) return prior;
    if (input.credential.decisionHash !== decisionHash) throw new Error('Checkpoint approval decision hash does not match the current plan');
    if (decision.checkpoint.contentHash !== input.checkpointHash) throw new Error('Checkpoint resume hash mismatch');
    this.actions.authorizeNonExecutingAction(input.credential, 'replay');
    const result = this.checkpointResumes.executeCheckpoint(input.binding, {
      tenantId: input.tenantId,
      projectId: input.projectId,
      instanceId: input.instanceId,
      decision,
      decisionHash,
      checkpoint: decision.checkpoint,
    }, input.checkpointHash);
    return this.record({
      instanceId: input.instanceId,
      decision,
      decisionHash,
      action: 'checkpoint_resume',
      outcome: 'completed',
      resultRef: result.resultRef,
    });
  }

  recordCompensation(input: {
    instanceId: string;
    executionNodeId: string;
    decisionHash: string;
    receiptRef: string;
  }): RecoveryAuditRecord {
    const decision = this.recovery.planRecovery(input.instanceId)
      .find((candidate) => candidate.executionNodeId === input.executionNodeId);
    if (!decision || hashRecoveryDecision(decision) !== input.decisionHash) {
      throw new Error('Compensation audit rejected because the recovery plan changed');
    }
    return this.record({
      instanceId: input.instanceId, decision, decisionHash: input.decisionHash,
      action: 'compensate', outcome: 'completed', resultRef: input.receiptRef,
    });
  }

  listAudit(instanceId: string): RecoveryAuditRecord[] {
    return (this.database.prepare(`
      SELECT audit_id, instance_id, execution_node_id, decision_hash, action, outcome,
             result_ref, error_ref, created_at
      FROM pipeline_recovery_audit WHERE instance_id = ? ORDER BY audit_id ASC
    `).all(instanceId) as Array<Record<string, unknown>>).map(toAudit);
  }

  private record(input: {
    instanceId: string;
    decision: PipelineRecoveryDecision;
    decisionHash: string;
    action: RecoveryAuditAction;
    outcome: RecoveryAuditRecord['outcome'];
    resultRef?: string;
    errorRef?: string;
  }): RecoveryAuditRecord {
    const existing = this.find(input.instanceId, input.decision.executionNodeId, input.action, input.decisionHash);
    if (existing) return existing;
    try {
      this.database.prepare(`
        INSERT INTO pipeline_recovery_audit
          (instance_id, execution_node_id, decision_hash, action, outcome, result_ref, error_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        input.instanceId, input.decision.executionNodeId, input.decisionHash, input.action,
        input.outcome, input.resultRef ?? null, input.errorRef ?? null, this.now(),
      );
    } catch {
      const raced = this.find(input.instanceId, input.decision.executionNodeId, input.action, input.decisionHash);
      if (raced) return raced;
      throw new Error(`Recovery audit persistence failed for ${input.decision.executionNodeId}/${input.action}`);
    }
    return this.find(input.instanceId, input.decision.executionNodeId, input.action, input.decisionHash)!;
  }

  private find(
    instanceId: string,
    executionNodeId: string,
    action: RecoveryAuditAction,
    decisionHash: string,
  ): RecoveryAuditRecord | undefined {
    const row = this.database.prepare(`
      SELECT audit_id, instance_id, execution_node_id, decision_hash, action, outcome,
             result_ref, error_ref, created_at
      FROM pipeline_recovery_audit
      WHERE instance_id = ? AND execution_node_id = ? AND action = ? AND decision_hash = ?
    `).get(instanceId, executionNodeId, action, decisionHash) as Record<string, unknown> | undefined;
    return row ? toAudit(row) : undefined;
  }

  private initializeSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_recovery_audit (
        audit_id INTEGER PRIMARY KEY AUTOINCREMENT,
        instance_id TEXT NOT NULL,
        execution_node_id TEXT NOT NULL,
        decision_hash TEXT NOT NULL,
        action TEXT NOT NULL,
        outcome TEXT NOT NULL,
        result_ref TEXT,
        error_ref TEXT,
        created_at INTEGER NOT NULL,
        UNIQUE (instance_id, execution_node_id, action, decision_hash)
      );
    `);
  }
}

export function hashRecoveryDecision(decision: PipelineRecoveryDecision): string {
  return createHash('sha256').update(JSON.stringify(decision)).digest('hex');
}

function toAudit(row: Record<string, unknown>): RecoveryAuditRecord {
  return {
    auditId: Number(row.audit_id),
    instanceId: String(row.instance_id),
    executionNodeId: String(row.execution_node_id),
    decisionHash: String(row.decision_hash),
    action: String(row.action) as RecoveryAuditAction,
    outcome: String(row.outcome) as RecoveryAuditRecord['outcome'],
    ...(row.result_ref ? { resultRef: String(row.result_ref) } : {}),
    ...(row.error_ref ? { errorRef: String(row.error_ref) } : {}),
    createdAt: Number(row.created_at),
  };
}
