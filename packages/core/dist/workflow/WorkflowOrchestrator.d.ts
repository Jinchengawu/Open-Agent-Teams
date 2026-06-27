import Database from 'better-sqlite3';
import { AgentBus } from '../bus/AgentBus.js';
import type { SessionManager } from '../session/SessionManager.js';
import type { WorkflowTemplate, WorkflowRecord, WorkflowStepRecord } from './types.js';
export declare class WorkflowOrchestrator {
    private db;
    private agentBus;
    private templates;
    private sessionManager;
    constructor(db: Database.Database, agentBus: AgentBus, sessionManager: SessionManager, templates?: WorkflowTemplate[]);
    listTemplates(): WorkflowTemplate[];
    getTemplate(id: string): WorkflowTemplate | undefined;
    startWorkflow(sessionId: string, templateId: string, userRequest: string): Promise<WorkflowRecord>;
    advanceWorkflow(workflowId: string): Promise<void>;
    private resolveTemplate;
    private completeWorkflow;
    private failWorkflow;
    cancelWorkflow(workflowId: string): void;
    getWorkflow(workflowId: string): WorkflowRecord | null;
    getWorkflowSteps(workflowId: string): WorkflowStepRecord[];
    listWorkflows(sessionId?: string, limit?: number): WorkflowRecord[];
}
//# sourceMappingURL=WorkflowOrchestrator.d.ts.map