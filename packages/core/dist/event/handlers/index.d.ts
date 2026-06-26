/**
 * Event Handlers — 事件处理器注册入口
 *
 * 用法：
 *   import { registerAllHandlers } from '@open-agent-teams/core/event/handlers';
 *   registerAllHandlers({
 *     kanban: { runWorkflow: async (taskId, goal) => { ... } },
 *     workflow: { updateTaskStatus: async (taskId, status) => { ... } },
 *     meeting: { createKanbanTask: async (task) => { ... } },
 *   });
 */
import { registerKanbanHandlers, type KanbanHandlerDeps } from './KanbanHandler.js';
import { registerWorkflowHandlers, type WorkflowHandlerDeps } from './WorkflowHandler.js';
import { registerMeetingHandlers, type MeetingHandlerDeps } from './MeetingHandler.js';
export interface AllHandlerDeps {
    kanban?: KanbanHandlerDeps;
    workflow?: WorkflowHandlerDeps;
    meeting?: MeetingHandlerDeps;
}
/**
 * 注册所有事件处理器
 */
export declare function registerAllHandlers(deps?: AllHandlerDeps): void;
export { registerKanbanHandlers, type KanbanHandlerDeps };
export { registerWorkflowHandlers, type WorkflowHandlerDeps };
export { registerMeetingHandlers, type MeetingHandlerDeps };
//# sourceMappingURL=index.d.ts.map