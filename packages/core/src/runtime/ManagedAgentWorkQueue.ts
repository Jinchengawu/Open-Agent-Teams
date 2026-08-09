import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { AgentRunResult } from '../orchestrator/types.js';
import {
  ManagedArtifactContractError,
  ManagedArtifactBindingError,
  ManagedArtifactIdempotencyConflictError,
  ManagedArtifactAcceptanceError,
  ManagedArtifactTaskScopeError,
  validateManagedArtifactEnvelope,
  type ManagedArtifactEnvelope,
} from './ManagedArtifactContract.js';
import {
  captureManagedWorkspaceSnapshot,
  ManagedCodeChangeVerificationError,
  verifyManagedCodeChange,
  type ManagedWorkspacePolicy,
  type ManagedWorkspaceSnapshot,
} from './ManagedCodeChangeVerification.js';

export type ManagedAgentWorkStatus =
  | 'pending'
  | 'claimed'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'timed_out'
  | 'interrupted';

export interface ManagedAgentWorkItem {
  id: string;
  agentId: string;
  goal: string;
  sessionId?: string;
  surfaceId?: string;
  taskId?: string;
  taskContract?: ManagedTaskContract;
  inputArtifactRefs?: ManagedArtifactReference[];
  attemptId: string;
  status: ManagedAgentWorkStatus;
  createdAt: number;
  updatedAt: number;
  claimedBy?: string;
  leaseExpiresAt?: number;
  error?: string;
  output?: string;
  artifact?: ManagedArtifactEnvelope;
  workspaceSnapshot?: ManagedWorkspaceSnapshot;
}

/** Immutable upstream Artifact binding supplied to a managed worker. */
export interface ManagedArtifactReference {
  surfaceId: string;
  artifactId: string;
  contentHash: string;
}

export interface ManagedTaskContract {
  sourceTaskId: string;
  title: string;
  ownerAgent: string;
  dependsOn: string[];
  acceptanceIds: string[];
  allowedPaths: string[];
  expectedArtifactKind: string;
  expectedMutation: boolean;
}

export interface ManagedAgentWorkerHeartbeat {
  workerId: string;
  agentIds?: string[];
  ttlMs?: number;
}

export interface ManagedAgentWorkerAudit {
  workerId: string;
  agentIds: string[];
  lastSeenAt: number;
  expiresAt: number;
  active: boolean;
}

interface ManagedAgentWorker {
  workerId: string;
  agentIds: Set<string>;
  lastSeenAt: number;
  expiresAt: number;
}

interface PendingRequest {
  resolve: (result: AgentRunResult) => void;
  timeout: ReturnType<typeof setTimeout>;
  signal?: AbortSignal;
  onAbort?: () => void;
}

interface AcceptedArtifactRecord {
  artifactId: string;
  workItemId: string;
  contentHash: string;
  workerId: string;
  claimTokenHash: string;
}

function narrowWorkspacePolicy(
  policy: ManagedWorkspacePolicy,
  contract: ManagedTaskContract,
): ManagedWorkspacePolicy {
  if (contract.acceptanceIds.length === 0) throw new Error('task contract acceptanceIds are required');
  if (contract.allowedPaths.length === 0) throw new Error('task contract allowedPaths are required');
  const outsideSurfacePolicy = contract.allowedPaths.filter((taskPath) =>
    !policy.allowedPaths.some((surfacePath) => pathScopeContains(surfacePath, taskPath)),
  );
  if (outsideSurfacePolicy.length > 0) {
    throw new Error(`task contract allowedPaths exceed the Surface workspace policy: ${outsideSurfacePolicy.join(', ')}`);
  }
  return { ...policy, allowedPaths: [...contract.allowedPaths] };
}

function pathScopeContains(parentScope: string, childScope: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/$/, '');
  const parent = normalize(parentScope).replace(/\/\*\*$/, '');
  const child = normalize(childScope).replace(/\/\*\*$/, '');
  return parent === '' || parent === '.' || child === parent || child.startsWith(`${parent}/`);
}

