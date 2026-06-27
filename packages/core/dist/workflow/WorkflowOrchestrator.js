import { v4 as uuidv4 } from 'uuid';
import { MessageType } from '../bus/types.js';
import { BUILTIN_TEMPLATES, WORKFLOW_SCHEMA } from './templates.js';
export class WorkflowOrchestrator {
    db;
    agentBus;
    templates;
    sessionManager;
    constructor(db, agentBus, sessionManager, templates) {
        this.db = db;
        this.db.exec(WORKFLOW_SCHEMA);
        this.agentBus = agentBus;
        this.sessionManager = sessionManager;
        this.templates = new Map();
        for (const t of [...BUILTIN_TEMPLATES, ...(templates || [])]) {
            this.templates.set(t.id, t);
        }
    }
    listTemplates() {
        return Array.from(this.templates.values());
    }
    getTemplate(id) {
        return this.templates.get(id);
    }
    async startWorkflow(sessionId, templateId, userRequest) {
        const template = this.templates.get(templateId);
        if (!template) {
            throw new Error(`Unknown workflow template: ${templateId}`);
        }
        const workflowId = uuidv4();
        const context = { userRequest };
        this.db
            .prepare(`INSERT INTO workflows (id, session_id, template, status, context)
         VALUES (?, ?, ?, 'running', ?)`)
            .run(workflowId, sessionId, templateId, JSON.stringify(context));
        const insertStep = this.db.prepare(`INSERT INTO workflow_steps (workflow_id, agent_id, step_order, input, status)
       VALUES (?, ?, ?, '', 'pending')`);
        const stepInsert = this.db.transaction(() => {
            for (const step of template.steps) {
                insertStep.run(workflowId, step.agentId, step.order);
            }
        });
        stepInsert();
        this.sessionManager.addMessage(sessionId, 'system', `[Workflow] Started "${template.name}" (${templateId})`, 'system');
        await this.advanceWorkflow(workflowId);
        return this.getWorkflow(workflowId);
    }
    async advanceWorkflow(workflowId) {
        const wf = this.getWorkflow(workflowId);
        if (!wf)
            throw new Error(`Workflow not found: ${workflowId}`);
        if (wf.status === 'completed' || wf.status === 'failed')
            return;
        const steps = this.getWorkflowSteps(workflowId);
        const currentStep = steps.find((s) => s.status === 'pending' || s.status === 'running');
        if (!currentStep) {
            this.completeWorkflow(workflowId);
            return;
        }
        const template = this.templates.get(wf.template);
        const stepDef = template?.steps.find((s) => s.order === currentStep.step_order);
        if (!stepDef || !template) {
            this.failWorkflow(workflowId, `No definition for step ${currentStep.step_order}`);
            return;
        }
        const ctx = JSON.parse(wf.context || '{}');
        const input = this.resolveTemplate(stepDef.inputTemplate, ctx, steps);
        this.db
            .prepare(`UPDATE workflow_steps SET input = ?, status = 'running', started_at = datetime('now')
         WHERE id = ?`)
            .run(input, currentStep.id);
        this.db
            .prepare(`UPDATE workflows SET current_step = ?, updated_at = datetime('now') WHERE id = ?`)
            .run(currentStep.step_order, workflowId);
        this.sessionManager.addMessage(wf.session_id, 'system', `[Workflow Step ${currentStep.step_order + 1}/${template.steps.length}] ${stepDef.description} → ${stepDef.agentId}`, 'system');
        try {
            const response = await this.agentBus.sendAndWait(currentStep.agent_id, {
                from: 'workflow-orchestrator',
                to: currentStep.agent_id,
                sessionId: wf.session_id,
                type: MessageType.TASK,
                payload: { prompt: input, workflowId },
            });
            const output = typeof response.payload === 'object' && response.payload
                ? response.payload.output || JSON.stringify(response.payload)
                : String(response.payload || '');
            this.db
                .prepare(`UPDATE workflow_steps SET output = ?, status = 'completed', completed_at = datetime('now')
           WHERE id = ?`)
                .run(String(output).substring(0, 5000), currentStep.id);
            ctx[`step${currentStep.step_order}`] = {
                agentId: currentStep.agent_id,
                output: String(output).substring(0, 3000),
            };
            this.db
                .prepare(`UPDATE workflows SET context = ?, updated_at = datetime('now') WHERE id = ?`)
                .run(JSON.stringify(ctx), workflowId);
            this.sessionManager.addMessage(wf.session_id, 'system', `[Workflow] Step ${currentStep.step_order + 1} completed by ${currentStep.agent_id}`, 'system');
            await this.advanceWorkflow(workflowId);
        }
        catch (e) {
            const errMsg = e instanceof Error ? e.message : 'Unknown error';
            this.db
                .prepare(`UPDATE workflow_steps SET output = ?, status = 'failed', completed_at = datetime('now')
           WHERE id = ?`)
                .run(`Error: ${errMsg}`, currentStep.id);
            this.failWorkflow(workflowId, errMsg);
        }
    }
    resolveTemplate(template, ctx, steps) {
        return template.replace(/\{\{(\w+)\.(\w+)\}\}/g, (_, stepKey, field) => {
            if (stepKey === 'userRequest')
                return ctx.userRequest || '';
            const stepNum = parseInt(stepKey.replace('step', ''));
            const step = steps.find((s) => s.step_order === stepNum);
            if (!step)
                return '';
            if (field === 'output')
                return step.output || '';
            return '';
        });
    }
    completeWorkflow(workflowId) {
        this.db
            .prepare(`UPDATE workflows SET status = 'completed', updated_at = datetime('now') WHERE id = ?`)
            .run(workflowId);
        const wf = this.getWorkflow(workflowId);
        if (wf) {
            this.sessionManager.addMessage(wf.session_id, 'system', '[Workflow] All steps completed successfully', 'system');
        }
    }
    failWorkflow(workflowId, error) {
        this.db
            .prepare(`UPDATE workflows SET status = 'failed', updated_at = datetime('now') WHERE id = ?`)
            .run(workflowId);
        const wf = this.getWorkflow(workflowId);
        if (wf) {
            this.sessionManager.addMessage(wf.session_id, 'system', `[Workflow] Failed: ${error}`, 'system');
        }
    }
    cancelWorkflow(workflowId) {
        this.db
            .prepare(`UPDATE workflows SET status = 'failed', updated_at = datetime('now') WHERE id = ?`)
            .run(workflowId);
    }
    getWorkflow(workflowId) {
        const row = this.db
            .prepare('SELECT * FROM workflows WHERE id = ?')
            .get(workflowId);
        return row || null;
    }
    getWorkflowSteps(workflowId) {
        return this.db
            .prepare('SELECT * FROM workflow_steps WHERE workflow_id = ? ORDER BY step_order ASC')
            .all(workflowId);
    }
    listWorkflows(sessionId, limit = 20) {
        if (sessionId) {
            return this.db
                .prepare('SELECT * FROM workflows WHERE session_id = ? ORDER BY created_at DESC LIMIT ?')
                .all(sessionId, limit);
        }
        return this.db
            .prepare('SELECT * FROM workflows ORDER BY created_at DESC LIMIT ?')
            .all(limit);
    }
}
//# sourceMappingURL=WorkflowOrchestrator.js.map