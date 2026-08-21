import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { PipelineExecutionCheckpoint, PipelineRecoveryDecision } from './PipelineRecoveryStore.js';

export interface RecoveryHandlerBinding {
  handlerId: string;
  version: string;
  hash: string;
}

export interface RecoveryHandlerSpec<TContext> {
  handlerId: string;
  version: string;
  implementationId: string;
  handler: (context: TContext) => { resultRef: string };
}

export interface ReplayHandlerContext {
  tenantId: string;
  projectId: string;
  instanceId: string;
  decision: PipelineRecoveryDecision;
  decisionHash: string;
}

export interface CheckpointResumeContext extends ReplayHandlerContext {
  checkpoint: PipelineExecutionCheckpoint;
}

export interface DurableRecoveryHandlerResult {
  binding: RecoveryHandlerBinding;
  instanceId: string;
  executionNodeId: string;
  decisionHash: string;
  resultRef: string;
  createdAt: number;
}

class DurableRecoveryHandlerRegistry<TContext extends ReplayHandlerContext> {
  private readonly handlers = new Map<string, { spec: RecoveryHandlerSpec<TContext>; binding: RecoveryHandlerBinding }>();

  constructor(
    private readonly database: Database.Database,
    private readonly kind: 'replay' | 'checkpoint',
    private readonly now: () => number,
  ) {
    this.initializeSchema();
  }

  register(spec: RecoveryHandlerSpec<TContext>): RecoveryHandlerBinding {
    const binding = handlerBinding(spec);
    const key = `${spec.handlerId}@${spec.version}`;
    const existing = this.handlers.get(key);
    if (existing && existing.binding.hash !== binding.hash) throw new Error(`Recovery handler ${key} content conflict`);
    this.handlers.set(key, { spec: { ...spec }, binding });
    return binding;
  }

  execute(binding: RecoveryHandlerBinding, context: TContext, checkpointHash = ''): DurableRecoveryHandlerResult {
    const registered = this.handlers.get(`${binding.handlerId}@${binding.version}`);
    if (!registered) throw new Error(`Unknown ${this.kind} handler ${binding.handlerId}@${binding.version}`);
    if (registered.binding.hash !== binding.hash) throw new Error(`${this.kind} handler binding hash mismatch`);
    const existing = this.findResult(binding, context, checkpointHash);
    if (existing) return existing;
    const output = registered.spec.handler(structuredClone(context));
    requireReference('recovery handler resultRef', output.resultRef);
    try {
      this.database.prepare(`
        INSERT INTO pipeline_recovery_handler_results
          (kind, instance_id, execution_node_id, decision_hash, checkpoint_hash,
           handler_id, handler_version, handler_hash, result_ref, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        this.kind, context.instanceId, context.decision.executionNodeId, context.decisionHash, checkpointHash,
        binding.handlerId, binding.version, binding.hash, output.resultRef, this.now(),
      );
    } catch {
      const raced = this.findResult(binding, context, checkpointHash);
      if (raced) return raced;
      throw new Error(`${this.kind} handler result persistence failed`);
    }
    return this.findResult(binding, context, checkpointHash)!;
  }

  private findResult(
    binding: RecoveryHandlerBinding,
    context: ReplayHandlerContext,
    checkpointHash: string,
  ): DurableRecoveryHandlerResult | undefined {
    const row = this.database.prepare(`
      SELECT handler_id, handler_version, handler_hash, instance_id, execution_node_id,
             decision_hash, checkpoint_hash, result_ref, created_at
      FROM pipeline_recovery_handler_results
      WHERE kind = ? AND instance_id = ? AND execution_node_id = ? AND decision_hash = ?
    `).get(this.kind, context.instanceId, context.decision.executionNodeId, context.decisionHash) as Record<string, unknown> | undefined;
    if (!row) return undefined;
    if (row.handler_id !== binding.handlerId || row.handler_version !== binding.version
      || row.handler_hash !== binding.hash || row.checkpoint_hash !== checkpointHash) {
      throw new Error(`${this.kind} handler durable result binding conflict`);
    }
    return {
      binding: { ...binding },
      instanceId: String(row.instance_id),
      executionNodeId: String(row.execution_node_id),
      decisionHash: String(row.decision_hash),
      resultRef: String(row.result_ref),
      createdAt: Number(row.created_at),
    };
  }

  private initializeSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS pipeline_recovery_handler_results (
        kind TEXT NOT NULL,
        instance_id TEXT NOT NULL,
        execution_node_id TEXT NOT NULL,
        decision_hash TEXT NOT NULL,
        checkpoint_hash TEXT NOT NULL,
        handler_id TEXT NOT NULL,
        handler_version TEXT NOT NULL,
        handler_hash TEXT NOT NULL,
        result_ref TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (kind, instance_id, execution_node_id, decision_hash)
      );
    `);
  }
}

export class ReplayRegistry extends DurableRecoveryHandlerRegistry<ReplayHandlerContext> {
  constructor(database: Database.Database, now: () => number = Date.now) {
    super(database, 'replay', now);
  }
}

export class CheckpointResumeRegistry extends DurableRecoveryHandlerRegistry<CheckpointResumeContext> {
  constructor(database: Database.Database, now: () => number = Date.now) {
    super(database, 'checkpoint', now);
  }

  executeCheckpoint(
    binding: RecoveryHandlerBinding,
    context: CheckpointResumeContext,
    checkpointHash: string,
  ): DurableRecoveryHandlerResult {
    if (context.checkpoint.contentHash !== checkpointHash) throw new Error('Checkpoint resume hash mismatch');
    if (context.decision.checkpoint?.contentHash !== checkpointHash) throw new Error('Checkpoint is not bound to the recovery decision');
    return this.execute(binding, context, checkpointHash);
  }
}

function handlerBinding(spec: Pick<RecoveryHandlerSpec<ReplayHandlerContext>, 'handlerId' | 'version' | 'implementationId'>): RecoveryHandlerBinding {
  for (const [name, value] of Object.entries({
    handlerId: spec.handlerId, version: spec.version, implementationId: spec.implementationId,
  })) if (!value.trim()) throw new Error(`recovery handler ${name} is required`);
  return {
    handlerId: spec.handlerId,
    version: spec.version,
    hash: createHash('sha256').update(JSON.stringify({
      handlerId: spec.handlerId, version: spec.version, implementationId: spec.implementationId,
    })).digest('hex'),
  };
}

function requireReference(name: string, value: string): void {
  if (!value?.trim() || !/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) throw new Error(`${name} must be an artifact-style URI`);
}
