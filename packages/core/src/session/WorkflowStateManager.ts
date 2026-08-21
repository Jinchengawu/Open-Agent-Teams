/**
 * WorkflowStateManager — 工作流状态持久化管理器
 *
 * 职责：
 * - 保存工作流执行状态到 SQLite
 * - 从 SQLite 恢复工作流状态
 * - 支持断点续传（resume from checkpoint）
 * - 状态变更时自动触发 EventBus 事件
 *
 * 与 SessionManager 共享同一个 SQLite 数据库实例。
 */

import type { Database } from 'better-sqlite3';
import { eventBus } from '../event/EventBus.js';
import type { WorkflowEvent } from '../event/types.js';
import type { AgentRunResult, TokenUsage } from '../orchestrator/types.js';
import {
  createOperationalEvent,
  DurableOperationalEventStore,
  type OperationalEvent,
} from '../telemetry/operational-events.js';

export interface WorkflowStepState {
  index: number;
  executionNodeId?: string;
  agentId: string;
  goal: string;
  output: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  startedAt?: number;
  completedAt?: number;
  error?: string;
}

export interface WorkflowContext {
  sharedMemory?: string;
  discussion?: string[];
  [key: string]: unknown;
}

export interface WorkflowState {
  id: string;
  goal: string;
  status: 'running' | 'paused' | 'completed' | 'failed' | 'cancelled';
  currentStep: number;
  totalSteps: number;
  steps: WorkflowStepState[];
  context: WorkflowContext;
  tokenUsage: TokenUsage;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

/** Explicit server-owned scope. Values in WorkflowContext are never promoted into this boundary. */
export interface WorkflowTrustedScope {
  trusted: true;
  tenantId: string;
  projectId: string;
  agentId?: string;
  sessionId?: string;
  taskId?: string;
  attemptId?: string;
}

interface OperationalEventStorePort {
  appendIfAbsent(event: OperationalEvent): { event: OperationalEvent; inserted: boolean };
}

export interface WorkflowStateManagerOptions {
  operationalEventStore?: OperationalEventStorePort;
  legacyEmit?: (event: WorkflowEvent) => void;
  now?: () => Date;
}

function getBoundTaskId(context: WorkflowContext): string | undefined {
  return typeof context.taskId === 'string' && context.taskId.trim()
    ? context.taskId
    : undefined;
}

export class WorkflowStateManager {
  private db: Database;
  private readonly operationalEventStore: OperationalEventStorePort;
  private readonly legacyEmit: (event: WorkflowEvent) => void;
  private readonly now: () => Date;

  constructor(db: Database, options: WorkflowStateManagerOptions = {}) {
    this.db = db;
    this.operationalEventStore = options.operationalEventStore ?? new DurableOperationalEventStore(db);
    this.legacyEmit = options.legacyEmit ?? ((event) => eventBus.emit(event));
    this.now = options.now ?? (() => new Date());
    this.initSchema();
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_states (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'paused', 'completed', 'failed', 'cancelled')),
        current_step INTEGER NOT NULL DEFAULT 0,
        total_steps INTEGER NOT NULL DEFAULT 0,
        steps TEXT NOT NULL DEFAULT '[]',
        context TEXT NOT NULL DEFAULT '{}',
        token_usage TEXT NOT NULL DEFAULT '{"input_tokens":0,"output_tokens":0}',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.migrateCancelledStatusConstraint();
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workflow_trusted_scopes (
        workflow_id TEXT PRIMARY KEY REFERENCES workflow_states(id) ON DELETE CASCADE,
        tenant_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        agent_id TEXT,
        session_id TEXT,
        task_id TEXT,
        attempt_id TEXT
      )
    `);
  }

  private migrateCancelledStatusConstraint(): void {
    const table = this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'workflow_states'").get() as { sql?: string } | undefined;
    if (!table?.sql || table.sql.includes("'cancelled'")) return;

    this.db.exec(`
      ALTER TABLE workflow_states RENAME TO workflow_states_legacy_status_constraint;

