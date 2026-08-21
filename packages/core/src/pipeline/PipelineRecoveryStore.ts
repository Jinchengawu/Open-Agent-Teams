import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import { DurableDispatchWaiterStore } from './DurableDispatchWaiterStore.js';

export type PipelineResumePolicy = 'replay_safe' | 'checkpointed' | 'manual';
export type PipelineSideEffectState = 'none' | 'pending' | 'committed' | 'compensated' | 'unknown';
export type PipelineExecutionRecoveryStatus = 'pending' | 'running' | 'interrupted' | 'completed' | 'failed';

export interface PipelineDispatchBinding {
  workItemId: string;
  attemptId: string;
}

export interface PipelineExecutionCheckpoint {
  executionNodeId: string;
  workItemId: string;
  attemptId: string;
  sequence: number;
  cursor: string;
  completedUnitIds: string[];
  savedAt: number;
  contentHash: string;
}

export interface PipelineRecoveryDecision {
  executionNodeId: string;
  action: 'skip' | 'reattach' | 'replay' | 'manual';
  reason: string;
  dispatchBinding?: PipelineDispatchBinding;
  checkpoint?: PipelineExecutionCheckpoint;
}

interface RecoveryNodeRow {
  instance_id: string;
  execution_node_id: string;
  surface_id: string;
  task_id: string;
  resume_policy: string;
  side_effect_state: string;
  status: string;
  work_item_id: string | null;
  attempt_id: string | null;
  checkpoint_json: string | null;
}

/**
 * Durable metadata needed to decide whether a Pipeline node may be resumed.
 *
 * This store deliberately plans recovery only. It never reruns a Team or
 * changes a ManagedAgentWorkQueue item, so callers cannot mistake metadata
 * recovery for execution recovery.
 */
export class PipelineRecoveryStore {
  private readonly dispatchWaiters: DurableDispatchWaiterStore;

  constructor(
    private readonly database: Database.Database,
    private readonly now: () => number = Date.now,
  ) {
    this.initializeSchema();
    this.dispatchWaiters = new DurableDispatchWaiterStore(database, now);
  }

