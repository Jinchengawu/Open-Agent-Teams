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
import { eventBus } from '../event/EventBus.js';
export class WorkflowStateManager {
    db;
    constructor(db) {
        this.db = db;
        this.initSchema();
    }
    initSchema() {
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
    }
    migrateCancelledStatusConstraint() {
        const table = this.db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'workflow_states'").get();
        if (!table?.sql || table.sql.includes("'cancelled'"))
            return;
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
    createState(goal, totalSteps, id, context = {}) {
        const workflowId = id || `wf-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const state = {
            id: workflowId,
            goal,
            status: 'running',
            currentStep: 0,
            totalSteps,
            steps: [],
            context,
            tokenUsage: { input_tokens: 0, output_tokens: 0 },
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        this.save(state);
        // 触发工作流开始事件
        eventBus.emit({
            type: 'workflow.started',
            source: 'workflow',
            timestamp: Date.now(),
            payload: {
                workflowId,
                taskId: goal.substring(0, 50),
                totalSteps,
            },
        });
        return state;
    }
    /**
     * 合并更新工作流上下文，用于持久化 Pipeline 元数据、协作绑定等恢复信息。
     */
    updateContext(workflowId, context) {
        const state = this.load(workflowId);
        if (!state)
            return null;
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
    save(state) {
        const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO workflow_states (
        id, goal, status, current_step, total_steps,
        steps, context, token_usage, error, created_at, updated_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);
        stmt.run(state.id, state.goal, state.status, state.currentStep, state.totalSteps, JSON.stringify(state.steps), JSON.stringify(state.context), JSON.stringify(state.tokenUsage), state.error || null, new Date(state.createdAt).toISOString(), new Date().toISOString());
    }
    /**
     * 从 SQLite 加载工作流状态
     */
    load(workflowId) {
        const row = this.db.prepare('SELECT * FROM workflow_states WHERE id = ?').get(workflowId);
        if (!row)
            return null;
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
    updateStep(workflowId, stepIndex, updates) {
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
        if (updates.agentId)
            step.agentId = updates.agentId;
        if (updates.goal)
            step.goal = updates.goal;
        if (updates.output !== undefined)
            step.output = updates.output;
        if (updates.status)
            step.status = updates.status;
        if (updates.error)
            step.error = updates.error;
        if (updates.startedAt)
            step.startedAt = updates.startedAt;
        if (updates.completedAt)
            step.completedAt = updates.completedAt;
        // 如果提供了 AgentRunResult，自动提取 output 和 tokenUsage
        if (updates.agentResult) {
            step.output = updates.agentResult.output;
            state.tokenUsage.input_tokens += updates.agentResult.tokenUsage?.input_tokens || 0;
            state.tokenUsage.output_tokens += updates.agentResult.tokenUsage?.output_tokens || 0;
        }
        state.currentStep = stepIndex;
        state.updatedAt = Date.now();
        this.save(state);
        // 触发步骤完成事件
        eventBus.emit({
            type: 'workflow.step_completed',
            source: 'workflow',
            timestamp: Date.now(),
            payload: {
                workflowId,
                stepIndex,
                totalSteps: state.totalSteps,
                output: step.output?.substring(0, 200),
            },
        });
    }
    /**
     * 完成工作流
     */
    complete(workflowId, finalOutput) {
        const state = this.load(workflowId);
        if (!state)
            return;
        state.status = 'completed';
        state.currentStep = state.totalSteps;
        state.updatedAt = Date.now();
        this.save(state);
        // 触发工作流完成事件
        eventBus.emit({
            type: 'workflow.completed',
            source: 'workflow',
            timestamp: Date.now(),
            payload: {
                workflowId,
                taskId: state.goal.substring(0, 50),
                output: finalOutput?.substring(0, 200),
                tokenUsage: state.tokenUsage,
            },
        });
    }
    /**
     * 标记工作流失败
     */
    fail(workflowId, error) {
        const state = this.load(workflowId);
        if (!state)
            return;
        state.status = 'failed';
        state.error = error;
        state.updatedAt = Date.now();
        this.save(state);
        // 触发工作流失败事件
        eventBus.emit({
            type: 'workflow.failed',
            source: 'workflow',
            timestamp: Date.now(),
            payload: {
                workflowId,
                taskId: state.goal.substring(0, 50),
                error,
            },
        });
    }
    /**
     * 取消工作流
     */
    cancel(workflowId, reason = 'Workflow cancelled') {
        const state = this.load(workflowId);
        if (!state)
            return;
        state.status = 'cancelled';
        state.error = reason;
        state.updatedAt = Date.now();
        this.save(state);
        eventBus.emit({
            type: 'workflow.cancelled',
            source: 'workflow',
            timestamp: Date.now(),
            payload: {
                workflowId,
                taskId: state.goal.substring(0, 50),
                error: reason,
            },
        });
    }
    /**
     * 获取所有正在运行的工作流
     */
    getRunningWorkflows() {
        const rows = this.db.prepare("SELECT * FROM workflow_states WHERE status = 'running' ORDER BY updated_at DESC").all();
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
    listWorkflows(limit = 50, offset = 0) {
        const rows = this.db.prepare('SELECT * FROM workflow_states ORDER BY updated_at DESC LIMIT ? OFFSET ?').all(limit, offset);
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
    delete(workflowId) {
        this.db.prepare('DELETE FROM workflow_states WHERE id = ?').run(workflowId);
    }
}
//# sourceMappingURL=WorkflowStateManager.js.map