      CREATE TABLE workflow_states (
        id TEXT PRIMARY KEY,
        goal TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'running' CHECK(status IN ('running', 'paused', 'completed', 'failed', 'cancelled')),
        current_step INTEGER NOT NULL DEFAULT 0,
        total_steps INTEGER NOT NULL DEFAULT 0,
        steps TEXT NOT NULL DEFAULT '[]',
        context TEXT NOT NULL DEFAULT '{}',
        token_usage TEXT NOT NULL DEFAULT '{"input_tokens":0,"output_tokens":0}',
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      INSERT INTO workflow_states (
        id, goal, status, current_step, total_steps,
        steps, context, token_usage, error, created_at, updated_at
      )
      SELECT
        id, goal, status, current_step, total_steps,
        steps, context, token_usage, error, created_at, updated_at
      FROM workflow_states_legacy_status_constraint;

      DROP TABLE workflow_states_legacy_status_constraint;
    `);
  }

  /**
   * 创建并保存新的工作流状态
   */
  createState(
    goal: string,
    totalSteps: number,
    id?: string,
    context: WorkflowContext = {},
    trustedScope?: WorkflowTrustedScope,
  ): WorkflowState {
    this.assertTrustedScope(trustedScope);
    const workflowId = id || `wf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    const existing = this.load(workflowId);
    if (existing) {
      if (existing.goal !== goal || existing.totalSteps !== totalSteps
        || JSON.stringify(existing.context) !== JSON.stringify(context)) {
        throw new Error(`Workflow ${workflowId} workflow identity conflict`);
      }
      if (!this.sameTrustedScope(this.loadTrustedScope(workflowId), trustedScope)) {
        throw new Error(`Workflow ${workflowId} trusted scope conflict`);
      }
      return existing;
    }
    const now = this.now().getTime();
    const state: WorkflowState = {
      id: workflowId,
      goal,
      status: 'running',
      currentStep: 0,
      totalSteps,
      steps: [],
      context,
      tokenUsage: { input_tokens: 0, output_tokens: 0 },
      createdAt: now,
      updatedAt: now,
    };

    this.persistThenEmit(state, trustedScope, 'started', {
      type: 'workflow.started',
      source: 'workflow',
      timestamp: now,
      payload: {
        workflowId,
        taskId: getBoundTaskId(context),
        totalSteps,
      },
    });

    return state;
  }

  /**
   * 合并更新工作流上下文，用于持久化 Pipeline 元数据、协作绑定等恢复信息。
   */
  updateContext(workflowId: string, context: WorkflowContext): WorkflowState | null {
    const state = this.load(workflowId);
    if (!state) return null;

    state.context = {
      ...state.context,
      ...context,
    };
    state.updatedAt = Date.now();
    this.save(state);
    return state;
  }

  /**
   * 保存工作流状态到 SQLite
   */
  save(state: WorkflowState): void {
    this.saveStatement(state);
  }

  private saveStatement(state: WorkflowState): void {
    const stmt = this.db.prepare(`
      INSERT INTO workflow_states (
        id, goal, status, current_step, total_steps,
        steps, context, token_usage, error, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      ) ON CONFLICT(id) DO UPDATE SET
        goal=excluded.goal,
        status=excluded.status,
        current_step=excluded.current_step,
        total_steps=excluded.total_steps,
        steps=excluded.steps,
        context=excluded.context,
        token_usage=excluded.token_usage,
        error=excluded.error,
        updated_at=excluded.updated_at
    `);

    stmt.run(
      state.id,
      state.goal,
      state.status,
      state.currentStep,
      state.totalSteps,
      JSON.stringify(state.steps),
      JSON.stringify(state.context),
      JSON.stringify(state.tokenUsage),
      state.error || null,
      new Date(state.createdAt).toISOString(),
      new Date(state.updatedAt).toISOString(),
    );
  }

  /**
   * 从 SQLite 加载工作流状态
   */
  load(workflowId: string): WorkflowState | null {
    const row = this.db.prepare('SELECT * FROM workflow_states WHERE id = ?').get(workflowId) as any;
    if (!row) return null;

    return {
      id: row.id,
      goal: row.goal,
      status: row.status,
      currentStep: row.current_step,
      totalSteps: row.total_steps,
      steps: JSON.parse(row.steps || '[]'),
      context: JSON.parse(row.context || '{}'),
      tokenUsage: JSON.parse(row.token_usage || '{}'),
      error: row.error || undefined,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    };
  }