  createRun(input: {
    instanceId: string;
    pipelineId: string;
    definitionHash: string;
    initialInputRef: string;
  }): void {
    requireText('instanceId', input.instanceId);
    requireText('pipelineId', input.pipelineId);
    if (!/^[a-f0-9]{64}$/.test(input.definitionHash)) {
      throw new Error('definitionHash must be a lowercase SHA-256 hash');
    }
    requireText('initialInputRef', input.initialInputRef);
    if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(input.initialInputRef)) {
      throw new Error('initialInputRef must be an artifact-style URI, not raw Pipeline input');
    }
    const existing = this.database.prepare(`
      SELECT pipeline_id, definition_hash, initial_input_ref
      FROM pipeline_recovery_runs WHERE instance_id = ?
    `).get(input.instanceId) as Record<string, unknown> | undefined;
    if (existing) {
      if (existing.pipeline_id === input.pipelineId
        && existing.definition_hash === input.definitionHash
        && existing.initial_input_ref === input.initialInputRef) return;
      throw new Error(`Pipeline recovery run ${input.instanceId} already exists with a different contract`);
    }
    const now = this.now();
    this.database.prepare(`
      INSERT INTO pipeline_recovery_runs
        (instance_id, pipeline_id, definition_hash, initial_input_ref, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'running', ?, ?)
    `).run(input.instanceId, input.pipelineId, input.definitionHash, input.initialInputRef, now, now);
  }

  getRunContract(instanceId: string): { instanceId: string; pipelineId: string; definitionHash: string; initialInputRef: string; status: string } {
    const run = this.requireRun(instanceId);
    return {
      instanceId: String(run.instance_id), pipelineId: String(run.pipeline_id),
      definitionHash: String(run.definition_hash), initialInputRef: String(run.initial_input_ref), status: String(run.status),
    };
  }

  registerExecutionNode(input: {
    instanceId: string;
    executionNodeId: string;
    surfaceId: string;
    taskId: string;
    resumePolicy: PipelineResumePolicy;
    sideEffectState?: PipelineSideEffectState;
  }): void {
    this.requireRun(input.instanceId);
    requireText('executionNodeId', input.executionNodeId);
    requireText('surfaceId', input.surfaceId);
    requireText('taskId', input.taskId);
    const sideEffectState = input.sideEffectState ?? 'unknown';
    const existing = this.getNode(input.instanceId, input.executionNodeId);
    if (existing) {
      const same = existing.surface_id === input.surfaceId
        && existing.task_id === input.taskId
        && existing.resume_policy === input.resumePolicy
        && existing.side_effect_state === sideEffectState;
      if (same) return;
      throw new Error(`Execution node ${input.executionNodeId} already exists with a different recovery contract`);
    }
    const now = this.now();
    this.database.prepare(`
      INSERT INTO pipeline_recovery_nodes
        (instance_id, execution_node_id, surface_id, task_id, resume_policy,
         side_effect_state, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)
    `).run(
      input.instanceId,
      input.executionNodeId,
      input.surfaceId,
      input.taskId,
      input.resumePolicy,
      sideEffectState,
      now,
      now,
    );
  }

  bindDispatch(
    instanceId: string,
    executionNodeId: string,
    binding: PipelineDispatchBinding,
  ): void {
    requireText('workItemId', binding.workItemId);
    requireText('attemptId', binding.attemptId);
    const node = this.requireNode(instanceId, executionNodeId);
    if (node.work_item_id || node.attempt_id) {
      if (node.work_item_id === binding.workItemId && node.attempt_id === binding.attemptId) {
        this.dispatchWaiters.subscribe({ instanceId, executionNodeId, ...binding });
        return;
      }
      throw new Error(`Execution node ${executionNodeId} already has a different dispatch binding`);
    }
    this.database.transaction(() => {
      this.database.prepare(`
        UPDATE pipeline_recovery_nodes
        SET work_item_id = ?, attempt_id = ?, updated_at = ?
        WHERE instance_id = ? AND execution_node_id = ?
          AND work_item_id IS NULL AND attempt_id IS NULL
      `).run(binding.workItemId, binding.attemptId, this.now(), instanceId, executionNodeId);
      this.dispatchWaiters.subscribe({ instanceId, executionNodeId, ...binding });
    })();
  }

  saveCheckpoint(
    instanceId: string,
    executionNodeId: string,
    input: { sequence: number; cursor: string; completedUnitIds?: string[] },
  ): PipelineExecutionCheckpoint {
    const node = this.requireNode(instanceId, executionNodeId);
    if (node.resume_policy !== 'checkpointed') {
      throw new Error(`Execution node ${executionNodeId} is not checkpointed`);
    }
    if (!node.work_item_id || !node.attempt_id) {
      throw new Error(`Execution node ${executionNodeId} has no durable dispatch binding`);
    }
    if (!Number.isSafeInteger(input.sequence) || input.sequence < 0) {
      throw new Error('checkpoint sequence must be a non-negative integer');
    }
    requireText('checkpoint cursor', input.cursor);
    const previous = parseCheckpoint(node.checkpoint_json);
    if (previous && input.sequence <= previous.sequence) {
      throw new Error('checkpoint sequence must increase');
    }
    const body = {
      executionNodeId,
      workItemId: node.work_item_id,
      attemptId: node.attempt_id,
      sequence: input.sequence,
      cursor: input.cursor,
      completedUnitIds: [...new Set(input.completedUnitIds ?? [])].sort(),
      savedAt: this.now(),
    };
    const checkpoint: PipelineExecutionCheckpoint = {
      ...body,
      contentHash: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
    };
    this.database.prepare(`
      UPDATE pipeline_recovery_nodes
      SET checkpoint_json = ?, updated_at = ?
      WHERE instance_id = ? AND execution_node_id = ?
    `).run(JSON.stringify(checkpoint), this.now(), instanceId, executionNodeId);
    return structuredClone(checkpoint);
  }

  markInterrupted(instanceId: string, reason: string): void {
    this.requireRun(instanceId);
    requireText('interruption reason', reason);
    const now = this.now();
    this.database.transaction(() => {
      this.database.prepare(`
        UPDATE pipeline_recovery_runs
        SET status = 'interrupted', interruption_reason = ?, updated_at = ?
        WHERE instance_id = ?
      `).run(reason, now, instanceId);
      this.database.prepare(`
        UPDATE pipeline_recovery_nodes
        SET status = 'interrupted', updated_at = ?
        WHERE instance_id = ? AND status = 'running'
      `).run(now, instanceId);
    })();
  }

  planRecovery(instanceId: string): PipelineRecoveryDecision[] {
    const run = this.requireRun(instanceId);
    if (run.status !== 'interrupted') {
      throw new Error(`Pipeline recovery run ${instanceId} is ${String(run.status)}, not interrupted`);
    }
    const rows = this.database.prepare(`
      SELECT instance_id, execution_node_id, surface_id, task_id, resume_policy,
             side_effect_state, status, work_item_id, attempt_id, checkpoint_json
      FROM pipeline_recovery_nodes
      WHERE instance_id = ?
      ORDER BY created_at ASC, execution_node_id ASC
    `).all(instanceId) as RecoveryNodeRow[];
    return rows.map((row) => this.planNode(row));
  }

  private planNode(row: RecoveryNodeRow): PipelineRecoveryDecision {
    if (row.status === 'completed') {
      return { executionNodeId: row.execution_node_id, action: 'skip', reason: 'execution already completed' };
    }
    if (row.side_effect_state !== 'none' && row.side_effect_state !== 'compensated') {
      return {
        executionNodeId: row.execution_node_id,
        action: 'manual',
        reason: `side effect state ${row.side_effect_state || 'unknown'} is not safe to replay`,
      };
    }
    if (row.resume_policy === 'manual') {
      return { executionNodeId: row.execution_node_id, action: 'manual', reason: 'execution requires manual recovery' };
    }
    if (row.resume_policy === 'replay_safe') {
      return { executionNodeId: row.execution_node_id, action: 'replay', reason: 'execution is explicitly replay safe' };
    }
    const checkpoint = parseCheckpoint(row.checkpoint_json);
    if (row.resume_policy === 'checkpointed' && row.work_item_id && row.attempt_id && checkpoint) {
      this.validateCheckpoint(row, checkpoint);
      return {
        executionNodeId: row.execution_node_id,
        action: 'reattach',
        reason: 'checkpointed execution has a durable dispatch binding and checkpoint',
        dispatchBinding: { workItemId: row.work_item_id, attemptId: row.attempt_id },
        checkpoint,
      };
    }
    return {
      executionNodeId: row.execution_node_id,
      action: 'manual',
      reason: 'checkpointed execution is missing a durable dispatch binding or checkpoint',
    };
  }

  private validateCheckpoint(row: RecoveryNodeRow, checkpoint: PipelineExecutionCheckpoint): void {
    const { contentHash, ...body } = checkpoint;
    const expectedHash = createHash('sha256').update(JSON.stringify(body)).digest('hex');
    if (checkpoint.executionNodeId !== row.execution_node_id
      || checkpoint.workItemId !== row.work_item_id
      || checkpoint.attemptId !== row.attempt_id
      || contentHash !== expectedHash) {
      throw new Error(`Pipeline checkpoint provenance validation failed for ${row.execution_node_id}`);
    }
  }

  private initializeSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_recovery_runs (
        instance_id TEXT PRIMARY KEY,
        pipeline_id TEXT NOT NULL,
        definition_hash TEXT NOT NULL,
        initial_input_ref TEXT NOT NULL,
        status TEXT NOT NULL,
        interruption_reason TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS pipeline_recovery_nodes (
        instance_id TEXT NOT NULL,
        execution_node_id TEXT NOT NULL,
        surface_id TEXT NOT NULL,
        task_id TEXT NOT NULL,
        resume_policy TEXT NOT NULL,
        side_effect_state TEXT NOT NULL,
        status TEXT NOT NULL,
        work_item_id TEXT,
        attempt_id TEXT,
        checkpoint_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (instance_id, execution_node_id),
        FOREIGN KEY (instance_id) REFERENCES pipeline_recovery_runs(instance_id) ON DELETE CASCADE
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_pipeline_recovery_dispatch
        ON pipeline_recovery_nodes(work_item_id)
        WHERE work_item_id IS NOT NULL;
    `);
  }

  private requireRun(instanceId: string): Record<string, unknown> {
    const row = this.database.prepare(`
      SELECT instance_id, pipeline_id, definition_hash, initial_input_ref, status
      FROM pipeline_recovery_runs WHERE instance_id = ?
    `).get(instanceId) as Record<string, unknown> | undefined;
    if (!row) throw new Error(`Pipeline recovery run ${instanceId} not found`);
    return row;
  }

  private getNode(instanceId: string, executionNodeId: string): RecoveryNodeRow | undefined {
    return this.database.prepare(`
      SELECT instance_id, execution_node_id, surface_id, task_id, resume_policy,
             side_effect_state, status, work_item_id, attempt_id, checkpoint_json
      FROM pipeline_recovery_nodes
      WHERE instance_id = ? AND execution_node_id = ?
    `).get(instanceId, executionNodeId) as RecoveryNodeRow | undefined;
  }

  private requireNode(instanceId: string, executionNodeId: string): RecoveryNodeRow {
    const node = this.getNode(instanceId, executionNodeId);
    if (!node) throw new Error(`Execution node ${executionNodeId} not found in ${instanceId}`);
    return node;
  }
}

function parseCheckpoint(value: string | null): PipelineExecutionCheckpoint | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as PipelineExecutionCheckpoint;
    if (!parsed || typeof parsed !== 'object') throw new Error('invalid checkpoint');
    return parsed;
  } catch {
    throw new Error('Pipeline checkpoint JSON is invalid');
  }
}

function requireText(name: string, value: string): void {
  if (!value?.trim()) throw new Error(`${name} is required`);
}