export class ManagedAgentWorkQueue {
  private readonly items = new Map<string, ManagedAgentWorkItem>();
  private readonly workers = new Map<string, ManagedAgentWorker>();
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private readonly claimTokens = new Map<string, string>();
  private readonly acceptedArtifacts = new Map<string, AcceptedArtifactRecord>();
  private readonly workerTtlMs: number;
  private readonly defaultWorkTimeoutMs: number;
  private readonly now: () => number;
  private readonly database?: Database.Database;
  private readonly processId = randomUUID();

  constructor(options: {
    workerTtlMs?: number;
    defaultWorkTimeoutMs?: number;
    now?: () => number;
    database?: Database.Database;
  } = {}) {
    this.workerTtlMs = options.workerTtlMs ?? 30_000;
    this.defaultWorkTimeoutMs = options.defaultWorkTimeoutMs ?? 300_000;
    this.now = options.now ?? Date.now;
    this.database = options.database;
    this.initializePersistence();
  }

  heartbeat(input: ManagedAgentWorkerHeartbeat): { workerId: string; expiresAt: number } {
    if (!input.workerId?.trim()) throw new Error('workerId is required');
    const lastSeenAt = this.now();
    const expiresAt = lastSeenAt + Math.max(1_000, input.ttlMs ?? this.workerTtlMs);
    this.workers.set(input.workerId, {
      workerId: input.workerId,
      agentIds: new Set(input.agentIds ?? []),
      lastSeenAt,
      expiresAt,
    });
    this.database?.prepare(`
      INSERT INTO managed_agent_worker_heartbeats
        (worker_id, process_id, agent_ids, last_seen_at, expires_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(worker_id) DO UPDATE SET
        process_id = excluded.process_id,
        agent_ids = excluded.agent_ids,
        last_seen_at = excluded.last_seen_at,
        expires_at = excluded.expires_at
    `).run(input.workerId, this.processId, JSON.stringify(input.agentIds ?? []), lastSeenAt, expiresAt);
    return { workerId: input.workerId, expiresAt };
  }

  hasActiveWorker(agentId?: string): boolean {
    this.expireWorkersAndClaims();
    return [...this.workers.values()].some((worker) =>
      !agentId || worker.agentIds.has(agentId),
    );
  }

  listWorkerHeartbeats(): ManagedAgentWorkerAudit[] {
    this.expireWorkersAndClaims();
    if (!this.database) {
      return [...this.workers.values()].map((worker) => ({
        workerId: worker.workerId,
        agentIds: [...worker.agentIds],
        lastSeenAt: worker.lastSeenAt,
        expiresAt: worker.expiresAt,
        active: true,
      }));
    }
    const rows = this.database.prepare(`
      SELECT worker_id, process_id, agent_ids, last_seen_at, expires_at
      FROM managed_agent_worker_heartbeats
      ORDER BY last_seen_at DESC
    `).all() as Array<Record<string, unknown>>;
    return rows.map((row) => {
      let agentIds: string[] = [];
      try {
        const parsed = JSON.parse(String(row.agent_ids));
        if (Array.isArray(parsed)) agentIds = parsed.map(String);
      } catch {
        agentIds = [];
      }
      const workerId = String(row.worker_id);
      return {
        workerId,
        agentIds,
        lastSeenAt: Number(row.last_seen_at),
        expiresAt: Number(row.expires_at),
        active: row.process_id === this.processId && this.workers.has(workerId),
      };
    });
  }

  list(filter: { status?: ManagedAgentWorkStatus; agentId?: string } = {}): ManagedAgentWorkItem[] {
    this.expireWorkersAndClaims();
    return [...this.items.values()]
      .filter((item) => !filter.status || item.status === filter.status)
      .filter((item) => !filter.agentId || item.agentId === filter.agentId)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((item) => ({ ...item }));
  }

  getArtifact(artifactId: string): ManagedArtifactEnvelope | undefined {
    if (!this.acceptedArtifacts.has(artifactId)) return undefined;
    const artifact = [...this.items.values()]
      .find((item) => item.artifact?.artifactId === artifactId)?.artifact;
    return artifact ? structuredClone(artifact) : undefined;
  }

  listArtifacts(filter: { taskId?: string } = {}): ManagedArtifactEnvelope[] {
    return [...this.items.values()]
      .filter((item) => !filter.taskId || item.taskId === filter.taskId)
      .filter((item) => item.artifact && this.acceptedArtifacts.has(item.artifact.artifactId))
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((item) => structuredClone(item.artifact!));
  }