  /**
   * 更新步骤状态
   */
  updateStep(
    workflowId: string,
    stepIndex: number,
    updates: Partial<WorkflowStepState> & { agentResult?: AgentRunResult },
  ): void {
    const state = this.load(workflowId);
    if (!state) {
      console.error(`[WorkflowStateManager] 工作流 ${workflowId} 不存在，无法更新步骤`);
      return;
    }

    // 找到或创建步骤
    let step = state.steps.find((s) => s.index === stepIndex);
    if (!step) {
      step = {
        index: stepIndex,
        agentId: updates.agentId || 'unknown',
        goal: updates.goal || '',
        output: '',
        status: 'pending',
      };
      state.steps.push(step);
    }

    // 更新步骤字段
    if (updates.agentId) step.agentId = updates.agentId;
    if (updates.executionNodeId) step.executionNodeId = updates.executionNodeId;
    if (updates.goal) step.goal = updates.goal;
    if (updates.output !== undefined) step.output = updates.output;
    if (updates.status) step.status = updates.status;
    if (updates.error) step.error = updates.error;
    if (updates.startedAt) step.startedAt = updates.startedAt;
    if (updates.completedAt) step.completedAt = updates.completedAt;

    // 如果提供了 AgentRunResult，自动提取 output 和 tokenUsage
    if (updates.agentResult) {
      step.output = updates.agentResult.output;
      state.tokenUsage.input_tokens += updates.agentResult.tokenUsage?.input_tokens || 0;
      state.tokenUsage.output_tokens += updates.agentResult.tokenUsage?.output_tokens || 0;
    }

    state.currentStep = stepIndex;
    state.updatedAt = this.now().getTime();

    // Checkpoints remain durable workflow state, but only a real completion may
    // consume the stable step_completed event identity.
    if (step.status !== 'completed') {
      this.save(state);
      return;
    }

    this.persistThenEmit(state, this.loadTrustedScope(workflowId), `step:${stepIndex}:completed`, {
      type: 'workflow.step_completed',
      source: 'workflow',
      timestamp: state.updatedAt,
      payload: {
        workflowId,
        taskId: getBoundTaskId(state.context),
        stepIndex,
        totalSteps: state.totalSteps,
        output: step.output?.substring(0, 200),
      },
    });
  }

  /**
   * Update a projected execution node without reusing the static Surface index.
   * The stable node id is the recovery identity; array position is presentation only.
   */
  updateExecutionNode(
    workflowId: string,
    executionNodeId: string,
    updates: Partial<WorkflowStepState> & { agentResult?: AgentRunResult },
  ): void {
    const state = this.load(workflowId);
    if (!state) {
      console.error(`[WorkflowStateManager] 工作流 ${workflowId} 不存在，无法更新执行节点`);
      return;
    }
    const existing = state.steps.find((step) => step.executionNodeId === executionNodeId);
    const stepIndex = existing?.index ?? Math.max(-1, ...state.steps.map((step) => step.index)) + 1;
    this.updateStep(workflowId, stepIndex, { ...updates, executionNodeId });
  }

  /**
   * 完成工作流
   */
  complete(workflowId: string, finalOutput?: string): void {
    const state = this.load(workflowId);
    if (!state) return;
    if (this.isTerminal(state.status)) return;

    state.status = 'completed';
    state.currentStep = state.totalSteps;
    state.updatedAt = this.now().getTime();
    this.persistThenEmit(state, this.loadTrustedScope(workflowId), 'completed', {
      type: 'workflow.completed',
      source: 'workflow',
      timestamp: state.updatedAt,
      payload: {
        workflowId,
        taskId: getBoundTaskId(state.context),
        output: finalOutput?.substring(0, 200),
        tokenUsage: state.tokenUsage,
      },
    });
  }

  /**
   * 标记工作流失败
   */
  fail(workflowId: string, error: string): void {
    const state = this.load(workflowId);
    if (!state) return;
    if (this.isTerminal(state.status)) return;

    state.status = 'failed';
    state.error = error;
    state.updatedAt = this.now().getTime();
    this.persistThenEmit(state, this.loadTrustedScope(workflowId), 'failed', {
      type: 'workflow.failed',
      source: 'workflow',
      timestamp: state.updatedAt,
      payload: {
        workflowId,
        taskId: getBoundTaskId(state.context),
        error,
      },
    });
  }

  /**
   * 取消工作流
   */
  cancel(workflowId: string, reason: string = 'Workflow cancelled'): void {
    const state = this.load(workflowId);
    if (!state) return;
    if (this.isTerminal(state.status)) return;

    state.status = 'cancelled';
    state.error = reason;
    state.updatedAt = this.now().getTime();
    this.persistThenEmit(state, this.loadTrustedScope(workflowId), 'cancelled', {
      type: 'workflow.cancelled',
      source: 'workflow',
      timestamp: state.updatedAt,
      payload: {
        workflowId,
        taskId: getBoundTaskId(state.context),
        error: reason,
      },
    });
  }

  /**
   * 获取所有正在运行的工作流
   */
  getRunningWorkflows(): WorkflowState[] {
    const rows = this.db.prepare("SELECT * FROM workflow_states WHERE status = 'running' ORDER BY updated_at DESC").all() as any[];
    return rows.map((row) => ({
      id: row.id,
      goal: row.goal,
      status: row.status,
      currentStep: row.current_step,
      totalSteps: row.total_steps,
      steps: JSON.parse(row.steps || '[]'),
      context: JSON.parse(row.context || '{}'),
      tokenUsage: JSON.parse(row.token_usage || '{}'),
      error: row.error || undefined,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    }));
  }

