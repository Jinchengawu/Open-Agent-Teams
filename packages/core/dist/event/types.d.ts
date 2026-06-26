/**
 * 事件类型定义 — 看板、工作流、会议、系统事件
 *
 * 所有事件共享统一的结构：
 * - type: 事件类型（点分命名）
 * - source: 事件来源（模块名）
 * - timestamp: 时间戳
 * - payload: 事件载荷（具体数据）
 */
import type { TokenUsage } from '../orchestrator/types.js';
export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'blocked';
export interface KanbanEvent {
    type: 'kanban.task.created' | 'kanban.task.updated' | 'kanban.task.status_changed' | 'kanban.task.deleted' | 'kanban.task.completed' | 'kanban.task.assigned';
    source: 'kanban';
    timestamp: number;
    payload: {
        taskId: string;
        projectId?: string;
        title?: string;
        status?: TaskStatus;
        oldStatus?: TaskStatus;
        assignee?: string;
        workflowId?: string;
        meetingId?: string;
        metadata?: Record<string, unknown>;
    };
}
export interface WorkflowEvent {
    type: 'workflow.started' | 'workflow.step_completed' | 'workflow.completed' | 'workflow.failed' | 'workflow.paused' | 'workflow.resumed' | 'workflow.cancelled';
    source: 'workflow';
    timestamp: number;
    payload: {
        workflowId: string;
        taskId?: string;
        stepIndex?: number;
        totalSteps?: number;
        output?: string;
        error?: string;
        tokenUsage?: TokenUsage;
        agentResults?: string[];
    };
}
export interface MeetingEvent {
    type: 'meeting.started' | 'meeting.round_completed' | 'meeting.completed' | 'meeting.cancelled';
    source: 'meeting';
    timestamp: number;
    payload: {
        meetingId: string;
        topic?: string;
        round?: number;
        totalRounds?: number;
        summary?: string;
        actionItems?: ActionItem[];
        participants?: string[];
        documentId?: string;
    };
}
export interface ActionItem {
    id: string;
    description: string;
    assignee?: string;
    priority: 'high' | 'medium' | 'low';
    dueDate?: string;
    autoCreateTask?: boolean;
}
export interface DocumentEvent {
    type: 'document.created' | 'document.updated' | 'document.linked';
    source: 'document';
    timestamp: number;
    payload: {
        documentId: string;
        projectId?: string;
        taskId?: string;
        type?: string;
        title?: string;
        tags?: string[];
        relatedTaskIds?: string[];
        relatedDocIds?: string[];
        metadata?: Record<string, unknown>;
    };
}
export interface ExperienceEvent {
    type: 'experience.captured';
    source: 'experience';
    timestamp: number;
    payload: {
        experienceId: string;
        workflowId: string;
        pipelineId?: string;
        projectId?: string;
        status?: string;
        summary?: string;
        metadata?: Record<string, unknown>;
    };
}
export interface SystemEvent {
    type: 'system.agent.started' | 'system.agent.stopped' | 'system.agent.error' | 'system.token_alert' | 'system.health_check';
    source: 'system';
    timestamp: number;
    payload: {
        agentId?: string;
        message?: string;
        severity?: 'info' | 'warning' | 'error';
        metadata?: Record<string, unknown>;
    };
}
export type AnyEvent = KanbanEvent | WorkflowEvent | MeetingEvent | DocumentEvent | ExperienceEvent | SystemEvent;
export type EventHandler<T = AnyEvent> = (event: T) => Promise<void>;
//# sourceMappingURL=types.d.ts.map