  enqueueAndWait(input: {
    agentId: string;
    goal: string;
    sessionId?: string;
    surfaceId?: string;
    taskId?: string;
    taskContract?: ManagedTaskContract;
    inputArtifactRefs?: ManagedArtifactReference[];
    workspacePolicy?: ManagedWorkspacePolicy;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<AgentRunResult> {
    if (!this.hasActiveWorker(input.agentId)) {
      return Promise.reject(new Error(`No active managed external worker for Agent ${input.agentId}`));
    }

    const id = `managed-work-${randomUUID()}`;
    const now = this.now();
    const workspacePolicy = input.taskContract && input.workspacePolicy
      ? narrowWorkspacePolicy(input.workspacePolicy, input.taskContract)
      : input.workspacePolicy;
    const workspaceSnapshot = (
      input.surfaceId === 'frontend' || input.surfaceId === 'backend'
    ) && workspacePolicy
      ? captureManagedWorkspaceSnapshot(workspacePolicy)
      : undefined;
    this.items.set(id, {
      id,
      agentId: input.agentId,
      goal: input.goal,
      sessionId: input.sessionId,
      surfaceId: input.surfaceId,
      taskId: input.taskId,
      taskContract: input.taskContract ? {
        sourceTaskId: input.taskContract.sourceTaskId,
        title: input.taskContract.title,
        ownerAgent: input.taskContract.ownerAgent,
        dependsOn: [...input.taskContract.dependsOn],
        acceptanceIds: [...input.taskContract.acceptanceIds],
        allowedPaths: [...input.taskContract.allowedPaths],
        expectedArtifactKind: input.taskContract.expectedArtifactKind,
        expectedMutation: input.taskContract.expectedMutation,
      } : undefined,
      inputArtifactRefs: input.inputArtifactRefs?.map((reference) => ({ ...reference })),
      attemptId: `attempt-${id}-01`,
      status: 'pending',
      createdAt: now,
      updatedAt: now,
      workspaceSnapshot,
    });
    this.persistItem(this.items.get(id)!);

    return new Promise<AgentRunResult>((resolve) => {
      const finishWithFailure = (status: 'cancelled' | 'timed_out', message: string) => {
        const item = this.items.get(id);
        if (!item || !this.pendingRequests.has(id)) return;
        item.status = status;
        item.error = message;
        item.updatedAt = this.now();
        this.persistItem(item);
        this.settle(id, this.failureResult(message));
      };
      const timeoutMs = input.timeoutMs ?? this.defaultWorkTimeoutMs;
      const timeout = setTimeout(
        () => finishWithFailure('timed_out', `Managed external Agent work timed out after ${timeoutMs}ms`),
        timeoutMs,
      );
      timeout.unref?.();
      const onAbort = () => finishWithFailure('cancelled', 'Managed external Agent work cancelled');
      this.pendingRequests.set(id, { resolve, timeout, signal: input.signal, onAbort });
      if (input.signal?.aborted) onAbort();
      else input.signal?.addEventListener('abort', onAbort, { once: true });
    });
  }

  claim(
    workItemId: string,
    input: { workerId: string; leaseMs?: number },
  ): { workItem: ManagedAgentWorkItem; claimToken: string } {
    this.expireWorkersAndClaims();
    const item = this.requireItem(workItemId);
    const worker = this.workers.get(input.workerId);
    if (!worker || worker.expiresAt <= this.now()) throw new Error(`Worker ${input.workerId} is not active`);
    if (worker.agentIds.size > 0 && !worker.agentIds.has(item.agentId)) {
      throw new Error(`Worker ${input.workerId} cannot claim Agent ${item.agentId} work`);
    }
    if (item.status !== 'pending') throw new Error(`Work item ${workItemId} is already ${item.status}`);

    const claimToken = randomUUID();
    item.status = 'claimed';
    item.claimedBy = input.workerId;
    item.leaseExpiresAt = this.now() + Math.max(1_000, input.leaseMs ?? this.workerTtlMs);
    item.updatedAt = this.now();
    this.claimTokens.set(item.id, claimToken);
    this.persistItem(item);
    return { workItem: { ...item }, claimToken };
  }

  complete(workItemId: string, input: {
    workerId: string;
    claimToken: string;
    output: string;
    artifact?: ManagedArtifactEnvelope;
    toolCalls?: AgentRunResult['toolCalls'];
  }): ManagedAgentWorkItem {
    const item = this.requireItem(workItemId);
    if ((item.surfaceId === 'frontend' || item.surfaceId === 'backend')
      && item.taskContract && input.artifact) {
      const acceptanceIds = [...(input.artifact.acceptanceIds ?? [])].sort();
      const expectedAcceptanceIds = [...item.taskContract.acceptanceIds].sort();
      if (JSON.stringify(acceptanceIds) !== JSON.stringify(expectedAcceptanceIds)) {
        throw new ManagedArtifactAcceptanceError(item.surfaceId, [
          'artifact acceptanceIds do not match the task contract',
        ]);
      }
      const scope = input.artifact.payload?.scope as Record<string, unknown> | undefined;
      const allowedPaths = Array.isArray(scope?.allowedPaths) ? [...scope.allowedPaths].sort() : [];
      const expectedAllowedPaths = [...item.taskContract.allowedPaths].sort();
      if (JSON.stringify(allowedPaths) !== JSON.stringify(expectedAllowedPaths)) {
        throw new ManagedArtifactTaskScopeError(item.surfaceId, [
          'artifact scope.allowedPaths do not match the task contract',
        ]);
      }
    }
    if (item.surfaceId) {
      const validation = validateManagedArtifactEnvelope(item.surfaceId, input.artifact, {
        sessionId: item.sessionId,
        taskId: item.taskId,
        attemptId: item.attemptId,
        agentId: item.agentId,
        workerId: input.workerId,
      });
      if (!validation.valid) {
        if (validation.code === 'ARTIFACT_BINDING_MISMATCH') {
          throw new ManagedArtifactBindingError(item.surfaceId, validation.issues);
        }
        throw new ManagedArtifactContractError(item.surfaceId, validation.issues);
      }
    }
    if (item.surfaceId === 'frontend' || item.surfaceId === 'backend') {
      if (!item.workspaceSnapshot || !input.artifact) {
        throw new ManagedCodeChangeVerificationError(
          'ARTIFACT_EVIDENCE_UNRESOLVABLE',
          422,
          item.surfaceId,
          ['implementation work item is missing a captured workspace snapshot'],
        );
      }
      verifyManagedCodeChange(item.workspaceSnapshot, input.artifact);
    }
    const artifactId = input.artifact?.artifactId;
    const contentHash = typeof input.artifact?.contentHash === 'string' ? input.artifact.contentHash : undefined;
    if (artifactId && contentHash) {
      const accepted = this.acceptedArtifacts.get(artifactId);
      if (accepted) {
        const claimTokenHash = this.hashSecret(input.claimToken);
        if (accepted.workItemId !== workItemId || accepted.contentHash !== contentHash) {
          throw new ManagedArtifactIdempotencyConflictError(item.surfaceId || 'unknown', [
            'artifactId was already accepted with different content or work item binding',
          ]);
        }
        if (accepted.workerId !== input.workerId || accepted.claimTokenHash !== claimTokenHash) {
          throw new Error(`Invalid claim for work item ${workItemId}`);
        }
        return { ...item };
      }
    }
    this.requireClaim(workItemId, input.workerId, input.claimToken);
    item.status = 'completed';
    item.output = input.output;
    item.artifact = input.artifact;
    item.updatedAt = this.now();
    this.persistItem(item);
    if (artifactId && contentHash) {
      this.persistAcceptedArtifact({
        artifactId,
        workItemId,
        contentHash,
        workerId: input.workerId,
        claimTokenHash: this.hashSecret(input.claimToken),
      }, input.artifact!);
    }
    this.settle(workItemId, {
      success: true,
      output: input.output,
      messages: [{ role: 'assistant', content: input.output }],
      tokenUsage: { input_tokens: 0, output_tokens: 0 },
      toolCalls: input.toolCalls ?? [],
      artifacts: input.artifact ? { managedArtifact: input.artifact } : undefined,
    });
    return { ...item };
  }

  fail(workItemId: string, input: {
    workerId: string;
    claimToken: string;
    error: string;
  }): ManagedAgentWorkItem {
    const item = this.requireClaim(workItemId, input.workerId, input.claimToken);
    item.status = 'failed';
    item.error = input.error;
    item.updatedAt = this.now();
    this.persistItem(item);
    this.settle(workItemId, this.failureResult(input.error));
    return { ...item };
  }

  private requireItem(workItemId: string): ManagedAgentWorkItem {
    const item = this.items.get(workItemId);
    if (!item) throw new Error(`Managed work item ${workItemId} not found`);
    return item;
  }

  private requireClaim(workItemId: string, workerId: string, claimToken: string): ManagedAgentWorkItem {
    this.expireWorkersAndClaims();
    const item = this.requireItem(workItemId);
    if (item.status !== 'claimed') throw new Error(`Work item ${workItemId} is not claimed`);
    if (item.claimedBy !== workerId || this.claimTokens.get(workItemId) !== claimToken) {
      throw new Error(`Invalid claim for work item ${workItemId}`);
    }
    return item;
  }

  private expireWorkersAndClaims(): void {
    const now = this.now();
    for (const [workerId, worker] of this.workers) {
      if (worker.expiresAt <= now) this.workers.delete(workerId);
    }
    for (const item of this.items.values()) {
      if (item.status === 'claimed' && item.leaseExpiresAt !== undefined && item.leaseExpiresAt <= now) {
        item.status = 'pending';
        item.claimedBy = undefined;
        item.leaseExpiresAt = undefined;
        item.updatedAt = now;
        this.claimTokens.delete(item.id);
        this.persistItem(item);
      }
    }
  }

  private initializePersistence(): void {
    if (!this.database) return;
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS managed_agent_work_items (
        id TEXT PRIMARY KEY,
        agent_id TEXT NOT NULL,
        goal TEXT NOT NULL,
        session_id TEXT,
        surface_id TEXT,
        task_id TEXT,
        attempt_id TEXT,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        claimed_by TEXT,
        lease_expires_at INTEGER,
        error TEXT,
        output TEXT,
        artifact_json TEXT,
        task_contract_json TEXT,
        input_artifact_refs_json TEXT
        ,workspace_snapshot_json TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_managed_work_status_created
        ON managed_agent_work_items(status, created_at);
      CREATE TABLE IF NOT EXISTS managed_agent_worker_heartbeats (
        worker_id TEXT PRIMARY KEY,
        process_id TEXT NOT NULL,
        agent_ids TEXT NOT NULL DEFAULT '[]',
        last_seen_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS managed_agent_artifacts (
        artifact_id TEXT PRIMARY KEY,
        work_item_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        worker_id TEXT NOT NULL,
        claim_token_hash TEXT NOT NULL,
        artifact_json TEXT NOT NULL,
        accepted_at INTEGER NOT NULL
      );
    `);
    const workItemColumns = (
      this.database.prepare('PRAGMA table_info(managed_agent_work_items)').all()
    ) as Array<{ name: string }>;
    if (!workItemColumns.some((column) => column.name === 'surface_id')) {
      this.database.exec('ALTER TABLE managed_agent_work_items ADD COLUMN surface_id TEXT');
    }
    if (!workItemColumns.some((column) => column.name === 'task_id')) {
      this.database.exec('ALTER TABLE managed_agent_work_items ADD COLUMN task_id TEXT');
    }
    if (!workItemColumns.some((column) => column.name === 'attempt_id')) {
      this.database.exec('ALTER TABLE managed_agent_work_items ADD COLUMN attempt_id TEXT');
      this.database.exec(`
        UPDATE managed_agent_work_items
        SET attempt_id = 'attempt-' || id || '-01'
        WHERE attempt_id IS NULL
      `);
    }
    if (!workItemColumns.some((column) => column.name === 'artifact_json')) {
      this.database.exec('ALTER TABLE managed_agent_work_items ADD COLUMN artifact_json TEXT');
    }
    if (!workItemColumns.some((column) => column.name === 'workspace_snapshot_json')) {
      this.database.exec('ALTER TABLE managed_agent_work_items ADD COLUMN workspace_snapshot_json TEXT');
    }
    if (!workItemColumns.some((column) => column.name === 'task_contract_json')) {
      this.database.exec('ALTER TABLE managed_agent_work_items ADD COLUMN task_contract_json TEXT');
    }
    if (!workItemColumns.some((column) => column.name === 'input_artifact_refs_json')) {
      this.database.exec('ALTER TABLE managed_agent_work_items ADD COLUMN input_artifact_refs_json TEXT');
    }

    const rows = this.database.prepare(`
      SELECT id, agent_id, goal, session_id, surface_id, task_id, attempt_id, status, created_at, updated_at,
             claimed_by, lease_expires_at, error, output, artifact_json, task_contract_json, workspace_snapshot_json,
             input_artifact_refs_json
      FROM managed_agent_work_items
      ORDER BY created_at ASC
    `).all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      const item: ManagedAgentWorkItem = {
        id: String(row.id),
        agentId: String(row.agent_id),
        goal: String(row.goal),
        sessionId: row.session_id ? String(row.session_id) : undefined,
        surfaceId: row.surface_id ? String(row.surface_id) : undefined,
        taskId: row.task_id ? String(row.task_id) : undefined,
        attemptId: row.attempt_id ? String(row.attempt_id) : `attempt-${String(row.id)}-01`,
        status: String(row.status) as ManagedAgentWorkStatus,
        createdAt: Number(row.created_at),
        updatedAt: Number(row.updated_at),
        claimedBy: row.claimed_by ? String(row.claimed_by) : undefined,
        leaseExpiresAt: row.lease_expires_at === null ? undefined : Number(row.lease_expires_at),
        error: row.error ? String(row.error) : undefined,
        output: row.output ? String(row.output) : undefined,
        artifact: this.parseArtifact(row.artifact_json),
        taskContract: this.parseTaskContract(row.task_contract_json),
        inputArtifactRefs: this.parseArtifactReferences(row.input_artifact_refs_json),
        workspaceSnapshot: this.parseWorkspaceSnapshot(row.workspace_snapshot_json),
      };
      if (item.status === 'pending' || item.status === 'claimed') {
        item.status = 'interrupted';
        item.error = 'Managed external Agent work interrupted by process restart';
        item.claimedBy = undefined;
        item.leaseExpiresAt = undefined;
        item.updatedAt = this.now();
        this.persistItem(item);
      }
      this.items.set(item.id, item);
    }
    const artifactRows = this.database.prepare(`
      SELECT artifact_id, work_item_id, content_hash, worker_id, claim_token_hash
      FROM managed_agent_artifacts
    `).all() as Array<Record<string, unknown>>;
    for (const row of artifactRows) {
      this.acceptedArtifacts.set(String(row.artifact_id), {
        artifactId: String(row.artifact_id),
        workItemId: String(row.work_item_id),
        contentHash: String(row.content_hash),
        workerId: String(row.worker_id),
        claimTokenHash: String(row.claim_token_hash),
      });
    }
    // Heartbeat rows are audit-only across process boundaries. A worker must
    // heartbeat again into this process before readiness can become true.
  }

  private persistItem(item: ManagedAgentWorkItem): void {
    this.database?.prepare(`
      INSERT INTO managed_agent_work_items
        (id, agent_id, goal, session_id, surface_id, task_id, attempt_id, status, created_at, updated_at,
         claimed_by, lease_expires_at, error, output, artifact_json, task_contract_json, workspace_snapshot_json,
         input_artifact_refs_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        surface_id = excluded.surface_id,
        task_id = excluded.task_id,
        attempt_id = excluded.attempt_id,
        status = excluded.status,
        updated_at = excluded.updated_at,
        claimed_by = excluded.claimed_by,
        lease_expires_at = excluded.lease_expires_at,
        error = excluded.error,
        output = excluded.output,
        artifact_json = excluded.artifact_json
        ,task_contract_json = excluded.task_contract_json
        ,workspace_snapshot_json = excluded.workspace_snapshot_json
        ,input_artifact_refs_json = excluded.input_artifact_refs_json
    `).run(
      item.id,
      item.agentId,
      item.goal,
      item.sessionId ?? null,
      item.surfaceId ?? null,
      item.taskId ?? null,
      item.attemptId,
      item.status,
      item.createdAt,
      item.updatedAt,
      item.claimedBy ?? null,
      item.leaseExpiresAt ?? null,
      item.error ?? null,
      item.output ?? null,
      item.artifact ? JSON.stringify(item.artifact) : null,
      item.taskContract ? JSON.stringify(item.taskContract) : null,
      item.workspaceSnapshot ? JSON.stringify(item.workspaceSnapshot) : null,
      item.inputArtifactRefs ? JSON.stringify(item.inputArtifactRefs) : null,
    );
  }

  private persistAcceptedArtifact(record: AcceptedArtifactRecord, artifact: ManagedArtifactEnvelope): void {
    this.database?.prepare(`
      INSERT INTO managed_agent_artifacts
        (artifact_id, work_item_id, content_hash, worker_id, claim_token_hash, artifact_json, accepted_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      record.artifactId,
      record.workItemId,
      record.contentHash,
      record.workerId,
      record.claimTokenHash,
      JSON.stringify(artifact),
      this.now(),
    );
    this.acceptedArtifacts.set(record.artifactId, record);
  }

  private hashSecret(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private parseArtifact(value: unknown): ManagedArtifactEnvelope | undefined {
    if (!value) return undefined;
    try {
      const parsed = JSON.parse(String(value));
      return parsed && typeof parsed === 'object' ? parsed as ManagedArtifactEnvelope : undefined;
    } catch {
      return undefined;
    }
  }

  private parseWorkspaceSnapshot(value: unknown): ManagedWorkspaceSnapshot | undefined {
    if (!value) return undefined;
    try {
      const parsed = JSON.parse(String(value));
      return parsed && typeof parsed === 'object' ? parsed as ManagedWorkspaceSnapshot : undefined;
    } catch {
      return undefined;
    }
  }

  private parseTaskContract(value: unknown): ManagedTaskContract | undefined {
    if (!value) return undefined;
    try {
      const parsed = JSON.parse(String(value)) as Partial<ManagedTaskContract>;
      return Array.isArray(parsed.acceptanceIds) && Array.isArray(parsed.allowedPaths)
        ? {
          sourceTaskId: String(parsed.sourceTaskId ?? ''),
          title: String(parsed.title ?? ''),
          ownerAgent: String(parsed.ownerAgent ?? ''),
          dependsOn: Array.isArray(parsed.dependsOn) ? parsed.dependsOn.map(String) : [],
          acceptanceIds: parsed.acceptanceIds.map(String),
          allowedPaths: parsed.allowedPaths.map(String),
          expectedArtifactKind: String(parsed.expectedArtifactKind ?? ''),
          expectedMutation: parsed.expectedMutation === true,
        }
        : undefined;
    } catch {
      return undefined;
    }
  }

  private parseArtifactReferences(value: unknown): ManagedArtifactReference[] | undefined {
    if (!value) return undefined;
    try {
      const parsed = JSON.parse(String(value));
      if (!Array.isArray(parsed) || parsed.some((reference) => !reference || typeof reference !== 'object'
        || typeof reference.surfaceId !== 'string' || !reference.surfaceId.trim()
        || typeof reference.artifactId !== 'string' || !reference.artifactId.trim()
        || typeof reference.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(reference.contentHash))) {
        return undefined;
      }
      return parsed.map((reference) => ({
        surfaceId: reference.surfaceId,
        artifactId: reference.artifactId,
        contentHash: reference.contentHash,
      }));
    } catch {
      return undefined;
    }
  }

  private settle(workItemId: string, result: AgentRunResult): void {
    const pending = this.pendingRequests.get(workItemId);
    if (!pending) return;
    clearTimeout(pending.timeout);
    if (pending.onAbort) pending.signal?.removeEventListener('abort', pending.onAbort);
    this.pendingRequests.delete(workItemId);
    this.claimTokens.delete(workItemId);
    pending.resolve(result);
  }

  private failureResult(message: string): AgentRunResult {
    return {
      success: false,
      output: message,
      messages: [{ role: 'assistant', content: message }],
      tokenUsage: { input_tokens: 0, output_tokens: 0 },
      toolCalls: [],
    };
  }
}

let globalManagedAgentWorkQueue: ManagedAgentWorkQueue | undefined;

export function getGlobalManagedAgentWorkQueue(): ManagedAgentWorkQueue {
  globalManagedAgentWorkQueue ??= new ManagedAgentWorkQueue();
  return globalManagedAgentWorkQueue;
}

export function resetGlobalManagedAgentWorkQueue(): void {
  globalManagedAgentWorkQueue = undefined;
}