  /**
   * 列出所有工作流（分页）
   */
  listWorkflows(limit: number = 50, offset: number = 0): WorkflowState[] {
    const rows = this.db.prepare('SELECT * FROM workflow_states ORDER BY updated_at DESC LIMIT ? OFFSET ?').all(limit, offset) as any[];
    return rows.map((row) => ({
      id: row.id,
      goal: row.goal,
      status: row.status,
      currentStep: row.current_step,
      totalSteps: row.total_steps,
      steps: JSON.parse(row.steps || '[]'),
      context: JSON.parse(row.context || '{}'),
      tokenUsage: JSON.parse(row.token_usage || '{}'),
      error: row.error || undefined,
      createdAt: new Date(row.created_at).getTime(),
      updatedAt: new Date(row.updated_at).getTime(),
    }));
  }

  /**
   * 删除工作流状态
   */
  delete(workflowId: string): void {
    this.db.prepare('DELETE FROM workflow_states WHERE id = ?').run(workflowId);
  }

  private persistThenEmit(
    state: WorkflowState,
    trustedScope: WorkflowTrustedScope | undefined,
    lifecycleKey: string,
    legacyEvent: WorkflowEvent,
  ): void {
    let shouldEmit = true;
    const durableEvent = trustedScope ? createOperationalEvent({
      kind: lifecycleKey === 'completed' || lifecycleKey === 'failed' || lifecycleKey === 'cancelled' ? 'outcome' : 'task',
      dimensions: {
        tenantId: trustedScope.tenantId,
        projectId: trustedScope.projectId,
        agentId: trustedScope.agentId,
        sessionId: trustedScope.sessionId,
        taskId: trustedScope.taskId ?? getBoundTaskId(state.context) ?? state.id,
        attemptId: trustedScope.attemptId,
      },
      source: 'workflow-state-manager',
      sourceEventId: `workflow:${state.id}:${lifecycleKey}`,
      observedAt: new Date(state.updatedAt).toISOString(),
      completeness: 'complete',
      measurementStatus: 'unmeasured',
      payload: { workflowId: state.id, lifecycle: lifecycleKey, status: state.status },
    }, { now: this.now }) : undefined;

    this.db.transaction(() => {
      this.saveStatement(state);
      if (trustedScope) this.saveTrustedScope(state.id, trustedScope);
      if (durableEvent) shouldEmit = this.operationalEventStore.appendIfAbsent(durableEvent).inserted;
    })();

    if (shouldEmit) {
      this.legacyEmit({
        ...legacyEvent,
        payload: { ...legacyEvent.payload, scopeStatus: trustedScope ? 'durable' : 'unscoped' },
      });
    }
  }

  private saveTrustedScope(workflowId: string, scope: WorkflowTrustedScope): void {
    this.db.prepare(`INSERT INTO workflow_trusted_scopes
      (workflow_id,tenant_id,project_id,agent_id,session_id,task_id,attempt_id)
      VALUES (?,?,?,?,?,?,?) ON CONFLICT(workflow_id) DO NOTHING`).run(
      workflowId, scope.tenantId, scope.projectId, scope.agentId ?? null, scope.sessionId ?? null,
      scope.taskId ?? null, scope.attemptId ?? null,
    );
    const persisted = this.loadTrustedScope(workflowId);
    if (!this.sameTrustedScope(persisted, scope)) {
      throw new Error(`Workflow ${workflowId} trusted scope is immutable`);
    }
  }

  private loadTrustedScope(workflowId: string): WorkflowTrustedScope | undefined {
    const row = this.db.prepare(`SELECT tenant_id,project_id,agent_id,session_id,task_id,attempt_id
      FROM workflow_trusted_scopes WHERE workflow_id=?`).get(workflowId) as Record<string, string | null> | undefined;
    if (!row) return undefined;
    return {
      trusted: true,
      tenantId: row.tenant_id!, projectId: row.project_id!,
      ...(row.agent_id ? { agentId: row.agent_id } : {}),
      ...(row.session_id ? { sessionId: row.session_id } : {}),
      ...(row.task_id ? { taskId: row.task_id } : {}),
      ...(row.attempt_id ? { attemptId: row.attempt_id } : {}),
    };
  }

  private assertTrustedScope(scope?: WorkflowTrustedScope): void {
    if (!scope) return;
    if (scope.trusted !== true || !scope.tenantId.trim() || !scope.projectId.trim()) {
      throw new Error('trusted workflow scope requires non-empty tenantId and projectId');
    }
  }

  private sameTrustedScope(left?: WorkflowTrustedScope, right?: WorkflowTrustedScope): boolean {
    if (!left || !right) return left === right;
    return left.tenantId === right.tenantId
      && left.projectId === right.projectId
      && left.agentId === right.agentId
      && left.sessionId === right.sessionId
      && left.taskId === right.taskId
      && left.attemptId === right.attemptId;
  }

  private isTerminal(status: WorkflowState['status']): boolean {
    return status === 'completed' || status === 'failed' || status === 'cancelled';
  }
}
