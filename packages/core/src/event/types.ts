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

// ============================================================================

// ============================================================================
// 看板事件
// ============================================================================

export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'blocked';

export interface KanbanEvent {
  type:
    | 'kanban.task.created'
    | 'kanban.task.updated'
    | 'kanban.task.status_changed'
    | 'kanban.task.deleted'
    | 'kanban.task.completed'
    | 'kanban.task.assigned';
  source: 'kanban';
  timestamp: number;
  payload: {
    taskId: string;
    projectId?: string;
    title?: string;
    status?: TaskStatus;
    oldStatus?: TaskStatus;
    assignee?: string;
    workflowId?: string;      // 绑定的工作流 ID
    meetingId?: string;       // 关联的会议 ID
    metadata?: Record<string, unknown>;
  };
}

// ============================================================================
// 工作流事件
// ============================================================================

export interface WorkflowEvent {
  type:
    | 'workflow.started'
    | 'workflow.step_completed'
    | 'workflow.completed'
    | 'workflow.failed'
    | 'workflow.paused'
    | 'workflow.resumed'
    | 'workflow.cancelled';
  source: 'workflow';
  timestamp: number;
  payload: {
    workflowId: string;
    taskId?: string;            // 关联的看板任务
    stepIndex?: number;         // 当前步骤索引
    totalSteps?: number;        // 总步骤数
    output?: string;            // 步骤/工作流输出
    error?: string;             // 错误信息
    tokenUsage?: TokenUsage;        // Token 消耗
    agentResults?: string[];    // 参与 Agent 的结果摘要
  };
}

// ============================================================================
// 会议事件
// ============================================================================

export interface MeetingEvent {
  type:
    | 'meeting.started'
    | 'meeting.round_completed'
    | 'meeting.completed'
    | 'meeting.cancelled';
  source: 'meeting';
  timestamp: number;
  payload: {
    meetingId: string;
    topic?: string;
    round?: number;
    totalRounds?: number;
    summary?: string;           // 会议纪要
    actionItems?: ActionItem[]; // 行动项
    participants?: string[];      // 参与 Agent
    documentId?: string;        // 沉淀的文档 ID
  };
}

export interface ActionItem {
  id: string;
  description: string;
  assignee?: string;            // 负责 Agent
  priority: 'high' | 'medium' | 'low';
  dueDate?: string;
  autoCreateTask?: boolean;     // 是否自动创建看板任务
}

// ============================================================================
// 系统事件
// ============================================================================

export interface SystemEvent {
  type:
    | 'system.agent.started'
    | 'system.agent.stopped'
    | 'system.agent.error'
    | 'system.token_alert'
    | 'system.health_check';
  source: 'system';
  timestamp: number;
  payload: {
    agentId?: string;
    message?: string;
    severity?: 'info' | 'warning' | 'error';
    metadata?: Record<string, unknown>;
  };
}

// ============================================================================
// 通用类型
// ============================================================================

export type AnyEvent = KanbanEvent | WorkflowEvent | MeetingEvent | SystemEvent;

export type EventHandler<T = AnyEvent> = (event: T) => Promise<void>;
